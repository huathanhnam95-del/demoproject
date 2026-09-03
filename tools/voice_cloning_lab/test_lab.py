"""
Automated Test Suite for Voice Cloning Laboratory (2026 SOTA Engines)
Validates API endpoints, synthesis adapters (Dots.TTS Soar, Fun-CosyVoice 3, MOSS-TTS v1.5), SECS scorer, and static file accessibility.
"""

import unittest
import json
from pathlib import Path
from fastapi.testclient import TestClient

from tools.voice_cloning_lab.server import app, ENGINES, similarity_scorer, intelligibility_evaluator
from tools.voice_cloning_lab.config import SAMPLES_DIR, RESULTS_DIR

class TestVoiceCloningLab(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_01_status_endpoint(self):
        """Verify server status and 2026 GPU metadata."""
        response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "online")
        self.assertIn("gpu", data)
        self.assertIn("engines", data)
        self.assertIn("dots_tts", data["engines"])
        self.assertIn("cosyvoice3", data["engines"])
        self.assertIn("moss_tts", data["engines"])

    def test_02_engines_synthesis(self):
        """Verify synthesis across all 3 2026 SOTA model adapters."""
        req_payload = {
            "target_text": "Evaluating zero-shot Mel flow matching and 48kHz HD acoustic accuracy for authentic accent preservation.",
            "reference_id": "test_ref",
            "reference_transcript": "Evaluating acoustic structures.",
            "engines": ["dots_tts", "cosyvoice3", "moss_tts"],
            "emotion": "neutral",
            "speed": 1.0
        }
        response = self.client.post("/api/synthesize", json=req_payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(len(data["results"]), 3)

        for engine_id in ["dots_tts", "cosyvoice3", "moss_tts"]:
            res = data["results"][engine_id]
            self.assertIn("duration_seconds", res)
            self.assertIn("latency_seconds", res)
            self.assertIn("rtf", res)
            self.assertIn("metrics", res)
            self.assertGreater(res["metrics"]["secs_similarity"], 0.70)
            self.assertLess(res["metrics"]["estimated_wer"], 0.10)

    def test_03_evaluator_metrics(self):
        """Verify SECS and WER computations."""
        wer = intelligibility_evaluator.compute_wer(
            "the quick brown fox jumps over the lazy dog",
            "the quick brown fox jumps over the lazy dog"
        )
        self.assertEqual(wer, 0.0)

        wer_err = intelligibility_evaluator.compute_wer(
            "the quick brown fox",
            "the quick brown fox jumps"
        )
        self.assertGreater(wer_err, 0.0)

    def test_04_evaluation_recording(self):
        """Verify evaluation submission and leaderboard."""
        eval_payload = {
            "session_id": "test_session_1",
            "engine_id": "dots_tts",
            "target_text": "Sample test evaluation sentence.",
            "similarity_score": 5.0,
            "prosody_score": 5.0,
            "clarity_score": 4.5,
            "emotion_score": 4.5,
            "artifact_score": 5.0,
            "comments": "Super clean prosody and authentic accent retention."
        }
        response = self.client.post("/api/evaluate", json=eval_payload)
        self.assertEqual(response.status_code, 200)
        self.assertIn("overall_mos", response.json())

        # Check leaderboard
        lb_res = self.client.get("/api/evaluations/leaderboard")
        self.assertEqual(lb_res.status_code, 200)
        lb_data = lb_res.json()
        self.assertGreaterEqual(lb_data["total_ratings"], 1)

    def test_05_static_files_presence(self):
        """Verify standalone frontend files exist."""
        lab_dir = Path("c:/Cursor AI/tools/voice_cloning_lab")
        self.assertTrue((lab_dir / "index.html").exists())
        self.assertTrue((lab_dir / "style.css").exists())
        self.assertTrue((lab_dir / "app.js").exists())


if __name__ == "__main__":
    unittest.main()
