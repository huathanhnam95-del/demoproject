#!/usr/bin/env python3
"""Build exact-IPA feature rows for the existing Vietnamese-L1 recordings."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.local_server.pronunciation_reference import parse_pronunciation

DEFAULT_MANIFEST = ROOT / "tests" / "fixtures" / "pronunciation-segmentation" / "manifest.json"
DEFAULT_AUDIO = ROOT / "test-results" / "pronunciation-segmentation-corpus"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-calibration" / "vietnamese-external-dataset.json"


def build(manifest_path: Path, audio_dir: Path) -> dict:
    payload = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    entries = payload.get("entries") or []
    records = []
    for entry in entries:
        sample_id = str(entry["sampleId"])
        word = str(entry["targetWord"]).lower()
        category = str(entry.get("category") or "clean").lower()
        parsed = parse_pronunciation(str(entry["referenceIpa"]), headword=word)
        if parsed.conflicts:
            raise ValueError(f"reference conflict for {sample_id}: {parsed.conflicts}")
        audio_path = audio_dir / f"{sample_id}.wav"
        if not audio_path.exists():
            raise ValueError(f"missing Vietnamese audio: {audio_path}")
        target_count = int(entry["targetSyllableCount"])
        if parsed.phonological_count != target_count:
            raise ValueError(f"reference count mismatch for {sample_id}")
        label_count = 1 if category in {"clean", "accented"} else 0 if category in {"omission", "insertion"} else None
        label_stress = 1 if category == "clean" and target_count > 1 else 0 if category == "accented" else None
        records.append({
            "id": sample_id,
            "source_recording_id": sample_id,
            "speaker_id": str(entry.get("speakerCohort") or "l1-vn-01"),
            "gender": "unknown",
            "split": "vietnamese_external",
            "word": word,
            "audio_path": str(audio_path.resolve()),
            "reference_ipa": entry["referenceIpa"],
            "reference_syllables": [str(item["ipa"]) for item in parsed.syllables],
            "expected_stress": parsed.primary_stress,
            "syllable_count": target_count,
            "label_count": label_count,
            "label_stress": label_stress,
            "category": category,
            "source_hash": entry.get("sourceHash"),
        })
    manifest_hash = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    return {
        "schema_version": "vietnamese-external-dataset-v1",
        "records": records,
        "provenance": {"archive_sha256": manifest_hash, "role": "external_evidence_only"},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--audio", type=Path, default=DEFAULT_AUDIO)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = build(args.manifest, args.audio)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    categories: dict[str, int] = {}
    for row in result["records"]:
        categories[row["category"]] = categories.get(row["category"], 0) + 1
    print(json.dumps({"output": str(args.output), "records": len(result["records"]), "categories": categories}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
