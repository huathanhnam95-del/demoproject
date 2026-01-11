from flask import Flask, request, jsonify
from flask_cors import CORS
import parselmouth
import numpy as np
import tempfile
import os

app = Flask(__name__)

# Update with your frontend URLs
CORS(app, origins=[
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'https://your-firebase-app.web.app',  # UPDATE THIS
    'https://your-frontend-domain.com'     # UPDATE THIS
])

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        'service': 'Pronunciation Analyzer API',
        'status': 'running',
        'endpoints': {
            '/health': 'Health check',
            '/analyze': 'POST - Analyze audio file'
        }
    })

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

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