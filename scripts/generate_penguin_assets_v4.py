
import os
import time
import requests
import base64
import argparse
from io import BytesIO
from google import genai
from google.genai.types import GenerateContentConfig, Modality, Part
from PIL import Image

# --- CONFIGURATION (Mirrored from generate_skill_icons.py) ---
API_KEY_STUDIO = "AIzaSyAc5K9UirxaZcP52JiGb1TE33HQ9MLgloY"
API_KEY_VERTEX = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
PROJECT_ID = "gen-lang-client-0677756745"

# Model Selection
MODEL_ID_STUDIO = "gemini-3-pro-image-preview"  # Layer 1
MODEL_ID_VERTEX_FLASH = "gemini-2.5-flash-lite" # Layer 2
MODEL_ID_VERTEX_IMAGEN = "imagen-4.0-generate-preview-06-06" # Layer 3

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "games", "penguin-crossing", "assets")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Common Style Prompt
STYLE_SUFFIX = (
    "matte painting style with subtle early-2000s 3D game aesthetic, cool blue ambient light, "
    "gentle warm rim light, not photoreal, slightly stylized, soft contrast, no text, no UI."
)

ASSETS = [
    # --- Background Layers (16:9 4k for scaling) ---
    {
        "id": "bg_sky",
        "prompt": f"Wide panoramic arctic night sky background layer, deep blue gradients with soft wispy high altitude clouds and subtle aurora borealis. {STYLE_SUFFIX}",
        "transparent": False
    },
    {
        "id": "bg_mountains",
        "prompt": f"Wide panoramic distant snowy mountain range layer for parallax background, soft atmospheric blue haze, white snow caps, isolated on solid magenta background (255, 0, 255). Do not use checkerboard. {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (255, 0, 255)
    },
    {
        "id": "bg_shore",
        "prompt": f"Wide panoramic midground arctic shoreline strip layer for parallax, dark rocky coast with sparse snow and tiny distant penguin silhouettes, isolated on solid magenta background (255, 0, 255). Do not use checkerboard. {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (255, 0, 255)
    },
    {
        "id": "bg_water_base",
        "prompt": f"Wide panoramic dark navy river water texture, seamless looping potential, deep blue with visible textured noise and gentle ripples, top-down view for game background. {STYLE_SUFFIX}",
        "transparent": False
    },
    {
        "id": "bg_water_shimmer",
        "prompt": f"Wide panoramic water sparkle texture overlay, black background with scattered bright white/cyan specular highlights and noise for additive blending. {STYLE_SUFFIX}",
        "transparent": False
    },
    {
        "id": "fg_snowbank",
        "prompt": f"Wide panoramic foreground snowbank layer for bottom of screen, soft white snow drift with blue shadows, isolated on solid magenta background (255, 0, 255). {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (255, 0, 255)
    },

    # --- Ice Floes ---
    {
        "id": "floe_01",
        "prompt": f"Single floating ice floe asset for a 2D game, pre-rendered 3D look, camera slightly above horizon, chunky sculpted ice sides, soft snow cap on top with uneven edge, cool blue shadows, transparent background. {STYLE_SUFFIX}",
        "transparent": True
    },
     {
        "id": "floe_02",
        "prompt": f"Single floating ice floe asset, wider variant, chunky ice sides, snow cap, pre-rendered 3D look, transparent background. {STYLE_SUFFIX}",
        "transparent": True
    },

    # --- Penguin Sheets (Strips) ---
    {
        "id": "penguin_idle_sheet",
        "prompt": f"Sprite sheet strip of a stylized penguin character in an IDLE animation. 12 frames horizontal. The penguin is standing and gently swaying/breathing. Pre-rendered 3D look, isometric/side view, cute proportions. Pure white background. {STYLE_SUFFIX}",
        "transparent": True
    },
    {
        "id": "penguin_jump_sheet",
        "prompt": f"Sprite sheet strip of a stylized penguin character in a JUMP animation. 14 frames horizontal. Sequence: Crouch -> Launch -> Mid-air stretch -> Landing squash -> Recover. Pre-rendered 3D look, side view. Pure white background. {STYLE_SUFFIX}",
        "transparent": True
    },
    {
        "id": "penguin_fail_sheet",
        "prompt": f"Sprite sheet strip of a stylized penguin character in a FAIL/SPLASH animation. 12 frames horizontal. Penguin slipping and falling into water. Pre-rendered 3D look. Pure white background. {STYLE_SUFFIX}",
        "transparent": True
    },

    # --- FX ---
    {
        "id": "fx_snow_puff_sheet",
        "prompt": f"Sprite sheet of a white snow puff explosion particle effect. 8 frames horizontal. Stylized white powder cloud dissipating. Black background. {STYLE_SUFFIX}",
        "transparent": True
    },
     {
        "id": "fx_ripple_ring",
        "prompt": f"Single white ring ripple effect texture for water splash. Top down view. White ring on black background. {STYLE_SUFFIX}",
        "transparent": True
    },
]

def make_transparent(img, threshold=15, bg_color=(255, 255, 255)):
    img = img.convert("RGBA")
    datas = img.getdata()
    new_data = []
    
    # Target color (r, g, b)
    tr, tg, tb = bg_color
    
    for item in datas:
        # Check distance to target color
        # Simple Euclidean-ish or manhattan
        dr = abs(item[0] - tr)
        dg = abs(item[1] - tg)
        db = abs(item[2] - tb)
        
        if dr < threshold and dg < threshold and db < threshold:
             new_data.append((255, 255, 255, 0))
        else:
             new_data.append(item)
             
    img.putdata(new_data)
    return img

def generate_via_studio(asset):
    """Layer 1: AI Studio (Gemini 3 Pro Image)"""
    print(f"  Trying Layer 1: AI Studio ({MODEL_ID_STUDIO})...")
    client = genai.Client(api_key=API_KEY_STUDIO)
    prompt_text = asset['prompt']
    
    contents = [prompt_text]

    try:
        response = client.models.generate_content(
            model=MODEL_ID_STUDIO,
            contents=contents,
            config=GenerateContentConfig(response_modalities=[Modality.IMAGE]),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return Image.open(BytesIO(part.inline_data.data))
        print(f"    No image in Studio response")
        return None
    except Exception as e:
        print(f"    AI Studio Error: {e}")
        return None

def generate_via_vertex_flash(asset):
    """Layer 2: Vertex AI (Gemini 2.5 Flash Lite)"""
    print(f"  Trying Layer 2: Vertex Flash ({MODEL_ID_VERTEX_FLASH})...")
    url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{MODEL_ID_VERTEX_FLASH}:generateContent?key={API_KEY_VERTEX}"
    
    prompt_text = asset['prompt']
    parts = [{"text": prompt_text}]
    
    payload = {
        "contents": [{"role": "user", "parts": parts}],
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
        print(f"    Vertex Flash Error: {e}")
        return None

def generate_via_vertex_imagen(asset):
    """Layer 3: Vertex AI (Imagen 4.0)"""
    print(f"  Trying Layer 3: Imagen 4.0 ({MODEL_ID_VERTEX_IMAGEN})...")
    url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{MODEL_ID_VERTEX_IMAGEN}:predict?key={API_KEY_VERTEX}"
    
    payload = {
        "instances": [{"prompt": asset['prompt']}],
        "parameters": {
            "sampleCount": 1
        }
    }
    
    try:
        response = requests.post(url, json=payload, timeout=90)
        res_json = response.json()
        if "predictions" in res_json:
            pred = res_json["predictions"][0]
            b64 = pred.get("bytesBase64Encoded") or pred.get("image")
            if b64:
                 img_data = base64.b64decode(b64)
                 return Image.open(BytesIO(img_data))
        return None
    except Exception as e:
        print(f"    Imagen Exception: {e}")
        return None

def generate_asset(asset):
    out_path = os.path.join(OUTPUT_DIR, f"{asset['id']}.png")
    
    # Optional: Skip if exists? No, we are regenerating fresh
    # if os.path.exists(out_path): ...

    print(f"\nGenerating {asset['id']}...")
    
    image = None
    # Layer 1
    image = generate_via_studio(asset)
    # Layer 2
    if not image:
        image = generate_via_vertex_flash(asset)
    # Layer 3
    if not image:
        image = generate_via_vertex_imagen(asset)
        
    if image:
        if asset['transparent']:
            bg = asset.get('bg_color', (255, 255, 255))
            # Use stricter threshold for specific chroma keys like magenta/black
            # Increased to 80 to catch anti-aliased edges (halos)
            thresh = 80 if bg in [(0,0,0), (255,0,255)] else 245
            image = make_transparent(image, threshold=thresh, bg_color=bg)
        image.save(out_path)
        print(f"  ✓ Saved to {out_path}")
    else:
        print(f"  ✗ Failed to generate {asset['id']}")

def main():
    print(f"Generating {len(ASSETS)} assets to: {OUTPUT_DIR}")
    for asset in ASSETS:
        generate_asset(asset)
        time.sleep(1)

if __name__ == "__main__":
    main()
