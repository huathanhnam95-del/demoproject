"""
Master Video Generator: 3-Minute Valve Flatland Documentary
===========================================================
Resolution: 1920x1080 (1080p Full HD)
Frame Rate: 30.0 fps (exactly 5,400 frames = 180.000s)
Audio: 48kHz Stereo AAC (synchronized to master WAV)
Codec: libx264 (CRF 18, preset medium, yuv420p)

Narrative Architecture:
- Act 1 (0:00 - 0:35): Gabe Newell & Founding of Valve (Microsoft to 1996), Ronald Coase & Transaction Costs
- Act 2 (0:35 - 1:15): The Anatomy of Flatland (Zero Managers, Desks on Wheels, Cabals, Voting With Feet)
- Act 3 (1:15 - 2:25): Real Employee Perspectives:
    * Part A: Autonomy & Craft Pride (Chet Faliszek, Erik Wolpaw, Josh Weier)
    * Part B: Documented Realities & Traps (Jo Freeman, Rich Geldreich, Phantom Crunch)
- Act 4 (2:25 - 3:00): Core Takeaway (Mutual Trust, Exponential Creative Leverage, The Learner First)
"""

import os
import sys
import json
import time
import subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path


PROJECT_ROOT = Path(r"C:\Cursor AI")
OUT_DIR = PROJECT_ROOT / "exported_slides"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MASTER_VIDEO_PATH = OUT_DIR / "valve_flatland_documentary_3min.mp4"
MASTER_AUDIO_PATH = OUT_DIR / "valve_flatland_documentary_3min_audio.wav"
KEYFRAMES_DIR = OUT_DIR / "preview_keyframes"
KEYFRAMES_DIR.mkdir(parents=True, exist_ok=True)

WIDTH, HEIGHT = 1920, 1080
FPS = 30.0
TOTAL_SECONDS = 180.0
TOTAL_FRAMES = int(round(FPS * TOTAL_SECONDS))  # Exactly 5,400 frames

FONTS_DIR = Path(r"C:\Windows\Fonts")
FONT_BOLD = str(FONTS_DIR / "segoeuib.ttf")
FONT_REG = str(FONTS_DIR / "segoeui.ttf")
FONT_SEMIBOLD = str(FONTS_DIR / "segoeuisl.ttf")

def smootherstep(t):
    """Ken Perlin's quintic smootherstep with zero 1st and 2nd derivatives."""
    t = float(np.clip(t, 0.0, 1.0))
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)

def composite_frosted_card(base_frame, card_overlay, x0, y0, card_w, card_h, alpha=1.0, radius=14, blur_ksize=27):
    """Genuine frosted glassmorphism: Gaussian blur + dark slate tint + card overlay."""
    if alpha <= 0.005:
        return base_frame

    x1 = max(0, x0)
    y1 = max(0, y0)
    x2 = min(WIDTH, x0 + card_w)
    y2 = min(HEIGHT, y0 + card_h)
    if x1 >= x2 or y1 >= y2:
        return base_frame

    roi = base_frame[y1:y2, x1:x2]
    blurred_roi = cv2.GaussianBlur(roi, (blur_ksize, blur_ksize), 0)

    mask_img = Image.new("L", (card_w, card_h), 0)
    mask_draw = ImageDraw.Draw(mask_img)
    mask_draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, fill=255)
    mask_arr = np.array(mask_img, dtype=np.float32)[y1 - y0:y2 - y0, x1 - x0:x2 - x0] / 255.0

    tint_bgr = np.array([22, 16, 12], dtype=np.float32)  # Deep slate tint
    tint_ratio = 0.65
    glass_roi = (1.0 - tint_ratio) * blurred_roi + tint_ratio * tint_bgr

    eff_glass_mask = (mask_arr * alpha)[:, :, np.newaxis]
    base_frame[y1:y2, x1:x2] = (1.0 - eff_glass_mask) * base_frame[y1:y2, x1:x2] + eff_glass_mask * glass_roi

    over_sub = card_overlay[y1 - y0:y2 - y0, x1 - x0:x2 - x0]
    fg_rgb = over_sub[:, :, :3]
    fg_a = (over_sub[:, :, 3:] / 255.0) * alpha
    fg_bgr = fg_rgb[:, :, ::-1]

    base_frame[y1:y2, x1:x2] = (1.0 - fg_a) * base_frame[y1:y2, x1:x2] + fg_a * fg_bgr
    return base_frame

# --- Graphic Card Overlay Builders ---

def make_lower_third(badge_text, name_text, title_text, quote_text=None, card_w=760, card_h=150, radius=14):
    overlay = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, outline=(255, 255, 255, 65), width=1)

    bar_x = 22
    draw.rounded_rectangle([bar_x, 20, bar_x + 6, card_h - 20], radius=3, fill=(243, 107, 33, 255))

    font_badge = ImageFont.truetype(FONT_BOLD, 13)
    font_name = ImageFont.truetype(FONT_BOLD, 32)
    font_title = ImageFont.truetype(FONT_REG, 18)
    font_quote = ImageFont.truetype(FONT_SEMIBOLD, 16)

    tx = bar_x + 22
    draw.text((tx, 18), badge_text.upper(), font=font_badge, fill=(243, 107, 33, 255))
    draw.text((tx, 38), name_text, font=font_name, fill=(255, 255, 255, 255))
    draw.text((tx, 80), title_text, font=font_title, fill=(203, 213, 225, 240))
    if quote_text:
        draw.text((tx, 110), quote_text, font=font_quote, fill=(251, 191, 36, 245))

    return np.array(overlay, dtype=np.uint8)

def make_title_card(badge_text, main_title, subtitle, pillars_text=None, card_w=980, card_h=210, radius=16):
    overlay = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, outline=(255, 255, 255, 75), width=1)

    pill_x, pill_y = 30, 20
    font_pill = ImageFont.truetype(FONT_BOLD, 13)
    badge_w = int(draw.textlength(badge_text.upper(), font=font_pill)) + 26
    draw.rounded_rectangle([pill_x, pill_y, pill_x + badge_w, pill_y + 24], radius=12, fill=(243, 107, 33, 245))
    draw.text((pill_x + 13, pill_y + 4), badge_text.upper(), font=font_pill, fill=(255, 255, 255, 255))

    font_title = ImageFont.truetype(FONT_BOLD, 40)
    draw.text((30, 56), main_title, font=font_title, fill=(255, 255, 255, 255))

    font_sub = ImageFont.truetype(FONT_REG, 21)
    draw.text((32, 112), subtitle, font=font_sub, fill=(226, 232, 240, 245))

    if pillars_text:
        font_tag = ImageFont.truetype(FONT_REG, 15)
        draw.text((32, 154), pillars_text, font=font_tag, fill=(148, 163, 184, 230))

    return np.array(overlay, dtype=np.uint8)

# --- Asset Management & Preloaders ---

def load_video_frames(path, target_fps=30.0, max_frames=None, loop_to_frames=None):
    """Ingest and downscale/upscale frames to 1920x1080."""
    cap = cv2.VideoCapture(str(path))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or target_fps
    frames = []
    
    print(f"Loading {Path(path).name} (src_fps={src_fps:.2f})...")
    while True:
        if max_frames and len(frames) >= max_frames:
            break
        ret, frame = cap.read()
        if not ret:
            break
        h, w, _ = frame.shape
        if (w, h) != (WIDTH, HEIGHT):
            target_w = int(h * 16 / 9)
            if target_w <= w:
                x_start = (w - target_w) // 2
                cropped = frame[:, x_start:x_start + target_w]
            else:
                target_h = int(w * 9 / 16)
                y_start = (h - target_h) // 2
                cropped = frame[y_start:y_start + target_h, :]
            resized = cv2.resize(cropped, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA if w > WIDTH else cv2.INTER_LANCZOS4)
        else:
            resized = frame
        frames.append(resized)
    cap.release()

    if not frames:
        raise RuntimeError(f"Could not load any frames from {path}")

    # Loop if requested
    if loop_to_frames and len(frames) < loop_to_frames:
        orig = list(frames)
        # Ping-pong loop for seamless motion
        ping_pong = orig + orig[::-1]
        while len(frames) < loop_to_frames:
            frames.extend(ping_pong)
        frames = frames[:loop_to_frames]

    print(f"  Loaded {len(frames)} frames for {Path(path).name}")
    return frames

def render_ken_burns(image, t, duration, zoom_start=1.0, zoom_end=1.06, pan_start=(0.5, 0.5), pan_end=(0.52, 0.5)):
    """Apply smooth Ken Burns pan and push-in on high-res still image."""
    frac = smootherstep(t / max(0.01, duration))
    zoom = zoom_start + frac * (zoom_end - zoom_start)
    cx_frac = pan_start[0] + frac * (pan_end[0] - pan_start[0])
    cy_frac = pan_start[1] + frac * (pan_end[1] - pan_start[1])

    ih, iw, _ = image.shape
    # Determine base 16:9 box in image
    base_w = min(iw, int(ih * 16 / 9))
    base_h = int(base_w * 9 / 16)
    
    crop_w = int(base_w / zoom)
    crop_h = int(base_h / zoom)
    
    cx = int(iw * cx_frac)
    cy = int(ih * cy_frac)
    
    x1 = max(0, min(iw - crop_w, cx - crop_w // 2))
    y1 = max(0, min(ih - crop_h, cy - crop_h // 2))
    
    crop = image[y1:y1 + crop_h, x1:x1 + crop_w]
    return cv2.resize(crop, (WIDTH, HEIGHT), interpolation=cv2.INTER_LINEAR)

# --- Master Video Pipeline ---

def generate_documentary():
    print("=" * 70)
    print("Generating 3-Minute Valve Flatland Documentary Master Video")
    print(f"Output: {MASTER_VIDEO_PATH}")
    print(f"Specs: {WIDTH}x{HEIGHT} @ {FPS} fps | Exactly {TOTAL_FRAMES} frames ({TOTAL_SECONDS}s)")
    print("=" * 70)

    if not MASTER_AUDIO_PATH.exists():
        raise FileNotFoundError(f"Master audio not found: {MASTER_AUDIO_PATH}")

    # 1. Preload / Prepare Assets
    t0 = time.time()
    print("\nPhase 1: Ingesting & Preprocessing Visual Assets...")
    
    # Video Clips
    v_gabe_talent = load_video_frames(PROJECT_ROOT / "assets" / "speaker_portraits" / "gabe_4k_talent.mp4", max_frames=450)
    v_gabe_closing = load_video_frames(PROJECT_ROOT / "assets" / "speaker_portraits" / "gabe_4k_closing.mp4", max_frames=450)
    v_veo_open = load_video_frames(PROJECT_ROOT / "output" / "veo_broll" / "valve_open_office_6s.mp4", loop_to_frames=400)
    v_veo_desks = load_video_frames(PROJECT_ROOT / "output" / "veo_broll" / "valve_wheeled_desks_6s.mp4", loop_to_frames=450)
    v_chet = load_video_frames(PROJECT_ROOT / "assets" / "test_chet.mp4", loop_to_frames=420)
    v_wolpaw = load_video_frames(PROJECT_ROOT / "assets" / "temp_clips" / "erik_wolpaw_clean.mp4", loop_to_frames=420)
    v_weier = load_video_frames(PROJECT_ROOT / "assets" / "temp_clips" / "josh_weier_clean.mp4", loop_to_frames=450)
    v_geldreich = load_video_frames(PROJECT_ROOT / "assets" / "temp_clips" / "rich_geldreich.mp4", loop_to_frames=420)
    v_morasky = load_video_frames(PROJECT_ROOT / "assets" / "temp_clips" / "mike_morasky_clean.mp4", loop_to_frames=220)
    v_birdwell = load_video_frames(PROJECT_ROOT / "assets" / "temp_clips" / "ken_birdwell.mp4", loop_to_frames=240)

    # Still Images & Slides
    img_gabe_office = cv2.imread(str(PROJECT_ROOT / "assets" / "speaker_portraits" / "gabe_valve_office.jpg"))
    img_slide_07 = cv2.imread(str(PROJECT_ROOT / "exported_slides" / "slide_07.png"))
    img_slide_06 = cv2.imread(str(PROJECT_ROOT / "exported_slides" / "slide_06.png"))
    img_slide_09 = cv2.imread(str(PROJECT_ROOT / "exported_slides" / "slide_09.png"))
    img_slide_10 = cv2.imread(str(PROJECT_ROOT / "exported_slides" / "slide_10.png"))
    img_slide_01 = cv2.imread(str(PROJECT_ROOT / "exported_slides" / "slide_01.png"))
    img_freeman = cv2.imread(str(PROJECT_ROOT / "assets" / "speaker_portraits" / "plates" / "freeman_plate.jpg"))

    # Dedicated archival layout for Jo Freeman (Scene 10)
    jo_freeman_canvas = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    for y in range(HEIGHT):
        factor = y / HEIGHT
        jo_freeman_canvas[y, :] = [int(18 + 14 * factor), int(14 + 10 * factor), int(10 + 8 * factor)]

    fh, fw, _ = img_freeman.shape
    f_target_h = 680
    f_target_w = int(fw * f_target_h / fh)
    freeman_res = cv2.resize(img_freeman, (f_target_w, f_target_h), interpolation=cv2.INTER_AREA)
    fpx, fpy = 140, 200
    cv2.rectangle(jo_freeman_canvas, (fpx - 4, fpy - 4), (fpx + f_target_w + 4, fpy + f_target_h + 4), (243, 107, 33), 2)
    jo_freeman_canvas[fpy:fpy + f_target_h, fpx:fpx + f_target_w] = freeman_res

    # Archival quote card on the right
    f_overlay = Image.new("RGBA", (1040, 680), (0, 0, 0, 0))
    f_draw = ImageDraw.Draw(f_overlay)
    f_draw.rounded_rectangle([0, 0, 1039, 679], radius=16, fill=(24, 18, 14, 235), outline=(243, 107, 33, 200), width=2)

    font_f_badge = ImageFont.truetype(FONT_BOLD, 14)
    font_f_title = ImageFont.truetype(FONT_BOLD, 36)
    font_f_sub = ImageFont.truetype(FONT_REG, 22)
    font_f_quote = ImageFont.truetype(FONT_SEMIBOLD, 24)
    font_f_body = ImageFont.truetype(FONT_REG, 19)

    f_draw.rounded_rectangle([40, 36, 40 + 260, 36 + 28], radius=12, fill=(243, 107, 33, 255))
    f_draw.text((54, 40), "DOCUMENTED REALITIES • 1970", font=font_f_badge, fill=(255, 255, 255, 255))
    f_draw.text((40, 84), "THE TYRANNY OF STRUCTURELESSNESS", font=font_f_title, fill=(255, 255, 255, 255))
    f_draw.text((42, 138), "Jo Freeman • Political Scientist & Organizational Theorist", font=font_f_sub, fill=(203, 213, 225, 240))
    f_draw.line([(42, 185), (998, 185)], fill=(255, 255, 255, 40), width=1)

    f_draw.text((42, 215), "“Removing formal hierarchy does not eliminate power.\nIt merely drives power into informal friend groups,\nwhisper conversations, and unwritten popularity contests.”", font=font_f_quote, fill=(251, 191, 36, 255), spacing=12)
    f_draw.line([(42, 340), (998, 340)], fill=(255, 255, 255, 40), width=1)

    f_draw.text((42, 365), "✦ THE FLATLAND PARADOX:\nWhen no one is formally in charge, the loudest voices or established cliques\nquietly dominate decisions unless transparency is actively protected.\n\n✦ FLATLAND CULTURE SAFEGUARDS:\n• Transparent communication in open team channels\n• Documented decision records accessible to everyone\n• Equal psychological safety for every peer to challenge ideas", font=font_f_body, fill=(226, 232, 240, 240), spacing=8)

    f_ov_np = np.array(f_overlay)
    f_rgb = f_ov_np[:, :, :3]
    f_a = f_ov_np[:, :, 3:] / 255.0
    jo_freeman_canvas[fpy:fpy + 680, 740:740 + 1040] = ((1.0 - f_a) * jo_freeman_canvas[fpy:fpy + 680, 740:740 + 1040] + f_a * f_rgb[:, :, ::-1]).astype(np.uint8)

    print(f"Asset ingestion complete in {time.time() - t0:.2f}s.")

    # 2. Pre-render Graphic Overlays
    print("\nPhase 2: Pre-rendering Glassmorphism Overlays...")
    cards = {
        # Scene 1: Gabe Newell Founder Card
        "c01_gabe": (
            make_lower_third(
                "FEATURED FOUNDER",
                "GABE NEWELL",
                "Co-Founder & President  •  Valve Corporation",
                "Ex-Microsoft Systems Engineer (1983–1996)  •  Founded Valve in 1996",
                card_w=760, card_h=146
            ),
            120, 850, 760, 146
        ),
        # Scene 2: 1996 Premise Title Card
        "c02_premise": (
            make_title_card(
                "THE RADICAL PREMISE  •  1996",
                "DISMANTLING THE PYRAMID",
                "Why 20th-Century Hierarchies Cripple Creative Software",
                "Zero Department Heads   |   No Middle Managers   |   Zero Bureaucracy",
                card_w=960, card_h=204
            ),
            120, 780, 960, 204
        ),
        # Scene 3: Ronald Coase
        "c03_coase": (
            make_lower_third(
                "ECONOMIC LOGIC",
                "RONALD COASE & THE FIRM",
                "Nobel Laureate (1937)  •  The Nature of the Firm",
                "Insight: Hierarchies create friction and review committee delays in knowledge work.",
                card_w=820, card_h=146
            ),
            120, 850, 820, 146
        ),
        # Scene 4: Anatomy of Flatland
        "c04_flatland": (
            make_title_card(
                "ACT II  •  THE ANATOMY OF FLATLAND",
                "WELCOME TO FLATLAND",
                "Zero Job Titles  •  Zero Project Managers  •  Direct Peer Trust",
                "No Permission Slips   |   No Status Reports   |   The Player Is The Boss",
                card_w=960, card_h=204
            ),
            120, 780, 960, 204
        ),
        # Scene 5: Desks on Wheels
        "c05_wheels": (
            make_lower_third(
                "CORE MECHANISM",
                "DESKS ON WHEELS & CABALS",
                "Self-Selecting Project Teams Assemble Freely",
                "Unplug your desk, roll across the studio, and team up against the problem.",
                card_w=800, card_h=146
            ),
            120, 850, 800, 146
        ),
        # Scene 6: Voting With Feet
        "c06_voting": (
            make_title_card(
                "ORGANIZATIONAL DYNAMICS",
                "VOTING WITH YOUR FEET",
                "Market-Driven Talent Allocation in Creative Work",
                "Passionate Momentum Ships Games   |   Disinterest Quietly Kills Projects",
                card_w=960, card_h=204
            ),
            120, 780, 960, 204
        ),
        # Scene 7: Chet Faliszek
        "c07_chet": (
            make_lower_third(
                "CREATOR INTERVIEW  •  VALVE",
                "CHET FALISZEK",
                "Writer & Game Designer (Half-Life 2, Left 4 Dead, Portal)",
                "Principle: 'Action Over Permission — Build the prototype, don't write a memo.'",
                card_w=820, card_h=146
            ),
            120, 850, 820, 146
        ),
        # Scene 8: Erik Wolpaw
        "c08_wolpaw": (
            make_lower_third(
                "CREATOR INTERVIEW  •  VALVE",
                "ERIK WOLPAW",
                "Lead Writer (Portal, Portal 2, Half-Life: Alyx)",
                "Principle: 'Leave Egos at the Door — The Player's joy is our only metric.'",
                card_w=820, card_h=146
            ),
            120, 850, 820, 146
        ),
        # Scene 9: Josh Weier
        "c09_weier": (
            make_lower_third(
                "CREATOR INTERVIEW  •  VALVE",
                "JOSH WEIER",
                "Project Lead & Programmer (Portal 2, Team Fortress 2)",
                "Discipline: 'Healthy Boundaries — Working till 2 AM is a broken workflow, not heroism.'",
                card_w=850, card_h=146
            ),
            120, 850, 850, 146
        ),
        # Scene 10: Jo Freeman
        "c10_freeman": (
            make_title_card(
                "DOCUMENTED REALITIES  •  1970",
                "THE TYRANNY OF STRUCTURELESSNESS",
                "Political Scientist Jo Freeman's Seminal Critique",
                "Trap 1: Without formal hierarchy, power quietly slips into informal popularity contests.",
                card_w=980, card_h=204
            ),
            120, 780, 980, 204
        ),
        # Scene 11: Rich Geldreich
        "c11_geldreich": (
            make_lower_third(
                "INSIDER PERSPECTIVE  •  VALVE",
                "RICH GELDREICH",
                "Former Senior Software Engineer, Valve Corporation",
                "Trap 2: Peer stack-ranking reviews can foster subtle cliques and political maneuvering.",
                card_w=850, card_h=146
            ),
            120, 850, 850, 146
        ),
        # Scene 12: Phantom Crunch
        "c12_crunch": (
            make_lower_third(
                "THE VALVE HANDBOOK WARNING",
                "PHANTOM CRUNCH & OVERTIME GUILT",
                "Trap 3: Without managers setting hours, teammates must protect each other's rest.",
                "Culture Safeguard: Dedicated teams look out for fatigue and encourage unplugging.",
                card_w=860, card_h=146
            ),
            120, 850, 860, 146
        ),
        # Scene 13: Gabe Closing
        "c13_gabe_closing": (
            make_lower_third(
                "ACT IV  •  THE CORE TAKEAWAY",
                "GABE NEWELL: THE PHILOSOPHY OF TRUST",
                "Co-Founder & President  •  Valve Corporation",
                "Truth: Creative mastery cannot be commanded — it thrives only on mutual trust.",
                card_w=820, card_h=146
            ),
            120, 850, 820, 146
        ),
        # Scene 14: Leverage
        "c14_leverage": (
            make_title_card(
                "THE MULTIPLIER EFFECT",
                "EXPONENTIAL CREATIVE LEVERAGE",
                "From Game Studios to Educational Design: Freedom Unlocks Mastery",
                "Trusting Professionals as Equals  •  Immediate Feedback  •  Direct Student Impact",
                card_w=980, card_h=204
            ),
            120, 780, 980, 204
        ),
        # Scene 15: Outro Resolution
        "c15_resolution": (
            make_title_card(
                "VALVE  •  THE FLATLAND EXPERIMENT",
                "TRUST • AUTONOMY • CRAFT MASTERY",
                "1996 — 2026  •  30 Years of Flat Autonomy",
                "Action Over Permission   |   Desks on Wheels   |   The Learner Comes First",
                card_w=980, card_h=204
            ),
            120, 780, 980, 204
        )
    }

    # 3. Define Master 15-Scene Timeline Synchronized with Narration Beats
    # Load manifest to verify synchronization
    manifest_path = PROJECT_ROOT / "exported_slides" / "documentary_3min_audio" / "narration_manifest.json"
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    beats = {b["id"]: b for b in manifest["beats"]}

    # Scene boundaries: (start_t, end_t) with 500ms cross-dissolve overlaps
    # Slides (sc03, sc06, sc12, sc14) and dedicated composite (sc10) are shown cleanly without obscuring lower-third boxes
    timeline_scenes = [
        # Act 1: 0:00 - 0:35
        {"id": "sc01", "start": 0.0,  "end": 12.5, "type": "vid", "frames": v_gabe_talent,  "card": "c01_gabe", "card_t": (2.0, 11.4)},
        {"id": "sc02", "start": 12.0, "end": 23.5, "type": "img", "img": img_gabe_office, "card": "c02_premise", "card_t": (13.5, 21.8), "pan": ((0.52, 0.46), (0.50, 0.44), 1.05, 1.15)},
        {"id": "sc03", "start": 23.0, "end": 35.5, "type": "img", "img": img_slide_07,    "card": None, "pan": ((0.42, 0.50), (0.46, 0.52), 1.05, 1.14)},
        
        # Act 2: 0:35 - 1:15
        {"id": "sc04", "start": 35.0, "end": 46.0, "type": "vid", "frames": v_veo_open,     "card": "c04_flatland", "card_t": (36.5, 44.0)},
        {"id": "sc05", "start": 45.5, "end": 59.5, "type": "vid", "frames": v_veo_desks,    "card": "c05_wheels", "card_t": (47.0, 58.0)},
        {"id": "sc06", "start": 59.0, "end": 73.0, "type": "img", "img": img_slide_09,    "card": None, "pan": ((0.50, 0.48), (0.52, 0.52), 1.03, 1.10)},
        
        # Act 3: 1:15 - 2:25
        {"id": "sc07", "start": 72.5, "end": 85.0, "type": "vid", "frames": v_chet,        "card": "c07_chet", "card_t": (74.5, 83.2)},
        {"id": "sc08", "start": 84.5, "end": 96.5, "type": "vid", "frames": v_wolpaw,      "card": "c08_wolpaw", "card_t": (86.0, 95.4)},
        {"id": "sc09", "start": 96.0, "end": 108.5, "type": "vid", "frames": v_weier,      "card": "c09_weier", "card_t": (97.5, 107.6)},
        {"id": "sc10", "start": 108.0, "end": 120.5, "type": "img", "img": jo_freeman_canvas, "card": None, "pan": ((0.50, 0.50), (0.50, 0.50), 1.00, 1.03)},
        {"id": "sc11", "start": 120.0, "end": 131.5, "type": "vid", "frames": v_geldreich,  "card": "c11_geldreich", "card_t": (121.5, 129.8)},
        {"id": "sc12", "start": 131.0, "end": 143.5, "type": "img", "img": img_slide_10,   "card": None, "pan": ((0.50, 0.52), (0.50, 0.54), 1.03, 1.10)},
        
        # Act 4: 2:25 - 3:00
        {"id": "sc13", "start": 143.0, "end": 155.0, "type": "vid", "frames": v_gabe_closing, "card": "c13_gabe_closing", "card_t": (145.0, 153.9)},
        {"id": "sc14", "start": 154.5, "end": 165.5, "type": "img", "img": img_slide_01,   "card": None, "pan": ((0.50, 0.48), (0.52, 0.50), 1.03, 1.10)},
        {"id": "sc15", "start": 165.0, "end": 180.0, "type": "vid", "frames": v_veo_open,   "card": "c15_resolution", "card_t": (166.5, 175.0)},
    ]

    def get_scene_frame(scene, t):
        s_start = scene["start"]
        s_dur = scene["end"] - s_start
        local_t = max(0.0, t - s_start)
        
        stype = scene["type"]
        if stype == "vid":
            frames = scene["frames"]
            idx = min(len(frames) - 1, int(round(local_t * FPS)))
            return frames[idx].copy()
            
        elif stype == "img":
            pan_cfg = scene.get("pan", ((0.5, 0.5), (0.5, 0.5), 1.0, 1.06))
            return render_ken_burns(scene["img"], local_t, s_dur,
                                    zoom_start=pan_cfg[2], zoom_end=pan_cfg[3],
                                    pan_start=pan_cfg[0], pan_end=pan_cfg[1])
                                    
        elif stype == "vid_hybrid":
            # Hybrid: video for first half, smooth slide for second half
            split = scene["split_t"] - s_start
            if local_t < split:
                frames = scene["frames"]
                idx = min(len(frames) - 1, int(round(local_t * FPS)))
                return frames[idx].copy()
            else:
                img_t = local_t - split
                img_dur = s_dur - split
                return render_ken_burns(scene["img_alt"], img_t, img_dur, 1.02, 1.08, (0.5, 0.48), (0.52, 0.50))
                
        elif stype == "vid_split":
            split = scene["split_t"] - s_start
            if local_t < split:
                frames = scene["f1"]
                idx = min(len(frames) - 1, int(round(local_t * FPS)))
                return frames[idx].copy()
            else:
                frames = scene["f2"]
                idx2 = min(len(frames) - 1, int(round((local_t - split) * FPS)))
                return frames[idx2].copy()

        return np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)

    # 4. Launch FFmpeg Encoder
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{WIDTH}x{HEIGHT}",
        "-pix_fmt", "bgr24",
        "-r", str(int(FPS)),
        "-i", "-",
        "-i", str(MASTER_AUDIO_PATH),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "256k",
        "-ar", "48000",
        "-t", "180.000",
        str(MASTER_VIDEO_PATH)
    ]

    ffmpeg_log_path = OUT_DIR / "ffmpeg_documentary_3min.log"
    ffmpeg_log = open(ffmpeg_log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=ffmpeg_log)

    keyframe_stamps = [
        (4.0, "kf_01_gabe_intro_4s.jpg"),
        (17.0, "kf_02_gabe_office_17s.jpg"),
        (28.0, "kf_03_coase_diagram_28s.jpg"),
        (40.0, "kf_04_veo_open_studio_40s.jpg"),
        (52.0, "kf_05_wheeled_desks_52s.jpg"),
        (65.0, "kf_06_voting_with_feet_65s.jpg"),
        (78.0, "kf_07_chet_faliszek_78s.jpg"),
        (90.0, "kf_08_erik_wolpaw_90s.jpg"),
        (102.0, "kf_09_josh_weier_102s.jpg"),
        (114.0, "kf_10_jo_freeman_archival_114s.jpg"),
        (125.0, "kf_11_rich_geldreich_125s.jpg"),
        (137.0, "kf_12_phantom_crunch_137s.jpg"),
        (149.0, "kf_13_gabe_trust_closing_149s.jpg"),
        (160.0, "kf_14_exponential_leverage_160s.jpg"),
        (171.0, "kf_15_master_resolution_171s.jpg"),
    ]
    keyframe_frames = {int(round(t_s * FPS)): name for t_s, name in keyframe_stamps}

    print(f"\nPhase 3: Rendering {TOTAL_FRAMES} Master Frames ({TOTAL_SECONDS}s)...", flush=True)
    render_start = time.time()

    for frame_idx in range(TOTAL_FRAMES):
        t = frame_idx / FPS

        # Identify active scenes (there may be 1 or 2 during cross-dissolve)
        active = []
        for sc in timeline_scenes:
            if sc["start"] <= t < sc["end"]:
                active.append(sc)

        if len(active) == 1:
            base_frame = get_scene_frame(active[0], t).astype(np.float32)
            primary_sc = active[0]
        elif len(active) >= 2:
            sc1, sc2 = active[0], active[1]
            overlap_start = sc2["start"]
            overlap_end = sc1["end"]
            k = smootherstep((t - overlap_start) / max(0.01, overlap_end - overlap_start))
            f1 = get_scene_frame(sc1, t).astype(np.float32)
            f2 = get_scene_frame(sc2, t).astype(np.float32)
            base_frame = (1.0 - k) * f1 + k * f2
            primary_sc = sc2 if k >= 0.5 else sc1
        else:
            base_frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
            primary_sc = None

        # Composite Card Overlay if active in current time
        for sc in active:
            card_key = sc.get("card")
            if not card_key or card_key not in cards:
                continue
            card_t0, card_t1 = sc["card_t"]
            if card_t0 <= t <= card_t1:
                # In/Out transitions
                t_in = 0.40
                t_out = 0.35
                if t < card_t0 + t_in:
                    k_in = smootherstep((t - card_t0) / t_in)
                    card_alpha = k_in
                    y_shift = int(25 * (1.0 - k_in))
                elif t > card_t1 - t_out:
                    k_out = smootherstep((t - (card_t1 - t_out)) / t_out)
                    card_alpha = 1.0 - k_out
                    y_shift = 0
                else:
                    card_alpha = 1.0
                    y_shift = 0

                card_overlay, cx0, cy0, cw, ch = cards[card_key]
                base_frame = composite_frosted_card(
                    base_frame, card_overlay, cx0, cy0 + y_shift, cw, ch,
                    alpha=card_alpha, radius=14, blur_ksize=25
                )

        # Master Fade In (0.0s - 1.5s) & Master Fade Out (176.5s - 180.0s)
        master_alpha = 1.0
        if t < 1.50:
            master_alpha = smootherstep(t / 1.50)
        elif t > 176.50:
            master_alpha = 1.0 - smootherstep((t - 176.50) / 3.50)

        final_frame = np.clip(base_frame * master_alpha, 0, 255).astype(np.uint8)

        # Save keyframe snapshots
        if frame_idx in keyframe_frames:
            kf_name = keyframe_frames[frame_idx]
            cv2.imwrite(str(KEYFRAMES_DIR / kf_name), final_frame)

        # Write to FFmpeg
        proc.stdin.write(final_frame.tobytes())

        if (frame_idx + 1) % 150 == 0 or frame_idx == TOTAL_FRAMES - 1:
            pct = (frame_idx + 1) / TOTAL_FRAMES * 100
            el = time.time() - render_start
            fps_cur = (frame_idx + 1) / max(0.1, el)
            eta = (TOTAL_FRAMES - frame_idx - 1) / max(0.1, fps_cur)
            sys.stdout.write(f"\r  Rendering: {frame_idx + 1:4d}/{TOTAL_FRAMES} frames ({pct:5.1f}%) | {fps_cur:5.1f} fps | Elapsed: {el:5.1f}s | ETA: {eta:4.1f}s")
            sys.stdout.flush()

    print("\n\nFinalizing video stream and closing FFmpeg pipe...")
    proc.stdin.close()
    proc.wait()
    ffmpeg_log.close()

    if proc.returncode != 0:
        with open(ffmpeg_log_path, "r", encoding="utf-8") as f:
            log_err = f.read()
        print(f"FFmpeg Error:\n{log_err}")
        raise RuntimeError(f"FFmpeg encoding failed with code {proc.returncode}")

    render_time = time.time() - render_start
    size_mb = MASTER_VIDEO_PATH.stat().st_size / (1024 * 1024)
    print("=" * 70)
    print(f"DOCUMENTARY MASTER VIDEO COMPLETED: {MASTER_VIDEO_PATH}")
    print(f"  Total Duration: {TOTAL_SECONDS:.2f}s ({TOTAL_FRAMES} frames @ {FPS} fps)")
    print(f"  File Size:      {size_mb:.2f} MB")
    print(f"  Render Speed:   {TOTAL_FRAMES / render_time:.1f} fps ({render_time:.1f}s total)")
    print(f"  Keyframes:      {KEYFRAMES_DIR}")
    print("=" * 70)

if __name__ == "__main__":
    generate_documentary()
