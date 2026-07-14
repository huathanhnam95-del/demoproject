"""
Tests for IndependentSyllabifier
================================

All tests use mock phoneme data — no model required.
"""

from __future__ import annotations

import unittest

from backend.phoneme_service.syllabifier import IndependentSyllabifier


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ph(symbol: str, start: float, end: float, confidence: float = 0.92) -> dict:
    """Build a mock phoneme dict."""
    return {
        "symbol": symbol,
        "start_time": start,
        "end_time": end,
        "confidence": confidence,
    }


def _quick_phonemes(symbols: list[str], confidence: float = 0.92) -> list[dict]:
    """Generate evenly-spaced phoneme dicts from a symbol list."""
    return [
        _ph(sym, round(i * 0.08, 4), round((i + 1) * 0.08, 4), confidence)
        for i, sym in enumerate(symbols)
    ]


class TestIndependentSyllabifier(unittest.TestCase):
    """Verify independent syllabification and quality policy."""

    def setUp(self) -> None:
        self.syl = IndependentSyllabifier(
            mean_confidence_threshold=0.45,
            nucleus_confidence_threshold=0.30,
        )

    # ------------------------------------------------------------------
    # 1. Monophthong counting — banana → [b, æ, n, æ, n, ə] → 3 syllables
    # ------------------------------------------------------------------
    def test_monophthong_counting(self) -> None:
        phonemes = _quick_phonemes(["b", "æ", "n", "æ", "n", "ə"])
        result = self.syl.syllabify(phonemes)

        self.assertEqual(result["syllable_count"], 3)
        self.assertEqual(result["nuclei_detected"], ["æ", "æ", "ə"])

    # ------------------------------------------------------------------
    # 2. Diphthong counting — photo → [f, oʊ, t, oʊ] → 2 syllables
    #    Diphthongs are ONE nucleus.
    # ------------------------------------------------------------------
    def test_diphthong_counting(self) -> None:
        phonemes = _quick_phonemes(["f", "oʊ", "t", "oʊ"])
        result = self.syl.syllabify(phonemes)

        self.assertEqual(result["syllable_count"], 2)
        self.assertEqual(result["nuclei_detected"], ["oʊ", "oʊ"])

    # ------------------------------------------------------------------
    # 3. Rhotic vowel — car → [k, ɑɹ] → 1 syllable
    # ------------------------------------------------------------------
    def test_rhotic_vowel(self) -> None:
        phonemes = _quick_phonemes(["k", "ɑɹ"])
        result = self.syl.syllabify(phonemes)

        self.assertEqual(result["syllable_count"], 1)
        self.assertEqual(result["nuclei_detected"], ["ɑɹ"])

    # ------------------------------------------------------------------
    # 4. Syllabic consonant — button → [b, ʌ, t, n̩] → 2 syllables
    # ------------------------------------------------------------------
    def test_syllabic_consonant(self) -> None:
        phonemes = _quick_phonemes(["b", "ʌ", "t", "n̩"])
        result = self.syl.syllabify(phonemes)

        self.assertEqual(result["syllable_count"], 2)
        self.assertEqual(result["nuclei_detected"], ["ʌ", "n̩"])

    # ------------------------------------------------------------------
    # 5. Omission detection — someone says "photography" but drops a
    #    syllable: [f, oʊ, t, ə, ɡ, ɹ, f, i] → 3 syllables (not 4)
    # ------------------------------------------------------------------
    def test_omission_detection(self) -> None:
        phonemes = _quick_phonemes(["f", "oʊ", "t", "ə", "ɡ", "ɹ", "f", "i"])
        result = self.syl.syllabify(phonemes)

        # Only 3 nuclei present: oʊ, ə, i  → 3 syllables (one omitted)
        self.assertEqual(result["syllable_count"], 3)
        self.assertEqual(result["nuclei_detected"], ["oʊ", "ə", "i"])

    # ------------------------------------------------------------------
    # 6. Insertion detection — extra nucleus produces extra syllable
    # ------------------------------------------------------------------
    def test_insertion_detection(self) -> None:
        # "cat" is 1 syllable [k, æ, t], but speaker adds extra vowel
        phonemes = _quick_phonemes(["k", "æ", "t", "ə"])
        result = self.syl.syllabify(phonemes)

        self.assertEqual(result["syllable_count"], 2)
        self.assertEqual(result["nuclei_detected"], ["æ", "ə"])

    # ------------------------------------------------------------------
    # 7. Independent count — result never influenced by expected count
    # ------------------------------------------------------------------
    def test_independent_count(self) -> None:
        # The syllabifier has NO parameter for expected count.
        # Verify the API signature does not accept one.
        import inspect

        sig = inspect.signature(self.syl.syllabify)
        param_names = list(sig.parameters.keys())
        self.assertEqual(param_names, ["phonemes"],
                         "syllabify must accept ONLY 'phonemes'")

        # Also verify the result is purely observational
        phonemes = _quick_phonemes(["b", "æ", "t"])
        result = self.syl.syllabify(phonemes)
        self.assertEqual(result["syllable_count"], 1)

    # ------------------------------------------------------------------
    # 8. Quality — rateable with high confidence
    # ------------------------------------------------------------------
    def test_quality_rateable(self) -> None:
        phonemes = _quick_phonemes(["b", "æ", "t"], confidence=0.92)
        result = self.syl.syllabify(phonemes)

        self.assertTrue(result["is_rateable"])
        self.assertIsNone(result["quality_reason"])

    # ------------------------------------------------------------------
    # 9. Quality — low confidence → unrateable
    # ------------------------------------------------------------------
    def test_quality_low_confidence(self) -> None:
        phonemes = _quick_phonemes(["b", "æ", "t"], confidence=0.10)
        result = self.syl.syllabify(phonemes)

        self.assertFalse(result["is_rateable"])
        self.assertEqual(result["quality_reason"], "LOW_PHONEME_CONFIDENCE")

    # ------------------------------------------------------------------
    # 10. Quality — no speech (empty list)
    # ------------------------------------------------------------------
    def test_quality_no_speech(self) -> None:
        result = self.syl.syllabify([])

        self.assertFalse(result["is_rateable"])
        self.assertEqual(result["quality_reason"], "NO_SPEECH")
        self.assertEqual(result["syllable_count"], 0)

    # ------------------------------------------------------------------
    # 11. Quality — only consonants, no nuclei
    # ------------------------------------------------------------------
    def test_quality_no_nuclei(self) -> None:
        phonemes = _quick_phonemes(["b", "t", "k", "s"])
        result = self.syl.syllabify(phonemes)

        self.assertFalse(result["is_rateable"])
        self.assertEqual(result["quality_reason"], "NO_PHONEME_SEQUENCE")
        self.assertEqual(result["syllable_count"], 0)

    # ------------------------------------------------------------------
    # 12. Longest-match — [a, ɪ] adjacent are merged into diphthong [aɪ]
    # ------------------------------------------------------------------
    def test_longest_match_merge(self) -> None:
        # Provide "a" and "ɪ" as two separate phonemes; they should be
        # merged into a single diphthong "aɪ" → 1 nucleus, not 2.
        phonemes = _quick_phonemes(["f", "a", "ɪ", "n", "d"])
        result = self.syl.syllabify(phonemes)

        self.assertEqual(result["syllable_count"], 1)
        self.assertEqual(result["nuclei_detected"], ["aɪ"])


if __name__ == "__main__":
    unittest.main()
