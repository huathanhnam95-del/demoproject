# audit_rfib_explanations.py — Multi-LLM 3-Model Quality Audit & Debate Engine for RFIB
#
# Audits RFIB explanations using all 3 local LLMs (DeepSeek-R1, Qwen3, Gemma4).
# - 2/3 Approval Rule: If 2 or 3 models vote PASS, the explanation passes.
# - 2/3 Disapproval Rule: If 2 or 3 models vote FAIL, an iterative debate loop runs
#   between all 3 models until 3/3 mutual consent is achieved.
# - Supports 20% random sampling (or configurable percentage) with reproducible seed.

import os
import re
import sys
import time
import json
import copy
import random
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
    "dr": os.getenv("LOCAL_DEEPSEEK_MODEL", "deepseek-r1:14b"),
    "qw": os.getenv("LOCAL_QWEN_MODEL", "qwen3:14b"),
    "gm": os.getenv("LOCAL_GEMMA_MODEL", "gemma4:12b"),
}

INPUT_REVISION = r"C:\Cursor AI\public\database\RFIB\RFIB_3model_revision.jsonl"
INPUT_WORKBOOK = r"C:\Cursor AI\public\database\RFIB\RFIB Final ver.xlsx"
INPUT_EXISTING = r"C:\Cursor AI\public\database\RFIB\RFIB_cohesion_enrichment.jsonl"
OUTPUT_AUDITED = r"C:\Cursor AI\public\database\RFIB\RFIB_audited_sample20.jsonl"
OUTPUT_DEBATE_REPORT = r"C:\Cursor AI\public\database\RFIB\RFIB_audit_debate_report.json"
OUTPUT_FAILURES = r"C:\Cursor AI\public\database\RFIB\audit_failures.json"

BLANK_RE = re.compile(r"__([^_]+?)__")


# ── Shared utilities ─────────────────────────────────────────────────────────

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
    if "qwen" in model.lower():
        effective_prompt = "/no_think\n\n" + prompt

    num_ctx = 8192 if "gemma" in model.lower() else 16384
    num_predict = 4096

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
                        time.sleep(2 * attempt)
                        continue
                return cleaned
            logging.warning(f"Ollama HTTP {resp.status_code} (attempt {attempt}, model={model})")
        except requests.exceptions.Timeout:
            logging.warning(f"Ollama timeout (attempt {attempt}, model={model})")
        except Exception as e:
            logging.warning(f"Ollama error (attempt {attempt}, model={model}): {e}")
        if attempt < max_retries:
            time.sleep(2 * attempt)
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


def save_json(path: str, data: dict | list):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ── Audit Prompt Builders ────────────────────────────────────────────────────

def build_audit_prompt(
    answer_with_blanks: str,
    full_text: str,
    final_explanation: str,
    grammar_tag: str,
    correct_answer: str,
    options: list[str],
    model_role_title: str = "expert English linguistics fact-checker",
) -> str:
    distractors = [o for o in options if o != correct_answer]
    distractor_list = ", ".join(f"'{d}'" for d in distractors) if distractors else "(None)"

    return f"""You are an {model_role_title}. Your SOLE job is to verify whether an AI-generated grammar explanation is FACTUALLY CORRECT and LOGICALLY SOUND.

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
- MANDATORY FAIL FOR PASSIVE DISTRACTORS: For any distractor that uses passive voice, the explanation MUST explicitly explain the subject-verb action relationship.
- If the explanation is correct and complete, return verdict "PASS" with an empty issues array.
- Do NOT nitpick purely stylistic preferences. Only flag factual errors, logical flaws, and missing critical analysis.
- For the "correction" field, write the COMPLETE corrected text that should replace the affected_text.
"""


def build_debate_synthesis_prompt(
    answer_with_blanks: str,
    full_text: str,
    correct_answer: str,
    options: list[str],
    current_explanation: str,
    current_grammar_tag: str,
    debate_critiques: list[dict],
    debate_round: int,
) -> str:
    distractors = [o for o in options if o != correct_answer]
    distractor_list = ", ".join(f"'{d}'" for d in distractors) if distractors else "(None)"

    critique_block = ""
    for c in debate_critiques:
        critique_block += f"\n--- Critique from Model [{c.get('model', 'Juror')}] (Verdict: {c.get('verdict', 'FAIL')}) ---\n"
        critique_block += f"Notes: {c.get('overall_notes', '')}\n"
        critique_block += f"Verified Grammar Tag: {c.get('verified_grammar_tag', '')}\n"
        issues = c.get("issues", [])
        if issues:
            critique_block += "Issues flagged:\n"
            for i, iss in enumerate(issues, 1):
                critique_block += f"  {i}. [{iss.get('type', 'issue')}] {iss.get('description', '')}\n"
                if iss.get("affected_text"):
                    critique_block += f"     Affected text: \"{iss['affected_text']}\"\n"
                if iss.get("correction"):
                    critique_block += f"     Proposed correction: \"{iss['correction']}\"\n"

    return f"""You are the Master Moderator and Synthesizer in an AI panel debate. 
All 3 AI linguistic models have evaluated an RFIB explanation, and at least 2 models disapproved.

TASK: Synthesize all juror critiques from Debate Round {debate_round} and write a DEFINITIVE, PERFECTLY REVISED explanation that satisfies ALL 3 models unanimously.

PASSAGE:
{answer_with_blanks}

FULL TEXT:
{full_text}

BLANK:
- Correct answer: '{correct_answer}'
- Distractors: {distractor_list}
- Current Grammar Tag: "{current_grammar_tag}"

CURRENT EXPLANATION (under debate):
{current_explanation}

JUROR CRITIQUES & DISAGREEMENTS:
{critique_block}

SYNTHESIS GOAL:
1. Address EVERY valid critique raised by all 3 models.
2. Select or reconcile the most precise and accurate grammar tag.
3. Ensure subject-verb semantic logic (active vs passive) is explicitly explained for any passive distractor.
4. Keep the explanation clear, natural, and formatted for B1-B2 English learners with bullet points:
   * Why '[option]' is incorrect: [specific reason]
5. Address the correct answer AND every distractor.

RESPONSE FORMAT — return ONLY valid JSON:
{{
  "proposed_explanation": "The complete, revised student-facing explanation incorporating all consensus fixes",
  "proposed_concise": "One-sentence summary of why this answer is correct (max 50 words)",
  "proposed_grammar_tag": "The reconciled, factually verified grammar category",
  "reconciliation_summary": "How the disagreements between models were resolved"
}}
"""


# ── Single Model Audit ───────────────────────────────────────────────────────

def audit_single_model(
    model_key: str,
    answer_with_blanks: str,
    full_text: str,
    explanation: str,
    grammar_tag: str,
    correct_answer: str,
    options: list[str],
) -> dict:
    model_name = MODELS[model_key]
    role_titles = {
        "dr": "expert English linguistics fact-checker and diagnostic linguist",
        "qw": "senior ESL editor and grammatical cohesion reviewer",
        "gm": "expert English language quality auditor and structural reviewer",
    }
    role = role_titles.get(model_key, "expert English linguist")

    prompt = build_audit_prompt(
        answer_with_blanks, full_text, explanation,
        grammar_tag, correct_answer, options,
        model_role_title=role,
    )

    raw = query_ollama(model_name, prompt, temperature=0.1, max_retries=4, timeout=300, json_mode=False)
    if not raw:
        return {
            "model": model_name,
            "model_key": model_key,
            "verdict": "ERROR",
            "issues": [{"type": "timeout_error", "description": f"{model_name} failed to respond", "affected_text": "", "correction": ""}],
            "verified_grammar_tag": grammar_tag,
            "overall_notes": f"Model {model_name} timed out or produced no response",
        }

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {
            "model": model_name,
            "model_key": model_key,
            "verdict": "ERROR",
            "issues": [{"type": "parse_error", "description": "Invalid JSON response", "affected_text": "", "correction": ""}],
            "verified_grammar_tag": grammar_tag,
            "overall_notes": f"Invalid JSON returned: {raw[:150]}",
        }

    verdict = str(data.get("verdict", "FAIL")).upper().strip()
    if verdict not in ["PASS", "FAIL"]:
        verdict = "FAIL" if data.get("issues") else "PASS"

    issues = data.get("issues", [])
    if not isinstance(issues, list):
        issues = []

    return {
        "model": model_name,
        "model_key": model_key,
        "verdict": verdict,
        "issues": issues,
        "verified_grammar_tag": str(data.get("verified_grammar_tag", grammar_tag)).strip() or grammar_tag,
        "overall_notes": str(data.get("overall_notes", "")).strip(),
    }


# ── Multi-Model Audit & Debate Engine ───────────────────────────────────────

def run_multi_model_audit_for_blank(
    answer_with_blanks: str,
    full_text: str,
    blank_data: dict,
    options: list[str],
    max_debate_rounds: int = 3,
) -> dict:
    b_idx = blank_data.get("blank_index", "?")
    correct_answer = blank_data.get("correct_answer", "")
    current_grammar_tag = blank_data.get("grammar_tag", "")
    current_explanation = blank_data.get("final_explanation", "")
    current_concise = blank_data.get("concise_explanation", "")

    if not current_explanation.strip():
        return {
            "blank_index": b_idx,
            "final_verdict": "FAIL",
            "votes": {"PASS": 0, "FAIL": 3, "details": []},
            "debate_rounds": 0,
            "debate_history": [],
            "final_explanation": "",
            "final_concise": "",
            "final_grammar_tag": current_grammar_tag,
            "consensus_type": "EMPTY_INPUT",
        }

    # ── Round 1: Independent 3-Juror Audit ──
    logging.info(f"      [Round 1] Gathering independent votes from all 3 models...")
    juror_votes = []
    for mkey in ["dr", "qw", "gm"]:
        t0 = time.time()
        vote = audit_single_model(
            mkey, answer_with_blanks, full_text,
            current_explanation, current_grammar_tag,
            correct_answer, options,
        )
        elapsed = time.time() - t0
        juror_votes.append(vote)
        logging.info(f"        Juror [{MODELS[mkey]}]: {vote['verdict']} ({len(vote['issues'])} issues, {elapsed:.1f}s)")

    pass_count = sum(1 for v in juror_votes if v["verdict"] == "PASS")
    fail_count = sum(1 for v in juror_votes if v["verdict"] != "PASS")

    # If 2/3 approve, the target passes immediately!
    if pass_count >= 2:
        reconciled_tag = current_grammar_tag
        for v in juror_votes:
            if v["verdict"] == "PASS" and v["verified_grammar_tag"]:
                reconciled_tag = v["verified_grammar_tag"]
                break

        logging.info(f"      ✓ PASSED by consensus ({pass_count}/3 approvals).")
        return {
            "blank_index": b_idx,
            "final_verdict": "PASS",
            "round_1_votes": {"pass": pass_count, "fail": fail_count, "details": juror_votes},
            "debate_rounds": 0,
            "debate_history": [],
            "final_explanation": current_explanation,
            "final_concise": current_concise,
            "final_grammar_tag": reconciled_tag,
            "consensus_type": "ROUND1_APPROVAL",
        }

    # ── Disapproved by 2/3 models -> Enter Debate & Consensus Loop ──
    logging.info(f"      ⚠️ DISAPPROVED ({fail_count}/3 rejections) -> Initiating Debate & Consensus Loop...")
    debate_history = []
    candidate_explanation = current_explanation
    candidate_concise = current_concise
    candidate_tag = current_grammar_tag
    last_critiques = juror_votes

    for round_num in range(1, max_debate_rounds + 1):
        logging.info(f"      --- Debate Round {round_num}/{max_debate_rounds} ---")
        synth_prompt = build_debate_synthesis_prompt(
            answer_with_blanks, full_text, correct_answer, options,
            candidate_explanation, candidate_tag, last_critiques, round_num,
        )

        synth_raw = query_ollama(MODELS["qw"], synth_prompt, temperature=0.2, max_retries=4, timeout=300)
        if not synth_raw:
            logging.warning(f"        Qwen3 debate synthesis failed, falling back to Gemma4...")
            synth_raw = query_ollama(MODELS["gm"], synth_prompt, temperature=0.2, max_retries=4, timeout=300)

        if not synth_raw:
            logging.error(f"        Debate synthesis failed in round {round_num}.")
            break

        try:
            synth_data = json.loads(synth_raw)
            candidate_explanation = synth_data.get("proposed_explanation", candidate_explanation)
            candidate_concise = synth_data.get("proposed_concise", candidate_concise)
            candidate_tag = synth_data.get("proposed_grammar_tag", candidate_tag)
            reconcile_summary = synth_data.get("reconciliation_summary", "")
        except json.JSONDecodeError:
            logging.error(f"        Invalid JSON in debate synthesis round {round_num}.")
            break

        # Re-evaluate candidate explanation with all 3 models
        logging.info(f"        Re-evaluating synthesized explanation with 3 models for mutual consent...")
        round_votes = []
        for mkey in ["dr", "qw", "gm"]:
            t0 = time.time()
            v = audit_single_model(
                mkey, answer_with_blanks, full_text,
                candidate_explanation, candidate_tag,
                correct_answer, options,
            )
            round_votes.append(v)
            logging.info(f"          Re-vote [{MODELS[mkey]}]: {v['verdict']} ({len(v['issues'])} issues, {time.time()-t0:.1f}s)")

        round_passes = sum(1 for v in round_votes if v["verdict"] == "PASS")
        debate_history.append({
            "round": round_num,
            "reconciliation_summary": reconcile_summary,
            "candidate_explanation": candidate_explanation,
            "candidate_grammar_tag": candidate_tag,
            "votes": round_votes,
            "pass_count": round_passes,
        })

        # Check for 3/3 Unanimous Mutual Consent
        if round_passes == 3:
            logging.info(f"      🎉 MUTUAL CONSENT ACHIEVED (3/3 Unanimous PASS) in Debate Round {round_num}!")
            return {
                "blank_index": b_idx,
                "final_verdict": "FIXED_CONSENSUS",
                "round_1_votes": {"pass": pass_count, "fail": fail_count, "details": juror_votes},
                "debate_rounds": round_num,
                "debate_history": debate_history,
                "final_explanation": candidate_explanation,
                "final_concise": candidate_concise,
                "final_grammar_tag": candidate_tag,
                "consensus_type": "UNANIMOUS_MUTUAL_CONSENT",
            }

        last_critiques = round_votes

    # If loop concludes without 3/3 unanimous consent, check if 2/3 consent was reached
    best_round = max(debate_history, key=lambda r: r["pass_count"]) if debate_history else None
    if best_round and best_round["pass_count"] >= 2:
        logging.info(f"      ✓ MAJORITY CONSENT ({best_round['pass_count']}/3) achieved after {len(debate_history)} debate rounds.")
        return {
            "blank_index": b_idx,
            "final_verdict": "FIXED_MAJORITY",
            "round_1_votes": {"pass": pass_count, "fail": fail_count, "details": juror_votes},
            "debate_rounds": len(debate_history),
            "debate_history": debate_history,
            "final_explanation": best_round["candidate_explanation"],
            "final_concise": candidate_concise,
            "final_grammar_tag": best_round["candidate_grammar_tag"],
            "consensus_type": "MAJORITY_CONSENT",
        }

    logging.warning(f"      ⚠️ UNRESOLVED DEBATE after {max_debate_rounds} rounds.")
    return {
        "blank_index": b_idx,
        "final_verdict": "UNRESOLVED_DEBATE",
        "round_1_votes": {"pass": pass_count, "fail": fail_count, "details": juror_votes},
        "debate_rounds": len(debate_history),
        "debate_history": debate_history,
        "final_explanation": candidate_explanation,
        "final_concise": candidate_concise,
        "final_grammar_tag": candidate_tag,
        "consensus_type": "UNRESOLVED_DEBATE",
    }


# ── Question Auditor ─────────────────────────────────────────────────────────

def audit_question_multi_model(
    record: dict,
    answer_text: str,
    full_text: str,
    workbook_blanks: list[dict],
    max_debate_rounds: int = 3,
) -> dict:
    qid = record["id"]
    blanks = record.get("blanks", [])
    audited_record = copy.deepcopy(record)

    total_r1_pass = 0
    total_mutual_consent = 0
    total_majority_consent = 0
    total_unresolved = 0
    blank_audit_details = []

    for i, blank_data in enumerate(blanks):
        b_idx = blank_data.get("blank_index", i + 1)
        wb_blank = workbook_blanks[i] if i < len(workbook_blanks) else None

        if wb_blank and wb_blank.get("options"):
            options = wb_blank["options"]
        else:
            options = [blank_data.get("correct_answer", "")]
            for d in blank_data.get("dr_distractor_analysis", []):
                opt = d.get("option")
                if opt and opt not in options:
                    options.append(opt)

        logging.info(f"    Auditing blank {b_idx}/{len(blanks)} ('{blank_data.get('correct_answer', '')}') ...")

        audit_res = run_multi_model_audit_for_blank(
            answer_text, full_text, blank_data, options,
            max_debate_rounds=max_debate_rounds,
        )

        v = audit_res["final_verdict"]
        if v == "PASS":
            total_r1_pass += 1
        elif v == "FIXED_CONSENSUS":
            total_mutual_consent += 1
        elif v == "FIXED_MAJORITY":
            total_majority_consent += 1
        else:
            total_unresolved += 1

        # Apply updated fields
        audited_record["blanks"][i]["final_explanation"] = audit_res["final_explanation"]
        audited_record["blanks"][i]["concise_explanation"] = audit_res["final_concise"]
        audited_record["blanks"][i]["grammar_tag"] = audit_res["final_grammar_tag"]
        audited_record["blanks"][i]["audit_verdict"] = v
        audited_record["blanks"][i]["audit_consensus_type"] = audit_res["consensus_type"]
        audited_record["blanks"][i]["debate_rounds_run"] = audit_res["debate_rounds"]

        blank_audit_details.append(audit_res)

    overall_status = "PASS"
    if total_unresolved > 0:
        overall_status = "UNRESOLVED"
    elif total_mutual_consent > 0 or total_majority_consent > 0:
        overall_status = "REVISED_WITH_CONSENSUS"

    audited_record["audit_status"] = overall_status
    audited_record["audit_summary"] = {
        "round1_passed_blanks": total_r1_pass,
        "mutual_consent_fixed_blanks": total_mutual_consent,
        "majority_consent_fixed_blanks": total_majority_consent,
        "unresolved_blanks": total_unresolved,
        "total_blanks": len(blanks),
        "details": blank_audit_details,
    }
    audited_record["audit_timestamp"] = datetime.now(timezone.utc).isoformat()

    logging.info(f"  [AUDIT RESULT] Q{qid}: {overall_status} (R1_PASS={total_r1_pass}, MUTUAL_CONSENT={total_mutual_consent}, MAJORITY={total_majority_consent}, UNRESOLVED={total_unresolved})")
    return audited_record


# ── Workbook Loader ──────────────────────────────────────────────────────────

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
        description="Multi-LLM 3-Model Quality Audit & Debate Engine for RFIB Explanations"
    )
    parser.add_argument("--input", default=INPUT_REVISION,
                        help="Path to 3-model revision JSONL")
    parser.add_argument("--workbook", default=INPUT_WORKBOOK,
                        help="Path to RFIB workbook XLSX")
    parser.add_argument("--out", default=OUTPUT_AUDITED,
                        help="Output path for audited JSONL")
    parser.add_argument("--debate-report", default=OUTPUT_DEBATE_REPORT,
                        help="Output path for debate summary report JSON")
    parser.add_argument("--sample-pct", type=float, default=0.20,
                        help="Percentage of questions to randomly audit (default 0.20 = 20 percent)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for reproducible 20% sampling")
    parser.add_argument("--ids", type=str,
                        help="Comma-separated question IDs to audit explicitly")
    parser.add_argument("--limit", type=int,
                        help="Max questions to audit (for smoke tests)")
    parser.add_argument("--max-debate-rounds", type=int, default=3,
                        help="Max rounds of debate before concluding consensus")
    parser.add_argument("--save-every", type=int, default=1,
                        help="Save output every N questions")
    parser.add_argument("--no-resume", action="store_true",
                        help="Re-audit questions already in output file")
    return parser.parse_args()


def main():
    args = parse_args()

    logging.info("Loading 3-model revision dataset ...")
    revision_records = load_jsonl(args.input)
    logging.info(f"  Loaded {len(revision_records)} revision records")

    logging.info("Loading workbook data ...")
    workbook_data = load_workbook_data(args.workbook)
    logging.info(f"  Loaded {len(workbook_data)} workbook questions")

    audited_records = load_jsonl(args.out) if not args.no_resume else {}
    logging.info(f"  Already audited records: {len(audited_records)}")

    # Determine candidate IDs to audit
    all_revised_ids = sorted(revision_records.keys())
    
    if args.ids:
        target_ids = [int(x.strip()) for x in args.ids.split(",") if x.strip()]
        target_ids = [qid for qid in target_ids if qid in revision_records]
        logging.info(f"  Targeting explicit {len(target_ids)} IDs: {target_ids}")
    else:
        # Sample percentage with reproducible seed
        rng = random.Random(args.seed)
        sample_size = int(len(all_revised_ids) * args.sample_pct)
        target_ids = sorted(rng.sample(all_revised_ids, sample_size))
        logging.info(f"  Randomly sampled {len(target_ids)} questions ({args.sample_pct*100:.0f}% of {len(all_revised_ids)}, seed={args.seed})")

    if args.limit:
        target_ids = target_ids[:args.limit]
        logging.info(f"  Limiting to first {len(target_ids)} questions for this run")

    if not args.no_resume:
        unprocessed_ids = [qid for qid in target_ids if qid not in audited_records]
        logging.info(f"  Questions remaining after resume filter: {len(unprocessed_ids)} / {len(target_ids)}")
        target_ids = unprocessed_ids

    logging.info(f"\n=======================================================")
    logging.info(f"  STARTING 3-MODEL AUDIT & DEBATE ON {len(target_ids)} QUESTIONS")
    logging.info(f"  Models: {MODELS['dr']} (DR), {MODELS['qw']} (QW), {MODELS['gm']} (GM)")
    logging.info(f"  Voting Rule: >=2/3 PASS = Pass | >=2/3 FAIL = Debate until 3/3 Mutual Consent")
    logging.info(f"=======================================================\n")

    debate_report_data = None
    if os.path.exists(args.debate_report) and not args.no_resume:
        try:
            with open(args.debate_report, "r", encoding="utf-8") as f:
                debate_report_data = json.load(f)
            logging.info(f"  Loaded existing debate report with {len(debate_report_data.get('debate_transcripts', []))} transcripts")
        except Exception as e:
            logging.warning(f"  Could not load existing debate report: {e}")
            debate_report_data = None

    if not debate_report_data:
        debate_report_data = {
            "sample_pct": args.sample_pct,
            "sample_seed": args.seed,
            "total_target_questions": len(target_ids) + len(audited_records),
            "processed_questions": len(audited_records) if not args.no_resume else 0,
            "round1_pass_count": 0,
            "debate_revised_count": 0,
            "unresolved_count": 0,
            "debate_transcripts": [],
        }

    save_counter = 0

    for idx, qid in enumerate(target_ids, 1):
        rec = revision_records[qid]
        wb_data = workbook_data.get(qid)
        if not wb_data:
            logging.warning(f"  Q{qid} missing from workbook, skipping")
            continue

        logging.info(f"\n--- [Question {qid}] ({idx}/{len(target_ids)}) | Blanks: {len(rec.get('blanks', []))} ---")
        t0 = time.time()

        audited_q = audit_question_multi_model(
            rec, wb_data["answer_text"], wb_data["full_text"],
            wb_data["blanks"], max_debate_rounds=args.max_debate_rounds,
        )

        elapsed = time.time() - t0
        audited_records[qid] = audited_q
        save_counter += 1

        summary = audited_q.get("audit_summary", {})
        if audited_q.get("audit_status") == "PASS":
            debate_report_data["round1_pass_count"] += 1
        elif audited_q.get("audit_status") == "REVISED_WITH_CONSENSUS":
            debate_report_data["debate_revised_count"] += 1
        else:
            debate_report_data["unresolved_count"] += 1

        debate_report_data["processed_questions"] += 1

        # Capture debate transcripts if any
        for b_detail in summary.get("details", []):
            if b_detail.get("debate_history"):
                debate_report_data["debate_transcripts"].append({
                    "question_id": qid,
                    "blank_index": b_detail.get("blank_index"),
                    "round_1_votes": b_detail.get("round_1_votes"),
                    "debate_rounds": b_detail.get("debate_rounds"),
                    "consensus_type": b_detail.get("consensus_type"),
                    "final_explanation": b_detail.get("final_explanation"),
                    "debate_history": b_detail.get("debate_history"),
                })

        logging.info(f"  Completed Q{qid} in {elapsed:.1f}s")

        if save_counter % args.save_every == 0:
            save_jsonl_atomic(args.out, audited_records)
            save_json(args.debate_report, debate_report_data)

    save_jsonl_atomic(args.out, audited_records)
    save_json(args.debate_report, debate_report_data)

    logging.info(f"\n=======================================================")
    logging.info(f"  AUDIT PASS COMPLETE")
    logging.info(f"  Total Processed: {debate_report_data['processed_questions']}")
    logging.info(f"  Round 1 Passed (>=2/3 approvals): {debate_report_data['round1_pass_count']}")
    logging.info(f"  Debated & Revised to Consensus: {debate_report_data['debate_revised_count']}")
    logging.info(f"  Unresolved Debates: {debate_report_data['unresolved_count']}")
    logging.info(f"  Audited Records Output: {args.out}")
    logging.info(f"  Debate Report Output: {args.debate_report}")
    logging.info(f"=======================================================\n")


if __name__ == "__main__":
    main()
