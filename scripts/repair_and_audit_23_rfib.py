# repair_and_audit_23_rfib.py — Edge-Case Pipeline for RFIB (1,105 -> 1,128)
#
# Processes the 23 missing question IDs through:
# 1. 3-Model Revision (DeepSeek-R1 -> Qwen3 -> Gemma4) with distractor analyses.
# 2. 3-Model Judicial Audit & Debate Loop.
# 3. Incremental export to public/database/RFIB/review-metadata.json.

import os
import sys
import json
import time
import logging
from datetime import datetime, timezone

# Ensure project root is in sys.path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)

import scripts.revise_rfib_explanations as rev
import scripts.audit_rfib_explanations as aud
from scripts.export_rfib_audit_files import update_review_metadata, load_sidecar, REVIEW_METADATA_PATH

TARGET_MISSING_IDS = [
    153, 237, 572, 596, 644, 674, 704, 736, 813, 826,
    831, 919, 923, 973, 1036, 1061, 1082, 1132, 1165,
    1173, 1175, 1181, 1255
]

REVISION_JSONL = r"public/database/RFIB/RFIB_3model_revision.jsonl"
AUDITED_JSONL = r"public/database/RFIB/RFIB_audited_full.jsonl"
WORKBOOK_PATH = r"public/database/RFIB/RFIB Final ver.xlsx"
EXISTING_JSONL = r"public/database/RFIB/RFIB_cohesion_enrichment.jsonl"


def main():
    logging.info(f"=== Starting RFIB Edge-Case Repair for {len(TARGET_MISSING_IDS)} Questions ===")
    
    # Load sources
    logging.info("Loading Excel workbook data...")
    wb_data = rev.load_workbook_data(WORKBOOK_PATH)
    logging.info(f"  Workbook loaded: {len(wb_data)} questions")

    logging.info("Loading existing enrichment data...")
    existing_data = rev.load_existing_explanations(EXISTING_JSONL)
    logging.info(f"  Enrichment data loaded: {len(existing_data)} questions")

    # Load existing records
    revision_records = rev.load_sidecar(REVISION_JSONL)
    logging.info(f"  Existing revision records: {len(revision_records)}")

    audited_records = aud.load_jsonl(AUDITED_JSONL)
    logging.info(f"  Existing audited records: {len(audited_records)}")

    # Filter targets
    remaining_ids = [qid for qid in TARGET_MISSING_IDS if qid not in audited_records]
    logging.info(f"Questions remaining to process: {len(remaining_ids)} / {len(TARGET_MISSING_IDS)}")

    if not remaining_ids:
        logging.info("All 23 edge-case questions are already audited! Syncing review-metadata.json...")
        update_review_metadata(load_sidecar(AUDITED_JSONL), REVIEW_METADATA_PATH)
        logging.info("Sync complete. 1,128 questions live.")
        return

    for idx, qid in enumerate(remaining_ids, start=1):
        logging.info("\n=======================================================")
        logging.info(f"Processing Edge-Case Question {qid} ({idx}/{len(remaining_ids)})")
        logging.info("=======================================================")

        q_info = wb_data.get(qid)
        if not q_info:
            logging.error(f"Question {qid} missing from workbook! Skipping.")
            continue

        e_info = existing_data.get(qid)

        # Step 1: 3-Model Revision (if not already revised)
        if qid not in revision_records:
            logging.info(f"--- [Step 1: Revision] Question {qid} ---")
            t0 = time.time()
            revised_record = rev.process_question(qid, q_info, e_info)
            if not revised_record:
                logging.error(f"Revision failed for Question {qid}!")
                continue
            revision_records[qid] = revised_record
            rev.save_sidecar_atomic(REVISION_JSONL, revision_records)
            logging.info(f"Question {qid} revision complete in {time.time() - t0:.1f}s")
        else:
            logging.info(f"Question {qid} already in revision records.")
            revised_record = revision_records[qid]

        # Step 2: 3-Model Judicial Audit & Consensus Debate Loop
        logging.info(f"--- [Step 2: Judicial Audit] Question {qid} ---")
        t0 = time.time()
        audited_record = aud.audit_question_multi_model(
            revised_record,
            q_info["answer_text"],
            q_info["full_text"],
            q_info["blanks"],
            max_debate_rounds=3,
            short_circuit=True,
        )
        audited_records[qid] = audited_record
        aud.save_jsonl_atomic(AUDITED_JSONL, audited_records)
        logging.info(f"Question {qid} audit complete in {time.time() - t0:.1f}s")

        # Step 3: Incremental Sync to review-metadata.json
        updated = update_review_metadata(audited_records, REVIEW_METADATA_PATH)
        logging.info(f"Synced Question {qid} to {REVIEW_METADATA_PATH} (Total live: {len(audited_records)}/1128)")

    # Final verification
    logging.info("\n=======================================================")
    logging.info("Edge-case pipeline complete!")
    logging.info(f"Audited records on disk: {len(audited_records)} / 1128")
    logging.info("=======================================================")


if __name__ == "__main__":
    main()
