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


def _prompt_traps(prompt_type: str) -> list[dict[str, str]]:
    common = {
        "en": "Do not write a general essay about the topic without answering the exact task.",
        "vi": "Không viết bài chung chung về chủ đề mà không trả lời đúng yêu cầu của đề.",
    }
    by_type = {
        "agree_disagree": {"en": "Do not explain the statement without making your own position clear.", "vi": "Không chỉ giải thích nhận định mà quên nêu rõ quan điểm cá nhân."},
        "discuss_both_views": {"en": "Do not discuss only the side you prefer; explain both views before your position.", "vi": "Không chỉ thảo luận phía bạn thích; hãy giải thích cả hai phía trước khi nêu quan điểm."},
        "problems_solutions": {"en": "Do not list solutions without connecting them to the stated problems.", "vi": "Không liệt kê giải pháp mà không liên hệ với các vấn đề đã nêu."},
        "advantages_disadvantages": {"en": "Do not list advantages and disadvantages without making the required judgement.", "vi": "Không chỉ liệt kê ưu nhược điểm mà quên đưa ra nhận định bắt buộc."},
    }
    return [common, by_type.get(prompt_type, {"en": "Do not ignore a direct question in the prompt.", "vi": "Không bỏ qua câu hỏi trực tiếp trong đề."})]


def _gloss(term: str, topic: str) -> tuple[str, str]:
    return (f"A useful word for discussing {topic or 'this topic'}.",
            f"Từ hữu ích để thảo luận về {topic or 'chủ đề này'}.")


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


def _scaffolds(variant: dict[str, Any], level_id: str, topic: str) -> list[dict[str, Any]]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", _clean(variant.get("essay"))) if p.strip()]
    if len(paragraphs) < 4:
        paragraphs = [
            f"This prompt concerns {topic or 'an important issue'}.",
            f"One important point is that {topic or 'this issue'} affects people in practical ways.",
            f"A second point is that the wider effects of {topic or 'this issue'} should also be considered.",
            "For these reasons, the position above is the most convincing.",
        ]
    output: list[dict[str, Any]] = []
    for paragraph_index in range(4):
        sentences = _split_sentences(paragraphs[paragraph_index])
        expected = 3 if paragraph_index == 0 else 2 if paragraph_index == 3 else 5
        if not sentences:
            sentences = ["" for _ in range(expected)]
        for index in range(min(max(len(sentences), expected), 5 if paragraph_index in (1, 2) else 3)):
            model_sentence = sentences[index] if index < len(sentences) else ""
            purpose = _sentence_purpose(paragraph_index, index)
            frame = {
                "paraphrase the prompt": "The question of ____ has become increasingly important.",
                "state your position": "In my view, I ____ because ____.",
                "preview the main points": "This essay will discuss ____ and ____.",
                "introduce the main point": "One important reason is that ____.",
                "explain why it matters": "This is because ____.",
                "give a relevant example": "For example, ____.",
                "show the effect": "As a result, ____.",
                "link back to the position": "Therefore, this supports the view that ____.",
                "restate the position": "In conclusion, I believe that ____.",
                "synthesise the main points": "This is because ____ and ____.",
            }[purpose]
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
                point = _clean(analysis.get(key))
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
            "collocations": [{"term": term, "enGloss": f"A natural academic word combination for {topic or 'this topic'}.", "viGloss": f"Cụm từ học thuật tự nhiên về {topic or 'chủ đề này'}."} for term in collocation_terms[:4]],
            "grammar": _grammar_for(prompt_type),
            "cohesion": _cohesion(),
        }
        plans = []
        scaffolds: dict[str, list[dict[str, Any]]] = {}
        for variant in variants:
            variant_id = str(variant.get("id") or "default")
            analysis = variant.get("analysis") if isinstance(variant.get("analysis"), dict) else {}
            plans.append({
                "variantId": variant_id,
                "label": _clean(variant.get("label")) or variant_id,
                "stance": _clean(variant.get("stance")) or "unspecified",
                "thesisFrame": f"In my view, {topic or 'this issue'} should be considered from the perspective of {variant.get('stance') or 'the selected position'}.",
                "point1": _clean(analysis.get("point1")) or f"A practical effect of {topic or 'this issue'}.",
                "point2": _clean(analysis.get("point2")) or f"A wider effect of {topic or 'this issue'}.",
                "sampleVariantId": variant_id,
                "sampleSourceStatus": "approved" if variant.get("qa", {}).get("status") == "approved" else "fallback_or_generated",
            })
            scaffolds[variant_id] = _scaffolds(variant, level_id, topic)
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
            "promptTraps": _prompt_traps(prompt_type),
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
