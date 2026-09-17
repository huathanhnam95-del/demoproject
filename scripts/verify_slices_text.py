import whisper

m = whisper.load_model('base')
for name in ['r1', 'r2', 'b_demo', 'bring_demo']:
    res = m.transcribe(f'workspace_rachel_voiceover/rachel_{name}.wav', language='en')
    t = res['text'].strip()
    print(f"{name}: '{t}'")
