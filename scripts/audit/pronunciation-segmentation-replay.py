#!/usr/bin/env python3
"""Replay unique saved manual reviews and score V3 syllable partitions.

Historical manual/display gaps are converted to their adjacent midpoint only
for evaluation. The source JSON files are never modified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


PARTITION_CONVENTIONS = {
    "ctc-interspan-midpoint-contiguous-v1",
    "ctc-interspan-acoustic-tail-contiguous-v2",
    "ctc-interspan-acoustic-hybrid-contiguous-v3",
}


def _time(span: dict[str, Any], start: bool) -> float:
    keys = ("startTime", "start_time", "start") if start else ("endTime", "end_time", "end")
    for key in keys:
        if key in span and span[key] is not None:
            return float(span[key])
    raise ValueError(f"Span is missing {'start' if start else 'end'} time: {span!r}")


def contiguous_boundaries(spans: Iterable[dict[str, Any]]) -> list[float]:
    """Return N+1 boundaries, normalizing historical gaps to midpoints."""
    ordered = list(spans)
    if not ordered:
        return []
    boundaries = [_time(ordered[0], True)]
    for current, following in zip(ordered, ordered[1:]):
        boundaries.append((_time(current, False) + _time(following, True)) / 2.0)
    boundaries.append(_time(ordered[-1], False))
    return boundaries


def coverage_edges(spans: Iterable[dict[str, Any]]) -> list[float]:
    return [value for span in spans for value in (_time(span, True), _time(span, False))]


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(len(ordered) - 1, lower + 1)
    fraction = position - lower
    return ordered[lower] + ((ordered[upper] - ordered[lower]) * fraction)


def summarize_errors(errors_seconds: Iterable[float]) -> dict[str, float | int]:
    errors = [abs(float(value)) for value in errors_seconds]
    if not errors:
        return {
            "edgeCount": 0,
            "maeMs": 0.0,
            "medianMs": 0.0,
            "p90Ms": 0.0,
            "maxMs": 0.0,
            "within20Pct": 0.0,
            "within40Pct": 0.0,
            "within60Pct": 0.0,
        }

    def milliseconds(value: float) -> float:
        return round(value * 1000.0, 3)

    return {
        "edgeCount": len(errors),
        "maeMs": milliseconds(sum(errors) / len(errors)),
        "medianMs": milliseconds(_percentile(errors, 0.5)),
        "p90Ms": milliseconds(_percentile(errors, 0.9)),
        "maxMs": milliseconds(max(errors)),
        "within20Pct": round(100.0 * sum(value <= 0.020000001 for value in errors) / len(errors), 1),
        "within40Pct": round(100.0 * sum(value <= 0.040000001 for value in errors) / len(errors), 1),
        "within60Pct": round(100.0 * sum(value <= 0.060000001 for value in errors) / len(errors), 1),
    }


def _manual_payload(document: dict[str, Any]) -> dict[str, Any]:
    return document.get("manualReview") or {}


def load_unique_reviews(root: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    reviews: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()
    candidate_count = 0
    duplicate_count = 0
    missing_audio_count = 0
    for json_path in sorted(root.glob("*manual-review*.json")):
        wav_path = json_path.with_suffix(".wav")
        if not wav_path.exists():
            missing_audio_count += 1
            continue
        candidate_count += 1
        source_hash = hashlib.sha256(wav_path.read_bytes()).hexdigest()
        if source_hash in seen_hashes:
            duplicate_count += 1
            continue
        seen_hashes.add(source_hash)
        document = json.loads(json_path.read_text(encoding="utf-8"))
        manual = _manual_payload(document)
        analysis = document.get("analysis") or {}
        manual_segments = manual.get("manualSegments") or analysis.get("manualSegments") or []
        displayed_segments = manual.get("automaticSegments") or analysis.get("automaticSegments") or []
        reference = document.get("reference") or {}
        reviews.append({
            "id": document.get("sampleId") or json_path.stem,
            "word": manual.get("targetWord") or document.get("word"),
            "expectedCount": int(manual.get("expectedObservedCount") or reference.get("syllableCount") or 0),
            "referenceIpa": manual.get("referenceIpa") or reference.get("displayIpa") or reference.get("rawIpa"),
            "referenceSyllableIpa": manual.get("referenceSyllableIpa")
                or [item.get("ipa") for item in reference.get("syllables") or []],
            "primaryStress": reference.get("primaryStress"),
            "manualSegments": manual_segments,
            "displayedSegments": displayed_segments,
            "audioPath": str(wav_path),
            "audioSha256": source_hash,
        })
    return reviews, {
        "candidateCount": candidate_count,
        "uniqueCount": len(reviews),
        "duplicateCount": duplicate_count,
        "missingAudioCount": missing_audio_count,
    }


def replay_review(review: dict[str, Any], base_url: str, timeout: float = 90.0) -> dict[str, Any]:
    import requests
    import urllib3

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    reference_syllables = review["referenceSyllableIpa"]
    replay_reference_ipa = review["referenceIpa"]
    if (
        isinstance(reference_syllables, list)
        and len(reference_syllables) == review["expectedCount"]
        and all(isinstance(syllable, str) and syllable for syllable in reference_syllables)
    ):
        replay_syllables = list(reference_syllables)
        primary_stress = review.get("primaryStress")
        if isinstance(primary_stress, int) and 0 <= primary_stress < len(replay_syllables):
            replay_syllables[primary_stress] = "\u02c8" + replay_syllables[primary_stress]
        replay_reference_ipa = "/" + ".".join(replay_syllables) + "/"
    data = {
        "reference_ipa": replay_reference_ipa,
        "reference_syllables": json.dumps(reference_syllables, ensure_ascii=False),
        "expected_syllables": str(review["expectedCount"]),
        "target_word": review["word"],
    }
    audio_path = Path(review["audioPath"])
    with audio_path.open("rb") as audio_file:
        response = requests.post(
            f"{base_url.rstrip('/')}/analyze/compare",
            files={"audio": (audio_path.name, audio_file, "audio/wav")},
            data=data,
            timeout=timeout,
            verify=False,
        )
    response.raise_for_status()
    payload = response.json()
    envelope = payload.get("v3") or {}
    analysis = envelope.get("analysis") or {}
    syllables = analysis.get("observed_syllables") or []
    raw_segments = [{
        "startTime": _time(span, True),
        "endTime": _time(span, False),
    } for span in syllables]
    partition_segments = [{
        "startTime": float(span.get("partitionStartTime", span.get("partition_start_time"))),
        "endTime": float(span.get("partitionEndTime", span.get("partition_end_time"))),
    } for span in syllables if (
        span.get("partitionStartTime", span.get("partition_start_time")) is not None
        and span.get("partitionEndTime", span.get("partition_end_time")) is not None
    )]
    quality = analysis.get("quality") or {}
    explicitly_unrateable = quality.get("rateable") is False
    return {
        "status": envelope.get("status"),
        "reason": envelope.get("reason"),
        "rateable": envelope.get("status") == "available" and not explicitly_unrateable,
        "partitionConvention": analysis.get("partition_convention"),
        "rawSegments": raw_segments,
        "partitionSegments": partition_segments,
    }


def _absolute_errors(actual: list[float], expected: list[float]) -> list[float]:
    if len(actual) != len(expected):
        raise ValueError(f"Cannot compare {len(actual)} edges with {len(expected)} edges")
    return [abs(left - right) for left, right in zip(actual, expected)]


def evaluate_replays(reviews: list[dict[str, Any]]) -> dict[str, Any]:
    partition_errors: list[float] = []
    partition_errors_with_displayed_baseline: list[float] = []
    displayed_errors: list[float] = []
    raw_errors: list[float] = []
    included: list[str] = []
    excluded: list[dict[str, str]] = []
    count_failures: list[str] = []
    rateability_failures: list[str] = []
    displayed_baseline_missing: list[str] = []
    per_sample: dict[str, Any] = {}

    for review in reviews:
        sample_id = str(review["id"])
        expected_count = int(review["expectedCount"])
        manual = list(review.get("manualSegments") or [])
        displayed = list(review.get("displayedSegments") or [])
        replay = review.get("replay") or {}
        raw = list(replay.get("rawSegments") or [])
        partition = list(replay.get("partitionSegments") or [])
        counts = [len(manual), len(raw), len(partition)]
        if any(count != expected_count for count in counts):
            count_failures.append(sample_id)
            excluded.append({"id": sample_id, "reason": "SYLLABLE_COUNT_MISMATCH"})
            continue
        if replay.get("rateable") is False:
            rateability_failures.append(sample_id)
            excluded.append({"id": sample_id, "reason": "UNRATEABLE"})
            continue
        if replay.get("partitionConvention") is not None and replay.get("partitionConvention") not in PARTITION_CONVENTIONS:
            excluded.append({"id": sample_id, "reason": "PARTITION_CONVENTION_MISMATCH"})
            continue

        manual_boundaries = contiguous_boundaries(manual)
        sample_partition_errors = _absolute_errors(contiguous_boundaries(partition), manual_boundaries)
        sample_raw_errors = _absolute_errors(coverage_edges(raw), coverage_edges(manual))
        partition_errors.extend(sample_partition_errors)
        raw_errors.extend(sample_raw_errors)
        included.append(sample_id)
        sample_report = {
            "partition": summarize_errors(sample_partition_errors),
            "rawCtcCoverage": summarize_errors(sample_raw_errors),
        }
        if len(displayed) == expected_count:
            sample_displayed_errors = _absolute_errors(contiguous_boundaries(displayed), manual_boundaries)
            displayed_errors.extend(sample_displayed_errors)
            partition_errors_with_displayed_baseline.extend(sample_partition_errors)
            sample_report["displayed"] = summarize_errors(sample_displayed_errors)
        else:
            displayed_baseline_missing.append(sample_id)
            sample_report["displayed"] = None
        per_sample[sample_id] = sample_report

    partition_summary = summarize_errors(partition_errors)
    displayed_summary = summarize_errors(displayed_errors)
    matched_partition_summary = summarize_errors(partition_errors_with_displayed_baseline)
    raw_summary = summarize_errors(raw_errors)

    def improvement(baseline: dict[str, Any], candidate: dict[str, Any]) -> float:
        baseline_mae = float(baseline["maeMs"])
        if baseline_mae <= 0:
            return 0.0
        return round(100.0 * (baseline_mae - float(candidate["maeMs"])) / baseline_mae, 1)

    return {
        "includedCount": len(included),
        "excludedCount": len(excluded),
        "included": included,
        "excluded": excluded,
        "countFailures": count_failures,
        "rateabilityFailures": rateability_failures,
        "displayedBaselineMissing": displayed_baseline_missing,
        "partition": partition_summary,
        "partitionOnDisplayedBaselineSet": matched_partition_summary,
        "displayed": displayed_summary,
        "rawCtcCoverage": raw_summary,
        "improvementVsDisplayedPct": improvement(displayed_summary, matched_partition_summary),
        "improvementVsRawCtcPct": improvement(raw_summary, partition_summary),
        "perSample": per_sample,
    }


def acceptance_gates(report: dict[str, Any], reported_sha: str = "2083e91799e814806a78e26b53b6ae51f1365715a6e50e151a2ed2075a6701d2") -> dict[str, bool]:
    reported = next(
        (metrics for sample_id, metrics in report["perSample"].items() if reported_sha in sample_id),
        None,
    )
    # The caller normally supplies IDs containing the hash suffix for stable
    # lookup. Fall back to an explicit reportedSample injected by the CLI.
    reported = report.get("reportedSample") or reported
    return {
        "pooledMaeAtMost35Ms": report["partition"]["maeMs"] <= 35.0,
        "atLeast75PctWithin40Ms": report["partition"]["within40Pct"] >= 75.0,
        "atLeast25PctBetterThanDisplayed": report["improvementVsDisplayedPct"] >= 25.0,
        "atLeast25PctBetterThanRawCtc": report["improvementVsRawCtcPct"] >= 25.0,
        "reportedSampleMaeAtMost15Ms": bool(reported and reported["partition"]["maeMs"] <= 15.0),
        "reportedSampleMaxAtMost30Ms": bool(reported and reported["partition"]["maxMs"] <= 30.0),
        "noCountOrRateabilityRegression": (
            report["includedCount"] >= 5
            and len(report["countFailures"]) <= 1
            and not report["rateabilityFailures"]
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=Path, default=Path("test-results/pronounce-local-samples"))
    parser.add_argument("--base-url", default="https://127.0.0.1:8081")
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    reviews, inventory = load_unique_reviews(args.samples)
    replayed = []
    for review in reviews:
        result = replay_review(review, args.base_url, args.timeout)
        replayed.append({**review, "replay": result})
        print(
            f"{review['id']}: v3={result['status']} "
            f"count={len(result['partitionSegments'])}/{review['expectedCount']} "
            f"rateable={result['rateable']}"
        )

    report = evaluate_replays(replayed)
    reported = next((review for review in replayed if review["audioSha256"].startswith("2083e917")), None)
    if reported and reported["id"] in report["perSample"]:
        report["reportedSample"] = report["perSample"][reported["id"]]
    report["inventory"] = inventory
    report["gates"] = acceptance_gates(report)
    report["passed"] = all(report["gates"].values())
    serialized = json.dumps(report, indent=2, ensure_ascii=False)
    print(serialized)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized + "\n", encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
