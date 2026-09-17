"""
scripts/render_option_c_rotoscope_vignette.py
Option C: Stabilized Sketch Rotoscope Vignette / PiP + Whiteboard Infographics
- Hand-drawn paper texture backdrop
- Right side: Original Rachel's English video transformed via 2D pencil-sketch rotoscope shader
  (Centered on Rachel at x=600, Dodge blend + Adaptive pencil edge detection + circular sketched vignette)
- Left side: Dynamic whiteboard pedagogical diagrams with anatomical sagittal cutaway
- Pristine Vietnamese Unicode rendering using Segoe UI Bold
"""

import os
import sys
import math
import random
import subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageChops, ImageFilter

WORK_DIR = os.path.abspath("workspace_rachel_voiceover")
ASSET_DIR = os.path.join(WORK_DIR, "mock_assets")
VIDEO_PATH = os.path.join(WORK_DIR, "video.mp4")
AUDIO_PATH = os.path.join(WORK_DIR, "audio_30s_preview.wav")
OUTPUT_PATH = os.path.join(WORK_DIR, "mock_option_c_rotoscope_vignette.mp4")

WIDTH = 1920
HEIGHT = 1080
FPS = 30
TOTAL_FRAMES = 900 # 30 seconds

# High-fidelity fonts with complete Vietnamese Unicode diacritics
FONT_TITLE = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 44)
FONT_HEADING = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 34)
FONT_BODY = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 26)
FONT_SUB_VI = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 32)
FONT_SUB_EN = ImageFont.truetype("C:/Windows/Fonts/segoeuii.ttf", 26)
FONT_IPA_BIG = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 85)
FONT_TAG = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 22)

GRAPHITE = (40, 42, 48)
PENCIL_RED = (205, 45, 35)
PENCIL_BLUE = (25, 100, 185)
PENCIL_YELLOW = (240, 180, 20)

def draw_sketch_rect(draw, box, color=GRAPHITE, width=3, jitter_seed=1):
    x0, y0, x1, y1 = box
    rng = random.Random(jitter_seed)
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    for i in range(4):
        p1, p2 = corners[i], corners[i+1]
        for _ in range(2):
            dx1, dy1 = rng.uniform(-2, 2), rng.uniform(-2, 2)
            dx2, dy2 = rng.uniform(-2, 2), rng.uniform(-2, 2)
            draw.line([(p1[0]+dx1, p1[1]+dy1), (p2[0]+dx2, p2[1]+dy2)], fill=color, width=width)

def draw_sketch_circle(draw, center, radius, color=GRAPHITE, width=3, jitter_seed=1):
    cx, cy = center
    rng = random.Random(jitter_seed)
    for _ in range(2):
        pts = []
        for rad in np.linspace(0, 2 * math.pi, 120):
            r = radius + rng.uniform(-1.5, 1.5)
            pts.append((cx + r * math.cos(rad), cy + r * math.sin(rad)))
        draw.line(pts, fill=color, width=width)

def rotoscope_sketch_filter(frame_bgr):
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    inv = 255 - gray
    blur = cv2.GaussianBlur(inv, (21, 21), 0)
    sketch = cv2.divide(gray, 255 - blur, scale=256)
    edges = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 9, 4)
    combined = cv2.multiply(sketch, edges, scale=1.0/255)
    r = (combined * 0.96).astype(np.uint8)
    g = (combined * 0.95).astype(np.uint8)
    b = (combined * 0.91).astype(np.uint8)
    return cv2.merge([b, g, r])

def render_frame_c(frame_idx, base_paper, rachel_sketch_bgr, thumb_rgba):
    t = frame_idx / FPS
    boil_cycle = frame_idx // 3

    frame = base_paper.copy()
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (255, 255, 255, 0))
    draw = ImageDraw.Draw(canvas)

    # 1. Header
    header_w, header_h = 1080, 75
    hx, hy = (WIDTH - header_w)//2, 30
    draw_sketch_rect(draw, (hx, hy, hx + header_w, hy + header_h), color=GRAPHITE, width=3, jitter_seed=boil_cycle)
    
    hl = Image.new("RGBA", (WIDTH, HEIGHT), (0,0,0,0))
    h_draw = ImageDraw.Draw(hl)
    h_draw.rectangle((hx+10, hy+10, hx+header_w-10, hy+header_h-10), fill=(230, 245, 255, 140))
    canvas = Image.alpha_composite(canvas, hl)
    draw = ImageDraw.Draw(canvas)

    htext = "HYBRID SKETCH ROTOSCOPE & WHITEBOARD INFOGRAPHIC"
    tb = draw.textbbox((0,0), htext, font=FONT_HEADING)
    hw = tb[2] - tb[0]
    draw.text(((WIDTH - hw)//2, hy + 18), htext, fill=GRAPHITE, font=FONT_HEADING)

    # 2. Subtitles
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

    # 3. Right Side: Centered Sketch Rotoscope Vignette of Rachel
    vig_size = 680
    vx, vy = 1140, 150

    # Rachel centered crop (x_center = 600)
    h_orig, w_orig = rachel_sketch_bgr.shape[:2]
    crop_size = min(h_orig, 750)
    cx = 600
    x_start = max(0, cx - crop_size//2)
    x_end = min(w_orig, x_start + crop_size)
    y_start = 80
    y_end = min(h_orig, y_start + crop_size)
    
    crop_rachel = rachel_sketch_bgr[y_start:y_end, x_start:x_end]
    crop_resized = cv2.resize(crop_rachel, (vig_size, vig_size))

    pil_rachel = Image.fromarray(cv2.cvtColor(crop_resized, cv2.COLOR_BGR2RGB)).convert("RGBA")
    
    mask = Image.new("L", (vig_size, vig_size), 0)
    m_draw = ImageDraw.Draw(mask)
    m_draw.ellipse((10, 10, vig_size - 10, vig_size - 10), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(3))
    pil_rachel.putalpha(mask)

    frame.paste(pil_rachel, (vx, vy), pil_rachel)

    center_vig = (vx + vig_size//2, vy + vig_size//2)
    radius_vig = vig_size//2 - 8
    draw_sketch_circle(draw, center_vig, radius_vig, color=GRAPHITE, width=4, jitter_seed=boil_cycle)
    draw_sketch_circle(draw, center_vig, radius_vig + 8, color=PENCIL_BLUE, width=2, jitter_seed=boil_cycle+1)

    tag_text = "[ KHẨU HÌNH THỰC TẾ: CÔ RACHEL (2D SKETCH ROTOSCOPE) ]"
    tb_tag = draw.textbbox((0,0), tag_text, font=FONT_TAG)
    tw_tag = tb_tag[2] - tb_tag[0]
    draw.text((vx + (vig_size - tw_tag)//2, vy + vig_size + 15), tag_text, fill=PENCIL_BLUE, font=FONT_TAG)

    # 4. Left Side: Educational Whiteboard Infographics
    inf_x, inf_y = 100, 140
    inf_w, inf_h = 980, 720
    draw_sketch_rect(draw, (inf_x, inf_y, inf_x + inf_w, inf_y + inf_h), color=GRAPHITE, width=4, jitter_seed=boil_cycle)
    
    inf_fill = Image.new("RGBA", (WIDTH, HEIGHT), (0,0,0,0))
    ifd = ImageDraw.Draw(inf_fill)
    ifd.rectangle((inf_x+6, inf_y+6, inf_x+inf_w-6, inf_y+inf_h-6), fill=(255, 255, 252, 235))
    canvas = Image.alpha_composite(canvas, inf_fill)
    draw = ImageDraw.Draw(canvas)

    if t < 9.72:
        draw.text((inf_x + 60, inf_y + 40), "CẶP PHỤ ÂM TẮC [p] & [b]", fill=PENCIL_RED, font=FONT_TITLE)
        draw.line([(inf_x + 50, inf_y + 115), (inf_x + inf_w - 50, inf_y + 115)], fill=GRAPHITE, width=2)

        draw.text((inf_x + 60, inf_y + 150), "• Tên chuyên ngành: Bilabial Plosives / Stops", fill=GRAPHITE, font=FONT_HEADING)
        draw.text((inf_x + 60, inf_y + 220), "• Đặc điểm nhận dạng quan trọng nhất:", fill=PENCIL_BLUE, font=FONT_HEADING)
        draw.text((inf_x + 90, inf_y + 280), "1. Cùng dùng 100% hình thái của hai bờ môi.", fill=GRAPHITE, font=FONT_BODY)
        draw.text((inf_x + 90, inf_y + 335), "2. Môi khép chặt hoàn toàn trước khi phát âm.", fill=GRAPHITE, font=FONT_BODY)
        draw.text((inf_x + 90, inf_y + 390), "3. [p] là âm vô thanh (không rung dây thanh).", fill=PENCIL_RED, font=FONT_BODY)
        draw.text((inf_x + 90, inf_y + 445), "4. [b] là âm hữu thanh (rung dây thanh quản).", fill=PENCIL_BLUE, font=FONT_BODY)

        call_y = inf_y + 530
        draw_sketch_rect(draw, (inf_x + 60, call_y, inf_x + inf_w - 60, call_y + 110), color=PENCIL_BLUE, width=2, jitter_seed=boil_cycle)
        draw.text((inf_x + 90, call_y + 18), "[→] ĐỐI CHIẾU KHẨU HÌNH THỰC TẾ CÙNG CÔ RACHEL", fill=PENCIL_BLUE, font=FONT_TAG)
        draw.text((inf_x + 90, call_y + 58), "Quan sát góc quay cận cảnh độ nét cao ở khung tròn bên phải.", fill=GRAPHITE, font=FONT_BODY)

    elif 9.72 <= t < 16.34:
        draw.text((inf_x + 60, inf_y + 40), "CƠ CHẾ PHỤ ÂM TẮC (BILABIAL STOPS)", fill=PENCIL_BLUE, font=FONT_TITLE)
        draw.line([(inf_x + 50, inf_y + 115), (inf_x + inf_w - 50, inf_y + 115)], fill=GRAPHITE, width=2)

        draw.text((inf_x + 60, inf_y + 150), "2 PHA HOẠT ĐỘNG CỦA KHẨU HÌNH:", fill=GRAPHITE, font=FONT_HEADING)
        
        b1_y = inf_y + 220
        draw_sketch_rect(draw, (inf_x + 60, b1_y, inf_x + inf_w - 60, b1_y + 160), color=PENCIL_RED, width=3, jitter_seed=boil_cycle)
        draw.text((inf_x + 80, b1_y + 20), "PHA 1: CHẶN DÒNG KHÍ (OCCLUSION)", fill=PENCIL_RED, font=FONT_HEADING)
        draw.text((inf_x + 80, b1_y + 75), "Môi khép chặt kín. Áp suất khí tăng cao trong miệng.", fill=GRAPHITE, font=FONT_BODY)

        b2_y = inf_y + 420
        draw_sketch_rect(draw, (inf_x + 60, b2_y, inf_x + inf_w - 60, b2_y + 160), color=PENCIL_BLUE, width=3, jitter_seed=boil_cycle+1)
        draw.text((inf_x + 80, b2_y + 20), "PHA 2: BẬT NỔ KHÍ RA (PLOSIVE RELEASE)", fill=PENCIL_BLUE, font=FONT_HEADING)
        draw.text((inf_x + 80, b2_y + 75), "Môi mở tức thì, luồng hơi bùng nổ ra ngoài tạo âm sắc.", fill=GRAPHITE, font=FONT_BODY)

    else:
        draw.text((inf_x + 60, inf_y + 35), "GIẢI PHẪU KHOANG MIỆNG BÊN TRONG", fill=PENCIL_RED, font=FONT_TITLE)
        draw.line([(inf_x + 50, inf_y + 105), (inf_x + inf_w - 50, inf_y + 105)], fill=GRAPHITE, width=2)

        # Paste crisp graphite cutaway directly onto whiteboard canvas
        canvas.paste(thumb_rgba, (inf_x + 50, inf_y + 130), thumb_rgba)

        cx_text = inf_x + 530
        if 16.34 <= t < 21.92:
            draw.text((cx_text, inf_y + 150), "CÙNG KHẨU HÌNH", fill=PENCIL_RED, font=FONT_HEADING)
            draw.text((cx_text, inf_y + 220), "• Môi trên & dưới:", fill=GRAPHITE, font=FONT_BODY)
            draw.text((cx_text + 20, inf_y + 265), "Khép chặt 100%", fill=PENCIL_RED, font=FONT_HEADING)
            draw.text((cx_text, inf_y + 330), "• Răng cửa: Hé nhẹ", fill=GRAPHITE, font=FONT_BODY)
            draw.text((cx_text, inf_y + 390), "• Lưỡi: Nghỉ tự nhiên", fill=GRAPHITE, font=FONT_BODY)
            draw.text((cx_text, inf_y + 460), "→ Đối chiếu trực tiếp", fill=PENCIL_BLUE, font=FONT_BODY)
            draw.text((cx_text + 20, inf_y + 505), "với môi cô Rachel!", fill=PENCIL_BLUE, font=FONT_HEADING)

        elif 21.92 <= t < 28.90:
            draw.text((cx_text, inf_y + 140), "ÂM [ p ]: VÔ THANH", fill=PENCIL_RED, font=FONT_HEADING)
            draw.text((cx_text, inf_y + 205), "• Thanh quản: KHÔNG RUNG", fill=PENCIL_RED, font=FONT_BODY)
            draw.text((cx_text, inf_y + 260), "• Chỉ có luồng hơi bật ra!", fill=GRAPHITE, font=FONT_BODY)
            draw.text((cx_text, inf_y + 325), "• Độ rung dây thanh:", fill=GRAPHITE, font=FONT_BODY)
            draw.text((cx_text + 20, inf_y + 370), "[ 0% - MUTE ]", fill=PENCIL_RED, font=FONT_HEADING)
            draw.text((cx_text, inf_y + 450), "Từ mẫu: pen, happen", fill=PENCIL_BLUE, font=FONT_HEADING)

        else:
            draw.text((cx_text, inf_y + 140), "ÂM [ b ]: HỮU THANH", fill=PENCIL_BLUE, font=FONT_HEADING)
            draw.text((cx_text, inf_y + 205), "• Thanh quản: RUNG MẠNH", fill=PENCIL_BLUE, font=FONT_BODY)
            draw.text((cx_text, inf_y + 260), "• Tạo âm sắc ngân vang", fill=GRAPHITE, font=FONT_BODY)
            draw.text((cx_text, inf_y + 325), "• Độ rung dây thanh:", fill=GRAPHITE, font=FONT_BODY)
            draw.text((cx_text + 20, inf_y + 370), "[ 100% - ACTIVE ]", fill=PENCIL_BLUE, font=FONT_HEADING)
            draw.text((cx_text, inf_y + 450), "Từ mẫu: big, habit", fill=PENCIL_RED, font=FONT_HEADING)

    # 5. Bottom Subtitle Ribbon
    sub_w, sub_h = 1720, 140
    sx0, sy0 = (WIDTH - sub_w)//2, 890
    draw_sketch_rect(draw, (sx0, sy0, sx0 + sub_w, sy0 + sub_h), color=GRAPHITE, width=3, jitter_seed=boil_cycle+5)
    
    t_overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0,0,0,0))
    td = ImageDraw.Draw(t_overlay)
    td.rectangle((sx0+6, sy0+6, sx0+sub_w-6, sy0+sub_h-6), fill=(255, 255, 245, 235))
    canvas = Image.alpha_composite(canvas, t_overlay)
    draw = ImageDraw.Draw(canvas)

    tb_vi = draw.textbbox((0,0), sub_vi, font=FONT_SUB_VI)
    vi_w = tb_vi[2] - tb_vi[0]
    draw.text(((WIDTH - vi_w)//2, sy0 + 20), sub_vi, fill=GRAPHITE, font=FONT_SUB_VI)

    tb_en = draw.textbbox((0,0), sub_en, font=FONT_SUB_EN)
    en_w = tb_en[2] - tb_en[0]
    draw.text(((WIDTH - en_w)//2, sy0 + 75), sub_en, fill=(80, 80, 95), font=FONT_SUB_EN)

    final_frame = Image.alpha_composite(frame.convert("RGBA"), canvas).convert("RGB")
    return np.array(final_frame)[:, :, ::-1]

def render_option_c():
    print(f"=== Re-rendering Polished Option C ({TOTAL_FRAMES} frames) ===")
    paper_path = os.path.join(ASSET_DIR, "sketch_paper_texture_1789185260561.jpg")
    cutaway_path = os.path.join(ASSET_DIR, "sagittal_cutaway_sketch_1789185277220.jpg")

    base_paper = Image.open(paper_path).resize((WIDTH, HEIGHT))
    cutaway_img = Image.open(cutaway_path)

    # Pre-process cutaway into crisp transparent graphite sketch
    cut_w, cut_h = 460, 460
    cut_thumb = cutaway_img.resize((cut_w, cut_h)).convert('L')
    arr = np.array(cut_thumb)
    ink = 255.0 - arr.astype(np.float32)
    ink[ink < 25] = 0
    ink = np.clip(ink * 1.6, 0, 255).astype(np.uint8)
    rgba = np.zeros((cut_h, cut_w, 4), dtype=np.uint8)
    rgba[:, :, 0] = 35
    rgba[:, :, 1] = 35
    rgba[:, :, 2] = 40
    rgba[:, :, 3] = ink
    thumb_rgba = Image.fromarray(rgba)

    cap = cv2.VideoCapture(VIDEO_PATH)

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
        ret, frame_orig = cap.read()
        if not ret:
            break
        sketch_bgr = rotoscope_sketch_filter(frame_orig)
        final_bgr = render_frame_c(i, base_paper, sketch_bgr, thumb_rgba)
        proc.stdin.write(final_bgr.tobytes())

    cap.release()
    proc.stdin.close()
    proc.wait()
    print(f"Polished Option C rendered successfully to: {OUTPUT_PATH}")

if __name__ == "__main__":
    render_option_c()
