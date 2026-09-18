import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

test_terms = ['professional body', 'governing body', 'international body', 'provide foundation', 'rote memorization', 'academic discourse']
prompt = (
    "You are an expert bilingual academic lexicographer for IELTS/PTE essay writing.\n"
    "For each academic collocation below, provide:\n"
    "1. 'viGloss': authentic, natural, context-aware academic Vietnamese translation (max 15 words).\n"
    "   ELIMINATE literal machine translation errors (e.g. 'professional body' -> 'tổ chức / hiệp hội chuyên môn', NOT 'cơ thể chuyên nghiệp'; 'governing body' -> 'cơ quan quản trị / điều hành', NOT 'cơ thể quản lý'; 'international body' -> 'tổ chức quốc tế').\n"
    "2. 'enGloss': meaningful, non-boilerplate English definition explaining what the phrase means and its academic function (max 15 words). Do NOT use generic placeholder text like 'Natural academic collocation enhancing coherence'.\n"
    "Return STRICT JSON mapping term to object:\n"
    "{\n"
    '  "term": {"enGloss": "...", "viGloss": "..."}\n'
    "}\n"
    f"Terms: {json.dumps(test_terms)}"
)
payload = {
    "model": "qwen3:14b",
    "messages": [{"role": "user", "content": prompt}],
    "think": False,
    "format": "json",
    "stream": False,
    "options": {"temperature": 0.1, "num_predict": 2048}
}
req = urllib.request.Request(
    "http://127.0.0.1:11434/api/chat",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req, timeout=60) as resp:
    data = json.loads(resp.read().decode("utf-8"))
    content = data.get("message", {}).get("content", "")
    if "<think>" in content and "</think>" in content:
        content = content.split("</think>")[-1].strip()
    print(content)
