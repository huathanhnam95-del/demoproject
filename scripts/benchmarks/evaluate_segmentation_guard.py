#!/usr/bin/env python3
"""A/B the count-matched split guard over the Kokoro benchmark corpus.

The guard in split_oversized_syllables() skips splitting once the detector has
already produced the expected number of spans. It was introduced from a single
hand-labelled sample (`industrial`), so before shipping it we measure it across
the whole 250-file Kokoro set against CMU syllable counts.

Reports, for guard-enabled and guard-disabled runs:
  * syllable-count accuracy vs the CMU reference count
  * internal gaps between consecutive spans (the artifact the guard targets)

Usage:
  python scripts/benchmarks/evaluate_segmentation_guard.py [--limit N] [--output PATH]
"""
from __future__ import annotations

import argparse
import inspect
import json
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.local_server import server  # noqa: E402

DEFAULT_DATASET = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "reference-dataset.json"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "segmentation-guard-ab.json"

# Two consecutive spans that should be contiguous but are not. The industrial
# regression showed a 160 ms hole; anything above this is not rounding noise.
GAP_THRESHOLD_S = 0.05


GUARD_NEW = "if not syllables or not expected_count or len(syllables) >= expected_count:"
GUARD_OLD = "if not syllables or not expected_count:"


def build_pre_fix_split():
    """Rebuild split_oversized_syllables() with only the guard reverted.

    Reconstructing from live source keeps the two arms of the A/B identical in
    every other respect. Rewriting expected_count instead would also change
    `expected_avg`, which sets max_duration -- that would measure two different
    things and attribute the difference to the guard.
    """
    source = textwrap.dedent(inspect.getsource(server.split_oversized_syllables))
    if GUARD_NEW not in source:
        raise SystemExit(
            "split_oversized_syllables no longer contains the expected guard; "
            "update GUARD_NEW in this script before trusting the comparison."
        )
    namespace = {}
    exec(source.replace(GUARD_NEW, GUARD_OLD), server.__dict__, namespace)  # noqa: S102
    return namespace["split_oversized_syllables"]


def measure(records, *, guard_enabled):
    """Analyze every record. `guard_enabled=False` restores pre-fix behaviour."""
    original = server.split_oversized_syllables

    if not guard_enabled:
        server.split_oversized_syllables = build_pre_fix_split()

    rows = []
    try:
        for record in records:
            audio_path = Path(record["audio_path"])
            if not audio_path.exists():
                audio_path = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "audio" / f"{record['id']}.wav"
            expected = int(record["syllable_count"])
            try:
                result = server.analyze_audio(str(audio_path), expected_syllables=expected)
            except Exception as error:  # noqa: BLE001 - a failed file is a data point
                rows.append({"id": record["id"], "error": str(error)})
                continue

            spans = result.get("syllables") or []
            gaps = []
            for left, right in zip(spans, spans[1:]):
                gap = float(right["startTime"]) - float(left["endTime"])
                if gap > GAP_THRESHOLD_S:
                    gaps.append(round(gap, 4))

            rows.append({
                "id": record["id"],
                "word": record["word"],
                "expected": expected,
                "observed": len(spans),
                "countCorrect": len(spans) == expected,
                "gapCount": len(gaps),
                "gapTotal": round(sum(gaps), 4),
                "maxGap": round(max(gaps), 4) if gaps else 0.0,
            })
    finally:
        server.split_oversized_syllables = original

    analyzed = [row for row in rows if "error" not in row]
    correct = sum(1 for row in analyzed if row["countCorrect"])
    with_gaps = [row for row in analyzed if row["gapCount"] > 0]
    return {
        "guardEnabled": guard_enabled,
        "files": len(rows),
        "analyzed": len(analyzed),
        "errors": len(rows) - len(analyzed),
        "countCorrect": correct,
        "countAccuracy": round(correct / len(analyzed), 4) if analyzed else 0.0,
        "filesWithGaps": len(with_gaps),
        "gapRate": round(len(with_gaps) / len(analyzed), 4) if analyzed else 0.0,
        "totalGapSeconds": round(sum(row["gapTotal"] for row in analyzed), 4),
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

    enabled = measure(records, guard_enabled=True)
    disabled = measure(records, guard_enabled=False)

    def line(label, report):
        print(
            f"{label:16s} count {report['countCorrect']:3d}/{report['analyzed']:3d} "
            f"= {report['countAccuracy']:.3f} | files with gaps {report['filesWithGaps']:3d} "
            f"({report['gapRate']:.3f}) | total gap {report['totalGapSeconds']:.3f}s "
            f"| errors {report['errors']}"
        )

    print(f"Kokoro segmentation guard A/B over {len(records)} files")
    line("guard ON", enabled)
    line("guard OFF", disabled)
    delta = enabled["countAccuracy"] - disabled["countAccuracy"]
    print(f"count accuracy delta: {delta:+.4f}")
    print(f"files with gaps delta: {enabled['filesWithGaps'] - disabled['filesWithGaps']:+d}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"guardEnabled": enabled, "guardDisabled": disabled}, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
