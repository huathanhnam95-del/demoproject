"""
Generate Penguin Crossing "Classic Arctic" 2.5D assets using Vertex AI / Imagen 3.0/4.0.

Assets:
1. Background Layers (Parallax): Sky, Mountains, Shore, Water Base, Water Shimmer, Foreground Snow.
2. Ice Floe Variants (8x).
3. Penguin Sprite Sheets: Idle (12 frames), Jump (14 frames), Fail (12 frames).
4. FX Sprites: Snow puff, Ripple ring.
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

# Common Style Prompt
STYLE_SUFFIX = (
    "matte painting style with subtle early-2000s 3D game aesthetic, cool blue ambient light, "
    "gentle warm rim light, not photoreal, slightly stylized, soft contrast, no text, no UI."
)

ASSETS = [
    # --- Background Layers (16:9 4k for scaling) ---
    {
        "id": "bg_sky",
        "prompt": f"Wide panoramic arctic sky background layer, pale blue gradients with soft wispy high altitude clouds. {STYLE_SUFFIX}",
        "transparent": False
    },
    {
        "id": "bg_mountains",
        "prompt": f"Wide panoramic distant snowy mountain range layer for parallax background, soft atmospheric blue haze, white snow caps, isolated on transparent background. {STYLE_SUFFIX}",
        "transparent": True
    },
    {
        "id": "bg_shore",
        "prompt": f"Wide panoramic midground arctic shoreline strip layer for parallax, dark rocky coast with sparse snow and tiny distant penguin silhouettes, isolated on transparent background. {STYLE_SUFFIX}",
        "transparent": True
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
        "prompt": f"Wide panoramic foreground snowbank layer for bottom of screen, soft white snow drift with blue shadows, isolated on transparent background. {STYLE_SUFFIX}",
        "transparent": True
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

def make_transparent(img, threshold=245):
    img = img.convert("RGBA")
    data = img.getdata()
    new_data = []
    
    # Simple color keying for white/black backgrounds if needed
    # For generated assets, we generally want to remove WHITE/light backgrounds if specified
    # For FX on black, this generic function might need tweaking or use ADDITIVE blend in game
    
    for r, g, b, a in data:
        # Remove white background
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
    print(f"Generating {len(ASSETS)} assets to: {OUTPUT_DIR}")
    
    for asset in ASSETS:
        out_path = os.path.join(OUTPUT_DIR, f"{asset['id']}.png")
        
        # Skip if exists, unless forced (can add force flag later if needed)
        # For now, let's just generate everything requested to ensure freshness
        
        print(f"\nGenerating {asset['id']}...")
        
        img_data = generate_with_vertex(asset['prompt'])
        if img_data:
            img = Image.open(BytesIO(img_data))
            
            if asset['transparent']:
                # Basic transparency handling. 
                # Note: For complex transparency (hair/fur), this is rough.
                # Ideally, we'd use a mask if the model supported it.
                img = make_transparent(img)
            
            img.save(out_path)
            print(f"  ✓ Saved to {out_path}")
        else:
            print(f"  ✗ Failed to generate {asset['id']}")
        
        time.sleep(1)

if __name__ == "__main__":
    main()
