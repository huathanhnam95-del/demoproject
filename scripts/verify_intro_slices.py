import whisper

m = whisper.load_model('base')
res = m.transcribe('workspace_rachel_voiceover/rachel_pb_intro.wav', word_timestamps=True)
print('Text:', res['text'])
for seg in res.get('segments', []):
    for w in seg.get('words', []):
        print(f"[{w['start']:.2f}s - {w['end']:.2f}s] '{w['word']}'")
