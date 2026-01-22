"""Direct test of find_vowel_end with the same data as 'improve' analysis."""
import sys
import os

# Add local_server directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'local_server'))

import numpy as np
import parselmouth
import tempfile
import requests

# Get the audio file
audio_url = 'https://media.merriam-webster.com/audio/prons/en/us/mp3/i/improv01.mp3'
resp = requests.get(audio_url, timeout=15)
with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as tmp:
    tmp.write(resp.content)
    tmp_path = tmp.name

try:
    # Load with Praat
    sound = parselmouth.Sound(tmp_path)
    pitch = sound.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
    intensity = sound.to_intensity(minimum_pitch=75, time_step=0.01)
    
    # Get data arrays
    int_times = np.array(intensity.xs())
    int_values = np.array([intensity.get_value(t) for t in int_times])
    int_values = np.nan_to_num(int_values, nan=0.0)
    
    print("=== DIRECT VOWEL-END TEST ===\n")
    
    # The peak for syllable 1 is around index 18 (0.18s) based on earlier analysis
    # But what does the ACTUAL peaks_to_syllables pass as peak_time?
    # Let's check what peaks are detected
    
    from server import find_intensity_peaks, AnalysisConfig
    
    config = AnalysisConfig()
    
    # Find speech region
    voiced_intensities = int_values[int_values > 0]
    median_intensity = np.median(voiced_intensities)
    speech_threshold = median_intensity - 5
    speech_indices = np.where(int_values > speech_threshold)[0]
    speech_start_idx = max(0, speech_indices[0] - 2)
    speech_end_idx = min(len(int_values) - 1, speech_indices[-1] + 2)
    speech_start = float(int_times[speech_start_idx])
    speech_end = float(int_times[speech_end_idx])
    
    print(f"Speech region: {speech_start:.3f}s - {speech_end:.3f}s")
    
    # Find peaks
    peaks = find_intensity_peaks(int_times, int_values, speech_threshold,
                                  speech_start_idx, speech_end_idx, pitch, min_dip=2.0)
    
    print(f"\nDetected peaks ({len(peaks)}):")
    for p in peaks:
        print(f"  Peak at t={p['time']:.3f}s (intensity={p['intensity']:.1f}dB)")
    
    if len(peaks) >= 2:
        # Simulate what peaks_to_syllables does
        current_peak = peaks[0]
        next_peak = peaks[1]
        
        # BoundaryDetector would propose a boundary between them
        # For this test, let's use intensity minimum as candidate
        start_idx = current_peak['index']
        end_idx = next_peak['index']
        search_region = int_values[start_idx:end_idx+1]
        min_idx_in_region = np.argmin(search_region)
        min_idx = start_idx + min_idx_in_region
        candidate_boundary = float(int_times[min_idx])
        
        print(f"\n=== BOUNDARY ANALYSIS ===")
        print(f"Peak 1: t={current_peak['time']:.3f}s")
        print(f"Peak 2: t={next_peak['time']:.3f}s")
        print(f"Candidate boundary (intensity min): t={candidate_boundary:.3f}s")
        
        # Now call find_vowel_end
        from server import find_vowel_end
        
        print(f"\n=== CALLING find_vowel_end ===")
        vowel_end = find_vowel_end(
            pitch, intensity, int_times, int_values, 
            current_peak['time'], candidate_boundary, config
        )
        
        print(f"\n=== RESULT ===")
        print(f"Candidate boundary: {candidate_boundary:.3f}s")
        print(f"Vowel end found:    {vowel_end:.3f}s")
        print(f"Clamped boundary:   {min(candidate_boundary, vowel_end):.3f}s")
        
        # Check voicing around the transition
        print(f"\n=== VOICING CHECK around peak ===")
        for t in np.arange(current_peak['time'], candidate_boundary + 0.05, 0.02):
            p = pitch.get_value_at_time(t)
            voiced = "VOICED" if not np.isnan(p) and p > 0 else "unvoiced"
            print(f"  t={t:.3f}s: {voiced} (pitch={p if not np.isnan(p) else 'NaN'})")
        
finally:
    os.unlink(tmp_path)
