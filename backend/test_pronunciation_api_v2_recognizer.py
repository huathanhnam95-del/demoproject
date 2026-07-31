import io
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
        self.assertEqual(payload["request_reference_id"], "variant-test")
        self.assertGreater(payload["audio_duration_sec"], 0)
        self.assertNotIn("log_probs", payload)


if __name__ == "__main__":
    unittest.main()
