#!/usr/bin/env python3
"""Offline reanalysis for the segmentation-study-v2 corpus.

This module is deliberately independent of the learner-facing pronunciation
service.  It provides a small, deterministic experiment runner that can be
used with the historical local samples as well as exports from the CRM study.

The public functions are kept dependency-light so they can also be used by
unit tests and by a later notebook/reporting command.  NumPy is used for the
STFT/Mel feature extraction; the standard library handles WAV and report I/O.

Typical usage::

    python scripts/audit/segmentation_spectrogram_reanalysis.py \
        --samples-dir test-results/pronounce-local-samples \
        --manifest scripts/data/segmentation-study-v2.json \
        --output-dir test-results/segmentation-study-v2

The command exits successfully even when the gate report is ``fail``.  A
failed gate is an experiment result, not a process error, and the candidate
must remain offline until a later rollout decision.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import wave
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np


STUDY_ID = "segmentation-study-v2"
MANIFEST_VERSION = "2.0.0"
CANONICAL_EXPORT_SCHEMA_VERSION = "segmentation-study-export-v2"
STUDY_COHORT = "segmentation-study-v2"
FROZEN_REFERENCE_PROVENANCE = "explicit-reviewed-en-US-v1"
VARIANT_SCHEMA_VERSIONS = {
    "v2": "pronunciation-comparison-v2",
    "v3": "pronunciation-partition-variants-v2",
    "v4": "pronunciation-partition-variants-v2",
}
DEFAULT_SEED = 20260813
DEFAULT_BOOTSTRAP_RESAMPLES = 10_000
DEFAULT_FRAME_MS = 25.0
DEFAULT_HOP_MS = 5.0
DEFAULT_N_FFT = 512
DEFAULT_N_MELS = 40
DEFAULT_FMAX_HZ = 8_000.0
DEFAULT_SEARCH_MS = 80.0
DEFAULT_TARGET_SAMPLE_RATE = 16_000

# The v2 reference labels are an auditable, frozen contract.  These entries
# correct the deterministic splitter's onset/coda choices without changing
# the source IPA variant or the 100-word cohort.  Keep this table explicit so
# a future manifest rebuild cannot silently reintroduce v1 labels.
FROZEN_REFERENCE_SYLLABLES: dict[str, tuple[str, ...]] = {
    "abroad": ("ə", "ˈbrɔd"),
    "acquire": ("ə", "ˈkwaɪɝ"),
    "accomplish": ("ə", "ˈkɑm", "plɪʃ"),
    "adjustment": ("ə", "ˈdʒəst", "mənt"),
    "agreement": ("ə", "ˈɡri", "mənt"),
    "accomplishment": ("ə", "ˈkɑm", "plɪʃ", "mənt"),
    "agriculture": ("ˈæɡ", "rɪ", "ˌkəl", "tʃɝ"),
    "analogy": ("ə", "ˈnæ", "lə", "dʒi"),
    "appreciate": ("ə", "ˈpri", "ʃi", "ˌeɪt"),
    "biology": ("baɪ", "ˈɑ", "lə", "dʒi"),
    "congressional": ("kən", "ˈɡrɛ", "ʃə", "nəl"),
    "democratic": ("ˌdɛ", "mə", "ˈkræ", "tɪk"),
    "original": ("ɝ", "ˈɪ", "dʒə", "nəl"),
    "originate": ("ɝ", "ˈɪ", "dʒə", "ˌneɪt"),
    "administration": ("æd", "ˌmɪ", "nɪ", "ˈstreɪ", "ʃən"),
    "administrative": ("əd", "ˈmɪ", "nə", "ˌstreɪ", "tɪv"),
    "administrator": ("əd", "ˈmɪ", "nə", "ˌstreɪ", "tɝ"),
    "appreciation": ("ə", "ˌpri", "ʃi", "ˈeɪ", "ʃən"),
    "approximately": ("ə", "ˈprɑk", "sə", "mət", "li"),
    "experimental": ("ɪk", "ˌspɛ", "rɪ", "ˈmɛn", "təl"),
    "ideology": ("ˌaɪ", "di", "ˈɑ", "lə", "dʒi"),
    "imaginary": ("ˌɪ", "ˈmæ", "dʒə", "ˌnɛ", "ri"),
    "technological": ("ˌtɛk", "nə", "ˈlɑ", "dʒɪ", "kəl"),
}

# These words keep the selected source variant but require a reasoned note
# because stress placement, reduced vowels, /g/, or adjacent nuclei can make
# automated syllable splitting look plausible while remaining ambiguous.
FROZEN_REFERENCE_RATIONALES: dict[str, str] = {
    "accurate": "Retained /ˈækjɝət/ as two en-US syllables; rhotic /ɝ/ is not split into a separate hiatus nucleus.",
    "accuracy": "Retained /ˈækjɝəsi/ as three en-US syllables; the rhotic /ɝə/ sequence is one nucleus before final /si/.",
    "deteriorate": "Retained /dɪˈtɪriɝˌeɪt/ as four en-US syllables; the rhotic /iɝ/ sequence is not promoted to a separate hiatus syllable.",
    "immediately": "Retained /ˌɪˈmiˌdiətli/ as four en-US syllables; reduced /iə/ remains one nucleus rather than an extra hiatus syllable.",
    "accuse": "Retained /əkˈjuz/ en-US variant; /j/ belongs to the stressed /ju/ onset rather than the first syllable.",
    "accused": "Retained /əkˈjuzd/ en-US variant; /j/ belongs to the stressed /ju/ onset and final /d/ stays coda material.",
    "agriculture": "Corrected v1 /ɡr/ onset and /tʃ/ affricate boundary; frozen en-US final /tʃɝ/ is one syllable.",
    "biography": "Retained /baɪˈɑɡrəfi/ en-US variant; the unstressed /rə/ nucleus is separate from /ˈɑɡ/.",
    "characteristic": "Retained /ˌkɛrəktɝˈɪstɪk/ en-US variant; rhotic /ɝ/ and final /ɪstɪk/ boundaries are explicit.",
    "communicate": "Retained /kəmˈjunəˌkeɪt/ en-US variant; /ju/ is the stressed second syllable and /keɪt/ is final.",
    "communication": "Retained /kəmˌjunəˈkeɪʃən/ en-US variant; stress and the final /ʃən/ syllable are preserved.",
    "declaration": "Retained /ˌdɛklɝˈeɪʃən/ en-US variant; /lɝ/ and /ˈeɪ/ are separate nuclei across the rhotic sequence.",
    "diplomatic": "Retained /ˌdɪpləˈmætɪk/ en-US variant; /pl/ is onset/coda context and /ˈmæ/ remains the stressed third syllable.",
    "inevitably": "Retained /ˌɪˈnɛvətəbli/ en-US variant; reduced /ə/ nuclei and final /bli/ remain distinct syllables.",
    "constitutional": "Retained /ˌkɑnstəˈtuʃənəl/ with /ns|t/; the legal coda/onset exception avoids maximal /n|st/ while preserving five syllables.",
}

_VOWELS = frozenset(
    "iɪeɛæaɑɒɔoʊuʌəɝɚɜɞɐɨɵyøœɯɤɶʉ"
)
_STRESS = frozenset("ˈˌ")
_COMBINING_MARKS = frozenset(
    "ːˑ̩̯̣̥̤̞̝̟̠̪̺̻̹̜̘̙̝̩̃̈́̀̌̆̇"
)
_FRICATIVES = frozenset("f v θ ð s z ʃ ʒ ʂ ʐ ç x ɣ h ħ ɦ".split())
_STOPS = frozenset("p b t d k ɡ g q ʔ".split())
_NASALS = frozenset("m n ŋ ɲ ɳ ɴ".split())
_LIQUIDS_GLIDES = frozenset("l ɫ r ɹ ɻ ɾ ɽ j w ɥ".split())
_AFFRICATES = frozenset(("tʃ", "dʒ", "ts", "dz", "tɕ", "dʑ"))


FEATURE_CONFIG: dict[str, float | int] = {
    "frameMs": DEFAULT_FRAME_MS,
    "hopMs": DEFAULT_HOP_MS,
    "nFft": DEFAULT_N_FFT,
    "nMels": DEFAULT_N_MELS,
    "fmaxHz": DEFAULT_FMAX_HZ,
    "targetSampleRate": DEFAULT_TARGET_SAMPLE_RATE,
    "searchMs": DEFAULT_SEARCH_MS,
    "prominence": 0.55,
    "agreementMargin": 0.18,
    "agreementWindowMs": 30.0,
}

# This small, pre-registered grid is the only parameter search performed by
# the experiment.  It deliberately varies cue confidence/agreement rather
# than inventing a threshold after inspecting holdout labels.
CONTEXT_PARAMETER_GRID: tuple[dict[str, float | int], ...] = tuple(
    {
        "prominence": prominence,
        "agreementMargin": agreement_margin,
        "agreementWindowMs": agreement_window,
    }
    for prominence in (0.45, 0.55, 0.65)
    for agreement_margin in (0.12, 0.18, 0.25)
    for agreement_window in (20.0, 30.0)
)

# These are the six paired recordings reproduced in the accuracy note. They
# are a named regression set, never a tuning set. The loader remains generic
# so CRM exports can contain additional samples, but the CLI's historical
# replay uses this allowlist when it is available.
HISTORICAL_REGRESSION_IDS = frozenset(
    {
        "photograph-manual-review-20260809091453535-7b4913e7",
        "photograph-manual-review-20260811005358817-73add71e",
        "photograph-manual-review-20260811010309837-04dc4b2f",
        "photograph-manual-review-20260811013133753-ea8c7b3d",
        "photograph-manual-review-20260811043541473-18dec116",
        "recording-manual-review-20260812104521996-9b669377",
    }
)
# The source WAVs are not present in either checkout, so the six authoritative
# SHA-256 values are intentionally unavailable.  Keep an explicit registry so
# arbitrary hashes attached to matching IDs can never unlock promotion.
HISTORICAL_REGRESSION_EXPECTED_HASHES: dict[str, str | None] = {
    sample_id: None for sample_id in HISTORICAL_REGRESSION_IDS
}


def _json_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return hashlib.sha256(payload).hexdigest()


def _as_float(value: Any, default: float | None = None) -> float | None:
    try:
        if value is None:
            return default
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def _time(span: Mapping[str, Any], start: bool) -> float:
    keys = ("startTime", "start_time", "start") if start else ("endTime", "end_time", "end")
    for key in keys:
        value = _as_float(span.get(key))
        if value is not None:
            return value
    raise ValueError(f"Span is missing {'start' if start else 'end'} time: {span!r}")


def _segment(start: float, end: float, index: int | None = None) -> dict[str, float | int]:
    item: dict[str, float | int] = {"startTime": float(start), "endTime": float(end)}
    if index is not None:
        item["index"] = int(index)
    return item


def normalize_segments(value: Any) -> list[dict[str, float | int]]:
    """Normalize a segment list while retaining ordering and numeric times."""

    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return []
    result: list[dict[str, float | int]] = []
    for index, item in enumerate(value):
        if isinstance(item, Mapping):
            start = _as_float(item.get("startTime", item.get("start_time", item.get("start"))))
            end = _as_float(item.get("endTime", item.get("end_time", item.get("end"))))
        elif isinstance(item, Sequence) and len(item) >= 2:
            start, end = _as_float(item[0]), _as_float(item[1])
        else:
            continue
        if start is None or end is None or end < start:
            continue
        result.append(_segment(start, end, index))
    return result


def contiguous_boundaries(segments: Sequence[Mapping[str, Any]]) -> list[float]:
    """Convert spans to one boundary per edge, midpoint-normalizing gaps."""

    normalized = normalize_segments(segments)
    if not normalized:
        return []
    boundaries = [_time(normalized[0], True)]
    for left, right in zip(normalized, normalized[1:]):
        boundaries.append((_time(left, False) + _time(right, True)) / 2.0)
    boundaries.append(_time(normalized[-1], False))
    return boundaries


def boundary_errors(
    actual: Sequence[float], expected: Sequence[float], *, internal_only: bool = True
) -> list[float]:
    """Return signed errors in seconds (actual minus expected)."""

    if len(actual) != len(expected):
        raise ValueError(f"Cannot compare {len(actual)} boundaries with {len(expected)}")
    indexes = range(1, len(actual) - 1) if internal_only else range(len(actual))
    return [float(actual[index]) - float(expected[index]) for index in indexes]


def _percentile(values: Sequence[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(float(value) for value in values)
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(len(ordered) - 1, lower + 1)
    return ordered[lower] + ((ordered[upper] - ordered[lower]) * (position - lower))


def summarize_errors(errors_seconds: Iterable[float]) -> dict[str, float | int]:
    """Summarize absolute and signed-independent timing errors in milliseconds."""

    errors = [abs(float(value)) for value in errors_seconds if math.isfinite(float(value))]
    if not errors:
        return {
            "edgeCount": 0,
            "maeMs": 0.0,
            "medianMs": 0.0,
            "p90Ms": 0.0,
            "maxMs": 0.0,
            "within20Pct": 0.0,
            "within30Pct": 0.0,
            "within40Pct": 0.0,
            "within80Pct": 0.0,
        }
    return {
        "edgeCount": len(errors),
        "maeMs": round(sum(errors) * 1000.0 / len(errors), 3),
        "medianMs": round(_percentile(errors, 0.5) * 1000.0, 3),
        "p90Ms": round(_percentile(errors, 0.9) * 1000.0, 3),
        "maxMs": round(max(errors) * 1000.0, 3),
        "within20Pct": round(100.0 * sum(value <= 0.020000001 for value in errors) / len(errors), 1),
        "within30Pct": round(100.0 * sum(value <= 0.030000001 for value in errors) / len(errors), 1),
        "within40Pct": round(100.0 * sum(value <= 0.040000001 for value in errors) / len(errors), 1),
        "within80Pct": round(100.0 * sum(value <= 0.080000001 for value in errors) / len(errors), 1),
    }


def read_wav(path: str | Path) -> tuple[np.ndarray, int]:
    """Read a PCM WAV as mono float32 samples and return ``(samples, rate)``."""

    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frame_count = wav.getnframes()
        raw = wav.readframes(frame_count)
    if width == 1:
        values = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 2:
        values = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 3:
        packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        signed = (
            packed[:, 0].astype(np.int32)
            | (packed[:, 1].astype(np.int32) << 8)
            | (packed[:, 2].astype(np.int32) << 16)
        )
        signed = np.where((signed & 0x800000) != 0, signed - 0x1000000, signed)
        values = signed.astype(np.float32) / 8388608.0
    elif width == 4:
        values = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported PCM sample width: {width} bytes")
    if channels > 1:
        values = values.reshape(-1, channels).mean(axis=1)
    return np.clip(values.astype(np.float32), -1.0, 1.0), int(sample_rate)


def _hz_to_mel(frequency: np.ndarray | float) -> np.ndarray | float:
    return 2595.0 * np.log10(1.0 + np.asarray(frequency) / 700.0)


def _mel_to_hz(mel: np.ndarray | float) -> np.ndarray | float:
    return 700.0 * (10.0 ** (np.asarray(mel) / 2595.0) - 1.0)


def _mel_filterbank(sample_rate: int, n_fft: int, n_mels: int, fmax: float) -> np.ndarray:
    maximum = min(float(fmax), sample_rate / 2.0)
    mel_points = np.linspace(float(_hz_to_mel(0.0)), float(_hz_to_mel(maximum)), n_mels + 2)
    hz_points = np.asarray(_mel_to_hz(mel_points))
    bins = np.floor((n_fft + 1) * hz_points / sample_rate).astype(int)
    filters = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float64)
    for index in range(n_mels):
        left, centre, right = bins[index : index + 3]
        centre = max(centre, left + 1)
        right = max(right, centre + 1)
        left = max(0, min(left, filters.shape[1] - 1))
        centre = max(0, min(centre, filters.shape[1] - 1))
        right = max(centre + 1, min(right, filters.shape[1]))
        if centre > left:
            filters[index, left:centre] = np.linspace(0.0, 1.0, centre - left, endpoint=False)
        if right > centre:
            filters[index, centre:right] = np.linspace(1.0, 0.0, right - centre, endpoint=False)
    return filters


def extract_spectrogram_features(
    samples: np.ndarray,
    sample_rate: int,
    config: Mapping[str, float | int] | None = None,
) -> dict[str, Any]:
    """Extract deterministic STFT, log-Mel and boundary-cue series."""

    options = dict(FEATURE_CONFIG)
    if config:
        options.update(config)
    target_rate = int(options.get("targetSampleRate", DEFAULT_TARGET_SAMPLE_RATE))
    mono = np.asarray(samples, dtype=np.float64).reshape(-1)
    if mono.size == 0:
        mono = np.zeros(1, dtype=np.float64)
    if int(sample_rate) != target_rate:
        # Linear interpolation is deliberately used instead of a runtime
        # backend.  It is deterministic, keeps the recording duration, and
        # makes the registered 512-point FFT correspond to 25 ms at 16 kHz.
        old_times = np.arange(mono.size, dtype=np.float64) / float(sample_rate)
        target_size = max(1, int(round(mono.size * target_rate / float(sample_rate))))
        new_times = np.arange(target_size, dtype=np.float64) / target_rate
        mono = np.interp(new_times, old_times, mono)
        sample_rate = target_rate
    frame_length = max(1, int(round(sample_rate * float(options["frameMs"]) / 1000.0)))
    hop_length = max(1, int(round(sample_rate * float(options["hopMs"]) / 1000.0)))
    n_fft = int(options["nFft"])
    if frame_length > n_fft:
        raise ValueError(f"frame length {frame_length} exceeds registered FFT size {n_fft}; resample first")
    if mono.size < frame_length:
        mono = np.pad(mono, (0, frame_length - mono.size), mode="constant")
    frame_count = max(1, int(math.ceil(max(0, mono.size - frame_length) / hop_length)) + 1)
    required = (frame_count - 1) * hop_length + frame_length
    padded = np.pad(mono, (0, max(0, required - mono.size)), mode="constant")
    window = np.hanning(frame_length).astype(np.float64)
    frames = np.stack(
        [padded[offset : offset + frame_length] * window for offset in range(0, required - frame_length + 1, hop_length)]
    )
    power = (np.abs(np.fft.rfft(frames, n=n_fft, axis=1)) ** 2) / max(1, n_fft)
    mel_filters = _mel_filterbank(sample_rate, n_fft, int(options["nMels"]), float(options["fmaxHz"]))
    mel = power @ mel_filters.T
    log_mel = np.log(np.maximum(mel, 1e-12))
    delta = np.diff(log_mel, axis=0, prepend=log_mel[:1])
    spectral_flux = np.sqrt(np.sum(np.maximum(delta, 0.0) ** 2, axis=1))
    absolute_flux = np.sqrt(np.sum(delta**2, axis=1))
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    high_band = freqs >= 3000.0
    if not np.any(high_band):
        high_band = freqs >= max(0.0, sample_rate / 4.0)
    high_delta = np.diff(np.log(np.maximum(power[:, high_band], 1e-12)), axis=0, prepend=np.log(np.maximum(power[:1, high_band], 1e-12)))
    high_band_flux = np.sqrt(np.sum(np.maximum(high_delta, 0.0) ** 2, axis=1))
    broadband_change = np.mean(np.abs(delta), axis=1)
    energy = np.log(np.maximum(np.mean(frames**2, axis=1), 1e-12))
    energy_slope = np.abs(np.diff(energy, prepend=energy[:1]))
    low_band = freqs <= 500.0
    mid_band = (freqs > 500.0) & (freqs <= 2500.0)
    low_energy = np.sum(power[:, low_band], axis=1) + 1e-12
    mid_energy = np.sum(power[:, mid_band], axis=1) + 1e-12
    voicing = np.log(low_energy / mid_energy)
    voicing_change = np.abs(np.diff(voicing, prepend=voicing[:1]))
    times = (np.arange(frame_count, dtype=np.float64) * hop_length + frame_length / 2.0) / sample_rate
    return {
        "times": times,
        "logMel": log_mel,
        "spectralFlux": spectral_flux,
        "absoluteFlux": absolute_flux,
        "highBandFlux": high_band_flux,
        "broadbandChange": broadband_change,
        "energy": energy,
        "energySlope": energy_slope,
        "voicing": voicing,
        "voicingChange": voicing_change,
        "duration": float(mono.size / sample_rate),
        "sampleRate": int(sample_rate),
        "config": {key: value for key, value in options.items() if key in {"frameMs", "hopMs", "nFft", "nMels", "fmaxHz", "targetSampleRate"}},
    }


def extract_spectrogram_features_from_wav(
    path: str | Path, config: Mapping[str, float | int] | None = None
) -> dict[str, Any]:
    samples, sample_rate = read_wav(path)
    return extract_spectrogram_features(samples, sample_rate, config)


def _clean_ipa(ipa: str) -> str:
    text = str(ipa or "").strip()
    if len(text) >= 2 and text[0] in "/[" and text[-1] in "/]":
        text = text[1:-1]
    return text.replace(" ", "").replace("|", "")


def _is_vowel(character: str) -> bool:
    return character in _VOWELS


def split_ipa_syllables(ipa: str) -> list[str]:
    """Split a compact IPA transcription at vowel nuclei.

    This is a deterministic reference-label helper, not a phonological parser.
    It keeps stress/length marks with the relevant syllable and uses a maximal
    onset heuristic for intervocalic consonant clusters.  A source with an
    explicit syllable list should always take precedence over this fallback.
    """

    text = _clean_ipa(ipa)
    if not text:
        return []
    nuclei: list[tuple[int, int]] = []
    index = 0
    while index < len(text):
        if not _is_vowel(text[index]):
            index += 1
            continue
        start = index
        index += 1
        while index < len(text) and (text[index] in _VOWELS or text[index] in _COMBINING_MARKS):
            index += 1
        nuclei.append((start, index))
    if not nuclei:
        return [text]
    starts = [0]
    for left, right in zip(nuclei, nuclei[1:]):
        cluster_start, cluster_end = left[1], right[0]
        consonants = [
            pos
            for pos in range(cluster_start, cluster_end)
            if text[pos] not in _STRESS and text[pos] not in _COMBINING_MARKS
        ]
        split_at = right[0] if not consonants else consonants[-1]
        # A stress marker immediately before the onset belongs to the next
        # syllable rather than to the previous coda.
        while split_at > cluster_start and text[split_at - 1] in _STRESS | _COMBINING_MARKS:
            split_at -= 1
        starts.append(split_at)
    starts.append(len(text))
    syllables = [text[start:end] for start, end in zip(starts, starts[1:]) if text[start:end]]
    return syllables


def _ipa_symbols(syllable: str) -> list[str]:
    text = _clean_ipa(syllable)
    symbols: list[str] = []
    index = 0
    while index < len(text):
        if text[index] in _STRESS or text[index] in _COMBINING_MARKS:
            index += 1
            continue
        pair = text[index : index + 2]
        if pair in _AFFRICATES:
            symbols.append(pair)
            index += 2
            continue
        symbols.append(text[index])
        index += 1
    return symbols


def _phone_family(phone: str) -> str:
    if phone in _AFFRICATES:
        return "affricate"
    if phone in _FRICATIVES:
        return "fricative"
    if phone in _STOPS:
        return "stop"
    if phone in _NASALS:
        return "nasal"
    if phone in _LIQUIDS_GLIDES:
        return "liquid_glide"
    if phone in _VOWELS:
        return "vowel"
    return "other"


def boundary_transition(left_syllable: str, right_syllable: str) -> dict[str, str]:
    left_symbols = _ipa_symbols(left_syllable)
    right_symbols = _ipa_symbols(right_syllable)
    left_family = _phone_family(left_symbols[-1]) if left_symbols else "other"
    right_family = _phone_family(right_symbols[0]) if right_symbols else "other"
    if left_family in {"fricative", "affricate"} or right_family in {"fricative", "affricate"}:
        family = "fricative_affricate"
    else:
        family = right_family if right_family != "vowel" else left_family
    return {
        "left": left_family,
        "right": right_family,
        "label": f"{left_family}->{right_family}",
        "family": family,
    }


def _choose_ipa_variant(variants: Sequence[str]) -> tuple[str, list[str]] | None:
    unique_variants = sorted({str(variant).strip() for variant in variants if str(variant).strip()})
    if len(unique_variants) != 1:
        return None
    choices: list[tuple[int, str, list[str]]] = []
    for variant in unique_variants:
        syllables = split_ipa_syllables(str(variant))
        if not 2 <= len(syllables) <= 5:
            continue
        # Prefer the variant with an explicit primary stress and no whitespace.
        score = (0 if " " in str(variant) else 1) + (1 if "ˈ" in str(variant) else 0)
        choices.append((score, str(variant), syllables))
    if not choices:
        return None
    choices.sort(key=lambda item: (-item[0], item[1]))
    _, variant, syllables = choices[0]
    return variant, syllables


def _load_ipa_entries(path: Path) -> dict[str, list[str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "entries" in data and isinstance(data["entries"], Mapping):
        return {str(key).lower(): [str(item) for item in value] for key, value in data["entries"].items() if isinstance(value, list)}
    return {str(key).lower(): [str(item) for item in value] for key, value in data.items() if isinstance(value, list)}


def _build_heuristic_manifest_for_historical_compatibility(
    oxford_csv: str | Path,
    ipa_json: str | Path,
    *,
    oxford_override_json: str | Path | None = None,
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:
    """Legacy diagnostic builder; never use its output as the v2 primary manifest."""

    del seed  # Selection is lexical plus deterministic rarity balancing.
    ipa_entries = _load_ipa_entries(Path(ipa_json))
    override_entries = _load_ipa_entries(Path(oxford_override_json)) if oxford_override_json else {}
    words: list[tuple[str, str, list[str], str, str]] = []
    seen_words: set[str] = set()
    with Path(oxford_csv).open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            raw_word = str(row.get("word") or "").strip().lower()
            if not re.fullmatch(r"[a-z]+", raw_word) or raw_word in seen_words:
                continue
            variants = override_entries.get(raw_word) or ipa_entries.get(raw_word) or []
            selected = _choose_ipa_variant(variants)
            if not selected:
                continue
            seen_words.add(raw_word)
            reference_ipa, syllables = selected
            frozen_syllables = FROZEN_REFERENCE_SYLLABLES.get(raw_word)
            if frozen_syllables is not None:
                syllables = list(frozen_syllables)
            transitions = [boundary_transition(left, right) for left, right in zip(syllables, syllables[1:])]
            families = sorted({transition["family"] for transition in transitions})
            words.append((raw_word, reference_ipa, syllables, "oxford-american-ipa" if raw_word in override_entries else "ipa-dict", ",".join(families)))

    selected_entries: list[dict[str, Any]] = []
    target_by_count = {2: 25, 3: 25, 4: 25, 5: 25}
    # v2 deliberately keeps the v1 cohort and order.  Re-running the family
    # balancing heuristic after a corrected label can otherwise replace a
    # word whose source splitter count changed, silently changing the study.
    frozen_cohort: dict[int, list[str]] = defaultdict(list)
    frozen_cohort_path = Path(__file__).resolve().parents[1] / "data" / "segmentation-study-v1.json"
    if frozen_cohort_path.exists():
        try:
            frozen_document = json.loads(frozen_cohort_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            frozen_document = {}
        for frozen_entry in frozen_document.get("entries", []) if isinstance(frozen_document, Mapping) else []:
            if not isinstance(frozen_entry, Mapping):
                continue
            frozen_count = frozen_entry.get("targetSyllableCount")
            frozen_word = str(frozen_entry.get("targetWord") or "").lower()
            if frozen_count in target_by_count and frozen_word:
                frozen_cohort[int(frozen_count)].append(frozen_word)
    use_frozen_cohort = all(len(frozen_cohort[count]) == target_by_count[count] for count in target_by_count)
    by_word = {item[0]: item for item in words}
    for syllable_count in range(2, 6):
        if use_frozen_cohort:
            missing = [word for word in frozen_cohort[syllable_count] if word not in by_word]
            if missing:
                raise ValueError(f"The frozen v1 cohort is missing source words: {', '.join(missing)}")
            chosen = [by_word[word] for word in frozen_cohort[syllable_count]]
        else:
            candidates = [item for item in words if len(item[2]) == syllable_count]
            if len(candidates) < target_by_count[syllable_count]:
                raise ValueError(f"Only {len(candidates)} {syllable_count}-syllable candidates; need 25")
            chosen = []
            family_counts: Counter[str] = Counter()
            remaining = list(sorted(candidates, key=lambda item: item[0]))
            while remaining and len(chosen) < target_by_count[syllable_count]:
                remaining.sort(
                    key=lambda item: (
                        -sum(1.0 / (1.0 + family_counts[family]) for family in item[4].split(",") if family),
                        item[0],
                    )
                )
                picked = remaining.pop(0)
                chosen.append(picked)
                family_counts.update(family for family in picked[4].split(",") if family)
            chosen.sort()
        for order, (word, reference_ipa, syllables, ipa_source, _) in enumerate(chosen, start=1):
            if len(syllables) != syllable_count:
                raise ValueError(f"Frozen v2 label count for {word} is {len(syllables)}; expected {syllable_count}.")
            transitions = [boundary_transition(left, right) for left, right in zip(syllables, syllables[1:])]
            if word in FROZEN_REFERENCE_RATIONALES:
                exception_rationale = FROZEN_REFERENCE_RATIONALES[word]
            elif word in FROZEN_REFERENCE_SYLLABLES:
                label = ",".join(syllables)
                exception_rationale = f"Corrected v1 syllable boundary; frozen en-US label is [{label}]."
            else:
                label = ",".join(syllables)
                exception_rationale = f"Reviewed en-US source variant retained as frozen v2 label [{label}]."
            selected_entries.append(
                {
                    "taskId": f"{STUDY_ID}-{len(selected_entries) + 1:04d}",
                    "order": len(selected_entries) + 1,
                    "targetWord": word,
                    "referenceIpa": reference_ipa,
                    "referenceSyllableIpa": syllables,
                    "targetSyllableCount": syllable_count,
                    "expectedObservedCount": syllable_count,
                    "ipaSource": ipa_source,
                    "transitionTypes": [transition["label"] for transition in transitions],
                    "transitionFamilies": sorted({transition["family"] for transition in transitions}),
                    "category": "clean",
                    "speakerCohort": STUDY_COHORT,
                    "referenceDialect": "en-US",
                    "dialect": "en-US",
                    "referenceSource": ipa_source,
                    "referenceProvenance": {
                        "dialect": "en-US",
                        "source": ipa_source,
                        "method": FROZEN_REFERENCE_PROVENANCE,
                        "exceptionRationale": exception_rationale,
                    },
                    "referenceLabelProvenance": FROZEN_REFERENCE_PROVENANCE,
                    "labelProvenance": FROZEN_REFERENCE_PROVENANCE,
                    "exceptionRationale": exception_rationale,
                }
            )

    development_counts = {2: 18, 3: 18, 4: 17, 5: 17}
    for entry in selected_entries:
        count = int(entry["targetSyllableCount"])
        same_count = [item for item in selected_entries if item["targetSyllableCount"] == count]
        rank = same_count.index(entry)
        entry["split"] = "development" if rank < development_counts[count] else "holdout"
    manifest: dict[str, Any] = {
        "studyId": STUDY_ID,
        "version": MANIFEST_VERSION,
        "createdAt": "2026-08-13T00:00:00Z",
        "selection": {
            "wordList": "The_Oxford_5000.csv",
            "ipaPrimary": "public/oxford-american-ipa.json",
            "ipaFallback": "public/ipa-dict.json",
            "seed": DEFAULT_SEED,
            "rules": "same 100 words as study-v1; one frozen en-US 2-5 syllable IPA label per word; heuristic labels prohibited",
            "referencePolicy": "explicit frozen en-US referenceSyllableIpa labels only",
        },
        "splitCounts": {
            "development": {"2": 18, "3": 18, "4": 17, "5": 17},
            "holdout": {"2": 7, "3": 7, "4": 8, "5": 8},
        },
        "entries": selected_entries,
    }
    manifest["manifestSha256"] = _json_hash(manifest)
    return manifest


def build_study_manifest(
    oxford_csv: str | Path | None = None,
    ipa_json: str | Path | None = None,
    *,
    oxford_override_json: str | Path | None = None,
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:
    """Return the checked-in explicit v2 manifest; never synthesize labels."""

    del oxford_csv, ipa_json, oxford_override_json, seed
    checked_in = Path(__file__).resolve().parents[2] / "scripts" / "data" / "segmentation-study-v2.json"
    try:
        manifest = json.loads(checked_in.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("The checked-in explicit v2 manifest is required; heuristic synthesis is disabled.") from error
    _validate_manifest_identity(manifest)
    return manifest


def _first_mapping(value: Any, *keys: str) -> Any:
    if not isinstance(value, Mapping):
        return None
    for key in keys:
        if key in value and value[key] is not None:
            return value[key]
    return None


def _extract_version_segments(document: Mapping[str, Any], version: str) -> list[dict[str, float | int]]:
    direct = _first_mapping(document, f"{version}Segments", f"{version}_segments")
    if direct:
        return normalize_segments(direct)
    analysis = document.get("analysis") if isinstance(document.get("analysis"), Mapping) else {}
    nested = analysis.get("analysis") if isinstance(analysis, Mapping) and isinstance(analysis.get("analysis"), Mapping) else analysis
    if not isinstance(nested, Mapping):
        nested = {}
    variant = nested.get(version)
    if isinstance(variant, Mapping):
        variant_analysis = variant.get("analysis") if isinstance(variant.get("analysis"), Mapping) else variant
        if isinstance(variant_analysis, Mapping):
            partition_variants = variant_analysis.get("partitionVariants")
            if isinstance(partition_variants, Mapping):
                candidates = partition_variants.get(version) or partition_variants.get(version.lower())
                result = normalize_segments(candidates)
                if result:
                    return result
            for key in ("observed_syllables", "observedSyllables", "syllables"):
                values = variant_analysis.get(key)
                result: list[dict[str, float | int]] = []
                for item in values or []:
                    if not isinstance(item, Mapping):
                        continue
                    if version == "v3":
                        start = _as_float(item.get("partitionStartTime"))
                        end = _as_float(item.get("partitionEndTime"))
                    elif version == "v4":
                        start = _as_float(item.get("v4PartitionStartTime", item.get("partitionStartTime")))
                        end = _as_float(item.get("v4PartitionEndTime", item.get("partitionEndTime")))
                    else:
                        start = _as_float(item.get("startTime"))
                        end = _as_float(item.get("endTime"))
                    if start is not None and end is not None:
                        result.append(_segment(start, end, len(result)))
                if result:
                    return result
    # Local manual-review exports keep the automatic baseline under the outer
    # ``analysis`` object rather than at the document root.  Accept both
    # shapes so a historical export can be replayed without hand editing it.
    for source in (document, analysis, nested):
        if isinstance(source, Mapping):
            automatic = normalize_segments(source.get("automaticSegments", source.get("automatic_segments")))
            if automatic and version in {"v3", "v4"}:
                return automatic
    if version == "v3":
        return normalize_segments(_first_mapping(document, "automaticSegments", "automatic_segments"))
    if version == "v4":
        return normalize_segments(_first_mapping(document, "v4Segments", "v4_segments")) or _extract_version_segments(document, "v3")
    return normalize_segments(_first_mapping(document, "v2", "automaticSegments"))


def _extract_manual_segments(document: Mapping[str, Any]) -> list[dict[str, float | int]]:
    manual_review = document.get("manualReview") if isinstance(document.get("manualReview"), Mapping) else {}
    analysis = document.get("analysis") if isinstance(document.get("analysis"), Mapping) else {}
    nested = analysis.get("analysis") if isinstance(analysis, Mapping) and isinstance(analysis.get("analysis"), Mapping) else {}
    for source in (manual_review, analysis, nested):
        if isinstance(source, Mapping):
            result = normalize_segments(source.get("manualSegments"))
            if result:
                return result
    return []


def _canonical_manifest(manifest: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if isinstance(manifest, Mapping):
        return manifest
    default_path = Path(__file__).resolve().parents[2] / "scripts" / "data" / "segmentation-study-v2.json"
    if not default_path.exists():
        raise ValueError("The study-v2 manifest is required for canonical export validation.")
    try:
        loaded = json.loads(default_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("The study-v2 manifest is unreadable.") from error
    if not isinstance(loaded, Mapping):
        raise ValueError("The study-v2 manifest must be an object.")
    return loaded


def _validate_manifest_identity(manifest: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    if manifest.get("studyId") != STUDY_ID or manifest.get("version") != MANIFEST_VERSION:
        raise ValueError("Canonical export requires the immutable study-v2 manifest.")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or len(entries) != 100:
        raise ValueError("The study-v2 manifest must contain exactly 100 entries.")
    expected_hash = manifest.get("manifestSha256")
    actual_hash = _json_hash({key: value for key, value in manifest.items() if key != "manifestSha256"})
    if not isinstance(expected_hash, str) or expected_hash != actual_hash:
        raise ValueError("The study-v2 manifest checksum does not match its content.")
    result: dict[str, Mapping[str, Any]] = {}
    count_totals: Counter[int] = Counter()
    split_totals: Counter[tuple[str, int]] = Counter()
    for entry in entries:
        if not isinstance(entry, Mapping):
            raise ValueError("The study-v2 manifest contains a malformed entry.")
        task_id = str(entry.get("taskId") or "")
        word = str(entry.get("targetWord") or "").lower()
        count = entry.get("targetSyllableCount")
        labels = entry.get("referenceSyllableIpa")
        if not re.fullmatch(r"segmentation-study-v2-\d{4}", task_id) or not word:
            raise ValueError("The study-v2 manifest contains an invalid task identity.")
        if not isinstance(count, int) or count not in {2, 3, 4, 5} or not isinstance(labels, list) or len(labels) != count:
            raise ValueError(f"The frozen reference labels for {word or task_id} are incomplete.")
        if not all(isinstance(label, str) and label.strip() for label in labels):
            raise ValueError(f"The frozen reference labels for {word} must be non-empty strings.")
        reference_ipa = _clean_ipa(str(entry.get("referenceIpa") or ""))
        reconstructed = "".join(_clean_ipa(label) for label in labels)
        if not reference_ipa or reconstructed != reference_ipa:
            raise ValueError(f"The frozen reference labels for {word} do not reconstruct referenceIpa.")
        source_stress = "".join(symbol for symbol in reference_ipa if symbol in _STRESS)
        label_stress = "".join(symbol for label in labels for symbol in _clean_ipa(label) if symbol in _STRESS)
        if source_stress != label_stress or any(any(mark in _clean_ipa(label)[1:] for mark in _STRESS) for label in labels):
            raise ValueError(f"The frozen reference stress markers for {word} are not syllable-initial and source-aligned.")
        for boundary in range(1, len(reconstructed)):
            if reconstructed[boundary - 1 : boundary + 1] in _AFFRICATES:
                left = _clean_ipa(labels[0])
                consumed = 0
                for label in labels:
                    consumed += len(_clean_ipa(label))
                    if consumed == boundary:
                        raise ValueError(f"The frozen reference labels for {word} split an affricate across syllables.")
                    if consumed > boundary:
                        break
        deterministic = split_ipa_syllables(reference_ipa)
        if labels != deterministic:
            rationale = str(entry.get("exceptionRationale") or "").lower()
            if word not in FROZEN_REFERENCE_SYLLABLES or "correct" not in rationale:
                raise ValueError(f"The non-maximal-onset label exception for {word} lacks an explicit rationale.")
        count_totals[count] += 1
        split_totals[(str(entry.get("split") or ""), count)] += 1
        if entry.get("referenceDialect") != "en-US" or entry.get("dialect") != "en-US":
            raise ValueError(f"The frozen reference labels for {word} must declare en-US.")
        provenance = str(entry.get("labelProvenance") or "").lower()
        if not provenance or "heuristic" in provenance or provenance in {"deterministic-transform", "ipa-splitter"}:
            raise ValueError(f"The primary manifest cannot use heuristic labels for {word}.")
        reference_provenance = entry.get("referenceProvenance")
        if not isinstance(reference_provenance, Mapping) or reference_provenance.get("dialect") != "en-US" or reference_provenance.get("method") != FROZEN_REFERENCE_PROVENANCE or entry.get("referenceLabelProvenance") != FROZEN_REFERENCE_PROVENANCE or not str(entry.get("exceptionRationale") or "").strip():
            raise ValueError(f"The frozen reference provenance for {word} is incomplete.")
        if task_id in result or f"word:{word}" in result:
            raise ValueError("The study-v2 manifest contains duplicate task or word identities.")
        result[task_id] = entry
        result[f"word:{word}"] = entry
    if count_totals != Counter({2: 25, 3: 25, 4: 25, 5: 25}):
        raise ValueError("The study-v2 manifest must contain exactly 25 entries for each syllable count.")
    if {int(entry.get("targetSyllableCount")) for entry in entries} != {2, 3, 4, 5}:
        raise ValueError("The study-v2 manifest must cover 2-, 3-, 4-, and 5-syllable words.")
    if sum(entry.get("split") == "development" for entry in entries) != 70 or sum(entry.get("split") == "holdout" for entry in entries) != 30:
        raise ValueError("The study-v2 manifest must have a 70/30 development/holdout split.")
    expected_split_counts = {("development", 2): 18, ("development", 3): 18, ("development", 4): 17, ("development", 5): 17, ("holdout", 2): 7, ("holdout", 3): 7, ("holdout", 4): 8, ("holdout", 5): 8}
    if split_totals != Counter(expected_split_counts):
        raise ValueError("The study-v2 manifest split does not match the frozen 70/30 per-count allocation.")
    return result


def _canonical_spans(value: Any, field: str, expected_count: int) -> list[dict[str, float | int]]:
    if isinstance(value, Mapping):
        value = value.get("spans") or value.get("observed_syllables") or value.get("syllables")
    if not isinstance(value, list) or len(value) != expected_count:
        raise ValueError(f"Canonical export requires top-level {field}.")
    spans: list[dict[str, float | int]] = []
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise ValueError(f"Canonical export {field} contains a malformed span at index {index}.")
        start = _as_float(item.get("startTime", item.get("start_time", item.get("start"))))
        end = _as_float(item.get("endTime", item.get("end_time", item.get("end"))))
        if start is None or end is None or start < 0 or end <= start:
            raise ValueError(f"Canonical export {field} must contain positive finite spans.")
        if spans and abs(start - float(spans[-1]["endTime"])) > 0.000001:
            raise ValueError(f"Canonical export {field} must be ordered and contiguous.")
        spans.append(_segment(start, end, index))
    return spans


def _automatic_order(manifest_sha256: str, task_id: str) -> str:
    """Derive the immutable automatic-exposure token for one task."""

    return hashlib.sha256(f"{manifest_sha256}{task_id}".encode("utf-8")).hexdigest()


def _automatic_version_order(manifest_sha256: str, task_id: str) -> list[str]:
    """Derive the deterministic V2/V3/V4 exposure order from the token."""

    digest = _automatic_order(manifest_sha256, task_id)
    keyed = [(digest[index * 16:(index + 1) * 16], version) for index, version in enumerate(("v2", "v3", "v4"))]
    return [version for _, version in sorted(keyed)]


def _valid_assisted_exposure(
    value: Any,
    *,
    automatic_order: str,
    automatic_version_order: Sequence[str],
) -> bool:
    if not isinstance(value, list) or len(value) != 3:
        return False
    seen: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            return False
        raw_version = item.get("version")
        raw_order = item.get("automaticOrder") if item.get("automaticOrder") is not None else item.get("automatic_order")
        raw_viewed_at = item.get("viewedAt") if item.get("viewedAt") is not None else item.get("viewed_at")
        version = raw_version.strip().lower() if isinstance(raw_version, str) else ""
        supplied_order = raw_order.strip() if isinstance(raw_order, str) else ""
        viewed_at = raw_viewed_at.strip() if isinstance(raw_viewed_at, str) else ""
        if (
            version != automatic_version_order[index]
            or version in seen
            or supplied_order != automatic_order
            or not re.fullmatch(r"[0-9a-f]{64}", supplied_order)
            or not viewed_at
        ):
            return False
        try:
            parsed = datetime.fromisoformat(viewed_at.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return False
        if not isinstance(parsed, datetime):
            return False
        seen.add(version)
    return seen == set(automatic_version_order) == {"v2", "v3", "v4"}


def _canonical_hash(sample: Mapping[str, Any]) -> str:
    source_hash = str(sample.get("sourceHash") or "").strip().lower()
    audio_hash = str(sample.get("audioSha256") or "").strip().lower()
    if source_hash and audio_hash and source_hash != audio_hash:
        raise ValueError("Canonical export sourceHash and audioSha256 must match.")
    value = source_hash or audio_hash
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Canonical export samples require a valid sourceHash SHA-256.")
    return value


def _canonical_sample(sample: Mapping[str, Any], entries: Mapping[str, Mapping[str, Any]], manifest_sha256: str) -> dict[str, Any]:
    task_id = str(sample.get("taskId") or "")
    entry = entries.get(task_id)
    if entry is None:
        raise ValueError(f"Canonical export contains an unknown taskId: {task_id or '<missing>'}.")
    if str(sample.get("targetWord") or "").lower() != str(entry.get("targetWord") or "").lower():
        raise ValueError(f"Canonical export task {task_id} does not match its manifest word.")
    if sample.get("speakerCohort") != STUDY_COHORT:
        raise ValueError(f"Canonical export task {task_id} is outside the exact study-v2 cohort.")
    if sample.get("certainty") != "certain":
        raise ValueError(f"Canonical export task {task_id} is not promotion-eligible certainty=certain.")
    if sample.get("promotionEligible") is not True:
        raise ValueError(f"Canonical export task {task_id} must explicitly declare promotionEligible=true.")
    expected_automatic_order = _automatic_order(manifest_sha256, task_id)
    expected_automatic_version_order = _automatic_version_order(manifest_sha256, task_id)
    if sample.get("automaticOrder") != expected_automatic_order or sample.get("automaticVersionOrder") != expected_automatic_version_order:
        raise ValueError(f"Canonical export task {task_id} has an invalid deterministic automatic exposure proof.")
    expected_count = int(entry["targetSyllableCount"])
    reference_syllables = sample.get("referenceSyllableIpa")
    if reference_syllables != entry.get("referenceSyllableIpa"):
        raise ValueError(f"Canonical export task {task_id} must use the frozen reference labels.")
    if sample.get("referenceIpa") != entry.get("referenceIpa"):
        raise ValueError(f"Canonical export task {task_id} must use the frozen reference IPA.")
    if sample.get("targetSyllableCount") != expected_count or sample.get("expectedObservedCount") != expected_count:
        raise ValueError(f"Canonical export task {task_id} has a mismatched frozen syllable count.")
    if sample.get("split") != entry.get("split"):
        raise ValueError(f"Canonical export task {task_id} is missing its exact manifest split.")
    reference_provenance = sample.get("referenceProvenance")
    expected_provenance = entry.get("referenceProvenance")
    if (
        not isinstance(reference_provenance, Mapping)
        or not reference_provenance
        or reference_provenance.get("dialect") != "en-US"
        or reference_provenance.get("method") != FROZEN_REFERENCE_PROVENANCE
        or reference_provenance != expected_provenance
        or sample.get("referenceLabelProvenance") != FROZEN_REFERENCE_PROVENANCE
    ):
        raise ValueError(f"Canonical export task {task_id} requires reference provenance.")
    versions = sample.get("versions")
    if not isinstance(versions, Mapping):
        raise ValueError(f"Canonical export task {task_id} must include versions.v2/v3/v4.")
    normalized_versions: dict[str, list[dict[str, float | int]]] = {}
    variant_provenance = sample.get("variantProvenance")
    if not isinstance(variant_provenance, Mapping):
        raise ValueError(f"Canonical export task {task_id} requires variant provenance for V2/V3/V4.")
    if not str(sample.get("analysisRevision") or "").strip():
        raise ValueError(f"Canonical export task {task_id} requires analysisRevision.")
    version_provenance: dict[str, tuple[str, str, str]] = {}
    for version in ("v2", "v3", "v4"):
        if version not in versions:
            raise ValueError(f"Canonical export task {task_id} is missing genuine versions.{version}.")
        version_data = versions[version]
        supplied = variant_provenance.get(version)
        if not isinstance(version_data, Mapping) or not isinstance(supplied, Mapping):
            raise ValueError(f"Canonical export task {task_id} has incomplete {version} provenance.")
        analysis_version = str(version_data.get("analysisVersion") or "").strip()
        source = str(version_data.get("source") or "").strip()
        schema = str(version_data.get("schemaVersion") or supplied.get("schemaVersion") or "").strip()
        variant_id = str(version_data.get("variantId") or version_data.get("variant") or supplied.get("variantId") or supplied.get("variant") or "").strip()
        if not analysis_version or not source or not schema or variant_id != version or schema != VARIANT_SCHEMA_VERSIONS[version]:
            raise ValueError(f"Canonical export task {task_id} requires analysisVersion/source/schema for {version}.")
        if (
            str(supplied.get("analysisVersion") or "").strip() != analysis_version
            or str(supplied.get("source") or "").strip() != source
            or str(supplied.get("schemaVersion") or "").strip() != schema
            or str(supplied.get("variantId") or supplied.get("variant") or "").strip() != version
        ):
            raise ValueError(f"Canonical export task {task_id} has mismatched {version} provenance.")
        version_provenance[version] = (analysis_version, source, schema)
        normalized_versions[version] = _canonical_spans(versions[version], f"versions.{version}", expected_count)
    if len({version for version in version_provenance}) != 3 or len({item[0] for item in version_provenance.values()}) != 3 or len({item[1] for item in version_provenance.values()}) != 3:
        raise ValueError(f"Canonical export task {task_id} cannot alias V2/V3/V4 provenance.")
    manual = _canonical_spans(sample.get("manualSpans"), "manualSpans", expected_count)
    capture = sample.get("captureMetadata") or sample.get("captureSettings")
    if not isinstance(capture, Mapping) or not capture or sample.get("captureEligibility") not in {True, "eligible"}:
        raise ValueError(f"Canonical export task {task_id} requires eligible capture metadata.")
    if any(capture.get(key) is not False for key in ("echoCancellation", "noiseSuppression", "autoGainControl")):
        raise ValueError(f"Canonical export task {task_id} requires all raw capture settings explicitly false.")
    if not any(capture.get(key) for key in ("captureId", "capturedAt", "sessionId")):
        raise ValueError(f"Canonical export task {task_id} requires capture identity metadata.")
    if sample.get("annotationProtocol") != "automatic-visible-assisted-v1":
        raise ValueError(f"Canonical export task {task_id} requires the exact assisted annotation protocol.")
    assisted = sample.get("assistedMetadata")
    if (
        not isinstance(assisted, Mapping)
        or assisted.get("assisted") is not True
        or assisted.get("annotationProtocol") != "automatic-visible-assisted-v1"
        or not _valid_assisted_exposure(
            assisted.get("exposureLog"),
            automatic_order=expected_automatic_order,
            automatic_version_order=expected_automatic_version_order,
        )
    ):
        raise ValueError(f"Canonical export task {task_id} requires explicit assisted metadata and V2/V3/V4 exposure.")
    for flag in ("substituted", "substitution", "substitutionUsed", "fallback", "fallbackUsed", "attrited", "repaired", "repairUsed"):
        if sample.get(flag) not in (None, False, ""):
            raise ValueError(f"Canonical export task {task_id} contains forbidden {flag} metadata.")
    historical = sample.get("historicalCompatibility")
    if historical is not None and (not isinstance(historical, Mapping) or historical.get("promotionEligible") is not False):
        raise ValueError(f"Historical compatibility for task {task_id} must be explicit and non-promotable.")
    sample_id = str(sample.get("sampleId") or sample.get("id") or "").strip()
    if not sample_id:
        raise ValueError(f"Canonical export task {task_id} requires a genuine sampleId.")
    audio_hash = _canonical_hash(sample)
    return {
        "id": sample_id,
        "taskId": task_id,
        "word": str(entry["targetWord"]),
        "audioSha256": audio_hash,
        "sourceHash": audio_hash,
        "referenceIpa": sample.get("referenceIpa") or entry.get("referenceIpa") or "",
        "referenceProvenance": dict(reference_provenance),
        "referenceLabelProvenance": FROZEN_REFERENCE_PROVENANCE,
        "referenceSyllableIpa": [str(item) for item in reference_syllables],
        "targetSyllableCount": expected_count,
        "expectedObservedCount": expected_count,
        "manualSegments": manual,
        "versions": normalized_versions,
        "split": entry.get("split"),
        "speakerCohort": STUDY_COHORT,
        "automaticOrder": expected_automatic_order,
        "automaticVersionOrder": expected_automatic_version_order,
        "certainty": sample.get("certainty") or "certain",
        "captureEligibility": sample.get("captureEligibility"),
        "captureMetadata": dict(capture),
        "annotationProtocol": "automatic-visible-assisted-v1",
        "assistedMetadata": dict(assisted),
        "analysisRevision": str(sample.get("analysisRevision")),
        "variantProvenance": {version: {"variantId": version, "variant": version, "analysisVersion": values[0], "source": values[1], "schemaVersion": values[2]} for version, values in version_provenance.items()},
        "historicalCompatibility": dict(historical) if isinstance(historical, Mapping) else None,
        "historical": bool(isinstance(historical, Mapping)),
        "promotionEligible": sample.get("promotionEligible") is True and not isinstance(historical, Mapping),
        "_canonicalExportV2": True,
    }


def load_canonical_export_v2(source: Mapping[str, Any] | str | Path, *, manifest: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
    """Load the route's canonical export without dropping or repairing records."""

    if isinstance(source, (str, Path)):
        try:
            document = json.loads(Path(source).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError("Canonical export is unreadable JSON.") from error
    else:
        document = source
    if not isinstance(document, Mapping) or document.get("schemaVersion") != CANONICAL_EXPORT_SCHEMA_VERSION:
        raise ValueError("Expected a segmentation-study-export-v2 canonical export.")
    if document.get("studyVersion") not in {STUDY_ID, "study-v2"} or document.get("manifestVersion") != MANIFEST_VERSION:
        raise ValueError("Canonical export identity does not match study-v2.")
    checked_manifest = _canonical_manifest(manifest)
    entries = _validate_manifest_identity(checked_manifest)
    if document.get("manifestSha256") != checked_manifest.get("manifestSha256"):
        raise ValueError("Canonical export manifestSha256 does not match the checked-in manifest.")
    samples = document.get("samples")
    if not isinstance(samples, list) or len(samples) != 100:
        raise ValueError("Canonical export must contain exactly 100 samples; refusing silent attrition.")
    manifest_sha256 = str(checked_manifest["manifestSha256"])
    loaded = [_canonical_sample(sample, entries, manifest_sha256) for sample in samples if isinstance(sample, Mapping)]
    if len(loaded) != len(samples):
        raise ValueError("Canonical export contains a malformed sample record.")
    task_ids = [sample["taskId"] for sample in loaded]
    expected_task_ids = [str(entry["taskId"]) for entry in checked_manifest["entries"]]
    if len(set(task_ids)) != 100 or set(task_ids) != set(expected_task_ids):
        raise ValueError("Canonical export does not have exact study-v2 cohort coverage.")
    sample_ids = [sample["id"] for sample in loaded]
    audio_hashes = [sample["audioSha256"] for sample in loaded]
    if len(set(sample_ids)) != 100 or len(set(audio_hashes)) != 100:
        raise ValueError("Canonical export contains duplicate sample IDs or audio hashes.")
    return loaded


def load_labeled_samples(
    source: str | Path,
    *,
    manifest: Mapping[str, Any] | None = None,
    compatibility: str = "canonical",
    allow_historical_compatibility: bool = False,
) -> list[dict[str, Any]]:
    """Load only canonical v2 exports unless historical compatibility is explicit."""

    mode = "historical" if allow_historical_compatibility else str(compatibility or "canonical").strip().lower()
    if mode not in {"canonical", "historical"}:
        raise ValueError("compatibility must be canonical or historical.")

    path = Path(source)
    parsed_documents: list[tuple[Path, Any]] = []
    if path.is_file():
        try:
            header = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError("Sample export is unreadable JSON.") from error
        if isinstance(header, Mapping) and (header.get("schemaVersion") == CANONICAL_EXPORT_SCHEMA_VERSION or header.get("studyVersion") in {STUDY_ID, "study-v2"}):
            return load_canonical_export_v2(header, manifest=manifest)
        if mode != "historical":
            raise ValueError("Primary reanalysis requires a canonical segmentation-study-export-v2 export; use compatibility=historical explicitly for legacy data.")
        parsed_documents.append((path, header))
    elif not path.is_dir():
        raise ValueError(f"Sample export path does not exist: {path}")
    paths = sorted(path.glob("*.json")) if path.is_dir() else [path]
    samples: list[dict[str, Any]] = []
    seen_audio: set[str] = set()
    if path.is_dir():
        if not paths and mode != "historical":
            raise ValueError("Primary reanalysis requires a canonical export JSON file.")
        for json_path in paths:
            try:
                document = json.loads(json_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                if mode == "canonical":
                    raise ValueError(f"Sample export is unreadable JSON: {json_path}") from error
                continue
            if isinstance(document, Mapping) and (document.get("schemaVersion") == CANONICAL_EXPORT_SCHEMA_VERSION or document.get("studyVersion") in {STUDY_ID, "study-v2"}):
                return load_canonical_export_v2(document, manifest=manifest)
            parsed_documents.append((json_path, document))
    for json_path, document in parsed_documents:
        if isinstance(document, Mapping) and (
            document.get("schemaVersion") == CANONICAL_EXPORT_SCHEMA_VERSION
            or document.get("studyVersion") in {STUDY_ID, "study-v2"}
        ):
            return load_canonical_export_v2(document, manifest=manifest)
        if isinstance(document, list):
            documents = document
        else:
            documents = document.get("samples") if isinstance(document, Mapping) and isinstance(document.get("samples"), list) else [document]
        for item in documents:
            if not isinstance(item, Mapping):
                continue
            audio_value = item.get("audioPath") or item.get("audio_path")
            if audio_value:
                audio_path = Path(str(audio_value))
                if not audio_path.is_absolute():
                    audio_path = json_path.parent / audio_path
            else:
                audio_path = json_path.with_suffix(".wav")
            audio_path = audio_path.resolve()
            audio_hash = str(item.get("audioSha256") or item.get("sourceHash") or "")
            if not audio_hash and audio_path.exists():
                audio_hash = hashlib.sha256(audio_path.read_bytes()).hexdigest()
            manual = _extract_manual_segments(item)
            # A directory can contain the automatic comparison export before
            # its manual-review export.  Do not let an unlabeled JSON reserve
            # the SHA and hide the later ground-truth record.
            if not manual:
                continue
            if audio_hash and audio_hash in seen_audio:
                continue
            if audio_hash:
                seen_audio.add(audio_hash)
            manual_review = item.get("manualReview") if isinstance(item.get("manualReview"), Mapping) else {}
            reference = item.get("reference") if isinstance(item.get("reference"), Mapping) else {}
            reference_syllables = item.get("referenceSyllableIpa") or manual_review.get("referenceSyllableIpa") or [
                syllable.get("ipa") for syllable in reference.get("syllables", []) if isinstance(syllable, Mapping) and syllable.get("ipa")
            ]
            if not reference_syllables:
                reference_syllables = split_ipa_syllables(str(item.get("referenceIpa") or manual_review.get("referenceIpa") or reference.get("rawIpa") or ""))
            sample = {
                "id": str(item.get("sampleId") or item.get("id") or json_path.stem),
                "word": str(item.get("targetWord") or item.get("word") or manual_review.get("targetWord") or json_path.stem),
                "audioPath": str(audio_path),
                "audioSha256": audio_hash,
                "referenceIpa": item.get("referenceIpa") or manual_review.get("referenceIpa") or reference.get("rawIpa") or "",
                "referenceSyllableIpa": [str(value) for value in reference_syllables],
                "manualSegments": manual,
                "source": item.get("source"),
                "historical": item.get("historical"),
                "versions": {
                    "v2": _extract_version_segments(item, "v2"),
                    "v3": _extract_version_segments(item, "v3"),
                    "v4": _extract_version_segments(item, "v4"),
                },
                "certainty": item.get("certainty") or manual_review.get("certainty") or item.get("reviewStatus") or manual_review.get("reviewStatus") or "certain",
                "split": item.get("split"),
            }
            samples.append(sample)
    if mode == "historical":
        for sample in samples:
            sample["historicalCompatibility"] = {"sourceVersion": "study-v1", "promotionEligible": False}
            sample["historical"] = True
            sample["promotionEligible"] = False
            sample["split"] = None
    return samples


def select_historical_regression_set(samples: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return only the exact six historical records with verified source hashes.

    A word-based fallback is deliberately forbidden: a renamed or substituted
    recording must make the historical gate unavailable rather than silently
    changing the regression set.
    """

    by_id = {str(sample.get("id")): dict(sample) for sample in samples}
    selected = [by_id[sample_id] for sample_id in sorted(HISTORICAL_REGRESSION_IDS) if sample_id in by_id]
    if len(selected) != len(HISTORICAL_REGRESSION_IDS):
        return []
    hashes = [str(sample.get("sourceHash") or sample.get("audioSha256") or "").strip().lower() for sample in selected]
    expected_hashes = [HISTORICAL_REGRESSION_EXPECTED_HASHES.get(sample_id) for sample_id in sorted(HISTORICAL_REGRESSION_IDS)]
    if any(expected_hash is None for expected_hash in expected_hashes):
        return []
    if any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in hashes) or len(set(hashes)) != len(hashes) or hashes != expected_hashes:
        return []
    for sample, source_hash in zip(selected, hashes):
        sample["sourceHash"] = source_hash
        sample["historicalRegressionLocked"] = True
        sample["promotionEligible"] = False
    return selected


def _minmax(values: np.ndarray) -> np.ndarray:
    array = np.asarray(values, dtype=np.float64)
    if array.size == 0:
        return array
    low, high = float(np.nanpercentile(array, 10)), float(np.nanpercentile(array, 90))
    if high <= low + 1e-12:
        return np.zeros_like(array)
    return np.clip((array - low) / (high - low), 0.0, 1.0)


def _feature_at(features: Mapping[str, Any], key: str, time: float) -> float:
    times = np.asarray(features.get("times", []), dtype=np.float64)
    values = np.asarray(features.get(key, []), dtype=np.float64)
    if times.size == 0 or values.size == 0:
        return 0.0
    return float(values[int(np.argmin(np.abs(times - time)))])


def _candidate_indices(features: Mapping[str, Any], start: float, end: float) -> np.ndarray:
    times = np.asarray(features.get("times", []), dtype=np.float64)
    if times.size == 0:
        return np.asarray([], dtype=int)
    indexes = np.flatnonzero((times >= start) & (times <= end))
    if indexes.size:
        return indexes
    return np.asarray([int(np.argmin(np.abs(times - ((start + end) / 2.0))))], dtype=int)


def _score_series(features: Mapping[str, Any], key: str, indexes: np.ndarray) -> np.ndarray:
    values = np.asarray(features.get(key, []), dtype=np.float64)
    if values.size == 0:
        return np.zeros(indexes.size, dtype=np.float64)
    return _minmax(values[indexes])


def _nucleus_centres(
    features: Mapping[str, Any],
    boundaries: Sequence[float],
    spans: Sequence[Mapping[str, Any]] | None = None,
) -> list[float]:
    times = np.asarray(features.get("times", []), dtype=np.float64)
    energy = np.asarray(features.get("energy", []), dtype=np.float64)
    centres: list[float] = []
    for index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
        if spans and index < len(spans):
            nucleus_start = _as_float(spans[index].get("nucleusStartTime", spans[index].get("nucleus_start_time")))
            nucleus_end = _as_float(spans[index].get("nucleusEndTime", spans[index].get("nucleus_end_time")))
            if nucleus_start is not None and nucleus_end is not None and nucleus_end > nucleus_start:
                centres.append((nucleus_start + nucleus_end) / 2.0)
                continue
        indexes = _candidate_indices(features, float(start), float(end))
        if indexes.size and energy.size:
            centres.append(float(times[indexes[int(np.argmax(energy[indexes]))]]))
        else:
            centres.append((float(start) + float(end)) / 2.0)
    return centres


def generate_candidates(
    sample: Mapping[str, Any],
    features: Mapping[str, Any] | None = None,
    *,
    config: Mapping[str, float | int] | None = None,
) -> dict[str, list[float]]:
    """Generate V2/V3/V4, naive spectral, and gated context candidates."""

    options = dict(FEATURE_CONFIG)
    if config:
        options.update(config)
    versions = sample.get("versions") if isinstance(sample.get("versions"), Mapping) else {}
    if sample.get("_canonicalExportV2"):
        missing = [version for version in ("v2", "v3", "v4") if not isinstance(versions.get(version), Sequence) or isinstance(versions.get(version), (str, bytes, bytearray))]
        if missing:
            raise ValueError(f"Canonical study-v2 sample is missing genuine version payloads: {', '.join(missing)}")
    v3 = contiguous_boundaries(versions.get("v3") or []) if isinstance(versions, Mapping) else []
    v4 = contiguous_boundaries(versions.get("v4") or []) if isinstance(versions, Mapping) else []
    v2 = contiguous_boundaries(versions.get("v2") or []) if isinstance(versions, Mapping) else []
    base = v3 or v4 or v2
    if not base:
        # Never synthesize an automatic baseline from the manual labels.  That
        # would leak the ground truth into the candidate and make a missing
        # replay look perfect.
        return {"v2": [], "v3": [], "v4": [], "naiveSpectral": [], "contextAware": []}
    if not v2 and not sample.get("_canonicalExportV2"):
        v2 = list(base)
    if not v3 and not sample.get("_canonicalExportV2"):
        v3 = list(base)
    if not v4 and not sample.get("_canonicalExportV2"):
        v4 = list(v3)
    naive = list(v3)
    context = list(v3)
    if features is None or len(v3) < 3:
        return {"v2": v2, "v3": v3, "v4": v4, "naiveSpectral": naive, "contextAware": context}
    v3_spans = versions.get("v3") if isinstance(versions, Mapping) and isinstance(versions.get("v3"), Sequence) else None
    centres = _nucleus_centres(features, v3, v3_spans)
    transitions = [
        boundary_transition(left, right)
        for left, right in zip(sample.get("referenceSyllableIpa") or [], (sample.get("referenceSyllableIpa") or [])[1:])
    ]
    times = np.asarray(features.get("times", []), dtype=np.float64)
    for boundary_index in range(1, len(v3) - 1):
        anchor = float(v3[boundary_index])
        left_centre = centres[boundary_index - 1] if boundary_index - 1 < len(centres) else float(v3[boundary_index - 1])
        right_centre = centres[boundary_index] if boundary_index < len(centres) else float(v3[boundary_index + 1])
        lower = max(min(left_centre, right_centre), anchor - float(options["searchMs"]) / 1000.0)
        upper = min(max(left_centre, right_centre), anchor + float(options["searchMs"]) / 1000.0)
        if upper <= lower:
            continue
        indexes = _candidate_indices(features, lower, upper)
        if indexes.size == 0 or times.size == 0:
            continue
        cue_arrays = {
            "spectral": _score_series(features, "spectralFlux", indexes),
            "absoluteSpectral": _score_series(features, "absoluteFlux", indexes),
            "highBand": _score_series(features, "highBandFlux", indexes),
            "broadband": _score_series(features, "broadbandChange", indexes),
            "energy": _score_series(features, "energySlope", indexes),
            "voicing": _score_series(features, "voicingChange", indexes),
        }
        # Registered naive baseline: choose the strongest spectral-change
        # landmark, without consulting the IPA context class.
        naive_score = cue_arrays["spectral"]
        naive_index = int(indexes[int(np.argmax(naive_score))])
        naive[boundary_index] = float(times[naive_index])
        transition = transitions[boundary_index - 1] if boundary_index - 1 < len(transitions) else {"family": "other"}
        family = transition.get("family")
        if family in {"fricative", "affricate", "fricative_affricate"}:
            cue_names = ("highBand", "spectral")
        elif family == "stop" or transition.get("left") == "stop":
            cue_names = ("broadband", "energy", "voicing")
        elif family in {"nasal", "liquid_glide", "vowel"}:
            cue_names = ("spectral", "energy", "voicing")
        else:
            cue_names = ("spectral", "broadband", "energy")
        scores = [(name, cue_arrays[name]) for name in cue_names]
        peaks = sorted(
            ((float(np.max(series)) if series.size else 0.0, name, int(indexes[int(np.argmax(series))])) for name, series in scores),
            reverse=True,
        )
        if not peaks:
            continue
        best_score, _, best_index = peaks[0]
        agreement = sum(
            1
            for _, _, peak_index in peaks[1:]
            if abs(float(times[peak_index]) - float(times[best_index])) <= float(options["agreementWindowMs"]) / 1000.0
        )
        second_score = peaks[1][0] if len(peaks) > 1 else 0.0
        if best_score >= float(options["prominence"]) and agreement >= 1 and best_score - second_score <= float(options["agreementMargin"]):
            context[boundary_index] = float(times[best_index])
        else:
            context[boundary_index] = anchor
    for candidate in (naive, context):
        for index in range(1, len(candidate) - 1):
            candidate[index] = max(float(candidate[index - 1]) + 1e-6, min(float(candidate[index]), float(candidate[index + 1]) - 1e-6))
    return {"v2": v2, "v3": v3, "v4": v4, "naiveSpectral": naive, "contextAware": context}


def _sample_metric_rows(
    samples: Sequence[Mapping[str, Any]], candidate_name: str, *, internal_only: bool = True
) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    excluded: list[str] = []
    for sample in samples:
        manual = contiguous_boundaries(sample.get("manualSegments") or [])
        candidates = sample.get("candidates") if isinstance(sample.get("candidates"), Mapping) else {}
        actual = candidates.get(candidate_name) if isinstance(candidates, Mapping) else None
        if not manual or not isinstance(actual, Sequence) or len(actual) != len(manual):
            excluded.append(str(sample.get("id")))
            continue
        signed = boundary_errors([float(value) for value in actual], manual, internal_only=internal_only)
        indexes = range(1, len(manual) - 1) if internal_only else range(len(manual))
        for index, error in zip(indexes, signed):
            transition_types = sample.get("transitionTypes") or []
            rows.append(
                {
                    "sampleId": str(sample.get("id")),
                    "word": str(sample.get("word") or sample.get("id")),
                    "boundaryIndex": int(index),
                    "errorMs": round(error * 1000.0, 6),
                    "absErrorMs": round(abs(error) * 1000.0, 6),
                    "actualMs": round(float(actual[index]) * 1000.0, 6),
                    "manualMs": round(float(manual[index]) * 1000.0, 6),
                    "transitionType": str(transition_types[index - 1]) if internal_only and index - 1 < len(transition_types) else "unknown",
                }
            )
    return rows, excluded


def summarize_candidate(samples: Sequence[Mapping[str, Any]], candidate_name: str) -> dict[str, Any]:
    rows, excluded = _sample_metric_rows(samples, candidate_name)
    absolute = [float(row["absErrorMs"]) / 1000.0 for row in rows]
    signed = [float(row["errorMs"]) / 1000.0 for row in rows]
    summary = summarize_errors(absolute)
    summary["signedBiasMs"] = round(sum(signed) * 1000.0 / len(signed), 3) if signed else 0.0
    summary["sampleCount"] = len({row["sampleId"] for row in rows})
    summary["excludedSampleIds"] = excluded
    return summary


def summarize_candidate_edges(samples: Sequence[Mapping[str, Any]], candidate_name: str) -> dict[str, Any]:
    """Summarize word start/end plus internal boundaries for diagnostics."""

    rows, excluded = _sample_metric_rows(samples, candidate_name, internal_only=False)
    absolute = [float(row["absErrorMs"]) / 1000.0 for row in rows]
    signed = [float(row["errorMs"]) / 1000.0 for row in rows]
    summary = summarize_errors(absolute)
    summary["signedBiasMs"] = round(sum(signed) * 1000.0 / len(signed), 3) if signed else 0.0
    summary["sampleCount"] = len({row["sampleId"] for row in rows})
    summary["excludedSampleIds"] = excluded
    return summary


def _word_mae(rows: Sequence[Mapping[str, Any]]) -> dict[str, float]:
    grouped: defaultdict[str, list[float]] = defaultdict(list)
    for row in rows:
        grouped[str(row["word"])].append(float(row["absErrorMs"]))
    return {word: sum(values) / len(values) for word, values in grouped.items() if values}


def bootstrap_improvement_interval(
    samples: Sequence[Mapping[str, Any]],
    candidate_name: str,
    baseline_name: str,
    *,
    resamples: int = DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:
    """Bootstrap baseline MAE minus candidate MAE, clustered by word."""

    candidate_rows, _ = _sample_metric_rows(samples, candidate_name)
    baseline_rows, _ = _sample_metric_rows(samples, baseline_name)
    candidate_words = _word_mae(candidate_rows)
    baseline_words = _word_mae(baseline_rows)
    words = sorted(set(candidate_words) & set(baseline_words))
    if not words:
        return {"candidate": candidate_name, "baseline": baseline_name, "wordCount": 0, "resamples": 0, "lowerMs": 0.0, "medianMs": 0.0, "upperMs": 0.0, "passes": False}
    rng = np.random.default_rng(seed)
    improvements = np.empty(max(1, int(resamples)), dtype=np.float64)
    word_array = np.asarray(words, dtype=object)
    for index in range(improvements.size):
        draw = rng.choice(word_array, size=len(words), replace=True)
        candidate_mean = float(np.mean([candidate_words[str(word)] for word in draw]))
        baseline_mean = float(np.mean([baseline_words[str(word)] for word in draw]))
        improvements[index] = baseline_mean - candidate_mean
    return {
        "candidate": candidate_name,
        "baseline": baseline_name,
        "wordCount": len(words),
        "resamples": int(improvements.size),
        "seed": int(seed),
        "lowerMs": round(float(np.percentile(improvements, 2.5)), 3),
        "medianMs": round(float(np.percentile(improvements, 50.0)), 3),
        "upperMs": round(float(np.percentile(improvements, 97.5)), 3),
        "passes": bool(float(np.percentile(improvements, 2.5)) > 0.0),
    }


def evaluate_gates(
    report: Mapping[str, Any],
    *,
    candidate_name: str = "contextAware",
    historical_sample_ids: Sequence[str] = (),
) -> dict[str, Any]:
    """Apply the pre-registered development/holdout and regression gates."""

    holdout = report.get("holdout") if isinstance(report.get("holdout"), Mapping) else {}
    history = report.get("historical") if isinstance(report.get("historical"), Mapping) else {}
    holdout_summaries = holdout.get("summaries") if isinstance(holdout.get("summaries"), Mapping) else {}
    history_summaries = history.get("summaries") if isinstance(history.get("summaries"), Mapping) else {}
    candidate = holdout_summaries.get(candidate_name) if isinstance(holdout_summaries, Mapping) else None
    v3 = holdout_summaries.get("v3") if isinstance(holdout_summaries, Mapping) else None
    v4 = holdout_summaries.get("v4") if isinstance(holdout_summaries, Mapping) else None
    checks: dict[str, bool] = {}
    reasons: list[str] = []
    if (
        not isinstance(candidate, Mapping)
        or not isinstance(v3, Mapping)
        or not isinstance(v4, Mapping)
        or int(candidate.get("edgeCount", 0) or 0) <= 0
        or int(v3.get("edgeCount", 0) or 0) <= 0
        or int(v4.get("edgeCount", 0) or 0) <= 0
    ):
        checks["holdoutMetricsAvailable"] = False
        reasons.append("missing holdout candidate or baseline metrics")
    else:
        checks["holdoutMetricsAvailable"] = True
        checks["holdoutMaeLowerThanV3AndV4"] = float(candidate.get("maeMs", math.inf)) < min(float(v3.get("maeMs", math.inf)), float(v4.get("maeMs", math.inf)))
        checks["holdoutWithin40AtLeastBestBaseline"] = float(candidate.get("within40Pct", 0.0)) >= max(float(v3.get("within40Pct", 0.0)), float(v4.get("within40Pct", 0.0)))
        if not checks["holdoutMaeLowerThanV3AndV4"]:
            reasons.append("holdout MAE is not lower than both V3 and V4")
        if not checks["holdoutWithin40AtLeastBestBaseline"]:
            reasons.append("holdout within-40ms is below the better baseline")
    bootstrap = report.get("bootstrap") if isinstance(report.get("bootstrap"), Mapping) else {}
    for baseline in ("v3", "v4"):
        item = bootstrap.get(baseline) if isinstance(bootstrap, Mapping) else None
        checks[f"bootstrapPositiveAgainst{baseline.upper()}"] = bool(isinstance(item, Mapping) and item.get("passes") is True)
        if not checks[f"bootstrapPositiveAgainst{baseline.upper()}"]:
            reasons.append(f"bootstrap interval against {baseline} is not strictly positive")
    per_word = holdout.get("perWord", {}) if isinstance(holdout, Mapping) else {}
    regression_words = []
    if isinstance(per_word, Mapping):
        for word, values in per_word.items():
            if not isinstance(values, Mapping):
                continue
            candidate_mae = _as_float(values.get(candidate_name), math.inf) or math.inf
            v4_mae = _as_float(values.get("v4"), math.inf) or math.inf
            if candidate_mae - v4_mae > 20.0:
                regression_words.append(str(word))
    checks["noHoldoutWordOver20MsWorseThanV4"] = not regression_words
    if regression_words:
        reasons.append("holdout word regression over 20ms: " + ", ".join(regression_words))
    history_candidate = history_summaries.get(candidate_name) if isinstance(history_summaries, Mapping) else None
    history_v3 = history_summaries.get("v3") if isinstance(history_summaries, Mapping) else None
    history_v4 = history_summaries.get("v4") if isinstance(history_summaries, Mapping) else None
    if isinstance(history_candidate, Mapping) and isinstance(history_v3, Mapping) and isinstance(history_v4, Mapping):
        checks["historicalMaeLowerThanV3AndV4"] = float(history_candidate.get("maeMs", math.inf)) < min(float(history_v3.get("maeMs", math.inf)), float(history_v4.get("maeMs", math.inf)))
    else:
        checks["historicalMaeLowerThanV3AndV4"] = False
    if not checks["historicalMaeLowerThanV3AndV4"]:
        reasons.append("historical-set MAE is not lower than both V3 and V4")
    history_regressions = []
    # The gate is intentionally per recording, not only per word aggregate.
    # If a CRM export predates this field, fall back to the word aggregate so
    # old reports remain readable.
    history_per_sample = history.get("perSample", {}) if isinstance(history, Mapping) else {}
    history_regression_values = history_per_sample if isinstance(history_per_sample, Mapping) and history_per_sample else history.get("perWord", {}) if isinstance(history, Mapping) else {}
    if isinstance(history_regression_values, Mapping):
        for sample_id, values in history_regression_values.items():
            if not isinstance(values, Mapping):
                continue
            candidate_mae = _as_float(values.get(candidate_name), math.inf) or math.inf
            v4_mae = _as_float(values.get("v4"), math.inf) or math.inf
            if candidate_mae - v4_mae > 10.0:
                history_regressions.append(str(sample_id))
    checks["noHistoricalSampleOver10MsWorseThanV4"] = not history_regressions
    if history_regressions:
        reasons.append("historical sample regression over 10ms: " + ", ".join(history_regressions))
    recording_regressions = []
    if isinstance(history_regression_values, Mapping):
        for sample_id, values in history_regression_values.items():
            if not isinstance(values, Mapping) or "recording" not in str(sample_id).lower():
                continue
            candidate_mae = _as_float(values.get(candidate_name), math.inf) or math.inf
            v4_mae = _as_float(values.get("v4"), math.inf) or math.inf
            if candidate_mae > v4_mae + 1e-9:
                recording_regressions.append(str(sample_id))
    checks["recordingDoesNotRegress"] = not recording_regressions
    if recording_regressions:
        reasons.append("recording sample regresses against V4")
    promotion_gate = report.get("promotionGate") if isinstance(report.get("promotionGate"), Mapping) else {}
    checks["assistedReviewPromotionGate"] = promotion_gate.get("eligible") is True
    if not checks["assistedReviewPromotionGate"]:
        reasons.append("assisted-review promotion gate is unavailable or not proven")
    checks["developmentConfigFrozen"] = bool(report.get("developmentConfigHash")) and report.get("developmentConfigHash") == report.get("holdoutConfigHash")
    if not checks["developmentConfigFrozen"]:
        reasons.append("development configuration hash is not frozen for holdout evaluation")
    evaluation = report.get("evaluation") if isinstance(report.get("evaluation"), Mapping) else {}
    evaluation_mode = report.get("evaluationMode") or evaluation.get("holdoutMode") or "authoritative-first"
    checks["authoritativeHoldoutEvaluation"] = evaluation_mode == "authoritative-first"
    if not checks["authoritativeHoldoutEvaluation"]:
        reasons.append("exploratory reruns are explicitly non-promotable")
    checks["historicalRegressionAvailable"] = report.get("historicalRegressionAvailable") is True
    if not checks["historicalRegressionAvailable"]:
        reasons.append("locked six-recording historical regression set is unavailable")
    checks["all"] = all(checks.values()) if checks else False
    return {"status": "pass" if checks["all"] else "fail", "checks": checks, "reasons": reasons}


def _prepare_samples(
    samples: Sequence[Mapping[str, Any]],
    feature_config: Mapping[str, Any] | None = None,
    *,
    keep_features: bool = False,
) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for source in samples:
        sample = dict(source)
        features: dict[str, Any] | None = None
        path = Path(str(sample.get("audioPath") or ""))
        if path.exists():
            try:
                features = extract_spectrogram_features_from_wav(path, feature_config)
            except (OSError, EOFError, wave.Error, ValueError):
                features = None
        sample["candidates"] = generate_candidates(sample, features, config=feature_config)
        if keep_features:
            sample["_features"] = features
        sample["featureConfig"] = features.get("config") if features else dict(feature_config or FEATURE_CONFIG)
        prepared.append(sample)
    return prepared


def is_primary_benchmark_sample(sample: Mapping[str, Any]) -> bool:
    """Return false for labels intentionally retained but excluded from scoring."""

    certainty = str(sample.get("certainty") or "certain").strip().lower()
    return certainty not in {"unsure", "uncertain", "needs_review", "needs-review"}


def tune_context_parameters(
    development_samples: Sequence[Mapping[str, Any]],
    *,
    base_config: Mapping[str, Any] | None = None,
    parameter_grid: Sequence[Mapping[str, float | int]] = CONTEXT_PARAMETER_GRID,
) -> dict[str, Any]:
    """Select one context configuration using development labels only.

    Selection is lexicographic: configurations that satisfy the development
    no-regression guard rank first, then lower MAE, higher within-40ms rate,
    and finally less movement from V3.  Holdout and historical samples are
    never passed to this function by :func:`run_reanalysis`.
    """

    fixed = dict(FEATURE_CONFIG)
    if base_config:
        fixed.update(base_config)
    if not development_samples:
        return {"selected": fixed, "candidates": [], "reason": "no development labels"}
    evaluations: list[dict[str, Any]] = []
    feature_prepared = _prepare_samples(development_samples, fixed, keep_features=True)
    for grid_item in parameter_grid:
        config = dict(fixed)
        config.update(grid_item)
        prepared = []
        for source in feature_prepared:
            sample = dict(source)
            sample["candidates"] = generate_candidates(sample, source.get("_features"), config=config)
            prepared.append(sample)
        context = summarize_candidate(prepared, "contextAware")
        v3 = summarize_candidate(prepared, "v3")
        v4 = summarize_candidate(prepared, "v4")
        rows_context, _ = _sample_metric_rows(prepared, "contextAware")
        rows_v3, _ = _sample_metric_rows(prepared, "v3")
        movement = [
            abs(float(context_row["actualMs"]) - float(v3_row["actualMs"]))
            for context_row, v3_row in zip(rows_context, rows_v3)
            if context_row.get("sampleId") == v3_row.get("sampleId") and context_row.get("boundaryIndex") == v3_row.get("boundaryIndex")
        ]
        per_word: defaultdict[str, list[float]] = defaultdict(list)
        for row in rows_context:
            per_word[str(row["word"])].append(float(row["absErrorMs"]))
        v4_words = _word_mae(_sample_metric_rows(prepared, "v4")[0])
        word_regression = any(
            (sum(values) / len(values)) - v4_words.get(word, math.inf) > 20.0
            for word, values in per_word.items()
            if word in v4_words
        )
        no_regression = float(context.get("maeMs", math.inf)) <= min(float(v3.get("maeMs", math.inf)), float(v4.get("maeMs", math.inf))) and not word_regression
        evaluations.append(
            {
                "config": config,
                "noRegression": no_regression,
                "maeMs": context.get("maeMs", math.inf),
                "within40Pct": context.get("within40Pct", 0.0),
                "movementMs": round(sum(movement) / len(movement), 6) if movement else 0.0,
            }
        )
    evaluations.sort(
        key=lambda item: (
            0 if item["noRegression"] else 1,
            float(item["maeMs"]),
            -float(item["within40Pct"]),
            float(item["movementMs"]),
            json.dumps(item["config"], sort_keys=True),
        )
    )
    selected = evaluations[0]["config"] if evaluations else fixed
    return {"selected": selected, "candidates": evaluations, "reason": "development-only lexicographic selection"}


def _summaries_for(samples: Sequence[Mapping[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    names = ("v2", "v3", "v4", "naiveSpectral", "contextAware")
    summaries = {name: summarize_candidate(samples, name) for name in names}
    per_word: defaultdict[str, dict[str, float]] = defaultdict(dict)
    for name in names:
        rows, _ = _sample_metric_rows(samples, name)
        for word, value in _word_mae(rows).items():
            per_word[word][name] = round(value, 3)
    return summaries, {word: dict(values) for word, values in sorted(per_word.items())}


def _per_sample_mae(samples: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for sample in samples:
        sample_id = str(sample.get("id"))
        values: dict[str, float] = {}
        for name in ("v2", "v3", "v4", "naiveSpectral", "contextAware"):
            rows, _ = _sample_metric_rows([sample], name)
            values[name] = round(sum(float(row["absErrorMs"]) for row in rows) / len(rows), 3) if rows else 0.0
        result[sample_id] = values
    return result


def _boundary_context_results(sample: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Return one auditable context/correction row per shared boundary."""

    manual = contiguous_boundaries(sample.get("manualSegments") or [])
    candidates = sample.get("candidates") if isinstance(sample.get("candidates"), Mapping) else {}
    if len(manual) < 3 or not isinstance(candidates, Mapping):
        return []
    reference = sample.get("referenceSyllableIpa") or []
    rows: list[dict[str, Any]] = []
    for index in range(1, len(manual) - 1):
        transition = (
            boundary_transition(reference[index - 1], reference[index])
            if index < len(reference)
            else {"left": "unknown", "right": "unknown", "label": "unknown", "family": "unknown"}
        )
        values: dict[str, Any] = {
            "sampleId": str(sample.get("id")),
            "word": str(sample.get("word") or sample.get("id")),
            "boundaryIndex": index,
            "transition": transition,
            "manualMs": round(float(manual[index]) * 1000.0, 6),
        }
        for name in ("v2", "v3", "v4", "naiveSpectral", "contextAware"):
            values[f"{name}Ms"] = round(float(candidates.get(name, [])[index]) * 1000.0, 6) if isinstance(candidates.get(name), Sequence) and len(candidates.get(name)) == len(manual) else None
        v3_ms = values.get("v3Ms")
        context_ms = values.get("contextAwareMs")
        moved = v3_ms is not None and context_ms is not None and abs(float(context_ms) - float(v3_ms)) > 0.001
        values["contextMovementMs"] = round(float(context_ms) - float(v3_ms), 6) if moved else 0.0
        values["contextAccepted"] = bool(moved)
        values["decision"] = "selected-context-correction" if moved else "rejected-retain-v3"
        rows.append(values)
    return rows


def _summarize_boundary_contexts(samples: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    contexts: defaultdict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for name in ("v2", "v3", "v4", "naiveSpectral", "contextAware"):
        rows, _ = _sample_metric_rows(samples, name)
        for row in rows:
            contexts[f"{name}:{row.get('transitionType') or 'unknown'}"].append(row)
    result: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for key, rows in contexts.items():
        candidate_name, context = key.split(":", 1)
        result[candidate_name][context] = summarize_errors(float(row["absErrorMs"]) / 1000.0 for row in rows)
    return {name: dict(values) for name, values in sorted(result.items())}


def run_reanalysis(
    samples: Sequence[Mapping[str, Any]],
    *,
    manifest: Mapping[str, Any] | None = None,
    bootstrap_resamples: int = DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: int = DEFAULT_SEED,
    feature_config: Mapping[str, Any] | None = None,
    evaluation_mode: str = "authoritative-first",
) -> dict[str, Any]:
    """Run the complete offline experiment and return a JSON-safe report."""

    if evaluation_mode not in {"authoritative-first", "exploratory"}:
        raise ValueError("evaluation_mode must be authoritative-first or exploratory")

    manifest_by_word = {
        str(entry.get("targetWord")): entry
        for entry in (manifest.get("entries", []) if isinstance(manifest, Mapping) else [])
        if isinstance(entry, Mapping)
    }
    assigned_inputs: list[dict[str, Any]] = []
    for source in samples:
        sample = dict(source)
        entry = manifest_by_word.get(str(sample.get("word")))
        historical_marker = bool(
            sample.get("historical")
            or sample.get("historicalCompatibility")
            or sample.get("promotionEligible") is False
            or sample.get("set") == "historical"
            or sample.get("source") in {"previous", "historical", "pronounce-mode-local"}
            or "manual-review" in str(sample.get("id", "")).lower()
        )
        if entry and not historical_marker:
            sample["split"] = entry.get("split")
            sample["transitionTypes"] = entry.get("transitionTypes", [])
        elif historical_marker:
            sample["split"] = None
        assigned_inputs.append(sample)
    development_inputs = [sample for sample in assigned_inputs if sample.get("split") == "development" and is_primary_benchmark_sample(sample)]
    supplied_config = dict(FEATURE_CONFIG)
    supplied_config.update(feature_config or {})
    tuning = {
        "selected": supplied_config,
        "candidates": [],
        "reason": "caller supplied feature configuration" if feature_config else "no development labels",
    }
    if feature_config is None and development_inputs:
        tuning = tune_context_parameters(development_inputs)
    selected_config = tuning["selected"]
    configuration_hash = _json_hash({"featureConfig": selected_config, "candidate": "contextAware"})
    locked_historical = select_historical_regression_set(assigned_inputs)
    historical_regression_available = len(locked_historical) == len(HISTORICAL_REGRESSION_IDS)
    assisted_review_eligible = bool(assigned_inputs) and all(
        sample.get("certainty") == "certain"
        and sample.get("annotationProtocol") == "automatic-visible-assisted-v1"
        and isinstance(sample.get("assistedMetadata"), Mapping)
        and sample.get("assistedMetadata", {}).get("assisted") is True
        and sample.get("promotionEligible", True) is not False
        for sample in assigned_inputs
        if sample.get("split") in {"development", "holdout"}
    )
    prepared = _prepare_samples(assigned_inputs, selected_config)
    for sample, assigned in zip(prepared, assigned_inputs):
        sample["split"] = assigned.get("split")
        sample["transitionTypes"] = assigned.get("transitionTypes", [])
    uncertain = [sample for sample in prepared if not is_primary_benchmark_sample(sample)]
    certain_samples = [sample for sample in prepared if is_primary_benchmark_sample(sample)]
    historical = [sample for sample in certain_samples if not sample.get("split")]
    benchmark_samples = [sample for sample in certain_samples if sample.get("split") in {"development", "holdout"}]
    development = [sample for sample in benchmark_samples if sample.get("split") == "development"]
    holdout = [sample for sample in benchmark_samples if sample.get("split") == "holdout"]
    all_summaries, all_per_word = _summaries_for(prepared)
    benchmark_summaries, benchmark_per_word = _summaries_for(benchmark_samples)
    development_summaries, development_per_word = _summaries_for(development)
    holdout_summaries, holdout_per_word = _summaries_for(holdout)
    historical_summaries, historical_per_word = _summaries_for(historical)
    bootstrap = {
        baseline: bootstrap_improvement_interval(holdout, "contextAware", baseline, resamples=bootstrap_resamples, seed=seed)
        for baseline in ("v3", "v4")
    }
    authoritative_first = evaluation_mode == "authoritative-first"
    report: dict[str, Any] = {
        "studyId": STUDY_ID,
        "reportVersion": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "evaluationMode": evaluation_mode,
        "authoritativeHoldout": authoritative_first,
        "holdoutArtifactPolicy": "immutable-first-authoritative; reruns require explicit exploratory mode" if authoritative_first else "exploratory-rerun; never eligible for promotion",
        "featureConfig": dict(selected_config),
        "configurationHash": configuration_hash,
        "developmentConfigHash": configuration_hash,
        "holdoutConfigHash": configuration_hash,
        "evaluation": {"holdoutMode": evaluation_mode, "exploratoryReruns": "must retain this frozen developmentConfigHash", "authoritativeFirst": authoritative_first},
        "anchoringBiasDisclosure": "Automatic V2/V3/V4 boundaries were visible during assisted manual review; manual labels are therefore not independent of the shown baselines.",
        "promotionGate": {"name": "assisted-review promotion gate", "eligible": assisted_review_eligible and authoritative_first, "reason": "requires authoritative-first mode, certain canonical samples, exact assisted protocol, and non-promotable historical exclusions"},
        "historicalRegressionAvailable": historical_regression_available,
        "tuning": tuning,
        "sampleCounts": {"all": len(prepared), "benchmark": len(benchmark_samples), "uncertain": len(uncertain), "development": len(development), "holdout": len(holdout), "historical": len(historical)},
        "summaries": benchmark_summaries,
        "perWord": benchmark_per_word,
        "endpointSummaries": {name: summarize_candidate_edges(benchmark_samples, name) for name in ("v2", "v3", "v4", "naiveSpectral", "contextAware")},
        "allIncludingUncertain": {"summaries": all_summaries, "perWord": all_per_word, "boundaryContexts": _summarize_boundary_contexts(prepared)},
        "boundaryContexts": _summarize_boundary_contexts(benchmark_samples),
        "development": {"summaries": development_summaries, "perWord": development_per_word, "perSample": _per_sample_mae(development), "endpointSummaries": {name: summarize_candidate_edges(development, name) for name in ("v2", "v3", "v4", "naiveSpectral", "contextAware")}},
        "holdout": {"summaries": holdout_summaries, "perWord": holdout_per_word, "perSample": _per_sample_mae(holdout), "endpointSummaries": {name: summarize_candidate_edges(holdout, name) for name in ("v2", "v3", "v4", "naiveSpectral", "contextAware")}, "boundaryContexts": _summarize_boundary_contexts(holdout)},
        "historical": {"summaries": historical_summaries, "perWord": historical_per_word, "perSample": _per_sample_mae(historical), "endpointSummaries": {name: summarize_candidate_edges(historical, name) for name in ("v2", "v3", "v4", "naiveSpectral", "contextAware")}, "boundaryContexts": _summarize_boundary_contexts(historical)},
        "bootstrap": bootstrap,
        "gates": {},
        "sampleReports": [],
    }
    for sample in prepared:
        sample_report = {
            "sampleId": sample.get("id"),
            "word": sample.get("word"),
            "split": sample.get("split") or "historical",
            "certainty": sample.get("certainty") or "certain",
            "excludedFromPrimary": not is_primary_benchmark_sample(sample) or sample.get("split") not in {"development", "holdout"},
            "promotionEligible": bool(sample.get("promotionEligible", True)) and not bool(sample.get("historicalCompatibility")),
            "transitionTypes": sample.get("transitionTypes", []),
            "candidates": sample.get("candidates", {}),
        }
        per_candidate: dict[str, Any] = {}
        for name in ("v2", "v3", "v4", "naiveSpectral", "contextAware"):
            rows, excluded = _sample_metric_rows([sample], name)
            per_candidate[name] = {
                "metrics": summarize_errors([float(row["absErrorMs"]) / 1000.0 for row in rows]),
                "excluded": excluded,
                "boundaries": sample.get("candidates", {}).get(name, []),
            }
        baseline_boundaries = sample.get("candidates", {}).get("v3", [])
        selected_boundaries = sample.get("candidates", {}).get("contextAware", [])
        manual_boundaries = contiguous_boundaries(sample.get("manualSegments") or [])
        transition_types = sample.get("transitionTypes") or []
        corrections = []
        for index in range(1, max(1, min(len(baseline_boundaries), len(selected_boundaries), len(manual_boundaries)) - 1)):
            accepted = abs(float(selected_boundaries[index]) - float(baseline_boundaries[index])) > 1e-9
            corrections.append(
                {
                    "boundaryIndex": index,
                    "transitionType": str(transition_types[index - 1]) if index - 1 < len(transition_types) else "unknown",
                    "manualMs": round(float(manual_boundaries[index]) * 1000.0, 3),
                    "v3Ms": round(float(baseline_boundaries[index]) * 1000.0, 3),
                    "contextAwareMs": round(float(selected_boundaries[index]) * 1000.0, 3),
                    "movementMs": round((float(selected_boundaries[index]) - float(baseline_boundaries[index])) * 1000.0, 3),
                    "accepted": accepted,
                    "decision": "selected-context-correction" if accepted else "rejected-retain-v3",
                }
            )
        sample_report["candidates"] = per_candidate
        v3_metrics = per_candidate.get("v3", {}).get("metrics", {})
        context_metrics = per_candidate.get("contextAware", {}).get("metrics", {})
        sample_report["corrections"] = corrections
        sample_report["beforeAfter"] = {
            "baseline": "v3",
            "candidate": "contextAware",
            "v3MaeMs": v3_metrics.get("maeMs", 0.0),
            "contextAwareMaeMs": context_metrics.get("maeMs", 0.0),
            "deltaMaeMs": round(float(context_metrics.get("maeMs", 0.0)) - float(v3_metrics.get("maeMs", 0.0)), 3),
        }
        report["sampleReports"].append(sample_report)
    report["gates"] = evaluate_gates(report, historical_sample_ids=[str(sample.get("id")) for sample in historical])
    return report


def _flatten_report_rows(report: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sample in report.get("sampleReports", []) if isinstance(report.get("sampleReports"), list) else []:
        if not isinstance(sample, Mapping):
            continue
        for name, candidate in (sample.get("candidates") or {}).items():
            if not isinstance(candidate, Mapping):
                continue
            metrics = candidate.get("metrics") or {}
            rows.append({
                "sampleId": sample.get("sampleId"),
                "word": sample.get("word"),
                "split": sample.get("split"),
                "rowType": "aggregate",
                "candidate": name,
                "edgeCount": metrics.get("edgeCount", 0),
                "maeMs": metrics.get("maeMs", 0.0),
                "medianMs": metrics.get("medianMs", 0.0),
                "p90Ms": metrics.get("p90Ms", 0.0),
                "maxMs": metrics.get("maxMs", 0.0),
                "within40Pct": metrics.get("within40Pct", 0.0),
            })
        for correction in sample.get("corrections", []) if isinstance(sample.get("corrections"), list) else []:
            if not isinstance(correction, Mapping):
                continue
            actual = float(correction.get("contextAwareMs", 0.0))
            manual = float(correction.get("manualMs", 0.0))
            rows.append(
                {
                    "sampleId": sample.get("sampleId"),
                    "word": sample.get("word"),
                    "split": sample.get("split"),
                    "rowType": "boundary",
                    "candidate": "contextAware",
                    "transitionType": correction.get("transitionType", "unknown"),
                    "boundaryIndex": correction.get("boundaryIndex"),
                    "actualMs": actual,
                    "manualMs": manual,
                    "errorMs": round(actual - manual, 6),
                    "absErrorMs": round(abs(actual - manual), 6),
                    "selectedCorrection": correction.get("accepted", False),
                }
            )
    return rows


def write_outputs(report: Mapping[str, Any], output_dir: str | Path) -> dict[str, Path]:
    """Write versioned JSON/CSV/Markdown artifacts and return their paths."""

    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    evaluation = report.get("evaluation") if isinstance(report.get("evaluation"), Mapping) else {}
    evaluation_mode = str(report.get("evaluationMode") or evaluation.get("holdoutMode") or "authoritative-first")
    if evaluation_mode not in {"authoritative-first", "exploratory"}:
        raise ValueError("report evaluationMode must be authoritative-first or exploratory")
    authoritative_marker = directory / f"{STUDY_ID}-authoritative-first.marker.json"
    if evaluation_mode == "authoritative-first" and authoritative_marker.exists():
        raise FileExistsError(
            "The authoritative-first holdout marker already exists; rerun with evaluation_mode='exploratory'."
        )
    base_stem = f"{STUDY_ID}-{report.get('configurationHash', 'report')[:12]}"
    if evaluation_mode == "authoritative-first":
        stem = base_stem
        planned_paths = [directory / f"{stem}.json", directory / f"{stem}.csv", directory / f"{stem}.md"]
        if any(path.exists() for path in planned_paths):
            raise FileExistsError(
                "The authoritative-first holdout artifacts already exist; rerun with evaluation_mode='exploratory'."
            )
    else:
        nonce = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}-{uuid.uuid4().hex[:8]}"
        stem = f"{base_stem}-exploratory-{nonce}"
    json_path = directory / f"{stem}.json"
    csv_path = directory / f"{stem}.csv"
    markdown_path = directory / f"{stem}.md"
    written_paths: list[Path] = []
    marker_created = False
    try:
        json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written_paths.append(json_path)
        rows = _flatten_report_rows(report)
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "sampleId", "word", "split", "rowType", "candidate", "transitionType", "boundaryIndex",
                    "edgeCount", "maeMs", "medianMs", "p90Ms", "maxMs", "within40Pct",
                    "actualMs", "manualMs", "errorMs", "absErrorMs", "selectedCorrection",
                ],
                extrasaction="ignore",
            )
            writer.writeheader()
            writer.writerows(rows)
        written_paths.append(csv_path)
        lines = [
        f"# {STUDY_ID} reanalysis",
        "",
        f"Evaluation mode: **{evaluation_mode}**",
        f"Holdout artifact policy: {report.get('holdoutArtifactPolicy', '')}",
        "",
        f"Status: **{(report.get('gates') or {}).get('status', 'pending')}**",
        f"Configuration hash: `{report.get('configurationHash', '')}`",
        f"Assisted-review promotion gate: **{str((report.get('promotionGate') or {}).get('eligible', False)).upper()}**",
        f"Historical regression set available: **{str(report.get('historicalRegressionAvailable', False)).upper()}**",
        f"Anchoring-bias disclosure: {report.get('anchoringBiasDisclosure', '')}",
        "",
        "## Aggregate metrics",
        "",
        "| Candidate | Samples | Edges | MAE (ms) | Median (ms) | P90 (ms) | Within 40 ms |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
        for name, summary in (report.get("summaries") or {}).items():
            lines.append(f"| {name} | {summary.get('sampleCount', 0)} | {summary.get('edgeCount', 0)} | {summary.get('maeMs', 0)} | {summary.get('medianMs', 0)} | {summary.get('p90Ms', 0)} | {summary.get('within40Pct', 0)}% |")
        lines.extend(["", "## Boundary contexts", "", "| Candidate | Context | Edges | MAE (ms) | Within 40 ms |", "| --- | --- | ---: | ---: | ---: |"])
        for candidate, contexts in (report.get("boundaryContexts") or {}).items():
            for context, summary in contexts.items():
                lines.append(f"| {candidate} | {context} | {summary.get('edgeCount', 0)} | {summary.get('maeMs', 0)} | {summary.get('within40Pct', 0)}% |")
        lines.extend(["", "## Gates", ""])
        for name, passed in ((report.get("gates") or {}).get("checks") or {}).items():
            lines.append(f"- {'PASS' if passed else 'FAIL'}: {name}")
        reasons = (report.get("gates") or {}).get("reasons") or []
        if reasons:
            lines.extend(["", "Reasons:"])
            lines.extend(f"- {reason}" for reason in reasons)
        lines.extend(["", "## Bootstrap", ""])
        for baseline, value in (report.get("bootstrap") or {}).items():
            lines.append(f"- Context-aware improvement vs {baseline}: {value.get('lowerMs', 0)} to {value.get('upperMs', 0)} ms (median {value.get('medianMs', 0)} ms)")
        markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        written_paths.append(markdown_path)
        if evaluation_mode == "authoritative-first":
            marker_payload = {
                "studyId": STUDY_ID,
                "evaluationMode": "authoritative-first",
                "configurationHash": report.get("configurationHash"),
                "json": json_path.name,
                "csv": csv_path.name,
                "markdown": markdown_path.name,
            }
            try:
                with authoritative_marker.open("x", encoding="utf-8") as handle:
                    json.dump(marker_payload, handle, ensure_ascii=False, indent=2)
                    handle.write("\n")
                marker_created = True
            except FileExistsError as error:
                raise FileExistsError(
                    "The authoritative-first holdout marker already exists; rerun with evaluation_mode='exploratory'."
                ) from error
        return {"json": json_path, "csv": csv_path, "markdown": markdown_path}
    except Exception:
        for path in written_paths:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        if marker_created:
            try:
                authoritative_marker.unlink()
            except FileNotFoundError:
                pass
        raise


def _default_paths() -> tuple[Path, Path, Path]:
    root = Path(__file__).resolve().parents[2]
    return root / "public" / "The_Oxford_5000.csv", root / "public" / "ipa-dict.json", root / "public" / "oxford-american-ipa.json"


def copy_explicit_v2_manifest(destination: str | Path | None = None) -> dict[str, Any]:
    """Copy/validate the checked-in reviewed v2 manifest without synthesis."""

    checked_in = Path(__file__).resolve().parents[2] / "scripts" / "data" / "segmentation-study-v2.json"
    try:
        payload = checked_in.read_bytes()
        manifest = json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("The checked-in explicit v2 manifest is unreadable.") from error
    _validate_manifest_identity(manifest)
    if destination is not None:
        target = Path(destination)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    return manifest


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples-dir", type=Path, help="Directory of CRM/history JSON samples")
    parser.add_argument("--samples-json", type=Path, help="JSON export containing labeled samples")
    parser.add_argument("--manifest", type=Path, default=Path("scripts/data/segmentation-study-v2.json"))
    parser.add_argument("--generate-manifest", action="store_true", help="Generate the fixed 100-word manifest before analysis")
    parser.add_argument("--compatibility", choices=("canonical", "historical"), default="canonical", help="Require canonical v2 export, or explicitly replay non-promotable historical JSON")
    parser.add_argument("--output-dir", type=Path, default=Path("test-results/segmentation-study-v2"))
    parser.add_argument("--bootstrap-resamples", type=int, default=DEFAULT_BOOTSTRAP_RESAMPLES)
    parser.add_argument("--evaluation-mode", choices=("authoritative-first", "exploratory"), default="authoritative-first", help="Persist the immutable first holdout report or an explicitly non-promotable exploratory rerun")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    if args.generate_manifest:
        manifest = copy_explicit_v2_manifest(args.manifest)
    elif not args.manifest.exists():
        parser.error("The checked-in v2 manifest is required; use --generate-manifest only for the explicit v2 path.")
    else:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    source = args.samples_json or args.samples_dir
    if not source:
        parser.error("one of --samples-dir or --samples-json is required")
    samples = load_labeled_samples(source, manifest=manifest, compatibility=args.compatibility)
    # The local replay corpus contains older labelled recordings in addition
    # to the six paired samples named in the accuracy note. Keep that named
    # six-recording set as the historical regression slice; new CRM labels
    # remain split by the checked-in manifest and are not filtered here.
    if samples and not any(sample.get("split") for sample in samples):
        selected_history = select_historical_regression_set(samples) if args.compatibility == "historical" else []
        if selected_history:
            samples = selected_history
    report = run_reanalysis(samples, manifest=manifest, bootstrap_resamples=args.bootstrap_resamples, evaluation_mode=args.evaluation_mode)
    paths = write_outputs(report, args.output_dir)
    print(json.dumps({"status": report["gates"]["status"], "sampleCounts": report["sampleCounts"], "outputs": {key: str(value) for key, value in paths.items()}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
