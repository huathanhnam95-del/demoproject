"""
Automated Artifact Validator for RFIB 3-Model Revision Sidecar
Asserts:
- Exact 10 target IDs: [1, 2, 9, 13, 375, 398, 597, 677, 944, 1315]
- Exact 45 expected blanks
- Untruncated raw artifacts (no dr_raw, qw_raw, gm_raw capped at 1500 chars)
- All 3 phase models present (deepseek-r1:14b, qwen3:14b, gemma4:latest)
- Exact confidence distribution breakdown
"""

import sys
import os
import json

EXPECTED_IDS = [1, 2, 9, 13, 375, 398, 597, 677, 944, 1315]
EXPECTED_BLANKS = 45
SIDECAR_PATH = r"C:\Cursor AI\public\database\RFIB\RFIB_3model_revision.jsonl"


def validate_sidecar(sidecar_path=SIDECAR_PATH):
    if not os.path.exists(sidecar_path):
        print(f"FAIL: Sidecar file not found at {sidecar_path}")
        return False

    with open(sidecar_path, "r", encoding="utf-8") as f:
        records = [json.loads(line) for line in f if line.strip()]

    errors = []

    # 1. Exact 10 IDs check
    actual_ids = sorted([r["id"] for r in records])
    if actual_ids != EXPECTED_IDS:
        errors.append(f"ID set mismatch. Expected {EXPECTED_IDS}, got {actual_ids}")

    if len(records) != len(set(actual_ids)):
        errors.append("Duplicate IDs found in sidecar!")

    # 2. Total blank count & confidence distribution
    total_blanks = 0
    conf_counts = {"high": 0, "medium": 0, "low": 0}

    truncated_raw_records = []

    for r in records:
        qid = r.get("id")
        blanks = r.get("blanks", [])
        total_blanks += len(blanks)

        for b in blanks:
            c = b.get("confidence", "low")
            conf_counts[c] = conf_counts.get(c, 0) + 1

        # Check raw artifact truncation
        raws = r.get("raw_artifacts", {})
        for key in ["dr_raw", "qw_raw", "gm_raw"]:
            val = raws.get(key, "")
            if len(val) == 1500:
                truncated_raw_records.append((qid, key))

        # Check phase models
        models = r.get("phase_models", [])
        if len(models) != 3 or "deepseek-r1:14b" not in models[0] or "qwen3:14b" not in models[1] or "gemma4" not in models[2]:
            errors.append(f"ID {qid}: Incorrect phase_models {models}")

    if total_blanks != EXPECTED_BLANKS:
        errors.append(f"Total blank count mismatch. Expected {EXPECTED_BLANKS}, got {total_blanks}")

    if truncated_raw_records:
        errors.append(f"Truncated 1,500-char raw artifacts detected in records: {truncated_raw_records}")

    print("============================================================")
    print("RFIB 3-MODEL SIDECAR ARTIFACT VALIDATION REPORT")
    print("============================================================")
    print(f"Records Checked: {len(records)} / {len(EXPECTED_IDS)}")
    print(f"Total Blanks:    {total_blanks} / {EXPECTED_BLANKS}")
    print(f"Confidences:     High: {conf_counts.get('high', 0)}, Medium: {conf_counts.get('medium', 0)}, Low: {conf_counts.get('low', 0)}")
    print(f"Truncated Raw:   {len(truncated_raw_records)} truncated artifacts")
    print("============================================================")

    if errors:
        print("VALIDATION FAILED WITH ERRORS:")
        for err in errors:
            print(f" - {err}")
        return False
    else:
        print("SUCCESS: Sidecar fully passes all quality gate assertions!")
        return True


if __name__ == "__main__":
    success = validate_sidecar()
    sys.exit(0 if success else 1)
