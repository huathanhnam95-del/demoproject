"""Canonical pitch processing for pronunciation reference audio.

Raw Praat measurements are never mutated.  A separate canonical track removes
high harmonic locks conservatively, and unresolved extreme runs are nulled so
they cannot influence lexical-stress scoring.
"""

from __future__ import annotations

import math
from statistics import median
from typing import Any, Iterable


PITCH_PROCESSING_VERSION = "canonical-pitch-v1"
_EXTREME_HZ = 400.0
_OCTAVE_TOLERANCE_ST = 4.0


def _finite_pitch(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value)) and float(value) > 0


def _voiced_runs(values: list[Any]) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
    previous: float | None = None
    for index, value in enumerate(values + [None]):
        current = float(value) if _finite_pitch(value) else None
        has_octave_jump = bool(
            start is not None
            and previous is not None
            and current is not None
            and _semitone_distance(previous, current) >= 8.0
        )
        if has_octave_jump:
            runs.append((start, index))
            start = index
        if _finite_pitch(value) and start is None:
            start = index
        elif not _finite_pitch(value) and start is not None:
            runs.append((start, index))
            start = None
        previous = current
    return runs


def _semitone_distance(left: float, right: float) -> float:
    return abs(12.0 * math.log2(left / right))


def canonicalize_pitch_track(times: Iterable[Any], raw_values: Iterable[Any]) -> dict[str, Any]:
    """Return raw and independently corrected pitch series plus diagnostics."""
    times_list = list(times or [])
    raw = list(raw_values or [])
    if len(times_list) != len(raw):
        raise ValueError("Pitch times and values must have equal lengths")

    values = list(raw)
    runs = _voiced_runs(raw)
    run_medians = [
        float(median(float(raw[index]) for index in range(start, end) if _finite_pitch(raw[index])))
        for start, end in runs
    ]
    normal_medians = [value for value in run_medians if value < _EXTREME_HZ]
    anchor = float(median(normal_medians)) if normal_medians else None
    corrected_runs = 0
    unresolved_runs = 0
    corrections: list[dict[str, Any]] = []

    for run_index, ((start, end), run_median) in enumerate(zip(runs, run_medians)):
        if run_median < _EXTREME_HZ or anchor is None:
            continue
        folded = run_median / 2.0
        distance = _semitone_distance(folded, anchor)
        if distance <= _OCTAVE_TOLERANCE_ST:
            for index in range(start, end):
                values[index] = round(float(raw[index]) / 2.0, 1)
            corrected_runs += 1
            corrections.append({
                "runIndex": run_index,
                "startIndex": start,
                "endIndex": end,
                "operation": "divide-by-two",
                "rawMedianHz": round(run_median, 1),
                "canonicalMedianHz": round(folded, 1),
                "anchorDistanceSemitones": round(distance, 3),
            })
        else:
            for index in range(start, end):
                values[index] = None
            unresolved_runs += 1

    reasons = ["UNRESOLVED_HARMONIC_RUN"] if unresolved_runs else []
    status = "unrateable" if unresolved_runs else ("corrected" if corrected_runs else "clean")
    confidence = 0.0 if unresolved_runs else (
        round(max(0.0, 1.0 - max((item["anchorDistanceSemitones"] for item in corrections), default=0.0) / (_OCTAVE_TOLERANCE_ST * 4.0)), 3)
        if corrected_runs else 1.0
    )
    return {
        "version": PITCH_PROCESSING_VERSION,
        "status": status,
        "confidence": confidence,
        "rawValues": raw,
        "values": values,
        "correctedRunCount": corrected_runs,
        "unresolvedRunCount": unresolved_runs,
        "reasons": reasons,
        "corrections": corrections,
    }


def apply_canonical_pitch_to_syllables(
    syllables: Iterable[dict[str, Any]],
    times: Iterable[Any],
    values: Iterable[Any],
) -> list[dict[str, Any]]:
    """Recompute syllable pitch features from the canonical track."""
    time_values = list(times or [])
    pitch_values = list(values or [])
    if len(time_values) != len(pitch_values):
        raise ValueError("Pitch times and values must have equal lengths")

    result: list[dict[str, Any]] = []
    for syllable in syllables or []:
        updated = dict(syllable)
        start = float(updated.get("startTime", 0) or 0)
        end = float(updated.get("endTime", start) or start)
        region = [
            float(value)
            for time, value in zip(time_values, pitch_values)
            if isinstance(time, (int, float)) and start <= float(time) <= end and _finite_pitch(value)
        ]
        updated["maxPitch"] = round(max(region), 1) if region else 0
        updated["avgPitch"] = round(sum(region) / len(region), 1) if region else 0
        result.append(updated)
    return result
