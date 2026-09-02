#!/usr/bin/env python3
"""
Unit tests for the phoneme service Flask application.

All tests mock the backend, recognizer, and syllabifier so no actual
model download or GPU is needed.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import unittest
import wave
from unittest import mock

# ---------------------------------------------------------------------------
# WAV helper — create minimal valid WAV bytes
# ---------------------------------------------------------------------------


def _make_wav_bytes(
    n_samples: int = 1600,
    sample_rate: int = 16000,
    n_channels: int = 1,
    sampwidth: int = 2,
) -> bytes:
    """Create a minimal valid WAV file in memory."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(n_channels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(sample_rate)
        # Silent audio (zeros)
        raw = struct.pack(f"<{n_samples}h", *([0] * n_samples))
        wf.writeframes(raw)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Mock results
# ---------------------------------------------------------------------------

MOCK_PHONEMES = [
    {"symbol": "h", "start_time": 0.0, "end_time": 0.02, "confidence": 0.95},
    {"symbol": "ɛ", "start_time": 0.02, "end_time": 0.06, "confidence": 0.92},
    {"symbol": "l", "start_time": 0.06, "end_time": 0.08, "confidence": 0.89},
    {"symbol": "oʊ", "start_time": 0.08, "end_time": 0.12, "confidence": 0.91},
]

MOCK_BACKEND_RESULT = {
    "phonemes": MOCK_PHONEMES,
    "raw_tokens": [5, 12, 8, 14],
    "effective_stride_ms": 20.0,
    "engine_version": "1.0.0",
    "model_revision": "abc1234",
    "symbol_table": ["<pad>", "a", "b"],
}

MOCK_SYLLABIFY_RESULT = {
    "syllable_count": 2,
    "syllables": [
        {
            "index": 0,
            "phonemes": ["h", "ɛ"],
            "nucleus": "ɛ",
            "start_time": 0.0,
            "end_time": 0.06,
            "duration": 0.06,
            "confidence": 0.935,
        },
        {
            "index": 1,
            "phonemes": ["l", "oʊ"],
            "nucleus": "oʊ",
            "start_time": 0.06,
            "end_time": 0.12,
            "duration": 0.06,
            "confidence": 0.90,
        },
    ],
    "nuclei_detected": ["ɛ", "oʊ"],
    "is_rateable": True,
    "quality_reason": None,
}

MOCK_MANIFEST = {
    "schemaVersion": "1.0.0",
    "selectedEngine": "torch",
    "modelId": "facebook/wav2vec2-lv-60-espeak-cv-ft",
    "modelRevision": "abc1234",
    "tokenizerChecksum": "a" * 64,
    "modelChecksum": "b" * 64,
    "quality": {
        "meanPhonemeConfidence": 0.65,
        "minNucleusConfidence": 0.45,
    },
    "benchmark": {"peakRssGiB": 1.2},
    "evidenceStatus": "verified",
    "verdict": "torch",
}


# ---------------------------------------------------------------------------
# Test helper — create a Flask test app with all mocks wired in
# ---------------------------------------------------------------------------


def _create_test_app(ready: bool = True):
    """Create a Flask test app with mocked internals.

    Returns (app, mock_backend, mock_recognizer_sem) so tests
    can manipulate state.
    """
    import tempfile
    import os

    # Write a temporary manifest
    tmpdir = tempfile.mkdtemp()
    manifest_path = os.path.join(tmpdir, "model-manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(MOCK_MANIFEST, fh)

    # Create a mock backend
    mock_backend = mock.MagicMock()
    mock_backend.recognize.return_value = MOCK_BACKEND_RESULT

    if ready:
        from backend.phoneme_service.app import create_app

        app = create_app(
            manifest_path=manifest_path,
            backend_override=mock_backend,
        )
        # Trigger initialisation so readyz will return 200
        with app.test_client() as client:
            client.get("/readyz")
    else:
        from backend.phoneme_service.app import create_app

        app = create_app(
            manifest_path=manifest_path,
            backend_override=mock_backend,
        )

    app.config["TESTING"] = True
    return app, mock_backend


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestHealthz(unittest.TestCase):
    """GET /healthz always returns 200."""

    def test_healthz_returns_ok(self):
        app, _ = _create_test_app(ready=False)
        with app.test_client() as client:
            resp = client.get("/healthz")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data["status"], "ok")


class TestVersion(unittest.TestCase):
    """GET /version returns engine metadata."""

    def test_version_returns_metadata(self):
        app, _ = _create_test_app(ready=True)
        with app.test_client() as client:
            resp = client.get("/version")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertIn("engine", data)
            self.assertIn("model_revision", data)
            self.assertIn("manifest_checksum", data)
            self.assertIn("build_sha", data)
            self.assertEqual(data["engine"], "torch")
            self.assertEqual(data["model_revision"], "abc1234")
            self.assertEqual(data["build_sha"], "dev")
            # manifest_checksum should be a 64-char hex string
            self.assertEqual(len(data["manifest_checksum"]), 64)


class TestReadyz(unittest.TestCase):
    """GET /readyz reflects model readiness."""

    def test_readyz_returns_503_before_init(self):
        """readyz should return 503 when manifest doesn't exist."""
        from backend.phoneme_service.app import create_app

        app = create_app(
            manifest_path="/nonexistent/path/model-manifest.json",
        )
        app.config["TESTING"] = True
        with app.test_client() as client:
            resp = client.get("/readyz")
            self.assertEqual(resp.status_code, 503)
            data = resp.get_json()
            self.assertEqual(data["status"], "not_ready")

    def test_readyz_returns_200_when_ready(self):
        app, _ = _create_test_app(ready=True)
        with app.test_client() as client:
            resp = client.get("/readyz")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data["status"], "ready")

    def test_readyz_returns_503_when_backend_model_load_fails(self):
        failing_backend = mock.MagicMock()
        failing_backend.load.side_effect = RuntimeError("model dependency unavailable")

        import tempfile
        import os
        from backend.phoneme_service.app import create_app

        tmpdir = tempfile.mkdtemp()
        manifest_path = os.path.join(tmpdir, "model-manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(MOCK_MANIFEST, fh)

        app = create_app(manifest_path=manifest_path, backend_override=failing_backend)
        app.config["TESTING"] = True
        with app.test_client() as client:
            resp = client.get("/readyz")
            self.assertEqual(resp.status_code, 503)
            self.assertEqual(resp.get_json()["status"], "not_ready")
        failing_backend.load.assert_called_once()

    def test_readyz_rejects_pending_benchmark_evidence(self):
        import tempfile
        import os
        from backend.phoneme_service.app import create_app

        pending_manifest = dict(MOCK_MANIFEST)
        pending_manifest["evidenceStatus"] = "pending"
        pending_manifest["selectedEngine"] = "provider-evaluation-required"
        pending_manifest["verdict"] = "provider-evaluation-required"
        tmpdir = tempfile.mkdtemp()
        manifest_path = os.path.join(tmpdir, "model-manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(pending_manifest, fh)

        backend = mock.MagicMock()
        app = create_app(manifest_path=manifest_path, backend_override=backend)
        app.config["TESTING"] = True
        with app.test_client() as client:
            resp = client.get("/readyz")
            self.assertEqual(resp.status_code, 503)
            self.assertIn("not verified", resp.get_json()["reason"])
        backend.load.assert_not_called()

    def test_readyz_accepts_composition_waived_evidence_but_surfaces_it(self):
        import tempfile
        import os
        from backend.phoneme_service.app import create_app

        waived_manifest = dict(MOCK_MANIFEST)
        waived_manifest["evidenceStatus"] = "composition-waived"
        waived_manifest["waivedRequirements"] = [
            "category_composition", "accented_speaker_cohorts",
        ]
        tmpdir = tempfile.mkdtemp()
        manifest_path = os.path.join(tmpdir, "model-manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(waived_manifest, fh)

        backend = mock.MagicMock()
        app = create_app(manifest_path=manifest_path, backend_override=backend)
        app.config["TESTING"] = True
        with app.test_client() as client:
            resp = client.get("/readyz")
            self.assertEqual(resp.status_code, 200)
            payload = resp.get_json()
            self.assertEqual(payload["status"], "ready")
            # The waiver must be visible without reading container logs.
            self.assertEqual(payload["evidenceStatus"], "composition-waived")
            self.assertIn("category_composition", payload["waivedRequirements"])

    def test_readyz_omits_evidence_fields_when_fully_verified(self):
        import tempfile
        import os
        from backend.phoneme_service.app import create_app

        tmpdir = tempfile.mkdtemp()
        manifest_path = os.path.join(tmpdir, "model-manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(dict(MOCK_MANIFEST), fh)

        backend = mock.MagicMock()
        app = create_app(manifest_path=manifest_path, backend_override=backend)
        app.config["TESTING"] = True
        with app.test_client() as client:
            payload = client.get("/readyz").get_json()
            self.assertEqual(payload["status"], "ready")
            self.assertNotIn("evidenceStatus", payload)


class TestRecognizeV1(unittest.TestCase):
    """POST /recognize/v1 — inference endpoint."""

    def setUp(self):
        self.app, self.mock_backend = _create_test_app(ready=True)
        self.wav_bytes = _make_wav_bytes()

        # Patch syllabifier.syllabify to return mock result
        self._syl_patcher = mock.patch(
            "backend.phoneme_service.syllabifier.IndependentSyllabifier.syllabify",
            return_value=MOCK_SYLLABIFY_RESULT,
        )
        self._syl_patcher.start()

    def tearDown(self):
        self._syl_patcher.stop()

    def test_recognize_valid_audio(self):
        with self.app.test_client() as client:
            resp = client.post(
                "/recognize/v1",
                data={"audio": (io.BytesIO(self.wav_bytes), "test.wav")},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertIn("syllable_count", data)
            self.assertIn("syllables", data)
            self.assertIn("nuclei", data)
            self.assertIn("is_rateable", data)
            self.assertIn("phonemes", data)
            self.assertIn("engine_version", data)
            self.assertIn("model_revision", data)
            self.assertIn("confidence", data)
            self.assertEqual(data["syllable_count"], 2)
            self.assertTrue(data["is_rateable"])
            self.assertAlmostEqual(data["confidence"], 0.9175, places=4)

    def test_recognize_no_audio(self):
        with self.app.test_client() as client:
            resp = client.post("/recognize/v1")
            self.assertEqual(resp.status_code, 400)
            data = resp.get_json()
            self.assertEqual(data["error"]["code"], "NO_AUDIO")

    def test_recognize_too_large(self):
        # Create bytes > 5 MB
        large_bytes = b"\x00" * (5 * 1024 * 1024 + 1)
        with self.app.test_client() as client:
            resp = client.post(
                "/recognize/v1",
                data={"audio": (io.BytesIO(large_bytes), "big.wav")},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 400)
            data = resp.get_json()
            self.assertEqual(data["error"]["code"], "AUDIO_TOO_LARGE")

    def test_recognize_busy(self):
        """When the semaphore is already held, return 503."""
        with self.app.test_client() as client:
            # Trigger init so recognizer exists
            client.get("/readyz")

        # Access the internal state to grab the recognizer's semaphore
        # We need to acquire it before making the request
        with self.app.test_request_context():
            pass

        # We'll make the recognizer's semaphore unavailable by acquiring it
        # To do this, we need to reach into the app's closure state
        # Instead, let's mock the semaphore.acquire to return False
        with self.app.test_client() as client:
            with mock.patch(
                "threading.Semaphore.acquire", return_value=False
            ):
                resp = client.post(
                    "/recognize/v1",
                    data={"audio": (io.BytesIO(self.wav_bytes), "test.wav")},
                    content_type="multipart/form-data",
                )
                self.assertEqual(resp.status_code, 503)
                data = resp.get_json()
                self.assertEqual(data["error"]["code"], "RECOGNIZER_BUSY")

    def test_recognize_base64(self):
        b64 = base64.b64encode(self.wav_bytes).decode("ascii")
        with self.app.test_client() as client:
            resp = client.post(
                "/recognize/v1",
                data=json.dumps({"audio_base64": b64}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertIn("syllable_count", data)
            self.assertTrue(data["is_rateable"])

    def test_recognize_returns_timing(self):
        with self.app.test_client() as client:
            resp = client.post(
                "/recognize/v1",
                data={"audio": (io.BytesIO(self.wav_bytes), "test.wav")},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertIn("timing", data)
            timing = data["timing"]
            self.assertIn("inference_ms", timing)
            self.assertIn("syllabification_ms", timing)
            self.assertIn("total_ms", timing)
            # Timing values should be non-negative numbers
            self.assertGreaterEqual(timing["inference_ms"], 0)
            self.assertGreaterEqual(timing["syllabification_ms"], 0)
            self.assertGreaterEqual(timing["total_ms"], 0)


class TestRecognizeV2V4Alignment(unittest.TestCase):
    """V4 alignment is additive and reuses the one recognizer logit call."""

    def test_optional_reference_ipa_returns_v4_alignment_without_second_inference(self):
        from backend.phoneme_service.app import create_app

        app, backend = _create_test_app(ready=True)
        symbols = ["<pad>", "k", "æ", "m", "ə", "r"]
        probabilities = [[0.01] * len(symbols) for _ in range(16)]
        for row in probabilities:
            row[0] = 0.8
        backend.recognize_with_logits.return_value = {
            "phonemes": [{"symbol": "k", "confidence": 0.9}],
            "symbol_table": symbols,
            "blank_id": 0,
            "log_probs": __import__("numpy").log(__import__("numpy").asarray(probabilities)),
            "model_revision": "abc1234",
        }
        wav_bytes = _make_wav_bytes()
        with app.test_client() as client:
            response = client.post(
                "/recognize/v2",
                data={
                    "audio": (io.BytesIO(wav_bytes), "test.wav"),
                    "reference_syllables": json.dumps(["kæm", "ərə"], ensure_ascii=False),
                    "expected_syllable_count": "2",
                    "reference_ipa": "/ˈkæmərə/",
                },
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload["contract_version"], "recognize-v2")
        self.assertEqual(payload["v4_alignment"]["analysisVersion"], "pronunciation-analysis-v4.1")
        self.assertEqual(payload["v4_alignment"]["syllabificationVersion"], "pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1")
        backend.recognize_with_logits.assert_called_once()

    def test_conflicting_reference_ipa_returns_fail_closed_v4_alignment(self):
        from backend.phoneme_service.app import create_app

        app, backend = _create_test_app(ready=True)
        symbols = ["<pad>", "k", "æ", "m", "ə", "r"]
        probabilities = [[0.01] * len(symbols) for _ in range(16)]
        for row in probabilities:
            row[0] = 0.8
        backend.recognize_with_logits.return_value = {
            "phonemes": [{"symbol": "k", "confidence": 0.9}],
            "symbol_table": symbols,
            "blank_id": 0,
            "log_probs": __import__("numpy").log(__import__("numpy").asarray(probabilities)),
            "model_revision": "abc1234",
        }
        with app.test_client() as client:
            response = client.post(
                "/recognize/v2",
                data={
                    "audio": (io.BytesIO(_make_wav_bytes()), "test.wav"),
                    "reference_syllables": json.dumps(["kæ", "ərə"], ensure_ascii=False),
                    "expected_syllable_count": "2",
                    "reference_ipa": "/ˈkæmərə/",
                },
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertFalse(payload["v4_alignment"]["aligned"])
        self.assertEqual(payload["v4_alignment"]["reason"], "V4_TOKEN_SEQUENCE_MISMATCH")
        backend.recognize_with_logits.assert_called_once()


class EagerLoadTest(unittest.TestCase):
    """Cloud Run gates traffic on /readyz, so the model must load at startup.

    With a lazy load, gunicorn binds the port in under a second, the platform
    marks the instance ready, and the first learner's request absorbs the whole
    46-52s model load. Loading during create_app() moves that cost into startup
    where CPU boost applies and where the probe holds traffic back.
    """

    def _manifest_path(self, temp):
        import json as _json
        from pathlib import Path as _Path

        manifest = {
            "evidenceStatus": "verified", "selectedEngine": "torch",
            "verdict": "torch", "modelId": "fake", "modelRevision": "fake",
            "quality": {},
        }
        path = _Path(temp) / "manifest.json"
        path.write_text(_json.dumps(manifest), encoding="utf-8")
        return str(path)

    class _CountingBackend:
        def __init__(self):
            self.loads = 0

        def load(self):
            self.loads += 1

        def recognize(self, samples, sample_rate):
            return {"phonemes": [], "symbol_table": [], "model_revision": "fake", "blank_id": 0}

    def test_eager_load_leaves_instance_ready_before_first_request(self):
        import os
        import tempfile

        from backend.phoneme_service.app import create_app

        backend = self._CountingBackend()
        with tempfile.TemporaryDirectory() as temp:
            with mock.patch.dict(os.environ, {"PHONEME_EAGER_LOAD": "1"}):
                app = create_app(self._manifest_path(temp), backend_override=backend)
                response = app.test_client().get("/readyz")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_lazy_path_is_preserved_when_eager_load_is_off(self):
        import os
        import tempfile

        from backend.phoneme_service.app import create_app

        backend = self._CountingBackend()
        with tempfile.TemporaryDirectory() as temp:
            with mock.patch.dict(os.environ, {"PHONEME_EAGER_LOAD": "0"}):
                create_app(self._manifest_path(temp), backend_override=backend)

        # Construction alone must not initialise, or every unit test using a
        # mocked backend would pay a load it never asked for.
        self.assertEqual(backend.loads, 0)


class TestInferenceGateObservability(unittest.TestCase):
    """Observability and state contract for inference gate acquisition and release."""

    def test_recognize_v1_and_v2_busy_response_contains_age_without_sensitive_data(self):
        app, backend = _create_test_app(ready=True)
        recognizer = app.extensions["phoneme_service_state"]["recognizer"]

        with app.test_client() as client:
            # Force acquire the gate
            acq = recognizer._gate.try_acquire(endpoint="/external-holder")
            self.assertTrue(acq.acquired)

            try:
                # 1. /recognize/v1 busy response
                res1 = client.post(
                    "/recognize/v1",
                    data={"audio": (io.BytesIO(_make_wav_bytes()), "test.wav")},
                    content_type="multipart/form-data",
                )
                self.assertEqual(res1.status_code, 503)
                json1 = res1.get_json()
                self.assertEqual(json1["error"]["code"], "RECOGNIZER_BUSY")
                self.assertIn("active_request_age_ms", json1["error"]["details"])
                # Must not leak audio, tokens, or IPA
                self.assertNotIn("phonemes", str(json1))
                self.assertNotIn("tokens", str(json1))
                self.assertNotIn("reference", str(json1))

                # 2. /recognize/v2 busy response
                res2 = client.post(
                    "/recognize/v2",
                    data={
                        "audio": (io.BytesIO(_make_wav_bytes()), "test.wav"),
                        "reference_syllables": json.dumps(["hɛ", "loʊ"]),
                        "expected_syllable_count": "2",
                        "reference_ipa": "/hɛˈloʊ/",
                    },
                    content_type="multipart/form-data",
                )
                self.assertEqual(res2.status_code, 503)
                json2 = res2.get_json()
                self.assertEqual(json2["error"]["code"], "RECOGNIZER_BUSY")
                self.assertIn("active_request_age_ms", json2["error"]["details"])
                self.assertNotIn("v4_alignment", str(json2))
                self.assertNotIn("canonical_alignment", str(json2))

                # 3. /readyz remains 200 ready (model readiness is decoupled from gate contention)
                ready_res = client.get("/readyz")
                self.assertEqual(ready_res.status_code, 200)
                self.assertEqual(ready_res.get_json()["status"], "ready")

            finally:
                recognizer._gate.release(outcome="completed")

    def test_gate_releases_on_backend_error_and_validation_error(self):
        app, backend = _create_test_app(ready=True)
        recognizer = app.extensions["phoneme_service_state"]["recognizer"]

        # Backend exception during recognize
        backend.recognize.side_effect = RuntimeError("GPU crash simulated")
        with app.test_client() as client:
            res = client.post(
                "/recognize/v1",
                data={"audio": (io.BytesIO(_make_wav_bytes()), "test.wav")},
                content_type="multipart/form-data",
            )
            self.assertEqual(res.status_code, 500)
            # Gate must be free for next request
            self.assertIsNone(recognizer._gate.active_request_id)

            # Next request can acquire
            backend.recognize.side_effect = None
            backend.recognize.return_value = MOCK_BACKEND_RESULT
            res2 = client.post(
                "/recognize/v1",
                data={"audio": (io.BytesIO(_make_wav_bytes()), "test.wav")},
                content_type="multipart/form-data",
            )
            self.assertEqual(res2.status_code, 200)


if __name__ == "__main__":
    unittest.main()
