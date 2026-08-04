#!/usr/bin/env python3
"""Shadow accuracy measurement: V3 phoneme recognizer vs V2 Praat acoustic.

Posts Kokoro corpus audio to the production /analyze/v3 endpoint (which runs in
shadow mode), then reads Cloud Run logs to extract the V3 phoneme count
alongside the V2 Praat count. Both are compared against CMU ground truth.

The V2 count returned in the API response is the UNGUIDED Praat detector
(expected_syllable_count=None in shadow mode), so it matches the 0.656 baseline.
The V3 count comes from the phoneme recognizer's independent syllabification.

Usage:
  python scripts/benchmarks/compare_v3_shadow.py [--limit N] [--output PATH]
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "reference-dataset.json"
DEFAULT_OUTPUT = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "v3-shadow-comparison.json"
DEFAULT_API = "https://praat-api-1071929245506.us-central1.run.app"
ORIGIN = "https://betterenglishlearning.com"
GCLOUD = r"C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"


def post_audio_v3(api: str, audio_path: Path, expected: int, word: str,
                  timeout: int = 120) -> dict:
    boundary = "----belv3shadow8a2c"
    audio = audio_path.read_bytes()
    parts = [
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="expected_syllables"\r\n\r\n',
        f"{expected}\r\n".encode(),
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="target_word"\r\n\r\n',
        f"{word}\r\n".encode(),
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="audio"; filename="{audio_path.name}"\r\n'.encode(),
        b"Content-Type: audio/wav\r\n\r\n",
        audio,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{api}/analyze/v3",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Origin": ORIGIN,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def read_shadow_logs(project: str = "parselmouth", minutes: int = 30,
                     limit: int = 1000) -> list[dict]:
    """Read V3 shadow log entries from Cloud Run stdout."""
    log_filter = (
        f'resource.type="cloud_run_revision" '
        f'resource.labels.service_name="praat-api" '
        f'jsonPayload.message=~"pronunciation_v3_shadow" '
        f'timestamp>="{_minutes_ago(minutes)}"'
    )
    cmd = [
        GCLOUD, "logging", "read", log_filter,
        "--project", project,
        "--format", "json",
        "--limit", str(limit),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"Warning: gcloud logging read failed: {result.stderr.strip()}")
        return []

    entries = json.loads(result.stdout) if result.stdout.strip() else []
    shadow_rows = []
    for entry in entries:
        msg = entry.get("jsonPayload", {}).get("message", "")
        if "pronunciation_v3_shadow" not in msg:
            text_msg = entry.get("textPayload", "")
            if "pronunciation_v3_shadow" not in text_msg:
                continue
            msg = text_msg

        prefix = "V3 shadow result: "
        idx = msg.find(prefix)
        if idx < 0:
            continue
        try:
            shadow_rows.append(json.loads(msg[idx + len(prefix):]))
        except json.JSONDecodeError:
            continue
    return shadow_rows


def _minutes_ago(minutes: int) -> str:
    from datetime import datetime, timezone, timedelta
    t = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--api", default=DEFAULT_API)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--seed", type=int, default=20260801)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--skip-post", action="store_true",
                        help="Skip POSTing audio, just read logs from a prior run")
    args = parser.parse_args()

    records = json.loads(args.dataset.read_text(encoding="utf-8"))["records"]
    random.Random(args.seed).shuffle(records)
    records = records[: args.limit]
    ground_truth = {r["word"]: int(r["syllable_count"]) for r in records}

    # ── Phase 1: POST audio to /analyze/v3 ──────────────────────────
    v2_from_response = {}
    if not args.skip_post:
        print(f"Phase 1: posting {len(records)} files to {args.api}/analyze/v3")
        for i, record in enumerate(records, 1):
            audio_path = Path(record["audio_path"])
            if not audio_path.exists():
                audio_path = (ROOT / "test-results" / "pronunciation-kokoro-benchmark"
                              / "audio" / f"{record['id']}.wav")
            expected = int(record["syllable_count"])
            word = record["word"]
            try:
                result = post_audio_v3(args.api, audio_path, expected, word,
                                       args.timeout)
            except Exception as e:
                print(f"  [{i:3d}/{len(records)}] {word:<16} FAILED: {e}")
                continue

            v2_count = result.get("syllable_count", 0)
            v2_from_response[record["id"]] = {
                "word": word,
                "expected": expected,
                "v2_count": v2_count,
                "v2_correct": v2_count == expected,
                "mode": result.get("mode", "unknown"),
            }
            status = "ok " if v2_count == expected else "MISS"
            print(f"  [{i:3d}/{len(records)}] {word:<16} {status} "
                  f"v2={v2_count} expected={expected} mode={result.get('mode')}")

        print(f"\nPhase 1 done: {len(v2_from_response)}/{len(records)} analyzed")
        print("Waiting 15s for logs to propagate...")
        time.sleep(15)

    # ── Phase 2: read shadow logs ────────────────────────────────────
    print("\nPhase 2: reading Cloud Run shadow logs...")
    shadow_logs = read_shadow_logs(minutes=30, limit=len(records) * 2)
    print(f"  found {len(shadow_logs)} shadow log entries")

    # Match logs to ground truth by target_word. Multiple logs per word
    # (multiple voices) → keep all.
    v3_results = []
    words_seen = Counter()
    for log in shadow_logs:
        word = log.get("target_word")
        if not word or word not in ground_truth:
            continue
        expected = ground_truth[word]
        v3_count = log.get("v3_count")
        v2_count = log.get("v2_count")
        v3_results.append({
            "word": word,
            "expected": expected,
            "v3_count": v3_count,
            "v2_count": v2_count,
            "v3_correct": v3_count == expected if v3_count is not None else None,
            "v2_correct": v2_count == expected if v2_count is not None else None,
            "disagreement": log.get("disagreement_category"),
            "confidence": log.get("confidence"),
            "quality_reason": log.get("quality_reason"),
            "model_revision": log.get("model_revision"),
            "latency": log.get("latency_seconds"),
        })
        words_seen[word] += 1

    # ── Phase 3: report ─────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("V3 Shadow Accuracy Report")
    print(f"{'='*60}")

    if not v3_results:
        print("\nNo shadow log entries matched. Possible causes:")
        print("  - phoneme-recognizer service is not responding")
        print("  - shadow logs haven't propagated yet")
        print("  - gcloud logging read failed")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({"error": "no_shadow_logs"}, indent=2))
        return 1

    v3_rateable = [r for r in v3_results if r["v3_count"] is not None]
    v3_correct = sum(1 for r in v3_rateable if r["v3_correct"])
    v2_rateable = [r for r in v3_results if r["v2_count"] is not None]
    v2_correct = sum(1 for r in v2_rateable if r["v2_correct"])

    v3_acc = v3_correct / len(v3_rateable) if v3_rateable else 0
    v2_acc = v2_correct / len(v2_rateable) if v2_rateable else 0

    v3_errors = Counter()
    for r in v3_rateable:
        if not r["v3_correct"]:
            delta = r["v3_count"] - r["expected"]
            v3_errors[delta] += 1

    v2_errors = Counter()
    for r in v2_rateable:
        if not r["v2_correct"]:
            delta = r["v2_count"] - r["expected"]
            v2_errors[delta] += 1

    disagreements = Counter(r["disagreement"] for r in v3_results)

    print(f"\nFiles posted:        {len(records)}")
    print(f"Shadow logs matched: {len(v3_results)}")
    print(f"Unique words:        {len(words_seen)}")
    print(f"\nV3 (phoneme recognizer):")
    print(f"  rateable:  {len(v3_rateable)}")
    print(f"  correct:   {v3_correct}/{len(v3_rateable)} = {v3_acc:.3f}")
    print(f"  error dist: {dict(sorted(v3_errors.items()))}")
    print(f"\nV2 (Praat acoustic, unguided):")
    print(f"  rateable:  {len(v2_rateable)}")
    print(f"  correct:   {v2_correct}/{len(v2_rateable)} = {v2_acc:.3f}")
    print(f"  error dist: {dict(sorted(v2_errors.items()))}")
    print(f"\nAccuracy delta (V3 - V2): {v3_acc - v2_acc:+.3f}")
    print(f"Disagreement: {dict(disagreements)}")

    if v3_rateable:
        avg_latency = sum(r["latency"] or 0 for r in v3_rateable) / len(v3_rateable)
        model_revs = set(r["model_revision"] for r in v3_rateable if r["model_revision"])
        print(f"Avg latency:  {avg_latency:.2f}s")
        print(f"Model revisions: {model_revs or 'none'}")

    quality_reasons = Counter(r["quality_reason"] for r in v3_results if r["quality_reason"])
    if quality_reasons:
        print(f"Quality reasons: {dict(quality_reasons)}")

    # ── Save ────────────────────────────────────────────────────────
    report = {
        "files_posted": len(records),
        "shadow_logs_matched": len(v3_results),
        "v3_accuracy": round(v3_acc, 4),
        "v3_rateable": len(v3_rateable),
        "v3_correct": v3_correct,
        "v3_error_distribution": dict(sorted(v3_errors.items())),
        "v2_accuracy": round(v2_acc, 4),
        "v2_rateable": len(v2_rateable),
        "v2_correct": v2_correct,
        "v2_error_distribution": dict(sorted(v2_errors.items())),
        "accuracy_delta": round(v3_acc - v2_acc, 4),
        "disagreement_distribution": dict(disagreements),
        "results": v3_results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nWrote {args.output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
