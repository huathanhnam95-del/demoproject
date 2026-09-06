#!/usr/bin/env python3
import sys
import glob
import json
import hashlib
import re
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
PACKS_DIR = Path('public/database/Write Essay/support/v1/packs')
MANIFEST_PATH = Path('public/database/Write Essay/support/v1/manifest.json')

with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
    manifest = json.load(f)

all_files = glob.glob(str(PACKS_DIR / 'q*.json'))
print(f"Total pack files on disk: {len(all_files)}")
assert len(all_files) == 453, f"Expected 453 files, found {len(all_files)}"
assert len(manifest['questions']) == 453, f"Expected 453 questions in manifest, found {len(manifest['questions'])}"

p_vocab = 0
p_colloc = 0
p_hotro = 0
p_tranhcau = 0
p_chinese = 0
p_literal = 0
p_hash_mismatch = 0
total_colloc_checked = 0

literal_bad_patterns = [
    'cơ thể chuyên nghiệp',
    'cơ thể quản lý',
    'kỷ luật học thuật',
    'kỹ năng chuyển nhượng',
    'thử thách hiện tại',
    'tài khoản ngắn gọn',
    'lãi suất đáng kể'
]

for fpath_str in all_files:
    fpath = Path(fpath_str)
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
        d = json.loads(content)

    # Check hash
    trimmed_sha = hashlib.sha256(content.strip().encode('utf-8')).hexdigest()
    m = re.match(r'^q(\d{4})\.([a-f0-9]{16})\.json$', fpath.name)
    assert m, f"Filename pattern mismatch: {fpath.name}"
    qid_key = str(int(m.group(1)))
    manifest_entry = manifest['questions'].get(qid_key)
    if not manifest_entry or manifest_entry['sha256'] != trimmed_sha:
        p_hash_mismatch += 1

    # Check hardVocab
    for v in d.get('common', {}).get('hardVocabulary', []):
        if 'Từ quan trọng trong đề' in v.get('viGloss', ''):
            p_vocab += 1
            break

    # Check collocations across all 3 levels
    for lvl in ['a2_b1', 'b2', 'c1']:
        for c in d.get('levels', {}).get(lvl, {}).get('languageKit', {}).get('collocations', []):
            total_colloc_checked += 1
            vi = c.get('viGloss', '')
            en = c.get('enGloss', '')
            if 'Cụm kết hợp từ tự nhiên' in vi or 'Natural academic collocation' in en:
                p_colloc += 1
            if any(bad in vi.lower() for bad in literal_bad_patterns):
                p_literal += 1

    # Check calque
    raw_str = json.dumps(d, ensure_ascii=False)
    if 'Hỗ trợ quan điểm' in raw_str:
        p_hotro += 1
    if 'Tránh câu chung học thuộc' in raw_str:
        p_tranhcau += 1
    if any('\u4e00' <= ch <= '\u9fff' for ch in raw_str):
        p_chinese += 1

print(f"Total collocations examined across all 3 levels: {total_colloc_checked}")
print(f"Placeholder hardVocab instances: {p_vocab}")
print(f"Placeholder collocation gloss instances: {p_colloc}")
print(f"Literal translation error instances: {p_literal}")
print(f"Hỗ trợ quan điểm instances: {p_hotro}")
print(f"Tránh câu chung học thuộc instances: {p_tranhcau}")
print(f"Chinese characters instances: {p_chinese}")
print(f"SHA-256 hash mismatches against manifest: {p_hash_mismatch}")

assert p_vocab == 0, f"Placeholder hardVocab detected: {p_vocab}"
assert p_colloc == 0, f"Placeholder collocations detected: {p_colloc}"
assert p_literal == 0, f"Literal translation errors detected: {p_literal}"
assert p_hotro == 0, f"Hỗ trợ quan điểm detected: {p_hotro}"
assert p_tranhcau == 0, f"Tránh câu chung học thuộc detected: {p_tranhcau}"
assert p_chinese == 0, f"Chinese characters detected: {p_chinese}"
assert p_hash_mismatch == 0, f"Hash mismatch detected: {p_hash_mismatch}"
print("🎉 AUDIT COMPLETE: ALL QUALITY GATES PASSED (100% PERFECT)!")
