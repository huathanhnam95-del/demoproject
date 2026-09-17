import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

import os
import re
import json
import asyncio
import urllib.request
import edge_tts
from pydub import AudioSegment, silence

SAMPLE_RATE = 24000

# Grouped continuous semantic blocks: (start_seg, end_seg, text)
SEMANTIC_BLOCKS = [
    (1, 2, "Trong video luyện phát âm tiếng Anh-Mỹ này, chúng ta sẽ học cách phát âm hai phụ âm P và B."),
    (3, 3, "Hai âm này đi thành một cặp vì chúng có cùng khẩu hình."),
    (4, 4, "Âm P là âm vô thanh, nghĩa là chỉ có luồng hơi đi qua miệng."),
    (5, 5, "Còn âm B là âm hữu thanh, nghĩa là dây thanh quản rung lên để tạo ra âm thanh."),
    (6, 6, "Hai môi khép lại trong khi răng hơi hé mở."),
    (7, 8, "Vị trí của lưỡi không quan trọng đối với hai phụ âm này, nên lưỡi có thể bắt đầu chuyển sang vị trí chuẩn bị cho âm tiếp theo."),
    (9, 10, "Ví dụ, nếu âm tiếp theo là phụ âm R, lưỡi có thể lùi về sau và nâng lên cho âm R, trong khi môi khép lại để phát âm B: bring."),
    (11, 11, "Hãy cùng quan sát khẩu hình ở cự ly gần và quay chậm."),
    (12, 12, "Hai môi mím chặt lại rồi bật mở ra."),
    (13, 13, "Đây là các phụ âm tắc."),
    (14, 15, "Đối với phụ âm tắc, có hai giai đoạn: thứ nhất là chặn luồng hơi lại, và thứ hai là bật hơi ra."),
    (16, 16, "Giai đoạn chặn hơi diễn ra khi hai môi khép lại."),
    (17, 17, "Ví dụ trong từ: happen."),
    (18, 18, "Giai đoạn bật hơi là khi môi mở ra và luồng hơi thoát ra: pen, happen."),
    (19, 20, "Đôi khi người bản xứ không bật phụ âm tắc khi chúng đứng ở cuối câu, hoặc khi từ tiếp theo bắt đầu bằng một phụ âm."),
    (21, 21, "Ví dụ như trong cụm từ quen thuộc: What's up?"),
    (22, 22, "Môi tôi khép lại ở vị trí âm P, nhưng không hề bật hơi ra."),
    # 23: Rachel 'What's up?' untouched
    (24, 24, "Một ví dụ khác: nap time!"),
    # 25: Rachel 'Nap---time!' untouched
    (26, 26, "Môi tôi mím lại cho âm P, nhưng không bật hơi ra."),
    (27, 27, "Tôi chặn hơi bằng môi, rồi chỉ bật hơi ra ở âm tiếp theo: phụ âm T."),
    # 28: Rachel 'Nap time.' untouched
    (29, 29, "Hãy cùng quan sát một số từ ở cự ly gần và quay chậm."),
    (30, 30, "Từ 'best'."),
    (31, 31, "Hai môi mím lại rồi bật mở sang nguyên âm EH như trong từ BED."),
    (32, 32, "Từ 'spot'."),
    (33, 33, "Hai môi mím lại rồi bật mở sang nguyên âm AH như trong từ FATHER."),
    (34, 34, "Từ 'rip'."),
    (35, 35, "Hai môi mím chặt lại rồi bật mở ra."),
    (36, 36, "Các phụ âm P và B: best, spot, rip."),
    (37, 37, "Các từ ví dụ. Hãy nhắc lại theo tôi:")
    # 38-43: Rachel repetition drills untouched
]

ENGLISH_TERMS = [
    "What's up?", "What's up", "nap time", "happen", "bring",
    "best", "spot", "rip", "pen", "BED", "FATHER", "EH", "AH",
    "P", "B", "R", "T"
]
sorted_terms = sorted(ENGLISH_TERMS, key=len, reverse=True)
EN_REGEX = re.compile(r'(\b(?:' + '|'.join(re.escape(t) for t in sorted_terms) + r')\b)', re.IGNORECASE)

def trim_silence(aud, thresh=-40.0):
    s = silence.detect_leading_silence(aud, silence_threshold=thresh)
    e = silence.detect_leading_silence(aud.reverse(), silence_threshold=thresh)
    if s >= len(aud):
        return aud[:0]
    return aud[s:len(aud)-e]

def synth_kokoro_en(text, voice="am_adam"):
    url = "http://127.0.0.1:8880/v1/audio/speech"
    req_data = json.dumps({
        "model": "tts-1",
        "input": text,
        "voice": voice,
        "response_format": "mp3",
        "speed": 1.0
    }).encode("utf-8")
    req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            tmp_path = f"workspace_rachel_voiceover/tmp_k_{abs(hash(text)) % 10000}.mp3"
            with open(tmp_path, "wb") as f:
                f.write(resp.read())
            aud = AudioSegment.from_file(tmp_path).set_frame_rate(SAMPLE_RATE).set_channels(2)
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return trim_silence(aud)
    except Exception as e:
        return None

async def synth_edge_tts(text, voice="vi-VN-NamMinhNeural", rate="+0%", pitch="+0Hz"):
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    tmp_path = f"workspace_rachel_voiceover/tmp_e_{abs(hash(text)) % 10000}.mp3"
    await comm.save(tmp_path)
    aud = AudioSegment.from_file(tmp_path).set_frame_rate(SAMPLE_RATE).set_channels(2)
    if os.path.exists(tmp_path):
        os.remove(tmp_path)
    return trim_silence(aud)

def parse_bilingual_tokens(text):
    tokens = []
    last = 0
    for m in EN_REGEX.finditer(text):
        start, end = m.span()
        if start > last:
            vi_sub = text[last:start]
            if vi_sub.strip():
                tokens.append(("vi", vi_sub.strip()))
        tokens.append(("en", m.group(1).strip()))
        last = end
    if last < len(text):
        vi_sub = text[last:]
        if vi_sub.strip():
            tokens.append(("vi", vi_sub.strip()))
    return tokens

async def synthesize_block(text, vi_voice="vi-VN-NamMinhNeural", en_voice="am_adam", rate="+0%", pitch="+0Hz"):
    tokens = parse_bilingual_tokens(text)
    if not any(lang == "en" for lang, _ in tokens):
        return await synth_edge_tts(text, vi_voice, rate=rate, pitch=pitch)
    
    combined = AudioSegment.empty()
    for i, (lang, chunk_text) in enumerate(tokens):
        clean_text = re.sub(r'[^\w\s]', '', chunk_text).strip()
        if not clean_text:
            pause_ms = 180 if any(p in chunk_text for p in ['.', '!', '?']) else 100
            combined += AudioSegment.silent(duration=pause_ms, frame_rate=SAMPLE_RATE).set_channels(2)
            continue
        
        if lang == "en":
            en_aud = synth_kokoro_en(chunk_text, en_voice)
            if en_aud is None or len(en_aud) == 0:
                en_aud = await synth_edge_tts(chunk_text, "en-US-GuyNeural", rate=rate)
            chunk_aud = en_aud
        else:
            chunk_aud = await synth_edge_tts(chunk_text, vi_voice, rate=rate, pitch=pitch)
            
        if len(combined) > 0 and len(chunk_aud) > 0:
            combined += AudioSegment.silent(duration=80, frame_rate=SAMPLE_RATE).set_channels(2)
        combined += chunk_aud
    return combined

async def test_all_blocks():
    print(f"Testing synthesis of all {len(SEMANTIC_BLOCKS)} semantic blocks...")
    total_ms = 0
    for s_idx, e_idx, text in SEMANTIC_BLOCKS:
        aud = await synthesize_block(text)
        print(f"Block {s_idx:02d}-{e_idx:02d}: {len(aud)}ms | '{text[:40]}...'")
        total_ms += len(aud)
    print(f"Total speech duration across all blocks: {total_ms/1000.0:.2f}s")

if __name__ == "__main__":
    asyncio.run(test_all_blocks())
