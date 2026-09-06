#!/usr/bin/env python3
"""
Batch vocabulary gloss generator using local Ollama qwen3:14b.
"""
import json
import os
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3:14b"
OUTPUT_FILE = "scripts/write_essay_support/academic_vocab_glossary.json"

with open("distinct_vocab_terms.json", "r", encoding="utf-8") as f:
    terms = json.load(f)

existing = {}
if os.path.exists(OUTPUT_FILE):
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            existing = json.load(f)
    except Exception:
        existing = {}

missing_terms = [t for t in terms if t not in existing]
print(f"Total terms: {len(terms)}, already translated: {len(existing)}, missing: {len(missing_terms)}")

BATCH_SIZE = 50

def translate_batch(batch):
    prompt = (
        "You are an expert bilingual academic translator for IELTS/PTE essay writing.\n"
        "Translate the following list of English essay terms into precise, natural academic Vietnamese glosses (viGloss),\n"
        "and supply a concise English definition (enGloss, max 10 words).\n"
        "Return STRICT JSON with format:\n"
        "{\n"
        '  "term_name": {"enGloss": "concise English meaning", "viGloss": "nghĩa tiếng Việt tự nhiên, chính xác"},\n'
        "  ...\n"
        "}\n\n"
        f"Terms: {json.dumps(batch)}"
    )
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "format": "json",
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": 4096,
            "num_ctx": 4096
        }
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        content = res.get("message", {}).get("content", "{}")
        # Clean think tags
        if "<think>" in content and "</think>" in content:
            content = content.split("</think>")[-1].strip()
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1:
            content = content[start:end+1]
        return json.loads(content)

for i in range(0, len(missing_terms), BATCH_SIZE):
    batch = missing_terms[i:i+BATCH_SIZE]
    print(f"Translating batch {i//BATCH_SIZE + 1} / {(len(missing_terms) + BATCH_SIZE - 1)//BATCH_SIZE} ({len(batch)} terms)...")
    t0 = time.time()
    try:
        res = translate_batch(batch)
        for k, v in res.items():
            k_clean = k.strip().lower()
            if isinstance(v, dict) and "viGloss" in v:
                existing[k_clean] = {
                    "enGloss": v.get("enGloss", "Key academic term in essay prompt."),
                    "viGloss": v.get("viGloss", "Từ vựng học thuật quan trọng trong đề.")
                }
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
        print(f"Batch done in {time.time()-t0:.2f}s! Total saved: {len(existing)}")
    except Exception as e:
        print(f"Error on batch {i}: {e}")
        time.sleep(2)

print(f"FINISHED! Total terms in glossary: {len(existing)}")
