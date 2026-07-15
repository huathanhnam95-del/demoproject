#!/usr/bin/env python3
"""
Phoneme recognizer backends — abstract base, Torch CTC, and ONNX stub.

Each backend loads a wav2vec2-style model and exposes a single
``recognize(samples, sample_rate)`` method that returns structured
phoneme-level results with timestamps, confidences, and a symbol table.

The concrete backend is chosen at runtime via ``create_backend()`` which
reads ``model-manifest.json`` and instantiates the appropriate engine.
"""

from __future__ import annotations

import abc
import json
import os
import struct
import threading
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_FILE_BYTES = 5 * 1024 * 1024          # 5 MB
MAX_DURATION_SEC = 15.0                    # 15 seconds
TARGET_SAMPLE_RATE = 16_000               # 16 kHz expected by wav2vec2
MODEL_STRIDE_SAMPLES = 320                # wav2vec2 receptive-field stride
STRIDE_MS = MODEL_STRIDE_SAMPLES / TARGET_SAMPLE_RATE * 1000  # 20 ms
CTC_BLANK_TOKEN_ID = 0                    # CTC blank is index 0

ENGINE_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class RecognizerBackend(abc.ABC):
    """Abstract interface every phoneme-recognition backend must satisfy."""

    @abc.abstractmethod
    def load(self) -> None:
        """Load and validate model dependencies and artifacts."""
        ...

    @abc.abstractmethod
    def recognize(
        self, samples: np.ndarray, sample_rate: int
    ) -> Dict[str, Any]:
        """Run phoneme recognition on raw audio samples.

        Parameters
        ----------
        samples : np.ndarray
            1-D float32 array of audio samples in [-1, 1].
        sample_rate : int
            Sample rate of *samples* (must be ``TARGET_SAMPLE_RATE``).

        Returns
        -------
        dict
            phonemes : list[dict]
                Each dict has ``symbol``, ``start_time``, ``end_time``,
                ``confidence``.
            raw_tokens : list[int]
                Raw CTC token IDs (blanks removed, repeats collapsed).
            effective_stride_ms : float
            engine_version : str
            model_revision : str
            symbol_table : list[str]
        """
        ...


# ---------------------------------------------------------------------------
# Torch backend
# ---------------------------------------------------------------------------


class TorchRecognizerBackend(RecognizerBackend):
    """CTC phoneme recognition using ``transformers.Wav2Vec2ForCTC``."""

    def __init__(self, manifest: Dict[str, Any]) -> None:
        self._manifest = manifest
        self._model_id: str = manifest["modelId"]
        self._model_revision: str = manifest["modelRevision"]
        self._model: Any = None
        self._processor: Any = None
        self._symbol_table: List[str] = []
        self._lock = threading.Lock()

    # -- lazy load ----------------------------------------------------------

    def _ensure_loaded(self) -> None:
        """Load model + processor on first call (thread-safe)."""
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:         # double-check
                return
            # These imports are deferred so the module can be loaded
            # even when torch / transformers are not installed (e.g.
            # for unit-testing with mocks).
            import torch  # noqa: F811
            from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

            self._processor = Wav2Vec2Processor.from_pretrained(
                self._model_id, revision=self._model_revision
            )
            self._model = Wav2Vec2ForCTC.from_pretrained(
                self._model_id, revision=self._model_revision
            )
            self._model.eval()

            # Build symbol table from tokenizer vocabulary
            vocab = self._processor.tokenizer.get_vocab()
            # Invert {token: id} → list ordered by id
            inv = [""] * len(vocab)
            for tok, idx in vocab.items():
                inv[idx] = tok
            self._symbol_table = inv

    # -- public API ---------------------------------------------------------

    def load(self) -> None:
        self._ensure_loaded()

    def recognize(
        self, samples: np.ndarray, sample_rate: int
    ) -> Dict[str, Any]:
        self._ensure_loaded()

        import torch

        # Prepare input tensors
        inputs = self._processor(
            samples,
            sampling_rate=sample_rate,
            return_tensors="pt",
            padding=True,
        )

        with torch.no_grad():
            logits = self._model(**inputs).logits  # (1, T, V)

        # Softmax → per-frame confidence
        probs = torch.softmax(logits, dim=-1)          # (1, T, V)
        pred_ids = torch.argmax(probs, dim=-1)[0]      # (T,)
        max_probs = probs[0].max(dim=-1).values        # (T,)

        # CTC decode: remove blanks, collapse repeats
        phonemes, raw_tokens = _ctc_decode(
            pred_ids.cpu().numpy(),
            max_probs.cpu().numpy(),
            self._symbol_table,
        )

        return {
            "phonemes": phonemes,
            "raw_tokens": raw_tokens,
            "effective_stride_ms": STRIDE_MS,
            "engine_version": ENGINE_VERSION,
            "model_revision": self._model_revision,
            "symbol_table": list(self._symbol_table),
        }


# ---------------------------------------------------------------------------
# ONNX stub backend
# ---------------------------------------------------------------------------


class OnnxRecognizerBackend(RecognizerBackend):
    """Stub ONNX backend — raises ``NotImplementedError`` until an ONNX
    export of the model is available."""

    def __init__(self, manifest: Dict[str, Any]) -> None:
        self._manifest = manifest
        self._model_id: str = manifest["modelId"]
        self._model_revision: str = manifest["modelRevision"]

    def recognize(
        self, samples: np.ndarray, sample_rate: int
    ) -> Dict[str, Any]:
        raise NotImplementedError(
            f"ONNX backend is not yet implemented for model "
            f"'{self._model_id}' (revision {self._model_revision}). "
            f"Use the 'torch' engine instead."
        )

    def load(self) -> None:
        raise NotImplementedError(
            f"ONNX backend is not yet implemented for model '{self._model_id}'."
        )


# ---------------------------------------------------------------------------
# CTC decode helper (shared)
# ---------------------------------------------------------------------------


def _ctc_decode(
    pred_ids: np.ndarray,
    max_probs: np.ndarray,
    symbol_table: List[str],
) -> tuple:
    """Remove CTC blanks, collapse repeated frames, derive timestamps.

    Returns
    -------
    phonemes : list[dict]
        Each entry: ``{symbol, start_time, end_time, confidence}``.
    raw_tokens : list[int]
        Token IDs after blank-removal and repeat-collapse.
    """
    phonemes: List[Dict[str, Any]] = []
    raw_tokens: List[int] = []

    prev_id: Optional[int] = None
    group_start: Optional[int] = None
    group_probs: List[float] = []

    for frame_idx, token_id in enumerate(pred_ids):
        token_id = int(token_id)
        if token_id == CTC_BLANK_TOKEN_ID:
            # Flush current group
            if prev_id is not None and prev_id != CTC_BLANK_TOKEN_ID:
                _flush_group(
                    phonemes, raw_tokens, prev_id,
                    group_start, frame_idx, group_probs, symbol_table,
                )
            prev_id = token_id
            group_start = None
            group_probs = []
            continue

        if token_id == prev_id:
            # Same token continues — extend group
            group_probs.append(float(max_probs[frame_idx]))
        else:
            # New token — flush previous group first
            if prev_id is not None and prev_id != CTC_BLANK_TOKEN_ID:
                _flush_group(
                    phonemes, raw_tokens, prev_id,
                    group_start, frame_idx, group_probs, symbol_table,
                )
            prev_id = token_id
            group_start = frame_idx
            group_probs = [float(max_probs[frame_idx])]

    # Flush last group
    if prev_id is not None and prev_id != CTC_BLANK_TOKEN_ID:
        _flush_group(
            phonemes, raw_tokens, prev_id,
            group_start, len(pred_ids), group_probs, symbol_table,
        )

    return phonemes, raw_tokens


def _flush_group(
    phonemes: List[Dict[str, Any]],
    raw_tokens: List[int],
    token_id: int,
    start_frame: int,
    end_frame: int,
    probs: List[float],
    symbol_table: List[str],
) -> None:
    """Append a decoded phoneme entry from a contiguous CTC frame group."""
    if start_frame is None:
        return
    start_sec = start_frame * STRIDE_MS / 1000.0
    end_sec = end_frame * STRIDE_MS / 1000.0
    confidence = float(np.mean(probs)) if probs else 0.0
    symbol = symbol_table[token_id] if token_id < len(symbol_table) else "?"

    phonemes.append({
        "symbol": symbol,
        "start_time": round(start_sec, 4),
        "end_time": round(end_sec, 4),
        "confidence": round(confidence, 4),
    })
    raw_tokens.append(token_id)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_backend(manifest_path: str) -> RecognizerBackend:
    """Instantiate the correct backend from a ``model-manifest.json`` file.

    Parameters
    ----------
    manifest_path : str
        Absolute or relative path to the manifest JSON file.

    Returns
    -------
    RecognizerBackend

    Raises
    ------
    FileNotFoundError
        If *manifest_path* does not exist.
    ValueError
        If the manifest specifies an unsupported engine.
    """
    p = Path(manifest_path)
    if not p.exists():
        raise FileNotFoundError(
            f"Model manifest not found at '{p.resolve()}'. "
            f"Run the phoneme model benchmark probe first to generate it."
        )

    with open(p, "r", encoding="utf-8") as fh:
        manifest: Dict[str, Any] = json.load(fh)

    engine = manifest.get("selectedEngine", "").lower()

    if engine == "torch":
        return TorchRecognizerBackend(manifest)
    elif engine == "onnx":
        return OnnxRecognizerBackend(manifest)
    else:
        raise ValueError(
            f"Unsupported engine '{engine}' in manifest. "
            f"Expected 'torch' or 'onnx'."
        )
