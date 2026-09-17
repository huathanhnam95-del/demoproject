"""
scripts/rachel_voiceover_orchestrator.py
Complete End-to-End Pipeline for Vietnamese Voice-Over on Rachel's English [b] & [p] lesson:
1. Ingestion: yt-dlp downloads 1080p MP4 and official English captions.
2. Subtitle Parsing & Pedagogical Alignment: Audited translation with drill silence preservation.
3. Multi-Engine Bilingual Voice-Over Synthesis:
   - 'namminh' (Edge-TTS vi-VN-NamMinhNeural + Kokoro 'am_adam' / Edge 'en-US-GuyNeural')
   - 'hoaimy' (Edge-TTS vi-VN-HoaiMyNeural + Kokoro 'af_heart' / Edge 'en-US-JennyNeural')
   - 'vieneu' (VieNeu-TTS v3 Turbo, 48kHz, voice='Minh Đức')
   - 'kokoro' (Kokoro-Vietnamese ONNX/CPU, voice='diem_trinh')
   - 'gtts' (Google TTS)
4. Timeline Audio Carving (100% HARD CARVED MUTING):
   - During Vietnamese narration: Rachel's audio is sliced out and replaced by 100% digital silence.
   - During Rachel's demonstrations & repetition drills: Rachel's audio is 100% preserved.
5. Muxing: Direct MP4 stream muxing without compressors (-c:v copy -c:a aac -b:a 192k).
"""

import os
import sys
import re
import json
import argparse
import asyncio
import subprocess
import urllib.request
from pydub import AudioSegment, silence

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

YOUTUBE_URL = "https://www.youtube.com/watch?v=JPUr5MgeDHM"
WORK_DIR = os.path.abspath("workspace_rachel_voiceover")
SAMPLE_RATE = 44100

# Target English vocabulary and phonetic target terms requiring authentic US English pronunciation
ENGLISH_TERMS = [
    "What's up?", "What's up", "nap time", "happen", "bring",
    "best", "spot", "rip", "pen", "BED", "FATHER", "EH", "AH",
    "P", "B", "R", "T"
]
_sorted_terms = sorted(ENGLISH_TERMS, key=len, reverse=True)
EN_REGEX = re.compile(r'(?<!\w)(' + '|'.join(re.escape(t) for t in _sorted_terms) + r')(?!\w)', re.IGNORECASE)

# Protected segments where Rachel demonstrates pronunciation or leads repetition drills:
# Segments 2 ("P and B consonants."), 23 ("What's up?"), 25 ("Nap---time!"), 28 ("Nap time."), 38-43 (Repetition drills: Bring, Baby, Job, Peace, Price, Up)
PROTECTED_RACHEL_SEGS = {2, 17, 23, 25, 28, 38, 39, 40, 41, 42, 43}

# Explicit millisecond windows where Rachel demonstrates pure phonemes [p] and [b], [r], and example words:
# These windows are 100% preserved from Rachel's authentic audio and never muted.
EXPLICIT_PROTECTED_WINDOWS = [
    (6140, 9720),      # Rachel authentic intro pronunciation "P and B consonants."
    (24100, 25400),    # Rachel authentic /p/ mouth pop [p] [p]
    (31300, 32700),    # Rachel authentic /b/ vocal cord vibration #1 [b] [b]
    (36600, 38500),    # Rachel authentic /b/ vocal cord vibration #2 [b] [b]
    (54900, 56400),    # Rachel authentic /r/ demonstration #1 ("the R consonant")
    (59000, 59700),    # Rachel authentic /r/ demonstration #2 ("the R")
    (61800, 62400),    # Rachel authentic /b/ demonstration ("the B")
    (63700, 65369),    # Rachel authentic "bring" example word demonstration
    (90000, 92900),    # Rachel authentic slow-motion demonstration "Hap-pen."
    (97200, 104260),   # Rachel authentic release demonstration "-pen, hap-pen, happen."
]

# Merged semantic flow map: start_id -> (end_id, text) or (end_id, text, start_s, end_s)
# Grouping contiguous subtitle fragments eliminates staccato mid-sentence breaks.
# Script audited: Changed "khẩu hình miệng" -> "khẩu hình".
# Blocks 1, 4, 5, 9, 10, 16, 18 are aligned around Rachel's authentic phoneme demonstrations.
MERGED_FLOW_MAP = {
    1: (1, "Trong video luyện phát âm tiếng Anh-Mỹ này, chúng ta sẽ học cách phát âm hai phụ âm:"),
    3: (3, "Hai âm này đi thành một cặp vì chúng có cùng khẩu hình."),
    4: (4, "Âm P là âm vô thanh,", 21.920, 24.100),
    402: (4, "nghĩa là chỉ có luồng hơi đi qua miệng.", 25.400, 28.900),
    5: (5, "Còn âm B là âm hữu thanh,", 28.900, 31.300),
    502: (5, "nghĩa là dây thanh quản rung lên để tạo ra âm thanh.", 32.700, 36.600),
    6: (6, "Hai môi khép lại trong khi răng hơi hé mở."),
    7: (8, "Vị trí của lưỡi không quan trọng đối với hai phụ âm này, nên lưỡi có thể bắt đầu chuyển sang vị trí chuẩn bị cho âm tiếp theo."),
    901: (9, "Ví dụ, nếu âm tiếp theo là phụ âm:", 52.000, 54.900),
    902: (9, "lưỡi sẽ kéo về sau và nâng lên cho:", 56.400, 59.000),
    1001: (10, "trong khi hai môi khép lại cho:", 59.700, 61.800),
    1002: (10, "như trong từ:", 62.400, 63.700),
    11: (11, "Hãy cùng quan sát khẩu hình ở cự ly gần và quay chậm."),
    12: (12, "Hai môi mím chặt lại rồi bật mở ra."),
    13: (13, "Đây là các phụ âm tắc."),
    14: (15, "Đối với phụ âm tắc, có hai giai đoạn: thứ nhất là chặn luồng hơi lại, và thứ hai là bật hơi ra."),
    16: (16, "Giai đoạn chặn hơi diễn ra khi hai môi khép lại, ví dụ trong từ:", 85.480, 90.000),
    1801: (18, "Giai đoạn bật hơi là khi môi mở ra và luồng hơi thoát ra:", 92.900, 97.200),
    19: (20, "Đôi khi người bản xứ không bật phụ âm tắc khi chúng đứng ở cuối câu, hoặc khi từ tiếp theo bắt đầu bằng một phụ âm."),
    21: (21, "Ví dụ như trong cụm từ quen thuộc: What's up?"),
    22: (22, "Môi tôi khép lại ở vị trí âm P, nhưng không hề bật hơi ra."),
    24: (24, "Một ví dụ khác: nap time!"),
    26: (26, "Môi tôi mím lại cho âm P, nhưng không bật hơi ra."),
    27: (27, "Tôi chặn hơi bằng môi, rồi chỉ bật hơi ra ở âm tiếp theo: phụ âm T."),
    29: (29, "Hãy cùng quan sát một số từ ở cự ly gần và quay chậm."),
    30: (30, "Từ 'best'."),
    31: (31, "Hai môi mím lại rồi bật mở sang nguyên âm EH như trong từ BED."),
    32: (32, "Từ 'spot'."),
    33: (33, "Hai môi mím lại rồi bật mở sang nguyên âm AH như trong từ FATHER."),
    34: (34, "Từ 'rip'."),
    35: (35, "Hai môi mím chặt lại rồi bật mở ra."),
    36: (36, "Các phụ âm P và B: best, spot, rip."),
    37: (37, "Các từ ví dụ. Hãy nhắc lại theo tôi:")
}

def trim_silence(aud, thresh=-35.0):
    """Strip leading and trailing digital silence to prevent staccato pacing gaps."""
    if len(aud) == 0:
        return aud
    s = silence.detect_leading_silence(aud, silence_threshold=thresh)
    e = silence.detect_leading_silence(aud.reverse(), silence_threshold=thresh)
    if s >= len(aud):
        return aud[:0]
    return aud[s:len(aud)-e]

def synth_kokoro_en(text, voice="am_adam"):
    """Synthesize English words using local Kokoro TTS running on port 8880."""
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
            tmp_path = os.path.join(WORK_DIR, f"tmp_k_{abs(hash(text)) % 100000}.mp3")
            with open(tmp_path, "wb") as f:
                f.write(resp.read())
            aud = AudioSegment.from_file(tmp_path).set_frame_rate(SAMPLE_RATE).set_channels(2)
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return trim_silence(aud)
    except Exception:
        return None

async def synth_edge(text, voice, rate="+0%", pitch="+0Hz", max_retries=3, retry_delay=0.6, trim=True):
    """Synthesize speech chunk via Edge-TTS with automatic retries and optional silence stripping."""
    import edge_tts
    for attempt in range(1, max_retries + 1):
        tmp_path = os.path.join(WORK_DIR, f"tmp_e_{os.getpid()}_{abs(hash((text, voice, attempt))) % 1000000}.mp3")
        try:
            comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
            await comm.save(tmp_path)
            aud = AudioSegment.from_file(tmp_path).set_frame_rate(SAMPLE_RATE).set_channels(2)
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return trim_silence(aud) if trim else aud
        except Exception as e:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            if attempt < max_retries:
                await asyncio.sleep(retry_delay * attempt)
            else:
                raise e

def parse_bilingual_tokens(text):
    """Split mixed Vietnamese/English text into tagged language tokens."""
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

async def synthesize_bilingual_block(text, vi_synth_func, en_voice, en_edge_voice, rate="+0%", pitch="+0Hz"):
    """
    Code-switching synthesis:
    - Vietnamese tokens -> vi_synth_func
    - English words/letters -> Kokoro (am_adam/af_heart) with fallback to Edge en-US (Guy/Jenny)
    - Punctuation -> natural acoustic pauses (100-180ms)
    - Strips leading/trailing silence to eliminate staccato pauses
    """
    tokens = parse_bilingual_tokens(text)
    if not any(lang == "en" for lang, _ in tokens):
        raw_vi = await vi_synth_func(text)
        return trim_silence(raw_vi)

    combined = AudioSegment.empty()
    for lang, chunk_text in tokens:
        clean_text = re.sub(r'[^\w\s]', '', chunk_text).strip()
        if not clean_text:
            # Pure punctuation: insert natural prosodic pause
            pause_ms = 180 if any(p in chunk_text for p in ['.', '!', '?']) else 100
            combined += AudioSegment.silent(duration=pause_ms, frame_rate=SAMPLE_RATE).set_channels(2)
            continue

        if lang == "en":
            en_aud = synth_kokoro_en(chunk_text, en_voice)
            if en_aud is None or len(en_aud) == 0:
                en_aud = await synth_edge(chunk_text, en_edge_voice, rate=rate)
            chunk_aud = en_aud
            # If the English term ends with punctuation, manually add a pause since trim_silence removes it
            if any(chunk_text.endswith(p) for p in ['.', '!', '?']):
                chunk_aud += AudioSegment.silent(duration=180, frame_rate=SAMPLE_RATE).set_channels(2)
            elif any(chunk_text.endswith(p) for p in [',', ':', ';']):
                chunk_aud += AudioSegment.silent(duration=100, frame_rate=SAMPLE_RATE).set_channels(2)
        else:
            raw_chunk = await vi_synth_func(chunk_text)
            chunk_aud = trim_silence(raw_chunk)

        if len(combined) > 0 and len(chunk_aud) > 0:
            combined = combined.append(chunk_aud, crossfade=min(len(combined), len(chunk_aud), 20))
        else:
            combined += chunk_aud

    return combined

def step1_download():
    print(">>> [1/5] Checking/Downloading video and official captions...")
    os.makedirs(WORK_DIR, exist_ok=True)
    video_out = os.path.join(WORK_DIR, "video.%(ext)s")
    video_target = os.path.join(WORK_DIR, "video.mp4")

    existing_srts = [
        os.path.join(WORK_DIR, f) for f in os.listdir(WORK_DIR)
        if f.endswith(".srt") and "en-6Pw-d3P9U40" in f
    ]
    if os.path.exists(video_target) and existing_srts:
        print(f"Video and SRT already exist in {WORK_DIR}. Skipping download.")
        return video_target, existing_srts[0]

    cmd = [
        "yt-dlp",
        "--js-runtimes", "node",
        "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
        "--merge-output-format", "mp4",
        "--write-sub", "--sub-lang", "en-6Pw-d3P9U40",
        "--convert-subs", "srt",
        "-o", video_out,
        YOUTUBE_URL
    ]
    subprocess.run(cmd, check=True)

    srt_candidates = [
        os.path.join(WORK_DIR, f) for f in os.listdir(WORK_DIR)
        if f.endswith(".srt")
    ]
    return video_target, srt_candidates[0]

def parse_srt(srt_path):
    print(f">>> Parsing SRT file: {srt_path}")
    with open(srt_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read().replace("\r\n", "\n")
    blocks = [b.strip() for b in content.split("\n\n") if b.strip()]
    raw_segments = {}
    for b in blocks:
        lines = b.split("\n")
        if len(lines) >= 2:
            try:
                idx = int(lines[0].strip())
            except ValueError:
                continue
            m = re.match(r"(\d+):(\d+):(\d+)[,\.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,\.](\d+)", lines[1].strip())
            if m:
                s = int(m.group(1))*3600 + int(m.group(2))*60 + int(m.group(3)) + int(m.group(4))/1000.0
                e = int(m.group(5))*3600 + int(m.group(6))*60 + int(m.group(7)) + int(m.group(8))/1000.0
                text = " ".join(lines[2:]).strip()
                raw_segments[idx] = {
                    "id": idx,
                    "start": s,
                    "end": e,
                    "duration": round(e - s, 3),
                    "en_text": text
                }

    # Construct unified semantic blocks from MERGED_FLOW_MAP
    semantic_blocks = []
    for item_id, item_val in MERGED_FLOW_MAP.items():
        if len(item_val) == 2:
            end_id, vi_text = item_val
            if item_id in raw_segments and end_id in raw_segments:
                s = raw_segments[item_id]["start"]
                e = raw_segments[end_id]["end"]
                semantic_blocks.append({
                    "id": item_id,
                    "end_id": end_id,
                    "start": s,
                    "end": e,
                    "duration": round(e - s, 3),
                    "vi_text": vi_text
                })
        elif len(item_val) == 4:
            ref_id, vi_text, s, e = item_val
            semantic_blocks.append({
                "id": item_id,
                "end_id": ref_id,
                "start": s,
                "end": e,
                "duration": round(e - s, 3),
                "vi_text": vi_text
            })

    semantic_blocks.sort(key=lambda b: b["start"])
    print(f"Constructed {len(semantic_blocks)} semantic blocks with flowing prosody.")
    return semantic_blocks, raw_segments

def synthesize_tts(semantic_blocks, engine_name, force=False):
    print(f">>> [2/5] Synthesizing Vietnamese speech via engine: '{engine_name}'...")
    seg_dir = os.path.join(WORK_DIR, f"segments_{engine_name}")
    os.makedirs(seg_dir, exist_ok=True)

    is_male = engine_name in ["namminh", "vieneu"]
    en_voice = "am_adam" if is_male else "af_heart"
    en_edge_voice = "en-US-GuyNeural" if is_male else "en-US-JennyNeural"

    if engine_name in ["namminh", "hoaimy"]:
        vi_voice = "vi-VN-NamMinhNeural" if engine_name == "namminh" else "vi-VN-HoaiMyNeural"
        async def vi_synth_func(text):
            return await synth_edge(text, vi_voice, rate="+0%", pitch="+0Hz", trim=True)
    elif engine_name == "vieneu":
        from vieneu import Vieneu
        import tempfile
        tts = Vieneu(device="cpu", backend="onnx")
        async def vi_synth_func(text):
            audio = tts.infer(text=text, voice="Minh Đức")
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_name = tmp.name
            tts.save(audio, tmp_name)
            aud = AudioSegment.from_file(tmp_name).set_frame_rate(SAMPLE_RATE).set_channels(2)
            if os.path.exists(tmp_name):
                os.remove(tmp_name)
            return aud
    elif engine_name == "kokoro":
        import soundfile as sf
        import tempfile
        from kokoro_vietnamese import KokoroVietnamese, SAMPLE_RATE as K_RATE
        tts = KokoroVietnamese(device="cpu", voice="diem_trinh")
        async def vi_synth_func(text):
            audio, _ = tts.synthesize(text, speed=1.0)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_name = tmp.name
            sf.write(tmp_name, audio, K_RATE)
            aud = AudioSegment.from_file(tmp_name).set_frame_rate(SAMPLE_RATE).set_channels(2)
            if os.path.exists(tmp_name):
                os.remove(tmp_name)
            return aud
    elif engine_name == "gtts":
        from gtts import gTTS
        import tempfile
        async def vi_synth_func(text):
            tts = gTTS(text, lang="vi")
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                tmp_name = tmp.name
            tts.save(tmp_name)
            aud = AudioSegment.from_file(tmp_name).set_frame_rate(SAMPLE_RATE).set_channels(2)
            if os.path.exists(tmp_name):
                os.remove(tmp_name)
            return aud

    meta_path = os.path.join(seg_dir, "segments_meta.json")
    meta = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            meta = {}

    async def _synth_all():
        for blk in semantic_blocks:
            blk_key = str(blk['id'])
            out_path = os.path.join(seg_dir, f"seg_{blk['id']:03d}.wav")
            cached_text = meta.get(blk_key, {}).get("text")
            if not force and os.path.exists(out_path) and os.path.getsize(out_path) > 1000 and cached_text == blk["vi_text"]:
                continue
            print(f"  [{engine_name.upper()}] Synthesizing block #{blk['id']:02d}-#{blk['end_id']:02d} ({blk['duration']}s window)...")
            aud = await synthesize_bilingual_block(
                blk["vi_text"],
                vi_synth_func=vi_synth_func,
                en_voice=en_voice,
                en_edge_voice=en_edge_voice,
                rate="+0%",
                pitch="+0Hz"
            )
            aud.export(out_path, format="wav")
            meta[blk_key] = {"text": blk["vi_text"], "duration_ms": len(aud)}
            print(f"    -> Exported #{blk['id']:02d}: {len(aud)}ms (fits {int(blk['duration']*1000)}ms window)")
            await asyncio.sleep(0.1)

    asyncio.run(_synth_all())
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"All segments ready in: {seg_dir}")
    return seg_dir

def merge_windows(windows):
    """Merge overlapping or contiguous time intervals."""
    if not windows:
        return []
    sorted_windows = sorted(windows)
    merged = [sorted_windows[0]]
    for cur_s, cur_e in sorted_windows[1:]:
        prev_s, prev_e = merged[-1]
        if cur_s <= prev_e:
            merged[-1] = (prev_s, max(prev_e, cur_e))
        else:
            merged.append((cur_s, cur_e))
    return merged

def assemble_carved_voiceover(video_path, semantic_blocks, raw_segments, engine_name, seg_dir):
    print(f">>> [3/5] Assembling master audio timeline with 100% CARVED MUTING of Rachel...")

    orig_audio = AudioSegment.from_file(video_path).set_frame_rate(SAMPLE_RATE).set_channels(2)
    total_ms = len(orig_audio)
    print(f"Loaded original video audio: {total_ms/1000.0:.2f} seconds ({total_ms} ms)")

    master_audio = orig_audio

    # Build protected timestamps list (Rachel demonstrations & repetition drills)
    protected_windows = []
    for pid in sorted(PROTECTED_RACHEL_SEGS):
        if pid in raw_segments:
            p_start = int(raw_segments[pid]["start"] * 1000)
            p_end = int(raw_segments[pid]["end"] * 1000)
            protected_windows.append((p_start, p_end))

    # Add explicit protected windows for Rachel /p/ and /b/ demonstrations
    protected_windows.extend(EXPLICIT_PROTECTED_WINDOWS)
    protected_windows = merge_windows(protected_windows)
    print(f"Total protected Rachel demonstration windows (merged): {len(protected_windows)}")

    # Process each semantic block
    for blk in semantic_blocks:
        seg_file_wav = os.path.join(seg_dir, f"seg_{blk['id']:03d}.wav")
        seg_file_mp3 = os.path.join(seg_dir, f"seg_{blk['id']:03d}.mp3")
        seg_file = seg_file_wav if os.path.exists(seg_file_wav) else seg_file_mp3
        if not os.path.exists(seg_file):
            continue

        chunk = AudioSegment.from_file(seg_file).set_frame_rate(SAMPLE_RATE).set_channels(2)
        start_ms = int(blk["start"] * 1000)
        end_ms = int(blk["end"] * 1000)
        target_ms = end_ms - start_ms
        chunk_ms = len(chunk)

        # Check upcoming protected window to ensure voiceover never bleeds into Rachel's demonstration
        next_prot_start = None
        for p_start, p_end in protected_windows:
            if p_start >= start_ms:
                next_prot_start = p_start
                break

        # Adaptive tempo stretch if speech exceeds target window OR would collide with protected drill
        max_allowed_ms = target_ms
        if next_prot_start is not None:
            max_allowed_ms = min(max_allowed_ms, max(next_prot_start - start_ms - 80, 200))

        if chunk_ms > max_allowed_ms and max_allowed_ms > 400:
            speed_ratio = min(chunk_ms / max_allowed_ms, 1.45)
            stretched_wav = os.path.join(seg_dir, f"seg_{blk['id']:03d}_str.wav")
            subprocess.run([
                "ffmpeg", "-y", "-i", seg_file,
                "-filter:a", f"atempo={speed_ratio:.3f}",
                "-ar", str(SAMPLE_RATE),
                stretched_wav
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            chunk = AudioSegment.from_file(stretched_wav).set_frame_rate(SAMPLE_RATE).set_channels(2)
            chunk_ms = len(chunk)

        # Hard guard: Ensure chunk strictly terminates with a smooth fade-out before next protected window
        if next_prot_start is not None and start_ms + chunk_ms > next_prot_start - 40:
            safe_len = max(next_prot_start - start_ms - 40, 100)
            chunk = chunk[:safe_len].fade_out(30)
            chunk_ms = len(chunk)

        # Calculate safe carving boundary so it never bleeds into any protected drill window
        max_mute_end = end_ms
        if next_prot_start is not None:
            max_mute_end = min(max_mute_end, next_prot_start)

        mute_end_ms = min(max_mute_end, start_ms + max(chunk_ms, target_ms))
        mute_len = mute_end_ms - start_ms

        if mute_len > 0 and start_ms < total_ms:
            silence_part = AudioSegment.silent(duration=mute_len, frame_rate=SAMPLE_RATE).set_channels(2)
            master_audio = master_audio[:start_ms] + silence_part + master_audio[start_ms + mute_len:]

        # Overlay the synthesized voiceover smoothly onto the digitally carved silent timeline
        master_audio = master_audio.overlay(chunk, position=start_ms)

    # Double-Lock Audio Shield: Guarantee 100% authentic original Rachel audio for all protected windows
    for p_start, p_end in protected_windows:
        if p_start < total_ms:
            p_end_safe = min(p_end, total_ms)
            master_audio = master_audio[:p_start] + orig_audio[p_start:p_end_safe] + master_audio[p_end_safe:]

    # Maintain exact video sync duration
    master_audio = master_audio[:total_ms]
    vo_master_path = os.path.join(WORK_DIR, f"master_carved_{engine_name}.wav")
    master_audio.export(vo_master_path, format="wav")
    print(f"Exported master carved audio: {vo_master_path} ({len(master_audio)/1000.0:.2f}s)")
    return vo_master_path


def step4_remux(video_path, vo_audio_path, engine_name):
    print(f">>> [4/5] Remuxing final video with carved audio (0% Rachel bleed)...")
    output_video = os.path.join(WORK_DIR, f"rachel_bp_voiceover_{engine_name}.mp4")

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", vo_audio_path,
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        output_video
    ]
    print(f"Running remux command: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    print(f">>> [5/5] Success! Deliverable video: {output_video}")
    return output_video

def main():
    parser = argparse.ArgumentParser(description="Rachel English Vietnamese Voiceover Pipeline")
    parser.add_argument("--engine", choices=["namminh", "hoaimy", "vieneu", "kokoro", "gtts"], default="namminh",
                        help="Select Vietnamese TTS voice engine (default: namminh)")
    parser.add_argument("--force", action="store_true", help="Force re-synthesis of all audio segments")
    args = parser.parse_args()

    print(f"==================================================")
    print(f"Starting Bilingual Voiceover Pipeline: {args.engine.upper()}")
    print(f"==================================================")

    video_path, srt_path = step1_download()
    semantic_blocks, raw_segments = parse_srt(srt_path)
    seg_dir = synthesize_tts(semantic_blocks, args.engine, force=args.force)
    vo_master_wav = assemble_carved_voiceover(video_path, semantic_blocks, raw_segments, args.engine, seg_dir)
    output_video = step4_remux(video_path, vo_master_wav, args.engine)

    print("\n==================================================")
    print("PIPELINE COMPLETE!")
    print(f"Engine: {args.engine}")
    print(f"Output Video: {output_video}")
    print("==================================================")

if __name__ == "__main__":
    main()
