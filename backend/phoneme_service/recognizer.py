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

from dataclasses import dataclass
import io
import json
import logging
import os
import struct
import threading
import time
import uuid
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

logger = logging.getLogger(__name__)

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
# Inference Gate Observability
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class InferenceGateAcquisition:
    """Result of attempting to acquire the inference gate."""
    acquired: bool
    request_id: str
    active_request_age_ms: Optional[float] = None


class InferenceGate:
    """Thread-safe single-inference gate tracking and structured logging.

    Enforces the single-inference invariant, measures monotonic active
    request age and inference duration, and emits privacy-safe structured
    logs without exposing audio payloads, token sequences, or learner IPA.
    """

    def __init__(self, semaphore: Optional[threading.Semaphore] = None) -> None:
        self._semaphore = semaphore if semaphore is not None else threading.Semaphore(1)
        self._lock = threading.Lock()
        self._active_request_id: Optional[str] = None
        self._active_endpoint: Optional[str] = None
        self._active_start_time: Optional[float] = None
        self._revision = os.environ.get("K_REVISION", "local")
        self._instance_id = os.environ.get("HOSTNAME", os.environ.get("INSTANCE_ID", "local"))

    @property
    def semaphore(self) -> threading.Semaphore:
        return self._semaphore

    @property
    def active_request_id(self) -> Optional[str]:
        with self._lock:
            return self._active_request_id

    @property
    def active_request_age_ms(self) -> Optional[float]:
        with self._lock:
            if self._active_start_time is None:
                return None
            return round((time.monotonic() - self._active_start_time) * 1000, 2)

    def acquire(
        self,
        endpoint: str,
        request_id: Optional[str] = None,
        blocking: bool = True,
        timeout: Optional[float] = None,
    ) -> InferenceGateAcquisition:
        """Acquire the inference gate (blocking or non-blocking)."""
        now = time.monotonic()
        req_id = request_id or uuid.uuid4().hex[:12]

        if not blocking:
            with self._lock:
                if not self._semaphore.acquire(blocking=False):
                    age_ms = None
                    if self._active_start_time is not None:
                        age_ms = round((now - self._active_start_time) * 1000, 2)
                    self._log_event(
                        event="RECOGNIZER_BUSY",
                        request_id=req_id,
                        endpoint=endpoint,
                        outcome="busy",
                        active_request_age_ms=age_ms,
                        inference_duration_ms=None,
                    )
                    return InferenceGateAcquisition(
                        acquired=False, request_id=req_id, active_request_age_ms=age_ms
                    )
                self._active_request_id = req_id
                self._active_endpoint = endpoint
                self._active_start_time = now
                self._log_event(
                    event="INFERENCE_ACQUIRED",
                    request_id=req_id,
                    endpoint=endpoint,
                    outcome="acquired",
                    active_request_age_ms=0.0,
                    inference_duration_ms=None,
                )
                return InferenceGateAcquisition(
                    acquired=True, request_id=req_id, active_request_age_ms=0.0
                )

        # Blocking acquisition
        kw = {} if timeout is None else {"timeout": timeout}
        acquired = self._semaphore.acquire(blocking=True, **kw)
        now_acquired = time.monotonic()
        if not acquired:
            return InferenceGateAcquisition(
                acquired=False, request_id=req_id, active_request_age_ms=None
            )
        with self._lock:
            self._active_request_id = req_id
            self._active_endpoint = endpoint
            self._active_start_time = now_acquired
            self._log_event(
                event="INFERENCE_ACQUIRED",
                request_id=req_id,
                endpoint=endpoint,
                outcome="acquired",
                active_request_age_ms=0.0,
                inference_duration_ms=None,
            )
            return InferenceGateAcquisition(
                acquired=True, request_id=req_id, active_request_age_ms=0.0
            )

    def try_acquire(
        self, endpoint: str, request_id: Optional[str] = None
    ) -> InferenceGateAcquisition:
        """Attempt non-blocking acquisition of the inference gate."""
        return self.acquire(endpoint=endpoint, request_id=request_id, blocking=False)

    def release(
        self, outcome: str = "completed", inference_duration_ms: Optional[float] = None
    ) -> None:
        """Release the gate and record structured completion telemetry."""
        now = time.monotonic()
        with self._lock:
            req_id = self._active_request_id or "unknown"
            endpoint = self._active_endpoint or "unknown"
            duration = inference_duration_ms
            if duration is None and self._active_start_time is not None:
                duration = round((now - self._active_start_time) * 1000, 2)
            self._active_request_id = None
            self._active_endpoint = None
            self._active_start_time = None
            try:
                self._semaphore.release()
            except ValueError:
                pass
            self._log_event(
                event="INFERENCE_RELEASED",
                request_id=req_id,
                endpoint=endpoint,
                outcome=outcome,
                active_request_age_ms=None,
                inference_duration_ms=duration,
            )

    def _log_event(
        self,
        event: str,
        request_id: str,
        endpoint: str,
        outcome: str,
        active_request_age_ms: Optional[float],
        inference_duration_ms: Optional[float],
    ) -> None:
        payload = {
            "event": event,
            "requestId": request_id,
            "endpoint": endpoint,
            "outcome": outcome,
            "activeRequestAgeMs": active_request_age_ms,
            "inferenceDurationMs": inference_duration_ms,
            "revision": self._revision,
            "instanceId": self._instance_id,
        }
        logger.info(json.dumps(payload))


# ---------------------------------------------------------------------------
# Recognizer
# ---------------------------------------------------------------------------


class PhonemeRecognizer:
    """Thread-safe wrapper around a :class:`RecognizerBackend`.

    * Validates size and duration limits.
    * Decodes WAV, converts to mono float32, resamples.
    * Calls the backend and returns enriched results.
    """

    def __init__(
        self,
        backend: RecognizerBackend,
        gate: Optional[InferenceGate] = None,
    ) -> None:
        self._backend = backend
        self._gate = gate if gate is not None else InferenceGate()
        self._semaphore = self._gate.semaphore

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

        # --- inference (thread-safe gate) ---
        self._gate.acquire(endpoint="/recognize_wav", blocking=True)

        outcome = "completed"
        inference_ms = 0.0
        try:
            t1 = time.monotonic()
            result = self._backend.recognize(samples, TARGET_SAMPLE_RATE)
            inference_ms = (time.monotonic() - t1) * 1000
        except Exception:
            outcome = "error"
            raise
        finally:
            self._gate.release(outcome=outcome, inference_duration_ms=round(inference_ms, 2))

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
