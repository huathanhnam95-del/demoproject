"""
Studio Audio Producer for 10s Valve & Gabe Newell Intro Video
- Speech: Kokoro TTS (am_adam)
- DSP: 80Hz rumble filter, peak normalization
- Ambient Score: Warm cinematic synth drone & pad, ducked under narration
- Master Duration: Exactly 10.000s (480,000 samples @ 48kHz)
"""

import os
import sys
import json
import urllib.request
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt
from pathlib import Path

PROJECT_ROOT = Path(r"C:\Cursor AI")
OUT_DIR = PROJECT_ROOT / "exported_slides"
OUT_DIR.mkdir(parents=True, exist_ok=True)

AUDIO_OUT = OUT_DIR / "valve_gabe_intro_audio_10s.wav"
SAMPLE_RATE = 48000
TOTAL_SECONDS = 10.0
TOTAL_SAMPLES = int(SAMPLE_RATE * TOTAL_SECONDS)

# Script: punchy, authentic narrative introduction
SCRIPT_TEXT = "In 1996, Gabe Newell founded Valve with a radical premise: tear down corporate hierarchy, and give creators total ownership."

def get_or_synthesize_speech():
    cand_path = OUT_DIR / "intro_10s_audio" / "cand_B.wav"
    cand_path.parent.mkdir(parents=True, exist_ok=True)
    if cand_path.exists():
        print(f"Loading existing Kokoro speech from: {cand_path}")
        speech_raw, sr = sf.read(str(cand_path))
        return speech_raw, sr
    
    print("Synthesizing speech via Kokoro TTS...")
    sys.path.append(str(PROJECT_ROOT / "scripts"))
    from generate_gabe_narration import ensure_kokoro_server
    proc, log_file = ensure_kokoro_server()
    try:
        payload = {
            "model": "kokoro",
            "input": SCRIPT_TEXT,
            "voice": "am_adam",
            "response_format": "wav",
            "speed": 1.0
        }
        req = urllib.request.Request(
            "http://127.0.0.1:8880/v1/audio/speech",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req) as resp, open(str(cand_path), "wb") as f:
            f.write(resp.read())
        speech_raw, sr = sf.read(str(cand_path))
        return speech_raw, sr
    finally:
        if proc:
            proc.kill()
        if log_file:
            log_file.close()

def highpass_filter(data, cutoff=80.0, fs=48000, order=4):
    sos = butter(order, cutoff, btype='highpass', fs=fs, output='sos')
    return sosfilt(sos, data)

def generate_cinematic_ambient_score(duration_sec=10.0, fs=48000):
    """
    Synthesize a warm, cinematic ambient score with analog detuning,
    sub-bass foundation, lush mid pad chords, and subtle stereo chorus.
    Key: D minor / D major (D2, A2, D3, F#3, A3, E4)
    """
    t = np.linspace(0, duration_sec, int(duration_sec * fs), endpoint=False)
    
    # Layer 1: Warm sub-bass (D1: 36.71 Hz, D2: 73.42 Hz)
    sub = 0.25 * np.sin(2 * np.pi * 36.71 * t) + 0.35 * np.sin(2 * np.pi * 73.42 * t)
    
    # Layer 2: Rich chord pad (D2, A2, D3, F#3, A3, E4) with detuned unisons
    chord_freqs = [73.42, 110.00, 146.83, 185.00, 220.00, 329.63]
    pad_left = np.zeros_like(t)
    pad_right = np.zeros_like(t)
    
    for i, f in enumerate(chord_freqs):
        weight = 1.0 / (1.0 + 0.25 * i)
        # Detuned oscillators for lush analog chorus
        detune = 0.25 + 0.08 * i
        osc1 = np.sin(2 * np.pi * (f - detune) * t)
        osc2 = np.sin(2 * np.pi * f * t + 0.5)
        osc3 = np.sin(2 * np.pi * (f + detune) * t + 1.0)
        
        # Soft harmonics
        harm = 0.2 * np.sin(2 * np.pi * (f * 2) * t)
        
        sig = weight * (0.4 * osc1 + 0.4 * osc2 + 0.4 * osc3 + harm)
        
        # Stereo panning spread
        pan = np.sin(0.3 * t + i * 1.2) * 0.35
        pad_left += sig * (0.5 - pan)
        pad_right += sig * (0.5 + pan)
    
    # Subtle organic texture / slow breathing modulation
    lfo = 0.85 + 0.15 * np.sin(2 * np.pi * 0.2 * t)
    pad_left *= lfo
    pad_right *= lfo
    
    # Combine sub and pads
    ambient_l = sub * 0.5 + pad_left * 0.3
    ambient_r = sub * 0.5 + pad_right * 0.3
    
    # Master envelope: 0.5s soft fade-in, 0.8s smooth fade-out
    fade_in_samples = int(0.5 * fs)
    fade_out_samples = int(0.8 * fs)
    env = np.ones_like(t)
    env[:fade_in_samples] = np.sin(np.linspace(0, np.pi / 2, fade_in_samples)) ** 2
    env[-fade_out_samples:] = np.cos(np.linspace(0, np.pi / 2, fade_out_samples)) ** 2
    
    ambient_l *= env
    ambient_r *= env
    
    # Normalize ambient bed peak to -12 dBFS
    ambient_stereo = np.column_stack([ambient_l, ambient_r])
    peak = np.max(np.abs(ambient_stereo))
    if peak > 0:
        ambient_stereo = ambient_stereo * (10 ** (-12.0 / 20.0) / peak)
        
    return ambient_stereo

def build_master_audio():
    speech_raw, sr_speech = get_or_synthesize_speech()
    if speech_raw.ndim > 1:
        speech_raw = speech_raw[:, 0]
        
    # Resample speech to 48kHz if needed
    if sr_speech != SAMPLE_RATE:
        import math
        import scipy.signal
        g = math.gcd(int(SAMPLE_RATE), int(sr_speech))
        up = int(SAMPLE_RATE) // g
        down = int(sr_speech) // g
        speech_48k = scipy.signal.resample_poly(speech_raw, up, down)
    else:
        speech_48k = speech_raw
        
    # 80Hz rumble removal
    speech_filtered = highpass_filter(speech_48k, cutoff=80.0, fs=SAMPLE_RATE)
    
    # Normalize speech peak to -1.5 dBFS
    speech_peak = np.max(np.abs(speech_filtered))
    if speech_peak > 0:
        speech_norm = speech_filtered * (10 ** (-1.5 / 20.0) / speech_peak)
    else:
        speech_norm = speech_filtered
        
    speech_dur = len(speech_norm) / SAMPLE_RATE
    print(f"Speech duration: {speech_dur:.3f}s")
    
    # Timing:
    # 0.0s to 0.5s: Pre-roll
    # 0.5s to 0.5s + speech_dur: Speech
    # Tail: remaining time to 10.0s
    pre_roll_sec = 0.50
    pre_roll_samples = int(pre_roll_sec * SAMPLE_RATE)
    speech_len = len(speech_norm)
    
    if pre_roll_samples + speech_len > TOTAL_SAMPLES:
        # If speech is slightly too long, adjust pre-roll
        pre_roll_samples = max(0, TOTAL_SAMPLES - speech_len - int(0.2 * SAMPLE_RATE))
        
    # Create master speech track (stereo)
    master_speech = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)
    end_sample = min(TOTAL_SAMPLES, pre_roll_samples + speech_len)
    actual_speech_len = end_sample - pre_roll_samples
    master_speech[pre_roll_samples:end_sample, 0] = speech_norm[:actual_speech_len]
    master_speech[pre_roll_samples:end_sample, 1] = speech_norm[:actual_speech_len]
    
    # Generate Ambient Score
    ambient = generate_cinematic_ambient_score(duration_sec=TOTAL_SECONDS, fs=SAMPLE_RATE)
    
    # Duck ambient music under narration
    # Ducking gain envelope
    duck_env = np.ones(TOTAL_SAMPLES, dtype=np.float32)
    duck_start = pre_roll_samples - int(0.15 * SAMPLE_RATE)
    duck_end = end_sample + int(0.25 * SAMPLE_RATE)
    duck_start = max(0, duck_start)
    duck_end = min(TOTAL_SAMPLES, duck_end)
    
    # Smooth duck transition (gain drops to 0.28 = -11 dB ducking)
    duck_target = 0.28
    transition_samples = int(0.25 * SAMPLE_RATE)
    
    # Ramp down into duck
    ramp_down = np.linspace(1.0, duck_target, transition_samples)
    d_s1 = min(duck_start + transition_samples, TOTAL_SAMPLES)
    duck_env[duck_start:d_s1] = ramp_down[:d_s1 - duck_start]
    duck_env[d_s1:duck_end] = duck_target
    
    # Ramp up after speech
    d_s2 = min(duck_end + transition_samples, TOTAL_SAMPLES)
    ramp_up = np.linspace(duck_target, 1.0, transition_samples)
    duck_env[duck_end:d_s2] = ramp_up[:d_s2 - duck_end]
    
    ambient_ducked = ambient * duck_env[:, np.newaxis]
    
    # Master mix
    mix = master_speech + ambient_ducked
    
    # Final limiter / safety ceiling (-1.0 dBFS)
    mix_peak = np.max(np.abs(mix))
    if mix_peak > 10 ** (-1.0 / 20.0):
        mix = mix * (10 ** (-1.0 / 20.0) / mix_peak)
        
    sf.write(str(AUDIO_OUT), mix, SAMPLE_RATE, subtype='PCM_16')
    print(f"Master audio generated: {AUDIO_OUT}")
    print(f"  Duration: {len(mix)/SAMPLE_RATE:.4f}s")
    print(f"  Channels: 2 (Stereo)")
    print(f"  Sample rate: {SAMPLE_RATE} Hz")
    print(f"  Peak: {20 * np.log10(np.max(np.abs(mix))):.2f} dBFS")

if __name__ == "__main__":
    build_master_audio()
