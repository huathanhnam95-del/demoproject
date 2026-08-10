"""Pure-JSON runtime for the pronunciation verifier.

No pickle/joblib is loaded here. The exported artifact is intentionally small,
auditable and safe to evaluate in the request process.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "pronunciation-verifier-v1"
FEATURE_SCHEMA_VERSION = "features-v1"


def validate_artifact(artifact: dict[str, Any]) -> None:
    if artifact.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("verifier schema mismatch")
    if artifact.get("feature_schema_version", FEATURE_SCHEMA_VERSION) != FEATURE_SCHEMA_VERSION:
        raise ValueError("feature schema mismatch")
    if artifact.get("artifact_sha256") == "placeholder-untrained":
        raise ValueError("verifier artifact is not trained")
    actual_hash = artifact.get("artifact_sha256")
    if not isinstance(actual_hash, str) or actual_hash != artifact_sha256(artifact):
        raise ValueError("verifier artifact hash mismatch")
    for name in ("count", "stress"):
        model = artifact.get(name)
        if not isinstance(model, dict):
            raise ValueError(f"missing {name} model")
        if name == "stress" and model.get("mode") == "disabled":
            # An artifact that deliberately ships no stress head. Count-only
            # releases use this so stress is never scored and never claimed.
            continue
        if name == "stress" and model.get("mode") == "ranker":
            features = model.get("features") or []
            weights = model.get("weights") or []
            if not features or len(features) != len(weights):
                raise ValueError("missing stress ranker features")
            means = model.get("means") or [0.0] * len(features)
            scales = model.get("scales") or [1.0] * len(features)
            if len(means) != len(features) or len(scales) != len(features):
                raise ValueError("stress ranker scaler length mismatch")
            if any(not math.isfinite(float(value)) for value in [*weights, *means, *scales]):
                raise ValueError("non-finite stress ranker parameter")
            if any(float(scale) == 0.0 for scale in scales):
                raise ValueError("zero stress ranker scale")
            if float(model.get("margin_threshold", 0.0)) < 0.0:
                raise ValueError("invalid stress ranker margin threshold")
            # A ranker fitted on zero positive rows falls back to hand-written
            # defaults that were never calibrated. Refuse to load it: the
            # placeholder hash is not the only way an artifact can be untrained.
            for field in ("training_positive_rows", "calibration_positive_rows"):
                rows = model.get(field)
                if not isinstance(rows, int) or isinstance(rows, bool) or rows < 1:
                    raise ValueError(f"stress ranker {field} must be a positive integer")
            continue
        if not model.get("coefficients") or not isinstance(model.get("thresholds"), dict):
            raise ValueError(f"missing {name} model")
        if not {"verified", "incorrect"}.issubset(model["thresholds"]):
            raise ValueError(f"missing {name} thresholds")
        feature_count = len(model["coefficients"])
        if len(model.get("mean") or []) != feature_count or len(model.get("scale") or []) != feature_count:
            raise ValueError(f"{name} scaler length mismatch")
        verified = float(model["thresholds"]["verified"])
        incorrect = float(model["thresholds"]["incorrect"])
        # Tiny out-of-range sentinels intentionally disable a decision class
        # when calibration cannot meet its precision requirement. Since model
        # probabilities remain in [0, 1], these values always abstain.
        if not -0.001 <= incorrect < verified <= 1.001:
            raise ValueError(f"invalid {name} threshold order")


def load_artifact(path: str | Path) -> dict[str, Any]:
    artifact = json.loads(Path(path).read_text(encoding="utf-8"))
    validate_artifact(artifact)
    return artifact


def _sigmoid(value: float) -> float:
    value = max(-60.0, min(60.0, value))
    return 1.0 / (1.0 + math.exp(-value))


def _isotonic(points: list[list[float]] | None, value: float) -> float:
    if not points:
        return value
    ordered = sorted((float(x), float(y)) for x, y in points)
    if value <= ordered[0][0]:
        return ordered[0][1]
    for (x0, y0), (x1, y1) in zip(ordered, ordered[1:]):
        if value <= x1:
            if x1 == x0:
                return y1
            fraction = (value - x0) / (x1 - x0)
            return y0 + fraction * (y1 - y0)
    return ordered[-1][1]


def classify_probability(probability: float, *, verified_threshold: float, incorrect_threshold: float) -> str:
    if probability >= verified_threshold:
        return "verified"
    if probability <= incorrect_threshold:
        return "incorrect"
    return "unrateable"


def _evaluate_head(model: dict[str, Any], values: list[float], points: list[list[float]] | None) -> dict[str, Any]:
    mean = model.get("mean", [0.0] * len(values))
    scale = model.get("scale", [1.0] * len(values))
    coefficients = model["coefficients"]
    if len(values) != len(coefficients):
        raise ValueError("feature vector length mismatch")
    z = float(model.get("intercept", 0.0)) + sum(float(coef) * ((float(value) - float(mu)) / (float(sd) or 1.0)) for coef, value, mu, sd in zip(coefficients, values, mean, scale))
    raw = _sigmoid(z)
    probability = _isotonic(points, raw)
    thresholds = model["thresholds"]
    status = classify_probability(probability, verified_threshold=float(thresholds["verified"]), incorrect_threshold=float(thresholds["incorrect"]))
    confidence = probability if status == "verified" else (1.0 - probability if status == "incorrect" else 0.0)
    return {
        "status": status,
        "confidence": round(confidence, 6),
        "match_probability": round(probability, 6),
        "raw_probability": round(raw, 6),
        "reasons": [],
    }


def evaluate_model(artifact: dict[str, Any], feature_vectors: dict[str, list[float]]) -> dict[str, Any]:
    validate_artifact(artifact)
    stress_model = artifact["stress"]
    if stress_model.get("mode") == "disabled":
        stress_result = {
            "status": "unrateable",
            "confidence": 0.0,
            "match_probability": 0.0,
            "raw_probability": 0.0,
            "reasons": ["STRESS_SCORING_DISABLED"],
        }
    elif stress_model.get("mode") == "ranker":
        stress_result = {
            "status": "unrateable",
            "confidence": 0.0,
            "match_probability": 0.0,
            "raw_probability": 0.0,
            "reasons": ["RANKER_REQUIRES_ACOUSTIC_ROWS"],
        }
    else:
        stress_result = _evaluate_head(stress_model, feature_vectors["stress"], artifact.get("isotonic", {}).get("stress"))
    return {
        "count": _evaluate_head(artifact["count"], feature_vectors["count"], artifact.get("isotonic", {}).get("count")),
        "stress": stress_result,
    }


def evaluate_count_model(artifact: dict[str, Any], values: list[float]) -> dict[str, Any]:
    """Evaluate only the count head, allowing stress to use ranker mode."""
    validate_artifact(artifact)
    return _evaluate_head(artifact["count"], values, artifact.get("isotonic", {}).get("count"))


def count_feature_vector(recognizer_result: dict[str, Any], expected_count: int) -> list[float]:
    observed = recognizer_result.get("decoded_syllable_count")
    aligned = recognizer_result.get("canonical_alignment") or {}
    spans = aligned.get("syllables") or []
    confidence = [float(span.get("nucleus_confidence", 0.0)) for span in spans]
    hypotheses = recognizer_result.get("hypotheses") or {}
    def hypothesis_value(name: str, default: float) -> float:
        value = hypotheses.get(name)
        return float(value) if isinstance(value, (int, float)) and math.isfinite(float(value)) else default

    return [
        float((observed if isinstance(observed, (int, float)) else expected_count) - expected_count),
        float(sum(confidence) / len(confidence)) if confidence else 0.0,
        float(min(confidence)) if confidence else 0.0,
        hypothesis_value("canonical_log_likelihood", -20.0),
        hypothesis_value("canonical_minus_omission", 0.0),
        hypothesis_value("canonical_minus_insertion", 0.0),
        float(sum(float(span.get("confidence", 0.0)) for span in spans) / len(spans)) if spans else 0.0,
        float(recognizer_result.get("audio_duration_sec", 0.0)) / max(1, expected_count),
    ]


def _finite_contour_values(contour: dict[str, Any], start: float, end: float, *, positive: bool = False) -> list[tuple[float, float]]:
    times = contour.get("times") or []
    values = contour.get("values") or []
    result: list[tuple[float, float]] = []
    for raw_time, raw_value in zip(times, values):
        if not isinstance(raw_time, (int, float)) or not isinstance(raw_value, (int, float)):
            continue
        time = float(raw_time)
        value = float(raw_value)
        if not math.isfinite(time) or not math.isfinite(value) or time < start or time > end:
            continue
        if positive and value <= 0:
            continue
        result.append((time, value))
    return result


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def aligned_acoustic_features(praat_result: dict[str, Any], recognizer_result: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract acoustic evidence inside recognizer-aligned vowel nuclei.

    This deliberately does not reuse Praat's target-guided syllable summaries:
    the recognizer supplies the time spans, while Praat supplies only the raw
    pitch and intensity contours.
    """
    alignment = recognizer_result.get("canonical_alignment") or {}
    spans = alignment.get("syllables") or []
    pitch = praat_result.get("pitch") or {}
    intensity = praat_result.get("intensity") or {}
    result: list[dict[str, Any]] = []
    for span in spans:
        raw_start = span.get(
            "measurement_start_time",
            span.get("nucleus_start_time", span.get("start_time")),
        )
        raw_end = span.get(
            "measurement_end_time",
            span.get("nucleus_end_time", span.get("end_time")),
        )
        if not isinstance(raw_start, (int, float)) or not isinstance(raw_end, (int, float)):
            continue
        start = float(raw_start)
        end = float(raw_end)
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            continue
        pitch_pairs = _finite_contour_values(pitch, start, end, positive=True)
        intensity_pairs = _finite_contour_values(intensity, start, end)
        pitch_values = [value for _, value in pitch_pairs]
        intensity_values = [value for _, value in intensity_pairs]
        f0_median = _median(pitch_values)
        f0_range = max(pitch_values) - min(pitch_values) if pitch_values else None
        f0_slope = None
        if len(pitch_pairs) >= 2 and pitch_pairs[-1][0] > pitch_pairs[0][0]:
            f0_slope = (pitch_pairs[-1][1] - pitch_pairs[0][1]) / (pitch_pairs[-1][0] - pitch_pairs[0][0])
        result.append({
            "start_time": start,
            "end_time": end,
            "duration_sec": end - start,
            "intensity_db": _median(intensity_values),
            "f0_median": f0_median,
            "f0_range": f0_range,
            "f0_slope": f0_slope,
            "spectral_tilt": span.get("spectral_tilt"),
            "nucleus_confidence": float(span.get("nucleus_confidence", 0.0)),
            "voiced_confidence": 1.0 if pitch_values else 0.0,
        })
    return result


def stress_feature_vector(acoustic_features: list[dict[str, Any]], expected_index: int = 0) -> list[float]:
    if not acoustic_features:
        return [0.0] * 10
    expected = max(0, min(int(expected_index), len(acoustic_features) - 1))

    def value(row: dict[str, Any], name: str) -> float:
        raw = row.get(name)
        return float(raw) if isinstance(raw, (int, float)) and math.isfinite(float(raw)) else 0.0

    alternatives = [row for index, row in enumerate(acoustic_features) if index != expected]
    expected_row = acoustic_features[expected]

    def margin(name: str, *, absolute: bool = False) -> float:
        expected_value = value(expected_row, name)
        alternative_values = [value(row, name) for row in alternatives]
        if absolute:
            expected_value = abs(expected_value)
            alternative_values = [abs(item) for item in alternative_values]
        return expected_value - max(alternative_values) if alternative_values else 0.0

    confidence = [value(row, "nucleus_confidence") for row in acoustic_features]
    voiced = [value(row, "voiced_confidence") for row in acoustic_features]
    return [
        margin("duration_sec"),
        margin("intensity_db"),
        margin("f0_median"),
        margin("f0_range"),
        margin("f0_slope", absolute=True),
        margin("spectral_tilt"),
        float(sum(confidence) / len(confidence)),
        float(min(confidence)),
        float(sum(voiced) / len(voiced)),
        float(min(voiced)),
    ]


def evaluate_stress_ranker(
    artifact: dict[str, Any],
    acoustic_features: list[dict[str, Any]],
    *,
    expected_index: int,
) -> dict[str, Any]:
    """Conservatively verify that the expected nucleus is most prominent.

    The ranker is intentionally positive-only at release time: it can verify
    a strong expected nucleus, but it abstains when an alternative wins or the
    acoustic evidence is incomplete.  This avoids turning a weak prominence
    signal into a claim about a specific wrong-stress location.
    """
    mode = str(artifact.get("mode") or "ranker")
    if mode != "ranker":
        raise ValueError("stress artifact is not a ranker")
    rows = list(acoustic_features or [])
    if len(rows) < 2 or not 0 <= int(expected_index) < len(rows):
        return {
            "status": "unrateable",
            "confidence": 0.0,
            "expected_index": expected_index,
            "margin": 0.0,
            "reason": "MISSING_STRESS_EVIDENCE",
        }
    feature_names = [str(name) for name in artifact.get("features") or []]
    weights = [float(value) for value in artifact.get("weights") or []]
    means = [float(value) for value in artifact.get("means") or [0.0] * len(feature_names)]
    scales = [float(value) for value in artifact.get("scales") or [1.0] * len(feature_names)]
    if not feature_names or len(weights) != len(feature_names) or len(means) != len(feature_names) or len(scales) != len(feature_names):
        raise ValueError("stress ranker feature shape mismatch")
    min_confidence = float(artifact.get("min_confidence", 0.0))
    for row in rows:
        if float(row.get("nucleus_confidence", 0.0)) < min_confidence or float(row.get("voiced_confidence", 0.0)) < min_confidence:
            return {
                "status": "unrateable",
                "confidence": 0.0,
                "expected_index": expected_index,
                "margin": 0.0,
                "reason": "MISSING_STRESS_EVIDENCE",
            }

    # Prominence is relative within one recording.  Normalize each acoustic
    # cue across the aligned nuclei before applying the exported weights so
    # absolute pitch, loudness, and microphone gain cannot become shortcuts.
    relative: dict[str, list[float]] = {}
    for name in feature_names:
        values = [float(row[name]) for row in rows if isinstance(row.get(name), (int, float)) and math.isfinite(float(row[name]))]
        if not values:
            return {
                "status": "unrateable",
                "confidence": 0.0,
                "expected_index": expected_index,
                "margin": 0.0,
                "reason": "MISSING_STRESS_EVIDENCE",
            }
        mean_value = sum(values) / len(values)
        variance = sum((value - mean_value) ** 2 for value in values) / len(values)
        relative[name] = [(value - mean_value) / (math.sqrt(variance) or 1.0) for value in values]

    scores: list[float] = []
    for row_index, row in enumerate(rows):
        score = 0.0
        for name, weight, mean, scale in zip(feature_names, weights, means, scales):
            raw = row.get(name)
            if not isinstance(raw, (int, float)) or not math.isfinite(float(raw)):
                return {
                    "status": "unrateable",
                    "confidence": 0.0,
                    "expected_index": expected_index,
                    "margin": 0.0,
                    "reason": "MISSING_STRESS_EVIDENCE",
                }
            normalized = relative[name][row_index]
            score += weight * ((normalized - mean) / (scale or 1.0))
        scores.append(score)

    expected_score = scores[int(expected_index)]
    alternatives = [score for index, score in enumerate(scores) if index != int(expected_index)]
    alternative_score = max(alternatives)
    margin = expected_score - alternative_score
    threshold = float(artifact.get("margin_threshold", 0.0))
    if expected_score < alternative_score or margin < threshold:
        return {
            "status": "unrateable",
            "confidence": 0.0,
            "expected_index": expected_index,
            "strongest_index": int(max(range(len(scores)), key=scores.__getitem__)),
            "margin": round(margin, 6),
            "reason": "EXPECTED_NUCLEUS_NOT_STRONGEST" if expected_score < alternative_score else "STRESS_MARGIN_TOO_SMALL",
        }
    confidence = _sigmoid(margin - threshold)
    return {
        "status": "verified",
        "confidence": round(float(confidence), 6),
        "expected_index": expected_index,
        "strongest_index": int(max(range(len(scores)), key=scores.__getitem__)),
        "margin": round(margin, 6),
        "reason": None,
    }


def artifact_sha256(artifact: dict[str, Any]) -> str:
    canonical = {key: value for key, value in artifact.items() if key != "artifact_sha256"}
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
