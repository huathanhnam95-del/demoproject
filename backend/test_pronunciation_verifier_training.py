import json
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "train_pronunciation_verifier.py"


def load_module():
    spec = importlib.util.spec_from_file_location("train_pronunciation_verifier", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PronunciationVerifierTrainingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def _nuclei(self):
        strong = {
            "duration_sec": 0.30, "intensity_db": 72.0, "f0_median": 185.0,
            "f0_range": 40.0, "f0_slope": 6.0, "spectral_tilt": -8.0,
            "nucleus_confidence": 0.95, "voiced_confidence": 1.0,
        }
        weak = {
            "duration_sec": 0.14, "intensity_db": 64.0, "f0_median": 120.0,
            "f0_range": 10.0, "f0_slope": 1.0, "spectral_tilt": -13.0,
            "nucleus_confidence": 0.90, "voiced_confidence": 1.0,
        }
        return [strong, weak]

    def _rows(self, with_nuclei=True):
        rows = []
        for index in range(20):
            positive = index % 2 == 0
            row = {
                "speaker_id": f"speaker-{index}",
                "split": "train" if index < 12 else "calibration",
                "label_count": int(positive),
                "label_stress": int(positive),
                "diagnostics": {
                    "decoded_is_rateable": True,
                    "all_nuclei_voiced": True,
                    "expected_stress": 0,
                },
                "features": {
                    **{
                        name: 0.0
                        for name in (
                            self.module.COUNT_FEATURES
                            + self.module.STRESS_FEATURES
                        )
                    },
                    "count_delta": 0 if positive else 1,
                    "alignment_confidence": 0.9 if positive else 0.2,
                    "expected_duration_margin": 1 if positive else -1,
                },
            }
            if with_nuclei and positive:
                row["stress_nuclei"] = self._nuclei()
            rows.append(row)
        return rows

    def test_training_exports_json_artifact_with_ranker_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            records = pathlib.Path(temp) / "records.json"
            output = pathlib.Path(temp) / "artifact.json"
            records.write_text(json.dumps(self._rows()), encoding="utf-8")
            completed = subprocess.run([sys.executable, str(SCRIPT), "--input", str(records), "--output", str(output)], capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            artifact = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(artifact["schema_version"], "pronunciation-verifier-v1")
            self.assertIn("count", artifact)
            self.assertIn("stress", artifact)
            self.assertEqual(artifact["stress"]["mode"], "ranker")
            self.assertGreater(artifact["stress"]["training_positive_rows"], 0)
            self.assertGreater(artifact["stress"]["calibration_positive_rows"], 0)
            self.assertEqual(artifact["training_support"]["train"], 12)
            self.assertEqual(artifact["training_support"]["calibration"], 8)
            self.assertTrue(artifact["ablations"]["prior_only"]["evaluated"])
            self.assertTrue(artifact["ablations"]["alignment_only"]["evaluated"])
            self.assertIn("probability", artifact["ablations"]["prior_only"])
            self.assertIn("model", artifact["ablations"]["alignment_only"])
            self.assertIn("isotonic", artifact["ablations"]["alignment_only"])

    def test_dry_run_does_not_write_an_artifact(self):
        with tempfile.TemporaryDirectory() as temp:
            records = pathlib.Path(temp) / "records.json"
            output = pathlib.Path(temp) / "artifact.json"
            records.write_text(json.dumps(self._rows()), encoding="utf-8")
            completed = subprocess.run([sys.executable, str(SCRIPT), "--input", str(records), "--output", str(output), "--dry-run"], capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertFalse(output.exists(), "--dry-run must not write a promotable artifact")
            self.assertTrue(json.loads(completed.stdout)["dry_run"])
            self.assertFalse(json.loads(completed.stdout)["written"])

    def test_missing_stress_nuclei_fails_instead_of_using_default_weights(self):
        with self.assertRaisesRegex(ValueError, "no eligible training rows"):
            self.module.train(self._rows(with_nuclei=False))

    def test_count_only_training_needs_no_stress_data_and_disables_incorrect(self):
        # The count-only profile is exactly the shard shape that fails the
        # full trainer: count labels present, no stress_nuclei anywhere.
        artifact = self.module.train(self._rows(with_nuclei=False), count_only=True)
        self.assertEqual(artifact["release_profile"], "count-only")
        self.assertEqual(artifact["stress"]["mode"], "disabled")
        self.assertNotIn("weights", artifact["stress"])
        thresholds = artifact["count"]["thresholds"]
        self.assertEqual(thresholds["incorrect"], self.module.DISABLED_INCORRECT_THRESHOLD)
        self.assertLess(thresholds["incorrect"], 0.0)
        self.assertEqual(thresholds["incorrect_decisions"], 0)

    def test_count_only_artifact_can_never_return_incorrect(self):
        import sys, pathlib
        sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))
        from backend.local_server.pronunciation_verifier import classify_probability
        artifact = self.module.train(self._rows(with_nuclei=False), count_only=True)
        thresholds = artifact["count"]["thresholds"]
        for probability in (0.0, 0.001, 0.25, 0.5, 0.75, 1.0):
            status = classify_probability(
                probability,
                verified_threshold=float(thresholds["verified"]),
                incorrect_threshold=float(thresholds["incorrect"]),
            )
            self.assertIn(status, ("verified", "unrateable"))
            self.assertNotEqual(status, "incorrect")

    def test_thresholds_maximize_decisions_subject_to_precision(self):
        probabilities = [0.99, 0.95, 0.85, 0.20, 0.10, 0.01]
        labels = [1, 1, 0, 1, 0, 0]
        thresholds = self.module.select_thresholds(probabilities, labels, min_precision=0.95)
        self.assertGreater(thresholds["verified"], 0.85)
        self.assertLess(thresholds["incorrect"], 0.20)
        self.assertEqual(thresholds["verified_decisions"], 2)
        self.assertEqual(thresholds["incorrect_decisions"], 2)

    def test_speaker_overlap_between_train_and_calibration_is_rejected(self):
        rows = [
            {"speaker_id": "same", "split": "train", "label_count": 1, "label_stress": 1, "features": {}},
            {"speaker_id": "same", "split": "calibration", "label_count": 0, "label_stress": 0, "features": {}},
        ]
        with self.assertRaisesRegex(ValueError, "speaker leakage"):
            self.module.train(rows)

    def test_training_vectors_exclude_unrateable_component_rows(self):
        complete_features = {
            name: 0.0
            for name in self.module.COUNT_FEATURES + self.module.STRESS_FEATURES
        }
        rows = [
            {
                "label_count": 1,
                "label_stress": 1,
                "diagnostics": {
                    "decoded_is_rateable": True,
                    "all_nuclei_voiced": True,
                },
                "features": complete_features,
            },
            {
                "label_count": 0,
                "label_stress": 0,
                "diagnostics": {
                    "decoded_is_rateable": False,
                    "all_nuclei_voiced": False,
                },
                "features": complete_features,
            },
        ]
        _, count_labels = self.module._vectors(
            rows,
            self.module.COUNT_FEATURES,
            "label_count",
        )
        _, stress_labels = self.module._vectors(
            rows,
            self.module.STRESS_FEATURES,
            "label_stress",
        )
        self.assertEqual(count_labels.tolist(), [1])
        self.assertEqual(stress_labels.tolist(), [1])

    def test_missing_feature_fails_closed_instead_of_becoming_zero(self):
        rows = [
            {
                "id": "incomplete",
                "label_count": 1,
                "diagnostics": {"decoded_is_rateable": True},
                "features": {},
            }
        ]
        with self.assertRaisesRegex(ValueError, "missing feature"):
            self.module._vectors(
                rows,
                self.module.COUNT_FEATURES,
                "label_count",
            )
