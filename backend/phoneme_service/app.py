#!/usr/bin/env python3
"""
Flask application for the phoneme segmentation microservice.

Endpoints
---------
POST /recognize/v1   – private inference (multipart or base64 JSON)
GET  /healthz        – liveness probe (never touches the model)
GET  /readyz         – readiness probe (model loaded & manifest valid)
GET  /version        – build / model metadata
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Flask, Response, jsonify, request

from backend.phoneme_service.backends import (
    ENGINE_VERSION,
    MAX_FILE_BYTES,
    RecognizerBackend,
    create_backend,
)
from backend.phoneme_service.recognizer import PhonemeRecognizer
from backend.phoneme_service.syllabifier import (
    REASON_RECOGNIZER_BUSY,
    IndependentSyllabifier,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default paths
# ---------------------------------------------------------------------------
_MANIFEST_PATH = str(
    Path(__file__).resolve().parent / "model-manifest.json"
)

# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app(
    manifest_path: Optional[str] = None,
    backend_override: Optional[RecognizerBackend] = None,
) -> Flask:
    """Create and configure the Flask application.

    Parameters
    ----------
    manifest_path : str, optional
        Path to ``model-manifest.json``.  Defaults to the file next to
        this module.
    backend_override : RecognizerBackend, optional
        If provided, skip manifest loading and use this backend directly.
        Useful for testing.
    """
    app = Flask(__name__)

    manifest_file = manifest_path or _MANIFEST_PATH

    # --- app-level state (stored on app.config) ---
    app.config["MANIFEST_PATH"] = manifest_file
    app.config["BUILD_SHA"] = os.environ.get("BUILD_SHA", "dev")
    app.config["PORT"] = int(os.environ.get("PORT", "8081"))

    # Mutable state guarded by _init_lock
    _init_lock = threading.Lock()
    _state: Dict[str, Any] = {
        "backend": backend_override,
        "recognizer": None,
        "syllabifier": None,
        "manifest": None,
        "manifest_checksum": None,
        "ready": False,
    }

    # ---------------------------------------------------------------
    # Lazy initialisation
    # ---------------------------------------------------------------

    def _ensure_initialised() -> None:
        """Load model, tokenizer, and syllabifier on first need."""
        if _state["ready"]:
            return
        with _init_lock:
            if _state["ready"]:
                return

            # Load manifest
            mp = Path(app.config["MANIFEST_PATH"])
            if not mp.exists():
                raise FileNotFoundError(
                    f"Model manifest not found at '{mp.resolve()}'."
                )
            with open(mp, "r", encoding="utf-8") as fh:
                manifest = json.load(fh)
            _state["manifest"] = manifest

            # Compute checksum
            raw_bytes = mp.read_bytes()
            _state["manifest_checksum"] = hashlib.sha256(raw_bytes).hexdigest()

            # Create backend (or use override)
            if _state["backend"] is None:
                _state["backend"] = create_backend(str(mp))

            # Create recognizer
            _state["recognizer"] = PhonemeRecognizer(_state["backend"])

            # Create syllabifier with calibrated thresholds from manifest
            quality = manifest.get("quality", {})
            mean_threshold = quality.get("meanPhonemeConfidence", 0.65)
            nucleus_threshold = quality.get("minNucleusConfidence", 0.45)
            _state["syllabifier"] = IndependentSyllabifier(
                mean_confidence_threshold=mean_threshold,
                nucleus_confidence_threshold=nucleus_threshold,
            )

            _state["ready"] = True
            logger.info(
                "Phoneme service initialised: engine=%s model=%s",
                manifest.get("selectedEngine"),
                manifest.get("modelId"),
            )

    # ---------------------------------------------------------------
    # GET /healthz — liveness
    # ---------------------------------------------------------------

    @app.route("/healthz", methods=["GET"])
    def healthz() -> tuple:
        return jsonify({"status": "ok"}), 200

    # ---------------------------------------------------------------
    # GET /readyz — readiness
    # ---------------------------------------------------------------

    @app.route("/readyz", methods=["GET"])
    def readyz() -> tuple:
        try:
            _ensure_initialised()
        except Exception as exc:
            logger.warning("readyz: not ready — %s", exc)
            return jsonify({
                "status": "not_ready",
                "reason": str(exc),
            }), 503

        if not _state["ready"]:
            return jsonify({
                "status": "not_ready",
                "reason": "Model not loaded",
            }), 503

        # Verify manifest and backend are valid
        if _state["manifest"] is None or _state["backend"] is None:
            return jsonify({
                "status": "not_ready",
                "reason": "Backend or manifest missing",
            }), 503

        return jsonify({"status": "ready"}), 200

    # ---------------------------------------------------------------
    # GET /version — metadata
    # ---------------------------------------------------------------

    @app.route("/version", methods=["GET"])
    def version() -> tuple:
        # Try to initialise to get manifest data, but don't fail hard
        try:
            _ensure_initialised()
        except Exception:
            pass

        manifest = _state.get("manifest") or {}
        return jsonify({
            "engine": manifest.get("selectedEngine", "unknown"),
            "model_revision": manifest.get("modelRevision", "unknown"),
            "manifest_checksum": _state.get("manifest_checksum", "unknown"),
            "build_sha": app.config["BUILD_SHA"],
        }), 200

    # ---------------------------------------------------------------
    # POST /recognize/v1 — inference
    # ---------------------------------------------------------------

    @app.route("/recognize/v1", methods=["POST"])
    def recognize_v1() -> tuple:
        t_total_start = time.monotonic()

        # --- Extract audio bytes ---
        wav_bytes: Optional[bytes] = None

        # Option 1: multipart file upload
        if "audio" in request.files:
            wav_bytes = request.files["audio"].read()
        # Option 2: JSON body with base64
        elif request.is_json:
            body = request.get_json(silent=True) or {}
            b64 = body.get("audio_base64")
            if b64:
                try:
                    wav_bytes = base64.b64decode(b64)
                except Exception:
                    return _error_response(
                        "INVALID_BASE64",
                        "Could not decode audio_base64 field.",
                        400,
                    )

        if wav_bytes is None:
            return _error_response(
                "NO_AUDIO",
                "No audio provided. Send multipart 'audio' file "
                "or JSON with 'audio_base64'.",
                400,
            )

        # --- Size validation ---
        if len(wav_bytes) > MAX_FILE_BYTES:
            return _error_response(
                "AUDIO_TOO_LARGE",
                f"Audio file too large: {len(wav_bytes)} bytes "
                f"(max {MAX_FILE_BYTES} bytes).",
                400,
            )

        # --- Ensure service is initialised ---
        try:
            _ensure_initialised()
        except Exception as exc:
            return _error_response(
                "SERVICE_UNAVAILABLE",
                f"Service not ready: {exc}",
                503,
            )

        recognizer: PhonemeRecognizer = _state["recognizer"]
        syllabifier: IndependentSyllabifier = _state["syllabifier"]

        # --- Run inference (with semaphore busy check) ---
        if not recognizer._semaphore.acquire(blocking=False):
            return _error_response(
                "RECOGNIZER_BUSY",
                "The recognizer is currently processing another request. "
                "Please retry shortly.",
                503,
            )

        try:
            t_infer_start = time.monotonic()
            try:
                rec_result = recognizer._backend.recognize(
                    *_preprocess_wav(wav_bytes)
                )
            except ValueError as exc:
                return _error_response(
                    "INVALID_AUDIO",
                    str(exc),
                    400,
                )
            except Exception as exc:
                logger.exception("Inference error")
                return _error_response(
                    "INFERENCE_ERROR",
                    f"Inference failed: {exc}",
                    500,
                )
            t_infer_end = time.monotonic()
            inference_ms = round((t_infer_end - t_infer_start) * 1000, 2)

            # --- Syllabify ---
            t_syl_start = time.monotonic()
            phonemes = rec_result.get("phonemes", [])
            syl_result = syllabifier.syllabify(phonemes)
            t_syl_end = time.monotonic()
            syllabification_ms = round((t_syl_end - t_syl_start) * 1000, 2)

        finally:
            recognizer._semaphore.release()

        t_total_end = time.monotonic()
        total_ms = round((t_total_end - t_total_start) * 1000, 2)

        manifest = _state.get("manifest") or {}

        return jsonify({
            "syllable_count": syl_result["syllable_count"],
            "syllables": syl_result["syllables"],
            "nuclei": syl_result.get("nuclei_detected", []),
            "is_rateable": syl_result["is_rateable"],
            "quality_reason": syl_result.get("quality_reason"),
            "phonemes": phonemes,
            "engine_version": ENGINE_VERSION,
            "model_revision": manifest.get("modelRevision", "unknown"),
            "timing": {
                "inference_ms": inference_ms,
                "syllabification_ms": syllabification_ms,
                "total_ms": total_ms,
            },
        }), 200

    return app


# ---------------------------------------------------------------------------
# Audio preprocessing (extracted for direct backend calls)
# ---------------------------------------------------------------------------

def _preprocess_wav(wav_bytes: bytes):
    """Decode, validate, convert to mono float32, resample.

    Returns (samples, sample_rate) ready for a backend.
    """
    from backend.phoneme_service.recognizer import (
        _decode_wav,
        _resample,
        _to_mono_float32,
    )
    from backend.phoneme_service.backends import (
        MAX_DURATION_SEC,
        TARGET_SAMPLE_RATE,
    )

    samples_int, orig_sr, n_channels, sampwidth = _decode_wav(wav_bytes)

    # Duration check
    n_frames = samples_int.shape[0] if n_channels > 1 else len(samples_int)
    duration_sec = n_frames / orig_sr
    if duration_sec > MAX_DURATION_SEC:
        raise ValueError(
            f"Audio too long: {duration_sec:.1f}s (max {MAX_DURATION_SEC}s)."
        )

    samples = _to_mono_float32(samples_int, n_channels, sampwidth)
    samples = _resample(samples, orig_sr, TARGET_SAMPLE_RATE)
    return samples, TARGET_SAMPLE_RATE


# ---------------------------------------------------------------------------
# Error helper
# ---------------------------------------------------------------------------

def _error_response(code: str, message: str, status: int) -> tuple:
    """Return a structured JSON error response."""
    return jsonify({
        "error": {
            "code": code,
            "message": message,
        }
    }), status


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app = create_app()
    port = app.config["PORT"]
    logger.info("Starting phoneme service on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
