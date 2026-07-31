import os
import time
import requests
import base64
import argparse
from io import BytesIO
from google import genai
from google.genai.types import GenerateContentConfig, Modality
from PIL import Image

# --- CONFIGURATION ---
API_KEY_STUDIO = "AIzaSyAc5K9UirxaZcP52JiGb1TE33HQ9MLgloY"
API_KEY_VERTEX = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
PROJECT_ID = "gen-lang-client-0677756745"

# Models
MODEL_ID_STUDIO = "gemini-3-pro-image-preview"
MODEL_ID_VERTEX_GEMINI = "gemini-3.1-flash-lite"
MODEL_ID_VERTEX_IMAGEN = "imagen-3.0-generate-001"

# Output
OUTPUT_DIR = "public/assets/skill-icons/variations"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Base Prompt
BASE_PROMPT = "Full body character design sheet of original mascot 'BEL', wearing a blue jumpsuit with 'BEL' printed on a yellow chest badge. 1950s retro-cartoon animation style, vector art, thick bold outline, cell shaded, high contrast, vibrant blue and yellow colors, funny happy action, deterministic and positive expression, winning smile, white background, no text, no UI border. High quality 2D illustration. "

# Variations
VARIATIONS = [
    {"id": "bel_v1_classic", "desc": "Classic look, short messy brown hair, big smile, thumbs up."},
    {"id": "bel_v2_cap", "desc": "Wearing a backwards blue baseball cap, freckles, energetic running pose."},
    {"id": "bel_v3_goggles", "desc": "Wearing steampunk aviator goggles on forehead, spiky blonde hair, holding a wrench."},
    {"id": "bel_v4_quiff", "desc": "Rockabilly style with a large pompadour hairstyle, cool finger-gun pose."},
    {"id": "bel_v5_nerdy", "desc": "Wearing thick black rimmed glasses, holding a book, smart and happy look."},
    {"id": "bel_v6_gloves", "desc": "Wearing large yellow work gloves, messy hair, carrying a toolbox, determined look."},
    {"id": "bel_v7_robot_arm", "desc": "Has one robotic arm attachment, futuristic retro style, confident superhero pose."},
    {"id": "bel_v8_scarf", "desc": "Wearing a yellow scarf, windblown hair, adventurous explorer pose."},
    {"id": "bel_v9_boots", "desc": "Wearing oversized heavy boots, sturdy stance, crossed arms, confident grin."},
    {"id": "bel_v10_cowlick", "desc": " prominent cowlick hairstyle, wide expressive eyes, jumping in the air joyfully."}
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

def generate_vertex_gemini(prompt):
    print(f"  Trying Vertex Gemini...")
    url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{MODEL_ID_VERTEX_GEMINI}:generateContent?key={API_KEY_VERTEX}"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "image/png"}
    }
    try:
        response = requests.post(url, json=payload, timeout=90)
        res_json = response.json()
        if "candidates" in res_json:
            for part in res_json["candidates"][0]["content"]["parts"]:
                if "inlineData" in part:
                    img_data = base64.b64decode(part["inlineData"]["data"])
                    return Image.open(BytesIO(img_data))
        return None
    except Exception as e:
        print(f"    Vertex Gemini Error: {e}")
        return None

def generate_vertex_imagen(prompt):
    print(f"  Trying Vertex Imagen...")
    url = f"https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/us-central1/publishers/google/models/{MODEL_ID_VERTEX_IMAGEN}:predict"
    # Using API Key in query param as fallback
    url = f"https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/us-central1/publishers/google/models/{MODEL_ID_VERTEX_IMAGEN}:predict?key={API_KEY_VERTEX}"
    
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1}
    }
    try:
        response = requests.post(url, json=payload, timeout=120)
        res_json = response.json()
        if "predictions" in res_json:
            img_data = base64.b64decode(res_json["predictions"][0]["bytesBase64Encoded"])
            return Image.open(BytesIO(img_data))
        return None
    except Exception as e:
        print(f"    Vertex Imagen Error: {e}")
        return None

def generate_variation(var):
    file_path = os.path.join(OUTPUT_DIR, f"{var['id']}.png")
    if os.path.exists(file_path):
        print(f"Skipping {var['id']} (exists)")
        return

    full_prompt = BASE_PROMPT + var['desc']
    print(f"Generating: {var['id']}...")
    
    image = generate_ai_studio(full_prompt)
    if not image:
        image = generate_vertex_gemini(full_prompt)
    if not image:
        image = generate_vertex_imagen(full_prompt)
    
    if image:
        image.save(file_path)
        print(f"  SUCCESS Saved -> {file_path}")
    else:
        print(f"  FAILED -> {var['id']}")

if __name__ == "__main__":
    for var in VARIATIONS:
        generate_variation(var)
        time.sleep(2)
