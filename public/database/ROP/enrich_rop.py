import os
import time
import re
import json
import openpyxl
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- API Configuration ---
API_KEY = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
PROJECT_ID = "gen-lang-client-0677756745"
LOCATION = "us-central1"
MODEL = "gemini-2.5-flash"

EXCEL_PATH = r"C:\Cursor AI\public\database\ROP\ROP\ROP.xlsx"

def parse_paragraphs(text):
    if not text:
        return []
    # Standard splitting by newline
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    paragraphs = []
    for line in lines:
        # Match pattern like "1. ", "1) ", "1 ", etc.
        match = re.match(r'^(\d+)[.)\s]\s*(.*)$', line)
        if match:
            paragraphs.append(match.group(2).strip())
        else:
            paragraphs.append(line)
    return paragraphs

def generate_enrichment(paragraphs):
    paras_input = "\n".join([f"{i+1}. {p}" for i, p in enumerate(paragraphs)])
    
    prompt = f"""
You are an expert English language tutor specializing in the PTE Academic reading section, specifically "Re-order Paragraphs".
Given the correct sequential order of paragraphs below:

{paras_input}

Task Instructions:
1. Identify 2-4 key cohesive links between the paragraphs. These include:
   - Grammatical cohesion: pronouns (he, she, it, they, these, this, that), demonstratives, substitution (one, the other, doing so), ellipsis.
   - Lexical cohesion: synonyms, keyword repetition, collocations, or transitional words/phrases (however, therefore, thus, in addition).
2. Rewrite the paragraphs by adding cohesive linking span tags. Wrap the cohesive markers (such as pronouns, repeating keywords, transitional words) and their referents in `<span class="cohesion-link" data-link="groupN" data-tooltip="Tooltip description">...</span>` tags where N is a number starting from 1 (e.g. group1, group2) representing each cohesive relationship.
   For example, in paragraph 1 you might wrap:
   "<span class="cohesion-link" data-link="group1" data-tooltip="Referenced by: This process">endothermic reaction</span>"
   And in paragraph 2:
   "<span class="cohesion-link" data-link="group1" data-tooltip="Reference to: endothermic reaction">This process</span>"
3. Do NOT modify the text inside the paragraphs besides wrapping elements in the `<span>` tags. Keep formatting intact.
4. Generate a detailed, educational explanation in HTML format that details the logical flow, focusing heavily on Grammatical Cohesion and Lexical Cohesion that link the paragraphs together (refer to the group link numbers).
5. Output the result strictly in this JSON format:
{{
  "enriched_paragraphs": [
     "Paragraph 1 text with spans...",
     "Paragraph 2 text with spans...",
     ...
  ],
  "explanation": "HTML explanation here..."
}}

Rules:
- Do NOT wrap in markdown backticks.
- Return raw JSON content only.
- Write explanation using standard HTML: <p>, <strong>, <ul>, <li>. Do NOT include <html> or <body> tags.
- Tone must be encouraging, supportive, and educational.
"""

    url = f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL}:generateContent?key={API_KEY}"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    }
    
    try:
        response = requests.post(url, json=payload, timeout=45)
        if response.status_code == 200:
            res_json = response.json()
            content_text = res_json['candidates'][0]['content']['parts'][0]['text']
            # Parse JSON out of response
            data = json.loads(content_text.strip())
            return data
        else:
            print(f"API Error ({response.status_code}): {response.text}")
            return None
    except Exception as e:
        print(f"Exception during request: {e}")
        return None

def process_row(row_idx, q_id, title, answer_text):
    paras = parse_paragraphs(answer_text)
    if not paras:
        return row_idx, q_id, None, None
    
    result = generate_enrichment(paras)
    if not result:
        return row_idx, q_id, None, None
    
    # Reassemble enriched answers with index prefixes
    enriched_paras = result.get("enriched_paragraphs", [])
    enriched_text = ""
    if enriched_paras and len(enriched_paras) == len(paras):
        enriched_text = "\n".join([f"{i+1}. {p}" for i, p in enumerate(enriched_paras)])
    else:
        # Fallback if AI returned incorrect count
        enriched_text = "\n".join([f"{i+1}. {p}" for i, p in enumerate(paras)])
        
    explanation = result.get("explanation", "")
    return row_idx, q_id, enriched_text, explanation

def main():
    print(f"Loading workbook: {EXCEL_PATH}...")
    wb = openpyxl.load_workbook(EXCEL_PATH)
    sheet = wb.active
    
    # Check headers
    # Ensure there are at least 5 columns
    c4 = sheet.cell(row=1, column=4).value
    c5 = sheet.cell(row=1, column=5).value
    
    if c4 != "ENRICHED_ANSWER":
        sheet.cell(row=1, column=4, value="ENRICHED_ANSWER")
        wb.save(EXCEL_PATH)
        print("Added Column D header 'ENRICHED_ANSWER'")
    if c5 != "EXPLANATION":
        sheet.cell(row=1, column=5, value="EXPLANATION")
        wb.save(EXCEL_PATH)
        print("Added Column E header 'EXPLANATION'")
        
    max_row = sheet.max_row
    tasks = []
    
    # Identify rows that need processing
    for row_idx in range(2, max_row + 1):
        q_id = sheet.cell(row=row_idx, column=1).value
        title = sheet.cell(row=row_idx, column=2).value
        answer_text = sheet.cell(row=row_idx, column=3).value
        existing_explanation = sheet.cell(row=row_idx, column=5).value
        
        # If we already have a long explanation, skip
        if existing_explanation and len(str(existing_explanation).strip()) > 20:
            continue
            
        tasks.append((row_idx, q_id, title, answer_text))
        
    total_tasks = len(tasks)
    print(f"Pending tasks to enrich: {total_tasks}")
    if total_tasks == 0:
        print("No pending tasks. Enrichment complete.")
        return

    # For testing/safety, we will let the script run and print row-by-row logs.
    success_count = 0
    fail_count = 0
    
    # We can process the tasks one-by-one or in parallel.
    # To run a fast demo/validation, we will do it in parallel but safely.
    # Limit max workers to 4 to avoid hitting API rate limits.
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_row = {
            executor.submit(process_row, row_idx, q_id, title, answer_text): (row_idx, q_id)
            for row_idx, q_id, title, answer_text in tasks
        }
        
        for future in as_completed(future_to_row):
            row_idx, q_id = future_to_row[future]
            try:
                row_idx, q_id, enriched_text, explanation = future.result()
                if explanation and enriched_text:
                    # Thread-safe write by reloading and saving
                    wb_write = openpyxl.load_workbook(EXCEL_PATH)
                    sheet_write = wb_write.active
                    sheet_write.cell(row=row_idx, column=4, value=enriched_text)
                    sheet_write.cell(row=row_idx, column=5, value=explanation)
                    wb_write.save(EXCEL_PATH)
                    success_count += 1
                    print(f"Row {row_idx}/{max_row} (ID {q_id}): Enriched. ({success_count}/{total_tasks})")
                else:
                    fail_count += 1
                    print(f"Row {row_idx}/{max_row} (ID {q_id}): Failed to generate enrichment.")
            except Exception as exc:
                fail_count += 1
                print(f"Row {row_idx} (ID {q_id}) exception: {exc}")
                
    print(f"\nProcessing finished! Success: {success_count}, Failed: {fail_count}")

if __name__ == "__main__":
    main()
