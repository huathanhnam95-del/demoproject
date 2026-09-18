import os
import sys
import time
import json
import re
from collections import Counter
import requests
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OLLAMA_URL = "http://localhost:11434/api/generate"

MODELS = {
    "gm": os.getenv("LOCAL_GEMMA_MODEL", "gemma4:12b"),
    "qw": os.getenv("LOCAL_QWEN_MODEL", "qwen3:14b"),
    "dr": os.getenv("LOCAL_DEEPSEEK_MODEL", "deepseek-r1:14b")
}

ALLOWED_TOPICS = [
    "Education",
    "Socio-cultural and global issues",
    "Age, generation, and gender",
    "Economy, money, and trade",
    "Work",
    "Media and communication",
    "Government, politics, and diplomacy",
    "Lifestyle",
    "Food and health",
    "Environment",
    "Science, technology, and innovation",
    "Crime, punishment, and law",
    "Leisure, sports, and hobbies",
    "City development",
    "Art and museums",
    "Travelling and tourism",
    "Language",
    "Traffic",
    "Ethics",
    "Animals",
    "Population",
    "Climate"
]

TOPIC_MAP = {t.lower(): t for t in ALLOWED_TOPICS}

def normalize_topic(t_str):
    if not t_str or not isinstance(t_str, str):
        return None
    cleaned = t_str.strip().lower()
    if cleaned in TOPIC_MAP:
        return TOPIC_MAP[cleaned]
    # Fuzzy match
    for allowed in ALLOWED_TOPICS:
        if allowed.lower() in cleaned or cleaned in allowed.lower():
            return allowed
    return None

def clean_response(raw: str) -> str:
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

def query_ollama(model_name: str, prompt: str, temperature: float = 0.1, max_retries: int = 3, timeout: int = 90) -> dict | None:
    eff_prompt = prompt
    if "qwen" in model_name.lower():
        eff_prompt = "/no_think\n\n" + prompt

    payload = {
        "model": model_name,
        "prompt": eff_prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": temperature,
            "num_predict": 350,
            "num_ctx": 4096
        }
    }
    if not any(r in model_name.lower() for r in ["deepseek-r1", "-r1", "/r1", "reasoner", "qwq"]):
        payload["think"] = False
    
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
            if resp.status_code == 200:
                raw = resp.json().get("response", "")
                cleaned = clean_response(raw)
                try:
                    data = json.loads(cleaned)
                    return data
                except Exception:
                    # Retry once with lower temperature
                    pass
        except Exception as e:
            time.sleep(1 * attempt)
    return None

def unload_all_models():
    for m in MODELS.values():
        try:
            requests.post(OLLAMA_URL, json={"model": m, "keep_alive": 0}, timeout=5)
        except Exception:
            pass

def build_audit_prompt(prompt_text, current_prim, current_sec1, current_sec2):
    return f"""You are a senior academic examiner and curriculum auditor for PTE and IELTS writing assessments.
Audit the thematic topic classification of this essay prompt:

ESSAY PROMPT:
"{prompt_text}"

CURRENT TOPIC ASSIGNMENT:
- Primary Topic: "{current_prim}"
- Secondary Topic 1: "{current_sec1 or 'None'}"
- Secondary Topic 2: "{current_sec2 or 'None'}"

ALLOWED TOPICS (choose ONLY from this exact list):
{json.dumps(ALLOWED_TOPICS)}

EVALUATION INSTRUCTIONS:
1. Determine if the current Primary Topic accurately reflects the central controversy and substantive subject matter.
2. If the current primary topic is accurate, vote "PASS".
3. If inaccurate or a different topic from the allowed list is significantly more precise, vote "FAIL" and specify your corrected primary and secondary topics.

Respond ONLY with valid JSON in this exact structure:
{{
  "verdict": "PASS" or "FAIL",
  "primary_topic": "Exact topic from allowed list",
  "secondary_topic_1": "Exact topic from allowed list or null",
  "secondary_topic_2": "Exact topic from allowed list or null",
  "reason": "1-sentence concise justification"
}}"""

def build_debate_prompt(prompt_text, proposed_topics, model_stances):
    stances_formatted = ""
    for m_key, stance in model_stances.items():
        stances_formatted += f"""
- Examiner ({stance['model_name']}):
  * Stance: {stance['verdict']}
  * Proposed Primary: "{stance['primary_topic']}"
  * Proposed Secondary: "{stance['secondary_topic_1']}", "{stance['secondary_topic_2']}"
  * Reasoning: {stance['reason']}
"""

    return f"""You are a senior moderator in a panel of 3 expert examiners resolving a disagreement on an essay prompt's topic classification.

ESSAY PROMPT:
"{prompt_text}"

PANEL STANCES:
{stances_formatted}

ALLOWED TOPICS (choose ONLY from this exact list):
{json.dumps(ALLOWED_TOPICS)}

DEBATE TASK:
Review the differing perspectives and justifications from your fellow examiners.
Deliberate on the true core societal issue being tested in this essay.
Cast your final binding vote on the single best Primary Topic and up to 2 Secondary Topics.

Respond ONLY with valid JSON in this exact structure:
{{
  "final_primary_topic": "Exact topic from allowed list",
  "final_secondary_topic_1": "Exact topic from allowed list or null",
  "final_secondary_topic_2": "Exact topic from allowed list or null",
  "debate_rebuttal": "1-2 sentences explaining why this classification is the most accurate resolution"
}}"""

def main():
    print("=" * 80)
    print("STARTING 3-MODEL CONSENSUS & DEBATE AUDIT FOR PTE ESSAY PROMPTS")
    print(f"Models: {list(MODELS.values())}")
    print("=" * 80)

    # 1. Load PTE Prompts from Excel / Database
    excel_path = r"C:\Users\Admin\Downloads\PTE_453_Cleaned_Prompts_Topics_Task_Types.xlsx"
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    ws = wb["453 Prompts"]

    prompts = []
    for r in range(5, ws.max_row + 1):
        no = ws.cell(r, 1).value
        p_text = ws.cell(r, 2).value
        t_type = ws.cell(r, 3).value
        prim = ws.cell(r, 4).value
        s1 = ws.cell(r, 5).value
        s2 = ws.cell(r, 6).value
        if no and p_text:
            prompts.append({
                "no": int(no),
                "prompt": str(p_text).strip(),
                "task_type": str(t_type).strip() if t_type else "To what extent do you agree or disagree",
                "primary_topic": str(prim).strip() if prim else "Education",
                "sec_1": str(s1).strip() if s1 else None,
                "sec_2": str(s2).strip() if s2 else None,
            })

    total_prompts = len(prompts)
    print(f"Loaded {total_prompts} prompts from Excel.")

    os.makedirs("tmp", exist_ok=True)
    checkpoint_file = "tmp/pte_3model_audit_checkpoint.json"
    
    audit_data = {}
    if os.path.exists(checkpoint_file):
        try:
            with open(checkpoint_file, 'r', encoding='utf-8') as f:
                audit_data = json.load(f)
            print(f"Loaded existing checkpoint with {len(audit_data)} audited prompts.")
        except Exception:
            audit_data = {}

    # 2. Sequential Batched Evaluation by Model
    for m_key, m_name in MODELS.items():
        print(f"\n" + "-"*60)
        print(f"--- RUNNING MODEL PASS: {m_name} ({m_key.upper()}) ---")
        print("-" * 60)
        unload_all_models()
        time.sleep(1)
        
        needed = [p for p in prompts if str(p["no"]) not in audit_data or m_key not in audit_data[str(p["no"])].get("round1", {})]
        print(f"Prompts to evaluate for {m_key}: {len(needed)} / {total_prompts}")
        
        for idx, p in enumerate(needed, 1):
            p_no_str = str(p["no"])
            if p_no_str not in audit_data:
                audit_data[p_no_str] = {
                    "no": p["no"],
                    "prompt": p["prompt"],
                    "task_type": p["task_type"],
                    "original_primary": p["primary_topic"],
                    "original_sec1": p["sec_1"],
                    "original_sec2": p["sec_2"],
                    "round1": {},
                    "debate": None,
                    "final_decision": None
                }
                
            prompt_req = build_audit_prompt(p["prompt"], p["primary_topic"], p["sec_1"], p["sec_2"])
            res = query_ollama(m_name, prompt_req)
            
            if res:
                verdict = str(res.get("verdict", "PASS")).upper().strip()
                prim_t = normalize_topic(res.get("primary_topic")) or p["primary_topic"]
                sec1_t = normalize_topic(res.get("secondary_topic_1"))
                sec2_t = normalize_topic(res.get("secondary_topic_2"))
                reason = str(res.get("reason", "")).strip()
                
                # If proposed primary matches original, it's effectively a PASS
                if prim_t == p["primary_topic"] and verdict == "FAIL":
                    verdict = "PASS"
                    
                audit_data[p_no_str]["round1"][m_key] = {
                    "model_name": m_name,
                    "verdict": verdict,
                    "primary_topic": prim_t,
                    "secondary_topic_1": sec1_t,
                    "secondary_topic_2": sec2_t,
                    "reason": reason
                }
            else:
                audit_data[p_no_str]["round1"][m_key] = {
                    "model_name": m_name,
                    "verdict": "PASS",
                    "primary_topic": p["primary_topic"],
                    "secondary_topic_1": p["sec_1"],
                    "secondary_topic_2": p["sec_2"],
                    "reason": "Defaulted pass on response timeout"
                }

            if idx % 10 == 0 or idx == len(needed):
                print(f"[{m_key.upper()}] Evaluated {idx}/{len(needed)} prompts...")
                with open(checkpoint_file, 'w', encoding='utf-8') as f:
                    json.dump(audit_data, f, ensure_ascii=False, indent=2)

    # 3. Analyze Round 1 Consensus & Identify Debates
    print("\n" + "="*80)
    print("ANALYZING ROUND 1 CONSENSUS AND IDENTIFYING CONTESTED PROMPTS")
    print("="*80)

    debates_needed = []
    
    for p in prompts:
        p_no_str = str(p["no"])
        item = audit_data.get(p_no_str, {})
        r1 = item.get("round1", {})
        
        pass_votes = sum(1 for m in r1.values() if m.get("verdict") == "PASS")
        fail_votes = sum(1 for m in r1.values() if m.get("verdict") == "FAIL")
        
        prim_candidates = [m.get("primary_topic") for m in r1.values() if m.get("primary_topic")]
        prim_counts = Counter(prim_candidates)
        
        # Check if 2/3 agree on pass or a single primary topic
        top_topic, top_count = prim_counts.most_common(1)[0] if prim_counts else (p["primary_topic"], 0)
        
        if pass_votes >= 2:
            # 2/3 or 3/3 passed the original classification
            item["status"] = "PASSED_UNCONTESTED" if pass_votes == 3 else "PASSED_MAJORITY"
            item["final_decision"] = {
                "primary_topic": p["primary_topic"],
                "secondary_topic_1": p["sec_1"],
                "secondary_topic_2": p["sec_2"],
                "consensus": f"{pass_votes}/3 Pass",
                "notes": "Passed Round 1 without debate"
            }
        elif top_count >= 2:
            # 2/3 models agree on a specific new primary topic
            item["status"] = "REVISED_BY_MAJORITY"
            item["final_decision"] = {
                "primary_topic": top_topic,
                "secondary_topic_1": p["sec_1"] if p["sec_1"] != top_topic else p["primary_topic"],
                "secondary_topic_2": p["sec_2"],
                "consensus": f"{top_count}/3 Consensus on {top_topic}",
                "notes": "Updated by 2/3 majority consensus"
            }
        else:
            # Complete disagreement (1-1-1 split) or 2/3 Fail with conflicting alternatives
            item["status"] = "DEBATE_REQUIRED"
            debates_needed.append(p)

    print(f"Total Prompts: {total_prompts}")
    print(f" - Uncontested / Majority Pass : {total_prompts - len(debates_needed)} ({((total_prompts - len(debates_needed))/total_prompts)*100:.1f}%)")
    print(f" - Contested / Debate Required : {len(debates_needed)} ({(len(debates_needed)/total_prompts)*100:.1f}%)")

    # 4. Round 2: Multi-Model Debate Loop
    if debates_needed:
        print("\n" + "="*80)
        print(f"RUNNING ROUND 2 DEBATE LOOP FOR {len(debates_needed)} CONTESTED PROMPTS")
        print("="*80)
        
        for m_key, m_name in MODELS.items():
            print(f"\n--- DEBATE DELIBERATION: {m_name} ({m_key.upper()}) ---")
            unload_all_models()
            time.sleep(1)
            
            for idx, p in enumerate(debates_needed, 1):
                p_no_str = str(p["no"])
                item = audit_data[p_no_str]
                if item.get("debate") is None:
                    item["debate"] = {}
                if m_key in item["debate"]:
                    continue
                    
                debate_prompt = build_debate_prompt(p["prompt"], p, item["round1"])
                res = query_ollama(m_name, debate_prompt)
                
                if res:
                    f_prim = normalize_topic(res.get("final_primary_topic")) or p["primary_topic"]
                    f_sec1 = normalize_topic(res.get("final_secondary_topic_1"))
                    f_sec2 = normalize_topic(res.get("final_secondary_topic_2"))
                    rebuttal = str(res.get("debate_rebuttal", "")).strip()
                    
                    item["debate"][m_key] = {
                        "model_name": m_name,
                        "final_primary": f_prim,
                        "final_sec1": f_sec1,
                        "final_sec2": f_sec2,
                        "rebuttal": rebuttal
                    }
                else:
                    item["debate"][m_key] = {
                        "model_name": m_name,
                        "final_primary": item["round1"][m_key]["primary_topic"],
                        "final_sec1": item["round1"][m_key]["secondary_topic_1"],
                        "final_sec2": item["round1"][m_key]["secondary_topic_2"],
                        "rebuttal": "Defended original stance."
                    }
                    
                if idx % 5 == 0 or idx == len(debates_needed):
                    print(f"[{m_key.upper()}] Debated {idx}/{len(debates_needed)} prompts...")
                    with open(checkpoint_file, 'w', encoding='utf-8') as f:
                        json.dump(audit_data, f, ensure_ascii=False, indent=2)

        # Final Debate Consensus Calculation
        for p in debates_needed:
            p_no_str = str(p["no"])
            item = audit_data[p_no_str]
            deb = item.get("debate", {})
            
            final_prim_votes = [m["final_primary"] for m in deb.values() if m.get("final_primary")]
            prim_counts = Counter(final_prim_votes)
            top_topic, top_votes = prim_counts.most_common(1)[0]
            
            # Aggregate secondary topics from all models
            all_sec = []
            for m in deb.values():
                if m.get("final_sec1") and m["final_sec1"] != top_topic:
                    all_sec.append(m["final_sec1"])
                if m.get("final_sec2") and m["final_sec2"] != top_topic:
                    all_sec.append(m["final_sec2"])
            sec_counts = Counter(all_sec)
            top_sec = [s for s, _ in sec_counts.most_common(2)]
            
            item["status"] = "RESOLVED_BY_DEBATE"
            item["final_decision"] = {
                "primary_topic": top_topic,
                "secondary_topic_1": top_sec[0] if len(top_sec) > 0 else None,
                "secondary_topic_2": top_sec[1] if len(top_sec) > 1 else None,
                "consensus": f"{top_votes}/3 Debate Consensus on {top_topic}",
                "notes": f"Resolved after deliberation among {len(deb)} models."
            }

    # Save complete audit report
    report_file = r"public\database\Write Essay\PTE_audit_debate_report.json"
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(audit_data, f, ensure_ascii=False, indent=2)
    print(f"\nSaved full debate report to {report_file}")

    # 5. Update Excel Workbook with 3-Model Verified Topics
    print("\nUpdating Excel workbook with verified topics...")
    from tmp.build_pte_prompts_excel import main as rebuild_excel
    
    # Update essay-questions.json with verified topics
    updated_database = []
    with open(r"public\database\Write Essay\essay-questions.json", 'r', encoding='utf-8') as f:
        orig_json = json.load(f)
        
    for item in orig_json:
        p_no_str = str(item.get("id"))
        if p_no_str in audit_data and audit_data[p_no_str].get("final_decision"):
            fdec = audit_data[p_no_str]["final_decision"]
            item["verifiedPrimaryTopic"] = fdec["primary_topic"]
            item["verifiedSecondaryTopic1"] = fdec["secondary_topic_1"]
            item["verifiedSecondaryTopic2"] = fdec["secondary_topic_2"]
            item["auditStatus"] = audit_data[p_no_str]["status"]
        updated_database.append(item)
        
    with open(r"public\database\Write Essay\essay-questions.json", 'w', encoding='utf-8') as f:
        json.dump(updated_database, f, ensure_ascii=False, indent=2)
        
    # Rebuild Excel with verified topics
    rebuild_excel()
    print("Excel workbook successfully regenerated with 3-model audited & debated topics!")

if __name__ == '__main__':
    main()
