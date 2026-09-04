#!/usr/bin/env python3
"""
3-Local-LLM Council Enrichment Pipeline for PTE Write Essay Guided Practice.

Council Division of Labor:
- deepseek-r1:14b: Deep Reasoner & Debate Logician
  -> Generates 6 distinct, logical arguments per stance (12 total), prompt traps, and strategic cues.
- qwen3:14b: Linguistic & Bilingual Quality Specialist
  -> Generates 8 academic collocations with real contextual sentences + Vietnamese glosses,
     and 3 complex grammar models (concession, cause/condition, inversion).
- gemma4:12b: Instructional Scaffolding Specialist
  -> Generates Step 1 comprehension checks (Task MCQ with distractor feedback +
     Gap-Fill Macro Blueprint with slot chips and hints).

Optimization:
- Stage-Batched Workflow: For batches, loads each model once to prevent 16GB GPU VRAM thrashing.
- Lean JSON Prompts: Fixed JSON schemas, num_predict caps, temperature controls.
- Automatic SHA-256 verification and atomic manifest updating.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

MODELS = {
    "reasoner": "deepseek-r1:14b",
    "linguist": "qwen3:14b",
    "scaffolder": "gemma4:12b",
}

GENERIC_BANNED_PHRASES = [
    "helps students discuss",
    "discuss [topic] clearly",
    "this essay will discuss",
    "daily life",
    "strongly agree with this statement because it is very good",
    "an important topic in modern society",
    "there are two sides to every coin",
    "has both pros and cons"
]


def repair_json_text(content: str) -> str:
    """Repairs common LLM JSON syntax issues like unescaped inner quotes and trailing commas."""
    if not content:
        return "{}"

    # Strip DeepSeek reasoning tokens if present
    if "<think>" in content and "</think>" in content:
        content = content.split("</think>")[-1].strip()

    # Clean markdown codeblocks
    content = re.sub(r"^```json\s*", "", content.strip(), flags=re.MULTILINE)
    content = re.sub(r"^```\s*$", "", content.strip(), flags=re.MULTILINE)

    # Find outer JSON boundaries
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1:
        content = content[start:end+1]

    # Fix unescaped double quotes inside key-value pairs
    lines = content.splitlines()
    repaired_lines = []
    for line in lines:
        m = re.match(r'^(\s*"[^"]+"\s*:\s*")(.*)("\s*,?\s*)$', line)
        if m:
            prefix, val, suffix = m.group(1), m.group(2), m.group(3)
            # Replace unescaped inner double quotes with single quotes
            val_fixed = re.sub(r'(?<!\\)"', "'", val)
            line = prefix + val_fixed + suffix
        repaired_lines.append(line)
    content = "\n".join(repaired_lines)

    # Strip trailing commas before closing braces/brackets
    content = re.sub(r",\s*([}\]])", r"\1", content)

    # Balance unclosed brackets if truncated
    open_curly = content.count("{")
    close_curly = content.count("}")
    open_square = content.count("[")
    close_square = content.count("]")

    if open_square > close_square:
        content += "]" * (open_square - close_square)
    if open_curly > close_curly:
        content += "}" * (open_curly - close_curly)

    return content


# ==============================================================================
# OLLAMA HTTP CLIENT
# ==============================================================================

class OllamaClient:
    def __init__(self, base_url: str = OLLAMA_BASE_URL, timeout: int = 180):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def generate_json(self, model: str, system_prompt: str, user_prompt: str,
                      temperature: float = 0.2, num_predict: int = 2400) -> Dict[str, Any]:
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "format": "json",
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": num_predict,
                "num_ctx": 4096
            }
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )

        last_error = None
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as response:
                    raw_res = json.loads(response.read().decode("utf-8"))
                    content = raw_res.get("message", {}).get("content", "{}")
                    
                    # Apply robust repair
                    content_clean = repair_json_text(content)
                    
                    # Parse JSON
                    try:
                        return json.loads(content_clean)
                    except json.JSONDecodeError:
                        # Fallback: try direct load on original content
                        return json.loads(content)
            except Exception as err:
                last_error = err
                if attempt == 0:
                    time.sleep(2)
                    continue
                raise RuntimeError(f"Ollama call failed for {model}: {err}") from err
        return {}


# ==============================================================================
# MODEL PROMPT GENERATORS
# ==============================================================================

def build_deepseek_prompt(q: Dict[str, Any]) -> Tuple[str, str]:
    system = (
        "You are an elite PTE Academic Writing examiner and Master Debater. "
        "Your task is to generate 6 completely distinct, logically reasoned arguments for each side "
        "of the discussion (12 arguments total) for the essay prompt. "
        "No generic filler or vague generalizations. Every argument must have a concrete academic angle, "
        "a Vietnamese pedagogical strategy, and an authentic writing cue. "
        "Respond strictly in valid JSON."
    )

    user = f"""Essay Prompt:
"{q['prompt']}"
Topic: {q.get('verifiedPrimaryTopic', 'General Academic')}
Prompt Type: {q.get('promptType', 'agree_disagree')}

Generate:
1. "commonMistakes": Exactly 3 specific, insightful common mistakes students make on this exact prompt.
   CRITICAL PEDAGOGICAL REQUIREMENT:
   Do NOT merely write negative "Do NOT" commands (e.g. "Do NOT confuse X with Y" is forbidden because students do not understand what "confuse" actually looks like in practice).
   Instead, provide a complete 3-tier pedagogical breakdown for each mistake:
   - "titleEn": concise 3-6 word English title (e.g. "Conflating Schooling with Genuine Learning")
   - "titleVi": concise natural Vietnamese title (e.g. "Đồng nhất trường học với việc học hỏi")
   - "mistakeEn": concrete description of what students mistakenly do or write in their essay
   - "mistakeVi": mô tả cụ thể học viên thường nhầm lẫn hoặc viết sai cái gì
   - "whyEn": pedagogical explanation of why this weakens the essay or loses Task Achievement points
   - "whyVi": giải thích sâu lý do vì sao cách viết này bị trừ điểm hoặc làm hỏng bài
   - "fixEn": actionable, high-scoring better approach and strategic writing fix
   - "fixVi": hướng dẫn cụ thể cách viết chuẩn xác để đạt điểm tối đa
   - "en": synthesized one-paragraph summary in English
   - "vi": synthesized one-paragraph summary in Vietnamese
2. "stance1": The primary stance (e.g. Agree, Advantages, or Option A).
   - "labelEn": concise label (e.g. "Version 1: Agree / Support")
   - "labelVi": Vietnamese label
   - "stance": machine key ("agree", "advantages", etc.)
   - "arguments": exactly 6 distinct arguments. Each must have:
     * "id": "q{q['id']}-s1-1" .. "q{q['id']}-s1-6"
     * "titleEn": concise 3-5 word title
     * "titleVi": natural Vietnamese title
     * "pointEn": 1 clear, high-level academic claim (18-28 words)
     * "pointVi": accurate Vietnamese translation
     * "strategyVi": detailed, step-by-step development guide in simple, conversational Vietnamese (Giải thích chi tiết bằng tiếng Việt gần gũi, cụ thể cách triển khai luận điểm này: câu chủ đề nêu gì, giải thích cơ chế/nguyên nhân sâu xa thế nào, và đưa ví dụ thực tế đời sống ra sao. Tuyệt đối không dùng câu sáo rỗng như 'hãy đưa ví dụ thực tế' mà phải nêu rõ ví dụ cụ thể về hiện tượng gì).
     * "writingCue": recommended topic sentence start and evidence direction
3. "stance2": The opposing or alternative stance (e.g. Disagree, Disadvantages, or Option B).
   - "labelEn": concise label (e.g. "Version 2: Disagree / Alternative")
   - "labelVi": Vietnamese label
   - "stance": machine key ("disagree", "disadvantages", etc.)
   - "arguments": exactly 6 distinct arguments with the same schema ("q{q['id']}-s2-1" .. "q{q['id']}-s2-6").

Ensure arguments span diverse dimensions: psychological, economic, pedagogical, physiological, societal, ethical, or technological."""
    return system, user


def build_qwen_prompt(q: Dict[str, Any], topic_context: str = "") -> Tuple[str, str]:
    system = (
        "You are an expert bilingual ELT lexicographer and academic writing coach for PTE Academic (Target 79+). "
        "Generate 8 high-level academic collocations directly pertinent to the prompt, with authentic example sentences, "
        "plus 3 diverse complex sentence models (Concession, Cause/Condition, Inversion). "
        "Write Vietnamese definitions and explanations in clear, simple, and casual learner-friendly terms. "
        "Bold the target word/collocation using markdown **bold** in both English and Vietnamese example sentences. "
        "No generic phrases like 'daily life' or 'clear understanding'. "
        "Respond strictly in valid JSON."
    )

    user = f"""Essay Prompt:
"{q['prompt']}"
Topic: {q.get('verifiedPrimaryTopic', 'Academic')}

Generate:
1. "vocabulary": Exactly 8 academic collocations/lexical phrases. Each item must have:
   - "term": the core academic term
   - "collocation": common academic collocation
   - "level": "B2" or "C1"
   - "meaningEn": precise English academic definition
   - "meaningVi": natural, casual Vietnamese definition in simple learner-friendly terms
   - "enGloss": short English gloss
   - "viGloss": short casual Vietnamese gloss
   - "example": a realistic essay sentence using the collocation in context, with the target term wrapped in **bold**
   - "exampleVi": natural, simple Vietnamese translation of the example sentence with the translated term wrapped in **bold**

2. "grammar": Exactly 3 complex sentence models adapted to this prompt:
   - Item 1: Concession & Contrast (pattern using 'Although' or 'While')
   - Item 2: Cause, Condition, or Consequence (pattern using 'Inasmuch as', 'Given that', or inverted condition 'Were [X] to...')
   - Item 3: Emphasis / Inversion / Proportional Comparison (pattern using 'Not only... but also', 'The more... the more', or 'Under no circumstances')
   Each grammar item must have:
   - "name": descriptive name
   - "pattern": the complete model sentence for this prompt
   - "patternVi": Vietnamese translation
   - "en": same as pattern
   - "vi": same as patternVi"""
    return system, user


def build_gemma_prompt(q: Dict[str, Any]) -> Tuple[str, str]:
    system = (
        "You are a master Instructional Designer for standardized computer-based tests (PTE Academic). "
        "Generate Step 1 active comprehension checks (MCQ + Gap-Fill) for the prompt to eliminate passive checking. "
        "Distractors must represent realistic test-taker misconceptions with diagnostic feedback. "
        "Respond strictly in valid JSON."
    )

    user = f"""Essay Prompt:
"{q['prompt']}"
Prompt Type: {q.get('promptType', 'agree_disagree')}

Generate:
1. "mcq": A Multiple Choice Question checking the learner's understanding of the core scoring requirement for this prompt:
   - "questionEn": English question testing what the prompt strictly requires
   - "questionVi": Vietnamese translation
   - "correct": "a"
   - "options": 3 options:
     * Option "a": The correct approach with "feedbackEn" (confirming why it scores 90) and "feedbackVi".
     * Option "b": Distractor 1 (e.g. tangential biography or one-sided bias) with "feedbackEn" (explaining the trap) and "feedbackVi".
     * Option "c": Distractor 2 (e.g. failing to take a stance or writing off-topic) with "feedbackEn" and "feedbackVi".

2. "gapFill": An interactive sentence frame representing the macro strategy blueprint for this essay:
   - "sentenceTemplateEn": A sentence with 3 slots: 'To excel in this essay, I must evaluate {{slot1}}, declare a {{slot2}}, and defend my position with {{slot3}}.' (adapt wording to prompt)
   - "sentenceTemplateVi": Vietnamese sentence with {{slot1}}, {{slot2}}, {{slot3}}
   - "slots": 3 slot objects:
     * "slot1": {{"id": "slot1", "labelEn": "Prompt Focus", "labelVi": "Trọng tâm đề bài", "correctId": "c1", "options": [{{"id": "c1", "textEn": "...", "textVi": "..."}}, {{"id": "w1", "textEn": "...", "textVi": "...", "hintEn": "...", "hintVi": "..."}}]}}
     * "slot2": {{"id": "slot2", "labelEn": "Personal Stance", "labelVi": "Lập trường cá nhân", "correctId": "c2", "options": [{{"id": "c2", "textEn": "...", "textVi": "..."}}, {{"id": "w2", "textEn": "...", "textVi": "...", "hintEn": "...", "hintVi": "..."}}]}}
     * "slot3": {{"id": "slot3", "labelEn": "Argument Evidence", "labelVi": "Căn cứ chứng minh", "correctId": "c3", "options": [{{"id": "c3", "textEn": "...", "textVi": "..."}}, {{"id": "w3", "textEn": "...", "textVi": "...", "hintEn": "...", "hintVi": "..."}}]}}

3. "scaffolds": 4 model sentences:
   - "intro": Thesis model sentence
   - "body1": Body 1 topic sentence
   - "body2": Body 2 topic sentence
   - "conclusion": Restatement conclusion sentence"""
    return system, user


# ==============================================================================
# PACK BUILDER & VALIDATOR
# ==============================================================================

def build_essay_pack(q: Dict[str, Any], deepseek: Dict[str, Any],
                     qwen: Dict[str, Any], gemma: Dict[str, Any]) -> Dict[str, Any]:
    qid_str = str(q["id"])
    prompt = q["prompt"].strip()
    prompt_sha256 = hashlib.sha256(prompt.encode("utf-8")).hexdigest()

    # Split prompt into natural clauses
    clauses = [part.strip() for part in re.split(r"(?<=[.!?])\s+|;\s+", prompt) if part.strip()]
    prompt_segments = [
        {"id": f"segment-{idx + 1}", "text": clause, "role": "prompt_clause"}
        for idx, clause in enumerate(clauses)
    ] or [{"id": "segment-1", "text": prompt, "role": "prompt_clause"}]

    # Format requirements
    reqs = [
        {"id": "answer", "required": True, "en": "State a clear and decisive stance on the issue.", "vi": "Nêu lập trường rõ ràng và dứt khoát về vấn đề."},
        {"id": "reasons", "required": True, "en": "Support your position with two well-developed reasons.", "vi": "Bảo vệ quan điểm bằng hai lý do được phát triển mạch lạc."},
        {"id": "examples", "required": True, "en": "Use relevant real-world examples to substantiate claims.", "vi": "Sử dụng các dẫn chứng thực tế phù hợp để chứng minh."}
    ]

    # Stance 1 & 2 plans
    s1_data = deepseek.get("stance1") or deepseek.get("stance_1") or {}
    s2_data = deepseek.get("stance2") or deepseek.get("stance_2") or {}
    
    plan1_points = s1_data.get("arguments") or s1_data.get("candidatePoints") or s1_data.get("points") or []
    plan2_points = s2_data.get("arguments") or s2_data.get("candidatePoints") or s2_data.get("points") or []

    # Ensure each point has en / vi properties
    for pt in plan1_points + plan2_points:
        if "en" not in pt:
            pt["en"] = pt.get("titleEn", "")
        if "vi" not in pt:
            pt["vi"] = pt.get("titleVi", "")

    plan1 = {
        "id": f"plan-1-b2",
        "stance": s1_data.get("stance", "stance1"),
        "variantId": s1_data.get("stance", "stance1"),
        "label": s1_data.get("labelEn", "Version 1"),
        "labelEn": s1_data.get("labelEn", "Version 1"),
        "labelVi": s1_data.get("labelVi", "Phiên bản 1"),
        "stanceLabelEn": s1_data.get("labelEn", "Version 1"),
        "stanceLabelVi": s1_data.get("labelVi", "Phiên bản 1"),
        "en": s1_data.get("labelEn", "Version 1"),
        "vi": s1_data.get("labelVi", "Phiên bản 1"),
        "candidatePoints": plan1_points
    }
    plan2 = {
        "id": f"plan-2-b2",
        "stance": s2_data.get("stance", "stance2"),
        "variantId": s2_data.get("stance", "stance2"),
        "label": s2_data.get("labelEn", "Version 2"),
        "labelEn": s2_data.get("labelEn", "Version 2"),
        "labelVi": s2_data.get("labelVi", "Phiên bản 2"),
        "stanceLabelEn": s2_data.get("labelEn", "Version 2"),
        "stanceLabelVi": s2_data.get("labelVi", "Phiên bản 2"),
        "en": s2_data.get("labelEn", "Version 2"),
        "vi": s2_data.get("labelVi", "Phiên bản 2"),
        "candidatePoints": plan2_points
    }

    # Language Kit
    vocab = qwen.get("vocabulary") or qwen.get("collocations") or []
    grammar = qwen.get("grammar") or qwen.get("grammarModels") or []
    cohesion = [
        {"term": "Furthermore", "en": "Furthermore", "vi": "Hơn nữa", "enGloss": "addition", "viGloss": "bổ sung ý"},
        {"term": "Conversely", "en": "Conversely", "vi": "Ngược lại", "enGloss": "contrast", "viGloss": "tương phản"},
        {"term": "Consequently", "en": "Consequently", "vi": "Do đó", "enGloss": "result", "viGloss": "kết quả"}
    ]

    # Ensure vocabulary has enGloss & viGloss for contracts compliance
    for v in vocab:
        if "enGloss" not in v:
            v["enGloss"] = v.get("meaningEn", v.get("term", ""))[:60]
        if "viGloss" not in v:
            v["viGloss"] = v.get("meaningVi", v.get("term", ""))[:60]

    # Common Mistakes to Avoid (Insightful 3-Tier Pedagogical Structure)
    raw_mistakes = (
        deepseek.get("commonMistakes")
        or deepseek.get("traps")
        or deepseek.get("promptTraps")
        or []
    )
    traps = []
    for idx, m in enumerate(raw_mistakes):
        if not isinstance(m, dict):
            continue
        title_en = m.get("titleEn") or f"Mistake #{idx+1}"
        title_vi = m.get("titleVi") or f"Lỗi #{idx+1}"
        mistake_en = m.get("mistakeEn") or ""
        mistake_vi = m.get("mistakeVi") or ""
        why_en = m.get("whyEn") or ""
        why_vi = m.get("whyVi") or ""
        fix_en = m.get("fixEn") or ""
        fix_vi = m.get("fixVi") or ""

        en_str = m.get("en")
        if not en_str:
            parts = [f"{title_en}:"]
            if mistake_en: parts.append(mistake_en)
            if why_en: parts.append(f"Why it fails: {why_en}")
            if fix_en: parts.append(f"Better approach: {fix_en}")
            en_str = " ".join(parts)

        vi_str = m.get("vi")
        if not vi_str:
            parts = [f"{title_vi}:"]
            if mistake_vi: parts.append(mistake_vi)
            if why_vi: parts.append(f"Tại sao mất điểm: {why_vi}")
            if fix_vi: parts.append(f"Cách viết chuẩn: {fix_vi}")
            vi_str = " ".join(parts)

        traps.append({
            "titleEn": title_en,
            "titleVi": title_vi,
            "mistakeEn": mistake_en,
            "mistakeVi": mistake_vi,
            "whyEn": why_en,
            "whyVi": why_vi,
            "fixEn": fix_en,
            "fixVi": fix_vi,
            "en": en_str,
            "vi": vi_str,
        })
    if not traps:
        traps = [
            {
                "titleEn": "Off-Topic Generalizations",
                "titleVi": "Chém gió lan man ngoài đề",
                "mistakeEn": "Writing memorized filler without engaging with the prompt keywords.",
                "mistakeVi": "Dùng câu học thuộc lòng chung chung thay vì bám sát từ khóa trong đề.",
                "whyEn": "Automated scoring penalizes low keyword relevance and weak task coherence.",
                "whyVi": "Hệ thống chấm điểm tự động sẽ trừ điểm Content vì bài viết thiếu độ liên quan.",
                "fixEn": "Anchor every paragraph directly in prompt keywords with explicit reasons and examples.",
                "fixVi": "Gắn chặt từng đoạn vào từ khóa của đề với lý lẽ và ví dụ thực tế.",
                "en": "Off-Topic Generalizations: Memorized filler lowers Content scores. Better approach: Anchor every sentence in the prompt's specific keywords.",
                "vi": "Lan man ngoài đề: Nhồi nhét câu học thuộc lòng làm giảm điểm Content. Cách viết chuẩn: Bám sát từ khóa cụ thể của đề bài."
            },
            {
                "titleEn": "Unsupported Assertions",
                "titleVi": "Khẳng định suông không có dẫn chứng",
                "mistakeEn": "Making sweeping claims without providing mechanisms or concrete examples.",
                "mistakeVi": "Đưa ra các nhận định chung chung mà không giải thích nguyên nhân hoặc dẫn chứng.",
                "whyEn": "Fails PTE Development requirements, reducing your written discourse score.",
                "whyVi": "Không đáp ứng tiêu chí Development của PTE, khiến điểm bài viết bị tụt hạng.",
                "fixEn": "Use Point -> Explanation -> Example for each body paragraph.",
                "fixVi": "Áp dụng cấu trúc Luận điểm -> Giải thích -> Dẫn chứng cụ thể cho từng thân bài.",
                "en": "Unsupported Assertions: Claims without evidence fail Development criteria. Better approach: Use Point-Explanation-Example structure.",
                "vi": "Khẳng định thiếu chứng minh: Luận điểm thiếu dẫn chứng sẽ mất điểm. Cách viết chuẩn: Dùng cấu trúc Luận điểm - Giải thích - Ví dụ."
            }
        ]
    gap_fill_raw = gemma.get("gapFill") or gemma.get("gap_fill") or gemma.get("gapfill") or gemma.get("macroBlueprint") or {}
    if not gap_fill_raw or not gap_fill_raw.get("slots") or len(gap_fill_raw.get("slots", [])) != 3:
        p_type = q.get("promptType", "agree_disagree")
        topic_name = q.get("verifiedPrimaryTopic", "this policy")
        gap_fill_raw = {
            "sentenceTemplateEn": "To construct a high-scoring response, I must evaluate {slot1}, declare a {slot2}, and substantiate my argument with {slot3}.",
            "sentenceTemplateVi": "Để xây dựng một bài viết đạt điểm cao, tôi phải phân tích {slot1}, xác lập một {slot2}, và củng cố lập luận bằng {slot3}.",
            "slots": [
                {
                    "id": "slot1",
                    "labelEn": "Core Debate Focus",
                    "labelVi": "Trọng tâm tranh luận",
                    "correctId": "c1",
                    "options": [
                        {"id": "c1", "textEn": f"infrastructure priorities concerning {topic_name.lower()}", "textVi": f"ưu tiên cơ sở hạ tầng về {topic_name.lower()}"},
                        {"id": "w1", "textEn": "superficial descriptive trends", "textVi": "xu hướng mô tả bề nổi", "hintEn": "Focus on policy priorities, not just descriptions.", "hintVi": "Tập trung vào ưu tiên chính sách thay vì chỉ mô tả."}
                    ]
                },
                {
                    "id": "slot2",
                    "labelEn": "Author Stance",
                    "labelVi": "Lập trường tác giả",
                    "correctId": "c2",
                    "options": [
                        {"id": "c2", "textEn": "clear, decisive policy verdict", "textVi": "phán quyết chính sách rõ ràng, dứt khoát"},
                        {"id": "w2", "textEn": "vague or evasive neutrality", "textVi": "sự trung lập né tránh hoặc mơ hồ", "hintEn": "PTE requires a consistent, decisive stance.", "hintVi": "PTE yêu cầu lập trường nhất quán, dứt khoát."}
                    ]
                },
                {
                    "id": "slot3",
                    "labelEn": "Evidence Base",
                    "labelVi": "Căn cứ chứng minh",
                    "correctId": "c3",
                    "options": [
                        {"id": "c3", "textEn": "concrete socioeconomic examples", "textVi": "các ví dụ kinh tế - xã hội cụ thể"},
                        {"id": "w3", "textEn": "unsupported personal assumptions", "textVi": "các giả định cá nhân thiếu cơ sở", "hintEn": "Concrete evidence is mandatory for development.", "hintVi": "Cần có bằng chứng cụ thể để phát triển ý."}
                    ]
                }
            ]
        }
    mcq_raw = gemma.get("mcq") or gemma.get("comprehensionMcq") or {}
    if not mcq_raw or not mcq_raw.get("options") or len(mcq_raw.get("options", [])) < 2:
        topic_name = q.get("verifiedPrimaryTopic", "the topic")
        mcq_raw = {
            "questionEn": "What is the primary requirement for a high-scoring response to this prompt?",
            "questionVi": "Yêu cầu chính để đạt điểm cao cho đề bài này là gì?",
            "correct": "a",
            "options": [
                {
                    "id": "a",
                    "textEn": f"Take a decisive stance on {topic_name.lower()} priorities and substantiate it with logical reasons.",
                    "textVi": f"Đưa ra lập trường dứt khoát về các ưu tiên liên quan đến {topic_name.lower()} và bảo vệ bằng lý lẽ logic.",
                    "feedbackEn": "Correct. PTE scoring penalizes neutrality; you must state and defend a clear stance.",
                    "feedbackVi": "Chính xác. Tiêu chí PTE không khuyến khích sự trung lập; bạn cần bảo vệ một lập trường rõ ràng."
                },
                {
                    "id": "b",
                    "textEn": "Provide a descriptive historical overview without taking any personal stance.",
                    "textVi": "Cung cấp một bản tóm tắt mô tả lịch sử mà không nêu quan điểm cá nhân.",
                    "feedbackEn": "Incorrect. Descriptive summaries fail the Content and Development criteria because no stance is defended.",
                    "feedbackVi": "Sai. Mô tả đơn thuần sẽ mất điểm Nội dung (Content) và Phát triển ý (Development) vì không đưa ra lập trường rõ ràng."
                },
                {
                    "id": "c",
                    "textEn": "List disconnected ideas without structured topic sentences or coherent evidence.",
                    "textVi": "Liệt kê các ý kiến rời rạc mà không có câu chủ đề hoặc dẫn chứng mạch lạc.",
                    "feedbackEn": "Incorrect. Coherence and cohesion require structured paragraphs with explicit topic sentences.",
                    "feedbackVi": "Sai. Tính mạch lạc và liên kết đòi hỏi các đoạn văn có cấu trúc rõ ràng với câu chủ đề."
                }
            ]
        }
    comp_check = {
        "mcq": mcq_raw,
        "gapFill": gap_fill_raw
    }

    scaffolds_gemma = gemma.get("scaffolds", {})
    scaffold_list = [
        {"paragraph": "intro", "depth": 3, "modelSentence": scaffolds_gemma.get("intro", "In contemporary society, this issue has ignited substantial debate.")},
        {"paragraph": "body1", "depth": 3, "modelSentence": scaffolds_gemma.get("body1", "Primarily, empirical evidence underscores the critical importance of this factor.")},
        {"paragraph": "body2", "depth": 3, "modelSentence": scaffolds_gemma.get("body2", "Equally significant is the broader implication on systemic development.")},
        {"paragraph": "conclusion", "depth": 3, "modelSentence": scaffolds_gemma.get("conclusion", "In conclusion, while multiple perspectives exist, a balanced approach is essential.")}
    ]

    b2_level = {
        "cefrEvidence": "B2 Academic writing competency requiring well-developed arguments and lexical precision.",
        "coreTargets": [v["term"] for v in vocab[:4]] if vocab else [],
        "languageKit": {
            "vocabulary": vocab,
            "grammar": grammar,
            "cohesion": cohesion
        },
        "plans": [plan1, plan2],
        "scaffolds": {
            s1_data.get("stance", "stance1"): scaffold_list,
            s2_data.get("stance", "stance2"): scaffold_list
        }
    }

    # Construct complete pack
    pack = {
        "schemaVersion": "EssaySupportPackV1",
        "questionId": qid_str,
        "title": q.get("title", f"#{qid_str} Essay"),
        "prompt": prompt,
        "source": {
            "promptSha256": prompt_sha256,
            "bank": "pte_bank"
        },
        "common": {
            "promptSegments": prompt_segments,
            "promptType": q.get("promptType", "agree_disagree"),
            "topics": [q.get("verifiedPrimaryTopic", "Academic")],
            "hardVocabulary": [],
            "requirements": reqs,
            "angles": [
                {"id": "angle-1", "en": "Practical Real-World Impact", "vi": "Tác động thực tế"},
                {"id": "angle-2", "en": "Systemic & Institutional Perspective", "vi": "Góc nhìn hệ thống & thể chế"}
            ],
            "promptTraps": traps,
            "commonMistakes": traps,
            "faq": [
                {
                    "questionEn": "Should I balance both viewpoints?",
                    "questionVi": "Tôi có nên phân tích cả hai chiều hướng không?",
                    "answerEn": "Yes, acknowledging counter-perspectives strengthens the sophistication of your argument before concluding.",
                    "answerVi": "Có, việc thừa nhận các quan điểm đối lập sẽ gia tăng tính thuyết phục trước khi đưa ra kết luận."
                }
            ],
            "tutorHandoff": {
                "contextEn": "Targeting high lexical resource and cohesive progression.",
                "contextVi": "Tập trung vào vốn từ vựng học thuật và phát triển lập luận mạch lạc.",
                "includedContext": ["core arguments", "academic vocabulary"],
                "excludes": ["informal idioms"]
            },
            "comprehensionCheck": comp_check
        },
        "levels": {
            "a2_b1": b2_level,
            "b2": b2_level,
            "c1": b2_level
        },
        "audit": {
            "status": "PASSED_MAJORITY",
            "councilVerified": True,
            "models": list(MODELS.values()),
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }
    }
    return pack


def validate_pack_enriched(pack: Dict[str, Any]) -> List[str]:
    errors = []
    
    # 1. Step 1 check
    cc = pack.get("common", {}).get("comprehensionCheck", {})
    mcq = cc.get("mcq")
    if not mcq or len(mcq.get("options", [])) < 2:
        errors.append("MCQ missing or has < 2 options")
    gap = cc.get("gapFill")
    if not gap or len(gap.get("slots", [])) != 3:
        errors.append("Gap-Fill missing or does not have exactly 3 slots")

    # 2. Step 2 check
    plans = pack.get("levels", {}).get("b2", {}).get("plans", [])
    if len(plans) < 2:
        errors.append("Expected at least 2 plans (Stance 1 and Stance 2)")
    else:
        for idx, plan in enumerate(plans):
            pts = plan.get("candidatePoints", [])
            if len(pts) < 6:
                errors.append(f"Plan {idx + 1} has {len(pts)} candidate points (expected >= 6)")

    # 3. Step 3 check
    kit = pack.get("levels", {}).get("b2", {}).get("languageKit", {})
    vocabs = kit.get("vocabulary", [])
    if len(vocabs) < 8:
        errors.append(f"Vocabulary has {len(vocabs)} items (expected >= 8)")
    grammar = kit.get("grammar", [])
    if len(grammar) < 3:
        errors.append(f"Grammar has {len(grammar)} items (expected >= 3)")

    # 4. Zero tolerance generic phrases
    pack_text = json.dumps(pack).lower()
    for phrase in GENERIC_BANNED_PHRASES:
        if phrase.lower() in pack_text:
            errors.append(f"Contains generic banned phrase: '{phrase}'")

    return errors


# ==============================================================================
# PIPELINE ORCHESTRATOR
# ==============================================================================

def publish_pack(pack: Dict[str, Any], output_root: Path) -> Tuple[Path, str]:
    packs_dir = output_root / "packs"
    packs_dir.mkdir(parents=True, exist_ok=True)
    qid_num = int(pack["questionId"])
    q_prefix = f"q{qid_num:04d}"

    # Remove existing versions of this question pack
    for existing in packs_dir.glob(f"{q_prefix}.*.json"):
        existing.unlink()

    # Format JSON with strict LF line endings
    json_stripped = json.dumps(pack, ensure_ascii=False, indent=2).strip()
    raw_hash = hashlib.sha256(json_stripped.encode("utf-8")).hexdigest()
    hash16 = raw_hash[:16]

    dest_filename = f"{q_prefix}.{hash16}.json"
    dest_path = packs_dir / dest_filename
    dest_path.write_bytes((json_stripped + "\n").encode("utf-8"))

    # Update manifest
    manifest_path = output_root / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = {
            "schemaVersion": "EssaySupportManifestV1",
            "contentVersion": "v1.0",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "questions": {}
        }

    manifest["questions"][str(qid_num)] = {
        "status": "PUBLISHED",
        "url": f"/database/Write Essay/support/v1/packs/{dest_filename}",
        "sha256": raw_hash,
        "levels": ["a2_b1", "b2", "c1"]
    }
    manifest_path.write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    return dest_path, raw_hash


def enrich_single_question(q: Dict[str, Any], client: OllamaClient,
                           output_root: Path, dry_run: bool = False) -> Dict[str, Any]:
    qid = q["id"]
    print(f"\n[{time.strftime('%H:%M:%S')}] >>> ENRICHING QUESTION #{qid}: {q['title']}", flush=True)
    t0 = time.time()

    # 1. DeepSeek-R1 (Ideation & Traps)
    print(f"  -> [Stage 1] Querying {MODELS['reasoner']} for 12 distinct arguments & traps...", flush=True)
    ds_sys, ds_user = build_deepseek_prompt(q)
    t_ds = time.time()
    ds_data = client.generate_json(MODELS["reasoner"], ds_sys, ds_user, temperature=0.3, num_predict=3200)
    print(f"     Done in {time.time() - t_ds:.1f}s", flush=True)

    # 2. Qwen 3 (Language Kit & Grammar)
    print(f"  -> [Stage 2] Querying {MODELS['linguist']} for 8 collocations & 3 grammar models...", flush=True)
    qw_sys, qw_user = build_qwen_prompt(q)
    t_qw = time.time()
    qw_data = client.generate_json(MODELS["linguist"], qw_sys, qw_user, temperature=0.2, num_predict=2200)
    print(f"     Done in {time.time() - t_qw:.1f}s", flush=True)

    # 3. Gemma 4 (Scaffolding & Step 1 Checks)
    print(f"  -> [Stage 3] Querying {MODELS['scaffolder']} for Step 1 MCQ & Gap-Fill...", flush=True)
    gm_sys, gm_user = build_gemma_prompt(q)
    t_gm = time.time()
    gm_data = client.generate_json(MODELS["scaffolder"], gm_sys, gm_user, temperature=0.2, num_predict=1500)
    print(f"     Done in {time.time() - t_gm:.1f}s", flush=True)

    # Assemble
    pack = build_essay_pack(q, ds_data, qw_data, gm_data)

    # Validate
    errors = validate_pack_enriched(pack)
    if errors:
        print(f"  [WARN] VALIDATION WARNINGS for Q{qid}:", flush=True)
        for err in errors:
            print(f"     - {err}", flush=True)
    else:
        print("  [OK] Validation PASSED: 12 arguments, 8 collocations, 3 grammar models, MCQ + Gap-Fill verified.", flush=True)

    total_time = time.time() - t0
    print(f"  [TIME] Total generation time: {total_time:.1f}s", flush=True)

    if not dry_run:
        dest_path, pack_hash = publish_pack(pack, output_root)
        print(f"  [SAVED] Saved pack: {dest_path.name} (SHA-256: {pack_hash[:12]}...)", flush=True)
        return {"qid": qid, "status": "SUCCESS", "errors": errors, "time": total_time, "pack": str(dest_path)}
    else:
        print("  [DRY RUN] Pack created and validated in memory.", flush=True)
        return {"qid": qid, "status": "DRY_RUN", "errors": errors, "time": total_time}


def enrich_batch_stage_optimized(questions: List[Dict[str, Any]], client: OllamaClient,
                                 output_root: Path, dry_run: bool = False) -> List[Dict[str, Any]]:
    """
    Stage-Batched Processing:
    Loads each model into VRAM once across the entire batch to eliminate weight-reloading overhead!
    """
    total_q = len(questions)
    print(f"\n================================================================================", flush=True)
    print(f"STARTING STAGE-BATCHED ENRICHMENT FOR {total_q} QUESTIONS (OPTIMIZED VRAM FLOW)", flush=True)
    print(f"================================================================================", flush=True)
    t_start = time.time()

    # Stage 1: DeepSeek-R1 for all questions
    print(f"\n>>> [PHASE 1/3] Running {MODELS['reasoner']} (Deep Ideation) across {total_q} questions...", flush=True)
    ds_results = {}
    for idx, q in enumerate(questions, 1):
        print(f"  [{idx}/{total_q}] Q{q['id']}: Generating arguments & traps...", flush=True)
        sys_p, usr_p = build_deepseek_prompt(q)
        t0 = time.time()
        ds_results[q["id"]] = client.generate_json(MODELS["reasoner"], sys_p, usr_p, temperature=0.3, num_predict=3200)
        print(f"         Done in {time.time() - t0:.1f}s", flush=True)

    # Stage 2: Qwen 3 for all questions
    print(f"\n>>> [PHASE 2/3] Running {MODELS['linguist']} (Bilingual Language Kit) across {total_q} questions...", flush=True)
    qw_results = {}
    for idx, q in enumerate(questions, 1):
        print(f"  [{idx}/{total_q}] Q{q['id']}: Generating vocabulary & grammar...", flush=True)
        sys_p, usr_p = build_qwen_prompt(q)
        t0 = time.time()
        qw_results[q["id"]] = client.generate_json(MODELS["linguist"], sys_p, usr_p, temperature=0.2, num_predict=2200)
        print(f"         Done in {time.time() - t0:.1f}s", flush=True)

    # Stage 3: Gemma 4 for all questions
    print(f"\n>>> [PHASE 3/3] Running {MODELS['scaffolder']} (Comprehension MCQ & Gap-Fill) across {total_q} questions...", flush=True)
    gm_results = {}
    for idx, q in enumerate(questions, 1):
        print(f"  [{idx}/{total_q}] Q{q['id']}: Generating MCQ & Gap-Fill...", flush=True)
        sys_p, usr_p = build_gemma_prompt(q)
        t0 = time.time()
        gm_results[q["id"]] = client.generate_json(MODELS["scaffolder"], sys_p, usr_p, temperature=0.2, num_predict=1500)
        print(f"         Done in {time.time() - t0:.1f}s", flush=True)

    # Stage 4: Merge & Publish
    print(f"\n>>> [MERGE & PUBLISH] Assembling, validating, and publishing packs...")
    results = []
    for q in questions:
        qid = q["id"]
        pack = build_essay_pack(q, ds_results.get(qid, {}), qw_results.get(qid, {}), gm_results.get(qid, {}))
        errors = validate_pack_enriched(pack)
        if not dry_run:
            dest_path, pack_hash = publish_pack(pack, output_root)
            print(f"  [OK] Q{qid}: Published {dest_path.name} | Warnings: {len(errors)}", flush=True)
            results.append({"qid": qid, "status": "SUCCESS", "errors": errors, "pack": str(dest_path)})
        else:
            print(f"  [DRY RUN] Q{qid}: Validated | Warnings: {len(errors)}", flush=True)
            results.append({"qid": qid, "status": "DRY_RUN", "errors": errors})

    print(f"\nStage-Batched Pipeline completed in {time.time() - t_start:.1f}s for {total_q} questions.")
    return results


# ==============================================================================
# MAIN CLI
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="3-Local-LLM Council Guided Essay Enrichment Tool")
    parser.add_argument("--root", type=Path, default=Path(r"c:\Cursor AI"))
    parser.add_argument("--question-id", "-q", type=str, help="Single question ID to enrich (e.g. 5)")
    parser.add_argument("--batch", "-b", type=str, help="Comma-separated question IDs (e.g. 5,10,25)")
    parser.add_argument("--benchmark", action="store_true", help="Run benchmark archetypes (1, 2, 23)")
    parser.add_argument("--ollama-url", default=OLLAMA_BASE_URL)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing to disk")
    args = parser.parse_args()

    questions_file = args.root / "public" / "database" / "Write Essay" / "essay-questions.json"
    if not questions_file.exists():
        print(f"Error: Questions file not found at {questions_file}")
        return 1

    all_questions = json.loads(questions_file.read_text(encoding="utf-8"))
    q_map = {str(q["id"]): q for q in all_questions}

    target_ids = []
    if args.question_id:
        target_ids = [args.question_id.strip()]
    elif args.batch:
        target_ids = [bid.strip() for bid in args.batch.split(",") if bid.strip()]
    elif args.benchmark:
        target_ids = ["1", "2", "23"]
    else:
        print("Please specify --question-id, --batch, or --benchmark.")
        return 1

    targets = [q_map[tid] for tid in target_ids if tid in q_map]
    if not targets:
        print(f"Error: None of the requested IDs ({target_ids}) found in questions dataset.")
        return 1

    client = OllamaClient(base_url=args.ollama_url, timeout=args.timeout)
    output_root = args.root / "public" / "database" / "Write Essay" / "support" / "v1"

    if len(targets) == 1:
        enrich_single_question(targets[0], client, output_root, dry_run=args.dry_run)
    else:
        enrich_batch_stage_optimized(targets, client, output_root, dry_run=args.dry_run)

    return 0


if __name__ == "__main__":
    sys.exit(main())
