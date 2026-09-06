import glob
import json
import sys
import re
import hashlib
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

packs = sorted(glob.glob('public/database/Write Essay/support/v1/packs/q*.json'))
print(f"Found {len(packs)} packs on disk.")

with open('public/database/Write Essay/support/v1/manifest.json', 'r', encoding='utf-8') as f:
    manifest = json.load(f)

bad_colloc_strings = [
    'cụm kết hợp từ tự nhiên giúp tăng tính học thuật',
    'natural academic collocation',
    'cơ thể chuyên nghiệp',
    'cơ thể quản lý',
    'cơ thể quốc tế',
    'kỷ luật học thuật',
    'kỹ năng chuyển nhượng',
    'thử thách hiện tại',
    'tài khoản ngắn gọn',
    'lãi suất đáng kể',
    'bữa tiệc chính trị',
    'tạo dáng thử thách',
    'vẽ kết luận'
]

errors = []
total_collocs = 0
distinct_collocs_found = set()
crlf_count = 0
hash_mismatch_count = 0
empty_gloss_count = 0
bad_pattern_count = 0

for p in packs:
    with open(p, 'rb') as f:
        raw_bytes = f.read()
    
    # Check CRLF
    if b'\r\n' in raw_bytes:
        crlf_count += 1
        errors.append(f"{p}: contains CRLF line endings!")

    raw_text = raw_bytes.decode('utf-8')
    d = json.loads(raw_text)
    
    # Check filename & manifest hash
    fname = Path(p).name
    m = re.match(r'^q(\d{4})\.([a-f0-9]{16})\.json$', fname)
    if not m:
        errors.append(f"{p}: invalid filename pattern")
        continue
    
    qid_num = int(m.group(1))
    fname_hash = m.group(2)
    calc_hash = hashlib.sha256(raw_text.strip().encode('utf-8')).hexdigest()
    
    if calc_hash[:16] != fname_hash:
        hash_mismatch_count += 1
        errors.append(f"{p}: filename hash {fname_hash} != calculated {calc_hash[:16]}")
    
    manifest_entry = manifest['questions'].get(str(qid_num))
    if not manifest_entry:
        hash_mismatch_count += 1
        errors.append(f"{p}: question {qid_num} missing in manifest")
    elif manifest_entry['sha256'] != calc_hash:
        hash_mismatch_count += 1
        errors.append(f"{p}: manifest sha256 mismatch")
    elif manifest_entry['url'] != f"/database/Write Essay/support/v1/packs/q{m.group(1)}.{calc_hash[:16]}.json":
        hash_mismatch_count += 1
        errors.append(f"{p}: manifest url mismatch")

    # Check collocations
    for lvl in ['a2_b1', 'b2', 'c1']:
        for c in d.get('levels', {}).get(lvl, {}).get('languageKit', {}).get('collocations', []):
            total_collocs += 1
            t = c.get('term', '').strip().lower()
            distinct_collocs_found.add(t)
            vi = c.get('viGloss', '')
            en = c.get('enGloss', '')
            
            if not vi or len(vi.strip()) == 0:
                empty_gloss_count += 1
                errors.append(f"{p} {lvl} {t}: empty viGloss")
            if not en or len(en.strip()) == 0:
                empty_gloss_count += 1
                errors.append(f"{p} {lvl} {t}: empty enGloss")
                
            for bad in bad_colloc_strings:
                if bad in vi.lower() or bad in en.lower():
                    bad_pattern_count += 1
                    errors.append(f"{p} {lvl} {t}: bad pattern '{bad}' in gloss")

print(f"Total collocations scanned across all 3 levels: {total_collocs}")
print(f"Distinct collocation terms found across packs: {len(distinct_collocs_found)}")
print(f"CRLF files: {crlf_count}")
print(f"Hash mismatches: {hash_mismatch_count}")
print(f"Empty glosses: {empty_gloss_count}")
print(f"Bad translation patterns: {bad_pattern_count}")
print(f"Total errors: {len(errors)}")

if errors:
    print("Sample errors:")
    for e in errors[:20]:
        print("  ", e)
else:
    print("ALL 453 PACKS PASSED DEEP VERIFICATION WITH ZERO ERRORS!")
