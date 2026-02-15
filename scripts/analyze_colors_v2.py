from PIL import Image
import os
from collections import Counter

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "games", "penguin-crossing", "assets")
TARGETS = ["bg_mountains.png", "bg_shore.png", "fg_snowbank.png"]

def analyze(fname):
    img_path = os.path.join(ASSETS_DIR, fname)
    if not os.path.exists(img_path):
        print(f"{fname}: Not found")
        return

    img = Image.open(img_path).convert("RGBA")
    width, height = img.size
    
    print(f"\nAnalysis for {fname} ({width}x{height}):")
    
    # 2. Dominant color (sample every 10th pixel)
    pixels = []
    magenta_count = 0
    total_samples = 0
    
    for x in range(0, width, 10):
        for y in range(0, height, 10):
            r, g, b, a = img.getpixel((x,y))
            pixels.append((r,g,b,a))
            total_samples += 1
            
            # Check for Magenta-ish
            # R > 200, G < 100, B > 200
            if r > 200 and g < 100 and b > 200 and a > 0:
                magenta_count += 1
            
    most_common = Counter(pixels).most_common(5)
    print(f"  Top 5 colors: {most_common}")
    print(f"  Magenta-ish pixels: {magenta_count} / {total_samples} ({magenta_count/total_samples*100:.1f}%)")

if __name__ == "__main__":
    for t in TARGETS:
        analyze(t)
