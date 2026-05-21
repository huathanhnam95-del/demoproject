import os
import time
import re
import openpyxl
import requests

# --- API Configuration ---
API_KEY = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "gen-lang-client-0677756745")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
MODEL = os.environ.get("RMCMA_EXPLANATION_MODEL", "gemini-2.5-flash")

EXCEL_PATH = r"C:\Cursor AI\public\database\RMCMA\RMCMA\RMCMA.xlsx"

def parse_rmcma_content(text):
    if not text:
        return None
    
    # Split by hyphens (at least 3 hyphens, preceded and/or followed by whitespace)
    parts = [p.strip() for p in re.split(r'\n\s*-+\s*\n|\n-+', text) if p.strip()]
    
    if len(parts) < 3:
        # Fallback if split has fewer segments
        parts = [p.strip() for p in re.split(r'-{3,}', text) if p.strip()]
        if len(parts) < 3:
            if len(parts) == 2:
                passage = parts[0]
                rest = parts[1]
                lines = rest.split('\n')
                choices = []
                question_lines = []
                for line in lines:
                    trimmed = line.strip()
                    if trimmed.startswith('[]') or trimmed.startswith('[x]'):
                        is_correct = trimmed.startswith('[x]')
                        choice_text = trimmed[3:].strip()
                        choices.append({
                            'text': choice_text,
                            'is_correct': is_correct
                        })
                    else:
                        if not choices:
                            question_lines.append(line)
                question = "\n".join(question_lines).strip()
                return {
                    'passage': passage,
                    'question': question,
                    'choices': choices
                }
            return None
            
    passage = parts[0]
    question = parts[1]
    choices_str = parts[2]
    
    choices = []
    for line in choices_str.split('\n'):
        trimmed = line.strip()
        if trimmed.startswith('[]') or trimmed.startswith('[x]'):
            is_correct = trimmed.startswith('[x]')
            choice_text = trimmed[3:].strip()
            choices.append({
                'text': choice_text,
                'is_correct': is_correct
            })
            
    return {
        'passage': passage,
        'question': question,
        'choices': choices
    }

def generate_explanation(parsed_data):
    if not API_KEY:
        raise RuntimeError("Set GOOGLE_API_KEY or GEMINI_API_KEY before generating RMCMA explanations.")

    passage = parsed_data['passage']
    question = parsed_data['question']
    
    options_lines = []
    for c in parsed_data['choices']:
        label = "(Correct)" if c['is_correct'] else "(Incorrect)"
        options_lines.append(f"- {c['text']} {label}")
    options_text = "\n".join(options_lines)
    
    prompt = f"""
You are an expert PTE Academic tutor.
Analyze the following reading passage, question, and options, and provide a clear, detailed, and easy-to-understand explanation of the correct and incorrect answers.

PASSAGE:
{passage}

QUESTION:
{question}

OPTIONS:
{options_text}

Task Instructions:
1. Explain why the correct options are correct by citing relevant information or context from the passage.
2. Explain why each incorrect option is wrong, pointing out where the passage contradicts it or why it is not mentioned/relevant.
3. Write the response in clean HTML format. Use standard HTML tags:
   - Use <p> for paragraphs.
   - Use <strong> for emphasis.
   - Use <ul> and <li> for lists.
   - Do NOT include any outer markdown backticks (such as ```html) or outer wrapping tags like <html>, <body>. Start directly with the HTML content.
   - Make the tone supportive, encouraging, and highly instructional.
"""
    
    url = f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL}:generateContent?key={API_KEY}"
    
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2
        }
    }
    
    try:
        response = requests.post(url, json=payload, timeout=30)
        if response.status_code == 200:
            return response.json()['candidates'][0]['content']['parts'][0]['text']
        else:
            print(f"API Error ({response.status_code}): {response.text}")
            return None
    except Exception as e:
        print(f"Exception during request: {e}")
        return None

def main():
    print(f"Loading workbook: {EXCEL_PATH}...")
    wb = openpyxl.load_workbook(EXCEL_PATH)
    sheet = wb.active
    
    # Ensure header column D is 'EXPLANATION'
    header_val = sheet.cell(row=1, column=4).value
    if header_val != "EXPLANATION":
        sheet.cell(row=1, column=4, value="EXPLANATION")
        print("Set Column D header to 'EXPLANATION'")
    
    max_row = sheet.max_row
    print(f"Total rows to process: {max_row - 1}")
    
    success_count = 0
    skip_count = 0
    fail_count = 0
    
    for row_idx in range(2, max_row + 1):
        q_id = sheet.cell(row=row_idx, column=1).value
        title = sheet.cell(row=row_idx, column=2).value
        content = sheet.cell(row=row_idx, column=3).value
        existing_explanation = sheet.cell(row=row_idx, column=4).value
        
        if existing_explanation and len(str(existing_explanation).strip()) > 20:
            print(f"Row {row_idx} (ID {q_id}): Explanation already exists. Skipping.")
            skip_count += 1
            continue
            
        print(f"Row {row_idx}/{max_row} (ID {q_id}): Parsing...")
        parsed = parse_rmcma_content(content)
        if not parsed:
            print(f"Row {row_idx} (ID {q_id}): Failed to parse content!")
            fail_count += 1
            continue
            
        print(f"Row {row_idx} (ID {q_id}): Querying Gemini...")
        explanation = generate_explanation(parsed)
        
        if explanation:
            sheet.cell(row=row_idx, column=4, value=explanation)
            success_count += 1
            print(f"Row {row_idx} (ID {q_id}): Successfully enriched.")
            # Save progress incrementally to avoid loss on failure
            wb.save(EXCEL_PATH)
        else:
            print(f"Row {row_idx} (ID {q_id}): Failed to generate explanation.")
            fail_count += 1
            
        # Respect API rate limits
        time.sleep(1.0)
        
    print(f"\nProcessing finished! Success: {success_count}, Skipped: {skip_count}, Failed: {fail_count}")
    wb.save(EXCEL_PATH)
    print("Workbook saved successfully.")

if __name__ == "__main__":
    main()
