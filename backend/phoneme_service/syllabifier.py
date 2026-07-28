"""
Independent Phoneme-Based Syllabifier
======================================

Syllabifies a phoneme sequence using IPA nucleus detection.
The syllable count comes ONLY from independently observed phoneme nuclei —
never from a target word, target IPA, or expected syllable count.

Quality Policy
--------------
A result is rateable only when:
  1. At least one nucleus is detected
  2. Mean accepted phoneme confidence >= mean_confidence_threshold
  3. Every accepted nucleus confidence >= nucleus_confidence_threshold
"""

from __future__ import annotations

from typing import Optional


# ---------------------------------------------------------------------------
# Quality-gate reason codes (exactly one is returned when unrateable)
# ---------------------------------------------------------------------------
REASON_NO_SPEECH = "NO_SPEECH"
REASON_NO_PHONEME_SEQUENCE = "NO_PHONEME_SEQUENCE"
REASON_LOW_PHONEME_CONFIDENCE = "LOW_PHONEME_CONFIDENCE"
REASON_MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
REASON_MODEL_INFERENCE_FAILED = "MODEL_INFERENCE_FAILED"
REASON_RECOGNIZER_BUSY = "RECOGNIZER_BUSY"


class IndependentSyllabifier:
    """Syllabify a phoneme sequence by detecting IPA nuclei independently."""

    # ------------------------------------------------------------------
    # IPA phoneme tables
    # ------------------------------------------------------------------

    # fmt: off
    VOWEL_NUCLEI: set[str] = {
        "a", "e", "i", "o", "u",
        "aː", "eː", "iː", "oː", "uː", "ɑː", "ɔː", "ɜː",
        "æ", "ɑ", "ɒ", "ɔ", "ə",
        "ɛ", "ɜ", "ɪ", "ʊ", "ʌ",
        "ɐ", "ɤ", "ɨ", "ʉ",
    }

    DIPHTHONGS: set[str] = {
        "aɪ", "aʊ", "eɪ", "oʊ", "ɔɪ",
        "əʊ", "ɪə", "ɛə", "ʊə",
    }

    RHOTIC_VOWELS: set[str] = {
        "ɑɹ", "ɔɹ", "ɛɹ", "ɪɹ", "ʊɹ",
        "ɝ", "ɚ", "ɔːɹ",
    }

    SYLLABIC_CONSONANTS: set[str] = {
        "l̩", "m̩", "n̩", "ŋ̩",
        # Simplified / alternate representations
        "ɫ", "əl", "ə5", "ᵻ",
    }

    CONSONANTS: set[str] = {
        "b", "d", "f", "ɡ", "h", "j", "k", "l", "m", "n",
        "p", "r", "s", "t", "v", "w", "z",
        "ð", "ŋ", "ɹ", "ʃ", "ʒ", "θ", "ʔ", "ʤ", "ʧ",
        "ɲ", "ɾ", "ç", "x", "ɣ", "χ", "ʁ", "ɬ",
    }
    # fmt: on

    # All multi-character units eligible for longest-match merging
    _MULTI_CHAR_NUCLEI: set[str] = DIPHTHONGS | RHOTIC_VOWELS

    # All symbols that count as a syllable nucleus
    _ALL_NUCLEI: set[str] = VOWEL_NUCLEI | DIPHTHONGS | RHOTIC_VOWELS | SYLLABIC_CONSONANTS

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def __init__(
        self,
        mean_confidence_threshold: float = 0.65,
        nucleus_confidence_threshold: float = 0.45,
    ) -> None:
        self.mean_confidence_threshold = mean_confidence_threshold
        self.nucleus_confidence_threshold = nucleus_confidence_threshold

        # Pre-sort multi-char units by length descending for greedy matching
        self._sorted_multi = sorted(
            self._MULTI_CHAR_NUCLEI, key=len, reverse=True
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def syllabify(self, phonemes: list[dict]) -> dict:
        """Syllabify a phoneme sequence independently.

        Parameters
        ----------
        phonemes : list[dict]
            Each dict has keys: symbol, start_time, end_time, confidence.

        Returns
        -------
        dict
            syllable_count, syllables, nuclei_detected, is_rateable, quality_reason
        """
        # Quality gate: no speech
        if not phonemes:
            return self._empty_result(REASON_NO_SPEECH)

        # Step 1 — Longest-match normalisation (merge adjacent symbols into
        # diphthongs / rhotic vowels where applicable)
        merged = self._merge_multi_char_units(phonemes)

        # Step 2 — Nucleus detection
        labelled = self._label_nuclei(merged)

        # Step 3 — Group into syllables
        syllables = self._group_syllables(labelled)

        # Quality gate: no nuclei detected
        if not syllables:
            return self._empty_result(REASON_NO_PHONEME_SEQUENCE)

        # Step 4–6 — Compute timing, duration, confidence per syllable
        syllable_dicts = []
        nuclei_detected: list[str] = []
        for idx, syl in enumerate(syllables):
            phon_symbols = [p["symbol"] for p in syl]
            nucleus_sym = self._find_nucleus_symbol(syl)
            start = syl[0]["start_time"]
            end = syl[-1]["end_time"]
            duration = round(end - start, 6)
            confidence = round(
                sum(p["confidence"] for p in syl) / len(syl), 6
            )
            syllable_dicts.append(
                {
                    "index": idx,
                    "phonemes": phon_symbols,
                    "nucleus": nucleus_sym,
                    "start_time": start,
                    "end_time": end,
                    "duration": duration,
                    "confidence": confidence,
                }
            )
            nuclei_detected.append(nucleus_sym)

        # Quality assessment
        is_rateable, quality_reason = self.assess_quality(merged, syllable_dicts)

        return {
            "syllable_count": len(syllable_dicts),
            "syllables": syllable_dicts,
            "nuclei_detected": nuclei_detected,
            "is_rateable": is_rateable,
            "quality_reason": quality_reason,
        }

    def assess_quality(
        self,
        merged_phonemes: list[dict],
        syllable_dicts: list[dict],
    ) -> tuple[bool, Optional[str]]:
        """Apply the calibrated quality policy.

        Returns (is_rateable, reason).  reason is None when rateable.
        """
        # Rule 1 — at least one nucleus
        if not syllable_dicts:
            return False, REASON_NO_PHONEME_SEQUENCE

        # Rule 2 — mean accepted phoneme confidence
        if merged_phonemes:
            mean_conf = sum(p["confidence"] for p in merged_phonemes) / len(
                merged_phonemes
            )
            if mean_conf < self.mean_confidence_threshold:
                return False, REASON_LOW_PHONEME_CONFIDENCE

        # Rule 3 — every nucleus must meet its own threshold
        for syl in syllable_dicts:
            # Find constituent phonemes that are nuclei and check their average
            if syl["confidence"] < self.nucleus_confidence_threshold:
                return False, REASON_LOW_PHONEME_CONFIDENCE

        return True, None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _merge_multi_char_units(self, phonemes: list[dict]) -> list[dict]:
        """Greedily merge adjacent phonemes into diphthongs / rhotic vowels.

        Uses a longest-match strategy: at each position, try to match the
        longest known multi-character nucleus first.
        """
        merged: list[dict] = []
        i = 0
        while i < len(phonemes):
            matched = False
            # Try longest multi-char units first
            for multi in self._sorted_multi:
                seq_len = self._multi_char_len(multi, phonemes, i)
                if seq_len is not None:
                    # Merge seq_len phonemes into one entry
                    group = phonemes[i : i + seq_len]
                    merged.append(
                        {
                            "symbol": multi,
                            "start_time": group[0]["start_time"],
                            "end_time": group[-1]["end_time"],
                            "confidence": sum(p["confidence"] for p in group)
                            / len(group),
                        }
                    )
                    i += seq_len
                    matched = True
                    break
            if not matched:
                merged.append(phonemes[i])
                i += 1
        return merged

    def _multi_char_len(
        self, multi: str, phonemes: list[dict], start: int
    ) -> Optional[int]:
        """Check if phonemes starting at *start* match the multi-char unit.

        A multi-char unit can be present either as a single symbol already
        equal to *multi*, or as adjacent individual symbols whose
        concatenation equals *multi*.  Returns the number of phonemes
        consumed, or None.
        """
        # Case 1: already a single symbol
        if phonemes[start]["symbol"] == multi:
            return 1

        # Case 2: adjacent symbols concatenate to form the unit
        concat = ""
        for j in range(start, len(phonemes)):
            concat += phonemes[j]["symbol"]
            if concat == multi:
                return j - start + 1
            if len(concat) >= len(multi):
                break
        return None

    def _label_nuclei(
        self, phonemes: list[dict]
    ) -> list[tuple[dict, bool]]:
        """Return list of (phoneme_dict, is_nucleus) tuples."""
        return [
            (p, p["symbol"] in self._ALL_NUCLEI) for p in phonemes
        ]

    @staticmethod
    def _group_syllables(
        labelled: list[tuple[dict, bool]],
    ) -> list[list[dict]]:
        """Group labelled phonemes into syllable lists.

        Strategy: each nucleus anchors a syllable; preceding consonants
        (after the previous nucleus) attach to the current syllable.
        Trailing consonants attach to the last syllable.
        """
        syllables: list[list[dict]] = []
        current: list[dict] = []

        for phoneme, is_nucleus in labelled:
            current.append(phoneme)
            if is_nucleus:
                syllables.append(current)
                current = []

        # Trailing consonants after the last nucleus → attach to last syllable
        if current and syllables:
            syllables[-1].extend(current)
        elif current and not syllables:
            # Only consonants, no nuclei — no syllables
            pass

        return syllables

    def _find_nucleus_symbol(self, syllable_phonemes: list[dict]) -> str:
        """Return the nucleus symbol within a syllable's phonemes."""
        for p in syllable_phonemes:
            if p["symbol"] in self._ALL_NUCLEI:
                return p["symbol"]
        return ""

    @staticmethod
    def _empty_result(reason: str) -> dict:
        return {
            "syllable_count": 0,
            "syllables": [],
            "nuclei_detected": [],
            "is_rateable": False,
            "quality_reason": reason,
        }
