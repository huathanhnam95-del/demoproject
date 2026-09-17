"""
scripts/generate_4_voice_samples.py
Synthesizes the identical test passage using 4 distinct free Vietnamese TTS engines:
1. Edge-TTS Nam Minh (vi-VN-NamMinhNeural, rate=-4%, pitch=-2Hz)
2. VieNeu-TTS v3 Turbo (48kHz, voice: Minh Đức - Nam/Bắc/Tin tức)
3. Kokoro-Vietnamese (24kHz, voice: Diễm Trinh - Nữ/Tự nhiên)
4. Google TTS (gTTS, 24kHz)
"""

import os
import sys
import asyncio
import soundfile as sf
from pydub import AudioSegment

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SAMPLE_TEXT = "Trong video luyện phát âm tiếng Anh-Mỹ này, chúng ta sẽ học cách phát âm hai phụ âm P và B. Ví dụ trong từ happen và nap time."
OUT_DIR = os.path.abspath("workspace_rachel_voiceover/samples")
os.makedirs(OUT_DIR, exist_ok=True)

def gen_engine1_edge_namminh():
    print(">>> [1/4] Generating Sample 1: Edge-TTS Nam Minh...")
    import edge_tts
    out_path = os.path.join(OUT_DIR, "sample_1_edge_namminh.mp3")
    async def _run():
        comm = edge_tts.Communicate(SAMPLE_TEXT, "vi-VN-NamMinhNeural", rate="-4%", pitch="-2Hz")
        await comm.save(out_path)
    asyncio.run(_run())
    print(f"    Saved: {out_path}")
    return out_path

def gen_engine2_vieneu():
    print(">>> [2/4] Generating Sample 2: VieNeu-TTS v3 Turbo (Minh Đức)...")
    from vieneu import Vieneu
    out_path = os.path.join(OUT_DIR, "sample_2_vieneu_minhduc.wav")
    tts = Vieneu(device="cpu", backend="onnx")
    audio = tts.infer(text=SAMPLE_TEXT, voice="Minh Đức")
    tts.save(audio, out_path)
    print(f"    Saved: {out_path}")
    return out_path

def gen_engine3_kokoro_vi():
    print(">>> [3/4] Generating Sample 3: Kokoro-Vietnamese (Diễm Trinh)...")
    from kokoro_vietnamese import KokoroVietnamese, SAMPLE_RATE
    out_path = os.path.join(OUT_DIR, "sample_3_kokoro_diemtrinh.wav")
    tts = KokoroVietnamese(device="cpu", voice="diem_trinh")
    audio, _ = tts.synthesize(SAMPLE_TEXT, speed=1.0)
    sf.write(out_path, audio, SAMPLE_RATE)
    print(f"    Saved: {out_path}")
    return out_path

def gen_engine4_gtts():
    print(">>> [4/4] Generating Sample 4: Google TTS (gTTS)...")
    from gtts import gTTS
    out_path = os.path.join(OUT_DIR, "sample_4_google_tts.mp3")
    tts = gTTS(SAMPLE_TEXT, lang="vi")
    tts.save(out_path)
    print(f"    Saved: {out_path}")
    return out_path

def main():
    print(f"Test Text: \"{SAMPLE_TEXT}\"\n")
    s1 = gen_engine1_edge_namminh()
    s2 = gen_engine2_vieneu()
    s3 = gen_engine3_kokoro_vi()
    s4 = gen_engine4_gtts()
    print("\nAll 4 voice samples generated successfully in:")
    print(OUT_DIR)

if __name__ == "__main__":
    main()
