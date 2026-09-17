import sys
import asyncio
import edge_tts
from pydub import AudioSegment

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

async def test():
    options = [
        "Trong video luyện phát âm tiếng Anh-Mỹ này, chúng ta sẽ học cách phát âm hai phụ âm:",
        "Trong video luyện phát âm tiếng Anh-Mỹ này, chúng ta sẽ học hai phụ âm:",
        "Trong video này, chúng ta sẽ cùng học cách phát âm hai phụ âm:",
    ]
    for opt in options:
        comm = edge_tts.Communicate(opt, "vi-VN-NamMinhNeural", rate="+6%", pitch="+0Hz")
        tmp = "workspace_rachel_voiceover/test_opt.mp3"
        await comm.save(tmp)
        aud = AudioSegment.from_file(tmp)
        print(f"'{opt}': {len(aud)} ms ({len(aud)/1000.0:.2f}s)")

asyncio.run(test())
