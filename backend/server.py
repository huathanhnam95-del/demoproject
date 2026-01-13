from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import parselmouth
import numpy as np
import tempfile
import os
import requests as http_requests  # Renamed to avoid conflict with flask.request
import re

app = Flask(__name__)

# CORS configuration - allow all origins for development
# For production, you can restrict to specific domains
CORS(app, origins='*', methods=['GET', 'POST', 'OPTIONS'], allow_headers=['Content-Type'])

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
    return jsonify({'status': 'ok'})

# ============================================
# MERRIAM-WEBSTER DICTIONARY ENDPOINTS
# ============================================

# MW API Key from environment variable (set in Cloud Run)
MW_API_KEY = os.environ.get('MW_API_KEY', '')

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
        parsed = parse_mw_response(data, normalized_word)
        if parsed:
            return jsonify({'found': True, 'data': parsed})
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
    # Find best matching entry
    entry = None
    for e in api_data:
        if isinstance(e, dict) and e.get('meta', {}).get('id', '').lower().split(':')[0] == word:
            entry = e
            break
    
    if not entry:
        entry = api_data[0] if isinstance(api_data[0], dict) else None
    
    if not entry or 'hwi' not in entry:
        return None
    
    hwi = entry.get('hwi', {})
    
    result = {
        'word': word,
        'source': 'merriam-webster',
        'syllables': parse_syllables(hwi.get('hw', '')),
        'syllableCount': 0,
        'stressedSyllable': 0,
        'pronunciation': None,
        'audioUrl': None,
        'audioFilename': None,
        'partOfSpeech': entry.get('fl'),
        'definition': entry.get('shortdef', [None])[0]
    }
    
    # Initial count from headword
    result['syllableCount'] = len(result['syllables'])
    
    prs = hwi.get('prs', [])
    if prs:
        pron = prs[0]
        # Prioritize IPA field for display, fallback to mw
        result['pronunciation'] = pron.get('ipa') or pron.get('mw')
        
        # Use IPA for stress detection if available, as it's more standardized with 'ˈ'
        # Fallback to MW field or display pronunciation
        stress_source = pron.get('ipa') or pron.get('mw') or result['pronunciation']
        
        # Calculate IPA vowel count for validation/fallback
        ipa_string = pron.get('ipa') or ""
        ipa_count = count_ipa_syllables(ipa_string)
        
        # If IPA count is greater than HW count (e.g. missing separators in HW), trust IPA
        if ipa_count > result['syllableCount']:
            print(f"Refining syllable count from IPA: {result['syllableCount']} -> {ipa_count} (IPA: {ipa_string})")
            result['syllableCount'] = ipa_count
            
        # Recalculate stress index based on new count
        result['stressedSyllable'] = find_stressed_syllable(stress_source, result['syllableCount'])
        
        if pron.get('sound', {}).get('audio'):
            audio_filename = pron['sound']['audio']
            result['audioFilename'] = audio_filename
            result['audioUrl'] = build_audio_url(audio_filename)
    
    return result

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
    """Count syllables using improved IPA vowel regex."""
    if not ipa:
        return 0
    # Improved regex to handle diphthongs, long vowels, and syllabic consonants
    # Order matters: longer sequences first
    vowel_regex = r'''
        (aɪ|eɪ|ɔɪ|aʊ|oʊ|əʊ|       # Common diphthongs
         ɪə|eə|ʊə|ɛə|ɔə|          # Centering diphthongs
         iː|uː|ɑː|ɔː|ɜː|ɛː|æː|    # Long vowels
         eːɪ|                     # Legacy/Non-standard
         [ɪieɛæəɐʌɑɒɔouʊaɚɝɨʉ]|   # Short vowels
         [lnmŋ]̩)                  # Syllabic consonants
    '''
    matches = re.findall(vowel_regex, ipa, re.VERBOSE)
    return len(matches)

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
    
    # Fallback for IPA without breaks: count vowels before stress marker
    # This matches the logic used in the frontend's parseIPA
    vowel_regex = r'(aɪ|eɪ|ɔɪ|aʊ|oʊ|ɪə|eə|ʊə|iː|uː|ɑː|ɔː|ɜː|eːɪ|[ɪieɛæəʌɑɒɔouʊaɚɝ])'
    before_stress = pronunciation[:stress_pos]
    matches = re.findall(vowel_regex, before_stress)
    
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

def analyze_audio(audio_path, expected_syllables=None):
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
    pitch_values = []
    for t in times:
        p = pitch.get_value_at_time(t)
        pitch_values.append(None if np.isnan(p) or p == 0 else round(float(p), 1))
    
    # Extract intensity
    # Use same minimum pitch as pitch analysis for consistency
    intensity = sound.to_intensity(minimum_pitch=75, time_step=time_step)
    intensity_values = []
    for t in times:
        val = intensity.get_value(t)
        intensity_values.append(round(float(val), 2) if not np.isnan(val) else 0)
    
    # Detect syllables using the pitch and intensity objects (they handle their own grids internally)
    syllables = detect_syllables(sound, pitch, intensity, expected_syllables)
    
    return {
        'duration': round(duration, 3),
        'sampleRate': int(sound.sampling_frequency),
        'pitch': {
            'times': [round(float(t), 3) for t in times],
            'values': pitch_values
        },
        'intensity': {
            'times': [round(float(t), 3) for t in times],
            'values': intensity_values
        },
        'syllables': syllables
    }

def detect_syllables(sound, pitch, intensity, expected_syllables=None):
    """Detect syllables using De Jong & Wempe (2009) method with dip detection."""
    
    int_times = np.array(intensity.xs())
    int_values = np.array([intensity.get_value(t) for t in int_times])
    int_values = np.nan_to_num(int_values, nan=0.0)
    
    # Filter only voiced parts for threshold calculation
    voiced_intensities = int_values[int_values > 0]
    
    if len(voiced_intensities) == 0:
        return []

    # De Jong & Wempe (2009) Standard: Median - 2dB (configurable silence threshold)
    median_intensity = np.median(voiced_intensities)
    SILENCE_THRESHOLD_DB = 2.0 
    
    # Use median-based threshold
    speech_threshold = median_intensity - SILENCE_THRESHOLD_DB
    
    # Sanity check: ensure threshold isn't unreasonably low (e.g. background noise level)
    # If the recording is very quiet, median might be noise. 
    # Enforce a minimum floor of max-25dB to avoid picking up silence as speech.
    max_intensity = np.max(int_values)
    min_safe_threshold = max_intensity - 25
    speech_threshold = max(speech_threshold, min_safe_threshold)
    
    # Find speech region based on threshold
    speech_indices = np.where(int_values > speech_threshold)[0]
    if len(speech_indices) == 0:
        return []
    
    speech_start_idx = max(0, speech_indices[0] - 2)
    speech_end_idx = min(len(int_values) - 1, speech_indices[-1] + 2)
    speech_start = float(int_times[speech_start_idx])
    speech_end = float(int_times[speech_end_idx])
    
    # Find intensity peaks using Dip Detection
    peaks = find_intensity_peaks(int_times, int_values, speech_threshold, speech_start_idx, speech_end_idx, pitch)
    
    # Adjust based on expected count
    if expected_syllables:
        peaks = adjust_peaks_to_expected(peaks, expected_syllables, int_times, int_values, speech_start, speech_end)
    
    # Convert to syllables
    syllables = peaks_to_syllables(peaks, pitch, int_times, int_values, speech_start, speech_end, sound)
    
    return syllables

def find_intensity_peaks(times, values, threshold, start_idx, end_idx, pitch_obj):
    """Find intensity peaks that are preceded by a dip (De Jong & Wempe)."""
    
    # Parameters
    MIN_DIP = 2.0  # dB drop required to start a new syllable
    
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
        
    return sorted(result, key=lambda x: x['time'])

def adjust_peaks_to_expected(peaks, expected, times, values, speech_start, speech_end):
    """Adjust detected peaks to match expected syllable count."""
    
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
        # Add evenly spaced points in gaps
        while len(peaks) < expected:
            all_times = [speech_start] + [p['time'] for p in peaks] + [speech_end]
            all_times.sort()
            
            max_gap = 0
            gap_start, gap_end = speech_start, speech_end
            
            for i in range(len(all_times) - 1):
                gap = all_times[i + 1] - all_times[i]
                if gap > max_gap:
                    max_gap = gap
                    gap_start = all_times[i]
                    gap_end = all_times[i + 1]
            
            mid_time = (gap_start + gap_end) / 2
            mid_idx = int(np.argmin(np.abs(times - mid_time)))
            
            peaks.append({
                'index': mid_idx,
                'time': float(times[mid_idx]),
                'intensity': float(values[mid_idx])
            })
            peaks.sort(key=lambda p: p['time'])
        
        return peaks
    
    return peaks

def measure_vowel_duration(sound, start_time, end_time, pitch_obj):
    """
    Measure duration of voiced (vowel) portion within a syllable.
    """
    voiced_duration = 0
    time_step = 0.002  # 2ms resolution
    
    t = start_time
    while t < end_time:
        pitch_val = pitch_obj.get_value_at_time(t)
        if not np.isnan(pitch_val) and pitch_val > 0:
            voiced_duration += time_step
        t += time_step
        
    return voiced_duration

def peaks_to_syllables(peaks, pitch, int_times, int_values, speech_start, speech_end, sound):
    """Convert peaks to syllable objects using intensity minima as boundaries."""
    if not peaks:
        return []
        
    syllables = []
    
    # 1. Find boundaries using intensity minima (dips) between peaks
    # This is more accurate than midpoints for phonetic boundaries
    boundaries = [speech_start]
    for i in range(len(peaks) - 1):
        start_idx = peaks[i]['index']
        end_idx = peaks[i+1]['index']
        
        # Find the absolute minimum intensity between these two peaks
        search_region = int_values[start_idx:end_idx+1]
        min_idx_in_region = np.argmin(search_region)
        min_idx = start_idx + min_idx_in_region
        
        boundaries.append(float(int_times[min_idx]))
        
    boundaries.append(speech_end)
    
    for i, peak in enumerate(peaks):
        start_t = boundaries[i]
        end_t = boundaries[i+1]
        
        # Extract features for this region
        p_max = 0
        t_indices = [j for j, t in enumerate(int_times) if start_t <= t <= end_t]
        
        if t_indices:
             region_pitches = [pitch.get_value_at_time(int_times[j]) for j in t_indices]
             valid_pitches = [p for p in region_pitches if not np.isnan(p) and p > 0]
             if valid_pitches:
                 p_max = max(valid_pitches)
        
        # NEW: Measure vowel (voiced) duration separately
        vowel_dur = measure_vowel_duration(sound, start_t, end_t, pitch)
        
        syllables.append({
            'syllable': i + 1,
            'startTime': round(start_t, 3),
            'endTime': round(end_t, 3),
            'duration': round(end_t - start_t, 3),
            'vowelDuration': round(vowel_dur, 3), # NEW
            'maxPitch': round(float(p_max), 1),
            'intensity': round(float(peak['intensity']), 1),
            'isStressed': False # Placeholder
        })
        
    # Determine stressed syllable
    if syllables:
        stressed_idx = determine_stressed_syllable(syllables)
        for i, syl in enumerate(syllables):
            syl['isStressed'] = (i == stressed_idx)
            
    return syllables

def determine_stressed_syllable(syllables):
    """
    Determine stressed syllable using weighted acoustic cues.
    Based on Fry (1955, 1958) hierarchy.
    """
    if not syllables:
        return 0
    
    # Get max values for normalization
    max_dur = max([s['duration'] for s in syllables]) or 1
    max_pitch = max([s['maxPitch'] for s in syllables]) or 1
    max_int = max([s['intensity'] for s in syllables]) or 1
    
    best_idx = 0
    best_score = -1
    
    for i, s in enumerate(syllables):
        # Updated Weights: Pitch (0.45), Duration (0.35), Intensity (0.20)
        total_score = (p_score * 0.45) + (d_score * 0.35) + (i_score * 0.20)
        
        if total_score > best_score:
            best_score = total_score
            best_idx = i
            
    return best_idx

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)