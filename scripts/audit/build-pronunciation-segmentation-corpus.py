#!/usr/bin/env python3
"""Build the pronunciation segmentation corpus manifest from source WAV files.

Scans an input directory for WAV files, generates deidentified manifest entries
with SHA-256 hashes, and validates the result against the JSON Schema.

Usage:
    python build-pronunciation-segmentation-corpus.py \
        --input-dir /path/to/wavs \
        --output tests/fixtures/pronunciation-segmentation/manifest.json \
        --schema tests/fixtures/pronunciation-segmentation/manifest.schema.json
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import jsonschema
except ImportError:
    jsonschema = None


def sha256_file(filepath: Path) -> str:
    """Compute the SHA-256 hex digest of a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def deidentify_id(filepath: Path, index: int) -> str:
    """Generate a deidentified sample ID from filename and index.

    Strips non-alphanumeric characters and lowercases the stem,
    appending a zero-padded index for uniqueness.
    """
    stem = filepath.stem.lower()
    clean = re.sub(r"[^a-z0-9]", "-", stem)
    clean = re.sub(r"-+", "-", clean).strip("-")
    return f"{clean}-{index:04d}"


def scan_wav_files(input_dir: Path) -> list[Path]:
    """Recursively find all .wav files under input_dir."""
    wav_files = sorted(input_dir.rglob("*.wav"))
    return wav_files


def build_entry(filepath: Path, index: int) -> dict:
    """Build a single manifest entry for a WAV file.

    The entry uses placeholder values for fields that require manual
    annotation (targetWord, referenceIpa, expectedObservedCount, category,
    speakerCohort, labelProvenance). These should be filled in during
    the manual labelling phase.
    """
    return {
        "sampleId": deidentify_id(filepath, index),
        "targetWord": filepath.stem.lower(),
        "referenceIpa": "",
        "expectedObservedCount": 0,
        "category": "clean",
        "speakerCohort": "unknown",
        "sourceHash": sha256_file(filepath),
        "labelProvenance": "automated",
        "verifiedSpans": None,
    }


def validate_manifest(manifest: dict, schema_path: Path) -> bool:
    """Validate the manifest against the JSON Schema.

    Returns True if valid, raises on failure.
    """
    if jsonschema is None:
        print(
            "WARNING: jsonschema not installed — skipping validation. "
            "Install with: pip install jsonschema",
            file=sys.stderr,
        )
        return True

    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)

    jsonschema.validate(instance=manifest, schema=schema)
    print("Schema validation passed.")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build pronunciation segmentation corpus manifest from WAV files."
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        required=True,
        help="Directory containing source WAV files.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Output path for the manifest JSON file.",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        required=True,
        help="Path to the manifest JSON Schema for validation.",
    )
    args = parser.parse_args()

    if not args.input_dir.is_dir():
        print(f"ERROR: Input directory does not exist: {args.input_dir}", file=sys.stderr)
        sys.exit(1)

    if not args.schema.is_file():
        print(f"ERROR: Schema file does not exist: {args.schema}", file=sys.stderr)
        sys.exit(1)

    wav_files = scan_wav_files(args.input_dir)
    print(f"Found {len(wav_files)} WAV file(s) in {args.input_dir}")

    entries = [build_entry(fp, i) for i, fp in enumerate(wav_files)]

    manifest = {
        "version": "1.0.0",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "entries": entries,
    }

    validate_manifest(manifest, args.schema)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Manifest written to {args.output} with {len(entries)} entries.")


if __name__ == "__main__":
    main()
