import os
import sys
import json
import time
import shutil
import logging
import argparse
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import openpyxl

# Configure logging to console (standard logging)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

INPUT_FILE = r"public\database\RFIB\RFIB Final ver.xlsx"
SIDECAR_FILE = r"public\database\RFIB\RFIB_cohesion_enrichment.jsonl"
MODEL_NAME = os.getenv("LOCAL_GEMMA_MODEL", "gemma4:12b")

PROMPT_TEMPLATE = """You are an expert English language learning content designer.
Your task is to write a cohesive, professional "Cohesion Feature Details" text for a Reading Fill-in-the-Blanks passage, based on the existing details, verification notes, and specific cohesion ties.

Passage text:
"{passage_text}"

Existing Cohesion Details (may be incomplete or contain incorrect claims):
"{existing_details}"

Verification Notes (explaining what is correct, what is incorrect, and what was omitted in the existing details):
"{notes}"

Additional Cohesion Ties from explanations:
{cohesion_ties}

Rewrite and synthesize the cohesion details into a single professional paragraph.
Follow these rules:
1. Retain existing correct claims mentioned in the notes.
2. Correct any incorrect claims mentioned in the notes (do not include incorrect claims in the final output).
3. Integrate the missing/omitted cohesion ties described in the notes and explanations.
4. For each cohesive blank, specify the blank index, the correct word, the type of cohesion (grammatical or lexical), and a clear, concise explanation of how it links to other parts of the text.
5. Format the output as a clean paragraph of text without bullet points, without markdown titles, and without introductory/concluding remarks (e.g. do not start with "Here is the rewritten details:"). Start directly with the claims.
6. Keep it concise, clear, and direct.
"""

excel_lock = threading.Lock()
sidecar_lock = threading.Lock()

def backup_suffix() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def save_sidecar_atomic(sidecar_path: str, records: dict[int, dict]):
    tmp_path = sidecar_path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            for rid in sorted(records.keys()):
                f.write(json.dumps(records[rid], ensure_ascii=False) + "\n")
        os.replace(tmp_path, sidecar_path)
    except Exception as e:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise e

def save_workbook_safe(wb, target_path: str) -> str:
    tmp_path = target_path + ".tmp"
    try:
        wb.save(tmp_path)
        os.replace(tmp_path, target_path)
        return target_path
    except PermissionError:
        fallback = target_path.replace(".xlsx", f".cohesion_updated.{backup_suffix()}.xlsx")
        logging.warning(f"File locked. Saving to fallback: {fallback}")
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        wb.save(fallback)
        return fallback
    except Exception as e:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise e

def load_sidecar_to_dict(sidecar_path: str) -> dict[int, dict]:
    records = {}
    if not os.path.exists(sidecar_path):
        return records
    with open(sidecar_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            records[rec["id"]] = rec
    return records

def query_gemma_rewrite(prompt: str) -> str:
    url = "http://localhost:11434/api/generate"
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False
    }
    for attempt in range(3):
        try:
            res = requests.post(url, json=payload, timeout=45)
            if res.status_code == 200:
                response = res.json().get("response", "").strip()
                if response:
                    return response
            logging.warning(f"Ollama returned status {res.status_code} (attempt {attempt+1}/3)")
        except Exception as e:
            logging.warning(f"Ollama query failed: {e} (attempt {attempt+1}/3)")
        time.sleep(1)
    return ""

def build_header_map(ws) -> dict:
    hmap = {}
    for col in range(1, ws.max_column + 1):
        val = ws.cell(row=1, column=col).value
        if val:
            hmap[val.strip()] = col
    return hmap

def parse_arguments():
    parser = argparse.ArgumentParser(description="Update RFIB Cohesion columns H and I.")
    parser.add_argument("--input", type=str, default=INPUT_FILE, help="Workbook path.")
    parser.add_argument("--sidecar", type=str, default=SIDECAR_FILE, help="Sidecar JSONL path.")
    parser.add_argument("--ids", type=str, default="", help="Comma-separated list of IDs to update.")
    parser.add_argument("--no-resume", action="store_true", help="Force rewrite from LLM even if already done.")
    parser.add_argument("--workers", type=int, default=3, help="Number of parallel workers.")
    parser.add_argument("--dry-run", action="store_true", help="Print prompt/response without saving to Excel.")
    return parser.parse_args()

def process_single_row(row_id: int, row_num: int, record: dict, row_data: dict, args):
    # Format cohesion ties from explanations
    ties = []
    for exp in record.get("explanations", []):
        t = exp.get("cohesion_tie", "")
        if t:
            ties.append(f"- Blank {exp['blank_index']} ('{exp['correct_answer']}'): {t}")
    
    cohesion_ties_str = "\n".join(ties) if ties else "None"
    
    prompt = PROMPT_TEMPLATE.format(
        passage_text=row_data["passage"],
        existing_details=row_data["details"],
        notes=record["notes"],
        cohesion_ties=cohesion_ties_str
    )
    
    response = query_gemma_rewrite(prompt)
    if not response:
        logging.error(f"[-] ID {row_id} (row {row_num}): Failed to get response from Gemma.")
        return None
        
    # Normalize line endings
    response_norm = response.replace("\r\n", "\n").replace("\r", "\n").strip()
    return response_norm

def main():
    args = parse_arguments()
    
    if not os.path.exists(args.input):
        logging.error(f"Workbook not found: {args.input}")
        sys.exit(1)
        
    if not os.path.exists(args.sidecar):
        logging.error(f"Sidecar not found: {args.sidecar}")
        sys.exit(1)

    logging.info(f"Loading sidecar: {args.sidecar}")
    sidecar_records = load_sidecar_to_dict(args.sidecar)
    logging.info(f"Loaded {len(sidecar_records)} records from sidecar.")

    logging.info(f"Loading workbook: {args.input}")
    wb = openpyxl.load_workbook(args.input)
    ws = wb.active
    hmap = build_header_map(ws)

    # Columns
    required = ["ID", "Full Text", "Cohesion Feature", "Cohesion Feature Details", "Cohesion Verification"]
    missing = [c for c in required if c not in hmap]
    if missing:
        logging.error(f"Missing columns in workbook: {missing}")
        sys.exit(1)

    col_id = hmap["ID"]
    col_passage = hmap["Full Text"]
    col_feature = hmap["Cohesion Feature"]
    col_details = hmap["Cohesion Feature Details"]
    col_verification = hmap["Cohesion Verification"]

    # Build ID -> row map
    id_to_row = {}
    for r in range(2, ws.max_row + 1):
        rid = ws.cell(row=r, column=col_id).value
        if rid is not None:
            id_to_row[int(rid)] = r

    # Create backup if not dry-run
    if not args.dry_run:
        bak_path = args.input.replace(".xlsx", f".backup.update_cohesion.{backup_suffix()}.xlsx")
        shutil.copy2(args.input, bak_path)
        logging.info(f"Backup created: {bak_path}")

    # Determine target IDs to process
    target_ids = set()
    if args.ids:
        target_ids = set(int(x.strip()) for x in args.ids.split(",") if x.strip())
    else:
        # All IDs in sidecar
        target_ids = set(sidecar_records.keys())

    logging.info(f"Selected {len(target_ids)} records for processing.")

    # Status counts and lists
    stats = {
        "total": len(target_ids),
        "skipped_correct": 0,
        "skipped_resume": 0,
        "processed": 0,
        "failed": 0
    }

    # First pass: Process "Correct" and "No Cohesion" status rows synchronously and fast
    # Also find which ones need Ollama processing
    ollama_tasks = []
    
    for rid in sorted(target_ids):
        row = id_to_row.get(rid)
        if not row:
            logging.warning(f"ID {rid} not found in workbook. Skipping.")
            continue
            
        record = sidecar_records.get(rid)
        if not record:
            logging.warning(f"ID {rid} not found in sidecar. Skipping.")
            continue
            
        status = record["status"]
        if status in ("Correct", "No Cohesion"):
            # Update columns H, I, N directly without Ollama
            with excel_lock:
                if status == "No Cohesion":
                    ws.cell(row=row, column=col_feature, value=False)
                    ws.cell(row=row, column=col_details, value="None of the correct blanks demonstrate cohesion features in this passage.")
                else:
                    # status is Correct: keep existing details
                    pass
                ws.cell(row=row, column=col_verification).value = None
            stats["skipped_correct"] += 1
            logging.info(f"  [+] ID {rid} (row {row}) is Correct/No Cohesion. Sheet updated directly.")
        else:
            # Partially Correct or Incorrect: needs new details
            # Check if we already have "new_details" in sidecar and args.no_resume is False
            if not args.no_resume and record.get("new_details"):
                new_details = record["new_details"]
                with excel_lock:
                    ws.cell(row=row, column=col_feature, value=True)
                    ws.cell(row=row, column=col_details, value=new_details)
                    ws.cell(row=row, column=col_verification).value = None
                stats["skipped_resume"] += 1
                logging.info(f"  [+] ID {rid} (row {row}) rendered from sidecar new_details.")
            else:
                # Add to Ollama task queue
                row_data = {
                    "passage": ws.cell(row=row, column=col_passage).value or "",
                    "details": ws.cell(row=row, column=col_details).value or ""
                }
                ollama_tasks.append((rid, row, record, row_data))

    logging.info(f"Initial sync complete. Correct: {stats['skipped_correct']}, Resume skipped: {stats['skipped_resume']}. Ollama tasks: {len(ollama_tasks)}")

    # Execute Ollama tasks in parallel
    if ollama_tasks:
        checkpoint_every = 25
        lock_save = threading.Lock()
        
        def task_worker(task):
            rid, row, record, row_data = task
            new_details = process_single_row(rid, row, record, row_data, args)
            if new_details:
                if not args.dry_run:
                    with excel_lock:
                        ws.cell(row=row, column=col_feature, value=True)
                        ws.cell(row=row, column=col_details, value=new_details)
                        ws.cell(row=row, column=col_verification).value = None
                    with sidecar_lock:
                        record["new_details"] = new_details
                        # Save sidecar atomically
                        save_sidecar_atomic(args.sidecar, sidecar_records)
                return rid, new_details
            return rid, None

        logging.info(f"Starting ThreadPoolExecutor with {args.workers} workers...")
        processed_since_save = 0
        
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(task_worker, t): t for t in ollama_tasks}
            for i, future in enumerate(as_completed(futures), 1):
                rid, new_details = future.result()
                if new_details:
                    stats["processed"] += 1
                    processed_since_save += 1
                    logging.info(f"  [+] ID {rid}: Successfully updated cohesion details [{i}/{len(ollama_tasks)}]")
                    
                    # Periodic save to Excel
                    if not args.dry_run and processed_since_save >= checkpoint_every:
                        with lock_save:
                            save_workbook_safe(wb, args.input)
                            logging.info(f"  [Save] Excel checkpoint saved -> {args.input}")
                            processed_since_save = 0
                else:
                    stats["failed"] += 1
                    logging.error(f"  [-] ID {rid}: Failed to update cohesion details [{i}/{len(ollama_tasks)}]")

    # Save workbook
    if not args.dry_run:
        save_workbook_safe(wb, args.input)
        logging.info(f"Workbook successfully saved to: {args.input}")

    logging.info("=" * 60)
    logging.info("UPDATE STATUS REPORT")
    logging.info("=" * 60)
    logging.info(f"Total target records:   {stats['total']}")
    logging.info(f"Correct/No Cohesion:    {stats['skipped_correct']}")
    logging.info(f"Resumed from sidecar:   {stats['skipped_resume']}")
    logging.info(f"Processed via Gemma:    {stats['processed']}")
    logging.info(f"Failed:                 {stats['failed']}")
    logging.info("=" * 60)

if __name__ == "__main__":
    main()
