import importlib.util
import pathlib
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "evaluate_pronunciation_verifier.py"


def load_module():
    spec = importlib.util.spec_from_file_location("evaluate_pronunciation_verifier", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PronunciationVerifierEvaluationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_precision_treats_confident_wrong_match_as_false_positive(self):
        decisions = [
            {"status": "verified", "truth_matches": True},
            {"status": "verified", "truth_matches": False},
        ]
        value, count = self.module.precision(decisions, "verified")
        self.assertEqual(count, 2)
        self.assertEqual(value, 0.5)

    def test_ece_is_zero_for_perfect_binary_probabilities(self):
        self.assertEqual(self.module.expected_calibration_error([0.0, 1.0], [0, 1]), 0.0)

    def test_evaluate_excludes_unknown_component_truth_from_overall_denominator(self):
        dataset = {
            "records": [
                {
                    "id": "known",
                    "split": "test",
                    "gender": "f",
                    "syllable_count": 1,
                    "label_count": 1,
                    "label_stress": None,
                },
                {
                    "id": "unknown-stress",
                    "split": "test",
                    "gender": "m",
                    "syllable_count": 2,
                    "label_count": 1,
                    "label_stress": None,
                },
            ]
        }
        features = {
            "records": [
                {
                    "id": sample_id,
                    "diagnostics": {"decoded_is_rateable": True, "all_nuclei_voiced": True},
                    "features": {
                        **{name: 0.0 for name in self.module.COUNT_FEATURES},
                        **{name: 0.0 for name in self.module.STRESS_FEATURES},
                    },
                }
                for sample_id in ("known", "unknown-stress")
            ]
        }
        artifact = {"artifact_sha256": "test", "ablations": {"full_beats_both": True}}
        score = {
            "count": {"status": "verified", "match_probability": 0.99},
            "stress": {"status": "verified", "match_probability": 0.99},
        }
        with mock.patch.object(self.module, "evaluate_model", return_value=score):
            result = self.module.evaluate(dataset, features, artifact)
        self.assertEqual(result["metrics"]["eligible"], 1)
        self.assertEqual(result["metrics"]["unknown_ground_truth"], 1)
        self.assertEqual(result["metrics"]["verified_decisions"], 1)

    def test_gates_enforce_subgroup_precision_and_acoustic_ablation(self):
        dataset = {
            "records": [
                {
                    "id": "female",
                    "split": "test",
                    "gender": "f",
                    "syllable_count": 1,
                    "label_count": 1,
                    "label_stress": None,
                },
                {
                    "id": "male",
                    "split": "test",
                    "gender": "m",
                    "syllable_count": 1,
                    "label_count": 0,
                    "label_stress": None,
                },
            ]
        }
        features = {
            "records": [
                {
                    "id": sample_id,
                    "diagnostics": {"decoded_is_rateable": True, "all_nuclei_voiced": True},
                    "features": {
                        **{name: 0.0 for name in self.module.COUNT_FEATURES},
                        **{name: 0.0 for name in self.module.STRESS_FEATURES},
                    },
                }
                for sample_id in ("female", "male")
            ]
        }
        artifact = {"artifact_sha256": "test", "ablations": {"full_beats_both": False}}

        def score(artifact_arg, payload):
            del artifact_arg, payload
            return {
                "count": {"status": "verified", "match_probability": 0.99},
                "stress": {"status": "verified", "match_probability": 0.99},
            }

        with mock.patch.object(self.module, "evaluate_model", side_effect=score):
            result = self.module.evaluate(dataset, features, artifact)
        self.assertTrue(result["gates"]["female_subgroup_precision"])
        self.assertFalse(result["gates"]["male_subgroup_precision"])
        self.assertFalse(result["gates"]["acoustic_ablation"])


if __name__ == "__main__":
    unittest.main()
