from __future__ import annotations

import re
from typing import Any, Iterable

from .contracts import LEVELS, PACK_SCHEMA, sha256_text


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _unique(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        value = _clean(item)
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            output.append(value)
    return output


def _prompt_segments(prompt: str) -> list[dict[str, str]]:
    clauses = [part.strip() for part in re.split(r"(?<=[.!?])\s+|;\s+", prompt) if part.strip()]
    return [{"id": f"segment-{index + 1}", "text": clause, "role": "prompt_clause"}
            for index, clause in enumerate(clauses)] or [{"id": "segment-1", "text": prompt, "role": "prompt_clause"}]


def _requirements(prompt_type: str) -> list[dict[str, Any]]:
    values = {
        "agree_disagree": [
            ("answer", "State how far you agree or disagree.", "Nêu mức độ đồng ý hoặc không đồng ý."),
            ("reasons", "Support your position with two clear reasons.", "Hỗ trợ quan điểm bằng hai lý do rõ ràng."),
            ("examples", "Use relevant examples when they strengthen an idea.", "Dùng ví dụ phù hợp khi chúng làm rõ ý."),
        ],
        "discuss_both_views": [
            ("both_views", "Explain both views fairly.", "Giải thích công bằng cả hai quan điểm."),
            ("position", "Give your own position clearly.", "Nêu rõ quan điểm của bạn."),
            ("support", "Support the discussion with reasons and examples.", "Hỗ trợ phần thảo luận bằng lý do và ví dụ."),
        ],
        "advantages_disadvantages": [
            ("comparison", "Discuss the important advantages and disadvantages.", "Thảo luận những ưu điểm và nhược điểm quan trọng."),
            ("judgement", "Make the required overall judgement.", "Đưa ra nhận định tổng thể theo yêu cầu."),
            ("support", "Support the comparison with relevant examples.", "Hỗ trợ phần so sánh bằng ví dụ phù hợp."),
        ],
        "problems_solutions": [
            ("problems", "Identify the main problems or causes.", "Xác định các vấn đề hoặc nguyên nhân chính."),
            ("solutions", "Propose practical solutions.", "Đề xuất các giải pháp thực tế."),
            ("support", "Explain why the solutions could work.", "Giải thích vì sao các giải pháp có thể hiệu quả."),
        ],
        "choose_between": [
            ("options", "Compare the available options.", "So sánh các lựa chọn được nêu."),
            ("choice", "Choose one option and state why.", "Chọn một phương án và nêu lý do."),
            ("support", "Support the choice with specific reasons.", "Hỗ trợ lựa chọn bằng các lý do cụ thể."),
        ],
        "responsibility": [
            ("actors", "Identify the people or institutions involved.", "Xác định những cá nhân hoặc tổ chức liên quan."),
            ("responsibility", "Explain who should carry the main responsibility.", "Giải thích ai nên chịu trách nhiệm chính."),
            ("support", "Support the judgement with reasons and examples.", "Hỗ trợ nhận định bằng lý do và ví dụ."),
        ],
        "other": [
            ("task", "Answer every direct question in the prompt.", "Trả lời mọi câu hỏi trực tiếp trong đề."),
            ("position", "State a clear and consistent position when an opinion is requested.", "Nêu quan điểm rõ ràng và nhất quán khi đề yêu cầu ý kiến."),
            ("support", "Develop each main idea with explanation and an example.", "Phát triển mỗi ý chính bằng giải thích và ví dụ."),
        ],
    }
    return [{"id": key, "required": True, "en": en, "vi": vi} for key, en, vi in values.get(prompt_type, values["other"])]


def clean_claim_text(text: str) -> str:
    raw = str(text or "").strip()
    cleaned = re.sub(
        r"^(The essay argues that|The essay uses the concept of|The essay uses two main points:?|The essay uses|The body paragraphs detail|The writer believes that|The author suggests that|The response asserts that)\s*",
        "",
        raw,
        flags=re.IGNORECASE
    )
    cleaned = re.sub(r"^(\d+\)\s*|Point \d+:\s*)", "", cleaned)
    match = re.search(r"to support the (?:idea|view|claim|argument) that\s+(.+)$", cleaned, flags=re.IGNORECASE)
    if match:
        cleaned = match.group(1).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned or raw


def _thesis_frame(stance: str, topic: str) -> str:
    s = str(stance or "").lower()
    if "agree" in s and "disagree" not in s:
        return f"In my view, I strongly agree with this perspective because {topic or 'this issue'} ____."
    elif "disagree" in s:
        return f"In my view, I disagree with this assertion because {topic or 'this issue'} ____."
    elif "advantage" in s or "positive" in s:
        return f"In my view, the benefits of {topic or 'this trend'} far outweigh the drawbacks because ____."
    elif "disadvantage" in s or "negative" in s:
        return f"In my view, the negative consequences of {topic or 'this development'} are more concerning because ____."
    elif "both" in s or "discuss" in s:
        return f"While both viewpoints offer valid considerations, I contend that {topic or 'this issue'} ____."
    return f"In my view, {topic or 'this issue'} requires a nuanced approach because ____."


def _prompt_traps(prompt: str, prompt_type: str, topic: str) -> list[dict[str, str]]:
    traps = []
    p_lower = str(prompt or "").lower()
    if '"' in prompt or '“' in prompt or 'quote' in p_lower or 'said' in p_lower:
        traps.append({
            "en": "Do not write a biography of the quoted figure; focus strictly on analyzing and evaluating the core claim.",
            "vi": "Không viết về tiểu sử của nhân vật được trích dẫn; hãy tập trung phân tích và đánh giá đúng nhận định trong đề.",
        })
    if '?' in prompt and (prompt.count('?') > 1 or 'and' in prompt or 'also' in prompt):
        traps.append({
            "en": "Do not answer only the first question while neglecting the second requirement; address both dimensions equally.",
            "vi": "Không chỉ trả lời câu hỏi đầu tiên mà bỏ quên yêu cầu thứ hai; cần giải quyết cả hai khía cạnh công bằng.",
        })

    type_traps = {
        "agree_disagree": {
            "en": "Do not merely rephrase the topic without stating a definitive personal position in both intro and conclusion.",
            "vi": "Không chỉ diễn đạt lại đề bài mà quên khẳng định rõ lập trường cá nhân ở cả mở bài và kết bài.",
        },
        "discuss_both_views": {
            "en": "Do not discuss only your preferred side; give equal analytical weight to both perspectives before concluding.",
            "vi": "Không chỉ phân tích phía bạn ủng hộ; hãy trình bày công bằng cả hai quan điểm trước khi đưa ra kết luận.",
        },
        "problems_solutions": {
            "en": "Do not list abstract solutions without directly linking each solution to a specific root cause mentioned.",
            "vi": "Không liệt kê giải pháp chung chung mà không gắn kết trực tiếp với từng nguyên nhân cụ thể đã nêu.",
        },
        "advantages_disadvantages": {
            "en": "Do not simply enumerate pros and cons without providing the required evaluation of which side outweighs.",
            "vi": "Không chỉ liệt kê ưu nhược điểm mà quên so sánh và đánh giá mặt nào chiếm ưu thế hơn.",
        },
    }
    match = type_traps.get(prompt_type, {
        "en": f"Do not write off-topic generalizations; ground every point in the specific context of {topic or 'the prompt'}.",
        "vi": f"Không viết chung chung ngoài đề; hãy gắn chặt từng luận điểm vào bối cảnh cụ thể của {topic or 'đề bài'}.",
    })
    traps.append(match)
    if len(traps) < 2:
        traps.append({
            "en": "Avoid memorized generic templates; ensure every body paragraph contains concrete reasoning and evidence.",
            "vi": "Tránh các câu rập khuôn học thuộc lòng; hãy đảm bảo mỗi thân bài đều có lập luận và dẫn chứng cụ thể.",
        })
    return traps[:3]


def _gloss(term: str, topic: str) -> tuple[str, str]:
    return (f"Key academic term used to analyze core concepts in {topic or 'this domain'}.",
            f"Thuật ngữ học thuật then chốt dùng để phân tích các khía cạnh của {topic or 'chủ đề này'}.")


def _collocation_gloss(collo: str, topic: str) -> tuple[str, str]:
    return (
        f"Natural academic collocation that enhances cohesion when discussing {topic or 'this subject'}.",
        f"Cụm kết hợp từ tự nhiên giúp tăng tính học thuật và mạch lạc khi viết về {topic or 'chủ đề này'}."
    )


def _sample_variants(question: dict[str, Any], level_id: str) -> list[dict[str, Any]]:
    level = (question.get("sampleResponses") or {}).get("levels", {}).get(level_id, {})
    variants = [v for v in level.get("variants", []) if isinstance(v, dict)]
    return variants or [{"id": "default", "label": "Guided plan", "stance": "unspecified"}]


def _sample_vocab(variant: dict[str, Any]) -> list[dict[str, str]]:
    analysis = variant.get("analysis") if isinstance(variant.get("analysis"), dict) else {}
    output = []
    for item in analysis.get("vocabulary", []) if isinstance(analysis.get("vocabulary"), list) else []:
        if not isinstance(item, dict) or not _clean(item.get("term")):
            continue
        output.append({
            "term": _clean(item.get("term")),
            "enGloss": _clean(item.get("enGloss")),
            "viGloss": _clean(item.get("viGloss")),
            "source": "approved_sample" if variant.get("qa", {}).get("status") == "approved" else "legacy_sample",
        })
    return output


def _grammar_for(prompt_type: str) -> list[dict[str, str]]:
    templates = {
        "agree_disagree": ("Although X, I believe Y because Z.", "Mặc dù X, tôi cho rằng Y vì Z.", "contrast and thesis"),
        "discuss_both_views": ("While some people argue X, others believe Y; I agree more with Z.", "Một số người cho rằng X, trong khi người khác tin Y; tôi nghiêng về Z.", "balanced discussion"),
        "advantages_disadvantages": ("Although X offers A, its main limitation is B.", "Mặc dù X có A, hạn chế chính là B.", "comparison"),
        "problems_solutions": ("One major problem is X, which can be addressed by Y.", "Một vấn đề lớn là X, có thể được giải quyết bằng Y.", "problem-solution link"),
        "choose_between": ("Compared with X, I prefer Y because Z.", "So với X, tôi thích Y hơn vì Z.", "comparison and choice"),
        "responsibility": ("Although several groups are involved, X should take the main responsibility for Y.", "Mặc dù có nhiều nhóm liên quan, X nên chịu trách nhiệm chính cho Y.", "responsibility judgement"),
    }
    en, vi, purpose = templates.get(prompt_type, ("This is important because X leads to Y.", "Điều này quan trọng vì X dẫn đến Y.", "cause and effect"))
    return [{"id": "sentence-pattern-1", "purpose": purpose, "en": en, "vi": vi}]


def _cohesion() -> list[dict[str, str]]:
    return [
        {"id": "cause-result", "term": "as a result", "en": "Use this to show a result.", "vi": "Dùng để nêu kết quả."},
        {"id": "contrast", "term": "however", "en": "Use a semicolon before and a comma after however when it joins clauses.", "vi": "Dùng dấu chấm phẩy trước và dấu phẩy sau however khi nối mệnh đề."},
    ]


def _sentence_purpose(paragraph: int, index: int) -> str:
    if paragraph == 0:
        return ("paraphrase the prompt", "state your position", "preview the main points")[min(index, 2)]
    if paragraph in (1, 2):
        return ("introduce the main point", "explain why it matters", "give a relevant example", "show the effect", "link back to the position")[min(index, 4)]
    return ("restate the position", "synthesise the main points")[min(index, 1)]


def _split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", _clean(text)) if part.strip()]


def _scaffolds(variant: dict[str, Any], level_id: str, topic: str, prompt: str = "") -> list[dict[str, Any]]:
    raw_essay = str(variant.get("essay") or "").strip()
    # Split paragraphs by double newline directly on raw_essay to preserve structure
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", raw_essay) if p.strip()]
    if len(paragraphs) < 4:
        lines = [p.strip() for p in raw_essay.split("\n") if len(p.strip()) > 35]
        if len(lines) >= 4:
            paragraphs = lines[:4]
        else:
            paragraphs = [
                f"The question of whether {topic or 'this issue'} exerts a positive influence on society has sparked significant debate.",
                f"To begin with, a primary consideration is that {topic or 'this issue'} provides direct practical benefits for development.",
                f"Furthermore, another crucial dimension is the broader social and institutional implications of {topic or 'this development'}.",
                f"In conclusion, having analyzed both theoretical principles and practical impacts, I reaffirm my stance on {topic or 'this subject'}.",
            ]
    output: list[dict[str, Any]] = []
    for paragraph_index in range(min(4, len(paragraphs))):
        sentences = _split_sentences(paragraphs[paragraph_index])
        expected = 3 if paragraph_index == 0 else 2 if paragraph_index == 3 else 4
        if not sentences:
            sentences = ["" for _ in range(expected)]
        num_sentences = min(max(len(sentences), expected), 5 if paragraph_index in (1, 2) else 3)
        for index in range(num_sentences):
            model_sentence = sentences[index] if index < len(sentences) else ""
            purpose = _sentence_purpose(paragraph_index, index)
            frame = {
                "paraphrase the prompt": "The issue of ____ has sparked considerable debate in contemporary society.",
                "state your position": "In my view, I ____ because ____.",
                "preview the main points": "This essay will examine ____ as well as ____.",
                "introduce the main point": "First and foremost, a major consideration is that ____.",
                "explain why it matters": "Specifically, this occurs because ____.",
                "give a relevant example": "For instance, real-world experience demonstrates that ____.",
                "show the effect": "Consequently, this leads to ____.",
                "link back to the position": "Therefore, this evidence confirms that ____.",
                "restate the position": "In conclusion, while some argue otherwise, I reaffirm that ____.",
                "synthesise the main points": "Looking forward, addressing both ____ and ____ will be vital.",
            }.get(purpose, "Furthermore, it is evident that ____.")
            output.append({
                "sentenceId": f"p{paragraph_index + 1}s{index + 1}",
                "paragraph": ["introduction", "body1", "body2", "conclusion"][paragraph_index],
                "index": index + 1,
                "purpose": purpose,
                "ideaCue": f"Connect this sentence to {topic or 'the prompt'}.",
                "frame": frame,
                "modelSentence": model_sentence,
                "level": level_id,
                "sampleVariantId": str(variant.get("id") or "default"),
                "sampleSourceStatus": "approved" if variant.get("qa", {}).get("status") == "approved" else "fallback_or_generated",
            })
    return output


def build_template_candidate(question: dict[str, Any], collocations: set[str]) -> dict[str, Any]:
    prompt = _clean(question.get("prompt"))
    if not prompt:
        raise ValueError(f"question {question.get('id')} has no prompt text")
    question_id = str(question.get("id") or "")
    topic = _clean(question.get("verifiedPrimaryTopic"))
    topics = _unique([question.get("verifiedPrimaryTopic"), question.get("verifiedSecondaryTopic1"), question.get("verifiedSecondaryTopic2")])
    prompt_type = _clean(question.get("promptType")) or "other"
    variants_by_level: dict[str, list[dict[str, Any]]] = {}
    common_angles: list[dict[str, Any]] = []
    for level_id in LEVELS:
        variants = _sample_variants(question, level_id)
        variants_by_level[level_id] = variants
        for variant in variants:
            analysis = variant.get("analysis") if isinstance(variant.get("analysis"), dict) else {}
            for key in ("point1", "point2"):
                raw_point = _clean(analysis.get(key))
                point = clean_claim_text(raw_point)
                if point:
                    common_angles.append({
                        "id": f"{variant.get('id', 'angle')}-{key}",
                        "label": key.replace("point", "Point "),
                        "en": point,
                        "vi": f"Góc nhìn: {point}",
                        "sourceVariantId": str(variant.get("id") or "default"),
                    })
    if not common_angles:
        common_angles = [{"id": "angle-1", "label": "Main angle", "en": f"Consider how {topic or 'the issue'} affects people and society.", "vi": f"Xem xét {topic or 'vấn đề này'} ảnh hưởng đến con người và xã hội.", "sourceVariantId": "default"}]
    deduped_angles = []
    seen_angles = set()
    for angle in common_angles:
        key = angle["en"].casefold()
        if key not in seen_angles:
            seen_angles.add(key)
            deduped_angles.append(angle)
    target_vocab = question.get("targetVocabulary") or {}
    levels: dict[str, Any] = {}
    for level_id, vocab_level in zip(LEVELS, ("B1", "B2", "C1")):
        variants = variants_by_level[level_id]
        chosen = next((v for v in variants if v.get("qa", {}).get("status") == "approved"), variants[0])
        vocabulary = _sample_vocab(chosen)
        if not vocabulary:
            for term in (target_vocab.get(vocab_level) or target_vocab.get("B2") or [])[:6]:
                en, vi = _gloss(_clean(term), topic)
                vocabulary.append({"term": _clean(term), "enGloss": en, "viGloss": vi, "source": "target_vocabulary"})
        vocabulary = vocabulary[:6]
        collocation_terms = [item for item in sorted(collocations) if any(token in item for token in _unique([topic, *[v["term"].lower() for v in vocabulary]]))]
        language_kit = {
            "vocabulary": vocabulary,
            "collocations": [{"term": term, "enGloss": _collocation_gloss(term, topic)[0], "viGloss": _collocation_gloss(term, topic)[1]} for term in collocation_terms[:4]],
            "grammar": _grammar_for(prompt_type),
            "cohesion": _cohesion(),
        }
        plans = []
        scaffolds: dict[str, list[dict[str, Any]]] = {}
        for variant in variants:
            variant_id = str(variant.get("id") or "default")
            analysis = variant.get("analysis") if isinstance(variant.get("analysis"), dict) else {}
            stance_val = _clean(variant.get("stance")) or "unspecified"
            point1_clean = clean_claim_text(analysis.get("point1")) or f"A primary consideration regarding {topic or 'this issue'} is its direct impact."
            point2_clean = clean_claim_text(analysis.get("point2")) or f"Another crucial dimension of {topic or 'this issue'} is its long-term social effect."
            plans.append({
                "variantId": variant_id,
                "label": _clean(variant.get("label")) or variant_id,
                "stance": stance_val,
                "thesisFrame": _thesis_frame(stance_val, topic),
                "point1": point1_clean,
                "point2": point2_clean,
                "sampleVariantId": variant_id,
                "sampleSourceStatus": "approved" if variant.get("qa", {}).get("status") == "approved" else "fallback_or_generated",
            })
            scaffolds[variant_id] = _scaffolds(variant, level_id, topic, prompt)
        levels[level_id] = {
            "cefrEvidence": f"{level_id} uses controlled sentence frames, {len(vocabulary)} core vocabulary items, and prompt-specific academic structures.",
            "coreTargets": [{"id": f"{level_id}-vocab-{i + 1}", "type": "vocabulary", "term": item["term"], "source": item["source"]} for i, item in enumerate(vocabulary[:4])] + [{"id": f"{level_id}-grammar-1", "type": "grammar", "term": language_kit["grammar"][0]["en"]}],
            "languageKit": language_kit,
            "plans": plans,
            "scaffolds": scaffolds,
            "recycling": {"maxPreviousTargets": 2, "instructionEn": "Reuse up to two relevant targets from the previous Guided question.", "instructionVi": "Tái sử dụng tối đa hai mục tiêu phù hợp từ câu Guided trước."},
        }
    return {
        "schemaVersion": PACK_SCHEMA,
        "questionId": question_id,
        "title": _clean(question.get("title")),
        "prompt": prompt,
        "source": {"promptSha256": sha256_text(prompt), "sourceIssues": question.get("sourceIssues") or []},
        "common": {
            "promptSegments": _prompt_segments(prompt),
            "promptType": prompt_type,
            "topics": topics,
            "hardVocabulary": [{"term": token, "enGloss": f"A key word in this prompt.", "viGloss": "Từ quan trọng trong đề."} for token in _unique(re.findall(r"[A-Za-z][A-Za-z'-]{6,}", prompt))[:8]],
            "requirements": _requirements(prompt_type),
            "angles": deduped_angles[:8],
            "promptTraps": _prompt_traps(prompt, prompt_type, topic),
            "faq": [
                {"questionEn": "What is this question asking?", "questionVi": "Đề này đang hỏi điều gì?", "answerEn": "Break the prompt into its direct requirements before choosing ideas.", "answerVi": "Hãy tách đề thành các yêu cầu trực tiếp trước khi chọn ý."},
                {"questionEn": "How many main ideas should I use?", "questionVi": "Tôi nên dùng bao nhiêu ý chính?", "answerEn": "Use two developed points with explanation and relevant examples.", "answerVi": "Dùng hai luận điểm được phát triển bằng giải thích và ví dụ phù hợp."},
                {"questionEn": "Can I use a personal example?", "questionVi": "Tôi có thể dùng ví dụ cá nhân không?", "answerEn": "Yes, if it directly supports the point and remains relevant to the prompt.", "answerVi": "Có, nếu ví dụ trực tiếp hỗ trợ luận điểm và vẫn liên quan đến đề."},
                {"questionEn": "What should I avoid?", "questionVi": "Tôi nên tránh điều gì?", "answerEn": "Avoid memorised general sentences and any idea that does not answer the task.", "answerVi": "Tránh câu chung học thuộc và mọi ý không trả lời đúng yêu cầu."},
            ],
            "tutorHandoff": {
                "contextEn": "I am working on Write Essay question {questionId}. Please help me review the prompt requirements, my selected direction, and my language targets.",
                "contextVi": "Tôi đang làm câu Write Essay {questionId}. Hãy giúp tôi kiểm tra yêu cầu đề, hướng triển khai và các mục tiêu ngôn ngữ đã chọn.",
                "includedContext": ["questionId", "prompt", "promptType", "selectedVariantId", "selectedTargetIds"],
                "excludes": ["rawAuditArtifacts", "modelVotes", "revealedSentenceText"],
            },
        },
        "levels": levels,
        "audit": {"status": "CANDIDATE", "components": {}, "humanReview": "not_required_by_policy"},
    }
