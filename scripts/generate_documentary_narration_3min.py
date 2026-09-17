"""
Comprehensive 3-Minute Documentary Narration Producer
Voice: Kokoro TTS am_michael @ 0.90 speed (slower, deeper, warmer documentary voice)
DSP: 80Hz rumble removal, warm mid EQ, peak normalization
Ambient: Contemplative documentary drone/pad, ducked -22dB beneath speech
Target: Exactly 180.000s (8,640,000 samples @ 48kHz)
"""

import os
import sys
import json
import urllib.request
import time
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt
from pathlib import Path

PROJECT_ROOT = Path(r"C:\Cursor AI")
OUT_DIR = PROJECT_ROOT / "exported_slides" / "documentary_3min_audio"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MASTER_WAV = PROJECT_ROOT / "exported_slides" / "valve_flatland_documentary_3min_audio.wav"
MANIFEST_JSON = OUT_DIR / "narration_manifest.json"

SAMPLE_RATE = 48000
TOTAL_SECONDS = 180.0
TOTAL_SAMPLES = int(SAMPLE_RATE * TOTAL_SECONDS)

# Voice parameters: slower, deeper, warmer
VOICE = "am_adam"
SPEED = 0.88


BEATS = [
    # Act 1: The Visionary & Genesis (0:00 - 0:35)
    {
        "id": "act1_01_gabe_intro",
        "act": 1,
        "title": "Gabe Newell & The Genesis",
        "speaker": "Narrator",
        "text": "In 1996, a former Microsoft systems engineer named Gabe Newell walked away from corporate stability to test a radical premise.",
        "target_start": 2.0
    },
    {
        "id": "act1_02_corporate_ladder",
        "act": 1,
        "title": "The Failure of Corporate Hierarchy",
        "speaker": "Narrator",
        "text": "Newell realized that while traditional corporate ladders worked for factory assembly lines, they crippled creative software development.",
        "target_start": 13.5
    },
    {
        "id": "act1_03_ronald_coase",
        "act": 1,
        "title": "Ronald Coase & Transaction Costs",
        "speaker": "Narrator",
        "text": "Gabe based this on Ronald Coase's theory of transaction costs: eliminating middle managers so creative professionals answer directly to customers.",
        "target_start": 24.5
    },

    # Act 2: Anatomy of Flatland (0:35 - 1:15)
    {
        "id": "act2_01_welcome_flatland",
        "act": 2,
        "title": "Welcome to Flatland",
        "speaker": "Narrator",
        "text": "Welcome to Flatland. At Valve, there are no job titles, no project managers, and no bureaucratic sign-offs.",
        "target_start": 36.5
    },
    {
        "id": "act2_02_desks_on_wheels",
        "act": 2,
        "title": "Desks on Wheels & Cabals",
        "speaker": "Narrator",
        "text": "Workstations are mounted on heavy wheels. If a creator spots an exciting challenge, they unplug, roll across the studio, and form a self-selecting team called a Cabal.",
        "target_start": 47.0
    },
    {
        "id": "act2_03_voting_with_feet",
        "act": 2,
        "title": "Voting With Your Feet",
        "speaker": "Narrator",
        "text": "Nobody assigns you tickets. People vote with their feet. If a project ignites momentum, it ships; if nobody joins, it quietly fades away.",
        "target_start": 60.5
    },

    # Act 3: Voices from Flatland — Autonomy & Reality (1:15 - 2:25)
    # Part A: Autonomy & Craft Pride
    {
        "id": "act3_01_chet_faliszek",
        "act": 3,
        "title": "Chet Faliszek — Action Over Permission",
        "speaker": "Narrator",
        "text": "Writer Chet Faliszek championed action over permission: don't wait for sign-off—build a quick prototype and let the results do the talking.",
        "target_start": 74.5
    },
    {
        "id": "act3_02_erik_wolpaw",
        "act": 3,
        "title": "Erik Wolpaw — Leave Egos at the Door",
        "speaker": "Narrator",
        "text": "Erik Wolpaw urged creators to leave egos at the door: without bosses to impress, ideas stand or fall purely on whether they delight the player.",
        "target_start": 86.0
    },
    {
        "id": "act3_03_josh_weier",
        "act": 3,
        "title": "Josh Weier — Healthy Boundaries",
        "speaker": "Narrator",
        "text": "Josh Weier proved that autonomy requires boundaries: grinding late into the night isn't heroism—sharp, focused teamwork beats exhaustion every time.",
        "target_start": 97.5
    },
    # Part B: Documented Challenges & Realities
    {
        "id": "act3_04_jo_freeman",
        "act": 3,
        "title": "Jo Freeman — The Tyranny of Structurelessness",
        "speaker": "Narrator",
        "text": "Yet Flatland has real traps. As Jo Freeman warned in The Tyranny of Structurelessness, removing formal hierarchy can breed invisible informal power.",
        "target_start": 109.5
    },
    {
        "id": "act3_05_rich_geldreich",
        "act": 3,
        "title": "Rich Geldreich — Stack Ranking & Cliques",
        "speaker": "Narrator",
        "text": "Former engineer Rich Geldreich warned how peer stack rankings could foster hidden cliques and subtle peer pressure beneath the surface.",
        "target_start": 121.5
    },
    {
        "id": "act3_06_phantom_crunch",
        "act": 3,
        "title": "Phantom Crunch & Boundary Protection",
        "speaker": "Narrator",
        "text": "Valve's handbook explicitly cautions against phantom crunch. Without managers setting hours, teammates must actively look out for each other's rest.",
        "target_start": 133.0
    },

    # Act 4: Core Takeaway & Creative Leverage (2:25 - 3:00)
    {
        "id": "act4_01_gabe_closing",
        "act": 4,
        "title": "The Philosophy of Trust",
        "speaker": "Narrator",
        "text": "Ultimately, Gabe Newell's thirty-year experiment proves that creative mastery cannot be commanded—it thrives only on mutual trust.",
        "target_start": 145.0
    },
    {
        "id": "act4_02_creative_leverage",
        "act": 4,
        "title": "Exponential Human Leverage",
        "speaker": "Narrator",
        "text": "Whether building software or designing lessons for students, trusting professionals as equals unlocks exponential creative leverage.",
        "target_start": 156.0
    },
    {
        "id": "act4_03_outro_tag",
        "act": 4,
        "title": "Final Resolution",
        "speaker": "Narrator",
        "text": "When you remove hierarchy, the work speaks for itself—and the learners always come first.",
        "target_start": 166.5
    }
]

KOKORO_DIR = PROJECT_ROOT / "Kokoro-FastAPI"
PYTHON_EXE = KOKORO_DIR / ".venv" / "Scripts" / "python.exe"
ESPEAK_DLL = KOKORO_DIR / ".venv" / "Lib" / "site-packages" / "espeakng_loader" / "espeak-ng.dll"
ESPEAK_DATA = KOKORO_DIR / ".venv" / "Lib" / "site-packages" / "espeakng_loader" / "espeak-ng-data"

def is_server_ready():
    try:
        req = urllib.request.urlopen("http://127.0.0.1:8880/v1/audio/voices", timeout=2)
        return req.status == 200
    except Exception:
        return False

def ensure_kokoro_server():
    if is_server_ready():
        print("Kokoro TTS server is active on http://127.0.0.1:8880")
        return None
        
    print("Starting Kokoro TTS server...")
    env = os.environ.copy()
    env["PHONEMIZER_ESPEAK_LIBRARY"] = str(ESPEAK_DLL)
    env["ESPEAK_DATA_PATH"] = str(ESPEAK_DATA)
    env["PYTHONUTF8"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    env["PROJECT_ROOT"] = str(KOKORO_DIR)
    env["USE_GPU"] = "false"
    env["PYTHONPATH"] = f"{KOKORO_DIR};{KOKORO_DIR / 'api'}"
    env["MODEL_DIR"] = "src/models"
    env["VOICES_DIR"] = "src/voices/v1_0"
    env["WEB_PLAYER_PATH"] = str(KOKORO_DIR / 'web')

    cmd = [str(PYTHON_EXE), "-m", "uvicorn", "api.src.main:app", "--host", "127.0.0.1", "--port", "8880"]
    proc = subprocess.Popen(cmd, cwd=str(KOKORO_DIR), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    for i in range(45):
        time.sleep(1)
        if is_server_ready():
            print(f"Kokoro server ready in {i+1}s!")
            return proc

    print("Kokoro server failed to start within 45s.")
    proc.kill()
    sys.exit(1)

def synthesize_beat(beat, force=False):
    beat_wav = OUT_DIR / f"{beat['id']}.wav"
    txt_file = OUT_DIR / f"{beat['id']}.txt"
    meta_file = OUT_DIR / f"{beat['id']}.meta.json"
    
    expected_meta = {"voice": VOICE, "speed": SPEED, "text": beat["text"].strip()}
    
    need_synth = force or not beat_wav.exists()
    if meta_file.exists() and not need_synth:
        try:
            cached_meta = json.loads(meta_file.read_text(encoding="utf-8"))
            if cached_meta != expected_meta:
                need_synth = True
        except Exception:
            need_synth = True
    elif not meta_file.exists():
        need_synth = True

    if not need_synth:
        data, sr = sf.read(str(beat_wav))
        return data, sr

    print(f"  [Synth] Synthesizing {beat['id']} (voice={VOICE}, speed={SPEED})...")
    payload = {
        "model": "kokoro",
        "input": beat["text"],
        "voice": VOICE,
        "response_format": "wav",
        "speed": SPEED
    }
    req = urllib.request.Request(
        "http://127.0.0.1:8880/v1/audio/speech",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        with open(beat_wav, "wb") as f:
            f.write(resp.read())
            
    txt_file.write_text(beat["text"].strip(), encoding="utf-8")
    meta_file.write_text(json.dumps(expected_meta), encoding="utf-8")
    data, sr = sf.read(str(beat_wav))
    return data, sr

def apply_dsp(speech_raw, sr_speech):
    """Apply highpass filter, warm vocal resonance EQ, broadcast smoothing, and peak normalization."""
    if speech_raw.ndim > 1:
        speech_raw = speech_raw[:, 0]
    speech_raw = speech_raw.astype(np.float32)

    # Resample to 48kHz
    if sr_speech != SAMPLE_RATE:
        import math
        import scipy.signal
        g = math.gcd(int(SAMPLE_RATE), int(sr_speech))
        up = int(SAMPLE_RATE) // g
        down = int(sr_speech) // g
        speech_48k = scipy.signal.resample_poly(speech_raw, up, down)
    else:
        speech_48k = speech_raw

    # 1. 80Hz rumble highpass filter (order 4)
    sos_hp = butter(4, 80.0, btype='highpass', fs=SAMPLE_RATE, output='sos')
    speech_filtered = sosfilt(sos_hp, speech_48k)

    # 2. Warm low-mid presence boost (~150Hz, +2.8dB) for authentic documentary baritone warmth
    f0 = 150.0
    gain_db = 2.8
    Q = 1.0
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * f0 / SAMPLE_RATE
    alpha = np.sin(w0) / (2 * Q)
    b0 = 1 + alpha * A
    b1 = -2 * np.cos(w0)
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * np.cos(w0)
    a2 = 1 - alpha / A
    b = np.array([b0/a0, b1/a0, b2/a0], dtype=np.float32)
    a = np.array([1.0, a1/a0, a2/a0], dtype=np.float32)
    import scipy.signal
    speech_warm = scipy.signal.lfilter(b, a, speech_filtered)

    # 3. High-shelf broadcast de-harshing (-2.0 dB above 7.5 kHz)
    fh = 7500.0
    gain_h_db = -2.0
    Ah = 10 ** (gain_h_db / 40.0)
    w0h = 2 * np.pi * fh / SAMPLE_RATE
    alphah = np.sin(w0h) / 2 * np.sqrt((Ah + 1/Ah) * (1/0.7 - 1) + 2)
    cos_w0h = np.cos(w0h)
    two_sqrt_Ah_alphah = 2 * np.sqrt(Ah) * alphah
    bh0 = Ah * ((Ah + 1) + (Ah - 1) * cos_w0h + two_sqrt_Ah_alphah)
    bh1 = -2 * Ah * ((Ah - 1) + (Ah + 1) * cos_w0h)
    bh2 = Ah * ((Ah + 1) + (Ah - 1) * cos_w0h - two_sqrt_Ah_alphah)
    ah0 = (Ah + 1) - (Ah - 1) * cos_w0h + two_sqrt_Ah_alphah
    ah1 = 2 * ((Ah - 1) - (Ah + 1) * cos_w0h)
    ah2 = (Ah + 1) - (Ah - 1) * cos_w0h - two_sqrt_Ah_alphah
    bh = np.array([bh0/ah0, bh1/ah0, bh2/ah0], dtype=np.float32)
    ah = np.array([1.0, ah1/ah0, ah2/ah0], dtype=np.float32)
    speech_smooth = scipy.signal.lfilter(bh, ah, speech_warm)

    # 4. Peak normalization to -1.5 dBFS
    peak = np.max(np.abs(speech_smooth))
    if peak > 0:
        speech_norm = speech_smooth * (10 ** (-1.5 / 20.0) / peak)
    else:
        speech_norm = speech_smooth

    return speech_norm

def generate_ambient_music(duration_sec=180.0, fs=48000):
    """Synthesize warm, expansive, contemplative documentary soundtrack."""
    print(f"Synthesizing {duration_sec}s documentary ambient score...")
    t = np.linspace(0, duration_sec, int(duration_sec * fs), endpoint=False)
    
    sub = (
        0.30 * np.sin(2 * np.pi * 36.71 * t) +
        0.35 * np.sin(2 * np.pi * 73.42 * t) +
        0.15 * np.sin(2 * np.pi * 55.00 * t + 0.3)
    )
    
    pad_l = np.zeros_like(t)
    pad_r = np.zeros_like(t)
    
    freqs_dmin = [73.42, 110.00, 146.83, 174.61, 220.00, 293.66, 349.23, 440.00]
    
    for i, f in enumerate(freqs_dmin):
        amp = 1.0 / (1.0 + 0.28 * i)
        detune = 0.22 + 0.06 * i
        
        osc1 = np.sin(2 * np.pi * (f - detune) * t)
        osc2 = np.sin(2 * np.pi * f * t + 0.8)
        osc3 = np.sin(2 * np.pi * (f + detune) * t + 1.6)
        
        warmth = 0.15 * np.sin(2 * np.pi * (f * 1.5) * t)
        sig = amp * (0.35 * osc1 + 0.40 * osc2 + 0.35 * osc3 + warmth)
        
        pan = np.sin(0.15 * t + i * 1.1) * 0.40
        pad_l += sig * (0.50 - pan)
        pad_r += sig * (0.50 + pan)
        
    lfo = 0.82 + 0.18 * np.sin(2 * np.pi * 0.08 * t)
    pad_l *= lfo
    pad_r *= lfo
    
    ambient_l = sub * 0.45 + pad_l * 0.25
    ambient_r = sub * 0.45 + pad_r * 0.25
    
    fade_in = int(1.5 * fs)
    fade_out = int(3.5 * fs)
    env = np.ones_like(t)
    env[:fade_in] = np.sin(np.linspace(0, np.pi/2, fade_in)) ** 2
    env[-fade_out:] = np.cos(np.linspace(0, np.pi/2, fade_out)) ** 2
    
    ambient_l *= env
    ambient_r *= env
    
    ambient_stereo = np.column_stack([ambient_l, ambient_r])
    peak = np.max(np.abs(ambient_stereo))
    if peak > 0:
        ambient_stereo = ambient_stereo * (10 ** (-18.0 / 20.0) / peak)
        
    return ambient_stereo

def build_master_soundtrack(force_synth=False):
    print("=" * 70)
    print("Building 3-Minute Valve Documentary Soundtrack")
    print(f"Voice: {VOICE} @ speed {SPEED} (Deeper, warmer, slower documentary timbre)")
    print("=" * 70)

    ensure_kokoro_server()

    # 1. Synthesize all beats
    beat_manifests = []
    current_time = 2.0

    print("\nPhase 1: Synthesizing & Processing Narration Beats...")
    for idx, beat in enumerate(BEATS):
        raw_audio, sr = synthesize_beat(beat, force=force_synth)
        processed = apply_dsp(raw_audio, sr)
        dur = len(processed) / SAMPLE_RATE

        start_t = max(current_time, beat.get("target_start", current_time))
        end_t = start_t + dur
        current_time = end_t + 1.35  # Natural pause between documentary beats


        entry = dict(beat)
        entry["audio_duration"] = dur
        entry["start_time"] = start_t
        entry["end_time"] = end_t
        entry["processed_audio"] = processed
        beat_manifests.append(entry)

        print(f"  Beat {idx+1:2d} [{entry['act']}]: {entry['title']} ({dur:5.2f}s) -> [{start_t:6.2f}s - {end_t:6.2f}s]")

    last_end = beat_manifests[-1]["end_time"]
    print(f"\nFinal Speech Beat Ends At: {last_end:.2f}s (Budget: {TOTAL_SECONDS}s)")
    if last_end > TOTAL_SECONDS - 2.5:
        raise ValueError(f"Speech ends at {last_end:.2f}s, exceeding maximum allowed audio budget ({TOTAL_SECONDS - 2.5}s)!")

    # 2. Assemble Master Voice Track
    print("\nPhase 2: Assembling Master Speech Track...")
    master_speech = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)

    duck_curve = np.ones(TOTAL_SAMPLES, dtype=np.float32)
    duck_level = 0.20  # Duck to -22 dBFS during speech
    ramp_samples = int(0.30 * SAMPLE_RATE)

    for b in beat_manifests:
        s_idx = max(0, min(TOTAL_SAMPLES, int(b["start_time"] * SAMPLE_RATE)))
        audio = b["processed_audio"]
        e_idx = max(s_idx, min(TOTAL_SAMPLES, s_idx + len(audio)))
        actual_len = e_idx - s_idx

        master_speech[s_idx:e_idx, 0] = audio[:actual_len]
        master_speech[s_idx:e_idx, 1] = audio[:actual_len]

        d_start = max(0, min(TOTAL_SAMPLES, s_idx - int(0.18 * SAMPLE_RATE)))
        d_end = max(d_start, min(TOTAL_SAMPLES, e_idx + int(0.28 * SAMPLE_RATE)))

        r_down_end = max(d_start, min(TOTAL_SAMPLES, d_start + ramp_samples))
        if r_down_end > d_start:
            duck_curve[d_start:r_down_end] = np.minimum(
                duck_curve[d_start:r_down_end],
                np.linspace(1.0, duck_level, r_down_end - d_start)
            )
        if d_end > r_down_end:
            duck_curve[r_down_end:d_end] = np.minimum(duck_curve[r_down_end:d_end], duck_level)
            
        r_up_end = max(d_end, min(TOTAL_SAMPLES, d_end + ramp_samples))
        if r_up_end > d_end:
            duck_curve[d_end:r_up_end] = np.minimum(
                duck_curve[d_end:r_up_end],
                np.linspace(duck_level, 1.0, r_up_end - d_end)
            )

    # 3. Generate Ambient Music Bed
    print("\nPhase 3: Synthesizing Ambient Bed...")
    ambient_music = generate_ambient_music(duration_sec=TOTAL_SECONDS, fs=SAMPLE_RATE)

    # Duck ambient music under speech
    ambient_ducked = ambient_music * duck_curve[:, np.newaxis]

    # 4. Master Mix
    print("\nPhase 4: Master Mixing & Limiting...")
    mix = master_speech + ambient_ducked

    peak = np.max(np.abs(mix))
    target_ceiling = 10 ** (-1.0 / 20.0)
    if peak > target_ceiling:
        mix = mix * (target_ceiling / peak)

    sf.write(str(MASTER_WAV), mix, SAMPLE_RATE, subtype='PCM_16')
    print(f"\nMaster Audio Generated: {MASTER_WAV}")
    print(f"  Duration: {len(mix)/SAMPLE_RATE:.4f}s ({len(mix)} samples)")
    print(f"  Channels: 2 (Stereo 48kHz)")
    print(f"  Peak: {20 * np.log10(np.max(np.abs(mix))):.2f} dBFS")

    manifest_beats = []
    for b in beat_manifests:
        clean_b = {k: v for k, v in b.items() if k != "processed_audio"}
        manifest_beats.append(clean_b)

    manifest_data = {
        "title": "Valve: The Flatland Experiment — 3-Minute Documentary",
        "voice": VOICE,
        "speed": SPEED,
        "total_duration": TOTAL_SECONDS,
        "sample_rate": SAMPLE_RATE,
        "beats": manifest_beats
    }
    with open(str(MANIFEST_JSON), "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)
    print(f"  Manifest: {MANIFEST_JSON}")
    print("=" * 70)

if __name__ == "__main__":
    force = "--force" in sys.argv
    build_master_soundtrack(force_synth=force)

