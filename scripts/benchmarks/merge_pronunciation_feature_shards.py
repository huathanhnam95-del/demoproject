#!/usr/bin/env python3
"""Merge deterministic pronunciation feature checkpoints without duplicates."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("shards", nargs="+", type=Path)
    args = parser.parse_args()

    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    expected_hash = dataset.get("provenance", {}).get("archive_sha256")
    records_by_id = {}
    failures_by_id = {}
    processed_sources = set()
    for path in args.shards:
        shard = json.loads(path.read_text(encoding="utf-8"))
        if shard.get("dataset_sha256") != expected_hash:
            raise SystemExit(f"dataset hash mismatch in {path}")
        for row in shard.get("records") or []:
            records_by_id[str(row["id"])] = row
        for row in shard.get("failures") or []:
            failures_by_id[str(row["id"])] = row
        processed_sources.update(str(value) for value in shard.get("processed_source_recordings") or [])

    source_order = list(dict.fromkeys(str(row["source_recording_id"]) for row in dataset.get("records", [])))
    row_order = {str(row["id"]): index for index, row in enumerate(dataset.get("records", []))}
    records = sorted(records_by_id.values(), key=lambda row: row_order.get(str(row["id"]), 10**9))
    failures = sorted(failures_by_id.values(), key=lambda row: row_order.get(str(row["id"]), 10**9))
    result = {
        "schema_version": "pronunciation-calibration-features-v1",
        "dataset_sha256": expected_hash,
        "coverage_denominator": len(dataset.get("records", [])),
        "records": records,
        "failures": failures,
        "processed_source_recordings": [source for source in source_order if source in processed_sources],
        "complete": len(processed_sources) == len(source_order),
        "coverage": len(records) / len(dataset.get("records", [])) if dataset.get("records") else 0.0,
    }
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "processed_source_recordings": len(processed_sources),
        "records": len(records),
        "failures": len(failures),
        "complete": result["complete"],
        "coverage": result["coverage"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
