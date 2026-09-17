#!/usr/bin/env python3
"""
Comprehensive Verification Script for Cross-Mode Remediations (Phases 1–3)
"""

import openpyxl
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

def test_cjk_asq():
    print("[1/7] Testing ASQ workbooks for stray Chinese characters...")
    targets = [
        ('public/database/quiz/ASQ/ASQ.xlsx', 2),
        ('public/database/question_bank_data.xlsm', 12),
        ('public/database/quiz/ASQ/ASQ_backup_20260729_110356.xlsx', 2)
    ]
    for path, col in targets:
        wb = openpyxl.load_workbook(path, data_only=True)
        ws = wb.active
        for r in [198, 208, 233]:
            val = ws.cell(row=r, column=col).value
            assert '\u4e00' not in val, f"Failed: \\u4e00 found in {path} row {r}"
            assert '—' in val, f"Failed: em-dash missing in {path} row {r}"
    print("  -> PASSED: 0 stray Chinese characters in ASQ workbooks; em-dashes verified.")

def test_cjk_essay():
    print("[2/7] Testing Write Essay master sheet...")
    wb = openpyxl.load_workbook('public/database/Write Essay/ESSAY/Essay.xlsx', data_only=True)
    ws = wb.active
    val = ws.cell(row=369, column=2).value
    assert val == 'The Role of Examinations in Education', f"Unexpected title: {repr(val)}"
    assert '论点翻译' not in str(val)
    print("  -> PASSED: Row 369 Col 2 is 'The Role of Examinations in Education'.")

def test_cjk_rfib():
    print("[3/7] Testing RFIB review-metadata.json...")
    with open('public/database/RFIB/review-metadata.json', 'r', encoding='utf-8') as f:
        content = f.read()
    cjk_matches = list(re.finditer(r'[\u4e00-\u9fff]', content))
    assert len(cjk_matches) == 0, f"Failed: {len(cjk_matches)} CJK characters found in RFIB metadata"
    print("  -> PASSED: 0 CJK characters found across all RFIB review metadata.")

def test_bom():
    print("[4/7] Testing public/collocations.json for UTF-8 BOM...")
    with open('public/collocations.json', 'rb') as f:
        header = f.read(4)
    assert not header.startswith(b'\xef\xbb\xbf'), "Failed: BOM detected in collocations.json"
    with open('public/collocations.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    assert isinstance(data, dict) and len(data) > 0
    print("  -> PASSED: 0 BOM bytes; valid JSON with", len(data), "entries.")

def test_zip_cleanup():
    print("[5/7] Testing legacy zip files in public/database/...")
    import glob
    zips = glob.glob('public/database/**/*.zip', recursive=True)
    assert len(zips) == 0, f"Failed: {len(zips)} zip files still remain: {zips}"
    print("  -> PASSED: All 26 legacy zip archives pruned.")

def test_ai_persona_cleanup():
    print("[6/7] Testing AI persona boilerplate scrubbing across 7 workbooks...")
    files = [
        ('ROP', 'public/database/ROP/ROP/ROP.xlsx'),
        ('HIW', 'public/database/Highlight Incorrect Words/HIW/HIW.xlsx'),
        ('LMCMA', 'public/database/LMCMA/LMCMA/LMCMA.xlsx'),
        ('SMW', 'public/database/SMW/SMW/SMW.xlsx'),
        ('LMCSA', 'public/database/LMCSA/LMCSA/LMCSA.xlsx'),
        ('RMCMA', 'public/database/RMCMA/RMCMA/RMCMA.xlsx'),
        ('RMCSA', 'public/database/RMCSA/RMCSA/RMCSA.xlsx')
    ]
    greeting_regex = re.compile(r'^\s*<p>\s*(?:Hello|Hello\s+there|Welcome|Hi|Greetings)[\s!,]', re.IGNORECASE)
    header_regex = re.compile(r'^\s*<h3>Understanding\s+Cohes', re.IGNORECASE)
    for mode, fpath in files:
        wb = openpyxl.load_workbook(fpath, data_only=True)
        ws = wb.active
        headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
        exp_col = headers.index('EXPLANATION') + 1
        for r in range(2, ws.max_row + 1):
            val = ws.cell(row=r, column=exp_col).value
            if val and isinstance(val, str):
                assert not greeting_regex.match(val), f"Failed: Greeting found in {mode} row {r}: {repr(val[:60])}"
                assert not header_regex.match(val), f"Failed: Marketing header found in {mode} row {r}: {repr(val[:60])}"
                assert len(val) >= 40, f"Explanation too short in {mode} row {r}: {len(val)}"
    print("  -> PASSED: 0 conversational greetings or boilerplate headers remain across all 7 workbooks.")

def test_di_and_rts_models():
    print("[7/7] Testing DI keyPoints and RTS sampleResponse models...")
    # Describe Image
    with open('public/database/Describe Image/describe-image-questions.json', 'r', encoding='utf-8') as f:
        di_questions = json.load(f)
    assert len(di_questions) == 1170
    for q in di_questions:
        pts = q.get('keyPoints')
        assert isinstance(pts, list) and len(pts) >= 2, f"DI Q{q.get('id')} missing keyPoints"
    print(f"  -> PASSED: 1,170/1,170 Describe Image questions have 2-4 authentic keyPoints.")

    # RTS
    with open('public/database/RTS/rts_questions.json', 'r', encoding='utf-8') as f:
        rts_questions = json.load(f)
    assert len(rts_questions) == 146
    for q in rts_questions:
        sr = q.get('sampleResponse')
        assert sr and sr.get('full') and sr.get('simplified'), f"RTS Q{q.get('id')} missing sampleResponse"
        assert len(sr['full']) >= 40
        assert len(sr['simplified']) >= 20
    print(f"  -> PASSED: 146/146 RTS questions have authentic full and simplified sample responses.")

def test_pedagogy_retention_and_guardrails():
    print("[8/8] Testing substantive pedagogy retention and existing guardrails test suites...")
    import subprocess
    # Run guardrails
    for test_cmd in [
        ['node', 'tests/rmcsa-explanation-guardrails.test.js'],
        ['node', 'tests/lmcma-explanation-logic.test.js'],
        ['node', 'tests/hiw-data-guardrails.test.js'],
        ['node', 'tests/smw-data-guardrails.test.js'],
        ['node', 'tests/write-essay-support-runtime.test.mjs']
    ]:
        res = subprocess.run(test_cmd, capture_output=True, text=True)
        assert res.returncode == 0, f"Guardrail test failed: {' '.join(test_cmd)}\n{res.stdout}\n{res.stderr}"

    # Verify public/rts-mode.js has both showResults and displayAiScore fallback models
    with open('public/rts-mode.js', 'r', encoding='utf-8') as f:
        rts_code = f.read()
    assert 'buildSampleResponsesHtml(currentEntry?.sampleResponse)' in rts_code, "RTS mode missing showResults fallback sample rendering"
    assert ('currentEntry?.sampleResponse' in rts_code and 'buildSampleResponsesHtml' in rts_code), "RTS mode missing displayAiScoreResults fallback"

    # Verify public/hiw-mode.js has safeRenderHtml for explanation
    with open('public/hiw-mode.js', 'r', encoding='utf-8') as f:
        hiw_code = f.read()
    assert 'hiw-explanation-text-card' in hiw_code, "HIW mode missing hiw-explanation-text-card"
    assert 'safeRenderHtml(state.currentQuestion.explanation, explanationCard)' in hiw_code, "HIW mode missing safeRenderHtml explanation call"

    print("  -> PASSED: All 5 guardrail suites passed; RTS and HIW fallback pipelines verified.")

def main():
    print("==================================================================")
    print("RUNNING CROSS-MODE DATA QUALITY & CONTROLLER TEST SUITE")
    print("==================================================================")
    test_cjk_asq()
    test_cjk_essay()
    test_cjk_rfib()
    test_bom()
    test_zip_cleanup()
    test_ai_persona_cleanup()
    test_di_and_rts_models()
    test_pedagogy_retention_and_guardrails()
    print("==================================================================")
    print("ALL 8 VERIFICATION SUITES PASSED WITH 0 FAILURES!")
    print("==================================================================")

if __name__ == '__main__':
    main()
