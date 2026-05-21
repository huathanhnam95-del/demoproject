import os
import sys
import time
import re
import json
import openpyxl
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding='utf-8')

# --- API Configuration ---
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:latest")

EXCEL_PATH = r"C:\Cursor AI\public\database\ROP\ROP\ROP.xlsx"

def safe_save(wb, path):
    temp_path = path + ".tmp.xlsx"
    wb.save(temp_path)
    os.replace(temp_path, path)

def parse_paragraphs(text):
    if not text:
        return []
    # Split robustly at newlines that are followed by number indicators
    parts = re.split(r'\r?\n(?=\s*\d+[.)\s])', text)
    paragraphs = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # Match paragraph number and content
        match = re.match(r'^\s*(\d+)[.)\s]\s*([\s\S]*)$', part)
        if match:
            paragraphs.append(match.group(2).strip())
        else:
            paragraphs.append(part)
    return paragraphs

def parse_json_response(raw: str):
    """Try to parse JSON from the Ollama response, handling markdown fences."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Search for first curly brace to last curly brace
        m = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
    return None

def generate_cohesion_reasons(paragraphs):
    if len(paragraphs) < 2:
        return {}
        
    paras_input = "\n".join([f"{i+1}. {p}" for i, p in enumerate(paragraphs)])
    expected_keys = {f"{i}-{i+1}" for i in range(1, len(paragraphs))}
    keys_str = ", ".join([f'"{k}"' for k in sorted(expected_keys)])
    example_items = [f'  "{k}": "Concise reason why {k.split("-")[1]} follows {k.split("-")[0]}."' for k in sorted(expected_keys)]
    example_json = "{\n" + ",\n".join(example_items) + "\n}"

    prompt = f"""You are an expert English language tutor specializing in the PTE Academic reading section, specifically "Re-order Paragraphs".
Given the correct sequential order of paragraphs:

{paras_input}

Task:
For each correct transition from paragraph i to paragraph i+1 (e.g. 1->2, 2->3, etc.), write a single, extremely concise cohesion reason (maximum 15 words) explaining why paragraph i+1 logically follows paragraph i. Focus on grammatical cohesion (e.g. pronoun references) or lexical cohesion (e.g. transitional phrases, synonyms, or logical flow).

Output must be a raw JSON object containing exactly the following keys: {keys_str}
For example:
{example_json}

Rules:
- Do NOT wrap in markdown code blocks.
- Output raw valid JSON only.
- Each reason MUST be under 15 words.
"""

    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "num_ctx": 4096,
            "num_predict": 512
        }
    }

    for attempt in range(1, 4):
        try:
            response = requests.post(url, json=payload, timeout=60)
            if response.status_code == 200:
                res_json = response.json()
                content_text = res_json.get("response", "")
                data = parse_json_response(content_text)
                if isinstance(data, dict):
                    # Validate all expected transition keys exist
                    if expected_keys.issubset(data.keys()):
                        # Clean and return only the expected keys
                        validated_data = {k: str(data[k]).strip() for k in expected_keys}
                        return validated_data
                print(f"Attempt {attempt}/3: Missing or invalid keys. Keys received: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
            else:
                print(f"Attempt {attempt}/3: API Error ({response.status_code})")
        except Exception as e:
            print(f"Attempt {attempt}/3: Exception during request: {e}")
        time.sleep(1)
        
    # Return default fallback if all retries fail
    print("WARNING: Returning fallback cohesion reasons.")
    fallback = {}
    for i in range(1, len(paragraphs)):
        fallback[f"{i}-{i+1}"] = f"Paragraph {i+1} logically flows from paragraph {i}."
    return fallback

def is_valid_cohesion_json(cell_value, expected_num_transitions):
    if not cell_value:
        return False
    try:
        data = json.loads(str(cell_value))
        if not isinstance(data, dict):
            return False
        if len(data) != expected_num_transitions:
            return False
        # Verify keys format (e.g. "1-2", "2-3")
        expected_keys = {f"{i}-{i+1}" for i in range(1, expected_num_transitions + 1)}
        if not expected_keys.issubset(data.keys()):
            return False
        return True
    except Exception:
        return False

def worker(row_idx, q_id, answer_text):
    paras = parse_paragraphs(answer_text)
    if not paras:
        return row_idx, "{}"
    
    reasons = generate_cohesion_reasons(paras)
    return row_idx, json.dumps(reasons, ensure_ascii=False)

def main():
    print(f"Loading workbook: {EXCEL_PATH}...")
    wb = openpyxl.load_workbook(EXCEL_PATH)
    sheet = wb.active

    # Check and add header for Column G
    c7 = sheet.cell(row=1, column=7).value
    if c7 != "COHESION_REASONS":
        sheet.cell(row=1, column=7, value="COHESION_REASONS")
        safe_save(wb, EXCEL_PATH)
        print("Added Column G header 'COHESION_REASONS'")

    max_row = sheet.max_row
    tasks = []

    # Identify rows that need processing
    for row_idx in range(2, max_row + 1):
        q_id = sheet.cell(row=row_idx, column=1).value
        answer_text = sheet.cell(row=row_idx, column=3).value
        existing_reasons = sheet.cell(row=row_idx, column=7).value

        if not q_id or not answer_text:
            continue

        paras = parse_paragraphs(answer_text)
        expected_transitions = len(paras) - 1

        if expected_transitions <= 0:
            # Single paragraph, write empty dict
            sheet.cell(row=row_idx, column=7, value="{}")
            continue

        if is_valid_cohesion_json(existing_reasons, expected_transitions):
            continue

        tasks.append((row_idx, q_id, answer_text))

    total_tasks = len(tasks)
    print(f"Pending rows to process for cohesion reasons: {total_tasks} / {max_row - 1}")
    if total_tasks == 0:
        print("All rows already have valid cohesion reasons. Complete.")
        return

    success_count = 0
    fail_count = 0

    # Process using ThreadPoolExecutor
    # 4 workers balances speed and CPU usage for local Ollama
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(worker, row_idx, q_id, answer_text): (row_idx, q_id)
            for row_idx, q_id, answer_text in tasks
        }

        for future in as_completed(futures):
            row_idx, q_id = futures[future]
            try:
                row_idx, reasons_json = future.result()
                if reasons_json and reasons_json != "{}":
                    sheet.cell(row=row_idx, column=7, value=reasons_json)
                    success_count += 1
                    print(f"Row {row_idx}/{max_row} (ID {q_id}): Generated cohesion reasons. ({success_count}/{total_tasks})")

                    # Save periodically
                    if success_count % 10 == 0:
                        safe_save(wb, EXCEL_PATH)
                        print("Saved progress to ROP.xlsx.")
                else:
                    fail_count += 1
                    print(f"Row {row_idx}/{max_row} (ID {q_id}): Failed to generate.")
            except Exception as exc:
                fail_count += 1
                print(f"Row {row_idx} exception: {exc}")

    safe_save(wb, EXCEL_PATH)
    print(f"\nProcessing finished! Success: {success_count}, Failed: {fail_count}")

if __name__ == "__main__":
    main()
