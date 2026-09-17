from pydub import AudioSegment

audio = AudioSegment.from_file("workspace_rachel_voiceover/video.mp4")

# Extract 6.0s to 9.5s
rachel_pb = audio[6000:9500]
rachel_pb.export("workspace_rachel_voiceover/rachel_pb_intro.wav", format="wav")

# Also extract just "P": 6150 to 6600
p_slice = audio[6150:6600]
p_slice.export("workspace_rachel_voiceover/rachel_P_isolated.wav", format="wav")

# Also extract just "B": 7250 to 7800
b_slice = audio[7250:7800]
b_slice.export("workspace_rachel_voiceover/rachel_B_isolated.wav", format="wav")

print("Exported rachel_pb_intro.wav, rachel_P_isolated.wav, rachel_B_isolated.wav")
