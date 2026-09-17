import os
import json
import re
import openpyxl
import sys

sys.stdout.reconfigure(encoding='utf-8')

print("==================================================================")
print("RUNNING CROSS-MODE DATA QUALITY & CONTROLLER VERIFICATION SUITE")
print("==================================================================")

failures = []

# 1. CJK Scan in ASQ, Question Bank, Backup, Essay, and RFIB metadata
print("\n[CHECK 1] CJK Scan Verification:")
cjk_pattern = re.compile(r'[\u4e00-\u9fff]')

asq_files = [
    ('ASQ.xlsx', 'public/database/quiz/ASQ/ASQ.xlsx'),
    ('question_bank_data.xlsm', 'public/database/question_bank_data.xlsm'),
    ('ASQ_backup.xlsx', 'public/database/quiz/ASQ/ASQ_backup_20260729_110356.xlsx')
]

for name, path in asq_files:
    wb = openpyxl.load_workbook(path, data_only=True)
    cjk_count = 0
    for sname in wb.sheetnames:
        ws = wb[sname]
        for r in range(1, ws.max_row + 1):
            for c in range(1, ws.max_column + 1):
                v = ws.cell(row=r, column=c).value
                if v and isinstance(v, str) and '\u4e00' in v:
                    cjk_count += 1
    if cjk_count == 0:
        print(f"  PASS: {name} has 0 stray Chinese numeral (U+4E00)")
    else:
        failures.append(f"{name} has {cjk_count} instances of U+4E00")
        print(f"  FAIL: {name} has {cjk_count} instances of U+4E00")

# Essay Row 369
wb_essay = openpyxl.load_workbook('public/database/Write Essay/ESSAY/Essay.xlsx', data_only=True)
ws_essay = wb_essay.active
essay_val = ws_essay.cell(row=369, column=2).value
if essay_val == 'The Role of Examinations in Education':
    print(f"  PASS: Essay Row 369 Col 2 title is '{essay_val}'")
else:
    failures.append(f"Essay Row 369 Col 2 is '{essay_val}' (expected 'The Role of Examinations in Education')")
    print(f"  FAIL: Essay Row 369 Col 2 is '{essay_val}'")

# RFIB review-metadata.json
with open('public/database/RFIB/review-metadata.json', 'r', encoding='utf-8') as f:
    rfib_data = json.load(f)
rfib_str = json.dumps(rfib_data, ensure_ascii=False)
rfib_cjk = cjk_pattern.findall(rfib_str)
if len(rfib_cjk) == 0:
    print(f"  PASS: RFIB review-metadata.json has 0 CJK characters")
else:
    failures.append(f"RFIB review-metadata.json has {len(rfib_cjk)} CJK characters")
    print(f"  FAIL: RFIB review-metadata.json has {len(rfib_cjk)} CJK characters")

# 2. BOM Check
print("\n[CHECK 2] Collocations UTF-8 BOM Check:")
with open('public/collocations.json', 'rb') as f:
    header = f.read(3)
if header != b'\xef\xbb\xbf':
    print("  PASS: public/collocations.json does not contain BOM")
else:
    failures.append("public/collocations.json has UTF-8 BOM")
    print("  FAIL: public/collocations.json has UTF-8 BOM")

with open('public/collocations.json', 'r', encoding='utf-8') as f:
    collo_data = json.load(f)
print(f"  PASS: collocations.json parsed cleanly with {len(collo_data)} keys")

# 3. Zip Archives Check
print("\n[CHECK 3] Redundant Zip Archives Check:")
zips = []
for root, _, files in os.walk('public/database'):
    for file in files:
        if file.lower().endswith('.zip'):
            zips.append(os.path.join(root, file))
if len(zips) == 0:
    print("  PASS: 0 legacy .zip files found in public/database/")
else:
    failures.append(f"Found {len(zips)} unexpected .zip files in public/database/")
    print(f"  FAIL: Found {len(zips)} .zip files")

# 4. Persona Boilerplate Check across 7 modes
print("\n[CHECK 4] Persona Boilerplate Scrub Verification:")
persona_targets = [
    'hello! as your pte', 'hello there!', 'premium pte teacher', 'as a premium pte',
    'understanding cohesive links', 'pte listening mastery', 'pte expert analysis',
    'pte deep dive', 'pte teacher analysis', 'as a pte academic expert',
    'as your premium pte', 'pte listening deep dive', 'pte mastery tip'
]
target_workbooks = [
    ('ROP', 'public/database/ROP/ROP/ROP.xlsx'),
    ('HIW', 'public/database/Highlight Incorrect Words/HIW/HIW.xlsx'),
    ('LMCMA', 'public/database/LMCMA/LMCMA/LMCMA.xlsx'),
    ('SMW', 'public/database/SMW/SMW/SMW.xlsx'),
    ('LMCSA', 'public/database/LMCSA/LMCSA/LMCSA.xlsx'),
    ('RMCMA', 'public/database/RMCMA/RMCMA/RMCMA.xlsx'),
    ('RMCSA', 'public/database/RMCSA/RMCSA/RMCSA.xlsx')
]

for mode, path in target_workbooks:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    exp_col = headers.index('EXPLANATION') + 1
    found = 0
    for r in range(2, ws.max_row + 1):
        v = ws.cell(row=r, column=exp_col).value
        if v and isinstance(v, str):
            lower = v[:250].lower()
            if any(t in lower for t in persona_targets):
                found += 1
    if found == 0:
        print(f"  PASS: [{mode}] 0 persona greetings detected across all {ws.max_row - 1} rows")
    else:
        failures.append(f"[{mode}] has {found} rows with persona boilerplate")
        print(f"  FAIL: [{mode}] has {found} rows with persona boilerplate")

# 5. Describe Image Key Points Validation
print("\n[CHECK 5] Describe Image Key Points Check:")
with open('public/database/Describe Image/describe-image-questions.json', 'r', encoding='utf-8') as f:
    di_questions = json.load(f)

di_empty_kp = [q['id'] for q in di_questions if not q.get('keyPoints') or len(q['keyPoints']) == 0]
if len(di_empty_kp) == 0:
    print(f"  PASS: 100% ({len(di_questions)}/{len(di_questions)}) Describe Image questions have keyPoints populated")
else:
    failures.append(f"{len(di_empty_kp)} DI questions missing keyPoints")
    print(f"  FAIL: {len(di_empty_kp)} DI questions missing keyPoints")

# 6. RTS Reference Model Validation
print("\n[CHECK 6] RTS Reference Models Check:")
with open('public/database/RTS/rts_questions.json', 'r', encoding='utf-8') as f:
    rts_questions = json.load(f)

rts_missing = [q['id'] for q in rts_questions if not q.get('sampleResponse') or not q['sampleResponse'].get('full') or not q['sampleResponse'].get('simplified')]
if len(rts_missing) == 0:
    print(f"  PASS: 100% ({len(rts_questions)}/{len(rts_questions)}) RTS questions have sampleResponse {{\"full\", \"simplified\"}}")
else:
    failures.append(f"{len(rts_missing)} RTS questions missing full/simplified sampleResponse")
    print(f"  FAIL: {len(rts_missing)} RTS questions missing sampleResponse")

print("\n==================================================================")
if not failures:
    print("ALL 6 VERIFICATION SUITES PASSED! ZERO DEFECTS FOUND.")
else:
    print(f"FAILED WITH {len(failures)} DEFECTS:")
    for fail in failures:
        print(" - ", fail)
print("==================================================================")
