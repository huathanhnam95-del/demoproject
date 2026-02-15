import os
import base64
import requests
import time

# Keys from existing project scripts
VERTEX_KEY = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
PROJECT_ID = "gen-lang-client-0677756745"

# Models
IMAGEN_MODELS = ["imagen-3.0-generate-002", "imagen-3.0-generate-001"]

OUTPUT_DIR = r"c:\Cursor AI\public\games\penguin-crossing\assets"
os.makedirs(OUTPUT_DIR, exist_ok=True)

STYLE_SUFFIX = (
    "matte painting style, cool blue arctic lighting, NO transparency, NO checkerboard, "
    "solid background pixels, horizontal view, high quality."
)

def generate_with_vertex(prompt):
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1}
    }
    loc = "us-central1"
    for model in IMAGEN_MODELS:
        ep = f"https://{loc}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{loc}/publishers/google/models/{model}:predict?key={VERTEX_KEY}"
        try:
            print(f"  Trying {model}...")
            resp = requests.post(ep, json=payload, timeout=60)
            if resp.status_code == 200:
                res_json = resp.json()
                if "predictions" in res_json:
                    pred = res_json["predictions"][0]
                    b64 = pred.get("bytesBase64Encoded") or pred.get("image")
                    if b64:
                        return base64.b64decode(b64)
            else:
                print(f"    Failed ({resp.status_code}): {resp.text[:100]}")
        except Exception as e:
            print(f"    Error: {e}")
    return None

def main():
    assets = [
        ("bg_sky", f"Arctic sky with soft white clouds, pale blue haze, early morning light, horizontal. {STYLE_SUFFIX}"),
        ("bg_water_base", f"Dark blue arctic water surface, deep navy, subtle ripples, floating ice crystals. {STYLE_SUFFIX}"),
    ]
    
    for a_id, prompt in assets:
        out_path = os.path.join(OUTPUT_DIR, f"{a_id}.png")
        print(f"Generating {a_id}...")
        img_data = generate_with_vertex(prompt)
        if img_data:
            with open(out_path, "wb") as f:
                f.write(img_data)
            print(f"  ✓ Saved to {out_path}")
        else:
            print(f"  ✗ Failed {a_id}")
        time.sleep(1)

if __name__ == "__main__":
    main()
