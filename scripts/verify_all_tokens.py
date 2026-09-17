import os
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

import json
import urllib.request
import asyncio
import edge_tts
from pydub import AudioSegment, silence

def trim(aud, thresh=-40.0):
    s = silence.detect_leading_silence(aud, silence_threshold=thresh)
    e = silence.detect_leading_silence(aud.reverse(), silence_threshold=thresh)
    if s >= len(aud):
        return aud[:0]
    return aud[s:len(aud)-e]

def test_kokoro(token, voice="am_adam"):
    url = "http://127.0.0.1:8880/v1/audio/speech"
    req_data = json.dumps({
        "model": "tts-1",
        "input": token,
        "voice": voice,
        "response_format": "mp3",
        "speed": 1.0
    }).encode("utf-8")
    req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.read()

async def test_edge(token, voice="en-US-GuyNeural"):
    comm = edge_tts.Communicate(token, voice)
    tmp_path = "workspace_rachel_voiceover/tmp_edge_token.mp3"
    await comm.save(tmp_path)
    with open(tmp_path, "rb") as f:
        data = f.read()
    if os.path.exists(tmp_path):
        os.remove(tmp_path)
    return data

async def main():
    terms = ["P", "B", "R", "T", "bring", "happen", "pen", "What's up?", "nap time", "best", "spot", "rip", "EH", "BED", "AH", "FATHER"]
    for t in terms:
        k_bytes = test_kokoro(t)
        e_bytes = await test_edge(t)
        print(f"Token '{t}': Kokoro={len(k_bytes)}B, Edge={len(e_bytes)}B")

if __name__ == "__main__":
    asyncio.run(main())
