"""
Generate Penguin Crossing game assets using Gemini Image Generation API.

Assets:
1. background.png - Arctic ocean panorama (800x600)
2. iceberg.png    - Single ice floe platform
3. penguin.png    - Emperor penguin standing
4. penguin_jump.png - Emperor penguin mid-jump

All assets use a consistent art style:
  "3D pre-rendered CG, early 2000s educational game, 
   Mavis Beacon style, painterly arctic theme"
"""

import os
import sys
import time
from io import BytesIO
from google import genai
from google.genai.types import GenerateContentConfig, Modality
from PIL import Image

API_KEY = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
MODEL_ID = "gemini-3-pro-image-preview"

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "games", "penguin-crossing", "assets")
os.makedirs(OUTPUT_DIR, exist_ok=True)

STYLE = (
    "3D pre-rendered CG art style, early 2000s educational typing game aesthetic "
    "(like Mavis Beacon Teaches Typing), painterly soft lighting, cool arctic "
    "blue-white color palette, high quality game asset."
)

ASSETS = [
    {
        "id": "background",
        "prompt": (
            f"A wide panoramic arctic landscape scene for a penguin typing game background. "
            f"The bottom 60% is deep blue ocean water with subtle gentle wave ripples and floating ice fragments. "
            f"The background shows distant snowy white mountains and icy cliffs with atmospheric fog and a pale blue sky. "
            f"A group of small emperor penguins can be seen standing on a snowy shoreline in the far distance. "
            f"The scene has a 3/4 perspective looking slightly downward at the water. "
            f"Cool blue-white-teal color palette. No text, no UI elements, no icebergs in the foreground. "
            f"Landscape format, 800x600 pixel proportions. {STYLE}"
        ),
        "size": (800, 600),
        "transparent": False,
    },
    {
        "id": "iceberg",
        "prompt": (
            f"A single chunky floating ice floe platform for a game, viewed from a slightly elevated 3/4 perspective. "
            f"The ice is irregularly shaped like a broken-off ice shelf, roughly rectangular with organic cracked edges. "
            f"The top surface is flat(ish) with snow dusting and a light blue-white color. "
            f"The sides and underwater portion are darker blue-gray translucent ice. "
            f"The ice block is about 150 pixels wide and 70 pixels tall in proportion. "
            f"Isolated on a solid white background. No text, no characters on it. {STYLE}"
        ),
        "size": None,
        "transparent": True,
    },
    {
        "id": "penguin",
        "prompt": (
            f"A cute emperor penguin character standing upright, facing slightly toward the viewer. "
            f"Full body view showing the classic emperor penguin coloring: sleek black back and flippers, "
            f"white belly, and distinctive golden-yellow patches on the upper chest and sides of the head. "
            f"The penguin has slightly cartoonish proportions — round body, small head, tiny feet. "
            f"Standing pose with flippers resting at its sides, looking alert and ready. "
            f"Isolated on a solid white background. No accessories. Full body visible. {STYLE}"
        ),
        "size": None,
        "transparent": True,
    },
    {
        "id": "penguin_jump",
        "prompt": (
            f"A cute emperor penguin character mid-jump, leaping through the air. "
            f"Both flippers spread wide like arms, body slightly tilted forward, tiny feet off the ground. "
            f"Classic emperor penguin coloring: black back and flippers, white belly, golden-yellow chest patches. "
            f"Dynamic jumping pose showing motion and energy, same character as the standing version. "
            f"Slightly cartoonish proportions — round body, small head. "
            f"Isolated on a solid white background. No accessories. Full body visible. {STYLE}"
        ),
        "size": None,
        "transparent": True,
    },
]


def make_transparent(img):
    """Convert near-white pixels to transparent."""
    img = img.convert("RGBA")
    data = img.getdata()
    new_data = []
    for r, g, b, a in data:
        if r > 240 and g > 240 and b > 240:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append((r, g, b, a))
    img.putdata(new_data)
    return img


def generate_asset(asset):
    """Generate one asset image."""
    file_path = os.path.join(OUTPUT_DIR, f"{asset['id']}.png")
    if os.path.exists(file_path) and not os.environ.get("OVERWRITE"):
        print(f"  Skipping {asset['id']} (exists). Set OVERWRITE=1 to regenerate.")
        return True

    print(f"\nGenerating: {asset['id']}...")
    client = genai.Client(api_key=API_KEY)

    for attempt in range(3):
        if attempt > 0:
            wait = 5 * (attempt + 1)
            print(f"  Retry {attempt + 1} in {wait}s...")
            time.sleep(wait)

        try:
            response = client.models.generate_content(
                model=MODEL_ID,
                contents=[asset["prompt"]],
                config=GenerateContentConfig(
                    response_modalities=[Modality.TEXT, Modality.IMAGE]
                ),
            )
            for part in response.candidates[0].content.parts:
                if part.inline_data:
                    img = Image.open(BytesIO(part.inline_data.data))

                    # Resize if specified
                    if asset.get("size"):
                        img = img.resize(asset["size"], Image.LANCZOS)

                    # Transparency
                    if asset.get("transparent"):
                        img = make_transparent(img)

                    img.save(file_path)
                    print(f"  ✓ Saved → {file_path} ({img.size})")
                    return True

            print(f"  No image in response")
        except Exception as e:
            print(f"  Error: {e}")

    print(f"  ✗ FAILED: {asset['id']}")
    return False


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", type=str, help="Generate only a specific asset ID")
    args = parser.parse_args()

    count = 0
    for asset in ASSETS:
        if args.asset and asset["id"] != args.asset:
            continue
        if generate_asset(asset):
            count += 1
            time.sleep(3)

    print(f"\nDone! Generated {count}/{len(ASSETS)} assets.")
