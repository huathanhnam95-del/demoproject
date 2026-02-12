import os
import time
import requests
import base64
import argparse
from io import BytesIO
from google import genai
from google.genai.types import GenerateContentConfig, Modality
from PIL import Image

# --- CONFIGURATION (Same Keys) ---
API_KEY_STUDIO = "AIzaSyAc5K9UirxaZcP52JiGb1TE33HQ9MLgloY"
API_KEY_VERTEX = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
PROJECT_ID = "gen-lang-client-0677756745"

# Models
MODEL_ID_STUDIO = "gemini-3-pro-image-preview"

# Output
OUTPUT_DIR = "public/assets/skill-icons/variations_scholar"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Refined Base Prompt (Scholar + Suit + Lively Skin + Broad Forehead)
BASE_PROMPT = "Full body character design sheet of original mascot 'BEL', wearing a sharp suit (business or smart casual), thick black rimmed glasses. He has a broad forehead, warm lively healthy skin tone (not pale), and a confident winning smile. 1950s retro-cartoon animation style, vector art, thick bold outline, cell shaded, high contrast, funny happy action, deterministic and positive expression, white background. High quality 2D illustration. "

# Variations focusing on Suit/Outfit/Expression Nuances
VARIATIONS = [
    {"id": "scholar_v1_navy_red", "desc": "Wearing a Navy Blue Suit, Crisp White Shirt, Red Necktie. Classic professional look."},
    {"id": "scholar_v2_grey_bowtie", "desc": "Wearing a Charcoal Grey Suit, Light Blue Shirt, Red Bowtie. Smart academic professor look."},
    {"id": "scholar_v3_brown_tweed", "desc": "Wearing a Brown Tweed Jacket, White Shirt, Green Tie. Vintage university professor vibe."},
    {"id": "scholar_v4_blue_open", "desc": "Wearing a Bright Blue Suit, White Shirt, Top button open (no tie). Modern smart casual look."},
    {"id": "scholar_v5_pinstripe", "desc": "Wearing a Dark Blue Pinstripe Suit, White Shirt, Yellow Tie. Sharp banker/lawyer look."},
    {"id": "scholar_v6_vest", "desc": "Wearing a Grey Suit Vest over White Shirt with rolled up sleeves, Blue Tie. Hardworking scholar look."},
    {"id": "scholar_v7_sweater", "desc": "Wearing a Navy Sweater over White Shirt and Tie, Khaki pants. Preppy student look."},
    {"id": "scholar_v8_labcoat", "desc": "Wearing a White Lab Coat over a Shirt and Tie. Scientific researcher look."},
    {"id": "scholar_v9_tuxedo", "desc": "Wearing a Black Tuxedo with Bowtie. Very formal and fancy look."},
    {"id": "scholar_v10_suspenders", "desc": "Wearing Suspenders over White Shirt, Bowtie, Glasses pushed up nose. Nerdy enthusiastic look."}
]

def generate_ai_studio(prompt):
    print(f"  Trying AI Studio...")
    client = genai.Client(api_key=API_KEY_STUDIO)
    try:
        response = client.models.generate_content(
            model=MODEL_ID_STUDIO,
            contents=(prompt),
            config=GenerateContentConfig(response_modalities=[Modality.TEXT, Modality.IMAGE]),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return Image.open(BytesIO((part.inline_data.data)))
        return None
    except Exception as e:
        print(f"    AI Studio Error: {e}")
        return None

def generate_variation(var):
    file_path = os.path.join(OUTPUT_DIR, f"{var['id']}.png")
    if os.path.exists(file_path):
        print(f"Skipping {var['id']} (exists)")
        return

    full_prompt = BASE_PROMPT + var['desc']
    print(f"Generating: {var['id']}...")
    
    # Simple Fallback (Just Studio for now for speed, add others if needed)
    image = generate_ai_studio(full_prompt)
    
    if image:
        image.save(file_path)
        print(f"  SUCCESS Saved -> {file_path}")
    else:
        print(f"  FAILED -> {var['id']}")

if __name__ == "__main__":
    for var in VARIATIONS:
        generate_variation(var)
        time.sleep(2)
