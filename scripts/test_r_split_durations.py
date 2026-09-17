import asyncio
import sys
sys.path.append('scripts')
from rachel_voiceover_orchestrator import synth_edge

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

phrases = [
    ("9a (fits 2740ms)", "Ví dụ, nếu âm tiếp theo là phụ âm:", 2740),
    ("9b (fits 3400ms)", "lưỡi có thể lùi về sau và nâng lên cho âm:", 3400),
    ("10a (fits 2200ms)", "trong khi môi khép lại cho âm:", 2200),
    ("10b (fits 1300ms)", "như trong từ:", 1300),
]

async def test():
    for label, text, max_ms in phrases:
        aud = await synth_edge(text, "vi-VN-NamMinhNeural", rate="+6%")
        d = len(aud)
        margin = max_ms - d
        print(f"[{label}] '{text}': duration = {d} ms (margin = {margin} ms) -> {'PASS' if margin >= 100 else 'TIGHT'}")

asyncio.run(test())
