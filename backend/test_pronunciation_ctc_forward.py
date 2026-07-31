import unittest
from unittest.mock import patch

import numpy as np


class CtcForwardLikelihoodTest(unittest.TestCase):
    def test_tokenizer_normalizes_dictionary_voicing_diacritic(self):
        from backend.phoneme_service.stress_alignment import tokenize_ipa

        symbols = ["<pad>", "t", "i"]
        self.assertEqual(tokenize_ipa("t̬i", symbols), [1, 2])

    def test_forward_sum_is_finite_and_length_normalized(self):
        from backend.phoneme_service.backends import ctc_forward_log_likelihood
        emissions = np.log(np.asarray([
            [0.8, 0.1, 0.1],
            [0.1, 0.8, 0.1],
            [0.8, 0.1, 0.1],
        ], dtype=float))
        result = ctc_forward_log_likelihood(emissions, [1], blank_id=0)
        self.assertTrue(np.isfinite(result["log_likelihood"]))
        self.assertTrue(np.isfinite(result["normalized_log_likelihood"]))
        self.assertGreaterEqual(result["path_count"], 1)

    def test_forward_sum_handles_repeated_tokens_and_underflow(self):
        from backend.phoneme_service.backends import ctc_forward_log_likelihood
        emissions = np.full((40, 4), -1000.0, dtype=float)
        emissions[:, 0] = 0.0
        result = ctc_forward_log_likelihood(emissions, [1, 1], blank_id=0)
        self.assertTrue(np.isfinite(result["log_likelihood"]))
        self.assertEqual(result["target_length"], 2)

    def test_hypothesis_features_choose_best_vowel_edit(self):
        from backend.phoneme_service.stress_alignment import ctc_hypothesis_features

        def score(_log_probs, target_ids, *, blank_id):
            values = {
                (1, 2): -1.0,
                (2,): -4.0,
                (1,): -2.0,
                (1, 1, 2): -3.0,
                (1, 2, 2): -1.5,
            }
            return {"normalized_log_likelihood": values[tuple(target_ids)]}

        with patch("backend.phoneme_service.stress_alignment.ctc_forward_log_likelihood", side_effect=score):
            result = ctc_hypothesis_features(
                np.zeros((2, 3)),
                [1, 2],
                blank_id=0,
                omission_candidates=[[2], [1]],
                insertion_candidates=[[1, 1, 2], [1, 2, 2]],
            )
        self.assertEqual(result["canonical_minus_omission"], 1.0)
        self.assertEqual(result["canonical_minus_insertion"], 0.5)
        self.assertEqual(result["omission_candidate_count"], 2)
        self.assertEqual(result["insertion_candidate_count"], 2)
