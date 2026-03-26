import os
import subprocess
import pandas as pd
from dotenv import load_dotenv
import requests
import random
import time
import base64

load_dotenv()

# --- API Configuration ---
# Using the Vertex AI Express key to bypass AI Studio limits
API_KEY = "AQ.Ab8RN6IevtwiomI4-zHShe_gVo__PYPcY0HlDukIul9qHdxZig"
PROJECT_ID = "gen-lang-client-0677756745"
LOCATION = "us-central1"
MODEL = "gemini-2.5-flash-preview-tts"

EXCEL_PATH = r"C:\Cursor AI\public\database\RFIB\RFIB Final ver.xlsx"
AUDIO_DIR = r"C:\Cursor AI\public\database\RFIB\audio"
os.makedirs(AUDIO_DIR, exist_ok=True)

df = pd.read_excel(EXCEL_PATH)

MALE_VOICES = ["Charon", "Fenrir", "Puck"]
FEMALE_VOICES = ["Aoede", "Kore"]

# --- Configuration ---
START_ROW = 0
END_ROW = 263  # exclusive — set to len(df) for full run
MP3_BITRATE = "64k"  # speech-optimized bitrate
FFMPEG_PATH = r"C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"

def generate_voice(text, voice_name, pcm_output_path, max_retries=5):
    if pd.isna(text) or str(text).strip() == "":
        return False
        
    url = f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL}:generateContent?key={API_KEY}"
    
    payload = {
        "contents": [{"role": "user", "parts": [{"text": str(text)}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice_name
                    }
                }
            }
        }
    }
    
    for attempt in range(max_retries):
        try:
            print(f"Generating audio for '{str(text)[:25]}...' using {voice_name} via Vertex")
            response = requests.post(url, json=payload)
            
            if response.status_code == 200:
                data = response.json()
                b64_audio = data['candidates'][0]['content']['parts'][0]['inlineData']['data']
                with open(pcm_output_path, "wb") as f:
                    f.write(base64.b64decode(b64_audio))
                return True
                
            err_str = response.text
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                wait = 5 * (2 ** attempt)
                print(f"  Rate limited (attempt {attempt+1}/{max_retries}). Retrying in {wait}s...")
                time.sleep(wait)
                continue
            elif "SSL" in err_str or "ssl" in err_str or "DECRYPTION" in err_str or "bad record mac" in err_str:
                wait = 5 * (2 ** attempt)
                print(f"  SSL error (attempt {attempt+1}/{max_retries}). Retrying in {wait}s...")
                time.sleep(wait)
                continue
            else:
                print(f"  API Error ({response.status_code}): {err_str}")
                if attempt < max_retries - 1:
                    time.sleep(3)
                    continue
                return False
                
        except Exception as e:
            err_str = str(e)
            if "SSL" in err_str or "ssl" in err_str or "DECRYPTION" in err_str or "bad record mac" in err_str:
                wait = 5 * (2 ** attempt)
                print(f"  Network/SSL error (attempt {attempt+1}/{max_retries}). Retrying in {wait}s...")
                time.sleep(wait)
                continue
            else:
                print(f"  Request Error: {e}")
                if attempt < max_retries - 1:
                    time.sleep(3)
                    continue
                return False
                
    print("  Max retries reached. Skipping.")
    return False


def convert_and_stretch(pcm_input, speeds_dict):
    """
    speeds_dict: {100: "out_100.mp3", 80: "out_80.mp3", etc}
    Converts PCM to MP3 with optional time-stretching.
    """
    if not os.path.exists(pcm_input):
        return
    for speed, out_path in speeds_dict.items():
        if speed == 100:
            cmd = [
                FFMPEG_PATH, "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
                "-i", pcm_input, "-b:a", MP3_BITRATE, out_path
            ]
        else:
            rate = speed / 100.0
            cmd = [
                FFMPEG_PATH, "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
                "-i", pcm_input, "-filter:a", f"atempo={rate}",
                "-b:a", MP3_BITRATE, out_path
            ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.remove(pcm_input)


def row_is_complete(question_id):
    """Check if all expected MP3 files for this row already exist."""
    expected = [
        f"{question_id}_Full_M_100.mp3", f"{question_id}_Full_M_80.mp3",
        f"{question_id}_Full_F_100.mp3", f"{question_id}_Full_F_80.mp3",
        f"{question_id}_Inter_M_80.mp3", f"{question_id}_Inter_F_80.mp3",
        f"{question_id}_Beg_M_80.mp3", f"{question_id}_Beg_F_80.mp3",
    ]
    return all(os.path.exists(os.path.join(AUDIO_DIR, f)) for f in expected)


def run_batch():
    completed = 0
    skipped = 0
    for idx in range(START_ROW, min(END_ROW, len(df))):
        row = df.iloc[idx]
        raw_id = str(row['ID']).split('.')[0]
        question_id = raw_id.zfill(4)

        if row_is_complete(question_id):
            skipped += 1
            continue

        print(f"\n--- Processing Row {idx} (ID: {question_id}) ---")

        male_voice = random.choice(MALE_VOICES)
        female_voice = random.choice(FEMALE_VOICES)

        # Full: 100% + 80% | Inter: 80% only | Beg: 80% only
        versions = [
            ("Full", row.get('Full Text', ''), [100, 80]),
            ("Inter", row.get('Inter Ver', ''), [80]),
            ("Beg", row.get('Beginner Ver', ''), [80]),
        ]

        for ver_name, text, speeds in versions:
            if pd.isna(text) or str(text).strip() == "":
                continue

            # MALE
            male_pcm = os.path.join(AUDIO_DIR, f"{question_id}_{ver_name}_M.pcm")
            first_mp3 = os.path.join(AUDIO_DIR, f"{question_id}_{ver_name}_M_{speeds[0]}.mp3")
            if not os.path.exists(first_mp3):
                if generate_voice(text, male_voice, male_pcm):
                    male_speeds = {s: os.path.join(AUDIO_DIR, f"{question_id}_{ver_name}_M_{s}.mp3") for s in speeds}
                    convert_and_stretch(male_pcm, male_speeds)

            # FEMALE
            female_pcm = os.path.join(AUDIO_DIR, f"{question_id}_{ver_name}_F.pcm")
            first_mp3_f = os.path.join(AUDIO_DIR, f"{question_id}_{ver_name}_F_{speeds[0]}.mp3")
            if not os.path.exists(first_mp3_f):
                if generate_voice(text, female_voice, female_pcm):
                    female_speeds = {s: os.path.join(AUDIO_DIR, f"{question_id}_{ver_name}_F_{s}.mp3") for s in speeds}
                    convert_and_stretch(female_pcm, female_speeds)

        completed += 1
        
        if completed >= 20:
            print(f"\nReached target of 20 newly generated questions. Stopping batch.")
            break
    
    print(f"\n=== Batch complete: {completed} rows processed, {skipped} skipped (already done) ===")


if __name__ == "__main__":
    run_batch()
