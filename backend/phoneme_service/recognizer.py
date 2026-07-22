#!/usr/bin/env python3
"""
High-level phoneme recognizer — wraps a backend with audio preprocessing,
validation, and thread-safe singleton management.

Usage::

    from backend.phoneme_service.recognizer import get_recognizer

    recognizer = get_recognizer()          # lazy-loaded singleton
    result = recognizer.recognize_wav(wav_bytes)
"""

from __future__ import annotations

import io
import struct
import threading
import time
import wave
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np

from backend.phoneme_service.backends import (
    MAX_DURATION_SEC,
    MAX_FILE_BYTES,
    TARGET_SAMPLE_RATE,
    RecognizerBackend,
    create_backend,
)

# ---------------------------------------------------------------------------
# Default manifest location (sibling to this module)
# ---------------------------------------------------------------------------

_DEFAULT_MANIFEST = str(
    Path(__file__).resolve().parent / "model-manifest.json"
)

# ---------------------------------------------------------------------------
# Audio helper functions
# ---------------------------------------------------------------------------


def _decode_wav(wav_bytes: bytes) -> tuple:
    """Decode raw WAV bytes → (samples_int, sample_rate, n_channels, sampwidth).

    Uses the stdlib ``wave`` module so no extra dependencies are required.
    """
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        sample_rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    # Unpack raw PCM to integer array
    if sampwidth == 1:
        fmt = f"<{len(raw)}B"
        samples = np.array(struct.unpack(fmt, raw), dtype=np.int16) - 128
    elif sampwidth == 2:
        fmt = f"<{len(raw) // 2}h"
        samples = np.array(struct.unpack(fmt, raw), dtype=np.int16)
    elif sampwidth == 4:
        fmt = f"<{len(raw) // 4}i"
        samples = np.array(struct.unpack(fmt, raw), dtype=np.int32)
    else:
        raise ValueError(f"Unsupported WAV sample width: {sampwidth}")

    # Reshape for multi-channel
    if n_channels > 1:
        samples = samples.reshape(-1, n_channels)

    return samples, sample_rate, n_channels, sampwidth


def _to_mono_float32(
    samples: np.ndarray, n_channels: int, sampwidth: int
) -> np.ndarray:
    """Convert integer PCM samples to mono float32 in [-1, 1]."""
    if n_channels > 1:
        # Downmix by averaging channels
        samples = samples.astype(np.float64).mean(axis=1)

    samples = samples.astype(np.float32)

    # Normalize to [-1, 1]
    if sampwidth == 1:
        samples = samples / 128.0
    elif sampwidth == 2:
        samples = samples / 32768.0
    elif sampwidth == 4:
        samples = samples / 2147483648.0

    return samples


def _resample(samples: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Resample *samples* from *orig_sr* → *target_sr* using scipy."""
    if orig_sr == target_sr:
        return samples
    try:
        from scipy.signal import resample as scipy_resample
    except ImportError:
        raise ImportError(
            "scipy is required for resampling. Install it with: "
            "pip install scipy"
        )
    num_target = int(len(samples) * target_sr / orig_sr)
    return scipy_resample(samples, num_target).astype(np.float32)


# ---------------------------------------------------------------------------
# Recognizer
# ---------------------------------------------------------------------------


class PhonemeRecognizer:
    """Thread-safe wrapper around a :class:`RecognizerBackend`.

    * Validates size and duration limits.
    * Decodes WAV, converts to mono float32, resamples.
    * Calls the backend and returns enriched results.
    """

    def __init__(self, backend: RecognizerBackend) -> None:
        self._backend = backend
        self._semaphore = threading.Semaphore(1)

    # -- public API ---------------------------------------------------------

    def recognize_wav(self, wav_bytes: bytes) -> Dict[str, Any]:
        """Recognize phonemes from raw WAV file bytes.

        Parameters
        ----------
        wav_bytes : bytes
            Contents of a WAV file (PCM encoded).

        Returns
        -------
        dict
            Recognition result from the backend, augmented with
            ``preprocessing`` timing metadata.

        Raises
        ------
        ValueError
            If the file exceeds size or duration limits.
        """
        t0 = time.monotonic()

        # --- validation ---
        if len(wav_bytes) > MAX_FILE_BYTES:
            raise ValueError(
                f"WAV file too large: {len(wav_bytes)} bytes "
                f"(max {MAX_FILE_BYTES} bytes / "
                f"{MAX_FILE_BYTES / 1024 / 1024:.0f} MB)."
            )

        samples_int, orig_sr, n_channels, sampwidth = _decode_wav(wav_bytes)

        # Duration check (based on raw frame count)
        if n_channels > 1:
            n_frames = samples_int.shape[0]
        else:
            n_frames = len(samples_int)
        duration_sec = n_frames / orig_sr
        if duration_sec > MAX_DURATION_SEC:
            raise ValueError(
                f"Audio too long: {duration_sec:.1f}s "
                f"(max {MAX_DURATION_SEC}s)."
            )

        # --- preprocessing ---
        samples = _to_mono_float32(samples_int, n_channels, sampwidth)
        samples = _resample(samples, orig_sr, TARGET_SAMPLE_RATE)

        preprocess_ms = (time.monotonic() - t0) * 1000

        # --- inference (thread-safe) ---
        self._semaphore.acquire()
        try:
            t1 = time.monotonic()
            result = self._backend.recognize(samples, TARGET_SAMPLE_RATE)
            inference_ms = (time.monotonic() - t1) * 1000
        finally:
            self._semaphore.release()

        result["preprocessing"] = {
            "original_sample_rate": orig_sr,
            "original_channels": n_channels,
            "original_duration_sec": round(duration_sec, 4),
            "preprocess_ms": round(preprocess_ms, 2),
            "inference_ms": round(inference_ms, 2),
        }
        return result


# ---------------------------------------------------------------------------
# Singleton / lazy loader
# ---------------------------------------------------------------------------

_instance: Optional[PhonemeRecognizer] = None
_instance_lock = threading.Lock()


def get_recognizer(
    manifest_path: Optional[str] = None,
) -> PhonemeRecognizer:
    """Return (and lazily create) the singleton :class:`PhonemeRecognizer`.

    Parameters
    ----------
    manifest_path : str, optional
        Path to ``model-manifest.json``.  Defaults to the file next to
        this module.
    """
    global _instance
    if _instance is not None:
        return _instance
    with _instance_lock:
        if _instance is not None:
            return _instance
        path = manifest_path or _DEFAULT_MANIFEST
        backend = create_backend(path)
        _instance = PhonemeRecognizer(backend)
        return _instance


def reset_recognizer() -> None:
    """Reset the singleton (useful for testing)."""
    global _instance
    with _instance_lock:
        _instance = None
