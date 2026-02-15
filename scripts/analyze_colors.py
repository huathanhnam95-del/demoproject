from PIL import Image
import os
from collections import Counter

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "games", "penguin-crossing", "assets")
TARGETS = ["bg_sky.png", "bg_mountains.png", "bg_shore.png"]

def analyze(fname):
    img_path = os.path.join(ASSETS_DIR, fname)
    if not os.path.exists(img_path):
        print(f"{fname}: Not found")
        return

    img = Image.open(img_path).convert("RGBA")
    width, height = img.size
    
    # 1. Corner colors
    c1 = img.getpixel((0,0))
    c2 = img.getpixel((width-1, 0))
    c3 = img.getpixel((0, height-1))
    c4 = img.getpixel((width-1, height-1))
    
    print(f"\nAnalysis for {fname} ({width}x{height}):")
    print(f"  TL: {c1}")
    print(f"  TR: {c2}")
    print(f"  BL: {c3}")
    print(f"  BR: {c4}")
    
    # 2. Dominant color (sample every 10th pixel)
    pixels = []
    for x in range(0, width, 10):
        for y in range(0, height, 10):
            pixels.append(img.getpixel((x,y)))
            
    most_common = Counter(pixels).most_common(5)
    print(f"  Top 5 colors: {most_common}")

if __name__ == "__main__":
    for t in TARGETS:
        analyze(t)
