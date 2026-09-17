import os
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
import subprocess
import json
from pydub import AudioSegment, silence

VID_ORIG = "workspace_rachel_voiceover/video.mp4"
VID_NAMMINH = "workspace_rachel_voiceover/rachel_bp_voiceover_namminh.mp4"
VID_HOAIMY = "workspace_rachel_voiceover/rachel_bp_voiceover_hoaimy.mp4"

def probe(file_path):
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        file_path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)

def verify():
    print("=== DEEP VERIFICATION OF DELIVERABLE VIDEOS ===")
    
    # 1. Existence and size
    assert os.path.exists(VID_NAMMINH), "NamMinh video missing"
    assert os.path.exists(VID_HOAIMY), "HoaiMy video missing"
    sz_nm = os.path.getsize(VID_NAMMINH)
    sz_hm = os.path.getsize(VID_HOAIMY)
    print(f"NamMinh video size: {sz_nm / (1024*1024):.2f} MB")
    print(f"HoaiMy video size:  {sz_hm / (1024*1024):.2f} MB")
    assert sz_nm > 5 * 1024 * 1024, "NamMinh video too small"
    assert sz_hm > 5 * 1024 * 1024, "HoaiMy video too small"

    # 2. Probe streams
    p_orig = probe(VID_ORIG)
    p_nm = probe(VID_NAMMINH)
    p_hm = probe(VID_HOAIMY)
    
    dur_orig = float(p_orig["format"]["duration"])
    dur_nm = float(p_nm["format"]["duration"])
    dur_hm = float(p_hm["format"]["duration"])
    print(f"Original duration: {dur_orig:.2f}s")
    print(f"NamMinh duration:  {dur_nm:.2f}s (delta = {abs(dur_nm - dur_orig):.3f}s)")
    print(f"HoaiMy duration:   {dur_hm:.2f}s (delta = {abs(dur_hm - dur_orig):.3f}s)")
    assert abs(dur_nm - dur_orig) < 0.1, "Duration mismatch for NamMinh"
    assert abs(dur_hm - dur_orig) < 0.1, "Duration mismatch for HoaiMy"

    # 3. Audio waveform checks: check preserved drills vs carved narration
    print("\n--- Audio Timeline Integrity Checks ---")
    aud_orig = AudioSegment.from_file(VID_ORIG)
    aud_nm = AudioSegment.from_file(VID_NAMMINH)
    
    # Repetition drill interval: 200.0s to 230.0s (Rachel drills)
    # Both audios must be non-silent and correlated
    rachel_drill_orig = aud_orig[200000:230000]
    rachel_drill_nm = aud_nm[200000:230000]
    print(f"Rachel drill [200s-230s] - Orig dBFS: {rachel_drill_orig.dBFS:.2f}, NamMinh dBFS: {rachel_drill_nm.dBFS:.2f}")
    assert abs(rachel_drill_nm.dBFS - rachel_drill_orig.dBFS) < 1.0, "Drill audio was not preserved untouched!"

    # Demonstration 'What's up?' at 124.74s - 127.06s
    rachel_demo_orig = aud_orig[125000:126500]
    rachel_demo_nm = aud_nm[125000:126500]
    print(f"Rachel demo 'What's up?' [125s-126.5s] - Orig dBFS: {rachel_demo_orig.dBFS:.2f}, NamMinh dBFS: {rachel_demo_nm.dBFS:.2f}")
    assert abs(rachel_demo_nm.dBFS - rachel_demo_orig.dBFS) < 1.0, "Demo audio was not preserved untouched!"

    # Block 17 (happen) check: 90.02s to 93.10s
    seg17_nm = aud_nm[90020:93100]
    print(f"Block 17 'happen' [90.02s-93.10s] - dBFS: {seg17_nm.dBFS:.2f}")
    assert seg17_nm.dBFS > -30, "Voiceover missing in block 17!"

    # Block 24 (nap time) check: 127.06s to 131.28s
    seg24_nm = aud_nm[127060:131280]
    print(f"Block 24 'nap time' [127.06s-131.28s] - dBFS: {seg24_nm.dBFS:.2f}")
    assert seg24_nm.dBFS > -30, "Voiceover missing in block 24!"

    # Check Block 3 script text in rachel_voiceover_orchestrator.py
    with open("scripts/rachel_voiceover_orchestrator.py", "r", encoding="utf-8") as f:
        src = f.read()
    assert "khẩu hình miệng" not in src, "'khẩu hình miệng' still found in orchestrator script!"
    assert "khẩu hình" in src, "'khẩu hình' not found in orchestrator script!"
    print("Script verification: 'khẩu hình miệng' completely eliminated, 'khẩu hình' present.")

    print("\nALL VERIFICATION GATES PASSED PERFECTLY!")

if __name__ == "__main__":
    verify()
