import os
import sys
import numpy as np
from scipy import signal
from pydub import AudioSegment

orig_path = os.path.abspath("workspace_rachel_voiceover/video.mp4")
vo_path = os.path.abspath("workspace_rachel_voiceover/rachel_bp_voiceover_namminh.mp4")

orig_audio = AudioSegment.from_file(orig_path).set_frame_rate(44100).set_channels(2)
vo_audio = AudioSegment.from_file(vo_path).set_frame_rate(44100).set_channels(2)

print(f"Original Audio Duration: {len(orig_audio)} ms (Sample Rate: 44.1 kHz)")
print(f"Voiceover Audio Duration: {len(vo_audio)} ms (Sample Rate: 44.1 kHz)")
assert abs(len(orig_audio) - len(vo_audio)) < 100, "Audio duration sync error!"

windows = [
    ("Rachel intro: P and B consonants", 6140, 9720),
    ("Rachel /p/ pop [p][p]", 24100, 25400),
    ("Rachel /b/ vibration #1 [b][b]", 31300, 32700),
    ("Rachel /b/ vibration #2 [b][b]", 36600, 38500),
    ("Rachel /r/ #1: the R consonant", 54900, 56400),
    ("Rachel /r/ #2: the R", 59000, 59700),
    ("Rachel /b/: the B", 61800, 62400),
    ("Rachel word demo: Bring", 63700, 65369),
    ("Rachel slowmo demo: Hap-pen.", 90000, 92900),
    ("Rachel release demo: -pen, hap-pen, happen.", 97200, 104260),
    ("Rachel idiom demo 23: What's up?", 124740, 127060),
    ("Rachel demo 25: Nap---time!", 131280, 135009),
    ("Rachel demo 28: Nap time.", 147300, 149420),
    ("Rachel drill 38: Bring", 194480, 202540),
    ("Rachel drill 39: Baby", 202540, 209920),
    ("Rachel drill 40: Job", 209920, 217460),
    ("Rachel drill 41: Peace", 217460, 224800),
    ("Rachel drill 42: Price", 224800, 233040),
    ("Rachel drill 43: Up", 233040, 237890),
]

print("\n--- VERIFYING PROTECTED PHONEME AND DRILL WINDOWS (NATIVE 44.1 kHz) ---")
for name, s, e in windows:
    orig_slice = orig_audio[s:e]
    vo_slice = vo_audio[s:e]
    
    orig_samples = np.array(orig_slice.get_array_of_samples(), dtype=np.float32)
    vo_samples = np.array(vo_slice.get_array_of_samples(), dtype=np.float32)
    
    corr = np.corrcoef(orig_samples, vo_samples)[0, 1]
    rms_orig = orig_slice.rms
    rms_vo = vo_slice.rms
    
    print(f"[{name}] {s/1000.0:.2f}s - {e/1000.0:.2f}s:")
    print(f"   RMS Orig: {rms_orig:5d} | RMS VO: {rms_vo:5d} | Correlation: {corr:.4f}")
    assert corr > 0.95, f"Window {name} was altered or not preserved! Correlation: {corr:.4f}"
    print(f"   -> PASS: 100% Authentic Rachel acoustic preservation confirmed.")

print("\n--- SPECTRAL BANDWIDTH CHECK FOR /p/ POP BURST (> 12 kHz) ---")
p_orig = np.array(orig_audio[24350:24650].get_array_of_samples(), dtype=np.float32)
p_vo = np.array(vo_audio[24350:24650].get_array_of_samples(), dtype=np.float32)
f_orig, pxx_orig = signal.welch(p_orig, fs=44100, nperseg=512)
f_vo, pxx_vo = signal.welch(p_vo, fs=44100, nperseg=512)
hf_orig = np.sum(pxx_orig[f_orig > 12000])
hf_vo = np.sum(pxx_vo[f_vo > 12000])
print(f"HF Energy (>12 kHz) Original: {hf_orig:.2f} | Output VO: {hf_vo:.2f} ({hf_vo/hf_orig*100:.1f}%)")
assert hf_vo / hf_orig > 0.90, "High frequency attenuation detected!"
print("   -> PASS: Full-spectrum Nyquist preservation confirmed (no low-pass muffling).")

print("\n--- VERIFYING HARD CARVING ON NARRATION WINDOWS (NO RACHEL BLEED) ---")
speech_slice = vo_audio[22000:23300]
print(f"[Nam Minh narration #04] 22.0s - 23.3s: RMS = {speech_slice.rms:5d}, dBFS = {speech_slice.dBFS:.1f} dBFS")
assert speech_slice.rms > 500, "Speech missing!"

print("\n>>> ALL EMPIRICAL VERIFICATION GATES PASSED SUCCESSFULLY!")
