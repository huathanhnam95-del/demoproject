# audit_rfib_explanations.py — Post-Pipeline Quality Audit for RFIB Explanations
#
# Reads RFIB_3model_revision.jsonl, fact-checks each explanation using DeepSeek-R1,
# auto-fixes flagged issues using Qwen3 (with Gemma4 fallback), retries pipeline-
# skipped questions once, and outputs RFIB_audited.jsonl + audit_failures.json.

import os
import re
import sys
import time
import json
import copy
import logging
import argparse
import requests
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)

OLLAMA_URL = "http://localhost:11434/api/generate"

MODELS = {
    "dr": "deepseek-r1:14b",
    "qw": "qwen3:14b",
    "gm": "gemma4:latest",
}

INPUT_REVISION = r"C:\Cursor AI\public\database\RFIB\RFIB_3model_revision.jsonl"
INPUT_WORKBOOK = r"C:\Cursor AI\public\database\RFIB\RFIB Final ver.xlsx"
INPUT_EXISTING = r"C:\Cursor AI\public\database\RFIB\RFIB_cohesion_enrichment.jsonl"
OUTPUT_AUDITED = r"C:\Cursor AI\public\database\RFIB\RFIB_audited.jsonl"
OUTPUT_FAILURES = r"C:\Cursor AI\public\database\RFIB\audit_failures.json"

BLANK_RE = re.compile(r"__([^_]+?)__")


# ── Shared utilities (from revise_rfib_explanations.py) ──────────────────────

def clean_model_response(raw: str) -> str:
    if not raw:
        return raw
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if "<think>" in cleaned:
        cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL).strip()
    cleaned = re.sub(r"</?(no_)?think>", "", cleaned).strip()
    if cleaned.startswith("```"):
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(1).strip()
    if not cleaned.startswith("{") and not cleaned.startswith("["):
        match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(1).strip()
    return cleaned


def query_ollama(model: str, prompt: str, temperature: float = 0.1,
                 max_retries: int = 5, timeout: int = 450,
                 json_mode: bool = True) -> str | None:
    effective_prompt = prompt
    if "qwen3" in model.lower():
        effective_prompt = "/no_think\n\n" + prompt

    num_ctx = 4096 if "gemma" in model.lower() else 8192
    num_predict = 2048 if "gemma" in model.lower() else 4096

    for attempt in range(1, max_retries + 1):
        temp = temperature if attempt == 1 else 0.0
        payload = {
            "model": model,
            "prompt": effective_prompt,
            "stream": False,
            "options": {
                "temperature": temp,
                "num_predict": num_predict,
                "num_ctx": num_ctx,
            },
        }
        if json_mode:
            payload["format"] = "json"
        try:
            resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
            if resp.status_code == 200:
                raw = resp.json().get("response", "")
                cleaned = clean_model_response(raw)
                if not cleaned or len(cleaned.strip()) < 10:
                    if attempt < max_retries:
                        time.sleep(3 * attempt)
                        continue
                return cleaned
            logging.warning(f"Ollama HTTP {resp.status_code} (attempt {attempt}, model={model})")
        except requests.exceptions.Timeout:
            logging.warning(f"Ollama timeout (attempt {attempt}, model={model})")
        except Exception as e:
            logging.warning(f"Ollama error (attempt {attempt}, model={model}): {e}")
        if attempt < max_retries:
            time.sleep(3 * attempt)
    return None


def extract_blanks(answer_text: str) -> list[dict]:
    if not answer_text:
        return []
    matches = BLANK_RE.findall(answer_text)
    blanks = []
    for i, payload in enumerate(matches, start=1):
        options = [s.strip() for s in payload.split("/")]
        blanks.append({"index": i, "correct": options[0], "options": options})
    return blanks


# ── File I/O ─────────────────────────────────────────────────────────────────

def load_jsonl(path: str) -> dict[int, dict]:
    records = {}
    if not os.path.exists(path):
        return records
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                rid = int(rec.get("id", 0))
                if rid > 0:
                    records[rid] = rec
            except (json.JSONDecodeError, ValueError):
                continue
    return records


def save_jsonl_atomic(path: str, records: dict[int, dict]):
    tmp_path = path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            for rid in sorted(records.keys()):
                f.write(json.dumps(records[rid], ensure_ascii=False) + "\n")
        
        for attempt in range(1, 6):
            try:
                os.replace(tmp_path, path)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(0.5 * attempt)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise


def save_failures(path: str, failures: list[dict]):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(failures, f, indent=2, ensure_ascii=False)


# ── Audit Prompt ─────────────────────────────────────────────────────────────

def build_audit_prompt(
    answer_with_blanks: str,
    full_text: str,
    final_explanation: str,
    grammar_tag: str,
    correct_answer: str,
    options: list[str],
) -> str:
    distractors = [o for o in options if o != correct_answer]
    distractor_list = ", ".join(f"'{d}'" for d in distractors) if distractors else "(None)"

    return f"""You are an expert English linguistics fact-checker. Your SOLE job is to verify whether an AI-generated grammar explanation is FACTUALLY CORRECT and LOGICALLY SOUND.

PASSAGE (with blanks marked by __option1/option2/...__):
{answer_with_blanks}

FULL TEXT:
{full_text}

BLANK BEING CHECKED:
- Correct answer: '{correct_answer}'
- Distractors: {distractor_list}
- Grammar tag assigned: "{grammar_tag}"

EXPLANATION TO VERIFY:
{final_explanation}

YOUR VERIFICATION CHECKLIST — check ALL of these:

1. GRAMMAR LABEL ACCURACY:
   - Is the grammar_tag "{grammar_tag}" factually correct for the word '{correct_answer}' in this sentence?
   - For each distractor, does the explanation correctly identify its grammatical form?
   - Example error to catch: calling "is received" a "Present Passive" when it should be identified as "Simple Present Passive" AND the explanation should note whether passive voice makes semantic sense for the subject.

2. REASONING LOGIC:
   - Does each "why wrong" reason make logical sense?
   - Are there any circular arguments or contradictions?
   - Does the explanation confuse cause and effect?

3. SEMANTIC & COLLOCATION GAPS:
   - For PASSIVE VOICE distractors: Does the explanation address whether the SUBJECT can logically BE the receiver of the action? (e.g., "The Professor is received" — a professor RECEIVES things, they aren't received. This semantic impossibility MUST be mentioned.)
   - For ACTIVE VOICE distractors: Does the explanation address whether the subject logically PERFORMS the action?
   - For COLLOCATION: Does the explanation address whether the word naturally pairs with surrounding words?
   - For MEANING: Does the explanation address whether the word fits the semantic context of the passage?

4. COMPLETENESS:
   - Does EVERY distractor have a clear, specific explanation?
   - Are multiple failure dimensions mentioned when applicable (e.g., wrong tense AND wrong voice)?

RESPONSE FORMAT — return ONLY valid JSON:
{{
  "verdict": "PASS" or "FAIL",
  "issues": [
    {{
      "type": "grammar_label_error" | "reasoning_error" | "semantic_gap" | "collocation_gap" | "completeness_gap" | "factual_error",
      "description": "Specific description of what is wrong",
      "affected_text": "The exact part of the explanation that is wrong",
      "correction": "What it should say instead"
    }}
  ],
  "verified_grammar_tag": "The correct grammar tag (same as original if correct, corrected if wrong)",
  "overall_notes": "Brief summary of verification result"
}}

RULES:
- Be STRICT. If ANY grammar label is wrong, if ANY reasoning has a logical flaw, or if ANY semantic/collocation gap exists, the verdict MUST be "FAIL".
- MANDATORY FAIL FOR PASSIVE DISTRACTORS: For any distractor that uses passive voice (e.g., 'is received', 'was given'), the explanation MUST explicitly explain the subject-verb action relationship (e.g., "The subject 'The Professor' is the person performing the action of receiving, not receiving the action, so passive voice makes no semantic sense here"). If the explanation ONLY mentions tense or simply names the voice (e.g. "this is Present Passive, we need past tense") without explaining why passive voice fails for this subject, you MUST set verdict to "FAIL" with issue type "semantic_gap".
- If the explanation is correct and complete, return verdict "PASS" with an empty issues array.
- Do NOT nitpick stylistic preferences. Only flag factual errors, logical flaws, and missing critical analysis.
- For the "correction" field, write the COMPLETE corrected text that should replace the affected_text.
"""


# ── Fix Prompt ───────────────────────────────────────────────────────────────

def build_fix_prompt(
    answer_with_blanks: str,
    full_text: str,
    correct_answer: str,
    options: list[str],
    original_explanation: str,
    issues: list[dict],
    verified_grammar_tag: str,
) -> str:
    distractors = [o for o in options if o != correct_answer]
    distractor_list = ", ".join(f"'{d}'" for d in distractors) if distractors else "(None)"

    issues_block = ""
    for i, issue in enumerate(issues, 1):
        issues_block += f"\n  {i}. [{issue.get('type', 'issue')}] {issue.get('description', '')}"
        if issue.get("affected_text"):
            issues_block += f"\n     Affected: \"{issue['affected_text']}\""
        if issue.get("correction"):
            issues_block += f"\n     Should be: \"{issue['correction']}\""

    return f"""You are an expert ESL content editor. Fix the specific errors identified in the explanation below.

PASSAGE:
{answer_with_blanks}

FULL TEXT:
{full_text}

BLANK: Correct answer is '{correct_answer}', distractors are {distractor_list}.
VERIFIED GRAMMAR TAG: "{verified_grammar_tag}"

ORIGINAL EXPLANATION (with errors):
{original_explanation}

ERRORS FOUND BY FACT-CHECKER:
{issues_block}

TASK: Rewrite the explanation, fixing ONLY the identified errors. Keep all correct parts intact. The rewritten explanation must:
1. Use the verified grammar tag "{verified_grammar_tag}" (not the old one if it was wrong)
2. Fix all reasoning errors identified above
3. Fill all semantic/collocation gaps identified above
4. Keep the same structure and B1-B2 level language
5. Address the correct answer AND every distractor

RESPONSE FORMAT — return ONLY valid JSON:
{{
  "fixed_explanation": "The complete corrected explanation",
  "fixed_concise": "One-sentence summary of why this answer is correct (max 50 words)",
  "changes_made": "Brief list of what was changed"
}}

RULES:
- Do NOT add new errors while fixing old ones.
- Keep all correct analysis intact — only change what was flagged.
- The fixed_explanation must be complete and self-contained.
"""


# ── Core Audit Logic ─────────────────────────────────────────────────────────

def audit_blank(
    answer_with_blanks: str,
    full_text: str,
    blank_data: dict,
    options: list[str],
) -> dict:
    """Audit a single blank's explanation. Returns audit result dict."""
    blank_index = blank_data.get("blank_index", "?")
    correct_answer = blank_data.get("correct_answer", "")
    grammar_tag = blank_data.get("grammar_tag", "")
    final_explanation = blank_data.get("final_explanation", "")

    if not final_explanation.strip():
        return {
            "blank_index": blank_index,
            "verdict": "FAIL",
            "issues": [{"type": "completeness_gap", "description": "Empty explanation", "affected_text": "", "correction": ""}],
            "verified_grammar_tag": grammar_tag,
            "overall_notes": "No explanation to audit",
        }

    prompt = build_audit_prompt(
        answer_with_blanks, full_text,
        final_explanation, grammar_tag, correct_answer, options,
    )

    raw = query_ollama(MODELS["dr"], prompt, temperature=0.1, max_retries=4, timeout=300, json_mode=False)
    if not raw:
        return {
            "blank_index": blank_index,
            "verdict": "ERROR",
            "issues": [],
            "verified_grammar_tag": grammar_tag,
            "overall_notes": "Audit model failed to respond",
        }

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as err:
        logging.warning(f"JSON decode error for blank {blank_index}: {err}. Snippet: {raw[:150]}")
        return {
            "blank_index": blank_index,
            "verdict": "ERROR",
            "issues": [],
            "verified_grammar_tag": grammar_tag,
            "overall_notes": f"Audit model returned invalid JSON: {err}",
        }

    verdict = result.get("verdict", "ERROR").upper()
    issues = result.get("issues", [])
    if not isinstance(issues, list):
        issues = []

    return {
        "blank_index": blank_index,
        "verdict": verdict,
        "issues": issues,
        "verified_grammar_tag": result.get("verified_grammar_tag", grammar_tag),
        "overall_notes": result.get("overall_notes", ""),
    }


def fix_blank(
    answer_with_blanks: str,
    full_text: str,
    blank_data: dict,
    options: list[str],
    audit_result: dict,
    fix_model: str,
) -> dict | None:
    """Attempt to fix a failed blank using the specified model. Returns fixed blank data or None."""
    correct_answer = blank_data.get("correct_answer", "")
    original_explanation = blank_data.get("final_explanation", "")

    prompt = build_fix_prompt(
        answer_with_blanks, full_text,
        correct_answer, options,
        original_explanation,
        audit_result["issues"],
        audit_result["verified_grammar_tag"],
    )

    raw = query_ollama(fix_model, prompt, temperature=0.2, max_retries=4, timeout=300)
    if not raw:
        return None

    try:
        fix_data = json.loads(raw)
    except json.JSONDecodeError:
        return None

    fixed_explanation = fix_data.get("fixed_explanation", "")
    if not fixed_explanation or len(fixed_explanation.strip()) < 30:
        return None

    return {
        "fixed_explanation": fixed_explanation,
        "fixed_concise": fix_data.get("fixed_concise", blank_data.get("concise_explanation", "")),
        "changes_made": fix_data.get("changes_made", ""),
    }


def audit_question(record: dict, answer_text: str, full_text: str, workbook_blanks: list[dict]) -> dict:
    """Audit all blanks in a question record. Returns updated record with audit metadata."""
    qid = record["id"]
    blanks = record.get("blanks", [])
    audited_record = copy.deepcopy(record)

    total_pass = 0
    total_fail = 0
    total_fixed = 0
    total_unfixable = 0
    total_error = 0
    blank_audit_details = []

    for i, blank_data in enumerate(blanks):
        b_idx = blank_data.get("blank_index", i + 1)
        wb_blank = workbook_blanks[i] if i < len(workbook_blanks) else None
        
        # Safely determine options (from workbook or blank_data)
        if wb_blank and wb_blank.get("options"):
            options = wb_blank["options"]
        else:
            options = [blank_data.get("correct_answer", "")]
            for d in blank_data.get("dr_distractor_analysis", []):
                opt = d.get("option")
                if opt and opt not in options:
                    options.append(opt)

        logging.info(f"    Auditing blank {b_idx} ...")

        audit_result = audit_blank(answer_text, full_text, blank_data, options)
        verdict = audit_result["verdict"]

        if verdict == "PASS":
            total_pass += 1
            # Update grammar tag if auditor verified a correction
            if audit_result["verified_grammar_tag"] != blank_data.get("grammar_tag", ""):
                audited_record["blanks"][i]["grammar_tag"] = audit_result["verified_grammar_tag"]
            audited_record["blanks"][i]["audit_status"] = "PASS"
            audited_record["blanks"][i]["audit_notes"] = audit_result.get("overall_notes", "")
            blank_audit_details.append({"blank_index": b_idx, "verdict": "PASS"})

        elif verdict == "FAIL":
            total_fail += 1
            logging.info(f"    [FAIL] Blank {b_idx} FAILED audit — {len(audit_result['issues'])} issues found")
            for issue in audit_result["issues"]:
                logging.info(f"      [{issue.get('type', '?')}] {issue.get('description', '')[:100]}")

            # Try fix with Qwen3
            logging.info(f"    Fixing blank {b_idx} with {MODELS['qw']} ...")
            fix_result = fix_blank(answer_text, full_text, blank_data, options, audit_result, MODELS["qw"])

            if fix_result is None:
                # Fallback to Gemma4
                logging.info(f"    Qwen3 fix failed, trying {MODELS['gm']} ...")
                fix_result = fix_blank(answer_text, full_text, blank_data, options, audit_result, MODELS["gm"])

            if fix_result:
                total_fixed += 1
                audited_record["blanks"][i]["final_explanation"] = fix_result["fixed_explanation"]
                audited_record["blanks"][i]["concise_explanation"] = fix_result["fixed_concise"]
                audited_record["blanks"][i]["grammar_tag"] = audit_result["verified_grammar_tag"]
                audited_record["blanks"][i]["audit_status"] = "FIXED"
                audited_record["blanks"][i]["audit_notes"] = f"Issues: {json.dumps(audit_result['issues'], ensure_ascii=False)[:500]}. Changes: {fix_result.get('changes_made', '')}"
                blank_audit_details.append({"blank_index": b_idx, "verdict": "FIXED", "issues": len(audit_result["issues"])})
                logging.info(f"    [FIXED] Blank {b_idx} FIXED")
            else:
                total_unfixable += 1
                audited_record["blanks"][i]["audit_status"] = "UNFIXABLE"
                audited_record["blanks"][i]["audit_notes"] = f"Issues found but auto-fix failed: {json.dumps(audit_result['issues'], ensure_ascii=False)[:500]}"
                blank_audit_details.append({"blank_index": b_idx, "verdict": "UNFIXABLE", "issues": len(audit_result["issues"])})
                logging.warning(f"    [UNFIXABLE] Blank {b_idx} UNFIXABLE")

        else:  # ERROR
            total_error += 1
            audited_record["blanks"][i]["audit_status"] = "ERROR"
            audited_record["blanks"][i]["audit_notes"] = audit_result.get("overall_notes", "Audit error")
            blank_audit_details.append({"blank_index": b_idx, "verdict": "ERROR"})

    # Set overall audit status
    if total_unfixable > 0 or total_error > 0:
        audited_record["audit_status"] = "PARTIAL"
    elif total_fixed > 0:
        audited_record["audit_status"] = "FIXED"
    else:
        audited_record["audit_status"] = "PASS"

    audited_record["audit_summary"] = {
        "passed": total_pass,
        "failed": total_fail,
        "fixed": total_fixed,
        "unfixable": total_unfixable,
        "errors": total_error,
        "details": blank_audit_details,
    }
    audited_record["audit_timestamp"] = datetime.now(timezone.utc).isoformat()

    status_str = f"PASS={total_pass} FIXED={total_fixed} UNFIXABLE={total_unfixable} ERROR={total_error}"
    logging.info(f"  [AUDIT] Question {qid}: {status_str}")

    return audited_record


# ── Pipeline Retry (for skipped questions) ───────────────────────────────────

def retry_pipeline_question(qid: int, question: dict, existing_explanation: dict | None) -> dict | None:
    """Re-run the full 3-model pipeline for a single question. Import from revise script."""
    # Import process_question from the pipeline script
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from revise_rfib_explanations import process_question
        return process_question(qid, question, existing_explanation)
    except ImportError:
        logging.error("Could not import process_question from revise_rfib_explanations.py")
        return None


# ── Workbook loader (reused from pipeline) ───────────────────────────────────

def load_workbook_data(workbook_path: str) -> dict[int, dict]:
    import openpyxl

    wb = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    ws = wb.active

    rows_iter = ws.iter_rows(values_only=False)
    header_row = next(rows_iter)
    hmap = {}
    for i, cell in enumerate(header_row):
        if cell.value is not None:
            hmap[str(cell.value).strip()] = i

    id_idx = hmap.get("ID", hmap.get("id"))
    answer_idx = hmap.get("ANSWER", hmap.get("Answer"))
    full_text_idx = hmap.get("Full Text", hmap.get("fullText"))

    if id_idx is None or answer_idx is None or full_text_idx is None:
        raise ValueError(f"Missing required columns. Headers: {list(hmap.keys())}")

    questions = {}
    for row in rows_iter:
        cells = list(row)
        if id_idx >= len(cells):
            continue
        raw_id = cells[id_idx].value
        if raw_id is None:
            continue
        try:
            qid = int(raw_id)
        except (ValueError, TypeError):
            continue

        answer_text = str(cells[answer_idx].value or "") if answer_idx < len(cells) else ""
        full_text = str(cells[full_text_idx].value or "") if full_text_idx < len(cells) else ""

        if not answer_text.strip() or not full_text.strip():
            continue

        blanks = extract_blanks(answer_text)
        if not blanks:
            continue

        questions[qid] = {
            "id": qid,
            "answer_text": answer_text,
            "full_text": full_text,
            "blanks": blanks,
        }

    wb.close()
    return questions


# ── CLI & Main ───────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Post-Pipeline Quality Audit for RFIB Explanations"
    )
    parser.add_argument("--input", default=INPUT_REVISION,
                        help="Path to 3-model revision JSONL")
    parser.add_argument("--workbook", default=INPUT_WORKBOOK,
                        help="Path to RFIB workbook XLSX")
    parser.add_argument("--existing", default=INPUT_EXISTING,
                        help="Path to original cohesion enrichment JSONL")
    parser.add_argument("--out", default=OUTPUT_AUDITED,
                        help="Output path for audited JSONL")
    parser.add_argument("--failures", default=OUTPUT_FAILURES,
                        help="Output path for failures JSON")
    parser.add_argument("--ids", type=str,
                        help="Comma-separated question IDs to audit")
    parser.add_argument("--limit", type=int,
                        help="Max questions to audit")
    parser.add_argument("--save-every", type=int, default=1,
                        help="Save after every N questions")
    parser.add_argument("--no-resume", action="store_true",
                        help="Re-audit questions already in the output file")
    parser.add_argument("--retry-skipped", action="store_true",
                        help="Also retry pipeline-skipped questions")
    parser.add_argument("--audit-only", action="store_true",
                        help="Skip retry phase, only audit existing records")
    return parser.parse_args()


def main():
    args = parse_args()

    # Load data
    logging.info("Loading 3-model revision data ...")
    revision_records = load_jsonl(args.input)
    logging.info(f"  Loaded {len(revision_records)} revised records")

    logging.info("Loading workbook data ...")
    workbook_data = load_workbook_data(args.workbook)
    logging.info(f"  Loaded {len(workbook_data)} workbook questions")

    # Load already-audited records for resume
    audited_records = load_jsonl(args.out) if not args.no_resume else {}
    logging.info(f"  Already audited: {len(audited_records)} records (resume mode)")

    failures = []

    # ── Phase A: Retry pipeline-skipped questions ────────────────────────
    if args.retry_skipped and not args.audit_only:
        all_workbook_ids = set(workbook_data.keys())
        already_revised = set(revision_records.keys())
        skipped_ids = sorted(all_workbook_ids - already_revised)

        if skipped_ids:
            logging.info(f"\n=== Phase A: Retry {len(skipped_ids)} pipeline-skipped questions ===")
            existing_explanations = load_jsonl(args.existing)

            retried = 0
            retry_failed = 0
            for qid in skipped_ids:
                q_data = workbook_data.get(qid)
                if not q_data:
                    continue

                logging.info(f"  Retrying Q{qid} ...")
                e_data = existing_explanations.get(qid)
                result = retry_pipeline_question(qid, q_data, e_data)

                if result:
                    revision_records[qid] = result
                    retried += 1
                    logging.info(f"  ✓ Q{qid} retry succeeded")
                else:
                    retry_failed += 1
                    failures.append({
                        "id": qid,
                        "phase": "retry",
                        "reason": "Pipeline retry failed (all 3 phases)",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    logging.warning(f"  ✗ Q{qid} retry failed — added to failures list")

            logging.info(f"  Retry complete: {retried} succeeded, {retry_failed} failed")

            # Save updated revision records after retries
            if retried > 0:
                save_jsonl_atomic(args.input, revision_records)
                logging.info(f"  Updated {args.input} with {retried} retried records")

    # ── Phase B: Audit all revision records ──────────────────────────────
    if args.ids:
        target_ids = [int(x.strip()) for x in args.ids.split(",") if x.strip()]
        target_ids = [qid for qid in target_ids if qid in revision_records]
    else:
        target_ids = sorted(revision_records.keys())
        if args.limit:
            target_ids = target_ids[:args.limit]

    # Filter out already-audited (resume)
    if not args.no_resume:
        target_ids = [qid for qid in target_ids if qid not in audited_records]

    logging.info(f"\n=== Phase B: Audit {len(target_ids)} questions ===")

    audit_pass = 0
    audit_fixed = 0
    audit_partial = 0
    save_counter = 0

    for idx, qid in enumerate(target_ids):
        record = revision_records[qid]
        wb_data = workbook_data.get(qid)

        if not wb_data:
            logging.warning(f"  Q{qid} not found in workbook — skipping")
            continue

        answer_text = wb_data["answer_text"]
        full_text = wb_data["full_text"]
        wb_blanks = wb_data["blanks"]

        logging.info(f"--- Auditing Q{qid} ({idx+1}/{len(target_ids)}): {len(record.get('blanks', []))} blanks ---")
        t_start = time.time()

        audited = audit_question(record, answer_text, full_text, wb_blanks)
        elapsed = time.time() - t_start

        status = audited.get("audit_status", "?")
        if status == "PASS":
            audit_pass += 1
        elif status == "FIXED":
            audit_fixed += 1
        else:
            audit_partial += 1
            # Add unfixable blanks to failures
            summary = audited.get("audit_summary", {})
            if summary.get("unfixable", 0) > 0 or summary.get("errors", 0) > 0:
                failures.append({
                    "id": qid,
                    "phase": "audit",
                    "reason": f"Unfixable={summary.get('unfixable', 0)}, Errors={summary.get('errors', 0)}",
                    "details": summary.get("details", []),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

        audited_records[qid] = audited
        save_counter += 1

        logging.info(f"  [{status}] Q{qid} audited in {elapsed:.1f}s")

        if save_counter % args.save_every == 0:
            save_jsonl_atomic(args.out, audited_records)

    # Final save
    save_jsonl_atomic(args.out, audited_records)
    save_failures(args.failures, failures)

    logging.info(f"\n=== Audit Complete ===")
    logging.info(f"  PASS: {audit_pass}")
    logging.info(f"  FIXED: {audit_fixed}")
    logging.info(f"  PARTIAL/UNFIXABLE: {audit_partial}")
    logging.info(f"  Failures logged: {len(failures)}")
    logging.info(f"  Output: {args.out}")
    logging.info(f"  Failures: {args.failures}")


if __name__ == "__main__":
    main()
