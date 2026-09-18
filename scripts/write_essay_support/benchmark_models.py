import urllib.request
import json
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

test_terms = [
    'abstract concept', 'academic achievement', 'academic career', 'academic circles',
    'academic community', 'academic discipline', 'academic discourse', 'academic institution',
    'academic life', 'academic performance', 'academic research', 'academic skills',
    'academic study', 'academic success', 'academic work', 'academic world',
    'academic writing', 'accept responsibility', 'acceptable behaviour', 'accurate assessment'
]

def test_model(model_name):
    prompt = (
        "You are an expert bilingual academic lexicographer for IELTS/PTE essay writing.\n"
        "For each academic collocation below, provide:\n"
        "1. 'viGloss': authentic, natural, context-aware academic Vietnamese translation (max 15 words).\n"
        "   ELIMINATE literal translation errors (e.g. 'professional body' -> 'tổ chức / hiệp hội chuyên môn', NOT 'cơ thể chuyên nghiệp'; 'governing body' -> 'cơ quan quản trị / điều hành'; 'international body' -> 'tổ chức quốc tế').\n"
        "2. 'enGloss': meaningful, non-boilerplate English definition explaining what the phrase means and its academic function (max 15 words). Do NOT use generic placeholder text.\n"
        "Return STRICT JSON mapping term to object:\n"
        "{\n"
        '  "term": {"enGloss": "...", "viGloss": "..."}\n'
        "}\n"
        f"Terms: {json.dumps(test_terms)}"
    )
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 4096}
    }
    if not any(r in model_name.lower() for r in ["deepseek-r1", "-r1", "/r1", "reasoner", "qwq"]):
        payload["think"] = False
    t0 = time.time()
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        content = data.get("message", {}).get("content", "")
        if "<think>" in content and "</think>" in content:
            content = content.split("</think>")[-1].strip()
        elapsed = time.time() - t0
        print(f"{model_name} took {elapsed:.2f}s")
        parsed = json.loads(content)
        print(f"Returned {len(parsed)} items")
        for k in list(parsed.keys())[:3]:
            print(f"  {k}: {parsed[k]}")

test_model("gemma4:12b")
