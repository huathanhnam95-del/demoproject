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
import math
from typing import Any, Iterable, Sequence

import numpy as np

from backend.phoneme_service.backends import ctc_forward_log_likelihood, ctc_forced_align


SPECIAL_TOKENS = {"", "<pad>", "<s>", "</s>", "<unk>"}
SPAN_CONTRACT_VERSION = "ctc-alignment-v2"
FRAME_INTERVAL = "half-open"
SYLLABLE_SPAN_TYPE = "ctc-token-coverage"
NUCLEUS_SPAN_TYPE = "ctc-vowel-token-coverage"
MEASUREMENT_SPAN_TYPE = "ctc-blank-midpoint-v1"
PARTITION_SPAN_TYPE = "ctc-interspan-midpoint-contiguous-v1"
VOWEL_MARKERS = set("aeiouɐɑɒɔəɚɛɜɝɞɟɪʊʌæœɨɵɶː")
MODEL_IGNORABLE_DIACRITICS = {"̬"}


def _classifier_symbol(value: str) -> str:
    """Normalize the only accepted IPA classifier equivalence (g/ɡ)."""
    return unicodedata.normalize("NFC", value).replace("ɡ", "g")


def derive_contiguous_partition_spans(
    syllable_spans: list[dict],
    *,
    frame_count: int | None = None,
) -> list[dict]:
    """Add a contiguous phonological partition without changing CTC coverage.

    Raw CTC spans deliberately leave blank-state gaps (and can occasionally
    overlap after normalization).  A user-facing syllable timeline instead
    needs one shared boundary between every adjacent pair.  The midpoint of
    the two raw token edges is used, constrained to fall between the adjacent
    vowel-nucleus centres.  Outer edges remain the first/last raw CTC edges.
    """
    partitioned = [{**span} for span in syllable_spans]
    if not partitioned:
        return partitioned

    frame_limit = max(0, int(frame_count)) if frame_count is not None else None

    def clamp_frame(value: float) -> int:
        rounded = int(math.floor(float(value) + 0.5))
        if frame_limit is None:
            return max(0, rounded)
        return min(frame_limit, max(0, rounded))

    outer_start = clamp_frame(partitioned[0]["start_frame"])
    outer_end = clamp_frame(partitioned[-1]["end_frame"])
    boundaries = [outer_start]

    for index in range(len(partitioned) - 1):
        current = partitioned[index]
        following = partitioned[index + 1]
        raw_midpoint = (
            float(current["end_frame"]) + float(following["start_frame"])
        ) / 2.0
        current_nucleus_centre = (
            float(current.get("nucleus_start_frame", current["start_frame"]))
            + float(current.get("nucleus_end_frame", current["end_frame"]))
        ) / 2.0
        following_nucleus_centre = (
            float(following.get("nucleus_start_frame", following["start_frame"]))
            + float(following.get("nucleus_end_frame", following["end_frame"]))
        ) / 2.0
        lower = min(current_nucleus_centre, following_nucleus_centre)
        upper = max(current_nucleus_centre, following_nucleus_centre)
        candidate = clamp_frame(min(upper, max(lower, raw_midpoint)))

        # Reserve at least one frame for every remaining partition whenever
        # the aligned outer interval is wide enough to do so.
        minimum = boundaries[-1] + 1
        remaining = len(partitioned) - index - 1
        maximum = outer_end - remaining
        if maximum >= minimum:
            candidate = min(maximum, max(minimum, candidate))
        else:
            candidate = max(boundaries[-1], min(outer_end, candidate))
        boundaries.append(candidate)

    boundaries.append(outer_end)
    for index, span in enumerate(partitioned):
        span["partition_start_frame"] = boundaries[index]
        span["partition_end_frame"] = boundaries[index + 1]
    return partitioned


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
        match = next(
            (
                item
                for item in tokens
                if text.startswith(item[0], cursor)
                or _classifier_symbol(text[cursor:cursor + len(item[0])]) == _classifier_symbol(item[0])
            ),
            None,
        )
        if match is None:
            raise ValueError(f"IPA character sequence is not in model vocabulary: {text[cursor:]!r}")
        ids.append(match[1])
        cursor += len(match[0])
    return ids


def _derive_measurement_spans(syllable_spans: list[dict]) -> list[dict]:
    """Derive acoustic measurement spans from raw CTC coverage.

    CTC Viterbi alignment assigns each frame to either a target-token state or
    the blank state.  Token spans only cover the target-state frames, so blank
    frames between the last token of one syllable and the first token of the
    next are unassigned — truncating vowels that acoustically extend into those
    blanks.  This is most noticeable on stressed syllables whose longer vowels
    produce more unassigned blank frames.

    For each inter-syllable gap the blank frames are split at the midpoint.
    Only a vowel nucleus that touches the relevant raw syllable edge receives
    its half of the gap. The returned dictionaries retain every raw field and
    add ``measurement_start_frame``/``measurement_end_frame``.
    """
    measured = []
    for span in syllable_spans:
        nucleus_start = span.get("nucleus_start_frame", span["start_frame"])
        nucleus_end = span.get("nucleus_end_frame", span["end_frame"])
        measured.append({
            **span,
            "measurement_start_frame": nucleus_start,
            "measurement_end_frame": nucleus_end,
        })

    if len(syllable_spans) < 2:
        return measured

    for i in range(len(syllable_spans) - 1):
        cur = syllable_spans[i]
        nxt = syllable_spans[i + 1]
        gap_start = cur["end_frame"]
        gap_end = nxt["start_frame"]
        if gap_end <= gap_start:
            continue
        mid = (gap_start + gap_end + 1) // 2
        nucleus_at_trailing_edge = (
            cur.get("nucleus_end_frame", cur["end_frame"]) == gap_start
        )
        nucleus_at_leading_edge = (
            nxt.get("nucleus_start_frame", nxt["start_frame"]) == gap_end
        )
        if nucleus_at_trailing_edge:
            measured[i]["measurement_end_frame"] = mid
        if nucleus_at_leading_edge:
            measured[i + 1]["measurement_start_frame"] = mid
    return measured


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

    syllable_spans = _derive_measurement_spans(syllable_spans)
    alignment_frame_count = max(1, int(np.asarray(log_probs).shape[0]))
    syllable_spans = derive_contiguous_partition_spans(
        syllable_spans,
        frame_count=alignment_frame_count,
    )

    if sample_count and sample_rate:
        frame_count = alignment_frame_count
        for span in syllable_spans:
            span["start_time"] = round(span["start_frame"] / frame_count * sample_count / sample_rate, 6)
            span["end_time"] = round(span["end_frame"] / frame_count * sample_count / sample_rate, 6)
            span["nucleus_start_time"] = round(span["nucleus_start_frame"] / frame_count * sample_count / sample_rate, 6)
            span["nucleus_end_time"] = round(span["nucleus_end_frame"] / frame_count * sample_count / sample_rate, 6)
            span["measurement_start_time"] = round(span["measurement_start_frame"] / frame_count * sample_count / sample_rate, 6)
            span["measurement_end_time"] = round(span["measurement_end_frame"] / frame_count * sample_count / sample_rate, 6)
            span["partition_start_time"] = round(span["partition_start_frame"] / frame_count * sample_count / sample_rate, 6)
            span["partition_end_time"] = round(span["partition_end_frame"] / frame_count * sample_count / sample_rate, 6)
    return {
        "aligned": True,
        "syllables": syllable_spans,
        "span_contract_version": SPAN_CONTRACT_VERSION,
        "frame_interval": FRAME_INTERVAL,
        "syllable_span_type": SYLLABLE_SPAN_TYPE,
        "nucleus_span_type": NUCLEUS_SPAN_TYPE,
        "measurement_span_type": MEASUREMENT_SPAN_TYPE,
        "partition_span_type": PARTITION_SPAN_TYPE,
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
        start_frame = span.get(
            "measurement_start_frame",
            span.get("nucleus_start_frame", span["start_frame"]),
        )
        end_frame = span.get(
            "measurement_end_frame",
            span.get("nucleus_end_frame", span["end_frame"]),
        )
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
