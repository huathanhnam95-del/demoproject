import os
import subprocess
import pandas as pd
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

client = genai.Client()

EXCEL_PATH = r"C:\Cursor AI\public\database\RFIB\RFIB Final ver.xlsx"
AUDIO_DIR = r"C:\Cursor AI\public\database\RFIB\audio"

os.makedirs(AUDIO_DIR, exist_ok=True)

df = pd.read_excel(EXCEL_PATH)

def generate_voice(text, voice_name, pcm_output_path):
    print(f"Generating audio for '{text[:20]}...' using voice {voice_name}")
    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=text,
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
            return
    print(f"Failed to extract audio for {voice_name}")

def convert_and_stretch(pcm_input, out_100, out_80):
    cmd_100 = ["ffmpeg", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm_input, out_100]
    cmd_80 = ["ffmpeg", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm_input, "-filter:a", "atempo=0.8", out_80]
    subprocess.run(cmd_100, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(cmd_80, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # clean up the PCM file
    if os.path.exists(pcm_input):
        os.remove(pcm_input)
    print(f"Saved {out_100} and {out_80}")

def run_test():
    # Test just first 3 rows
    for idx, row in df.head(3).iterrows():
        text = str(row['Full Text'])
        print(f"\nProcessing row {idx}: {text}")
        
        male_pcm = os.path.join(AUDIO_DIR, f"row{idx}_male.pcm")
        male_100 = os.path.join(AUDIO_DIR, f"row{idx}_male_100.wav")
        male_80 = os.path.join(AUDIO_DIR, f"row{idx}_male_80.wav")
        
        female_pcm = os.path.join(AUDIO_DIR, f"row{idx}_female.pcm")
        female_100 = os.path.join(AUDIO_DIR, f"row{idx}_female_100.wav")
        female_80 = os.path.join(AUDIO_DIR, f"row{idx}_female_80.wav")
        
        # Male ('Charon' is a deeper, professional male voice)
        generate_voice(text, "Charon", male_pcm)
        convert_and_stretch(male_pcm, male_100, male_80)
        
        generate_voice(text, "Kore", female_pcm)
        convert_and_stretch(female_pcm, female_100, female_80)
        
    print("\nTest run complete!")

if __name__ == "__main__":
    run_test()
