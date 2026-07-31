import importlib.util
import pathlib
import unittest


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "build_perturbation_reference_dataset.py"


def load_module():
    spec = importlib.util.spec_from_file_location("build_perturbation_reference_dataset", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PerturbationReferenceDatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_count_and_stress_edits_receive_independent_labels(self):
        parents = {"records": [{
            "id": "parent",
            "label_count": 1,
            "label_stress": 1,
            "syllable_count": 3,
        }]}
        perturbations = {"records": [
            {"id": "omit", "parent_id": "parent", "operator": "count_omission", "audio": "omit.wav"},
            {"id": "stress", "parent_id": "parent", "operator": "wrong_stress", "audio": "stress.wav"},
        ]}
        result = self.module.build(parents, perturbations)
        by_id = {row["id"]: row for row in result["records"]}
        self.assertEqual(by_id["omit"]["label_count"], 0)
        self.assertIsNone(by_id["omit"]["label_stress"])
        self.assertEqual(by_id["stress"]["label_count"], 1)
        self.assertEqual(by_id["stress"]["label_stress"], 0)


if __name__ == "__main__":
    unittest.main()
