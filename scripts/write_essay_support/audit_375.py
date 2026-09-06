import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/raw_translated_375.json', 'r', encoding='utf-8') as f:
    trans = json.load(f)

# Problematic patterns
checks = [
    ('kỷ luật', 'discipline -> ngành học / chuyên ngành'),
    ('cơ thể', 'body -> cơ quan / tổ chức'),
    ('bữa tiệc', 'party -> các bên / đảng phái'),
    ('tiệc', 'party'),
    ('cánh tay', 'arm -> vũ trang'),
    ('bài tập', 'exercise -> thực thi / áp dụng'),
    ('địa chỉ', 'address -> giải quyết / xử lý'),
    ('hạnh kiểm', 'conduct -> tiến hành / thực hiện'),
    ('vẽ', 'draw -> rút ra'),
    ('tạo dáng', 'pose -> đặt ra / gây ra nguy cơ'),
    ('đúc', 'cast -> đặt ra / dấy lên nghi ngờ'),
    ('chạy', 'run / operate'),
    ('giường', 'bed'),
    ('phòng', 'room -> dư địa / không gian'),
    ('ném', 'throw / cast'),
    ('rơi', 'fall'),
    ('bắt', 'catch / arrest'),
    ('đập', 'beat / strike'),
    ('thịt', 'flesh / meat'),
    ('cỏ', 'grass / weed'),
    ('hoa', 'flower / bloom'),
]

flagged = []
for k, v in sorted(trans.items()):
    for pat, desc in checks:
        if pat in v.lower():
            flagged.append((k, v, desc))

print(f"Total flagged out of 375: {len(flagged)}")
for k, v, desc in flagged:
    print(f"  {k:30} -> {v} ({desc})")
