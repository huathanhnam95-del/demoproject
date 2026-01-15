"""Debug script to trace vowel-end detection logic."""
import numpy as np
import requests

# Fetch the audio analysis data
r = requests.post('http://127.0.0.1:8080/analyze-url', 
    json={'audioUrl': 'https://media.merriam-webster.com/audio/prons/en/us/mp3/i/improv01.mp3', 
          'expectedSyllables': 2}, timeout=30)
d = r.json()

pitch_data = d['pitch']
int_data = d['intensity']

times = np.array(pitch_data['times'])
pitch_values = pitch_data['values']
int_values = np.array(int_data['values'])

print("=== IMPROVE ANALYSIS DEBUG ===")
print(f"\nSyllables detected:")
for s in d['syllables']:
    print(f"  Syl {s['syllable']}: {s['startTime']:.3f}s - {s['endTime']:.3f}s")

# The peak for Syl1 should be around 0.18s (where intensity is ~80dB)
# Look for voicing break between 0.18s and 0.40s
print("\n=== VOICING CHECK (0.18s to 0.40s) ===")
for i, t in enumerate(times):
    if 0.18 <= t <= 0.40:
        p = pitch_values[i]
        intensity = int_values[i]
        voiced = "VOICED" if p is not None and p > 0 else "unvoiced"
        print(f"  t={t:.2f}s: pitch={str(p):>7s} ({voiced}), intensity={intensity:.1f}dB")

# The voicing break should be visible around 0.28s
print("\n=== KEY OBSERVATION ===")
print("Voicing breaks (null pitch) should indicate vowel end.")
print("The boundary should clamp to the first unvoiced frame after the peak.")

# Calculate where vowel-end SHOULD be
peak_time = 0.18  # approx
print(f"\nPeak time: ~{peak_time}s")
for i, t in enumerate(times):
    if t > peak_time:
        p = pitch_values[i]
        if p is None:
            print(f"First unvoiced after peak: t={t:.3f}s")
            break
