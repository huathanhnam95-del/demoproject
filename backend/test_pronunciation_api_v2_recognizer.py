import io
import re
import os
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np


class V2RecognizerApiTest(unittest.TestCase):
    def test_v2_returns_alignment_and_hypotheses_without_logits(self):
        from backend.phoneme_service.app import create_app
        from backend.test_phoneme_service import _make_wav_bytes

        class FakeBackend:
            def load(self):
                return None

            def recognize(self, samples, sample_rate):
                return self.recognize_with_logits(samples, sample_rate) | {"log_probs": None}

            def recognize_with_logits(self, samples, sample_rate):
                return {
                    "phonemes": [
                        {"symbol": "h", "confidence": 0.95, "start_time": 0.0, "end_time": 0.1},
                        {"symbol": "ɛ", "confidence": 0.95, "start_time": 0.1, "end_time": 0.2},
                        {"symbol": "l", "confidence": 0.95, "start_time": 0.2, "end_time": 0.3},
                        {"symbol": "oʊ", "confidence": 0.95, "start_time": 0.3, "end_time": 0.4},
                    ],
                    "symbol_table": ["<pad>", "h", "ɛ", "l", "oʊ"],
                    "log_probs": np.log(np.asarray([[0.9, 0.05, 0.02, 0.02, 0.01]] * 20)),
                    "model_revision": "fake",
                    "blank_id": 0,
                }

        manifest = {"evidenceStatus": "verified", "selectedEngine": "torch", "verdict": "torch", "modelId": "fake", "modelRevision": "fake", "quality": {}}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "manifest.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            app = create_app(str(path), backend_override=FakeBackend())
            response = app.test_client().post("/recognize/v2", data={"audio": (io.BytesIO(_make_wav_bytes()), "a.wav"), "reference_syllables": json.dumps(["hɛ", "loʊ"]), "expected_syllable_count": "2", "variant_id": "variant-test"}, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertNotIn("error", payload, payload)
        self.assertEqual(payload["contract_version"], "recognize-v2")
        self.assertIn("canonical_alignment", payload)
        self.assertIn("hypotheses", payload)
        alignment = payload["canonical_alignment"]
        self.assertEqual(alignment["span_contract_version"], "ctc-alignment-v2")
        self.assertEqual(alignment["frame_interval"], "half-open")
        self.assertEqual(alignment["syllable_span_type"], "ctc-token-coverage")
        self.assertEqual(alignment["measurement_span_type"], "ctc-blank-midpoint-v1")
        self.assertIn("measurement_start_time", alignment["syllables"][0])
        self.assertIn("measurement_end_time", alignment["syllables"][0])
        self.assertEqual(payload["request_reference_id"], "variant-test")
        self.assertGreater(payload["audio_duration_sec"], 0)
        self.assertNotIn("log_probs", payload)


class V3TimeoutBudgetTest(unittest.TestCase):
    """The V3 timeout layers must nest, or a cold start fails at the wrong one.

    A scale-to-zero recognizer pays a 46-52s model load on its first request.
    If any inner budget is tighter than the one it wraps, that cold path is
    reported as an opaque cancellation instead of the real cause, which is
    exactly the defect these bounds exist to prevent.
    """

    def test_client_timeout_is_inside_the_v3_hard_cap(self):
        from backend.local_server.phoneme_client import _RECOGNIZER_HTTP_TIMEOUT_SEC
        from backend.local_server.server import _V3_HARD_TIMEOUT_SECONDS

        self.assertLess(_RECOGNIZER_HTTP_TIMEOUT_SEC, _V3_HARD_TIMEOUT_SECONDS)
        # Both must clear the observed 46-52s Cloud Run cold start.
        self.assertGreaterEqual(_RECOGNIZER_HTTP_TIMEOUT_SEC, 60)
        # And both must fit inside the gunicorn/Cloud Run request budget (120s).
        self.assertLess(_V3_HARD_TIMEOUT_SECONDS, 120)

    def test_container_request_budget_clears_the_application_budget(self):
        dockerfile = (Path(__file__).parent / "Dockerfile.phoneme").read_text(encoding="utf-8")
        self.assertIn("--timeout 120", dockerfile)
        self.assertIn("PHONEME_EAGER_LOAD=1", dockerfile)

    def test_praat_api_worker_outlives_the_v3_wait(self):
        # praat-api is the service the browser calls, and it blocks while the
        # recognizer cold-starts. Its own gunicorn budget must clear
        # _V3_HARD_TIMEOUT_SECONDS or the caller gets a 504 no matter how wide
        # every downstream timeout is. This regressed once: 60s killed the
        # worker at 61.2s on a real cold start.
        from backend.local_server.server import _V3_HARD_TIMEOUT_SECONDS

        dockerfile = (Path(__file__).parent / "Dockerfile").read_text(encoding="utf-8")
        match = re.search(r"--timeout\s+(\d+)", dockerfile)
        self.assertIsNotNone(match, "praat-api Dockerfile has no gunicorn --timeout")
        self.assertGreater(int(match.group(1)), _V3_HARD_TIMEOUT_SECONDS)


class V3TransportReasonTest(unittest.TestCase):
    """Transport failures must not be reported as model failures."""

    def _pipeline_reason(self, error):
        import backend.local_server.server as server_module

        class FailingClient:
            def recognize_v2(self, *args, **kwargs):
                raise error

        from backend.test_phoneme_service import _make_wav_bytes

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(_make_wav_bytes())
            tmp_path = tmp.name

        import unittest.mock as mock
        with mock.patch("backend.local_server.phoneme_client.create_phoneme_client", return_value=FailingClient()):
            result = server_module.run_v3_pipeline(
                tmp_path,
                reference_ipa="/ˈhɛloʊ/",
                expected_syllables=2,
                target_word="hello",
            )
        Path(tmp_path).unlink(missing_ok=True)
        return result.get("phoneme_error")

    def test_read_timeout_reports_timeout_not_inference_failure(self):
        import requests

        self.assertEqual(
            self._pipeline_reason(requests.exceptions.ReadTimeout("cold start")),
            "TIMEOUT",
        )

    def test_connection_error_reports_unreachable_not_inference_failure(self):
        import requests

        self.assertEqual(
            self._pipeline_reason(requests.exceptions.ConnectionError("refused")),
            "RECOGNIZER_UNREACHABLE",
        )


class WarmV3EndpointTest(unittest.TestCase):
    """/warm/v3 exists to absorb a cold start; it must never block or fail."""

    def setUp(self):
        import backend.local_server.server as server_module

        self.server = server_module
        self.client = server_module.app.test_client()
        # Each test owns the debounce window.
        server_module._warm_v3_state['last_dispatch'] = 0.0

    def test_returns_immediately_even_when_recognizer_is_slow(self):
        import time as _time
        import unittest.mock as mock

        class SlowClient:
            def warm(self):
                _time.sleep(30)
                return True

        with mock.patch.dict(os.environ, {'PHONEME_SERVICE_URL': 'http://127.0.0.1:8082'}):
            with mock.patch('backend.local_server.phoneme_client.create_phoneme_client', return_value=SlowClient()):
                started = _time.time()
                response = self.client.post('/warm/v3')
                elapsed = _time.time() - started

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.get_json()['status'], 'warming')
        self.assertLess(elapsed, 1.0, 'warm-up must not block on the recognizer')

    def test_debounces_repeat_calls_inside_the_window(self):
        import unittest.mock as mock

        calls = []

        class CountingClient:
            def warm(self):
                calls.append(1)
                return True

        with mock.patch.dict(os.environ, {'PHONEME_SERVICE_URL': 'http://127.0.0.1:8082'}):
            with mock.patch('backend.local_server.phoneme_client.create_phoneme_client', return_value=CountingClient()):
                first = self.client.post('/warm/v3')
                second = self.client.post('/warm/v3')

        self.assertEqual(first.get_json()['status'], 'warming')
        self.assertEqual(second.status_code, 202)
        self.assertEqual(second.get_json()['status'], 'debounced')

    def test_reports_disabled_rather_than_failing_when_unconfigured(self):
        import unittest.mock as mock

        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PHONEME_SERVICE_URL', None)
            response = self.client.post('/warm/v3')

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.get_json()['status'], 'disabled')

    def test_health_reports_recognizer_wiring_without_leaking_the_url(self):
        import unittest.mock as mock

        secret_url = 'https://phoneme-recognizer-should-not-appear.example'
        with mock.patch.dict(os.environ, {'PHONEME_SERVICE_URL': secret_url}):
            response = self.client.get('/health')

        payload = response.get_json()
        self.assertTrue(payload['recognizerConfigured'])
        self.assertNotIn('should-not-appear', json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
