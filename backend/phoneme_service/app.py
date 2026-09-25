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
import unicodedata
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
from backend.phoneme_service.stress_alignment import align_reference_syllables, ctc_hypothesis_features, tokenize_ipa
from backend.phoneme_service.v4_syllabification import align_v4_reference

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
    app.extensions["phoneme_service_state"] = _state

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

            evidence_status = manifest.get("evidenceStatus")
            if evidence_status == "composition-waived":
                # The benchmark ran, but the corpus did not meet its
                # composition requirements. Accepted so a segmentation-only
                # release can deploy, and surfaced loudly so the accuracy
                # figure is never mistaken for fully gated evidence.
                waived = manifest.get("waivedRequirements") or []
                logger.warning(
                    "Model benchmark evidence is composition-waived (%s); "
                    "accuracy figures are not corpus-gated.",
                    ", ".join(str(item) for item in waived) or "unspecified",
                )
            elif evidence_status != "verified":
                raise RuntimeError(
                    "Model benchmark evidence is not verified; recognizer cannot become ready."
                )
            if manifest.get("selectedEngine") != manifest.get("verdict"):
                raise RuntimeError(
                    "Model manifest selectedEngine does not match the benchmark verdict."
                )

            # Compute checksum
            raw_bytes = mp.read_bytes()
            _state["manifest_checksum"] = hashlib.sha256(raw_bytes).hexdigest()

            # Create backend (or use override)
            if _state["backend"] is None:
                _state["backend"] = create_backend(str(mp))
            _state["backend"].load()

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

        manifest = _state["manifest"] or {}
        payload: Dict[str, Any] = {"status": "ready"}
        if manifest.get("evidenceStatus") == "composition-waived":
            # Ready, but the operator must be able to see that the benchmark
            # corpus gate was waived without reading container logs.
            payload["evidenceStatus"] = "composition-waived"
            payload["waivedRequirements"] = manifest.get("waivedRequirements") or []
        return jsonify(payload), 200

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
            "recognizer_contract": "recognize-v2",
            "alignment_feature_schema": "alignment-v2",
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
        gate = getattr(recognizer, "_gate", None)

        # --- Run inference (with gate busy check) ---
        acq = gate.try_acquire(endpoint="/recognize/v1") if gate is not None else None
        if acq is not None and not acq.acquired:
            return _error_response(
                "RECOGNIZER_BUSY",
                "The recognizer is currently processing another request. "
                "Please retry shortly.",
                503,
                details={"active_request_age_ms": acq.active_request_age_ms},
            )

        outcome = "completed"
        inference_ms = 0.0
        try:
            t_infer_start = time.monotonic()
            try:
                rec_result = recognizer._backend.recognize(
                    *_preprocess_wav(wav_bytes)
                )
            except ValueError as exc:
                outcome = "invalid_audio"
                return _error_response(
                    "INVALID_AUDIO",
                    str(exc),
                    400,
                )
            except Exception as exc:
                outcome = "inference_error"
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
            if gate is not None:
                gate.release(outcome=outcome, inference_duration_ms=inference_ms)

        t_total_end = time.monotonic()
        total_ms = round((t_total_end - t_total_start) * 1000, 2)

        manifest = _state.get("manifest") or {}
        phoneme_confidences = [
            float(item.get("confidence"))
            for item in phonemes
            if isinstance(item.get("confidence"), (int, float))
        ]
        confidence = (
            sum(phoneme_confidences) / len(phoneme_confidences)
            if phoneme_confidences else 0.0
        )

        return jsonify({
            "syllable_count": syl_result["syllable_count"],
            "syllables": syl_result["syllables"],
            "nuclei": syl_result.get("nuclei_detected", []),
            "is_rateable": syl_result["is_rateable"],
            "quality_reason": syl_result.get("quality_reason"),
            "confidence": round(confidence, 6),
            "phonemes": phonemes,
            "engine_version": ENGINE_VERSION,
            "model_revision": manifest.get("modelRevision", "unknown"),
            "timing": {
                "inference_ms": inference_ms,
                "syllabification_ms": syllabification_ms,
                "total_ms": total_ms,
            },
        }), 200

    # ---------------------------------------------------------------
    # POST /recognize/v2 — independent count + reference alignment
    # ---------------------------------------------------------------

    @app.route("/recognize/v2", methods=["POST"])
    def recognize_v2() -> tuple:
        wav_bytes: Optional[bytes] = None
        if "audio" in request.files:
            wav_bytes = request.files["audio"].read()
            reference_raw = request.form.get("reference_syllables", "")
            expected_raw = request.form.get("expected_syllable_count", "")
            variant_raw = request.form.get("variant_id", "")
            reference_ipa_raw = request.form.get("reference_ipa")
        elif request.is_json:
            body = request.get_json(silent=True) or {}
            reference_raw = body.get("reference_syllables", "")
            expected_raw = body.get("expected_syllable_count", "")
            variant_raw = body.get("variant_id", "")
            reference_ipa_raw = body.get("reference_ipa", body.get("referenceIpa"))
            if body.get("audio_base64"):
                try:
                    wav_bytes = base64.b64decode(body["audio_base64"])
                except Exception:
                    return _error_response("INVALID_BASE64", "Could not decode audio_base64 field.", 400)
        else:
            reference_raw = expected_raw = ""
            variant_raw = ""
            reference_ipa_raw = None
        if wav_bytes is None:
            return _error_response("NO_AUDIO", "No audio provided.", 400)
        if len(wav_bytes) > MAX_FILE_BYTES:
            return _error_response("AUDIO_TOO_LARGE", "Audio exceeds the maximum size.", 400)
        try:
            reference = json.loads(reference_raw) if isinstance(reference_raw, str) else reference_raw
            expected = int(expected_raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            return _error_response("INVALID_REFERENCE", "reference_syllables must be JSON and expected count an integer.", 400)
        if not isinstance(reference, list) or not 1 <= len(reference) <= 8 or expected != len(reference):
            return _error_response("INVALID_REFERENCE", "Expected 1-8 reference syllables matching expected_syllable_count.", 400)
        if any(not isinstance(item, str) or item != unicodedata.normalize("NFC", item) for item in reference):
            return _error_response("INVALID_REFERENCE", "Reference syllables must be NFC Unicode strings.", 400)
        reference_ipa = None
        if reference_ipa_raw is not None:
            if (
                not isinstance(reference_ipa_raw, str)
                or not reference_ipa_raw.strip()
                or len(reference_ipa_raw) > 300
                or reference_ipa_raw != unicodedata.normalize("NFC", reference_ipa_raw)
            ):
                return _error_response("INVALID_REFERENCE", "reference_ipa must be a non-empty NFC string of at most 300 characters.", 400)
            reference_ipa = reference_ipa_raw.strip()
        if variant_raw and (
            not isinstance(variant_raw, str)
            or len(variant_raw) > 128
            or variant_raw != unicodedata.normalize("NFC", variant_raw)
        ):
            return _error_response("INVALID_REFERENCE", "variant_id must be an NFC string of at most 128 characters.", 400)
        request_reference_id = variant_raw or hashlib.sha256(
            json.dumps(
                {"reference_syllables": reference, "expected_syllable_count": expected},
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:16]
        try:
            _ensure_initialised()
            samples, sample_rate = _preprocess_wav(wav_bytes)
        except ValueError as exc:
            return _error_response("INVALID_AUDIO", str(exc), 400)
        except Exception as exc:
            return _error_response("SERVICE_UNAVAILABLE", str(exc), 503)
        recognizer: PhonemeRecognizer = _state["recognizer"]
        gate = getattr(recognizer, "_gate", None)
        acq = gate.try_acquire(endpoint="/recognize/v2") if gate is not None else None
        if acq is not None and not acq.acquired:
            return _error_response(
                "RECOGNIZER_BUSY",
                "Recognizer is busy.",
                503,
                details={"active_request_age_ms": acq.active_request_age_ms},
            )

        outcome = "completed"
        inference_ms = 0.0
        try:
            t_infer_start = time.monotonic()
            backend = recognizer._backend
            recognize_with_logits = getattr(backend, "recognize_with_logits", None)
            if recognize_with_logits is None:
                outcome = "unrateable_no_logits"
                return _error_response("UNRATEABLE", "Backend does not expose alignment probabilities.", 200)
            result = recognize_with_logits(samples, sample_rate)
            t_infer_end = time.monotonic()
            inference_ms = round((t_infer_end - t_infer_start) * 1000, 2)
            symbol_table = result.get("symbol_table") or []
            blank_id = int(result.get("blank_id", getattr(backend, "_blank_id", 0)))
            log_probs = result.get("log_probs")
            if log_probs is None or not symbol_table:
                outcome = "unrateable_missing_resources"
                return _error_response("UNRATEABLE", "Recognizer did not return alignment resources.", 200)
            canonical_ids: list[int] = []
            ranges: list[tuple[int, int]] = []
            for ipa in reference:
                start = len(canonical_ids)
                canonical_ids.extend(tokenize_ipa(ipa, symbol_table))
                ranges.append((start, len(canonical_ids)))
            if len(canonical_ids) > 128:
                outcome = "resource_limit_tokens"
                return _error_response("RESOURCE_LIMIT", "Reference contains too many phoneme tokens.", 200)
            syl_result = _state["syllabifier"].syllabify(result.get("phonemes", []))
            aligned = align_reference_syllables(
                log_probs,
                reference,
                symbol_table,
                blank_id=blank_id,
                sample_count=len(samples),
                sample_rate=sample_rate,
            )
            vowel_positions = [index for index, token_id in enumerate(canonical_ids) if any(char in "aeiouəɛɪʊɔɑæɒɜɝɚʌ" for char in str(symbol_table[token_id]))]
            omission_candidates = [
                canonical_ids[:position] + canonical_ids[position + 1:]
                for position in vowel_positions
                if len(canonical_ids) > 1
            ]
            insertion_candidates = [
                canonical_ids[:position + 1] + [canonical_ids[position]] + canonical_ids[position + 1:]
                for position in vowel_positions
            ]
            hypotheses = ctc_hypothesis_features(
                log_probs,
                canonical_ids,
                blank_id=blank_id,
                omission_candidates=omission_candidates,
                insertion_candidates=insertion_candidates,
            )
            response = {
                "contract_version": "recognize-v2",
                "request_reference_id": request_reference_id,
                "audio_duration_sec": round(len(samples) / sample_rate, 6),
                "decoded_syllable_count": syl_result.get("syllable_count"),
                "decoded_is_rateable": syl_result.get("is_rateable"),
                "canonical_alignment": aligned,
                "hypotheses": hypotheses,
                "model_revision": result.get("model_revision", "unknown"),
                "blank_id": blank_id,
            }
            # V4 is an additive, reference-constrained view.  It consumes the
            # exact logits already obtained above; no second model inference
            # or mutation of canonical_alignment is permitted.
            if reference_ipa is not None:
                response["v4_alignment"] = align_v4_reference(
                    log_probs,
                    reference_ipa,
                    symbol_table,
                    blank_id=blank_id,
                    sample_count=len(samples),
                    sample_rate=sample_rate,
                    canonical_token_ids=canonical_ids,
                    expected_syllable_count=expected,
                ).to_dict()
            return jsonify(response), 200
        except (ValueError, KeyError) as exc:
            outcome = "unrateable_exception"
            return _error_response("UNRATEABLE", str(exc), 200)
        except Exception as exc:
            outcome = "inference_error"
            logger.exception("V2 alignment error")
            return _error_response("INFERENCE_ERROR", str(exc), 500)
        finally:
            if gate is not None:
                gate.release(outcome=outcome, inference_duration_ms=inference_ms)

    # ---------------------------------------------------------------
    # Eager initialisation
    # ---------------------------------------------------------------
    # Cloud Run's startup probe gates traffic on /readyz. Loading here means an
    # instance is only advertised once the model is resident, so the load is
    # paid during startup (where CPU boost applies) instead of inside the first
    # learner's request. Off by default so unit tests and mocked backends keep
    # the lazy path; the container sets PHONEME_EAGER_LOAD=1.
    if os.environ.get("PHONEME_EAGER_LOAD", "").strip().lower() in {"1", "true", "yes"}:
        try:
            _ensure_initialised()
            logger.info("Eager model load complete; instance ready for traffic")
        except Exception:
            # Never block app construction: /readyz will retry and report the
            # real reason, which is what the startup probe reads anyway.
            logger.exception("Eager model load failed; falling back to lazy load")

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

def _error_response(
    code: str,
    message: str,
    status: int,
    details: Optional[Dict[str, Any]] = None,
) -> tuple:
    """Return a structured JSON error response."""
    payload: Dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    if details:
        payload["error"]["details"] = details
    return jsonify(payload), status


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app = create_app()
    port = app.config["PORT"]
    logger.info("Starting phoneme service on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
