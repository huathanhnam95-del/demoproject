from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import json
from pathlib import Path
import sys
try:
    import parselmouth  # type: ignore
except ImportError:
    import praat_parselmouth as parselmouth  # type: ignore
import numpy as np
import tempfile
import os
import requests as http_requests  # Renamed to avoid conflict with flask.request
import re
try:
    from .pronunciation_reference import (
        ALGORITHM_VERSION as PRONUNCIATION_ALGORITHM_VERSION,
        SCHEMA_VERSION as PRONUNCIATION_SCHEMA_VERSION,
        build_pronunciation_reference,
        build_pronunciation_variant,
    )
except ImportError:
    from pronunciation_reference import (  # type: ignore
        ALGORITHM_VERSION as PRONUNCIATION_ALGORITHM_VERSION,
        SCHEMA_VERSION as PRONUNCIATION_SCHEMA_VERSION,
        build_pronunciation_reference,
        build_pronunciation_variant,
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
import time

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


app: Flask = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_UPLOAD_BYTES', 10 * 1024 * 1024))

# CORS configuration - default to production BEL and local origins unless explicitly overridden
# Using late initialization pattern to avoid type mismatch in some IDEs
cors = CORS()
cors_origins_env = str(os.environ.get('CORS_ORIGINS', '')).strip()
cors_origins = [origin.strip() for origin in cors_origins_env.split(',') if origin.strip()] if cors_origins_env else [
    'https://betterenglishlearning.com',
    'https://www.betterenglishlearning.com',
    'http://localhost:8443',
    'https://localhost:8443',
    'http://127.0.0.1:8443',
    'https://127.0.0.1:8443'
]
# type: ignore
cors.init_app(app, origins=cors_origins, methods=['GET', 'POST', 'OPTIONS'], allow_headers=['Content-Type'])

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
            '/analyze-url': 'POST - Analyze audio from URL'
        }
    })

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'schemaVersion': PRONUNCIATION_SCHEMA_VERSION,
        'algorithmVersion': PRONUNCIATION_ALGORITHM_VERSION,
        'analysisVersion': 'pronunciation-analysis-v2',
        'deploymentVersion': get_deployment_version(),
        'pronunciationV3Mode': _PRONUNCIATION_V3_MODE,
    })

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


def score_lexical_stress_v2(syllables, confidence_threshold=None):
    """Score stress from within-recording relative pitch, duration, and intensity."""
    if confidence_threshold is None:
        confidence_threshold = AnalysisConfig.STRESS_CONFIDENCE_THRESHOLD
    syllables = list(syllables or [])
    if not syllables:
        return {
            'primaryStress': None,
            'confidence': 0.0,
            'rateable': False,
            'reasons': ['NO_SPEECH'],
            'scores': [],
        }
    if len(syllables) == 1:
        return {
            'primaryStress': 0,
            'confidence': 1.0,
            'rateable': True,
            'reasons': [],
            'scores': [1.0],
        }

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
        return {
            'primaryStress': None,
            'confidence': 0.0,
            'rateable': False,
            'reasons': ['INSUFFICIENT_STRESS_EVIDENCE'],
            'scores': [],
        }

    pitch_median = float(np.median(pitches))
    duration_median = float(np.median(durations))
    intensity_median = float(np.median(intensities))
    pitch_semitones = 12.0 * np.log2(pitches / pitch_median)
    duration_prominence = np.log2(durations / duration_median)
    intensity_prominence = intensities - intensity_median
    scores = (
        pitch_semitones * AnalysisConfig.STRESS_WEIGHT_PITCH
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
    return {
        'primaryStress': best_index if rateable else None,
        'confidence': confidence,
        'rateable': rateable,
        'reasons': [] if rateable else ['LOW_STRESS_CONFIDENCE'],
        'scores': [round(float(value), 4) for value in scores],
        'features': {
            'pitchSemitones': [round(float(value), 4) for value in pitch_semitones],
            'relativeDuration': [round(float(value), 4) for value in duration_prominence],
            'relativeIntensityDb': [round(float(value), 4) for value in intensity_prominence],
        },
    }


def build_analysis_v2_response(raw_analysis, expected_syllable_count=None, native=False):
    syllables = list(raw_analysis.get('syllables') or [])
    candidates = [_candidate_from_syllable(syllable) for syllable in syllables]
    if native:
        segmentation = select_native_acoustic_candidates(
            candidates,
            expected_syllable_count,
        )
    else:
        evidence = [
            item for item in candidates
            if item['voiced'] and _finite_number(item['intensity'])
        ]
        segmentation = {
            'rawCandidateCount': len(candidates),
            'evidenceCandidateCount': len(evidence),
            'selectedCount': len(evidence),
            'method': 'independent-acoustic-detection',
            'confidence': round(
                float(np.mean([item['confidence'] for item in evidence])),
                3,
            ) if evidence else 0.0,
            'conflicts': [] if evidence else ['NO_SPEECH'],
            'selected': evidence,
        }

    selected_syllables = [item['syllable'] for item in segmentation['selected']]
    reasons = list(segmentation['conflicts'])
    stress = score_lexical_stress_v2(selected_syllables)
    rateable = bool(selected_syllables) and not reasons
    primary_stress = stress['primaryStress']
    public_segmentation = {
        key: value
        for key, value in segmentation.items()
        if key != 'selected'
    }
    pitch_values = list((raw_analysis.get('pitch') or {}).get('values') or [])
    intensity_values = list((raw_analysis.get('intensity') or {}).get('values') or [])
    has_native_contours = bool(
        native
        and any(_finite_number(value) and float(value) > 0 for value in pitch_values)
        and any(_finite_number(value) for value in intensity_values)
    )
    return {
        'analysisVersion': 'pronunciation-analysis-v2',
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
        'pitch': raw_analysis.get('pitch') or {'times': [], 'values': []},
        'intensity': raw_analysis.get('intensity') or {'times': [], 'values': []},
        'duration': raw_analysis.get('duration', 0),
        'sampleRate': raw_analysis.get('sampleRate'),
        'capabilities': {
            'showNativeGraphs': has_native_contours,
        },
    }


def analyze_audio_v2(audio_path, expected_syllable_count=None, native=False):
    # Native dictionary audio may be aligned to its trusted canonical count.
    # Learner audio uses that count only to select an acoustically observed
    # threshold result; it must never synthesize or prune nuclei to force a match.
    if native:
        raw_analysis = analyze_audio(
            audio_path,
            expected_syllables=expected_syllable_count,
        )
    else:
        raw_analysis = analyze_audio(
            audio_path,
            expected_syllables=expected_syllable_count,
            allow_expected_adjustment=False,
        )
    return build_analysis_v2_response(
        raw_analysis,
        expected_syllable_count=expected_syllable_count,
        native=native,
    )


@app.route('/analyze/v2', methods=['POST'])
def analyze_v2():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    audio_file = request.files['audio']
    expected_syllable_count = request.form.get('expected_syllables', type=int)
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
    if not audio_url.startswith('https://media.merriam-webster.com/'):
        return jsonify({'error': 'Invalid audio URL'}), 400
    if not re.fullmatch(r'[0-9a-f]{16}', variant_id):
        return jsonify({'error': 'Valid variantId is required'}), 400
    if not isinstance(expected_count, int) or expected_count < 1:
        return jsonify({'error': 'Valid expectedSyllableCount is required'}), 400

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
            )
            result['variantId'] = variant_id
            result['canonicalSyllableCount'] = expected_count
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

# ============================================
# V3 PRONUNCIATION ANALYSIS ENDPOINT
# ============================================

_V3_HARD_TIMEOUT_SECONDS = 18


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
    """Build the comparison block for v3 response when reference_ipa is provided."""
    if not reference_ipa:
        return None
    ref_phonemes = list(reference_ipa) if isinstance(reference_ipa, str) else list(reference_ipa or [])
    edit_ops = _phoneme_align_edit_ops(ref_phonemes, observed_phonemes)
    count_delta = observed_syllable_count - (expected_syllables or 0) if expected_syllables else None
    return {
        'count_delta': count_delta,
        'edit_operations': edit_ops,
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
            'start': s.get('startTime', 0),
            'end': s.get('endTime', 0),
            'duration': s.get('duration', 0),
        } for s in syllables],
        'syllable_count': syllable_count,
        'comparison': comparison,
        'pitch': v2_result.get('pitch', {'times': [], 'values': []}),
        'intensity': v2_result.get('intensity', {'times': [], 'values': []}),
        'total_duration': v2_result.get('duration', 0),
        'sample_rate': v2_result.get('sampleRate'),
        'capabilities': {
            'graphs': True,
            'syllable_duration': True,
            'phoneme_alignment': False,
        },
    }


def _build_v3_active_response(praat_result, phoneme_result, reference_ipa=None, expected_syllables=None):
    """Build v3 response from phoneme recognition + Praat contours."""
    phonemes = phoneme_result.get('phonemes', [])
    syllables_from_recognizer = phoneme_result.get('syllables', [])
    confidence = phoneme_result.get('confidence', 0.0)
    is_rateable = phoneme_result.get('is_rateable', True)
    quality_reason = phoneme_result.get('quality_reason')
    syllable_count = len(syllables_from_recognizer)

    observed_phoneme_labels = [p.get('label', '') for p in phonemes]
    comparison = _build_v3_comparison(
        reference_ipa, observed_phoneme_labels, syllable_count, expected_syllables,
    )

    return {
        'analysisVersion': 'pronunciation-analysis-v3',
        'mode': 'active',
        'engine': 'ctc-praat',
        'is_rateable': is_rateable,
        'confidence': confidence,
        'quality_reason': quality_reason,
        'degraded': False,
        'observed_phonemes': phonemes,
        'observed_syllables': [{
            'start': s.get('start', 0),
            'end': s.get('end', 0),
            'duration': s.get('end', 0) - s.get('start', 0),
        } for s in syllables_from_recognizer],
        'syllable_count': syllable_count,
        'comparison': comparison,
        'pitch': praat_result.get('pitch', {'times': [], 'values': []}),
        'intensity': praat_result.get('intensity', {'times': [], 'values': []}),
        'total_duration': praat_result.get('duration', 0),
        'sample_rate': praat_result.get('sampleRate'),
        'capabilities': {
            'graphs': True,
            'syllable_duration': True,
            'phoneme_alignment': True,
        },
    }


@app.route('/analyze/v3', methods=['POST'])
def analyze_v3():
    """V3 pronunciation analysis with optional phoneme recognition."""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']
    reference_ipa = request.form.get('reference_ipa')
    expected_syllables = request.form.get('expected_syllables', type=int)

    mode = _PRONUNCIATION_V3_MODE

    # Save audio to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        start_time = time.time()

        if mode == 'off':
            # Pure v2: run Praat only, adapt output to v3 shape
            v2_result = analyze_audio_v2(tmp_path, native=False)
            return jsonify(_adapt_v2_to_v3_response(
                v2_result, mode,
                reference_ipa=reference_ipa,
                expected_syllables=expected_syllables,
            ))

        # shadow or active: run Praat + phoneme recognition concurrently
        try:
            from .phoneme_client import create_phoneme_client
        except ImportError:
            from phoneme_client import create_phoneme_client  # type: ignore

        with open(tmp_path, 'rb') as f:
            wav_bytes = f.read()

        praat_result = None
        phoneme_result = None
        phoneme_error = None

        remaining = max(1, _V3_HARD_TIMEOUT_SECONDS - (time.time() - start_time))

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            praat_future = executor.submit(
                analyze_audio_v2, tmp_path, native=False,
            )
            phoneme_future = executor.submit(
                create_phoneme_client().recognize, wav_bytes,
            )

            try:
                praat_result = praat_future.result(timeout=remaining)
            except Exception as e:
                print(f'V3 Praat analysis error: {e}')
                return jsonify({
                    'error': 'Pronunciation analysis failed',
                    'code': 'V3_PRAAT_FAILED',
                }), 500

            phoneme_remaining = max(1, _V3_HARD_TIMEOUT_SECONDS - (time.time() - start_time))
            try:
                phoneme_result = phoneme_future.result(timeout=phoneme_remaining)
            except concurrent.futures.TimeoutError:
                phoneme_error = 'TIMEOUT'
                print('V3 phoneme recognition timed out')
            except Exception as e:
                phoneme_error = str(e)
                print(f'V3 phoneme recognition error: {e}')

        elapsed = time.time() - start_time
        if elapsed > _V3_HARD_TIMEOUT_SECONDS:
            return jsonify({
                'error': 'Analysis exceeded time limit',
                'code': 'V3_TIMEOUT',
            }), 504

        if mode == 'shadow':
            # Log phoneme results for comparison, but always return v2-adapted
            if phoneme_result and not phoneme_error:
                phoneme_syllable_count = len(phoneme_result.get('syllables', []))
                v2_syllable_count = praat_result.get('observed', {}).get('syllableCount', 0)
                if phoneme_syllable_count != v2_syllable_count:
                    disagreement_log = {
                        'v2_count': v2_syllable_count,
                        'v3_count': phoneme_syllable_count,
                        'disagreement_category': 'omission' if phoneme_syllable_count < v2_syllable_count else 'insertion' if phoneme_syllable_count > v2_syllable_count else 'count-mismatch',
                        'confidence': phoneme_result.get('confidence'),
                        'latency_seconds': elapsed,
                        'quality_reason': phoneme_result.get('quality_reason'),
                        'model_revision': phoneme_result.get('model_revision'),
                        'reference_ipa': reference_ipa,
                    }
                    print(f'V3 shadow disagreement: {json.dumps(disagreement_log)}')
            return jsonify(_adapt_v2_to_v3_response(
                praat_result, mode,
                reference_ipa=reference_ipa,
                expected_syllables=expected_syllables,
            ))

        # mode == 'active'
        if phoneme_error or not phoneme_result:
            # Degrade to v2 contours
            return jsonify(_adapt_v2_to_v3_response(
                praat_result, mode,
                reference_ipa=reference_ipa,
                expected_syllables=expected_syllables,
            ))

        # Check if phoneme recognition is rateable
        if not phoneme_result.get('is_rateable', True):
            return jsonify(_adapt_v2_to_v3_response(
                praat_result, mode,
                reference_ipa=reference_ipa,
                expected_syllables=expected_syllables,
            ))

        return jsonify(_build_v3_active_response(
            praat_result, phoneme_result,
            reference_ipa=reference_ipa,
            expected_syllables=expected_syllables,
        ))

    except Exception as error:
        print(f'V3 analysis error: {error}')
        return jsonify({
            'error': 'Pronunciation analysis v3 unavailable',
            'code': 'V3_ANALYSIS_FAILED',
        }), 500
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


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

def analyze_audio(audio_path, expected_syllables=None, allow_expected_adjustment=True):
    """Main analysis using Parselmouth/Praat"""
    
    # Load sound
    sound = parselmouth.Sound(audio_path)
    duration = float(sound.duration)
    
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
    
    if not syllables or not expected_count:
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

def measure_vowel_duration(sound, start_time, end_time, pitch_obj):
    """
    Measure duration of voiced (vowel) portion within a syllable.
    """
    voiced_duration: float = 0.0
    time_step = 0.002  # 2ms resolution
    
    t = start_time
    while t < end_time:
        pitch_val = pitch_obj.get_value_at_time(t)
        if not np.isnan(pitch_val) and pitch_val > 0:
            voiced_duration += time_step
        t += time_step
        
    return voiced_duration

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
    
    boundaries.append(speech_end)
    
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
    max_dur = max(s.get('duration', 0) for s in syllables) or 1
    max_int = max(s.get('intensity', 0) for s in syllables) or 1
    
    return [{
        'pitch_rel': (s.get('maxPitch', 0) or s.get('avgPitch', 0)) / max_pitch,
        'dur_rel': s.get('duration', 0) / max_dur,
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


def find_stressed_with_corrections(syllables):
    """
    Find stressed syllable with phonetic corrections.
    Used for edge cases and backwards compatibility.
    """
    if not syllables:
        return 0
    
    n = len(syllables)
    max_pitch = max(s.get('maxPitch', 0) or s.get('avgPitch', 1) for s in syllables) or 1
    max_dur = max(s.get('duration', 0) for s in syllables) or 1
    max_int = max(s.get('intensity', 0) for s in syllables) or 1
    
    best_idx = 0
    best_score = -1
    
    for i, s in enumerate(syllables):
        p_score = (s.get('maxPitch', 0) or s.get('avgPitch', 0)) / max_pitch
        d_score = s.get('duration', 0) / max_dur
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
        total = (p_score * 0.50) + (d_score * 0.30) + (i_score * 0.20)
        
        if total > best_score:
            best_score = total
            best_idx = i
    
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
