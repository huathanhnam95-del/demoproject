#!/usr/bin/env python3
"""Contract tests for the V4 reference-IPA syllabification layer.

These tests deliberately exercise the pure syllabification contract before
the service wiring.  V4 is reference-constrained, but its frame spans must be
derived from the same CTC logits used by recognize-v2.
"""

from __future__ import annotations

import unittest

import numpy as np


class TestV4ReferenceTokenization(unittest.TestCase):
    def test_longest_match_and_glyph_equivalence(self):
        from backend.phoneme_service.v4_syllabification import tokenize_reference_ipa

        symbols = ["<pad>", "t", "ʃ", "tʃ", "g"]
        result = tokenize_reference_ipa("/ˈtʃɡ/", symbols)

        self.assertEqual([token.symbol for token in result.tokens], ["tʃ", "g"])
        self.assertEqual([token.token_id for token in result.tokens], [3, 4])
        self.assertEqual(result.tokens[0].stress, "primary")

        equivalent = tokenize_reference_ipa("/ˈtʃɡ/", ["<pad>", "t", "ʃ", "tʃ", "ɡ"])
        self.assertEqual(
            [token.token_id for token in equivalent.tokens],
            [3, 4],
            "g and IPA script-g must classify equivalently",
        )

    def test_unknown_ipa_fails_closed(self):
        from backend.phoneme_service.v4_syllabification import (
            V4SyllabificationError,
            tokenize_reference_ipa,
        )

        with self.assertRaises(V4SyllabificationError) as context:
            tokenize_reference_ipa("/ˈhɛ☃/", ["<pad>", "h", "ɛ"])
        self.assertEqual(context.exception.code, "V4_IPA_TOKENIZATION_FAILED")

    def test_empty_symbol_inventory_fails_before_none_token_id_cast(self):
        from backend.phoneme_service.v4_syllabification import align_v4_reference

        result = align_v4_reference(
            np.log(np.asarray([[0.9, 0.1], [0.9, 0.1]])),
            "/i/",
            ["<pad>"],
        )

        self.assertFalse(result.aligned)
        self.assertEqual(result.reason, "V4_IPA_TOKENIZATION_FAILED")


class TestV4SyllabificationRules(unittest.TestCase):
    def test_maximal_legal_onset_for_unstressed_lax_context(self):
        from backend.phoneme_service.v4_syllabification import syllabify_reference_ipa

        result = syllabify_reference_ipa("/əˈkənstrʌktɪv/")

        self.assertEqual(result.syllable_count, 4)
        self.assertEqual([item.ipa for item in result.syllables], ["ə", "ˈkən", "strʌk", "tɪv"])
        self.assertEqual(result.syllabification_version, "pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1")

    def test_stressed_lax_reserves_one_intervening_consonant_for_prior_coda(self):
        from backend.phoneme_service.v4_syllabification import syllabify_reference_ipa

        result = syllabify_reference_ipa("/ˈkæmərə/")

        self.assertEqual([item.ipa for item in result.syllables], ["ˈkæm", "ə", "rə"])
        self.assertEqual(result.syllables[0].coda, ("m",))
        self.assertEqual(result.syllables[1].onset, ())
        ambiguity = result.syllables[0].ambiguity
        self.assertEqual(ambiguity["predicate"], "stressed-lax-singleton-vcv")
        self.assertEqual(ambiguity["predicateCode"], "V4_STRESSED_LAX_SINGLETON_VCV")
        self.assertTrue(ambiguity["isSingleton"])
        self.assertEqual(ambiguity["selectedDisplay"], "ˈkæm.ə")
        self.assertEqual(ambiguity["alternativeDisplay"], "ˈkæ.mə")
        self.assertEqual(ambiguity["alternative"]["nextOnset"], ["m"])

    def test_empty_onsets_and_final_coda_are_valid(self):
        from backend.phoneme_service.v4_syllabification import syllabify_reference_ipa

        result = syllabify_reference_ipa("/ˈiːəst/")

        self.assertEqual(result.syllable_count, 2)
        self.assertEqual(result.syllables[1].onset, ())
        self.assertEqual(result.syllables[1].coda, ("s", "t"))

    def test_missing_vowel_fails_closed(self):
        from backend.phoneme_service.v4_syllabification import (
            V4SyllabificationError,
            syllabify_reference_ipa,
        )

        with self.assertRaises(V4SyllabificationError) as context:
            syllabify_reference_ipa("/str/")
        self.assertEqual(context.exception.code, "V4_NO_VOWEL_NUCLEUS")


class TestV4LogitAlignment(unittest.TestCase):
    def test_alignment_uses_one_logit_matrix_and_preserves_syllable_ids(self):
        from backend.phoneme_service.v4_syllabification import align_v4_reference

        symbols = ["<pad>", "k", "æ", "m", "ə", "r"]
        probabilities = np.full((11, len(symbols)), 0.01, dtype=float)
        sequence = [0, 1, 1, 2, 2, 3, 0, 4, 4, 5, 0]
        for frame, token_id in enumerate(sequence):
            probabilities[frame, token_id] = 0.9
        result = align_v4_reference(
            np.log(probabilities),
            "/ˈkæmərə/",
            symbols,
            blank_id=0,
            sample_count=1760,
            sample_rate=16000,
        )

        self.assertTrue(result.aligned)
        self.assertEqual(result.syllable_count, 3)
        self.assertEqual(result.analysis_version, "pronunciation-analysis-v4.1")
        self.assertEqual(result.syllabification_version, "pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1")
        self.assertEqual([item.syllable_id for item in result.syllables], ["v4-syllable-1", "v4-syllable-2", "v4-syllable-3"])
        self.assertEqual(result.syllables[0].partition_end_frame, result.syllables[1].partition_start_frame)
        payload = result.to_dict()
        self.assertEqual(payload["schemaVersion"], "pronunciation-syllabification-v1")
        self.assertEqual(payload["provenance"]["ruleVersion"], "pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1")
        self.assertEqual(payload["provenance"]["onsetInventoryVersion"], "en-US-onsets-v1")
        self.assertEqual(payload["provenance"]["syllables"][0]["syllableId"], "v4-syllable-1")
        self.assertEqual(payload["provenance"]["syllables"][0]["alignmentTokenRange"]["endExclusive"], 3)
        self.assertRegex(payload["contentHash"] if "contentHash" in payload else payload["provenance"]["contentHash"], r"^[0-9a-f]{64}$")

    def test_alignment_fails_closed_when_ctc_cannot_fit_reference(self):
        from backend.phoneme_service.v4_syllabification import align_v4_reference

        symbols = ["<pad>", "h", "ɛ", "l", "oʊ"]
        log_probs = np.log(np.asarray([[0.99, 0.005, 0.005]] * 2))
        result = align_v4_reference(log_probs, "/ˈhɛloʊ/", symbols, blank_id=0)

        self.assertFalse(result.aligned)
        self.assertEqual(result.reason, "V4_CTC_ALIGNMENT_FAILED")

    def test_nonfinite_logits_fail_closed_as_invalid_logits(self):
        from backend.phoneme_service.v4_syllabification import align_v4_reference

        result = align_v4_reference(
            np.asarray([[float("nan"), 0.0], [0.0, 0.0]]),
            "/i/",
            ["<pad>", "i"],
        )

        self.assertFalse(result.aligned)
        self.assertEqual(result.reason, "V4_INVALID_LOGITS")

    def test_conflicting_canonical_token_sequence_fails_closed(self):
        from backend.phoneme_service.v4_syllabification import align_v4_reference

        symbols = ["<pad>", "k", "æ", "m", "ə", "r"]
        log_probs = np.log(np.asarray([[0.01, 0.2, 0.2, 0.2, 0.2, 0.19]] * 12))
        result = align_v4_reference(
            log_probs,
            "/ˈkæmərə/",
            symbols,
            canonical_token_ids=[1, 2, 4, 5],
        )

        self.assertFalse(result.aligned)
        self.assertEqual(result.reason, "V4_TOKEN_SEQUENCE_MISMATCH")

    def test_vowel_nucleus_timing_exposed_on_v4_syllable(self):
        from backend.phoneme_service.v4_syllabification import align_v4_reference

        symbols = ["<pad>", "k", "æ", "m", "ə", "r"]
        probabilities = np.full((11, len(symbols)), 0.01, dtype=float)
        sequence = [0, 1, 1, 2, 2, 3, 0, 4, 4, 5, 0]
        for frame, token_id in enumerate(sequence):
            probabilities[frame, token_id] = 0.9
        result = align_v4_reference(
            np.log(probabilities),
            "/ˈkæmərə/",
            symbols,
            blank_id=0,
            sample_count=1760,
            sample_rate=16000,
        )

        self.assertTrue(result.aligned)
        syl1 = result.syllables[0]
        self.assertIsNotNone(syl1.vowel_start_time)
        self.assertIsNotNone(syl1.vowel_end_time)
        self.assertIsNotNone(syl1.vowel_duration)
        self.assertGreater(syl1.vowel_duration, 0)
        # Check serialization in to_dict()
        data = syl1.to_dict()
        self.assertIn("vowel_duration", data)
        self.assertIn("vowelDuration", data)
        self.assertIn("vowelStartTime", data)
        self.assertIn("vowelEndTime", data)
        self.assertEqual(data["vowelDuration"], syl1.vowel_duration)


if __name__ == "__main__":
    unittest.main()
