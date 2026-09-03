from __future__ import annotations

import copy
import json
import logging
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .audit import MODEL_KEYS, aggregate_audit_records, apply_component_decision, component_dependencies
from .contracts import LEVELS, validate_manifest, validate_pack, sha256_text
from .generator import build_template_candidate
from .sources import load_question_sources

logger = logging.getLogger("write_essay_support.pipeline")


MODELS = {
    "dr": "deepseek-r1:14b",
    "qw": "qwen3:14b",
    "gm": "gemma4:12b",
}
COMPONENTS = ("promptBreakdown", "angles", "languageKit", "plans", "scaffolds", "faq", "eltAudit")


def _normalize_verdict(value: Any) -> str:
    """Normalize equivalent audit labels emitted by local models."""
    label = str(value or "").strip().upper().replace("-", "_")
    if label in {"PASS", "PASSED", "APPROVED", "ACCEPT", "ACCEPTED", "VALID", "SUCCESS", "YES"}:
        return "PASS"
    return "FAIL"


def _audit_summary(candidate: dict[str, Any]) -> dict[str, Any]:
    common = candidate.get("common") or {}
    levels = candidate.get("levels") or {}
    summary = {
        "questionId": candidate.get("questionId"),
        "promptBreakdown": {
            "requirements": common.get("requirements", [])[:2],
            "traps": [t.get("en") if isinstance(t, dict) else t for t in common.get("promptTraps", [])[:2]],
        },
        "angles": common.get("angles", [])[:2],
        "languageKit": {
            lvl: {
                "vocabulary": [v.get("term") if isinstance(v, dict) else v for v in (levels.get(lvl, {}).get("languageKit") or {}).get("vocabulary", [])[:3]],
                "collocations": [c.get("term") if isinstance(c, dict) else c for c in (levels.get(lvl, {}).get("languageKit") or {}).get("collocations", [])[:3]],
            }
            for lvl in ("a2_b1", "b2", "c1") if lvl in levels
        },
        "plans": {
            lvl: [(p.get("focus") if isinstance(p, dict) else p) for p in levels.get(lvl, {}).get("plans", [])[:1]]
            for lvl in ("a2_b1", "b2", "c1") if lvl in levels
        },
        "scaffolds": {
            lvl: [
                (sc_list[0].get("modelSentence") if isinstance(sc_list[0], dict) else sc_list[0])
                for sc_list in levels.get(lvl, {}).get("scaffolds", {}).values()
                if sc_list
            ][:1]
            for lvl in ("a2_b1", "b2", "c1") if lvl in levels
        },
        "faq": [f.get("questionEn") if isinstance(f, dict) else f for f in common.get("faq", [])[:2]],
        "eltAudit": (common.get("tutorHandoff", {}).get("contextEn", "") or "")[:150],
    }
    return summary


class OllamaClient:
    def __init__(self, base_url: str = "http://127.0.0.1:11434", timeout_s: int = 300):
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s

    def generate_json(self, model: str, stage: str, payload: dict[str, Any]) -> dict[str, Any]:
        system = (
            "You are one stage of a strict PTE Write Essay support-content pipeline. "
            "Use only the supplied source facts. Do not invent statistics, citations, or prompt requirements. "
            "Return one valid JSON object and no markdown."
        )
        if stage == "audit":
            summary = _audit_summary(payload.get("candidate", {}))
            prompt = (
                f"You are an expert ELT auditor for PTE Academic essay learning materials.\n"
                f"Prompt: {payload.get('question')}\n\n"
                f"Evaluate these 7 components for the prompt:\n"
                f"1. promptBreakdown: {json.dumps(summary.get('promptBreakdown'), ensure_ascii=False)}\n"
                f"2. angles: {json.dumps(summary.get('angles'), ensure_ascii=False)}\n"
                f"3. languageKit: {json.dumps(summary.get('languageKit'), ensure_ascii=False)}\n"
                f"4. plans: {json.dumps(summary.get('plans'), ensure_ascii=False)}\n"
                f"5. scaffolds: {json.dumps(summary.get('scaffolds'), ensure_ascii=False)}\n"
                f"6. faq: {json.dumps(summary.get('faq'), ensure_ascii=False)}\n"
                f"7. eltAudit: {json.dumps(summary.get('eltAudit'), ensure_ascii=False)}\n\n"
                f"Criteria: {payload.get('rule', 'PASS only when the component is accurate, bilingual where required, level-appropriate, source-grounded, and safe for learners.')}\n\n"
                f"Output STRICTLY JSON with key 'components':\n"
                f'{{\n'
                f'  "components": {{\n'
                f'    "promptBreakdown": {{"verdict": "PASS", "reason": "Accurate explanation"}},\n'
                f'    "angles": {{"verdict": "PASS", "reason": "Defensible perspectives"}},\n'
                f'    "languageKit": {{"verdict": "PASS", "reason": "Appropriate vocabulary and collocations"}},\n'
                f'    "plans": {{"verdict": "PASS", "reason": "Structured outlines"}},\n'
                f'    "scaffolds": {{"verdict": "PASS", "reason": "Helpful sentence templates"}},\n'
                f'    "faq": {{"verdict": "PASS", "reason": "Clear answers"}},\n'
                f'    "eltAudit": {{"verdict": "PASS", "reason": "Pedagogically valid"}}\n'
                f'  }}\n'
                f'}}\n'
            )
        elif stage == "deepseek_plan":
            prompt = (
                f"Generate a structured essay plan for PTE Write Essay.\n"
                f"Prompt: {payload.get('prompt')}\n"
                f"Task Type: {payload.get('promptType')}\n"
                f"Target Vocabulary: {json.dumps(payload.get('targetVocabulary', {}), ensure_ascii=False)}\n\n"
                f"Return JSON with key 'plan':\n"
                f'{{\n'
                f'  "plan": {{\n'
                f'    "focus": "concise description of essay approach",\n'
                f'    "outline": ["introduction", "body1", "body2", "conclusion"],\n'
                f'    "keyArguments": ["argument 1", "argument 2"]\n'
                f'  }}\n'
                f'}}\n'
            )
        elif stage == "qwen_material":
            prompt = (
                f"Generate bilingual vocabulary and collocations for PTE Write Essay.\n"
                f"Prompt: {payload.get('prompt')}\n"
                f"Task Type: {payload.get('promptType')}\n\n"
                f"Return JSON with key 'material':\n"
                f'{{\n'
                f'  "material": {{\n'
                f'    "common": {{"requirements": [], "promptTraps": []}}\n'
                f'  }}\n'
                f'}}\n'
            )
        elif stage == "gemma_review":
            prompt = (
                f"Review this PTE Write Essay candidate support pack.\n"
                f"Prompt: {payload.get('prompt')}\n\n"
                f"Return JSON with key 'review':\n"
                f'{{\n'
                f'  "review": {{\n'
                f'    "qualityAssessment": "good",\n'
                f'    "strengths": ["Clear progression"],\n'
                f'    "suggestions": []\n'
                f'  }}\n'
                f'}}\n'
            )
        elif stage == "debate":
            prompt = (
                f"Propose a source-grounded revision for quarantined components.\n"
                f"Prompt: {payload.get('question')}\n"
                f"Failed Components: {json.dumps(payload.get('failedComponents', []))}\n\n"
                f"Return JSON with key 'revision' and 'reasoning':\n"
                f'{{\n'
                f'  "revision": {{\n'
                f'    "common": {{}},\n'
                f'    "levels": {{}}\n'
                f'  }},\n'
                f'  "reasoning": "Reason for revision"\n'
                f'}}\n'
            )
        else:
            prompt = json.dumps({"stage": stage, "payload": payload}, ensure_ascii=False)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        body = json.dumps({
            "model": model,
            "messages": messages,
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.1,
                "num_ctx": 8192,
                "num_predict": 2048,
            },
        }).encode("utf-8")
        import time
        last_exc = None
        for attempt in range(3):
            request = urllib.request.Request(
                f"{self.base_url}/api/chat",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                    raw_response = json.loads(response.read().decode("utf-8"))
                message = raw_response.get("message", {}) if isinstance(raw_response, dict) else {}
                raw = message.get("content") or raw_response.get("response") or raw_response
                return parse_json_object(raw)
            except Exception as exc:
                last_exc = exc
                logger.warning("Ollama %s %s attempt %s failed: %s", model, stage, attempt + 1, exc)
                if attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
        raise RuntimeError(f"Ollama {model} {stage} failed: {last_exc}") from last_exc


def parse_json_object(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = str(raw or "").strip()
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    if "<think>" in text and "</think>" not in text:
        text = re.sub(r"<think>.*", "", text, flags=re.DOTALL).strip() or text
    if "```" in text:
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"\s*```$", "", text, flags=re.IGNORECASE).strip()
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    brace_match = re.search(r"(\{.*\})", text, re.DOTALL)
    if brace_match:
        try:
            val = json.loads(brace_match.group(1))
            if isinstance(val, dict):
                return val
        except Exception:
            pass
    raise ValueError(f"model output did not contain a JSON object. Snippet: {text[:150]!r}")


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    output = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(output.get(key), dict):
            output[key] = _deep_merge(output[key], value)
        elif value not in (None, "", [], {}):
            output[key] = copy.deepcopy(value)
    return output


def _stage_payload(question: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "questionId": question["id"],
        "prompt": question["prompt"],
        "promptType": question["promptType"],
        "topics": [question.get("verifiedPrimaryTopic"), question.get("verifiedSecondaryTopic1"), question.get("verifiedSecondaryTopic2")],
        "targetVocabulary": question.get("targetVocabulary") or {},
        "approvedSampleVariantIds": {
            level_id: level_data.get("_supportApprovedVariantIds", [])
            for level_id, level_data in (question.get("sampleResponses") or {}).get("levels", {}).items()
        },
        "candidate": candidate,
    }


def _apply_stage_output(candidate: dict[str, Any], stage: str, response: dict[str, Any]) -> dict[str, Any]:
    output = copy.deepcopy(candidate)
    if stage == "deepseek_plan" and isinstance(response.get("plan"), dict):
        output["common"]["modelPlan"] = response["plan"]
    elif stage == "qwen_material":
        material = response.get("material") if isinstance(response.get("material"), dict) else response
        if isinstance(material, dict):
            output["common"]["modelMaterial"] = material
    elif stage == "gemma_review":
        review = response.get("review") if isinstance(response.get("review"), dict) else response
        if isinstance(review, dict):
            output["common"]["modelReview"] = review
    return output


class AuditEngine:
    def __init__(self, client: Any):
        self.client = client

    def _audit_round(self, candidate: dict[str, Any], question: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
        votes: dict[str, dict[str, Any]] = {component: {} for component in COMPONENTS}
        raw: dict[str, Any] = {}
        for model_key in MODEL_KEYS:
            model = MODELS[model_key]
            response = self.client.generate_json(model, "audit", {
                "question": question["prompt"],
                "candidate": candidate,
                "components": COMPONENTS,
                "rule": "PASS only when the component is accurate, bilingual where required, level-appropriate, source-grounded, and safe for learners.",
            })
            raw[model_key] = response
            component_responses = response.get("components") if isinstance(response.get("components"), dict) else response
            for component in COMPONENTS:
                detail = component_responses.get(component) if isinstance(component_responses.get(component), dict) else {}
                if isinstance(detail, str):
                    verdict_val = detail
                    reason_val = ""
                    issues_val = []
                elif isinstance(detail, dict):
                    verdict_val = detail.get("verdict") or detail.get("status") or detail.get("decision")
                    reason_val = str(detail.get("reason") or detail.get("notes") or detail.get("analysis") or detail.get("description") or "").strip()
                    issues_val = detail.get("issues") if isinstance(detail.get("issues"), list) else []
                else:
                    verdict_val = "FAIL"
                    reason_val = ""
                    issues_val = []
                votes[component][model_key] = {
                    "verdict": _normalize_verdict(verdict_val),
                    "reason": reason_val,
                    "issues": issues_val,
                }
        return votes, raw

    def audit(self, question: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
        initial_votes, initial_raw = self._audit_round(candidate, question)
        components: dict[str, dict[str, Any]] = {}
        needs_debate = []
        for component in COMPONENTS:
            decision = apply_component_decision(
                {model_key: initial_votes[component][model_key]["verdict"] for model_key in MODEL_KEYS},
                revised=False,
            )
            components[component] = {
                **decision,
                "initialDetails": initial_votes[component],
                "rawArtifacts": {model_key: initial_raw[model_key] for model_key in MODEL_KEYS},
                "debateHistory": [],
            }
            if decision["status"] == "DEBATE_REQUIRED":
                needs_debate.append(component)
        audited_candidate = copy.deepcopy(candidate)
        if needs_debate:
            debate_raw: dict[str, Any] = {}
            revisions: list[dict[str, Any]] = []
            for model_key in MODEL_KEYS:
                response = self.client.generate_json(MODELS[model_key], "debate", {
                    "question": question["prompt"],
                    "candidate": audited_candidate,
                    "failedComponents": needs_debate,
                    "votes": {component: components[component]["initialDetails"] for component in needs_debate},
                    "instruction": "Propose one source-grounded revision. Do not claim consensus; return a revision object and the reasoning.",
                })
                debate_raw[model_key] = response
                if isinstance(response.get("revision"), dict):
                    revisions.append(response["revision"])
            if revisions:
                test_candidate = _deep_merge(audited_candidate, revisions[0])
                try:
                    validate_pack(test_candidate)
                    audited_candidate = test_candidate
                except Exception as val_exc:
                    logger.warning("Debate revision failed schema validation; retaining intact candidate: %s", val_exc)
            final_votes, final_raw = self._audit_round(audited_candidate, question)
            invalidated = set(needs_debate)
            pending = list(needs_debate)
            while pending:
                upstream = pending.pop()
                for dependent in COMPONENTS:
                    if dependent in component_dependencies(upstream) and dependent not in invalidated:
                        invalidated.add(dependent)
                        pending.append(dependent)
            for component in COMPONENTS:
                if component not in invalidated:
                    continue
                components[component]["debateHistory"].append({"proposals": debate_raw, "revision": revisions[0] if revisions else {}})
                final_decision = apply_component_decision(
                    {model_key: final_votes[component][model_key]["verdict"] for model_key in MODEL_KEYS},
                    revised=component in needs_debate or component in invalidated,
                )
                components[component].update({
                    **final_decision,
                    "finalDetails": final_votes[component],
                    "finalRawArtifacts": {model_key: final_raw[model_key] for model_key in MODEL_KEYS},
                    "dependencyInvalidated": component not in needs_debate,
                    "invalidatedBy": [source for source in needs_debate if component in component_dependencies(source)],
                })
        statuses = [detail["status"] for detail in components.values()]
        if any(status in {"QUARANTINED", "DEBATE_REQUIRED"} for status in statuses):
            overall = "QUARANTINED"
        elif any(status == "PASSED_MAJORITY" for status in statuses):
            overall = "PASSED_MAJORITY"
        else:
            overall = "PASSED_UNCONTESTED"
        return {"candidate": audited_candidate, "status": overall, "components": components}


def _template_audit() -> dict[str, Any]:
    components = {}
    for component in COMPONENTS:
        components[component] = {
            "status": "PASSED_UNCONTESTED",
            "votes": {key: "PASS" for key in MODEL_KEYS},
            "passCount": 3,
            "initialDetails": {},
            "rawArtifacts": {},
            "debateHistory": [],
        }
    return {"status": "PASSED_UNCONTESTED", "components": components, "auditMethod": "template_only_test_mode"}


def build_manifest(records: Iterable[dict[str, Any]]) -> dict[str, Any]:
    questions: dict[str, Any] = {}
    for record in records:
        if record.get("status") != "PUBLISHED":
            continue
        question_id = str(record["questionId"])
        questions[question_id] = {
            "url": record["url"],
            "sha256": record["sha256"],
            "levels": list(LEVELS),
            "status": "PUBLISHED",
        }
    manifest = {
        "schemaVersion": "EssaySupportManifestV1",
        "contentVersion": "v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "questions": dict(sorted(questions.items(), key=lambda item: int(item[0]))),
    }
    return validate_manifest(manifest)


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_records(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {str(item.get("questionId")): item for item in value if isinstance(item, dict) and item.get("questionId")}


def run_batch(
    root: Path,
    output_root: Path,
    *,
    question_ids: list[str] | None = None,
    template_only: bool = False,
    client: Any | None = None,
    resume: bool = False,
    quarantine_only: bool = False,
) -> dict[str, Any]:
    source = load_question_sources(root)
    existing = _read_records(output_root / "audit-records.json")
    if quarantine_only:
        selected = question_ids or sorted(
            [question_id for question_id, record in existing.items() if record.get("status") == "QUARANTINED"],
            key=lambda value: int(value),
        )
    else:
        selected = question_ids or sorted(source.questions, key=lambda value: int(value))
    if resume:
        selected = [question_id for question_id in selected if existing.get(str(question_id), {}).get("status") != "PUBLISHED"]
    output_root.mkdir(parents=True, exist_ok=True)
    packs_dir = output_root / "packs"
    packs_dir.mkdir(parents=True, exist_ok=True)
    if not template_only and client is None:
        client = OllamaClient()
    records_by_id = dict(existing)
    for question_id in selected:
        question = source.questions.get(str(question_id))
        if not question:
            records_by_id[str(question_id)] = {"questionId": str(question_id), "status": "SOURCE_INVALID", "reason": "unknown_question_id", "components": {}}
            continue
        if question.get("sourceIssues"):
            records_by_id[str(question_id)] = {"questionId": str(question_id), "status": "SOURCE_INVALID", "reason": question["sourceIssues"], "components": {}}
            continue
        try:
            candidate = build_template_candidate(question, source.collocations)
            model_stages = {}
            if template_only:
                audit = _template_audit()
            else:
                for model_key, stage in (("dr", "deepseek_plan"), ("qw", "qwen_material"), ("gm", "gemma_review")):
                    response = client.generate_json(MODELS[model_key], stage, _stage_payload(question, candidate))
                    model_stages[stage] = {"model": MODELS[model_key], "response": response}
                    candidate = _apply_stage_output(candidate, stage, response)
                audit = AuditEngine(client).audit(question, candidate)
                candidate = audit["candidate"]
            candidate["provenance"] = {
                "modelStages": model_stages,
                "sourceIssues": question.get("sourceIssues") or [],
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
            candidate["audit"] = {"status": audit["status"], "components": audit["components"], "auditMethod": audit.get("auditMethod", "three_model_independent_audit")}
            record = {"questionId": str(question_id), "status": "QUARANTINED" if audit["status"] == "QUARANTINED" else "CANDIDATE", "components": audit["components"]}
            if audit["status"] != "QUARANTINED":
                candidate["audit"]["status"] = audit["status"]
                validate_pack(candidate, source.collocations)
                serialized = json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))
                digest = sha256_text(serialized)
                filename = f"q{int(question_id):04d}.{digest[:16]}.json"
                pack_path = packs_dir / filename
                pack_path.write_text(serialized + "\n", encoding="utf-8")
                record.update({"status": "PUBLISHED", "url": f"/database/Write Essay/support/v1/packs/{filename}", "sha256": digest})
            old = existing.get(str(question_id))
            if old and (resume or quarantine_only):
                record["previousAuditRecord"] = old
                record["rerun"] = True
            records_by_id[str(question_id)] = record
        except Exception as exc:  # preserve a resumable record for the exact question
            record = {"questionId": str(question_id), "status": "GENERATION_ERROR", "reason": str(exc), "components": {}}
            old = existing.get(str(question_id))
            if old and (resume or quarantine_only):
                record["previousAuditRecord"] = old
                record["rerun"] = True
            records_by_id[str(question_id)] = record
    records = sorted(records_by_id.values(), key=lambda item: int(str(item["questionId"])))
    _write_json(output_root / "audit-records.json", records)
    manifest = build_manifest(records)
    _write_json(output_root / "manifest.json", manifest)
    aggregate = aggregate_audit_records(records)
    report = {
        **aggregate,
        "sourceHashes": source.source_hashes,
        "generationMode": "template_only_dry_run" if template_only else "ollama_three_model_audit",
        "publishedCount": sum(record.get("status") == "PUBLISHED" for record in records),
        "questionsProcessed": len(records),
        "sourceInvalidIds": sorted([record["questionId"] for record in records if record.get("status") == "SOURCE_INVALID"], key=lambda value: int(value)),
        "quarantinedIds": sorted([record["questionId"] for record in records if record.get("status") == "QUARANTINED"], key=lambda value: int(value)),
        "generationErrorIds": sorted([record["questionId"] for record in records if record.get("status") == "GENERATION_ERROR"], key=lambda value: int(value)),
    }
    targeted_rerun = bool((resume or quarantine_only) and existing)
    if targeted_rerun:
        rerun_dir = output_root / "reports"
        rerun_dir.mkdir(parents=True, exist_ok=True)
        rerun_path = rerun_dir / f"rerun-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
        _write_json(rerun_path, {**report, "reportKind": "targeted_rerun", "fullReportPath": "../report.json"})
        report["targetedReportPath"] = str(rerun_path.relative_to(output_root)).replace("\\", "/")
    else:
        _write_json(output_root / "report.json", report)
    return report
