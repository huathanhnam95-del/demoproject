#!/usr/bin/env python3
"""
Batch collocation gloss generator using local Ollama qwen3:14b.
"""
import json
import os
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3:14b"
OUTPUT_FILE = "scripts/write_essay_support/academic_collocation_glossary.json"

with open("distinct_collocations.json", "r", encoding="utf-8") as f:
    colls = json.load(f)

existing = {}
if os.path.exists(OUTPUT_FILE):
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            existing = json.load(f)
    except Exception:
        existing = {}

missing_colls = [c for c in colls if c not in existing]
print(f"Total collocations: {len(colls)}, already translated: {len(existing)}, missing: {len(missing_colls)}")

BATCH_SIZE = 40

def translate_batch(batch):
    prompt = (
        "You are an expert bilingual academic translator for IELTS/PTE essay writing.\n"
        "For each English academic collocation below, provide:\n"
        "1. 'viGloss': a natural, accurate Vietnamese definition and usage context (max 15 words).\n"
        "2. 'enGloss': a concise English explanation of what the collocation means and how it functions (max 12 words).\n"
        "Return STRICT JSON with format:\n"
        "{\n"
        '  "collocation_term": {"enGloss": "concise English meaning", "viGloss": "nghĩa tiếng Việt tự nhiên, chuẩn xác"},\n'
        "  ...\n"
        "}\n\n"
        f"Collocations: {json.dumps(batch)}"
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
        if "<think>" in content and "</think>" in content:
            content = content.split("</think>")[-1].strip()
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1:
            content = content[start:end+1]
        return json.loads(content)

for i in range(0, len(missing_colls), BATCH_SIZE):
    batch = missing_colls[i:i+BATCH_SIZE]
    print(f"Translating batch {i//BATCH_SIZE + 1} / {(len(missing_colls) + BATCH_SIZE - 1)//BATCH_SIZE} ({len(batch)} collocations)...")
    t0 = time.time()
    try:
        res = translate_batch(batch)
        for k, v in res.items():
            k_clean = k.strip().lower()
            if isinstance(v, dict) and "viGloss" in v:
                existing[k_clean] = {
                    "enGloss": v.get("enGloss", "Natural academic collocation enhancing coherence."),
                    "viGloss": v.get("viGloss", "Cụm từ học thuật giúp liên kết câu mạch lạc.")
                }
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
        print(f"Batch done in {time.time()-t0:.2f}s! Total saved: {len(existing)}")
    except Exception as e:
        print(f"Error on batch {i}: {e}")
        time.sleep(2)

print(f"FINISHED! Total collocations in glossary: {len(existing)}")
