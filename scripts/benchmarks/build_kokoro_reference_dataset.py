#!/usr/bin/env python3
"""Build isolated-word reference rows for the existing 50 x 5 Kokoro set."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_AUDIO = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "audio"
DEFAULT_CMU = ROOT / "public" / "cmudict.json"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "reference-dataset.json"
VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}


def parse_source(path: Path) -> tuple[str, str]:
    if not path.stem.startswith("kokoro-") or "-" not in path.stem[7:]:
        raise ValueError(f"unexpected Kokoro filename: {path.name}")
    voice, word = path.stem[7:].rsplit("-", 1)
    return voice, word.lower()


def build(audio_dir: Path, cmu_path: Path) -> dict:
    cmu = json.loads(cmu_path.read_text(encoding="utf-8"))
    records = []
    digest = hashlib.sha256()
    for path in sorted(audio_dir.glob("*.wav")):
        voice, word = parse_source(path)
        pronunciation = cmu.get(word)
        if not isinstance(pronunciation, str) or not pronunciation.strip():
            raise ValueError(f"missing CMU pronunciation for {word}")
        phones = pronunciation.split()
        syllable_count = sum((phone[:-1] if phone[-1:].isdigit() else phone) in VOWELS for phone in phones)
        digest.update(path.name.encode("utf-8"))
        digest.update(str(path.stat().st_size).encode("ascii"))
        records.append({
            "id": path.stem,
            "source_recording_id": path.stem,
            "speaker_id": voice,
            "gender": "female" if voice.startswith("af_") else "male" if voice.startswith("am_") else "unknown",
            "split": "train_augmentation",
            "word": word,
            "audio_path": str(path.resolve()),
            "utterance_text": word,
            "utterance_reference_phones": pronunciation,
            "word_phone_range": [0, len(phones)],
            "reference_phones": pronunciation,
            "syllable_count": syllable_count,
            "label_count": 1,
            "label_stress": 1 if syllable_count > 1 else None,
        })
    return {
        "schema_version": "kokoro-reference-dataset-v1",
        "records": records,
        "provenance": {"archive_sha256": digest.hexdigest(), "role": "synthetic_augmentation_source"},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, default=DEFAULT_AUDIO)
    parser.add_argument("--cmu", type=Path, default=DEFAULT_CMU)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = build(args.audio, args.cmu)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "records": len(result["records"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
