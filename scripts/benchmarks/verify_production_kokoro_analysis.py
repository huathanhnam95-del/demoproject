#!/usr/bin/env python3
"""End-to-end accuracy check: Kokoro audio -> the live production Praat API.

The local A/B (evaluate_segmentation_guard.py) proves the segmentation guard is
safe in-process. This proves the deployed Cloud Run revision actually analyzes
real Kokoro speech correctly through HTTP, which is what learners hit.

Sends Kokoro-generated WAVs to /analyze/v2 with the CMU syllable count as the
target and reports how often the returned segmentation matches, plus how many
responses carry the gap artifact the guard removes.

Usage:
  python scripts/benchmarks/verify_production_kokoro_analysis.py [--limit N]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "reference-dataset.json"
DEFAULT_API = "https://praat-api-1071929245506.us-central1.run.app"
ORIGIN = "https://betterenglishlearning.com"
GAP_THRESHOLD_S = 0.05


def post_audio(api, audio_path: Path, expected: int, timeout: int):
    """Multipart POST without pulling in a dependency."""
    boundary = "----belverify7d9f2a1c"
    audio = audio_path.read_bytes()
    parts = [
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="expected_syllables"\r\n\r\n',
        f"{expected}\r\n".encode(),
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="audio"; filename="{audio_path.name}"\r\n'.encode(),
        b"Content-Type: audio/wav\r\n\r\n",
        audio,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    request = urllib.request.Request(
        f"{api}/analyze/v2",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Origin": ORIGIN,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--api", default=DEFAULT_API)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--seed", type=int, default=20260731)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    records = json.loads(args.dataset.read_text(encoding="utf-8"))["records"]
    # Sample across voices and words rather than taking the alphabetical head,
    # which would only cover 'a' words from one or two speakers.
    random.Random(args.seed).shuffle(records)
    records = records[: args.limit]

    matched = 0
    gapped = 0
    failures = []
    print(f"Kokoro -> production analysis over {len(records)} files ({args.api})")

    for index, record in enumerate(records, start=1):
        audio_path = Path(record["audio_path"])
        if not audio_path.exists():
            audio_path = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "audio" / f"{record['id']}.wav"
        expected = int(record["syllable_count"])
        try:
            result = post_audio(args.api, audio_path, expected, args.timeout)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            failures.append((record["id"], str(error)))
            print(f"  [{index:3d}/{len(records)}] {record['word']:<16} REQUEST FAILED: {error}")
            continue

        # /analyze/v2 nests the segmentation under `observed`; the flat
        # `syllables` key belongs to the older /analyze response shape.
        spans = (result.get("observed") or {}).get("syllables") or []
        gaps = [
            round(float(b["startTime"]) - float(a["endTime"]), 4)
            for a, b in zip(spans, spans[1:])
            if float(b["startTime"]) - float(a["endTime"]) > GAP_THRESHOLD_S
        ]
        ok = len(spans) == expected
        matched += ok
        gapped += bool(gaps)
        flag = "ok " if ok else "MISS"
        gap_note = f" gaps={gaps}" if gaps else ""
        print(
            f"  [{index:3d}/{len(records)}] {record['word']:<16} {flag} "
            f"expected={expected} observed={len(spans)}{gap_note}"
        )

    analyzed = len(records) - len(failures)
    print()
    print(f"analyzed              : {analyzed}/{len(records)}")
    if analyzed:
        print(f"segmentation matches  : {matched}/{analyzed} = {matched / analyzed:.3f}")
        print(f"responses with gaps   : {gapped}/{analyzed}")
    for sample_id, error in failures:
        print(f"  FAILED {sample_id}: {error}")

    # The guard's promise is zero gap artifacts; a count miss through the guided
    # endpoint would mean the deployed pipeline disagrees with the local one.
    return 0 if analyzed and matched == analyzed and gapped == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
