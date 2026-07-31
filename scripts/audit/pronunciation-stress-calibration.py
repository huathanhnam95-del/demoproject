#!/usr/bin/env python3
"""Compatibility entry point for the V1 verifier calibration.

Modern records are exported through ``scripts/benchmarks/train_pronunciation_verifier.py``
and the JSON runtime. The legacy feature-only fixture path remains readable so
older audit reports can be reproduced, but it is not used by production V3.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path
from typing import Iterable


MINIMUM_SAMPLE_SIZE = 200
WEIGHT_STEP = 0.1
FINAL_PENALTIES = (0.0, 0.2, 0.35, 0.5)
MINIMUM_CONFIDENCE_THRESHOLD = 0.65


def median(values):
    ordered = sorted(float(value) for value in values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2.0


def feature_vectors(syllables):
    pitches = [float(item.get("avgPitch") or item.get("maxPitch") or 0) for item in syllables]
    durations = [
        float(item.get("vowelDuration") or item.get("duration") or 0)
        for item in syllables
    ]
    intensities = [float(item.get("intensity") or 0) for item in syllables]
    if not syllables or min(pitches) <= 0 or min(durations) <= 0:
        raise ValueError("Every calibration syllable needs positive pitch and duration")
    pitch_median = median(pitches)
    duration_median = median(durations)
    intensity_median = median(intensities)
    return {
        "pitch": [12.0 * math.log2(value / pitch_median) for value in pitches],
        "duration": [math.log2(value / duration_median) for value in durations],
        "intensity": [value - intensity_median for value in intensities],
    }


def predict(record, weights, final_penalty):
    features = feature_vectors(record["syllables"])
    scores = []
    for index in range(len(record["syllables"])):
        score = (
            features["pitch"][index] * weights["pitch"]
            + features["duration"][index] * weights["duration"]
            + features["intensity"][index] * weights["intensity"]
        )
        if index == len(record["syllables"]) - 1:
            score -= final_penalty
        scores.append(score)
    ranking = sorted(range(len(scores)), key=lambda index: scores[index], reverse=True)
    margin = scores[ranking[0]] - scores[ranking[1]] if len(ranking) > 1 else 20.0
    confidence = 1.0 - math.exp(-max(0.0, margin) / 2.0)
    return ranking[0], confidence


def weight_grid():
    steps = int(round(1.0 / WEIGHT_STEP))
    for pitch_step in range(steps + 1):
        for duration_step in range(steps - pitch_step + 1):
            intensity_step = steps - pitch_step - duration_step
            yield {
                "pitch": pitch_step / steps,
                "duration": duration_step / steps,
                "intensity": intensity_step / steps,
            }


def exact_accuracy(records, weights, final_penalty):
    if not records:
        return 0.0
    correct = sum(
        predict(record, weights, final_penalty)[0] == int(record["primaryStress"])
        for record in records
    )
    return correct / len(records)


def stratified_split(records, seed):
    groups = {}
    for record in records:
        groups.setdefault(len(record["syllables"]), []).append(record)
    randomizer = random.Random(seed)
    training = []
    heldout = []
    for group in groups.values():
        randomizer.shuffle(group)
        split_index = max(1, int(len(group) * 0.70))
        training.extend(group[:split_index])
        heldout.extend(group[split_index:])
    return training, heldout


def calibrate(records, seed):
    training, heldout = stratified_split(list(records), seed)
    preferred_weights = {"pitch": 0.5, "duration": 0.3, "intensity": 0.2}
    candidates = []
    for weights in weight_grid():
        distance = sum(abs(weights[key] - preferred_weights[key]) for key in weights)
        for penalty in FINAL_PENALTIES:
            accuracy = exact_accuracy(training, weights, penalty)
            candidates.append((accuracy, -distance, -abs(penalty - 0.35), weights, penalty))
    _, _, _, weights, final_penalty = max(
        candidates,
        key=lambda item: (item[0], item[1], item[2]),
    )

    heldout_predictions = []
    for record in heldout:
        predicted, confidence = predict(record, weights, final_penalty)
        heldout_predictions.append({
            "correct": predicted == int(record["primaryStress"]),
            "confidence": confidence,
        })
    heldout_accuracy = (
        sum(item["correct"] for item in heldout_predictions) / len(heldout_predictions)
        if heldout_predictions else 0.0
    )

    thresholds = sorted({
        MINIMUM_CONFIDENCE_THRESHOLD,
        *[
            item["confidence"]
            for item in heldout_predictions
            if item["confidence"] >= MINIMUM_CONFIDENCE_THRESHOLD
        ],
    })
    threshold_choice = 1.0
    scored_accuracy = 0.0
    scored_count = 0
    for threshold in thresholds:
        scored = [item for item in heldout_predictions if item["confidence"] >= threshold]
        if not scored:
            continue
        accuracy = sum(item["correct"] for item in scored) / len(scored)
        if accuracy >= 0.95 and len(scored) > scored_count:
            threshold_choice = threshold
            scored_accuracy = accuracy
            scored_count = len(scored)

    return {
        "sampleSize": len(records),
        "seed": seed,
        "split": {
            "training": len(training),
            "heldout": len(heldout),
            "stratifiedBySyllableCount": True,
        },
        "configuration": {
            "weights": weights,
            "finalLengtheningPenalty": final_penalty,
            "confidenceThreshold": round(threshold_choice, 6),
        },
        "training": {
            "exactStressAccuracy": round(exact_accuracy(training, weights, final_penalty), 6),
        },
        "heldout": {
            "exactStressAccuracy": round(heldout_accuracy, 6),
            "scoredAccuracy": round(scored_accuracy, 6),
            "scoredCount": scored_count,
            "coverage": round(scored_count / len(heldout), 6) if heldout else 0.0,
        },
        "gates": {
            "minimumSamples": len(records) >= MINIMUM_SAMPLE_SIZE,
            "heldoutExactAtLeast90": heldout_accuracy >= 0.90,
            "scoredAccuracyAtLeast95": scored_accuracy >= 0.95,
            "passed": (
                len(records) >= MINIMUM_SAMPLE_SIZE
                and heldout_accuracy >= 0.90
                and scored_accuracy >= 0.95
            ),
        },
    }


def validate_records(records: Iterable[dict]):
    validated = []
    for record in records:
        word = str(record.get("word") or "").strip()
        syllables = record.get("syllables")
        primary = record.get("primaryStress")
        if not word or not isinstance(syllables, list) or len(syllables) < 2:
            continue
        if not isinstance(primary, int) or not 0 <= primary < len(syllables):
            continue
        feature_vectors(syllables)
        validated.append(record)
    return validated


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        default="test-results/pronunciation-audit-1000.json",
        help=(
            "JSON array of validated native-recording feature records, or a "
            "pronunciation audit report containing calibrationRecords"
        ),
    )
    parser.add_argument("--seed", type=int, default=20260711)
    parser.add_argument("--output", default="test-results/pronunciation-stress-calibration.json")
    return parser.parse_args()


def main():
    args = parse_args()
    with open(args.input, encoding="utf-8") as input_file:
        payload = json.load(input_file)
    raw_records = (
        payload.get("calibrationRecords", [])
        if isinstance(payload, dict)
        else payload
    )
    if raw_records and any(isinstance(record.get("features"), dict) for record in raw_records if isinstance(record, dict)):
        # Keep this historical CLI usable for modern calibration exports while
        # making the production artifact come from the non-circular trainer.
        import subprocess
        modern_input = Path(args.output).with_suffix('.modern-input.json')
        modern_input.write_text(json.dumps(raw_records), encoding='utf-8')
        modern_output = Path(args.output).with_suffix('.verifier.json')
        trainer = Path(__file__).resolve().parents[1] / 'benchmarks' / 'train_pronunciation_verifier.py'
        completed = subprocess.run([sys.executable, str(trainer), '--input', str(modern_input), '--output', str(modern_output)], check=False)
        if completed.returncode != 0:
            return completed.returncode
        print(json.dumps({"modern_artifact": str(modern_output), "schema_version": "pronunciation-verifier-v1"}))
        return 0
    records = validate_records(raw_records)
    report = calibrate(records, args.seed)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))
    return 0 if report["gates"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
