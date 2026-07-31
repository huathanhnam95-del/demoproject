import unittest


class ArpabetMappingTest(unittest.TestCase):
    def test_mapping_covers_reduced_vowels_diphthongs_and_rhotics(self):
        from backend.phoneme_service.arpabet import arpabet_to_ipa
        mapped = arpabet_to_ipa(["AH0", "ER0", "ER1", "ER2", "AY1", "AO0", "R"])
        self.assertEqual(mapped, ["ə", "ɚ", "ɜː", "ɜː", "aɪ", "ɔ", "ɹ"])

    def test_unknown_tokens_are_rejected(self):
        from backend.phoneme_service.arpabet import arpabet_to_ipa
        with self.assertRaises(ValueError):
            arpabet_to_ipa(["NOT_A_PHONE"])
