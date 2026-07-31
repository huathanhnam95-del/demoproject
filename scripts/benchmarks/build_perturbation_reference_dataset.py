#!/usr/bin/env python3
"""Convert retained synthetic edits into isolated-word feature rows."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PARENTS = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "reference-dataset.json"
DEFAULT_PERTURBATIONS = ROOT / "test-results" / "pronunciation-perturbations" / "manifest.json"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-perturbations" / "reference-dataset.json"


def build(parents: dict, perturbations: dict) -> dict:
    parent_by_id = {str(row["id"]): row for row in parents.get("records") or []}
    records = []
    for edit in perturbations.get("records") or []:
        parent = parent_by_id.get(str(edit["parent_id"]))
        if not parent:
            raise ValueError(f"missing parent row: {edit['parent_id']}")
        operator = str(edit["operator"])
        count_label = 0 if operator in {"count_omission", "count_insertion"} else 1
        if operator in {"wrong_stress", "flat_prominence"}:
            stress_label = 0
        elif operator in {"count_omission", "count_insertion"}:
            stress_label = None
        else:
            stress_label = parent.get("label_stress")
        row = dict(parent)
        row.update({
            "id": edit["id"],
            "source_recording_id": edit["id"],
            "audio_path": edit["audio"],
            "split": "train_augmentation",
            "label_count": count_label,
            "label_stress": stress_label,
            "parent_id": edit["parent_id"],
            "transformation_operator": operator,
            "transformation_parameters": edit.get("parameters") or {},
        })
        records.append(row)
    digest = hashlib.sha256(json.dumps(perturbations, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return {
        "schema_version": "pronunciation-perturbation-reference-v1",
        "records": records,
        "provenance": {"archive_sha256": digest, "role": "training_augmentation_only"},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parents", type=Path, default=DEFAULT_PARENTS)
    parser.add_argument("--perturbations", type=Path, default=DEFAULT_PERTURBATIONS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = build(
        json.loads(args.parents.read_text(encoding="utf-8")),
        json.loads(args.perturbations.read_text(encoding="utf-8")),
    )
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "records": len(result["records"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
