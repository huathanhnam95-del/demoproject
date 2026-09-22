from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
try:
    import parselmouth  # type: ignore
except ImportError:
    import praat_parselmouth as parselmouth  # type: ignore
import numpy as np
import tempfile
import os
import requests as http_requests  # Renamed to avoid conflict with flask.request
import re
import hashlib
import inspect
import secrets
import unicodedata
from datetime import datetime, timezone
try:
    from .pronunciation_reference import (
        ALGORITHM_VERSION as PRONUNCIATION_ALGORITHM_VERSION,
        SCHEMA_VERSION as PRONUNCIATION_SCHEMA_VERSION,
        build_pronunciation_reference,
        build_pronunciation_variant,
        parse_pronunciation,
    )
    from .pitch_processing import (
        PITCH_PROCESSING_VERSION,
        apply_canonical_pitch_to_syllables,
        canonicalize_pitch_track,
    )
except ImportError:
    from pronunciation_reference import (  # type: ignore
        ALGORITHM_VERSION as PRONUNCIATION_ALGORITHM_VERSION,
        SCHEMA_VERSION as PRONUNCIATION_SCHEMA_VERSION,
        build_pronunciation_reference,
        build_pronunciation_variant,
        parse_pronunciation,
    )
    from pitch_processing import (  # type: ignore
        PITCH_PROCESSING_VERSION,
        apply_canonical_pitch_to_syllables,
        canonicalize_pitch_track,
    )
try:
    from scipy.ndimage import uniform_filter1d  # type: ignore
except ImportError:
    try:
        from scipy.ndimage.filters import uniform_filter1d  # type: ignore
    except ImportError:
        def uniform_filter1d(input: np.ndarray, size: int, *args, **kwargs) -> np.ndarray:
            return input

try:
    # Keep Unicode log output from crashing on Windows' default console encoding.
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

try:
    import nltk
    from nltk.stem import WordNetLemmatizer
    
    # Ensure wordnet data is present
    try:
        nltk.data.find('corpora/wordnet')
    except LookupError:
        print("⚠️ NLTK WordNet data not found. Downloading...")
        nltk.download('wordnet')
    
    lemmatizer = WordNetLemmatizer()
    print("✅ NLTK Lemmatizer loaded.")
except ImportError:
    print("⚠️ NLTK not installed. Lemmatization fallback will be disabled.")
    lemmatizer = None
except Exception as e:
    print(f"⚠️ Error loading NLTK: {e}")
    lemmatizer = None

import concurrent.futures
import logging
import threading
import time
import unicodedata

logger = logging.getLogger(__name__)

# V3 mode: off | shadow | active
_PRONUNCIATION_V3_MODE = os.environ.get('PRONUNCIATION_V3_MODE', 'off').strip().lower()
if _PRONUNCIATION_V3_MODE not in ('off', 'shadow', 'active'):
    raise ValueError(f"Invalid PRONUNCIATION_V3_MODE: {_PRONUNCIATION_V3_MODE!r} — must be off, shadow, or active")
if _PRONUNCIATION_V3_MODE in ('shadow', 'active'):
    if not os.environ.get('PHONEME_SERVICE_URL'):
        raise ValueError("PHONEME_SERVICE_URL is required when PRONUNCIATION_V3_MODE is shadow or active")

# ============================================================================
# CONFIGURATION - Research-backed parameters
# ============================================================================

class AnalysisConfig:
    """
    Centralized configuration with research-backed defaults.
    
    References:
    - de Jong & Wempe (2009): Praat script for syllable nuclei detection
    - Tepperman & Narayanan (2005): Pitch-based stress detection
    - Kochanski et al. (2005): Acoustic correlates of stress in English
    - Fry (1955, 1958): Duration and pitch as stress cues
    """
    
    # Pitch extraction (Praat recommendations)
    PITCH_FLOOR = 75      # Hz - captures low male voices
    PITCH_CEILING = 500   # Hz - avoids octave errors
    TIME_STEP = 0.01      # 10ms - standard for speech
    
    # Syllable detection (de Jong & Wempe 2009)
    INITIAL_DIP_THRESHOLD = 2.0    # dB - standard threshold
    SENSITIVE_DIP_THRESHOLD = 1.5  # dB - for weak syllables
    HINTED_DIP_THRESHOLD = 0.75    # dB - target-guided pass for smooth transitions
    MIN_SYLLABLE_DURATION = 0.04   # 40ms - minimum valid syllable
    MAX_SYLLABLE_DURATION = 0.45   # 450ms - based on TIMIT statistics
    MIN_NUCLEUS_SEPARATION = 0.08  # Ignore release/transient peaks within 80ms
    EDGE_NUCLEUS_WINDOW = 0.06     # Edge peaks inside 60ms may be onset/release noise
    EDGE_NEIGHBOR_MAX_SEPARATION = 0.12
    WEAK_EDGE_NUCLEUS_MARGIN_DB = 6.0
    
    # Threshold retry levels (dB below median)
    THRESHOLD_LEVELS = [2, 5, 8]
    
    # Pitch transition detection (Tepperman & Narayanan 2005)
    PITCH_TRANSITION_THRESHOLD = 15  # Hz - significant change
    PITCH_SMOOTHING_WINDOW = 5       # frames
    
    # Empirically frozen on 447 canonical-v2 native recordings (seed 20260711).
    STRESS_CALIBRATION_VERSION = 'candidate-audit-20260711-447'
    STRESS_WEIGHT_PITCH = 0.30
    STRESS_WEIGHT_DURATION = 0.60
    STRESS_WEIGHT_INTENSITY = 0.10
    STRESS_FINAL_LENGTHENING_PENALTY = 0.0
    STRESS_CONFIDENCE_THRESHOLD = 0.65
    
    # Pattern matching
    PATTERN_MATCH_THRESHOLD = 0.70   # Pearson correlation threshold
    
    # Trailing-silence trim for the final syllable. speech_end includes low-
    # energy out-breath/decay; the human boundary sits where energy has fallen
    # ~15 dB below the syllable's own peak (measured on the `industrial` label:
    # 82 dB peak, hand-cut at ~67 dB). This is deliberately tighter than the
    # 25 dB whole-utterance speech-region floor, which is too permissive to
    # catch a single syllable's tail.
    TRAILING_SILENCE_DROP_DB = 15

    # Vowel-end clamping (prevents onset cluster leakage)
    # Based on perceptual syllable timing - boundary should be at vowel offset
    VOWEL_END_LOOKAHEAD_FACTOR = 1.5  # Multiplier of MIN_SYLLABLE_DURATION
    VOWEL_END_INTENSITY_DROP = 0.15   # 15% relative drop from peak (speaker-normalized)
    VOWEL_END_FLUX_THRESHOLD = 0.4    # Normalized intensity rate-of-change for voiced clusters


# ============================================================================
# MULTI-CUE BOUNDARY DETECTOR
# ============================================================================

class BoundaryDetector:
    """
    Multi-cue syllable boundary detection.
    
    Combines four acoustic cues with weighted scoring:
    - Voicing transitions (40%): Voiced→unvoiced marks consonant onset
    - Spectral centroid (30%): Vowels=low, fricatives=high
    - Intensity minimum (20%): Traditional approach, now secondary
    - Amplitude envelope change (10%): Rapid drops indicate transitions
    
    This fixes the diphthong problem where intensity minima fall WITHIN
    vowels like /eɪ/ and /oʊ/, causing incorrect syllable boundaries.
    """
    
    # Weights for different cues (research-backed)
    WEIGHT_VOICING = 0.40
    WEIGHT_SPECTRAL = 0.30
    WEIGHT_INTENSITY = 0.20
    WEIGHT_ENVELOPE = 0.10
    
    def __init__(self, sound, pitch, intensity):
        self.sound = sound
        self.pitch = pitch
        self.intensity = intensity
        
        # Precompute intensity arrays
        self.int_times = np.array(intensity.xs())
        self.int_values = np.array([intensity.get_value(t) for t in self.int_times])
        self.int_values = np.nan_to_num(self.int_values, nan=0.0)
        
        # Precompute spectral centroid (may fail for short audio)
        try:
            self.spectral_centroid = self._compute_spectral_centroid()
        except Exception as e:
            print(f"BoundaryDetector: Spectral centroid computation failed: {e}")
            self.spectral_centroid = None
        
        # Precompute amplitude envelope
        self.envelope = self._compute_envelope()
    
    def _compute_spectral_centroid(self):
        """
        Compute spectral centroid over time.
        Vowels have low centroid (~500-1500 Hz), fricatives have high (2000-8000 Hz).
        """
        # Use Praat's spectrogram
        spectrogram = self.sound.to_spectrogram(
            window_length=0.025,  # 25ms window
            time_step=0.01        # 10ms step
        )
        
        centroids = []
        times = []
        
        # Sample at 10ms intervals
        t = 0.01
        while t < self.sound.duration - 0.01:
            try:
                # Get power at different frequencies
                spectrum_slice = spectrogram.to_spectrum_slice(t)
                if spectrum_slice is not None:
                    freqs = np.array(spectrum_slice.xs())
                    # Get power values (squared amplitude)
                    powers = np.array([abs(spectrum_slice.get_value_at_index(i))**2 
                                      for i in range(len(freqs))])
                    powers = np.maximum(powers, 1e-10)  # Avoid division by zero
                    
                    # Spectral centroid: frequency weighted by power
                    centroid = np.sum(freqs * powers) / np.sum(powers)
                    centroids.append(centroid)
                    times.append(t)
            except Exception:
                pass
            t += 0.01
        
        if len(centroids) < 3:
            return None
            
        return {'times': np.array(times), 'values': np.array(centroids)}
    
    def _compute_envelope(self):
        """Compute amplitude envelope and its derivative (rate of change)."""
        # Smooth intensity
        smoothed = uniform_filter1d(self.int_values, size=5)  # type: ignore
        
        # Compute derivative (rate of change)
        derivative = np.gradient(smoothed)
        
        return {
            'times': self.int_times,
            'values': smoothed,
            'derivative': derivative
        }
    
    def find_boundary(self, start_time, end_time):
        """
        Find optimal syllable boundary between two time points.
        Returns boundary time and confidence scores for each cue.
        """
        # Initialize with explicit structure to satisfy type checkers
        results: dict[str, dict] = {
            'voicing': {'time': None, 'confidence': 0.0},
            'spectral': {'time': None, 'confidence': 0.0},
            'intensity': {'time': None, 'confidence': 0.0},
            'envelope': {'time': None, 'confidence': 0.0}
        }
        
        # 1. Find voicing transition
        voicing_result = self._find_voicing_boundary(start_time, end_time)
        results['voicing'] = voicing_result
        
        # 2. Find spectral centroid change
        spectral_result = self._find_spectral_boundary(start_time, end_time)
        results['spectral'] = spectral_result
        
        # 3. Find intensity minimum
        intensity_result = self._find_intensity_boundary(start_time, end_time)
        results['intensity'] = intensity_result
        
        # 4. Find envelope change point
        envelope_result = self._find_envelope_boundary(start_time, end_time)
        results['envelope'] = envelope_result
        
        # Combine using weighted scoring
        optimal_boundary = self._combine_cues(results, start_time, end_time)
        
        return {
            'time': optimal_boundary,
            'cues': results
        }
    
    def _find_voicing_boundary(self, start_time, end_time):
        """Find voicing transition (voiced↔unvoiced)."""
        step = 0.005  # 5ms resolution
        transitions = []
        
        prev_voiced: bool | None = None
        t = start_time
        
        while t <= end_time:
            p = self.pitch.get_value_at_time(t)
            is_voiced = not np.isnan(p) and p > 0
            
            if prev_voiced is not None and is_voiced != prev_voiced:
                transition_type = 'v2uv' if prev_voiced else 'uv2v'
                transitions.append({
                    'time': t,
                    'type': transition_type,
                    # Prefer voiced→unvoiced (vowel ending)
                    'score': 1.0 if transition_type == 'v2uv' else 0.7
                })
            
            prev_voiced = is_voiced
            t += step
        
        if not transitions:
            return {'time': None, 'confidence': 0.0}
        
        # Return best transition
        best = max(transitions, key=lambda x: x['score'])
        return {
            'time': best['time'],
            'type': best['type'],
            'confidence': best['score'],
            'all_transitions': transitions
        }
    
    def _find_spectral_boundary(self, start_time, end_time):
        """Find point of maximum spectral centroid change."""
        if self.spectral_centroid is None:
            return {'time': None, 'confidence': 0.0}
            
        times = self.spectral_centroid['times']
        values = self.spectral_centroid['values']
        
        # Get values in range
        mask = (times >= start_time) & (times <= end_time)
        local_times = times[mask]
        local_values = values[mask]
        
        if len(local_values) < 3:
            return {'time': None, 'confidence': 0.0}
        
        # Compute derivative (rate of change)
        derivative = np.abs(np.gradient(local_values))
        
        # Find maximum change
        max_idx = np.argmax(derivative)
        max_time = float(local_times[max_idx])
        
        # Confidence based on magnitude of change
        change_magnitude = derivative[max_idx]
        avg_change = np.mean(derivative)
        confidence = min(1.0, change_magnitude / (avg_change * 3 + 1e-6))
        
        return {
            'time': max_time,
            'confidence': confidence,
            'change_magnitude': float(change_magnitude)
        }
    
    def _find_intensity_boundary(self, start_time, end_time):
        """Find intensity minimum (traditional approach)."""
        mask = (self.int_times >= start_time) & (self.int_times <= end_time)
        local_times = self.int_times[mask]
        local_values = self.int_values[mask]
        
        if len(local_values) == 0:
            return {'time': None, 'confidence': 0.0}
        
        # Find minimum
        min_idx = np.argmin(local_values)
        min_time = float(local_times[min_idx])
        min_value = local_values[min_idx]
        
        # Confidence based on dip depth
        max_value = np.max(local_values)
        dip_depth = max_value - min_value
        confidence = min(1.0, dip_depth / 10.0)  # Normalize by 10dB
        
        return {
            'time': min_time,
            'confidence': confidence,
            'dip_depth': float(dip_depth)
        }
    
    def _find_envelope_boundary(self, start_time, end_time):
        """Find point of maximum amplitude envelope change."""
        times = self.envelope['times']
        derivative = self.envelope['derivative']
        
        mask = (times >= start_time) & (times <= end_time)
        local_times = times[mask]
        local_derivative = np.abs(derivative[mask])
        
        if len(local_derivative) < 2:
            return {'time': None, 'confidence': 0.0}
        
        # Find maximum change rate
        max_idx = np.argmax(local_derivative)
        max_time = float(local_times[max_idx])
        
        # Confidence
        max_change = local_derivative[max_idx]
        avg_change = np.mean(local_derivative)
        confidence = min(1.0, max_change / (avg_change * 2 + 1e-6))
        
        return {
            'time': max_time,
            'confidence': confidence
        }
    
    def _combine_cues(self, results, start_time, end_time):
        """Combine all cues using weighted scoring."""
        candidates = []
        
        # Collect all candidate times with their weights
        if results['voicing']['time'] is not None:
            candidates.append({
                'time': results['voicing']['time'],
                'weight': self.WEIGHT_VOICING * results['voicing']['confidence'],
                'source': 'voicing'
            })
        
        if results['spectral']['time'] is not None:
            candidates.append({
                'time': results['spectral']['time'],
                'weight': self.WEIGHT_SPECTRAL * results['spectral']['confidence'],
                'source': 'spectral'
            })
        
        if results['intensity']['time'] is not None:
            candidates.append({
                'time': results['intensity']['time'],
                'weight': self.WEIGHT_INTENSITY * results['intensity']['confidence'],
                'source': 'intensity'
            })
        
        if results['envelope']['time'] is not None:
            candidates.append({
                'time': results['envelope']['time'],
                'weight': self.WEIGHT_ENVELOPE * results['envelope']['confidence'],
                'source': 'envelope'
            })
        
        if not candidates:
            # Fallback to midpoint
            return (start_time + end_time) / 2
        
        # If voicing transition exists and is confident, prefer it
        voicing = results['voicing']
        if voicing['time'] is not None and voicing['confidence'] > 0.7:
            # Strong voicing evidence - trust it over others
            return voicing['time']
        
        # Otherwise use weighted average
        total_weight = sum(c['weight'] for c in candidates)
        if total_weight > 0:
            weighted_avg = sum(c['time'] * c['weight'] for c in candidates) / total_weight
            return weighted_avg
        
        return (start_time + end_time) / 2


# ============================================================================
# VOWEL-END CLAMPING (Prevents onset cluster leakage like /pr/ into prev syl)
# ============================================================================

def find_vowel_end(pitch, intensity_obj, int_times, int_values, peak_time, candidate_boundary, config=None):
    """
    Find where the vowel nucleus ends, BEFORE consonant onset.
    
    This prevents onset clusters (e.g., /pr/ in "improve") from leaking into
    the previous syllable's audio playback and duration metrics.
    
    Uses:
    1. Voicing break (voiced -> unvoiced transition)
    2. Intensity drop (relative to speaker's dynamic range)
    3. Intensity flux spike (fallback for voiced clusters like /mbr/)
    
    Args:
        peak_time: Time of syllable nucleus peak
        candidate_boundary: The boundary proposed by BoundaryDetector (search up to this)
    
    Returns the time of vowel offset.
    """
    if config is None:
        config = AnalysisConfig()
    
    # Search from peak to just past candidate boundary
    # This ensures we check the ENTIRE region where onset could be
    max_lookahead = candidate_boundary - peak_time + 0.02  # +20ms buffer past candidate
    max_lookahead = max(max_lookahead, 0.06)  # At least 60ms
    max_lookahead = min(max_lookahead, 0.25)  # Cap at 250ms to avoid runaway
    
    # Speaker-normalized intensity drop threshold
    median_intensity = np.median(int_values[int_values > 0]) if np.any(int_values > 0) else 50
    drop_threshold = median_intensity * config.VOWEL_END_INTENSITY_DROP
    
    # Find indices
    start_idx = int(np.searchsorted(int_times, peak_time))
    end_limit = min(peak_time + max_lookahead, int_times[-1] if len(int_times) > 0 else peak_time)
    end_idx = int(np.searchsorted(int_times, end_limit))
    
    if start_idx >= len(int_values) or end_idx <= start_idx:
        return float(end_limit)
    
    peak_intensity = int_values[start_idx]
    
    # PASS 1: Look for voicing break (primary - most reliable)
    prev_voiced = True
    for i in range(start_idx + 1, min(end_idx, len(int_values))):
        t = float(int_times[i])
        p = pitch.get_value_at_time(t)
        is_voiced = not np.isnan(p) and p > 0
        
        if prev_voiced and not is_voiced:
            return t
        
        prev_voiced = is_voiced
    
    # PASS 2: Look for sharp intensity drop (secondary)
    for i in range(start_idx + 1, min(end_idx, len(int_values))):
        t = float(int_times[i])
        curr_intensity = int_values[i]
        
        if curr_intensity < peak_intensity - drop_threshold:
            return t
    
    # PASS 3: Flux spike (tertiary - only for voiced clusters like /mbr/)
    # Use a high threshold to avoid false positives
    FLUX_THRESHOLD = 1.5
    prev_intensity = int_values[start_idx]
    for i in range(start_idx + 1, min(end_idx, len(int_values))):
        t = float(int_times[i])
        curr_intensity = int_values[i]
        dt = int_times[i] - int_times[i-1]
        
        if dt > 0:
            flux = abs(curr_intensity - prev_intensity) / dt
            normalized_flux = flux / (peak_intensity + 1e-6)
            if normalized_flux > FLUX_THRESHOLD:
                return t
        
        prev_intensity = curr_intensity
    
    return float(end_limit)


def clamp_boundary_to_vowel_end(candidate_boundary, peak_time, start_time, 
                                  pitch, intensity_obj, int_times, int_values, config=None):
    """
    Clamp a candidate boundary so it never crosses into the next syllable's onset.
    
    Also enforces minimum syllable duration constraint.
    """
    if config is None:
        config = AnalysisConfig()
    
    # Find vowel end (search up to candidate boundary)
    vowel_end = find_vowel_end(pitch, intensity_obj, int_times, int_values, peak_time, candidate_boundary, config)
    
    # Clamp: boundary cannot be later than vowel end
    clamped = min(candidate_boundary, vowel_end)
    
    # Sanity check: ensure syllable doesn't become too short
    min_end = start_time + config.MIN_SYLLABLE_DURATION
    clamped = max(clamped, min_end)

    return clamped, vowel_end


def trim_trailing_silence(final_start, speech_end, peak_time,
                          pitch, intensity_obj, int_times, int_values, config=None):
    """
    Pull the final syllable's end back off trailing silence / out-breath.

    speech_end is the last above-threshold intensity frame plus a fixed padding,
    so a low-energy tail (out-breath, lingering frication) inflates the final
    syllable's duration. Because duration is the heaviest stress cue
    (STRESS_WEIGHT_DURATION = 0.60), that inflation biases the final syllable's
    stress score — the `industrial` sample overshot its hand-labelled `al`
    boundary by ~78 ms this way.

    Walk back from speech_end to the last frame whose intensity is still within
    TRAILING_SILENCE_DROP_DB of this syllable's own peak, then re-apply the same
    2-frame (~20 ms) padding speech_end carries. The end is only ever pulled IN,
    and never earlier than the vowel offset of the final peak nor below the
    minimum syllable duration, so a genuinely short or voiced-coda final syllable
    is never clipped.
    """
    if config is None:
        config = AnalysisConfig()

    span_idx = np.where((int_times >= final_start) & (int_times <= speech_end))[0]
    if span_idx.size == 0:
        return speech_end

    span_values = int_values[span_idx]
    peak_intensity = float(np.max(span_values))
    # Perceptual speech offset for a single syllable's tail: energy has decayed
    # this far below the syllable's own peak.
    trailing_floor = peak_intensity - config.TRAILING_SILENCE_DROP_DB

    voiced_local = np.where(span_values > trailing_floor)[0]
    if voiced_local.size == 0:
        return speech_end

    last_voiced_idx = int(span_idx[int(voiced_local[-1])])
    # Mirror the +2-frame (~20 ms) padding that speech_end itself carries.
    padded_idx = min(len(int_times) - 1, last_voiced_idx + 2)
    trimmed_end = float(int_times[padded_idx])

    # Only ever pull the end in.
    trimmed_end = min(trimmed_end, speech_end)
    # Never cross earlier than the final vowel's offset...
    vowel_end = find_vowel_end(
        pitch, intensity_obj, int_times, int_values, peak_time, speech_end, config
    )
    trimmed_end = max(trimmed_end, vowel_end)
    # ...nor shorten the syllable below the minimum valid duration.
    trimmed_end = max(trimmed_end, final_start + config.MIN_SYLLABLE_DURATION)
    # Final ceiling: the trim only ever pulls the end IN.
    trimmed_end = min(trimmed_end, speech_end)

    return trimmed_end


app: Flask = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_UPLOAD_BYTES', 10 * 1024 * 1024))

# CORS configuration - default to production BEL and local origins unless explicitly overridden
# Using late initialization pattern to avoid type mismatch in some IDEs
cors = CORS()
cors_origins_env = str(os.environ.get('CORS_ORIGINS', '')).strip()
cors_origins = [origin.strip() for origin in cors_origins_env.split(',') if origin.strip()] if cors_origins_env else [
    'https://betterenglishlearning.com',
    'https://www.betterenglishlearning.com',
    'https://listening-tasks-3ae34.web.app',
    'https://listening-tasks-3ae34.firebaseapp.com',
    'http://localhost:8443',
    'https://localhost:8443',
    'http://127.0.0.1:8443',
    'https://127.0.0.1:8443'
]
# type: ignore
cors.init_app(app, origins=cors_origins, methods=['GET', 'POST', 'OPTIONS'], allow_headers=['Content-Type'])

LOCAL_PRONOUNCE_SAMPLE_MAX_BYTES = 5 * 1024 * 1024
LOCAL_PRONOUNCE_SAMPLE_ORIGINS = {
    'http://localhost:8443',
    'https://localhost:8443',
    'http://127.0.0.1:8443',
    'https://127.0.0.1:8443',
}


def _local_pronounce_sample_dir():
    """Return the workspace-local directory used by the Pronounce save action."""
    configured = str(os.environ.get('PRONUNCIATION_DEBUG_SAMPLE_DIR') or '').strip()
    if configured:
        return Path(configured).expanduser().resolve()
    # server.py lives at <workspace>/backend/local_server/server.py.
    return Path(__file__).resolve().parents[2] / 'test-results' / 'pronounce-local-samples'


def _is_local_pronounce_request():
    """Keep the debug sample route loopback-only, even if HOST is widened."""
    remote_addr = str(request.remote_addr or '').strip().lower()
    if remote_addr not in {'127.0.0.1', '::1', 'localhost'}:
        return False
    origin = str(request.headers.get('Origin') or '').strip()
    return not origin or origin in LOCAL_PRONOUNCE_SAMPLE_ORIGINS


def _local_sample_id(word):
    slug = re.sub(r'[^a-z0-9]+', '-', str(word or '').casefold()).strip('-')[:40] or 'word'
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    return f'{slug}-{timestamp}-{secrets.token_hex(4)}'


def _workspace_relative_path(path):
    workspace_root = Path(__file__).resolve().parents[2]
    try:
        return str(path.resolve().relative_to(workspace_root)).replace(os.sep, '/')
    except ValueError:
        return str(path.resolve())

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        'service': 'Pronunciation Analyzer API',
        'status': 'running',
        'endpoints': {
            '/health': 'Health check',
            '/analyze': 'POST - Analyze audio file',
            '/dictionary/<word>': 'GET - Fetch word data from Merriam-Webster',
            '/proxy-audio': 'GET - Proxy audio from MW (CORS bypass)',
            '/analyze-url': 'POST - Analyze audio from URL',
            '/debug/pronounce-samples': 'POST - Save a localhost-only Pronounce sample'
        }
    })

@app.route('/health', methods=['GET'])
def health():
    verifier_path = Path(os.environ.get('PRONUNCIATION_VERIFIER_ARTIFACT') or (Path(__file__).parent / 'models' / 'pronunciation-verifier-v1.json'))
    try:
        verifier_metadata = json.loads(verifier_path.read_text(encoding='utf-8'))
    except Exception:
        verifier_metadata = {}

    # Reading the JSON is not enough: an active deployment whose artifact fails
    # validation cannot score anything, and must not look healthy to
    # deployment automation.
    try:
        from .pronunciation_verifier import validate_artifact
    except ImportError:
        from pronunciation_verifier import validate_artifact  # type: ignore
    try:
        validate_artifact(verifier_metadata)
        verifier_status = 'ok'
    except Exception as error:
        verifier_status = str(error)

    healthy = verifier_status == 'ok' or _PRONUNCIATION_V3_MODE != 'active'
    payload = {
        'status': 'ok' if healthy else 'degraded',
        'schemaVersion': PRONUNCIATION_SCHEMA_VERSION,
        'algorithmVersion': PRONUNCIATION_ALGORITHM_VERSION,
        'analysisVersion': 'pronunciation-analysis-v2',
        'deploymentVersion': get_deployment_version(),
        'pronunciationV3Mode': _PRONUNCIATION_V3_MODE,
        'recognizerContract': 'recognize-v2',
        # Presence only, never the URL itself — one curl answers "is V3 wired
        # up?" without reading a running process's environment. A local session
        # that silently lost its recognizer wiring is otherwise invisible.
        'recognizerConfigured': bool(os.environ.get('PHONEME_SERVICE_URL')),
        'verifierSchema': 'pronunciation-verifier-v1',
        'verifierFeatureSchema': verifier_metadata.get('feature_schema_version', 'unavailable'),
        'verifierRevision': verifier_metadata.get('artifact_sha256', 'unavailable'),
        'verifierStatus': verifier_status,
    }
    if not healthy:
        payload['error'] = 'V3 is active but the verifier artifact is unusable'
        return jsonify(payload), 503
    return jsonify(payload)

# ============================================
# MERRIAM-WEBSTER DICTIONARY ENDPOINTS
# ============================================

# MW API Key from environment variable (set in Cloud Run or .env for local dev)
# Load from .env file for local development
from dotenv import load_dotenv
load_dotenv()

MW_API_KEY = os.environ.get('MW_API_KEY')
if not MW_API_KEY:
    print("WARNING: MW_API_KEY environment variable not set. Dictionary features will not work.")

MW_REFERENCES = ('collegiate', 'learners', 'sd4')

_CMU_VOWELS = {
    'AA': 'ɑ', 'AE': 'æ', 'AO': 'ɔ', 'AW': 'aʊ', 'AY': 'aɪ',
    'EH': 'ɛ', 'EY': 'eɪ', 'IH': 'ɪ', 'IY': 'i', 'OW': 'oʊ',
    'OY': 'ɔɪ', 'UH': 'ʊ', 'UW': 'u', 'AX': 'ə', 'AXR': 'ɚ',
    'IX': 'ɨ', 'UX': 'ʉ',
}
_CMU_CONSONANTS = {
    'B': 'b', 'CH': 'tʃ', 'D': 'd', 'DH': 'ð', 'F': 'f', 'G': 'g',
    'HH': 'h', 'JH': 'dʒ', 'K': 'k', 'L': 'l', 'M': 'm', 'N': 'n',
    'NG': 'ŋ', 'P': 'p', 'R': 'r', 'S': 's', 'SH': 'ʃ', 'T': 't',
    'TH': 'θ', 'V': 'v', 'W': 'w', 'Y': 'j', 'Z': 'z', 'ZH': 'ʒ',
}
_CMU_FALLBACK_CACHE = None


def arpabet_to_ipa(pronunciation):
    """Convert one exact CMU ARPAbet pronunciation to phonemic American IPA."""
    ipa = []
    for raw_token in str(pronunciation or '').split('#', 1)[0].split():
        match = re.fullmatch(r'([A-Z]+)([012]?)', raw_token)
        if not match:
            return None
        phoneme, stress = match.groups()
        if phoneme == 'AH':
            symbol = 'ə' if stress == '0' else 'ʌ'
        elif phoneme == 'ER':
            symbol = 'ɚ' if stress == '0' else 'ɝ'
        elif phoneme in _CMU_VOWELS:
            symbol = _CMU_VOWELS[phoneme]
        elif phoneme in _CMU_CONSONANTS and not stress:
            ipa.append(_CMU_CONSONANTS[phoneme])
            continue
        else:
            return None
        if stress == '1':
            ipa.append('ˈ')
        elif stress == '2':
            ipa.append('ˌ')
        ipa.append(symbol)
    return ''.join(ipa) or None


def get_cmu_pronunciation(word):
    """Load the bundled exact-word CMU dictionary lazily."""
    global _CMU_FALLBACK_CACHE
    if _CMU_FALLBACK_CACHE is None:
        candidates = (
            Path(__file__).with_name('cmudict.json'),
            Path(__file__).resolve().parents[2] / 'public' / 'cmudict.json',
        )
        path = next((candidate for candidate in candidates if candidate.is_file()), None)
        if path is None:
            _CMU_FALLBACK_CACHE = {}
        else:
            with path.open(encoding='utf-8') as source:
                _CMU_FALLBACK_CACHE = json.load(source)
    pronunciation = _CMU_FALLBACK_CACHE.get(str(word or '').strip().casefold())
    return str(pronunciation).strip() if pronunciation else None


def build_cmu_fallback_variant(word, pronunciation):
    raw_ipa = arpabet_to_ipa(pronunciation)
    if not raw_ipa:
        return None
    variant = build_pronunciation_variant(
        word=word,
        part_of_speech=None,
        definition=None,
        entry_id=f'cmudict:{word}',
        exact_match=True,
        raw_ipa=raw_ipa,
        headword=None,
        audio_filename=None,
        audio_url=None,
        source_provider='cmu-pronouncing-dictionary',
        source_transcription='cmu-arpabet-converted',
    )
    return variant if variant['validation']['status'] == 'valid' else None


def get_deployment_version():
    return (
        str(os.environ.get('GIT_SHA', '')).strip()
        or str(os.environ.get('DEPLOYMENT_VERSION', '')).strip()
        or str(os.environ.get('K_REVISION', '')).strip()
        or 'local-development'
    )


def _mw_entry_id(entry):
    if not isinstance(entry, dict):
        return ''
    return str(entry.get('meta', {}).get('id') or '').strip()


def _mw_entry_base(entry):
    return _mw_entry_id(entry).split(':', 1)[0].casefold()


def _normalize_mw_surface(value):
    """Normalize MW headword markup without performing morphological matching."""
    normalized = str(value or '').strip().casefold()
    normalized = re.sub(r'[\*·•‧]', '', normalized)
    normalized = re.sub(r'\s+', ' ', normalized)
    return normalized


_MW_NON_US_REGIONS = (
    'australian',
    'british',
    'canadian',
    'irish',
    'new zealand',
    'scottish',
    'south african',
)


def _mw_pronunciation_labels(pronunciation):
    labels = []
    if not isinstance(pronunciation, dict):
        return labels
    for value in (pronunciation.get('l'), pronunciation.get('l2')):
        values = value if isinstance(value, list) else [value]
        labels.extend(str(item).strip() for item in values if str(item or '').strip())
    return labels


def _mw_pronunciation_is_en_us(pronunciation):
    """Apply the explicit region policy for the en-US pronunciation contract."""
    label_text = ' '.join(_mw_pronunciation_labels(pronunciation)).casefold()
    if not label_text:
        return True
    explicitly_us = (
        re.search(r'\bu\.?s\.?(?:a\.?)?\b', label_text) is not None
        or 'united states' in label_text
        or 'american' in label_text
    )
    if explicitly_us:
        return True
    return not any(region in label_text for region in _MW_NON_US_REGIONS)


def _deduplicate_mw_items(items):
    unique = []
    seen = set()
    for item in items:
        if isinstance(item, dict):
            key = _mw_entry_id(item) or repr(item)
        else:
            key = str(item)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def fetch_mw_entries_v2(word):
    """Fetch exact entries first; retain loose results only as conflict evidence."""
    headers = {
        'User-Agent': 'BEL-Pronunciation-Reference/1.0'
    }
    loose_entries = []
    suggestions = []
    last_error = None

    for reference in MW_REFERENCES:
        url = (
            f'https://www.dictionaryapi.com/api/v3/references/{reference}/json/'
            f'{word}?key={MW_API_KEY}'
        )
        response = http_requests.get(url, headers=headers, timeout=10)
        if not response.ok:
            last_error = {
                'status': response.status_code,
                'message': f'Merriam-Webster {reference} request failed'
            }
            continue
        try:
            payload = response.json()
        except Exception:
            last_error = {
                'status': 502,
                'message': f'Merriam-Webster {reference} returned invalid JSON'
            }
            continue
        if not isinstance(payload, list):
            continue

        exact = [
            entry for entry in payload
            if isinstance(entry, dict) and _mw_entry_base(entry) == word
        ]
        if exact:
            return _deduplicate_mw_items(exact), [], None
        loose_entries.extend(entry for entry in payload if isinstance(entry, dict))
        suggestions.extend(str(item) for item in payload if isinstance(item, str))

    return (
        _deduplicate_mw_items(loose_entries),
        _deduplicate_mw_items(suggestions)[:10],
        last_error,
    )


def _mw_pronunciation_records(entries, requested_word):
    records = []
    for entry in entries:
        entry_id = _mw_entry_id(entry)
        exact_match = _mw_entry_base(entry) == requested_word
        hwi = entry.get('hwi') if isinstance(entry.get('hwi'), dict) else {}
        headword = str(hwi.get('hw') or '').strip() or None
        part_of_speech = str(entry.get('fl') or '').strip() or None
        definitions = entry.get('shortdef')
        definition = (
            str(definitions[0]).strip()
            if isinstance(definitions, list) and definitions and definitions[0]
            else None
        )

        def append_pronunciations(
            pronunciations,
            *,
            record_entry_id,
            record_exact_match,
            record_headword,
            record_part_of_speech,
            record_definition,
        ):
            if not isinstance(pronunciations, list) or not pronunciations:
                pronunciations = [{}]
            for pronunciation in pronunciations:
                pronunciation = pronunciation if isinstance(pronunciation, dict) else {}
                if not _mw_pronunciation_is_en_us(pronunciation):
                    continue
                raw_ipa = pronunciation.get('ipa') or pronunciation.get('mw') or None
                sound = pronunciation.get('sound')
                sound = sound if isinstance(sound, dict) else {}
                audio_filename = str(sound.get('audio') or '').strip() or None
                records.append({
                    'word': requested_word,
                    'entry_id': record_entry_id or None,
                    'exact_match': record_exact_match,
                    'headword': record_headword,
                    'part_of_speech': record_part_of_speech,
                    'definition': record_definition,
                    'raw_ipa': str(raw_ipa).strip() if raw_ipa else None,
                    'audio_filename': audio_filename,
                    'audio_url': build_audio_url(audio_filename) if audio_filename else None,
                    'source_labels': _mw_pronunciation_labels(pronunciation),
                })

        append_pronunciations(
            hwi.get('prs'),
            record_entry_id=entry_id,
            record_exact_match=exact_match,
            record_headword=headword,
            record_part_of_speech=part_of_speech,
            record_definition=definition,
        )

        for index, run_on in enumerate(entry.get('uros') or []):
            if not isinstance(run_on, dict):
                continue
            run_on_headword = str(run_on.get('ure') or '').strip() or None
            if _normalize_mw_surface(run_on_headword) != requested_word:
                continue
            append_pronunciations(
                run_on.get('prs'),
                record_entry_id=f'{entry_id}#uro:{index}' if entry_id else f'uro:{index}',
                record_exact_match=True,
                record_headword=run_on_headword,
                record_part_of_speech=str(run_on.get('fl') or '').strip() or None,
                record_definition=None,
            )

        variants = [*(entry.get('vrs') or []), *(hwi.get('vrs') or [])]
        for index, variant in enumerate(variants):
            if not isinstance(variant, dict):
                continue
            variant_headword = str(variant.get('va') or '').strip() or None
            if _normalize_mw_surface(variant_headword) != requested_word:
                continue
            append_pronunciations(
                variant.get('prs'),
                record_entry_id=f'{entry_id}#vr:{index}' if entry_id else f'vr:{index}',
                record_exact_match=True,
                record_headword=variant_headword,
                record_part_of_speech=part_of_speech,
                record_definition=definition if exact_match else None,
            )
    return records


def build_dictionary_v2_reference(word, entries):
    records = _mw_pronunciation_records(entries, word)
    audio_by_pronunciation = {}
    for record in records:
        if not record['exact_match'] or not record['audio_url'] or not record['raw_ipa']:
            continue
        key = (
            normalize_ipa(record['raw_ipa']),
            str(record['part_of_speech'] or '').casefold(),
        )
        audio_by_pronunciation.setdefault(
            key,
            (record['audio_filename'], record['audio_url']),
        )

    variants = []
    for record in records:
        if record['exact_match'] and not record['audio_url'] and record['raw_ipa']:
            key = (
                normalize_ipa(record['raw_ipa']),
                str(record['part_of_speech'] or '').casefold(),
            )
            inherited = audio_by_pronunciation.get(key)
            if inherited:
                record = dict(record)
                record['audio_filename'], record['audio_url'] = inherited
        variants.append(build_pronunciation_variant(**record))

    return build_pronunciation_reference(
        word=word,
        variants=variants,
        deployment_version=get_deployment_version(),
    )


@app.route('/dictionary/v2/<word>', methods=['GET'])
def get_dictionary_word_v2(word):
    normalized_word = str(word or '').strip().casefold()
    if not normalized_word:
        return jsonify({'error': 'Word is required'}), 400
    if not MW_API_KEY:
        return jsonify({
            'error': 'Dictionary API not configured',
            'code': 'DICTIONARY_NOT_CONFIGURED'
        }), 503
    try:
        entries, suggestions, fetch_error = fetch_mw_entries_v2(normalized_word)
        reference = build_dictionary_v2_reference(normalized_word, entries)
        if reference['defaultVariantId'] is None:
            fallback = build_cmu_fallback_variant(
                normalized_word,
                get_cmu_pronunciation(normalized_word),
            )
            if fallback:
                reference = build_pronunciation_reference(
                    word=normalized_word,
                    variants=[*reference['variants'], fallback],
                    deployment_version=get_deployment_version(),
                )
        if suggestions:
            reference['suggestions'] = suggestions
        elif not entries:
            reference['suggestions'] = []
        if fetch_error and not entries and not suggestions:
            reference['upstreamError'] = fetch_error
        return jsonify(reference)
    except Exception as error:
        print(f'Dictionary v2 error: {error}')
        return jsonify({
            'error': 'Pronunciation reference unavailable',
            'code': 'DICTIONARY_UPSTREAM_ERROR'
        }), 502

@app.route('/dictionary/<word>', methods=['GET'])
def get_dictionary_word(word):
    """
    Fetch word data from Merriam-Webster API.
    Returns syllables, pronunciation, audio URL, and definition.
    """
    if not MW_API_KEY:
        return jsonify({'error': 'Dictionary API not configured'}), 500
    
    try:
        normalized_word = word.lower().strip()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        # Try Collegiate first
        url = f'https://www.dictionaryapi.com/api/v3/references/collegiate/json/{normalized_word}?key={MW_API_KEY}'
        response = http_requests.get(url, headers=headers, timeout=10)
        
        # Fallback 1: try learners (often contains IPA)
        if response.status_code == 200 and "Not subscribed for this reference" in response.text:
            print(f"Key not valid for Collegiate, trying Learner's Dictionary for '{normalized_word}'...")
            url = f'https://www.dictionaryapi.com/api/v3/references/learners/json/{normalized_word}?key={MW_API_KEY}'
            response = http_requests.get(url, headers=headers, timeout=10)
            
        # Fallback 2: try school dictionary (sd4)
        if response.status_code == 200 and "Not subscribed for this reference" in response.text:
            print(f"Key not valid for Learners, trying School Dictionary (sd4) for '{normalized_word}'...")
            url = f'https://www.dictionaryapi.com/api/v3/references/sd4/json/{normalized_word}?key={MW_API_KEY}'
            response = http_requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 403:
            return jsonify({'error': 'Invalid API key or quota exceeded'}), 403
        
        if not response.ok:
            return jsonify({'error': f'API error: {response.status_code}', 'text': response.text[:500]}), response.status_code
        
        try:
            data = response.json()
            # If we get a string back (like the error message), it's not JSON we can parse
            if isinstance(data, str):
                 raise ValueError(f"API returned string instead of JSON: {data[:100]}")

            # DEBUG
            if isinstance(data, list):
                print(f"DEBUG MW RESPONSE: Found {len(data)} entries.")
                for i, e in enumerate(data):
                    if isinstance(e, dict):
                         print(f"  Entry {i}: {e.get('meta', {}).get('id', 'NO_ID')}")
            else:
                 print(f"DEBUG MW RESPONSE: Not a list? Type: {type(data)}")
        except Exception as json_err:
            print(f"JSON DECODE ERROR. Response first 500 chars: {response.text[:500]}")
            return jsonify({
                'error': f'JSON decode error: {str(json_err)}',
                'raw_response': response.text[:1000]
            }), 500
        
        # Check if we got results or suggestions
        if not data or not isinstance(data, list) or len(data) == 0:
            return jsonify({'found': False, 'suggestions': []})
        
        # If first item is string, these are spelling suggestions
        if isinstance(data[0], str):
            return jsonify({'found': False, 'suggestions': data[:5]})
        
        # Parse the response
        # Parse the response
        parsed = parse_mw_response(data, normalized_word)
        
        # LEMMATIZATION FALLBACK: If word not found, try lemma (e.g. practicing -> practice)
        # We check if parsed is None/not found, OR if it was a suggestion response
        # LEMMATIZATION FALLBACK: If word not found, try lemma
        if (not parsed or not parsed.get('found')) and lemmatizer:
             # Try different POS tags: verb (v), noun (n), adjective (a)
             # "practicing" -> v -> practice
             # "goods" -> n -> good
             # "happier" -> a -> happy
             lemmas_to_try = []
             
             # Prioritize based on likely inflection
             if normalized_word.endswith('ing') or normalized_word.endswith('ed'):
                 lemmas_to_try.append(lemmatizer.lemmatize(normalized_word, pos='v'))
             elif normalized_word.endswith('s'):
                 lemmas_to_try.append(lemmatizer.lemmatize(normalized_word, pos='n'))
                 lemmas_to_try.append(lemmatizer.lemmatize(normalized_word, pos='v')) # e.g. "likes"
             elif normalized_word.endswith('er') or normalized_word.endswith('est'):
                 lemmas_to_try.append(lemmatizer.lemmatize(normalized_word, pos='a'))
             
             # Fallback to generic noun/verb if not caught above
             lemmas_to_try.append(lemmatizer.lemmatize(normalized_word, pos='v'))
             lemmas_to_try.append(lemmatizer.lemmatize(normalized_word, pos='n'))
             
             # Deduplicate and remove original word
             candidates = []
             seen = set()
             seen.add(normalized_word)
             
             for l in lemmas_to_try:
                 if l not in seen:
                     candidates.append(l)
                     seen.add(l)
            
             for lemma in candidates:
                 print(f"DEBUG: '{normalized_word}' not found. Trying lemma '{lemma}'...")
                 
                 lemma_url = f'https://www.dictionaryapi.com/api/v3/references/collegiate/json/{lemma}?key={MW_API_KEY}'
                 try:
                    lemma_resp = http_requests.get(lemma_url, headers=headers, timeout=10)
                    
                    if lemma_resp.ok:
                        lemma_data = lemma_resp.json()
                        if isinstance(lemma_data, list) and len(lemma_data) > 0 and isinstance(lemma_data[0], dict):
                            lemma_parsed = parse_mw_response(lemma_data, lemma)
                            if lemma_parsed and lemma_parsed.get('found'):
                                print(f"DEBUG: Found lemma '{lemma}'")
                                lemma_parsed['isLemmaFallback'] = True
                                lemma_parsed['originalWord'] = normalized_word
                                return jsonify(lemma_parsed)
                 except Exception as e:
                     print(f"Lemma fetch error: {e}")

        # FALLBACK: If no audio found (even after potential lemma check, or if lemma wasn't used), 
        # try to inherit from stem (for the ORIGINAL word found case).
        # ... (Existing stem logic remains effective for the *current* parsed result if it exists) ...
        
        if parsed and parsed.get('found'):
            has_audio = any(alt.get('audioUrl') for alt in parsed.get('alternatives', []))
            
            if not has_audio and isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                stems = data[0].get('meta', {}).get('stems', [])
                # Prefer shortest stem that is not the word itself
                candidates = [s for s in stems if s.lower() != normalized_word and ' ' not in s]
                candidates.sort(key=len)
                
                if candidates:
                    stem = candidates[0]
                    print(f"DEBUG: No audio for '{normalized_word}', falling back to stem '{stem}'")
                    
                    stem_data = None
                    # Simple fetch loop for stem
                    for ref in ['collegiate', 'learners', 'sd4']:
                        stem_url = f'https://www.dictionaryapi.com/api/v3/references/{ref}/json/{stem}?key={MW_API_KEY}'
                        try:
                            stem_resp = http_requests.get(stem_url, headers=headers, timeout=5)
                            if stem_resp.ok:
                                stem_json = stem_resp.json()
                                if isinstance(stem_json, list) and len(stem_json) > 0 and isinstance(stem_json[0], dict):
                                    stem_data = stem_json
                                    break
                        except Exception as e:
                            print(f"Stem fetch error ({ref}): {e}")

                    if stem_data:
                        stem_parsed = parse_mw_response(stem_data, stem)
                        if stem_parsed and stem_parsed.get('found'):
                            # Find first audio in stem
                            stem_audio_alt = next((alt for alt in stem_parsed.get('alternatives', []) if alt.get('audioUrl')), None)
                            
                            if stem_audio_alt:
                                print(f"DEBUG: Found audio in stem '{stem}': {stem_audio_alt['audioUrl']}")
                                # Inject into original
                                for alt in parsed['alternatives']:
                                    if not alt.get('audioUrl'):
                                        alt['audioUrl'] = stem_audio_alt['audioUrl']
                                        alt['audioFilename'] = stem_audio_alt.get('audioFilename')
                                    if not alt.get('pronunciation'):
                                        alt['pronunciation'] = stem_audio_alt.get('pronunciation')
                                        alt['inheritedPronunciation'] = True

        if parsed and parsed.get('found'):
            return jsonify(parsed)
        else:
            return jsonify({'found': False, 'suggestions': []})
            
    except Exception as e:
        import traceback
        print(f"Dictionary API error: {e}")
        trace = traceback.format_exc()
        print(trace)
        return jsonify({'error': str(e), 'trace': trace}), 500

def parse_mw_response(api_data, word):
    """Parse Merriam-Webster API response into our format."""
    # Parse all matching entries, not just the first one
    all_parsed_entries = []
    
    # Filter for exact matches first
    exact_matches = [e for e in api_data if isinstance(e, dict) and e.get('meta', {}).get('id', '').lower().split(':')[0] == word]
    
    # If no exact matches found by ID, use all entries provided they have an ID (loose matching)
    if not exact_matches:
        exact_matches = [e for e in api_data if isinstance(e, dict) and 'meta' in e]
        
    for entry in exact_matches:
        # returns a list of forms
        parsed_forms = parse_single_mw_entry(entry, word)
        if parsed_forms:
            all_parsed_entries.extend(parsed_forms)
            
    if all_parsed_entries:
        # ROBUST AUDIO FILLING STRATEGY (Cross-entry IPA matching)
        # Instead of inheriting from "primary" or "first in entry", we look for
        # any entry that has audio for the SAME pronunciation (normalized).
        
        # 1. Build Index of available audio
        audio_by_ipa_pos = {}
        audio_by_ipa = {}
        
        for f in all_parsed_entries:
            ipa = normalize_ipa(f.get("pronunciation", ""))
            if not ipa:
                continue
            
            if f.get("audioUrl"):
                pos = (f.get("partOfSpeech") or "").lower().strip()
                audio_by_ipa_pos[(ipa, pos)] = (f["audioUrl"], f.get("audioFilename"))
                audio_by_ipa[ipa] = (f["audioUrl"], f.get("audioFilename"))

        # 2. Fill missing audio where IPA matches
        for f in all_parsed_entries:
            if f.get("audioUrl"):
                continue
                
            ipa = normalize_ipa(f.get("pronunciation", ""))
            if not ipa:
                continue
                
            pos = (f.get("partOfSpeech") or "").lower().strip()

            # Try exact match (IPA + POS) first, then loose match (IPA only)
            match = audio_by_ipa_pos.get((ipa, pos)) or audio_by_ipa.get(ipa)
            if match:
                f["audioUrl"], f["audioFilename"] = match
                f["inheritedAudio"] = True
                f["inheritedAudioReason"] = "ipa_match"

        # DEDUPLICATION: Collapse identical word forms to keep the UI clean.
        seen_forms = set()
        unique_entries = []
        
        print(f"\n{'#'*30}")
        print(f"DEBUG: Processing {len(all_parsed_entries)} entries/forms for '{word}'")
        
        for entry in all_parsed_entries:
            # Keys consist of: pos:label:ipa (identical audio/pos/label/ipa = same button)
            pos = str(entry.get('partOfSpeech') or "").lower().strip()
            label = str(entry.get('label') or "").lower().strip()
            ipa = str(entry.get('pronunciation') or "").lower().strip()
            # Also distinguish by audio filename if present (so we don't merge distinct variants if they happen to share text but not audio)
            # Actually, deduping visually identical items is usually desired even if audio sources differ slightly.
            # But here, we want visual distinctness.
            key = f"{pos}:{label}:{ipa or word.lower()}"
            
            if key not in seen_forms:
                seen_forms.add(key)
                unique_entries.append(entry)
            else:
                pass # Duplicate

        print(f"DEBUG: Final count for '{word}': {len(unique_entries)}")
        print(f"{'#'*30}\n")

        return {
            'found': True, 
            'alternatives': unique_entries,
            'word': word
        }
    else:
        return {'found': False, 'suggestions': []}

def normalize_ipa(ipa):
    """Normalize IPA for matching (remove stress marks, spaces)."""
    if not ipa:
        return ""
    # Remove primary/secondary stress marks and whitespace
    # Also handle some common variations if needed
    import re
    cleaned = ipa.replace("ˈ", "").replace("ˌ", "").replace("'", "")
    cleaned = re.sub(r"\s+", "", cleaned)
    return cleaned

def parse_single_mw_entry(entry, word):
    """Parse a single Merriam-Webster API entry into our format.
    Returns a list of word forms (multi-pronunciation support)."""
    if not entry or 'hwi' not in entry:
        return []
    
    hwi = entry.get('hwi', {})
    hw_text = hwi.get('hw', '')
    fl = entry.get('fl')
    shortdef = entry.get('shortdef', [None])[0] if entry.get('shortdef') else None
    
    prs = hwi.get('prs', [])
    if not prs:
        # Still return basic form even without dictionary pronunciation
        return [{
            'word': word,
            'source': 'merriam-webster',
            'syllables': parse_syllables(hw_text),
            'syllableCount': len(parse_syllables(hw_text)),
            'stressedSyllable': 0,
            'pronunciation': None,
            'audioUrl': None,
            'audioFilename': None,
            'partOfSpeech': fl,
            'definition': shortdef
        }]

    # NOTE: Removed unsafe "first_audio_data" logic. 
    # We do NOT want to inherit audio within the entry unless we are sure it matches.
    # Cross-entry IPA matching in parse_mw_response will handle missing audio more safely.

    results = []
    for i, pron in enumerate(prs):
        # Extract metadata
        ipa_string = pron.get('ipa') or pron.get('mw') or ""
        
        # Improved label logic: Don't use 'pun' unless it looks like a label
        pun = pron.get('pun')
        label = pron.get('l')
        
        if not label and pun and pun.strip() not in {",", ";", ":"}:
            label = pun
            
        # Clean label
        if label:
            label = label.strip().strip('.;,')
            
        res = {
            'word': word,
            'source': 'merriam-webster',
            'syllables': parse_syllables(hw_text),
            'syllableCount': 0,
            'stressedSyllable': 0,
            'pronunciation': ipa_string,
            'audioUrl': None,
            'audioFilename': None,
            'partOfSpeech': fl,
            'label': label,
            'definition': shortdef
        }

        # Syllable counting logic
        hw_count = len(res['syllables'])
        res['syllableCount'] = hw_count
        
        if ipa_string:
            ipa_count = count_ipa_syllables(ipa_string)
            if ipa_count > 0 and ipa_count != hw_count:
                res['syllableCount'] = ipa_count
                res['syllables'] = split_word_by_ipa(word, ipa_string, ipa_count)
            
            res['stressedSyllable'] = find_stressed_syllable(ipa_string, res['syllableCount'])

        # Audio pairing - ONLY use audio clearly attached to this pronunciation
        if pron.get('sound', {}).get('audio'):
            audio_filename = pron['sound']['audio']
            res['audioFilename'] = audio_filename
            res['audioUrl'] = build_audio_url(audio_filename)

        results.append(res)
    
    return results

def parse_syllables(hw):
    """Parse syllables from 'hw' field: 'pho·to·graph' -> ['pho', 'to', 'graph']"""
    if not hw:
        return []
    cleaned = hw.lstrip('*')
    
    # Try multiple common separators
    if '*' in cleaned:
        return [s for s in cleaned.split('*') if s]
    if '·' in cleaned:
        return [s for s in cleaned.split('·') if s]
    if '-' in cleaned:
        return [s for s in cleaned.split('-') if s]
    if '.' in cleaned:
        return [s for s in cleaned.split('.') if s]
        
    return [cleaned]

def count_ipa_syllables(ipa):
    """
    Count syllables by counting vowel sounds in IPA or MW notation.
    Handles various Unicode representations and notation styles.
    """
    if not ipa:
        return 0
    
    # Normalize Unicode (some sources use different representations)
    import unicodedata
    ipa_normalized = unicodedata.normalize('NFC', ipa)
    
    # Also handle regular colon as length mark and standard 'g'
    ipa_normalized = ipa_normalized.replace(':', 'ː').replace('ɡ', 'g').replace("'", "ˈ")
    
    # Remove stress markers and syllable separators for counting
    # Also remove common MW delimiters
    ipa_clean = re.sub(r'[ˈˌ\'\"\.·\-\s\\/()]', '', ipa_normalized)
    
    # IPA vowel nuclei patterns - order matters! Longer sequences first
    vowel_patterns = [
        # Diphthongs
        'aɪ', 'eɪ', 'ɔɪ', 'aʊ', 'oʊ', 'əʊ',
        'ɪə', 'eə', 'ʊə', 'ɛə', 'ɔə',
        # Rhotic diphthongs (common in American English)
        'aɪə', 'aʊə', # Triphthongs
        'oɚ', 'ɔɚ', 'aɚ', 'ɪɚ', 'eɚ', 'ʊɚ', 'ɛɚ', 'uɚ',
        # Long vowels
        'iː', 'uː', 'ɑː', 'ɔː', 'ɜː', 'eː', 'oː', 'æː', 'aː', 'ɛː', 'œː',
        # MW Long vowels
        'äː', 'ëː', 'ïː', 'öː', 'üː',
    ]
    
    # Standard vowels including schwas and MW variants
    # ɚ and ɝ are syllabic rhotics (count as syllable nuclei)
    short_vowels = 'ɪieɛæəɐʌɑɒɔouʊaɚɝɨʉɤøœyɯɵʏäëïöü'
    
    count = 0
    i = 0
    matched_clusters = []
    
    while i < len(ipa_clean):
        matched = False
        
        # Try multi-character patterns first
        for pattern in vowel_patterns:
            if ipa_clean[i:].startswith(pattern):
                count += 1
                matched_clusters.append(pattern)
                i += len(pattern)
                # Skip trailing length marks
                while i < len(ipa_clean) and ipa_clean[i] == 'ː':
                    i += 1
                matched = True
                break
        
        if not matched:
            # Check single vowel only
            if ipa_clean[i] in short_vowels:
                count += 1
                matched_clusters.append(ipa_clean[i])
            i += 1
            
    print(f"DEBUG Syllables: '{ipa}' -> clusters: {matched_clusters}, count: {count}")
    return count


def split_word_by_ipa(word, ipa, syllable_count):
    """
    Attempt to split the word into syllables based on IPA syllable count.
    Used when headword field breaks are incorrect.
    """
    # Heuristic: if we have explicit separators in IPA, we might use them,
    # but mapping them back to orthography is complex.
    # Fallback to a robust approximate split.
    return approximate_orthographic_split(word, syllable_count)


def approximate_orthographic_split(word, syllable_count):
    """
    Approximately split a word into N syllables.
    Used as fallback when MW data is unreliable.
    """
    if syllable_count <= 1:
        return [word]
    
    # Find vowel clusters
    vowel_pattern = r'[aeiouyAEIOUY]+'
    
    # We want to identify the vowel clusters as nuclei
    matches = list(re.finditer(vowel_pattern, word))
    
    if len(matches) == syllable_count:
        # We have exactly the right number of vowel clusters!
        # Split between them (roughly mid-way between clusters)
        syllables = []
        last_end = 0
        for i in range(len(matches)):
            # If this is not the last syllable
            if i < len(matches) - 1:
                # Find space between this cluster and next one
                start_current = matches[i].start()
                end_current = matches[i].end()
                start_next = matches[i+1].start()
                
                # Split at mid-point of consonants
                split_point = (end_current + start_next) // 2
                syllables.append(word[last_end:split_point])
                last_end = split_point
            else:
                # Last syllable
                syllables.append(word[last_end:])
        return syllables
    
    # If heuristic fails (e.g. vowel clusters != syllable count)
    # fall back to even split as per user suggestion
    chunk_size = len(word) // syllable_count
    syllables = []
    for i in range(syllable_count):
        start = i * chunk_size
        end = start + chunk_size if i < syllable_count - 1 else len(word)
        syllables.append(word[start:end])
    
    return syllables

def find_stressed_syllable(pronunciation, syllable_count):
    """Find stressed syllable from MW pronunciation. ˈ = primary stress."""
    if not pronunciation:
        return 0
    
    stress_pos = pronunciation.find('ˈ')
    if stress_pos == -1:
        return 0
    
    # If there are explicit syllable breaks (-, ·, .), count them
    if any(c in pronunciation for c in ['-', '·', '.']):
        before_stress = pronunciation[:stress_pos]
        breaks = before_stress.count('-') + before_stress.count('·') + before_stress.count('.')
        return min(breaks, syllable_count - 1) if syllable_count > 0 else 0
    
    # Use standard vowel list for consistency
    vowel_chars = 'ɪieɛæəɐʌɑɒɔouʊaɚɝɨʉɤøœyɯɵʏæ'
    before_stress = pronunciation[:stress_pos]
    
    # Normalize colons etc for stress counting too
    norm_before = before_stress.replace(':', 'ː').replace('ɡ', 'g')
    matches = re.findall(f'[{vowel_chars}]+[ː]*', norm_before)
    
    return min(len(matches), syllable_count - 1) if syllable_count > 0 else 0

def build_audio_url(filename):
    """Build MW audio URL from filename."""
    if not filename:
        return None
    
    if filename.startswith('bix'):
        subdir = 'bix'
    elif filename.startswith('gg'):
        subdir = 'gg'
    elif filename.startswith('_') or filename[0].isdigit():
        subdir = 'number'
    else:
        subdir = filename[0].lower()
    
    return f'https://media.merriam-webster.com/audio/prons/en/us/mp3/{subdir}/{filename}.mp3'

@app.route('/proxy-audio', methods=['GET'])
def proxy_audio():
    """
    Proxy audio from external URL to avoid CORS issues.
    Usage: /proxy-audio?url=https://media.merriam-webster.com/...
    """
    audio_url = request.args.get('url')
    
    if not audio_url:
        return jsonify({'error': 'No URL provided'}), 400
    
    # Only allow MW audio URLs for security
    if not audio_url.startswith('https://media.merriam-webster.com/'):
        return jsonify({'error': 'Invalid audio URL'}), 400
    
    try:
        response = http_requests.get(audio_url, timeout=15)
        if not response.ok:
            return jsonify({'error': f'Failed to fetch audio: {response.status_code}'}), response.status_code
        
        return Response(
            response.content,
            mimetype='audio/mpeg',
            headers={'Content-Disposition': 'inline'}
        )
    except Exception as e:
        print(f"Proxy audio error: {e}")
        return jsonify({'error': str(e)}), 500

# ============================================
# TATOEBA EXAMPLE SENTENCES ENDPOINT
# ============================================

# In-memory cache for sentences (consider Redis for production)
_sentence_cache = {}

@app.route('/sentences/<word>', methods=['GET'])
def get_example_sentences(word):
    """
    Fetch example sentences from Tatoeba API.
    Returns up to 5 English sentences containing the word.
    """
    normalized_word = word.lower().strip()
    
    # Check cache first
    if normalized_word in _sentence_cache:
        return jsonify({'word': normalized_word, 'sentences': _sentence_cache[normalized_word]})
    
    try:
        # Tatoeba API endpoint for searching sentences
        # Using their public API (no auth required)
        url = f"https://tatoeba.org/en/api_v0/search?from=eng&query={normalized_word}&orphans=no&unapproved=no"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
        
        response = http_requests.get(url, headers=headers, timeout=10)
        
        if not response.ok:
            print(f"Tatoeba API error: {response.status_code}")
            return jsonify({'word': normalized_word, 'sentences': [], 'error': f'API error: {response.status_code}'})
        
        data = response.json()
        
        # Extract sentences from response
        sentences = []
        results = data.get('results', [])
        
        for result in results[:5]:  # Limit to 5 sentences
            text = result.get('text', '')
            if text and normalized_word in text.lower():
                sentences.append(text)
        
        # Cache the results
        _sentence_cache[normalized_word] = sentences
        
        return jsonify({
            'word': normalized_word,
            'sentences': sentences,
            'source': 'tatoeba'
        })
        
    except Exception as e:
        print(f"Tatoeba fetch error: {e}")
        return jsonify({'word': normalized_word, 'sentences': [], 'error': str(e)})

@app.route('/analyze-url', methods=['POST'])
def analyze_from_url():
    """
    Analyze audio from a URL (for native reference analysis).
    Expects JSON: { "audioUrl": "https://...", "expectedSyllables": 3 }
    """
    data = request.get_json()
    
    if not data or 'audioUrl' not in data:
        return jsonify({'error': 'No audioUrl provided'}), 400
    
    audio_url = data['audioUrl']
    expected_syllables = data.get('expectedSyllables')
    
    # Only allow MW audio URLs
    if not audio_url.startswith('https://media.merriam-webster.com/'):
        return jsonify({'error': 'Invalid audio URL'}), 400
    
    try:
        # Fetch audio
        response = http_requests.get(audio_url, timeout=15)
        if not response.ok:
            return jsonify({'error': f'Failed to fetch audio: {response.status_code}'}), response.status_code
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name
        
        try:
            result = analyze_audio(tmp_path, expected_syllables)
            return jsonify(result)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                
    except Exception as e:
        print(f"Analyze URL error: {e}")
        return jsonify({'error': str(e)}), 500


def _finite_number(value):
    try:
        return bool(np.isfinite(float(value)))
    except (TypeError, ValueError):
        return False


def _candidate_from_syllable(syllable):
    start = float(syllable.get('startTime', 0) or 0)
    end = float(syllable.get('endTime', start) or start)
    duration = max(0.0, end - start)
    pitch_value = syllable.get('avgPitch') or syllable.get('maxPitch') or 0
    intensity_value = syllable.get('intensity')
    voiced = _finite_number(pitch_value) and float(pitch_value) > 0
    has_intensity = _finite_number(intensity_value)
    confidence = 0.0
    if voiced:
        confidence += 0.45
    if has_intensity and float(intensity_value) > 0:
        confidence += 0.20
    if 0.05 <= duration <= 0.65:
        confidence += 0.20
    vowel_duration = syllable.get('vowelDuration')
    if _finite_number(vowel_duration) and float(vowel_duration) >= 0.03:
        confidence += 0.15
    return {
        'time': round((start + end) / 2.0, 4),
        'intensity': float(intensity_value) if has_intensity else None,
        'confidence': round(min(1.0, confidence), 3),
        'voiced': voiced,
        'syllable': dict(syllable),
    }


def _target_aligned_duration_segmentation(candidates, target_count, method):
    """Keep measured duration regions even when an individual region lacks F0."""
    candidates = list(candidates or [])
    if (
        not isinstance(target_count, int)
        or target_count < 1
        or len(candidates) != target_count
    ):
        return None

    for candidate in candidates:
        syllable = candidate.get('syllable') or {}
        start = syllable.get('startTime')
        end = syllable.get('endTime')
        if (
            not _finite_number(candidate.get('time'))
            or not _finite_number(candidate.get('intensity'))
            or not _finite_number(start)
            or not _finite_number(end)
            or float(end) <= float(start)
        ):
            return None

    return {
        'rawCandidateCount': len(candidates),
        'evidenceCandidateCount': sum(
            1 for candidate in candidates if candidate.get('voiced') is True
        ),
        'selectedCount': len(candidates),
        'method': method,
        'confidence': round(
            float(np.mean([
                float(candidate.get('confidence', 0) or 0)
                for candidate in candidates
            ])),
            3,
        ),
        'conflicts': [],
        'selected': candidates,
    }


def select_native_acoustic_candidates(candidates, target_count, noise_threshold=0.45):
    """Select only acoustically supported nuclei; never synthesize a candidate."""
    raw_candidates = list(candidates or [])
    evidence = [
        candidate for candidate in raw_candidates
        if candidate.get('voiced') is True
        and _finite_number(candidate.get('time'))
        and _finite_number(candidate.get('intensity'))
    ]
    result = {
        'rawCandidateCount': len(raw_candidates),
        'evidenceCandidateCount': len(evidence),
        'selectedCount': 0,
        'method': 'acoustic-candidate-selection',
        'confidence': 0.0,
        'conflicts': [],
        'selected': [],
    }
    if not isinstance(target_count, int) or target_count < 1:
        result['method'] = 'invalid-target-count'
        result['conflicts'] = ['ACOUSTIC_COUNT_MISMATCH']
        return result

    if len(evidence) < target_count:
        result['method'] = 'insufficient-acoustic-candidates'
        result['conflicts'] = ['ACOUSTIC_COUNT_MISMATCH']
        return result

    selected = list(evidence)
    if len(evidence) > target_count:
        ranked = sorted(
            evidence,
            key=lambda item: (
                float(item.get('confidence', 0) or 0),
                float(item.get('intensity', 0) or 0),
            ),
            reverse=True,
        )
        kept = ranked[:target_count]
        discarded = ranked[target_count:]
        quietest_kept = min(float(item['intensity']) for item in kept)
        discard_is_noise = all(
            float(item.get('confidence', 0) or 0) < noise_threshold
            and float(item['intensity']) <= quietest_kept - 3.0
            for item in discarded
        )
        if not discard_is_noise:
            result['method'] = 'unresolved-extra-candidates'
            result['conflicts'] = ['ACOUSTIC_COUNT_MISMATCH']
            return result
        selected = kept

    selected.sort(key=lambda item: float(item['time']))
    result['selected'] = selected
    result['selectedCount'] = len(selected)
    result['confidence'] = round(
        float(np.mean([float(item.get('confidence', 0) or 0) for item in selected])),
        3,
    )
    return result


def score_lexical_stress_v2(
    syllables,
    confidence_threshold=None,
    expected_primary_stress=None,
    pitch_reliability=1.0,
):
    """Score stress from within-recording relative pitch, duration, and intensity."""
    if confidence_threshold is None:
        confidence_threshold = AnalysisConfig.STRESS_CONFIDENCE_THRESHOLD
    syllables = list(syllables or [])
    if not syllables:
        result = {
            'primaryStress': None,
            'confidence': 0.0,
            'rateable': False,
            'reasons': ['NO_SPEECH'],
            'scores': [],
        }
        if expected_primary_stress is not None:
            result['referenceStress'] = {
                'expectedPrimaryStress': expected_primary_stress,
                'matches': False,
                'rateable': False,
                'confidence': 0.0,
                'reason': 'NO_SPEECH',
            }
        return result
    if len(syllables) == 1:
        result = {
            'primaryStress': 0,
            'confidence': 1.0,
            'rateable': True,
            'reasons': [],
            'scores': [1.0],
        }
        if expected_primary_stress is not None:
            expected = int(expected_primary_stress)
            result['referenceStress'] = {
                'expectedPrimaryStress': expected,
                'matches': expected == 0,
                'rateable': expected == 0,
                'confidence': 1.0 if expected == 0 else 0.0,
                'reason': None if expected == 0 else 'REFERENCE_STRESS_OUT_OF_RANGE',
            }
        return result

    pitches = np.array([
        float(item.get('avgPitch') or item.get('maxPitch') or 0)
        for item in syllables
    ], dtype=float)
    durations = np.array([
        float(item.get('vowelDuration') or item.get('duration') or 0)
        for item in syllables
    ], dtype=float)
    intensities = np.array([
        float(item.get('intensity') or 0)
        for item in syllables
    ], dtype=float)
    if np.any(pitches <= 0) or np.any(durations <= 0) or np.any(~np.isfinite(intensities)):
        result = {
            'primaryStress': None,
            'confidence': 0.0,
            'rateable': False,
            'reasons': ['INSUFFICIENT_STRESS_EVIDENCE'],
            'scores': [],
        }
        if expected_primary_stress is not None:
            result['referenceStress'] = {
                'expectedPrimaryStress': int(expected_primary_stress),
                'matches': False,
                'rateable': False,
                'confidence': 0.0,
                'reason': 'INSUFFICIENT_STRESS_EVIDENCE',
            }
        return result

    pitch_median = float(np.median(pitches))
    duration_median = float(np.median(durations))
    intensity_median = float(np.median(intensities))
    pitch_semitones = 12.0 * np.log2(pitches / pitch_median)
    duration_prominence = np.log2(durations / duration_median)
    intensity_prominence = intensities - intensity_median
    pitch_reliability = min(1.0, max(0.0, float(pitch_reliability)))
    scores = (
        pitch_semitones * AnalysisConfig.STRESS_WEIGHT_PITCH * pitch_reliability
        + duration_prominence * AnalysisConfig.STRESS_WEIGHT_DURATION
        + intensity_prominence * AnalysisConfig.STRESS_WEIGHT_INTENSITY
    )
    # Phrase-final lengthening is not lexical stress evidence.
    scores[-1] -= AnalysisConfig.STRESS_FINAL_LENGTHENING_PENALTY
    ranking = np.argsort(scores)[::-1]
    best_index = int(ranking[0])
    margin = float(scores[ranking[0]] - scores[ranking[1]])
    confidence = round(float(1.0 - np.exp(-max(0.0, margin) / 2.0)), 3)
    rateable = confidence >= confidence_threshold
    result = {
        'primaryStress': best_index if rateable else None,
        'confidence': confidence,
        'rateable': rateable,
        'reasons': [] if rateable else ['LOW_STRESS_CONFIDENCE'],
        'scores': [round(float(value), 4) for value in scores],
        'features': {
            'pitchSemitones': [round(float(value), 4) for value in pitch_semitones],
            'relativeDuration': [round(float(value), 4) for value in duration_prominence],
            'relativeIntensityDb': [round(float(value), 4) for value in intensity_prominence],
            'pitchReliability': round(pitch_reliability, 3),
        },
    }
    if expected_primary_stress is not None:
        expected = int(expected_primary_stress)
        reference = {
            'expectedPrimaryStress': expected,
            'matches': False,
            'rateable': False,
            'confidence': 0.0,
            'reason': None,
        }
        if 0 <= expected < len(scores):
            other_scores = np.delete(scores, expected)
            expected_margin = float(scores[expected] - np.max(other_scores)) if len(other_scores) else 0.0
            # Reference-conditioned verification asks a narrower question:
            # does the recording make the dictionary-stressed syllable more
            # prominent than every alternative?  A sigmoid calibration keeps
            # this confidence interpretable without turning a wrong argmax
            # into a passing result.
            expected_confidence = float(1.0 / (1.0 + np.exp(-2.0 * expected_margin)))
            reference.update({
                'matches': expected_margin >= 0.0,
                'rateable': expected_confidence >= confidence_threshold,
                'confidence': round(expected_confidence, 3),
                'margin': round(expected_margin, 4),
            })
            if not reference['rateable']:
                reference['reason'] = 'LOW_REFERENCE_STRESS_CONFIDENCE'
        else:
            reference['reason'] = 'REFERENCE_STRESS_OUT_OF_RANGE'
        result['referenceStress'] = reference
        if reference['matches'] and reference['rateable'] and result['primaryStress'] is None:
            result.update({
                'primaryStress': expected,
                'confidence': reference['confidence'],
                'rateable': True,
                'reasons': [],
                'decisionMode': 'reference-conditioned-acoustic-verification',
            })
    return result


def build_analysis_v2_response(
    raw_analysis,
    expected_syllable_count=None,
    native=False,
    reference_ipa=None,
    expected_primary_stress=None,
    audio_source_kind='dictionary',
):
    explicit_expected_primary_stress = expected_primary_stress is not None
    pitch_processing = None
    canonical_pitch = raw_analysis.get('pitch') or {'times': [], 'values': []}
    syllables = list(raw_analysis.get('syllables') or [])
    if native:
        pitch_processing = canonicalize_pitch_track(
            canonical_pitch.get('times') or [],
            canonical_pitch.get('values') or [],
        )
        canonical_pitch = {
            **canonical_pitch,
            'values': pitch_processing['values'],
            'rawValues': pitch_processing['rawValues'],
        }
        syllables = apply_canonical_pitch_to_syllables(
            syllables,
            canonical_pitch.get('times') or [],
            canonical_pitch.get('values') or [],
        )
    candidates = [_candidate_from_syllable(syllable) for syllable in syllables]
    if native:
        segmentation = select_native_acoustic_candidates(
            candidates,
            expected_syllable_count,
        )
        if (
            segmentation['method'] == 'insufficient-acoustic-candidates'
            and (
                aligned_segmentation := _target_aligned_duration_segmentation(
                    candidates,
                    expected_syllable_count,
                    'target-aligned-native-duration-regions',
                )
            ) is not None
        ):
            segmentation = aligned_segmentation
    else:
        segmentation = _target_aligned_duration_segmentation(
            candidates,
            expected_syllable_count,
            'target-aligned-acoustic-feedback',
        )
        if segmentation is None:
            evidence = [
                item for item in candidates
                if item['voiced'] and _finite_number(item['intensity'])
            ]
            segmentation = {
                'rawCandidateCount': len(candidates),
                'evidenceCandidateCount': len(evidence),
                'selectedCount': len(evidence),
                'method': (
                    'target-aligned-acoustic-feedback'
                    if expected_syllable_count
                    else 'independent-acoustic-detection'
                ),
                'confidence': round(
                    float(np.mean([item['confidence'] for item in evidence])),
                    3,
                ) if evidence else 0.0,
                'conflicts': [] if evidence else ['NO_SPEECH'],
                'selected': evidence,
            }

    selected_syllables = [item['syllable'] for item in segmentation['selected']]
    reasons = list(segmentation['conflicts'])
    parsed_primary_stress = None
    reference_count_conflict = False
    if reference_ipa:
        try:
            parsed_reference = parse_pronunciation(reference_ipa)
            reference_count_conflict = bool(
                expected_syllable_count
                and parsed_reference.phonological_count != expected_syllable_count
            )
            if parsed_reference.primary_stress is not None:
                parsed_primary_stress = parsed_reference.primary_stress
        except Exception:
            parsed_primary_stress = None
    if expected_primary_stress is None:
        expected_primary_stress = parsed_primary_stress
    stress = score_lexical_stress_v2(
        selected_syllables,
        expected_primary_stress=expected_primary_stress,
        pitch_reliability=(
            0.25
            if pitch_processing and pitch_processing.get('correctedRunCount', 0) > 0
            else 1.0
        ),
    )
    if reference_count_conflict and not explicit_expected_primary_stress and stress.get('referenceStress'):
        stress['referenceStress'].update({
            'matches': False,
            'rateable': False,
            'reason': 'REFERENCE_COUNT_CONFLICT',
        })
    # ``isStressed`` is a legacy display hint from the acoustic peak finder.
    # Never expose that hint as a lexical stress decision when the calibrated
    # V2 scorer cannot rate the evidence; otherwise the UI can show “strongest
    # detected” beside an explicit N/A stress decision.
    selected_syllables = [dict(item) for item in selected_syllables]
    for index, item in enumerate(selected_syllables):
        item['isStressed'] = bool(
            stress.get('rateable')
            and stress.get('primaryStress') is not None
            and index == int(stress['primaryStress'])
        )
    if pitch_processing and pitch_processing['status'] == 'unrateable':
        reasons.extend(reason for reason in pitch_processing['reasons'] if reason not in reasons)
    rateable = bool(selected_syllables) and not reasons
    primary_stress = stress['primaryStress']
    public_segmentation = {
        key: value
        for key, value in segmentation.items()
        if key != 'selected'
    }
    pitch_values = list(canonical_pitch.get('values') or [])
    intensity_values = list((raw_analysis.get('intensity') or {}).get('values') or [])
    has_native_contours = bool(
        native
        and any(_finite_number(value) and float(value) > 0 for value in pitch_values)
        and any(_finite_number(value) for value in intensity_values)
    )
    compatibility = {
        'version': 'reference-audio-compatibility-v1',
        'status': 'unrateable',
        'expectedPrimaryStress': expected_primary_stress,
        'observedPrimaryStress': primary_stress,
        'confidence': 0.0,
        'reasons': [],
    }
    reference_stress = stress.get('referenceStress')
    if pitch_processing and pitch_processing['status'] == 'unrateable':
        compatibility['reasons'] = list(pitch_processing['reasons'])
    elif reference_stress and reference_stress.get('matches'):
        compatibility.update({
            'status': 'compatible',
            'confidence': reference_stress.get('confidence', 0.0),
        })
    elif (
        expected_primary_stress is not None
        and stress.get('rateable')
        and primary_stress is not None
        and int(primary_stress) != int(expected_primary_stress)
    ):
        compatibility.update({
            'status': 'conflict',
            'confidence': stress.get('confidence', 0.0),
            'reasons': ['REFERENCE_STRESS_CONFLICT'],
        })
    elif reference_stress:
        compatibility['confidence'] = reference_stress.get('confidence', 0.0)
        compatibility['reasons'] = [reference_stress.get('reason') or 'REFERENCE_STRESS_UNCERTAIN']

    can_show_measured_graph = bool(
        has_native_contours
        and compatibility['status'] != 'conflict'
        and (not pitch_processing or pitch_processing['status'] != 'unrateable')
    )
    result = {
        'analysisVersion': 'pronunciation-analysis-v2',
        'canonicalPrimaryStress': expected_primary_stress,
        'quality': {
            'rateable': rateable,
            'confidence': segmentation['confidence'],
            'reasons': reasons,
        },
        'segmentation': public_segmentation,
        'observed': {
            'syllableCount': len(selected_syllables),
            'primaryStress': primary_stress,
            'syllables': selected_syllables,
            'stressEvidence': stress,
        },
        'pitch': canonical_pitch,
        'intensity': raw_analysis.get('intensity') or {'times': [], 'values': []},
        'duration': raw_analysis.get('duration', 0),
        'sampleRate': raw_analysis.get('sampleRate'),
        'capabilities': {
            'showNativeGraphs': can_show_measured_graph,
        },
    }
    if native:
        result['pitchProcessing'] = {
            key: value for key, value in pitch_processing.items()
            if key not in {'values', 'rawValues'}
        }
        result['audioCompatibility'] = compatibility
        result['graphSource'] = {
            'kind': 'measured-generated' if audio_source_kind == 'generated' else 'measured-dictionary',
            'label': 'Measured generated reference' if audio_source_kind == 'generated' else 'Measured dictionary reference',
            'measured': True,
            'version': PITCH_PROCESSING_VERSION,
        }
    return result


def analyze_audio_v2(
    audio_path,
    expected_syllable_count=None,
    native=False,
    reference_ipa=None,
    expected_primary_stress=None,
    audio_source_kind='dictionary',
):
    # Native references and learner attempts are aligned to the trusted target
    # count so every expected syllable receives measured acoustic feedback.
    if native:
        raw_analysis = analyze_audio(
            audio_path,
            expected_syllables=expected_syllable_count,
        )
    else:
        raw_analysis = analyze_audio(
            audio_path,
            expected_syllables=expected_syllable_count,
        )
    return build_analysis_v2_response(
        raw_analysis,
        expected_syllable_count=expected_syllable_count,
        native=native,
        reference_ipa=reference_ipa,
        expected_primary_stress=expected_primary_stress,
        audio_source_kind=audio_source_kind,
    )


@app.route('/analyze/v2', methods=['POST'])
def analyze_v2():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    audio_file = request.files['audio']
    expected_syllable_count = request.form.get('expected_syllables', type=int)
    reference_ipa = request.form.get('reference_ipa')
    if not expected_syllable_count or not 1 <= expected_syllable_count <= 20:
        expected_syllable_count = None
    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name
    try:
        result = analyze_audio_v2(
            tmp_path,
            expected_syllable_count=expected_syllable_count,
            native=False,
            reference_ipa=reference_ipa,
        )
        return jsonify(result)
    except Exception as error:
        print(f'Learner analysis v2 error: {error}')
        return jsonify({
            'error': 'Learner pronunciation analysis unavailable',
            'code': 'ANALYSIS_FAILED',
        }), 500
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.route('/analyze-url/v2', methods=['POST'])
def analyze_from_url_v2():
    data = request.get_json(silent=True) or {}
    audio_url = str(data.get('audioUrl') or '').strip()
    variant_id = str(data.get('variantId') or '').strip()
    expected_count = data.get('expectedSyllableCount')
    reference_ipa = str(data.get('referenceIpa') or '').strip() or None
    expected_primary_stress = data.get('referencePrimaryStress')
    audio_source_kind = str(data.get('audioSourceKind') or 'dictionary').strip()
    if not audio_url.startswith('https://media.merriam-webster.com/'):
        return jsonify({'error': 'Invalid audio URL'}), 400
    if not re.fullmatch(r'[0-9a-f]{16}', variant_id):
        return jsonify({'error': 'Valid variantId is required'}), 400
    if not isinstance(expected_count, int) or expected_count < 1:
        return jsonify({'error': 'Valid expectedSyllableCount is required'}), 400
    if expected_primary_stress is not None and (
        not isinstance(expected_primary_stress, int)
        or expected_primary_stress < 0
        or expected_primary_stress >= expected_count
    ):
        return jsonify({'error': 'Valid referencePrimaryStress is required'}), 400
    if audio_source_kind not in {'dictionary', 'generated'}:
        return jsonify({'error': 'Valid audioSourceKind is required'}), 400

    try:
        response = http_requests.get(audio_url, timeout=15)
        if not response.ok:
            return jsonify({'error': 'Failed to fetch native audio'}), response.status_code
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name
        try:
            result = analyze_audio_v2(
                tmp_path,
                expected_syllable_count=expected_count,
                native=True,
                reference_ipa=reference_ipa,
                expected_primary_stress=expected_primary_stress,
                audio_source_kind=audio_source_kind,
            )
            result['variantId'] = variant_id
            result['canonicalSyllableCount'] = expected_count
            result['audioContentHash'] = hashlib.sha256(response.content).hexdigest()
            return jsonify(result)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    except Exception as error:
        print(f'Analyze URL v2 error: {error}')
        return jsonify({
            'error': 'Native pronunciation analysis unavailable',
            'code': 'ANALYSIS_FAILED',
        }), 500


@app.route('/analyze-reference/v2', methods=['POST'])
def analyze_generated_reference_v2():
    if 'audio' not in request.files:
        return jsonify({'error': 'Generated reference audio is required'}), 400
    variant_id = str(request.form.get('variantId') or '').strip()
    expected_count = request.form.get('expectedSyllableCount', type=int)
    reference_ipa = str(request.form.get('referenceIpa') or '').strip()
    expected_primary_stress = request.form.get('referencePrimaryStress', type=int)
    try:
        reference_syllables = json.loads(str(request.form.get('referenceSyllables') or '[]'))
    except Exception:
        reference_syllables = None
    if not re.fullmatch(r'[0-9a-f]{16}', variant_id):
        return jsonify({'error': 'Valid variantId is required'}), 400
    if not isinstance(expected_count, int) or expected_count < 1:
        return jsonify({'error': 'Valid expectedSyllableCount is required'}), 400
    if not reference_ipa:
        return jsonify({'error': 'Valid referenceIpa is required'}), 400
    if not isinstance(expected_primary_stress, int) or not 0 <= expected_primary_stress < expected_count:
        return jsonify({'error': 'Valid referencePrimaryStress is required'}), 400
    if not isinstance(reference_syllables, list) or len(reference_syllables) != expected_count:
        return jsonify({'error': 'Valid referenceSyllables are required'}), 400

    audio_file = request.files['audio']
    suffix = '.mp3' if str(audio_file.filename or '').lower().endswith('.mp3') else '.wav'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name
    try:
        result = analyze_audio_v2(
            tmp_path,
            expected_syllable_count=expected_count,
            native=True,
            reference_ipa=reference_ipa,
            expected_primary_stress=expected_primary_stress,
            audio_source_kind='generated',
        )
        result['variantId'] = variant_id
        result['canonicalSyllableCount'] = expected_count
        with open(tmp_path, 'rb') as generated_audio:
            result['audioContentHash'] = hashlib.sha256(generated_audio.read()).hexdigest()
        return jsonify(result)
    except Exception as error:
        print(f'Generated reference analysis error: {error}')
        return jsonify({'error': 'Generated pronunciation analysis unavailable', 'code': 'ANALYSIS_FAILED'}), 500
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

# ============================================
# V3 PRONUNCIATION ANALYSIS ENDPOINT
# ============================================

# Must stay above phoneme_client._RECOGNIZER_HTTP_TIMEOUT_SEC so a genuine HTTP
# read timeout surfaces as TIMEOUT from the client instead of being pre-empted
# here as an opaque future cancellation. See
# docs/plans/2026-08-03-v3-recognizer-cold-start-no-cost-plan.md.
_V3_HARD_TIMEOUT_SECONDS = 80

_IPA_IGNORED_MARKS = frozenset('/[]ˈˌ.·| ‿')
_IPA_MULTI_SYMBOL_UNITS = tuple(sorted({
    'tʃ', 'dʒ', 'aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ',
    'ɪə', 'ɛə', 'ʊə', 'ɝ', 'ɚ',
    'ɑr', 'ɔr', 'ɛr', 'ɪr', 'ʊr', 'ər',
    'l̩', 'm̩', 'n̩', 'ŋ̩',
}, key=len, reverse=True))


def _tokenize_reference_ipa(reference_ipa):
    """Tokenize display IPA into phoneme units for edit alignment."""
    normalized = unicodedata.normalize('NFC', str(reference_ipa or ''))
    tokens = []
    index = 0
    while index < len(normalized):
        char = normalized[index]
        if char in _IPA_IGNORED_MARKS or char.isspace():
            index += 1
            continue
        matched = next(
            (unit for unit in _IPA_MULTI_SYMBOL_UNITS if normalized.startswith(unit, index)),
            None,
        )
        if matched:
            tokens.append(matched)
            index += len(matched)
            continue
        if char in ('ː', 'ˑ') and tokens:
            tokens[-1] += char
        else:
            tokens.append(char)
        index += 1
    return tokens


def _phoneme_align_edit_ops(reference_phonemes, observed_phonemes):
    """Compute edit operations between reference and observed phoneme lists.

    Uses Needleman-Wunsch (global alignment) with tie-breaking order:
    match > substitution > deletion > insertion.

    Returns a list of dicts with keys: op, ref, obs.
    """
    ref = list(reference_phonemes or [])
    obs = list(observed_phonemes or [])
    n, m = len(ref), len(obs)

    MATCH_SCORE = 1
    MISMATCH_SCORE = -1
    GAP_SCORE = -2

    # Build DP table
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + GAP_SCORE
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + GAP_SCORE

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref[i - 1] == obs[j - 1]:
                diag = dp[i - 1][j - 1] + MATCH_SCORE
            else:
                diag = dp[i - 1][j - 1] + MISMATCH_SCORE
            up = dp[i - 1][j] + GAP_SCORE      # deletion
            left = dp[i][j - 1] + GAP_SCORE     # insertion
            dp[i][j] = max(diag, up, left)

    # Traceback with tie-breaking: match > substitution > deletion > insertion
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0:
            if ref[i - 1] == obs[j - 1]:
                diag = dp[i - 1][j - 1] + MATCH_SCORE
            else:
                diag = dp[i - 1][j - 1] + MISMATCH_SCORE
            up = dp[i - 1][j] + GAP_SCORE if i > 0 else float('-inf')
            left = dp[i][j - 1] + GAP_SCORE if j > 0 else float('-inf')

            current = dp[i][j]
            # Tie-breaking: prefer match/substitution (diagonal), then deletion, then insertion
            if current == diag:
                if ref[i - 1] == obs[j - 1]:
                    ops.append({'op': 'match', 'ref': ref[i - 1], 'obs': obs[j - 1]})
                else:
                    ops.append({'op': 'substitution', 'ref': ref[i - 1], 'obs': obs[j - 1]})
                i -= 1
                j -= 1
            elif i > 0 and current == up:
                ops.append({'op': 'deletion', 'ref': ref[i - 1], 'obs': None})
                i -= 1
            else:
                ops.append({'op': 'insertion', 'ref': None, 'obs': obs[j - 1]})
                j -= 1
        elif i > 0:
            ops.append({'op': 'deletion', 'ref': ref[i - 1], 'obs': None})
            i -= 1
        else:
            ops.append({'op': 'insertion', 'ref': None, 'obs': obs[j - 1]})
            j -= 1

    ops.reverse()
    return ops


def _build_v3_comparison(reference_ipa, observed_phonemes, observed_syllable_count, expected_syllables):
    """Build the comparison block for v3 response when reference_ipa is provided.

    ``edit_operations`` is None — not an empty list, and never an all-deletion
    script — when nothing was decoded. Aligning the reference against an empty
    observation yields one deletion per reference phoneme, which reads as "the
    learner said nothing"; that is an artifact of a missing decode, not
    evidence about the recording.
    """
    if not reference_ipa:
        return None
    count_delta = observed_syllable_count - (expected_syllables or 0) if expected_syllables else None
    if not observed_phonemes:
        return {
            'count_delta': count_delta,
            'edit_operations': None,
        }
    ref_phonemes = (
        _tokenize_reference_ipa(reference_ipa)
        if isinstance(reference_ipa, str)
        else list(reference_ipa or [])
    )
    return {
        'count_delta': count_delta,
        'edit_operations': _phoneme_align_edit_ops(ref_phonemes, observed_phonemes),
    }


def _unavailable_v3_best_effort():
    """Return the advisory-only shape used when no reliable observation exists."""
    return {
        'available': False,
        'observed_count': None,
        'expected_stress_appears_strongest': None,
        'advisory_only': True,
    }


def _adapt_v2_to_v3_response(v2_result, mode, reference_ipa=None, expected_syllables=None):
    """Convert a v2 analysis result into v3 response shape."""
    quality = v2_result.get('quality', {})
    observed = v2_result.get('observed', {})
    syllables = observed.get('syllables', [])
    syllable_count = observed.get('syllableCount', 0)

    comparison = _build_v3_comparison(
        reference_ipa, [], syllable_count, expected_syllables,
    )

    return {
        'analysisVersion': 'pronunciation-analysis-v3',
        'mode': mode,
        'engine': 'praat-v2',
        'is_rateable': quality.get('rateable', False),
        'confidence': quality.get('confidence', 0.0),
        'quality_reason': quality.get('reasons', [None])[0] if quality.get('reasons') else None,
        'degraded': mode == 'active',
        'observed_phonemes': [],
        'observed_syllables': [{
            'startTime': s.get('startTime', s.get('start', 0)),
            'endTime': s.get('endTime', s.get('end', 0)),
            'duration': s.get('duration', 0),
        } for s in syllables],
        'syllable_count': syllable_count,
        'comparison': comparison,
        'reference_stress': (v2_result.get('observed', {}).get('stressEvidence', {}).get('referenceStress')
                             if isinstance(v2_result.get('observed', {}).get('stressEvidence'), dict)
                             else None),
        'pitch': v2_result.get('pitch', {'times': [], 'values': []}),
        'intensity': v2_result.get('intensity', {'times': [], 'values': []}),
        'total_duration': v2_result.get('duration', 0),
        'sample_rate': v2_result.get('sampleRate'),
        'capabilities': {
            'graphs': True,
            'syllable_duration': True,
            'phoneme_alignment': False,
        },
        'verification': {
            'status': 'unrateable',
            'count': {'expected': expected_syllables, 'observed': syllable_count, 'status': 'unrateable', 'confidence': 0.0, 'reasons': ['V3_NOT_ACTIVE']},
            'primary_stress': {'applicable': bool(expected_syllables and expected_syllables > 1), 'expected': None, 'matches_expected': None, 'status': 'unrateable', 'confidence': 0.0, 'pitch_evidence': [], 'reasons': ['V3_NOT_ACTIVE']},
            'model_revision': None,
        },
        'best_effort': _unavailable_v3_best_effort(),
    }


def _refine_partition_boundaries_with_acoustic_tail(spans, intensity):
    """Move only wide-gap midpoints that demonstrably split a late vowel tail.

    CTC blank gaps are normally partitioned at their midpoint. In a wide gap,
    however, the preceding vowel can continue beyond its raw aligned token.
    When that vowel reaches its acoustic peak inside the gap, keep its decaying
    tail with the preceding syllable until intensity falls 8 dB below the peak
    measured in the preceding raw span. The correction is capped at 50 ms and
    never changes raw CTC or measurement intervals.
    """
    if not isinstance(spans, list) or len(spans) < 2 or not isinstance(intensity, dict):
        return False
    times = intensity.get('times')
    values = intensity.get('values')
    if not isinstance(times, list) or not isinstance(values, list) or len(times) != len(values):
        return False
    contour = []
    for time_value, intensity_value in zip(times, values):
        try:
            time_number = float(time_value)
            intensity_number = float(intensity_value)
        except (TypeError, ValueError):
            continue
        if np.isfinite(time_number) and np.isfinite(intensity_number):
            contour.append((time_number, intensity_number))
    if not contour:
        return False

    def span_time(span, snake_key, camel_key, fallback=None):
        value = span.get(snake_key, span.get(camel_key, fallback))
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    changed = False
    for index in range(len(spans) - 1):
        current = spans[index]
        following = spans[index + 1]
        raw_start = span_time(current, 'start_time', 'startTime')
        gap_start = span_time(current, 'end_time', 'endTime')
        gap_end = span_time(following, 'start_time', 'startTime')
        boundary = span_time(current, 'partition_end_time', 'partitionEndTime')
        next_partition_end = span_time(
            following, 'partition_end_time', 'partitionEndTime', gap_end
        )
        if any(value is None for value in (
            raw_start, gap_start, gap_end, boundary, next_partition_end
        )):
            continue
        if gap_end - gap_start < 0.14:
            continue

        preceding_values = [
            value for time_value, value in contour
            if raw_start <= time_value <= gap_start
        ]
        gap_values = [
            (time_value, value) for time_value, value in contour
            if gap_start <= time_value <= gap_end
        ]
        if not preceding_values or not gap_values:
            continue
        peak_reference = max(preceding_values)
        gap_peak_time, _gap_peak_value = max(gap_values, key=lambda item: item[1])
        if gap_peak_time - gap_start < 0.02 or gap_peak_time > boundary:
            continue

        threshold = peak_reference - 8.0
        candidates = [
            time_value for time_value, value in gap_values
            if time_value >= boundary and value <= threshold
        ]
        if not candidates:
            continue
        candidate = min(candidates[0], boundary + 0.05, gap_end)
        candidate = min(candidate, next_partition_end - 0.000001)
        if candidate - boundary < 0.001:
            continue
        candidate = round(candidate, 6)
        current['partition_end_time'] = candidate
        following['partition_start_time'] = candidate
        changed = True
    return changed


def _refine_partition_boundaries_with_fricative_onset(
    spans,
    intensity,
    acoustic_syllables,
):
    """Use a corroborated acoustic boundary when CTC splits onset frication.

    Stop-to-fricative sequences can make a forced CTC token for the coda stop
    latch onto the rising frication.  A blank-gap midpoint then assigns the
    first part of the following fricative to the preceding syllable.  Shift
    only when the next authoritative syllable begins with a fricative, V2's
    acoustic boundary is materially earlier, and the intensity valley agrees.
    Raw CTC and measurement intervals remain unchanged.
    """
    if (
        not isinstance(spans, list)
        or len(spans) < 2
        or not isinstance(acoustic_syllables, list)
        or len(acoustic_syllables) != len(spans)
        or not isinstance(intensity, dict)
    ):
        return False
    times = intensity.get('times')
    values = intensity.get('values')
    if not isinstance(times, list) or not isinstance(values, list) or len(times) != len(values):
        return False
    contour = []
    for time_value, intensity_value in zip(times, values):
        try:
            time_number = float(time_value)
            intensity_number = float(intensity_value)
        except (TypeError, ValueError):
            continue
        if np.isfinite(time_number) and np.isfinite(intensity_number):
            contour.append((time_number, intensity_number))
    if not contour:
        return False

    fricative_onsets = ('s', 'z', 'ʃ', 'ʒ', 'f', 'v', 'θ', 'ð', 'h')

    def number(source, *keys):
        for key in keys:
            if isinstance(source, dict) and source.get(key) is not None:
                try:
                    return float(source[key])
                except (TypeError, ValueError):
                    return None
        return None

    changed = False
    for index in range(len(spans) - 1):
        current = spans[index]
        following = spans[index + 1]
        following_ipa = unicodedata.normalize('NFC', str(following.get('ipa') or ''))
        following_ipa = following_ipa.lstrip('/[.( ˈˌ')
        if not following_ipa.startswith(fricative_onsets):
            continue

        boundary = number(current, 'partition_end_time', 'partitionEndTime')
        next_partition_end = number(following, 'partition_end_time', 'partitionEndTime')
        acoustic_end = number(acoustic_syllables[index], 'endTime', 'end_time', 'end')
        acoustic_next_start = number(
            acoustic_syllables[index + 1], 'startTime', 'start_time', 'start'
        )
        current_nucleus_end = number(
            current, 'nucleus_end_time', 'nucleusEndTime', 'end_time', 'endTime'
        )
        following_raw_start = number(following, 'start_time', 'startTime')
        if any(value is None for value in (
            boundary,
            next_partition_end,
            acoustic_end,
            acoustic_next_start,
            current_nucleus_end,
            following_raw_start,
        )):
            continue

        acoustic_boundary = (acoustic_end + acoustic_next_start) / 2.0
        if boundary - acoustic_boundary < 0.05:
            continue
        valley_window = [
            item for item in contour
            if current_nucleus_end + 0.02 <= item[0] <= following_raw_start
        ]
        if len(valley_window) < 3:
            continue
        valley_time, valley_value = min(valley_window, key=lambda item: item[1])
        if abs(acoustic_boundary - valley_time) > 0.04:
            continue
        preceding_peak = max(
            (value for time_value, value in valley_window if time_value <= valley_time),
            default=valley_value,
        )
        following_peak = max(
            (value for time_value, value in valley_window if time_value >= valley_time),
            default=valley_value,
        )
        if preceding_peak - valley_value < 6.0 or following_peak - valley_value < 6.0:
            continue

        candidate = min(acoustic_boundary, next_partition_end - 0.000001)
        previous_partition_start = number(
            current, 'partition_start_time', 'partitionStartTime'
        )
        if previous_partition_start is None or candidate <= previous_partition_start:
            continue
        candidate = round(candidate, 6)
        current['partition_end_time'] = candidate
        following['partition_start_time'] = candidate
        changed = True
    return changed


def _refine_partition_boundaries_with_confidence_weighted_acoustic(
    spans,
    intensity,
    pitch,
    acoustic_syllables,
    total_duration,
):
    """Confidence-weighted acoustic correction for CTC partition boundaries.

    Addresses three systematic errors found in diagnostic review of manual
    annotations: late onset (+46ms avg), last-syllable truncation (-49ms avg),
    and position-dependent accuracy degradation.  Low-confidence syllables
    receive more acoustic correction; high-confidence syllables are untouched.
    Raw CTC and measurement intervals remain unchanged.
    """
    empty_result = {'changed': False, 'corrections': [], 'diagnostics': []}
    if not isinstance(spans, list) or len(spans) < 1:
        return empty_result

    def _validated_confidence(value):
        """Return a finite confidence in [0, 1], or None for unusable data."""
        if value is None or isinstance(value, (bool, str, bytes)):
            return None
        try:
            confidence = float(value)
        except (TypeError, ValueError, OverflowError):
            return None
        if not np.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            return None
        return confidence

    def _none_confidence_diagnostic(index, raw_confidence):
        reason = 'missing confidence' if raw_confidence is None else 'invalid confidence'
        return {
            'index': index,
            'correction_type': 'none',
            'confidence': 0.0,
            'blend_weight': 0.0,
            'shift_ms': 0.0,
            'reason': reason,
            'boundary': None,
            'old': None,
            'new': None,
            'signed_shift': 0.0,
            'signed_shift_ms': 0.0,
            'mutation': False,
        }

    def _unavailable_acoustic_result():
        """Retain explicit confidence diagnostics when acoustic data is absent."""
        return {
            'changed': False,
            'corrections': [
                _none_confidence_diagnostic(index, span.get('confidence'))
                for index, span in enumerate(spans)
                if isinstance(span, dict)
                and _validated_confidence(span.get('confidence')) is None
            ],
            'diagnostics': [],
        }

    if not isinstance(intensity, dict):
        return _unavailable_acoustic_result()

    i_times = intensity.get('times')
    i_values = intensity.get('values')
    if (
        not isinstance(i_times, list)
        or not isinstance(i_values, list)
        or len(i_times) != len(i_values)
    ):
        return _unavailable_acoustic_result()
    contour = []
    for t, v in zip(i_times, i_values):
        try:
            tf = float(t)
            vf = float(v)
        except (TypeError, ValueError):
            continue
        if np.isfinite(tf) and np.isfinite(vf):
            contour.append((tf, vf))
    if not contour:
        return _unavailable_acoustic_result()
    contour.sort(key=lambda item: item[0])

    pitch_contour = []
    if isinstance(pitch, dict):
        p_times = pitch.get('times') or []
        p_values = pitch.get('values') or []
        for t, v in zip(p_times, p_values):
            try:
                tf = float(t)
            except (TypeError, ValueError):
                continue
            if v is not None:
                try:
                    vf = float(v)
                except (TypeError, ValueError):
                    vf = None
            else:
                vf = None
            if np.isfinite(tf):
                pitch_contour.append((tf, vf))

    CONFIDENCE_HIGH = 0.55
    CONFIDENCE_LOW = 0.20
    POSITION_PENALTY = 0.05
    MAX_ONSET_SHIFT = 0.080
    MAX_FINAL_EXTENSION = 0.100
    ONSET_SEARCH_WINDOW = 0.080
    FINAL_SEARCH_WINDOW = 0.100
    INTENSITY_RISE_DB = 6.0
    VOICING_DECAY_DB = 12.0

    def _number(source, *keys):
        for key in keys:
            if isinstance(source, dict) and source.get(key) is not None:
                try:
                    return float(source[key])
                except (TypeError, ValueError):
                    return None
        return None

    def _nucleus_centre(span):
        ns = _number(span, 'nucleus_start_time', 'nucleusStartTime', 'start_time', 'startTime')
        ne = _number(span, 'nucleus_end_time', 'nucleusEndTime', 'end_time', 'endTime')
        if ns is not None and ne is not None:
            return (ns + ne) / 2.0
        return None

    def _blend_weight(confidence, index, count):
        position_ratio = index / max(1, count - 1) if count > 1 else 0.0
        effective = confidence - (position_ratio * POSITION_PENALTY)
        if effective >= CONFIDENCE_HIGH:
            return 0.0
        if effective <= CONFIDENCE_LOW:
            return 1.0
        return (CONFIDENCE_HIGH - effective) / (CONFIDENCE_HIGH - CONFIDENCE_LOW)

    def _align_praat_to_ctc(ctc_spans, praat_syls):
        anchors = [None] * len(ctc_spans)
        if not praat_syls:
            return anchors
        ctc_centres = [_nucleus_centre(s) for s in ctc_spans]
        used = set()
        for ci, cc in enumerate(ctc_centres):
            if cc is None:
                continue
            best_dist = 0.200
            best_pi = None
            for pi, ps in enumerate(praat_syls):
                if pi in used:
                    continue
                ps_start = _number(ps, 'startTime', 'start_time', 'start')
                ps_end = _number(ps, 'endTime', 'end_time', 'end')
                if ps_start is None or ps_end is None:
                    continue
                pc = (ps_start + ps_end) / 2.0
                dist = abs(cc - pc)
                if dist < best_dist:
                    best_dist = dist
                    best_pi = pi
            if best_pi is not None:
                anchors[ci] = praat_syls[best_pi]
                used.add(best_pi)
        return anchors

    def _find_intensity_onset(boundary, search_window, rise_db):
        window_start = boundary - search_window
        window = [(t, v) for t, v in contour if window_start <= t <= boundary]
        if len(window) < 3:
            return None
        valley_index = min(range(len(window)), key=lambda index: window[index][1])
        valley_time, valley_value = window[valley_index]
        # An onset is a rise *after* the intensity valley.  Looking for the
        # first frame above the window minimum can select a pre-valley frame
        # and shift a boundary into the preceding syllable.
        for t, v in window[valley_index + 1:]:
            if t > valley_time and v >= valley_value + rise_db:
                return t
        return None

    def _find_voicing_or_decay_end(boundary, search_window, decay_db, span_peak_db):
        window_end = boundary + search_window
        window = [(t, v) for t, v in contour if boundary <= t <= window_end]
        if not window:
            return None
        threshold = span_peak_db - decay_db
        voicing_end = None
        if pitch_contour:
            voiced_frames = [
                t for t, v in pitch_contour
                if boundary <= t <= window_end and v is not None and v > 0
            ]
            if voiced_frames:
                voicing_end = max(voiced_frames)
        decay_end = None
        for t, v in window:
            if v >= threshold:
                decay_end = t
        candidates = [c for c in (voicing_end, decay_end) if c is not None and c > boundary]
        if candidates:
            return max(candidates)
        return None

    praat_anchors = _align_praat_to_ctc(spans, acoustic_syllables)
    n = len(spans)
    changed = False
    corrections = []
    mutation_diagnostics = []

    for i in range(n):
        span = spans[i]
        correction_count_before = len(corrections)
        raw_confidence = span.get('confidence')
        confidence = _validated_confidence(raw_confidence)
        if confidence is None:
            corrections.append(_none_confidence_diagnostic(i, raw_confidence))
            continue
        w = _blend_weight(confidence, i, n)

        def append_correction(boundary, side, old_value, new_value, correction_type, reason):
            """Record exactly one diagnostic for one changed boundary."""
            signed_shift = new_value - old_value
            signed_shift_ms = round(signed_shift * 1000, 1)
            diagnostic = {
                # Legacy diagnostic keys retained for existing consumers.
                'index': i,
                'correction_type': correction_type,
                'confidence': round(confidence, 4),
                'blend_weight': round(w, 4),
                'shift_ms': signed_shift_ms,
                'reason': reason,
                # V4 boundary mutation provenance.
                'boundary': boundary,
                'side': side,
                'old': round(old_value, 6),
                'new': round(new_value, 6),
                'old_boundary': round(old_value, 6),
                'new_boundary': round(new_value, 6),
                'signed_shift': round(signed_shift, 6),
                'signed_shift_ms': signed_shift_ms,
                'mutation': True,
            }
            corrections.append(diagnostic)
            mutation_diagnostics.append(diagnostic)

        current_part_start = _number(span, 'partition_start_time', 'partitionStartTime')
        current_part_end = _number(span, 'partition_end_time', 'partitionEndTime')

        if current_part_start is None or current_part_end is None:
            continue

        # --- Onset correction (syllables after the first) ---
        if i > 0:
            prev_span = spans[i - 1]
            prev_nucleus_centre = _nucleus_centre(prev_span)
            acoustic_onset = _find_intensity_onset(
                current_part_start, ONSET_SEARCH_WINDOW, INTENSITY_RISE_DB,
            )
            praat_anchor = praat_anchors[i]
            if praat_anchor is not None:
                praat_start = _number(praat_anchor, 'startTime', 'start_time', 'start')
                if praat_start is not None and praat_start < current_part_start:
                    if acoustic_onset is not None:
                        # Keep the acoustic candidate post-valley.  A Praat
                        # anchor before the valley is not evidence for an
                        # onset shift into the preceding syllable.
                        acoustic_onset = max(acoustic_onset, praat_start)

            if acoustic_onset is not None and acoustic_onset < current_part_start:
                raw_shift = current_part_start - acoustic_onset
                capped_shift = min(raw_shift, MAX_ONSET_SHIFT)
                blended_shift = w * capped_shift
                corrected = current_part_start - blended_shift
                previous_partition_start = _number(
                    prev_span, 'partition_start_time', 'partitionStartTime',
                )
                lower_bound = max(
                    value + 0.001
                    for value in (
                        previous_partition_start if previous_partition_start is not None else 0.0,
                        prev_nucleus_centre if prev_nucleus_centre is not None else 0.0,
                    )
                )
                upper_bound = current_part_end - 0.001
                if upper_bound <= lower_bound:
                    corrected = current_part_start
                else:
                    corrected = min(upper_bound, max(lower_bound, corrected))
                actual_shift = current_part_start - corrected
                if actual_shift > 0.001:
                    old_boundary = current_part_start
                    corrected = round(corrected, 6)
                    span['partition_start_time'] = corrected
                    prev_span['partition_end_time'] = corrected
                    append_correction(
                        'partition_start_time', 'start', old_boundary, corrected, 'onset',
                        f'onset corrected by {-actual_shift * 1000:.1f}ms (w={w:.2f})',
                    )
                    changed = True

        # --- Final syllable extension (last syllable only) ---
        if i == n - 1:
            current_part_end = _number(span, 'partition_end_time', 'partitionEndTime')
            span_values = [v for t, v in contour
                          if current_part_start <= t <= current_part_end]
            span_peak = max(span_values) if span_values else 60.0
            acoustic_end = _find_voicing_or_decay_end(
                current_part_end, FINAL_SEARCH_WINDOW, VOICING_DECAY_DB, span_peak,
            )
            praat_anchor = praat_anchors[i]
            if praat_anchor is not None:
                praat_end = _number(praat_anchor, 'endTime', 'end_time', 'end')
                if praat_end is not None and praat_end > current_part_end:
                    if acoustic_end is not None:
                        acoustic_end = max(acoustic_end, praat_end)
                    else:
                        acoustic_end = praat_end

            if acoustic_end is not None and acoustic_end > current_part_end:
                raw_extension = acoustic_end - current_part_end
                capped_extension = min(raw_extension, MAX_FINAL_EXTENSION)
                blended_extension = w * capped_extension
                upper_bound = total_duration - 0.005 if total_duration > 0 else current_part_end
                corrected = min(current_part_end + blended_extension, upper_bound)
                actual_extension = corrected - current_part_end
                if actual_extension > 0.001 and corrected > current_part_start + 0.001:
                    old_boundary = current_part_end
                    corrected = round(corrected, 6)
                    span['partition_end_time'] = corrected
                    append_correction(
                        'partition_end_time', 'end', old_boundary, corrected, 'final_extension',
                        f'final syllable extended by {actual_extension * 1000:.1f}ms (w={w:.2f})',
                    )
                    changed = True

        # --- Interior boundary correction (when Praat anchors available for both sides) ---
        if 0 < i < n - 1:
            praat_curr = praat_anchors[i]
            praat_next = praat_anchors[i + 1]
            if praat_curr is not None and praat_next is not None:
                praat_curr_end = _number(praat_curr, 'endTime', 'end_time', 'end')
                praat_next_start = _number(praat_next, 'startTime', 'start_time', 'start')
                if praat_curr_end is not None and praat_next_start is not None:
                    acoustic_midpoint = (praat_curr_end + praat_next_start) / 2.0
                    current_boundary = _number(span, 'partition_end_time', 'partitionEndTime')
                    if current_boundary is not None and abs(acoustic_midpoint - current_boundary) > 0.005:
                        next_span = spans[i + 1]
                        next_confidence = _validated_confidence(next_span.get('confidence'))
                        next_w = (
                            _blend_weight(next_confidence, i + 1, n)
                            if next_confidence is not None else 0.0
                        )
                        effective_w = max(w, next_w)
                        if effective_w > 0:
                            shift = effective_w * (acoustic_midpoint - current_boundary)
                            corrected = current_boundary + shift
                            curr_nc = _nucleus_centre(span)
                            next_nc = _nucleus_centre(next_span)
                            current_partition_start = _number(
                                span, 'partition_start_time', 'partitionStartTime',
                            )
                            next_partition_end = _number(
                                next_span, 'partition_end_time', 'partitionEndTime',
                            )
                            lower_bound = (current_partition_start + 0.001) if current_partition_start is not None else None
                            upper_bound = (next_partition_end - 0.001) if next_partition_end is not None else None
                            if curr_nc is not None and next_nc is not None:
                                lower, upper = sorted((curr_nc, next_nc))
                                lower_bound = max(
                                    lower_bound if lower_bound is not None else lower + 0.001,
                                    lower + 0.001,
                                )
                                upper_bound = min(
                                    upper_bound if upper_bound is not None else upper,
                                    upper,
                                )
                            if lower_bound is not None and upper_bound is not None:
                                if upper_bound <= lower_bound:
                                    continue
                                corrected = min(upper_bound, max(lower_bound, corrected))
                            actual_shift = corrected - current_boundary
                            if abs(actual_shift) > 0.001:
                                old_boundary = current_boundary
                                corrected = round(corrected, 6)
                                span['partition_end_time'] = corrected
                                next_span['partition_start_time'] = corrected
                                append_correction(
                                    'partition_end_time', 'end', old_boundary, corrected, 'interior',
                                    f'interior boundary shifted by {actual_shift * 1000:.1f}ms (w={effective_w:.2f})',
                                )
                                changed = True

        if len(corrections) == correction_count_before:
            corrections.append({
                'index': i,
                'correction_type': 'none',
                'confidence': round(confidence, 4),
                'blend_weight': round(w, 4),
                'shift_ms': 0.0,
                'reason': 'no correction needed' if w > 0 else 'high confidence, no correction needed',
                'boundary': None,
                'old': None,
                'new': None,
                'signed_shift': 0.0,
                'signed_shift_ms': 0.0,
                'mutation': False,
            })

    return {
        'changed': changed,
        'corrections': corrections,
        'diagnostics': mutation_diagnostics,
    }


def _build_v3_active_response(
    praat_result,
    phoneme_result,
    reference_ipa=None,
    expected_syllables=None,
    *,
    include_partition_variants=False,
    allow_legacy_v4=False,
):
    """Build v3 response from phoneme recognition + Praat contours.

    Both recognizer contracts land here. ``recognize`` (v1) reports a free
    phoneme decode with its own ``confidence``; ``recognize-v2`` force-aligns
    the reference instead and reports confidence per aligned syllable. Reading
    the v1 keys directly made every v2 response claim 0.0 confidence and an
    empty decode, so the shared ``_recognizer_*`` readers are used instead.
    """
    phonemes = phoneme_result.get('phonemes', []) or []
    canonical_alignment = phoneme_result.get('canonical_alignment') or {}
    syllables_from_recognizer = phoneme_result.get('syllables', []) or canonical_alignment.get('syllables', [])
    confidence = _recognizer_confidence(phoneme_result)
    if confidence is None:
        confidence = 0.0
    is_rateable = _recognizer_is_rateable(phoneme_result)
    quality_reason = _recognizer_quality_reason(phoneme_result)
    syllable_count = _recognizer_syllable_count(phoneme_result)
    if syllable_count is None:
        syllable_count = len(syllables_from_recognizer)

    observed_phoneme_labels = [
        p.get('symbol') or p.get('label', '')
        for p in phonemes
    ]
    comparison = _build_v3_comparison(
        reference_ipa, observed_phoneme_labels, syllable_count, expected_syllables,
    )

    def _ensure_measurement_boundaries(spans):
        """Fill in measurement boundaries when the recognizer omits them.

        Splits inter-syllable gaps at the midpoint and extends each
        neighbouring syllable's measurement boundary into its half,
        mirroring the logic in stress_alignment._derive_measurement_spans.
        """
        if not spans or not isinstance(spans, list):
            return spans
        time_key = 'start_time' if 'start_time' in (spans[0] or {}) else 'startTime'
        end_key = 'end_time' if 'end_time' in (spans[0] or {}) else 'endTime'
        meas_start_key = 'measurement_start_time'
        meas_end_key = 'measurement_end_time'
        if any(s.get(meas_start_key) is not None or s.get(meas_end_key) is not None for s in spans):
            return spans
        for s in spans:
            s.setdefault(meas_start_key, s.get(time_key))
            s.setdefault(meas_end_key, s.get(end_key))
        for i in range(len(spans) - 1):
            gap_start = spans[i].get(end_key, 0)
            gap_end = spans[i + 1].get(time_key, 0)
            if gap_end > gap_start:
                mid = (gap_start + gap_end) / 2
                spans[i][meas_end_key] = mid
                spans[i + 1][meas_start_key] = mid
        return spans

    _ensure_measurement_boundaries(syllables_from_recognizer)

    partition_convention = 'ctc-interspan-midpoint-contiguous-v1'

    def _ensure_partition_boundaries(spans):
        """Add a contiguous display/playback partition beside raw CTC spans."""
        if not spans or not isinstance(spans, list):
            return spans
        if all(
            s.get('partition_start_time') is not None
            and s.get('partition_end_time') is not None
            for s in spans
        ):
            return spans

        def _span_time(span, snake_key, camel_key, fallback):
            value = span.get(snake_key, span.get(camel_key, fallback))
            return float(value)

        raw_starts = [
            _span_time(span, 'start_time', 'startTime', 0.0)
            for span in spans
        ]
        raw_ends = [
            _span_time(span, 'end_time', 'endTime', raw_starts[index])
            for index, span in enumerate(spans)
        ]
        total_duration = max(0.0, float(praat_result.get('duration') or raw_ends[-1]))
        outer_start = min(total_duration, max(0.0, raw_starts[0]))
        outer_end = min(total_duration, max(outer_start, raw_ends[-1]))
        boundaries = [outer_start]

        for index in range(len(spans) - 1):
            current = spans[index]
            following = spans[index + 1]
            candidate = (raw_ends[index] + raw_starts[index + 1]) / 2.0
            current_nucleus_start = _span_time(
                current, 'nucleus_start_time', 'nucleusStartTime', raw_starts[index]
            )
            current_nucleus_end = _span_time(
                current, 'nucleus_end_time', 'nucleusEndTime', raw_ends[index]
            )
            next_nucleus_start = _span_time(
                following, 'nucleus_start_time', 'nucleusStartTime', raw_starts[index + 1]
            )
            next_nucleus_end = _span_time(
                following, 'nucleus_end_time', 'nucleusEndTime', raw_ends[index + 1]
            )
            current_centre = (current_nucleus_start + current_nucleus_end) / 2.0
            next_centre = (next_nucleus_start + next_nucleus_end) / 2.0
            lower, upper = sorted((current_centre, next_centre))
            candidate = min(upper, max(lower, candidate))
            candidate = min(outer_end, max(boundaries[-1], candidate))
            boundaries.append(round(candidate, 6))

        boundaries.append(round(outer_end, 6))
        for index, span in enumerate(spans):
            span['partition_start_time'] = boundaries[index]
            span['partition_end_time'] = boundaries[index + 1]
        return spans

    _ensure_partition_boundaries(syllables_from_recognizer)
    acoustic_tail_refined = _refine_partition_boundaries_with_acoustic_tail(
        syllables_from_recognizer,
        praat_result.get('intensity'),
    )
    fricative_onset_refined = _refine_partition_boundaries_with_fricative_onset(
        syllables_from_recognizer,
        praat_result.get('intensity'),
        (praat_result.get('observed') or {}).get('syllables') or [],
    )
    partition_refined = acoustic_tail_refined or fricative_onset_refined

    def _snapshot_partition_spans(spans):
        """Capture the public contiguous partition before another refinement mutates it.

        The recognizer's raw CTC, nucleus, and measurement spans are kept in the
        original objects.  These small snapshots are intentionally limited to
        display partitions so the CRM comparison can show V3 and V4 as separate
        versions without duplicating or rewriting authoritative measurements.
        """
        if not isinstance(spans, list):
            return []
        snapshot = []
        for index, span in enumerate(spans):
            if not isinstance(span, dict):
                continue
            start = span.get('partition_start_time', span.get('partitionStartTime'))
            end = span.get('partition_end_time', span.get('partitionEndTime'))
            try:
                start = float(start)
                end = float(end)
            except (TypeError, ValueError):
                continue
            if not np.isfinite(start) or not np.isfinite(end) or end <= start:
                continue
            snapshot.append({
                'index': index,
                'startTime': round(start, 6),
                'endTime': round(end, 6),
                'duration': round(end - start, 6),
                'source': 'partition-snapshot'
            })
        return snapshot

    partition_variants = None
    if include_partition_variants:
        v3_partition_snapshot = _snapshot_partition_spans(syllables_from_recognizer)
        # V4 is comparison-only.  New recognizer responses provide the exact
        # reference-IPA syllabification and its CTC spans.  Keep that payload
        # separate from the frozen V3 partition and never mutate either one.
        remote_v4_alignment = phoneme_result.get('v4_alignment')

        def _snapshot_v4_alignment(alignment):
            if not isinstance(alignment, dict) or alignment.get('aligned') is not True:
                return []
            snapshots = []
            for index, source in enumerate(alignment.get('syllables') or []):
                if not isinstance(source, dict):
                    continue
                start = source.get('partitionStartTime', source.get('partition_start_time', source.get('startTime', source.get('start_time'))))
                end = source.get('partitionEndTime', source.get('partition_end_time', source.get('endTime', source.get('end_time'))))
                try:
                    start = float(start)
                    end = float(end)
                except (TypeError, ValueError):
                    continue
                if not np.isfinite(start) or not np.isfinite(end) or end <= start:
                    continue
                snapshots.append({
                    'index': index,
                    'syllableId': source.get('syllableId', source.get('syllable_id', f'v4-syllable-{index + 1}')),
                    'startTime': round(start, 6),
                    'endTime': round(end, 6),
                    # Keep the raw and partition timing keys available to the
                    # existing acoustic refiner. Raw CTC coverage remains
                    # immutable; only these V4 partition candidates may move.
                    'start_time': source.get('start_time', source.get('startTime', source.get('start'))),
                    'end_time': source.get('end_time', source.get('endTime', source.get('end'))),
                    'partition_start_time': round(start, 6),
                    'partition_end_time': round(end, 6),
                    'duration': round(end - start, 6),
                    'confidence': source.get('confidence'),
                    'nucleus_start_time': source.get('nucleus_start_time', source.get('nucleusStartTime')),
                    'nucleus_end_time': source.get('nucleus_end_time', source.get('nucleusEndTime')),
                    'ipa': source.get('ipa'),
                    'onset': source.get('onset', []),
                    'nucleus': source.get('nucleus'),
                    'coda': source.get('coda', []),
                    'stress': source.get('stress'),
                    # Structural provenance is copied alongside the timing
                    # span, while the complete immutable envelope remains in
                    # partitionVariants.v4Alignment.
                    'phoneIndexes': source.get('phoneIndexes', source.get('phone_indexes', [])),
                    'phoneOwnership': source.get('phoneOwnership', source.get('phone_ownership')),
                    'alignmentTokenRange': source.get('alignmentTokenRange', source.get('alignment_token_range')),
                    'timingSpanIndex': source.get('timingSpanIndex', source.get('timing_span_index', index)),
                    'rule': source.get('rule'),
                    'ambiguity': source.get('ambiguity'),
                    'source': 'v4_alignment',
                })
            return snapshots

        if isinstance(remote_v4_alignment, dict):
            v4_candidate_spans = _snapshot_v4_alignment(remote_v4_alignment)
            failure_code = remote_v4_alignment.get('failureCode') or remote_v4_alignment.get('failure_code')
            if remote_v4_alignment.get('aligned') is True and v4_candidate_spans:
                # A2 supplies canonical ownership and initial CTC timing. The
                # existing acoustic boundary refinement is applied only to
                # this copied V4 partition candidate, never to V3/raw spans.
                v4_result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
                    v4_candidate_spans,
                    praat_result.get('intensity'),
                    praat_result.get('pitch'),
                    (praat_result.get('observed') or {}).get('syllables') or [],
                    float(praat_result.get('duration') or 0),
                )
                for candidate in v4_candidate_spans:
                    candidate['startTime'] = round(float(candidate['partition_start_time']), 6)
                    candidate['endTime'] = round(float(candidate['partition_end_time']), 6)
                    candidate['duration'] = round(candidate['endTime'] - candidate['startTime'], 6)
                refined_alignment = dict(remote_v4_alignment)
                refined_syllables = []
                for index, source in enumerate(remote_v4_alignment.get('syllables') or []):
                    refined = dict(source) if isinstance(source, dict) else {}
                    if index < len(v4_candidate_spans):
                        candidate = v4_candidate_spans[index]
                        refined_start = candidate.get('partition_start_time')
                        refined_end = candidate.get('partition_end_time')
                        if refined_start is not None:
                            refined['partition_start_time'] = round(float(refined_start), 6)
                            refined['partitionStartTime'] = round(float(refined_start), 6)
                        if refined_end is not None:
                            refined['partition_end_time'] = round(float(refined_end), 6)
                            refined['partitionEndTime'] = round(float(refined_end), 6)
                    refined_syllables.append(refined)
                refined_alignment['syllables'] = refined_syllables
                remote_v4_alignment = refined_alignment
            else:
                v4_result = {
                    'diagnostics': [] if remote_v4_alignment.get('aligned') is True else [{
                        'code': remote_v4_alignment.get('reason', 'V4_ALIGNMENT_UNAVAILABLE'),
                        'failureCode': failure_code or remote_v4_alignment.get('reason', 'V4_ALIGNMENT_UNAVAILABLE'),
                    }],
                }
        elif allow_legacy_v4:
            # Compatibility for explicitly requested historical rendering.
            # New comparisons must carry the recognizer's reference-constrained
            # V4 alignment and never infer it from a V3 copy.
            v4_candidate_spans = [dict(span) for span in syllables_from_recognizer]
            v4_result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
                v4_candidate_spans,
                praat_result.get('intensity'),
                praat_result.get('pitch'),
                (praat_result.get('observed') or {}).get('syllables') or [],
                float(praat_result.get('duration') or 0),
            )
        else:
            v4_candidate_spans = []
            v4_result = {
                'diagnostics': [{'code': 'V4_ALIGNMENT_UNAVAILABLE'}],
            }
        partition_variants = {
            'schemaVersion': 'pronunciation-partition-variants-v2',
            'v3': v3_partition_snapshot,
            'v4': v4_candidate_spans if isinstance(remote_v4_alignment, dict) else _snapshot_partition_spans(v4_candidate_spans),
            'v4AnalysisVersion': (
                remote_v4_alignment.get('analysisVersion', 'pronunciation-analysis-v4.1')
                if isinstance(remote_v4_alignment, dict) else 'pronunciation-analysis-v4'
            ),
            'v4SyllabificationVersion': (
                remote_v4_alignment.get('syllabificationVersion')
                if isinstance(remote_v4_alignment, dict) else None
            ),
            'v4Diagnostics': (
                v4_result.get('diagnostics', v4_result.get('corrections', []))
                if isinstance(v4_result, dict) else []
            )
        }
        if isinstance(remote_v4_alignment, dict):
            partition_variants['v4Alignment'] = remote_v4_alignment
            timing_v42_flag = os.environ.get('PRONOUNCE_TIMING_V42', 'active').strip().lower()
            if remote_v4_alignment.get('aligned') is True and timing_v42_flag != 'off':
                try:
                    from backend.local_server.pronounce_v42 import build_pronounce_v42
                    sample_rate = int(praat_result.get('sampleRate') or 16000)
                    pcm_data = praat_result.get('raw_pcm')
                    if pcm_data is not None and len(pcm_data) > 0:
                        pcm_data = np.asarray(pcm_data, dtype=np.float32)
                        total_samples = len(pcm_data)
                    else:
                        duration_sec = float(praat_result.get('duration') or 0.0)
                        total_samples = max(1, int(round(duration_sec * sample_rate)))
                        pcm_data = np.zeros(total_samples, dtype=np.float32)

                    audio_identity = {
                        'sampleRateHz': sample_rate,
                        'sampleCount': total_samples,
                        'audioHash': hashlib.sha256(pcm_data.tobytes()).hexdigest(),
                        'channels': 1,
                        'pcmEncoding': 's16le',
                        'canonicalizationVersion': 'canonical-v1'
                    }
                    v42_res = build_pronounce_v42(
                        pcm=pcm_data,
                        audio=audio_identity,
                        reference={'text': reference_ipa or ''},
                        recognizer_result=phoneme_result,
                        v41_snapshot=remote_v4_alignment
                    )
                    partition_variants['timingVariants'] = {
                        'v42': {
                            'status': v42_res.get('status', 'available'),
                            'mode': timing_v42_flag,
                            'clockStatus': v42_res.get('clockStatus', 'TIME_MAPPING_UNVERIFIED'),
                            'analysis': v42_res.get('timing'),
                            'stress': v42_res.get('stress'),
                            'boundaryDecisions': v42_res.get('boundaryDecisions', []),
                            'nucleusDecisions': v42_res.get('nucleusDecisions', [])
                        }
                    }
                except Exception as exc:
                    partition_variants['timingVariants'] = {
                        'v42': {
                            'status': 'unavailable',
                            'reason': f'V42_BUILD_FAILED: {str(exc)}'
                        }
                    }
        elif not allow_legacy_v4:
            partition_variants['v4AnalysisVersion'] = None
    if fricative_onset_refined:
        partition_convention = 'ctc-interspan-acoustic-hybrid-contiguous-v3'
    elif acoustic_tail_refined:
        partition_convention = 'ctc-interspan-acoustic-tail-contiguous-v2'

    def public_syllable_span(span):
        start_time = span.get('start_time', span.get('startTime', span.get('start', 0)))
        end_time = span.get('end_time', span.get('endTime', span.get('end', 0)))
        output = {
            'startTime': start_time,
            'endTime': end_time,
            'duration': span.get('duration', end_time - start_time),
            'confidence': span.get('confidence'),
            'nucleus': span.get('nucleus'),
        }
        for source, target in (
            ('nucleus_start_time', 'nucleusStartTime'),
            ('nucleus_end_time', 'nucleusEndTime'),
            ('measurement_start_time', 'measurementStartTime'),
            ('measurement_end_time', 'measurementEndTime'),
            ('partition_start_time', 'partitionStartTime'),
            ('partition_end_time', 'partitionEndTime'),
        ):
            if source in span and span[source] is not None:
                output[target] = span[source]
        if 'partitionStartTime' in output and 'partitionEndTime' in output:
            output['partitionDuration'] = round(
                output['partitionEndTime'] - output['partitionStartTime'], 6
            )
        return output

    response = {
        'analysisVersion': 'pronunciation-analysis-v3',
        'mode': 'active',
        'engine': 'ctc-praat',
        'is_rateable': is_rateable,
        'confidence': confidence,
        'quality_reason': quality_reason,
        'degraded': False,
        'observed_phonemes': phonemes,
        'observed_syllables': [public_syllable_span(s) for s in syllables_from_recognizer],
        'segmentation_source': 'ctc',
        'span_contract_version': canonical_alignment.get('span_contract_version'),
        'segmentation_convention': canonical_alignment.get('syllable_span_type'),
        'nucleus_convention': canonical_alignment.get('nucleus_span_type'),
        'measurement_convention': canonical_alignment.get('measurement_span_type'),
        'partition_convention': (
            partition_convention
            if partition_refined
            else (canonical_alignment.get('partition_span_type') or partition_convention)
        ) if syllables_from_recognizer else None,
        'syllable_count': syllable_count,
        'comparison': comparison,
        'reference_stress': (praat_result.get('observed', {}).get('stressEvidence', {}).get('referenceStress')
                             if isinstance(praat_result.get('observed', {}).get('stressEvidence'), dict)
                             else None),
        'pitch': praat_result.get('pitch', {'times': [], 'values': []}),
        'intensity': praat_result.get('intensity', {'times': [], 'values': []}),
        'total_duration': praat_result.get('duration', 0),
        'sample_rate': praat_result.get('sampleRate'),
        'capabilities': {
            'graphs': True,
            'syllable_duration': True,
            # Only a free phoneme decode supports a phoneme-level alignment.
            # recognize-v2 force-aligns the reference, so it has none to offer.
            'phoneme_alignment': bool(phonemes),
        },
    }
    if partition_variants is not None:
        response['partitionVariants'] = partition_variants
        if 'timingVariants' in partition_variants:
            response['timingVariants'] = partition_variants['timingVariants']
    return response


def _build_v2_comparison_envelope(v2_result, expected_syllables):
    """Build the comparison V2 view without rewriting its raw acoustic spans.

    V2's native acoustic nuclei can leave inter-nucleus gaps.  The study UI
    needs a contiguous timeline, so this comparison-only envelope adds a
    midpoint partition as ``observed_syllables`` while retaining the original
    ``observed.syllables`` and an explicit raw-span provenance record.
    """
    unavailable = {
        'status': 'unavailable',
        'reason': 'ANALYSIS_FAILED',
        'analysis': None,
    }
    if not isinstance(v2_result, dict):
        return unavailable
    if v2_result.get('analysisVersion') != 'pronunciation-analysis-v2':
        return {
            **unavailable,
            'reason': 'ANALYSIS_INVALID',
        }
    observed = v2_result.get('observed')
    raw_spans = observed.get('syllables') if isinstance(observed, dict) else None
    if not isinstance(raw_spans, list) or not raw_spans:
        return {
            **unavailable,
            'reason': 'ANALYSIS_SPANS_UNAVAILABLE',
        }
    if not isinstance(expected_syllables, int) or len(raw_spans) != expected_syllables:
        return {
            **unavailable,
            'reason': 'ANALYSIS_SYLLABLE_COUNT_MISMATCH',
        }

    parsed_spans = []
    for span in raw_spans:
        if not isinstance(span, dict):
            return {
                **unavailable,
                'reason': 'ANALYSIS_SPANS_INVALID',
            }
        try:
            start = float(span.get('startTime', span.get('start_time', span.get('start'))))
            end = float(span.get('endTime', span.get('end_time', span.get('end'))))
        except (TypeError, ValueError):
            return {
                **unavailable,
                'reason': 'ANALYSIS_SPANS_INVALID',
            }
        if not np.isfinite(start) or not np.isfinite(end) or end <= start:
            return {
                **unavailable,
                'reason': 'ANALYSIS_SPANS_INVALID',
            }
        parsed_spans.append((start, end))

    boundaries = [parsed_spans[0][0]]
    for index in range(len(parsed_spans) - 1):
        previous_start, previous_end = parsed_spans[index]
        next_start, next_end = parsed_spans[index + 1]
        candidate = (previous_end + next_start) / 2.0
        # Clamp to the already established left edge and the next raw end so
        # overlaps/gaps cannot create a non-monotonic or zero-width partition.
        candidate = min(next_end, max(boundaries[-1], candidate))
        if candidate <= boundaries[-1] or candidate >= next_end:
            return {
                **unavailable,
                'reason': 'ANALYSIS_SPANS_NONCONTIGUOUS',
            }
        boundaries.append(candidate)
    boundaries.append(parsed_spans[-1][1])

    raw_snapshot = [dict(span) for span in raw_spans]
    contiguous_spans = []
    for index, span in enumerate(raw_spans):
        contiguous = dict(span)
        contiguous['index'] = index
        contiguous['startTime'] = round(boundaries[index], 6)
        contiguous['endTime'] = round(boundaries[index + 1], 6)
        contiguous['duration'] = round(boundaries[index + 1] - boundaries[index], 6)
        contiguous['source'] = 'comparison-v2-partition'
        contiguous_spans.append(contiguous)

    analysis = dict(v2_result)
    analysis['observed_syllables'] = contiguous_spans
    analysis['syllable_count'] = len(contiguous_spans)
    analysis['partition_convention'] = 'acoustic-interspan-midpoint-contiguous-v1'
    analysis['provenance'] = {
        'source': 'observed.syllables',
        'variant': 'v2',
        'derivedSource': 'comparison.v2.midpoint-partition',
        'rawSpans': raw_snapshot,
    }
    return {
        'status': 'complete',
        'reason': None,
        'analysis': analysis,
    }


def _v4_alignment_contract_error(alignment, expected_syllables, partition_spans):
    """Return a stable reason when a remote V4.1 envelope is not trustworthy.

    The recognizer owns this structural envelope.  The local comparison layer
    may normalize/refine its copied timing candidate, but it must not promote a
    response with missing provenance or mismatched syllable ownership as a
    complete V4 analysis.
    """
    if not isinstance(alignment, dict) or alignment.get('aligned') is not True:
        return 'V4_ALIGNMENT_INVALID'
    if alignment.get('analysisVersion') != 'pronunciation-analysis-v4.1':
        return 'V4_ALIGNMENT_INVALID'
    if alignment.get('syllabificationVersion') != (
        'pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1'
    ):
        return 'V4_ALIGNMENT_INVALID'
    if alignment.get('ruleVersion') != alignment.get('syllabificationVersion'):
        return 'V4_ALIGNMENT_INVALID'
    if alignment.get('onsetInventoryVersion') != 'en-US-onsets-v1':
        return 'V4_ALIGNMENT_INVALID'
    if alignment.get('schemaVersion') != 'pronunciation-syllabification-v1':
        return 'V4_ALIGNMENT_INVALID'
    if not isinstance(expected_syllables, int) or expected_syllables < 1:
        return 'V4_REFERENCE_COUNT_MISMATCH'

    syllables = alignment.get('syllables')
    provenance = (
        alignment.get('v4Syllabification')
        or alignment.get('v4Provenance')
        or alignment.get('provenance')
    )
    if not isinstance(syllables, list) or len(syllables) != expected_syllables:
        return 'V4_REFERENCE_COUNT_MISMATCH'
    if alignment.get('syllable_count') != expected_syllables:
        return 'V4_REFERENCE_COUNT_MISMATCH'
    if (
        alignment.get('dialect') != 'en-US'
        or not isinstance(alignment.get('originalIpa'), str)
        or not isinstance(alignment.get('normalizedIpa'), str)
        or not alignment.get('originalIpa')
        or not alignment.get('normalizedIpa')
    ):
        return 'V4_ALIGNMENT_INVALID'
    if not isinstance(provenance, dict):
        return 'V4_ALIGNMENT_INVALID'
    if provenance.get('schemaVersion') != 'pronunciation-syllabification-v1':
        return 'V4_ALIGNMENT_INVALID'
    if provenance.get('analysisVersion') != 'pronunciation-analysis-v4.1':
        return 'V4_ALIGNMENT_INVALID'
    if provenance.get('ruleVersion') != (
        'pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1'
    ):
        return 'V4_ALIGNMENT_INVALID'
    if provenance.get('onsetInventoryVersion') != 'en-US-onsets-v1':
        return 'V4_ALIGNMENT_INVALID'
    if (
        not isinstance(provenance.get('rule'), dict)
        or not isinstance(provenance.get('ambiguity'), dict)
        or provenance.get('timingSpanContractVersion') != 'ctc-alignment-v2'
    ):
        return 'V4_ALIGNMENT_INVALID'
    content_hash = provenance.get('contentHash')
    if (
        not isinstance(content_hash, str)
        or not re.fullmatch(r'[a-f0-9]{64}', content_hash)
        or alignment.get('contentHash') != content_hash
    ):
        return 'V4_ALIGNMENT_INVALID'
    structural_fields = (
        'schemaVersion', 'analysisVersion', 'ruleVersion',
        'onsetInventoryVersion', 'dialect', 'originalIpa', 'normalizedIpa',
        'displayIpa', 'displaySyllabification', 'exactSyllabification',
        'rule', 'ambiguity', 'timingSpanContractVersion', 'syllables',
    )
    try:
        structural = {key: provenance[key] for key in structural_fields}
        expected_hash = hashlib.sha256(
            json.dumps(structural, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
        ).hexdigest()
    except (KeyError, TypeError, ValueError):
        return 'V4_ALIGNMENT_INVALID'
    if expected_hash != content_hash:
        return 'V4_ALIGNMENT_INVALID'
    provenance_syllables = provenance.get('syllables')
    if not isinstance(provenance_syllables, list) or len(provenance_syllables) != expected_syllables:
        return 'V4_ALIGNMENT_INVALID'

    def _value(item, camel, snake=None, default=None):
        if not isinstance(item, dict):
            return default
        if camel in item:
            return item[camel]
        if snake and snake in item:
            return item[snake]
        return default

    def _signature(item):
        return {
            'index': item.get('index'),
            'syllableId': _value(item, 'syllableId', 'syllable_id'),
            'ipa': item.get('ipa'),
            'onset': item.get('onset'),
            'nucleus': item.get('nucleus'),
            'coda': item.get('coda'),
            'stress': item.get('stress'),
            'phoneIndexes': _value(item, 'phoneIndexes', 'phone_indexes'),
            'phoneOwnership': _value(item, 'phoneOwnership', 'phone_ownership'),
            'alignmentTokenRange': _value(item, 'alignmentTokenRange', 'alignment_token_range'),
            'timingSpanIndex': _value(item, 'timingSpanIndex', 'timing_span_index'),
            'rule': item.get('rule'),
            'ambiguity': item.get('ambiguity'),
        }

    ids = set()
    previous_phone_end = 0
    expected_display = f"/{'.'.join(item['ipa'] for item in syllables)}/"
    for candidate in (alignment, provenance):
        if candidate.get('displaySyllabification') != expected_display:
            return 'V4_ALIGNMENT_INVALID'
        if candidate.get('exactSyllabification') != expected_display:
            return 'V4_ALIGNMENT_INVALID'
    for index, (item, structural) in enumerate(zip(syllables, provenance_syllables)):
        if not isinstance(item, dict) or not isinstance(structural, dict):
            return 'V4_ALIGNMENT_INVALID'
        signature = _signature(item)
        structural_signature = _signature(structural)
        if signature != structural_signature:
            return 'V4_ALIGNMENT_INVALID'
        if signature['index'] != index:
            return 'V4_ALIGNMENT_INVALID'
        syllable_id = signature['syllableId']
        if not isinstance(syllable_id, str) or not syllable_id or syllable_id in ids:
            return 'V4_ALIGNMENT_INVALID'
        ids.add(syllable_id)
        if not isinstance(signature['ipa'], str) or not signature['ipa']:
            return 'V4_ALIGNMENT_INVALID'
        if not isinstance(signature['onset'], list) or not isinstance(signature['coda'], list):
            return 'V4_ALIGNMENT_INVALID'
        if not isinstance(signature['nucleus'], str) or not signature['nucleus']:
            return 'V4_ALIGNMENT_INVALID'
        phone_indexes = signature['phoneIndexes']
        ownership = signature['phoneOwnership']
        token_range = signature['alignmentTokenRange']
        if (
            not isinstance(phone_indexes, list)
            or any(not isinstance(value, int) or isinstance(value, bool) for value in phone_indexes)
            or phone_indexes != list(range(previous_phone_end, previous_phone_end + len(phone_indexes)))
            or not isinstance(ownership, dict)
            or ownership.get('indexes') != phone_indexes
            or ownership.get('startIndex') != previous_phone_end
            or ownership.get('endIndex') != previous_phone_end + len(phone_indexes)
            or not isinstance(token_range, dict)
            or token_range.get('start') != previous_phone_end
            or token_range.get('end') != previous_phone_end + len(phone_indexes)
            or token_range.get('endExclusive') != previous_phone_end + len(phone_indexes)
            or signature['timingSpanIndex'] != index
        ):
            return 'V4_ALIGNMENT_INVALID'
        previous_phone_end += len(phone_indexes)

        if index >= len(partition_spans):
            return 'V4_ALIGNMENT_INVALID'
        span = partition_spans[index]
        start = _value(item, 'partitionStartTime', 'partition_start_time')
        end = _value(item, 'partitionEndTime', 'partition_end_time')
        try:
            if abs(float(start) - float(span['startTime'])) > 0.000001:
                return 'V4_ALIGNMENT_INVALID'
            if abs(float(end) - float(span['endTime'])) > 0.000001:
                return 'V4_ALIGNMENT_INVALID'
        except (TypeError, ValueError, KeyError):
            return 'V4_ALIGNMENT_INVALID'
    return None


def _build_v4_comparison_envelope(v3_envelope, expected_syllables):
    """Expose the comparison-only V4 partition as an independent envelope.

    V4 is a reference-IPA A2 grouping aligned from the same recognizer logits,
    with an optional acoustic refinement of its copied timing candidate. It is
    therefore complete only when the V3 response carries the versioned V4
    partition with the exact count and contiguous spans required by the study.
    Invalid or missing partition data stays explicitly unavailable instead of
    being represented as a plausible V4 analysis.
    """
    unavailable = {
        'status': 'unavailable',
        'reason': 'PARTITION_VARIANT_V4_UNAVAILABLE',
        'analysis': None,
    }
    if not isinstance(v3_envelope, dict):
        return {
            **unavailable,
            'reason': 'V3_ANALYSIS_UNAVAILABLE',
        }
    v3_analysis = v3_envelope.get('analysis')
    if (
        isinstance(v3_analysis, dict)
        and v3_analysis.get('analysisVersion') != 'pronunciation-analysis-v3'
    ):
        return {
            **unavailable,
            'reason': 'ANALYSIS_INVALID',
        }
    if v3_envelope.get('status') != 'complete':
        return {
            **unavailable,
            'reason': (
                'ANALYSIS_INVALID'
                if v3_envelope.get('reason') == 'ANALYSIS_INVALID'
                else 'V3_ANALYSIS_UNAVAILABLE'
            ),
        }
    if not isinstance(v3_analysis, dict):
        return unavailable
    partition_variants = v3_analysis.get('partitionVariants')
    if not isinstance(partition_variants, dict):
        return unavailable
    partition_schema = partition_variants.get('schemaVersion')
    if partition_schema != 'pronunciation-partition-variants-v2':
        return unavailable
    spans = partition_variants.get('v4')
    if not isinstance(spans, list) or not spans:
        diagnostics = partition_variants.get('v4Diagnostics')
        diagnostics = diagnostics if isinstance(diagnostics, list) else []
        failure_code = next((
            item.get('failureCode') or item.get('failure_code')
            for item in diagnostics
            if isinstance(item, dict) and (item.get('failureCode') or item.get('failure_code'))
        ), None)
        return {
            **unavailable,
            'failureCode': failure_code,
            'diagnostics': [dict(item) if isinstance(item, dict) else item for item in diagnostics],
        }
    if not isinstance(expected_syllables, int) or len(spans) != expected_syllables:
        return {
            **unavailable,
            'failureCode': 'V4_REFERENCE_COUNT_MISMATCH',
        }

    normalized_spans = []
    previous_end = None
    for index, span in enumerate(spans):
        if not isinstance(span, dict):
            return unavailable
        try:
            start = float(span.get('startTime', span.get('start_time', span.get('start'))))
            end = float(span.get('endTime', span.get('end_time', span.get('end'))))
        except (TypeError, ValueError):
            return unavailable
        if not np.isfinite(start) or not np.isfinite(end) or start < 0 or end <= start:
            return unavailable
        if previous_end is not None and abs(start - previous_end) > 0.000001:
            return unavailable
        normalized = dict(span)
        normalized['index'] = index
        normalized['startTime'] = round(start, 6)
        normalized['endTime'] = round(end, 6)
        normalized['duration'] = round(end - start, 6)
        normalized_spans.append(normalized)
        previous_end = end

    remote_v4_alignment = partition_variants.get('v4Alignment')
    if isinstance(remote_v4_alignment, dict):
        failure_code = _v4_alignment_contract_error(
            remote_v4_alignment,
            expected_syllables,
            normalized_spans,
        )
        if failure_code:
            return {
                **unavailable,
                'failureCode': failure_code,
            }
    elif partition_variants.get('v4AnalysisVersion') == 'pronunciation-analysis-v4.1':
        return {
            **unavailable,
            'failureCode': 'V4_ALIGNMENT_INVALID',
        }

    v4_diagnostics = partition_variants.get('v4Diagnostics')
    if not isinstance(v4_diagnostics, list):
        v4_diagnostics = []
    # Keep the diagnostic list immutable from the caller's perspective and
    # expose it under both the V4-specific and generic comparison names.
    diagnostics = [dict(item) if isinstance(item, dict) else item for item in v4_diagnostics]
    analysis = {
        'analysisVersion': partition_variants.get('v4AnalysisVersion') or 'pronunciation-analysis-v4',
        'mode': 'comparison',
        'engine': 'ctc-reference-v4.1' if partition_variants.get('v4Alignment') else 'ctc-praat-v4',
        'source': 'partitionVariants.v4',
        'provenance': {
            'source': 'partitionVariants.v4',
            'variant': 'v4',
            'schemaVersion': partition_schema,
            'parentAnalysisVersion': v3_analysis.get('analysisVersion'),
        },
        'partitionSchemaVersion': partition_schema,
        'observed_syllables': normalized_spans,
        'spans': normalized_spans,
        'syllable_count': len(normalized_spans),
        'total_duration': v3_analysis.get('total_duration', v3_analysis.get('duration')),
        'sample_rate': v3_analysis.get('sample_rate', v3_analysis.get('sampleRate')),
        'partition_convention': v3_analysis.get('partition_convention'),
        'diagnostics': diagnostics,
        'v4Diagnostics': diagnostics,
    }
    if partition_variants.get('v4SyllabificationVersion'):
        analysis['syllabificationVersion'] = partition_variants['v4SyllabificationVersion']
    if isinstance(partition_variants.get('v4Alignment'), dict):
        # Preserve the exact recognizer response as an additive provenance
        # record while exposing the normalized contiguous spans above.
        analysis['v4_alignment'] = partition_variants['v4Alignment']
        analysis['v4Syllabification'] = (
            partition_variants['v4Alignment'].get('v4Syllabification')
            or partition_variants['v4Alignment'].get('v4Provenance')
            or partition_variants['v4Alignment'].get('provenance')
        )
        analysis['v4Provenance'] = analysis['v4Syllabification']
    return {
        'status': 'complete',
        'reason': None,
        'analysis': analysis,
    }


def _v42_timing_contract_error(timing_envelope, expected_syllables):
    """Return a stable reason when a V4.2 timing envelope fails the contract."""
    if not isinstance(timing_envelope, dict):
        return 'V42_TIMING_INVALID'
    if timing_envelope.get('schemaVersion') != 'pronounce-timing-v2':
        return 'V42_SCHEMA_VERSION_INVALID'
    if timing_envelope.get('segmentationVersion') != 'bel-segmentation-v4.2':
        return 'V42_SEGMENTATION_VERSION_INVALID'
    syllables = timing_envelope.get('syllables')
    if not isinstance(syllables, list) or len(syllables) != expected_syllables:
        return 'V42_SYLLABLE_COUNT_MISMATCH'
    try:
        from backend.local_server.segment_contract import validate_timing_envelope
        validate_timing_envelope(timing_envelope)
    except Exception:
        return 'V42_TIMING_INVALID'
    return None


def _build_v42_comparison_envelope(v3_envelope, expected_syllables):
    """Expose V4.2 candidate timing as an independent comparison envelope."""
    unavailable = {
        'status': 'unavailable',
        'reason': 'PARTITION_VARIANT_V42_UNAVAILABLE',
        'analysis': None,
    }
    if not isinstance(v3_envelope, dict):
        return {**unavailable, 'reason': 'V3_ANALYSIS_UNAVAILABLE'}
    v3_analysis = v3_envelope.get('analysis')
    if not isinstance(v3_analysis, dict):
        return unavailable
    partition_variants = v3_analysis.get('partitionVariants')
    if not isinstance(partition_variants, dict):
        return unavailable
    timing_variants = partition_variants.get('timingVariants')
    if not isinstance(timing_variants, dict) or 'v42' not in timing_variants:
        return unavailable
    v42_data = timing_variants['v42']
    if not isinstance(v42_data, dict):
        return unavailable
    if v42_data.get('status') != 'available':
        return {
            'status': 'unavailable',
            'reason': v42_data.get('reason', 'V42_TIMING_UNAVAILABLE'),
            'clockStatus': v42_data.get('clockStatus'),
            'analysis': None
        }
    analysis = v42_data.get('analysis')
    contract_err = _v42_timing_contract_error(analysis, expected_syllables)
    if contract_err:
        return {
            'status': 'unavailable',
            'reason': contract_err,
            'clockStatus': v42_data.get('clockStatus'),
            'analysis': analysis
        }
    return {
        'status': 'complete',
        'reason': None,
        'clockStatus': v42_data.get('clockStatus'),
        'analysis': analysis,
        'boundaryDecisions': v42_data.get('boundaryDecisions', []),
        'nucleusDecisions': v42_data.get('nucleusDecisions', [])
    }


def _recognizer_syllable_count(phoneme_result):
    """Observed syllable count from either recognizer contract.

    ``recognize-v2`` reports ``decoded_syllable_count`` and puts spans under
    ``canonical_alignment.syllables``; only the legacy v1 shape has a
    top-level ``syllables`` list.
    """
    if not isinstance(phoneme_result, dict):
        return None
    decoded = phoneme_result.get('decoded_syllable_count')
    if isinstance(decoded, int) and not isinstance(decoded, bool):
        return decoded
    for spans in (
        phoneme_result.get('syllables'),
        (phoneme_result.get('canonical_alignment') or {}).get('syllables'),
    ):
        if isinstance(spans, list):
            return len(spans)
    return None


def _recognizer_confidence(phoneme_result):
    """Confidence metric from either contract.

    v2 reports per-syllable forced-alignment confidence in ``canonical_alignment``,
    so we return the mean forced-alignment confidence across syllables.
    v1 (legacy) reports top-level acoustic decoding confidence.
    """
    if not isinstance(phoneme_result, dict):
        return None
    value = phoneme_result.get('confidence')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    spans = (phoneme_result.get('canonical_alignment') or {}).get('syllables') or []
    values = [
        float(span.get('confidence'))
        for span in spans
        if isinstance(span, dict) and isinstance(span.get('confidence'), (int, float))
    ]
    return round(sum(values) / len(values), 6) if values else None


_RECOGNIZER_V2_CONTRACT = 'recognize-v2'
_RECOGNIZER_V2_FIELDS = frozenset({
    'decoded_syllable_count',
    'decoded_is_rateable',
    'canonical_alignment',
    'hypotheses',
})


def _recognizer_contract_kind(phoneme_result):
    """Classify a recognizer payload without accepting ambiguous shapes."""
    if not isinstance(phoneme_result, dict):
        return None
    contract_version = phoneme_result.get('contract_version')
    if contract_version == _RECOGNIZER_V2_CONTRACT:
        return _RECOGNIZER_V2_CONTRACT
    if contract_version in (None, 'recognize-v1'):
        if contract_version is None and _RECOGNIZER_V2_FIELDS.intersection(phoneme_result):
            return 'invalid'
        return 'recognize-v1'
    return 'invalid'


def _recognizer_is_rateable(phoneme_result):
    """Return rateability only when the active recognizer contract proves it.

    ``recognize`` (v1) reports ``is_rateable``; ``recognize-v2`` reports
    ``decoded_is_rateable``. A missing, invalid, or unknown contract must fail
    closed rather than treating a malformed recognizer response as rateable.
    """
    contract = _recognizer_contract_kind(phoneme_result)
    if contract == _RECOGNIZER_V2_CONTRACT:
        value = phoneme_result.get('decoded_is_rateable')
    elif contract == 'recognize-v1':
        value = phoneme_result.get('is_rateable')
    else:
        return False
    return value if isinstance(value, bool) else False


def _recognizer_quality_reason(phoneme_result):
    """Quality reason from either contract."""
    if not isinstance(phoneme_result, dict):
        return None
    reason = phoneme_result.get('quality_reason')
    if reason:
        return reason
    contract = _recognizer_contract_kind(phoneme_result)
    if contract == _RECOGNIZER_V2_CONTRACT:
        if phoneme_result.get('decoded_is_rateable') is False:
            return 'DECODED_UNRATEABLE'
        if not isinstance(phoneme_result.get('decoded_is_rateable'), bool):
            return 'RECOGNIZER_CONTRACT_INVALID'
    elif contract == 'invalid':
        return 'RECOGNIZER_CONTRACT_INVALID'
    return None


def _praat_display_spans(praat_result):
    """Untargeted Praat nuclei, usable for charts and playback only.

    In V3 the Praat pass runs without an expected syllable count, so these
    spans are an independent observation rather than a re-segmentation of the
    dictionary count. They are safe to draw, but they never carry a verdict:
    callers keep `syllable_count` unset and verification `unrateable`.
    """
    if not isinstance(praat_result, dict):
        return []
    spans = ((praat_result.get('observed') or {}).get('syllables')) or []
    display = []
    for span in spans:
        start = span.get('startTime', span.get('start'))
        end = span.get('endTime', span.get('end'))
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        if not (end > start):
            continue
        display.append({
            'startTime': float(start),
            'endTime': float(end),
            'duration': float(span.get('duration', end - start)),
            'confidence': None,
            'nucleus': None,
        })
    return display


def _build_v3_degraded_response(praat_result, reason, confidence=0.0):
    """Return contours without presenting a target-guided V2 learner count."""
    display_spans = _praat_display_spans(praat_result)
    return {
        'analysisVersion': 'pronunciation-analysis-v3',
        'mode': 'active',
        'engine': 'ctc-praat',
        'is_rateable': False,
        'confidence': confidence if isinstance(confidence, (int, float)) else 0.0,
        'quality_reason': reason or 'MODEL_INFERENCE_FAILED',
        'degraded': True,
        'observed_phonemes': [],
        # Display-only: charts and playback keep working while the recognizer
        # is unavailable. syllable_count stays None so no count is claimed.
        'observed_syllables': display_spans,
        'segmentation_source': 'praat-fallback' if display_spans else 'none',
        'syllable_count': None,
        'comparison': None,
        'pitch': praat_result.get('pitch', {'times': [], 'values': []}),
        'intensity': praat_result.get('intensity', {'times': [], 'values': []}),
        'total_duration': praat_result.get('duration', 0),
        'sample_rate': praat_result.get('sampleRate'),
        'capabilities': {
            'graphs': True,
            'syllable_duration': bool(display_spans),
            'phoneme_alignment': False,
        },
        'verification': {
            'status': 'unrateable',
            'count': {'expected': None, 'observed': None, 'status': 'unrateable', 'confidence': 0.0, 'reasons': [reason or 'MODEL_INFERENCE_FAILED']},
            'primary_stress': {'applicable': False, 'expected': None, 'matches_expected': None, 'status': 'unrateable', 'confidence': 0.0, 'pitch_evidence': [], 'reasons': [reason or 'MODEL_INFERENCE_FAILED']},
            'model_revision': None,
        },
        'best_effort': _unavailable_v3_best_effort(),
    }


def _derive_request_reference_id(target_word, reference_ipa, expected_syllables):
    payload = {
        'word': unicodedata.normalize('NFC', str(target_word or '').strip().lower()),
        'reference_ipa': unicodedata.normalize('NFC', str(reference_ipa or '').strip()),
        'expected_syllables': int(expected_syllables or 0),
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    ).hexdigest()[:16]


def _build_v3_verification(praat_result, phoneme_result, reference_ipa, expected_syllables, *, error_reason=None):
    """Combine independent count/alignment/acoustic evidence fail-closed."""
    unavailable = error_reason or None
    base = {
        'status': 'unrateable',
        'count': {'expected': expected_syllables, 'observed': None, 'status': 'unrateable', 'confidence': 0.0, 'reasons': []},
        'primary_stress': {'applicable': bool(expected_syllables and expected_syllables > 1), 'expected': None, 'matches_expected': None, 'status': 'unrateable', 'confidence': 0.0, 'pitch_evidence': [], 'reasons': []},
        'model_revision': phoneme_result.get('model_revision') if isinstance(phoneme_result, dict) else None,
    }
    if unavailable or not reference_ipa or not phoneme_result or phoneme_result.get('contract_version') != _RECOGNIZER_V2_CONTRACT:
        reason = unavailable or ('CONTRACT_MISMATCH' if phoneme_result and phoneme_result.get('contract_version') != _RECOGNIZER_V2_CONTRACT else 'MODEL_INFERENCE_FAILED')
        base['count']['reasons'] = [reason]
        base['primary_stress']['reasons'] = [reason]
        return base
    try:
        parsed = parse_pronunciation(reference_ipa)
    except Exception:
        base['count']['reasons'] = ['REFERENCE_CONFLICT']
        base['primary_stress']['reasons'] = ['REFERENCE_CONFLICT']
        return base
    if parsed.conflicts or parsed.phonological_count != expected_syllables or len(parsed.syllables) != expected_syllables:
        base['count']['reasons'] = ['REFERENCE_CONFLICT']
        base['primary_stress']['reasons'] = ['REFERENCE_CONFLICT']
        return base
    observed = phoneme_result.get('decoded_syllable_count')
    base['count']['observed'] = observed
    if not isinstance(observed, int) or not _recognizer_is_rateable(phoneme_result):
        base['count']['reasons'] = ['INDEPENDENT_COUNT_UNRATEABLE']
        base['primary_stress']['reasons'] = ['INDEPENDENT_COUNT_UNRATEABLE']
        return base

    try:
        from .pronunciation_verifier import (
            aligned_acoustic_features,
            count_feature_vector,
            evaluate_count_model,
            evaluate_model,
            evaluate_stress_ranker,
            load_artifact,
            stress_feature_vector,
        )
    except ImportError:
        from pronunciation_verifier import (  # type: ignore
            aligned_acoustic_features,
            count_feature_vector,
            evaluate_count_model,
            evaluate_model,
            evaluate_stress_ranker,
            load_artifact,
            stress_feature_vector,
        )
    artifact_path = os.environ.get('PRONUNCIATION_VERIFIER_ARTIFACT') or str(Path(__file__).parent / 'models' / 'pronunciation-verifier-v1.json')
    try:
        artifact = load_artifact(artifact_path)
    except Exception:
        base['count']['reasons'] = ['VERIFIER_ARTIFACT_UNAVAILABLE']
        base['primary_stress']['reasons'] = ['VERIFIER_ARTIFACT_UNAVAILABLE']
        return base

    expected_stress = parsed.primary_stress
    base['primary_stress']['expected'] = expected_stress
    acoustic = aligned_acoustic_features(praat_result, phoneme_result)
    stress_model = artifact.get('stress') or {}
    stress_disabled = stress_model.get('mode') == 'disabled'
    if stress_disabled:
        # Count-only release: stress is never scored, so it is not part of the
        # formal decision and must not hold an otherwise-verified count back.
        base['primary_stress'].update({
            'applicable': False,
            'status': 'unrateable',
            'confidence': 0.0,
            'matches_expected': None,
            'reasons': ['STRESS_SCORING_DISABLED'],
        })
    stress_features = [0.0] * len(stress_model.get('coefficients') or [])
    stress_evidence_ready = expected_syllables == 1
    if stress_disabled:
        stress_evidence_ready = False
    elif expected_syllables > 1:
        stress_evidence_ready = (
            expected_stress is not None
            and len(acoustic) == expected_syllables
            and all(float(row.get('voiced_confidence', 0.0)) > 0.0 for row in acoustic)
        )
        if stress_evidence_ready:
            # The expected index chooses which aligned nucleus to compare. Its
            # numeric position and the word identity are not model features.
            stress_features = stress_feature_vector(acoustic, expected_stress)
        else:
            base['primary_stress']['reasons'] = ['MISSING_STRESS_EVIDENCE']

    count_scored = evaluate_count_model(
        artifact,
        count_feature_vector(phoneme_result, expected_syllables),
    )
    scored = {'count': count_scored}
    if stress_model.get('mode') not in ('ranker', 'disabled'):
        scored['stress'] = evaluate_model(artifact, {
            'count': count_feature_vector(phoneme_result, expected_syllables),
            'stress': stress_features,
        })['stress']
    count_score = scored['count']
    base['count'].update({
        'status': count_score['status'],
        'confidence': count_score['confidence'],
        'reasons': [] if count_score['status'] == 'verified' else (
            ['COUNT_MISMATCH'] if count_score['status'] == 'incorrect' else ['COUNT_UNCERTAIN']
        ),
    })
    # The acoustic (Praat) pass runs untargeted in V3, so its count is a second
    # opinion on the recognizer's. When the two disagree neither is trusted.
    # `INDEPENDENT_` is already the recognizer's prefix here (see
    # INDEPENDENT_COUNT_UNRATEABLE above), so this one is named for the
    # acoustic side; and the disagreeing count is recorded, because a reason
    # citing evidence the payload does not contain reads as expected-vs-observed
    # and sends the reviewer chasing the wrong two numbers.
    praat_count = (praat_result.get('observed') or {}).get('syllableCount') if isinstance(praat_result, dict) else None
    if isinstance(praat_count, int) and not isinstance(praat_count, bool):
        base['count']['acoustic_observed'] = praat_count
        if praat_count != observed:
            base['count'].update({
                'status': 'unrateable',
                'confidence': 0.0,
                'reasons': ['ACOUSTIC_COUNT_DISAGREEMENT'],
            })
    base['model_revision'] = artifact.get('artifact_sha256')

    if stress_disabled:
        pass  # already marked not applicable above
    elif expected_syllables == 1:
        base['primary_stress'].update({
            'applicable': False,
            'status': 'unrateable',
            'confidence': 0.0,
            'reasons': [],
        })
    elif stress_evidence_ready and stress_model.get('mode') == 'ranker':
        stress_score = evaluate_stress_ranker(
            artifact['stress'],
            acoustic,
            expected_index=expected_stress,
        )
        base['primary_stress'].update({
            'status': stress_score['status'],
            'confidence': stress_score['confidence'],
            'matches_expected': True if stress_score['status'] == 'verified' else None,
            'pitch_evidence': [
                {'index': index, 'f0_median': row['f0_median']}
                for index, row in enumerate(acoustic)
                if row.get('f0_median') is not None and row.get('voiced_confidence', 0.0) > 0.0
            ],
            'reasons': [] if stress_score['status'] == 'verified' else [stress_score.get('reason') or 'STRESS_UNCERTAIN'],
        })
    elif stress_evidence_ready:
        stress_score = scored['stress']
        base['primary_stress'].update({
            'status': stress_score['status'],
            'confidence': stress_score['confidence'],
            'matches_expected': True if stress_score['status'] == 'verified' else (
                False if stress_score['status'] == 'incorrect' else None
            ),
            'pitch_evidence': [
                {'index': index, 'f0_median': row['f0_median']}
                for index, row in enumerate(acoustic)
                if row.get('f0_median') is not None and row.get('voiced_confidence', 0.0) > 0.0
            ],
            'reasons': [] if stress_score['status'] == 'verified' else (
                ['STRESS_MISMATCH'] if stress_score['status'] == 'incorrect' else ['STRESS_UNCERTAIN']
            ),
        })
    applicable = [base['count'], base['primary_stress']] if base['primary_stress'].get('applicable', True) else [base['count']]
    if any(component['status'] == 'incorrect' for component in applicable):
        base['status'] = 'incorrect'
    elif all(component['status'] == 'verified' for component in applicable):
        base['status'] = 'verified'
    return base


def _build_v3_best_effort(praat_result, phoneme_result, reference_ipa, expected_syllables):
    """Return advisory observations without changing formal verification."""
    result = {
        'available': False,
        'observed_count': None,
        'expected_stress_appears_strongest': None,
        'advisory_only': True,
    }
    if not _recognizer_is_rateable(phoneme_result):
        return result
    observed = _recognizer_syllable_count(phoneme_result)
    if not isinstance(observed, int) or isinstance(observed, bool):
        return result
    result['observed_count'] = observed
    if not reference_ipa or not isinstance(expected_syllables, int) or expected_syllables <= 1:
        result['available'] = True
        return result
    try:
        from .pronunciation_verifier import aligned_acoustic_features, evaluate_stress_ranker, load_artifact
        parsed = parse_pronunciation(reference_ipa)
        expected_stress = parsed.primary_stress
        if expected_stress is None:
            return result
        acoustic = aligned_acoustic_features(praat_result, phoneme_result)
        if len(acoustic) != expected_syllables:
            return result
        artifact_path = os.environ.get('PRONUNCIATION_VERIFIER_ARTIFACT') or str(Path(__file__).parent / 'models' / 'pronunciation-verifier-v1.json')
        artifact = load_artifact(artifact_path)
        if (artifact.get('stress') or {}).get('mode') != 'ranker':
            # Includes the count-only profile, where no stress claim exists.
            result['available'] = True
            return result
        stress = evaluate_stress_ranker(artifact['stress'], acoustic, expected_index=expected_stress)
        result['expected_stress_appears_strongest'] = stress.get('strongest_index') == expected_stress if stress.get('strongest_index') is not None else None
        result['available'] = True
    except Exception:
        return result
    return result


def run_v3_pipeline(
    tmp_path,
    *,
    wav_bytes=None,
    reference_ipa=None,
    reference_syllables=None,
    expected_syllables=None,
    target_word=None,
    variant_id=None,
):
    """Run the independent V3 recognizer and Praat work for one WAV.

    This helper deliberately has no Flask response behavior.  The legacy V3
    endpoint can keep its shadow/active response contract while the comparison
    endpoint can expose the same work as an independently labelled result.
    """
    start_time = time.time()
    request_reference_id = variant_id or _derive_request_reference_id(
        target_word,
        reference_ipa,
        expected_syllables,
    )
    if wav_bytes is None:
        with open(tmp_path, 'rb') as audio_handle:
            wav_bytes = audio_handle.read()

    try:
        from .phoneme_client import (
            ConfigurationError,
            REASON_RECOGNIZER_CONFIG_MISSING,
            create_phoneme_client,
        )
    except ImportError:
        from phoneme_client import (  # type: ignore
            ConfigurationError,
            REASON_RECOGNIZER_CONFIG_MISSING,
            create_phoneme_client,
        )

    praat_result = None
    phoneme_result = None
    phoneme_error = None
    praat_error = None
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    try:
        praat_future = executor.submit(
            analyze_audio_v2,
            tmp_path,
            native=False,
            reference_ipa=reference_ipa,
            # Keep Praat untargeted in V3 so its nucleus count remains an
            # independent signal rather than a re-segmentation of the target.
            expected_syllable_count=None,
        )
        if reference_syllables is None:
            try:
                parsed_reference = parse_pronunciation(reference_ipa) if reference_ipa else None
                resolved_reference_syllables = [
                    item.get('ipa', '') for item in parsed_reference.syllables
                ] if parsed_reference else []
            except Exception:
                resolved_reference_syllables = []
        else:
            resolved_reference_syllables = list(reference_syllables)

        try:
            client = create_phoneme_client()
            recognizer_call = getattr(client, 'recognize_v2', None)
            if recognizer_call is None:
                # Compatibility for legacy test doubles/deployments.  The
                # resulting payload remains unrateable for formal V3 claims.
                recognizer_call = getattr(client, 'recognize')
                phoneme_future = executor.submit(recognizer_call, wav_bytes)
            else:
                recognizer_kwargs = {'variant_id': request_reference_id}
                try:
                    recognizer_parameters = inspect.signature(recognizer_call).parameters
                    if 'reference_ipa' in recognizer_parameters or any(
                        parameter.kind is inspect.Parameter.VAR_KEYWORD
                        for parameter in recognizer_parameters.values()
                    ):
                        recognizer_kwargs['reference_ipa'] = reference_ipa
                except (TypeError, ValueError):
                    # A test double or proxy may not expose a signature. Keep
                    # the long-standing V2 call shape in that case.
                    pass
                phoneme_future = executor.submit(
                    recognizer_call,
                    wav_bytes,
                    resolved_reference_syllables,
                    expected_syllables or 0,
                    **recognizer_kwargs,
                )
        except ConfigurationError as error:
            phoneme_future = None
            phoneme_error = getattr(error, 'reason', None) or REASON_RECOGNIZER_CONFIG_MISSING
            # Diagnostics intentionally expose only configuration presence and
            # auth mode. Never log a URL, token, or exception text here.
            logger.warning(
                'V3 phoneme recognizer unavailable: reason=%s service_url_configured=%s auth_mode=%s',
                phoneme_error,
                bool(os.environ.get('PHONEME_SERVICE_URL')),
                (os.environ.get('PHONEME_SERVICE_AUTH') or 'google').strip().lower(),
            )
        except http_requests.exceptions.Timeout:
            phoneme_future = None
            phoneme_error = 'TIMEOUT'
        except http_requests.exceptions.ConnectionError:
            phoneme_future = None
            phoneme_error = 'RECOGNIZER_UNREACHABLE'
        except Exception as error:
            phoneme_future = None
            phoneme_error = getattr(error, 'reason', None) or 'MODEL_INFERENCE_FAILED'

        remaining = max(0.001, _V3_HARD_TIMEOUT_SECONDS - (time.time() - start_time))
        try:
            praat_result = praat_future.result(timeout=remaining)
            if isinstance(praat_result, dict) and 'raw_pcm' not in praat_result:
                try:
                    import parselmouth
                    sound = parselmouth.Sound(tmp_path)
                    praat_result['raw_pcm'] = sound.values.squeeze().astype(np.float32)
                    praat_result['sampleRate'] = int(sound.sampling_frequency)
                    praat_result['duration'] = float(sound.duration)
                except Exception:
                    try:
                        from scipy.io import wavfile
                        sr, data = wavfile.read(tmp_path)
                        if data.dtype == np.int16:
                            pcm = data.astype(np.float32) / 32768.0
                        else:
                            pcm = data.astype(np.float32)
                        if pcm.ndim > 1:
                            pcm = pcm.mean(axis=1)
                        praat_result['raw_pcm'] = pcm
                        praat_result['sampleRate'] = sr
                        praat_result['duration'] = len(pcm) / sr
                    except Exception:
                        pass
        except Exception as error:
            praat_error = 'V3_PRAAT_FAILED'
            print(f'V3 Praat analysis error: {error}')

        if phoneme_future is not None and not praat_error:
            phoneme_remaining = max(0.001, _V3_HARD_TIMEOUT_SECONDS - (time.time() - start_time))
            try:
                phoneme_result = phoneme_future.result(timeout=phoneme_remaining)
            except concurrent.futures.TimeoutError:
                phoneme_error = 'TIMEOUT'
                print('V3 phoneme recognition timed out', flush=True)
            except ConfigurationError as error:
                phoneme_error = getattr(error, 'reason', None) or REASON_RECOGNIZER_CONFIG_MISSING
                logger.warning(
                    'V3 phoneme recognizer unavailable during inference: reason=%s',
                    phoneme_error,
                )
            # Transport failures must not be reported as model failures: the
            # model was never reached, so blaming inference sends every future
            # investigation to the wrong service.
            except http_requests.exceptions.Timeout:
                phoneme_error = 'TIMEOUT'
                print('V3 phoneme recognition timed out (transport)', flush=True)
            except http_requests.exceptions.ConnectionError:
                phoneme_error = 'RECOGNIZER_UNREACHABLE'
                print('V3 phoneme recognizer unreachable', flush=True)
            except Exception as error:
                phoneme_error = getattr(error, 'reason', None) or 'MODEL_INFERENCE_FAILED'
                print(f'V3 phoneme recognition error: {error}')
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    return {
        'praat_result': praat_result,
        'phoneme_result': phoneme_result,
        'phoneme_error': phoneme_error,
        'praat_error': praat_error,
        'elapsed': time.time() - start_time,
        'request_reference_id': request_reference_id,
    }


def _build_v3_active_result_from_pipeline(
    pipeline,
    *,
    reference_ipa=None,
    expected_syllables=None,
    include_partition_variants=False,
    allow_legacy_v4=False,
):
    """Build the active V3 response and its stable unavailable reason."""
    pipeline = pipeline or {}
    praat_result = pipeline.get('praat_result') or {}
    phoneme_result = pipeline.get('phoneme_result')
    reason = pipeline.get('praat_error') or pipeline.get('phoneme_error')
    if pipeline.get('praat_error'):
        return _build_v3_degraded_response({}, pipeline['praat_error']), pipeline['praat_error']
    if reason or not phoneme_result:
        reason = reason or 'MODEL_INFERENCE_FAILED'
        return _build_v3_degraded_response(praat_result, reason), reason
    if not _recognizer_is_rateable(phoneme_result):
        reason = _recognizer_quality_reason(phoneme_result) or 'LOW_PHONEME_CONFIDENCE'
        return _build_v3_degraded_response(
            praat_result,
            reason,
            _recognizer_confidence(phoneme_result) or 0.0,
        ), reason

    response = _build_v3_active_response(
        praat_result,
        phoneme_result,
        reference_ipa=reference_ipa,
        expected_syllables=expected_syllables,
        include_partition_variants=include_partition_variants,
        allow_legacy_v4=allow_legacy_v4,
    )
    response['verification'] = _build_v3_verification(
        praat_result,
        phoneme_result,
        reference_ipa,
        expected_syllables,
    )
    response['best_effort'] = _build_v3_best_effort(
        praat_result,
        phoneme_result,
        reference_ipa,
        expected_syllables,
    )
    return response, None


def _parse_reference_syllables_payload(raw_value, expected_syllables):
    """Validate an optional authoritative per-syllable IPA request field."""
    if raw_value is None or not str(raw_value).strip():
        return None
    try:
        syllables = json.loads(raw_value)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError('REFERENCE_SYLLABLES_INVALID') from error
    if (
        not isinstance(syllables, list)
        or not 1 <= len(syllables) <= 8
        or len(syllables) != expected_syllables
        or any(
            not isinstance(syllable, str)
            or not syllable
            or syllable != unicodedata.normalize('NFC', syllable)
            for syllable in syllables
        )
    ):
        raise ValueError('REFERENCE_SYLLABLES_INVALID')
    return syllables


@app.route('/analyze/v3', methods=['POST'])
def analyze_v3():
    """V3 pronunciation analysis with optional phoneme recognition."""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']
    reference_ipa = request.form.get('reference_ipa')
    expected_syllables = request.form.get('expected_syllables', type=int)
    target_word = request.form.get('target_word')
    variant_id = request.form.get('variant_id')
    try:
        reference_syllables = _parse_reference_syllables_payload(
            request.form.get('reference_syllables'),
            expected_syllables,
        )
    except ValueError as error:
        code = str(error)
        return jsonify({'error': code, 'code': code}), 400
    request_reference_id = variant_id or _derive_request_reference_id(
        target_word,
        reference_ipa,
        expected_syllables,
    )
    mode = _PRONUNCIATION_V3_MODE

    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        if mode == 'off':
            v2_result = analyze_audio_v2(tmp_path, native=False)
            return jsonify(_adapt_v2_to_v3_response(
                v2_result,
                mode,
                reference_ipa=reference_ipa,
                expected_syllables=expected_syllables,
            ))

        pipeline = run_v3_pipeline(
            tmp_path,
            reference_ipa=reference_ipa,
            reference_syllables=reference_syllables,
            expected_syllables=expected_syllables,
            target_word=target_word,
            variant_id=request_reference_id,
        )
        praat_result = pipeline.get('praat_result') or {}
        phoneme_result = pipeline.get('phoneme_result')
        phoneme_error = pipeline.get('phoneme_error')
        if pipeline.get('praat_error'):
            return jsonify({
                **_build_v3_degraded_response({}, pipeline['praat_error']),
                'error': 'Pronunciation analysis failed',
                'code': pipeline['praat_error'],
            }), 500

        if mode == 'shadow':
            v2_syllable_count = praat_result.get('observed', {}).get('syllableCount', 0)
            phoneme_syllable_count = None
            if phoneme_result and not phoneme_error:
                phoneme_syllable_count = _recognizer_syllable_count(phoneme_result)
            disagreement_category = 'unavailable'
            if phoneme_syllable_count is not None:
                if phoneme_syllable_count == v2_syllable_count:
                    disagreement_category = 'agreement'
                elif phoneme_syllable_count < v2_syllable_count:
                    disagreement_category = 'omission'
                else:
                    disagreement_category = 'insertion'
            shadow_log = {
                'event': 'pronunciation_v3_shadow',
                'v2_count': v2_syllable_count,
                'v3_count': phoneme_syllable_count,
                'disagreement_category': disagreement_category,
                'confidence': _recognizer_confidence(phoneme_result),
                'latency_seconds': round(pipeline.get('elapsed', 0.0), 4),
                'quality_reason': _recognizer_quality_reason(phoneme_result) or phoneme_error,
                'model_revision': phoneme_result.get('model_revision') if phoneme_result else None,
                'target_word': target_word,
                'contract_version': phoneme_result.get('contract_version') if phoneme_result else None,
            }
            print(f'V3 shadow result: {json.dumps(shadow_log, sort_keys=True)}', flush=True)
            return jsonify(_adapt_v2_to_v3_response(
                praat_result,
                mode,
                reference_ipa=reference_ipa,
                expected_syllables=expected_syllables,
            ))

        response, _ = _build_v3_active_result_from_pipeline(
            pipeline,
            reference_ipa=reference_ipa,
            expected_syllables=expected_syllables,
        )
        return jsonify(response)
    except Exception as error:
        print(f'V3 analysis error: {error}', flush=True)
        return jsonify(_build_v3_degraded_response({}, 'V3_ANALYSIS_FAILED'))
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _comparison_reference_error(reference_ipa, expected_syllables):
    """Return a stable validation reason, or ``None`` for a valid target."""
    if not isinstance(reference_ipa, str) or not reference_ipa.strip():
        return 'REFERENCE_IPA_REQUIRED'
    if not isinstance(expected_syllables, int) or not 1 <= expected_syllables <= 20:
        return 'EXPECTED_SYLLABLES_INVALID'
    try:
        parsed = parse_pronunciation(reference_ipa)
    except Exception:
        return 'REFERENCE_IPA_INVALID'
    if parsed.conflicts:
        return 'REFERENCE_CONFLICT'
    if parsed.phonological_count != expected_syllables or len(parsed.syllables) != expected_syllables:
        return 'REFERENCE_COUNT_CONFLICT'
    return None


_WARM_V3_DEBOUNCE_SECONDS = 60
_warm_v3_state = {'last_dispatch': 0.0}
_warm_v3_lock = threading.Lock()


def _warm_v3_worker():
    """Poke the recognizer so it loads its model outside a learner's request."""
    try:
        from .phoneme_client import create_phoneme_client
    except ImportError:
        from phoneme_client import create_phoneme_client  # type: ignore
    try:
        create_phoneme_client().warm()
    except Exception as error:
        # Best effort by contract. A failed warm-up must never be visible to a
        # learner, and must never mark the service unhealthy.
        logger.info('V3 warm-up did not complete: %s', type(error).__name__)


@app.route('/warm/v3', methods=['GET', 'POST'])
def warm_v3():
    """Fire-and-forget recognizer warm-up. Never blocks, never fails the caller.

    Pronounce mode calls this on entry, long before the learner records. The
    recognizer scales to zero, so this moves its 46-52s model load into the
    time a learner spends reading the word instead of into their analysis
    request. Returns immediately in every case.
    """
    if not os.environ.get('PHONEME_SERVICE_URL'):
        return jsonify({'status': 'disabled'}), 202

    now = time.time()
    with _warm_v3_lock:
        if now - _warm_v3_state['last_dispatch'] < _WARM_V3_DEBOUNCE_SECONDS:
            return jsonify({'status': 'debounced'}), 202
        _warm_v3_state['last_dispatch'] = now

    threading.Thread(target=_warm_v3_worker, daemon=True).start()
    return jsonify({'status': 'warming'}), 202


@app.route('/analyze/compare', methods=['POST'])
def analyze_comparison():
    """Return V2/V3 analyses plus the comparison-only V4 partition envelope."""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided', 'code': 'AUDIO_REQUIRED'}), 400

    reference_ipa = request.form.get('reference_ipa')
    expected_syllables = request.form.get('expected_syllables', type=int)
    target_word = (request.form.get('target_word') or '').strip()
    variant_id = (request.form.get('variant_id') or '').strip() or None
    try:
        reference_syllables = _parse_reference_syllables_payload(
            request.form.get('reference_syllables'),
            expected_syllables,
        )
    except ValueError as error:
        code = str(error)
        return jsonify({'error': code, 'code': code}), 400
    reference_error = _comparison_reference_error(reference_ipa, expected_syllables)
    if reference_error:
        return jsonify({'error': reference_error, 'code': reference_error}), 400
    if not target_word:
        return jsonify({'error': 'TARGET_WORD_REQUIRED', 'code': 'TARGET_WORD_REQUIRED'}), 400

    comparison_id = secrets.token_hex(16)
    request_reference_id = variant_id or _derive_request_reference_id(
        target_word,
        reference_ipa,
        expected_syllables,
    )
    audio_file = request.files['audio']
    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    v2_envelope = {'status': 'unavailable', 'reason': 'ANALYSIS_FAILED', 'analysis': None}
    v3_envelope = {'status': 'unavailable', 'reason': 'MODEL_INFERENCE_FAILED', 'analysis': None}
    try:
        try:
            v2_result = analyze_audio_v2(
                tmp_path,
                expected_syllable_count=expected_syllables,
                native=False,
                reference_ipa=reference_ipa,
            )
            v2_envelope = _build_v2_comparison_envelope(v2_result, expected_syllables)
        except Exception as error:
            print(f'Comparison V2 analysis error: {error}')

        try:
            pipeline = run_v3_pipeline(
                tmp_path,
                reference_ipa=reference_ipa,
                reference_syllables=reference_syllables,
                expected_syllables=expected_syllables,
                target_word=target_word,
                variant_id=request_reference_id,
            )
            v3_result, v3_reason = _build_v3_active_result_from_pipeline(
                pipeline,
                reference_ipa=reference_ipa,
                expected_syllables=expected_syllables,
                include_partition_variants=True,
                allow_legacy_v4=False,
            )
            if not isinstance(v3_result, dict):
                v3_envelope = {
                    'status': 'unavailable',
                    'reason': 'ANALYSIS_INVALID',
                    'analysis': v3_result,
                }
            elif v3_result.get('analysisVersion') != 'pronunciation-analysis-v3':
                v3_envelope = {
                    'status': 'unavailable',
                    'reason': 'ANALYSIS_INVALID',
                    'analysis': v3_result,
                }
            elif v3_reason:
                v3_envelope = {
                    'status': 'unavailable',
                    'reason': v3_reason,
                    'analysis': v3_result,
                }
            else:
                v3_envelope = {
                    'status': 'complete',
                    'reason': None,
                    'analysis': v3_result,
                }
        except Exception as error:
            print(f'Comparison V3 analysis error: {error}')

        v4_envelope = _build_v4_comparison_envelope(v3_envelope, expected_syllables)
        v42_envelope = _build_v42_comparison_envelope(v3_envelope, expected_syllables)
        complete_versions = (
            v2_envelope['status'] == 'complete',
            v3_envelope['status'] == 'complete',
            v4_envelope['status'] == 'complete',
        )
        any_complete = any(complete_versions)
        all_complete = all(complete_versions)
        body = {
            'schemaVersion': 'pronunciation-comparison-v2',
            'mode': 'comparison',
            'status': 'complete' if all_complete else ('partial_failure' if any_complete else 'unavailable'),
            'comparisonId': comparison_id,
            'context': {
                'targetWord': target_word,
                'referenceIpa': reference_ipa,
                'referenceSyllableIpa': reference_syllables,
                'expectedSyllables': expected_syllables,
                'variantId': variant_id,
                'requestReferenceId': request_reference_id,
            },
            'revisions': {
                'comparisonSchema': 'pronunciation-comparison-v2',
                'v2': 'pronunciation-analysis-v2',
                'v3': (v3_envelope.get('analysis') or {}).get('analysisVersion') or 'pronunciation-analysis-v3',
                'v4': (v4_envelope.get('analysis') or {}).get('analysisVersion') or 'pronunciation-analysis-v4',
                'v3Model': ((v3_envelope.get('analysis') or {}).get('verification') or {}).get('model_revision'),
            },
            'v2': v2_envelope,
            'v3': v3_envelope,
            'v4': v4_envelope,
            'timingVariants': {
                'v42': v42_envelope
            } if v42_envelope else {},
        }
        return jsonify(body), (200 if any_complete else 503)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.route('/debug/pronounce-samples', methods=['POST'])
def save_local_pronounce_sample():
    """Persist one Pronounce recording and its analysis for local debugging only."""
    if not _is_local_pronounce_request():
        return jsonify({
            'error': 'This debug sample route is available from localhost only.',
            'code': 'LOCAL_ONLY'
        }), 403

    audio_file = request.files.get('audio')
    if not audio_file:
        return jsonify({'error': 'No audio file provided', 'code': 'AUDIO_REQUIRED'}), 400

    metadata_text = str(request.form.get('metadata') or '').strip()
    if not metadata_text:
        return jsonify({'error': 'Missing sample metadata', 'code': 'METADATA_REQUIRED'}), 400
    try:
        metadata = json.loads(metadata_text)
    except (TypeError, ValueError):
        return jsonify({'error': 'Sample metadata must be valid JSON', 'code': 'METADATA_INVALID'}), 400
    if not isinstance(metadata, dict):
        return jsonify({'error': 'Sample metadata must be an object', 'code': 'METADATA_INVALID'}), 400

    if metadata.get('source') != 'pronounce-mode-local':
        return jsonify({'error': 'Only Pronounce local samples may use this route', 'code': 'SOURCE_INVALID'}), 400

    word = str(metadata.get('word') or '').strip()
    if not word:
        return jsonify({'error': 'Sample word is required', 'code': 'WORD_REQUIRED'}), 400

    sample_id = str(metadata.get('sampleId') or '').strip().casefold()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,119}', sample_id):
        sample_id = _local_sample_id(word)

    audio_bytes = audio_file.read(LOCAL_PRONOUNCE_SAMPLE_MAX_BYTES + 1)
    if not audio_bytes:
        return jsonify({'error': 'Audio file is empty', 'code': 'AUDIO_EMPTY'}), 400
    if len(audio_bytes) > LOCAL_PRONOUNCE_SAMPLE_MAX_BYTES:
        return jsonify({'error': 'Audio file exceeds the 5 MB local debug limit', 'code': 'AUDIO_TOO_LARGE'}), 400
    if audio_bytes[:4] != b'RIFF' or audio_bytes[8:12] != b'WAVE':
        return jsonify({'error': 'Audio must be a PCM WAV file', 'code': 'AUDIO_NOT_WAV'}), 400

    sample_dir = _local_pronounce_sample_dir()
    audio_path = sample_dir / f'{sample_id}.wav'
    metadata_path = sample_dir / f'{sample_id}.json'
    saved_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    sha256 = hashlib.sha256(audio_bytes).hexdigest()
    saved_metadata = {
        **metadata,
        'sampleId': sample_id,
        'savedAt': saved_at,
        'audio': {
            **(metadata.get('audio') if isinstance(metadata.get('audio'), dict) else {}),
            'format': 'wav',
            'bytes': len(audio_bytes),
            'sha256': sha256,
        },
    }

    try:
        sample_dir.mkdir(parents=True, exist_ok=True)
        audio_tmp = sample_dir / f'.{sample_id}.wav.tmp'
        metadata_tmp = sample_dir / f'.{sample_id}.json.tmp'
        audio_tmp.write_bytes(audio_bytes)
        metadata_tmp.write_text(
            json.dumps(saved_metadata, ensure_ascii=False, indent=2),
            encoding='utf-8'
        )
        audio_tmp.replace(audio_path)
        metadata_tmp.replace(metadata_path)
    except Exception as error:
        for temporary_path in (locals().get('audio_tmp'), locals().get('metadata_tmp')):
            try:
                if temporary_path:
                    temporary_path.unlink(missing_ok=True)
            except Exception:
                pass
        print(f'Local Pronounce sample save error: {error}')
        return jsonify({
            'error': 'Failed to save local Pronounce sample',
            'code': 'SAVE_FAILED'
        }), 500

    return jsonify({
        'success': True,
        'sampleId': sample_id,
        'audioPath': _workspace_relative_path(audio_path),
        'metadataPath': _workspace_relative_path(metadata_path),
        'bytes': len(audio_bytes),
        'sha256': sha256,
    })


@app.route('/debug/syllables/<word>', methods=['GET'])
def debug_syllables_endpoint(word):
    """Debug endpoint to see syllable counting in detail."""
    print(f"\nDEBUG_SYLLABLES: Request for '{word}'")
    try:
        normalized_word = word.lower().strip()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        def safe_get_json(url):
            print(f"DEBUG_SYLLABLES: Fetching {url}")
            r = http_requests.get(url, headers=headers, timeout=10)
            print(f"DEBUG_SYLLABLES: Status {r.status_code}")
            if r.status_code != 200:
                return r, None
            try:
                return r, r.json()
            except:
                return r, None

        # Try Collegiate first
        url = f"https://www.dictionaryapi.com/api/v3/references/collegiate/json/{normalized_word}?key={MW_API_KEY}"
        resp, data = safe_get_json(url)
        
        # Fallback 1: try learners
        if data is None or not isinstance(data, list) or not data or (isinstance(data[0], str) and "Not subscribed" in data[0]):
             print("DEBUG_SYLLABLES: Collegiate failed or unsubscribed, trying Learner's...")
             url = f"https://www.dictionaryapi.com/api/v3/references/learners/json/{normalized_word}?key={MW_API_KEY}"
             resp, data = safe_get_json(url)
             
        # Fallback 2: try sd4
        if data is None or not isinstance(data, list) or not data or (isinstance(data[0], str) and "Not subscribed" in data[0]):
             print("DEBUG_SYLLABLES: Learner's failed or unsubscribed, trying SD4...")
             url = f"https://www.dictionaryapi.com/api/v3/references/sd4/json/{normalized_word}?key={MW_API_KEY}"
             resp, data = safe_get_json(url)
            
        if data is None or not isinstance(data, list) or not data:
             return jsonify({
                 'error': 'Failed to fetch valid JSON from MW',
                 'status_code': resp.status_code if resp else 'None',
                 'text_preview': resp.text[:200] if resp else 'None'
             }), 500
             
        if not isinstance(data[0], dict):
            return jsonify({'error': 'No entry found (received suggestions)', 'suggestions': data}), 404
            
        entry = data[0]
        hwi = entry.get('hwi', {})
        hw = hwi.get('hw', '')
        prs = hwi.get('prs', [])
        ipa = prs[0].get('ipa', '') if prs else ''
        mw_notation = prs[0].get('mw', '') if prs else ''
        pron_string = ipa or mw_notation
        
        print(f"DEBUG_SYLLABLES: Found pronunciation: '{pron_string}'")
        
        # Parse
        hw_syllables = parse_syllables(hw)
        ipa_count = count_ipa_syllables(pron_string)
        refined_labels = split_word_by_ipa(word, pron_string, ipa_count)
        
        result = {
            'word': word,
            'source_field': 'ipa' if ipa else 'mw',
            'raw_hw': hw,
            'raw_ipa': ipa,
            'raw_mw': mw_notation,
            'ipa_unicode': [f"U+{ord(c):04X} ({c})" for c in pron_string],
            'hw_syllables': hw_syllables,
            'hw_count': len(hw_syllables),
            'ipa_count': ipa_count,
            'final_syllables': refined_labels,
            'final_count': ipa_count if ipa_count > 0 else len(hw_syllables)
        }
        print(f"DEBUG_SYLLABLES: Success! Count: {result['final_count']}")
        return jsonify(result)
        
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"DEBUG_SYLLABLES ERROR: {str(e)}\n{error_trace}")
        return jsonify({'error': str(e), 'trace': error_trace}), 500

@app.route('/analyze', methods=['POST'])
def analyze():
    """
    Analyze audio for pitch, intensity, and syllables.
    """
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    
    audio_file = request.files['audio']
    expected_syllables = request.form.get('expected_syllables', type=int)
    
    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name
    
    try:
        result = analyze_audio(tmp_path, expected_syllables)
        return jsonify(result)
    except Exception as e:
        print(f"Analysis error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

@app.route('/analyze-vowel', methods=['POST'])
def analyze_vowel():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    category = str(request.form.get('category', '')).strip()
    if category != 'vowel':
        return jsonify({
            'exploratory': True,
            'usable': False,
            'reason': 'non_vowel_item'
        })

    audio_file = request.files['audio']
    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        result = analyze_vowel_hint(tmp_path)
        return jsonify(result)
    except Exception as e:
        print(f"Vowel hint analysis error: {e}")
        return jsonify({
            'exploratory': True,
            'usable': False,
            'reason': 'praat_unavailable'
        })
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

@app.route('/analyze-nucleus-prosody', methods=['POST'])
def analyze_nucleus_prosody():
    """
    Measure Praat pitch (F0) and intensity over specific vowel nucleus intervals.
    Used by Option A (Azure Speech + Praat Prosody Fusion).
    """
    req_json = request.get_json(silent=True) or {}
    if 'audio' not in request.files and not req_json:
        return jsonify({'error': 'No audio provided'}), 400

    intervals_raw = request.form.get('intervals')
    if not intervals_raw and req_json:
        intervals_raw = req_json.get('intervals')
    
    intervals = []
    if isinstance(intervals_raw, str):
        try:
            intervals = json.loads(intervals_raw)
        except Exception:
            intervals = []
    elif isinstance(intervals_raw, list):
        intervals = intervals_raw

    tmp_path = None
    try:
        if 'audio' in request.files:
            audio_file = request.files['audio']
            with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
                audio_file.save(tmp.name)
                tmp_path = tmp.name
        elif req_json and req_json.get('audioBase64'):
            import base64
            audio_data = base64.b64decode(req_json['audioBase64'])
            with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
                tmp.write(audio_data)
                tmp_path = tmp.name
        else:
            return jsonify({'error': 'Missing audio file or audioBase64'}), 400

        sound = parselmouth.Sound(tmp_path)
        duration = float(sound.duration)
        if duration < 0.09:
            return jsonify({'error': 'Audio duration is too short (<90ms) for acoustic analysis', 'success': False}), 400
        pitch = sound.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
        intensity = sound.to_intensity(minimum_pitch=75, time_step=0.01)

        enriched = []
        for idx, item in enumerate(intervals):
            start_t = float(item.get('startTime', item.get('start_time', 0.0)))
            end_t = float(item.get('endTime', item.get('end_time', start_t)))
            start_t = max(0.0, min(duration, start_t))
            end_t = max(start_t, min(duration, end_t))
            interval_dur = max(0.0, end_t - start_t)

            step = 0.01
            sample_times = np.arange(start_t, max(start_t + step, end_t), step) if interval_dur > 0 else [start_t]
            
            p_vals = []
            for t in sample_times:
                pv = pitch.get_value_at_time(float(t))
                if not np.isnan(pv) and pv > 0:
                    p_vals.append(float(pv))

            int_vals = []
            for t in sample_times:
                iv = intensity.get_value(float(t))
                if not np.isnan(iv) and iv > 0:
                    int_vals.append(float(iv))

            max_pitch = round(float(max(p_vals)), 1) if p_vals else 0.0
            mean_pitch = round(float(np.mean(p_vals)), 1) if p_vals else 0.0
            peak_intensity = round(float(max(int_vals)), 1) if int_vals else 0.0
            mean_intensity = round(float(np.mean(int_vals)), 1) if int_vals else 0.0

            enriched.append({
                'id': item.get('id', idx),
                'phoneme': item.get('phoneme', ''),
                'startTime': round(start_t, 4),
                'endTime': round(end_t, 4),
                'vowelDuration': round(interval_dur, 4),
                'maxPitch': max_pitch,
                'meanPitch': mean_pitch,
                'peakIntensity': peak_intensity,
                'meanIntensity': mean_intensity,
                'voicedRatio': round(len(p_vals) / max(1, len(sample_times)), 2),
            })

        return jsonify({
            'success': True,
            'duration': round(duration, 4),
            'sampleRate': int(sound.sampling_frequency),
            'intervals': enriched,
        })
    except Exception as e:
        logger.exception(f"analyze_nucleus_prosody error: {e}")
        return jsonify({'error': str(e), 'success': False}), 500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.route('/analyze/option-b', methods=['POST'])
def analyze_option_b():
    """
    Option B: Repaired Self-Hosted V4 Syllabification + Praat Native Analysis.
    Combines Praat multi-cue boundary detection, vowel duration measurement,
    and repaired lexical stress determination (normalized by max_vowel_dur).
    """
    req_json = request.get_json(silent=True) or {}
    if 'audio' not in request.files and not req_json:
        return jsonify({'error': 'No audio file provided'}), 400

    target_word = request.form.get('target_word') or request.form.get('word') or req_json.get('word') or ''
    reference_ipa = request.form.get('reference_ipa') or req_json.get('reference_ipa') or ''
    raw_expected = request.form.get('expected_syllables') if request.form else None
    if raw_expected is None and req_json:
        raw_expected = req_json.get('expected_syllables')
    expected_syllables = None
    if raw_expected is not None:
        try:
            expected_syllables = int(raw_expected)
        except (ValueError, TypeError):
            expected_syllables = None

    if not expected_syllables and reference_ipa:
        try:
            from backend.phoneme_service.v4_syllabification import syllabify_reference_ipa
            v4_hint = syllabify_reference_ipa(reference_ipa)
            if v4_hint and v4_hint.syllable_count > 0:
                expected_syllables = v4_hint.syllable_count
        except Exception as err:
            logger.debug(f"Could not infer expected_syllables from reference_ipa: {err}")

    tmp_path = None
    try:
        if 'audio' in request.files:
            audio_file = request.files['audio']
            with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
                audio_file.save(tmp.name)
                tmp_path = tmp.name
        elif req_json and req_json.get('audioBase64'):
            import base64
            audio_data = base64.b64decode(req_json['audioBase64'])
            with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
                tmp.write(audio_data)
                tmp_path = tmp.name
        else:
            return jsonify({'error': 'Missing audio file or audioBase64'}), 400

        sound = parselmouth.Sound(tmp_path)
        duration = float(sound.duration)
        if duration < 0.09:
            return jsonify({'error': 'Audio duration is too short (<90ms) for acoustic analysis', 'success': False}), 400

        # 1. Run native Praat analysis
        praat_res = analyze_audio(tmp_path, expected_syllables=expected_syllables)
        syllables = praat_res.get('syllables') or []

        # 2. Ensure each syllable has vowelDuration and interval measured
        pitch_obj = sound.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
        for s in syllables:
            s_start = float(s.get('startTime', s.get('start_time', 0)))
            s_end = float(s.get('endTime', s.get('end_time', s_start)))
            v_dur, v_start, v_end = measure_vowel_interval(sound, s_start, s_end, pitch_obj)
            s['vowelDuration'] = round(v_dur, 3)
            s['vowel_duration'] = s['vowelDuration']
            s['vowelStartTime'] = round(v_start, 3)
            s['vowelEndTime'] = round(v_end, 3)
            s['sylStartTime'] = round(s_start, 3)
            s['sylEndTime'] = round(s_end, 3)
            s['nucleusStartTime'] = round(v_start, 3)
            s['nucleusEndTime'] = round(v_end, 3)

        # 3. Detect stressed syllable with repaired phonetic corrections & vowel normalization
        prom_scores, detected_idx = compute_syllable_prominence_scores(syllables)
        normalized_pattern = normalize_syllable_pattern(syllables)

        # 4. Compute prominence per syllable using the synchronized penalized scores
        for i, s in enumerate(syllables):
            s['isStressed'] = (i == detected_idx)
            s['prominence'] = prom_scores[i] if i < len(prom_scores) else 0.0

        # 5. Add V4 syllabification if reference IPA is available
        v4_data = None
        if reference_ipa:
            try:
                from backend.phoneme_service.v4_syllabification import syllabify_reference_ipa
                v4_data = syllabify_reference_ipa(reference_ipa).to_dict()
            except Exception as v4_err:
                logger.debug(f"V4 syllabification hint failed: {v4_err}")

        return jsonify({
            'success': True,
            'engine': 'option-b',
            'targetWord': target_word,
            'referenceIpa': reference_ipa,
            'duration': praat_res.get('duration', round(sound.duration, 3)),
            'syllables': syllables,
            'detectedStressedIndex': detected_idx,
            'normalizedPattern': normalized_pattern,
            'pitch': praat_res.get('pitch', {}),
            'intensity': praat_res.get('intensity', {}),
            'v4Syllabification': v4_data,
            'summary': {
                'syllableCount': len(syllables),
                'detectedStressed': detected_idx,
                'stressedSyllableNumber': detected_idx + 1 if syllables else 1,
            }
        })
    except Exception as e:
        logger.exception(f"analyze_option_b error: {e}")
        status = 400 if "too short" in str(e).lower() else 500
        return jsonify({'error': str(e), 'success': False}), status
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

def analyze_audio(audio_path, expected_syllables=None, allow_expected_adjustment=True):
    """Main analysis using Parselmouth/Praat"""
    
    # Load sound
    sound = parselmouth.Sound(audio_path)
    duration = float(sound.duration)
    if duration < 0.09:
        raise ValueError("Audio duration is too short (<90ms) for acoustic analysis")
    
    # Define common time grid (10ms steps)
    time_step = 0.01
    times = np.arange(0, duration, time_step)
    
    # Adaptive Pitch Analysis
    # Standard gender-neutral ceiling is 500Hz (Praat recommendation)
    # 600Hz reserved for child/high-pitch mode if explicitly requested
    pitch_floor = 75
    pitch_ceiling = 500 
    
    pitch = sound.to_pitch(time_step=time_step, pitch_floor=pitch_floor, pitch_ceiling=pitch_ceiling)
    pitch_values: list[float | None] = []
    for t in times:
        p = pitch.get_value_at_time(t)
        pitch_values.append(None if np.isnan(p) or p == 0 else round(float(p), 1))
    
    # Extract intensity
    # Use same minimum pitch as pitch analysis for consistency
    intensity = sound.to_intensity(minimum_pitch=75, time_step=time_step)
    intensity_values: list[float] = []
    for t in times:
        val = intensity.get_value(t)
        intensity_values.append(round(float(val), 2) if not np.isnan(val) else 0.0)
    
    # Detect syllables using the pitch and intensity objects (they handle their own grids internally)
    syllables = detect_syllables(
        sound,
        pitch,
        intensity,
        expected_syllables,
        allow_expected_adjustment=allow_expected_adjustment,
    )
    
    return {
        'duration': round(duration, 3),
        'sampleRate': int(sound.sampling_frequency),
        'pitch': {
            'times': [round(float(t), 3) for t in times],
            'values': [v for v in pitch_values]
        },
        'intensity': {
            'times': [round(float(t), 3) for t in times],
            'values': [v for v in intensity_values]
        },
        'syllables': syllables
    }

def _longest_true_run(times, mask):
    best_start = None
    best_end = None
    run_start = None

    for index, flag in enumerate(mask):
        if flag and run_start is None:
            run_start = index
        if not flag and run_start is not None:
            if best_start is None or (index - run_start) > (best_end - best_start):
                best_start = run_start
                best_end = index
            run_start = None

    if run_start is not None:
        end_index = len(mask)
        if best_start is None or (end_index - run_start) > (best_end - best_start):
            best_start = run_start
            best_end = end_index

    if best_start is None or best_end is None:
        return None, None

    start_time = float(times[best_start])
    end_lookup = min(len(times) - 1, best_end - 1)
    end_time = float(times[end_lookup])
    return start_time, end_time

def analyze_vowel_hint(audio_path):
    sound = parselmouth.Sound(audio_path)
    duration = float(sound.duration)
    if duration < 0.08:
        return {
            'exploratory': True,
            'usable': False,
            'reason': 'no_stable_vowel'
        }

    time_step = 0.005
    times = np.arange(0, duration, time_step)
    pitch = sound.to_pitch(time_step=time_step, pitch_floor=75, pitch_ceiling=500)
    intensity = sound.to_intensity(minimum_pitch=75, time_step=time_step)
    formant = sound.to_formant_burg(time_step=time_step, max_number_of_formants=5, maximum_formant=5500)

    pitch_values = np.array([pitch.get_value_at_time(t) for t in times], dtype=float)
    intensity_values = np.array([intensity.get_value(t) for t in times], dtype=float)
    intensity_values = np.nan_to_num(intensity_values, nan=0.0)
    voiced_mask = (~np.isnan(pitch_values)) & (pitch_values > 0)

    positive_intensities = intensity_values[intensity_values > 0]
    if len(positive_intensities) == 0:
        return {
            'exploratory': True,
            'usable': False,
            'reason': 'no_stable_vowel'
        }

    intensity_threshold = max(np.percentile(positive_intensities, 35), 35.0)
    stable_mask = voiced_mask & (intensity_values >= intensity_threshold)
    if not np.any(stable_mask):
        return {
            'exploratory': True,
            'usable': False,
            'reason': 'no_stable_vowel'
        }

    region_start, region_end = _longest_true_run(times, stable_mask)
    if region_start is None or region_end is None or (region_end - region_start) < 0.05:
        return {
            'exploratory': True,
            'usable': False,
            'reason': 'no_stable_vowel'
        }

    region_duration = region_end - region_start
    nucleus_start = region_start + (region_duration * 0.2)
    nucleus_end = region_end - (region_duration * 0.2)
    if nucleus_end <= nucleus_start:
        return {
            'exploratory': True,
            'usable': False,
            'reason': 'no_stable_vowel'
        }

    sample_pcts = [35, 50, 65]
    samples = []
    for pct in sample_pcts:
        sample_time = nucleus_start + ((pct / 100.0) * (nucleus_end - nucleus_start))
        f1 = float(formant.get_value_at_time(1, sample_time))
        f2 = float(formant.get_value_at_time(2, sample_time))
        if np.isnan(f1) or np.isnan(f2) or f1 < 150 or f1 > 1200 or f2 < 500 or f2 > 3500:
            return {
                'exploratory': True,
                'usable': False,
                'reason': 'implausible_formants'
            }
        samples.append({
            'pct': pct,
            'f1': round(f1, 1),
            'f2': round(f2, 1)
        })

    mid_time = nucleus_start + ((nucleus_end - nucleus_start) / 2.0)
    mid_pitch = float(pitch.get_value_at_time(mid_time))
    if np.isnan(mid_pitch) or mid_pitch <= 0:
        mid_pitch = 0.0

    return {
        'exploratory': True,
        'usable': True,
        'reason': None,
        'nucleusStart': round(float(nucleus_start), 3),
        'nucleusEnd': round(float(nucleus_end), 3),
        'samples': samples,
        'midPitch': round(mid_pitch, 1)
    }

def detect_syllables(
    sound,
    pitch,
    intensity,
    expected_syllables=None,
    allow_expected_adjustment=True,
):
    """
    Detect syllables using multi-cue adaptive approach.
    
    Algorithm:
    1. Find speech region
    2. Detect intensity peaks with adaptive thresholds (retry if missing)
    3. Validate against expected count
    4. Split oversized syllables using pitch transitions
    5. Refine boundaries
    
    Based on de Jong & Wempe (2009) with enhancements.
    """
    config = AnalysisConfig()
    
    int_times = np.array(intensity.xs())
    int_values = np.array([intensity.get_value(t) for t in int_times])
    int_values = np.nan_to_num(int_values, nan=0.0)
    
    # Filter only voiced parts for threshold calculation
    voiced_intensities = int_values[int_values > 0]
    
    if len(voiced_intensities) == 0:
        return []

    median_intensity = np.median(voiced_intensities)
    max_intensity = np.max(int_values)
    min_safe_threshold = max_intensity - 25
    
    # Find speech region
    initial_threshold = median_intensity - config.THRESHOLD_LEVELS[0]
    speech_threshold = max(initial_threshold, min_safe_threshold)
    
    speech_indices = np.where(int_values > speech_threshold)[0]
    if len(speech_indices) == 0:
        return []
    
    speech_start_idx = max(0, speech_indices[0] - 2)
    speech_end_idx = min(len(int_values) - 1, speech_indices[-1] + 2)
    speech_start = float(int_times[speech_start_idx])
    speech_end = float(int_times[speech_end_idx])
    
    # === ADAPTIVE THRESHOLD RETRY ===
    # Try progressively lower thresholds to find weak syllables
    best_peaks = []
    peak_attempts = []
    
    for threshold_offset in config.THRESHOLD_LEVELS:
        current_threshold = max(median_intensity - threshold_offset, min_safe_threshold)
        
        peaks = find_intensity_peaks(
            int_times, int_values, current_threshold, 
            speech_start_idx, speech_end_idx, pitch,
            min_dip=config.SENSITIVE_DIP_THRESHOLD if threshold_offset > 2 else config.INITIAL_DIP_THRESHOLD
        )
        peak_attempts.append(peaks)

        # Trusted native references can stop once there is enough evidence for
        # canonical alignment. Independent learner analysis must inspect every
        # threshold before choosing a stable result.
        if (
            allow_expected_adjustment
            and expected_syllables is not None
            and len(peaks) >= expected_syllables
        ):
            best_peaks = peaks
            break
        
        # Keep the best attempt
        if len(peaks) > len(best_peaks):
            best_peaks = peaks

    if not allow_expected_adjustment and expected_syllables is not None:
        hinted_peaks = find_intensity_peaks(
            int_times,
            int_values,
            max(median_intensity - config.THRESHOLD_LEVELS[-1], min_safe_threshold),
            speech_start_idx,
            speech_end_idx,
            pitch,
            min_dip=config.HINTED_DIP_THRESHOLD,
        )
        peak_attempts.append(hinted_peaks)
    
    if allow_expected_adjustment and expected_syllables is not None:
        peaks = best_peaks
    else:
        non_empty_attempts = [attempt for attempt in peak_attempts if attempt]
        exact_attempts = [
            attempt for attempt in non_empty_attempts
            if expected_syllables is not None and len(attempt) == expected_syllables
        ]
        if exact_attempts:
            peaks = exact_attempts[-1]
        elif non_empty_attempts:
            consensus_count = int(np.median([len(attempt) for attempt in non_empty_attempts]))
            matching_attempts = [
                attempt for attempt in non_empty_attempts
                if len(attempt) == consensus_count
            ]
            peaks = matching_attempts[-1] if matching_attempts else non_empty_attempts[-1]
        else:
            peaks = []


    # Adjust based on expected count (only if still needed)
    if allow_expected_adjustment and expected_syllables and len(peaks) != expected_syllables:
        peaks = adjust_peaks_to_expected(
            peaks,
            expected_syllables,
            int_times,
            int_values,
            speech_start,
            speech_end,
            pitch_obj=pitch,
        )
    
    # Convert to syllables
    syllables = peaks_to_syllables(peaks, pitch, int_times, int_values, speech_start, speech_end, sound)
    
    # === SPLIT OVERSIZED SYLLABLES ===
    # === SPLIT OVERSIZED SYLLABLES ===
    alignment_count = expected_syllables if allow_expected_adjustment else None
    syllables = split_oversized_syllables(
        syllables,
        alignment_count,
        pitch,
        intensity,
        int_times,
        int_values,
    )
    
    # === PRUNE TO EXPECTED COUNT ===
    # Splitting might have created too many syllables (or noise was detected)
    if allow_expected_adjustment and expected_syllables and len(syllables) > expected_syllables:
        syllables = prune_syllables_to_expected(syllables, expected_syllables)
        
    return syllables

def prune_syllables_to_expected(syllables, expected_count):
    """
    Reduce syllable list to expected count by removing least likely candidates.
    Prioritizes keeping:
    1. Voiced syllables
    2. Longer syllables
    3. Louder syllables
    """
    if len(syllables) <= expected_count:
        return syllables
        
    # Calculate global maxes for normalization
    max_dur = max(s['duration'] for s in syllables) or 1
    max_int = max(s['intensity'] for s in syllables) or 1
    
    while len(syllables) > expected_count:
        # Score each syllable
        scored = []
        for i, s in enumerate(syllables):
            # Combined score
            dur_score = s['duration'] / max_dur
            int_score = s['intensity'] / max_int
            pitch_bonus = 0.5 if s['avgPitch'] > 0 else 0
            
            # Penalties
            # Penalty for being very short
            short_penalty = 0
            if s['duration'] < 0.08:
                short_penalty = 0.3
                
            total_score = (dur_score * 1.0) + (int_score * 0.5) + pitch_bonus - short_penalty
            scored.append((i, total_score))
            
        # Find index with lowest score
        scored.sort(key=lambda x: x[1])
        worst_idx = scored[0][0]
        
        # Remove it
        syllables.pop(worst_idx)
        
    # Re-index syllables
    for i, s in enumerate(syllables):
        s['syllable'] = i + 1
        
    return syllables

def find_intensity_peaks(times, values, threshold, start_idx, end_idx, pitch_obj, min_dip=2.0):
    """Find intensity peaks that are preceded by a dip (De Jong & Wempe)."""
    
    # min_dip: dB drop required to start a new syllable (configurable)
    MIN_DIP = min_dip
    
    candidates = []
    # Find all local maxima > threshold using window of 2 on each side
    for i in range(start_idx + 2, end_idx - 2):
        val = values[i]
        if val > threshold:
             if (val >= values[i-1] and val >= values[i-2] and
                 val >= values[i+1] and val >= values[i+2]):
                 # Additional check: Voicing
                 # Peak must be voiced to be a syllable nucleus
                 t = times[i]
                 p = pitch_obj.get_value_at_time(t)
                 if not np.isnan(p) and p > 0:
                     candidates.append((i, val, t))

    if not candidates:
        return []
        
    # Dip Detection Logic
    # 1. Start with the highest intensity peak (global max) as a certain syllable
    candidates.sort(key=lambda x: x[1], reverse=True)
    valid_peaks = [candidates[0]]
    
    # 2. Iteratively add other peaks if they are separated by a dip
    for cand in candidates[1:]:
        cand_idx, cand_val, cand_time = cand
        
        # Check against all currently valid peaks
        is_distinct = True
        for valid in valid_peaks:
            valid_idx, valid_val, valid_time = valid
            
            # Find the minimum intensity between candidate and this valid peak
            # To determine if they are merged or distinct
            start, end = sorted([cand_idx, valid_idx])
            min_between = np.min(values[start:end+1])
            
            # We need a dip of at least MIN_DIP relative to the *smaller* of the two peaks
            # If the dip is shallow, they belong to the same syllable
            lower_peak_val = min(cand_val, valid_val)
            dip_depth = lower_peak_val - min_between
            
            if dip_depth < MIN_DIP:
                is_distinct = False
                break
        
        if is_distinct:
            valid_peaks.append(cand)
            
    # Convert back to dict format and sort by time
    result = []
    for p in valid_peaks:
        result.append({
            'index': p[0],
            'time': float(p[2]),
            'intensity': float(p[1])
        })
        
    time_sorted = sorted(result, key=lambda x: x['time'])
    consolidated = []
    for peak in time_sorted:
        if (
            consolidated
            and peak['time'] - consolidated[-1]['time'] < AnalysisConfig.MIN_NUCLEUS_SEPARATION
        ):
            if peak['intensity'] > consolidated[-1]['intensity']:
                consolidated[-1] = peak
            continue
        consolidated.append(peak)

    speech_start = float(times[start_idx])
    speech_end = float(times[end_idx])
    return filter_weak_edge_peaks(consolidated, speech_start, speech_end)


def filter_weak_edge_peaks(peaks, speech_start, speech_end):
    """Remove only low-energy onset/release peaks, independent of lexical count."""
    filtered = list(peaks)
    if len(filtered) < 2:
        return filtered

    first, second = filtered[0], filtered[1]
    if (
        first['time'] - speech_start <= AnalysisConfig.EDGE_NUCLEUS_WINDOW
        and second['time'] - first['time']
        <= AnalysisConfig.EDGE_NEIGHBOR_MAX_SEPARATION
        and second['intensity'] - first['intensity']
        >= AnalysisConfig.WEAK_EDGE_NUCLEUS_MARGIN_DB
    ):
        filtered.pop(0)

    if len(filtered) < 2:
        return filtered

    penultimate, last = filtered[-2], filtered[-1]
    if (
        speech_end - last['time'] <= AnalysisConfig.EDGE_NUCLEUS_WINDOW
        and last['time'] - penultimate['time']
        <= AnalysisConfig.EDGE_NEIGHBOR_MAX_SEPARATION
        and penultimate['intensity'] - last['intensity']
        >= AnalysisConfig.WEAK_EDGE_NUCLEUS_MARGIN_DB
    ):
        filtered.pop()

    return filtered

def adjust_peaks_to_expected(
    peaks,
    expected,
    times,
    values,
    speech_start,
    speech_end,
    pitch_obj=None,
):
    """Adjust detected peaks to match expected syllable count."""
    peaks = list(peaks)
    
    if len(peaks) == expected:
        return peaks
    
    if len(peaks) > expected:
        # Keep strongest, well-distributed peaks
        peaks_sorted = sorted(peaks, key=lambda p: p['intensity'], reverse=True)
        selected = []
        speech_duration = speech_end - speech_start
        min_gap = speech_duration / (expected + 1) * 0.5
        
        for peak in peaks_sorted:
            if len(selected) >= expected:
                break
            too_close = any(abs(peak['time'] - s['time']) < min_gap for s in selected)
            if not too_close:
                selected.append(peak)
        
        return sorted(selected, key=lambda p: p['time'])
    
    if len(peaks) < expected:
        speech_duration = max(0.0, speech_end - speech_start)
        min_spacing = max(
            AnalysisConfig.MIN_SYLLABLE_DURATION,
            speech_duration / max(1, expected * 3),
        )

        # Add only acoustically supported nuclei. Prefer local intensity maxima
        # near the center of the widest gap; if a reduced vowel has no local
        # maximum, use the closest voiced positive-intensity frame.
        while len(peaks) < expected:
            all_times = [speech_start] + [p['time'] for p in peaks] + [speech_end]
            all_times.sort()
            gaps = sorted(
                (
                    (all_times[index + 1] - all_times[index], all_times[index], all_times[index + 1])
                    for index in range(len(all_times) - 1)
                ),
                reverse=True,
            )
            added_peak = None

            for _, gap_start, gap_end in gaps:
                candidate_indices = []
                for index, time_value in enumerate(times):
                    time_value = float(time_value)
                    if not (gap_start + min_spacing <= time_value <= gap_end - min_spacing):
                        continue
                    if any(abs(time_value - float(peak['time'])) < min_spacing for peak in peaks):
                        continue
                    intensity_value = values[index]
                    if not _finite_number(intensity_value) or float(intensity_value) <= 0:
                        continue
                    if pitch_obj is not None:
                        pitch_value = pitch_obj.get_value_at_time(time_value)
                        if not _finite_number(pitch_value) or float(pitch_value) <= 0:
                            continue
                    candidate_indices.append(index)

                if not candidate_indices:
                    continue

                local_maxima = [
                    index for index in candidate_indices
                    if 0 < index < len(values) - 1
                    and float(values[index]) >= float(values[index - 1])
                    and float(values[index]) >= float(values[index + 1])
                ]
                pool = local_maxima or candidate_indices
                midpoint = (gap_start + gap_end) / 2.0
                selected_index = min(
                    pool,
                    key=lambda index: (
                        abs(float(times[index]) - midpoint),
                        -float(values[index]),
                    ),
                )
                added_peak = {
                    'index': selected_index,
                    'time': float(times[selected_index]),
                    'intensity': float(values[selected_index]),
                }
                peaks.append(added_peak)
                break

            if added_peak is None:
                break
            peaks.sort(key=lambda p: p['time'])

        return peaks
    
    return peaks


def split_oversized_syllables(syllables, expected_count, pitch, intensity, int_times, int_values):
    """
    Split syllables that exceed MAX_SYLLABLE_DURATION (0.45s).
    Uses pitch transitions (15Hz) and intensity minima for split points.
    """
    config = AnalysisConfig()
    
    # If the recognizer already produced the target number of spans, splitting
    # an oversized span would manufacture an extra candidate that is later
    # pruned. That creates artificial gaps and discards real syllable audio
    # (for example, the unvoiced /tri/ interval in the industrial sample).
    if not syllables or not expected_count or len(syllables) >= expected_count:
        return syllables
    
    # Calculate adaptive max duration
    total_duration = sum(s['duration'] for s in syllables)
    expected_avg = total_duration / expected_count
    max_duration = min(expected_avg * 2.5, config.MAX_SYLLABLE_DURATION)
    
    result = []
    
    for syl in syllables:
        if syl['duration'] <= max_duration:
            result.append(syl)
            continue
        
        # Syllable is oversized - split it
        num_splits = max(2, int(np.ceil(syl['duration'] / max_duration)))
        
        # Strategy 1: Find pitch transitions
        boundaries = find_pitch_transitions(
            pitch, syl['startTime'], syl['endTime'], 
            config.PITCH_TRANSITION_THRESHOLD
        )
        
        if boundaries and len(boundaries) >= num_splits - 1:
            split_syls = split_at_boundaries(syl, boundaries[:num_splits-1], pitch, intensity)
            result.extend(split_syls)
            continue
        
        # Strategy 2: Find intensity minima
        start_idx = int(np.searchsorted(int_times, syl['startTime']))
        end_idx = int(np.searchsorted(int_times, syl['endTime']))
        
        if end_idx > start_idx:
            intensity_boundaries = find_intensity_minima(
                int_times[start_idx:end_idx], 
                int_values[start_idx:end_idx],
                num_splits - 1
            )
            
            if intensity_boundaries:
                split_syls = split_at_boundaries(syl, intensity_boundaries, pitch, intensity)
                result.extend(split_syls)
                continue
        
        # Strategy 3: Equal time division (fallback)
        split_syls = split_equally(syl, num_splits, pitch, intensity)
        result.extend(split_syls)
    
    return result


def find_pitch_transitions(pitch, start_time, end_time, threshold_hz):
    """
    Find points where pitch changes significantly (>threshold_hz).
    Based on Tepperman & Narayanan (2005).
    """
    boundaries = []
    window_size = 0.03  # 30ms
    step = 0.01
    
    prev_avg_pitch = None
    
    t = start_time + window_size
    while t < end_time - window_size:
        # Get average pitch in window
        pitches = []
        for dt in np.arange(-window_size/2, window_size/2, 0.005):
            p = pitch.get_value_at_time(t + dt)
            if not np.isnan(p) and p > 0:
                pitches.append(p)
        
        if pitches:
            avg_pitch = np.mean(pitches)
            
            if prev_avg_pitch is not None:
                change = abs(avg_pitch - prev_avg_pitch)
                if change > threshold_hz:
                    boundaries.append(t)
            
            prev_avg_pitch = avg_pitch
        
        t += step
    
    return boundaries


def find_intensity_minima(times, values, num_boundaries):
    """Find local intensity minima that could be syllable boundaries."""
    if len(values) < 5:
        return []
    
    # Smooth to reduce noise
    smoothed = uniform_filter1d(values.astype(float), size=5)  # type: ignore
    
    minima = []
    
    for i in range(2, len(smoothed) - 2):
        if (smoothed[i] < smoothed[i-1] and smoothed[i] < smoothed[i+1] and
            smoothed[i] < smoothed[i-2] and smoothed[i] < smoothed[i+2]):
            
            # Calculate dip depth
            left_max = np.max(smoothed[max(0, i-10):i])
            right_max = np.max(smoothed[i+1:min(len(smoothed), i+11)])
            dip_depth = min(left_max, right_max) - smoothed[i]
            
            if dip_depth >= 1.0:  # Minimum 1dB dip
                minima.append({
                    'time': float(times[i]),
                    'depth': dip_depth
                })
    
    # Sort by depth and return the deepest ones
    minima.sort(key=lambda x: x['depth'], reverse=True)
    return [m['time'] for m in minima[:num_boundaries]]


def split_at_boundaries(syllable, boundaries, pitch, intensity):
    """Split a syllable at specified boundary times."""
    all_times = [syllable['startTime']] + sorted(boundaries) + [syllable['endTime']]
    
    result = []
    for i in range(len(all_times) - 1):
        new_syl = create_syllable_segment(all_times[i], all_times[i + 1], pitch, intensity)
        result.append(new_syl)
    
    return result


def split_equally(syllable, num_parts, pitch, intensity):
    """Split a syllable into equal time segments (fallback)."""
    part_duration = syllable['duration'] / num_parts
    
    result = []
    for i in range(num_parts):
        start = syllable['startTime'] + i * part_duration
        end = start + part_duration
        
        new_syl = create_syllable_segment(start, end, pitch, intensity)
        result.append(new_syl)
    
    return result


def create_syllable_segment(start_time, end_time, pitch, intensity):
    """Create a syllable dictionary for a time segment."""
    # Calculate pitch statistics
    pitches = []
    t = start_time
    while t <= end_time:
        p = pitch.get_value_at_time(t)
        if not np.isnan(p) and p > 0:
            pitches.append(p)
        t += 0.005
    
    # Get intensity at midpoint
    mid_time = (start_time + end_time) / 2
    mid_intensity = intensity.get_value(mid_time)
    
    return {
        'startTime': round(start_time, 3),
        'endTime': round(end_time, 3),
        'duration': round(end_time - start_time, 3),
        'avgPitch': round(float(np.mean(pitches)), 1) if pitches else 0,
        'maxPitch': round(float(np.max(pitches)), 1) if pitches else 0,
        'intensity': round(float(mid_intensity), 2) if not np.isnan(mid_intensity) else 0
    }

def measure_vowel_interval(sound, start_time, end_time, pitch_obj):
    """
    Measure duration and time boundaries of voiced (vowel) portion within a syllable.
    Returns (voiced_duration, vowel_start, vowel_end).
    """
    voiced_duration: float = 0.0
    time_step = 0.002  # 2ms resolution
    first_voiced = None
    last_voiced = None
    
    t = start_time
    while t < end_time:
        pitch_val = pitch_obj.get_value_at_time(t)
        if not np.isnan(pitch_val) and pitch_val > 0:
            voiced_duration += time_step
            if first_voiced is None:
                first_voiced = t
            last_voiced = t
        t += time_step

    v_start = round(first_voiced, 3) if first_voiced is not None else round(start_time, 3)
    v_end = round(last_voiced + time_step, 3) if last_voiced is not None else round(end_time, 3)
    return round(voiced_duration, 3), v_start, v_end

def measure_vowel_duration(sound, start_time, end_time, pitch_obj):
    """
    Measure duration of voiced (vowel) portion within a syllable.
    """
    dur, _, _ = measure_vowel_interval(sound, start_time, end_time, pitch_obj)
    return dur

def peaks_to_syllables(peaks, pitch, int_times, int_values, speech_start, speech_end, sound):
    """
    Convert peaks to syllable objects using MULTI-CUE boundary detection.
    
    Uses BoundaryDetector to combine:
    - Voicing transitions (40%)
    - Spectral centroid changes (30%)
    - Intensity minima (20%)
    - Amplitude envelope changes (10%)
    
    This fixes the diphthong boundary problem where intensity minima
    fall within vowels like /eɪ/ and /oʊ/.
    """
    if not peaks:
        return []
    
    # Get intensity object from sound
    intensity = sound.to_intensity(minimum_pitch=75, time_step=0.01)
    
    # Initialize boundary detector with all cues
    detector = None
    try:
        detector = BoundaryDetector(sound, pitch, intensity)
        use_multicue = True
    except Exception as e:
        print(f"BoundaryDetector init failed, using intensity-only fallback: {e}")
        use_multicue = False
    
    syllables = []
    config = AnalysisConfig()
    
    # Find boundaries between each pair of peaks
    boundaries = [speech_start]
    boundary_debug = []
    
    for i in range(len(peaks) - 1):
        current_peak = peaks[i]
        next_peak = peaks[i + 1]
        
        if use_multicue and detector is not None:
            # Use multi-cue detection
            result = detector.find_boundary(current_peak['time'], next_peak['time'])
            candidate_time = result['time']
            boundary_debug.append(result)
        else:
            # Fallback: intensity minimum only
            start_idx = current_peak['index']
            end_idx = next_peak['index']
            search_region = int_values[start_idx:end_idx+1]
            min_idx_in_region = np.argmin(search_region)
            min_idx = start_idx + min_idx_in_region
            candidate_time = float(int_times[min_idx])
            boundary_debug.append({'time': candidate_time, 'cues': {'intensity_only': {'time': candidate_time, 'confidence': 1.0}}})
        
        # === VOWEL-END CLAMPING ===
        # Prevent onset clusters (/pr/, /tr/, /mbr/) from leaking into previous syllable
        syl_start = boundaries[-1] if boundaries else speech_start
        clamped_time, vowel_end = clamp_boundary_to_vowel_end(
            candidate_time, 
            current_peak['time'],
            syl_start,
            pitch, intensity, int_times, int_values, config
        )
        
        # Log if clamping was applied
        if abs(clamped_time - candidate_time) > 0.01:
            print(f"  [CLAMP] Boundary {i+1}: {candidate_time:.3f}s → {clamped_time:.3f}s (vowel_end: {vowel_end:.3f}s)")
        
        boundaries.append(clamped_time)

    # The final span otherwise runs to speech_end, which includes trailing
    # padding and any low-energy out-breath. Pull it back off silence so the
    # last syllable's duration reflects real speech.
    final_end = trim_trailing_silence(
        boundaries[-1], speech_end, peaks[-1]['time'],
        pitch, intensity, int_times, int_values, config
    )
    boundaries.append(final_end)

    # Debug logging
    print("\n" + "="*70)
    print("MULTI-CUE SYLLABLE BOUNDARY DETECTION")
    print("="*70)
    
    for i, debug in enumerate(boundary_debug):
        print(f"\nBoundary {i+1} (between peaks {i+1} and {i+2}):")
        print(f"  → Final boundary: {debug['time']:.3f}s")
        if 'cues' in debug and not debug['cues'].get('intensity_only'):
            for cue_name, cue_data in debug['cues'].items():
                if isinstance(cue_data, dict) and 'time' in cue_data:
                    if cue_data['time'] is not None:
                        conf = cue_data.get('confidence', 'N/A')
                        print(f"    {cue_name}: {cue_data['time']:.3f}s (conf: {conf:.2f})" if isinstance(conf, float) else f"    {cue_name}: {cue_data['time']:.3f}s")
                    else:
                        print(f"    {cue_name}: N/A")
    
    # Convert to syllables
    for i, peak in enumerate(peaks):
        start_t = boundaries[i]
        end_t = boundaries[i+1]
        
        # Extract features for this region
        p_max = 0
        valid_pitches = []
        t_indices = [j for j, t in enumerate(int_times) if start_t <= t <= end_t]
        
        if t_indices:
             region_pitches = [pitch.get_value_at_time(int_times[j]) for j in t_indices]
             valid_pitches = [p for p in region_pitches if not np.isnan(p) and p > 0]
             if valid_pitches:
                 p_max = max(valid_pitches)
        
        # Measure vowel (voiced) duration
        vowel_dur = measure_vowel_duration(sound, start_t, end_t, pitch)
        
        syllables.append({
            'syllable': i + 1,
            'startTime': round(start_t, 3),
            'endTime': round(end_t, 3),
            'duration': round(end_t - start_t, 3),
            'vowelDuration': round(vowel_dur, 3),
            'maxPitch': round(float(p_max), 1),
            'avgPitch': round(float(np.mean(valid_pitches)), 1) if valid_pitches else 0,
            'intensity': round(float(peak['intensity']), 1),
            'isStressed': False
        })
    
    print("\n" + "-"*70)
    print("RESULTING SYLLABLES:")
    for i, syl in enumerate(syllables):
        print(f"  Syl {i+1}: {syl['startTime']:.3f}s - {syl['endTime']:.3f}s "
              f"(dur: {syl['duration']:.3f}s)")
    print("="*70 + "\n")
    
    # Determine stressed syllable
    if syllables:
        stressed_idx = determine_stressed_syllable(syllables)
        for i, syl in enumerate(syllables):
            syl['isStressed'] = (i == stressed_idx)
            
    return syllables

def determine_stressed_syllable(syllables):
    """
    Wrapper that calls the corrected version for backwards compatibility.
    """
    return find_stressed_with_corrections(syllables)


def pearson_correlation(x, y):
    """
    Calculate Pearson correlation coefficient between two lists.
    Returns value between -1 and 1.
    """
    n = len(x)
    if n < 2 or len(y) < 2:
        return 0
    
    n = min(len(x), len(y))
    x = x[:n]
    y = y[:n]
    
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    sum_x2 = sum(xi ** 2 for xi in x)
    sum_y2 = sum(yi ** 2 for yi in y)
    
    numerator = n * sum_xy - sum_x * sum_y
    denominator = ((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2)) ** 0.5
    
    return numerator / denominator if denominator != 0 else 0


def normalize_syllable_pattern(syllables):
    """
    Normalize syllables to relative values (0-1) for pattern comparison.
    """
    if not syllables:
        return []
    
    max_pitch = max(s.get('maxPitch', 0) or s.get('avgPitch', 1) for s in syllables) or 1
    has_vowel_dur = any((s.get('vowel_duration') or s.get('vowelDuration')) for s in syllables)
    if has_vowel_dur:
        max_dur = max((s.get('vowel_duration', 0) or s.get('vowelDuration', 0) or s.get('duration', 0)) for s in syllables) or 1
    else:
        max_dur = max(s.get('duration', 0) for s in syllables) or 1
    max_int = max(s.get('intensity', 0) for s in syllables) or 1
    
    return [{
        'pitch_rel': (s.get('maxPitch', 0) or s.get('avgPitch', 0)) / max_pitch,
        'dur_rel': ((s.get('vowel_duration') or s.get('vowelDuration') or s.get('duration', 0)) if has_vowel_dur else s.get('duration', 0)) / max_dur,
        'int_rel': s.get('intensity', 0) / max_int
    } for s in syllables]


def analyze_pattern_match(user_syllables, native_syllables, native_stressed_idx=0):
    """
    Compare user's prosodic PATTERN against native's pattern using correlation.
    Returns pattern match info instead of just "which syllable was stressed."
    """
    if not user_syllables or not native_syllables:
        return {
            'pattern_matches': False,
            'confidence': 0,
            'detected_stressed': 0,
            'feedback': 'Insufficient data'
        }
    
    user_norm = normalize_syllable_pattern(user_syllables)
    native_norm = normalize_syllable_pattern(native_syllables)
    
    min_len = min(len(user_norm), len(native_norm))
    
    # Calculate correlations for each acoustic feature
    pitch_corr = pearson_correlation(
        [u['pitch_rel'] for u in user_norm[:min_len]],
        [n['pitch_rel'] for n in native_norm[:min_len]]
    )
    dur_corr = pearson_correlation(
        [u['dur_rel'] for u in user_norm[:min_len]],
        [n['dur_rel'] for n in native_norm[:min_len]]
    )
    int_corr = pearson_correlation(
        [u['int_rel'] for u in user_norm[:min_len]],
        [n['int_rel'] for n in native_norm[:min_len]]
    )
    
    # Weighted average (pitch matters most for stress perception)
    overall_correlation = (pitch_corr * 0.45) + (dur_corr * 0.35) + (int_corr * 0.20)
    
    # Pattern matches if correlation > 0.7
    pattern_matches = overall_correlation > 0.7
    
    # Generate feedback
    feedback = generate_pattern_feedback(user_norm, native_norm, native_stressed_idx, pitch_corr, dur_corr)
    
    # Also get detected stressed for backwards compatibility
    detected_stressed = find_stressed_with_corrections(user_syllables)
    
    return {
        'pattern_matches': pattern_matches,
        'confidence': int(round(max(0.0, float(overall_correlation)) * 100)),
        'pitch_correlation': round(pitch_corr * 100),
        'duration_correlation': round(dur_corr * 100),
        'intensity_correlation': round(int_corr * 100),
        'detected_stressed': detected_stressed,
        'native_stressed': native_stressed_idx,
        'feedback': feedback
    }


def generate_pattern_feedback(user_norm, native_norm, stressed_idx, p_corr, d_corr):
    """Generate specific, actionable feedback."""
    min_len = min(len(user_norm), len(native_norm))
    
    # Check stressed syllable prominence
    if stressed_idx < min_len:
        user_stressed = user_norm[stressed_idx]
        native_stressed = native_norm[stressed_idx]
        
        user_prominence = (user_stressed['pitch_rel'] + user_stressed['dur_rel']) / 2
        native_prominence = (native_stressed['pitch_rel'] + native_stressed['dur_rel']) / 2
        
        if user_prominence < native_prominence - 0.15:
            return f"Syllable {stressed_idx + 1} needs more emphasis. Raise pitch and hold slightly longer."
    
    # Check over-emphasized syllables
    for i in range(min_len):
        if i == stressed_idx:
            continue
        
        user_prom = (user_norm[i]['pitch_rel'] + user_norm[i]['dur_rel']) / 2
        native_prom = (native_norm[i]['pitch_rel'] + native_norm[i]['dur_rel']) / 2
        
        if user_prom > native_prom + 0.2:
            return f"Syllable {i + 1} is too prominent. Make it shorter and lower pitched."
    
    if d_corr < 0.6:
        return "Your rhythm pattern differs. Match the relative syllable lengths."
    
    if p_corr < 0.6:
        return "Your intonation differs. Follow the native pitch contour."
    
    return "Good pattern match!"


def compute_syllable_prominence_scores(syllables):
    """
    Compute prominence scores per syllable using phonetic corrections (final lengthening penalty,
    initial burst penalty, short duration penalty). Returns (prominence_scores_list, best_idx).
    """
    if not syllables:
        return [], 0
    
    n = len(syllables)
    max_pitch = max(s.get('maxPitch', 0) or s.get('avgPitch', 1) for s in syllables) or 1
    has_vowel_dur = any((s.get('vowel_duration') or s.get('vowelDuration')) for s in syllables)
    if has_vowel_dur:
        max_dur = max((s.get('vowel_duration', 0) or s.get('vowelDuration', 0) or s.get('duration', 0)) for s in syllables) or 1
    else:
        max_dur = max(s.get('duration', 0) for s in syllables) or 1
    max_int = max(s.get('intensity', 0) for s in syllables) or 1
    
    scores = []
    best_idx = 0
    best_score = -1
    
    for i, s in enumerate(syllables):
        p_score = (s.get('maxPitch', 0) or s.get('avgPitch', 0)) / max_pitch
        dur_val = (s.get('vowel_duration') or s.get('vowelDuration') or s.get('duration', 0)) if has_vowel_dur else s.get('duration', 0)
        d_score = dur_val / max_dur
        i_score = s.get('intensity', 0) / max_int
        
        # === PHONETIC CORRECTIONS ===
        # 1. Final syllable penalty (30% - more aggressive for final lengthening)
        if i == n - 1 and n > 1:
            d_score *= 0.70
        
        # 2. Initial syllable intensity penalty (speakers often start strong)
        if i == 0 and n > 2:
            i_score *= 0.85
        
        # 3. Penalize very short syllables with high pitch (often artifacts)
        if s.get('duration', 0) < 0.1:
            p_score *= 0.8
        
        # Weighted: Pitch (0.50) > Duration (0.30) > Intensity (0.20)
        total = round((p_score * 0.50) + (d_score * 0.30) + (i_score * 0.20), 3)
        scores.append(total)
        
        if total > best_score:
            best_score = total
            best_idx = i
            
    return scores, best_idx


def find_stressed_with_corrections(syllables):
    """
    Find stressed syllable with phonetic corrections.
    Used for edge cases and backwards compatibility.
    """
    if not syllables:
        return 0
    _, best_idx = compute_syllable_prominence_scores(syllables)
    return best_idx

if __name__ == '__main__':
    # Use 8081 to match config.js default
    port = int(os.environ.get('PORT', 8081))
    host = str(os.environ.get('HOST', '127.0.0.1')).strip() or '127.0.0.1'
    use_https = os.environ.get('USE_HTTPS', 'true').lower() == 'true'
    
    # For local development with HTTPS (Chrome requires it)
    if use_https:
        import ssl
        current_dir = os.path.dirname(os.path.abspath(__file__))
        potential_root = current_dir
        found_root = False
        
        # Look for package.json or localhost.pem to find project root
        print(f"🔍 Searching for project root starting from: {current_dir}")
        for i in range(5):
            if os.path.exists(os.path.join(potential_root, "package.json")) or \
               os.path.exists(os.path.join(potential_root, "localhost.pem")):
                found_root = True
                break
            # Optimization: stop if we hit a drive root
            parent = os.path.dirname(potential_root)
            if parent == potential_root:
                break
            potential_root = parent
            
        PROJECT_ROOT = potential_root if found_root else current_dir
        print(f"✅ Project root detected at: {PROJECT_ROOT}")
        
        # Try mkcert filenames first (as generated by setup-trusted-certs.bat)
        cert_choices = [
            ("localhost+2.pem", "localhost+2-key.pem"),
            ("localhost.pem", "localhost-key.pem"),
            ("cert.pem", "key.pem")
        ]
        
        cert_file, key_file = None, None
        for c, k in cert_choices:
            cp = os.path.join(PROJECT_ROOT, c)
            kp = os.path.join(PROJECT_ROOT, k)
            if os.path.exists(cp) and os.path.exists(kp):
                cert_file, key_file = cp, kp
                print(f"💎 Found SSL certificates: {c}")
                break
        
        if cert_file and key_file:
            print(f"🔒 Starting HTTPS server on port {port}")
            try:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(certfile=cert_file, keyfile=key_file)
                app.run(host=host, port=port, debug=False, ssl_context=context)
            except Exception as e:
                print(f"❌ SSL Error: Could not load certificate chain: {e}")
                print(f"   Falling back to HTTP on http://localhost:{port}")
                app.run(host=host, port=port, debug=False)
        else:
            print(f"⚠️  SSL certificates not found in {PROJECT_ROOT}")
            print("   Please run setup-trusted-certs.bat in the project root.")
            print(f"   Falling back to HTTP on http://localhost:{port}")
            app.run(host=host, port=port, debug=False)
    else:
        print(f"🌐 Starting HTTP server on http://localhost:{port} (USE_HTTPS is false)")
        app.run(host=host, port=port, debug=False)
