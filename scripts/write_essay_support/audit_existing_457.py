import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/academic_collocation_glossary.json', 'r', encoding='utf-8') as f:
    g = json.load(f)

print(f"Total existing: {len(g)}")

# Suspicious keywords in Vietnamese
bad_keywords = [
    'cơ thể', 'thực vật', 'bữa tiệc', 'cánh đồng', 'cánh tay', 'chân',
    'kỷ luật', 'giường', 'phòng', 'chạy', 'thả', 'ném', 'bắt', 'đánh'
]

flagged = []
for k, v in g.items():
    vi = v.get('viGloss', '')
    for b in bad_keywords:
        if b in vi.lower():
            flagged.append((k, vi, b))

print(f"Flagged {len(flagged)} potentially literal translations in existing 457:")
for k, vi, b in flagged:
    print(f"  {k:28} -> {vi} (flagged by '{b}')")
