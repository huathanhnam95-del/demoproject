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
    
    result['syllableCount'] = len(result['syllables'])
    
    prs = hwi.get('prs', [])
    if prs:
        pron = prs[0]
        # Prioritize IPA field for display, fallback to mw
        result['pronunciation'] = pron.get('ipa') or pron.get('mw')
        
        # Use MW field for stress detection if available, as it has hyphens
        # Fallback to display pronunciation (might be IPA)
        stress_source = pron.get('mw') or result['pronunciation']
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
    return [s for s in cleaned.split('*') if s] if '*' in cleaned else [s for s in cleaned.split('·') if s]

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
    
    # Extract pitch (50-300 Hz to cover creaky voice)
    pitch = sound.to_pitch(time_step=0.01, pitch_floor=50, pitch_ceiling=300)
    pitch_times = pitch.xs()
    pitch_values = []
    for t in pitch_times:
        p = pitch.get_value_at_time(t)
        pitch_values.append(None if np.isnan(p) else round(float(p), 1))
    
    # Extract intensity
    intensity = sound.to_intensity(minimum_pitch=50, time_step=0.01)
    intensity_times = intensity.xs()
    intensity_values = []
    for t in intensity_times:
        val = intensity.get_value(t)
        intensity_values.append(round(float(val), 2) if not np.isnan(val) else 0)
    
    # Detect syllables
    syllables = detect_syllables(sound, pitch, intensity, expected_syllables)
    
    return {
        'duration': round(float(sound.duration), 3),
        'sampleRate': int(sound.sampling_frequency),
        'pitch': {
            'times': [round(float(t), 3) for t in pitch_times],
            'values': pitch_values
        },
        'intensity': {
            'times': [round(float(t), 3) for t in intensity_times],
            'values': intensity_values
        },
        'syllables': syllables
    }

def detect_syllables(sound, pitch, intensity, expected_syllables=None):
    """Detect syllables using Praat's intensity-based method."""
    
    int_times = np.array(intensity.xs())
    int_values = np.array([intensity.get_value(t) for t in int_times])
    int_values = np.nan_to_num(int_values, nan=0.0)
    
    if len(int_values) == 0 or np.max(int_values) == 0:
        return []
    
    # Find speech region
    max_intensity = np.max(int_values)
    speech_threshold = max_intensity - 25  # 25 dB below peak
    
    speech_indices = np.where(int_values > speech_threshold)[0]
    if len(speech_indices) == 0:
        return []
    
    speech_start_idx = max(0, speech_indices[0] - 2)
    speech_end_idx = min(len(int_values) - 1, speech_indices[-1] + 2)
    speech_start = float(int_times[speech_start_idx])
    speech_end = float(int_times[speech_end_idx])
    
    # Find intensity peaks
    peaks = find_intensity_peaks(int_times, int_values, speech_threshold, speech_start_idx, speech_end_idx)
    
    # Adjust based on expected count
    if expected_syllables:
        peaks = adjust_peaks_to_expected(peaks, expected_syllables, int_times, int_values, speech_start, speech_end)
    
    # Convert to syllables
    syllables = peaks_to_syllables(peaks, pitch, int_times, speech_start, speech_end)
    
    return syllables

def find_intensity_peaks(times, values, threshold, start_idx, end_idx):
    """Find local maxima in intensity."""
    peaks = []
    
    for i in range(start_idx + 2, end_idx - 2):
        if values[i] > threshold:
            if (values[i] >= values[i-1] and values[i] >= values[i-2] and
                values[i] >= values[i+1] and values[i] >= values[i+2]):
                peaks.append({
                    'index': i,
                    'time': float(times[i]),
                    'intensity': float(values[i])
                })
    
    # Merge peaks closer than 100ms
    merged = []
    for peak in peaks:
        if not merged or peak['time'] - merged[-1]['time'] > 0.10:
            merged.append(peak)
        elif peak['intensity'] > merged[-1]['intensity']:
            merged[-1] = peak
    
    return merged

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

def peaks_to_syllables(peaks, pitch, int_times, speech_start, speech_end):
    """Convert peaks to syllables with boundaries and pitch."""
    
    if not peaks:
        return []
    
    syllables = []
    
    for i, peak in enumerate(peaks):
        if i == 0:
            start_time = speech_start
        else:
            start_time = (peaks[i-1]['time'] + peak['time']) / 2
        
        if i == len(peaks) - 1:
            end_time = speech_end
        else:
            end_time = (peak['time'] + peaks[i+1]['time']) / 2
        
        # Get pitch values
        syl_pitches = []
        t = start_time
        while t <= end_time:
            p = pitch.get_value_at_time(t)
            if not np.isnan(p) and p > 0:
                syl_pitches.append(p)
            t += 0.005
        
        avg_pitch = round(float(np.mean(syl_pitches)), 1) if syl_pitches else 0
        max_pitch = round(float(np.max(syl_pitches)), 1) if syl_pitches else 0
        
        syllables.append({
            'startTime': round(start_time, 3),
            'endTime': round(end_time, 3),
            'duration': round(end_time - start_time, 3),
            'avgPitch': avg_pitch,
            'maxPitch': max_pitch,
            'intensity': round(peak['intensity'], 2)
        })
    
    return syllables

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)