#!/usr/bin/env python3
"""
3-Local-LLM Council Debate & Consensus for Guided Write Essay Steps 3, 4, and 5.
Invokes:
  - deepseek-r1:14b (Architect & Cognitive Flow Specialist)
  - qwen3:14b (Linguist & Natural Vietnamese Phrasing Specialist)
  - gemma4:12b (Instructional Scaffolding & Learner UX Specialist)
Outputs:
  - council_steps3_5_design.json
  - council_steps3_5_design.md
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

MODELS = {
    "deepseek": "deepseek-r1:14b",
    "qwen": "qwen3:14b",
    "gemma": "gemma4:12b",
}

def query_ollama(model: str, prompt: str, system: str = "", timeout: int = 180) -> str:
    print(f"\n[Council] Querying {model}...")
    start_t = time.time()
    url = f"{OLLAMA_BASE_URL}/api/generate"
    data = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": 1800,
            "num_ctx": 4096,
        }
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            raw = payload.get("response", "")
            # Clean think tags
            if "<think>" in raw and "</think>" in raw:
                raw = raw.split("</think>")[-1].strip()
            elif "<think>" in raw:
                raw = re.sub(r"<think>.*", "", raw, flags=re.DOTALL).strip()
            elapsed = time.time() - start_t
            print(f"[Council] {model} finished in {elapsed:.1f}s ({len(raw)} chars)")
            return raw
    except Exception as e:
        print(f"[Council] Error querying {model}: {e}")
        return f"Error: {e}"

def main():
    print("=== Summoning 3-Local-LLM Council for Steps 3, 4, 5 Overhaul ===")
    
    context_problem = """
We are overhauling the Guided Write Essay practice mode in a web application for PTE Academic preparation.
Previously, Steps 1 and 2 were overhauled from text-heavy cards into interactive visual layouts (Mind map / Ideation tree / HUD / Thought bubbles).

Now we must overhaul the remaining steps:
- Step 3 (Language kit: Core vocabulary, collocations, sentence pattern models, cohesive linking words)
- Step 4 (Make a plan: Macro-to-micro essay outline and argument structure)
- Step 5 (Sentence builder / Further: Fill-in-the-blanks and sentence-by-sentence drafting leading into the full essay)

CRITICAL USER CONSTRAINTS:
1. "Too many box-in-box design" -> Strictly eliminate nested card borders, stacked boxes inside boxes, and heavy outer containers.
2. "Reduce wall of text as much as possible" -> Visual interactive elements, flowcharts, chips, toolbelts, slot-filling cards.
3. Natural, casual, non-academic Vietnamese -> NO AI-robot phrases like "Cán cân lập luận", NO generic placeholders like "Bạn có thể chọn góc nhìn này...", NO repetitive boilerplates.
4. Bold and highlight target terms in BOTH English and Vietnamese example sentences.
5. In Step 3, the <?> toggle must show clear, casual explanations and contextual meaning with bold/highlighted terms.
6. In Step 4, turn the static outline list into an interactive visual roadmap/flowchart connecting Intro -> Body 1 -> Body 2 -> Conclusion.
7. In Step 5, turn the sentence builder into a clean interactive workshop where sentences flow seamlessly into the draft essay.
"""

    # Round 1: Individual Insights
    # 1. DeepSeek-R1 (Architect & Cognitive Flow)
    prompt_deepseek = f"""
{context_problem}

As the ARCHITECT & COGNITIVE FLOW SPECIALIST:
Analyze how to visually structure Steps 3, 4, and 5:
1. Step 3 (Language Kit): How to reorganize Vocabulary, Collocations, Pattern Workbench, and Linking Words into a flat, interactive "Toolbelt" or visual dashboard that avoids vertical text bloat and nested cards?
2. Step 4 (Make a Plan): How to design an interactive 4-paragraph visual flowchart/timeline (Intro -> Body 1 -> Body 2 -> Conclusion) linking user-chosen ideas from Step 2 with visual badges and zero card-in-card nesting?
3. Step 5 (Sentence Builder): How to structure the interactive Sentence Construction Workshop so users see their sentences visually connect and stream into the final essay editor?

Provide concrete, actionable UI architecture proposals with DOM component structures and layout flow.
"""
    deepseek_out = query_ollama(MODELS["deepseek"], prompt_deepseek, "You are DeepSeek-R1, an expert UI Architect and Cognitive Flow Specialist.")

    # 2. Qwen3 (Linguist & Natural Vietnamese Copy)
    prompt_qwen = f"""
{context_problem}

As the LINGUISTIC & NATURAL VIETNAMESE SPECIALIST:
Scan the language, microcopy, headers, and explanations for Steps 3, 4, and 5:
1. Banned phrases vs. Natural Vietnamese alternatives:
   - Identify robotic/AI phrases to ban (e.g., "Cán cân lập luận", "Công cụ lập luận", "Mô hình hoá", "Chiến lược câu", "Khung hỗ trợ dàn ý", etc.).
   - Provide casual, punchy, student-friendly alternatives for:
     * Step 3 headers & tabs (Vocabulary, Collocations, Grammar Models, Linking Words).
     * <?> Explanation callouts (simple terms, how the point is developed in Vietnamese).
     * Step 4 headers & outline milestones (Thesis, Body 1, Body 2, Conclusion).
     * Step 5 cues, fill-in-the-blank placeholders, and action buttons.
2. Rules for bold + highlighting:
   - How to ensure terms are consistently bolded and highlighted in both English and Vietnamese translations.
3. Zero generic placeholders:
   - Ensure all model examples sound like real 79+ essay sentences, not generic templates.
"""
    qwen_out = query_ollama(MODELS["qwen"], prompt_qwen, "You are Qwen3, an expert Bilingual Linguist and Vietnamese UX Copy Specialist.")

    # 3. Gemma4 (Instructional Scaffolding & Learner UX)
    prompt_gemma = f"""
{context_problem}

As the INSTRUCTIONAL SCAFFOLDING & LEARNER UX SPECIALIST:
Design the progressive learning interactions for Steps 3, 4, and 5:
1. Step 3 (Language Kit): How should learners interact with the vocabulary & collocations? (e.g., click-to-commit target meter, quick category filtering, audio/meaning quick flip, interactive formula slot preview).
2. Step 4 (Make a Plan): How should learners inspect and verify their outline before writing? (e.g., interactive node click to preview argument mechanism, 1-click copy, visual readiness indicator).
3. Step 5 (Sentence Builder): How should the 3 hint levels (1-Purpose, 2-Fillable Frame, 3-Model Sentence) transition smoothly? How should user typing in the blanks auto-transfer to the essay draft with positive reinforcement?

Detail the interactive states, animations, and micro-interactions.
"""
    gemma_out = query_ollama(MODELS["gemma"], prompt_gemma, "You are Gemma4, an expert in Instructional Scaffolding and Learner UX.")

    # Round 2: Debate & Consensus Synthesis
    debate_prompt = f"""
You are the Council Lead synthesizing the proposals of our 3 specialist models:

--- DEEPSEEK-R1 (Architect):
{deepseek_out}

--- QWEN3 (Linguist & Natural Copy):
{qwen_out}

--- GEMMA4 (Learner UX & Scaffolding):
{gemma_out}

TASK:
Produce the UNIFIED CONSENSUS DESIGN SPECIFICATION for Steps 3, 4, and 5.
Include:
1. Step 3 (Language Kit) Consensus UI & Interactions:
   - Exact layout structure (e.g., Category Pills, Flat Toolbelt Cards, Inline Highlight Markup, Formula Slot Preview, 4-Stage Linking Stepper).
2. Step 4 (Make a Plan) Consensus UI & Interactions:
   - Exact visual roadmap / flowchart layout (Timeline nodes, Badges, Direct link with Step 2 choices).
3. Step 5 (Sentence Builder) Consensus UI & Interactions:
   - Exact workshop layout, blank-filling interaction, auto-sync to draft editor.
4. Natural Vietnamese Phrasing Dictionary:
   - Table of Old/Robotic terms vs. Approved Natural terms for all headers, buttons, and badges.
5. Implementation Checklist:
   - Code changes for public/write-essay-mode.js and public/write-essay-mode.css.

Format as a clean, authoritative markdown specification.
"""
    consensus_out = query_ollama(MODELS["deepseek"], debate_prompt, "You are the Council Lead presiding over the 3-LLM consensus synthesis.")

    # Save artifacts
    results = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "models": MODELS,
        "deepseek": deepseek_out,
        "qwen": qwen_out,
        "gemma": gemma_out,
        "consensus": consensus_out
    }

    out_json = os.path.join(os.getcwd(), "council_steps3_5_design.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    out_md = os.path.join(os.getcwd(), "council_steps3_5_design.md")
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("# 3-Local-LLM Council Consensus Specification: Guided Write Essay Steps 3–5\n\n")
        f.write(f"**Date**: {results['timestamp']}\n\n")
        f.write("## 1. DeepSeek-R1 (Architectural & Cognitive Flow Proposal)\n\n")
        f.write(deepseek_out + "\n\n")
        f.write("## 2. Qwen3 (Linguistic & Natural Vietnamese Phrasing Proposal)\n\n")
        f.write(qwen_out + "\n\n")
        f.write("## 3. Gemma4 (Instructional Scaffolding & Learner UX Proposal)\n\n")
        f.write(gemma_out + "\n\n")
        f.write("## 4. Final Council Consensus & Implementation Blueprint\n\n")
        f.write(consensus_out + "\n")

    print(f"\n[Council] Successfully completed! Output written to {out_json} and {out_md}")

if __name__ == "__main__":
    main()
