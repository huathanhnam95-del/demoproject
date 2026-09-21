import os
import sys
import json
import time
import requests
from typing import Dict, Any

OLLAMA_URL = "http://localhost:11434/api/generate"
MODELS = {
    "qwen": "qwen3:14b",
    "deepseek": "deepseek-r1:14b",
    "gemma": "gemma4:12b"
}

def clean_response_text(raw_text: str) -> str:
    cleaned = raw_text.strip()
    if "<think>" in cleaned and "</think>" in cleaned:
        cleaned = cleaned.split("</think>")[-1].strip()
    elif "</think>" in cleaned:
        cleaned = cleaned.split("</think>")[-1].strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()

def call_ollama(model: str, prompt: str, temperature: float = 0.2, num_predict: int = 1500) -> str:
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

    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=180)
        if resp.status_code == 200:
            raw = resp.json().get("response", "")
            return clean_response_text(raw)
    except Exception as e:
        print(f"Error calling {model}: {e}", file=sys.stderr)
    return ""

def main():
    # Load Question 50 data
    swt_json_path = os.path.join(os.path.dirname(__file__), "..", "public", "database", "Summarize Written Text", "SWT", "swt-questions.json")
    with open(swt_json_path, "r", encoding="utf-8") as f:
        questions = json.load(f)
    q50 = next((q for q in questions if str(q.get("id")) == "50"), None)
    if not q50:
        print("Question 50 not found!", file=sys.stderr)
        return

    source_text = q50["sourceText"]
    current_analysis = q50["answerAnalysis"]

    diagnostic_prompt = f"""You are a Principal Psychometrician and Chief Applied Linguist conducting a formal Forensic Quality Audit on a PTE Academic Summarize Written Text (SWT) pedagogical answer breakdown.

USER CRITIQUE & OBSERVED PROBLEM:
"The quality here has dropped as the point is only covering a small part of the text (only 'overqualified workers are' was used for points 1). Overall, I think the main points were not sufficiently captured, the text was so long (282 words across 3 distinct paragraphs) but only a few phrases were captured as the main point? I need the local LLMs to carefully assess this problem."

FULL SOURCE PASSAGE (282 words, 3 paragraphs):
\"\"\"{source_text}\"\"\"

CURRENT GENERATED BREAKDOWN:
Core Points:
{json.dumps(current_analysis["corePoints"], indent=2)}

Ignore Points:
{json.dumps(current_analysis["ignorePoints"], indent=2)}

Version A (Simple):
- Text: "{current_analysis["sampleSummary"]["versionA"]["text"]}"
- Point Highlights: {json.dumps(current_analysis["sampleSummary"]["versionA"]["pointHighlights"], indent=2)}

Version B (Advanced):
- Text: "{current_analysis["sampleSummary"]["versionB"]["text"]}"
- Point Highlights: {json.dumps(current_analysis["sampleSummary"]["versionB"]["pointHighlights"], indent=2)}

TASK FOR THE AUDITOR:
Carefully assess this problem across 4 critical areas and provide your unvarnished diagnostic:

1. PASSAGE COVERAGE DEFICIENCY:
   - Did the 3 core points sufficiently cover the essential arguments of this 282-word text across all 3 paragraphs?
   - What major thematic pillars or arguments were omitted or glossed over (e.g. the hiring bias/fear of turnover vs legal status, macroeconomic surplus in developing economies, specific autonomy mechanism)?
   - Exactly how many core points should a rich 280+ word text have, and what should they be?

2. HIGHLIGHT DEGRADATION (FRAGMENTED PHRASES):
   - Why did Version A's highlights degrade into useless 2-3 word grammatical fragments ("overqualified workers are", "empowerment can", "dissatisfaction, which")?
   - How does this undermine student learning?
   - What should the highlights in Version A actually have been?

3. AUDITOR COMMITTEE BLINDSPOT:
   - Why did the 3-model committee previously score this 8.67/10 and give it 3/3 PASS votes?
   - What critical flaw in the previous audit rubric allowed shallow passage coverage and fragmented highlights to pass undetected?

4. CONCRETE REMEDIATION PLAN:
   - What exact changes are required in:
     (a) Prompt engineering for core point extraction (paragraph-by-paragraph thematic mapping).
     (b) Highlight extraction algorithm (semantic predicate/clause requirement instead of greedy prefix slicing).
     (c) Audit criteria (mandatory checks for semantic completeness of highlights and passage coverage ratio).

Respond with a well-structured JSON object with these exact keys:
{{
  "modelName": "Your model name",
  "verdictOnQuality": "SUBSTANDARD / UNACCEPTABLE",
  "passageCoverageAnalysis": {{
    "wasCoverageSufficient": false,
    "omittedPillars": ["list of major ideas missed"],
    "recommendedCorePointCount": 4,
    "optimalCorePoints": [
      {{ "id": "core-1", "label": "...", "paragraph": 1 }},
      {{ "id": "core-2", "label": "...", "paragraph": 2 }},
      {{ "id": "core-3", "label": "...", "paragraph": 3 }},
      {{ "id": "core-4", "label": "...", "paragraph": 3 }}
    ]
  }},
  "highlightDegradationAnalysis": {{
    "rootCause": "...",
    "pedagogicalImpact": "...",
    "correctedVersionAHighlights": [
      {{ "pointId": "core-1", "phrase": "..." }},
      {{ "pointId": "core-2", "phrase": "..." }},
      {{ "pointId": "core-3", "phrase": "..." }}
    ]
  }},
  "auditCommitteeBlindspot": {{
    "whyAuditorsPassedIt": "...",
    "rubricFlaw": "..."
  }},
  "concreteRemediations": {{
    "generationPromptChanges": "...",
    "algorithmChanges": "...",
    "auditRubricChanges": "..."
  }}
}}"""

    print("=================================================================")
    print("  Executing Forensic Quality Diagnostic Across 3 Local LLMs")
    print("=================================================================")

    results = {}
    for role, model in MODELS.items():
        print(f"\n---> Querying {role} ({model}) for diagnostic analysis...")
        t0 = time.time()
        raw_res = call_ollama(model, diagnostic_prompt, temperature=0.1, num_predict=2500)
        dur = time.time() - t0
        print(f"     Received response from {role} in {dur:.1f}s")
        if raw_res:
            try:
                parsed = json.loads(raw_res)
                results[role] = parsed
                print(f"     Parsed diagnostic successfully from {role}")
            except Exception as err:
                print(f"     Failed to parse JSON from {role}: {err}")
                results[role] = {"raw": raw_res, "error": str(err)}
        else:
            print(f"     Empty response from {role}")

    out_file = os.path.join(os.path.dirname(__file__), "..", "reports", "swt_q50_quality_diagnostic.json")
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nSaved full diagnostic findings to {out_file}")

if __name__ == "__main__":
    main()
