import sys
import whisper
from pydub import AudioSegment

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

audio = AudioSegment.from_file("workspace_rachel_voiceover/rachel_bp_voiceover_namminh.mp4")
intro_clip = audio[:10000]
intro_clip.export("workspace_rachel_voiceover/vo_intro_10s.wav", format="wav")

model = whisper.load_model("base")
res = model.transcribe("workspace_rachel_voiceover/vo_intro_10s.wav", word_timestamps=True)
print("\n--- OUTPUT VO WORDS (0s - 10s) ---")
for seg in res["segments"]:
    print(f"[{seg['start']:.2f}s -> {seg['end']:.2f}s] {seg['text']}")
    for w in seg.get("words", []):
        print(f"   [{w['start']:.2f}s -> {w['end']:.2f}s] '{w['word']}'")
