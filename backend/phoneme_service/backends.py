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


def ctc_forward_log_likelihood(
    log_probs: np.ndarray,
    target_ids: List[int],
    *,
    blank_id: int = CTC_BLANK_TOKEN_ID,
) -> Dict[str, Any]:
    """Return the complete CTC forward-sum likelihood for a target sequence.

    Unlike a Viterbi score, this sums every valid CTC path in log space. The
    normalized value is divided by the observed frame count so hypotheses of
    different lengths remain comparable without an arbitrary correction.
    """
    emissions = np.asarray(log_probs, dtype=float)
    targets = [int(value) for value in target_ids]
    if emissions.ndim != 2 or emissions.shape[0] == 0:
        raise ValueError("log_probs must be a non-empty 2-D array")
    if not targets:
        return {"log_likelihood": 0.0, "normalized_log_likelihood": 0.0, "path_count": 1, "target_length": 0}
    if any(token == blank_id or token < 0 or token >= emissions.shape[1] for token in targets):
        raise ValueError("target token is outside the vocabulary or is the blank")
    labels: list[int] = [blank_id]
    for token in targets:
        labels.extend((token, blank_id))
    states = len(labels)
    neg_inf = -np.inf
    alpha = np.full(states, neg_inf, dtype=float)
    alpha[0] = 0.0
    path_count = np.zeros(states, dtype=object)
    path_count[0] = 1
    for frame in range(emissions.shape[0]):
        next_alpha = np.full(states, neg_inf, dtype=float)
        next_count = np.zeros(states, dtype=object)
        for state, label in enumerate(labels):
            candidates = [state]
            if state > 0:
                candidates.append(state - 1)
            if state > 1 and label != blank_id and label != labels[state - 2]:
                candidates.append(state - 2)
            values = np.asarray([alpha[index] for index in candidates], dtype=float)
            next_alpha[state] = np.logaddexp.reduce(values) + emissions[frame, label]
            next_count[state] = sum(path_count[index] for index in candidates)
        alpha, path_count = next_alpha, next_count
    terminal = [states - 1]
    if states > 1:
        terminal.append(states - 2)
    log_likelihood = float(np.logaddexp.reduce(alpha[terminal]))
    return {
        "log_likelihood": log_likelihood,
        "normalized_log_likelihood": log_likelihood / emissions.shape[0],
        "path_count": int(sum(path_count[index] for index in terminal)),
        "target_length": len(targets),
        "frame_count": int(emissions.shape[0]),
    }


def ctc_forced_align(
    log_probs: np.ndarray,
    target_ids: List[int],
    *,
    blank_id: int = CTC_BLANK_TOKEN_ID,
) -> Dict[str, Any]:
    """Viterbi-align a known CTC target sequence to frame log probabilities.

    The returned spans are useful for measuring acoustic features on the
    target phones without pretending that a target-guided syllable count was
    independently observed.  Repeated target IDs are separated with the
    standard CTC blank states.
    """
    emissions = np.asarray(log_probs, dtype=float)
    targets = [int(value) for value in target_ids]
    if emissions.ndim != 2:
        raise ValueError("log_probs must be a 2-D frame-by-vocabulary array")
    if not targets:
        return {
            "aligned": True,
            "target_ids": [],
            "spans": [],
            "score": 0.0,
            "normalized_score": 0.0,
        }
    if any(value == blank_id for value in targets):
        raise ValueError("target_ids must not contain the CTC blank token")
    if emissions.shape[0] < len(targets):
        return {
            "aligned": False,
            "target_ids": targets,
            "spans": [],
            "score": float("-inf"),
            "normalized_score": float("-inf"),
            "reason": "INSUFFICIENT_FRAMES",
        }

    labels: List[int] = []
    for target in targets:
        labels.extend((blank_id, target))
    labels.append(blank_id)
    state_count = len(labels)
    frame_count = emissions.shape[0]
    neg_inf = float("-inf")
    scores = np.full((frame_count + 1, state_count), neg_inf, dtype=float)
    back = np.full((frame_count + 1, state_count), -1, dtype=np.int32)
    scores[0, 0] = 0.0

    for frame in range(frame_count):
        for state, label in enumerate(labels):
            candidates = [(scores[frame, state], state)]
            if state > 0:
                candidates.append((scores[frame, state - 1], state - 1))
            if (
                state > 1
                and label != blank_id
                and label != labels[state - 2]
            ):
                candidates.append((scores[frame, state - 2], state - 2))
            previous_score, previous_state = max(candidates, key=lambda item: item[0])
            if np.isfinite(previous_score):
                scores[frame + 1, state] = previous_score + emissions[frame, label]
                back[frame + 1, state] = previous_state

    end_state = state_count - 1
    if state_count > 1 and scores[frame_count, state_count - 2] > scores[frame_count, end_state]:
        end_state = state_count - 2
    if not np.isfinite(scores[frame_count, end_state]):
        return {
            "aligned": False,
            "target_ids": targets,
            "spans": [],
            "score": float("-inf"),
            "normalized_score": float("-inf"),
            "reason": "NO_VALID_CTC_PATH",
        }

    state_path = []
    state = end_state
    for frame in range(frame_count, 0, -1):
        state_path.append(state)
        state = int(back[frame, state])
        if state < 0:
            return {
                "aligned": False,
                "target_ids": targets,
                "spans": [],
                "score": float("-inf"),
                "normalized_score": float("-inf"),
                "reason": "BROKEN_CTC_BACKTRACE",
            }
    state_path.reverse()

    spans = []
    for target_index, target in enumerate(targets):
        target_state = (target_index * 2) + 1
        frames = [
            frame
            for frame, state_value in enumerate(state_path)
            if state_value == target_state
        ]
        if not frames:
            return {
                "aligned": False,
                "target_ids": targets,
                "spans": [],
                "score": float("-inf"),
                "normalized_score": float("-inf"),
                "reason": "TARGET_TOKEN_UNOBSERVED",
            }
        target_probs = np.exp(emissions[frames, target])
        spans.append({
            "target_id": target,
            "start_frame": min(frames),
            "end_frame": max(frames) + 1,
            "confidence": round(float(np.mean(target_probs)), 6),
        })

    score = float(scores[frame_count, end_state])
    return {
        "aligned": True,
        "target_ids": targets,
        "spans": spans,
        "score": score,
        "normalized_score": score / frame_count,
    }

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
        self._blank_id: int = int(manifest.get("blankTokenId", CTC_BLANK_TOKEN_ID))
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

            try:
                self._processor = Wav2Vec2Processor.from_pretrained(
                    self._model_id, revision=self._model_revision
                )
            except Exception:
                from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2CTCTokenizer
                fe = Wav2Vec2FeatureExtractor.from_pretrained(
                    self._model_id, revision=self._model_revision
                )
                tok = Wav2Vec2CTCTokenizer.from_pretrained(
                    self._model_id, revision=self._model_revision
                )
                self._processor = Wav2Vec2Processor(feature_extractor=fe, tokenizer=tok)

            self._model = Wav2Vec2ForCTC.from_pretrained(
                self._model_id, revision=self._model_revision
            )
            self._model.eval()
            config_blank = getattr(self._model.config, "pad_token_id", None)
            tokenizer_blank = getattr(self._processor.tokenizer, "pad_token_id", None)
            configured = config_blank if config_blank is not None else tokenizer_blank
            if configured is not None:
                if config_blank is not None and tokenizer_blank is not None and int(config_blank) != int(tokenizer_blank):
                    raise RuntimeError("CTC blank ID conflicts between model config and tokenizer")
                self._blank_id = int(configured)


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
        result = self.recognize_with_logits(samples, sample_rate)
        result.pop("log_probs", None)
        return result

    def recognize_with_logits(
        self, samples: np.ndarray, sample_rate: int
    ) -> Dict[str, Any]:
        """Recognize audio and expose frame-level log probabilities."""
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

        log_probs = torch.log_softmax(logits, dim=-1)[0].cpu().numpy()

        # Softmax → per-frame confidence
        probs = torch.softmax(logits, dim=-1)          # (1, T, V)
        pred_ids = torch.argmax(probs, dim=-1)[0]      # (T,)
        max_probs = probs[0].max(dim=-1).values        # (T,)

        # CTC decode: remove blanks, collapse repeats
        phonemes, raw_tokens = _ctc_decode(
            pred_ids.cpu().numpy(),
            max_probs.cpu().numpy(),
            self._symbol_table,
            blank_id=self._blank_id,
            sample_duration_sec=(len(samples) / sample_rate),
        )

        return {
            "phonemes": phonemes,
            "raw_tokens": raw_tokens,
            "effective_stride_ms": STRIDE_MS,
            "engine_version": ENGINE_VERSION,
            "model_revision": self._model_revision,
            "symbol_table": list(self._symbol_table),
            "blank_id": self._blank_id,
            "frame_count": int(log_probs.shape[0]),
            "sample_count": int(len(samples)),
            "sample_rate": int(sample_rate),
            "log_probs": log_probs,
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
    *,
    blank_id: int = CTC_BLANK_TOKEN_ID,
    sample_duration_sec: float | None = None,
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
    frame_duration = (sample_duration_sec / len(pred_ids)) if sample_duration_sec and len(pred_ids) else STRIDE_MS / 1000.0

    prev_id: Optional[int] = None
    group_start: Optional[int] = None
    group_probs: List[float] = []

    for frame_idx, token_id in enumerate(pred_ids):
        token_id = int(token_id)
        if token_id == blank_id:
            # Flush current group
            if prev_id is not None and prev_id != blank_id:
                _flush_group(
                    phonemes, raw_tokens, prev_id,
                    group_start, frame_idx, group_probs, symbol_table,
                    frame_duration_sec=frame_duration,
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
            if prev_id is not None and prev_id != blank_id:
                _flush_group(
                    phonemes, raw_tokens, prev_id,
                    group_start, frame_idx, group_probs, symbol_table,
                    frame_duration_sec=frame_duration,
                )
            prev_id = token_id
            group_start = frame_idx
            group_probs = [float(max_probs[frame_idx])]

    # Flush last group
    if prev_id is not None and prev_id != blank_id:
        _flush_group(
            phonemes, raw_tokens, prev_id,
            group_start, len(pred_ids), group_probs, symbol_table,
            frame_duration_sec=frame_duration,
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
    frame_duration_sec: float = STRIDE_MS / 1000.0,
) -> None:
    """Append a decoded phoneme entry from a contiguous CTC frame group."""
    if start_frame is None:
        return
    start_sec = start_frame * frame_duration_sec
    end_sec = end_frame * frame_duration_sec
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
