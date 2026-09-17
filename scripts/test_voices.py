import os
import sys
import json
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(r"C:\Cursor AI")
sys.path.append(str(PROJECT_ROOT / "scripts"))
from generate_gabe_narration import ensure_kokoro_server, is_server_ready

TEST_DIR = PROJECT_ROOT / "output" / "voice_samples"
TEST_DIR.mkdir(parents=True, exist_ok=True)

test_phrase = "In 1996, Gabe Newell left Microsoft with a vision to build a creative studio with zero corporate hierarchy."

voices = ["am_michael", "bm_george", "am_fenrir", "am_adam", "bm_lewis", "am_onyx"]

proc, log_file = ensure_kokoro_server()
try:
    for v in voices:
        out_file = TEST_DIR / f"{v}.wav"
        if out_file.exists():
            print(f"Sample {v} already exists.")
            continue
        print(f"Synthesizing {v}...")
        payload = {
            "model": "kokoro",
            "input": test_phrase,
            "voice": v,
            "response_format": "wav",
            "speed": 0.92
        }
        req = urllib.request.Request(
            "http://127.0.0.1:8880/v1/audio/speech",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req) as resp, open(out_file, "wb") as f:
            f.write(resp.read())
        print(f"Saved {out_file.name} ({out_file.stat().st_size} bytes)")
finally:
    # Keep server running or let it run
    pass
