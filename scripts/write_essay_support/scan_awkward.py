import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/all_832_draft_vi.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

# Patterns that indicate literal or awkward translations in Vietnamese
checks = [
    ('cơ thể', 'literal body'),
    ('kỷ luật', 'literal discipline'),
    ('lãi suất', 'literal interest'),
    ('tài khoản', 'literal account'),
    ('thử thách hiện tại', 'literal present challenge'),
    ('tiếp xúc cơ thể', 'awkward physical contact'),
    ('thực vật', 'literal plant'),
    ('bữa tiệc', 'literal party'),
    ('cánh tay', 'literal arm'),
    ('quyền thực thi', 'inverted exercise authority'),
    ('hành tinh', 'planet'),
    ('bản sao', 'copy'),
    ('vận động viên', 'athlete'),
    ('khoáng sản', 'mineral'),
]

for pat, desc in checks:
    for k, v in d.items():
        if pat in v.lower():
            print(f"[{desc}] {k:30} -> {v}")
