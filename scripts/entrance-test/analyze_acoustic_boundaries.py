import wave
import numpy as np

def analyze_boundary(wav_path, word1, start1_ms, end1_ms, word2, start2_ms, end2_ms):
    with wave.open(wav_path, 'rb') as wf:
        sr = wf.getframerate()
        n_samples = wf.getnframes()
        raw = wf.readframes(n_samples)
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    print(f"\n=======================================================")
    print(f"Boundary Analysis: '{word1}' [{start1_ms} - {end1_ms}ms] -> '{word2}' [{start2_ms} - {end2_ms}ms]")
    gap_ms = start2_ms - end1_ms
    print(f"Reported Gap: {gap_ms}ms (Sample rate: {sr}Hz)")
    
    # Let's inspect energy in 10ms windows around end1_ms (-100ms to +100ms)
    center_sample = int((end1_ms / 1000.0) * sr)
    window_samples = int(0.010 * sr) # 10ms
    
    print(f"\nRMS Energy around end of '{word1}' (offset relative to endMs):")
    for offset_ms in range(-60, 80, 10):
        t_ms = end1_ms + offset_ms
        s_idx = int((t_ms / 1000.0) * sr)
        slice_data = samples[s_idx : s_idx + window_samples]
        if len(slice_data) > 0:
            rms = np.sqrt(np.mean(slice_data**2))
            # Zero-crossing rate
            zcr = np.sum(np.abs(np.diff(np.sign(slice_data)))) / (2 * len(slice_data))
            marker = ""
            if offset_ms == 0:
                marker = " <-- [endMs of word1]"
            elif offset_ms == gap_ms:
                marker = f" <-- [startMs of word2 '{word2}']"
            print(f"  {offset_ms:+4d}ms (abs {t_ms:5d}ms): RMS = {rms:7.4f}, ZCR = {zcr:5.3f}{marker}")

# Test 57
analyze_boundary('scripts/entrance-test/audio_analysis/test57_q1.wav', 'their', 18870, 19420, 'results', 19430, 20030)
analyze_boundary('scripts/entrance-test/audio_analysis/test57_q1.wav', 'and', 10390, 10890, 'do', 10900, 11460)
analyze_boundary('scripts/entrance-test/audio_analysis/test57_q1.wav', 'after', 13730, 14500, 'they', 14510, 14780)

# Test B0
analyze_boundary('scripts/entrance-test/audio_analysis/testB0_q1.wav', 'and', 4020, 4290, 'do', 4300, 4450)
analyze_boundary('scripts/entrance-test/audio_analysis/testB0_q1.wav', 'give', 7940, 8250, 'them', 8260, 8530)
analyze_boundary('scripts/entrance-test/audio_analysis/testB0_q1.wav', 'picture', 15970, 16510, 'of', 16520, 16650)
