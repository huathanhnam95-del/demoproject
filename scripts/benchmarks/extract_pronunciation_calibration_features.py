#!/usr/bin/env python3
"""Extract leakage-safe word features from sentence-level SpeechOcean audio.

The recognizer aligns the complete sentence once. Word windows and vowel
nuclei are then sliced from that alignment, avoiding target-word-only
alignment against a sentence recording.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.local_server.pronunciation_verifier import (
    aligned_acoustic_features,
    count_feature_vector,
    stress_feature_vector,
)
from backend.phoneme_service.app import _preprocess_wav
from backend.phoneme_service.arpabet import arpabet_to_ipa
from backend.phoneme_service.backends import create_backend, ctc_forced_align
from backend.phoneme_service.stress_alignment import ctc_hypothesis_features, tokenize_ipa
from backend.phoneme_service.syllabifier import IndependentSyllabifier
from scripts.benchmarks.build_pronunciation_calibration_dataset import ARPABET_VOWELS
from scripts.benchmarks.train_pronunciation_verifier import COUNT_FEATURES, STRESS_FEATURES

DEFAULT_DATASET = ROOT / "test-results" / "pronunciation-calibration" / "dataset.json"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-calibration" / "features.json"
DEFAULT_MANIFEST = ROOT / "backend" / "phoneme_service" / "model-manifest.json"


def build_reference_layout(reference_phones: str, symbol_table: list[str]) -> dict[str, Any]:
    phones = str(reference_phones or "").split()
    token_ids: list[int] = []
    phone_token_ranges: list[list[int]] = []
    vowel_phone_indices: list[int] = []
    primary_stress_phone_indices: list[int] = []
    for phone_index, phone in enumerate(phones):
        start = len(token_ids)
        ipa_symbols = arpabet_to_ipa([phone])
        for symbol in ipa_symbols:
            token_ids.extend(tokenize_ipa(symbol, symbol_table))
        phone_token_ranges.append([start, len(token_ids)])
        base = phone[:-1] if phone[-1:].isdigit() else phone
        if base.upper() in ARPABET_VOWELS:
            vowel_phone_indices.append(phone_index)
            if phone.endswith("1"):
                primary_stress_phone_indices.append(phone_index)
    return {
        "phones": phones,
        "token_ids": token_ids,
        "phone_token_ranges": phone_token_ranges,
        "vowel_phone_indices": vowel_phone_indices,
        "primary_stress_phone_indices": primary_stress_phone_indices,
    }


def build_ipa_reference_layout(
    reference_syllables: list[str],
    expected_stress: int | None,
    symbol_table: list[str],
) -> dict[str, Any]:
    vowel_markers = set("aeiouɐɑɒɔəɚɛɜɝɞɪʊʌæœɨɵɶː")
    token_ids: list[int] = []
    nucleus_token_ranges: list[list[int]] = []
    for syllable in reference_syllables:
        start = len(token_ids)
        syllable_ids = tokenize_ipa(syllable, symbol_table)
        token_ids.extend(syllable_ids)
        vowel_positions = [
            start + index
            for index, token_id in enumerate(syllable_ids)
            if any(character in vowel_markers for character in str(symbol_table[token_id]))
        ]
        if not vowel_positions:
            raise ValueError(f"reference syllable has no model vowel token: {syllable}")
        nucleus_token_ranges.append([min(vowel_positions), max(vowel_positions) + 1])
    return {
        "token_ids": token_ids,
        "direct_word": True,
        "nucleus_token_ranges": nucleus_token_ranges,
        "expected_stress": expected_stress,
    }


def _contours(samples: np.ndarray, sample_rate: int) -> dict[str, Any]:
    import parselmouth

    sound = parselmouth.Sound(np.asarray(samples, dtype=float), sampling_frequency=sample_rate)
    pitch = sound.to_pitch_ac(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
    intensity = sound.to_intensity(time_step=0.01)
    duration = len(samples) / sample_rate
    times = np.arange(0.0, duration, 0.01)
    pitch_values: list[float | None] = []
    intensity_values: list[float | None] = []
    for time in times:
        pitch_value = float(pitch.get_value_at_time(float(time)))
        intensity_value = float(intensity.get_value(float(time)))
        pitch_values.append(pitch_value if math.isfinite(pitch_value) and pitch_value > 0 else None)
        intensity_values.append(intensity_value if math.isfinite(intensity_value) else None)
    return {
        "pitch": {"times": times.round(6).tolist(), "values": pitch_values},
        "intensity": {"times": times.round(6).tolist(), "values": intensity_values},
    }


def _token_range_for_phone_range(layout: dict[str, Any], phone_range: list[int]) -> tuple[int, int]:
    start_phone, end_phone = map(int, phone_range)
    ranges = layout["phone_token_ranges"]
    if start_phone < 0 or end_phone > len(ranges) or start_phone >= end_phone:
        raise ValueError("invalid word phone range")
    return int(ranges[start_phone][0]), int(ranges[end_phone - 1][1])


def _word_recognizer_result(
    row: dict[str, Any],
    layout: dict[str, Any],
    token_spans: list[dict[str, Any]],
    recognizer: dict[str, Any],
    syllabifier: IndependentSyllabifier,
) -> tuple[dict[str, Any], int | None]:
    if layout.get("direct_word"):
        word_token_start, word_token_end = 0, len(layout["token_ids"])
    else:
        word_token_start, word_token_end = _token_range_for_phone_range(layout, row["word_phone_range"])
    selected_tokens = token_spans[word_token_start:word_token_end]
    if not selected_tokens:
        raise ValueError("word has no aligned tokens")
    frame_count = int(recognizer["frame_count"])
    sample_count = int(recognizer["sample_count"])
    sample_rate = int(recognizer["sample_rate"])
    duration = sample_count / sample_rate
    word_start_frame = min(int(item["start_frame"]) for item in selected_tokens)
    word_end_frame = max(int(item["end_frame"]) for item in selected_tokens)
    word_start_time = word_start_frame / frame_count * duration
    word_end_time = word_end_frame / frame_count * duration

    if layout.get("direct_word"):
        nucleus_token_ranges = list(layout["nucleus_token_ranges"])
    else:
        start_phone, end_phone = map(int, row["word_phone_range"])
        vowel_phone_indices = [
            phone_index
            for phone_index in layout["vowel_phone_indices"]
            if start_phone <= phone_index < end_phone
        ]
        nucleus_token_ranges = [layout["phone_token_ranges"][phone_index] for phone_index in vowel_phone_indices]
    syllable_spans: list[dict[str, Any]] = []
    for syllable_index, (token_start, token_end) in enumerate(nucleus_token_ranges):
        nucleus_tokens = token_spans[token_start:token_end]
        nucleus_start_frame = min(int(item["start_frame"]) for item in nucleus_tokens)
        nucleus_end_frame = max(int(item["end_frame"]) for item in nucleus_tokens)
        syllable_spans.append({
            "index": syllable_index,
            "nucleus_start_frame": nucleus_start_frame,
            "nucleus_end_frame": nucleus_end_frame,
            "nucleus_start_time": nucleus_start_frame / frame_count * duration,
            "nucleus_end_time": nucleus_end_frame / frame_count * duration,
            "nucleus_confidence": float(np.mean([item["confidence"] for item in nucleus_tokens])),
            "confidence": float(np.mean([item["confidence"] for item in nucleus_tokens])),
        })

    phonemes = [
        phoneme
        for phoneme in recognizer.get("phonemes", [])
        if word_start_time <= ((float(phoneme["start_time"]) + float(phoneme["end_time"])) / 2.0) <= word_end_time
    ]
    decoded = syllabifier.syllabify(phonemes)
    word_ids = layout["token_ids"][word_token_start:word_token_end]
    vowel_token_positions = [token_start - word_token_start for token_start, _ in nucleus_token_ranges]
    omission_candidates = [
        word_ids[:position] + word_ids[position + 1:]
        for position in vowel_token_positions
        if len(word_ids) > 1
    ]
    insertion_candidates = [
        word_ids[:position + 1] + [word_ids[position]] + word_ids[position + 1:]
        for position in vowel_token_positions
    ]
    word_log_probs = recognizer["log_probs"][word_start_frame:word_end_frame]
    hypotheses = ctc_hypothesis_features(
        word_log_probs,
        word_ids,
        blank_id=int(recognizer["blank_id"]),
        omission_candidates=omission_candidates,
        insertion_candidates=insertion_candidates,
    )
    if layout.get("direct_word"):
        expected_stress = layout.get("expected_stress")
    else:
        primary_candidates = [
            phone_index
            for phone_index in layout["primary_stress_phone_indices"]
            if start_phone <= phone_index < end_phone
        ]
        expected_stress = vowel_phone_indices.index(primary_candidates[0]) if primary_candidates else None
        if isinstance(row.get("expected_primary_stress"), int):
            expected_stress = int(row["expected_primary_stress"])
    return {
        "contract_version": "offline-full-utterance-v1",
        "audio_duration_sec": word_end_time - word_start_time,
        "decoded_syllable_count": decoded.get("syllable_count"),
        "decoded_is_rateable": decoded.get("is_rateable"),
        "canonical_alignment": {"aligned": True, "syllables": syllable_spans},
        "hypotheses": hypotheses,
    }, expected_stress


def extract(
    dataset: dict[str, Any],
    *,
    backend: Any,
    limit: int | None = None,
    source_start: int = 0,
    source_end: int | None = None,
    checkpoint_path: Path | None = None,
    resume: bool = False,
) -> dict[str, Any]:
    rows = dataset.get("records") or []
    ordered_sources = list(dict.fromkeys(str(row["source_recording_id"]) for row in rows))
    selected_sources = ordered_sources[max(0, source_start):source_end]
    if limit is not None:
        selected_sources = selected_sources[:limit]
    if source_start or source_end is not None or limit is not None:
        allowed_sources = set(selected_sources)
        rows = [row for row in rows if str(row["source_recording_id"]) in set(allowed_sources)]
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["source_recording_id"])].append(row)

    syllabifier = IndependentSyllabifier()
    output_rows: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    processed_sources: set[str] = set()
    if resume and checkpoint_path and checkpoint_path.exists():
        previous = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        if previous.get("dataset_sha256") == dataset.get("provenance", {}).get("archive_sha256"):
            output_rows = list(previous.get("records") or [])
            failures = list(previous.get("failures") or [])
            processed_sources = {str(item) for item in previous.get("processed_source_recordings") or []}

    def result_payload(*, complete: bool) -> dict[str, Any]:
        return {
            "schema_version": "pronunciation-calibration-features-v1",
            "dataset_sha256": dataset.get("provenance", {}).get("archive_sha256"),
            "coverage_denominator": len(rows),
            "records": output_rows,
            "failures": failures,
            "processed_source_recordings": sorted(processed_sources),
            "complete": complete,
            "coverage": len(output_rows) / len(rows) if rows else 0.0,
        }

    for group_index, (source_id, source_rows) in enumerate(grouped.items(), start=1):
        if source_id in processed_sources:
            continue
        try:
            source = source_rows[0]
            samples, sample_rate = _preprocess_wav(Path(source["audio_path"]).read_bytes())
            recognizer = backend.recognize_with_logits(samples, sample_rate)
            if source.get("reference_syllables"):
                layout = build_ipa_reference_layout(
                    source["reference_syllables"],
                    source.get("expected_stress"),
                    recognizer["symbol_table"],
                )
            else:
                layout = build_reference_layout(source["utterance_reference_phones"], recognizer["symbol_table"])
            alignment = ctc_forced_align(
                recognizer["log_probs"],
                layout["token_ids"],
                blank_id=int(recognizer["blank_id"]),
            )
            if not alignment.get("aligned"):
                raise ValueError(f"full utterance alignment failed: {alignment.get('reason')}")
            contours = _contours(samples, sample_rate)
            for row in source_rows:
                try:
                    word_result, expected_stress = _word_recognizer_result(
                        row,
                        layout,
                        alignment["spans"],
                        recognizer,
                        syllabifier,
                    )
                    acoustic = aligned_acoustic_features(contours, word_result)
                    if row.get("label_stress") is not None and expected_stress is None:
                        raise ValueError("labelled stress row has no canonical primary stress")
                    count_values = count_feature_vector(word_result, int(row["syllable_count"]))
                    stress_values = stress_feature_vector(acoustic, expected_stress or 0)
                    output_rows.append({
                        "id": row["id"],
                        "source_recording_id": source_id,
                        "speaker_id": row["speaker_id"],
                        "gender": row.get("gender"),
                        "split": row["split"],
                        "word": row["word"],
                        "parent_id": row.get("parent_id"),
                        "transformation_operator": row.get("transformation_operator"),
                        "transformation_parameters": row.get("transformation_parameters"),
                        "label_count": row.get("label_count"),
                        "label_stress": row.get("label_stress"),
                        "features": {
                            **dict(zip(COUNT_FEATURES, count_values)),
                            **dict(zip(STRESS_FEATURES, stress_values)),
                        },
                        "diagnostics": {
                            "decoded_syllable_count": word_result["decoded_syllable_count"],
                            "decoded_is_rateable": word_result["decoded_is_rateable"],
                            "expected_stress": expected_stress,
                            "aligned_nuclei": len(acoustic),
                            "all_nuclei_voiced": bool(acoustic) and all(item["voiced_confidence"] > 0 for item in acoustic),
                        },
                        "stress_nuclei": [
                            {
                                key: item.get(key)
                                for key in (
                                    "duration_sec", "intensity_db", "f0_median", "f0_range",
                                    "f0_slope", "spectral_tilt", "nucleus_confidence", "voiced_confidence",
                                )
                            }
                            for item in acoustic
                        ],
                        "alignment": {
                            "expected_stress": expected_stress,
                            "nuclei": [
                                {
                                    "index": item["index"],
                                    "start_time": item["nucleus_start_time"],
                                    "end_time": item["nucleus_end_time"],
                                    "confidence": item["nucleus_confidence"],
                                }
                                for item in word_result["canonical_alignment"]["syllables"]
                            ],
                        },
                    })
                except Exception as exc:
                    failures.append({"id": row.get("id"), "source_recording_id": source_id, "reason": str(exc)})
        except Exception as exc:
            failures.extend(
                {"id": row.get("id"), "source_recording_id": source_id, "reason": str(exc)}
                for row in source_rows
            )
        processed_sources.add(source_id)
        if checkpoint_path and group_index % 25 == 0:
            checkpoint_path.write_text(json.dumps(result_payload(complete=False), indent=2), encoding="utf-8")
    return result_payload(complete=len(processed_sources) == len(grouped))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model-manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--limit-source-recordings", type=int)
    parser.add_argument("--source-start", type=int, default=0)
    parser.add_argument("--source-end", type=int)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    if args.dry_run:
        source_count = len({str(row["source_recording_id"]) for row in dataset.get("records", [])})
        print(json.dumps({"valid": True, "rows": len(dataset.get("records", [])), "source_recordings": source_count}, indent=2))
        return 0
    backend = create_backend(str(args.model_manifest))
    backend.load()
    result = extract(
        dataset,
        backend=backend,
        limit=args.limit_source_recordings,
        source_start=args.source_start,
        source_end=args.source_end,
        checkpoint_path=args.output,
        resume=args.resume,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "coverage_denominator": result["coverage_denominator"],
        "retained": len(result["records"]),
        "failures": len(result["failures"]),
        "coverage": result["coverage"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
