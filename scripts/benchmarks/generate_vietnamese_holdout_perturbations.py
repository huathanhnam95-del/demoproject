#!/usr/bin/env python3
"""Create evaluation-only errors from existing clean Vietnamese recordings."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.benchmarks.generate_pronunciation_perturbations import (
    count_variant,
    expand_nuclei_for_edit,
    stress_aligned_variant,
)

DEFAULT_DATASET = ROOT / "test-results" / "pronunciation-calibration" / "vietnamese-external-dataset.json"
DEFAULT_ALIGNMENTS = ROOT / "test-results" / "pronunciation-calibration" / "vietnamese-external-features.json"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-vietnamese-holdout"

HELD_OUT_STRESS_PARAMETERS = {
    "expected_duration": 0.90,
    "expected_db": -1.0,
    "expected_semitones": -0.5,
    "competing_duration": 1.20,
    "competing_db": 2.0,
    "competing_semitones": 1.0,
    "crossfade_ms": 10,
}


def build_child_row(
    parent: dict[str, Any],
    operator: str,
    audio_path: Path,
    parameters: dict[str, Any],
) -> dict[str, Any]:
    child_id = f"{parent['id']}::{operator}::heldout"
    row = dict(parent)
    row.update(
        {
            "id": child_id,
            "source_recording_id": child_id,
            "audio_path": str(audio_path),
            "split": "vietnamese_transformed_holdout",
            "category": operator,
            "parent_id": parent["id"],
            "transformation_operator": operator,
            "transformation_parameters": dict(parameters),
            "evaluation_only": True,
            "label_count": 0 if operator in {"count_omission", "count_insertion"} else 1,
            "label_stress": 0 if operator == "wrong_stress" else None,
        }
    )
    return row


def _wrong_stress_change_is_valid(measurements: dict[str, Any]) -> bool:
    expected_before = measurements["expected_before"]
    expected_after = measurements["expected_after"]
    competing_before = measurements["competing_before"]
    competing_after = measurements["competing_after"]
    return (
        float(expected_after["duration_sec"]) < float(expected_before["duration_sec"]) * 0.98
        and float(competing_after["duration_sec"]) > float(competing_before["duration_sec"]) * 1.10
        and float(expected_after["rms"]) < float(expected_before["rms"])
        and float(competing_after["rms"]) > float(competing_before["rms"]) * 1.10
    )


def generate(
    dataset_path: Path,
    alignments_path: Path,
    output_dir: Path,
    *,
    validate_only: bool = False,
) -> dict[str, Any]:
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    alignment_payload = json.loads(alignments_path.read_text(encoding="utf-8"))
    alignment_by_id = {
        str(row["id"]): row for row in alignment_payload.get("records") or []
    }
    audio_dir = output_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for parent in dataset.get("records") or []:
        if parent.get("category") != "clean":
            continue
        alignment = alignment_by_id.get(str(parent["id"]))
        nuclei = (alignment or {}).get("alignment", {}).get("nuclei") or []
        expected_stress = (alignment or {}).get("alignment", {}).get("expected_stress")
        if not nuclei:
            rejected.append({"parent_id": parent["id"], "reason": "missing_nucleus_alignment"})
            continue
        audio, sample_rate = sf.read(parent["audio_path"], dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        edit_nuclei = expand_nuclei_for_edit(len(audio), sample_rate, nuclei)
        chosen = sum(str(parent["id"]).encode("utf-8")) % len(edit_nuclei)
        for operator, insertion in (("count_omission", False), ("count_insertion", True)):
            child = count_variant(audio, sample_rate, edit_nuclei[chosen], insertion=insertion)
            valid = len(child) > len(audio) if insertion else len(child) < len(audio)
            if not valid or not np.isfinite(child).all():
                rejected.append({"parent_id": parent["id"], "operator": operator, "reason": "measured_edit_not_intended"})
                continue
            destination = audio_dir / f"{parent['id']}--{operator}--heldout.wav"
            records.append(build_child_row(parent, operator, destination, {"nucleus_index": chosen, "crossfade_ms": 10}))
            if not validate_only:
                sf.write(destination, child, sample_rate, subtype="PCM_16")
        if len(edit_nuclei) >= 2 and isinstance(expected_stress, int) and 0 <= expected_stress < len(edit_nuclei):
            alternatives = [index for index in range(len(edit_nuclei)) if index != expected_stress]
            competing = alternatives[sum(str(parent["id"]).encode("utf-8")) % len(alternatives)]
            child, measurements = stress_aligned_variant(
                audio,
                sample_rate,
                edit_nuclei,
                expected_stress,
                competing,
                **{key: value for key, value in HELD_OUT_STRESS_PARAMETERS.items() if key != "crossfade_ms"},
            )
            if _wrong_stress_change_is_valid(measurements) and np.isfinite(child).all():
                destination = audio_dir / f"{parent['id']}--wrong_stress--heldout.wav"
                parameters = dict(HELD_OUT_STRESS_PARAMETERS)
                parameters["expected_index"] = expected_stress
                parameters["competing_index"] = competing
                records.append(build_child_row(parent, "wrong_stress", destination, parameters))
                if not validate_only:
                    sf.write(destination, child, sample_rate, subtype="PCM_16")
            else:
                rejected.append({"parent_id": parent["id"], "operator": "wrong_stress", "reason": "measured_edit_not_intended"})
        else:
            rejected.append({"parent_id": parent["id"], "operator": "wrong_stress", "reason": "missing_polysyllabic_alignment"})

    source_hash = hashlib.sha256(dataset_path.read_bytes() + alignments_path.read_bytes()).hexdigest()
    result = {
        "schema_version": "vietnamese-transformed-holdout-v1",
        "records": records,
        "rejected": rejected,
        "provenance": {
            "archive_sha256": source_hash,
            "source_sha256": source_hash,
            "role": "evaluation_only",
            "training_operator_strengths_reused": False,
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "reference-dataset.json").write_text(
        json.dumps(result, indent=2),
        encoding="utf-8",
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--alignments", type=Path, default=DEFAULT_ALIGNMENTS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    result = generate(
        args.dataset,
        args.alignments,
        args.output,
        validate_only=args.validate_only,
    )
    print(json.dumps({"retained": len(result["records"]), "rejected": len(result["rejected"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
