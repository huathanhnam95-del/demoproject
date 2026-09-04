import wave
import numpy as np

def measure_leakage(wav_path, word, start_ms, end_ms, next_word, next_start_ms):
    with wave.open(wav_path, 'rb') as wf:
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    print(f"\n=================================================================")
    print(f"Analyzing '{word}' [{start_ms} - {end_ms}ms] -> '{next_word}' [starts {next_start_ms}ms]")
    gap_ms = next_start_ms - end_ms
    print(f"Gap between words: {gap_ms}ms")

    # 1. Energy in the last 40ms of the word
    s1 = int(((end_ms - 40) / 1000.0) * sr)
    e1 = int((end_ms / 1000.0) * sr)
    rms_word_end = np.sqrt(np.mean(samples[s1:e1]**2))

    # 2. Energy in the next word onset (first 40ms of next word)
    s2 = int((next_start_ms / 1000.0) * sr)
    e2 = int(((next_start_ms + 40) / 1000.0) * sr)
    rms_next_onset = np.sqrt(np.mean(samples[s2:e2]**2))

    # 3. Energy if played with 50ms overshoot (past end_ms)
    s_over = int((end_ms / 1000.0) * sr)
    e_over = int(((end_ms + 50) / 1000.0) * sr)
    rms_overshoot = np.sqrt(np.mean(samples[s_over:e_over]**2))

    print(f"RMS Energy:")
    print(f"  Word Tail (-40ms to 0ms):          {rms_word_end:.4f}")
    print(f"  Next Word Onset (0ms to +40ms):    {rms_next_onset:.4f}")
    print(f"  50ms Overshoot Region:             {rms_overshoot:.4f}")
    
    # If overshoot has high energy compared to next onset, the next word is DEFINITELY leaking!
    ratio = (rms_overshoot / (rms_next_onset + 1e-6)) * 100
    print(f"  Next Word Bleed in Overshoot:      {ratio:.1f}% of next word volume!")

measure_leakage('scripts/entrance-test/audio_analysis/test57_q1.wav', 'their', 18870, 19420, 'results', 19430)
measure_leakage('scripts/entrance-test/audio_analysis/test57_q1.wav', 'and', 10390, 10890, 'do', 10900)
measure_leakage('scripts/entrance-test/audio_analysis/test57_q1.wav', 'after', 13730, 14500, 'they', 14510)
measure_leakage('scripts/entrance-test/audio_analysis/testB0_q1.wav', 'give', 7940, 8250, 'them', 8260)
measure_leakage('scripts/entrance-test/audio_analysis/testB0_q1.wav', 'picture', 15970, 16510, 'of', 16520)
