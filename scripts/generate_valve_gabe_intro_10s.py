"""
Production Master Generator: 10s Valve & Gabe Newell Narrative Intro Video
==========================================================================
Deliverable: exported_slides/valve_gabe_intro_10s.mp4
Specifications:
  - Resolution: 1920x1080 (1080p Full HD)
  - Frame rate: 30.0 fps (exactly 300 frames)
  - Total Duration: 10.000 seconds
  - Video Codec: libx264 (CRF 17, preset slow, yuv420p)
  - Audio Codec: AAC stereo 256kbps @ 48kHz
  - A/V Sync: Sample-accurate synchronization

Visual Flow:
  - 0.0s - 0.5s: Fade in from black, ambient audio swell
  - 0.0s - 4.7s: Shot 1 - Authentic Gabe Newell portrait with lower-third founder card (0.5s - 3.9s)
  - 4.0s - 4.7s: Cinematic 700ms quintic cross-dissolve from Gabe to Veo open office
  - 4.0s - 10.0s: Shot 2 - Google Veo 3.1 B-roll clip of Valve open studio with wheeled desks (full 6.0s 1:1 speed)
  - 4.7s - 9.4s: True frosted glass kinetic title card "VALVE • THE FLATLAND EXPERIMENT / Gabe Newell"
  - 9.4s - 10.0s: Smooth fade to black
"""

import os
import sys
import time
import subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

PROJECT_ROOT = Path(r"C:\Cursor AI")
OUT_DIR = PROJECT_ROOT / "exported_slides"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MASTER_VIDEO_PATH = OUT_DIR / "valve_gabe_intro_10s.mp4"
MASTER_AUDIO_PATH = OUT_DIR / "valve_gabe_intro_audio_10s.wav"
KEYFRAMES_DIR = OUT_DIR / "preview_keyframes"
KEYFRAMES_DIR.mkdir(parents=True, exist_ok=True)

WIDTH, HEIGHT = 1920, 1080
FPS = 30.0
TOTAL_SECONDS = 10.0
TOTAL_FRAMES = int(round(FPS * TOTAL_SECONDS))  # Exactly 300 frames

FONTS_DIR = Path(r"C:\Windows\Fonts")
FONT_BOLD = str(FONTS_DIR / "segoeuib.ttf")
FONT_REG = str(FONTS_DIR / "segoeui.ttf")
FONT_SEMIBOLD = str(FONTS_DIR / "segoeuisl.ttf")

def smootherstep(t):
    """Ken Perlin's quintic smootherstep with zero 1st & 2nd derivatives at endpoints."""
    t = float(np.clip(t, 0.0, 1.0))
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)

def find_input_videos():
    """Discover available source video assets with automatic fallbacks."""
    # Shot 1: Gabe Newell footage
    shot1_candidates = [
        PROJECT_ROOT / "output" / "veo_broll" / "gabe_shot1_1080p.mp4",
        PROJECT_ROOT / "assets" / "speaker_portraits" / "gabe_4k_closing.mp4",
    ]
    shot1_path = next((p for p in shot1_candidates if p.exists()), None)
    if not shot1_path:
        raise FileNotFoundError(f"No Gabe footage found. Checked: {[str(p) for p in shot1_candidates]}")
        
    # Shot 2: Veo B-roll footage
    shot2_candidates = [
        PROJECT_ROOT / "output" / "veo_broll" / "valve_open_office_6s.mp4",
        PROJECT_ROOT / "output" / "veo_broll" / "veo_shot2_1080p.mp4",
    ]
    shot2_path = next((p for p in shot2_candidates if p.exists()), None)
    if not shot2_path:
        raise FileNotFoundError(f"No Veo B-roll clip found. Checked: {[str(p) for p in shot2_candidates]}")
        
    return shot1_path, shot2_path

def load_shot1_frames(video_path, max_duration=5.0):
    """
    Load frames for Shot 1 (Gabe Newell).
    Downscales to 1080p immediately on ingest to prevent OOM when loading 4K source.
    """
    cap = cv2.VideoCapture(str(video_path))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    max_frames = int(max_duration * src_fps)
    frames_1080p = []
    
    print(f"Loading Shot 1 frames from {video_path.name} (src_fps={src_fps:.2f})...")
    frame_count = 0
    while frame_count < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        h, w, _ = frame.shape
        if (w, h) != (WIDTH, HEIGHT):
            target_w = int(h * 16 / 9)
            if target_w <= w:
                x_start = (w - target_w) // 2
                frame_cropped = frame[:, x_start:x_start + target_w]
            else:
                target_h = int(w * 9 / 16)
                y_start = (h - target_h) // 2
                frame_cropped = frame[y_start:y_start + target_h, :]
            frame_resized = cv2.resize(frame_cropped, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)
        else:
            frame_resized = frame
            
        frames_1080p.append(frame_resized)
        frame_count += 1
        
    cap.release()
    print(f"  Loaded {len(frames_1080p)} frames for Shot 1 ({len(frames_1080p)/src_fps:.2f}s).")
    return frames_1080p, src_fps

def load_shot2_frames(video_path):
    """
    Load frames for Shot 2 (Veo B-roll).
    Upscales to 1080p using high-quality Lanczos4 interpolation if source is 720p.
    """
    cap = cv2.VideoCapture(str(video_path))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frames_1080p = []
    
    print(f"Loading Shot 2 frames from {video_path.name} (src_fps={src_fps:.2f})...")
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        h, w, _ = frame.shape
        if (w, h) != (WIDTH, HEIGHT):
            frame_resized = cv2.resize(frame, (WIDTH, HEIGHT), interpolation=cv2.INTER_LANCZOS4)
        else:
            frame_resized = frame
        frames_1080p.append(frame_resized)
        
    cap.release()
    print(f"  Loaded {len(frames_1080p)} frames for Shot 2 ({len(frames_1080p)/src_fps:.2f}s).")
    return frames_1080p, src_fps

def build_lower_third_overlay(card_w=700, card_h=140, radius=14):
    """Render crisp RGBA graphic overlay for Shot 1 Founder card."""
    overlay = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Border
    draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, outline=(255, 255, 255, 65), width=1)
    
    # Accent bar: Valve Orange (#F36B21)
    bar_x = 22
    bar_y1 = 22
    bar_y2 = card_h - 22
    draw.rounded_rectangle([bar_x, bar_y1, bar_x + 6, bar_y2], radius=3, fill=(243, 107, 33, 255))
    
    # Typography
    font_badge = ImageFont.truetype(FONT_BOLD, 13)
    font_name = ImageFont.truetype(FONT_BOLD, 36)
    font_title = ImageFont.truetype(FONT_REG, 19)
    
    tx = bar_x + 22
    draw.text((tx, 20), "FEATURED FOUNDER", font=font_badge, fill=(243, 107, 33, 255))
    draw.text((tx, 42), "GABE NEWELL", font=font_name, fill=(255, 255, 255, 255))
    draw.text((tx, 90), "Co-Founder & President  •  Valve Corporation", font=font_title, fill=(203, 213, 225, 240))
    
    return np.array(overlay, dtype=np.uint8)

def build_title_card_overlay(card_w=980, card_h=226, radius=18):
    """
    Render crisp RGBA graphic overlay for Shot 2 Kinetic Title Card.
    Explicitly features: VALVE • THE FLATLAND EXPERIMENT / Gabe Newell.
    """
    overlay = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Border
    draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, outline=(255, 255, 255, 70), width=1)
    
    # Accent badge pill
    pill_x, pill_y = 32, 22
    font_pill = ImageFont.truetype(FONT_BOLD, 13)
    draw.rounded_rectangle([pill_x, pill_y, pill_x + 220, pill_y + 26], radius=13, fill=(243, 107, 33, 245))
    draw.text((pill_x + 14, pill_y + 5), "VALVE  •  GABE NEWELL", font=font_pill, fill=(255, 255, 255, 255))
    
    # Main Title
    font_title = ImageFont.truetype(FONT_BOLD, 46)
    draw.text((32, 62), "THE FLATLAND EXPERIMENT", font=font_title, fill=(255, 255, 255, 255))
    
    # Subtitle
    font_sub = ImageFont.truetype(FONT_REG, 23)
    draw.text((34, 124), "Gabe Newell's Radical Philosophy on Creative Value", font=font_sub, fill=(226, 232, 240, 245))
    
    # Pillars
    font_tag = ImageFont.truetype(FONT_REG, 15)
    draw.text((34, 168), "Zero Middle Managers   |   Wheeled Desks   |   Direct Creator Ownership", font=font_tag, fill=(148, 163, 184, 220))
    
    return np.array(overlay, dtype=np.uint8)

def composite_frosted_card(base_frame, card_overlay, x0, y0, card_w, card_h, alpha=1.0, radius=16, blur_ksize=31):
    """
    Apply genuine frosted glassmorphism:
    - Extracts ROI from base video frame
    - Applies smooth Gaussian blur
    - Blends subtle dark slate tint with blurred video
    - Composites anti-aliased card graphics on top
    """
    if alpha <= 0.005:
        return base_frame
        
    x1 = max(0, x0)
    y1 = max(0, y0)
    x2 = min(WIDTH, x0 + card_w)
    y2 = min(HEIGHT, y0 + card_h)
    if x1 >= x2 or y1 >= y2:
        return base_frame
        
    roi = base_frame[y1:y2, x1:x2]
    
    # 1. Frosted glass backdrop blur
    blurred_roi = cv2.GaussianBlur(roi, (blur_ksize, blur_ksize), 0)
    
    # 2. Rounded rectangle mask
    mask_img = Image.new("L", (card_w, card_h), 0)
    mask_draw = ImageDraw.Draw(mask_img)
    mask_draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, fill=255)
    mask_arr = np.array(mask_img, dtype=np.float32)[y1 - y0:y2 - y0, x1 - x0:x2 - x0] / 255.0
    
    # 3. Deep slate tint (#0c1018 BGR: 24, 16, 12)
    tint_bgr = np.array([24, 16, 12], dtype=np.float32)
    tint_ratio = 0.62
    glass_roi = (1.0 - tint_ratio) * blurred_roi + tint_ratio * tint_bgr
    
    # Blend glass into frame
    eff_glass_mask = (mask_arr * alpha)[:, :, np.newaxis]
    base_frame[y1:y2, x1:x2] = (1.0 - eff_glass_mask) * base_frame[y1:y2, x1:x2] + eff_glass_mask * glass_roi
    
    # 4. Composite crisp text, border, and accents from card_overlay
    over_sub = card_overlay[y1 - y0:y2 - y0, x1 - x0:x2 - x0]
    fg_rgb = over_sub[:, :, :3]
    fg_a = (over_sub[:, :, 3:] / 255.0) * alpha
    fg_bgr = fg_rgb[:, :, ::-1]  # RGB to BGR
    
    base_frame[y1:y2, x1:x2] = (1.0 - fg_a) * base_frame[y1:y2, x1:x2] + fg_a * fg_bgr
    return base_frame

def generate_master_video():
    print("=" * 70)
    print("Starting Valve & Gabe Newell 10s Narrative Video Master Generation")
    print("=" * 70)
    
    # 1. Verify audio & discover video sources
    if not MASTER_AUDIO_PATH.exists():
        raise FileNotFoundError(f"Master audio not found: {MASTER_AUDIO_PATH}")
        
    shot1_path, shot2_path = find_input_videos()
    print(f"Master Audio: {MASTER_AUDIO_PATH.name}")
    print(f"Shot 1 Source: {shot1_path.name}")
    print(f"Shot 2 Source: {shot2_path.name}")
    print(f"Target Output: {MASTER_VIDEO_PATH}")
    print(f"Master Specs: {WIDTH}x{HEIGHT} @ {FPS} fps ({TOTAL_FRAMES} frames, {TOTAL_SECONDS}s)")
    
    # 2. Ingest frames
    gabe_frames, gabe_fps = load_shot1_frames(shot1_path, max_duration=5.0)
    veo_frames, veo_fps = load_shot2_frames(shot2_path)
    
    # 3. Pre-render graphic overlays
    print("Pre-rendering glassmorphism graphic overlays...")
    lt_w, lt_h = 700, 140
    tc_w, tc_h = 980, 226
    lt_overlay = build_lower_third_overlay(lt_w, lt_h, radius=14)
    tc_overlay = build_title_card_overlay(tc_w, tc_h, radius=18)
    
    # 4. Launch FFmpeg pipe encoder
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
        "-preset", "slow",
        "-crf", "17",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "256k",
        "-ar", "48000",
        "-t", "10.000",
        str(MASTER_VIDEO_PATH)
    ]
    
    ffmpeg_log_path = OUT_DIR / "ffmpeg_intro_render.log"
    ffmpeg_log = open(ffmpeg_log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=ffmpeg_log)
    
    # Master Timeline:
    # 0.0s - 0.5s: Master fade-in from black
    # 0.0s - 4.7s: Shot 1 (Gabe)
    #   0.5s - 0.9s: Lower third slide in
    #   0.9s - 3.5s: Lower third hold
    #   3.5s - 3.9s: Lower third fade out
    # 4.0s - 4.7s: Cross-dissolve (700ms quintic)
    # 4.0s - 10.0s: Shot 2 (Veo B-roll, 6.0s full duration @ 1:1 speed)
    #   4.7s - 5.1s: Title card slide up
    #   5.1s - 9.1s: Title card hold
    #   9.1s - 9.4s: Title card fade out
    # 9.4s - 10.0s: Master fade out to black
    t_fade_in_end = 0.50
    t_cross_start = 4.00
    t_cross_end = 4.70
    t_shot2_start = 4.00
    t_fade_out_start = 9.40
    t_fade_out_end = 10.00
    
    print(f"\nRendering {TOTAL_FRAMES} master frames...", flush=True)
    t_start = time.time()
    
    keyframe_indices = {
        45: "kf_01_shot1_gabe_1.5s.jpg",      # 1.5s
        130: "kf_02_transition_4.35s.jpg",     # 4.35s
        195: "kf_03_shot2_veo_title_6.5s.jpg", # 6.5s
        290: "kf_04_fadeout_tail_9.7s.jpg",    # 9.7s
    }
    
    for frame_idx in range(TOTAL_FRAMES):
        t = frame_idx / FPS
        
        # --- 1. Fetch & Transform Shots ---
        need_shot1 = (t < t_cross_end)
        need_shot2 = (t >= t_cross_start)
        
        frame_s1 = None
        if need_shot1:
            idx1 = min(len(gabe_frames) - 1, max(0, int(round(t * gabe_fps))))
            gabe_raw = gabe_frames[idx1]
            # Subtle smooth push-in
            zoom = 1.00 + 0.05 * (t / t_cross_end)
            gh, gw, _ = gabe_raw.shape
            cw = int(gw / zoom)
            ch = int(gh / zoom)
            cx, cy = int(gw * 0.52), int(gh * 0.48)
            x1 = max(0, cx - cw // 2)
            y1 = max(0, cy - ch // 2)
            crop = gabe_raw[y1:min(gh, y1 + ch), x1:min(gw, x1 + cw)]
            frame_s1 = cv2.resize(crop, (WIDTH, HEIGHT), interpolation=cv2.INTER_LINEAR)
            
        frame_s2 = None
        if need_shot2:
            t_in_clip = max(0.0, t - t_shot2_start)
            idx2 = min(len(veo_frames) - 1, int(round(t_in_clip * veo_fps)))
            frame_s2 = veo_frames[idx2]
            
        # --- 2. Cross-Dissolve Compositing ---
        if t < t_cross_start:
            base_frame = frame_s1.astype(np.float32)
        elif t >= t_cross_end:
            base_frame = frame_s2.astype(np.float32)
        else:
            k = smootherstep((t - t_cross_start) / (t_cross_end - t_cross_start))
            base_frame = (1.0 - k) * frame_s1.astype(np.float32) + k * frame_s2.astype(np.float32)
            
        # --- 3. Kinetic Typography Overlays ---
        # A. Lower Third Founder Card (Shot 1: 0.5s -> 3.9s)
        if 0.50 <= t < 3.90:
            if t < 0.90:
                k_in = smootherstep((t - 0.50) / 0.40)
                lt_alpha = k_in
                x_off = int(-120 * (1.0 - k_in))
            elif t > 3.50:
                k_out = smootherstep((t - 3.50) / 0.40)
                lt_alpha = 1.0 - k_out
                x_off = 0
            else:
                lt_alpha = 1.0
                x_off = 0
                
            x_card = 120 + x_off
            y_card = 840
            base_frame = composite_frosted_card(
                base_frame, lt_overlay, x_card, y_card, lt_w, lt_h, alpha=lt_alpha, radius=14, blur_ksize=27
            )
            
        # B. Title Card (Shot 2: 4.7s -> 9.4s)
        if 4.70 <= t < 9.40:
            if t < 5.10:
                k_in = smootherstep((t - 4.70) / 0.40)
                tc_alpha = k_in
                y_off = int(40 * (1.0 - k_in))
            elif t > 9.10:
                k_out = smootherstep((t - 9.10) / 0.30)
                tc_alpha = 1.0 - k_out
                y_off = 0
            else:
                tc_alpha = 1.0
                y_off = 0
                
            x_card = 120
            y_card = 756 + y_off
            base_frame = composite_frosted_card(
                base_frame, tc_overlay, x_card, y_card, tc_w, tc_h, alpha=tc_alpha, radius=18, blur_ksize=31
            )
            
        # --- 4. Master Fade In & Fade Out to Black ---
        master_alpha = 1.0
        if t < t_fade_in_end:
            master_alpha = smootherstep(t / t_fade_in_end)
        elif t > t_fade_out_start:
            master_alpha = 1.0 - smootherstep((t - t_fade_out_start) / (t_fade_out_end - t_fade_out_start))
            
        final_frame = np.clip(base_frame * master_alpha, 0, 255).astype(np.uint8)
        
        # Save sample keyframes
        if frame_idx in keyframe_indices:
            kf_name = keyframe_indices[frame_idx]
            kf_path = KEYFRAMES_DIR / kf_name
            cv2.imwrite(str(kf_path), final_frame)
            
        # Write to FFmpeg pipe
        proc.stdin.write(final_frame.tobytes())
        
        if (frame_idx + 1) % 30 == 0 or frame_idx == TOTAL_FRAMES - 1:
            progress = (frame_idx + 1) / TOTAL_FRAMES * 100
            elapsed = time.time() - t_start
            fps_render = (frame_idx + 1) / max(0.1, elapsed)
            sys.stdout.write(f"\r  Rendering: {frame_idx + 1:3d}/{TOTAL_FRAMES} frames ({progress:5.1f}%) | {fps_render:5.1f} fps | {elapsed:4.1f}s")
            sys.stdout.flush()
            
    print("\n\nFinalizing video stream and closing FFmpeg pipe...")
    proc.stdin.close()
    proc.wait()
    ffmpeg_log.close()
    
    if proc.returncode != 0:
        with open(ffmpeg_log_path, "r", encoding="utf-8") as f:
            stderr_output = f.read()
        print(f"FFmpeg Error Log:\n{stderr_output}")
        raise RuntimeError(f"FFmpeg encoding failed with return code {proc.returncode}")
        
    render_time = time.time() - t_start
    file_size_mb = MASTER_VIDEO_PATH.stat().st_size / (1024 * 1024)
    print("=" * 70)
    print(f"MASTER VIDEO ENCODED SUCCESSFULLY: {MASTER_VIDEO_PATH}")
    print(f"  Total Time: {render_time:.2f}s ({TOTAL_FRAMES / render_time:.1f} fps average)")
    print(f"  File Size:  {file_size_mb:.2f} MB")
    print(f"  Keyframes:  {KEYFRAMES_DIR}")
    print("=" * 70)

if __name__ == "__main__":
    generate_master_video()
