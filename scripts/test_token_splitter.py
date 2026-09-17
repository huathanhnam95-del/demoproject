import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
import re

ENGLISH_TERMS = [
    "What's up?", "What's up", "nap time", "happen", "bring",
    "best", "spot", "rip", "pen", "BED", "FATHER", "EH", "AH",
    "P", "B", "R", "T"
]

# Sort terms by length descending so longer phrases match first
sorted_terms = sorted(ENGLISH_TERMS, key=len, reverse=True)
pattern = re.compile(r'(\b(?:' + '|'.join(re.escape(t) for t in sorted_terms) + r')\b)', re.IGNORECASE)

texts = [
    "hai phụ âm P và B.",
    "Âm P là âm vô thanh, nghĩa là chỉ có luồng hơi đi qua miệng.",
    "Còn âm B là âm hữu thanh, nghĩa là dây thanh quản rung lên để tạo ra âm thanh.",
    "Ví dụ, nếu âm tiếp theo là phụ âm R, lưỡi có thể lùi về sau và nâng lên cho âm R,",
    "trong khi môi khép lại để phát âm B: bring.",
    "Ví dụ trong từ: happen.",
    "Giai đoạn bật hơi là khi môi mở ra và luồng hơi thoát ra: pen, happen.",
    "Ví dụ như trong cụm từ quen thuộc: What's up?",
    "Một ví dụ khác: nap time!",
    "Tôi chặn hơi bằng môi, rồi chỉ bật hơi ra ở âm tiếp theo: phụ âm T.",
    "Từ 'best'.",
    "Hai môi mím lại rồi bật mở sang nguyên âm EH như trong từ BED.",
    "Từ 'spot'.",
    "Hai môi mím lại rồi bật mở sang nguyên âm AH như trong từ FATHER.",
    "Từ 'rip'.",
    "Các phụ âm P và B: best, spot, rip."
]

def split_bilingual(text):
    # Split text into tokens with language tags
    parts = []
    last_idx = 0
    for m in pattern.finditer(text):
        start, end = m.span()
        if start > last_idx:
            vi_text = text[last_idx:start]
            if vi_text.strip():
                parts.append(("vi", vi_text))
        en_word = m.group(1)
        parts.append(("en", en_word))
        last_idx = end
    if last_idx < len(text):
        vi_text = text[last_idx:]
        if vi_text.strip():
            parts.append(("vi", vi_text))
    return parts

for t in texts:
    p = split_bilingual(t)
    print(f"Original: {t}")
    print(f"  Tokens: {p}\n")
