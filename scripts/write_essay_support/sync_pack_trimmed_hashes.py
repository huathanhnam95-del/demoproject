#!/usr/bin/env python3
"""
Ensures all 453 packs have exact SHA-256 matches according to
write-essay-support.js runtime contract:
hash = sha256(file_content.trim())
File written strictly with LF line endings.
"""
import glob
import hashlib
import json
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

PACKS_DIR = Path('public/database/Write Essay/support/v1/packs')
MANIFEST_PATH = Path('public/database/Write Essay/support/v1/manifest.json')

with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
    manifest = json.load(f)

all_pack_files = glob.glob(str(PACKS_DIR / 'q*.json'))
print(f"Total packs found: {len(all_pack_files)}")

renamed_count = 0
for fpath_str in all_pack_files:
    fpath = Path(fpath_str)
    filename = fpath.name
    m = re.match(r'^q(\d{4})\.([a-f0-9]{16})\.json$', filename)
    if not m:
        continue

    q_num_str = m.group(1)
    qid_int = int(q_num_str)
    qid_key = str(qid_int)

    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Serialize strictly with LF
    raw_text = json.dumps(data, ensure_ascii=False, indent=2)
    # The client runtime computes hash of text.trim()
    trimmed_hash = hashlib.sha256(raw_text.strip().encode('utf-8')).hexdigest()
    new_filename = f"q{q_num_str}.{trimmed_hash[:16]}.json"
    new_fpath = PACKS_DIR / new_filename

    # Write file strictly with binary LF
    with open(new_fpath, 'wb') as f:
        f.write((raw_text + '\n').encode('utf-8'))

    if new_fpath.resolve() != fpath.resolve():
        fpath.unlink()
        renamed_count += 1

    # Update manifest entry
    if qid_key in manifest.get('questions', {}):
        manifest['questions'][qid_key]['url'] = f"/database/Write Essay/support/v1/packs/{new_filename}"
        manifest['questions'][qid_key]['sha256'] = trimmed_hash

with open(MANIFEST_PATH, 'wb') as f:
    f.write((json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))

print(f"Sync complete! Renamed/verified {renamed_count} files.")

# Final audit of all 453 packs
all_files = glob.glob(str(PACKS_DIR / 'q*.json'))
assert len(all_files) == 453, f"Expected 453 files, found {len(all_files)}"

mismatch = 0
for qid_key, entry in manifest.get('questions', {}).items():
    p = 'public' + entry['url']
    if not os.path.exists(p):
        print(f"Missing file: {p}")
        mismatch += 1
        continue
    with open(p, 'r', encoding='utf-8') as f:
        content = f.read()
    h = hashlib.sha256(content.strip().encode('utf-8')).hexdigest()
    if h != entry['sha256']:
        print(f"Hash mismatch for q{qid_key}: computed {h} != manifest {entry['sha256']}")
        mismatch += 1

print(f"Final Hash Audit: {mismatch} mismatches out of {len(manifest['questions'])} questions.")
assert mismatch == 0, "Integrity check failed!"
print("✅ ALL 453 PACKS HAVE 100% PERFECT SHA-256 INTEGRITY!")
