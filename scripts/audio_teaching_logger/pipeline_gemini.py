import os
import json
import time
import re
from pathlib import Path
from .config import (
    GEMINI_API_KEY,
    DEFAULT_GEMINI_MODEL,
    FALLBACK_GEMINI_MODELS,
    PEDAGOGICAL_PROMPT_REQUIREMENTS,
    ANALYSIS_JSON_SCHEMA,
    MERMAID_UNIFIED_PROMPT,
    MERMAID_MINDMAP_PROMPT,
    MERMAID_FLOWCHART_PROMPT
)

def format_markdown_report(data: dict, source_label: str = "Gemini 3.7 Flash") -> str:
    """Format structured analysis JSON into an executive, visual Teacher's Pre-Class Briefing Card."""
    title = data.get("title", "Teacher's Pre-Class Briefing & Lesson Log")
    summary = data.get("lesson_summary", {})
    what_taught = data.get("what_taught", [])
    problems_solutions = data.get("student_problems_and_solutions", [])
    next_briefing = data.get("next_lesson_briefing", {})

    # Fallback compatibility with older schema keys
    if not problems_solutions and data.get("student_problems"):
        # Map old schema
        old_probs = data.get("student_problems", [])
        old_sols = {s.get("targeted_problem_id", ""): s for s in data.get("teacher_solutions", [])}
        old_resps = {r.get("targeted_problem_id", ""): r for r in data.get("student_response", [])}
        for idx, p in enumerate(old_probs, 1):
            pid = p.get("problem_id", f"P{idx}")
            sol = old_sols.get(pid, {})
            resp = old_resps.get(pid, {})
            problems_solutions.append({
                "problem_id": pid,
                "severity": p.get("severity", "Medium"),
                "issue_summary": p.get("description", p.get("error_type", "Mistake")),
                "student_error": p.get("student_utterance", "N/A"),
                "teacher_fix": sol.get("explanation", sol.get("drill_guidance", "N/A")),
                "student_outcome": resp.get("comprehension_status", "Reviewed"),
                "outcome_evidence": resp.get("evidence", "")
            })

    lines = []
    lines.append(f"# 🎓 {title}")
    lines.append(f"> **Engine**: `{source_label}` | **Generated**: `{time.strftime('%Y-%m-%d %H:%M:%S')}`\n")

    # 1. 60-Second Quick Recap Card
    lines.append("## ⚡ 60-Second Quick Recap (Tóm tắt nhanh trước giờ dạy)")
    if isinstance(summary, dict):
        skill = summary.get("focus_skill", "General")
        topic = summary.get("core_topic", "Lesson Review")
        readiness = summary.get("student_readiness_level", "In Progress")
        recap_text = summary.get("quick_recap_60s", "")

        lines.append("| Focus Skill | Core Lesson Topic | Student Readiness |")
        lines.append("| :--- | :--- | :--- |")
        lines.append(f"| 🎯 **{skill}** | 📖 **{topic}** | 🚦 `{readiness}` |\n")

        if recap_text:
            lines.append(f"> [!TIP]\n> **Key Takeaway**: {recap_text}\n")
    elif isinstance(summary, str):
        lines.append(f"> [!TIP]\n> **Summary**: {summary}\n")

    lines.append("---\n")

    # 2. What was taught
    lines.append("## 🎯 1. Core Concepts Taught (Kiến thức trọng tâm đã dạy)")
    if what_taught:
        for idx, item in enumerate(what_taught, 1):
            cat = item.get("category", "General")
            topic = item.get("topic", "Topic")
            rule = item.get("key_rule", item.get("details", ""))
            examples = item.get("examples", [])
            lines.append(f"### {idx}. [{cat}] **{topic}**")
            lines.append(f"- 💡 **Core Rule / Principle**: {rule}")
            if examples:
                ex_str = ", ".join([f"`{e}`" for e in examples])
                lines.append(f"- 🔍 **Target Examples**: {ex_str}")
            lines.append("")
    else:
        lines.append("*No specific taught topics recorded.*\n")

    lines.append("---\n")

    # 3. Student Problems & Solutions Contrast Table
    lines.append("## ⚠️ 2. Student Blocker Radar & Fixes (Bảng đối chiếu Lỗi ➔ Cách sửa)")
    if problems_solutions:
        lines.append("| ID & Sev | Blocker Summary | ❌ Student Attempt / Error | ✅ Teacher Fix & Drill | 📈 Outcome |")
        lines.append("| :--- | :--- | :--- | :--- | :--- |")
        for p in problems_solutions:
            pid = p.get("problem_id", "P")
            sev = p.get("severity", "Medium")
            summary_txt = p.get("issue_summary", "").replace("|", "/")
            error_txt = p.get("student_error", "").replace("|", "/")
            fix_txt = p.get("teacher_fix", "").replace("|", "/")
            outcome = p.get("student_outcome", "Reviewed").replace("|", "/")
            lines.append(f"| **{pid}** ({sev}) | **{summary_txt}** | *\"{error_txt}\"* | {fix_txt} | `{outcome}` |")
        lines.append("")
    else:
        lines.append("*No specific student errors recorded.*\n")

    lines.append("---\n")

    # 4. Next-Class Action Plan & 5-Min Warmup
    lines.append("## 📋 3. Next-Class Action Plan & Warm-up (Kế hoạch bài học kế tiếp)")
    
    warmup_quiz = next_briefing.get("warmup_quiz_questions", []) if isinstance(next_briefing, dict) else []
    teacher_focus = next_briefing.get("teacher_followup_focus", []) if isinstance(next_briefing, dict) else []
    student_hw = next_briefing.get("student_homework_checklist", []) if isinstance(next_briefing, dict) else []

    # Fallback to action_items if present
    if not teacher_focus and data.get("action_items", {}).get("for_teacher"):
        teacher_focus = data["action_items"]["for_teacher"]
    if not student_hw and data.get("action_items", {}).get("for_student"):
        student_hw = data["action_items"]["for_student"]

    lines.append("### ⏱️ 5-Minute Warmup Quiz for Next Class (Bài kiểm tra nhanh đầu giờ):")
    if warmup_quiz:
        for idx, q in enumerate(warmup_quiz, 1):
            lines.append(f"- [ ] **Q{idx}**: {q}")
    else:
        lines.append("- [ ] *Ask student to re-apply the core rules from last session without prompt assistance.*")

    lines.append("\n### 👨‍🏫 Teacher Follow-up Focus (Điểm giáo viên cần giám sát):")
    if teacher_focus:
        for f in teacher_focus:
            lines.append(f"- [ ] {f}")
    else:
        lines.append("- [ ] *Re-test identified blockers in first practice prompt.*")

    lines.append("\n### 🧑‍🎓 Student Homework to Verify (Bài tập về nhà cần kiểm tra):")
    if student_hw:
        for hw in student_hw:
            lines.append(f"- [ ] {hw}")
    else:
        lines.append("- [ ] *Verify assigned practice passages.*")

    return "\n".join(lines)


def _sanitize_mermaid_text(text: object, max_len: int = 55) -> str:
    """Remove characters that break Mermaid syntax, normalize whitespace, and truncate."""
    if text is None:
        return "N/A"
    text = str(text)
    # Strip problematic characters for Mermaid node labels
    for ch in ['(', ')', '[', ']', '{', '}', '#', '&', ';', '<', '>', '`', '*', '|', '"', "'", "\n", "\r"]:
        text = text.replace(ch, ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    if not text:
        return "N/A"
    if len(text) > max_len:
        text = text[:max_len - 3].rstrip() + "..."
    return text


def generate_mermaid_fallback(data: dict | None) -> dict:
    """
    Pure-Python fallback: generate Mermaid mindmap and flowchart from analysis JSON
    without calling an LLM. Useful for offline mode, testing, or API fallback.
    """
    if not isinstance(data, dict):
        data = {}

    summary = data.get("lesson_summary", {})
    what_taught = data.get("what_taught", []) or []
    problems = data.get("student_problems_and_solutions", []) or data.get("student_problems", []) or []
    next_brief = data.get("next_lesson_briefing", {}) or {}

    topic = _sanitize_mermaid_text(summary.get("core_topic", "Lesson Review") if isinstance(summary, dict) else "Lesson Review", 50)

    # ─── 1. Mindmap ───
    mm = ['mindmap', f'  root(("{topic}"))']

    # Branch 1: What was taught
    mm.append("    🎯 Kien Thuc Da Day")
    if what_taught:
        for item in what_taught[:6]:
            if not isinstance(item, dict):
                continue
            cat = _sanitize_mermaid_text(item.get("category", "General"), 20)
            t = _sanitize_mermaid_text(item.get("topic", "Topic"), 40)
            mm.append(f"      {cat}: {t}")
            for ex in (item.get("examples", []) or [])[:2]:
                mm.append(f"        {_sanitize_mermaid_text(ex, 45)}")
    else:
        mm.append("      Noi dung: Tong quan bai hoc")

    # Branch 2: Student problems
    mm.append("    ⚠️ Loi Hoc Vien")
    if problems:
        for idx, p in enumerate(problems[:5], 1):
            if not isinstance(p, dict):
                continue
            sev = p.get("severity", "").replace("🔴", "P1").replace("🟡", "P2").replace("🟢", "P3").strip()
            pid = p.get("problem_id", f"P{idx}")
            label = _sanitize_mermaid_text(p.get("issue_summary", p.get("description", "Error")), 40)
            prefix = f"{sev} {pid}: " if sev else f"{pid}: "
            mm.append(f"      {prefix}{label}")
            outcome = _sanitize_mermaid_text(p.get("student_outcome", p.get("comprehension_status", "")), 35)
            if outcome and outcome != "N/A":
                mm.append(f"        Ket qua: {outcome}")
    else:
        mm.append("      Khong ghi nhan loi nghiem trong")

    # Branch 3: Next lesson
    mm.append("    📋 Buoi Sau")
    warmup = next_brief.get("warmup_quiz_questions", []) if isinstance(next_brief, dict) else []
    for q in warmup[:3]:
        mm.append(f"      Quiz: {_sanitize_mermaid_text(q, 45)}")
    focus = next_brief.get("teacher_followup_focus", []) if isinstance(next_brief, dict) else []
    for f_item in focus[:3]:
        mm.append(f"      Theo doi: {_sanitize_mermaid_text(f_item, 40)}")
    hw = next_brief.get("student_homework_checklist", []) if isinstance(next_brief, dict) else []
    for h in hw[:3]:
        mm.append(f"      BTVN: {_sanitize_mermaid_text(h, 45)}")
    if not (warmup or focus or hw):
        mm.append("      On tap va danh gia dinh ky")

    mindmap_code = "\n".join(mm)

    # ─── 2. Flowchart ───
    fc = ["graph TD"]
    fc.append(f'  START["{_sanitize_mermaid_text(topic, 45)}"]')

    prev_id = "START"
    if what_taught:
        for idx, item in enumerate(what_taught[:5]):
            if not isinstance(item, dict):
                continue
            nid = f"T{idx + 1}"
            cat = _sanitize_mermaid_text(item.get("category", "General"), 15)
            t = _sanitize_mermaid_text(item.get("topic", "Topic"), 35)
            fc.append(f'  {nid}["{cat}: {t}"]')
            fc.append(f"  {prev_id} --> {nid}")
            # Link related problems if any
            for p in problems:
                if not isinstance(p, dict):
                    continue
                psummary = p.get("issue_summary", p.get("description", "")).lower()
                ttopic = item.get("topic", "").lower()
                if any(w in psummary for w in ttopic.split()[:2] if len(w) > 3):
                    pid_num = "".join(filter(str.isdigit, p.get("problem_id", ""))) or str(idx + 1)
                    pid_node = f"E{pid_num}"
                    plabel = _sanitize_mermaid_text(p.get("issue_summary", p.get("description", "Error")), 40)
                    sev = p.get("severity", "")
                    style = "critical" if "🔴" in sev else ("warning" if "🟡" in sev else "success")
                    fc.append(f'  {pid_node}["{plabel}"]:::{style}')
                    fc.append(f"  {nid} -->|lỗi| {pid_node}")
                    break
            prev_id = nid
    else:
        fc.append('  T1["Noi dung buoi hoc"]')
        fc.append(f"  {prev_id} --> T1")
        prev_id = "T1"

    # Next steps
    fc.append('  NEXT["📋 Ke hoach buoi sau"]:::action')
    fc.append(f"  {prev_id} --> NEXT")
    for idx, q in enumerate(warmup[:2]):
        qid = f"N{idx + 1}"
        fc.append(f'  {qid}["{_sanitize_mermaid_text(q, 40)}"]:::action')
        fc.append(f"  NEXT --> {qid}")

    fc.append("")
    fc.append("  classDef critical fill:#ff6b6b,stroke:#c92a2a,color:#fff;")
    fc.append("  classDef warning fill:#ffd43b,stroke:#e67700,color:#333;")
    fc.append("  classDef success fill:#51cf66,stroke:#2b8a3e,color:#fff;")
    fc.append("  classDef action fill:#74c0fc,stroke:#1864ab,color:#fff;")

    flowchart_code = "\n".join(fc)

    return {
        "mindmap": mindmap_code,
        "flowchart": flowchart_code
    }


def generate_mermaid_diagrams(
    data: dict,
    api_key: str | None = None,
    model_name: str | None = None,
    use_llm: bool = True
) -> dict:
    """
    Generate Mermaid mindmap and flowchart from analysis JSON.

    If use_llm=True, calls Gemini API with a SINGLE unified JSON prompt (no audio tokens).
    Falls back gracefully to pure-Python template generation on any API error or schema mismatch.

    Returns dict with keys:
      - 'mindmap': Mermaid mindmap syntax string
      - 'flowchart': Mermaid graph TD flowchart syntax string
    """
    if not use_llm:
        return generate_mermaid_fallback(data)

    key = api_key or GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    if not key:
        print("[Mermaid] No API key available — using fallback template.")
        return generate_mermaid_fallback(data)

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("[Mermaid] google.genai not installed — using fallback template.")
        return generate_mermaid_fallback(data)

    client = genai.Client(api_key=key)
    mdl = model_name or DEFAULT_GEMINI_MODEL
    data_str = json.dumps(data, indent=2, ensure_ascii=False)

    try:
        print(f"[Mermaid] Generating mindmap & flowchart in unified pass via {mdl}...")
        resp = client.models.generate_content(
            model=mdl,
            contents=[f"{MERMAID_UNIFIED_PROMPT}\n{data_str}"],
            config=types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type="application/json"
            )
        )
        raw = resp.text.strip()
        parsed_json = json.loads(raw)

        mindmap = parsed_json.get("mindmap", "").strip()
        flowchart = parsed_json.get("flowchart", "").strip()

        # Clean any wrapping code fences
        mindmap = re.sub(r'^```(?:mermaid)?\s*\n?', '', mindmap)
        mindmap = re.sub(r'\n?```\s*$', '', mindmap).strip()

        flowchart = re.sub(r'^```(?:mermaid)?\s*\n?', '', flowchart)
        flowchart = re.sub(r'\n?```\s*$', '', flowchart).strip()

        fallback = generate_mermaid_fallback(data)

        # Validate that mindmap and flowchart start with valid keywords
        if not mindmap or "mindmap" not in mindmap:
            print("  ⚠️ Unified LLM mindmap invalid — using fallback")
            mindmap = fallback["mindmap"]
        else:
            print(f"  ✅ Mindmap generated ({len(mindmap)} chars)")

        if not flowchart or "graph" not in flowchart:
            print("  ⚠️ Unified LLM flowchart invalid — using fallback")
            flowchart = fallback["flowchart"]
        else:
            print(f"  ✅ Flowchart generated ({len(flowchart)} chars)")

        return {
            "mindmap": mindmap,
            "flowchart": flowchart
        }

    except Exception as e:
        print(f"  ⚠️ Unified Mermaid LLM call failed ({e}) — using fallback generator")
        return generate_mermaid_fallback(data)


def run_gemini_pipeline(
    audio_path: str | None = None,
    transcript_text: str | None = None,
    model_name: str | None = None,
    api_key: str | None = None
) -> dict:
    """
    Run Gemini Multimodal Audio analysis (Pipeline A).
    Accepts either an audio file path (.mp3/.m4a/.wav) or a raw transcript text.
    """
    key = api_key or GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise ValueError("GEMINI_API_KEY is not set. Please set it in environment or .env file.")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise ImportError("google.genai package is required. Install with: pip install google-genai")

    client = genai.Client(api_key=key)
    target_models = [model_name] if model_name else [DEFAULT_GEMINI_MODEL] + FALLBACK_GEMINI_MODELS

    prompt = f"""
{PEDAGOGICAL_PROMPT_REQUIREMENTS}

The input provided is a 1-on-1 teaching session with code-switching between Vietnamese and English.
Please analyze the entire dialogue, distinguish between Teacher and Student utterances, and output the analysis in STRICT JSON matching this schema:
```json
{json.dumps(ANALYSIS_JSON_SCHEMA, indent=2)}
```
"""

    start_time = time.time()
    last_error = None

    for mdl in target_models:
        if not mdl:
            continue
        try:
            print(f"[Gemini Pipeline] Attempting model: {mdl}...")
            contents = []

            # 1. If audio file provided
            if audio_path and os.path.exists(audio_path):
                print(f"[Gemini Pipeline] Uploading audio file: {audio_path}...")
                uploaded_file = client.files.upload(file=audio_path)
                contents.append(uploaded_file)
                contents.append(prompt)
            elif transcript_text:
                contents.append(f"{prompt}\n\n--- TRANSCRIPT ---\n{transcript_text}")
            else:
                raise ValueError("Either audio_path or transcript_text must be provided.")

            response = client.models.generate_content(
                model=mdl,
                contents=contents,
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    response_mime_type="application/json"
                )
            )

            raw_text = response.text
            # Extract JSON if wrapped in code blocks
            clean_json_str = raw_text.strip()
            match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", clean_json_str, re.DOTALL)
            if match:
                clean_json_str = match.group(1).strip()

            parsed_data = json.loads(clean_json_str)
            elapsed = round(time.time() - start_time, 2)

            markdown_report = format_markdown_report(parsed_data, source_label=f"Gemini API ({mdl})")

            # Generate visual Mermaid diagrams (text-only API call — near-zero cost)
            print("[Gemini Pipeline] Generating Mermaid visual diagrams...")
            mermaid_diagrams = generate_mermaid_diagrams(
                parsed_data, api_key=key, model_name=mdl, use_llm=True
            )

            return {
                "success": True,
                "model": mdl,
                "elapsed_seconds": round(time.time() - start_time, 2),
                "data": parsed_data,
                "markdown": markdown_report,
                "mermaid_mindmap": mermaid_diagrams.get("mindmap", ""),
                "mermaid_flowchart": mermaid_diagrams.get("flowchart", ""),
                "raw_response": raw_text
            }

        except Exception as e:
            print(f"[Gemini Pipeline] Error with {mdl}: {e}")
            last_error = e
            time.sleep(1)

    return {
        "success": False,
        "error": str(last_error),
        "elapsed_seconds": round(time.time() - start_time, 2),
        "data": None,
        "markdown": None
    }


def transcribe_audio_gemini(
    audio_path: str,
    model_name: str | None = None,
    api_key: str | None = None
) -> str:
    """Extract full timestamped and diarized bilingual transcript using Gemini API."""
    key = api_key or GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise ValueError("GEMINI_API_KEY is not set.")

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=key)
    mdl = model_name or DEFAULT_GEMINI_MODEL

    print(f"[Gemini STT] Uploading and transcribing audio with {mdl}...")
    uploaded = client.files.upload(file=audio_path)
    prompt = """Please transcribe the complete audio recording word-for-word with timestamps and speaker separation.
This is a 1-on-1 teaching session with Vietnamese and English code-switching.
Format:
[HH:MM:SS] Teacher: <exact spoken words>
[HH:MM:SS] Student: <exact spoken words>

Accurately transcribe all Vietnamese sentences and English vocabulary, pronunciation drills, and target phrases."""

    response = client.models.generate_content(
        model=mdl,
        contents=[uploaded, prompt]
    )
    return response.text
