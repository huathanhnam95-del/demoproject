# scripts/crm/audit_knowles_3llm.py
"""
3-Model Local LLM Full Quality & Layout Audit for Knowles (1973)
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

# 10 High-Signal Anchor Pages representing every structure & failure mode
TARGET_PAGES = [
    1,   # ERIC Microfiche Cover & Stamp numbers (ED 084 368)
    2,   # Document Resume & OCR metadata
    3,   # Front flap & 1970s curly font (izSpeiecs)
    5,   # Gutter crease scanner noise (6.1,,E1K...)
    10,  # Table of Contents & short page layout (%, .,)
    13,  # Preface & heading detection (= preface)
    16,  # Chapter 1 opener & introductory paragraphs
    17,  # Academic in-text citations ([Bruner, 1966], [Kidl, 1959])
    45,  # Mid-book theory models & diagrams
    195  # Appendix & bibliographic references
]

PROMPT_TEMPLATE = """You are an expert textbook editor and OCR quality auditor.
Analyze the following raw OCR extracted text from page {page_num} of Malcolm Knowles' 1973 book "(Knowles, 1973) The Adult Learner, A Neglected Species".

Raw Extracted Text:
\"\"\"
{page_text}
\"\"\"

Carefully evaluate the text and layout quality:
1. Is there scanner artifact noise (photocopy creases, stray punctuation like '=', '.,', margin smudges, garbage like '6.1,,E1K...')?
2. Are there severe OCR letter corruptions (e.g., 'izSpeiecs' instead of 'Species', 'th- Ty' instead of 'theory')?
3. Are academic citations (e.g. '[Skinner, 1968, p. 8]', '[Bruner, 1966]') legitimate citations that MUST BE PRESERVED?
4. How is the layout (headings, paragraph breaks, table of contents)?

Respond ONLY with a valid JSON object matching this exact schema:
{{
  "text_verdict": "PASS" | "WARN" | "FAIL",
  "layout_verdict": "PASS" | "WARN" | "FAIL",
  "scanner_noise_lines": ["exact noisy lines to remove"],
  "severe_ocr_corruptions": ["corrupted_word -> corrected_word"],
  "academic_citations_to_preserve": ["[Author, Year, p. X]"],
  "layout_notes": "brief notes on headings or paragraph flow"
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
        "keep_alive": "0s",
        "options": {
            "temperature": 0.1,
            "num_predict": 384,
            "num_ctx": 2048
        }
    }
    if "qwen" in model_name.lower():
        payload["think"] = False
        
    for attempt in range(1, 3):
        try:
            t0 = time.time()
            resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
            elapsed = round(time.time() - t0, 2)
            if resp.status_code == 200:
                raw_text = resp.json().get("response", "")
                cleaned = clean_response(raw_text)
                parsed = json.loads(cleaned)
                parsed["_elapsed_sec"] = elapsed
                return parsed
            else:
                time.sleep(2)
        except Exception as e:
            if attempt == 2:
                return {"error": str(e)}
            time.sleep(2)
    return {"error": "Failed after retries"}

def compute_consensus(votes: dict) -> dict:
    text_verdicts = []
    layout_verdicts = []
    all_noise = set()
    all_corruptions = set()
    all_citations = set()
    
    for model_key, res in votes.items():
        if "error" in res:
            continue
        tv = str(res.get("text_verdict", "WARN")).upper()
        lv = str(res.get("layout_verdict", "WARN")).upper()
        text_verdicts.append(tv)
        layout_verdicts.append(lv)
        
        for n in res.get("scanner_noise_lines", []):
            if n and isinstance(n, str):
                all_noise.add(n.strip())
        for c in res.get("severe_ocr_corruptions", []):
            if c and isinstance(c, str):
                all_corruptions.add(c.strip())
        for cit in res.get("academic_citations_to_preserve", []):
            if cit and isinstance(cit, str):
                all_citations.add(cit.strip())
                
    def majority(verdict_list):
        if not verdict_list:
            return "UNKNOWN"
        counts = {v: verdict_list.count(v) for v in set(verdict_list)}
        for v, cnt in counts.items():
            if cnt >= 2:
                return v
        return "WARN"
        
    return {
        "consensus_text_verdict": majority(text_verdicts),
        "consensus_layout_verdict": majority(layout_verdicts),
        "scanner_noise_lines": sorted(list(all_noise)),
        "severe_ocr_corruptions": sorted(list(all_corruptions)),
        "academic_citations_to_preserve": sorted(list(all_citations)),
        "individual_votes": {k: {"text": v.get("text_verdict"), "layout": v.get("layout_verdict")} for k, v in votes.items()}
    }

def main():
    print(f"=================================================================")
    print(f"3-Model Local LLM Consensus Quality Audit for Knowles (1973)")
    print(f"Active Models: {MODELS}")
    print(f"Auditing {len(TARGET_PAGES)} stratified target pages across the book...")
    print(f"=================================================================\n")
    
    with open("tmp/knowles_rev001_pages.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    pages = data.get("pages", [])
    
    audit_results = []
    
    for idx, page_num in enumerate(TARGET_PAGES):
        if page_num > len(pages):
            continue
        raw_text = pages[page_num - 1]
        print(f"\n[{idx+1}/{len(TARGET_PAGES)}] Auditing Page {page_num} ({len(raw_text)} chars)...")
        prompt = PROMPT_TEMPLATE.format(page_num=page_num, page_text=raw_text[:2500])
        
        page_votes = {}
        for m_key in ["qwen", "deepseek", "gemma"]:
            m_name = MODELS[m_key]
            print(f"  -> Querying {m_key} ({m_name})... ", end="", flush=True)
            res = query_model(m_name, prompt)
            if "error" in res:
                print(f"ERROR: {res['error']}")
            else:
                tv = res.get("text_verdict", "?")
                lv = res.get("layout_verdict", "?")
                print(f"Done ({res.get('_elapsed_sec')}s) [Text: {tv}, Layout: {lv}]")
            page_votes[m_key] = res
            
        consensus = compute_consensus(page_votes)
        print(f"  * CONSENSUS: Text={consensus['consensus_text_verdict']}, Layout={consensus['consensus_layout_verdict']}")
        if consensus['scanner_noise_lines']:
            print(f"    - Noise Identified: {consensus['scanner_noise_lines']}")
        if consensus['severe_ocr_corruptions']:
            print(f"    - OCR Corruptions: {consensus['severe_ocr_corruptions']}")
        if consensus['academic_citations_to_preserve']:
            print(f"    - Preserved Citations: {consensus['academic_citations_to_preserve']}")
            
        audit_results.append({
            "page_num": page_num,
            "char_count": len(raw_text),
            "consensus": consensus,
            "model_responses": page_votes
        })
        
        os.makedirs("reports", exist_ok=True)
        report_path = "reports/knowles_3llm_audit_report.json"
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "book": "(Knowles, 1973) The Adult Learner, A Neglected Species",
                "models": MODELS,
                "total_pages_audited": len(audit_results),
                "pages": audit_results
            }, f, indent=2)
            
    print(f"\n=================================================================")
    print(f"AUDIT COMPLETE: All {len(audit_results)} pages evaluated by all 3 local LLMs!")
    print(f"Full report saved to {report_path}")
    print(f"=================================================================\n")

if __name__ == "__main__":
    main()
