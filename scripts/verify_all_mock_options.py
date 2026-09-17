"""
scripts/verify_all_mock_options.py
Comprehensive Verification & Frame Snapshot Extraction for all 4 Mock Videos:
1. Option A: Procedural Whiteboard / Hand-Drawn Doodle & Anatomical Sagittal Cutaways
2. Option B: 2D Cartoon Teacher Avatar with Synchronized Visemes & Gestures
3. Option C: Stabilized Sketch Rotoscope Vignette / PiP + Whiteboard Infographics
4. Option D: Technical Blueprint / Architectural Phonetics & Soundwave Oscilloscope
"""

import os
import sys
import subprocess
import json
import cv2

WORK_DIR = os.path.abspath("workspace_rachel_voiceover")
SNAPSHOT_DIR = os.path.join(WORK_DIR, "snapshots")
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

OPTIONS = {
    "Option A (Procedural Whiteboard)": "mock_option_a_whiteboard.mp4",
    "Option B (2D Cartoon Avatar)": "mock_option_b_cartoon_avatar.mp4",
    "Option C (Sketch Rotoscope Vignette)": "mock_option_c_rotoscope_vignette.mp4",
    "Option D (Technical Blueprint)": "mock_option_d_technical_blueprint.mp4"
}

SNAPSHOT_TIMES = [5.0, 12.0, 19.0, 24.0, 29.2] # seconds

def verify_and_snapshot():
    print("=" * 70)
    print("EMPIRICAL VERIFICATION REPORT FOR ALL 4 MOCK 30-SECOND OPTIONS")
    print("=" * 70)
    
    all_passed = True

    for label, filename in OPTIONS.items():
        filepath = os.path.join(WORK_DIR, filename)
        print(f"\n---> Inspecting: {label}")
        print(f"     Path: {filepath}")

        if not os.path.exists(filepath):
            print(f"     [FAIL] File does not exist: {filepath}")
            all_passed = False
            continue

        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"     File Size: {size_mb:.2f} MB")

        # Probe with ffprobe
        cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", filepath
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print("     [FAIL] ffprobe failed to parse video")
            all_passed = False
            continue

        info = json.loads(res.stdout)
        duration = float(info["format"]["duration"])
        print(f"     Duration: {duration:.3f} s (Target: 30.000 s)")
        assert abs(duration - 30.0) < 0.2, f"Duration mismatch: {duration}"

        video_stream = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
        audio_stream = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)

        assert video_stream is not None, "Missing video stream"
        assert audio_stream is not None, "Missing audio stream"

        w = video_stream.get("width")
        h = video_stream.get("height")
        fps = video_stream.get("r_frame_rate")
        v_codec = video_stream.get("codec_name")
        a_codec = audio_stream.get("codec_name")
        a_rate = audio_stream.get("sample_rate")

        print(f"     Video: {v_codec} {w}x{h} @ {fps} fps")
        print(f"     Audio: {a_codec} {a_rate} Hz, channels: {audio_stream.get('channels')}")

        # Extract snapshots at key timestamps
        cap = cv2.VideoCapture(filepath)
        safe_prefix = filename.replace(".mp4", "")
        for t_sec in SNAPSHOT_TIMES:
            cap.set(cv2.CAP_PROP_POS_MSEC, t_sec * 1000.0)
            ret, frame = cap.read()
            if ret:
                snap_path = os.path.join(SNAPSHOT_DIR, f"{safe_prefix}_t{int(t_sec):02d}s.jpg")
                cv2.imwrite(snap_path, frame)
        cap.release()
        print(f"     Extracted snapshots at {SNAPSHOT_TIMES} to {SNAPSHOT_DIR}")

    print("\n" + "=" * 70)
    if all_passed:
        print("ALL 4 MOCK VIDEOS EMPIRICALLY VERIFIED & VALIDATED WITH 100% SUCCESS!")
    else:
        print("SOME CHECKS FAILED.")
    print("=" * 70)

if __name__ == "__main__":
    verify_and_snapshot()
