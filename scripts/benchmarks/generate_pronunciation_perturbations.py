#!/usr/bin/env python3
"""Generate training-only acoustic perturbations from existing Kokoro audio."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "audio"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-perturbations"
DEFAULT_ALIGNMENTS = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "features.json"


def crossfade(left: np.ndarray, right: np.ndarray, sample_rate: int, milliseconds: float = 10.0) -> np.ndarray:
    overlap = max(1, int(round(sample_rate * milliseconds / 1000)))
    if len(left) < overlap or len(right) < overlap:
        return np.concatenate([left, right])
    ramp = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
    blended = left[-overlap:] * (1.0 - ramp) + right[:overlap] * ramp
    return np.concatenate([left[:-overlap], blended, right[overlap:]])


def change_speed(samples: np.ndarray, factor: float) -> np.ndarray:
    factor = float(factor)
    if factor <= 0:
        raise ValueError("speed factor must be positive")
    source_x = np.arange(len(samples), dtype=float)
    target_length = max(1, int(round(len(samples) / factor)))
    target_x = np.linspace(0, max(0, len(samples) - 1), target_length)
    return np.interp(target_x, source_x, samples).astype(np.float32)


def replace_region(
    samples: np.ndarray,
    start: int,
    end: int,
    replacement: np.ndarray,
    sample_rate: int,
) -> np.ndarray:
    start = max(0, min(int(start), len(samples)))
    end = max(start, min(int(end), len(samples)))
    replacement = np.asarray(replacement, dtype=np.float32)
    if len(replacement) == 0:
        return crossfade(samples[:start], samples[end:], sample_rate)
    with_left = crossfade(samples[:start], replacement, sample_rate)
    return crossfade(with_left, samples[end:], sample_rate)


def count_variant(samples: np.ndarray, sample_rate: int, nucleus: dict[str, Any], *, insertion: bool) -> np.ndarray:
    start = int(round(float(nucleus["start_time"]) * sample_rate))
    end = int(round(float(nucleus["end_time"]) * sample_rate))
    segment = np.asarray(samples[start:end], dtype=np.float32)
    if insertion:
        duplicated = crossfade(segment, segment, sample_rate)
        return replace_region(samples, start, end, duplicated, sample_rate)
    return replace_region(samples, start, end, np.asarray([], dtype=np.float32), sample_rate)


def build_transform_row(parent_id: str, operator: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"{parent_id}::{operator}",
        "parent_id": parent_id,
        "operator": operator,
        "parameters": dict(parameters),
        "split": "train_augmentation",
    }


def audio_filename(record_id: str) -> str:
    return f"{record_id.replace('::', '--')}.wav"


def expand_nuclei_for_edit(
    sample_count: int,
    sample_rate: int,
    nuclei: list[dict[str, Any]],
    *,
    minimum_duration_sec: float = 0.08,
) -> list[dict[str, Any]]:
    """Expand one-frame CTC nuclei to editable, non-overlapping windows."""
    if not nuclei:
        return []
    audio_duration = sample_count / sample_rate
    centers = [
        (float(row["start_time"]) + float(row["end_time"])) / 2.0
        for row in nuclei
    ]
    expanded: list[dict[str, Any]] = []
    half = minimum_duration_sec / 2.0
    for index, (row, center) in enumerate(zip(nuclei, centers)):
        left_limit = 0.0 if index == 0 else (centers[index - 1] + center) / 2.0
        right_limit = audio_duration if index == len(centers) - 1 else (center + centers[index + 1]) / 2.0
        start = max(left_limit, center - half)
        end = min(right_limit, center + half)
        item = dict(row)
        item["start_time"] = start
        item["end_time"] = end
        expanded.append(item)
    return expanded


def _stress_variant(samples: np.ndarray, sample_rate: int, competing_factor: float = 1.30) -> np.ndarray:
    midpoint = max(1, len(samples) // 2)
    first = samples[:midpoint] * (10 ** (-2 / 20))
    second = samples[midpoint:] * (10 ** (3 / 20))
    # A time-domain approximation deliberately stays simple and is accepted
    # only when the measured energy contrast changes in the intended direction.
    return np.concatenate([first, second]).clip(-1, 1).astype(np.float32)


def _flat_variant(samples: np.ndarray) -> np.ndarray:
    midpoint = max(1, len(samples) // 2)
    first, second = samples[:midpoint], samples[midpoint:]
    first_rms = np.sqrt(np.mean(first * first)) + 1e-8
    second_rms = np.sqrt(np.mean(second * second)) + 1e-8
    target = (first_rms + second_rms) / 2
    return np.concatenate([first * target / first_rms, second * target / second_rms]).clip(-1, 1).astype(np.float32)


def _count_variant(samples: np.ndarray, sample_rate: int, insertion: bool) -> np.ndarray:
    width = max(1, int(round(sample_rate * 0.10)))
    midpoint = len(samples) // 2
    start = max(0, midpoint - width // 2)
    end = min(len(samples), start + width)
    if insertion:
        return crossfade(samples[:end], samples[start:end], sample_rate)
    return np.concatenate([samples[:start], samples[end:]])


def _snr_variant(samples: np.ndarray, snr_db: float, seed: int = 20260730) -> np.ndarray:
    rng = np.random.default_rng(seed)
    signal_power = float(np.mean(samples * samples)) + 1e-8
    noise_power = signal_power / (10 ** (snr_db / 10))
    return (samples + rng.normal(0.0, np.sqrt(noise_power), len(samples))).clip(-1, 1).astype(np.float32)


def _segment_metrics(samples: np.ndarray, sample_rate: int) -> dict[str, float | None]:
    samples = np.asarray(samples, dtype=np.float32)
    rms = float(np.sqrt(np.mean(samples * samples))) if len(samples) else 0.0
    f0_median = None
    if len(samples) >= max(1, int(sample_rate * 0.03)):
        try:
            import parselmouth

            pitch = parselmouth.Sound(samples.astype(float), sampling_frequency=sample_rate).to_pitch_ac(
                time_step=0.005,
                pitch_floor=75,
                pitch_ceiling=500,
            )
            values = pitch.selected_array["frequency"]
            voiced = values[np.isfinite(values) & (values > 0)]
            if len(voiced):
                f0_median = float(np.median(voiced))
        except Exception:
            f0_median = None
    return {"duration_sec": len(samples) / sample_rate, "rms": rms, "f0_median": f0_median}


def _transform_nucleus(
    segment: np.ndarray,
    sample_rate: int,
    *,
    duration_factor: float,
    gain_db: float,
    semitones: float,
) -> np.ndarray:
    import librosa

    source = np.asarray(segment, dtype=np.float32)
    changed = librosa.effects.pitch_shift(source, sr=sample_rate, n_steps=semitones)
    changed = librosa.effects.time_stretch(changed, rate=1.0 / duration_factor)
    source_rms = float(np.sqrt(np.mean(source * source))) + 1e-8
    changed_rms = float(np.sqrt(np.mean(changed * changed))) + 1e-8
    target_rms = source_rms * (10 ** (gain_db / 20.0))
    changed = changed * (target_rms / changed_rms)
    return np.clip(changed, -1.0, 1.0).astype(np.float32)


def _apply_nucleus_replacements(
    samples: np.ndarray,
    sample_rate: int,
    replacements: list[tuple[dict[str, Any], np.ndarray]],
) -> np.ndarray:
    result = np.asarray(samples, dtype=np.float32)
    for nucleus, replacement in sorted(replacements, key=lambda item: float(item[0]["start_time"]), reverse=True):
        start = int(round(float(nucleus["start_time"]) * sample_rate))
        end = int(round(float(nucleus["end_time"]) * sample_rate))
        result = replace_region(result, start, end, replacement, sample_rate)
    return result


def stress_aligned_variant(
    samples: np.ndarray,
    sample_rate: int,
    nuclei: list[dict[str, Any]],
    expected_index: int,
    competing_index: int,
    *,
    expected_duration: float = 0.85,
    expected_db: float = -2.0,
    expected_semitones: float = -1.0,
    competing_duration: float = 1.30,
    competing_db: float = 3.0,
    competing_semitones: float = 2.0,
) -> tuple[np.ndarray, dict[str, Any]]:
    expected = nuclei[expected_index]
    competing = nuclei[competing_index]

    def segment(nucleus: dict[str, Any]) -> np.ndarray:
        start = int(round(float(nucleus["start_time"]) * sample_rate))
        end = int(round(float(nucleus["end_time"]) * sample_rate))
        return samples[start:end]

    expected_parent = segment(expected)
    competing_parent = segment(competing)
    expected_child = _transform_nucleus(
        expected_parent,
        sample_rate,
        duration_factor=expected_duration,
        gain_db=expected_db,
        semitones=expected_semitones,
    )
    competing_child = _transform_nucleus(
        competing_parent,
        sample_rate,
        duration_factor=competing_duration,
        gain_db=competing_db,
        semitones=competing_semitones,
    )
    child = _apply_nucleus_replacements(
        samples,
        sample_rate,
        [(expected, expected_child), (competing, competing_child)],
    )
    return child, {
        "expected_index": expected_index,
        "competing_index": competing_index,
        "expected_before": _segment_metrics(expected_parent, sample_rate),
        "expected_after": _segment_metrics(expected_child, sample_rate),
        "competing_before": _segment_metrics(competing_parent, sample_rate),
        "competing_after": _segment_metrics(competing_child, sample_rate),
    }


def flat_aligned_variant(
    samples: np.ndarray,
    sample_rate: int,
    nuclei: list[dict[str, Any]],
) -> tuple[np.ndarray, dict[str, Any]]:
    segments: list[np.ndarray] = []
    metrics: list[dict[str, float | None]] = []
    for nucleus in nuclei:
        start = int(round(float(nucleus["start_time"]) * sample_rate))
        end = int(round(float(nucleus["end_time"]) * sample_rate))
        item = samples[start:end]
        segments.append(item)
        metrics.append(_segment_metrics(item, sample_rate))
    target_duration = float(np.median([item["duration_sec"] for item in metrics]))
    target_rms = float(np.median([item["rms"] for item in metrics]))
    voiced_f0 = [float(item["f0_median"]) for item in metrics if item["f0_median"]]
    target_f0 = float(np.median(voiced_f0)) if voiced_f0 else None
    replacements: list[tuple[dict[str, Any], np.ndarray]] = []
    after_metrics: list[dict[str, float | None]] = []
    for nucleus, segment, before in zip(nuclei, segments, metrics):
        duration_factor = target_duration / max(float(before["duration_sec"]), 1e-6)
        gain_db = 20.0 * np.log10(target_rms / max(float(before["rms"]), 1e-8))
        semitones = 0.0
        if target_f0 and before["f0_median"]:
            semitones = 12.0 * np.log2(target_f0 / float(before["f0_median"]))
        replacement = _transform_nucleus(
            segment,
            sample_rate,
            duration_factor=float(duration_factor),
            gain_db=float(gain_db),
            semitones=float(semitones),
        )
        replacements.append((nucleus, replacement))
        after_metrics.append(_segment_metrics(replacement, sample_rate))
    return _apply_nucleus_replacements(samples, sample_rate, replacements), {
        "target_duration_sec": target_duration,
        "target_rms": target_rms,
        "target_f0_median": target_f0,
        "before": metrics,
        "after": after_metrics,
    }


def intended_change(parent: np.ndarray, child: np.ndarray, operator: str, measurements: dict[str, Any] | None = None) -> bool:
    if len(child) == 0 or not np.isfinite(child).all():
        return False
    parent_rms = np.sqrt(np.mean(parent * parent)) + 1e-8
    child_rms = np.sqrt(np.mean(child * child)) + 1e-8
    if operator == "wrong_stress":
        if not measurements:
            return False
        expected_before = measurements["expected_before"]
        expected_after = measurements["expected_after"]
        competing_before = measurements["competing_before"]
        competing_after = measurements["competing_after"]
        duration_ok = (
            float(competing_after["duration_sec"]) > float(competing_before["duration_sec"]) * 1.20
            and float(expected_after["duration_sec"]) < float(expected_before["duration_sec"]) * 0.95
        )
        energy_ok = (
            float(competing_after["rms"]) > float(competing_before["rms"]) * 1.20
            and float(expected_after["rms"]) < float(expected_before["rms"])
        )
        pitch_ok = True
        if competing_before["f0_median"] and competing_after["f0_median"]:
            pitch_ok = float(competing_after["f0_median"]) > float(competing_before["f0_median"]) * 1.05
        return duration_ok and energy_ok and pitch_ok
    if operator == "flat_prominence":
        if not measurements:
            return False
        after = measurements.get("after") or []
        durations = [float(item["duration_sec"]) for item in after]
        rms_values = [float(item["rms"]) for item in after]
        return bool(durations and rms_values) and max(durations) - min(durations) <= 0.03 and max(rms_values) / max(min(rms_values), 1e-8) <= 1.25
    if operator == "count_omission":
        return len(child) < len(parent)
    if operator == "count_insertion":
        return len(child) > len(parent)
    length = min(len(parent), len(child))
    return np.max(np.abs(parent[:length] - child[:length])) > 1e-4


def generate(
    input_dir: Path,
    output_dir: Path,
    *,
    alignments_path: Path = DEFAULT_ALIGNMENTS,
    validate_only: bool = False,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    rejected: list[dict[str, str]] = []
    alignment_payload = json.loads(alignments_path.read_text(encoding="utf-8")) if alignments_path.exists() else {}
    alignment_by_id = {str(item["id"]): item for item in alignment_payload.get("records", [])}
    competing_positions: dict[int, int] = {}
    for source in sorted(input_dir.glob("*.wav")):
        parent_id = source.stem
        audio, sample_rate = sf.read(source, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        aligned = alignment_by_id.get(parent_id)
        nuclei = (aligned or {}).get("alignment", {}).get("nuclei") or []
        edit_nuclei = expand_nuclei_for_edit(len(audio), sample_rate, nuclei)
        expected_stress = (aligned or {}).get("alignment", {}).get("expected_stress")
        operator_results: list[tuple[str, np.ndarray, dict[str, Any], dict[str, Any] | None]] = []
        if len(edit_nuclei) >= 2 and isinstance(expected_stress, int) and 0 <= expected_stress < len(edit_nuclei):
            alternatives = [index for index in range(len(edit_nuclei)) if index != expected_stress]
            competing_index = alternatives[sum(parent_id.encode("utf-8")) % len(alternatives)]
            competing_positions[competing_index] = competing_positions.get(competing_index, 0) + 1
            stress_child, stress_measurements = stress_aligned_variant(
                audio,
                sample_rate,
                edit_nuclei,
                expected_stress,
                competing_index,
            )
            operator_results.append((
                "wrong_stress",
                stress_child,
                {
                    "expected_duration": 0.85,
                    "expected_db": -2,
                    "expected_semitones": -1,
                    "competing_duration": 1.30,
                    "competing_db": 3,
                    "competing_semitones": 2,
                    "crossfade_ms": 10,
                },
                stress_measurements,
            ))
            flat_child, flat_measurements = flat_aligned_variant(audio, sample_rate, edit_nuclei)
            operator_results.append(("flat_prominence", flat_child, {"normalize": "duration_rms_f0", "crossfade_ms": 10}, flat_measurements))
        else:
            rejected.extend([
                {"parent_id": parent_id, "operator": "wrong_stress", "reason": "missing_polysyllabic_alignment"},
                {"parent_id": parent_id, "operator": "flat_prominence", "reason": "missing_polysyllabic_alignment"},
            ])
        if edit_nuclei:
            nucleus_index = sum(parent_id.encode("utf-8")) % len(edit_nuclei)
            nucleus = edit_nuclei[nucleus_index]
            operator_results.extend([
                ("count_omission", count_variant(audio, sample_rate, nucleus, insertion=False), {"nucleus_index": nucleus_index, "crossfade_ms": 10}, None),
                ("count_insertion", count_variant(audio, sample_rate, nucleus, insertion=True), {"nucleus_index": nucleus_index, "crossfade_ms": 10}, None),
            ])
        else:
            rejected.extend([
                {"parent_id": parent_id, "operator": "count_omission", "reason": "missing_nucleus_alignment"},
                {"parent_id": parent_id, "operator": "count_insertion", "reason": "missing_nucleus_alignment"},
            ])
        operator_results.extend([
            ("snr_25db", _snr_variant(audio, 25), {"snr_db": 25}, None),
            ("speed_0_95", change_speed(audio, 0.95), {"speed": 0.95}, None),
            ("speed_1_05", change_speed(audio, 1.05), {"speed": 1.05}, None),
        ])
        for operator, child, params, measurements in operator_results:
            row = build_transform_row(parent_id, operator, params)
            row["sample_rate"] = int(sample_rate)
            row["source"] = str(source)
            row["measurements"] = measurements
            if not intended_change(audio, child, operator, measurements):
                rejected.append({"parent_id": parent_id, "operator": operator, "reason": "measured_edit_not_intended"})
                continue
            destination = output_dir / audio_filename(row["id"])
            row["audio"] = str(destination)
            rows.append(row)
            if not validate_only:
                sf.write(destination, child, sample_rate, subtype="PCM_16")
    manifest = {
        "schema_version": "pronunciation-perturbations-v1",
        "records": rows,
        "rejected": rejected,
        "source_count": len(list(input_dir.glob('*.wav'))),
        "synthetic_only": True,
        "alignment_source": str(alignments_path),
        "competing_stress_position_support": competing_positions,
        "reserved_evaluation_parameters": {
            "wrong_stress": {"competing_duration": 1.20, "competing_db": 2, "competing_semitones": 1},
            "channel": {"snr_db": 20, "speeds": [0.90, 1.10]},
        },
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--alignments", type=Path, default=DEFAULT_ALIGNMENTS)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    manifest = generate(args.input, args.output, alignments_path=args.alignments, validate_only=args.validate_only)
    print(json.dumps({"source_count": manifest["source_count"], "retained": len(manifest["records"]), "rejected": len(manifest["rejected"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
