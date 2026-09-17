import sys
import whisper
from pydub import AudioSegment

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

orig = AudioSegment.from_file("workspace_rachel_voiceover/video.mp4")
vo = AudioSegment.from_file("workspace_rachel_voiceover/rachel_bp_voiceover_namminh.mp4")

# Extract 50s to 66s
orig[50000:66000].export("workspace_rachel_voiceover/orig_50_66.wav", format="wav")
vo[50000:66000].export("workspace_rachel_voiceover/vo_50_66.wav", format="wav")

model = whisper.load_model("base")
print("--- ORIGINAL VIDEO 50s - 66s ---")
res_orig = model.transcribe("workspace_rachel_voiceover/orig_50_66.wav", word_timestamps=True)
for seg in res_orig["segments"]:
    for w in seg.get("words", []):
        ws = w["start"] + 50.0
        we = w["end"] + 50.0
        print(f"[{ws:5.2f}s -> {we:5.2f}s] '{w['word']}'")

print("\n--- OUTPUT VOICEOVER 50s - 66s ---")
res_vo = model.transcribe("workspace_rachel_voiceover/vo_50_66.wav", word_timestamps=True)
for seg in res_vo["segments"]:
    for w in seg.get("words", []):
        ws = w["start"] + 50.0
        we = w["end"] + 50.0
        print(f"[{ws:5.2f}s -> {we:5.2f}s] '{w['word']}'")
