"""Magnitude-preserving acoustic stress feature extractor for BEL Pronounce V4.2.

Extracts nucleus duration, dB intensity, pitch (Hz and semitones), and pitch slope
from accepted canonical nucleus spans. Computes log-duration ratios, intensity differences,
and semitone pitch contrasts while strictly masking missing cues (never converting to zero).
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

STRESS_FEATURES_SCHEMA_VERSION = "bel-stress-features-v2"
FEATURE_EXTRACTOR_VERSION = "stress-features-v2.0"


@dataclass(frozen=True)
class SyllableAcousticFeatures:
    syllable_index: int
    syllable_id: str
    expected_stress: Optional[str]
    expected_nucleus: Optional[str]
    nucleus_span_samples: Tuple[int, int]
    nucleus_duration_sec: float
    intensity_db: Optional[float]
    f0_median_hz: Optional[float]
    f0_slope_hz_per_sec: Optional[float]
    f0_semitones: Optional[float]
    voiced_frame_coverage: float
    quality: str
    pitch_evidence: List[Dict[str, float]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "syllableIndex": self.syllable_index,
            "syllableId": self.syllable_id,
            "expectedStress": self.expected_stress,
            "expectedNucleus": self.expected_nucleus,
            "nucleusSpan": {
                "startSample": self.nucleus_span_samples[0],
                "endSample": self.nucleus_span_samples[1]
            },
            "nucleusDurationSec": round(self.nucleus_duration_sec, 6),
            "intensityDb": round(self.intensity_db, 2) if self.intensity_db is not None else None,
            "f0MedianHz": round(self.f0_median_hz, 2) if self.f0_median_hz is not None else None,
            "f0Slope": round(self.f0_slope_hz_per_sec, 2) if self.f0_slope_hz_per_sec is not None else None,
            "f0Semitones": round(self.f0_semitones, 2) if self.f0_semitones is not None else None,
            "voicedFrameCoverage": round(self.voiced_frame_coverage, 4),
            "quality": self.quality,
            "pitchEvidence": self.pitch_evidence
        }


@dataclass(frozen=True)
class StressContrastPair:
    primary_index: int
    competing_index: int
    log_duration_ratio: float
    intensity_diff_db: Optional[float]
    pitch_diff_semitones: Optional[float]
    pitch_slope_diff: Optional[float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "primaryIndex": self.primary_index,
            "competingIndex": self.competing_index,
            "logDurationRatio": round(self.log_duration_ratio, 6),
            "intensityDiffDb": round(self.intensity_diff_db, 2) if self.intensity_diff_db is not None else None,
            "pitchDiffSemitones": round(self.pitch_diff_semitones, 2) if self.pitch_diff_semitones is not None else None,
            "pitchSlopeDiff": round(self.pitch_slope_diff, 2) if self.pitch_slope_diff is not None else None
        }


@dataclass(frozen=True)
class StressFeatureEnvelope:
    schema_version: str
    feature_extractor_version: str
    sample_rate_hz: int
    syllable_count: int
    syllables: List[SyllableAcousticFeatures]
    pairwise_contrasts: List[StressContrastPair]
    utterance_f0_baseline_hz: Optional[float]
    utterance_intensity_baseline_db: Optional[float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "featureExtractorVersion": self.feature_extractor_version,
            "sampleRateHz": self.sample_rate_hz,
            "syllableCount": self.syllable_count,
            "syllables": [s.to_dict() for s in self.syllables],
            "pairwiseContrasts": [c.to_dict() for c in self.pairwise_contrasts],
            "utteranceF0BaselineHz": round(self.utterance_f0_baseline_hz, 2) if self.utterance_f0_baseline_hz is not None else None,
            "utteranceIntensityBaselineDb": round(self.utterance_intensity_baseline_db, 2) if self.utterance_intensity_baseline_db is not None else None
        }


def _estimate_pitch_autocorr(
    chunk: np.ndarray,
    sample_rate_hz: int,
    f_min: float = 65.0,
    f_max: float = 500.0
) -> Optional[float]:
    """Estimate pitch using normalized autocorrelation on a small audio window."""
    if len(chunk) < 32:
        return None
    # DC removal
    chunk = chunk - np.mean(chunk)
    energy = np.sum(chunk * chunk)
    if energy < 1e-6:
        return None

    lag_min = int(sample_rate_hz / f_max)
    lag_max = int(sample_rate_hz / f_min)
    if lag_max >= len(chunk):
        lag_max = len(chunk) - 1
    if lag_min >= lag_max:
        return None

    # Autocorrelation via FFT
    n = len(chunk)
    n_fft = 1
    while n_fft < 2 * n:
        n_fft *= 2
    f_chunk = np.fft.rfft(chunk, n=n_fft)
    autocorr = np.fft.irfft(f_chunk * np.conj(f_chunk), n=n_fft)[:n]
    norm_autocorr = autocorr / (autocorr[0] + 1e-9)

    search_region = norm_autocorr[lag_min:lag_max]
    if len(search_region) == 0:
        return None
    best_lag_rel = int(np.argmax(search_region))
    peak_val = float(search_region[best_lag_rel])
    if peak_val >= 0.38:  # Voicing threshold
        best_lag = lag_min + best_lag_rel
        return float(sample_rate_hz / best_lag)
    return None


def extract_stress_features_v2(
    pcm: np.ndarray,
    timing_envelope: Dict[str, Any],
    reference: Any = None,
    praat_result: Optional[Dict[str, Any]] = None,
    sample_rate_hz: int = 16000
) -> StressFeatureEnvelope:
    """Extract magnitude-preserving acoustic stress features from accepted nucleus spans."""
    syllables_data = timing_envelope.get("syllables", [])
    num_syllables = len(syllables_data)

    if pcm.ndim != 1:
        pcm = pcm.flatten()
    if pcm.dtype != np.float32 and pcm.dtype != np.float64:
        pcm = pcm.astype(np.float64)

    # 1. Inspect Praat contours if provided
    praat_pitch = praat_result.get("pitch") if praat_result else None
    praat_intensity = praat_result.get("intensity") if praat_result else None

    # Calculate utterance pitch baseline across all voiced frames
    all_f0: List[float] = []
    all_intensity: List[float] = []

    syl_features: List[SyllableAcousticFeatures] = []

    for idx, syl in enumerate(syllables_data):
        syl_id = syl.get("syllableId", f"syl-{idx + 1}")
        expected_stress = syl.get("expectedStress")
        expected_nucleus = syl.get("expectedNucleus")

        n_span = syl.get("nucleusSpan")
        if not n_span:
            s_span = syl.get("syllableSpan", {"startSample": 0, "endSample": len(pcm)})
            n_span = s_span

        start_sample = int(n_span.get("startSample", 0))
        end_sample = int(n_span.get("endSample", len(pcm)))
        duration_sec = max(0.001, (end_sample - start_sample) / sample_rate_hz)

        start_sec = start_sample / sample_rate_hz
        end_sec = end_sample / sample_rate_hz

        # Slice PCM within interior 80% to avoid boundary coarticulation
        interior_margin = int(0.10 * (end_sample - start_sample))
        int_start = start_sample + interior_margin
        int_end = max(int_start + 16, end_sample - interior_margin)
        nucleus_chunk = pcm[int_start:int_end] if int_end > int_start else pcm[start_sample:end_sample]

        # Extract Intensity
        syl_intensity_db: Optional[float] = None
        if praat_intensity and isinstance(praat_intensity.get("times"), list):
            times = np.asarray(praat_intensity["times"], dtype=float)
            vals = np.asarray(praat_intensity.get("values", []), dtype=float)
            mask = (times >= start_sec) & (times <= end_sec) & (vals > 0)
            if np.any(mask):
                syl_intensity_db = float(np.median(vals[mask]))
        if syl_intensity_db is None and len(nucleus_chunk) > 0:
            rms = float(np.sqrt(np.mean(nucleus_chunk * nucleus_chunk)))
            syl_intensity_db = float(20.0 * math.log10(max(1e-6, rms)) + 90.0)

        if syl_intensity_db is not None:
            all_intensity.append(syl_intensity_db)

        # Extract Pitch & Voicing
        pitch_points: List[Dict[str, float]] = []
        voiced_frames_count = 0
        total_subframes = 0

        if praat_pitch and isinstance(praat_pitch.get("times"), list):
            times = np.asarray(praat_pitch["times"], dtype=float)
            vals = np.asarray(praat_pitch.get("values", []), dtype=float)
            mask = (times >= start_sec) & (times <= end_sec)
            total_subframes = max(1, int(np.sum(mask)))
            voiced_mask = mask & (vals > 0)
            voiced_frames_count = int(np.sum(voiced_mask))
            for t_val, v_val in zip(times[voiced_mask], vals[voiced_mask]):
                pitch_points.append({"time": float(t_val), "f0": float(v_val)})
        else:
            # Standalone pitch estimation in 25ms hops
            hop_samp = int(sample_rate_hz * 0.010)  # 10ms hop
            win_samp = int(sample_rate_hz * 0.030)  # 30ms window
            sub_start = start_sample
            while sub_start + win_samp <= end_sample:
                total_subframes += 1
                sub_chunk = pcm[sub_start:sub_start + win_samp]
                f0_est = _estimate_pitch_autocorr(sub_chunk, sample_rate_hz)
                if f0_est is not None:
                    voiced_frames_count += 1
                    pitch_points.append({
                        "time": float((sub_start + win_samp // 2) / sample_rate_hz),
                        "f0": f0_est
                    })
                sub_start += hop_samp

        voiced_coverage = voiced_frames_count / max(1, total_subframes)
        f0_median: Optional[float] = None
        f0_slope: Optional[float] = None

        if pitch_points:
            f0_values = [p["f0"] for p in pitch_points]
            f0_median = float(np.median(f0_values))
            all_f0.append(f0_median)

            # Linear slope (Hz / s) if >= 2 points
            if len(pitch_points) >= 2 and (pitch_points[-1]["time"] - pitch_points[0]["time"]) > 0.005:
                dt = pitch_points[-1]["time"] - pitch_points[0]["time"]
                df0 = pitch_points[-1]["f0"] - pitch_points[0]["f0"]
                f0_slope = float(df0 / dt)

        quality = "accepted" if voiced_coverage >= 0.35 and f0_median is not None else "uncertain"

        syl_features.append(SyllableAcousticFeatures(
            syllable_index=idx,
            syllable_id=syl_id,
            expected_stress=expected_stress,
            expected_nucleus=expected_nucleus,
            nucleus_span_samples=(start_sample, end_sample),
            nucleus_duration_sec=duration_sec,
            intensity_db=syl_intensity_db,
            f0_median_hz=f0_median,
            f0_slope_hz_per_sec=f0_slope,
            f0_semitones=None,  # Populated below once baseline is calculated
            voiced_frame_coverage=voiced_coverage,
            quality=quality,
            pitch_evidence=pitch_points
        ))

    # Calculate baseline F0 and semitone positions
    baseline_f0 = float(np.median(all_f0)) if all_f0 else None
    baseline_intensity = float(np.median(all_intensity)) if all_intensity else None

    # Populate f0_semitones relative to baseline
    final_syl_features: List[SyllableAcousticFeatures] = []
    for s in syl_features:
        semitones: Optional[float] = None
        if s.f0_median_hz is not None and baseline_f0 is not None and baseline_f0 > 0:
            semitones = 12.0 * math.log2(s.f0_median_hz / baseline_f0)
        final_syl_features.append(SyllableAcousticFeatures(
            syllable_index=s.syllable_index,
            syllable_id=s.syllable_id,
            expected_stress=s.expected_stress,
            expected_nucleus=s.expected_nucleus,
            nucleus_span_samples=s.nucleus_span_samples,
            nucleus_duration_sec=s.nucleus_duration_sec,
            intensity_db=s.intensity_db,
            f0_median_hz=s.f0_median_hz,
            f0_slope_hz_per_sec=s.f0_slope_hz_per_sec,
            f0_semitones=semitones,
            voiced_frame_coverage=s.voiced_frame_coverage,
            quality=s.quality,
            pitch_evidence=s.pitch_evidence
        ))

    # 2. Compute Magnitude-Preserving Pairwise Contrasts
    contrasts: List[StressContrastPair] = []
    for i in range(num_syllables):
        for j in range(num_syllables):
            if i == j:
                continue
            dur_i = final_syl_features[i].nucleus_duration_sec
            dur_j = final_syl_features[j].nucleus_duration_sec
            log_dur_ratio = math.log(max(1e-4, dur_i) / max(1e-4, dur_j))

            int_i = final_syl_features[i].intensity_db
            int_j = final_syl_features[j].intensity_db
            int_diff = (int_i - int_j) if (int_i is not None and int_j is not None) else None

            f0_i = final_syl_features[i].f0_median_hz
            f0_j = final_syl_features[j].f0_median_hz
            pitch_diff_st: Optional[float] = None
            if f0_i is not None and f0_j is not None and f0_i > 0 and f0_j > 0:
                pitch_diff_st = 12.0 * math.log2(f0_i / f0_j)

            slope_i = final_syl_features[i].f0_slope_hz_per_sec
            slope_j = final_syl_features[j].f0_slope_hz_per_sec
            slope_diff = (slope_i - slope_j) if (slope_i is not None and slope_j is not None) else None

            contrasts.append(StressContrastPair(
                primary_index=i,
                competing_index=j,
                log_duration_ratio=log_dur_ratio,
                intensity_diff_db=int_diff,
                pitch_diff_semitones=pitch_diff_st,
                pitch_slope_diff=slope_diff
            ))

    return StressFeatureEnvelope(
        schema_version=STRESS_FEATURES_SCHEMA_VERSION,
        feature_extractor_version=FEATURE_EXTRACTOR_VERSION,
        sample_rate_hz=sample_rate_hz,
        syllable_count=num_syllables,
        syllables=final_syl_features,
        pairwise_contrasts=contrasts,
        utterance_f0_baseline_hz=baseline_f0,
        utterance_intensity_baseline_db=baseline_intensity
    )
