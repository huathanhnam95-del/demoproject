"""BEL Pronounce V4.2 Acoustic Candidate Orchestrator.

Builds versioned pronounce-timing-v2 envelopes on top of V4.1 phonological ownership
and canonical PCM using deterministic boundary refinement without re-running the recognizer.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any, Dict, List, Optional, Tuple, Sequence

import numpy as np

from backend.local_server.segment_contract import (
    SampleSpan,
    BoundaryRange,
    validate_timing_envelope
)
from backend.phoneme_service.boundary_refinement import (
    extract_boundary_features,
    make_boundary_windows,
    propose_boundary_candidates,
    select_consistent_boundaries,
    refine_nucleus_edges,
    REFINEMENT_CONFIG_VERSION
)

TIMING_SCHEMA_VERSION = "pronounce-timing-v2"
SEGMENTATION_VERSION = "bel-segmentation-v4.2"
DEFAULT_FRAME_CLOCK_VERSION = "model-frontend-v1"


def validate_frame_clock(
    frame_clock: Optional[Dict[str, Any]],
    audio: Dict[str, Any]
) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    """Validate alignment clock metadata against canonical audio parameters."""
    if not isinstance(frame_clock, dict):
        return False, None, "TIME_MAPPING_UNVERIFIED"

    sample_rate = audio.get("sampleRateHz")
    sample_count = audio.get("sampleCount")
    clock_rate = frame_clock.get("sampleRateHz")
    frame_count = frame_clock.get("frameCount")

    if not isinstance(clock_rate, int) or clock_rate != sample_rate:
        return False, None, "TIME_MAPPING_UNVERIFIED"
    if not isinstance(frame_count, int) or frame_count <= 0:
        return False, None, "TIME_MAPPING_UNVERIFIED"

    clock_version = frame_clock.get("frameClockVersion", DEFAULT_FRAME_CLOCK_VERSION)
    stride_samples = frame_clock.get("frameStrideSamples")
    if not isinstance(stride_samples, int) or stride_samples <= 0:
        stride_samples = int(round(sample_count / frame_count)) if sample_count else 320

    validated = {
        "frameClockVersion": clock_version,
        "sampleRateHz": clock_rate,
        "sampleCount": sample_count,
        "frameCount": frame_count,
        "frameStrideSamples": stride_samples,
        "offsetSamples": int(frame_clock.get("offsetSamples", 0)),
        "convention": frame_clock.get("convention", "half-open")
    }
    return True, validated, "VERIFIED"


def frame_to_canonical_sample(
    frame: int,
    clock: Optional[Dict[str, Any]],
    total_samples: int,
    total_frames: Optional[int] = None
) -> int:
    """Map a CTC frame index to canonical sample offset."""
    if frame <= 0:
        return 0
    if clock:
        stride = clock.get("frameStrideSamples", 320)
        offset = clock.get("offsetSamples", 0)
        sample = frame * stride + offset
        return max(0, min(total_samples, int(sample)))
    
    # Fallback to proportional mapping
    num_frames = total_frames or 100
    sample = int(round(float(frame) / max(1, num_frames) * total_samples))
    return max(0, min(total_samples, sample))


def build_pronounce_v42(
    *,
    pcm: np.ndarray,
    audio: Dict[str, Any],
    reference: Any,
    recognizer_result: Dict[str, Any],
    v41_snapshot: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Orchestrate V4.2 acoustic refinement on top of V4.1 alignment.
    
    Never re-runs the CTC recognizer; consumes existing frame spans and canonical PCM.
    """
    cfg = config or {}
    sample_rate_hz = int(audio.get("sampleRateHz", 16000))
    sample_count = int(audio.get("sampleCount", len(pcm)))
    audio_hash = audio.get("audioHash", hashlib.sha256(pcm.tobytes()).hexdigest())

    # 1. Validate Clock
    frame_clock_meta = recognizer_result.get("frameClock")
    clock_valid, clock, clock_reason = validate_frame_clock(frame_clock_meta, audio)

    # 2. Extract V4.1 Syllables
    v41_syllables = v41_snapshot.get("syllables", [])
    if not isinstance(v41_syllables, list) or len(v41_syllables) == 0:
        return {
            "status": "unavailable",
            "reason": "V41_SYLLABLES_EMPTY",
            "timing": None,
            "stress": {
                "status": "unrateable",
                "reasons": ["V41_ALIGNMENT_UNAVAILABLE"]
            }
        }

    total_frames = recognizer_result.get("log_probs_shape", [100, 50])[0] if "log_probs_shape" in recognizer_result else (
        recognizer_result.get("v4_alignment", {}).get("syllables", [{}])[-1].get("end_frame", 100) if recognizer_result.get("v4_alignment") else 100
    )

    # 3. Map V4.1 Frame Boundaries to Initial Sample Spans
    initial_syllable_spans: List[Tuple[int, int]] = []
    initial_nuclei_spans: List[Tuple[int, int]] = []
    internal_sample_boundaries: List[int] = []

    for i, syl in enumerate(v41_syllables):
        s_frame = syl.get("partition_start_frame", syl.get("start_frame", syl.get("token_start", 0)))
        e_frame = syl.get("partition_end_frame", syl.get("end_frame", syl.get("token_end", 0)))
        
        # In case start_time / end_time are present in seconds
        if "start_time" in syl and "end_time" in syl and syl["start_time"] is not None and syl["end_time"] is not None:
            s_samp = int(round(float(syl["start_time"]) * sample_rate_hz))
            e_samp = int(round(float(syl["end_time"]) * sample_rate_hz))
        else:
            s_samp = frame_to_canonical_sample(s_frame, clock, sample_count, total_frames)
            e_samp = frame_to_canonical_sample(e_frame, clock, sample_count, total_frames)

        s_samp = max(0, min(sample_count - 1, s_samp))
        e_samp = max(s_samp + 1, min(sample_count, e_samp))
        initial_syllable_spans.append((s_samp, e_samp))

        # Nucleus frames
        vn_s_frame = syl.get("vowel_start_frame", s_frame)
        vn_e_frame = syl.get("vowel_end_frame", e_frame)
        if "vowel_start_time" in syl and "vowel_end_time" in syl and syl["vowel_start_time"] is not None and syl["vowel_end_time"] is not None:
            n_start = int(round(float(syl["vowel_start_time"]) * sample_rate_hz))
            n_end = int(round(float(syl["vowel_end_time"]) * sample_rate_hz))
        else:
            n_start = frame_to_canonical_sample(vn_s_frame, clock, sample_count, total_frames)
            n_end = frame_to_canonical_sample(vn_e_frame, clock, sample_count, total_frames)

        # Contain nucleus within syllable
        n_start = max(s_samp, min(e_samp - 1, n_start))
        n_end = max(n_start + 1, min(e_samp, n_end))
        initial_nuclei_spans.append((n_start, n_end))

    # Internal boundaries between syllables
    for i in range(len(initial_syllable_spans) - 1):
        internal_sample_boundaries.append(initial_syllable_spans[i][1])

    # 4. Extract Acoustic Boundary Features
    features = extract_boundary_features(
        pcm=pcm,
        sample_rate_hz=sample_rate_hz,
        win_ms=cfg.get("win_ms", 25.0),
        hop_ms=cfg.get("hop_ms", 5.0)
    )

    # 5. Form Search Windows & Propose Candidates
    phone_evidence = []
    for i in range(len(internal_sample_boundaries)):
        left_s = v41_syllables[i]
        right_s = v41_syllables[i + 1]
        phone_evidence.append({
            "leftPhone": left_s.get("coda", [""])[-1] if left_s.get("coda") else left_s.get("nucleus", ""),
            "rightPhone": right_s.get("onset", [""])[0] if right_s.get("onset") else right_s.get("nucleus", "")
        })

    windows = make_boundary_windows(
        initial_sample_boundaries=internal_sample_boundaries,
        syllable_nuclei_samples=initial_nuclei_spans,
        total_samples=sample_count,
        sample_rate_hz=sample_rate_hz,
        phone_evidence=phone_evidence
    )

    candidates_list = [
        propose_boundary_candidates(win, features, cfg.get("boundary_refinement"))
        for win in windows
    ]

    # 6. Monotonic Dynamic Programming Boundary Selection
    boundary_decisions = select_consistent_boundaries(
        windows=windows,
        candidates_list=candidates_list,
        config=cfg.get("boundary_refinement")
    )

    # Construct refined syllable spans
    refined_syllable_spans: List[Tuple[int, int]] = []
    curr_start = initial_syllable_spans[0][0]
    for i, dec in enumerate(boundary_decisions):
        cut = dec.selected_sample
        refined_syllable_spans.append((curr_start, cut))
        curr_start = cut
    refined_syllable_spans.append((curr_start, initial_syllable_spans[-1][1]))

    # 7. Refine Nucleus Edges
    nucleus_decisions = refine_nucleus_edges(
        syllable_nuclei=initial_nuclei_spans,
        syllable_spans=refined_syllable_spans,
        features=features,
        config=cfg.get("nucleus_refinement")
    )

    # 8. Assemble Full pronounce-timing-v2 Envelope
    envelope_syllables: List[Dict[str, Any]] = []
    refinement_hash = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode("utf-8")).hexdigest()[:16]

    for i, syl in enumerate(v41_syllables):
        s_span = refined_syllable_spans[i]
        n_dec = nucleus_decisions[i]
        n_span = n_dec.refined_span

        # Determine playback and nucleus quality
        start_dec = boundary_decisions[i - 1] if i > 0 else None
        end_dec = boundary_decisions[i] if i < len(boundary_decisions) else None

        uncertain = (
            not clock_valid or
            (start_dec and start_dec.uncertain) or
            (end_dec and end_dec.uncertain)
        )
        quality = "uncertain" if uncertain else "accepted"
        reasons = []
        if not clock_valid:
            reasons.append("TIME_MAPPING_UNVERIFIED")
        if start_dec and start_dec.uncertain:
            reasons.append("START_BOUNDARY_AMBIGUOUS")
        if end_dec and end_dec.uncertain:
            reasons.append("END_BOUNDARY_AMBIGUOUS")
        if not reasons:
            reasons.append("ACOUSTIC_ALIGNMENT_VERIFIED")

        syl_id = syl.get("syllableId", syl.get("syllable_id", f"v42-syllable-{i + 1}"))
        phone_indexes = syl.get("phoneIndexes", syl.get("phone_indexes", []))

        # Start boundary range
        start_range = None
        if start_dec:
            start_range = {
                "lowerSample": start_dec.accepted_range[0],
                "upperSample": start_dec.accepted_range[1]
            }
        else:
            start_range = {"lowerSample": 0, "upperSample": s_span[0]}

        # End boundary range
        end_range = None
        if end_dec:
            end_range = {
                "lowerSample": end_dec.accepted_range[0],
                "upperSample": end_dec.accepted_range[1]
            }
        else:
            end_range = {"lowerSample": s_span[1], "upperSample": sample_count}

        envelope_syllables.append({
            "syllableId": syl_id,
            "alignmentStatus": "matched",
            "expectedStress": syl.get("stress"),
            "expectedNucleus": syl.get("nucleus"),
            "phoneIndexes": list(phone_indexes),
            "syllableSpan": {
                "startSample": s_span[0],
                "endSample": s_span[1]
            },
            "nucleusSpan": {
                "startSample": n_span[0],
                "endSample": n_span[1]
            },
            "featureWindows": [{
                "startSample": n_span[0],
                "endSample": n_span[1]
            }],
            "contextSpan": {
                "startSample": max(0, s_span[0] - int(sample_rate_hz * 0.05)),
                "endSample": min(sample_count, s_span[1] + int(sample_rate_hz * 0.05))
            },
            "playbackQuality": quality,
            "nucleusQuality": n_dec.quality,
            "startBoundaryRange": start_range,
            "endBoundaryRange": end_range,
            "reasonCodes": reasons
        })

    envelope = {
        "schemaVersion": TIMING_SCHEMA_VERSION,
        "segmentationVersion": SEGMENTATION_VERSION,
        "analysisRevision": v41_snapshot.get("analysisVersion", "v4.1.0"),
        "sourceSha": v41_snapshot.get("contentHash", "unknown"),
        "referenceVariantId": v41_snapshot.get("provenance", {}).get("ruleVersion", "v1"),
        "referenceHash": v41_snapshot.get("contentHash", "unknown"),
        "ownershipRuleVersion": v41_snapshot.get("ruleVersion", "weighted-maximal-onset-v1"),
        "audio": {
            "audioHash": audio_hash,
            "sampleRateHz": sample_rate_hz,
            "sampleCount": sample_count,
            "channels": 1,
            "pcmEncoding": "s16le",
            "canonicalizationVersion": audio.get("canonicalizationVersion", "canonical-v1")
        },
        "frameClockVersion": clock.get("frameClockVersion", "unverified") if clock else "unverified",
        "refinementConfigHash": refinement_hash,
        "syllables": envelope_syllables,
        "pauses": []
    }

    # Validate against segment contract
    validate_timing_envelope(envelope)

    # 9. Extract and Evaluate Acoustic Stress Features (P7 / P8)
    stress_flag = os.environ.get("PRONOUNCE_STRESS_V2", "active").strip().lower()
    if stress_flag == "off":
        stress_features_dict = None
        stress_evaluation = {
            "status": "disabled",
            "applicable": False,
            "reason": "PRONOUNCE_STRESS_V2_DISABLED"
        }
    else:
        from backend.local_server.stress_features_v2 import extract_stress_features_v2
        from backend.local_server.stress_evaluator_v2 import evaluate_stress_v2

        target_stress_list = [syl.get("expectedStress", syl.get("stress")) for syl in v41_syllables]
        stress_features = extract_stress_features_v2(
            pcm=pcm,
            timing_envelope=envelope,
            reference=reference,
            praat_result=recognizer_result.get("praat_result"),
            sample_rate_hz=sample_rate_hz
        )
        stress_evaluation = evaluate_stress_v2(
            features=stress_features,
            target_stress=target_stress_list,
            config=cfg.get("stress_evaluation")
        )
        stress_features_dict = stress_features.to_dict()

    return {
        "status": "available",
        "clockStatus": clock_reason,
        "timing": envelope,
        "stress": stress_evaluation,
        "stressFeatures": stress_features_dict,
        "boundaryDecisions": [d.to_dict() for d in boundary_decisions],
        "nucleusDecisions": [d.to_dict() for d in nucleus_decisions]
    }
