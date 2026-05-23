import os
import time
import re
import sys
import openpyxl
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding="utf-8")

# --- API Configuration ---
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:latest")

EXCEL_PATH = r"C:\Cursor AI\public\database\LMCMA\LMCMA\LMCMA.xlsx"

def safe_save(workbook, path, retries=5):
    temp_path = f"{path}.tmp.{os.getpid()}.xlsx"
    workbook.save(temp_path)
    for attempt in range(1, retries + 1):
        try:
            os.replace(temp_path, path)
            return
        except PermissionError:
            if attempt == retries:
                raise
            time.sleep(0.2 * attempt)
    if os.path.exists(temp_path):
        os.remove(temp_path)

def parse_lmcma_content(text):
    if not text:
        return None
    
    # Split by hyphens (at least 3 hyphens)
    parts = [p.strip() for p in re.split(r'-{3,}', text) if p.strip()]
    if len(parts) < 2:
        return None
        
    question = parts[0]
    choices_str = parts[1]
    
    choices = []
    for line in choices_str.split('\n'):
        trimmed = line.strip()
        match = re.match(r'^\[([xX\s]*)\]\s*(.*)$', trimmed)
        if match:
            is_correct = "x" in match.group(1).lower()
            choice_text = match.group(2).strip()
            choices.append({
                'text': choice_text,
                'is_correct': is_correct
            })
            
    return {
        'question': question,
        'choices': choices
    }

def generate_explanation(parsed_data, transcript):
    question = parsed_data['question']
    
    options_lines = []
    for c in parsed_data['choices']:
        label = "(Correct)" if c['is_correct'] else "(Incorrect)"
        options_lines.append(f"- {c['text']} {label}")
    options_text = "\n".join(options_lines)
    
    prompt = f"""
You are an expert PTE Academic tutor.
Analyze the following listening transcript, question, and options, and provide a clear, detailed, and easy-to-understand explanation of the correct and incorrect answers.

TRANSCRIPT:
{transcript}

QUESTION:
{question}

OPTIONS:
{options_text}

Task Instructions:
1. Explain why the correct options are correct by citing relevant information or context from the transcript.
2. Explain why each incorrect option is wrong, pointing out where the transcript contradicts it or why it is not mentioned/relevant.
3. Write the response in clean HTML format. Use standard HTML tags:
   - Use <p> for paragraphs.
   - Use <strong> for emphasis.
   - Use <ul> and <li> for lists.
   - Do NOT include any outer markdown backticks (such as ```html) or outer wrapping tags like <html>, <body>. Start directly with the HTML content.
   - Make the tone supportive, encouraging, and highly instructional.
"""
    
    url = f"{OLLAMA_BASE_URL}/api/generate"
    
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_ctx": 8192,
            "num_predict": 2048
        }
    }
    
    try:
        response = requests.post(url, json=payload, timeout=300)
        if response.status_code == 200:
            return response.json().get("response", "").strip()
        else:
            print(f"API Error ({response.status_code}): {response.text}")
            return None
    except Exception as e:
        print(f"Exception during request: {e}")
        return None

def process_row(row_idx, q_id, title, answer_col, transcript_col):
    parsed = parse_lmcma_content(answer_col)
    if not parsed:
        return row_idx, q_id, None
    
    explanation = generate_explanation(parsed, transcript_col)
    return row_idx, q_id, explanation

def main():
    print(f"Loading workbook: {EXCEL_PATH}...")
    wb = openpyxl.load_workbook(EXCEL_PATH)
    sheet = wb.active
    
    # Ensure header column E is 'EXPLANATION'
    header_val = sheet.cell(row=1, column=5).value
    if header_val != "EXPLANATION":
        sheet.cell(row=1, column=5, value="EXPLANATION")
        safe_save(wb, EXCEL_PATH)
        print("Set Column E header to 'EXPLANATION'")
    
    max_row = sheet.max_row
    tasks = []
    
    # Identify rows that need processing
    for row_idx in range(2, max_row + 1):
        q_id = sheet.cell(row=row_idx, column=1).value
        title = sheet.cell(row=row_idx, column=2).value
        answer_col = sheet.cell(row=row_idx, column=3).value
        transcript_col = sheet.cell(row=row_idx, column=4).value
        existing_explanation = sheet.cell(row=row_idx, column=5).value
        
        if existing_explanation and len(str(existing_explanation).strip()) > 20:
            continue
            
        tasks.append((row_idx, q_id, title, answer_col, transcript_col))
        
    total_tasks = len(tasks)
    print(f"Pending tasks to enrich: {total_tasks}")
    if total_tasks == 0:
        print("No pending tasks. Enrichment complete.")
        return

    success_count = 0
    fail_count = 0
    
    # We use ThreadPoolExecutor with max_workers=1 to process sequentially
    with ThreadPoolExecutor(max_workers=1) as executor:
        future_to_row = {
            executor.submit(process_row, row_idx, q_id, title, answer_col, transcript_col): (row_idx, q_id)
            for row_idx, q_id, title, answer_col, transcript_col in tasks
        }
        
        for future in as_completed(future_to_row):
            row_idx, q_id = future_to_row[future]
            try:
                row_idx, q_id, explanation = future.result()
                if explanation:
                    # Reload workbook to avoid conflict with other saves, write, and save
                    wb_write = openpyxl.load_workbook(EXCEL_PATH)
                    sheet_write = wb_write.active
                    sheet_write.cell(row=row_idx, column=5, value=explanation)
                    safe_save(wb_write, EXCEL_PATH)
                    success_count += 1
                    print(f"Row {row_idx}/{max_row} (ID {q_id}): Successfully enriched. ({success_count}/{total_tasks})")
                else:
                    fail_count += 1
                    print(f"Row {row_idx}/{max_row} (ID {q_id}): Failed to generate explanation.")
            except Exception as exc:
                fail_count += 1
                print(f"Row {row_idx} (ID {q_id}) generated an exception: {exc}")
                
    print(f"\nProcessing finished! Success: {success_count}, Failed: {fail_count}")

if __name__ == "__main__":
    main()
