"""Unit and contract tests for BEL Pronounce V4.2 Word-Stress Coach."""

import math
import unittest
import numpy as np

from backend.local_server.stress_features_v2 import (
    extract_stress_features_v2,
    STRESS_FEATURES_SCHEMA_VERSION
)
from backend.local_server.stress_evaluator_v2 import (
    evaluate_stress_v2,
    STRESS_EVALUATOR_VERSION
)
from backend.local_server.pronounce_v42 import build_pronounce_v42


class TestStressFeaturesV2(unittest.TestCase):

    def setUp(self):
        self.sample_rate = 16000

    def test_magnitude_contrast_preservation(self):
        """§6.2: 101/100 ms must produce a much smaller contrast than 200/100 ms."""
        # 1. Subtle pair: 101 ms vs 100 ms (1616 vs 1600 samples)
        pcm = np.zeros(32000, dtype=np.float32)
        timing_subtle = {
            "syllables": [
                {
                    "syllableId": "syl-1",
                    "expectedStress": "primary",
                    "nucleusSpan": {"startSample": 0, "endSample": 1616}  # 101ms
                },
                {
                    "syllableId": "syl-2",
                    "expectedStress": "unstressed",
                    "nucleusSpan": {"startSample": 2000, "endSample": 3600}  # 100ms
                }
            ]
        }
        features_subtle = extract_stress_features_v2(pcm, timing_subtle, sample_rate_hz=self.sample_rate)
        contrast_subtle = features_subtle.pairwise_contrasts[0].log_duration_ratio

        # 2. Decisive pair: 200 ms vs 100 ms (3200 vs 1600 samples)
        timing_decisive = {
            "syllables": [
                {
                    "syllableId": "syl-1",
                    "expectedStress": "primary",
                    "nucleusSpan": {"startSample": 0, "endSample": 3200}  # 200ms
                },
                {
                    "syllableId": "syl-2",
                    "expectedStress": "unstressed",
                    "nucleusSpan": {"startSample": 4000, "endSample": 5600}  # 100ms
                }
            ]
        }
        features_decisive = extract_stress_features_v2(pcm, timing_decisive, sample_rate_hz=self.sample_rate)
        contrast_decisive = features_decisive.pairwise_contrasts[0].log_duration_ratio

        # Assert log duration ratios reflect raw acoustic magnitude
        self.assertAlmostEqual(contrast_subtle, math.log(101.0 / 100.0), places=3)
        self.assertAlmostEqual(contrast_decisive, math.log(200.0 / 100.0), places=3)
        # Decisive contrast is dramatically (>50x) larger than subtle contrast
        self.assertGreater(contrast_decisive, 50.0 * contrast_subtle)

    def test_monosyllabic_not_applicable(self):
        """§6.4: One-syllable words have no within-word stress comparison; mark not_applicable."""
        pcm = 0.2 * np.sin(2 * np.pi * 200 * np.linspace(0, 0.5, 8000))
        timing_mono = {
            "syllables": [
                {
                    "syllableId": "syl-1",
                    "expectedStress": "primary",
                    "nucleusSpan": {"startSample": 1000, "endSample": 6000}
                }
            ]
        }
        features = extract_stress_features_v2(pcm, timing_mono, sample_rate_hz=self.sample_rate)
        eval_res = evaluate_stress_v2(features, ["primary"])

        self.assertEqual(eval_res["status"], "not_applicable")
        self.assertFalse(eval_res["applicable"])
        self.assertEqual(eval_res["decision"], "monosyllabic_not_applicable")
        self.assertIn("MONOSYLLABIC_NO_INTERNAL_STRESS", eval_res["reasons"])

    def test_missing_pitch_masked(self):
        """§6.2: Missing cues remain missing/masked, never substituted with zero acoustic values."""
        # Syllable 1 has clear sine wave (220 Hz); Syllable 2 has silence / unvoiced noise
        pcm = np.zeros(16000, dtype=np.float32)
        t = np.linspace(0, 0.5, 8000, endpoint=False)
        pcm[0:8000] = 0.3 * np.sin(2 * np.pi * 220 * t)  # Voiced
        # 8000:16000 is silence (unvoiced)

        timing = {
            "syllables": [
                {
                    "syllableId": "syl-1",
                    "expectedStress": "primary",
                    "nucleusSpan": {"startSample": 1000, "endSample": 7000}
                },
                {
                    "syllableId": "syl-2",
                    "expectedStress": "unstressed",
                    "nucleusSpan": {"startSample": 9000, "endSample": 15000}
                }
            ]
        }
        features = extract_stress_features_v2(pcm, timing, sample_rate_hz=self.sample_rate)
        syl1 = features.syllables[0]
        syl2 = features.syllables[1]

        self.assertIsNotNone(syl1.f0_median_hz)
        self.assertIsNone(syl2.f0_median_hz)

        # Semitone contrast must be None, NOT 0.0
        contrast = features.pairwise_contrasts[0]
        self.assertIsNone(contrast.pitch_diff_semitones)

    def test_correct_pattern_detection(self):
        """Primary nucleus is decisive in duration, intensity, and pitch."""
        pcm = np.zeros(32000, dtype=np.float32)
        t1 = np.linspace(0, 0.35, 5600, endpoint=False)
        t2 = np.linspace(0, 0.15, 2400, endpoint=False)
        # Syllable 0: 350ms, loud, 280 Hz
        pcm[0:5600] = 0.6 * np.sin(2 * np.pi * 280 * t1)
        # Syllable 1: 150ms, quiet, 200 Hz
        pcm[8000:10400] = 0.2 * np.sin(2 * np.pi * 200 * t2)

        timing = {
            "syllables": [
                {
                    "syllableId": "syl-1",
                    "expectedStress": "primary",
                    "nucleusSpan": {"startSample": 500, "endSample": 5000}  # ~280ms
                },
                {
                    "syllableId": "syl-2",
                    "expectedStress": "unstressed",
                    "nucleusSpan": {"startSample": 8200, "endSample": 10200}  # ~125ms
                }
            ]
        }
        features = extract_stress_features_v2(pcm, timing, sample_rate_hz=self.sample_rate)
        eval_res = evaluate_stress_v2(features, ["primary", "unstressed"])

        self.assertEqual(eval_res["status"], "verified")
        self.assertEqual(eval_res["decision"], "correct_pattern")
        self.assertTrue(eval_res["matches_expected"])
        self.assertEqual(eval_res["observed"]["primaryStress"], 0)

    def test_weak_contrast_detection(self):
        """Primary nucleus is slightly longer but margin is below decisive threshold."""
        pcm = np.zeros(16000, dtype=np.float32)
        timing = {
            "syllables": [
                {
                    "syllableId": "syl-1",
                    "expectedStress": "primary",
                    "nucleusSpan": {"startSample": 0, "endSample": 1800}  # ~112ms
                },
                {
                    "syllableId": "syl-2",
                    "expectedStress": "unstressed",
                    "nucleusSpan": {"startSample": 3000, "endSample": 4600}  # ~100ms
                }
            ]
        }
        # Provide synthetic flat intensity and pitch
        praat_res = {
            "intensity": {"times": [0.05, 0.25], "values": [65.0, 64.0]},
            "pitch": {"times": [0.05, 0.25], "values": [200.0, 198.0]}
        }
        features = extract_stress_features_v2(pcm, timing, praat_result=praat_res, sample_rate_hz=self.sample_rate)
        eval_res = evaluate_stress_v2(features, ["primary", "unstressed"])

        self.assertEqual(eval_res["status"], "verified")
        self.assertEqual(eval_res["decision"], "correct_placement_weak_contrast")
        self.assertTrue(eval_res["matches_expected"])
        self.assertIn("CORRECT_PLACEMENT_WEAK_CONTRAST", eval_res["reasons"])

    def test_competing_stress_detection(self):
        """Unstressed syllable is much longer and higher pitch than expected primary syllable."""
        pcm = np.zeros(32000, dtype=np.float32)
        t1 = np.linspace(0, 0.10, 1600, endpoint=False)
        t2 = np.linspace(0, 0.40, 6400, endpoint=False)
        # Syllable 0 (expected primary): 100ms, 180 Hz, quiet
        pcm[0:1600] = 0.15 * np.sin(2 * np.pi * 180 * t1)
        # Syllable 1 (expected unstressed): 400ms, 300 Hz, loud
        pcm[4000:10400] = 0.6 * np.sin(2 * np.pi * 300 * t2)

        timing = {
            "syllables": [
                {
                    "syllableId": "syl-1",
                    "expectedStress": "primary",
                    "nucleusSpan": {"startSample": 200, "endSample": 1400}
                },
                {
                    "syllableId": "syl-2",
                    "expectedStress": "unstressed",
                    "nucleusSpan": {"startSample": 4500, "endSample": 9500}
                }
            ]
        }
        features = extract_stress_features_v2(pcm, timing, sample_rate_hz=self.sample_rate)
        eval_res = evaluate_stress_v2(features, ["primary", "unstressed"])

        self.assertEqual(eval_res["status"], "incorrect")
        self.assertIn(eval_res["decision"], ("competing_stress", "over_prominent_unstressed"))
        self.assertFalse(eval_res["matches_expected"])
        self.assertEqual(eval_res["observed"]["primaryStress"], 1)

    def test_pronounce_v42_stress_integration(self):
        """build_pronounce_v42 returns populated stress evaluation and features."""
        num_samples = 32000
        pcm = np.zeros(num_samples, dtype=np.float32)
        pcm[0:16000] = 0.4 * np.sin(2 * np.pi * 220 * np.linspace(0, 1.0, 16000, endpoint=False))
        pcm[16000:32000] = 0.4 * np.sin(2 * np.pi * 880 * np.linspace(0, 1.0, 16000, endpoint=False))

        audio = {
            "sampleRateHz": 16000,
            "sampleCount": num_samples,
            "audioHash": "b" * 64
        }
        clock = {
            "frameClockVersion": "model-frontend-v1",
            "sampleRateHz": 16000,
            "sampleCount": num_samples,
            "frameCount": 100,
            "frameStrideSamples": 320
        }
        v41 = {
            "schemaVersion": "pronunciation-syllabification-v1",
            "analysisVersion": "pronunciation-analysis-v4.1",
            "ruleVersion": "weighted-maximal-onset-v1",
            "contentHash": "d" * 64,
            "aligned": True,
            "syllables": [
                {
                    "index": 0,
                    "syllableId": "syl-1",
                    "ipa": "kæ",
                    "stress": "primary",
                    "token_start": 0,
                    "token_end": 2,
                    "start_frame": 10,
                    "end_frame": 50,
                    "partition_start_frame": 10,
                    "partition_end_frame": 50,
                    "vowel_start_frame": 20,
                    "vowel_end_frame": 40
                },
                {
                    "index": 1,
                    "syllableId": "syl-2",
                    "ipa": "mər",
                    "stress": "unstressed",
                    "token_start": 2,
                    "token_end": 4,
                    "start_frame": 50,
                    "end_frame": 90,
                    "partition_start_frame": 50,
                    "partition_end_frame": 90,
                    "vowel_start_frame": 60,
                    "vowel_end_frame": 80
                }
            ]
        }
        rec_res = {
            "frameClock": clock,
            "log_probs_shape": [100, 40]
        }
        res = build_pronounce_v42(
            pcm=pcm,
            audio=audio,
            reference={"text": "camera"},
            recognizer_result=rec_res,
            v41_snapshot=v41
        )

        self.assertEqual(res["status"], "available")
        stress = res["stress"]
        self.assertIsNotNone(stress)
        self.assertIn(stress["status"], ("verified", "incorrect", "unrateable", "not_applicable"))
        self.assertIn("stressFeatures", res)
        self.assertEqual(res["stressFeatures"]["schemaVersion"], STRESS_FEATURES_SCHEMA_VERSION)

    def test_evaluate_stress_v2_null_safety(self):
        """Stress evaluation survives None values in nucleusDurationSec and logDurationRatio."""
        from backend.local_server.stress_evaluator_v2 import evaluate_stress_v2

        features_with_nones = {
            "syllables": [
                {
                    "syllableIndex": 0,
                    "syllableId": "s1",
                    "nucleusDurationSec": None,
                    "intensityDb": None,
                    "f0Semitones": None,
                    "quality": "accepted",
                    "voicedFrameCoverage": 0.8
                },
                {
                    "syllableIndex": 1,
                    "syllableId": "s2",
                    "nucleusDurationSec": None,
                    "intensityDb": None,
                    "f0Semitones": None,
                    "quality": "accepted",
                    "voicedFrameCoverage": 0.8
                }
            ],
            "pairwiseContrasts": [
                {
                    "primaryIndex": 0,
                    "competingIndex": 1,
                    "logDurationRatio": None,
                    "intensityDiffDb": None,
                    "pitchDiffSemitones": None
                }
            ]
        }

        res = evaluate_stress_v2(features_with_nones, ["primary", "unstressed"])
        self.assertIsNotNone(res)
        self.assertIn(res["status"], ("verified", "incorrect", "unrateable"))

    def test_evaluate_stress_v2_uncertain_voiced_coverage_none(self):
        """Stress evaluation survives quality='uncertain' when voicedFrameCoverage is None."""
        from backend.local_server.stress_evaluator_v2 import evaluate_stress_v2

        features = {
            "syllables": [
                {
                    "syllableIndex": 0,
                    "syllableId": "s1",
                    "nucleusDurationSec": 0.2,
                    "intensityDb": 60.0,
                    "f0Semitones": 2.0,
                    "quality": "uncertain",
                    "voicedFrameCoverage": None
                },
                {
                    "syllableIndex": 1,
                    "syllableId": "s2",
                    "nucleusDurationSec": 0.1,
                    "intensityDb": 50.0,
                    "f0Semitones": 0.0,
                    "quality": "accepted",
                    "voicedFrameCoverage": 0.8
                }
            ],
            "pairwiseContrasts": [
                {
                    "primaryIndex": 0,
                    "competingIndex": 1,
                    "logDurationRatio": 0.69,
                    "intensityDiffDb": 10.0,
                    "pitchDiffSemitones": 2.0
                }
            ]
        }

        res = evaluate_stress_v2(features, ["primary", "unstressed"])
        self.assertIsNotNone(res)
        self.assertEqual(res["status"], "unrateable")
        self.assertIn("PRIMARY_NUCLEUS_UNVOICED_OR_UNCERTAIN", res["reasons"])


if __name__ == "__main__":
    unittest.main()
