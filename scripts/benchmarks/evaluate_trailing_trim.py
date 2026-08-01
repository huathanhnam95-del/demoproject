#!/usr/bin/env python3
"""A/B the final-syllable trailing-silence trim over the Kokoro corpus.

trim_trailing_silence() pulls the final span back off low-energy out-breath so
the last syllable's duration reflects real speech. It was tuned on one sample
(`industrial`), so this validates it across the 250-file Kokoro benchmark:

  * syllable-count accuracy must not regress (the trim only moves the final
    boundary, never adds or drops a span);
  * total final-span duration should shrink (trailing silence removed), never
    grow.

The pre-fix arm replaces trim_trailing_silence with an identity that returns
speech_end unchanged, so the two arms differ only in the trim.

Usage:
  python scripts/benchmarks/evaluate_trailing_trim.py [--limit N] [--output PATH]
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.local_server import server  # noqa: E402

DEFAULT_DATASET = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "reference-dataset.json"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "trailing-trim-ab.json"


def _identity_trim(final_start, speech_end, *_args, **_kwargs):
    return speech_end


def measure(records, *, trim_enabled):
    original = server.trim_trailing_silence
    if not trim_enabled:
        server.trim_trailing_silence = _identity_trim

    rows = []
    try:
        for record in records:
            audio_path = Path(record["audio_path"])
            if not audio_path.exists():
                audio_path = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "audio" / f"{record['id']}.wav"
            expected = int(record["syllable_count"])
            try:
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    result = server.analyze_audio(str(audio_path), expected_syllables=expected)
            except Exception as error:  # noqa: BLE001
                rows.append({"id": record["id"], "error": str(error)})
                continue

            spans = result.get("syllables") or []
            final_dur = float(spans[-1]["duration"]) if spans else 0.0
            final_end = float(spans[-1]["endTime"]) if spans else 0.0
            rows.append({
                "id": record["id"],
                "word": record["word"],
                "expected": expected,
                "observed": len(spans),
                "countCorrect": len(spans) == expected,
                "finalDuration": round(final_dur, 4),
                "finalEnd": round(final_end, 4),
            })
    finally:
        server.trim_trailing_silence = original

    analyzed = [r for r in rows if "error" not in r]
    correct = sum(1 for r in analyzed if r["countCorrect"])
    return {
        "trimEnabled": trim_enabled,
        "files": len(rows),
        "analyzed": len(analyzed),
        "errors": len(rows) - len(analyzed),
        "countCorrect": correct,
        "countAccuracy": round(correct / len(analyzed), 4) if analyzed else 0.0,
        "totalFinalDuration": round(sum(r["finalDuration"] for r in analyzed), 4),
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    records = dataset["records"]
    if args.limit:
        records = records[: args.limit]

    on = measure(records, trim_enabled=True)
    off = measure(records, trim_enabled=False)

    by_id = {r["id"]: r for r in off["rows"] if "error" not in r}
    changed = 0
    regressed = 0
    trimmed_total = 0.0
    for r in on["rows"]:
        if "error" in r:
            continue
        base = by_id.get(r["id"])
        if not base:
            continue
        delta = base["finalEnd"] - r["finalEnd"]
        if delta > 1e-6:
            changed += 1
            trimmed_total += delta
        if r["finalEnd"] > base["finalEnd"] + 1e-6:
            regressed += 1

    print(f"Kokoro trailing-trim A/B over {len(records)} files")
    print(f"  trim ON  count {on['countCorrect']}/{on['analyzed']} = {on['countAccuracy']:.3f} "
          f"| total final-span dur {on['totalFinalDuration']:.3f}s | errors {on['errors']}")
    print(f"  trim OFF count {off['countCorrect']}/{off['analyzed']} = {off['countAccuracy']:.3f} "
          f"| total final-span dur {off['totalFinalDuration']:.3f}s | errors {off['errors']}")
    print(f"  count accuracy delta: {on['countAccuracy'] - off['countAccuracy']:+.4f}")
    print(f"  files trimmed: {changed} | total trailing silence removed: {round(trimmed_total, 3)}s")
    print(f"  files where trim EXTENDED the span (must be 0): {regressed}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"trimEnabled": on, "trimDisabled": off,
                    "filesTrimmed": changed, "trailingSilenceRemoved": round(trimmed_total, 4),
                    "filesExtended": regressed}, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {args.output}")
    return 0 if regressed == 0 and on["countAccuracy"] >= off["countAccuracy"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
