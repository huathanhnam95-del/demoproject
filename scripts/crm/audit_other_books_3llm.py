# scripts/crm/audit_other_books_3llm.py
"""
3-Model Local LLM Full Quality & Layout Audit for Harmer (5th Edition) & Teaching Pronunciation
Queries DeepSeek-R1:14b, Qwen3:14b, and Gemma4:12b via Ollama.
Applies 2/3 consensus majority voting.
"""

import os
import re
import sys
import json
import time
import requests
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OLLAMA_URL = "http://localhost:11434/api/generate"

MODELS = {
    "qwen": os.getenv("LOCAL_QWEN_MODEL", "qwen3:14b"),
    "deepseek": os.getenv("LOCAL_DEEPSEEK_MODEL", "deepseek-r1:14b"),
    "gemma": os.getenv("LOCAL_GEMMA_MODEL", "gemma4:12b"),
}

TARGET_PAGES = [
    # Book 1: Harmer (5th Edition)
    {
        "book": "harmer",
        "book_title": "The Practice of English Language Teaching (5th Edition)",
        "file": "tmp/harmer_pages.json",
        "page_num": 4,
        "label": "Detailed Table of Contents (section numbers & commas)",
    },
    {
        "book": "harmer",
        "book_title": "The Practice of English Language Teaching (5th Edition)",
        "file": "tmp/harmer_pages.json",
        "page_num": 9,
        "label": "Video & DVD Contents Table (duration timestamps)",
    },
    {
        "book": "harmer",
        "book_title": "The Practice of English Language Teaching (5th Edition)",
        "file": "tmp/harmer_pages.json",
        "page_num": 24,
        "label": "InDesign Layered Heading Drop Shadows",
    },
    {
        "book": "harmer",
        "book_title": "The Practice of English Language Teaching (5th Edition)",
        "file": "tmp/harmer_pages.json",
        "page_num": 47,
        "label": "Conversational Dialogue Transcription (Speakers A & B)",
    },
    {
        "book": "harmer",
        "book_title": "The Practice of English Language Teaching (5th Edition)",
        "file": "tmp/harmer_pages.json",
        "page_num": 49,
        "label": "Chapter 2 End Notes & Further Reading Repeats",
    },
    {
        "book": "harmer",
        "book_title": "The Practice of English Language Teaching (5th Edition)",
        "file": "tmp/harmer_pages.json",
        "page_num": 100,
        "label": "Pedagogical Methodology Body Prose",
    },

    # Book 2: Teaching Pronunciation with Confidence
    {
        "book": "pronunciation",
        "book_title": "Teaching Pronunciation with Confidence",
        "file": "tmp/pronunciation_rev001_pages.json",
        "page_num": 12,
        "label": "Consonant Contrast Pairs (/p/, /b/)",
    },
    {
        "book": "pronunciation",
        "book_title": "Teaching Pronunciation with Confidence",
        "file": "tmp/pronunciation_rev001_pages.json",
        "page_num": 21,
        "label": "IPA Phonetic Vowel Transcription",
    },
    {
        "book": "pronunciation",
        "book_title": "Teaching Pronunciation with Confidence",
        "file": "tmp/pronunciation_rev001_pages.json",
        "page_num": 26,
        "label": "Vowel Quadrant Chart (/i/, /ɪ/, /ʊ/, /ʌ/, /ə/)",
    },
    {
        "book": "pronunciation",
        "book_title": "Teaching Pronunciation with Confidence",
        "file": "tmp/pronunciation_rev001_pages.json",
        "page_num": 42,
        "label": "Spelling to Phoneme Mapping (<a> hate [eɪ] hat [æ])",
    },
    {
        "book": "pronunciation",
        "book_title": "Teaching Pronunciation with Confidence",
        "file": "tmp/pronunciation_rev001_pages.json",
        "page_num": 43,
        "label": "Allophone Variations (flap [ɾ], glottal stop [ʔ])",
    },
    {
        "book": "pronunciation",
        "book_title": "Teaching Pronunciation with Confidence",
        "file": "tmp/pronunciation_rev001_pages.json",
        "page_num": 51,
        "label": "Dialect Variations (father [ɛə] [ɑ] [ɒ])",
    },
]

PROMPT_TEMPLATE = """You are an expert linguistics textbook editor and OCR quality auditor.
Analyze the following extracted text from page {page_num} of "{book_title}" ({label}).

Raw Extracted Text:
\"\"\"
{page_text}
\"\"\"

Carefully evaluate the text and layout quality:
1. Is there scanner artifact noise (photocopy creases, stray margin smudges, garbage characters)?
2. Are IPA phonetic symbols (e.g. /i/, /ʊ/, [ə], [æ], [ɾ], [ʔ]) or video timestamps (e.g. 3:10, 15:30) or dialogue markers (e.g. 'A:', 'B:') present and legitimate? (These MUST BE PRESERVED).
3. Are there layered repeated headings from InDesign drop shadows?
4. How is the layout and readability?

Respond ONLY with a valid JSON object matching this exact schema:
{{
  "text_verdict": "PASS" | "WARN" | "FAIL",
  "layout_verdict": "PASS" | "WARN" | "FAIL",
  "scanner_noise_lines": ["exact noisy lines to remove if any"],
  "legitimate_elements_to_preserve": ["IPA symbols, timestamps, dialogue lines that must be preserved"],
  "layered_repeated_phrases": ["phrases that repeat consecutively due to drop shadow"],
  "layout_notes": "brief evaluation notes"
}}
"""

def clean_response(raw: str) -> str:
    if not raw:
        return ""
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if "<think>" in cleaned:
        cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL).strip()
    cleaned = re.sub(r"</?(no_)?think>", "", cleaned).strip()
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(1).strip()
    brace_start = cleaned.find("{")
    brace_end = cleaned.rfind("}")
    if brace_start != -1 and brace_end != -1 and brace_end > brace_start:
        cleaned = cleaned[brace_start:brace_end+1]
    return cleaned

def query_model(model_name: str, prompt: str, timeout: int = 120) -> dict:
    payload = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "keep_alive": "0s",  # Unload from VRAM after query to avoid OOM
        "options": {
            "temperature": 0.1,
            "num_predict": 384,
            "num_ctx": 2048,
        }
    }
    if "qwen" in model_name:
        payload["options"]["think"] = False

    t0 = time.time()
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
        duration_ms = int((time.time() - t0) * 1000)
        if resp.status_code == 200:
            raw_text = resp.json().get("response", "")
            cleaned = clean_response(raw_text)
            try:
                data = json.loads(cleaned)
                return {"status": "SUCCESS", "data": data, "duration_ms": duration_ms, "raw": raw_text}
            except json.JSONDecodeError as err:
                return {"status": "JSON_PARSE_ERROR", "error": str(err), "duration_ms": duration_ms, "raw": raw_text}
        else:
            return {"status": f"HTTP_{resp.status_code}", "error": resp.text, "duration_ms": duration_ms}
    except Exception as e:
        duration_ms = int((time.time() - t0) * 1000)
        return {"status": "REQUEST_EXCEPTION", "error": str(e), "duration_ms": duration_ms}

def get_majority_verdict(verdicts: list) -> str:
    counts = {}
    for v in verdicts:
        v = (v or "").upper()
        counts[v] = counts.get(v, 0) + 1
    for status in ["FAIL", "WARN", "PASS"]:
        if counts.get(status, 0) >= 2:
            return status
    return "WARN" if "WARN" in counts or "FAIL" in counts else "PASS"

def main():
    print("=" * 70)
    print("3-MODEL LOCAL LLM CONSENSUS QUALITY AUDIT")
    print("Books: Harmer (5th Edition) & Teaching Pronunciation with Confidence")
    print(f"Models: Qwen ({MODELS['qwen']}), DeepSeek ({MODELS['deepseek']}), Gemma ({MODELS['gemma']})")
    print("=" * 70)

    # Load book pages
    books_data = {}
    for item in TARGET_PAGES:
        fpath = item["file"]
        if fpath not in books_data:
            with open(fpath, "r", encoding="utf-8") as f:
                books_data[fpath] = json.load(f).get("pages", [])

    results = []
    report_file = "reports/other_books_3llm_audit_report.json"
    os.makedirs("reports", exist_ok=True)

    for idx, item in enumerate(TARGET_PAGES):
        book = item["book"]
        book_title = item["book_title"]
        page_num = item["page_num"]
        label = item["label"]
        pages = books_data[item["file"]]
        page_text = pages[page_num - 1] if page_num - 1 < len(pages) else ""

        print(f"\n[{idx+1}/{len(TARGET_PAGES)}] Auditing {book_title} - Page {page_num} ({label})...")
        sample_snippet = (page_text[:1200] + "\n[... truncated ...]\n" + page_text[-400:]) if len(page_text) > 1600 else page_text
        prompt = PROMPT_TEMPLATE.format(page_num=page_num, book_title=book_title, label=label, page_text=sample_snippet)

        page_record = {
            "book": book,
            "book_title": book_title,
            "page_num": page_num,
            "label": label,
            "text_length": len(page_text),
            "evaluations": {},
            "consensus": {}
        }

        for model_key in ["qwen", "deepseek", "gemma"]:
            model_name = MODELS[model_key]
            print(f"  -> Querying {model_key} ({model_name})...", end="", flush=True)
            res = query_model(model_name, prompt)
            print(f" [{res['status']}] ({res['duration_ms']}ms)")
            page_record["evaluations"][model_key] = res

        # Synthesize consensus
        text_verdicts = []
        layout_verdicts = []
        preserved_elements = set()
        layered_phrases = set()

        for model_key in ["qwen", "deepseek", "gemma"]:
            data = page_record["evaluations"][model_key].get("data", {})
            if data:
                if "text_verdict" in data:
                    text_verdicts.append(data["text_verdict"])
                if "layout_verdict" in data:
                    layout_verdicts.append(data["layout_verdict"])
                for item_el in data.get("legitimate_elements_to_preserve", []):
                    preserved_elements.add(str(item_el))
                for item_rep in data.get("layered_repeated_phrases", []):
                    layered_phrases.add(str(item_rep))

        consensus_text = get_majority_verdict(text_verdicts) if text_verdicts else "UNKNOWN"
        consensus_layout = get_majority_verdict(layout_verdicts) if layout_verdicts else "UNKNOWN"

        page_record["consensus"] = {
            "text_verdict": consensus_text,
            "layout_verdict": consensus_layout,
            "legitimate_elements_to_preserve": sorted(list(preserved_elements)),
            "layered_repeated_phrases": sorted(list(layered_phrases)),
            "agreement_ratio": f"{max(text_verdicts.count(consensus_text), 1)}/3 text, {max(layout_verdicts.count(consensus_layout), 1)}/3 layout"
        }

        print(f"  ==> Consensus Verdict: Text: {consensus_text} | Layout: {consensus_layout} ({page_record['consensus']['agreement_ratio']})")
        if preserved_elements:
            print(f"      Preserved elements identified: {list(preserved_elements)[:3]}")
        if layered_phrases:
            print(f"      Layered phrases identified: {list(layered_phrases)[:3]}")

        results.append(page_record)
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump({
                "audited_at": datetime.now(timezone.utc).isoformat(),
                "models": MODELS,
                "pages": results
            }, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 70)
    print("AUDIT COMPLETE! Report saved to:", report_file)
    print("=" * 70)

if __name__ == "__main__":
    main()
