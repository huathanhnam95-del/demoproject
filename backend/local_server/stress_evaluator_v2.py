"""Multi-class calibrated stress evaluator for BEL Pronounce V4.2.

Evaluates observed acoustic prominence against dictionary target stress patterns.
Distinguishes correct pattern, weak contrast, competing stress, over-prominent unstressed syllables,
and unrateable recordings while treating monosyllables as not applicable.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

STRESS_EVALUATOR_VERSION = "stress-evaluator-v2.0"
EVALUATOR_CONFIG_HASH = hashlib.sha256(b"bel-stress-evaluator-v2-calibrated").hexdigest()[:16]


def evaluate_stress_v2(
    features: Any,  # StressFeatureEnvelope or dict
    target_stress: Sequence[Any],  # list of strings e.g. ['primary', 'unstressed'] or dicts
    config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Evaluate stress placement against target pattern with magnitude-preserving outcomes."""
    cfg = config or {}
    decisive_margin_threshold = float(cfg.get("decisive_margin_threshold", 0.25))
    competing_margin_threshold = float(cfg.get("competing_margin_threshold", -0.15))

    # Convert envelope to dict if dataclass
    features_dict = features.to_dict() if hasattr(features, "to_dict") else features
    syllables = features_dict.get("syllables", [])
    pairwise_contrasts = features_dict.get("pairwiseContrasts", [])
    num_syllables = len(syllables)

    # 1. Parse target stress
    target_pattern: List[Optional[str]] = []
    expected_primary_idx: Optional[int] = None

    for i, item in enumerate(target_stress):
        if isinstance(item, str):
            val = item.lower()
            target_pattern.append(val)
            if val == "primary" and expected_primary_idx is None:
                expected_primary_idx = i
        elif isinstance(item, dict):
            val = (item.get("stress") or item.get("expectedStress") or "").lower()
            target_pattern.append(val if val else None)
            if val == "primary" and expected_primary_idx is None:
                expected_primary_idx = i
        else:
            target_pattern.append(None)

    # 2. Monosyllabic handling (§6.4)
    if num_syllables <= 1:
        pitch_evidence = syllables[0].get("pitchEvidence", []) if syllables else []
        return {
            "applicable": False,
            "expected": {
                "primaryStress": expected_primary_idx if expected_primary_idx is not None else 0,
                "pattern": target_pattern
            },
            "observed": {
                "primaryStress": 0 if num_syllables == 1 else None,
                "pattern": ["primary"] if num_syllables == 1 else []
            },
            "matches_expected": True,
            "status": "not_applicable",
            "decision": "monosyllabic_not_applicable",
            "confidence": 1.0,
            "evaluatorVersion": STRESS_EVALUATOR_VERSION,
            "configHash": EVALUATOR_CONFIG_HASH,
            "pitch_evidence": pitch_evidence,
            "reasons": ["MONOSYLLABIC_NO_INTERNAL_STRESS"]
        }

    # 3. Check for valid expected target
    if expected_primary_idx is None:
        return {
            "applicable": True,
            "expected": {"primaryStress": None, "pattern": target_pattern},
            "observed": None,
            "matches_expected": None,
            "status": "unrateable",
            "decision": "unrateable",
            "confidence": 0.0,
            "evaluatorVersion": STRESS_EVALUATOR_VERSION,
            "configHash": EVALUATOR_CONFIG_HASH,
            "pitch_evidence": [],
            "reasons": ["TARGET_PRIMARY_STRESS_UNDEFINED"]
        }

    # 4. Check for rateable acoustic evidence on expected primary syllable
    target_syl = syllables[expected_primary_idx]
    if target_syl.get("quality") == "uncertain" and target_syl.get("voicedFrameCoverage", 0) < 0.15:
        return {
            "applicable": True,
            "expected": {"primaryStress": expected_primary_idx, "pattern": target_pattern},
            "observed": None,
            "matches_expected": None,
            "status": "unrateable",
            "decision": "unrateable",
            "confidence": 0.0,
            "evaluatorVersion": STRESS_EVALUATOR_VERSION,
            "configHash": EVALUATOR_CONFIG_HASH,
            "pitch_evidence": target_syl.get("pitchEvidence", []),
            "reasons": ["PRIMARY_NUCLEUS_UNVOICED_OR_UNCERTAIN"]
        }

    # 5. Evaluate Composite Prominence Margins against all competing syllables
    competing_margins: List[Tuple[int, float]] = []
    competing_details: Dict[int, Dict[str, Any]] = {}

    for j in range(num_syllables):
        if j == expected_primary_idx:
            continue
        # Find contrast pair: (expected_primary_idx, j)
        pair = next(
            (c for c in pairwise_contrasts if c.get("primaryIndex") == expected_primary_idx and c.get("competingIndex") == j),
            None
        )
        if not pair:
            continue

        log_dur = pair.get("logDurationRatio", 0.0)
        int_diff = pair.get("intensityDiffDb")
        pitch_diff_st = pair.get("pitchDiffSemitones")

        dur_comp = log_dur
        int_comp = (int_diff / 10.0) if int_diff is not None else 0.0
        pitch_comp = (pitch_diff_st / 6.0) if pitch_diff_st is not None else 0.0

        # Weighted composite prominence
        # Duration is primary acoustic anchor in English (45%), intensity (30%), pitch (25%)
        margin_j = 0.45 * dur_comp + 0.30 * int_comp + 0.25 * pitch_comp
        competing_margins.append((j, margin_j))
        competing_details[j] = {
            "logDurationRatio": log_dur,
            "intensityDiffDb": int_diff,
            "pitchDiffSemitones": pitch_diff_st,
            "margin": margin_j
        }

    if not competing_margins:
        return {
            "applicable": True,
            "expected": {"primaryStress": expected_primary_idx, "pattern": target_pattern},
            "observed": None,
            "matches_expected": None,
            "status": "unrateable",
            "decision": "unrateable",
            "confidence": 0.0,
            "evaluatorVersion": STRESS_EVALUATOR_VERSION,
            "configHash": EVALUATOR_CONFIG_HASH,
            "pitch_evidence": target_syl.get("pitchEvidence", []),
            "reasons": ["PAIRWISE_CONTRASTS_UNAVAILABLE"]
        }

    # Worst-case margin across competitors (minimum prominence margin)
    min_comp_idx, min_margin = min(competing_margins, key=lambda x: x[1])

    # Find the most prominent syllable overall
    # Compute absolute prominence score for each syllable
    abs_prominences: List[float] = []
    for s_idx in range(num_syllables):
        s_dur = syllables[s_idx].get("nucleusDurationSec", 0.1)
        s_int = syllables[s_idx].get("intensityDb") or 50.0
        s_st = syllables[s_idx].get("f0Semitones") or 0.0
        prom = 0.45 * math.log(max(1e-4, s_dur)) + 0.30 * (s_int / 10.0) + 0.25 * (s_st / 6.0)
        abs_prominences.append(prom)

    observed_primary_idx = int(np.argmax(abs_prominences))
    observed_pattern = ["primary" if i == observed_primary_idx else "unstressed" for i in range(num_syllables)]

    # 6. Classify Decision Outcomes (§6.3)
    if observed_primary_idx == expected_primary_idx:
        if min_margin >= decisive_margin_threshold:
            decision = "correct_pattern"
            status = "verified"
            matches_expected = True
            confidence = min(0.98, 0.70 + 0.5 * min_margin)
            reasons = ["STRESS_PATTERN_VERIFIED"]
        else:
            decision = "correct_placement_weak_contrast"
            status = "verified"
            matches_expected = True
            confidence = 0.65
            reasons = ["CORRECT_PLACEMENT_WEAK_CONTRAST"]
    else:
        # Expected primary is NOT most prominent
        matches_expected = False
        status = "incorrect"
        confidence = min(0.95, 0.60 + abs(min_margin))
        if min_margin < competing_margin_threshold:
            decision = "competing_stress"
            reasons = [f"COMPETING_STRESS_ON_SYLLABLE_{observed_primary_idx + 1}"]
        else:
            decision = "over_prominent_unstressed"
            reasons = [f"OVER_PROMINENT_UNSTRESSED_SYLLABLE_{observed_primary_idx + 1}"]

    return {
        "applicable": True,
        "expected": {
            "primaryStress": expected_primary_idx,
            "pattern": target_pattern
        },
        "observed": {
            "primaryStress": observed_primary_idx,
            "pattern": observed_pattern,
            "minMargin": round(min_margin, 4)
        },
        "matches_expected": matches_expected,
        "status": status,
        "decision": decision,
        "confidence": round(confidence, 4),
        "evaluatorVersion": STRESS_EVALUATOR_VERSION,
        "configHash": EVALUATOR_CONFIG_HASH,
        "pitch_evidence": target_syl.get("pitchEvidence", []),
        "competingDetails": competing_details,
        "reasons": reasons
    }
