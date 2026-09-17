"""
scripts/render_option_d_technical_blueprint.py
Option D: Technical Blueprint / Architectural Phonetics & Soundwave Oscilloscope
- Deep cyanotype architectural blueprint paper texture with technical millimeter grid
- White & electric cyan CAD technical line art
- High-contrast anatomical sagittal cutaway with engineering dimension callouts
- Real-time animated audio oscilloscope waveform driven by the actual audio signal
- Distinctive phonological feature matrix and articulatory pressure gauges
- Synchronized technical drafting subtitles
"""

import os
import sys
import math
import random
import subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageChops, ImageFilter
from pydub import AudioSegment

WORK_DIR = os.path.abspath("workspace_rachel_voiceover")
ASSET_DIR = os.path.join(WORK_DIR, "mock_assets")
AUDIO_PATH = os.path.join(WORK_DIR, "audio_30s_preview.wav")
OUTPUT_PATH = os.path.join(WORK_DIR, "mock_option_d_technical_blueprint.mp4")

WIDTH = 1920
HEIGHT = 1080
FPS = 30
TOTAL_FRAMES = 900 # 30 seconds

FONT_TITLE = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 36)
FONT_HEADING = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 28)
FONT_BODY = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 22)
FONT_BODY_BOLD = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 24)
FONT_TABLE_BODY = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 17)
FONT_TABLE_HDR = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 18)
FONT_SUB_VI = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 30)
FONT_SUB_EN = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 22)
FONT_IPA_BIG = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 75)
FONT_TAG = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 18)

# Blueprint CAD Palette
CAD_WHITE = (245, 250, 255)
CAD_CYAN = (0, 230, 255)
CAD_AMBER = (255, 195, 45)
CAD_GREEN = (65, 240, 140)
CAD_DARK_BLUE = (10, 45, 85)
CAD_GRID_LINE = (30, 95, 155)

# Load raw audio samples for oscilloscope
audio_seg = AudioSegment.from_file(AUDIO_PATH)
audio_samples = np.array(audio_seg.get_array_of_samples())
if audio_seg.channels == 2:
    audio_samples = audio_samples.reshape((-1, 2)).mean(axis=1)
sample_rate = audio_seg.frame_rate
samples_per_frame = int(sample_rate / FPS)

# Pre-process cutaway to blueprint inverted line art
def prepare_blueprint_cutaway(cutaway_path):
    img = Image.open(cutaway_path).convert("L")
    arr = np.array(img)
    # Invert: pencil dark lines become bright white/cyan lines
    inv = 255 - arr
    # Contrast stretch
    inv = cv2.normalize(inv, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
    # Threshold weak noise
    inv[inv < 50] = 0
    # Create RGBA: white lines with cyan glow
    h, w = inv.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 0] = (inv * 0.85).astype(np.uint8) # R
    rgba[:, :, 1] = (inv * 0.95).astype(np.uint8) # G
    rgba[:, :, 2] = inv # B (bright cyan/white)
    rgba[:, :, 3] = inv # Alpha
    return Image.fromarray(rgba)

def draw_cad_box(draw, box, color=CAD_CYAN, width=2):
    x0, y0, x1, y1 = box
    draw.rectangle([x0, y0, x1, y1], outline=color, width=width)
    # Corner marks
    d = 8
    draw.line([(x0-d, y0), (x0+d, y0)], fill=color, width=2)
    draw.line([(x0, y0-d), (x0, y0+d)], fill=color, width=2)
    draw.line([(x1-d, y0), (x1+d, y0)], fill=color, width=2)
    draw.line([(x1, y0-d), (x1, y0+d)], fill=color, width=2)
    draw.line([(x0-d, y1), (x0+d, y1)], fill=color, width=2)
    draw.line([(x0, y1-d), (x0, y1+d)], fill=color, width=2)
    draw.line([(x1-d, y1), (x1+d, y1)], fill=color, width=2)
    draw.line([(x1, y1-d), (x1, y1+d)], fill=color, width=2)

def render_frame_d(frame_idx, base_bp, bp_cutaway):
    t = frame_idx / FPS

    frame = base_bp.copy()
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # 1. Top Blueprint Technical Title Block
    bx0, by0, bx1, by1 = 60, 30, WIDTH - 60, 110
    draw_cad_box(draw, (bx0, by0, bx1, by1), color=CAD_CYAN, width=2)
    
    # Title bar contents
    draw.text((bx0 + 25, by0 + 15), "ACOUSTIC PHONETICS SCHEMATIC: BILABIAL OCCLUSIVES [p] / [b]", fill=CAD_WHITE, font=FONT_TITLE)
    draw.text((bx0 + 25, by0 + 55), "ISO/IPA STANDARD • ARTICULATORY & SPECTRAL DYNAMICS ANALYSIS", fill=CAD_CYAN, font=FONT_TAG)
    draw.text((bx1 - 280, by0 + 20), f"TIME: {t:05.2f}s / 30.00s", fill=CAD_AMBER, font=FONT_BODY_BOLD)
    draw.text((bx1 - 280, by0 + 55), f"FRAME: {frame_idx:04d} • 30 FPS", fill=CAD_CYAN, font=FONT_TAG)

    # 2. Subtitle Section
    sub_vi = ""
    sub_en = ""
    if 0.0 <= t < 6.14:
        sub_vi = "Trong video luyện phát âm tiếng Anh-Mỹ này, chúng ta sẽ học cách phát âm..."
        sub_en = "In this American English pronunciation video, we're going to learn how to pronounce..."
    elif 6.14 <= t < 9.72:
        sub_vi = "hai phụ âm P và B."
        sub_en = "the P and B consonants."
    elif 9.72 <= t < 16.34:
        sub_vi = "[ Nhạc dạo đầu & Giới thiệu bài học ]"
        sub_en = "[ Rachel's English Title Theme & Lesson Overview ]"
    elif 16.34 <= t < 21.92:
        sub_vi = "Hai âm này đi thành một cặp vì chúng có cùng khẩu hình miệng."
        sub_en = "These two sounds are paired together because they take the same mouth position."
    elif 21.92 <= t < 28.90:
        sub_vi = "Âm P là âm vô thanh, [pp], nghĩa là chỉ có luồng hơi đi qua miệng."
        sub_en = "P is unvoiced, [p], meaning only air passes through the mouth."
    else:
        sub_vi = "Còn âm B là âm hữu thanh, [bb], nghĩa là dây thanh quản rung lên để tạo ra âm thanh."
        sub_en = "And B is voiced, [b], meaning you make a sound with the vocal cords, [b]."

    # 3. Left Panel: Anatomical Sagittal CAD Cutaway
    p_x0, p_y0, p_x1, p_y1 = 60, 130, 880, 860
    draw_cad_box(draw, (p_x0, p_y0, p_x1, p_y1), color=CAD_CYAN, width=2)
    draw.text((p_x0 + 20, p_y0 + 15), "FIGURE 1.0: SAGITTAL VOCAL TRACT SECTION", fill=CAD_AMBER, font=FONT_HEADING)
    draw.line([(p_x0 + 20, p_y0 + 50), (p_x1 - 20, p_y0 + 50)], fill=CAD_GRID_LINE, width=1)

    # Paste inverted blueprint cutaway
    cut_size = 560
    cut_scaled = bp_cutaway.resize((cut_size, cut_size), Image.Resampling.LANCZOS)
    canvas.paste(cut_scaled, (p_x0 + 130, p_y0 + 60), cut_scaled)

    # Dimension & CAD callout lines on the cutaway
    # Lip occlusion marker
    lip_cx, lip_cy = p_x0 + 275, p_y0 + 385
    draw.ellipse((lip_cx - 15, lip_cy - 15, lip_cx + 15, lip_cy + 15), outline=CAD_AMBER, width=2)
    draw.line([(lip_cx + 15, lip_cy), (lip_cx + 90, lip_cy)], fill=CAD_AMBER, width=2)
    draw.line([(lip_cx + 90, lip_cy), (lip_cx + 140, lip_cy - 40)], fill=CAD_AMBER, width=2)
    draw.text((lip_cx + 145, lip_cy - 50), "BILABIAL CONTACT: 0.0 mm (SEALED)", fill=CAD_AMBER, font=FONT_TAG)

    # Glottis / vocal cords marker
    g_cx, g_cy = p_x0 + 440, p_y0 + 540
    is_voiced_b = (t >= 28.9) or (16.34 <= t < 21.92 and (frame_idx % 20 < 10))
    g_color = CAD_CYAN if is_voiced_b else CAD_WHITE
    draw.ellipse((g_cx - 15, g_cy - 15, g_cx + 15, g_cy + 15), outline=g_color, width=2)
    draw.line([(g_cx + 15, g_cy), (g_cx + 90, g_cy)], fill=g_color, width=2)
    draw.line([(g_cx + 90, g_cy), (g_cx + 130, g_cy + 40)], fill=g_color, width=2)
    
    if 21.92 <= t < 28.90:
        g_status = "GLOTTIS: ABDUCTED / RESTING (0 Hz)"
    elif t >= 28.90:
        g_status = "GLOTTIS: ADDUCTED / OSCILLATING (135 Hz)"
    else:
        g_status = "GLOTTIS: PHONATION MONITOR ACTIVE"
    draw.text((g_cx + 135, g_cy + 30), g_status, fill=g_color, font=FONT_TAG)

    # Bottom metric inside Left Panel
    draw.line([(p_x0 + 20, p_y1 - 130), (p_x1 - 20, p_y1 - 130)], fill=CAD_GRID_LINE, width=1)
    draw.text((p_x0 + 30, p_y1 - 110), "INTRAORAL AIR PRESSURE (P_oral):", fill=CAD_WHITE, font=FONT_BODY)
    p_val = 0.84 if (21.92 <= t < 28.90 or t < 9.72) else 0.42
    draw.text((p_x0 + 480, p_y1 - 110), f"{p_val:.2f} kPa [NORMAL PEAK]", fill=CAD_AMBER, font=FONT_BODY_BOLD)
    draw.text((p_x0 + 30, p_y1 - 70), "VELUM STATE (SOFT PALATE):", fill=CAD_WHITE, font=FONT_BODY)
    draw.text((p_x0 + 480, p_y1 - 70), "ELEVATED [+ORAL, -NASAL]", fill=CAD_GREEN, font=FONT_BODY_BOLD)

    # 4. Right Top Panel: Distinctive Feature Matrix
    r_x0, r_y0, r_x1, r_y1 = 920, 130, WIDTH - 60, 560
    draw_cad_box(draw, (r_x0, r_y0, r_x1, r_y1), color=CAD_CYAN, width=2)
    draw.text((r_x0 + 25, r_y0 + 15), "TECHNICAL SPECIFICATION: PHONOLOGICAL MATRIX", fill=CAD_AMBER, font=FONT_HEADING)
    draw.line([(r_x0 + 20, r_y0 + 50), (r_x1 - 20, r_y0 + 50)], fill=CAD_GRID_LINE, width=1)

    # Table of Distinctive Features
    rows = [
        ("FEATURE PARAMETER", "VALUE [p]", "VALUE [b]", "PHYSICAL CORRELATE"),
        ("Manner of Articulation", "Plosive (Stop)", "Plosive (Stop)", "Complete oral closure"),
        ("Place of Articulation", "Bilabial", "Bilabial", "Lower lip meets upper lip"),
        ("Phonation / Voicing", "VOICELESS [-voice]", "VOICED [+voice]", "Vocal fold vibration"),
        ("Voice Onset Time (VOT)", "+35ms to +70ms", "-10ms to +10ms", "Lag vs simultaneous burst"),
        ("Acoustic Burst Energy", "Diffused / Flat", "Low Bar (<200Hz)", "Transient release spectrum"),
        ("Vocal Tract Airflow", "High (>500 ml/s)", "Mod. (~150 ml/s)", "Glottal resistance delta")
    ]

    ty = r_y0 + 65
    c1_x = r_x0 + 20
    c2_x = r_x0 + 265
    c3_x = r_x0 + 460
    c4_x = r_x0 + 655

    for idx, (f_name, v_p, v_b, f_phys) in enumerate(rows):
        is_hdr = (idx == 0)
        c_text = CAD_AMBER if is_hdr else CAD_WHITE
        font_r = FONT_TABLE_HDR if is_hdr else FONT_TABLE_BODY
        
        # Highlight active row
        if idx == 3: # Voicing row
            highlight_color = (0, 60, 120, 180) if (21.92 <= t < 28.90) else (20, 80, 50, 180)
            draw.rectangle([r_x0 + 15, ty - 2, r_x1 - 15, ty + 26], fill=highlight_color)

        draw.text((c1_x, ty), f_name, fill=c_text, font=font_r)
        draw.text((c2_x, ty), v_p, fill=CAD_CYAN if not is_hdr else CAD_AMBER, font=font_r)
        draw.text((c3_x, ty), v_b, fill=CAD_GREEN if not is_hdr else CAD_AMBER, font=font_r)
        draw.text((c4_x, ty), f_phys, fill=c_text, font=font_r)
        ty += 34

    # 5. Right Bottom Panel: Real-Time Audio Oscilloscope & Spectrogram Ribbon
    o_x0, o_y0, o_x1, o_y1 = 920, 580, WIDTH - 60, 860
    draw_cad_box(draw, (o_x0, o_y0, o_x1, o_y1), color=CAD_CYAN, width=2)
    draw.text((o_x0 + 25, o_y0 + 15), "REAL-TIME ACOUSTIC OSCILLOSCOPE & WAVEFORM RIBBON", fill=CAD_AMBER, font=FONT_HEADING)
    draw.line([(o_x0 + 20, o_y0 + 50), (o_x1 - 20, o_y0 + 50)], fill=CAD_GRID_LINE, width=1)

    # Grid for oscilloscope
    center_oy = o_y0 + 160
    draw.line([(o_x0 + 20, center_oy), (o_x1 - 20, center_oy)], fill=(50, 130, 200), width=1)
    for g_x in range(o_x0 + 30, o_x1 - 20, 50):
        draw.line([(g_x, o_y0 + 60), (g_x, o_y1 - 20)], fill=(20, 70, 130), width=1)

    # Extract audio slice for current frame
    start_s = max(0, frame_idx * samples_per_frame - samples_per_frame // 2)
    end_s = min(len(audio_samples), start_s + samples_per_frame * 2)
    chunk = audio_samples[start_s:end_s]
    
    # Downsample chunk to width of oscilloscope
    disp_w = (o_x1 - 40) - (o_x0 + 40)
    if len(chunk) > 10:
        step = max(1, len(chunk) // disp_w)
        sampled = chunk[::step][:disp_w]
        max_val = np.max(np.abs(sampled)) if np.max(np.abs(sampled)) > 0 else 1
        
        # Draw oscilloscope trace
        pts = []
        for xi, val in enumerate(sampled):
            norm_y = (val / 32768.0) * 85.0
            px = o_x0 + 40 + xi
            py = center_oy - int(norm_y)
            pts.append((px, py))
        
        if len(pts) > 1:
            draw.line(pts, fill=CAD_CYAN, width=2)
            # Secondary glow trace
            draw.line([(p[0], p[1] + 1) for p in pts], fill=(0, 180, 220), width=1)

    # Status labels on oscilloscope
    cur_rms = np.sqrt(np.mean(chunk**2)) if len(chunk) > 0 else 0
    draw.text((o_x0 + 35, o_y1 - 40), f"SIGNAL AMPLITUDE: {int(cur_rms):05d} RMS", fill=CAD_WHITE, font=FONT_TAG)
    draw.text((o_x0 + 420, o_y1 - 40), "TIMEBASE: 10 ms/DIV • CHANNEL A: DIRECT MIC", fill=CAD_CYAN, font=FONT_TAG)

    # 6. Bottom Subtitle Ribbon (CAD style with opaque navy backing to prevent blueprint grid/title block bleed)
    sb_x0, sb_y0, sb_x1, sb_y1 = 60, 890, WIDTH - 60, 1030
    draw.rectangle([sb_x0, sb_y0, sb_x1, sb_y1], fill=(8, 28, 56, 235))
    draw_cad_box(draw, (sb_x0, sb_y0, sb_x1, sb_y1), color=CAD_CYAN, width=2)
    
    # Subtitle texts
    tb_vi = draw.textbbox((0,0), sub_vi, font=FONT_SUB_VI)
    vi_w = tb_vi[2] - tb_vi[0]
    draw.text(((WIDTH - vi_w)//2, sb_y0 + 20), sub_vi, fill=CAD_WHITE, font=FONT_SUB_VI)

    tb_en = draw.textbbox((0,0), sub_en, font=FONT_SUB_EN)
    en_w = tb_en[2] - tb_en[0]
    draw.text(((WIDTH - en_w)//2, sb_y0 + 75), sub_en, fill=CAD_CYAN, font=FONT_SUB_EN)

    # Composite canvas over blueprint
    final_frame = Image.alpha_composite(frame.convert("RGBA"), canvas).convert("RGB")
    return np.array(final_frame)[:, :, ::-1]

def render_option_d():
    print(f"=== Rendering Option D: Technical Blueprint ({TOTAL_FRAMES} frames) ===")
    bp_path = os.path.join(ASSET_DIR, "blueprint_blank_grid_1789185331930.jpg")
    cutaway_path = os.path.join(ASSET_DIR, "sagittal_cutaway_sketch_1789185277220.jpg")

    base_bp = Image.open(bp_path).resize((WIDTH, HEIGHT))
    bp_cutaway = prepare_blueprint_cutaway(cutaway_path)

    cmd = [
        "ffmpeg", "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{WIDTH}x{HEIGHT}", "-pix_fmt", "bgr24", "-r", str(FPS),
        "-i", "-", "-i", AUDIO_PATH,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        "-shortest", OUTPUT_PATH
    ]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

    for i in range(TOTAL_FRAMES):
        final_bgr = render_frame_d(i, base_bp, bp_cutaway)
        proc.stdin.write(final_bgr.tobytes())
        if (i + 1) % 150 == 0:
            print(f"Option D: Rendered frame {i+1}/{TOTAL_FRAMES} ({(i+1)/FPS:.1f}s)")

    proc.stdin.close()
    proc.wait()
    print(f"Option D rendered successfully to: {OUTPUT_PATH}")

if __name__ == "__main__":
    render_option_d()
