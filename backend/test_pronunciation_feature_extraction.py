import importlib.util
import pathlib
import unittest


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "extract_pronunciation_calibration_features.py"


def load_module():
    spec = importlib.util.spec_from_file_location("extract_pronunciation_calibration_features", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PronunciationFeatureExtractionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_reference_layout_preserves_phone_token_and_primary_stress_ranges(self):
        symbols = ["<pad>", "b", "\u0259", "n", "\u00e6"]
        layout = self.module.build_reference_layout("B AH0 N AE1 N AH0", symbols)
        self.assertEqual(len(layout["phone_token_ranges"]), 6)
        self.assertEqual(layout["vowel_phone_indices"], [1, 3, 5])
        self.assertEqual(layout["primary_stress_phone_indices"], [3])
        self.assertEqual(len(layout["token_ids"]), 6)

    def test_word_phone_range_converts_to_complete_token_range(self):
        symbols = ["<pad>", "b", "\u0259", "n", "\u00e6"]
        layout = self.module.build_reference_layout("B AH0 N AE1 N AH0", symbols)
        self.assertEqual(self.module._token_range_for_phone_range(layout, [1, 4]), (1, 4))

    def test_ipa_layout_preserves_selected_variant_syllables_and_stress(self):
        symbols = ["<pad>", "h", "\u00e6", "p", "i"]
        layout = self.module.build_ipa_reference_layout(["h\u00e6", "pi"], 0, symbols)
        self.assertTrue(layout["direct_word"])
        self.assertEqual(layout["nucleus_token_ranges"], [[1, 2], [3, 4]])
        self.assertEqual(layout["expected_stress"], 0)


if __name__ == "__main__":
    unittest.main()
