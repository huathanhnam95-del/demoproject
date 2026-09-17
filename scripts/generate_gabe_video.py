import os
import sys
import json
import subprocess
import time
import cv2
import numpy as np
import soundfile as sf

def quintic_smoothstep(t):
    """Ken Perlin's smootherstep with zero 1st and 2nd derivatives at endpoints."""
    t = np.clip(t, 0.0, 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)

def interpolate_camera(k1, k2, t):
    """Interpolate between two camera states (cx, cy, zoom)."""
    s = quintic_smoothstep(t)
    cx = k1["cx"] + s * (k2["cx"] - k1["cx"])
    cy = k1["cy"] + s * (k2["cy"] - k1["cy"])
    zoom = k1["zoom"] + s * (k2["zoom"] - k1["zoom"])
    return cx, cy, zoom

# Precise bounding boxes for the 5 strategic sections on test_gabe_slide.png (1920x1080)
CARDS = {
    "founder": (115, 248, 634, 874),
    "card_01": (668, 248, 1805, 445),
    "card_02": (668, 462, 1805, 660),
    "card_03": (668, 677, 1805, 874),
    "banner":  (115, 893, 1805, 1023),
}

def precompute_spotlight_masks(h, w, dim_factor=0.32):
    """
    Precompute anti-aliased, feathered spotlight masks for each card.
    Active card area = 1.0, inactive area = dim_factor.
    """
    masks = {}
    pad = 8
    
    # 1. Full slide uniform mask
    masks["full"] = np.ones((h, w), dtype=np.float32)
    
    for key, (x1, y1, x2, y2) in CARDS.items():
        bx1 = max(0, x1 - pad)
        by1 = max(0, y1 - pad)
        bx2 = min(w, x2 + pad)
        by2 = min(h, y2 + pad)
        
        card_mask = np.zeros((h, w), dtype=np.float32)
        cv2.rectangle(card_mask, (bx1, by1), (bx2, by2), 1.0, -1)
        card_mask = cv2.GaussianBlur(card_mask, (21, 21), 0)
        
        # Spotlight value: dim_factor where 0, 1.0 where card_mask is 1.0
        mask = dim_factor + (1.0 - dim_factor) * card_mask
        masks[key] = np.clip(mask, 0.0, 1.0)
        
    return masks

def build_director_schedule(manifest, total_duration):
    """Build mathematical director timeline for camera and dynamic spotlight."""
    beats = manifest["beats"]
    b1 = beats[0]
    b2 = beats[1]
    b3 = beats[2]
    b4 = beats[3]
    b5 = beats[4]
    
    # Camera Keyframe Anchors
    # Clean framing coordinates respecting element geometry
    cam_wide = {"cx": 960.0, "cy": 540.0, "zoom": 1.00}
    
    # Founder Card: centered at x=384, tilts from portrait (cy=460) down to hero quote (cy=620)
    cam_founder_portrait = {"cx": 384.0, "cy": 460.0, "zoom": 2.40}
    cam_founder_quote    = {"cx": 384.0, "cy": 620.0, "zoom": 2.35}
    
    # Right Column Cards: perfectly framed at cx=1240, cy=560, zoom=1.48 (no cut-off titles/banners)
    cam_col_c1 = {"cx": 1240.0, "cy": 560.0, "zoom": 1.48}
    cam_col_c1_drift = {"cx": 1244.0, "cy": 562.0, "zoom": 1.47}
    
    cam_col_c2 = {"cx": 1240.0, "cy": 560.0, "zoom": 1.48}
    cam_col_c2_drift = {"cx": 1236.0, "cy": 562.0, "zoom": 1.49}
    
    cam_col_c3 = {"cx": 1240.0, "cy": 560.0, "zoom": 1.48}
    cam_col_c3_drift = {"cx": 1242.0, "cy": 562.0, "zoom": 1.47}
    
    # Bottom Banner: framed widely at zoom 1.02 to ensure full text readability
    cam_banner_entry = {"cx": 960.0, "cy": 545.0, "zoom": 1.02}
    cam_banner_drift = {"cx": 960.0, "cy": 540.0, "zoom": 1.00}
    
    def get_state_at(t):
        # 1. Opening establishing shot (0.0s to 2.0s)
        if t < 2.00:
            return cam_wide["cx"], cam_wide["cy"], cam_wide["zoom"], "full", None, 0.0
            
        # 2. Smooth zoom into Founder Card (2.0s to 3.8s)
        elif t < 3.80:
            frac = (t - 2.00) / 1.80
            cx, cy, zoom = interpolate_camera(cam_wide, cam_founder_portrait, frac)
            return cx, cy, zoom, "full", "founder", frac
            
        # 3. Beat 1: Founder Vision & Hero Quote (3.8s to b1["end"])
        elif t <= b1["end"]:
            frac = (t - 3.80) / max(0.1, b1["end"] - 3.80)
            cx, cy, zoom = interpolate_camera(cam_founder_portrait, cam_founder_quote, frac)
            return cx, cy, zoom, "founder", None, 0.0
            
        # 4. Pause 1 -> 2: Glide to Right Column & Card 01 (b1["end"] to b2["start"])
        elif t < b2["start"]:
            frac = (t - b1["end"]) / max(0.1, b2["start"] - b1["end"])
            cx, cy, zoom = interpolate_camera(cam_founder_quote, cam_col_c1, frac)
            return cx, cy, zoom, "founder", "card_01", frac
            
        # 5. Beat 2: Pillar 1 (Transaction Costs)
        elif t <= b2["end"]:
            frac = (t - b2["start"]) / max(0.1, b2["end"] - b2["start"])
            cx, cy, zoom = interpolate_camera(cam_col_c1, cam_col_c1_drift, frac)
            return cx, cy, zoom, "card_01", None, 0.0
            
        # 6. Pause 2 -> 3: Transition to Card 02 (Creative Leverage)
        elif t < b3["start"]:
            frac = (t - b2["end"]) / max(0.1, b3["start"] - b2["end"])
            cx, cy, zoom = interpolate_camera(cam_col_c1_drift, cam_col_c2, frac)
            return cx, cy, zoom, "card_01", "card_02", frac
            
        # 7. Beat 3: Pillar 2 (Creative Leverage)
        elif t <= b3["end"]:
            frac = (t - b3["start"]) / max(0.1, b3["end"] - b3["start"])
            cx, cy, zoom = interpolate_camera(cam_col_c2, cam_col_c2_drift, frac)
            return cx, cy, zoom, "card_02", None, 0.0
            
        # 8. Pause 3 -> 4: Transition to Card 03 (Learner First)
        elif t < b4["start"]:
            frac = (t - b3["end"]) / max(0.1, b4["start"] - b3["end"])
            cx, cy, zoom = interpolate_camera(cam_col_c2_drift, cam_col_c3, frac)
            return cx, cy, zoom, "card_02", "card_03", frac
            
        # 9. Beat 4: Pillar 3 (Learner First)
        elif t <= b4["end"]:
            frac = (t - b4["start"]) / max(0.1, b4["end"] - b4["start"])
            cx, cy, zoom = interpolate_camera(cam_col_c3, cam_col_c3_drift, frac)
            return cx, cy, zoom, "card_03", None, 0.0
            
        # 10. Pause 4 -> 5: Transition to Bottom Banner
        elif t < b5["start"]:
            frac = (t - b4["end"]) / max(0.1, b5["start"] - b4["end"])
            cx, cy, zoom = interpolate_camera(cam_col_c3_drift, cam_banner_entry, frac)
            return cx, cy, zoom, "card_03", "banner", frac
            
        # 11. Beat 5: Bottom Takeaway Banner (Empowering Our Teaching Team)
        elif t <= b5["end"]:
            frac = (t - b5["start"]) / max(0.1, b5["end"] - b5["start"])
            cx, cy, zoom = interpolate_camera(cam_banner_entry, cam_banner_drift, frac)
            return cx, cy, zoom, "banner", None, 0.0
            
        # 12. Outro Pullback: Full slide illumination & settle (b5["end"] to b5["end"] + 2.0s)
        elif t < b5["end"] + 2.00:
            frac = (t - b5["end"]) / 2.00
            cx, cy, zoom = interpolate_camera(cam_banner_drift, cam_wide, frac)
            return cx, cy, zoom, "banner", "full", frac
            
        # 13. Final hold & fade out
        else:
            return cam_wide["cx"], cam_wide["cy"], cam_wide["zoom"], "full", None, 0.0
            
    return get_state_at, beats

def render_narrative_video():
    slide_path = r"C:\Cursor AI\exported_slides\test_gabe_slide.png"
    manifest_path = r"C:\Cursor AI\exported_slides\narration_audio\narration_manifest.json"
    audio_path = r"C:\Cursor AI\exported_slides\narration_audio\master_narration.wav"
    output_path = r"C:\Cursor AI\exported_slides\gabe_slide_narrative.mp4"
    
    if not os.path.exists(slide_path):
        raise FileNotFoundError(f"Slide not found: {slide_path}")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Master audio not found: {audio_path}")
        
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
        
    audio_info, sr = sf.read(audio_path)
    total_duration = len(audio_info) / sr
    print(f"Master Audio Duration: {total_duration:.3f}s")
    
    img = cv2.imread(slide_path)
    h, w, _ = img.shape
    print(f"Base Slide Image: {w}x{h}")
    
    fps = 30
    total_frames = int(round(total_duration * fps))
    print(f"Total Video Frames: {total_frames} @ {fps} fps")
    
    # Precompute spotlight masks for maximum rendering speed
    print("Precomputing feathered spotlight masks...")
    masks = precompute_spotlight_masks(h, w, dim_factor=0.32)
    
    director_func, beats = build_director_schedule(manifest, total_duration)
    
    print("\n--- Director Timeline & Beat Timings ---")
    for b in beats:
        print(f"  [{b['start']:6.2f}s - {b['end']:6.2f}s] {b['title']}")
        
    # FFmpeg pipe setup
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{w}x{h}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",
        "-i", audio_path,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output_path
    ]
    
    print(f"\nLaunching FFmpeg encoding pipeline...", flush=True)
    ffmpeg_log_path = os.path.join(os.path.dirname(output_path), "ffmpeg_render.log")
    ffmpeg_log = open(ffmpeg_log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=ffmpeg_log)
    
    t0 = time.time()
    last_log_t = t0
    
    dst_pts = np.float32([[0, 0], [w, 0], [0, h]])
    
    fade_in_dur = 1.0
    fade_out_dur = 1.5
    t_fade_out_start = total_duration - fade_out_dur
    
    img_f32 = img.astype(np.float32)
    
    for frame_idx in range(total_frames):
        t = frame_idx / fps
        cx, cy, zoom, m_cur, m_next, frac = director_func(t)
        
        # 1. Compute active spotlight mask
        if m_next is None or frac <= 0.0:
            active_mask = masks[m_cur]
        elif frac >= 1.0:
            active_mask = masks[m_next]
        else:
            s = quintic_smoothstep(frac)
            active_mask = (1.0 - s) * masks[m_cur] + s * masks[m_next]
            
        # Apply spotlight illumination
        lit_slide = img_f32 * active_mask[:, :, np.newaxis]
        
        # 2. Subpixel camera crop with bicubic interpolation
        crop_w = w / zoom
        crop_h = h / zoom
        
        # Safe clamp to strictly avoid black borders outside [0, w] x [0, h]
        cx = np.clip(cx, crop_w / 2.0, w - crop_w / 2.0)
        cy = np.clip(cy, crop_h / 2.0, h - crop_h / 2.0)
        
        x1 = cx - crop_w / 2.0
        y1 = cy - crop_h / 2.0
        x2 = x1 + crop_w
        y2 = y1 + crop_h
        
        src_pts = np.float32([[x1, y1], [x2, y1], [x1, y2]])
        matrix = cv2.getAffineTransform(src_pts, dst_pts)
        frame = cv2.warpAffine(lit_slide, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        
        # 3. Cinematic Opening Fade-In & Closing Fade-Out
        if t < fade_in_dur:
            fade = t / fade_in_dur
            frame = frame * fade
        elif t > t_fade_out_start:
            fade = max(0.0, (total_duration - t) / fade_out_dur)
            frame = frame * fade
            
        frame_u8 = np.clip(frame, 0.0, 255.0).astype(np.uint8)
        proc.stdin.write(frame_u8.tobytes())
        
        if time.time() - last_log_t > 3.0 or frame_idx == total_frames - 1:
            pct = (frame_idx + 1) / total_frames * 100.0
            fps_speed = (frame_idx + 1) / max(0.01, time.time() - t0)
            print(f"  Frame {frame_idx + 1}/{total_frames} ({pct:.1f}%) - Speed: {fps_speed:.1f} fps", flush=True)
            last_log_t = time.time()
            
    proc.stdin.close()
    proc.wait()
    ffmpeg_log.close()
    
    if proc.returncode != 0:
        print(f"FFmpeg error with code {proc.returncode}. Check {ffmpeg_log_path}", flush=True)
        sys.exit(proc.returncode)
        
    t1 = time.time()
    print(f"\nRender successfully completed in {t1 - t0:.2f}s ({total_frames / (t1 - t0):.1f} avg fps)!", flush=True)
    print(f"Final output video: {output_path}", flush=True)

if __name__ == "__main__":
    render_narrative_video()
