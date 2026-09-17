"""
Smart batch synthesizer for Gemini voices (Fenrir & Charon) to produce
all 15 beats within API free-tier quota using local Whisper boundary detection,
then assemble and remux into 3-minute documentary videos.
"""

import os
import sys
import json
import time
import math
import wave
import subprocess
import numpy as np
import soundfile as sf
import scipy.signal
from scipy.signal import butter, sosfilt
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(r"C:\Cursor AI")
load_dotenv(PROJECT_ROOT / ".env")

OUT_DIR = PROJECT_ROOT / "exported_slides" / "multivoice_3min"
OUT_DIR.mkdir(parents=True, exist_ok=True)
MASTER_VIDEO = PROJECT_ROOT / "exported_slides" / "valve_flatland_documentary_3min.mp4"

SAMPLE_RATE = 48000
TOTAL_SECONDS = 180.0
TOTAL_SAMPLES = int(SAMPLE_RATE * TOTAL_SECONDS)

# 15 narrative documentary beats
BEATS = [
    {
        "id": "act1_01_gabe_intro",
        "act": 1,
        "title": "Gabe Newell & The Genesis",
        "text": "In 1996, a former Microsoft systems engineer named Gabe Newell walked away from corporate stability to test a radical premise.",
        "target_start": 2.0
    },
    {
        "id": "act1_02_corporate_ladder",
        "act": 1,
        "title": "The Failure of Corporate Hierarchy",
        "text": "Newell realized that while traditional corporate ladders worked for factory assembly lines, they crippled creative software development.",
        "target_start": 13.5
    },
    {
        "id": "act1_03_ronald_coase",
        "act": 1,
        "title": "Ronald Coase & Transaction Costs",
        "text": "Gabe based this on Ronald Coase's theory of transaction costs: eliminating middle managers so creative professionals answer directly to customers.",
        "target_start": 24.5
    },
    {
        "id": "act2_01_welcome_flatland",
        "act": 2,
        "title": "Welcome to Flatland",
        "text": "Welcome to Flatland. At Valve, there are no job titles, no project managers, and no bureaucratic sign-offs.",
        "target_start": 36.5
    },
    {
        "id": "act2_02_desks_on_wheels",
        "act": 2,
        "title": "Desks on Wheels & Cabals",
        "text": "Workstations are mounted on heavy wheels. If a creator spots an exciting challenge, they unplug, roll across the studio, and form a self-selecting team called a Cabal.",
        "target_start": 47.0
    },
    {
        "id": "act2_03_voting_with_feet",
        "act": 2,
        "title": "Voting With Your Feet",
        "text": "Nobody assigns you tickets. People vote with their feet. If a project ignites momentum, it ships; if nobody joins, it quietly fades away.",
        "target_start": 60.5
    },
    {
        "id": "act3_01_chet_faliszek",
        "act": 3,
        "title": "Chet Faliszek — Action Over Permission",
        "text": "Writer Chet Faliszek championed action over permission: don't wait for sign-off—build a quick prototype and let the results do the talking.",
        "target_start": 74.5
    },
    {
        "id": "act3_02_erik_wolpaw",
        "act": 3,
        "title": "Erik Wolpaw — Leave Egos at the Door",
        "text": "Erik Wolpaw urged creators to leave egos at the door: without bosses to impress, ideas stand or fall purely on whether they delight the player.",
        "target_start": 86.0
    },
    {
        "id": "act3_03_josh_weier",
        "act": 3,
        "title": "Josh Weier — Healthy Boundaries",
        "text": "Josh Weier proved that autonomy requires boundaries: grinding late into the night isn't heroism—sharp, focused teamwork beats exhaustion every time.",
        "target_start": 97.5
    },
    {
        "id": "act3_04_jo_freeman",
        "act": 3,
        "title": "Jo Freeman — The Tyranny of Structurelessness",
        "text": "Yet Flatland has real traps. As Jo Freeman warned in The Tyranny of Structurelessness, removing formal hierarchy can breed invisible informal power.",
        "target_start": 109.5
    },
    {
        "id": "act3_05_rich_geldreich",
        "act": 3,
        "title": "Rich Geldreich — Stack Ranking & Cliques",
        "text": "Former engineer Rich Geldreich warned how peer stack rankings could foster hidden cliques and subtle peer pressure beneath the surface.",
        "target_start": 121.5
    },
    {
        "id": "act3_06_phantom_crunch",
        "act": 3,
        "title": "Phantom Crunch & Boundary Protection",
        "text": "Valve's handbook explicitly cautions against phantom crunch. Without managers setting hours, teammates must actively look out for each other's rest.",
        "target_start": 133.0
    },
    {
        "id": "act4_01_gabe_closing",
        "act": 4,
        "title": "The Philosophy of Trust",
        "text": "Ultimately, Gabe Newell's thirty-year experiment proves that creative mastery cannot be commanded—it thrives only on mutual trust.",
        "target_start": 145.0
    },
    {
        "id": "act4_02_creative_leverage",
        "act": 4,
        "title": "Exponential Human Leverage",
        "text": "Whether building software or designing lessons for students, trusting professionals as equals unlocks exponential creative leverage.",
        "target_start": 156.0
    },
    {
        "id": "act4_03_outro_tag",
        "act": 4,
        "title": "Final Resolution",
        "text": "When you remove hierarchy, the work speaks for itself—and the learners always come first.",
        "target_start": 166.5
    }
]

def get_client():
    from google import genai
    key = os.getenv("GEMINI_API_KEY_BACKUP") or os.getenv("GEMINI_API_KEY")
    return genai.Client(api_key=key)

def generate_batch_audio(beats_subset, voice_name, model_name="gemini-3.1-flash-tts-preview"):
    client = get_client()
    from google.genai import types

    lines = []
    for i, b in enumerate(beats_subset):
        lines.append(f"Section {i+1}: {b['text']}")
    joined_text = "\n\n".join(lines)

    prompt = (
        "Read each section clearly in a slow, deep, warm, reflective documentary narration style.\n"
        "Leave a 2-second silence between each section.\n"
        "Do not read the section labels out loud, read only the narrative sentences.\n\n"
        f"{joined_text}"
    )

    print(f"Calling Gemini API ({model_name}, Voice={voice_name}, {len(beats_subset)} beats)...")
    res = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
                )
            )
        )
    )
    raw_bytes = res.candidates[0].content.parts[0].inline_data.data
    return raw_bytes

def align_and_slice(raw_bytes, beats_subset, voice_id):
    voice_dir = OUT_DIR / voice_id
    voice_dir.mkdir(parents=True, exist_ok=True)
    temp_wav = voice_dir / f"batch_temp_{time.time_ns()}.wav"

    with wave.open(str(temp_wav), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(raw_bytes)

    full_audio, sr = sf.read(str(temp_wav))
    total_dur = len(full_audio) / sr
    print(f"Batch audio generated: {total_dur:.2f}s at {sr}Hz. Transcribing with Whisper for alignment...")

    import whisper
    whisper_model = whisper.load_model("base")
    transcription = whisper_model.transcribe(str(temp_wav))
    segments = transcription.get("segments", [])
    print(f"Whisper found {len(segments)} segments.")

    # Match each beat in beats_subset to segment boundaries
    # Strategy: for each beat, find segment where the start of beat text is mentioned
    beat_bounds = []
    cur_seg_idx = 0

    for b_idx, beat in enumerate(beats_subset):
        # find the segment that contains initial words of beat['text']
        first_word = beat["text"].split()[0].lower().strip(".,;:!?\"'")
        second_word = beat["text"].split()[1].lower().strip(".,;:!?\"'")
        
        found_start = None
        for s_idx in range(cur_seg_idx, len(segments)):
            seg_text = segments[s_idx]["text"].lower()
            if first_word in seg_text and second_word in seg_text:
                found_start = segments[s_idx]["start"]
                cur_seg_idx = s_idx
                break
        
        if found_start is None:
            # Fallback proportional if not cleanly matched
            found_start = (b_idx / len(beats_subset)) * total_dur
            print(f"  [WARN] Fallback start timestamp for beat '{beat['id']}': {found_start:.2f}s")
        else:
            print(f"  [ALIGNED] Beat '{beat['id']}' starts at {found_start:.2f}s")

        beat_bounds.append(found_start)

    # Calculate end for each beat
    for b_idx, beat in enumerate(beats_subset):
        start_t = max(0.0, beat_bounds[b_idx] - 0.15) # 150ms pre-pad
        if b_idx < len(beats_subset) - 1:
            end_t = beat_bounds[b_idx + 1] - 0.10 # 100ms before next
        else:
            end_t = total_dur # up to end of batch

        # Clamp slice
        start_samp = int(start_t * sr)
        end_samp = min(int(end_t * sr), len(full_audio))
        slice_audio = full_audio[start_samp:end_samp]

        # Trim trailing silence within slice
        # Energy based end trim
        frame_len = int(0.05 * sr)
        energies = [np.mean(slice_audio[k:k+frame_len]**2) for k in range(0, len(slice_audio)-frame_len, frame_len)]
        non_silent = [k for k, e in enumerate(energies) if e > 2e-5]
        if non_silent:
            trimmed_end_samp = min(len(slice_audio), (non_silent[-1] + 6) * frame_len) # add 300ms tail
            slice_audio = slice_audio[:trimmed_end_samp]

        out_wav = voice_dir / f"{beat['id']}.wav"
        meta_path = voice_dir / f"{beat['id']}.meta.json"
        sf.write(str(out_wav), slice_audio, sr)
        meta_key = {"voice_id": voice_id, "text": beat["text"]}
        meta_path.write_text(json.dumps(meta_key), encoding="utf-8")
        print(f"  -> Saved beat {beat['id']}: {len(slice_audio)/sr:.2f}s to {out_wav.name}")

    if temp_wav.exists():
        temp_wav.unlink()

# --- DSP & Soundtrack Mixing ---

def apply_dsp(speech_raw, sr_speech):
    if speech_raw.ndim > 1:
        speech_raw = speech_raw[:, 0]
    speech_raw = speech_raw.astype(np.float32)

    if sr_speech != SAMPLE_RATE:
        g = math.gcd(int(SAMPLE_RATE), int(sr_speech))
        up = int(SAMPLE_RATE) // g
        down = int(sr_speech) // g
        speech_48k = scipy.signal.resample_poly(speech_raw, up, down)
    else:
        speech_48k = speech_raw

    # 1. 80Hz rumble highpass
    sos_hp = butter(4, 80.0, btype="highpass", fs=SAMPLE_RATE, output="sos")
    speech_filtered = sosfilt(sos_hp, speech_48k)

    # 2. Warm low-mid presence boost (~150Hz, +2.5dB)
    f0, gain_db, Q = 150.0, 2.5, 1.0
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * f0 / SAMPLE_RATE
    alpha = np.sin(w0) / (2 * Q)
    b0, b1, b2 = 1 + alpha * A, -2 * np.cos(w0), 1 - alpha * A
    a0, a1, a2 = 1 + alpha / A, -2 * np.cos(w0), 1 - alpha / A
    b = np.array([b0/a0, b1/a0, b2/a0], dtype=np.float32)
    a = np.array([1.0, a1/a0, a2/a0], dtype=np.float32)
    speech_warm = scipy.signal.lfilter(b, a, speech_filtered)

    # 3. Peak normalization to -1.5 dBFS
    peak = np.max(np.abs(speech_warm))
    if peak > 0:
        speech_norm = speech_warm * (10 ** (-1.5 / 20.0) / peak)
    else:
        speech_norm = speech_warm
    return speech_norm

def generate_ambient_music(duration_sec=180.0, fs=48000):
    t = np.linspace(0, duration_sec, int(duration_sec * fs), endpoint=False)
    sub = (
        0.30 * np.sin(2 * np.pi * 36.71 * t) +
        0.35 * np.sin(2 * np.pi * 73.42 * t) +
        0.15 * np.sin(2 * np.pi * 55.00 * t + 0.3)
    )
    pad_l, pad_r = np.zeros_like(t), np.zeros_like(t)
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
    fade_in, fade_out = int(1.5 * fs), int(3.5 * fs)
    env = np.ones_like(t)
    env[:fade_in] = np.sin(np.linspace(0, np.pi/2, fade_in)) ** 2
    env[-fade_out:] = np.cos(np.linspace(0, np.pi/2, fade_out)) ** 2
    ambient_stereo = np.column_stack([ambient_l * env, ambient_r * env])
    peak = np.max(np.abs(ambient_stereo))
    if peak > 0:
        ambient_stereo = ambient_stereo * (10 ** (-18.0 / 20.0) / peak)
    return ambient_stereo

_cached_ambient = None
def get_ambient_score():
    global _cached_ambient
    if _cached_ambient is None:
        _cached_ambient = generate_ambient_music(TOTAL_SECONDS, SAMPLE_RATE)
    return _cached_ambient

def assemble_master_audio(voice_id, voice_display_name):
    print(f"\n--- Assembling 180s Master Audio for {voice_display_name} ({voice_id}) ---")
    timeline_speech = np.zeros(TOTAL_SAMPLES, dtype=np.float32)
    timeline_ducking = np.zeros(TOTAL_SAMPLES, dtype=np.float32)

    voice_dir = OUT_DIR / voice_id
    for i, beat in enumerate(BEATS):
        wav_path = voice_dir / f"{beat['id']}.wav"
        if not wav_path.exists():
            raise FileNotFoundError(f"Missing beat wav: {wav_path}")
        data, sr = sf.read(str(wav_path))
        dsp_audio = apply_dsp(data, sr)

        start_idx = int(beat["target_start"] * SAMPLE_RATE)
        end_idx = min(start_idx + len(dsp_audio), TOTAL_SAMPLES)
        usable_len = end_idx - start_idx
        timeline_speech[start_idx:end_idx] += dsp_audio[:usable_len]

        duck_pre = int(0.3 * SAMPLE_RATE)
        duck_post = int(0.5 * SAMPLE_RATE)
        d_start = max(0, start_idx - duck_pre)
        d_end = min(TOTAL_SAMPLES, end_idx + duck_post)
        timeline_ducking[d_start:d_end] = 1.0

    # Smooth ducking curve (1.2s window)
    window_len = int(1.2 * SAMPLE_RATE)
    smooth_kernel = np.hanning(window_len)
    smooth_kernel /= np.sum(smooth_kernel)
    duck_envelope = np.convolve(timeline_ducking, smooth_kernel, mode="same")
    duck_envelope = np.clip(duck_envelope, 0.0, 1.0)

    # Ducking gain: -22dB during speech
    duck_gain_db = -22.0 * duck_envelope
    duck_gain = 10.0 ** (duck_gain_db / 20.0)

    ambient = get_ambient_score().copy()
    ambient[:, 0] *= duck_gain
    ambient[:, 1] *= duck_gain

    master = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)
    master[:, 0] = timeline_speech + ambient[:, 0]
    master[:, 1] = timeline_speech + ambient[:, 1]

    peak = np.max(np.abs(master))
    if peak > 0:
        master = master * (10 ** (-1.40 / 20.0) / peak)

    out_master_wav = PROJECT_ROOT / "exported_slides" / f"valve_doc_3min_{voice_id}_audio.wav"
    sf.write(str(out_master_wav), master, SAMPLE_RATE)
    print(f"  [SUCCESS] Master audio written: {out_master_wav} ({TOTAL_SECONDS}s, 48kHz stereo)")
    return out_master_wav

def remux_video(voice_id, audio_wav, voice_display_name):
    out_video = PROJECT_ROOT / "exported_slides" / f"valve_doc_3min_{voice_id}.mp4"
    print(f"\n--- Remuxing 3-minute video for {voice_display_name} ---")
    cmd = [
        "ffmpeg", "-y",
        "-i", str(MASTER_VIDEO),
        "-i", str(audio_wav),
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "256k",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-shortest",
        "-movflags", "+faststart",
        str(out_video)
    ]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print("FFmpeg error:", res.stderr)
        raise RuntimeError("FFmpeg remux failed")
    size_mb = out_video.stat().st_size / (1024 * 1024)
    print(f"  [SUCCESS] Rendered: {out_video} ({size_mb:.2f} MB)")
    return out_video

def main():
    print("==================================================================")
    print("SMART BATCH SYNTHESIZER: GEMINI FENRIR & CHARON (3-MIN DOCUMENTARY)")
    print("==================================================================")

    # 1. Check Fenrir missing beats
    fenrir_dir = OUT_DIR / "gemini_fenrir"
    missing_fenrir = [b for b in BEATS if not (fenrir_dir / f"{b['id']}.wav").exists()]
    print(f"Gemini Fenrir: {len(missing_fenrir)} missing beats.")

    if missing_fenrir:
        # Generate missing beats for Fenrir in 2 safe chunks
        mid = len(missing_fenrir) // 2
        chunks = [missing_fenrir[:mid], missing_fenrir[mid:]] if len(missing_fenrir) > 6 else [missing_fenrir]
        for chunk_idx, chunk in enumerate(chunks):
            print(f"\nGenerating Fenrir chunk {chunk_idx+1}/{len(chunks)} ({len(chunk)} beats)...")
            raw_bytes = generate_batch_audio(chunk, "Fenrir", model_name="gemini-3.1-flash-tts-preview")
            align_and_slice(raw_bytes, chunk, "gemini_fenrir")
            time.sleep(2.0)

    # 2. Assemble and Remux Fenrir
    fenrir_audio = assemble_master_audio("gemini_fenrir", "Google Gemini Fenrir (Warm Raspy Baritone)")
    fenrir_video = remux_video("gemini_fenrir", fenrir_audio, "Google Gemini Fenrir (Warm Raspy Baritone)")

    # 3. Check Charon missing beats
    charon_dir = OUT_DIR / "gemini_charon"
    missing_charon = [b for b in BEATS if not (charon_dir / f"{b['id']}.wav").exists()]
    print(f"\nGemini Charon: {len(missing_charon)} missing beats.")

    if missing_charon:
        # Split 15 beats into 2 chunks: beats 0..7 and 7..15
        mid = len(missing_charon) // 2
        chunks = [missing_charon[:mid], missing_charon[mid:]]
        for chunk_idx, chunk in enumerate(chunks):
            print(f"\nGenerating Charon chunk {chunk_idx+1}/{len(chunks)} ({len(chunk)} beats)...")
            raw_bytes = generate_batch_audio(chunk, "Charon", model_name="gemini-2.5-pro-preview-tts")
            align_and_slice(raw_bytes, chunk, "gemini_charon")
            time.sleep(2.0)

    # 4. Assemble and Remux Charon
    charon_audio = assemble_master_audio("gemini_charon", "Google Gemini Charon (Grave Documentary)")
    charon_video = remux_video("gemini_charon", charon_audio, "Google Gemini Charon (Grave Documentary)")

    print("\n==================================================================")
    print("ALL GEMINI DELIVERABLES READY!")
    print(f"Fenrir Video: {fenrir_video}")
    print(f"Charon Video: {charon_video}")
    print("==================================================================")

if __name__ == "__main__":
    main()
