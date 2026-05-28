import os
import time
import re
import openpyxl
import requests

# --- API Configuration ---
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:latest")

EXCEL_PATH = r"C:\Cursor AI\public\database\RMCMA\RMCMA\RMCMA.xlsx"
CHOICE_RE = re.compile(r'^\[([xX\s]*)\]\s*(.*)$')


def parse_choice_line(line):
    match = CHOICE_RE.match(line.strip())
    if not match:
        return None
    return {
        'text': match.group(2).strip(),
        'is_correct': 'x' in match.group(1).lower()
    }


def is_negative_prompt(question):
    return bool(re.search(r'\b(false|incorrect|not true|not correct)\b', question or '', re.IGNORECASE))

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
                    parsed_choice = parse_choice_line(line)
                    if parsed_choice:
                        choices.append(parsed_choice)
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
        parsed_choice = parse_choice_line(line)
        if parsed_choice:
            choices.append(parsed_choice)
            
    return {
        'passage': passage,
        'question': question,
        'choices': choices
    }

def generate_explanation(parsed_data):
    passage = parsed_data['passage']
    question = parsed_data['question']
    negative_prompt = is_negative_prompt(question)
    
    options_lines = []
    for c in parsed_data['choices']:
        label = "Selected answer" if c['is_correct'] else "Not selected"
        options_lines.append(f"- {c['text']} {label}")
    options_text = "\n".join(options_lines)
    negative_guidance = """
Important logic note:
This is a negative-prompt question. The selected answers are the statements that are false or incorrect according to the passage.
Do not label options as simply "Correct" or "Incorrect" because that can confuse answer-key correctness with statement truth.
For each option, use "Selected" or "Not selected", then explain whether the statement itself is true or false according to the passage.
""" if negative_prompt else """
Important logic note:
Use "Selected" or "Not selected" when discussing the answer key, and separately explain whether each option is supported by the passage.
Avoid bare "Correct" or "Incorrect" labels that could be misread as statement truth rather than answer-key status.
"""
    
    prompt = f"""
You are an expert PTE Academic tutor.
Analyze the following reading passage, question, and options, and provide a clear, detailed, and easy-to-understand explanation of the answer key.

PASSAGE:
{passage}

QUESTION:
{question}

OPTIONS:
{options_text}

{negative_guidance}

Task Instructions:
1. Explain why each selected answer belongs in the answer key by citing relevant information or context from the passage.
2. Explain why each not-selected option does not belong in the answer key, pointing out where the passage contradicts it, supports it, or does not mention it.
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
        response = requests.post(url, json=payload, timeout=90)
        if response.status_code == 200:
            return response.json().get("response", "").strip()
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
            
        print(f"Row {row_idx} (ID {q_id}): Querying Ollama ({OLLAMA_MODEL})...")
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
