import os
import json
import asyncio
import urllib.request
import edge_tts
from pydub import AudioSegment, silence

def test_kokoro(text, voice="am_adam"):
    url = "http://127.0.0.1:8880/v1/audio/speech"
    req_data = json.dumps({
        "model": "tts-1",
        "input": text,
        "voice": voice,
        "response_format": "mp3",
        "speed": 1.0
    }).encode("utf-8")
    req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read()
    except Exception as e:
        print(f"Kokoro error for {text}: {e}")
        return None

async def test_edge(text, voice="en-US-GuyNeural"):
    comm = edge_tts.Communicate(text, voice)
    out_path = f"workspace_rachel_voiceover/tmp_{abs(hash(text))}.mp3"
    await comm.save(out_path)
    with open(out_path, "rb") as f:
        data = f.read()
    if os.path.exists(out_path):
        os.remove(out_path)
    return data

async def run_tests():
    words = ["happen", "nap time", "bring", "best", "spot", "rip", "P", "B"]
    for w in words:
        k_data = test_kokoro(w, "am_adam")
        if k_data:
            with open(f"workspace_rachel_voiceover/kokoro_{w.replace(' ', '_')}.mp3", "wb") as f:
                f.write(k_data)
        e_data = await test_edge(w, "en-US-GuyNeural")
        if e_data:
            with open(f"workspace_rachel_voiceover/edge_{w.replace(' ', '_')}.mp3", "wb") as f:
                f.write(e_data)
    print("Generated all English test words successfully!")

if __name__ == "__main__":
    asyncio.run(run_tests())
