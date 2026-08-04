import json
import os
import tempfile
import unittest
from unittest.mock import patch


class PronunciationVerifierTest(unittest.TestCase):
    def _trained_artifact(self):
        from backend.local_server.pronunciation_verifier import artifact_sha256
        artifact = {
            "schema_version": "pronunciation-verifier-v1",
            "feature_schema_version": "features-v1",
            "count": {
                "mean": [0.0] * 8,
                "scale": [1.0] * 8,
                "coefficients": [0.0] * 8,
                "intercept": 6.0,
                "thresholds": {"verified": 0.9, "incorrect": 0.1},
            },
            "stress": {
                "mean": [0.0] * 10,
                "scale": [1.0] * 10,
                "coefficients": [0.0] * 10,
                "intercept": 6.0,
                "thresholds": {"verified": 0.9, "incorrect": 0.1},
            },
            "isotonic": {
                "count": [[0.0, 0.0], [1.0, 1.0]],
                "stress": [[0.0, 0.0], [1.0, 1.0]],
            },
        }
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        return artifact

    def _v2_result(self):
        return {
            "contract_version": "recognize-v2",
            "decoded_syllable_count": 2,
            "decoded_is_rateable": True,
            "canonical_alignment": {
                "syllables": [
                    {"nucleus_start_time": 0.05, "nucleus_end_time": 0.25, "nucleus_confidence": 0.9, "confidence": 0.9},
                    {"nucleus_start_time": 0.25, "nucleus_end_time": 0.45, "nucleus_confidence": 0.8, "confidence": 0.8},
                ]
            },
            "hypotheses": {
                "canonical_log_likelihood": -2.0,
                "canonical_minus_omission": 1.0,
                "canonical_minus_insertion": 1.0,
            },
        }

    def test_runtime_evaluation_matches_logistic_probability(self):
        from backend.local_server.pronunciation_verifier import evaluate_model
        artifact = {
            "schema_version": "pronunciation-verifier-v1",
            "feature_schema_version": "features-v1",
            "count": {"mean": [0.0], "scale": [1.0], "coefficients": [2.0], "intercept": 0.0, "thresholds": {"verified": 0.7, "incorrect": 0.3}},
            "stress": {"mean": [0.0], "scale": [1.0], "coefficients": [2.0], "intercept": 0.0, "thresholds": {"verified": 0.7, "incorrect": 0.3}},
            "isotonic": {"count": [[0.0, 0.0], [1.0, 1.0]], "stress": [[0.0, 0.0], [1.0, 1.0]]},
        }
        from backend.local_server.pronunciation_verifier import artifact_sha256
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        result = evaluate_model(artifact, {"count": [1.0], "stress": [1.0]})
        self.assertAlmostEqual(result["count"]["confidence"], 1 / (1 + 2.718281828 ** -2), places=5)
        self.assertEqual(result["count"]["status"], "verified")

    def test_schema_mismatch_fails_closed(self):
        from backend.local_server.pronunciation_verifier import validate_artifact
        with self.assertRaises(ValueError):
            validate_artifact({"schema_version": "old"})

    def test_three_state_gap_is_unrateable(self):
        from backend.local_server.pronunciation_verifier import classify_probability
        self.assertEqual(classify_probability(0.5, verified_threshold=0.8, incorrect_threshold=0.2), "unrateable")

    def test_out_of_range_sentinels_disable_a_decision_class(self):
        from backend.local_server.pronunciation_verifier import (
            artifact_sha256,
            evaluate_model,
        )
        artifact = self._trained_artifact()
        artifact["stress"]["thresholds"] = {
            "verified": 1.000001,
            "incorrect": -0.000001,
        }
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        result = evaluate_model(
            artifact,
            {"count": [0.0] * 8, "stress": [0.0] * 10},
        )
        self.assertEqual(result["stress"]["status"], "unrateable")

    def test_incorrect_confidence_is_confidence_in_the_mismatch(self):
        from backend.local_server.pronunciation_verifier import evaluate_model
        artifact = self._trained_artifact()
        for name in ("count", "stress"):
            artifact[name]["intercept"] = -6.0
        from backend.local_server.pronunciation_verifier import artifact_sha256
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        result = evaluate_model(artifact, {"count": [0.0] * 8, "stress": [0.0] * 10})
        self.assertEqual(result["count"]["status"], "incorrect")
        self.assertGreater(result["count"]["confidence"], 0.99)
        self.assertLess(result["count"]["match_probability"], 0.01)

    def test_ranker_artifact_without_positive_rows_is_rejected(self):
        from backend.local_server.pronunciation_verifier import artifact_sha256, validate_artifact
        artifact = self._trained_artifact()
        artifact["stress"] = {
            "mode": "ranker",
            "features": ["duration_sec", "intensity_db"],
            "weights": [1.0, 0.7],
            "means": [0.0, 0.0],
            "scales": [1.0, 1.0],
            "margin_threshold": 0.5,
            "min_confidence": 0.7,
            "training_positive_rows": 0,
            "calibration_positive_rows": 0,
        }
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        with self.assertRaisesRegex(ValueError, "training_positive_rows"):
            validate_artifact(artifact)

        del artifact["stress"]["training_positive_rows"]
        del artifact["stress"]["calibration_positive_rows"]
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        with self.assertRaisesRegex(ValueError, "training_positive_rows"):
            validate_artifact(artifact)

    def test_disabled_stress_head_loads_and_never_scores_stress(self):
        from backend.local_server.pronunciation_verifier import (
            artifact_sha256, evaluate_model, validate_artifact,
        )
        artifact = self._trained_artifact()
        artifact["stress"] = {"mode": "disabled", "reason": "INSUFFICIENT_MISMATCH_LABELS"}
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        validate_artifact(artifact)  # must not raise
        scored = evaluate_model(artifact, {"count": [0.0] * 8, "stress": [0.0] * 10})
        self.assertEqual(scored["stress"]["status"], "unrateable")
        self.assertEqual(scored["stress"]["reasons"], ["STRESS_SCORING_DISABLED"])

    def test_count_only_artifact_marks_stress_not_applicable(self):
        from backend.local_server import server
        from backend.local_server.pronunciation_verifier import artifact_sha256
        artifact = self._trained_artifact()
        artifact["stress"] = {"mode": "disabled", "reason": "INSUFFICIENT_MISMATCH_LABELS"}
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        praat = {
            "observed": {"syllableCount": 2},
            "pitch": {"times": [0.1, 0.2, 0.3, 0.4], "values": [180, 170, 120, 115]},
            "intensity": {"times": [0.1, 0.2, 0.3, 0.4], "values": [72, 70, 65, 64]},
        }
        with tempfile.TemporaryDirectory() as directory:
            artifact_path = os.path.join(directory, "artifact.json")
            with open(artifact_path, "w", encoding="utf-8") as handle:
                json.dump(artifact, handle)
            with patch.dict(os.environ, {"PRONUNCIATION_VERIFIER_ARTIFACT": artifact_path}):
                result = server._build_v3_verification(
                    praat, self._v2_result(), "/ˈhæ.pi/", 2,
                )
        self.assertFalse(result["primary_stress"]["applicable"])
        self.assertEqual(result["primary_stress"]["reasons"], ["STRESS_SCORING_DISABLED"])
        # Stress must not hold back an otherwise-decided count.
        self.assertEqual(result["status"], result["count"]["status"])

    def test_degraded_response_keeps_praat_spans_for_charts_without_a_count(self):
        from backend.local_server import server
        praat = {
            "observed": {"syllables": [
                {"startTime": 0.0, "endTime": 0.3, "duration": 0.3},
                {"startTime": 0.3, "endTime": 0.6, "duration": 0.3},
            ]},
            "pitch": {"times": [0.1], "values": [180]},
            "intensity": {"times": [0.1], "values": [70]},
        }
        response = server._build_v3_degraded_response(praat, "RECOGNIZER_BUSY")
        self.assertEqual(len(response["observed_syllables"]), 2)
        self.assertEqual(response["segmentation_source"], "praat-fallback")
        self.assertTrue(response["capabilities"]["syllable_duration"])
        # Charts may draw, but no count and no verdict may be claimed.
        self.assertIsNone(response["syllable_count"])
        self.assertEqual(response["verification"]["status"], "unrateable")
        self.assertFalse(response["is_rateable"])

        empty = server._build_v3_degraded_response({}, "RECOGNIZER_BUSY")
        self.assertEqual(empty["observed_syllables"], [])
        self.assertEqual(empty["segmentation_source"], "none")
        self.assertFalse(empty["capabilities"]["syllable_duration"])

    def test_count_features_preserve_valid_zero_likelihood(self):
        from backend.local_server.pronunciation_verifier import count_feature_vector
        result = {
            "decoded_syllable_count": 2,
            "canonical_alignment": {"syllables": [{"nucleus_confidence": 0.8, "confidence": 0.9}]},
            "hypotheses": {
                "canonical_log_likelihood": 0.0,
                "canonical_minus_omission": 0.0,
                "canonical_minus_insertion": 0.0,
            },
        }
        self.assertEqual(count_feature_vector(result, 2)[3], 0.0)
        result["audio_duration_sec"] = 1.0
        self.assertEqual(count_feature_vector(result, 2)[7], 0.5)

    def test_v3_count_abstains_when_praat_count_disagrees_with_ctc(self):
        from backend.local_server import server
        praat = {
            "observed": {"syllableCount": 1},
            "pitch": {"times": [0.1, 0.2, 0.3, 0.4], "values": [180, 170, 120, 115]},
            "intensity": {"times": [0.1, 0.2, 0.3, 0.4], "values": [72, 70, 65, 64]},
        }
        with tempfile.TemporaryDirectory() as directory:
            artifact_path = os.path.join(directory, "artifact.json")
            with open(artifact_path, "w", encoding="utf-8") as handle:
                json.dump(self._trained_artifact(), handle)
            with patch.dict(os.environ, {"PRONUNCIATION_VERIFIER_ARTIFACT": artifact_path}):
                result = server._build_v3_verification(
                    praat,
                    self._v2_result(),
                    "/\u02c8h\u00e6.pi/",
                    2,
                )
        self.assertEqual(result["count"]["status"], "unrateable")
        self.assertIn("ACOUSTIC_COUNT_DISAGREEMENT", result["count"]["reasons"])
        # The reason must be self-explanatory in the payload: expected and
        # observed agree here, so without the acoustic count a reviewer reads
        # "disagreement" as a mismatch between those two.
        self.assertEqual(result["count"]["expected"], 2)
        self.assertEqual(result["count"]["observed"], 2)
        self.assertEqual(result["count"]["acoustic_observed"], 1)

    def test_aligned_acoustic_features_use_ctc_times_and_praat_contours(self):
        from backend.local_server.pronunciation_verifier import aligned_acoustic_features
        praat = {
            "pitch": {"times": [0.1, 0.2, 0.3, 0.4], "values": [100, 120, 180, 200]},
            "intensity": {"times": [0.1, 0.2, 0.3, 0.4], "values": [60, 62, 70, 72]},
        }
        recognizer = {
            "canonical_alignment": {
                "syllables": [
                    {"nucleus_start_time": 0.05, "nucleus_end_time": 0.25, "nucleus_confidence": 0.9},
                    {"nucleus_start_time": 0.25, "nucleus_end_time": 0.45, "nucleus_confidence": 0.8},
                ]
            }
        }
        features = aligned_acoustic_features(praat, recognizer)
        self.assertEqual(len(features), 2)
        self.assertAlmostEqual(features[0]["duration_sec"], 0.2)
        self.assertAlmostEqual(features[0]["f0_median"], 110.0)
        self.assertAlmostEqual(features[1]["intensity_db"], 71.0)

    def test_stress_vector_compares_expected_to_strongest_alternative(self):
        from backend.local_server.pronunciation_verifier import stress_feature_vector
        rows = [
            {"duration_sec": 0.25, "intensity_db": 72, "f0_median": 180, "f0_range": 20, "f0_slope": 5, "spectral_tilt": -8, "nucleus_confidence": 0.9, "voiced_confidence": 1.0},
            {"duration_sec": 0.15, "intensity_db": 65, "f0_median": 120, "f0_range": 10, "f0_slope": 2, "spectral_tilt": -12, "nucleus_confidence": 0.8, "voiced_confidence": 1.0},
        ]
        vector = stress_feature_vector(rows, expected_index=0)
        self.assertGreater(vector[0], 0)
        self.assertGreater(vector[1], 0)
        self.assertEqual(len(vector), 10)

    def test_stress_ranker_requires_expected_nucleus_to_win_by_margin(self):
        from backend.local_server.pronunciation_verifier import evaluate_stress_ranker

        artifact = {
            "mode": "ranker",
            "features": ["duration_sec", "intensity_db", "f0_median"],
            "weights": [1.0, 0.5, 0.25],
            "margin_threshold": 0.2,
            "min_confidence": 0.8,
        }
        rows = [
            {"duration_sec": 0.30, "intensity_db": 72, "f0_median": 180, "nucleus_confidence": 0.95, "voiced_confidence": 1.0},
            {"duration_sec": 0.16, "intensity_db": 65, "f0_median": 120, "nucleus_confidence": 0.90, "voiced_confidence": 1.0},
        ]
        result = evaluate_stress_ranker(artifact, rows, expected_index=0)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["expected_index"], 0)
        self.assertGreater(result["margin"], 0.2)

    def test_stress_ranker_abstains_when_alternative_wins_or_evidence_missing(self):
        from backend.local_server.pronunciation_verifier import evaluate_stress_ranker

        artifact = {
            "mode": "ranker",
            "features": ["duration_sec", "intensity_db", "f0_median"],
            "weights": [1.0, 0.5, 0.25],
            "margin_threshold": 0.2,
            "min_confidence": 0.8,
        }
        rows = [
            {"duration_sec": 0.15, "intensity_db": 64, "f0_median": 115, "nucleus_confidence": 0.95, "voiced_confidence": 1.0},
            {"duration_sec": 0.30, "intensity_db": 72, "f0_median": 180, "nucleus_confidence": 0.90, "voiced_confidence": 1.0},
        ]
        result = evaluate_stress_ranker(artifact, rows, expected_index=0)
        self.assertEqual(result["status"], "unrateable")
        self.assertEqual(result["reason"], "EXPECTED_NUCLEUS_NOT_STRONGEST")

        rows[0]["voiced_confidence"] = 0.0
        result = evaluate_stress_ranker(artifact, rows, expected_index=0)
        self.assertEqual(result["reason"], "MISSING_STRESS_EVIDENCE")

    def test_stress_ranker_normalizes_acoustic_values_within_recording(self):
        from backend.local_server.pronunciation_verifier import evaluate_stress_ranker
        artifact = {
            "mode": "ranker",
            "features": ["duration_sec", "intensity_db"],
            "weights": [1.0, 1.0],
            "means": [0.0, 0.0],
            "scales": [1.0, 1.0],
            "margin_threshold": 0.1,
            "min_confidence": 0.5,
        }
        base = [
            {"duration_sec": 0.30, "intensity_db": 72, "nucleus_confidence": 1.0, "voiced_confidence": 1.0},
            {"duration_sec": 0.15, "intensity_db": 65, "nucleus_confidence": 1.0, "voiced_confidence": 1.0},
        ]
        shifted = [{**row, "intensity_db": row["intensity_db"] + 40} for row in base]
        self.assertEqual(evaluate_stress_ranker(artifact, base, expected_index=0)["status"], "verified")
        self.assertEqual(evaluate_stress_ranker(artifact, shifted, expected_index=0)["status"], "verified")

    def test_v3_verification_uses_aligned_contours_and_trained_revision(self):
        from backend.local_server import server
        praat = {
            "pitch": {"times": [0.1, 0.2, 0.3, 0.4], "values": [180, 170, 120, 115]},
            "intensity": {"times": [0.1, 0.2, 0.3, 0.4], "values": [72, 70, 65, 64]},
        }
        with tempfile.TemporaryDirectory() as directory:
            artifact_path = os.path.join(directory, "artifact.json")
            with open(artifact_path, "w", encoding="utf-8") as handle:
                json.dump(self._trained_artifact(), handle)
            with patch.dict(os.environ, {"PRONUNCIATION_VERIFIER_ARTIFACT": artifact_path}):
                result = server._build_v3_verification(
                    praat,
                    self._v2_result(),
                    "/\u02c8h\u00e6.pi/",
                    2,
                )
        self.assertEqual(result["status"], "verified")
        self.assertEqual(len(result["model_revision"]), 64)
        self.assertEqual(result["primary_stress"]["pitch_evidence"][0]["f0_median"], 175.0)

    def test_v3_verification_missing_aligned_pitch_is_unrateable(self):
        from backend.local_server import server
        praat = {
            "pitch": {"times": [0.1], "values": [180]},
            "intensity": {"times": [0.1, 0.3], "values": [72, 65]},
        }
        with tempfile.TemporaryDirectory() as directory:
            artifact_path = os.path.join(directory, "artifact.json")
            with open(artifact_path, "w", encoding="utf-8") as handle:
                json.dump(self._trained_artifact(), handle)
            with patch.dict(os.environ, {"PRONUNCIATION_VERIFIER_ARTIFACT": artifact_path}):
                result = server._build_v3_verification(
                    praat,
                    self._v2_result(),
                    "/\u02c8h\u00e6.pi/",
                    2,
                )
        self.assertEqual(result["status"], "unrateable")
        self.assertEqual(result["primary_stress"]["reasons"], ["MISSING_STRESS_EVIDENCE"])

    def test_v3_verification_uses_conservative_stress_ranker(self):
        from backend.local_server import server
        artifact = self._trained_artifact()
        artifact["stress"] = {
            "mode": "ranker",
            "features": ["duration_sec", "intensity_db", "f0_median"],
            "weights": [1.0, 0.01, 0.001],
            "means": [0.0, 0.0, 0.0],
            "scales": [1.0, 1.0, 1.0],
            "margin_threshold": 0.01,
            "min_confidence": 0.5,
            "training_positive_rows": 40,
            "calibration_positive_rows": 12,
        }
        from backend.local_server.pronunciation_verifier import artifact_sha256
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        praat = {
            "pitch": {"times": [0.1, 0.2, 0.3, 0.4], "values": [180, 170, 120, 115]},
            "intensity": {"times": [0.1, 0.2, 0.3, 0.4], "values": [72, 70, 65, 64]},
        }
        with tempfile.TemporaryDirectory() as directory:
            artifact_path = os.path.join(directory, "artifact.json")
            with open(artifact_path, "w", encoding="utf-8") as handle:
                json.dump(artifact, handle)
            with patch.dict(os.environ, {"PRONUNCIATION_VERIFIER_ARTIFACT": artifact_path}):
                result = server._build_v3_verification(
                    praat,
                    self._v2_result(),
                    "/\u02c8h\u00e6.pi/",
                    2,
                )
        self.assertEqual(result["primary_stress"]["status"], "verified")
        self.assertTrue(result["primary_stress"]["matches_expected"])

    def test_v3_best_effort_is_advisory_only(self):
        from backend.local_server import server
        result = server._build_v3_best_effort(
            {"observed": {"syllableCount": 2}},
            {"decoded_syllable_count": 2, "decoded_is_rateable": True},
            "/\u02c8h\u00e6.pi/",
            2,
        )
        self.assertFalse(result["available"])
        self.assertTrue(result["advisory_only"])

    def test_v3_best_effort_exposes_observation_only_when_ranker_evidence_exists(self):
        from backend.local_server import server
        artifact = self._trained_artifact()
        artifact["stress"] = {
            "mode": "ranker",
            "features": ["duration_sec", "intensity_db", "f0_median"],
            "weights": [1.0, 0.01, 0.001],
            "means": [0.0, 0.0, 0.0],
            "scales": [1.0, 1.0, 1.0],
            "margin_threshold": 0.05,
            "min_confidence": 0.5,
            "training_positive_rows": 40,
            "calibration_positive_rows": 12,
        }
        from backend.local_server.pronunciation_verifier import artifact_sha256
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        praat = {
            "pitch": {"times": [0.1, 0.2, 0.3, 0.4], "values": [180, 170, 120, 115]},
            "intensity": {"times": [0.1, 0.2, 0.3, 0.4], "values": [72, 70, 65, 64]},
        }
        with tempfile.TemporaryDirectory() as directory:
            artifact_path = os.path.join(directory, "artifact.json")
            with open(artifact_path, "w", encoding="utf-8") as handle:
                json.dump(artifact, handle)
            with patch.dict(os.environ, {"PRONUNCIATION_VERIFIER_ARTIFACT": artifact_path}):
                result = server._build_v3_best_effort(
                    praat,
                    {**self._v2_result(), "decoded_is_rateable": True},
                    "/\u02c8h\u00e6.pi/",
                    2,
                )
        self.assertTrue(result["available"])
        self.assertEqual(result["observed_count"], 2)
        self.assertTrue(result["expected_stress_appears_strongest"])
        self.assertTrue(result["advisory_only"])

    def test_tampered_artifact_fails_closed(self):
        from backend.local_server.pronunciation_verifier import validate_artifact
        artifact = self._trained_artifact()
        artifact["count"]["intercept"] = 99
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            validate_artifact(artifact)
