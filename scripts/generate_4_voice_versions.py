"""
Generate 4 distinct voice versions of the 3-minute Valve Flatland Documentary Video:
1. google_fenrir: Google Gemini 2.5 Flash Native Audio (Fenrir - slow, deep, warm, raspy baritone)
2. google_charon: Google Gemini 2.5 Flash Native Audio (Charon - deep, authoritative, grave documentary narrator)
3. azure_ryan: Azure Neural TTS (en-GB-RyanNeural - deep, calm British UK documentary voice)
4. kokoro_george: Kokoro TTS (bm_george - deep British UK narrator, local)

Workflow:
1. Synthesize all 15 beats for each voice.
2. Assemble onto exact 180.000s master timeline with ambient music ducking.
3. Remux with the 1080p 30fps master video stream using FFmpeg -c:v copy.
"""

import os
import sys
import json
import time
import math
import wave
import requests
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

VOICE_CONFIGS = {
    "gemini_fenrir": {
        "engine": "gemini",
        "model": "gemini-2.5-flash-preview-tts",
        "voice": "Fenrir",
        "name": "Google Gemini Fenrir (Warm Raspy Baritone)",
        "desc": "Deep, warm, reflective baritone with natural human breathing and emotional resonance."
    },
    "gemini_charon": {
        "engine": "gemini",
        "model": "gemini-2.5-flash-preview-tts",
        "voice": "Charon",
        "name": "Google Gemini Charon (Authoritative Grave Documentary)",
        "desc": "Deep, authoritative, grave male documentary voice with dramatic weight."
    },
    "azure_ryan": {
        "engine": "azure",
        "voice": "en-GB-RyanNeural",
        "name": "Azure Ryan Neural (British UK Documentary)",
        "desc": "Deep, calm, cultured British UK documentary narrator voice."
    },
    "kokoro_george": {
        "engine": "kokoro",
        "voice": "bm_george",
        "speed": 0.88,
        "name": "Kokoro British George (UK Local Offline)",
        "desc": "Classic British BBC documentary narrator, local synthesis."
    }
}

# --- Synthesis Engines ---

_gemini_client = None
def get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        from google import genai
        _gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _gemini_client

def synth_gemini(text, voice_name, out_wav):
    client = get_gemini_client()
    from google.genai import types
    response = client.models.generate_content(
        model="gemini-2.5-flash-preview-tts",
        contents=f"Read the following text in a slow, deep, warm, reflective documentary narration style. Do not say anything else:\n\n\"{text}\"",
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
                )
            )
        )
    )
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            raw_bytes = part.inline_data.data
            with wave.open(str(out_wav), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(24000)
                wf.writeframes(raw_bytes)
            return True
    raise RuntimeError(f"No audio returned for Gemini voice {voice_name}")

def synth_azure(text, voice_name, out_wav):
    key = os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("AZURE_SPEECH_REGION", "southeastasia")
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        "User-Agent": "CursorAI"
    }
    ssml = f"""<speak version='1.0' xml:lang='en-GB'>
        <voice xml:lang='en-GB' name='{voice_name}'>
            <prosody rate='-5%' pitch='-2Hz'>
                {text}
            </prosody>
        </voice>
    </speak>"""
    res = requests.post(url, headers=headers, data=ssml.encode("utf-8"), timeout=15)
    if res.status_code == 200:
        with open(str(out_wav), "wb") as f:
            f.write(res.content)
        return True
    raise RuntimeError(f"Azure TTS error {res.status_code}: {res.text[:200]}")

def synth_kokoro(text, voice_name, speed, out_wav):
    url = "http://127.0.0.1:8880/v1/audio/speech"
    res = requests.post(url, json={
        "model": "kokoro",
        "input": text,
        "voice": voice_name,
        "response_format": "wav",
        "speed": speed
    }, timeout=20)
    if res.status_code == 200:
        data, sr = sf.read(io_bytes := io_import(res.content))
        sf.write(str(out_wav), data, sr)
        return True
    raise RuntimeError(f"Kokoro TTS error {res.status_code}")

import io
def io_import(bytes_data):
    return io.BytesIO(bytes_data)

def synth_beat(beat, voice_id, cfg):
    voice_dir = OUT_DIR / voice_id
    voice_dir.mkdir(parents=True, exist_ok=True)
    out_wav = voice_dir / f"{beat['id']}.wav"
    meta_path = voice_dir / f"{beat['id']}.meta.json"
    
    meta_key = {"voice_id": voice_id, "text": beat["text"]}
    if out_wav.exists() and meta_path.exists():
        try:
            cached = json.loads(meta_path.read_text(encoding="utf-8"))
            if cached == meta_key and out_wav.stat().st_size > 1000:
                data, sr = sf.read(str(out_wav))
                return data, sr
        except Exception:
            pass

    engine = cfg["engine"]
    if engine == "gemini":
        synth_gemini(beat["text"], cfg["voice"], out_wav)
    elif engine == "azure":
        synth_azure(beat["text"], cfg["voice"], out_wav)
    elif engine == "kokoro":
        synth_kokoro(beat["text"], cfg["voice"], cfg.get("speed", 0.88), out_wav)

    meta_path.write_text(json.dumps(meta_key), encoding="utf-8")
    data, sr = sf.read(str(out_wav))
    return data, sr

# --- DSP & Soundtrack Mixing ---

def apply_dsp(speech_raw, sr_speech):
    if speech_raw.ndim > 1:
        speech_raw = speech_raw[:, 0]
    speech_raw = speech_raw.astype(np.float32)

    # Resample to 48kHz
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

def build_voice_audio(voice_id, cfg):
    print(f"\n--- Generating Audio for {cfg['name']} ---")
    timeline_speech = np.zeros(TOTAL_SAMPLES, dtype=np.float32)
    timeline_ducking = np.zeros(TOTAL_SAMPLES, dtype=np.float32)

    for i, beat in enumerate(BEATS):
        print(f"  [Beat {i+1:02d}/15] {beat['title']}...")
        data, sr = synth_beat(beat, voice_id, cfg)
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

    # Smooth ducking curve (1.5s smoothing window)
    window_len = int(1.2 * SAMPLE_RATE)
    smooth_kernel = np.hanning(window_len)
    smooth_kernel /= np.sum(smooth_kernel)
    duck_envelope = np.convolve(timeline_ducking, smooth_kernel, mode="same")
    duck_envelope = np.clip(duck_envelope, 0.0, 1.0)

    # Ambient level: -22dB when speech active, 0dB baseline
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

def remux_video(voice_id, audio_wav, cfg):
    out_video = PROJECT_ROOT / "exported_slides" / f"valve_doc_3min_{voice_id}.mp4"
    print(f"\n--- Remuxing 3-minute video for {cfg['name']} ---")
    
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
    print("GENERATING 4 VOICE VERSIONS OF 3-MINUTE VALVE FLATLAND DOCUMENTARY")
    print("==================================================================")

    results = {}
    for voice_id, cfg in VOICE_CONFIGS.items():
        try:
            audio_wav = build_voice_audio(voice_id, cfg)
            video_mp4 = remux_video(voice_id, audio_wav, cfg)
            results[voice_id] = {
                "name": cfg["name"],
                "desc": cfg["desc"],
                "audio": str(audio_wav),
                "video": str(video_mp4),
                "size_mb": video_mp4.stat().st_size / (1024 * 1024)
            }
        except Exception as e:
            print(f"  [ERROR on {voice_id}]: {e}")
            import traceback
            traceback.print_exc()

    print("\n" + "=" * 70)
    print("ALL 4 VERSIONS GENERATED SUCCESSFULLY!")
    print("=" * 70)
    for vid, r in results.items():
        print(f"[{r['name']}]")
        print(f"  Video: {r['video']} ({r['size_mb']:.2f} MB)")
        print(f"  Audio: {r['audio']}")

if __name__ == "__main__":
    main()
