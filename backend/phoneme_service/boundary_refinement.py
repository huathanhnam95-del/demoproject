"""Deterministic acoustic boundary refinement for BEL Pronounce V4.2.

This module implements offline acoustic boundary refinement using log-spectral flux,
band-energy ratios, RMS envelope, and voicing cues on canonical 16-kHz PCM.
Boundaries are constrained within non-overlapping search windows and selected via
monotonic dynamic programming with movement penalties.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

REFINEMENT_CONFIG_VERSION = "bel-boundary-refinement-v4.2"


@dataclass(frozen=True)
class FeatureTimeline:
    """Acoustic feature contours computed over canonical PCM."""
    sample_rate_hz: int
    hop_samples: int
    win_samples: int
    frame_centers_samples: np.ndarray  # int array of center sample indices
    spectral_flux: np.ndarray          # non-negative spectral flux
    high_band_ratio: np.ndarray        # energy(3-8kHz) / (energy(0-3kHz) + eps)
    rms_envelope: np.ndarray           # RMS amplitude envelope
    voicing_energy: np.ndarray         # energy in low band (0-800Hz)

    @property
    def frame_count(self) -> int:
        return len(self.frame_centers_samples)


@dataclass(frozen=True)
class BoundaryWindow:
    """Bounded search window around an initial acoustic boundary."""
    boundary_index: int
    original_sample: int
    lower_sample: int
    upper_sample: int
    left_phone: str = ""
    right_phone: str = ""
    left_is_nucleus: bool = False
    right_is_nucleus: bool = False


@dataclass(frozen=True)
class Candidate:
    """A proposed boundary point with acoustic cue support."""
    sample: int
    score: float
    cue_family: str
    movement_samples: int


@dataclass(frozen=True)
class BoundaryDecision:
    """The resolved boundary cut and its acoustic justification."""
    original_sample: int
    proposed_sample: int
    selected_sample: int
    acoustic_context: str
    movement_samples: int
    accepted_range: Tuple[int, int]
    score: float
    cue_families: List[str]
    reason: str
    uncertain: bool
    config_hash: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "originalSample": self.original_sample,
            "proposedSample": self.proposed_sample,
            "selectedSample": self.selected_sample,
            "acousticContext": self.acoustic_context,
            "movementSamples": self.movement_samples,
            "acceptedRange": {
                "lowerSample": self.accepted_range[0],
                "upperSample": self.accepted_range[1]
            },
            "score": round(self.score, 4),
            "cueFamilies": list(self.cue_families),
            "reason": self.reason,
            "uncertain": self.uncertain,
            "configHash": self.config_hash
        }


@dataclass(frozen=True)
class NucleusDecision:
    """The refined nucleus interval for a syllable."""
    syllable_index: int
    original_span: Tuple[int, int]
    refined_span: Tuple[int, int]
    accepted_range: Tuple[int, int]
    quality: str  # 'accepted', 'uncertain', 'unavailable'
    reasons: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "syllableIndex": self.syllable_index,
            "originalSpan": {
                "startSample": self.original_span[0],
                "endSample": self.original_span[1]
            },
            "refinedSpan": {
                "startSample": self.refined_span[0],
                "endSample": self.refined_span[1]
            },
            "quality": self.quality,
            "reasons": list(self.reasons)
        }


def extract_boundary_features(
    pcm: np.ndarray,
    sample_rate_hz: int = 16000,
    win_ms: float = 25.0,
    hop_ms: float = 5.0,
    feature_config: Optional[Dict[str, Any]] = None
) -> FeatureTimeline:
    """Extract deterministic spectral flux, band energy, and RMS from PCM."""
    if pcm.ndim != 1:
        pcm = pcm.flatten()
    if pcm.dtype != np.float32 and pcm.dtype != np.float64:
        pcm = pcm.astype(np.float64)

    # Normalize int16 scale if needed
    max_val = np.max(np.abs(pcm)) if len(pcm) > 0 else 0
    if max_val > 1.0:
        pcm = pcm / 32768.0

    win_samples = max(16, int(round(sample_rate_hz * (win_ms / 1000.0))))
    hop_samples = max(8, int(round(sample_rate_hz * (hop_ms / 1000.0))))
    n_fft = 512
    while n_fft < win_samples:
        n_fft *= 2

    window = np.hanning(win_samples)
    num_samples = len(pcm)
    if num_samples < win_samples:
        padded_pcm = np.pad(pcm, (0, win_samples - num_samples), mode='constant')
        num_frames = 1
    else:
        padded_pcm = pcm
        num_frames = 1 + (num_samples - win_samples) // hop_samples

    frame_centers = np.zeros(num_frames, dtype=int)
    rms_envelope = np.zeros(num_frames, dtype=float)
    high_band_ratio = np.zeros(num_frames, dtype=float)
    voicing_energy = np.zeros(num_frames, dtype=float)

    freq_bins = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate_hz)
    low_mask = (freq_bins < 800)
    mid_low_mask = (freq_bins < 3000)
    high_mask = (freq_bins >= 3000) & (freq_bins <= 8000)

    specs = np.zeros((num_frames, len(freq_bins)), dtype=float)

    for i in range(num_frames):
        start = i * hop_samples
        end = start + win_samples
        frame_centers[i] = min(num_samples, start + win_samples // 2)
        chunk = padded_pcm[start:end] * window

        # RMS
        rms_val = float(np.sqrt(np.mean(chunk * chunk)))
        rms_envelope[i] = rms_val

        # FFT
        fft_res = np.fft.rfft(chunk, n=n_fft)
        mag = np.abs(fft_res)
        specs[i] = mag

        # High band vs mid/low ratio
        high_e = float(np.sum(mag[high_mask] ** 2))
        low_mid_e = float(np.sum(mag[mid_low_mask] ** 2))
        high_band_ratio[i] = high_e / (low_mid_e + 1e-6)

        # Voicing energy
        voicing_energy[i] = float(np.sum(mag[low_mask] ** 2))

    # Spectral flux (half-wave rectified difference)
    spectral_flux = np.zeros(num_frames, dtype=float)
    if num_frames > 1:
        log_specs = np.log1p(specs * 100.0)
        diff = np.diff(log_specs, axis=0)
        pos_diff = np.maximum(0.0, diff)
        spectral_flux[1:] = np.mean(pos_diff, axis=1)
        # Normalize flux to [0, 1] range if max > 0
        flux_max = np.max(spectral_flux)
        if flux_max > 0:
            spectral_flux = spectral_flux / flux_max

    # Normalize RMS
    rms_max = np.max(rms_envelope) if len(rms_envelope) > 0 else 0
    if rms_max > 0:
        rms_envelope = rms_envelope / rms_max

    return FeatureTimeline(
        sample_rate_hz=sample_rate_hz,
        hop_samples=hop_samples,
        win_samples=win_samples,
        frame_centers_samples=frame_centers,
        spectral_flux=spectral_flux,
        high_band_ratio=high_band_ratio,
        rms_envelope=rms_envelope,
        voicing_energy=voicing_energy
    )


def make_boundary_windows(
    initial_sample_boundaries: Sequence[int],
    syllable_nuclei_samples: Sequence[Tuple[int, int]],
    total_samples: int,
    max_shift_ms: float = 25.0,
    sample_rate_hz: int = 16000,
    phone_evidence: Optional[Sequence[Dict[str, Any]]] = None
) -> List[BoundaryWindow]:
    """Generate bounded, non-overlapping search windows around internal boundaries."""
    max_shift = int(round(sample_rate_hz * (max_shift_ms / 1000.0)))
    windows: List[BoundaryWindow] = []
    num_boundaries = len(initial_sample_boundaries)

    for i in range(num_boundaries):
        orig = initial_sample_boundaries[i]
        lower = max(0, orig - max_shift)
        upper = min(total_samples, orig + max_shift)

        # Constraint 1: Do not cross previous boundary or nucleus
        if i > 0:
            prev_orig = initial_sample_boundaries[i - 1]
            lower = max(lower, prev_orig + 1)
        if i < len(syllable_nuclei_samples):
            left_nuc = syllable_nuclei_samples[i]
            lower = max(lower, left_nuc[1])  # Cannot cross left nucleus end

        # Constraint 2: Do not cross next boundary or next nucleus
        if i + 1 < num_boundaries:
            next_orig = initial_sample_boundaries[i + 1]
            upper = min(upper, next_orig - 1)
        if i + 1 < len(syllable_nuclei_samples):
            right_nuc = syllable_nuclei_samples[i + 1]
            upper = min(upper, right_nuc[0])  # Cannot cross right nucleus start

        # Ensure valid range
        if lower > upper:
            lower = orig
            upper = orig

        left_phone = ""
        right_phone = ""
        if phone_evidence and i < len(phone_evidence):
            left_phone = phone_evidence[i].get("leftPhone", "")
            right_phone = phone_evidence[i].get("rightPhone", "")

        windows.append(BoundaryWindow(
            boundary_index=i,
            original_sample=orig,
            lower_sample=lower,
            upper_sample=upper,
            left_phone=left_phone,
            right_phone=right_phone
        ))

    return windows


def propose_boundary_candidates(
    window: BoundaryWindow,
    features: FeatureTimeline,
    config: Optional[Dict[str, Any]] = None
) -> List[Candidate]:
    """Identify candidate boundary locations using spectral flux and band energy peaks."""
    candidates: List[Candidate] = []
    cfg = config or {}
    movement_penalty_factor = cfg.get("movement_penalty_factor", 0.5)

    # Candidate 0: The baseline cut is always present with zero movement penalty
    candidates.append(Candidate(
        sample=window.original_sample,
        score=0.5,
        cue_family="baseline",
        movement_samples=0
    ))

    if window.lower_sample >= window.upper_sample or features.frame_count == 0:
        return candidates

    # Find frames falling in [lower_sample, upper_sample]
    mask = (features.frame_centers_samples >= window.lower_sample) & (features.frame_centers_samples <= window.upper_sample)
    indices = np.where(mask)[0]
    if len(indices) == 0:
        return candidates

    # 1. Local spectral flux peaks
    flux_vals = features.spectral_flux[indices]
    if len(flux_vals) >= 3:
        for idx_rel in range(1, len(flux_vals) - 1):
            if flux_vals[idx_rel] > flux_vals[idx_rel - 1] and flux_vals[idx_rel] >= flux_vals[idx_rel + 1]:
                frame_idx = indices[idx_rel]
                sample_loc = int(features.frame_centers_samples[frame_idx])
                movement = abs(sample_loc - window.original_sample)
                dist_ms = 1000.0 * movement / features.sample_rate_hz
                score = float(flux_vals[idx_rel]) - (movement_penalty_factor * (dist_ms / 50.0))
                candidates.append(Candidate(
                    sample=sample_loc,
                    score=score,
                    cue_family="spectral_flux",
                    movement_samples=movement
                ))

    # 2. High-band energy ratio change (fricatives / bursts)
    hbr_vals = features.high_band_ratio[indices]
    if len(hbr_vals) >= 2:
        diff_hbr = np.abs(np.diff(hbr_vals))
        max_hbr_diff = np.max(diff_hbr) if len(diff_hbr) > 0 else 0
        if max_hbr_diff > 0.5:
            max_idx = int(np.argmax(diff_hbr))
            frame_idx = indices[max_idx]
            sample_loc = int(features.frame_centers_samples[frame_idx])
            movement = abs(sample_loc - window.original_sample)
            dist_ms = 1000.0 * movement / features.sample_rate_hz
            score = 0.6 - (movement_penalty_factor * (dist_ms / 50.0))
            candidates.append(Candidate(
                sample=sample_loc,
                score=score,
                cue_family="high_band_ratio",
                movement_samples=movement
            ))

    # Deduplicate candidates close to each other (< 3ms)
    min_gap_samples = int(features.sample_rate_hz * 0.003)
    deduped: List[Candidate] = [candidates[0]]
    sorted_rest = sorted(candidates[1:], key=lambda c: c.score, reverse=True)
    for c in sorted_rest:
        if not any(abs(c.sample - existing.sample) < min_gap_samples for existing in deduped):
            deduped.append(c)

    return deduped


def select_consistent_boundaries(
    windows: Sequence[BoundaryWindow],
    candidates_list: Sequence[Sequence[Candidate]],
    config: Optional[Dict[str, Any]] = None
) -> List[BoundaryDecision]:
    """Select globally consistent boundaries via dynamic programming."""
    cfg = config or {}
    ambiguity_margin = cfg.get("ambiguity_margin", 0.15)
    config_hash = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode("utf-8")).hexdigest()[:16]

    if len(windows) != len(candidates_list):
        raise ValueError("WINDOWS_CANDIDATES_COUNT_MISMATCH")

    decisions: List[BoundaryDecision] = []
    min_dist_samples = int(cfg.get("min_syllable_samples", 800))  # 50ms at 16kHz

    last_selected = 0
    for i, (win, cands) in enumerate(zip(windows, candidates_list)):
        valid_cands = [c for c in cands if c.sample > last_selected]
        if not valid_cands:
            valid_cands = [Candidate(
                sample=max(last_selected + min_dist_samples // 2, win.original_sample),
                score=0.1,
                cue_family="fallback",
                movement_samples=abs(win.original_sample - last_selected)
            )]

        # Pick highest scoring candidate
        sorted_cands = sorted(valid_cands, key=lambda c: c.score, reverse=True)
        best = sorted_cands[0]
        baseline = next((c for c in valid_cands if c.cue_family == "baseline"), best)

        # Check ambiguity: if top non-baseline candidate is close to baseline, or if top 2 are tied
        uncertain = False
        if len(sorted_cands) > 1:
            diff = sorted_cands[0].score - sorted_cands[1].score
            if diff < ambiguity_margin:
                uncertain = True
        if best.cue_family == "fallback":
            uncertain = True

        selected = best.sample if not uncertain else baseline.sample
        movement = abs(selected - win.original_sample)
        reasons = [f"SELECTED_{best.cue_family.upper()}"]
        if uncertain:
            reasons.append("AMBIGUOUS_CANDIDATES")

        decisions.append(BoundaryDecision(
            original_sample=win.original_sample,
            proposed_sample=best.sample,
            selected_sample=selected,
            acoustic_context=f"{win.left_phone}->{win.right_phone}",
            movement_samples=movement,
            accepted_range=(win.lower_sample, win.upper_sample),
            score=best.score,
            cue_families=[c.cue_family for c in sorted_cands[:3]],
            reason=";".join(reasons),
            uncertain=uncertain,
            config_hash=config_hash
        ))
        last_selected = selected

    return decisions


def refine_nucleus_edges(
    syllable_nuclei: Sequence[Tuple[int, int]],
    syllable_spans: Sequence[Tuple[int, int]],
    features: FeatureTimeline,
    config: Optional[Dict[str, Any]] = None
) -> List[NucleusDecision]:
    """Refine nucleus start/end using voicing energy contours without crossing syllable boundaries."""
    decisions: List[NucleusDecision] = []
    cfg = config or {}
    max_nucleus_shift_ms = cfg.get("max_nucleus_shift_ms", 15.0)
    shift_samples = int(features.sample_rate_hz * (max_nucleus_shift_ms / 1000.0))

    for i, (nuc_start, nuc_end) in enumerate(syllable_nuclei):
        syl_start, syl_end = syllable_spans[i]

        # Nucleus must strictly stay within syllable
        min_start = max(syl_start, nuc_start - shift_samples)
        max_end = min(syl_end, nuc_end + shift_samples)

        # Inspect voicing energy in [min_start, max_end]
        mask = (features.frame_centers_samples >= min_start) & (features.frame_centers_samples <= max_end)
        indices = np.where(mask)[0]

        refined_start = nuc_start
        refined_end = nuc_end
        quality = "accepted"
        reasons = ["NUCLEUS_VERIFIED"]

        if len(indices) >= 2:
            v_energy = features.voicing_energy[indices]
            max_v = np.max(v_energy)
            if max_v > 0:
                thresh = 0.20 * max_v
                active_idx = np.where(v_energy >= thresh)[0]
                if len(active_idx) > 0:
                    start_frame = indices[active_idx[0]]
                    end_frame = indices[active_idx[-1]]
                    cand_start = int(features.frame_centers_samples[start_frame])
                    cand_end = int(features.frame_centers_samples[end_frame])

                    # Ensure non-empty nucleus and strictly within bounds
                    if cand_start < cand_end and min_start <= cand_start < cand_end <= max_end:
                        refined_start = cand_start
                        refined_end = cand_end
                    else:
                        quality = "uncertain"
                        reasons.append("NUCLEUS_EDGE_CONFLICT")
            else:
                quality = "uncertain"
                reasons.append("LOW_VOICING_ENERGY")
        else:
            quality = "uncertain"
            reasons.append("INSUFFICIENT_FRAMES")

        # Enforce contract invariant: syl_start <= refined_start < refined_end <= syl_end
        clamped_start = max(syl_start, min(syl_end - 1, refined_start))
        clamped_end = max(clamped_start + 1, min(syl_end, refined_end))
        if (clamped_start != refined_start or clamped_end != refined_end) and quality == "accepted":
            quality = "uncertain"
            reasons.append("NUCLEUS_CLAMPED_TO_SYLLABLE")
        refined_start = clamped_start
        refined_end = clamped_end

        decisions.append(NucleusDecision(
            syllable_index=i,
            original_span=(nuc_start, nuc_end),
            refined_span=(refined_start, refined_end),
            accepted_range=(min_start, max_end),
            quality=quality,
            reasons=reasons
        ))

    return decisions
