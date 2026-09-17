"""
scripts/render_option_a_whiteboard.py
Option A: Procedural Whiteboard / Hand-Drawn Doodle & Anatomical Sagittal Cutaways
- Textured paper canvas with subtle line-boil sketch jitter
- Hand-drawn progressive write-on sketches for [p] and [b]
- Anatomical sagittal cutaway diagram seamlessly multiply-blended onto parchment
- Dynamic air burst particles during unvoiced [p]
- Vibrating vocal cord acoustic ripples during voiced [b]
- Pristine Vietnamese Unicode rendering using Segoe UI Bold
"""

import os
import sys
import math
import random
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageChops, ImageFilter
from pydub import AudioSegment

WORK_DIR = os.path.abspath("workspace_rachel_voiceover")
ASSET_DIR = os.path.join(WORK_DIR, "mock_assets")
AUDIO_PATH = os.path.join(WORK_DIR, "audio_30s_preview.wav")
OUTPUT_PATH = os.path.join(WORK_DIR, "mock_option_a_whiteboard.mp4")

WIDTH = 1920
HEIGHT = 1080
FPS = 30
TOTAL_FRAMES = 900 # 30 seconds

# High-fidelity fonts with complete Vietnamese Unicode diacritics
FONT_TITLE = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 46)
FONT_HEADING = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 36)
FONT_BODY = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 28)
FONT_SUB_VI = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 32)
FONT_SUB_EN = ImageFont.truetype("C:/Windows/Fonts/segoeuii.ttf", 26)
FONT_IPA_BIG = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 95)
FONT_TAG = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 24)

# Colors (pencil/ink style)
GRAPHITE = (40, 42, 48)
PENCIL_RED = (205, 45, 35)
PENCIL_BLUE = (25, 100, 185)
PENCIL_YELLOW = (240, 180, 20)
PENCIL_GREEN = (35, 135, 70)

def get_line_boil_offset(frame_idx, seed=42):
    cycle = frame_idx // 3
    rng = random.Random(seed + cycle)
    return rng.randint(-2, 2), rng.randint(-2, 2)

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

def draw_sketch_circle(draw, center, radius, color=PENCIL_RED, width=3, jitter_seed=1):
    cx, cy = center
    rng = random.Random(jitter_seed)
    for _ in range(2):
        pts = []
        for a in range(0, 365, 15):
            rad = math.radians(a)
            r = radius + rng.uniform(-2.5, 2.5)
            pts.append((cx + r * math.cos(rad), cy + r * math.sin(rad)))
        draw.line(pts, fill=color, width=width)

def draw_sketch_arrow(draw, start, end, color=GRAPHITE, width=3, jitter_seed=1):
    sx, sy = start
    ex, ey = end
    rng = random.Random(jitter_seed)
    draw.line([(sx + rng.uniform(-1,1), sy + rng.uniform(-1,1)), 
               (ex + rng.uniform(-1,1), ey + rng.uniform(-1,1))], fill=color, width=width)
    angle = math.atan2(ey - sy, ex - sx)
    head_len = 16
    a1 = angle + math.pi * 0.85
    a2 = angle - math.pi * 0.85
    draw.line([(ex, ey), (ex + head_len*math.cos(a1), ey + head_len*math.sin(a1))], fill=color, width=width)
    draw.line([(ex, ey), (ex + head_len*math.cos(a2), ey + head_len*math.sin(a2))], fill=color, width=width)

def render_frame_a(frame_idx, base_paper, cutaway_img):
    t = frame_idx / FPS
    boil_cycle = frame_idx // 3
    bx, by = get_line_boil_offset(frame_idx, seed=101)

    frame = base_paper.copy()
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (255, 255, 255, 0))
    draw = ImageDraw.Draw(canvas)

    # 1. Top Header Banner
    banner_w, banner_h = 800, 80
    bx0, by0 = (WIDTH - banner_w)//2 + bx, 35 + by
    draw_sketch_rect(draw, (bx0, by0, bx0 + banner_w, by0 + banner_h), color=GRAPHITE, width=3, jitter_seed=boil_cycle)
    
    # Yellow highlighter
    highlighter = Image.new("RGBA", (WIDTH, HEIGHT), (0,0,0,0))
    h_draw = ImageDraw.Draw(highlighter)
    h_draw.rectangle((bx0+15, by0+15, bx0 + banner_w - 15, by0 + banner_h - 15), fill=(255, 235, 100, 110))
    canvas = Image.alpha_composite(canvas, highlighter)
    draw = ImageDraw.Draw(canvas)

    title_text = "ENGLISH PHONETICS: [p] & [b]"
    tb = draw.textbbox((0, 0), title_text, font=FONT_TITLE)
    tw = tb[2] - tb[0]
    draw.text(((WIDTH - tw)//2 + bx, by0 + 12 + by), title_text, fill=GRAPHITE, font=FONT_TITLE)

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

    # 3. Main Stage
    if t < 9.72:
        # Intro Cards
        c1_x, c1_y = 280 + bx, 170 + by
        draw_sketch_rect(draw, (c1_x, c1_y, c1_x + 600, c1_y + 490), color=GRAPHITE, width=3, jitter_seed=boil_cycle+1)
        draw.text((c1_x + 230, c1_y + 35), "[ p ]", fill=PENCIL_RED, font=FONT_IPA_BIG)
        draw.text((c1_x + 100, c1_y + 175), "UNVOICED (VÔ THANH)", fill=PENCIL_RED, font=FONT_HEADING)
        draw.text((c1_x + 80, c1_y + 250), "• Chỉ có luồng hơi thoát ra (Air Only)", fill=GRAPHITE, font=FONT_BODY)
        draw.text((c1_x + 80, c1_y + 310), "• Dây thanh quản: Không rung (0 Hz)", fill=GRAPHITE, font=FONT_BODY)
        draw.text((c1_x + 80, c1_y + 370), "• Ví dụ: pen, happen, map, stop", fill=PENCIL_BLUE, font=FONT_BODY)

        c2_x, c2_y = 1040 + bx, 170 + by
        draw_sketch_rect(draw, (c2_x, c2_y, c2_x + 600, c2_y + 490), color=GRAPHITE, width=3, jitter_seed=boil_cycle+2)
        draw.text((c2_x + 230, c2_y + 35), "[ b ]", fill=PENCIL_BLUE, font=FONT_IPA_BIG)
        draw.text((c2_x + 120, c2_y + 175), "VOICED (HỮU THANH)", fill=PENCIL_BLUE, font=FONT_HEADING)
        draw.text((c2_x + 80, c2_y + 250), "• Dây thanh quản rung mạnh trong cổ", fill=GRAPHITE, font=FONT_BODY)
        draw.text((c2_x + 80, c2_y + 310), "• Có âm vang trầm ngân nga", fill=GRAPHITE, font=FONT_BODY)
        draw.text((c2_x + 80, c2_y + 370), "• Ví dụ: big, habit, club, bring", fill=PENCIL_RED, font=FONT_BODY)

        conn_text = "= CÙNG KHẨU HÌNH MIỆNG (SAME POSITION) ="
        tb_c = draw.textbbox((0,0), conn_text, font=FONT_HEADING)
        cw = tb_c[2] - tb_c[0]
        draw.text(((WIDTH - cw)//2 + bx, 710 + by), conn_text, fill=GRAPHITE, font=FONT_HEADING)

    elif 9.72 <= t < 16.34:
        # Jingle Stage
        badge_w, badge_h = 1320, 520
        bg_x, bg_y = (WIDTH - badge_w)//2 + bx, 170 + by
        draw_sketch_rect(draw, (bg_x, bg_y, bg_x + badge_w, bg_y + badge_h), color=GRAPHITE, width=4, jitter_seed=boil_cycle)
        
        draw.text((bg_x + 170, bg_y + 40), "CƠ CHẾ PHÁT ÂM: PHỤ ÂM TẮC (BILABIAL STOPS)", fill=PENCIL_RED, font=FONT_HEADING)
        draw.line([(bg_x + 100, bg_y + 110), (bg_x + badge_w - 100, bg_y + 110)], fill=GRAPHITE, width=2)
        
        draw_sketch_circle(draw, (bg_x + 200, bg_y + 210), 45, color=PENCIL_BLUE, width=3, jitter_seed=boil_cycle)
        draw.text((bg_x + 188, bg_y + 185), "1", fill=PENCIL_BLUE, font=FONT_HEADING)
        draw.text((bg_x + 280, bg_y + 180), "GIAI ĐOẠN 1: CHẶN DÒNG KHÍ (OCCLUSION)", fill=GRAPHITE, font=FONT_HEADING)
        draw.text((bg_x + 280, bg_y + 235), "Hai môi mím chặt hoàn toàn, nén chặt dòng khí từ phổi.", fill=GRAPHITE, font=FONT_BODY)
        
        draw_sketch_circle(draw, (bg_x + 200, bg_y + 360), 45, color=PENCIL_GREEN, width=3, jitter_seed=boil_cycle+1)
        draw.text((bg_x + 188, bg_y + 335), "2", fill=PENCIL_GREEN, font=FONT_HEADING)
        draw.text((bg_x + 280, bg_y + 330), "GIAI ĐOẠN 2: BẬT NỔ RA NGOÀI (PLOSIVE RELEASE)", fill=GRAPHITE, font=FONT_HEADING)
        draw.text((bg_x + 280, bg_y + 385), "Môi mở tức thì để luồng khí thoát bùng nổ ra ngoài.", fill=GRAPHITE, font=FONT_BODY)

        draw.text((bg_x + 400, bg_y + 450), "★ KHÁM PHÁ CẮT LỚP GIẢI PHẪU MIỆNG BÊN TRONG ★", fill=PENCIL_YELLOW, font=FONT_HEADING)

    else:
        # Anatomical Stage: Multiply-blend cutaway onto frame
        cutaway_w, cutaway_h = 750, 750
        cx_pos = 1100 + bx
        cy_pos = 130 + by

        # Multiply blend cutaway directly onto parchment background
        cut_resized = cutaway_img.resize((cutaway_w, cutaway_h)).convert("RGB")
        # Create white backdrop of full size with cutaway in position
        cut_canvas = Image.new("RGB", (WIDTH, HEIGHT), (255, 255, 255))
        cut_canvas.paste(cut_resized, (cx_pos, cy_pos))
        frame = ImageChops.multiply(frame, cut_canvas)

        # Left Explanatory Panel
        panel_x, panel_y = 100 + bx, 150 + by
        draw_sketch_rect(draw, (panel_x, panel_y, panel_x + 940, panel_y + 680), color=GRAPHITE, width=3, jitter_seed=boil_cycle)

        if 16.34 <= t < 21.92:
            draw.text((panel_x + 50, panel_y + 40), "CÙNG MỘT KHẨU HÌNH MIỆNG", fill=PENCIL_RED, font=FONT_TITLE)
            draw.text((panel_x + 50, panel_y + 125), "• Hai bờ môi: Khép chặt hoàn toàn vào nhau", fill=GRAPHITE, font=FONT_HEADING)
            draw.text((panel_x + 50, panel_y + 190), "• Hai hàm răng: Hơi hé mở tự nhiên bên trong", fill=GRAPHITE, font=FONT_HEADING)
            draw.text((panel_x + 50, panel_y + 255), "• Vị trí của lưỡi: Thả lỏng, sẵn sàng cho âm kế tiếp", fill=GRAPHITE, font=FONT_HEADING)
            draw.text((panel_x + 50, panel_y + 320), "• Áp suất: Khí nén lại ngay sau hai bờ môi", fill=PENCIL_BLUE, font=FONT_HEADING)

            # Clean callout card inside left panel avoiding text lines
            callout_y = panel_y + 420
            draw_sketch_rect(draw, (panel_x + 50, callout_y, panel_x + 890, callout_y + 110), color=PENCIL_RED, width=2, jitter_seed=boil_cycle)
            draw.text((panel_x + 80, callout_y + 18), "TIÊU ĐIỂM GIẢI PHẪU: KHỚP NỐI HAI BỜ MÔI", fill=PENCIL_RED, font=FONT_HEADING)
            draw.text((panel_x + 80, callout_y + 62), "Quan sát vòng tròn chỉ thị trên thiết đồ cắt dọc bên phải.", fill=GRAPHITE, font=FONT_BODY)

            # Pointer to lips on cutaway (originates cleanly from callout box border)
            draw_sketch_circle(draw, (cx_pos + 195, cy_pos + 460), 65, color=PENCIL_RED, width=4, jitter_seed=boil_cycle)
            draw_sketch_arrow(draw, (panel_x + 890, callout_y + 55), (cx_pos + 130, cy_pos + 460), color=PENCIL_RED, width=3, jitter_seed=boil_cycle)
            draw.text((cx_pos + 270, cy_pos + 445), "HAI MÔI KHÉP CHẶT", fill=PENCIL_RED, font=FONT_TAG)

        elif 21.92 <= t < 28.90:
            draw.text((panel_x + 50, panel_y + 35), "ÂM [ p ]: VÔ THANH (UNVOICED)", fill=PENCIL_RED, font=FONT_TITLE)
            draw.text((panel_x + 50, panel_y + 115), "1. Luồng khí từ phổi dồn lên khoang miệng.", fill=GRAPHITE, font=FONT_BODY)
            draw.text((panel_x + 50, panel_y + 170), "2. Dây thanh quản MỞ HOÀN TOÀN - Không rung!", fill=PENCIL_RED, font=FONT_HEADING)
            draw.text((panel_x + 50, panel_y + 235), "3. Khi môi bật mở: Luồng hơi thoát mạnh ra: [ p ]!", fill=GRAPHITE, font=FONT_BODY)
            draw.text((panel_x + 50, panel_y + 295), "4. Đặt tay trước miệng: Cảm nhận luồng gió thổi mát!", fill=PENCIL_BLUE, font=FONT_BODY)

            # Clean callout card inside left panel
            callout_y = panel_y + 420
            draw_sketch_rect(draw, (panel_x + 50, callout_y, panel_x + 890, callout_y + 120), color=PENCIL_BLUE, width=2, jitter_seed=boil_cycle)
            draw.text((panel_x + 80, callout_y + 20), "ĐẶC TRƯNG ÂM BẬT [p]: KHÔNG RUNG THANH QUẢN", fill=PENCIL_BLUE, font=FONT_HEADING)
            draw.text((panel_x + 80, callout_y + 68), "Toàn bộ áp suất khí dồn lên môi và bùng nổ tức thì.", fill=GRAPHITE, font=FONT_BODY)

            # Air burst visual
            draw_sketch_circle(draw, (cx_pos + 195, cy_pos + 460), 55, color=PENCIL_BLUE, width=3, jitter_seed=boil_cycle)
            rng_p = random.Random(boil_cycle + 88)
            for _ in range(18):
                p_len = rng_p.uniform(40, 160)
                angle = rng_p.uniform(-math.pi*0.25, math.pi*0.25)
                px0 = cx_pos + 150
                py0 = cy_pos + 460
                px1 = px0 - p_len * math.cos(angle)
                py1 = py0 + p_len * math.sin(angle)
                draw.line([(px0, py0), (px1, py1)], fill=PENCIL_BLUE, width=2)
                draw.ellipse((px1-4, py1-4, px1+4, py1+4), fill=PENCIL_BLUE)

            # Air burst label with pill backing to avoid border clipping
            bt_text = "LUỒNG HƠI BẬT RA!"
            tb_bt = draw.textbbox((0, 0), bt_text, font=FONT_TAG)
            bt_w = tb_bt[2] - tb_bt[0]
            bt_x = cx_pos - 80
            bt_y = cy_pos + 360
            draw.rectangle((bt_x - 10, bt_y - 4, bt_x + bt_w + 10, bt_y + 26), fill=(255, 255, 250, 240), outline=PENCIL_BLUE, width=2)
            draw.text((bt_x, bt_y), bt_text, fill=PENCIL_BLUE, font=FONT_TAG)

            # Vocal cords label and clean arrow originating from callout card
            draw_sketch_circle(draw, (cx_pos + 380, cy_pos + 620), 45, color=PENCIL_RED, width=3, jitter_seed=boil_cycle)
            draw_sketch_arrow(draw, (panel_x + 890, callout_y + 60), (cx_pos + 330, cy_pos + 620), color=PENCIL_RED, width=3, jitter_seed=boil_cycle)
            
            th_text = "THANH QUẢN: KHÔNG RUNG (0 Hz)"
            tb_th = draw.textbbox((0, 0), th_text, font=FONT_TAG)
            th_w = tb_th[2] - tb_th[0]
            th_x = cx_pos + (cutaway_w - th_w)//2
            th_y = cy_pos + 680
            draw.rectangle((th_x - 12, th_y - 4, th_x + th_w + 12, th_y + 26), fill=(255, 255, 250, 240), outline=PENCIL_RED, width=2)
            draw.text((th_x, th_y), th_text, fill=PENCIL_RED, font=FONT_TAG)

        else:
            draw.text((panel_x + 50, panel_y + 35), "ÂM [ b ]: HỮU THANH (VOICED)", fill=PENCIL_BLUE, font=FONT_TITLE)
            draw.text((panel_x + 50, panel_y + 115), "1. Khẩu hình môi hoàn toàn giống âm [p].", fill=GRAPHITE, font=FONT_BODY)
            draw.text((panel_x + 50, panel_y + 170), "2. DÂY THANH QUẢN RUNG MẠNH TẠO TIẾNG!", fill=PENCIL_BLUE, font=FONT_HEADING)
            draw.text((panel_x + 50, panel_y + 235), "3. Khi Rachel phát âm [bb], cổ họng ngân rung trầm ấm.", fill=GRAPHITE, font=FONT_BODY)
            draw.text((panel_x + 50, panel_y + 295), "4. Đặt tay lên cổ họng: Cảm nhận rõ độ rung cơ học!", fill=PENCIL_RED, font=FONT_BODY)

            # Clean callout card inside left panel
            callout_y = panel_y + 420
            draw_sketch_rect(draw, (panel_x + 50, callout_y, panel_x + 890, callout_y + 120), color=PENCIL_BLUE, width=2, jitter_seed=boil_cycle)
            draw.text((panel_x + 80, callout_y + 20), "ĐẶC TRƯNG ÂM RUNG [b]: DÂY THANH HOẠT ĐỘNG", fill=PENCIL_BLUE, font=FONT_HEADING)
            draw.text((panel_x + 80, callout_y + 68), "Cổ họng rung mạnh tạo tần số âm thanh khi môi mở.", fill=GRAPHITE, font=FONT_BODY)

            lx, ly = cx_pos + 380, cy_pos + 620
            draw_sketch_circle(draw, (lx, ly), 50, color=PENCIL_BLUE, width=4, jitter_seed=boil_cycle)
            for ring_r in [75, 105, 135, 165]:
                draw_sketch_circle(draw, (lx, ly), ring_r, color=(35, 110, 190), width=2, jitter_seed=boil_cycle + ring_r)
            
            draw_sketch_arrow(draw, (panel_x + 890, callout_y + 60), (lx - 55, ly), color=PENCIL_BLUE, width=3, jitter_seed=boil_cycle)
            
            vb_text = "DÂY THANH RUNG LÊN (VOICED)!"
            tb_vb = draw.textbbox((0, 0), vb_text, font=FONT_HEADING)
            vb_w = tb_vb[2] - tb_vb[0]
            vb_x = cx_pos + (cutaway_w - vb_w)//2
            vb_y = cy_pos + 680
            draw.rectangle((vb_x - 14, vb_y - 6, vb_x + vb_w + 14, vb_y + 34), fill=(255, 255, 250, 245), outline=PENCIL_BLUE, width=2)
            draw.text((vb_x, vb_y), vb_text, fill=PENCIL_BLUE, font=FONT_HEADING)

    # 4. Bottom Subtitle Ribbon
    sub_w, sub_h = 1720, 140
    sx0, sy0 = (WIDTH - sub_w)//2 + bx, 890 + by
    draw_sketch_rect(draw, (sx0, sy0, sx0 + sub_w, sy0 + sub_h), color=GRAPHITE, width=3, jitter_seed=boil_cycle+5)
    
    tape_overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0,0,0,0))
    t_draw = ImageDraw.Draw(tape_overlay)
    t_draw.rectangle((sx0+6, sy0+6, sx0+sub_w-6, sy0+sub_h-6), fill=(255, 255, 245, 235))
    canvas = Image.alpha_composite(canvas, tape_overlay)
    draw = ImageDraw.Draw(canvas)

    tb_vi = draw.textbbox((0,0), sub_vi, font=FONT_SUB_VI)
    vi_w = tb_vi[2] - tb_vi[0]
    draw.text(((WIDTH - vi_w)//2 + bx, sy0 + 20 + by), sub_vi, fill=GRAPHITE, font=FONT_SUB_VI)

    tb_en = draw.textbbox((0,0), sub_en, font=FONT_SUB_EN)
    en_w = tb_en[2] - tb_en[0]
    draw.text(((WIDTH - en_w)//2 + bx, sy0 + 75 + by), sub_en, fill=(80, 80, 95), font=FONT_SUB_EN)

    final_frame = Image.alpha_composite(frame.convert("RGBA"), canvas).convert("RGB")
    return np.array(final_frame)[:, :, ::-1]

def render_option_a():
    print(f"=== Re-rendering Polished Option A ({TOTAL_FRAMES} frames) ===")
    paper_path = os.path.join(ASSET_DIR, "sketch_paper_texture_1789185260561.jpg")
    cutaway_path = os.path.join(ASSET_DIR, "sagittal_cutaway_sketch_1789185277220.jpg")
    
    base_paper = Image.open(paper_path).resize((WIDTH, HEIGHT))
    cutaway_img = Image.open(cutaway_path)

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
        frame_bgr = render_frame_a(i, base_paper, cutaway_img)
        proc.stdin.write(frame_bgr.tobytes())

    proc.stdin.close()
    proc.wait()
    print(f"Polished Option A rendered successfully to: {OUTPUT_PATH}")

if __name__ == "__main__":
    render_option_a()
