import os
import whisper

video_path = os.path.abspath("workspace_rachel_voiceover/video.mp4")
model = whisper.load_model("base")
print("Transcribing full video with word timestamps...")
res = model.transcribe(video_path, word_timestamps=True)

print("\n--- ALL DETECTED PHONEMES OR SHORT SOUNDS ---")
for seg in res["segments"]:
    for w in seg.get("words", []):
        word = w["word"].strip().strip(".,!?:;\"'").lower()
        if word in ["p", "b", "pp", "bb", "bring", "baby", "job", "peace", "price", "up", "best", "spot", "rip", "happen"]:
            print(f"[{w['start']:.2f}s -> {w['end']:.2f}s] word: '{w['word']}' in segment: \"{seg['text']}\"")
