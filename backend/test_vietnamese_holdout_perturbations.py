import importlib.util
import pathlib
import unittest


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "generate_vietnamese_holdout_perturbations.py"


def load_module():
    spec = importlib.util.spec_from_file_location("generate_vietnamese_holdout_perturbations", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VietnameseHoldoutPerturbationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_child_rows_are_evaluation_only_and_component_labelled(self):
        parent = {
            "id": "parent",
            "source_recording_id": "parent",
            "split": "vietnamese_external",
            "label_count": 1,
            "label_stress": 1,
        }
        count_child = self.module.build_child_row(
            parent,
            "count_omission",
            pathlib.Path("child.wav"),
            {"nucleus_index": 0},
        )
        stress_child = self.module.build_child_row(
            parent,
            "wrong_stress",
            pathlib.Path("stress.wav"),
            {"competing_duration": 1.20},
        )
        self.assertEqual(count_child["split"], "vietnamese_transformed_holdout")
        self.assertTrue(count_child["evaluation_only"])
        self.assertEqual(count_child["label_count"], 0)
        self.assertIsNone(count_child["label_stress"])
        self.assertEqual(stress_child["label_count"], 1)
        self.assertEqual(stress_child["label_stress"], 0)
        self.assertNotEqual(count_child["source_recording_id"], parent["source_recording_id"])

    def test_training_strengths_are_not_reused(self):
        self.assertNotEqual(
            self.module.HELD_OUT_STRESS_PARAMETERS["competing_duration"],
            1.30,
        )
        self.assertNotEqual(
            self.module.HELD_OUT_STRESS_PARAMETERS["competing_db"],
            3.0,
        )
        self.assertNotEqual(
            self.module.HELD_OUT_STRESS_PARAMETERS["competing_semitones"],
            2.0,
        )

    def test_generated_dataset_uses_archive_hash_contract(self):
        source = self.module.SCRIPT if hasattr(self.module, "SCRIPT") else None
        del source
        self.assertIn("archive_sha256", pathlib.Path(SCRIPT).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
