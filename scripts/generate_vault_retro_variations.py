import os
import time
import requests
import base64
from io import BytesIO
from google import genai
from google.genai.types import GenerateContentConfig, Modality
from PIL import Image

# --- CONFIGURATION ---
API_KEY_STUDIO = "AIzaSyAc5K9UirxaZcP52JiGb1TE33HQ9MLgloY"
MODEL_ID_STUDIO = "gemini-3-pro-image-preview"

# Output Directory
OUTPUT_DIR = "public/assets/skill-icons/variations_vault_retro"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Base Prompt for Vault Boy Retro
BASE_PROMPT = "Mascot character in the classic 1950s atomic age cartoon style, exactly like Vault Boy from Fallout. The character has jet black hair (not blonde) and is wearing a vibrant emerald green body suit with bright yellow trim. Hyper-positive expression, winking with a thumbs up, vector art, thick bold outline, cell shaded, high contrast, vibrant colors, white background, no text, no UI border. High quality 2D illustration."

# Variations for selection
VARIATIONS = [
    {"id": "vault_retro_v1", "desc": "Classic Vault Boy pose: Winking, thumbs up, big hyper-positive smile."},
    {"id": "vault_retro_v2", "desc": "Waving enthusiastically with both hands, eyes wide and happy."},
    {"id": "vault_retro_v3", "desc": "Confident pose: Arms crossed, chest out, proud but friendly smile."},
    {"id": "vault_retro_v4", "desc": "Running towards the camera with a look of pure determination and joy."},
    {"id": "vault_retro_v5", "desc": "Looking thoughtful: Finger on chin, eyes looking up at an invisible idea, small smile."},
    {"id": "vault_retro_v6", "desc": "Holding a giant glowing golden wrench (symbolizing fixing things), winking."},
    {"id": "vault_retro_v7", "desc": "Wearing retro-futuristic goggles on his forehead, looking ready for action."},
    {"id": "vault_retro_v8", "desc": "Pointing at the viewer with a wink and a confident 'You got this!' expression."},
    {"id": "vault_retro_v9", "desc": "Giving two thumbs up, eyes closed in a big wide happy smile."},
    {"id": "vault_retro_v10", "desc": "Sitting on a giant radioactive barrel, laughing heartily."},
]

def generate_variation(var):
    print(f"Generating {var['id']}...")
    prompt = f"{BASE_PROMPT} Scene: {var['desc']}"
    
    client = genai.Client(api_key=API_KEY_STUDIO)
    try:
        response = client.models.generate_content(
            model=MODEL_ID_STUDIO,
            contents=prompt,
            config=GenerateContentConfig(response_modalities=[Modality.TEXT, Modality.IMAGE]),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                img = Image.open(BytesIO(part.inline_data.data))
                path = os.path.join(OUTPUT_DIR, f"{var['id']}.png")
                img.save(path)
                print(f"  SUCCESS Saved -> {path}")
                return True
        print(f"  FAILED: No image in response")
        return False
    except Exception as e:
        print(f"  ERROR: {e}")
        return False

if __name__ == "__main__":
    count = 0
    for var in VARIATIONS:
        if generate_variation(var):
            count += 1
            time.sleep(2)
    print(f"\nDone! Generated {count} variations.")
