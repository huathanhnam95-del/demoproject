from __future__ import annotations

import hashlib
import re
from typing import Any


PACK_SCHEMA = "EssaySupportPackV1"
MANIFEST_SCHEMA = "EssaySupportManifestV1"
LEVELS = ("a2_b1", "b2", "c1")
PUBLISHED_STATUSES = {"PUBLISHED"}
AUDIT_STATUSES = {
    "PASSED_UNCONTESTED",
    "PASSED_MAJORITY",
    "REVISED_WITH_UNANIMOUS_CONSENSUS",
    "QUARANTINED",
}


class SupportContractError(ValueError):
    """Raised when a support pack or audit artifact violates its contract."""


def sha256_text(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SupportContractError(message)


def _walk_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _walk_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_strings(child)


def _require_bilingual(item: Any, label: str, en_key: str = "en", vi_key: str = "vi") -> None:
    _require(isinstance(item, dict), f"{label} must be an object")
    _require(bool(str(item.get(en_key) or "").strip()), f"{label}.{en_key} is required")
    _require(bool(str(item.get(vi_key) or "").strip()), f"{label}.{vi_key} is required")


def validate_pack(pack: dict[str, Any], collocation_allowlist: set[str] | None = None) -> dict[str, Any]:
    _require(isinstance(pack, dict), "support pack must be an object")
    _require(pack.get("schemaVersion") == PACK_SCHEMA, "unsupported support pack schema")
    question_id = str(pack.get("questionId") or "").strip()
    _require(question_id.isdigit() and int(question_id) > 0, "questionId must be a positive string integer")
    prompt = str(pack.get("prompt") or "").strip()
    _require(bool(prompt), "prompt is required")
    source = pack.get("source")
    _require(isinstance(source, dict) and len(str(source.get("promptSha256") or "")) == 64,
             "source.promptSha256 is required")
    _require(source.get("promptSha256") == sha256_text(prompt), "source.promptSha256 does not match prompt")
    common = pack.get("common")
    _require(isinstance(common, dict), "common support content is required")
    for field in ("promptSegments", "requirements", "angles", "promptTraps", "faq"):
        _require(isinstance(common.get(field), list), f"common.{field} must be a list")
    for index, item in enumerate(common["requirements"]):
        _require_bilingual(item, f"common.requirements[{index}]")
    for index, item in enumerate(common["promptTraps"]):
        _require_bilingual(item, f"common.promptTraps[{index}]")
    for index, item in enumerate(common["faq"]):
        _require_bilingual(item, f"common.faq[{index}]", "questionEn", "questionVi")
        _require_bilingual(item, f"common.faq[{index}] answer", "answerEn", "answerVi")
    if common.get("tutorHandoff") is not None:
        _require_bilingual(common["tutorHandoff"], "common.tutorHandoff", "contextEn", "contextVi")
        _require(isinstance(common["tutorHandoff"].get("includedContext"), list), "common.tutorHandoff.includedContext is required")
        _require(isinstance(common["tutorHandoff"].get("excludes"), list), "common.tutorHandoff.excludes is required")
    prompt_lower = prompt.casefold()
    for index, item in enumerate(common.get("hardVocabulary") or []):
        term = str((item or {}).get("term") or "").strip()
        _require(term and term.casefold() in prompt_lower, f"common.hardVocabulary[{index}] must occur in prompt")
    levels = pack.get("levels")
    _require(isinstance(levels, dict) and set(levels) == set(LEVELS), "all three support levels are required")
    for level_id in LEVELS:
        level = levels[level_id]
        _require(isinstance(level, dict), f"levels.{level_id} must be an object")
        _require(bool(str(level.get("cefrEvidence") or "").strip()), f"levels.{level_id}.cefrEvidence is required")
        _require(isinstance(level.get("coreTargets"), list), f"levels.{level_id}.coreTargets must be a list")
        _require(len(level["coreTargets"]) <= 6, f"levels.{level_id}.coreTargets exceeds six targets")
        kit = level.get("languageKit")
        _require(isinstance(kit, dict), f"levels.{level_id}.languageKit is required")
        for field in ("vocabulary", "grammar", "cohesion"):
            _require(isinstance(kit.get(field), list), f"levels.{level_id}.languageKit.{field} must be a list")
        for index, item in enumerate(kit["vocabulary"]):
            _require_bilingual(item, f"levels.{level_id}.languageKit.vocabulary[{index}]", "enGloss", "viGloss")
        for index, item in enumerate(kit.get("collocations") or []):
            _require_bilingual(item, f"levels.{level_id}.languageKit.collocations[{index}]", "enGloss", "viGloss")
            if collocation_allowlist is not None:
                _require(str(item.get("term") or "") in collocation_allowlist,
                         f"unsupported official collocation: {item.get('term')}")
        for index, item in enumerate(kit["grammar"]):
            _require_bilingual(item, f"levels.{level_id}.languageKit.grammar[{index}]")
        for index, item in enumerate(kit["cohesion"]):
            _require_bilingual(item, f"levels.{level_id}.languageKit.cohesion[{index}]")
        _require(isinstance(level.get("plans"), list), f"levels.{level_id}.plans must be a list")
        _require(isinstance(level.get("scaffolds"), dict), f"levels.{level_id}.scaffolds must be an object")
    audit = pack.get("audit")
    _require(isinstance(audit, dict), "audit is required")
    _require(audit.get("status") in AUDIT_STATUSES, "invalid pack audit status")
    _require(audit.get("status") != "QUARANTINED", "quarantined packs cannot be published")
    _require(not any(re.search(r"<\/?[a-z][^>]*>", value, flags=re.IGNORECASE) for value in _walk_strings(pack)),
             "support pack contains unsafe HTML")
    return pack


def validate_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    _require(isinstance(manifest, dict), "support manifest must be an object")
    _require(manifest.get("schemaVersion") == MANIFEST_SCHEMA, "unsupported support manifest schema")
    _require(bool(str(manifest.get("contentVersion") or "").strip()), "manifest contentVersion is required")
    questions = manifest.get("questions")
    _require(isinstance(questions, dict), "manifest.questions must be an object")
    for question_id, entry in questions.items():
        _require(str(question_id).isdigit(), "manifest question IDs must be numeric")
        _require(isinstance(entry, dict), f"manifest entry {question_id} must be an object")
        _require(entry.get("status") in PUBLISHED_STATUSES, f"manifest entry {question_id} is not published")
        _require(str(entry.get("url") or "").startswith("/database/Write Essay/support/"),
                 f"manifest entry {question_id} has an invalid URL")
        _require(len(str(entry.get("sha256") or "")) == 64, f"manifest entry {question_id} has no pack hash")
        _require(entry.get("levels") == list(LEVELS), f"manifest entry {question_id} lacks all levels")
    return manifest
