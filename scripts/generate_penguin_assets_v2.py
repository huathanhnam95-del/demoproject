"""
Generate Penguin Crossing game assets using Vertex AI / Imagen 4.0/3.0 as fallback.

Assets:
1. background_river.png - Full river panorama with snowy banks
2. iceberg_v2.png       - High-fidelity ice floe
3. penguin_jump_sheet.png - 5-frame jump animation sequence
"""

import os
import base64
import requests
import time
from io import BytesIO
from PIL import Image

# Keys from existing project scripts
VERTEX_KEY = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
PROJECT_ID = "gen-lang-client-0677756745"

# Fallback models from docs
IMAGEN_MODELS = [
    "imagen-4.0-generate-preview-06-06",
    "imagen-3.0-generate-002",
    "imagen-3.0-generate-001",
    "imagen-3.0-fast-generate-001"
]

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "games", "penguin-crossing", "assets")
os.makedirs(OUTPUT_DIR, exist_ok=True)

STYLE = (
    "Realistic 3D pre-rendered CG art style, early 2000s educational game aesthetic "
    "(Mavis Beacon style), detailed textures, soft arctic lighting."
)

ASSETS = [
    {
        "id": "background_river",
        "prompt": (
            f"Wide panoramic view of an arctic river. Snowy white banks at the top and bottom of the frame. "
            f"A deep blue water channel flows horizontally in the middle. Distant snowy mountains and pale blue sky. "
            f"3/4 slightly elevated perspective. High resolution, detailed snow and water textures. {STYLE}"
        ),
        "transparent": False
    },
    {
        "id": "iceberg_v2",
        "prompt": (
            f"A single thick floating iceberg platform, viewed from 3/4 perspective. "
            f"Flat top surface with snow dusting, cracked blue-translucent ice sides. "
            f"Isolated on a pure white background. {STYLE}"
        ),
        "transparent": True
    },
    {
        "id": "penguin_jump_sheet",
        "prompt": (
            f"A horizontal sprite sheet containing 5 distinct frames of an Emperor Penguin jumping from left to right. "
            f"Frame 1: Crouch. Frame 2: Launch. Frame 3: Apex mid-air. Frame 4: Descent. Frame 5: Landing. "
            f"Side view, consistent character model and lighting. Pure white background. {STYLE}"
        ),
        "transparent": True
    }
]

def make_transparent(img, threshold=245):
    img = img.convert("RGBA")
    data = img.getdata()
    new_data = []
    for r, g, b, a in data:
        if r >= threshold and g >= threshold and b >= threshold:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append((r, g, b, a))
    img.putdata(new_data)
    return img

def generate_with_vertex(prompt):
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1}
    }
    
    # Regional and Global endpoints
    locations = ["us-central1", "europe-west1", "asia-northeast1"]
    
    for model in IMAGEN_MODELS:
        for loc in locations:
            # Endpoint variants
            endpoints = [
                f"https://{loc}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{loc}/publishers/google/models/{model}:predict?key={VERTEX_KEY}",
                f"https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:predict?key={VERTEX_KEY}"
            ]
            
            for ep in endpoints:
                try:
                    print(f"  Trying {model} @ {loc}...")
                    resp = requests.post(ep, json=payload, timeout=60)
                    if resp.status_code == 200:
                        res_json = resp.json()
                        if "predictions" in res_json:
                            # Some models return "bytesBase64Encoded", others "image"
                            pred = res_json["predictions"][0]
                            b64 = pred.get("bytesBase64Encoded") or pred.get("image")
                            if b64:
                                return base64.b64decode(b64)
                    elif resp.status_code == 404:
                        continue # Expected if model not in region
                    else:
                        print(f"    Failed ({resp.status_code}): {resp.text[:100]}")
                except Exception as e:
                    print(f"    Error: {e}")
    return None

def main():
    for asset in ASSETS:
        out_path = os.path.join(OUTPUT_DIR, f"{asset['id']}.png")
        print(f"\nGenerating {asset['id']}...")
        
        img_data = generate_with_vertex(asset['prompt'])
        if img_data:
            img = Image.open(BytesIO(img_data))
            if asset['transparent']:
                img = make_transparent(img)
            img.save(out_path)
            print(f"  ✓ Saved to {out_path}")
        else:
            print(f"  ✗ Failed to generate {asset['id']}")
        
        time.sleep(1)

if __name__ == "__main__":
    main()
