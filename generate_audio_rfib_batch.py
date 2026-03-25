import os
import subprocess
import pandas as pd
from dotenv import load_dotenv
from google import genai
from google.genai import types
import random
import time

load_dotenv()

# --- API Key Rotation ---
API_KEYS = [
    "AIzaSyB-7-Z_akwDLmHj40KD-5W1t6qKJbTfqZs",
    "AIzaSyAaEBXf1LdkixTExCagUVCFY-dVUFf9X9U",
]
current_key_idx = 0
client = genai.Client(api_key=API_KEYS[current_key_idx])


def rotate_key():
    """Switch to the next API key. Returns False if all keys exhausted."""
    global current_key_idx, client
    current_key_idx += 1
    if current_key_idx >= len(API_KEYS):
        return False
    print(f"  >> Rotating to API key {current_key_idx + 1}/{len(API_KEYS)}")
    client = genai.Client(api_key=API_KEYS[current_key_idx])
    return True

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


def generate_voice(text, voice_name, pcm_output_path, max_retries=3):
    if pd.isna(text) or str(text).strip() == "":
        return False
    for attempt in range(max_retries):
        try:
            print(f"Generating audio for '{str(text)[:25]}...' using {voice_name}")
            response = client.models.generate_content(
                model="gemini-2.5-flash-preview-tts",
                contents=str(text),
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=voice_name
                            )
                        )
                    )
                )
            )
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'inline_data') and part.inline_data:
                    with open(pcm_output_path, "wb") as f:
                        f.write(part.inline_data.data)
                    return True
            return False
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                if rotate_key():
                    print(f"  Switched to next API key. Retrying...")
                    continue  # retry immediately with new key
                else:
                    print("  All API keys exhausted! Stopping.")
                    raise SystemExit("All API keys exhausted")
            else:
                print(f"  Error: {e}")
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
                "ffmpeg", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
                "-i", pcm_input, "-b:a", MP3_BITRATE, out_path
            ]
        else:
            rate = speed / 100.0
            cmd = [
                "ffmpeg", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
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
    
    print(f"\n=== Batch complete: {completed} rows processed, {skipped} skipped (already done) ===")


if __name__ == "__main__":
    run_batch()
