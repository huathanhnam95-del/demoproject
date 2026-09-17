import os
from PIL import Image, ImageEnhance, ImageOps

def create_plates():
    src_dir = r"c:\Cursor AI\assets\speaker_portraits"
    out_dir = r"c:\Cursor AI\assets\speaker_portraits\plates"
    os.makedirs(out_dir, exist_ok=True)

    # 4:5 aspect ratio (width = height * 0.8) -> 600 x 750
    specs = {
        "chet_plate.jpg": ("chet_faliszek_test.jpg", (568, 0, 1432, 1080)),
        "weier_plate.jpg": ("josh_weier_clean.jpg", (568, 0, 1432, 1080)),
        "morasky_plate.jpg": ("mike_morasky_cropped_hd.jpg", (360, 0, 1160, 1000)),
        "wolpaw_plate.jpg": ("erik_wolpaw_clean.jpg", (588, 0, 1452, 1080)),
        "geldreich_plate.jpg": ("rich_geldreich.jpg", (475, 10, 907, 550)),
        "freeman_plate.jpg": ("jo_freeman.jpg", (27, 0, 593, 707)),
        "laloux_plate.jpg": ("frederic_laloux_clean.jpg", (98, 0, 962, 1080)),
        "birdwell_plate.jpg": ("ken_birdwell.jpg", (182, 0, 758, 720)),
    }

    target_w, target_h = 600, 750

    for out_name, (src_name, crop_box) in specs.items():
        src_path = os.path.join(src_dir, src_name)
        if not os.path.exists(src_path):
            print(f"Error: {src_path} does not exist!")
            continue

        im = Image.open(src_path).convert("RGB")
        cropped = im.crop(crop_box)
        resized = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)

        # Subtle editorial grading: slight contrast enhancement (+5%), sharpness (+10%)
        enhancer = ImageEnhance.Contrast(resized)
        enhanced = enhancer.enhance(1.05)
        sharpener = ImageEnhance.Sharpness(enhanced)
        final_img = sharpener.enhance(1.10)

        out_path = os.path.join(out_dir, out_name)
        final_img.save(out_path, "JPEG", quality=96)
        print(f"Created: {out_path} ({target_w}x{target_h})")

if __name__ == "__main__":
    create_plates()
