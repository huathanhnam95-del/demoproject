
import os
import time
import requests
import base64
from io import BytesIO
from google import genai
from google.genai.types import GenerateContentConfig, Modality, Part
from PIL import Image

# --- CONFIGURATION ---
API_KEY_STUDIO = "AIzaSyAc5K9UirxaZcP52JiGb1TE33HQ9MLgloY"
API_KEY_VERTEX = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
PROJECT_ID = "gen-lang-client-0677756745"

# Model Selection
MODEL_ID_STUDIO = "gemini-3-pro-image-preview"
MODEL_ID_VERTEX_FLASH = "gemini-2.5-flash-lite"
MODEL_ID_VERTEX_IMAGEN = "imagen-4.0-generate-preview-06-06"

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "games", "penguin-crossing", "assets")
os.makedirs(OUTPUT_DIR, exist_ok=True)

STYLE_SUFFIX = (
    "matte painting style with subtle early-2000s 3D game aesthetic, cool blue ambient light, "
    "gentle warm rim light, not photoreal, slightly stylized, soft contrast, no text, no UI."
)

# TARGET ASSETS ONLY
ASSETS = [
    # --- Ice Floes ---
    {
        "id": "floe_01",
        "prompt": f"Single floating ice floe asset for a 2D game, pre-rendered 3D look, camera slightly above horizon, chunky sculpted ice sides, soft snow cap on top with uneven edge, cool blue shadows, transparent background. {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (0, 0, 0) # Default for remove_bg
    },
     {
        "id": "floe_02",
        "prompt": f"Single floating ice floe asset, wider variant, chunky ice sides, snow cap, pre-rendered 3D look, transparent background. {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (0, 0, 0)
    },

    # --- Penguin Sheets (Strips) ---
    {
        "id": "penguin_idle_sheet",
        "prompt": f"Sprite sheet strip of a stylized penguin character in an IDLE animation. 12 frames horizontal side-by-side. The penguin is standing and gently swaying/breathing. Pre-rendered 3D look, isometric/side view, cute proportions. Solid black background. {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (0, 0, 0)
    },
    {
        "id": "penguin_jump_sheet",
        "prompt": f"Sprite sheet strip of a stylized penguin character in a JUMP animation. 14 frames horizontal side-by-side. Sequence: Crouch -> Launch -> Mid-air stretch -> Landing squash -> Recover. Pre-rendered 3D look, side view. Solid black background. {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (0, 0, 0)
    },
    {
        "id": "penguin_fail_sheet",
        "prompt": f"Sprite sheet strip of a stylized penguin character in a FAIL/SPLASH animation. 12 frames horizontal side-by-side. Penguin slipping and falling into water. Pre-rendered 3D look. Solid black background. {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (0, 0, 0)
    },

    # --- FX ---
    {
        "id": "fx_snow_puff_sheet",
        "prompt": f"Sprite sheet of a white snow puff explosion particle effect. 8 frames horizontal side-by-side. Stylized white powder cloud dissipating. Solid black background. {STYLE_SUFFIX}",
        "transparent": True,
        "bg_color": (0, 0, 0)
    }
]

def make_transparent(img, threshold=50, bg_color=(0, 0, 0)):
    img = img.convert("RGBA")
    datas = img.getdata()
    new_data = []
    
    tr, tg, tb = bg_color
    
    # Aggressive removal for black backgrounds
    for item in datas:
        # Distance checks
        dr = abs(item[0] - tr)
        dg = abs(item[1] - tg)
        db = abs(item[2] - tb)
        
        # If black background, remove dark pixels
        if dr < threshold and dg < threshold and db < threshold:
             new_data.append((255, 255, 255, 0))
        else:
             new_data.append(item)
             
    img.putdata(new_data)
    return img

def generate_via_studio(asset):
    print(f"  Trying Layer 1: AI Studio ({MODEL_ID_STUDIO})...")
    client = genai.Client(api_key=API_KEY_STUDIO)
    try:
        response = client.models.generate_content(
            model=MODEL_ID_STUDIO,
            contents=[asset['prompt']],
            config=GenerateContentConfig(response_modalities=[Modality.IMAGE]),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return Image.open(BytesIO(part.inline_data.data))
    except Exception as e:
        print(f"    Studio Error: {e}")
    return None

def generate_via_vertex_flash(asset):
    print(f"  Trying Layer 2: Vertex Flash ({MODEL_ID_VERTEX_FLASH})...")
    url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{MODEL_ID_VERTEX_FLASH}:generateContent?key={API_KEY_VERTEX}"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": asset['prompt']}]}],
        "generationConfig": {"responseMimeType": "image/png"}
    }
    try:
        response = requests.post(url, json=payload, timeout=90)
        res_json = response.json()
        if "candidates" in res_json:
            for part in res_json["candidates"][0]["content"]["parts"]:
                if "inlineData" in part:
                    return Image.open(BytesIO(base64.b64decode(part["inlineData"]["data"])))
    except Exception as e:
        print(f"    Vertex Flash Error: {e}")
    return None

def generate_via_vertex_imagen(asset):
    print(f"  Trying Layer 3: Imagen 4.0 ({MODEL_ID_VERTEX_IMAGEN})...")
    url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{MODEL_ID_VERTEX_IMAGEN}:predict?key={API_KEY_VERTEX}"
    payload = {
        "instances": [{"prompt": asset['prompt']}],
        "parameters": {"sampleCount": 1}
    }
    try:
        response = requests.post(url, json=payload, timeout=90)
        res_json = response.json()
        if "predictions" in res_json:
            pred = res_json["predictions"][0]
            b64 = pred.get("bytesBase64Encoded") or pred.get("image")
            if b64:
                return Image.open(BytesIO(base64.b64decode(b64)))
    except Exception as e:
        print(f"    Imagen Error: {e}")
    return None

def main():
    print(f"Regenerating {len(ASSETS)} sprite assets...")
    for asset in ASSETS:
        print(f"\nGenerating {asset['id']}...")
        img = generate_via_studio(asset)
        if not img: img = generate_via_vertex_flash(asset)
        if not img: img = generate_via_vertex_imagen(asset)
        
        if img:
            if asset['transparent']:
                # Use black background removal
                img = make_transparent(img, threshold=40, bg_color=(0,0,0))
            
            out_path = os.path.join(OUTPUT_DIR, f"{asset['id']}.png")
            img.save(out_path)
            print(f"  ✓ Saved {asset['id']} ({img.width}x{img.height})")
        else:
            print(f"  ✗ Failed to generate {asset['id']}")
        time.sleep(1)

if __name__ == "__main__":
    main()
