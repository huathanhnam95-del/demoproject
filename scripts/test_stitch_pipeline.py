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
        print(f"Kokoro error for '{text}': {e}")
        return None

async def synth_edge_tts(text, voice, rate="+0%", pitch="+0Hz"):
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    tmp_path = f"workspace_rachel_voiceover/tmp_e_{abs(hash(text)) % 10000}.mp3"
    await comm.save(tmp_path)
    aud = AudioSegment.from_file(tmp_path).set_frame_rate(SAMPLE_RATE).set_channels(2)
    if os.path.exists(tmp_path):
        os.remove(tmp_path)
    return trim_silence(aud)

ENGLISH_TERMS = [
    "What's up?", "What's up", "nap time", "happen", "bring",
    "best", "spot", "rip", "pen", "BED", "FATHER", "EH", "AH",
    "P", "B", "R", "T"
]
sorted_terms = sorted(ENGLISH_TERMS, key=len, reverse=True)
EN_REGEX = re.compile(r'(\b(?:' + '|'.join(re.escape(t) for t in sorted_terms) + r')\b)', re.IGNORECASE)

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

async def synthesize_bilingual_segment(text, vi_voice="vi-VN-NamMinhNeural", en_voice="am_adam", rate="+0%", pitch="+0Hz"):
    tokens = parse_bilingual_tokens(text)
    print(f"Input: {text}")
    print(f"Tokens: {tokens}")
    
    # If no English tokens, synthesize standard Vietnamese directly
    if not any(lang == "en" for lang, _ in tokens):
        return await synth_edge_tts(text, vi_voice, rate=rate, pitch=pitch)
    
    # Otherwise stitch tokens
    combined = AudioSegment.empty()
    for i, (lang, chunk_text) in enumerate(tokens):
        # If pure punctuation, do not send to TTS
        clean_text = re.sub(r'[^\w\s]', '', chunk_text).strip()
        if not clean_text:
            # Pure punctuation: add natural pause (120ms for comma/colon, 200ms for period)
            pause_ms = 200 if any(p in chunk_text for p in ['.', '!', '?']) else 120
            combined += AudioSegment.silent(duration=pause_ms, frame_rate=SAMPLE_RATE).set_channels(2)
            continue

        if lang == "en":
            # Native US English
            en_aud = synth_kokoro_en(chunk_text, en_voice)
            if en_aud is None or len(en_aud) == 0:
                en_aud = await synth_edge_tts(chunk_text, "en-US-GuyNeural", rate=rate)
            chunk_aud = en_aud
        else:
            # Vietnamese
            chunk_aud = await synth_edge_tts(chunk_text, vi_voice, rate=rate, pitch=pitch)
        
        if len(combined) > 0 and len(chunk_aud) > 0:
            # Add natural pause between tokens: 80ms
            combined += AudioSegment.silent(duration=80, frame_rate=SAMPLE_RATE).set_channels(2)
        combined += chunk_aud
    
    return combined

async def main():
    test_cases = [
        "Ví dụ trong từ: happen.",
        "Một ví dụ khác: nap time!",
        "Giai đoạn bật hơi là khi môi mở ra và luồng hơi thoát ra: pen, happen.",
        "Hai âm này đi thành một cặp vì chúng có cùng khẩu hình."
    ]
    for idx, tc in enumerate(test_cases):
        aud = await synthesize_bilingual_segment(tc)
        out_f = f"workspace_rachel_voiceover/test_out_{idx+1}.wav"
        aud.export(out_f, format="wav")
        print(f"Exported {out_f}: {len(aud)}ms\n")

if __name__ == "__main__":
    asyncio.run(main())
