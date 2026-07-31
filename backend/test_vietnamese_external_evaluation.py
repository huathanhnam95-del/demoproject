import importlib.util
import pathlib
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "evaluate_vietnamese_external.py"


def load_module():
    spec = importlib.util.spec_from_file_location("evaluate_vietnamese_external", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VietnameseExternalEvaluationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_clean_metrics_and_non_clean_rows_are_kept_separate(self):
        dataset = {
            "records": [
                {
                    "id": "clean",
                    "category": "clean",
                    "syllable_count": 2,
                    "label_count": 1,
                    "label_stress": 1,
                },
                {
                    "id": "omission",
                    "category": "omission",
                    "syllable_count": 2,
                    "label_count": 0,
                    "label_stress": None,
                },
            ]
        }
        zero_features = {
            **{name: 0.0 for name in self.module.COUNT_FEATURES},
            **{name: 0.0 for name in self.module.STRESS_FEATURES},
        }
        features = {
            "records": [
                {
                    "id": row_id,
                    "features": zero_features,
                    "diagnostics": {
                        "decoded_is_rateable": True,
                        "all_nuclei_voiced": True,
                    },
                }
                for row_id in ("clean", "omission")
            ]
        }
        artifact = {"artifact_sha256": "test"}
        scores = [
            {
                "count": {"status": "verified", "confidence": 0.99},
                "stress": {"status": "verified", "confidence": 0.98},
            },
            {
                "count": {"status": "incorrect", "confidence": 0.97},
                "stress": {"status": "unrateable", "confidence": 0.0},
            },
        ]
        with mock.patch.object(self.module, "evaluate_model", side_effect=scores):
            result = self.module.evaluate(dataset, features, artifact)
        self.assertEqual(result["clean"]["eligible"], 1)
        self.assertEqual(result["clean"]["count_accepted_precision"], 1.0)
        self.assertEqual(result["clean"]["count_coverage"], 1.0)
        self.assertEqual(result["clean"]["polysyllabic_stress_verified_rate"], 1.0)
        self.assertEqual(len(result["non_clean_individual"]), 1)
        self.assertEqual(result["non_clean_individual"][0]["id"], "omission")

    def test_missing_features_count_against_clean_coverage(self):
        dataset = {
            "records": [
                {
                    "id": "missing",
                    "category": "clean",
                    "syllable_count": 1,
                    "label_count": 1,
                    "label_stress": None,
                }
            ]
        }
        result = self.module.evaluate(dataset, {"records": []}, {"artifact_sha256": "test"})
        self.assertEqual(result["clean"]["count_coverage"], 0.0)
        self.assertFalse(result["gates"]["clean_count_coverage"])

    def test_transformed_errors_gate_relevant_component_only(self):
        dataset = {
            "records": [
                {
                    "id": "count-error",
                    "transformation_operator": "count_omission",
                    "syllable_count": 2,
                    "label_count": 0,
                    "label_stress": None,
                },
                {
                    "id": "stress-error",
                    "transformation_operator": "wrong_stress",
                    "syllable_count": 2,
                    "label_count": 1,
                    "label_stress": 0,
                },
            ]
        }
        zero_features = {
            **{name: 0.0 for name in self.module.COUNT_FEATURES},
            **{name: 0.0 for name in self.module.STRESS_FEATURES},
        }
        features = {
            "records": [
                {
                    "id": row_id,
                    "features": zero_features,
                    "diagnostics": {
                        "decoded_is_rateable": True,
                        "all_nuclei_voiced": True,
                    },
                }
                for row_id in ("count-error", "stress-error")
            ]
        }
        scores = [
            {
                "count": {"status": "incorrect", "confidence": 0.99},
                "stress": {"status": "verified", "confidence": 0.99},
            },
            {
                "count": {"status": "verified", "confidence": 0.99},
                "stress": {"status": "unrateable", "confidence": 0.0},
            },
        ]
        with mock.patch.object(self.module, "evaluate_model", side_effect=scores):
            result = self.module.evaluate_transformed(
                dataset,
                features,
                {"artifact_sha256": "test"},
            )
        self.assertEqual(result["incorrect"], 1)
        self.assertEqual(result["unrateable"], 1)
        self.assertEqual(result["incorrectly_verified"], 0)
        self.assertFalse(result["passed"])


if __name__ == "__main__":
    unittest.main()
