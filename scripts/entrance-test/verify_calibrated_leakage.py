import wave
import numpy as np

def test_calibration(wav_path, word, start_ms, end_ms, next_word, next_start_ms, is_mispronounced=False):
    with wave.open(wav_path, 'rb') as wf:
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    gap = next_start_ms - end_ms
    
    # 1. Uncalibrated (old) playback window with HTML overshoot
    old_start = start_ms
    old_end = end_ms + 40 # 40ms average browser pause overshoot

    # 2. Calibrated (new) WebAudio playback window
    if gap < 100:
        if is_mispronounced:
            effective_end = min(end_ms - 35, next_start_ms - 50)
        else:
            effective_end = min(end_ms - 25, next_start_ms - 35)
    else:
        effective_end = end_ms
    effective_end = max(start_ms + 75, effective_end)
    
    # Next word true onset energy (first 30ms of next word)
    next_s = int((next_start_ms / 1000.0) * sr)
    next_e = int(((next_start_ms + 30) / 1000.0) * sr)
    next_onset_rms = np.sqrt(np.mean(samples[next_s:next_e]**2))

    # Old playback bleed (samples past next_start_ms)
    old_e_idx = int((old_end / 1000.0) * sr)
    if old_e_idx > next_s:
        old_bleed_rms = np.sqrt(np.mean(samples[next_s:old_e_idx]**2))
    else:
        old_bleed_rms = 0.0

    # New calibrated playback bleed (samples past next_start_ms)
    new_e_idx = int((effective_end / 1000.0) * sr)
    if new_e_idx > next_s:
        new_bleed_rms = np.sqrt(np.mean(samples[next_s:new_e_idx]**2))
    else:
        new_bleed_rms = 0.0

    print(f"\n=======================================================")
    print(f"Word: '{word}' -> Next: '{next_word}' (Gap: {gap}ms, Mispronounced: {is_mispronounced})")
    print(f"  Raw Azure bounds:       {start_ms}ms - {end_ms}ms (dur={end_ms - start_ms}ms)")
    print(f"  Old Playback with lag:  {old_start}ms - {old_end}ms (+40ms overshoot)")
    print(f"  New Calibrated bounds:  {start_ms}ms - {effective_end}ms (trimmed by {end_ms - effective_end}ms)")
    print(f"  Next Word Onset RMS:    {next_onset_rms:.4f}")
    print(f"  Old Bleed into Next:    {old_bleed_rms:.4f} ({(old_bleed_rms / (next_onset_rms + 1e-6))*100:.1f}% volume)")
    print(f"  New Bleed into Next:    {new_bleed_rms:.4f} ({(new_bleed_rms / (next_onset_rms + 1e-6))*100:.1f}% volume -> ZERO BLEED!)")

# Test cases
test_calibration('scripts/entrance-test/audio_analysis/test57_q1.wav', 'their', 18870, 19420, 'results', 19430, is_mispronounced=False)
test_calibration('scripts/entrance-test/audio_analysis/test57_q1.wav', 'and', 10390, 10890, 'do', 10900, is_mispronounced=False)
test_calibration('scripts/entrance-test/audio_analysis/test57_q1.wav', 'after', 13730, 14500, 'they', 14510, is_mispronounced=False)
test_calibration('scripts/entrance-test/audio_analysis/test57_q1.wav', 'observation', 4210, 5620, 'mat', 5650, is_mispronounced=True)
test_calibration('scripts/entrance-test/audio_analysis/testB0_q1.wav', 'give', 7940, 8250, 'them', 8260, is_mispronounced=False)
test_calibration('scripts/entrance-test/audio_analysis/testB0_q1.wav', 'picture', 15970, 16510, 'of', 16520, is_mispronounced=False)
