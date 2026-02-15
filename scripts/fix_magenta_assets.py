from PIL import Image
import os

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "games", "penguin-crossing", "assets")
TARGETS = ["bg_mountains.png", "bg_shore.png", "fg_snowbank.png"]

def force_clean_magenta(fname):
    img_path = os.path.join(ASSETS_DIR, fname)
    if not os.path.exists(img_path):
        print(f"Skipping {fname} (not found)")
        return

    print(f"Processing {fname} with Brute Force Magenta Removal...")
    try:
        img = Image.open(img_path).convert("RGBA")
    except Exception as e:
        print(f"Failed to open {fname}: {e}")
        return

    datas = img.getdata()
    new_data = []
    
    # Magenta target: (255, 0, 255)
    # We will remove anything that is "Pink/Purple" dominant
    # i.e., R > G and B > G
    
    count_removed = 0
    for item in datas:
        r, g, b, a = item
        
        # Check if fully transparent already
        if a == 0:
            new_data.append(item)
            continue
            
        # Distance to Magenta (255, 0, 255)
        # Euclidean distance
        dist = ((r-255)**2 + (g-0)**2 + (b-255)**2)**0.5
        
        # Loose threshold: < 150 (approx match)
        # Or checking if it's "Hot Pink"
        # R > 200, B > 200, G < 150
        
        if dist < 150 or (r > 200 and b > 200 and g < 150):
            new_data.append((255, 255, 255, 0)) # Transparent
            count_removed += 1
        else:
            new_data.append(item)
            
    img.putdata(new_data)
    img.save(img_path)
    print(f"  ✓ Processed. Removed {count_removed} pixels.")

if __name__ == "__main__":
    for t in TARGETS:
        force_clean_magenta(t)
