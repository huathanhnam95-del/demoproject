"""Reference-constrained CTC alignment and acoustic stress features.

This module deliberately keeps two signals separate:

* the decoded phoneme sequence remains the independent syllable-count signal;
* a dictionary pronunciation is used only to locate the expected vowels in
  the acoustic stream for stress/pitch measurement.

That separation prevents a target word from manufacturing a passing syllable
count while still allowing a reliable native reference to guide measurements.
"""

from __future__ import annotations

import unicodedata
from typing import Any, Iterable, Sequence

import numpy as np

from backend.phoneme_service.backends import ctc_forward_log_likelihood, ctc_forced_align


SPECIAL_TOKENS = {"", "<pad>", "<s>", "</s>", "<unk>"}
VOWEL_MARKERS = set("aeiouɐɑɒɔəɚɛɜɝɞɟɪʊʌæœɨɵɶː")
MODEL_IGNORABLE_DIACRITICS = {"̬"}


def tokenize_ipa(ipa: str, symbol_table: Sequence[str]) -> list[int]:
    """Tokenize a canonical IPA string using longest vocabulary matches."""
    text = unicodedata.normalize("NFC", ipa or "").strip().strip("/[]()")
    text = text.replace("ˈ", "").replace("ˌ", "").replace(" ", "")
    for diacritic in MODEL_IGNORABLE_DIACRITICS:
        text = text.replace(diacritic, "")
    tokens = [
        (token, index)
        for index, token in enumerate(symbol_table)
        if token not in SPECIAL_TOKENS and not token.startswith("<")
    ]
    tokens.sort(key=lambda item: len(item[0]), reverse=True)
    ids: list[int] = []
    cursor = 0
    while cursor < len(text):
        match = next((item for item in tokens if text.startswith(item[0], cursor)), None)
        if match is None:
            raise ValueError(f"IPA character sequence is not in model vocabulary: {text[cursor:]!r}")
        ids.append(match[1])
        cursor += len(match[0])
    return ids


def align_reference_syllables(
    log_probs: np.ndarray,
    syllable_ipas: Iterable[str],
    symbol_table: Sequence[str],
    *,
    blank_id: int = 0,
    sample_count: int | None = None,
    sample_rate: int | None = None,
) -> dict[str, Any]:
    """Align expected syllable IPA and return frame spans per syllable."""
    syllables = list(syllable_ipas)
    token_ids: list[int] = []
    ranges: list[tuple[int, int]] = []
    for ipa in syllables:
        start = len(token_ids)
        token_ids.extend(tokenize_ipa(ipa, symbol_table))
        ranges.append((start, len(token_ids)))

    alignment = ctc_forced_align(log_probs, token_ids, blank_id=blank_id)
    if not alignment.get("aligned"):
        return {"aligned": False, "syllables": [], "alignment": alignment}

    token_spans = alignment["spans"]
    syllable_spans = []
    for index, (start, end) in enumerate(ranges):
        selected = token_spans[start:end]
        if not selected:
            return {"aligned": False, "syllables": [], "alignment": alignment}
        nucleus = [
            item for item in selected
            if any(char in VOWEL_MARKERS for char in symbol_table[item["target_id"]])
        ] or selected
        syllable_spans.append(
            {
                "index": index,
                "ipa": syllables[index],
                "start_frame": min(item["start_frame"] for item in selected),
                "end_frame": max(item["end_frame"] for item in selected),
                "confidence": float(np.mean([item["confidence"] for item in selected])),
                "nucleus_start_frame": min(item["start_frame"] for item in nucleus),
                "nucleus_end_frame": max(item["end_frame"] for item in nucleus),
                "nucleus_confidence": float(np.mean([item["confidence"] for item in nucleus])),
            }
        )
        if sample_count and sample_rate:
            frame_count = max(1, int(np.asarray(log_probs).shape[0]))
            for span in (syllable_spans[-1],):
                span["start_time"] = round(span["start_frame"] / frame_count * sample_count / sample_rate, 6)
                span["end_time"] = round(span["end_frame"] / frame_count * sample_count / sample_rate, 6)
                span["nucleus_start_time"] = round(span["nucleus_start_frame"] / frame_count * sample_count / sample_rate, 6)
                span["nucleus_end_time"] = round(span["nucleus_end_frame"] / frame_count * sample_count / sample_rate, 6)
    return {
        "aligned": True,
        "syllables": syllable_spans,
        "alignment": alignment,
    }


def ctc_hypothesis_features(
    log_probs: np.ndarray,
    canonical_ids: list[int],
    *,
    blank_id: int,
    omission_ids: list[int] | None = None,
    insertion_ids: list[int] | None = None,
    omission_candidates: list[list[int]] | None = None,
    insertion_candidates: list[list[int]] | None = None,
) -> dict[str, float | int | None]:
    """Compare complete, length-normalized CTC hypotheses."""
    omission_candidates = omission_candidates or ([omission_ids] if omission_ids is not None else [])
    insertion_candidates = insertion_candidates or ([insertion_ids] if insertion_ids is not None else [])

    def score(ids: list[int]) -> float:
        return float(ctc_forward_log_likelihood(log_probs, ids, blank_id=blank_id)["normalized_log_likelihood"])

    canonical = score(canonical_ids)
    omission_scored = [(score(ids), ids) for ids in omission_candidates]
    insertion_scored = [(score(ids), ids) for ids in insertion_candidates]
    best_omission = max(omission_scored, key=lambda item: item[0]) if omission_scored else None
    best_insertion = max(insertion_scored, key=lambda item: item[0]) if insertion_scored else None
    return {
        "canonical_log_likelihood": canonical,
        "canonical_minus_omission": canonical - best_omission[0] if best_omission else None,
        "canonical_minus_insertion": canonical - best_insertion[0] if best_insertion else None,
        "canonical_length": len(canonical_ids),
        "omission_length": len(best_omission[1]) if best_omission else None,
        "insertion_length": len(best_insertion[1]) if best_insertion else None,
        "omission_candidate_count": len(omission_candidates),
        "insertion_candidate_count": len(insertion_candidates),
    }


def extract_acoustic_features(
    samples: np.ndarray,
    sample_rate: int,
    syllable_spans: Iterable[dict[str, Any]],
    *,
    frame_count: int | None = None,
) -> list[dict[str, Any]]:
    """Measure duration, RMS, and robust F0 statistics inside each span."""
    values = np.asarray(samples, dtype=float)
    syllable_spans = list(syllable_spans)
    if values.ndim > 1:
        values = values.mean(axis=1)
    features: list[dict[str, Any]] = []
    pitch = None
    try:
        import parselmouth

        sound = parselmouth.Sound(values, sampling_frequency=sample_rate)
        pitch = sound.to_pitch_ac(
            time_step=0.01,
            pitch_floor=75,
            max_number_of_candidates=15,
            pitch_ceiling=500,
        )
    except Exception:
        pitch = None

    frame_count = frame_count or max((int(span.get("end_frame", 0)) for span in syllable_spans), default=1)
    for span in syllable_spans:
        start_frame = span.get("nucleus_start_frame", span["start_frame"])
        end_frame = span.get("nucleus_end_frame", span["end_frame"])
        start = max(0, int(round(start_frame / frame_count * len(values))))
        end = min(len(values), int(round(end_frame / frame_count * len(values))))
        segment = values[start:end]
        if len(segment) == 0:
            rms = 0.0
        else:
            rms = float(np.sqrt(np.mean(np.square(segment))))
        f0_values: list[float] = []
        if pitch is not None:
            # Pitch needs a longer analysis window than the vowel nucleus
            # itself; retain vowel-local energy/duration but sample F0 over
            # the complete syllable span.
            pitch_start = max(0, int(round(span["start_frame"] / frame_count * len(values))))
            pitch_end = min(len(values), int(round(span["end_frame"] / frame_count * len(values))))
            start_time = pitch_start / sample_rate
            end_time = pitch_end / sample_rate
            times = np.arange(start_time, end_time, 0.01)
            if len(times):
                raw = np.asarray([pitch.get_value_at_time(float(time)) for time in times], dtype=float)
                f0_values = [float(item) for item in raw if np.isfinite(item) and item > 0]
        features.append(
            {
                **span,
                "duration_sec": round(max(0.0, (end - start) / sample_rate), 6),
                "rms": round(rms, 8),
                "f0_median": round(float(np.median(f0_values)), 4) if f0_values else None,
                "f0_range": round(float(np.ptp(f0_values)), 4) if f0_values else None,
                "f0_samples": len(f0_values),
            }
        )
    return features
