import subprocess
import json
from pathlib import Path

clips = [
    r"assets\speaker_portraits\gabe_4k_closing.mp4",
    r"assets\speaker_portraits\gabe_4k_talent.mp4",
    r"assets\temp_clips\erik_wolpaw_clean.mp4",
    r"assets\temp_clips\josh_weier_clean.mp4",
    r"assets\temp_clips\ken_birdwell.mp4",
    r"assets\temp_clips\mike_morasky_clean.mp4",
    r"assets\temp_clips\rich_geldreich.mp4",
    r"assets\temp_clips\frederic_laloux.mp4",
    r"assets\test_chet.mp4",
    r"output\veo_broll\valve_open_office_6s.mp4",
]

for c in clips:
    p = Path(c)
    if not p.exists():
        print(f"NOT FOUND: {c}")
        continue
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height,codec_name,r_frame_rate", "-of", "json", str(p)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    info = json.loads(res.stdout)
    dur = float(info.get("format", {}).get("duration", 0))
    streams = info.get("streams", [])
    v_info = [f"{s.get('codec_name')} {s.get('width')}x{s.get('height')} @ {s.get('r_frame_rate')}" for s in streams if s.get("width")]
    a_info = [f"{s.get('codec_name')}" for s in streams if not s.get("width")]
    print(f"{p.name:30s} | Dur: {dur:6.2f}s | Video: {v_info} | Audio: {a_info}")
