import wave
import numpy as np
import os

def slice_audio(wav_path, out_path, start_ms, end_ms, fade_ms=10):
    with wave.open(wav_path, 'rb') as wf:
        sr = wf.getframerate()
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        n_samples = wf.getnframes()
        raw = wf.readframes(n_samples)
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32)

    start_idx = max(0, int((start_ms / 1000.0) * sr))
    end_idx = min(len(samples), int((end_ms / 1000.0) * sr))
    
    segment = samples[start_idx:end_idx].copy()
    
    # Apply fade-out to prevent clicks and trailing bleed
    fade_samples = int((fade_ms / 1000.0) * sr)
    if len(segment) > fade_samples and fade_samples > 0:
        ramp = np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)
        segment[-fade_samples:] *= ramp
        
    out_data = np.clip(segment, -32768, 32767).astype(np.int16)
    with wave.open(out_path, 'wb') as out_wf:
        out_wf.setnchannels(n_channels)
        out_wf.setsampwidth(sampwidth)
        out_wf.setframerate(sr)
        out_wf.writeframes(out_data.tobytes())

# Generate comparison slices for 'their' in test57
# 'their' is [18870 - 19420ms], next word 'results' starts at 19430ms
out_dir = 'scripts/entrance-test/audio_analysis/slices'
os.makedirs(out_dir, exist_ok=True)

# 1. Exact raw timestamp
slice_audio('scripts/entrance-test/audio_analysis/test57_q1.wav', f'{out_dir}/their_exact.wav', 18870, 19420, fade_ms=0)

# 2. Overshoot by 50ms (simulating setInterval lag)
slice_audio('scripts/entrance-test/audio_analysis/test57_q1.wav', f'{out_dir}/their_overshoot50ms.wav', 18870, 19420 + 50, fade_ms=0)

# 3. Optimized with 35ms pullback + 15ms smooth fade
slice_audio('scripts/entrance-test/audio_analysis/test57_q1.wav', f'{out_dir}/their_optimized.wav', 18870, 19420 - 35, fade_ms=15)

# Also test 'give' in testB0 [7940 - 8250ms], next 'them' starts at 8260ms
slice_audio('scripts/entrance-test/audio_analysis/testB0_q1.wav', f'{out_dir}/give_exact.wav', 7940, 8250, fade_ms=0)
slice_audio('scripts/entrance-test/audio_analysis/testB0_q1.wav', f'{out_dir}/give_overshoot50ms.wav', 7940, 8250 + 50, fade_ms=0)
slice_audio('scripts/entrance-test/audio_analysis/testB0_q1.wav', f'{out_dir}/give_optimized.wav', 7940, 8250 - 35, fade_ms=15)

print("Generated comparison slices in", out_dir)
