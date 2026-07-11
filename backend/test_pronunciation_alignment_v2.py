import io
import unittest
from unittest.mock import patch

from backend.local_server import server


def candidate(time, intensity, confidence, *, voiced=True):
    return {
        "time": time,
        "intensity": intensity,
        "confidence": confidence,
        "voiced": voiced,
        "syllable": {
            "startTime": max(0.0, time - 0.08),
            "endTime": time + 0.08,
            "duration": 0.16,
            "vowelDuration": 0.11,
            "avgPitch": 150.0,
            "maxPitch": 165.0,
            "intensity": intensity,
        },
    }


class PronunciationAlignmentV2Test(unittest.TestCase):
    def test_one_syllable_rhotic_is_never_split(self):
        result = server.select_native_acoustic_candidates(
            [candidate(0.22, 74.0, 0.96)],
            target_count=1,
        )
        self.assertEqual(result["rawCandidateCount"], 1)
        self.assertEqual(result["selectedCount"], 1)
        self.assertEqual(result["method"], "acoustic-candidate-selection")
        self.assertEqual(result["conflicts"], [])

    def test_diphthong_internal_dip_can_discard_only_low_confidence_noise(self):
        result = server.select_native_acoustic_candidates(
            [
                candidate(0.18, 76.0, 0.94),
                candidate(0.27, 68.0, 0.21),
            ],
            target_count=1,
        )
        self.assertEqual(result["rawCandidateCount"], 2)
        self.assertEqual(result["selectedCount"], 1)
        self.assertEqual(result["selected"][0]["time"], 0.18)
        self.assertEqual(result["conflicts"], [])

    def test_weak_unstressed_syllable_remains_real_candidate(self):
        result = server.select_native_acoustic_candidates(
            [
                candidate(0.15, 74.0, 0.90),
                candidate(0.38, 68.0, 0.58),
                candidate(0.62, 75.0, 0.92),
            ],
            target_count=3,
        )
        self.assertEqual(result["selectedCount"], 3)
        self.assertEqual(result["conflicts"], [])

    def test_extra_high_confidence_nucleus_fails_closed(self):
        result = server.select_native_acoustic_candidates(
            [
                candidate(0.15, 74.0, 0.91),
                candidate(0.38, 72.0, 0.81),
                candidate(0.62, 75.0, 0.92),
            ],
            target_count=2,
        )
        self.assertEqual(result["selectedCount"], 0)
        self.assertIn("ACOUSTIC_COUNT_MISMATCH", result["conflicts"])
        self.assertEqual(result["method"], "unresolved-extra-candidates")

    def test_fewer_candidates_never_synthesizes_nuclei(self):
        result = server.select_native_acoustic_candidates(
            [candidate(0.22, 74.0, 0.96)],
            target_count=3,
        )
        self.assertEqual(result["rawCandidateCount"], 1)
        self.assertEqual(result["selectedCount"], 0)
        self.assertEqual(result["selected"], [])
        self.assertIn("ACOUSTIC_COUNT_MISMATCH", result["conflicts"])

    def test_candidates_require_voicing_and_finite_intensity_evidence(self):
        result = server.select_native_acoustic_candidates(
            [
                candidate(0.2, 72.0, 0.9, voiced=False),
                candidate(0.4, float("nan"), 0.9),
            ],
            target_count=1,
        )
        self.assertEqual(result["rawCandidateCount"], 2)
        self.assertEqual(result["evidenceCandidateCount"], 0)
        self.assertEqual(result["selectedCount"], 0)
        self.assertIn("ACOUSTIC_COUNT_MISMATCH", result["conflicts"])

    def test_native_analysis_contract_hides_graphs_on_count_conflict(self):
        raw = {
            "duration": 0.8,
            "sampleRate": 16000,
            "pitch": {"times": [0.1], "values": [150.0]},
            "intensity": {"times": [0.1], "values": [70.0]},
            "syllables": [
                candidate(0.2, 72.0, 0.9)["syllable"],
                candidate(0.5, 73.0, 0.9)["syllable"],
            ],
        }
        result = server.build_analysis_v2_response(
            raw,
            expected_syllable_count=1,
            native=True,
        )
        self.assertEqual(result["analysisVersion"], "pronunciation-analysis-v2")
        self.assertFalse(result["quality"]["rateable"])
        self.assertIn("ACOUSTIC_COUNT_MISMATCH", result["quality"]["reasons"])
        self.assertFalse(result["capabilities"]["showNativeGraphs"])
        self.assertEqual(result["segmentation"]["rawCandidateCount"], 2)

    def test_stress_prominence_penalizes_final_lengthening(self):
        syllables = [
            {"avgPitch": 185, "vowelDuration": 0.16, "duration": 0.20, "intensity": 74},
            {"avgPitch": 140, "vowelDuration": 0.15, "duration": 0.33, "intensity": 69},
        ]
        result = server.score_lexical_stress_v2(syllables)
        self.assertEqual(result["primaryStress"], 0)
        self.assertTrue(result["rateable"])

    def test_low_prominence_margin_is_unrateable(self):
        syllables = [
            {"avgPitch": 150, "vowelDuration": 0.18, "duration": 0.20, "intensity": 70},
            {"avgPitch": 151, "vowelDuration": 0.18, "duration": 0.20, "intensity": 70.1},
        ]
        result = server.score_lexical_stress_v2(syllables)
        self.assertIsNone(result["primaryStress"])
        self.assertFalse(result["rateable"])
        self.assertIn("LOW_STRESS_CONFIDENCE", result["reasons"])

    def test_learner_v2_endpoint_rejects_expected_count_forcing(self):
        server.app.testing = True
        client = server.app.test_client()
        fake_result = {
            "analysisVersion": "pronunciation-analysis-v2",
            "quality": {"rateable": False, "confidence": 0, "reasons": ["NO_SPEECH"]},
            "segmentation": {"rawCandidateCount": 0, "selectedCount": 0},
            "observed": {"syllableCount": 0, "primaryStress": None, "syllables": []},
            "pitch": {"times": [], "values": []},
            "intensity": {"times": [], "values": []},
        }
        with patch.object(server, "analyze_audio_v2", return_value=fake_result) as analyze:
            response = client.post(
                "/analyze/v2",
                data={
                    "audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav"),
                    "expected_syllables": "7",
                },
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        analyze.assert_called_once()
        self.assertIsNone(analyze.call_args.kwargs["expected_syllable_count"])
        self.assertFalse(analyze.call_args.kwargs["native"])


if __name__ == "__main__":
    unittest.main()
