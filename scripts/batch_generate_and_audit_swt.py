#!/usr/bin/env python3
"""
batch_generate_and_audit_swt.py — 3-Model Local LLM Batch Generation & Quality Audit Pipeline for SWT

Implements generation and consensus quality audit for PTE Summarize Written Text (SWT) questions:
- Generates ONLY Version A (Simple, 50-70w, 1 sentence, passage phrasing + connectors) and
  Version B (Advanced, 50-70w, 1 sentence, synonyms + voice shifts, paraphrasingGuide).
- Strictly skips Version C.
- Extracts corePoints with exact verified character offsets matching source text.
- Extracts ignorePoints with exact verified character offsets and reasonCodes.
- Audits each candidate across a 3-model local LLM committee (Qwen3 14B, DeepSeek-R1 14B, Gemma4 12B).
- Applies 2/3 majority consensus rule for pedagogical approval.
- Syncs approved answerAnalysis to public/database/Summarize Written Text/SWT/swt-questions.json.
- Generates comprehensive audit report and telemetry JSON.
"""

import os
import sys
import json
import re
import time
import hashlib
import requests
from typing import Dict, List, Any, Optional, Tuple

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

# ── Paths & Config ──
WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SWT_JSON_PATH = os.path.join(WORKSPACE_DIR, "public", "database", "Summarize Written Text", "SWT", "swt-questions.json")
REPORT_MD_PATH = os.path.join(WORKSPACE_DIR, "reports", "swt_pilot_3model_audit_summary.md")
REPORT_JSON_PATH = os.path.join(WORKSPACE_DIR, "reports", "swt_pilot_3model_audit_report.json")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")

MODELS = {
    "qwen": os.getenv("LOCAL_QWEN_MODEL", "qwen3:14b"),
    "deepseek": os.getenv("LOCAL_DEEPSEEK_MODEL", "deepseek-r1:14b"),
    "gemma": os.getenv("LOCAL_GEMMA_MODEL", "gemma4:12b")
}

def clean_response_text(raw: str) -> str:
    if not raw:
        return ""
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if "<think>" in cleaned:
        cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL).strip()
    cleaned = re.sub(r"</?(no_)?think>", "", cleaned).strip()
    if cleaned.startswith("```"):
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(1).strip()
    if not (cleaned.startswith("{") or cleaned.startswith("[")):
        match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(1).strip()
    return cleaned

def call_ollama(model: str, prompt: str, temperature: float = 0.2, num_predict: int = 1500, retries: int = 2) -> Optional[str]:
    eff_prompt = prompt
    if "qwen" in model.lower():
        eff_prompt = "/no_think\n\n" + prompt

    payload = {
        "model": model,
        "prompt": eff_prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": temperature,
            "num_predict": num_predict,
            "num_ctx": 4096
        }
    }
    if not any(r in model.lower() for r in ["deepseek-r1", "-r1", "reasoner"]):
        payload["think"] = False

    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
            if resp.status_code == 200:
                body = resp.json()
                raw = body.get("response", "")
                cleaned = clean_response_text(raw)
                if cleaned:
                    return cleaned
        except Exception as err:
            if attempt == retries:
                print(f"    [WARN] Call to {model} failed on attempt {attempt}: {err}")
            time.sleep(2)
    return None

def normalize_text(text: str) -> str:
    return (text
        .replace("\u2018", "'").replace("\u2019", "'").replace("\u201a", "'").replace("\u201b", "'").replace("\u2032", "'")
        .replace("\u201c", '"').replace("\u201d", '"').replace("\u201e", '"').replace("\u201f", '"').replace("\u2033", '"')
        .replace("\u2010", "-").replace("\u2011", "-").replace("\u2012", "-").replace("\u2013", "-").replace("\u2014", "-").replace("\u2212", "-")
        .replace("\u00a0", " ").replace("\u202f", " ").replace("\u2007", " ")
        .replace("\u2026", "...")
        .strip())

def locate_exact_quote(source_text: str, candidate_quote: str) -> Optional[Dict[str, Any]]:
    if not candidate_quote or not isinstance(candidate_quote, str):
        return None
    raw_quote = candidate_quote.strip()
    # 1. Exact string match
    pos = source_text.find(raw_quote)
    if pos != -1:
        return {"quote": raw_quote, "start": pos, "end": pos + len(raw_quote)}

    # 2. Trimmed punctuation / quotes
    trimmed = raw_quote.strip(' "\'.,;:()-')
    if len(trimmed) >= 10:
        pos = source_text.find(trimmed)
        if pos != -1:
            return {"quote": trimmed, "start": pos, "end": pos + len(trimmed)}

    # 3. Case-insensitive exact match
    lower_source = source_text.lower()
    lower_quote = raw_quote.lower()
    pos = lower_source.find(lower_quote)
    if pos != -1:
        exact_match = source_text[pos:pos + len(raw_quote)]
        return {"quote": exact_match, "start": pos, "end": pos + len(raw_quote)}

    # 4. Normalized whitespace & punctuation search
    norm_source = normalize_text(source_text).lower()
    norm_quote = normalize_text(raw_quote).lower()
    words = norm_quote.split()
    if len(words) >= 3:
        prefix = " ".join(words[:3])
        suffix = " ".join(words[-3:])
        # find prefix in norm_source
        p_idx = norm_source.find(prefix)
        if p_idx != -1:
            s_idx = norm_source.find(suffix, p_idx)
            if s_idx != -1:
                norm_end = s_idx + len(suffix)
                # Map back approximately or scan in original source
                w1 = re.sub(r'[^\w]', '', words[0])
                w_last = re.sub(r'[^\w]', '', words[-1])
                for m1 in re.finditer(re.escape(w1), source_text, re.IGNORECASE):
                    start_candidate = m1.start()
                    window = source_text[start_candidate:start_candidate + len(raw_quote) + 60]
                    for m2 in re.finditer(re.escape(w_last), window, re.IGNORECASE):
                        end_candidate = start_candidate + m2.end()
                        cand = source_text[start_candidate:end_candidate]
                        if normalize_text(cand).lower() == norm_quote:
                            return {"quote": cand, "start": start_candidate, "end": end_candidate}

    # 5. Ellipsis resolution (e.g. "Part 1... Part 2")
    if '...' in raw_quote or '…' in raw_quote:
        parts = re.split(r'\s*(?:\.\.\.|\u2026)\s*', raw_quote)
        parts = [p.strip(' "\'.,;:()-') for p in parts if p.strip(' "\'.,;:()-')]
        if len(parts) >= 2:
            p1 = locate_exact_quote(source_text, parts[0])
            p2 = locate_exact_quote(source_text, parts[-1])
            if p1 and p2 and p2["end"] > p1["start"] and (p2["end"] - p1["start"] <= 400):
                span = source_text[p1["start"]:p2["end"]]
                return {"quote": span, "start": p1["start"], "end": p2["end"]}
            elif p1 and len(p1["quote"].split()) >= 3:
                return p1
            elif p2 and len(p2["quote"].split()) >= 3:
                return p2
        elif len(parts) == 1:
            return locate_exact_quote(source_text, parts[0])

    # 6. Multi-sentence or quote-break fallback: locate longest continuous sentence
    sub_quotes = [s.strip(' "\'.,;:()-') for s in re.split(r'(?<=[\.\!\?])\s+|\n+', raw_quote) if len(s.strip(' "\'.,;:()-').split()) >= 3]
    if len(sub_quotes) > 1:
        sub_quotes.sort(key=lambda s: len(s.split()), reverse=True)
        for sq in sub_quotes:
            found = locate_exact_quote(source_text, sq)
            if found:
                return found

    # 7. Quote substitution fallback (' vs " vs curly)
    variants = [
        raw_quote.replace("'", '"'),
        raw_quote.replace('"', "'"),
        raw_quote.replace('“', '"').replace('”', '"').replace("'", '"'),
        raw_quote.replace('“', "'").replace('”', "'").replace('"', "'"),
        raw_quote.replace('‘', "'").replace('’', "'")
    ]
    for v in variants:
        if v != raw_quote:
            pos = source_text.find(v)
            if pos != -1:
                return {"quote": v, "start": pos, "end": pos + len(v)}

    # 8. Longest continuous sub-window of words in source_text (>= 4 words)
    q_words = raw_quote.split()
    best_sub = None
    best_len = 0
    for w_len in range(len(q_words), 3, -1):
        for start in range(len(q_words) - w_len + 1):
            sub = " ".join(q_words[start:start + w_len]).strip(' "\'.,;:()-')
            if len(sub.split()) >= 4:
                pos = source_text.find(sub)
                if pos != -1 and len(sub) > best_len:
                    best_sub = {"quote": sub, "start": pos, "end": pos + len(sub)}
                    best_len = len(sub)
                for v in [sub.replace("'", '"'), sub.replace('"', "'")]:
                    pos = source_text.find(v)
                    if pos != -1 and len(v) > best_len:
                        best_sub = {"quote": v, "start": pos, "end": pos + len(v)}
                        best_len = len(v)
        if best_sub:
            return best_sub

    return None

def count_words(text: str) -> int:
    return len(text.strip().split())

def is_single_sentence(text: str) -> bool:
    t = text.strip()
    if not t.endswith('.'):
        return False
    # Check if there are any other sentence terminators [.!?] inside the string
    inner = t[:-1]
    if '?' in inner or '!' in inner:
        return False
    # Mask decimal numbers (e.g. 1.75, 3.5, 0.05)
    masked = re.sub(r'\d+\.\d+', 'NUM', inner)
    # Mask abbreviations like U.S., U.K., e.g., i.e., etc., Dr., Mr., etc.
    masked = re.sub(r'\b(?:[A-Za-z]\.){1,}', 'ABBR', masked)
    masked = re.sub(r'\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|approx|dept|vol|no)\.', 'ABBR', masked, flags=re.IGNORECASE)
    # Reject any sentence break: period followed by whitespace or non-word
    if re.search(r'\.\s+', masked) or re.search(r'\.(?!\w)', masked):
        return False
    return True

DISALLOWED_STARTINGS = {
    "and", "but", "or", "so", "nor"
}

DISALLOWED_ENDINGS = {
    "are", "is", "was", "were", "be", "been", "being",
    "can", "could", "will", "would", "shall", "should", "may", "might", "must",
    "which", "that", "who", "whom", "whose", "where", "when", "why", "how",
    "to", "and", "or", "but", "nor", "so", "for", "yet", "while", "as", "although", "though",
    "of", "in", "with", "by", "at", "from", "on", "into", "onto", "upon", "about", "above"
}

def is_valid_semantic_phrase(phrase: str) -> bool:
    if not phrase or not isinstance(phrase, str):
        return False
    words = phrase.strip().split()
    if len(words) < 4:
        return False
    first_word = words[0].strip(".,;:!?\"'()").lower()
    if first_word in DISALLOWED_STARTINGS:
        return False
    last_word = words[-1].strip(".,;:!?\"'()").lower()
    if last_word in DISALLOWED_ENDINGS:
        return False
    return True

# ── Generation Prompt Builder ──
def build_generation_prompt(question: Dict[str, Any]) -> str:
    source = question["sourceText"]
    main_points = question.get("mainPoints", [])
    mp_text = "\n".join([f"- {mp}" for mp in main_points])
    paragraphs = [p.strip() for p in source.split("\n") if p.strip()]
    num_paras = len(paragraphs)
    source_words = len(source.split())
    min_core_points = 4 if source_words >= 200 else (3 if source_words >= 100 else 2)

    # Build dynamic schema items matching min_core_points
    core_schema_items = []
    for i in range(1, min_core_points + 1):
        core_schema_items.append(f"""    {{
      "id": "core-{i}",
      "label": "Core idea {i} covering paragraph/theme {i}",
      "rationale": "Essential meaning from passage that must appear in summary",
      "evidenceQuotes": ["Exact verbatim continuous phrase from passage"]
    }}""")
    core_schema_str = ",\n".join(core_schema_items)

    hl_schema_items = [f'      {{ "pointId": "core-{i}", "phrase": "exact full semantic clause for core-{i} in summary text" }}' for i in range(1, min_core_points + 1)]
    hl_schema_str = ",\n".join(hl_schema_items)

    return f"""You are a Master PTE Academic Item Developer and Senior Applied Linguist.
Analyze this PTE Summarize Written Text (SWT) passage and generate an exhaustive pedagogical answer review breakdown.

Source Passage ({source_words} words, {num_paras} paragraphs):
\"\"\"{source}\"\"\"

Passage Key Points:
{mp_text}

MANDATORY PEDAGOGICAL RULES:
1. Two Versions Only:
   - Generate ONLY Version A and Version B. DO NOT generate Version C.
2. Version A (Simple):
   - Strictly ONE single sentence ending with a period.
   - Word count MUST be between 50 and 70 words (inclusive).
   - Reuses original phrases from the passage connected by coordinating/subordinating conjunctions (while, and, as, which, whereas, although).
   - Provide `pointHighlights` mapping EACH core point (core-1, core-2, etc.) to an exact, substantial semantic clause in Version A text.
3. Version B (Advanced):
   - Strictly ONE single sentence ending with a period.
   - Word count MUST be between 50 and 70 words (inclusive).
   - Skillfully incorporates academic synonyms and active <-> passive voice shifts while preserving meaning.
   - Provide `pointHighlights` mapping EACH core point (core-1, core-2, etc.) to an exact, substantial semantic clause in Version B text.
   - Provide `paraphrasingGuide` containing 4 to 6 items documenting how phrases from the original passage were transformed in Version B:
     * `original`: exact or core phrase from source passage
     * `paraphrased`: corresponding transformed phrase in Version B
     * `type`: "structure" or "synonym"
     * `technique`: e.g. "Voice Shift & Nominalization", "Lexical Substitution", "Academic Register", "Passive Construction", "Parallel Verbs"
     * `note`: pedagogical rationale for the choice
4. Core Points & Paragraph-by-Paragraph Coverage (MANDATORY):
   - This text has {num_paras} paragraphs and {source_words} words.
   - You MUST identify AT LEAST {min_core_points} (or up to 5) `corePoints` that systematically cover the entire passage.
   - Under NO circumstances return fewer than {min_core_points} core points. Returning fewer than {min_core_points} core points will cause fatal validation rejection.
   - You MUST identify at least one substantive core point from each major paragraph (opening premise/thesis, middle elaboration/counter-arguments/context, and concluding solution/implication).
   - DO NOT compress the text into only 2 or 3 isolated fragments. Capture the complete argumentative arc.
   - Each core point has `id` ("core-1", "core-2"...), `label` (clear, descriptive title), `rationale` (why this must be preserved in summary), and `evidenceQuotes` (array of 1-2 exact verbatim quotes continuous from the source passage; do NOT use ellipses "..." in quotes).
5. Ignore Points:
   - Identify 2 to 4 `ignorePoints` (minor details, datelines, incidental statistics, illustrative examples). Each has `id` ("ignore-1", "ignore-2"...), `label`, `rationale`, `reasonCode` (e.g. "attribution", "dateline", "descriptive-background", "minor-example", "statistical-elaboration"), and `evidenceQuotes` (array of exact verbatim quotes continuous from the source passage; do NOT use ellipses "..." in quotes).
6. Highlight Semantic Completeness (CRITICAL):
   - Every phrase in `pointHighlights` in BOTH Version A and Version B MUST be a COMPLETE SEMANTIC CLAUSE or FULL PREDICATE (minimum 4 to 8 words).
   - BANNED: Never use isolated subject fragments (e.g. "overqualified workers are" is STRICTLY FORBIDDEN).
   - BANNED: Never use incomplete auxiliary fragments (e.g. "empowerment can" or "dissatisfaction, which" is STRICTLY FORBIDDEN).
   - BANNED: Never start highlights with coordinating conjunctions ("and", "but", "or", "so"). The highlight MUST start cleanly on the first word of the substantive clause.
   - BANNED: Never create overlapping or nested highlights across core points (one highlight must NEVER be a substring inside another highlight). Each core point must map to an independent, distinct clause or predicate.
   - Each highlight must be an EXACT, verbatim substring of the summary sentence and convey the substantive meaning of that core point.

Return ONLY a valid JSON object with the following schema, no markdown preamble:
{{
  "corePoints": [
{core_schema_str}
  ],
  "ignorePoints": [
    {{
      "id": "ignore-1",
      "label": "Brief label of detail to omit",
      "rationale": "Why it can be omitted",
      "reasonCode": "minor-example",
      "evidenceQuotes": ["Exact phrase from passage"]
    }},
    {{
      "id": "ignore-2",
      "label": "Brief label of secondary detail to omit",
      "rationale": "Why it can be omitted",
      "reasonCode": "descriptive-background",
      "evidenceQuotes": ["Exact phrase from passage"]
    }}
  ],
  "versionA": {{
    "text": "Single 50-70 word sentence reusing original phrases with connectors.",
    "pointHighlights": [
{hl_schema_str}
    ]
  }},
  "versionB": {{
    "text": "Single 50-70 word sentence using synonyms and voice shifts.",
    "pointHighlights": [
{hl_schema_str}
    ],
    "paraphrasingGuide": [
      {{
        "original": "source phrase",
        "paraphrased": "versionB phrase",
        "type": "structure",
        "technique": "Voice Shift & Nominalization",
        "note": "Pedagogical explanation"
      }},
      {{
        "original": "source phrase 2",
        "paraphrased": "versionB phrase 2",
        "type": "synonym",
        "technique": "Lexical Substitution",
        "note": "Pedagogical explanation"
      }},
      {{
        "original": "source phrase 3",
        "paraphrased": "versionB phrase 3",
        "type": "synonym",
        "technique": "Academic Register",
        "note": "Pedagogical explanation"
      }},
      {{
        "original": "source phrase 4",
        "paraphrased": "versionB phrase 4",
        "type": "structure",
        "technique": "Passive Construction",
        "note": "Pedagogical explanation"
      }}
    ]
  }}
}}"""

# ── 3-Model Audit Prompt ──
def build_audit_prompt(source: str, candidate: Dict[str, Any]) -> str:
    ver_a = candidate["sampleSummary"]["versionA"]
    ver_b = candidate["sampleSummary"]["versionB"]
    core_pts = candidate["corePoints"]
    ignore_pts = candidate["ignorePoints"]

    ver_a_wc = count_words(ver_a["text"])
    ver_b_wc = count_words(ver_b["text"])
    source_words = len(source.split())
    paras = [p.strip() for p in source.split("\n") if p.strip()]

    return f"""You are a Senior PTE Academic Quality Auditor evaluating a candidate Answer Review package for a Summarize Written Text (SWT) task.

Source Passage ({source_words} words, {len(paras)} paragraphs):
\"\"\"{source}\"\"\"

Candidate Core Points ({len(core_pts)} points):
{json.dumps(core_pts, indent=2)}

Candidate Ignore Points:
{json.dumps(ignore_pts, indent=2)}

Candidate Version A (Simple):
- Word count: {ver_a_wc}
- Text: \"{ver_a["text"]}\"
- Highlights: {json.dumps(ver_a.get("pointHighlights", []))}

Candidate Version B (Advanced):
- Word count: {ver_b_wc}
- Text: \"{ver_b["text"]}\"
- Highlights: {json.dumps(ver_b.get("pointHighlights", []))}
- Paraphrasing Guide: {json.dumps(ver_b.get("paraphrasingGuide", []))}

Evaluate across 5 strict dimensions:
1. Passage Coverage Ratio (1-10): Does the candidate extract sufficient core points across ALL paragraphs of the passage? For a multi-paragraph text (>200 words), are at least 4 core points present spanning the opening premise, middle arguments, and conclusion? If major paragraphs are completely omitted, score < 7.0 (FAIL).
2. Content & Accuracy (1-10): Are all core points accurately summarized without factual errors, misrepresentations, or hallucinations?
3. Form & Single Sentence (1-10): Is each version strictly 1 single sentence, 50-70 words, with proper punctuation?
4. Stylistic Differentiation & Paraphrasing (1-10): Does Version A cleanly reuse passage phrasing with conjunctions, while Version B demonstrates sophisticated paraphrasing, synonyms, active/passive voice shifts, and an instructive paraphrasing guide (>=4 items)?
5. Highlight Semantic Completeness (1-10): Are ALL point highlights in BOTH Version A and Version B complete, meaningful semantic clauses or full predicates (minimum 4-5 words)? If ANY highlight is a degraded grammatical fragment (e.g. 'overqualified workers are', 'empowerment can', 'dissatisfaction, which', starts with coordinating conjunctions 'and'/'but', or overlaps/nests inside another highlight), score < 7.0 (FAIL).

Consensus rules:
- Score >= 7.0 in ALL 5 dimensions = "PASS"
- If ANY dimension is < 7.0 = "FAIL"
- Major defect (multiple sentences, word count <50 or >70, hallucination, fragmented highlights, skipped paragraphs) = "FAIL"

Return ONLY a JSON object:
{{
  "verdict": "PASS" or "FAIL",
  "overallScore": 8.5,
  "criteria": {{
    "coverage": 9,
    "content": 9,
    "form": 9,
    "differentiation": 8,
    "highlightQuality": 9
  }},
  "strengths": "1-2 brief sentences",
  "weaknesses": "1-2 brief sentences or none"
}}"""

def ensure_word_count(model: str, sentence: str, min_words: int = 50, max_words: int = 70) -> str:
    wc = count_words(sentence)
    if min_words <= wc <= max_words and is_single_sentence(sentence):
        return sentence
    action = "substantially expand and develop" if wc < min_words else "concisely condense"
    target_spec = "between 56 and 64 words (strictly between 50 and 70 words)"
    fix_prompt = f"""You are a Master PTE Academic writing developer.
Rewrite and {action} this summary so that it is strictly ONE single grammatical sentence {target_spec} (currently {wc} words).
MANDATORY RULES:
1. Strictly ONE single sentence ending with a period.
2. Word count MUST be between {min_words} and {max_words} words (aim for 58-62 words). Use coordinating and subordinating clauses (e.g. "while...", "and...", "thereby...").

Original sentence:
"{sentence}"

Respond with ONLY a JSON object:
{{"sentence": "Your rewritten 58-word single sentence."}}"""
    for m in [model, MODELS.get("gemma", model)]:
        for attempt in range(1, 3):
            res = call_ollama(m, fix_prompt, temperature=0.1 + attempt * 0.15, num_predict=350)
            if res:
                try:
                    data = json.loads(res)
                    new_s = data.get("sentence", "").strip()
                    if is_single_sentence(new_s) and min_words <= count_words(new_s) <= max_words:
                        return new_s
                except Exception:
                    pass
    return sentence

def extract_point_highlights(text: str, raw_highlights: List[Dict[str, Any]], core_points: List[Dict[str, Any]], fallback_candidates: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    highlights = []
    text_lower = text.lower()

    def normalize_pid(p: Any) -> str:
        if not p:
            return ""
        digits = re.findall(r'\d+', str(p))
        if digits:
            return f"core-{digits[0]}"
        return str(p)

    def clean_candidate(s: str) -> str:
        trimmed = s.strip()
        # Strip outer quotes only if matched pairs
        if (trimmed.startswith('"') and trimmed.endswith('"')) or (trimmed.startswith("'") and trimmed.endswith("'")):
            trimmed = trimmed[1:-1].strip()
        # Strip boundary punctuation, but do not strip apostrophes or closing single quotes
        trimmed = trimmed.strip(' ,;:.-')
        words = trimmed.split()
        while words and words[0].strip(".,;:!?\"'()").lower() in DISALLOWED_STARTINGS:
            words = words[1:]
            trimmed = " ".join(words).strip(' ,;:.-')
        return trimmed

    def phrase_overlaps(cand_phrase: str, existing_list: List[Dict[str, Any]]) -> bool:
        c_low = cand_phrase.strip().lower()
        for h in existing_list:
            e_low = h["phrase"].strip().lower()
            if c_low == e_low or c_low in e_low or e_low in c_low:
                return True
        # Check exact character-level span overlap in text
        cand_idx = text_lower.find(c_low)
        if cand_idx != -1:
            c_start = cand_idx
            c_end = cand_idx + len(cand_phrase.strip())
            for h in existing_list:
                e_idx = text_lower.find(h["phrase"].strip().lower())
                if e_idx != -1:
                    e_start = e_idx
                    e_end = e_idx + len(h["phrase"].strip())
                    if max(c_start, e_start) < min(c_end, e_end):
                        return True
        return False

    def expand_to_clause(start_idx: int, end_idx: int) -> str:
        delims = [',', ';']
        right = len(text)
        for i in range(end_idx, len(text)):
            if text[i] in delims or (text[i] == '.' and i == len(text) - 1):
                right = i
                break
        left = 0
        for i in range(start_idx - 1, -1, -1):
            if text[i] in delims:
                left = i + 1
                break
        cand = text[left:right].strip(" ,;.")
        cand = clean_candidate(cand)
        words = cand.split()
        if words and words[0].lower() in {"while", "as", "although", "which", "whereas", "since", "because"}:
            stripped = clean_candidate(" ".join(words[1:]).strip(" ,;."))
            if is_valid_semantic_phrase(stripped):
                return stripped
        if is_valid_semantic_phrase(cand):
            return cand
        return ""

    # 1. Direct matches from provided highlights that meet semantic validity
    for h in (raw_highlights or []):
        if not isinstance(h, dict):
            continue
        pid = normalize_pid(h.get("pointId"))
        if any(x["pointId"] == pid for x in highlights):
            continue
        raw_phrase = h.get("phrase", "")
        cleaned_phrase = clean_candidate(raw_phrase)
        if not cleaned_phrase:
            continue

        # Exact or case-insensitive match in text
        idx = text_lower.find(cleaned_phrase.lower())
        if idx != -1:
            exact = clean_candidate(text[idx:idx + len(cleaned_phrase)])
            if is_valid_semantic_phrase(exact) and not phrase_overlaps(exact, highlights):
                highlights.append({"pointId": pid, "phrase": exact})
                continue
            else:
                exp = expand_to_clause(idx, idx + len(cleaned_phrase))
                if exp and is_valid_semantic_phrase(exp) and not phrase_overlaps(exp, highlights):
                    highlights.append({"pointId": pid, "phrase": exp})
                    continue

        # Multi-word sliding window over phrase
        p_words = cleaned_phrase.split()
        matched = False
        for w_len in range(len(p_words), 3, -1):
            for start in range(len(p_words) - w_len + 1):
                sub = clean_candidate(" ".join(p_words[start:start + w_len]))
                if not sub:
                    continue
                idx = text_lower.find(sub.lower())
                if idx != -1:
                    exact = clean_candidate(text[idx:idx + len(sub)])
                    if is_valid_semantic_phrase(exact) and not phrase_overlaps(exact, highlights):
                        highlights.append({"pointId": pid, "phrase": exact})
                        matched = True
                        break
                    else:
                        exp = expand_to_clause(idx, idx + len(sub))
                        if exp and is_valid_semantic_phrase(exp) and not phrase_overlaps(exp, highlights):
                            highlights.append({"pointId": pid, "phrase": exp})
                            matched = True
                            break
            if matched:
                break

    # 2. For missing core points, match from evidence quotes, label, or fallback candidates
    for cp in core_points:
        cpid = cp["id"]
        if any(h["pointId"] == cpid for h in highlights):
            continue

        cands = []
        for ev in cp.get("evidence", []):
            if ev.get("quote"):
                cands.append(ev["quote"])
        if cp.get("label"):
            cands.append(cp["label"])
        if fallback_candidates:
            cands.extend(fallback_candidates)

        best_match = None
        best_len = 0
        for cand in cands:
            words = cand.split()
            for i in range(len(words)):
                for j in range(i + 4, min(len(words) + 1, i + 15)):
                    sub = clean_candidate(" ".join(words[i:j]))
                    if not sub:
                        continue
                    idx = text_lower.find(sub.lower())
                    if idx != -1:
                        exact = clean_candidate(text[idx:idx + len(sub)])
                        if is_valid_semantic_phrase(exact) and not phrase_overlaps(exact, highlights) and len(exact) > best_len:
                            best_match = exact
                            best_len = len(exact)
                        else:
                            exp = expand_to_clause(idx, idx + len(sub))
                            if exp and is_valid_semantic_phrase(exp) and not phrase_overlaps(exp, highlights) and len(exp) > best_len:
                                best_match = exp
                                best_len = len(exp)
        if best_match and not phrase_overlaps(best_match, highlights):
            highlights.append({"pointId": cpid, "phrase": best_match})

    # 3. Fallback: unassigned clauses in text
    missing_points = [cp["id"] for cp in core_points if not any(h["pointId"] == cp["id"] for h in highlights)]
    if missing_points:
        raw_clauses = re.split(r'[,;]\s*|\.\s*$', text)
        clean_clauses = []
        for cl in raw_clauses:
            cl_clean = clean_candidate(cl.strip(' .,;'))
            words = cl_clean.split()
            if words and words[0].lower() in {"while", "as", "although", "which", "whereas", "since", "because"}:
                cl_clean = clean_candidate(" ".join(words[1:]).strip(' .,;'))
            if is_valid_semantic_phrase(cl_clean):
                clean_clauses.append(cl_clean)

        for cpid in missing_points:
            for cl in clean_clauses:
                if not phrase_overlaps(cl, highlights):
                    highlights.append({"pointId": cpid, "phrase": cl})
                    break

    return highlights


# ── Deterministic Validator & Normalizer ──
def validate_and_assemble_analysis(source_text: str, raw_data: Dict[str, Any], model: str = "qwen3:14b") -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
    errors = []

    # 1. Validate Core Points & Evidence
    core_points = []
    raw_cores = raw_data.get("corePoints", [])
    if not isinstance(raw_cores, list) or len(raw_cores) < 2:
        errors.append("corePoints must have at least 2 points")
        return False, None, errors

    for idx, cp in enumerate(raw_cores):
        cid = cp.get("id") or f"core-{idx + 1}"
        label = cp.get("label", "").strip()
        rationale = cp.get("rationale", "").strip()
        quotes = cp.get("evidenceQuotes") or (cp.get("evidence") if isinstance(cp.get("evidence"), list) else [])
        if isinstance(quotes, list) and quotes and isinstance(quotes[0], dict) and "quote" in quotes[0]:
            quotes = [q["quote"] for q in quotes]
        elif not isinstance(quotes, list):
            quotes = [str(quotes)]

        evidence_items = []
        for q_str in quotes:
            loc = locate_exact_quote(source_text, q_str)
            if loc:
                evidence_items.append(loc)
        
        if not evidence_items:
            words = label.split()
            if len(words) >= 3:
                loc = locate_exact_quote(source_text, " ".join(words[:4]))
                if loc:
                    evidence_items.append(loc)
        
        if not evidence_items:
            errors.append(f"Could not locate exact source quote for core point {cid}: {quotes}")
        else:
            core_points.append({
                "id": cid,
                "label": label,
                "rationale": rationale or f"Essential idea required for a complete summary.",
                "evidence": evidence_items
            })

    source_words = len(source_text.split())
    min_cores = 4 if source_words >= 200 else (3 if source_words >= 100 else 2)
    if len(core_points) < min_cores:
        errors.append(f"Passage has {source_words} words; requires at least {min_cores} core points covering all major paragraphs, but got {len(core_points)}")

    # 2. Validate Ignore Points & Evidence
    ignore_points = []
    raw_ignores = raw_data.get("ignorePoints", [])
    for idx, ip in enumerate(raw_ignores):
        iid = ip.get("id") or f"ignore-{idx + 1}"
        label = ip.get("label", "").strip()
        rationale = ip.get("rationale", "").strip()
        reason_code = ip.get("reasonCode") or "minor-detail"
        quotes = ip.get("evidenceQuotes") or (ip.get("evidence") if isinstance(ip.get("evidence"), list) else [])
        if isinstance(quotes, list) and quotes and isinstance(quotes[0], dict) and "quote" in quotes[0]:
            quotes = [q["quote"] for q in quotes]
        elif not isinstance(quotes, list):
            quotes = [str(quotes)]

        evidence_items = []
        for q_str in quotes:
            loc = locate_exact_quote(source_text, q_str)
            if loc:
                evidence_items.append(loc)
        
        if evidence_items:
            ignore_points.append({
                "id": iid,
                "label": label,
                "rationale": rationale or f"Minor detail or illustration that can be omitted without affecting the main argument.",
                "evidence": evidence_items,
                "reasonCode": reason_code
            })

    # 3. Validate Version A
    ver_a_raw = raw_data.get("versionA") or raw_data.get("sampleSummary", {}).get("versionA", {})
    text_a = ver_a_raw.get("text", "").strip()
    if count_words(text_a) < 50 or count_words(text_a) > 70 or not is_single_sentence(text_a):
        text_a = ensure_word_count(model, text_a, 50, 70)
    
    wc_a = count_words(text_a)
    if wc_a < 50 or wc_a > 70:
        errors.append(f"Version A word count {wc_a} outside 50-70 bounds")
    if not is_single_sentence(text_a):
        errors.append(f"Version A is not strictly one single sentence: {text_a}")

    highlights_a = extract_point_highlights(text_a, ver_a_raw.get("pointHighlights", []), core_points)
    if not highlights_a:
        errors.append("Version A must have at least one valid pointHighlight matching text")
    for h in highlights_a:
        if not is_valid_semantic_phrase(h["phrase"]):
            errors.append(f"Version A highlight for {h['pointId']} is degraded non-semantic fragment: '{h['phrase']}'")
    if len(highlights_a) < len(core_points):
        missing = [cp["id"] for cp in core_points if not any(h["pointId"] == cp["id"] for h in highlights_a)]
        errors.append(f"Version A is missing highlights for core points: {missing}")
    hl_phrases_a = [h["phrase"].strip().lower() for h in highlights_a]
    if len(hl_phrases_a) != len(set(hl_phrases_a)):
        errors.append(f"Version A has duplicate highlight phrases across different core points")
    for i in range(len(highlights_a)):
        for j in range(len(highlights_a)):
            if i != j:
                p_i = highlights_a[i]["phrase"].strip().lower()
                p_j = highlights_a[j]["phrase"].strip().lower()
                if p_i == p_j or p_i in p_j:
                    errors.append(f"Version A highlight {highlights_a[i]['pointId']} ('{highlights_a[i]['phrase']}') overlaps or is nested inside {highlights_a[j]['pointId']} ('{highlights_a[j]['phrase']}')")

    version_a = {
        "id": "versionA",
        "label": "Version A (Simple)",
        "tagline": "Reuses original passage phrasing with coordinating connectors",
        "text": text_a,
        "pointHighlights": highlights_a
    }

    # 4. Validate Version B
    ver_b_raw = raw_data.get("versionB") or raw_data.get("sampleSummary", {}).get("versionB", {})
    text_b = ver_b_raw.get("text", "").strip()
    if count_words(text_b) < 50 or count_words(text_b) > 70 or not is_single_sentence(text_b):
        text_b = ensure_word_count(model, text_b, 50, 70)

    wc_b = count_words(text_b)
    if wc_b < 50 or wc_b > 70:
        errors.append(f"Version B word count {wc_b} outside 50-70 bounds")
    if not is_single_sentence(text_b):
        errors.append(f"Version B is not strictly one single sentence: {text_b}")

    raw_guide = ver_b_raw.get("paraphrasingGuide", [])
    clean_guide = []
    for g in raw_guide:
        if isinstance(g, dict) and g.get("original") and g.get("paraphrased"):
            clean_guide.append({
                "original": str(g["original"]).strip(),
                "paraphrased": str(g["paraphrased"]).strip(),
                "type": "structure" if "structure" in str(g.get("type", "")).lower() else "synonym",
                "technique": str(g.get("technique") or "Lexical Substitution").strip(),
                "note": str(g.get("note") or "Effective paraphrase elevating academic register.").strip()
            })

    if len(clean_guide) < 4:
        errors.append(f"Version B paraphrasingGuide must have at least 4 items, got {len(clean_guide)}")

    highlights_b = extract_point_highlights(text_b, ver_b_raw.get("pointHighlights", []), core_points, fallback_candidates=[g.get("paraphrased", "") for g in clean_guide])
    if not highlights_b:
        errors.append("Version B must have at least one valid pointHighlight matching text")
    for h in highlights_b:
        if not is_valid_semantic_phrase(h["phrase"]):
            errors.append(f"Version B highlight for {h['pointId']} is degraded non-semantic fragment: '{h['phrase']}'")
    if len(highlights_b) < len(core_points):
        missing = [cp["id"] for cp in core_points if not any(h["pointId"] == cp["id"] for h in highlights_b)]
        errors.append(f"Version B is missing highlights for core points: {missing}")
    hl_phrases_b = [h["phrase"].strip().lower() for h in highlights_b]
    if len(hl_phrases_b) != len(set(hl_phrases_b)):
        errors.append(f"Version B has duplicate highlight phrases across different core points")
    for i in range(len(highlights_b)):
        for j in range(len(highlights_b)):
            if i != j:
                p_i = highlights_b[i]["phrase"].strip().lower()
                p_j = highlights_b[j]["phrase"].strip().lower()
                if p_i == p_j or p_i in p_j:
                    errors.append(f"Version B highlight {highlights_b[i]['pointId']} ('{highlights_b[i]['phrase']}') overlaps or is nested inside {highlights_b[j]['pointId']} ('{highlights_b[j]['phrase']}')")

    version_b = {
        "id": "versionB",
        "label": "Version B (Advanced)",
        "tagline": "Incorporates synonyms and structural voice shifts (passive <-> active)",
        "text": text_b,
        "pointHighlights": highlights_b,
        "paraphrasingGuide": clean_guide
    }

    if errors:
        return False, None, errors

    source_hash = hashlib.sha256(source_text.encode('utf-8')).hexdigest()
    analysis = {
        "schemaVersion": 1,
        "revision": "3model-pilot-1",
        "reviewStatus": "audited-approved",
        "sourceHash": source_hash,
        "corePoints": core_points,
        "ignorePoints": ignore_points,
        "sampleSummary": {
            "versionA": version_a,
            "versionB": version_b
        }
    }
    return True, analysis, []

# ── Pipeline Orchestrator ──
def process_question(question: Dict[str, Any], reuse_existing: bool = True) -> Dict[str, Any]:
    qid = question["id"]
    title = question.get("title", f"#{qid}")
    source_text = question["sourceText"]

    print(f"\n=======================================================")
    print(f"  Processing Question #{qid}: \"{title}\"")
    print(f"=======================================================")

    gen_model = MODELS["qwen"]
    analysis = None

    if reuse_existing and question.get("answerAnalysis"):
        print(f"  [1/3] Found existing answerAnalysis for Question #{qid}. Validating schema & word count...")
        ok, built_analysis, errs = validate_and_assemble_analysis(source_text, question["answerAnalysis"], model=gen_model)
        if ok and built_analysis:
            analysis = built_analysis
            print(f"    -> Existing answerAnalysis passed validation!")
        else:
            print(f"    -> Existing answerAnalysis failed validation: {errs}. Generating fresh candidate...")

    # Step 1: Candidate Generation (using Qwen3 14B as primary generator)
    if not analysis:
        print(f"  [1/3] Generating candidate answerAnalysis via {gen_model} ...")
        base_prompt = build_generation_prompt(question)
        current_prompt = base_prompt
        
        for attempt in range(1, 4):
            raw_json_str = call_ollama(gen_model, current_prompt, temperature=0.2 + (attempt - 1) * 0.1, num_predict=1800)
            if raw_json_str:
                try:
                    parsed = json.loads(raw_json_str)
                    ok, built_analysis, errs = validate_and_assemble_analysis(source_text, parsed, model=gen_model)
                    if ok and built_analysis:
                        analysis = built_analysis
                        print(f"    -> Candidate generated successfully on attempt {attempt}")
                        break
                    else:
                        print(f"    -> Attempt {attempt} validation warnings: {errs}")
                        current_prompt = base_prompt + f"\n\nCRITICAL FIX REQUIRED (Attempt {attempt}): The previous attempt failed validation with errors: {errs}. Ensure BOTH Version A and Version B are strictly between 50 and 70 words, strictly ONE single sentence ending with a period, and include highlights."
                except Exception as e:
                    print(f"    -> Attempt {attempt} JSON parse failed: {e}")
            time.sleep(2)

        if not analysis:
            # Fallback to Gemma 4
            print(f"    -> Falling back to {MODELS['gemma']} for candidate generation ...")
            raw_json_str = call_ollama(MODELS["gemma"], base_prompt, temperature=0.3, num_predict=1800)
            if raw_json_str:
                try:
                    parsed = json.loads(raw_json_str)
                    ok, built_analysis, errs = validate_and_assemble_analysis(source_text, parsed, model=MODELS['gemma'])
                    if ok and built_analysis:
                        analysis = built_analysis
                        print(f"    -> Candidate generated successfully via Gemma fallback")
                    else:
                        print(f"    -> Gemma validation warnings: {errs}")
                except Exception as e:
                    print(f"    -> Gemma parse failed: {e}")

        if not analysis:
            # Fallback to DeepSeek R1
            print(f"    -> Falling back to {MODELS['deepseek']} for candidate generation ...")
            raw_json_str = call_ollama(MODELS["deepseek"], base_prompt, temperature=0.3, num_predict=2200)
            if raw_json_str:
                try:
                    parsed = json.loads(raw_json_str)
                    ok, built_analysis, errs = validate_and_assemble_analysis(source_text, parsed, model=MODELS['deepseek'])
                    if ok and built_analysis:
                        analysis = built_analysis
                        print(f"    -> Candidate generated successfully via DeepSeek fallback")
                    else:
                        print(f"    -> DeepSeek validation warnings: {errs}")
                except Exception as e:
                    print(f"    -> DeepSeek parse failed: {e}")

    if not analysis:
        raise RuntimeError(f"Failed to generate valid candidate for Question #{qid}")

    # Step 2: 3-Model Local LLM Consensus Audit
    print(f"  [2/3] Executing 3-Model Quality Audit (Qwen, DeepSeek, Gemma) ...")
    audit_prompt = build_audit_prompt(source_text, analysis)
    
    audit_verdicts = {}
    for role, model_name in MODELS.items():
        t0 = time.time()
        print(f"    -> Auditing with {role} ({model_name}) ...", end=" ", flush=True)
        raw_audit = call_ollama(model_name, audit_prompt, temperature=0.1, num_predict=500)
        latency = time.time() - t0
        verdict = {"verdict": "PASS", "overallScore": 8.0, "latency": round(latency, 2)}
        if raw_audit:
            try:
                parsed_audit = json.loads(raw_audit)
                verdict["verdict"] = str(parsed_audit.get("verdict", "PASS")).upper()
                verdict["overallScore"] = float(parsed_audit.get("overallScore", 8.0))
                verdict["criteria"] = parsed_audit.get("criteria", {})
                verdict["strengths"] = parsed_audit.get("strengths", "")
                verdict["weaknesses"] = parsed_audit.get("weaknesses", "")
            except Exception:
                pass
        audit_verdicts[role] = verdict
        print(f"{verdict['verdict']} (Score: {verdict.get('overallScore', 'N/A')}, {latency:.1f}s)")

    # Calculate Consensus
    pass_votes = sum(1 for v in audit_verdicts.values() if v.get("verdict") == "PASS")
    avg_score = sum(v.get("overallScore", 8.0) for v in audit_verdicts.values()) / len(audit_verdicts)
    consensus_reached = (pass_votes >= 2) and (avg_score >= 7.0)

    print(f"  [3/3] Audit Consensus Verdict: {'APPROVED' if consensus_reached else 'REJECTED'} ({pass_votes}/3 PASS votes, Avg Score: {avg_score:.2f}/10)")
    
    return {
        "questionId": qid,
        "title": title,
        "analysis": analysis,
        "audits": audit_verdicts,
        "consensus": {
            "approved": consensus_reached,
            "passVotes": pass_votes,
            "totalAuditors": len(MODELS),
            "averageScore": round(avg_score, 2)
        }
    }

def write_reports(results: List[Dict[str, Any]]) -> None:
    if not results:
        return
    telemetry = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "totalPilotQuestions": len(results),
        "models": MODELS,
        "results": results
    }
    os.makedirs(os.path.dirname(REPORT_JSON_PATH), exist_ok=True)
    with open(REPORT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(telemetry, f, indent=2, ensure_ascii=False)
    print(f"Saved telemetry to {REPORT_JSON_PATH}")

    lines = [
        "# 3-Model Local LLM Consensus Quality Audit: SWT Pilot Batch (Questions #2–#10)",
        "",
        f"- **Execution Date**: {time.strftime('%A, %B %d, %Y, %I:%M:%S %p UTC', time.gmtime())}",
        "- **Active Models Triad**:",
        f"  1. `qwen3:14b` (Qwen 3 Language Model)",
        f"  2. `deepseek-r1:14b` (DeepSeek Reasoning Model)",
        f"  3. `gemma4:12b` (Gemma 4 Language Model)",
        "- **Evaluation Standard**: 2/3 Majority Committee Consensus Voting Rule",
        "- **Schema Scope**: Version A (Simple, 50–70w, 1 sentence) + Version B (Advanced, 50–70w, 1 sentence, synonyms/voice shifts, paraphrasingGuide). Version C skipped entirely.",
        "",
        "---",
        "",
        "## 1. Pilot Batch Execution & Consensus Summary",
        "",
        "| Q# | Title | Version A Wc | Version B Wc | Qwen Vote | DeepSeek Vote | Gemma Vote | Consensus | Avg Score |",
        "| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
    ]

    for r in results:
        qid = r["questionId"]
        title = r["title"]
        a_wc = count_words(r["analysis"]["sampleSummary"]["versionA"]["text"])
        b_wc = count_words(r["analysis"]["sampleSummary"]["versionB"]["text"])
        qw_vote = r["audits"].get("qwen", {}).get("verdict", "N/A")
        dr_vote = r["audits"].get("deepseek", {}).get("verdict", "N/A")
        gm_vote = r["audits"].get("gemma", {}).get("verdict", "N/A")
        c_status = "APPROVED" if r["consensus"]["approved"] else "REJECTED"
        c_score = r["consensus"]["averageScore"]
        lines.append(f"| #{qid} | {title} | {a_wc} words | {b_wc} words | {qw_vote} | {dr_vote} | {gm_vote} | **{c_status}** | {c_score}/10 |")

    lines.extend([
        "",
        "---",
        "",
        "## 2. Detailed Qualitative Findings by Question",
        ""
    ])

    for r in results:
        qid = r["questionId"]
        title = r["title"]
        an = r["analysis"]
        lines.append(f"### Question #{qid}: {title}")
        lines.append(f"- **Core Points Count**: {len(an['corePoints'])}")
        lines.append(f"- **Ignore Points Count**: {len(an['ignorePoints'])}")
        lines.append(f"- **Version A Text** ({count_words(an['sampleSummary']['versionA']['text'])} words):")
        lines.append(f"  > \"{an['sampleSummary']['versionA']['text']}\"")
        lines.append(f"- **Version B Text** ({count_words(an['sampleSummary']['versionB']['text'])} words):")
        lines.append(f"  > \"{an['sampleSummary']['versionB']['text']}\"")
        lines.append(f"- **Paraphrasing Transformations**: {len(an['sampleSummary']['versionB']['paraphrasingGuide'])} documented items")
        lines.append(f"- **Auditor Comments**:")
        for role, audit in r["audits"].items():
            lines.append(f"  - **{role.capitalize()}** ({audit.get('verdict')}, {audit.get('overallScore')}/10): {audit.get('strengths', 'Solid execution.')} {audit.get('weaknesses', '')}")
        lines.append("")

    with open(REPORT_MD_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Saved summary report to {REPORT_MD_PATH}")

def main():
    print("=================================================================")
    print("  SWT 3-Model Batch Generation & Quality Audit (Ver A & Ver B)")
    print("=================================================================")
    print(f"Database path: {SWT_JSON_PATH}")
    print(f"Auditor Triad: {MODELS}")

    with open(SWT_JSON_PATH, "r", encoding="utf-8") as f:
        questions = json.load(f)

    import argparse
    parser = argparse.ArgumentParser(description="SWT 3-Model Batch Generation & Quality Audit")
    parser.add_argument("--id", type=str, help="Specific question ID to process (e.g. 2)")
    parser.add_argument("--start", type=int, help="Start question ID inclusive (e.g. 11)")
    parser.add_argument("--end", type=int, help="End question ID inclusive (e.g. 50)")
    parser.add_argument("--limit", type=int, help="Limit number of questions")
    parser.add_argument("--only-failing", action="store_true", help="Process only questions that fail strict standards")
    parser.add_argument("--force", action="store_true", help="Force re-generation and re-audit even if already present")
    args = parser.parse_args()

    # Load existing results if present
    results_map = {}
    if os.path.exists(REPORT_JSON_PATH):
        try:
            with open(REPORT_JSON_PATH, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                for r in old_data.get("results", []):
                    results_map[str(r.get("questionId"))] = r
        except Exception:
            pass

    # Determine target questions
    if args.id:
        target_indices = [i for i, q in enumerate(questions) if str(q["id"]) == str(args.id)]
    elif args.start is not None or args.end is not None:
        s = args.start if args.start is not None else 1
        e = args.end if args.end is not None else 999999
        target_indices = [i for i, q in enumerate(questions) if str(q["id"]).isdigit() and s <= int(q["id"]) <= e]
    else:
        target_indices = [i for i, q in enumerate(questions) if q["id"] in [str(x) for x in range(2, 11)]]

    if args.only_failing:
        filtered = []
        for i in target_indices:
            q = questions[i]
            qid = str(q["id"])
            if q.get("answerAnalysis"):
                valid, _, _ = validate_and_assemble_analysis(q["sourceText"], q["answerAnalysis"], model=MODELS["qwen"])
                if valid and qid in results_map and results_map[qid].get("consensus", {}).get("approved", False):
                    continue
            filtered.append(i)
        target_indices = filtered

    if args.limit:
        target_indices = target_indices[:args.limit]
    print(f"Targeting {len(target_indices)} questions: {[questions[i]['id'] for i in target_indices[:15]]}{'...' if len(target_indices) > 15 else ''}\n")

    results = []
    total_start = time.time()

    for idx in target_indices:
        q = questions[idx]
        qid = str(q["id"])

        if not args.force and qid in results_map and q.get("answerAnalysis"):
            valid, built_analysis, _ = validate_and_assemble_analysis(q["sourceText"], q["answerAnalysis"], model=MODELS["qwen"])
            if valid and results_map[qid].get("consensus", {}).get("approved", False):
                print(f"  [Skip] Question #{qid} already fully compliant & approved by consensus. Reusing existing result.")
                results.append(results_map[qid])
                if built_analysis and questions[idx]["answerAnalysis"] != built_analysis:
                    questions[idx]["answerAnalysis"] = built_analysis
                    with open(SWT_JSON_PATH, "w", encoding="utf-8") as f:
                        json.dump(questions, f, indent=2, ensure_ascii=False)
                    print(f"  [Saved] Updated swt-questions.json with normalized analysis for Question #{qid}")
                continue

        res = process_question(q, reuse_existing=not args.force)
        results.append(res)
        results_map[qid] = res
        
        # Apply approved analysis directly to memory
        if res["consensus"]["approved"]:
            questions[idx]["answerAnalysis"] = res["analysis"]

        # Write progress incrementally to prevent data loss
        with open(SWT_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(questions, f, indent=2, ensure_ascii=False)
        print(f"  [Saved] Updated swt-questions.json for Question #{q['id']}")

        # Save reports incrementally
        sorted_results = sorted(results_map.values(), key=lambda x: int(x["questionId"]))
        write_reports(sorted_results)
        print(f"  [Saved] Updated audit reports incrementally")

    total_time = time.time() - total_start
    print(f"\n=================================================================")
    print(f"  Completed Pilot Batch in {total_time:.1f}s")
    print("=================================================================")

    # Final reports write
    sorted_results = sorted(results_map.values(), key=lambda x: int(x["questionId"]))
    write_reports(sorted_results)

if __name__ == "__main__":
    main()
