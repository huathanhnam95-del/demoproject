"""
scripts/render_option_b_cartoon_avatar.py
Option B: 2D Cartoon Teacher Avatar with Synchronized Visemes & Gestures
- Isolated custom 2D teacher character (Ms. Eleanor Vance)
- Pose 1 (0-16.3s): Welcoming pose gesturing towards whiteboard
- Pose 2 (16.3-30s): Articulatory demonstration pointing to mouth & lips
- Audio-reactive mouth viseme synchronization (idle smile, open vowels, bilabial compression)
- Natural breathing motion and organic eye blinking
- Dynamic educational whiteboard display synced with pedagogical phases
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
OUTPUT_PATH = os.path.join(WORK_DIR, "mock_option_b_cartoon_avatar.mp4")

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
FONT_TAG = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 24)

GRAPHITE = (40, 42, 48)
PENCIL_RED = (205, 45, 35)
PENCIL_BLUE = (25, 100, 185)
PENCIL_YELLOW = (240, 180, 20)
PENCIL_GREEN = (35, 135, 70)

def build_rms_map(audio_path, total_frames, fps):
    audio = AudioSegment.from_file(audio_path)
    samples = np.array(audio.get_array_of_samples())
    if audio.channels == 2:
        samples = samples.reshape((-1, 2)).mean(axis=1)
    rate = audio.frame_rate
    frame_samples = int(rate / fps)
    rms_map = []
    for i in range(total_frames):
        start = i * frame_samples
        end = min(len(samples), (i + 1) * frame_samples)
        chunk = samples[start:end]
        if len(chunk) > 0:
            rms = np.sqrt(np.mean(chunk**2))
        else:
            rms = 0.0
        rms_map.append(rms)
    max_rms = max(rms_map) if max(rms_map) > 0 else 1.0
    return [r / max_rms for r in rms_map]

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

def render_frame_b(frame_idx, base_paper, sprites, norm_rms_map):
    t = frame_idx / FPS
    boil_cycle = frame_idx // 3
    rms = norm_rms_map[frame_idx]

    frame = base_paper.copy()
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (255, 255, 255, 0))
    draw = ImageDraw.Draw(canvas)

    # 1. Top Header
    header_w, header_h = 1050, 75
    hx, hy = (WIDTH - header_w)//2, 30
    draw_sketch_rect(draw, (hx, hy, hx + header_w, hy + header_h), color=GRAPHITE, width=3, jitter_seed=boil_cycle)
    
    hl = Image.new("RGBA", (WIDTH, HEIGHT), (0,0,0,0))
    h_draw = ImageDraw.Draw(hl)
    h_draw.rectangle((hx+10, hy+10, hx+header_w-10, hy+header_h-10), fill=(255, 230, 100, 100))
    canvas = Image.alpha_composite(canvas, hl)
    draw = ImageDraw.Draw(canvas)

    htext = "2D CARTOON CLASSROOM: MS. ELEANOR VANCE"
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

    # 3. Left Side: Teacher Character
    breathe_y = int(math.sin(t * 3.5) * 5)
    
    is_bilabial_moment = (23.3 <= t <= 24.3) or (28.8 <= t <= 29.8) or (16.34 <= t <= 21.92 and rms <= 0.12)
    
    if t < 16.34:
        sprite = sprites["clean"]
        target_w, target_h = 580, 770
        char_base_x = 100
        char_base_y = 120 + breathe_y
        mouth_x = char_base_x + int(target_w * 0.44)
        mouth_y = char_base_y + int(target_h * 0.235)
    else:
        # Use closed mouth sprite during bilabial closure / low RMS; use open sprite during active speech
        if is_bilabial_moment or rms <= 0.12:
            sprite = sprites["point_closed"]
        else:
            sprite = sprites["point"]
        target_w, target_h = 580, 770
        char_base_x = 120
        char_base_y = 120 + breathe_y
        mouth_x = char_base_x + int(target_w * 0.505)
        mouth_y = char_base_y + int(target_h * 0.325)

    sprite_scaled = sprite.resize((target_w, target_h), Image.Resampling.LANCZOS)
    canvas.paste(sprite_scaled, (char_base_x, char_base_y), sprite_scaled)

    # Eye blink
    if (t % 3.5) < 0.16:
        eye_y = mouth_y - 32
        draw.arc((mouth_x - 30, eye_y - 8, mouth_x - 10, eye_y + 8), start=190, end=350, fill=GRAPHITE, width=3)
        draw.arc((mouth_x + 8, eye_y - 8, mouth_x + 28, eye_y + 8), start=190, end=350, fill=GRAPHITE, width=3)

    # Viseme lips and callout
    if is_bilabial_moment and t >= 16.34:
        # Polite callout badge to the right of her face pointing cleanly to lips
        badge_x, badge_y = char_base_x + int(target_w * 0.70), mouth_y - 25
        draw_sketch_rect(draw, (badge_x, badge_y, badge_x + 195, badge_y + 55), color=PENCIL_RED, width=2, jitter_seed=boil_cycle)
        draw.rectangle((badge_x + 3, badge_y + 3, badge_x + 192, badge_y + 52), fill=(255, 240, 240, 230))
        draw.text((badge_x + 16, badge_y + 14), "MÍM CHẶT MÔI", fill=PENCIL_RED, font=FONT_TAG)
        draw.line([(badge_x, badge_y + 27), (mouth_x + 24, mouth_y)], fill=PENCIL_RED, width=2)
    elif rms > 0.18:
        open_h = min(14, int(rms * 18))
        open_w = 12 + int(rms * 8)
        draw.ellipse((mouth_x - open_w//2, mouth_y - open_h//2, mouth_x + open_w//2, mouth_y + open_h//2), fill=(160, 40, 40))
        draw.rectangle((mouth_x - open_w//2 + 2, mouth_y - open_h//2, mouth_x + open_w//2 - 2, mouth_y - open_h//2 + 3), fill=(245, 245, 240))
        draw.arc((mouth_x - open_w//2, mouth_y - open_h//2, mouth_x + open_w//2, mouth_y + open_h//2), 0, 360, fill=GRAPHITE, width=2)

    # 4. Right Side: Interactive Classroom Whiteboard
    wb_x, wb_y = 740, 140
    wb_w, wb_h = 1100, 720
    draw_sketch_rect(draw, (wb_x, wb_y, wb_x + wb_w, wb_y + wb_h), color=GRAPHITE, width=4, jitter_seed=boil_cycle)
    
    wb_fill = Image.new("RGBA", (WIDTH, HEIGHT), (0,0,0,0))
    wb_draw = ImageDraw.Draw(wb_fill)
    wb_draw.rectangle((wb_x+6, wb_y+6, wb_x+wb_w-6, wb_y+wb_h-6), fill=(255, 255, 252, 235))
    canvas = Image.alpha_composite(canvas, wb_fill)
    draw = ImageDraw.Draw(canvas)

    if t < 9.72:
        draw.text((wb_x + 180, wb_y + 40), "CẶP PHỤ ÂM TỰ NHIÊN: [p] & [b]", fill=PENCIL_RED, font=FONT_TITLE)
        draw.line([(wb_x + 80, wb_y + 115), (wb_x + wb_w - 80, wb_y + 115)], fill=GRAPHITE, width=2)

        # Card P
        c1_x, c1_y = wb_x + 50, wb_y + 150
        c_w, c_h = 470, 470
        draw_sketch_rect(draw, (c1_x, c1_y, c1_x + c_w, c1_y + c_h), color=PENCIL_RED, width=3, jitter_seed=boil_cycle)
        tb_p = draw.textbbox((0, 0), "[ p ]", font=FONT_IPA_BIG)
        tw_p = tb_p[2] - tb_p[0]
        draw.text((c1_x + (c_w - tw_p)//2, c1_y + 25), "[ p ]", fill=PENCIL_RED, font=FONT_IPA_BIG)
        
        p_hdr = "UNVOICED (VÔ THANH)"
        tb_ph = draw.textbbox((0, 0), p_hdr, font=FONT_HEADING)
        tw_ph = tb_ph[2] - tb_ph[0]
        draw.text((c1_x + (c_w - tw_ph)//2, c1_y + 160), p_hdr, fill=PENCIL_RED, font=FONT_HEADING)
        draw.text((c1_x + 40, c1_y + 235), "• Chỉ phát ra luồng hơi (Air Only)", fill=GRAPHITE, font=FONT_BODY)
        draw.text((c1_x + 40, c1_y + 290), "• Thanh quản: Nghỉ ngơi (0 Hz)", fill=GRAPHITE, font=FONT_BODY)
        draw.text((c1_x + 40, c1_y + 345), "• pen / happen / top / cap", fill=PENCIL_BLUE, font=FONT_BODY)

        # Card B
        c2_x, c2_y = wb_x + 580, wb_y + 150
        draw_sketch_rect(draw, (c2_x, c2_y, c2_x + c_w, c2_y + c_h), color=PENCIL_BLUE, width=3, jitter_seed=boil_cycle+1)
        tb_b = draw.textbbox((0, 0), "[ b ]", font=FONT_IPA_BIG)
        tw_b = tb_b[2] - tb_b[0]
        draw.text((c2_x + (c_w - tw_b)//2, c2_y + 25), "[ b ]", fill=PENCIL_BLUE, font=FONT_IPA_BIG)
        
        b_hdr = "VOICED (HỮU THANH)"
        tb_bh = draw.textbbox((0, 0), b_hdr, font=FONT_HEADING)
        tw_bh = tb_bh[2] - tb_bh[0]
        draw.text((c2_x + (c_w - tw_bh)//2, c2_y + 160), b_hdr, fill=PENCIL_BLUE, font=FONT_HEADING)
        draw.text((c2_x + 40, c2_y + 235), "• Dây thanh quản rung ngân vang", fill=GRAPHITE, font=FONT_BODY)
        draw.text((c2_x + 40, c2_y + 290), "• Có âm sắc ấm áp trong họng", fill=GRAPHITE, font=FONT_BODY)
        draw.text((c2_x + 40, c2_y + 345), "• big / habit / club / bring", fill=PENCIL_RED, font=FONT_BODY)

    elif 9.72 <= t < 16.34:
        draw.text((wb_x + 130, wb_y + 40), "CƠ CHẾ: PHỤ ÂM TẮC HAI MÔI (BILABIAL)", fill=PENCIL_BLUE, font=FONT_TITLE)
        draw.line([(wb_x + 80, wb_y + 115), (wb_x + wb_w - 80, wb_y + 115)], fill=GRAPHITE, width=2)

        draw.text((wb_x + 80, wb_y + 160), "1. TẠI SAO GỌI LÀ CẶP ÂM ĐI CHUNG?", fill=GRAPHITE, font=FONT_HEADING)
        draw.text((wb_x + 120, wb_y + 220), "→ Cả hai âm đều dùng chung 100% khẩu hình miệng.", fill=PENCIL_RED, font=FONT_BODY)
        draw.text((wb_x + 120, wb_y + 270), "→ Hai môi khép chặt để chặn kín dòng khí từ phổi.", fill=GRAPHITE, font=FONT_BODY)

        draw.text((wb_x + 80, wb_y + 350), "2. ĐIỂM KHÁC BIỆT DUY NHẤT LÀ GÌ?", fill=GRAPHITE, font=FONT_HEADING)
        draw.text((wb_x + 120, wb_y + 410), "→ Âm [p]: Dây thanh quản mở, chỉ có luồng khí nổ ra.", fill=PENCIL_RED, font=FONT_BODY)
        draw.text((wb_x + 120, wb_y + 460), "→ Âm [b]: Dây thanh quản rung tạo ra tần số âm thanh.", fill=PENCIL_BLUE, font=FONT_BODY)

        badge_w = 940
        bx_sub = wb_x + 80
        draw_sketch_rect(draw, (bx_sub, wb_y + 540, bx_sub + badge_w, wb_y + 640), color=PENCIL_YELLOW, width=3, jitter_seed=boil_cycle)
        draw.text((bx_sub + 90, wb_y + 575), "QUAN SÁT CỰ LY GẦN CỦA CÔ GIÁO MS. ELEANOR", fill=GRAPHITE, font=FONT_HEADING)

    elif 16.34 <= t < 21.92:
        draw.text((wb_x + 140, wb_y + 40), "GIAI ĐOẠN 1: CÙNG KHẨU HÌNH MIỆNG", fill=PENCIL_RED, font=FONT_TITLE)
        draw.line([(wb_x + 80, wb_y + 115), (wb_x + wb_w - 80, wb_y + 115)], fill=GRAPHITE, width=2)

        draw.text((wb_x + 80, wb_y + 160), "• Vị trí môi: Hai môi mím chặt hoàn toàn vào nhau.", fill=GRAPHITE, font=FONT_HEADING)
        draw.text((wb_x + 80, wb_y + 230), "• Răng: Hai hàm răng hơi hé mở bên trong.", fill=GRAPHITE, font=FONT_BODY)
        draw.text((wb_x + 80, wb_y + 290), "• Lưỡi: Thả lỏng tự nhiên dưới sàn miệng.", fill=GRAPHITE, font=FONT_BODY)
        draw.text((wb_x + 80, wb_y + 350), "• Luồng khí: Bị nén lại ngay phía sau hai bờ môi.", fill=PENCIL_BLUE, font=FONT_BODY)

        lip_draw_x, lip_draw_y = wb_x + 330, wb_y + 440
        lip_box_w, lip_box_h = 440, 190
        draw_sketch_rect(draw, (lip_draw_x, lip_draw_y, lip_draw_x + lip_box_w, lip_draw_y + lip_box_h), color=PENCIL_RED, width=3, jitter_seed=boil_cycle)
        
        lh_text = "KHẨU HÌNH [p] & [b]"
        tb_lh = draw.textbbox((0, 0), lh_text, font=FONT_HEADING)
        tw_lh = tb_lh[2] - tb_lh[0]
        draw.text((lip_draw_x + (lip_box_w - tw_lh)//2, lip_draw_y + 25), lh_text, fill=PENCIL_RED, font=FONT_HEADING)
        
        l1_text = "Hai môi khép kín 100%"
        tb_l1 = draw.textbbox((0, 0), l1_text, font=FONT_BODY)
        tw_l1 = tb_l1[2] - tb_l1[0]
        draw.text((lip_draw_x + (lip_box_w - tw_l1)//2, lip_draw_y + 85), l1_text, fill=GRAPHITE, font=FONT_BODY)
        
        l2_text = "(Same Lip Position)"
        tb_l2 = draw.textbbox((0, 0), l2_text, font=FONT_BODY)
        tw_l2 = tb_l2[2] - tb_l2[0]
        draw.text((lip_draw_x + (lip_box_w - tw_l2)//2, lip_draw_y + 130), l2_text, fill=PENCIL_BLUE, font=FONT_BODY)

    elif 21.92 <= t < 28.90:
        draw.text((wb_x + 110, wb_y + 40), "ÂM [ p ]: VÔ THANH - CHỈ CÓ LUỒNG HƠI", fill=PENCIL_RED, font=FONT_TITLE)
        draw.line([(wb_x + 80, wb_y + 115), (wb_x + wb_w - 80, wb_y + 115)], fill=GRAPHITE, width=2)

        draw.text((wb_x + 80, wb_y + 150), "• Dây thanh quản: KHÔNG RUNG (0 Hz)", fill=PENCIL_RED, font=FONT_HEADING)
        draw.text((wb_x + 80, wb_y + 210), "• Hãy đặt tay lên cổ họng: Không có cảm giác rung!", fill=GRAPHITE, font=FONT_BODY)
        draw.text((wb_x + 80, wb_y + 260), "• Khi bật môi mở ra: Tạo ra một luồng khí nổ nhẹ: [ p ]", fill=GRAPHITE, font=FONT_BODY)

        m_x, m_y = wb_x + 80, wb_y + 350
        meter_w = 640
        draw.text((m_x, m_y), "Mức độ rung cổ họng (Vocal Cord Activity):", fill=GRAPHITE, font=FONT_BODY)
        draw_sketch_rect(draw, (m_x, m_y + 40, m_x + meter_w, m_y + 90), color=PENCIL_RED, width=3, jitter_seed=boil_cycle)
        draw.rectangle((m_x + 4, m_y + 44, m_x + meter_w - 4, m_y + 86), fill=(255, 235, 235))
        m_text = "[ TẮT / KHÔNG RUNG: 0% ]"
        tb_m = draw.textbbox((0, 0), m_text, font=FONT_HEADING)
        tw_m = tb_m[2] - tb_m[0]
        draw.text((m_x + (meter_w - tw_m)//2, m_y + 48), m_text, fill=PENCIL_RED, font=FONT_HEADING)

        draw.text((wb_x + 80, wb_y + 480), "Ví dụ thực hành từ vựng:", fill=PENCIL_BLUE, font=FONT_HEADING)
        draw.text((wb_x + 120, wb_y + 540), "• Pen  /pen/  (Cái bút)", fill=GRAPHITE, font=FONT_BODY)
        draw.text((wb_x + 120, wb_y + 590), "• Happen  /ˈhæp.ən/  (Xảy ra)", fill=GRAPHITE, font=FONT_BODY)
        draw.text((wb_x + 120, wb_y + 640), "• Stop  /stɑːp/  (Dừng lại)", fill=GRAPHITE, font=FONT_BODY)

    else:
        draw.text((wb_x + 110, wb_y + 40), "ÂM [ b ]: HỮU THANH - CỔ HỌNG RUNG LÊN", fill=PENCIL_BLUE, font=FONT_TITLE)
        draw.line([(wb_x + 80, wb_y + 115), (wb_x + wb_w - 80, wb_y + 115)], fill=GRAPHITE, width=2)

        draw.text((wb_x + 80, wb_y + 150), "• Dây thanh quản: RUNG MẠNH MẼ (ACTIVE)", fill=PENCIL_BLUE, font=FONT_HEADING)
        draw.text((wb_x + 80, wb_y + 210), "• Đặt tay lên cổ họng: Cảm nhận rõ độ rung và âm vang!", fill=GRAPHITE, font=FONT_BODY)
        draw.text((wb_x + 80, wb_y + 260), "• Giữ nguyên khẩu hình môi, thêm giọng nói: [ b ]", fill=GRAPHITE, font=FONT_BODY)

        m_x, m_y = wb_x + 80, wb_y + 350
        meter_w = 640
        draw.text((m_x, m_y), "Mức độ rung cổ họng (Vocal Cord Activity):", fill=GRAPHITE, font=FONT_BODY)
        draw_sketch_rect(draw, (m_x, m_y + 40, m_x + meter_w, m_y + 90), color=PENCIL_BLUE, width=3, jitter_seed=boil_cycle)
        draw.rectangle((m_x + 4, m_y + 44, m_x + meter_w - 4, m_y + 86), fill=(215, 235, 255))
        m_text = "[ BẬT / RUNG ĐỘNG: 100% ]"
        tb_m = draw.textbbox((0, 0), m_text, font=FONT_HEADING)
        tw_m = tb_m[2] - tb_m[0]
        draw.text((m_x + (meter_w - tw_m)//2, m_y + 48), m_text, fill=PENCIL_BLUE, font=FONT_HEADING)

        draw.text((wb_x + 80, wb_y + 480), "Ví dụ thực hành từ vựng:", fill=PENCIL_RED, font=FONT_HEADING)
        draw.text((wb_x + 120, wb_y + 540), "• Big  /bɪɡ/  (To lớn)", fill=GRAPHITE, font=FONT_BODY)
        draw.text((wb_x + 120, wb_y + 590), "• Habit  /ˈhæb.ɪt/  (Thói quen)", fill=GRAPHITE, font=FONT_BODY)
        draw.text((wb_x + 120, wb_y + 640), "• Club  /klʌb/  (Câu lạc bộ)", fill=GRAPHITE, font=FONT_BODY)

    # 5. Bottom Subtitle Banner
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

def render_option_b():
    print(f"=== Re-rendering Polished Option B ({TOTAL_FRAMES} frames) ===")
    paper_path = os.path.join(ASSET_DIR, "sketch_paper_texture_1789185260561.jpg")
    base_paper = Image.open(paper_path).resize((WIDTH, HEIGHT))

    sprites = {
        "clean": Image.open(os.path.join(ASSET_DIR, "teacher_clean_trans.png")),
        "point": Image.open(os.path.join(ASSET_DIR, "teacher_point_trans.png")),
        "point_closed": Image.open(os.path.join(ASSET_DIR, "teacher_point_closed.png")),
    }

    norm_rms_map = build_rms_map(AUDIO_PATH, TOTAL_FRAMES, FPS)

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
        frame_bgr = render_frame_b(i, base_paper, sprites, norm_rms_map)
        proc.stdin.write(frame_bgr.tobytes())

    proc.stdin.close()
    proc.wait()
    print(f"Polished Option B rendered successfully to: {OUTPUT_PATH}")

if __name__ == "__main__":
    render_option_b()
