import os
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
import re

SRT_PATH = "workspace_rachel_voiceover/video.en-6Pw-d3P9U40.srt"

def parse_srt(srt_path):
    with open(srt_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read().replace("\r\n", "\n")
    blocks = [b.strip() for b in content.split("\n\n") if b.strip()]
    segments = []
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
                segments.append({
                    "id": idx,
                    "start": s,
                    "end": e,
                    "duration": round(e - s, 3),
                    "en_text": text
                })
    return {s["id"]: s for s in segments}

srt_map = parse_srt(SRT_PATH)

# Merged definition: (start_id, end_id, vi_text)
MERGED_BLOCKS = [
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
    # 23: Rachel 'What's up?' demo (124.74 -> 127.06)
    (24, 24, "Một ví dụ khác: nap time!"),
    # 25: Rachel 'Nap---time!' demo (131.28 -> 135.01)
    (26, 26, "Môi tôi mím lại cho âm P, nhưng không bật hơi ra."),
    (27, 27, "Tôi chặn hơi bằng môi, rồi chỉ bật hơi ra ở âm tiếp theo: phụ âm T."),
    # 28: Rachel 'Nap time.' demo (147.30 -> 149.42)
    (29, 29, "Hãy cùng quan sát một số từ ở cự ly gần và quay chậm."),
    (30, 30, "Từ 'best'."),
    (31, 31, "Hai môi mím lại rồi bật mở sang nguyên âm EH như trong từ BED."),
    (32, 32, "Từ 'spot'."),
    (33, 33, "Hai môi mím lại rồi bật mở sang nguyên âm AH như trong từ FATHER."),
    (34, 34, "Từ 'rip'."),
    (35, 35, "Hai môi mím chặt lại rồi bật mở ra."),
    (36, 36, "Các phụ âm P và B: best, spot, rip."),
    (37, 37, "Các từ ví dụ. Hãy nhắc lại theo tôi:")
    # 38-43: Rachel repetition drills (194.48 -> 237.89)
]

print(f"{'Block':<10} | {'Start':<8} | {'End':<8} | {'Window':<8} | Text Preview")
print("-" * 75)
for s_id, e_id, text in MERGED_BLOCKS:
    start = srt_map[s_id]["start"]
    end = srt_map[e_id]["end"]
    win = round(end - start, 3)
    blk_str = f"#{s_id}" if s_id == e_id else f"#{s_id}-#{e_id}"
    print(f"{blk_str:<10} | {start:<8.2f} | {end:<8.2f} | {win:<8.2f}s | {text[:38]}...")
