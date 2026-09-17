from pydub import AudioSegment

audio = AudioSegment.from_file("workspace_rachel_voiceover/video.mp4")

# Slice 1: Rachel saying "R" (first time: 55.0s to 55.7s)
r1 = audio[55000:55700]
r1.export("workspace_rachel_voiceover/rachel_r1.wav", format="wav")

# Slice 2: Rachel saying "R" (second time: 59.1s to 59.7s)
r2 = audio[59100:59700]
r2.export("workspace_rachel_voiceover/rachel_r2.wav", format="wav")

# Slice 3: Rachel saying "B" (61.9s to 62.4s)
b_demo = audio[61900:62400]
b_demo.export("workspace_rachel_voiceover/rachel_b_demo.wav", format="wav")

# Slice 4: Rachel saying "bring" (63.7s to 64.5s)
bring_demo = audio[63700:64500]
bring_demo.export("workspace_rachel_voiceover/rachel_bring_demo.wav", format="wav")

print("Exported rachel_r1, rachel_r2, rachel_b_demo, rachel_bring_demo")
