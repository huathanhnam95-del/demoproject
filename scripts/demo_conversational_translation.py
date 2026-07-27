import sys
import requests
import json

sys.stdout.reconfigure(encoding='utf-8')

with open('public/database/RFIB/RFIB_3model_revision.jsonl', 'r', encoding='utf-8') as f:
    records = [json.loads(line) for line in f]

q1 = next(r for r in records if r['id'] == 1)
blank1 = q1['blanks'][0]
exp = blank1['final_explanation']

models = [
    ('DeepSeek-R1 (14B)', 'deepseek-r1:14b'),
    ('Qwen3 (14B)', 'qwen3:14b'),
    ('Gemma4 (Latest)', 'gemma4:latest')
]

prompt = f"""You are a warm, engaging, and expert English teacher having a 1-on-1 interactive conversation with a Vietnamese student studying PTE Reading Fill-in-the-Blanks.

GOAL: Explain the answer in friendly, natural, human Vietnamese, making it feel like a real conversation.

RULES:
1. Use an interactive, human teacher persona (calling the student "em" and asking friendly reflective questions like "Em có chú ý... không?").
2. DO NOT repeat rigid repetitive headings like "Why 'X' is incorrect:". PARAPHRASE and translate distractor questions naturally into conversational Vietnamese (e.g., "Thế còn phương án 'was receiving' thì sao nhỉ?", "Tại sao 'had received' lại chưa chuẩn trong câu này?").
3. KEEP exact option choices (e.g., 'received', 'was receiving'), grammar terms (e.g., 'Past Simple Tense', 'Past Continuous'), and English quotes in ENGLISH.
4. Include a quick reflective question or encouraging takeaway at the end to guide the student.

English Explanation:
{exp}

Interactive Vietnamese Teacher Explanation:"""

results = {}

print('=== Querying Models for Interactive Conversational Teacher Demo ===')
for m_label, m_name in models:
    print(f' -> Querying {m_label} ...')
    try:
        resp = requests.post('http://localhost:11434/api/generate', json={
            'model': m_name,
            'prompt': prompt,
            'stream': False,
            'options': {'temperature': 0.3}
        }, timeout=120)
        text = resp.json().get('response', '').strip()
        if '<think>' in text and '</think>' in text:
            text = text.split('</think>')[-1].strip()
        results[m_label] = text
    except Exception as e:
        results[m_label] = f'Error: {e}'

with open('public/database/RFIB/conversational_comparison_demo.json', 'w', encoding='utf-8') as out_f:
    json.dump(results, out_f, ensure_ascii=False, indent=2)

print('SUCCESS: Conversational teacher comparison generated.')
