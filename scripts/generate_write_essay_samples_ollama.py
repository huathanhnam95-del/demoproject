import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


OLLAMA_BASE_URL_DEFAULT = "http://localhost:11434"
OLLAMA_GENERATE_PATH = "/api/generate"
OLLAMA_VERSION_PATH = "/api/version"
MODEL_DEFAULT = "gemma4:latest"

ESSAY_JSON_PATH_DEFAULT = "public/database/Write Essay/essay-questions-with-vocab.json"
OXFORD_5000_CSV_DEFAULT = "The_Oxford_5000.csv"
RUBRIC_PATH_DEFAULT = "public/database/knowledge-base/Write Essay Score Guide.txt"
ACADEMIC_RULES_PATH_DEFAULT = "public/database/knowledge-base/Write Essay Academic Writing Rules.md"

STAGING_DIR_DEFAULT = "tmp/write-essay-samples"


PILOT_PROMPT_IDS_DEFAULT = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 18, 22, 23, 53, 66,
]


PILOT_VARIANTS: Dict[int, Dict[str, Any]] = {
    1: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the view that school education can sometimes stop real learning"},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the view that school education interferes with learning"},
        ],
    },
    2: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the view that a healthy diet is more effective for keeping fit than exercise"},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the view that a healthy diet is more effective for keeping fit than exercise"},
        ],
    },
    3: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the view that a healthy diet is more important for keeping fit than exercise"},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the view that a healthy diet is more important for keeping fit than exercise"},
        ],
    },
    4: {
        "promptType": "discuss_both_views",
        "variants": [
            {"id": "negative", "label": "Version 1: NEGATIVE VIEW", "stance": "agree",
             "stanceStatement": "the view that advertisements make people buy things they do not need or cannot afford"},
            {"id": "positive", "label": "Version 2: POSITIVE VIEW", "stance": "agree",
             "stanceStatement": "the view that advertisements help people by giving useful information and improving their quality of life",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that advertisements help people by giving useful information and improving daily life",
             }},
        ],
    },
    5: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the idea that cities should improve public transport rather than build more roads"},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the idea that cities should improve public transport rather than build more roads"},
        ],
    },
    6: {
        "promptType": "choose_between",
        "variants": [
            {"id": "education", "label": "Version 1: EDUCATION", "stance": "agree",
             "stanceStatement": "the view that education should receive more financial support than health"},
            {"id": "health", "label": "Version 2: HEALTH", "stance": "agree",
             "stanceStatement": "the view that health should receive more financial support than education"},
        ],
    },
    7: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the view that university students should pay the full cost of their education"},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the view that university students should pay the full cost of their education"},
        ],
    },
    8: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the view that every city should have at least one large public open space"},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the view that every city should have at least one large public open space"},
        ],
    },
    9: {
        "promptType": "responsibility",
        "variants": [
            {"id": "government", "label": "Version 1: GOVERNMENT", "stance": "agree",
             "stanceStatement": "the view that governments have the main responsibility to take action on climate change"},
            {"id": "companies", "label": "Version 2: COMPANIES", "stance": "agree",
             "stanceStatement": "the view that large companies have the main responsibility to take action on climate change"},
            {"id": "individuals", "label": "Version 3: INDIVIDUALS", "stance": "agree",
             "stanceStatement": "the view that individuals have the main responsibility to take action on climate change"},
        ],
    },
    10: {
        "promptType": "advantages_disadvantages",
        "variants": [
            {"id": "positive", "label": "Version 1: MORE POSITIVE", "stance": "agree",
             "stanceStatement": "the view that changes in communication have more positive impacts than negative impacts"},
            {"id": "negative", "label": "Version 2: MORE NEGATIVE", "stance": "agree",
             "stanceStatement": "the view that changes in communication have more negative impacts than positive impacts"},
        ],
    },
    11: {
        "promptType": "problems_solutions",
        "variants": [
            {"id": "solutions", "label": "Version 1: SOLUTIONS", "stance": "agree",
             "stanceStatement": "the view that culture shock can be reduced through language support and community programs",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that people can feel less stress in a new culture with language help and local support",
             }},
        ],
    },
    12: {
        "promptType": "choose_between",
        "variants": [
            {"id": "long_hours", "label": "Version 1: LONG HOURS", "stance": "agree",
             "stanceStatement": "the view that working long hours to achieve success is the better lifestyle",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that working long hours to be successful is the better lifestyle",
             }},
            {"id": "free_time", "label": "Version 2: FREE TIME", "stance": "agree",
             "stanceStatement": "the view that having more free time for enjoyment is the better lifestyle",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that having more free time to enjoy life is the better lifestyle",
             }},
        ],
    },
    13: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the view that the industrial revolution was the main factor behind problems in developed nations",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that big changes in factories and machines in the past were the main reason for problems in rich countries",
             }},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the view that the industrial revolution was the main factor behind problems in developed nations",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that big changes in factories and machines in the past were the main reason for problems in rich countries",
             }},
        ],
    },
    14: {
        "promptType": "choose_between",
        "variants": [
            {"id": "consumer", "label": "Version 1: CONSUMERS", "stance": "agree",
             "stanceStatement": "the view that consumers should avoid over-packaged products whenever possible",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that shoppers should avoid buying items with too much packaging whenever possible",
             }},
            {"id": "manufacturer", "label": "Version 2: MANUFACTURERS", "stance": "agree",
             "stanceStatement": "the view that manufacturers should reduce extra packaging in their products",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that companies should reduce extra packaging on their products",
             }},
        ],
    },
    15: {
        "promptType": "advantages_disadvantages",
        "variants": [
            {"id": "positive", "label": "Version 1: POSITIVE", "stance": "agree",
             "stanceStatement": "the view that living close to the workplace has a positive impact",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that living close to your job is good for people",
             }},
            {"id": "negative", "label": "Version 2: NEGATIVE", "stance": "agree",
             "stanceStatement": "the view that living close to the workplace has a negative impact",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that living close to your job can be bad for people",
             }},
        ],
    },
    18: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the view that ordinary people suffer because of extreme ideologies",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that normal people suffer because of very strong beliefs",
             }},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the view that ordinary people suffer because of extreme ideologies",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that normal people suffer because of very strong beliefs",
             }},
        ],
    },
    22: {
        "promptType": "agree_disagree",
        "variants": [
            {"id": "agree", "label": "Version 1: AGREE", "stance": "agree",
             "stanceStatement": "the view that inventions have improved people's lives overall",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that inventions have made people's lives better in many ways",
             }},
            {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree",
             "stanceStatement": "the view that inventions have improved people's lives overall",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that inventions have made people's lives better in many ways",
             }},
        ],
    },
    23: {
        "promptType": "advantages_disadvantages",
        "variants": [
            {"id": "positive", "label": "Version 1: MORE BENEFITS", "stance": "agree",
             "stanceStatement": "the view that extreme sports bring more benefits than drawbacks",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that dangerous sports bring more benefits than problems",
             }},
            {"id": "negative", "label": "Version 2: MORE DRAWBACKS", "stance": "agree",
             "stanceStatement": "the view that extreme sports bring more drawbacks than benefits",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that dangerous sports bring more problems than benefits",
             }},
        ],
    },
    53: {
        "promptType": "discuss_both_views",
        "variants": [
            {"id": "lazier", "label": "Version 1: LAZIER", "stance": "agree",
             "stanceStatement": "the view that the digital age has made us lazier"},
            {"id": "knowledgeable", "label": "Version 2: MORE KNOWLEDGEABLE", "stance": "agree",
             "stanceStatement": "the view that the digital age has made us more knowledgeable"},
        ],
    },
    66: {
        "promptType": "choose_between",
        "variants": [
            {"id": "discussion", "label": "Version 1: DISCUSSION", "stance": "agree",
             "stanceStatement": "the view that discussion with teachers and peers is the most reliable source of academic information",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that talking with teachers and classmates is the best source of study information",
             }},
            {"id": "books", "label": "Version 2: PRINTED BOOKS", "stance": "agree",
             "stanceStatement": "the view that printed books and articles are the most reliable source of academic information",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that printed books and articles are the best source of study information",
             }},
            {"id": "online", "label": "Version 3: ONLINE", "stance": "agree",
             "stanceStatement": "the view that online sources are the most reliable source of academic information",
             "stanceStatementByLevel": {
                 "a2_b1": "the view that online sources are the best source of study information",
             }},
        ],
    },
}


@dataclass
class QaIssue:
    code: str
    message: str
    severity: str  # "hard" or "soft"


LEVEL_SPECS: Dict[str, Dict[str, Any]] = {
    "a2_b1": {
        "label": "A2-B1",
        "allowedVocabKeys": ("A2", "B1"),
        "forbiddenVocabKeys": ("B2", "C1", "C2"),
    },
    "b2": {
        "label": "B2",
        "allowedVocabKeys": ("A2", "B1", "B2"),
        "forbiddenVocabKeys": ("C1", "C2"),
    },
    "c1": {
        "label": "C1",
        "allowedVocabKeys": ("A2", "B1", "B2", "C1"),
        "forbiddenVocabKeys": ("C2",),
    },
}


def resolve_stance_statement(variant: Dict[str, Any], *, level_id: str) -> str:
    by_level = variant.get("stanceStatementByLevel")
    if isinstance(by_level, dict):
        v = by_level.get(level_id)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return str(variant.get("stanceStatement") or "").strip()


def _http_get_json(url: str, timeout_s: float) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw)


def _http_post_json(url: str, payload: Dict[str, Any], timeout_s: float) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw)


def check_ollama_health(base_url: str, timeout_s: float) -> None:
    _http_get_json(base_url.rstrip("/") + OLLAMA_VERSION_PATH, timeout_s=timeout_s)


def extract_first_json_object(text: str) -> Dict[str, Any]:
    if not isinstance(text, str) or not text:
        raise ValueError("AI response did not contain text")

    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escape_next = False
        for i in range(start, len(text)):
            ch = text[i]
            if escape_next:
                escape_next = False
                continue
            if ch == "\\":
                escape_next = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start : i + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    raise ValueError("AI response did not contain valid JSON")


def normalize_newlines(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


def word_count_like_frontend(text: str) -> int:
    t = text.strip()
    if not t:
        return 0
    return len([w for w in re.split(r"\s+", t) if w])


def split_paragraphs(text: str) -> List[str]:
    t = normalize_newlines(text).strip()
    if not t:
        return []
    parts = re.split(r"\n{2,}", t)
    return [p.strip() for p in parts if p.strip()]


def split_sentences(text: str) -> List[str]:
    t = text.strip()
    if not t:
        return []
    parts = re.split(r"(?<=[.!?])\s+", t)
    return [p.strip() for p in parts if p.strip()]


def build_idea_flow(essay: str) -> Dict[str, str]:
    """
    Deterministic idea flow visualizations derived from the final essay text.
    Stored as plain text for safe HTML rendering and DOCX export.
    """

    def _pick(sents: List[str], idx: int, fallback: str = "") -> str:
        if isinstance(sents, list) and 0 <= idx < len(sents):
            v = str(sents[idx] or "").strip()
            if v:
                return v
        return str(fallback or "").strip()

    paras = split_paragraphs(str(essay or ""))
    if len(paras) != 4:
        return {"mindmap": "", "flowchart": ""}

    intro, body1, body2, concl = paras
    intro_s = split_sentences(intro)
    b1_s = split_sentences(body1)
    b2_s = split_sentences(body2)

    mind: List[str] = []
    mind.append("TOPIC")
    mind.append(f"- Paraphrase: {_pick(intro_s, 0, intro)}")
    mind.append(f"- Opinion: {_pick(intro_s, 1)}")
    mind.append(f"- Signpost: {_pick(intro_s, 2)}")
    mind.append("")
    mind.append("REASON ONE (BODY ONE)")
    mind.append(f"- Point: {_pick(b1_s, 0, body1)}")
    mind.append(f"- Explain: {_pick(b1_s, 1)}")
    mind.append(f"- Example: {_pick(b1_s, 2)}")
    mind.append(f"- Effect: {_pick(b1_s, 3)}")
    mind.append(f"- Link: {_pick(b1_s, 4)}")
    mind.append("")
    mind.append("REASON TWO (BODY TWO)")
    mind.append(f"- Point: {_pick(b2_s, 0, body2)}")
    mind.append(f"- Explain: {_pick(b2_s, 1)}")
    mind.append(f"- Example: {_pick(b2_s, 2)}")
    mind.append(f"- Effect: {_pick(b2_s, 3)}")
    mind.append(f"- Link: {_pick(b2_s, 4)}")
    mind.append("")
    mind.append("CONCLUSION")
    mind.append(f"- {str(concl).strip()}")

    flow: List[str] = []
    flow.append("[Topic] -> [Opinion] -> [Reason one] -> [Reason two] -> [Conclusion]")
    flow.append("")
    flow.append("Intro: Topic -> Opinion -> Signpost")
    flow.append(f"  Topic: {_pick(intro_s, 0, intro)}")
    flow.append(f"  Opinion: {_pick(intro_s, 1)}")
    flow.append(f"  Signpost: {_pick(intro_s, 2)}")
    flow.append("")
    flow.append("Body one: Point -> Explain -> Example -> Effect -> Link")
    flow.append(f"  Point: {_pick(b1_s, 0, body1)}")
    flow.append(f"  Explain: {_pick(b1_s, 1)}")
    flow.append(f"  Example: {_pick(b1_s, 2)}")
    flow.append(f"  Effect: {_pick(b1_s, 3)}")
    flow.append(f"  Link: {_pick(b1_s, 4)}")
    flow.append("")
    flow.append("Body two: Point -> Explain -> Example -> Effect -> Link")
    flow.append(f"  Point: {_pick(b2_s, 0, body2)}")
    flow.append(f"  Explain: {_pick(b2_s, 1)}")
    flow.append(f"  Example: {_pick(b2_s, 2)}")
    flow.append(f"  Effect: {_pick(b2_s, 3)}")
    flow.append(f"  Link: {_pick(b2_s, 4)}")
    flow.append("")
    flow.append(f"Conclusion: {str(concl).strip()}")

    return {"mindmap": "\n".join(mind).strip(), "flowchart": "\n".join(flow).strip()}


def tokenize_words(text: str) -> List[str]:
    t = text.lower()
    return re.findall(r"[a-z]+(?:'[a-z]+)?", t)


def derived_forms(tok: str) -> List[str]:
    t = str(tok or "").lower().strip()
    if not t:
        return []
    out = set()
    if t.endswith("ies") and len(t) > 4:
        out.add(t[:-3] + "y")
    if t.endswith("s") and len(t) > 3:
        out.add(t[:-1])
    if t.endswith("ed") and len(t) > 4:
        stem = t[:-2]
        out.add(stem)
        out.add(stem + "e")
    if t.endswith("ing") and len(t) > 5:
        stem = t[:-3]
        out.add(stem)
        out.add(stem + "e")
    return sorted(out)


def is_b2_plus_for_a2_b1(tok: str, oxford_levels: Dict[str, str]) -> bool:
    """
    A2-B1 lexical gate: treat some inflected forms as acceptable if their base
    form is A1/A2/B1 (Oxford list can place inflections at higher levels).
    """
    lvl = oxford_levels.get(tok)
    if lvl not in ("B2", "C1", "C2"):
        return False

    for base in derived_forms(tok):
        base_lvl = oxford_levels.get(base)
        if base_lvl in ("A1", "A2", "B1"):
            return False
    return True


def load_oxford_levels(path: Path) -> Dict[str, str]:
    levels: Dict[str, str] = {}
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            w = (row.get("word") or "").strip().lower()
            lvl = (row.get("level") or "").strip().upper()
            if not w or not lvl:
                continue
            prev = levels.get(w)
            if prev is None:
                levels[w] = lvl
            else:
                levels[w] = min(prev, lvl)
    return levels


def load_academic_rules(path: Path) -> str:
    try:
        return normalize_newlines(path.read_text(encoding="utf-8")).strip()
    except Exception:
        return ""


def collect_forbidden_phrases(
    target_vocab: Optional[Dict[str, Any]],
    *,
    forbidden_keys: Tuple[str, ...] = ("C1", "C2"),
) -> List[str]:
    if not isinstance(target_vocab, dict):
        return []
    forbidden: List[str] = []
    for key in forbidden_keys:
        items = target_vocab.get(key)
        if isinstance(items, list):
            forbidden.extend([str(x).strip() for x in items if str(x).strip()])
    return forbidden


def contains_forbidden_phrase(text: str, phrases: List[str]) -> List[str]:
    t = text.lower()
    hits = []
    for p in phrases:
        if p and p.lower() in t:
            hits.append(p)
    return hits


VOCAB_STOPWORDS = {
    "a", "an", "the", "and", "or", "but",
    "to", "of", "in", "on", "for", "with", "as", "at", "by",
    "is", "are", "was", "were", "be", "been", "being",
}


def term_matches_essay(term: str, essay_lower: str) -> bool:
    t = str(term or "").strip().lower()
    if not t:
        return False
    tokens = [x for x in re.findall(r"[a-z]+(?:'[a-z]+)?", t) if x not in VOCAB_STOPWORDS]
    if not tokens:
        return False
    for tok in tokens:
        if re.search(rf"\\b{re.escape(tok)}\\b", essay_lower):
            continue
        if tok.endswith("y") and len(tok) > 2:
            alt = tok[:-1] + "ies"
            if re.search(rf"\\b{re.escape(alt)}\\b", essay_lower):
                continue
        if re.search(rf"\\b[a-z]*{re.escape(tok)}[a-z]*\\b", essay_lower):
            continue
        return False
    return True


def looks_like_bullets(text: str) -> bool:
    t = normalize_newlines(text)
    lines = [ln.strip() for ln in t.split("\n") if ln.strip()]
    bullet_re = re.compile(r"^([*\-•]|\d+[.)])\s+")
    bulletish = sum(1 for ln in lines if bullet_re.match(ln))
    return bulletish >= 3


def has_html_injection_markers(text: str) -> bool:
    t = text.lower()
    markers = ["<script", "onerror=", "onload=", "javascript:", "<img", "<iframe"]
    return any(m in t for m in markers)


def is_all_caps(text: str) -> bool:
    letters = re.findall(r"[A-Za-z]", text)
    if len(letters) < 20:
        return False
    return all(ch.isupper() for ch in letters)


def issue_list_to_json(issues: List[QaIssue]) -> List[Dict[str, str]]:
    return [{"code": i.code, "message": i.message, "severity": i.severity} for i in issues]


def repair_prompt(
    original: Dict[str, Any],
    issues: List[QaIssue],
    *,
    level_id: str,
    academic_rules: str,
) -> str:
    level_id = str(level_id or "").strip() or "b2"
    level_label = str(LEVEL_SPECS.get(level_id, {}).get("label") or level_id).strip()
    level_note = {
        "a2_b1": "Lexical level: A2-B1. Avoid B2/C1/C2 vocabulary.",
        "b2": "Lexical level: B2. Avoid C2 vocabulary; keep C1 words very limited.",
        "c1": "Lexical level: C1. Avoid C2 vocabulary.",
    }.get(level_id, f"Lexical level: {level_label}.")

    extra_level_hints = {
        "a2_b1": (
            "Extra A2-B1 rules:\n"
            "- Keep sentence structure short and simple.\n"
            "- Do not use: however, therefore, thus, furthermore, moreover.\n"
            "- Do not start any body sentence with: First/Second/Third/Firstly/Secondly/Thirdly.\n"
            "- Use these PEEL starters (exact starters for sentence two to five):\n"
            "  - Body one: In other words, / For example, / As a result, / This shows that\n"
            "  - Body two: This is because / For example, / As a result, / This supports the view that\n"
            "- Avoid words such as: overall, stable, adjust, shock, workplace, freely, reputation, wrap, loose, textbook, deeply, greatly, prompt, gear.\n"
            "- If a lexical gate issue lists tokens, replace them with simpler words and remove them completely.\n\n"
        ),
        "b2": (
            "Extra B2 rules:\n"
            "- Avoid: furthermore, moreover, nevertheless, consequently.\n\n"
        ),
        "c1": (
            "Extra C1 rules:\n"
            "- Do not use however or therefore.\n\n"
        ),
    }.get(level_id, "")

    rules_block = academic_rules.strip()
    if rules_block:
        rules_block = "Academic writing rules (must follow):\n" + rules_block + "\n\n"

    # A2-B1 lexical gate often fails on a small set of common B2 tokens.
    lexical_hint = ""
    if level_id == "a2_b1":
        bad_tokens: List[str] = []
        for it in issues:
            if it.code != "lexical_gate":
                continue
            bad_tokens.extend(re.findall(r"'([^']+)'", str(it.message or "")))
        bad_tokens = sorted({t.strip().lower() for t in bad_tokens if str(t).strip()})
        if bad_tokens:
            replacements = {
                "adjust": "get used to",
                "shock": "stress",
                "industrial": "factory",
                "revolution": "big change",
                "workplace": "job",
                "stable": "safe",
                "freely": "without fear",
                "overall": "in the end",
                "reputation": "good name",
                "wrap": "cover",
                "loose": "not tight",
                "textbook": "school book",
                "deeply": "a lot",
                "greatly": "a lot",
                "prompt": "question",
                "gear": "equipment",
            }
            lines = ["Lexical gate help:\n"]
            lines.append(f"- Remove these tokens completely: {bad_tokens}\n")
            for t in bad_tokens:
                rep = replacements.get(t)
                if rep:
                    lines.append(f"- Replace {t} with: {rep}\n")
            lexical_hint = "\n" + "".join(lines) + "\n"

    return (
        "Fix the JSON output so it satisfies all HARD issues and as many SOFT issues as possible.\n"
        "Do not add or remove keys. Keep the same JSON shape.\n"
        "Return ONLY JSON.\n\n"
        f"{level_note}\n\n"
        f"{extra_level_hints}"
        f"{rules_block}"
        f"{lexical_hint}"
        "Hard constraints to keep while fixing:\n"
        "- Do not start a sentence with And/But/Or/So/Because.\n"
        "- Word count must be strictly 200-300.\n"
        "- Introduction has exactly 3 sentences.\n"
        "- Introduction sentence 3 must be exactly: \"This essay will provide two reasons supporting my idea.\".\n"
        "- Body 1 and Body 2 must each have EXACTLY 5 sentences (Point, Explain, Example, Effect, Link).\n"
        "- Do not add extra sentences to body paragraphs. If word count is low, add detail inside existing sentences.\n"
        "- Conclusion must be one or two sentences only.\n"
        "- Conclusion must start with \"In conclusion,\".\n"
        "- Do not use the digit 2 anywhere in the essay; use the word \"two\" instead.\n"
        "- Conclusion must clearly restate the opinion (use \"I strongly agree\" or \"I strongly disagree\").\n"
        "- Conclusion must briefly mention both body points (reuse one key word from each body paragraph topic sentence).\n"
        "- analysis.point1 and analysis.point2 must be non-empty strings.\n"
        "- analysis.vocabulary must contain 6-10 objects, each with: term, enGloss, viGloss.\n"
        "- All vocabulary terms must appear in the essay text (replace any term that is not in the essay).\n"
        "- If word count is outside 200-300, adjust body paragraphs to fit.\n"
        "- If word count is below 200, add more detail inside the existing PEEL sentences, but keep 5 sentences per body.\n\n"
        f"Issues:\n{json.dumps(issue_list_to_json(issues), ensure_ascii=False)}\n\n"
        f"Original JSON:\n{json.dumps(original, ensure_ascii=False)}\n"
    )


def build_system_prompt(*, level_id: str, academic_rules: str) -> str:
    level_id = str(level_id or "").strip() or "b2"
    level_label = str(LEVEL_SPECS.get(level_id, {}).get("label") or level_id).strip()

    level_style = {
        "a2_b1": (
            "Write model essays for A2-B1 learners.\n"
            "Use only A2/B1 vocabulary and simple collocations.\n"
            "Use short, clear sentences and simple connectors.\n"
            "Keep ideas simple and concrete.\n"
            "Keep each body paragraph focused on one clear point only.\n"
            "Avoid advanced linking words such as: furthermore, moreover, nevertheless, consequently.\n"
            "Avoid conjunctive adverbs like however and therefore at this level.\n"
            "Do not start sentences with First/Second/Third style enumerators.\n"
            "Avoid B2 words such as: gain, steady, overall, stable, adjust, shock, workplace, freely, reputation, wrap, loose, textbook, deeply, greatly, prompt, gear.\n"
        ),
        "b2": (
            "Write model essays for B2 learners.\n"
            "Use only B2-and-below vocabulary and collocations.\n"
            "Avoid C1/C2 vocabulary and advanced academic phrasing.\n"
            "Avoid advanced linking words such as: furthermore, moreover, nevertheless, consequently.\n"
        ),
        "c1": (
            "Write model essays for C1 learners.\n"
            "Use more precise vocabulary and some complex sentences.\n"
            "Avoid C2 vocabulary.\n"
            "Avoid however and therefore. Use other linking phrases instead.\n"
        ),
    }.get(level_id, f"Write model essays for level: {level_label}.\n")

    rules_block = academic_rules.strip()
    if rules_block:
        rules_block = "Academic writing rules (must follow):\n" + rules_block + "\n\n"

    return (
        "You are an expert PTE Academic writing teacher.\n"
        f"{level_style}"
        "Return ONLY valid JSON. No markdown. No extra keys.\n"
        "Do not write headings like 'Introduction:'.\n"
        "Do not start a sentence with And/But/Or/So/Because. Use \"This is because ...\" instead.\n"
        "Word count must be strictly 200-300. Target 230-260.\n"
        "Essay structure: Introduction (exactly 3 sentences), Body 1 (PEEL), Body 2 (PEEL), Conclusion.\n"
        "Body paragraphs must each have exactly 5 sentences: Point, Explain, Example, Effect, Link.\n"
        "Do not start body sentences with First/Second/Third/Firstly/Secondly/Thirdly.\n"
        "Conclusion must be one or two sentences only, and it must restate stance and paraphrase both body points.\n"
        "Introduction sentence 3 must be exactly: \"This essay will provide two reasons supporting my idea.\".\n"
        "Do not use the digit 2 anywhere in the essay; use the word \"two\" instead.\n"
        "In the conclusion, restate your opinion clearly and reuse key words from both body topic sentences.\n"
        "Return the essay as parts (no blank lines inside parts), and the app will assemble the 4 paragraphs.\n"
        "Also produce an Analysis block: point1, point2, and a vocabulary list.\n"
        "Vocabulary list: 6-10 terms that appear in the essay, each with enGloss and viGloss.\n"
        "Vietnamese glosses must be in Vietnamese with diacritics.\n"
        "Do not include personal data, names, phone numbers, or emails.\n\n"
        f"{rules_block}"
    )


def build_user_prompt(
    *,
    prompt_id: int,
    title: str,
    prompt_text: str,
    level_id: str,
    variant: Dict[str, Any],
    target_vocab: Optional[Dict[str, Any]],
    oxford_levels: Optional[Dict[str, str]] = None,
) -> str:
    stance = variant["stance"]
    stance_statement = variant["stanceStatement"]
    prompt_type = str(variant.get("promptType") or "").strip()

    level_id = str(level_id or "").strip() or "b2"
    level_spec = LEVEL_SPECS.get(level_id) or LEVEL_SPECS["b2"]
    level_label = str(level_spec.get("label") or level_id).strip()
    intro_sentence1_note = {
        "a2_b1": "simple A2-B1 English (short and clear)",
        "b2": "clear B2 English",
        "c1": "clear C1 English (still simple and direct)",
    }.get(level_id, "clear English")

    lexical_ban_line = ""
    if level_id == "a2_b1" and isinstance(oxford_levels, dict):
        banned = sorted({t for t in tokenize_words(prompt_text) if is_b2_plus_for_a2_b1(t, oxford_levels)})
        if banned:
            banned = banned[:12]
            lexical_ban_line = f"- Do not use these B2+ words from the prompt: {banned}. Paraphrase them with simpler words.\n"

    level_prompt_guidance = {
        "a2_b1": (
            "Level guidance:\n"
            "- Use simple, direct sentences and basic connectors.\n"
            "- Keep each body paragraph focused on one clear point only.\n"
            "- Do not use: however, therefore, thus, furthermore, moreover.\n"
            "- Do not start body sentences with: First/Second/Third/Firstly/Secondly/Thirdly.\n"
            "- Avoid B2 words such as: gain, steady, overall, stable, adjust, shock, workplace, freely, reputation, wrap, loose, textbook, deeply, greatly, prompt, gear.\n"
            "- Use \"For example,\" (not \"For instance,\").\n\n"
        ),
        "b2": (
            "Level guidance:\n"
            "- Keep vocabulary at B2 and below.\n"
            "- Avoid: furthermore, moreover, nevertheless, consequently.\n"
            "- Avoid however/therefore to prevent punctuation mistakes. Use \"This supports ...\" or \"As a result, ...\" instead.\n\n"
        ),
        "c1": (
            "Level guidance:\n"
            "- Use more precise vocabulary and some complex sentences.\n"
            "- Avoid C2 vocabulary.\n"
            "- Do not use however or therefore. Use other linking phrases instead.\n\n"
        ),
    }.get(level_id, "")

    allowed: List[str] = []
    forbidden: List[str] = []
    if isinstance(target_vocab, dict):
        for k in level_spec.get("allowedVocabKeys") or ("A2", "B1", "B2"):
            v = target_vocab.get(k)
            if isinstance(v, list):
                allowed.extend([str(x).strip() for x in v if str(x).strip()])
        forbidden = collect_forbidden_phrases(
            target_vocab,
            forbidden_keys=tuple(level_spec.get("forbiddenVocabKeys") or ("C1", "C2")),
        )

    allowed = allowed[:30]
    forbidden = forbidden[:25]

    schema = {
        "parts": {
            "introSentence1": "string (one sentence only)",
            "body1": "string (one paragraph, exactly five sentences)",
            "body2": "string (one paragraph, exactly five sentences)",
            "conclusion": "string (one paragraph, one or two sentences only)",
        },
        "analysis": {
            "point1": "string",
            "point2": "string",
            "vocabulary": [{"term": "string", "enGloss": "string", "viGloss": "string"}],
        },
    }

    chunks: List[str] = [
        f"Prompt ID: {prompt_id}\n",
        f"Title: {title}\n",
        f"Prompt:\n{prompt_text}\n\n",
        f"Target level: {level_label} ({level_id})\n",
        f"Prompt type: {prompt_type}\n",
        f"Variant: {variant['id']} ({variant['label']})\n\n",
        "Output format rules:\n",
        "- Return JSON with keys: parts, analysis.\n",
        "- Do not include blank lines inside any parts fields.\n\n",
        "Academic punctuation rules (hard):\n",
        "- Do not start a sentence with And/But/Or/So/Because.\n",
        "- Do not start a sentence with Because. Use \"This is because ...\" instead.\n",
        "- Use a comma before and/but/or/so when joining two independent clauses.\n",
        "- If however/therefore appear, use them only as: \"; however,\" / \"; therefore,\".\n\n",
        level_prompt_guidance + lexical_ban_line,
        "Introduction rules (these must be satisfied after assembly):\n",
        f"- parts.introSentence1 must be exactly ONE sentence that paraphrases the topic in {intro_sentence1_note}.\n",
    ]

    if prompt_type == "discuss_both_views":
        chunks.append("- For discuss_both_views: introSentence1 should mention that there are two different views.\n")

    chunks.extend(
        [
            f"- Intro sentence 2 will be fixed as: \"In my opinion, I strongly {stance} with {stance_statement}.\"\n",
            "- Intro sentence 3 will be fixed as: \"This essay will provide two reasons supporting my idea.\".\n\n",
            "Body rules:\n",
            "- parts.body1 and parts.body2 must follow PEEL and must each have exactly five sentences.\n",
            "- Do not use the digit 2 anywhere in the essay; use the word \"two\" instead.\n",
        ]
    )

    if prompt_type == "agree_disagree":
        chunks.append(
            "- For agree_disagree: STRICT RULE! BOTH body1 and body2 MUST argue the SAME direction favoring your stance. Do NOT write a balanced essay. Both paragraphs must support your opinion.\n"
        )
        chunks.append(
            "- For agree_disagree: The conclusion MUST strongly reaffirm the chosen stance without contradicting the body.\n"
        )

    if prompt_type == "choose_between":
        chunks.append(
            "- For choose_between: STRICT RULE! The essay MUST discuss BOTH options before concluding. body1 must discuss the first option, body2 must discuss the second option.\n"
        )
        chunks.append(
            f"- For choose_between: The conclusion MUST definitively pick the stated stance ({stance_statement}) after comparing both.\n"
        )

    if prompt_type == "discuss_both_views":
        chunks.append(
            "- For discuss_both_views: body1 MUST start with \"On the one hand,\" and explain the side that matches your opinion.\n"
        )
        chunks.append(
            "- For discuss_both_views: body2 MUST start with \"On the other hand,\" and explain the opposite side.\n"
        )
        chunks.append(
            "- For discuss_both_views: STRICT RULE! The conclusion MUST definitively pick the stated stance and not be vague.\n"
        )

    if prompt_type == "advantages_disadvantages":
        chunks.append(
            "- For advantages_disadvantages: body1 MUST start with \"On the one hand,\" and focus on ONE clear advantage.\n"
        )
        chunks.append(
            "- For advantages_disadvantages: body2 MUST start with \"On the other hand,\" and focus on ONE clear disadvantage.\n"
        )
        chunks.append(
            "- For advantages_disadvantages: body2 should use a clear disadvantage word such as \"disadvantage\", \"drawback\", \"negative\", \"problem\", or \"risk\".\n"
        )
        chunks.append(
            f"- For advantages_disadvantages: STRICT RULE! The conclusion MUST weigh the two sides and definitively align with the stated stance ({stance_statement}), clearly summarizing why the advantages or disadvantages are stronger.\n"
        )

    if prompt_type == "unknown":
        chunks.append(
            f"- STRICT RULE! The essay MUST logically support the assigned stance ({stance_statement}) without contradicting itself.\n"
        )

    if prompt_type == "problems_solutions":
        chunks.append(
            "- For problems_solutions: body1 MUST start with \"The main cause is\" (or \"The major reason is\") and explain the main cause/problem.\n"
        )
        chunks.append(
            "- For problems_solutions: body2 MUST start with \"One practical solution is\" (or \"One effective solution is\") and suggest a solution.\n"
        )

    if level_id == "a2_b1":
        body1_example_starter = "For example,"
        body1_link_starter = "This shows that"
        body2_explain_starter = "This is because"
        body2_example_starter = "For example,"
        body2_effect_starter = "As a result,"
        body2_link_starter = "This supports the view that"
    else:
        body1_example_starter = "For instance,"
        body1_link_starter = "Hence, it becomes evident that"
        body2_explain_starter = "This is primarily due to the fact that"
        body2_example_starter = "This can be exemplified by the fact that"
        body2_effect_starter = "The outcome is that"
        body2_link_starter = "This clearly aligns with the view that"

    chunks.extend(
        [
            "- Include one clear example and one clear effect in each body paragraph.\n\n",
            "Required PEEL starters (sentence two to sentence five):\n",
            "- Body one:\n",
            "  - Explain (sentence two): In other words,\n",
            f"  - Example (sentence three): {body1_example_starter}\n",
            "  - Effect (sentence four): As a result,\n",
            f"  - Link (sentence five): {body1_link_starter}\n",
            "- Body two:\n",
            f"  - Explain (sentence two): {body2_explain_starter}\n",
            f"  - Example (sentence three): {body2_example_starter}\n",
            f"  - Effect (sentence four): {body2_effect_starter}\n",
            f"  - Link (sentence five): {body2_link_starter}\n",
            "- Do not start any body sentence with First/Second/Third/Firstly/Secondly/Thirdly.\n\n",
            "Conclusion rules:\n",
            "- parts.conclusion must be one or two sentences only.\n",
            "- It must restate your stance and paraphrase both main points.\n\n",
            "- It should clearly restate your opinion using \"I strongly agree\" or \"I strongly disagree\".\n",
            "- Start the conclusion with \"In conclusion,\" to keep it short and direct.\n\n",
            "- Reuse one key word from body1's first sentence and one key word from body2's first sentence.\n\n",
            f"Allowed topic vocabulary suggestions (optional): {allowed}\n",
            f"Do not use these advanced prompt-specific phrases: {forbidden}\n\n",
            "Vocabulary Output Rule:\n",
            "- For parts.analysis.vocabulary, you MUST ONLY list vocabulary terms that actually appear in the essay you just wrote. DO NOT invent or list terms that are not present in your essay text.\n\n",
            f"Return strictly valid JSON matching this schema:\n{json.dumps(schema, ensure_ascii=False)}\n",
        ]
    )

    return "".join(chunks)


def build_analysis_system_prompt() -> str:
    return (
        "You are an expert PTE Academic writing teacher.\n"
        "Return ONLY valid JSON. No markdown. No extra keys.\n"
        "Given a prompt and an essay, produce:\n"
        "- point1: a short summary of the first body point\n"
        "- point2: a short summary of the second body point\n"
        "- vocabulary: 6-10 terms that APPEAR in the essay, each with enGloss and viGloss\n"
        "Vietnamese glosses must be in Vietnamese with diacritics.\n"
        "Do not invent vocabulary that is not in the essay.\n"
    )


def build_analysis_prompt(
    *,
    prompt_text: str,
    essay_text: str,
    level_id: str,
    target_vocab: Optional[Dict[str, Any]],
) -> str:
    level_id = str(level_id or "").strip() or "b2"
    level_spec = LEVEL_SPECS.get(level_id) or LEVEL_SPECS["b2"]

    allowed: List[str] = []
    forbidden: List[str] = []
    if isinstance(target_vocab, dict):
        for k in level_spec.get("allowedVocabKeys") or ("A2", "B1", "B2"):
            v = target_vocab.get(k)
            if isinstance(v, list):
                allowed.extend([str(x).strip() for x in v if str(x).strip()])
        forbidden = collect_forbidden_phrases(
            target_vocab,
            forbidden_keys=tuple(level_spec.get("forbiddenVocabKeys") or ("C1", "C2")),
        )
    allowed = allowed[:30]
    forbidden = forbidden[:25]

    schema = {
        "point1": "string",
        "point2": "string",
        "vocabulary": [{"term": "string", "enGloss": "string", "viGloss": "string"}],
    }

    return (
        f"Prompt:\n{prompt_text}\n\n"
        f"Essay:\n{essay_text}\n\n"
        f"Allowed topic vocabulary suggestions (optional): {allowed}\n"
        f"Do not use these advanced prompt-specific phrases: {forbidden}\n\n"
        f"Return strictly valid JSON matching this schema:\n{json.dumps(schema, ensure_ascii=False)}\n"
    )


def call_ollama_json(
    *,
    base_url: str,
    model: str,
    system: str,
    prompt: str,
    timeout_s: float,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    merged_options = {
        "temperature": 0.2,
        "num_predict": 750,
    }
    if isinstance(options, dict):
        merged_options.update(options)
    payload = {
        "model": model,
        "system": system,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": merged_options,
    }
    resp = _http_post_json(base_url.rstrip("/") + OLLAMA_GENERATE_PATH, payload, timeout_s=timeout_s)
    raw = (resp.get("response") or "").strip()
    if not raw:
        raise ValueError("Ollama returned empty response")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return extract_first_json_object(raw)


INTRO_SENTENCE_3 = "This essay will provide two reasons supporting my idea."


def _normalize_inline(text: str) -> str:
    t = normalize_newlines(str(text or "")).strip()
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def coerce_payload(raw: Dict[str, Any], variant: Dict[str, Any], *, level_id: str) -> Dict[str, Any]:
    if isinstance(raw.get("essay"), str) and isinstance(raw.get("analysis"), dict):
        return {"essay": raw["essay"], "analysis": raw["analysis"]}

    parts = raw.get("parts")
    analysis = raw.get("analysis")
    if not isinstance(parts, dict):
        raise ValueError("Missing parts object in model JSON")

    intro1 = _normalize_inline(parts.get("introSentence1"))
    intro1_sent = split_sentences(intro1)
    if len(intro1_sent) >= 2:
        # Keep only the first sentence to guarantee a 3-sentence introduction after assembly.
        intro1 = intro1_sent[0].strip()
    body1 = _normalize_inline(parts.get("body1"))
    body2 = _normalize_inline(parts.get("body2"))
    concl = _normalize_inline(parts.get("conclusion"))

    prompt_type = str(variant.get("promptType") or "").strip().lower()

    def _ensure_prefix(paragraph: str, prefix: str) -> str:
        p = str(paragraph or "").strip()
        if not p:
            return p
        if p.lower().startswith(prefix.lower()):
            return p
        return f"{prefix} {p}".strip()

    if prompt_type in ("discuss_both_views", "advantages_disadvantages"):
        body1 = _ensure_prefix(body1, "On the one hand,")
        body2 = _ensure_prefix(body2, "On the other hand,")

    # Normalize PEEL starters for sentence two to five when we have exactly five sentences.
    starters = {
        "a2_b1": {
            "body1": {
                "explain": "In other words,",
                "example": "For example,",
                "effect": "As a result,",
                "link": "This shows that",
            },
            "body2": {
                "explain": "This is because",
                "example": "For example,",
                "effect": "As a result,",
                "link": "This supports the view that",
            },
        },
        "b2": {
            "body1": {
                "explain": "In other words,",
                "example": "For instance,",
                "effect": "As a result,",
                "link": "Hence, it becomes evident that",
            },
            "body2": {
                "explain": "This is primarily due to the fact that",
                "example": "This can be exemplified by the fact that",
                "effect": "The outcome is that",
                "link": "This clearly aligns with the view that",
            },
        },
        "c1": {
            "body1": {
                "explain": "In other words,",
                "example": "For instance,",
                "effect": "As a result,",
                "link": "Hence, it becomes evident that",
            },
            "body2": {
                "explain": "This is primarily due to the fact that",
                "example": "This can be exemplified by the fact that",
                "effect": "The outcome is that",
                "link": "This clearly aligns with the view that",
            },
        },
    }

    def _strip_enum_prefix(sentence: str) -> str:
        s = str(sentence or "").strip()
        s = re.sub(r"(?i)^(first|second|third|firstly|secondly|thirdly)\\s*,\\s*", "", s)
        return s.strip()

    def _force_starter(sentence: str, starter: str) -> str:
        s = _strip_enum_prefix(sentence)
        if not s:
            return s
        if s.lower().startswith(starter.lower()):
            return s
        return f"{starter} {s}".strip()

    def _normalize_peel(paragraph: str, *, body_key: str) -> str:
        sents = split_sentences(paragraph)
        if len(sents) != 5:
            return paragraph
        st = starters.get(level_id, starters["b2"]).get(body_key) or starters["b2"][body_key]
        sents[1] = _force_starter(sents[1], st["explain"])
        sents[2] = _force_starter(sents[2], st["example"])
        sents[3] = _force_starter(sents[3], st["effect"])
        sents[4] = _force_starter(sents[4], st["link"])
        return " ".join(sents).strip()

    body1 = _normalize_peel(body1, body_key="body1")
    body2 = _normalize_peel(body2, body_key="body2")

    # Ensure the conclusion is short (1-2 sentences), restates stance, and mentions both body points.
    want = str(variant.get("stance") or "").strip().lower()
    stance_phrase = f"i strongly {want}" if want in ("agree", "disagree") else ""
    stance_sentence = f"In conclusion, I strongly {want} with {variant.get('stanceStatement')}." if stance_phrase else ""

    stop = {
        "this", "that", "these", "those", "there", "their", "they", "them", "then",
        "with", "without", "about", "from", "into", "over", "under", "between",
        "because", "overall", "also", "just", "only", "very",
        "people", "person", "persons", "students", "student", "countries", "country",
        "should", "could", "would", "will", "can", "cannot", "don't", "doesn't", "didn't",
        "have", "has", "had", "make", "makes", "made", "using", "use", "used",
        "more", "most", "many", "much", "some", "such", "same", "different",
    }

    def _first_keyword(paragraph: str) -> str:
        sents = split_sentences(paragraph)
        first = sents[0] if sents else paragraph
        for t in tokenize_words(first):
            if len(t) >= 4 and t not in stop:
                return t
        return ""

    kw1 = _first_keyword(body1)
    kw2 = _first_keyword(body2)

    concl_l = concl.lower()
    concl_sent = split_sentences(concl)
    has_stance = bool(stance_phrase and stance_phrase in concl_l)
    has_kw1 = bool(kw1 and (kw1 in concl_l or kw1[:5] in concl_l))
    has_kw2 = bool(kw2 and (kw2 in concl_l or kw2[:5] in concl_l))

    if (not has_stance) or (not has_kw1) or (not has_kw2) or len(concl_sent) > 2 or len(concl_sent) == 0:
        summary = ""
        if kw1 and kw2:
            summary = f"This is clear from {kw1} and {kw2}."
        elif kw1 or kw2:
            summary = f"This is clear from {kw1 or kw2}."

        if stance_sentence:
            concl = f"{stance_sentence} {summary}".strip() if summary else stance_sentence.strip()
        else:
            # Fallback: keep the first one or two sentences only.
            concl = " ".join(concl_sent[:2]).strip() if concl_sent else concl.strip()

    # Always start the conclusion with "In conclusion,".
    concl_strip = concl.lstrip()
    concl_low = concl_strip.lower()
    if concl_low.startswith("in conclusion") and not concl_low.startswith("in conclusion,"):
        rest = concl_strip[len("In conclusion") :].lstrip()
        if rest.startswith(","):
            rest = rest[1:].lstrip()
        concl = f"In conclusion, {rest}".strip()
    elif not concl_low.startswith("in conclusion,"):
        concl = f"In conclusion, {concl_strip}".strip()

    # Normalize spacing after the comma.
    if re.match(r"(?i)^in conclusion,(?!\\s)", concl):
        concl = "In conclusion, " + concl[len("In conclusion,") :].lstrip()

    sentence2 = f"In my opinion, I strongly {variant['stance']} with {variant['stanceStatement']}."
    intro = " ".join([intro1, sentence2, INTRO_SENTENCE_3]).strip()

    essay = "\n\n".join([intro, body1, body2, concl]).strip()
    wc = word_count_like_frontend(essay)
    if wc < 200:
        # IMPORTANT: Do not add new sentences (body paragraphs must stay at 5 sentences).
        max_words = 22 if str(level_id).strip().lower() == "a2_b1" else None
        pad_phrases = (
            ["in daily life", "for many people", "in many places", "today", "in a clear way"]
            if str(level_id).strip().lower() == "a2_b1"
            else ["in everyday life", "in many cases", "in many communities", "in the long term", "in practice"]
        )

        def _append_phrase_to_sentence(sent: str, phrase: str) -> str:
            s = sent.strip()
            if not s:
                return s
            m = re.match(r"^(.*?)([.!?])$", s)
            if m:
                core = m.group(1).rstrip()
                punct = m.group(2)
                return f"{core} {phrase}{punct}".strip()
            return f"{s} {phrase}".strip()

        def _pad_one_sentence(paragraph: str) -> str:
            sents = split_sentences(paragraph)
            if not sents:
                return paragraph
            # Prefer padding Explain/Example/Effect sentences so we do not change the Point/Link too much.
            order = [1, 2, 3] if len(sents) >= 4 else list(range(1, len(sents)))
            for si in order:
                for ph in pad_phrases:
                    candidate = _append_phrase_to_sentence(sents[si], ph)
                    if max_words is not None and word_count_like_frontend(candidate) > max_words:
                        continue
                    if candidate == sents[si]:
                        continue
                    sents[si] = candidate
                    return " ".join(sents).strip()
            return " ".join(sents).strip()

        i = 0
        while wc < 200 and i < 30:
            before = essay
            if i % 2 == 0:
                body1 = _pad_one_sentence(body1)
            else:
                body2 = _pad_one_sentence(body2)
            essay = "\n\n".join([intro, body1, body2, concl]).strip()
            wc = word_count_like_frontend(essay)
            if essay == before:
                break
            i += 1

    return {
        "essay": essay,
        "analysis": analysis if isinstance(analysis, dict) else {},
    }


def merge_missing_parts_analysis(new_raw: Any, old_raw: Any) -> Any:
    """
    Model repairs occasionally drop required keys. Preserve previously valid
    parts/analysis blocks when the new output is missing them.
    """
    if not isinstance(new_raw, dict) or not isinstance(old_raw, dict):
        return new_raw
    out = dict(new_raw)
    if not isinstance(out.get("parts"), dict) and isinstance(old_raw.get("parts"), dict):
        out["parts"] = old_raw["parts"]
    if not isinstance(out.get("analysis"), dict) and isinstance(old_raw.get("analysis"), dict):
        out["analysis"] = old_raw["analysis"]
    return out


def validate_sample(
    *,
    variant: Dict[str, Any],
    payload: Dict[str, Any],
    level_id: str,
    target_vocab: Optional[Dict[str, Any]],
    oxford_levels: Dict[str, str],
    pass_number: int,
) -> Tuple[bool, List[QaIssue], Dict[str, Any]]:
    issues: List[QaIssue] = []

    level_id = str(level_id or "").strip() or "b2"
    if level_id not in LEVEL_SPECS:
        level_id = "b2"
    level_spec = LEVEL_SPECS[level_id]

    essay = payload.get("essay")
    analysis = payload.get("analysis")
    if not isinstance(essay, str) or not essay.strip():
        issues.append(QaIssue("missing_essay", "Missing or empty essay", "hard"))
        return False, issues, {}
    if not isinstance(analysis, dict):
        issues.append(QaIssue("missing_analysis", "Missing analysis object", "hard"))
        return False, issues, {}

    point1 = analysis.get("point1")
    point2 = analysis.get("point2")
    vocab_list = analysis.get("vocabulary")
    if not isinstance(point1, str) or not point1.strip():
        issues.append(QaIssue("missing_point1", "Missing or empty analysis.point1", "hard"))
    if not isinstance(point2, str) or not point2.strip():
        issues.append(QaIssue("missing_point2", "Missing or empty analysis.point2", "hard"))
    if not isinstance(vocab_list, list) or len(vocab_list) < 6:
        issues.append(QaIssue("vocab_too_short", "analysis.vocabulary must have at least 6 items", "hard"))

    wc = word_count_like_frontend(essay)
    if wc < 200 or wc > 300:
        issues.append(QaIssue("word_count", f"Word count {wc} is outside 200-300", "hard"))

    if is_all_caps(essay):
        issues.append(QaIssue("all_caps", "Essay appears to be all caps", "hard"))
    if not re.search(r"[.!?]", essay):
        issues.append(QaIssue("no_punctuation", "Essay contains no sentence-ending punctuation", "hard"))
    if "2" in essay:
        issues.append(QaIssue("digit_two", "Essay must not use the digit 2; use the word \"two\" instead", "hard"))
    if looks_like_bullets(essay):
        issues.append(QaIssue("bullet_format", "Essay looks like bullet points / lists", "hard"))
    if has_html_injection_markers(essay):
        issues.append(QaIssue("html_injection", "Essay contains HTML/JS injection-like markers", "hard"))

    # Academic writing punctuation rules (hard).
    banned_starters = ("and", "but", "or", "so", "because")
    starter_hits: List[str] = []
    for s in split_sentences(essay):
        st = s.strip()
        if not st:
            continue
        m = re.match(r"^([A-Za-z]+)\b", st)
        if not m:
            continue
        first = m.group(1).lower()
        if first in banned_starters:
            starter_hits.append(m.group(1))
    if starter_hits:
        issues.append(QaIssue("sentence_starter_conjunction", f"Do not start sentences with conjunctions: {sorted(set(starter_hits))}", "hard"))

    # Conjunctive adverbs: if 'however'/'therefore' appear, enforce '; however,' / '; therefore,'.
    conj_adv_hits: List[str] = []
    for m in re.finditer(r"(?i)\b(however|therefore)\b", essay):
        word = m.group(1).lower()
        # Next non-space char must be a comma.
        j = m.end()
        while j < len(essay) and essay[j].isspace():
            j += 1
        if j >= len(essay) or essay[j] != ",":
            conj_adv_hits.append(word)
            continue
        # Previous non-space char must be a semicolon.
        i = m.start() - 1
        while i >= 0 and essay[i].isspace():
            i -= 1
        if i < 0 or essay[i] != ";":
            conj_adv_hits.append(word)
    if conj_adv_hits:
        issues.append(QaIssue("conjunctive_adverb_punctuation", f"Use '; however,' / '; therefore,' when these words appear: {sorted(set(conj_adv_hits))}", "hard"))

    # Comma before coordinating conjunction when it likely joins two independent clauses (heuristic, hard).
    pronoun_subjects = ("i", "you", "he", "she", "it", "we", "they", "this", "these", "those")
    missing_comma_examples: List[str] = []
    for s in split_sentences(essay):
        for m in re.finditer(r"(?i)\b(and|but|or|so)\b", s):
            after = s[m.end() :]
            # Heuristic: flag only when a new clause likely starts with a pronoun subject.
            if not re.match(rf"^\s+(?:{'|'.join(pronoun_subjects)})\b", after, flags=re.IGNORECASE):
                continue
            k = m.start() - 1
            while k >= 0 and s[k].isspace():
                k -= 1
            if k < 0:
                continue
            prev = s[k]
            if prev == ",":
                continue
            if prev in (";", ":"):
                continue
            snippet = s[max(0, m.start() - 25) : min(len(s), m.end() + 25)].strip()
            missing_comma_examples.append(snippet)
    if missing_comma_examples:
        issues.append(QaIssue("comma_before_conjunction", f"Add a comma before clause-joining conjunctions (examples): {missing_comma_examples[:3]}", "hard"))

    paragraphs = split_paragraphs(essay)
    if len(paragraphs) != 4:
        issues.append(QaIssue("paragraph_count", f"Expected 4 paragraphs, found {len(paragraphs)}", "hard"))
    else:
        intro, body1, body2, concl = paragraphs

        intro_sent = split_sentences(intro)
        if len(intro_sent) != 3:
            issues.append(QaIssue("intro_sentence_count", f"Intro must have 3 sentences, found {len(intro_sent)}", "hard"))
        else:
            want = variant["stance"]
            s2 = intro_sent[1].strip()
            s3 = intro_sent[2].strip()
            s2l = s2.lower()
            prefix_a = f"in my opinion, i strongly {want} with "
            prefix_b = f"in my opinion i strongly {want} with "
            if not (s2l.startswith(prefix_a) or s2l.startswith(prefix_b)):
                issues.append(QaIssue("intro_sentence2", f'Intro sentence 2 must start with "In my opinion, I strongly {want} with "', "hard"))
            if s3 != INTRO_SENTENCE_3:
                issues.append(QaIssue("intro_sentence3", "Intro sentence 3 must match the required template exactly", "hard"))

        def _check_body(label: str, p: str) -> None:
            s = split_sentences(p)
            if len(s) != 5:
                issues.append(QaIssue(f"{label}_sentences", f"{label} must have exactly 5 sentences (Point, Explain, Example, Effect, Link)", "hard"))
                return
            # No sentence should start with First/Second/Third style enumerators.
            banned_enum = ("first", "second", "third", "firstly", "secondly", "thirdly")
            enum_hits: List[str] = []
            for sent in s:
                st = sent.strip()
                if not st:
                    continue
                m = re.match(r"^([A-Za-z]+)\b", st)
                if not m:
                    continue
                w = m.group(1).lower()
                if w in banned_enum:
                    enum_hits.append(m.group(1))
            if enum_hits:
                issues.append(QaIssue(f"{label}_enum_starter", f"{label}: do not start sentences with First/Second/Third: {sorted(set(enum_hits))}", "hard"))

            # Enforce transitional starters for PEEL sentences (sentence indices: 1..4).
            level_key = "a2_b1" if level_id == "a2_b1" else ("b2" if level_id == "b2" else "c1")
            body_key = "body1" if label == "body1" else "body2"
            starters = {
                "a2_b1": {
                    "body1": {
                        "explain": ("In other words,",),
                        "example": ("For example,",),
                        "effect": ("As a result,",),
                        "link": ("This shows that",),
                    },
                    "body2": {
                        "explain": ("This is because",),
                        "example": ("For example,",),
                        "effect": ("As a result,",),
                        "link": ("This supports the view that",),
                    },
                },
                "b2": {
                    "body1": {
                        "explain": ("In other words,",),
                        "example": ("For instance,",),
                        "effect": ("As a result,",),
                        "link": ("Hence, it becomes evident that",),
                    },
                    "body2": {
                        "explain": ("This is primarily due to the fact that",),
                        "example": ("This can be exemplified by the fact that",),
                        "effect": ("The outcome is that",),
                        "link": ("This clearly aligns with the view that",),
                    },
                },
                "c1": {
                    "body1": {
                        "explain": ("In other words,",),
                        "example": ("For instance,",),
                        "effect": ("As a result,",),
                        "link": ("Hence, it becomes evident that",),
                    },
                    "body2": {
                        "explain": ("This is primarily due to the fact that",),
                        "example": ("This can be exemplified by the fact that",),
                        "effect": ("The outcome is that",),
                        "link": ("This clearly aligns with the view that",),
                    },
                },
            }[level_key][body_key]

            explain = s[1].lstrip()
            example = s[2].lstrip()
            effect = s[3].lstrip()
            link = s[4].lstrip()

            def _starts_with_any(text: str, prefixes: Tuple[str, ...]) -> bool:
                tl = text.lower()
                return any(tl.startswith(p.lower()) for p in prefixes)

            if not _starts_with_any(explain, starters["explain"]):
                issues.append(QaIssue(f"{label}_explain_starter", f"{label}: sentence two must start with {list(starters['explain'])}", "hard"))
            if not _starts_with_any(example, starters["example"]):
                issues.append(QaIssue(f"{label}_example_starter", f"{label}: sentence three must start with {list(starters['example'])}", "hard"))
            if not _starts_with_any(effect, starters["effect"]):
                issues.append(QaIssue(f"{label}_effect_starter", f"{label}: sentence four must start with {list(starters['effect'])}", "hard"))
            if not _starts_with_any(link, starters["link"]):
                issues.append(QaIssue(f"{label}_link_starter", f"{label}: sentence five must start with {list(starters['link'])}", "hard"))

            # A2-B1: keep sentences short and simple.
            if level_id == "a2_b1":
                too_long = [word_count_like_frontend(x) for x in s if word_count_like_frontend(x) > 22]
                if too_long:
                    issues.append(QaIssue(f"{label}_sentence_length", f"{label}: A2-B1 sentences must be short (max 22 words). Offending counts: {too_long[:3]}", "hard"))
                # Keep idea flow simple: link sentence should clearly restate the point using shared key words.
                stop_small = {
                    "this", "that", "these", "those", "there", "their", "they", "them", "then",
                    "with", "without", "about", "from", "into", "over", "under", "between",
                    "because", "also", "just", "only", "very", "people",
                    "should", "could", "would", "will", "can", "cannot", "don't", "doesn't", "didn't",
                    "have", "has", "had", "make", "makes", "made", "using", "use", "used",
                    "more", "most", "many", "much", "some", "such", "same", "different",
                }

                def _sig(tokens: set) -> set:
                    out = set()
                    for t in tokens:
                        out.add(t)
                        if len(t) >= 5:
                            out.add(t[:5])
                    return out

                pt = {t for t in tokenize_words(s[0]) if len(t) >= 4 and t not in stop_small}
                lk = {t for t in tokenize_words(s[4]) if len(t) >= 4 and t not in stop_small}
                if pt and lk and not (_sig(pt) & _sig(lk)):
                    issues.append(QaIssue(f"{label}_link_coherence", f"{label}: link sentence should restate the point using key words from sentence one", "soft"))

        _check_body("body1", body1)
        _check_body("body2", body2)

        prompt_type = str(variant.get("promptType") or "").strip()
        b1l = body1.lstrip().lower()
        b2l = body2.lstrip().lower()
        if prompt_type == "discuss_both_views":
            if not b1l.startswith("on the one hand"):
                issues.append(QaIssue("discuss_body1_marker", "discuss_both_views: body1 should start with \"On the one hand\"", "hard"))
            if not b2l.startswith("on the other hand"):
                issues.append(QaIssue("discuss_body2_marker", "discuss_both_views: body2 should start with \"On the other hand\"", "hard"))
        elif prompt_type == "advantages_disadvantages":
            if not b1l.startswith("on the one hand"):
                issues.append(QaIssue("advdis_body1_marker", "advantages_disadvantages: body1 should start with \"On the one hand\"", "hard"))
            if not b2l.startswith("on the other hand"):
                issues.append(QaIssue("advdis_body2_marker", "advantages_disadvantages: body2 should start with \"On the other hand\"", "hard"))
            advantage_words = (
                "advantage", "benefit", "positive", "helpful", "useful", "improve", "gain",
                "good", "better", "save", "saving", "reduce", "lower", "cheaper", "cheap", "easier", "easy", "healthy", "health",
            )
            disadvantage_words = (
                "disadvantage", "drawback", "negative", "risk", "danger", "injury", "harm", "accident", "problem", "cost", "expensive",
                "bad", "worse", "hard", "harder", "difficult", "difficulty", "stress", "noisy", "noise", "crowded", "crowd",
            )
            if not any(w in body1.lower() for w in advantage_words):
                issues.append(QaIssue("advdis_body1_advantage", "advantages_disadvantages: body1 should clearly describe an advantage", "hard"))
            if not any(w in body2.lower() for w in disadvantage_words):
                issues.append(QaIssue("advdis_body2_disadvantage", "advantages_disadvantages: body2 should clearly describe a disadvantage", "hard"))
        elif prompt_type == "problems_solutions":
            if not (b1l.startswith("the main cause is") or b1l.startswith("the major reason is")):
                issues.append(QaIssue("probsol_body1_marker", "problems_solutions: body1 should start with \"The main cause is\" (or \"The major reason is\")", "hard"))
            if not (b2l.startswith("one practical solution is") or b2l.startswith("one effective solution is")):
                issues.append(QaIssue("probsol_body2_marker", "problems_solutions: body2 should start with \"One practical solution is\" (or \"One effective solution is\")", "hard"))

        concl_l = concl.lower()
        want = str(variant.get("stance") or "").strip().lower()
        concl_strip = concl.lstrip()
        if not concl_strip.lower().startswith("in conclusion"):
            issues.append(QaIssue("conclusion_in_conclusion", "Conclusion must start with \"In conclusion,\"", "hard"))
        elif not concl_strip.lower().startswith("in conclusion,"):
            issues.append(QaIssue("conclusion_in_conclusion_comma", "Conclusion must start with \"In conclusion,\" (include a comma)", "hard"))
        if want == "agree":
            if "i strongly agree" not in concl_l and "i agree" not in concl_l:
                issues.append(QaIssue("conclusion_stance", "Conclusion should clearly restate your opinion (agree)", "hard"))
        elif want == "disagree":
            if "i strongly disagree" not in concl_l and "i disagree" not in concl_l:
                issues.append(QaIssue("conclusion_stance", "Conclusion should clearly restate your opinion (disagree)", "hard"))

        # Basic content check: conclusion should echo a key content word from each body point sentence.
        stop = {
            "this", "that", "these", "those", "there", "their", "they", "them", "then",
            "with", "without", "about", "from", "into", "over", "under", "between",
            "because", "therefore", "thus", "overall", "also", "just", "only", "very",
            "people", "person", "persons", "students", "student", "countries", "country",
            "should", "could", "would", "will", "can", "cannot", "don't", "doesn't", "didn't",
            "have", "has", "had", "make", "makes", "made", "using", "use", "used",
            "more", "most", "many", "much", "some", "such", "same", "different",
        }

        def _content_tokens(s: str) -> set:
            return {t for t in tokenize_words(s) if len(t) >= 4 and t not in stop}

        def _token_signatures(tokens: set) -> set:
            # Add a short prefix signature to tolerate simple morphology:
            # "computer" vs "computing", "medical" vs "medicine", etc.
            out = set()
            for t in tokens:
                out.add(t)
                if len(t) >= 5:
                    out.add(t[:5])
            return out

        concl_tokens = _content_tokens(concl)
        b1_s = split_sentences(body1)
        b2_s = split_sentences(body2)
        b1_point = b1_s[0] if b1_s else ""
        b2_point = b2_s[0] if b2_s else ""
        b1_tokens = _content_tokens(b1_point)
        b2_tokens = _content_tokens(b2_point)
        concl_sig = _token_signatures(concl_tokens)
        b1_sig = _token_signatures(b1_tokens)
        b2_sig = _token_signatures(b2_tokens)
        if b1_tokens and not (concl_sig & b1_sig):
            issues.append(QaIssue("conclusion_point1", "Conclusion should briefly mention the main idea from body 1", "hard"))
        if b2_tokens and not (concl_sig & b2_sig):
            issues.append(QaIssue("conclusion_point2", "Conclusion should briefly mention the main idea from body 2", "hard"))

        concl_sent = split_sentences(concl)
        if len(concl_sent) == 0:
            issues.append(QaIssue("conclusion_missing", "Conclusion is missing", "hard"))
        elif len(concl_sent) > 2:
            issues.append(QaIssue("conclusion_too_long", f"Conclusion must be 1-2 sentences, found {len(concl_sent)}", "hard"))

    forbidden_keys = tuple(level_spec.get("forbiddenVocabKeys") or ("C1", "C2"))
    forbidden_phrases = collect_forbidden_phrases(target_vocab, forbidden_keys=forbidden_keys)
    hits = contains_forbidden_phrase(essay, forbidden_phrases)
    if hits:
        issues.append(QaIssue("forbidden_phrase", f"Essay contains forbidden {list(forbidden_keys)} target phrases: {hits[:5]}", "hard"))

    tokens = tokenize_words(essay)
    c2_tokens = sorted({tok for tok in tokens if oxford_levels.get(tok) == "C2"})
    c1_tokens = sorted({tok for tok in tokens if oxford_levels.get(tok) == "C1"})
    if level_id == "a2_b1":
        bad = sorted({tok for tok in tokens if is_b2_plus_for_a2_b1(tok, oxford_levels)})
        if bad:
            issues.append(QaIssue("lexical_gate", f"A2-B1 essay contains B2+ tokens: {bad[:12]}", "hard"))
    elif level_id == "b2":
        if c2_tokens:
            issues.append(QaIssue("c2_tokens", f"Essay contains C2 tokens: {c2_tokens[:12]}", "hard"))
        elif len(c1_tokens) > 2:
            issues.append(QaIssue("c1_tokens", f"Essay contains many C1 tokens: {c1_tokens[:12]}", "hard"))
        elif c1_tokens:
            issues.append(QaIssue("c1_tokens", f"Essay contains a small number of C1 tokens: {c1_tokens[:12]}", "soft"))
    else:  # c1 (or unknown)
        if c2_tokens:
            issues.append(QaIssue("c2_tokens", f"Essay contains C2 tokens: {c2_tokens[:12]}", "hard"))

    if isinstance(vocab_list, list):
        essay_l = essay.lower()
        missing_terms: List[str] = []
        vi_bad: List[str] = []
        vi_non_ascii = 0
        dict_items = 0

        for item in vocab_list:
            if not isinstance(item, dict):
                continue
            dict_items += 1
            term = str(item.get("term") or "").strip()
            en = str(item.get("enGloss") or "").strip()
            vi = str(item.get("viGloss") or "").strip()
            if not term:
                missing_terms.append("<empty>")
                continue
            if not term_matches_essay(term, essay_l):
                missing_terms.append(term)
            if pass_number >= 2:
                if not vi or not en or vi.lower() == en.lower():
                    vi_bad.append(term)
                if any(ord(ch) > 127 for ch in vi):
                    vi_non_ascii += 1

        if dict_items < 6:
            issues.append(QaIssue("vocab_items_invalid", "Vocabulary list items must be objects with term/enGloss/viGloss", "hard"))
        if missing_terms:
            issues.append(QaIssue("vocab_term_missing_in_essay", f"Vocabulary terms not found in essay: {missing_terms[:10]}", "soft"))

        if pass_number >= 2:
            if vi_bad:
                issues.append(QaIssue("vietnamese_gloss_bad", f"Missing/duplicated Vietnamese glosses for: {vi_bad[:10]}", "hard"))
            if dict_items > 0 and (vi_non_ascii / max(1, dict_items)) < 0.5:
                issues.append(QaIssue("vietnamese_diacritics_low", "Less than 50% of Vietnamese glosses contain diacritics", "soft"))

    passed = not any(i.severity == "hard" for i in issues)
    cleaned = {
        "essay": essay.strip(),
        "analysis": analysis,
        "wordCount": wc,
    }
    return passed, issues, cleaned


ANALYSIS_HARD_CODES = {
    "missing_point1",
    "missing_point2",
    "vocab_too_short",
    "vocab_items_invalid",
    "vocab_term_missing_in_essay",
}


def only_analysis_hard_issues(issues: List[QaIssue]) -> bool:
    hard = [i.code for i in issues if i.severity == "hard"]
    return bool(hard) and all(code in ANALYSIS_HARD_CODES for code in hard)


def load_questions(path: Path) -> List[Dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_pretty(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_staging(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"variants": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"variants": {}}


def generate_variant_for_level(
    *,
    prompt_id: int,
    title: str,
    prompt_text: str,
    level_id: str,
    variant_ctx: Dict[str, Any],
    target_vocab: Optional[Dict[str, Any]],
    existing_prod: Optional[Dict[str, Any]],
    staged_variants: Dict[str, Any],
    staging_path: Path,
    base_url: str,
    model: str,
    timeout_s: float,
    system: str,
    academic_rules: str,
    oxford_levels: Dict[str, str],
    failures: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    key = f"{prompt_id}:{level_id}:{variant_ctx['id']}"

    # Prefer production-approved variants if they still pass our current QA.
    if isinstance(existing_prod, dict):
        try:
            ok_prod, _issues_prod, _cleaned_prod = validate_sample(
                variant=variant_ctx,
                payload={"essay": existing_prod.get("essay", ""), "analysis": existing_prod.get("analysis", {})},
                level_id=level_id,
                target_vocab=target_vocab,
                oxford_levels=oxford_levels,
                pass_number=2,
            )
        except Exception:
            ok_prod = False
        if ok_prod:
            staged_variants[key] = {"qa": existing_prod.get("qa", {}), "variant": existing_prod}
            write_json_pretty(staging_path, {"variants": staged_variants})
            return existing_prod

    existing = staged_variants.get(key)
    if isinstance(existing, dict) and existing.get("qa", {}).get("status") in ("approved", "needs_manual_review"):
        if existing.get("qa", {}).get("status") == "approved" and isinstance(existing.get("variant"), dict):
            # Staging can outlive QA rule changes; re-validate before reusing.
            try:
                ok_stage, _issues_stage, _cleaned_stage = validate_sample(
                    variant=variant_ctx,
                    payload={
                        "essay": existing["variant"].get("essay", ""),
                        "analysis": existing["variant"].get("analysis", {}),
                    },
                    level_id=level_id,
                    target_vocab=target_vocab,
                    oxford_levels=oxford_levels,
                    pass_number=2,
                )
            except Exception:
                ok_stage = False
            if ok_stage:
                return existing["variant"]
        # needs_manual_review (or malformed) -> keep skipping unless caller uses --no-resume.
        return None

    user_prompt = build_user_prompt(
        prompt_id=prompt_id,
        title=title,
        prompt_text=prompt_text,
        level_id=level_id,
        variant=variant_ctx,
        target_vocab=target_vocab,
        oxford_levels=oxford_levels,
    )

    try:
        raw = call_ollama_json(
            base_url=base_url,
            model=model,
            system=system,
            prompt=user_prompt,
            timeout_s=timeout_s,
        )
    except urllib.error.URLError as e:
        failures.append({"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"url_error: {e}"})
        return None
    except Exception as e:
        failures.append({"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"generation_error: {e}"})
        return None

    edit1 = False
    edit2 = False

    try:
        payload = coerce_payload(raw, variant_ctx, level_id=level_id)
    except Exception:
        try:
            retry_prompt = user_prompt + "\n\nIMPORTANT: Return JSON with keys 'parts' and 'analysis' exactly as required. Do not omit 'parts'."
            raw = call_ollama_json(
                base_url=base_url,
                model=model,
                system=system,
                prompt=retry_prompt,
                timeout_s=timeout_s,
            )
            payload = coerce_payload(raw, variant_ctx, level_id=level_id)
        except Exception as e2:
            failures.append({"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"schema_error: {e2}"})
            return None

    ok1, issues1, _cleaned1 = validate_sample(
        variant=variant_ctx,
        payload=payload,
        level_id=level_id,
        target_vocab=target_vocab,
        oxford_levels=oxford_levels,
        pass_number=1,
    )
    pass1 = {"passed": ok1, "issues": issue_list_to_json(issues1)}

    if not ok1:
        edit1 = True
        raw_before_edit1 = raw
        try:
            if only_analysis_hard_issues(issues1):
                analysis_raw = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=build_analysis_system_prompt(),
                    prompt=build_analysis_prompt(
                        prompt_text=prompt_text,
                        essay_text=payload.get("essay", ""),
                        level_id=level_id,
                        target_vocab=target_vocab,
                    ),
                    timeout_s=timeout_s,
                    options={"num_predict": 420},
                )
                if not isinstance(analysis_raw, dict):
                    raise ValueError("Analysis repair did not return a JSON object")
                raw = dict(raw)
                raw["analysis"] = analysis_raw
            else:
                repair_p = repair_prompt(raw, issues1, level_id=level_id, academic_rules=academic_rules)
                raw = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=system,
                    prompt=repair_p,
                    timeout_s=timeout_s,
                )
                raw = merge_missing_parts_analysis(raw, raw_before_edit1)
        except Exception as e:
            record = {
                "qa": {
                    "status": "needs_manual_review",
                    "assessmentPass1": pass1,
                    "editPass1Applied": True,
                    "editPass2Applied": False,
                },
                "variant": None,
            }
            staged_variants[key] = record
            failures.append({"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"edit1_error: {e}"})
            write_json_pretty(staging_path, {"variants": staged_variants})
            return None

        try:
            payload = coerce_payload(raw, variant_ctx, level_id=level_id)
        except Exception as e:
            # One more schema-focused retry for repairs that dropped required keys.
            try:
                retry_prompt = (
                    repair_prompt(raw_before_edit1, issues1, level_id=level_id, academic_rules=academic_rules)
                    + "\n\nIMPORTANT: Return JSON with keys 'parts' and 'analysis' exactly as required. Do not omit 'parts'."
                )
                raw_retry = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=system,
                    prompt=retry_prompt,
                    timeout_s=timeout_s,
                )
                raw = merge_missing_parts_analysis(raw_retry, raw_before_edit1)
                payload = coerce_payload(raw, variant_ctx, level_id=level_id)
            except Exception as e2:
                record = {
                    "qa": {
                        "status": "needs_manual_review",
                        "assessmentPass1": pass1,
                        "editPass1Applied": True,
                        "editPass2Applied": False,
                    },
                    "variant": None,
                }
                staged_variants[key] = record
                failures.append(
                    {"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"schema_error_after_edit1: {e2}"}
                )
                write_json_pretty(staging_path, {"variants": staged_variants})
                return None

        ok1, issues1, _cleaned1 = validate_sample(
            variant=variant_ctx,
            payload=payload,
            level_id=level_id,
            target_vocab=target_vocab,
            oxford_levels=oxford_levels,
            pass_number=1,
        )
        pass1 = {"passed": ok1, "issues": issue_list_to_json(issues1)}

    if not ok1:
        edit2 = True
        raw_before_edit2 = raw
        try:
            if only_analysis_hard_issues(issues1):
                analysis_raw = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=build_analysis_system_prompt(),
                    prompt=build_analysis_prompt(
                        prompt_text=prompt_text,
                        essay_text=payload.get("essay", ""),
                        level_id=level_id,
                        target_vocab=target_vocab,
                    ),
                    timeout_s=timeout_s,
                    options={"num_predict": 420},
                )
                if not isinstance(analysis_raw, dict):
                    raise ValueError("Analysis repair did not return a JSON object")
                raw = dict(raw)
                raw["analysis"] = analysis_raw
            else:
                repair_p = repair_prompt(raw, issues1, level_id=level_id, academic_rules=academic_rules)
                raw = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=system,
                    prompt=repair_p,
                    timeout_s=timeout_s,
                )
                raw = merge_missing_parts_analysis(raw, raw_before_edit2)
        except Exception as e:
            record = {
                "qa": {
                    "status": "needs_manual_review",
                    "assessmentPass1": pass1,
                    "editPass1Applied": edit1,
                    "editPass2Applied": True,
                },
                "variant": None,
            }
            staged_variants[key] = record
            failures.append({"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"edit2_error: {e}"})
            write_json_pretty(staging_path, {"variants": staged_variants})
            return None

        try:
            payload = coerce_payload(raw, variant_ctx, level_id=level_id)
        except Exception as e:
            # One more schema-focused retry for repairs that dropped required keys.
            try:
                retry_prompt = (
                    repair_prompt(raw_before_edit2, issues1, level_id=level_id, academic_rules=academic_rules)
                    + "\n\nIMPORTANT: Return JSON with keys 'parts' and 'analysis' exactly as required. Do not omit 'parts'."
                )
                raw_retry = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=system,
                    prompt=retry_prompt,
                    timeout_s=timeout_s,
                )
                raw = merge_missing_parts_analysis(raw_retry, raw_before_edit2)
                payload = coerce_payload(raw, variant_ctx, level_id=level_id)
            except Exception as e2:
                record = {
                    "qa": {
                        "status": "needs_manual_review",
                        "assessmentPass1": pass1,
                        "editPass1Applied": edit1,
                        "editPass2Applied": True,
                    },
                    "variant": None,
                }
                staged_variants[key] = record
                failures.append(
                    {"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"schema_error_after_edit2: {e2}"}
                )
                write_json_pretty(staging_path, {"variants": staged_variants})
                return None

        ok1, issues1, _cleaned1 = validate_sample(
            variant=variant_ctx,
            payload=payload,
            level_id=level_id,
            target_vocab=target_vocab,
            oxford_levels=oxford_levels,
            pass_number=1,
        )
        pass1 = {"passed": ok1, "issues": issue_list_to_json(issues1)}

    if not ok1:
        record = {
            "qa": {
                "status": "needs_manual_review",
                "assessmentPass1": pass1,
                "editPass1Applied": edit1,
                "editPass2Applied": edit2,
            },
            "variant": None,
            "lastPayload": raw,
        }
        staged_variants[key] = record
        failures.append({"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": "needs_manual_review", **record["qa"]})
        write_json_pretty(staging_path, {"variants": staged_variants})
        return None

    ok2, issues2, cleaned2 = validate_sample(
        variant=variant_ctx,
        payload=payload,
        level_id=level_id,
        target_vocab=target_vocab,
        oxford_levels=oxford_levels,
        pass_number=2,
    )
    pass2 = {"passed": ok2, "issues": issue_list_to_json(issues2)}

    if not ok2 and not edit2:
        edit2 = True
        raw_before_edit2_pass2 = raw
        try:
            if only_analysis_hard_issues(issues2):
                analysis_raw = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=build_analysis_system_prompt(),
                    prompt=build_analysis_prompt(
                        prompt_text=prompt_text,
                        essay_text=payload.get("essay", ""),
                        level_id=level_id,
                        target_vocab=target_vocab,
                    ),
                    timeout_s=timeout_s,
                    options={"num_predict": 420},
                )
                if not isinstance(analysis_raw, dict):
                    raise ValueError("Analysis repair did not return a JSON object")
                raw = dict(raw)
                raw["analysis"] = analysis_raw
            else:
                repair_p = repair_prompt(raw, issues2, level_id=level_id, academic_rules=academic_rules)
                raw = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=system,
                    prompt=repair_p,
                    timeout_s=timeout_s,
                )
                raw = merge_missing_parts_analysis(raw, raw_before_edit2_pass2)
        except Exception as e:
            record = {
                "qa": {
                    "status": "needs_manual_review",
                    "assessmentPass1": pass1,
                    "editPass1Applied": edit1,
                    "assessmentPass2": pass2,
                    "editPass2Applied": True,
                },
                "variant": None,
            }
            staged_variants[key] = record
            failures.append({"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"edit2_error: {e}"})
            write_json_pretty(staging_path, {"variants": staged_variants})
            return None

        try:
            payload = coerce_payload(raw, variant_ctx, level_id=level_id)
        except Exception as e:
            # One more schema-focused retry for repairs that dropped required keys.
            try:
                retry_prompt = (
                    repair_prompt(raw_before_edit2_pass2, issues2, level_id=level_id, academic_rules=academic_rules)
                    + "\n\nIMPORTANT: Return JSON with keys 'parts' and 'analysis' exactly as required. Do not omit 'parts'."
                )
                raw_retry = call_ollama_json(
                    base_url=base_url,
                    model=model,
                    system=system,
                    prompt=retry_prompt,
                    timeout_s=timeout_s,
                )
                raw = merge_missing_parts_analysis(raw_retry, raw_before_edit2_pass2)
                payload = coerce_payload(raw, variant_ctx, level_id=level_id)
            except Exception as e2:
                record = {
                    "qa": {
                        "status": "needs_manual_review",
                        "assessmentPass1": pass1,
                        "editPass1Applied": edit1,
                        "assessmentPass2": pass2,
                        "editPass2Applied": True,
                    },
                    "variant": None,
                }
                staged_variants[key] = record
                failures.append(
                    {"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": f"schema_error_after_edit2: {e2}"}
                )
                write_json_pretty(staging_path, {"variants": staged_variants})
                return None

        ok2, issues2, cleaned2 = validate_sample(
            variant=variant_ctx,
            payload=payload,
            level_id=level_id,
            target_vocab=target_vocab,
            oxford_levels=oxford_levels,
            pass_number=2,
        )
        pass2 = {"passed": ok2, "issues": issue_list_to_json(issues2)}

    if not ok2:
        record = {
            "qa": {
                "status": "needs_manual_review",
                "assessmentPass1": pass1,
                "editPass1Applied": edit1,
                "assessmentPass2": pass2,
                "editPass2Applied": edit2,
            },
            "variant": None,
            "lastPayload": raw,
        }
        staged_variants[key] = record
        failures.append({"id": prompt_id, "level": level_id, "variant": variant_ctx["id"], "error": "needs_manual_review", **record["qa"]})
        write_json_pretty(staging_path, {"variants": staged_variants})
        return None

    approved_variant = {
        "id": variant_ctx["id"],
        "label": variant_ctx["label"],
        "stance": variant_ctx["stance"],
        "essay": cleaned2["essay"],
        "wordCount": cleaned2["wordCount"],
        "ideaFlow": build_idea_flow(cleaned2["essay"]),
        "analysis": cleaned2["analysis"],
        "qa": {
            "status": "approved",
            "assessmentPass1": pass1,
            "editPass1Applied": edit1,
            "assessmentPass2": pass2,
            "editPass2Applied": edit2,
        },
    }

    staged_variants[key] = {"qa": approved_variant["qa"], "variant": approved_variant}
    write_json_pretty(staging_path, {"variants": staged_variants})
    return approved_variant


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--essay-json", default=ESSAY_JSON_PATH_DEFAULT)
    ap.add_argument("--oxford-5000", default=OXFORD_5000_CSV_DEFAULT)
    ap.add_argument("--rubric", default=RUBRIC_PATH_DEFAULT)
    ap.add_argument("--academic-rules", default=ACADEMIC_RULES_PATH_DEFAULT)
    ap.add_argument("--base-url", default=OLLAMA_BASE_URL_DEFAULT)
    ap.add_argument("--model", default=MODEL_DEFAULT)
    ap.add_argument("--staging-dir", default=STAGING_DIR_DEFAULT)
    ap.add_argument("--ids", default=",".join(str(i) for i in PILOT_PROMPT_IDS_DEFAULT))
    ap.add_argument("--levels", default="a2_b1,b2,c1")
    ap.add_argument("--timeout-s", type=float, default=120.0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-resume", action="store_true")
    args = ap.parse_args()

    essay_json_path = Path(args.essay_json)
    staging_dir = Path(args.staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)
    staging_path = staging_dir / "pilot-staging.json"

    ids = [int(x.strip()) for x in str(args.ids).split(",") if x.strip()]

    requested_levels_raw = [x.strip() for x in str(args.levels or "").split(",") if x.strip()]
    level_order = ["a2_b1", "b2", "c1"]
    levels_requested = [lvl for lvl in level_order if lvl in requested_levels_raw] + [
        lvl for lvl in requested_levels_raw if lvl in LEVEL_SPECS and lvl not in level_order
    ]
    if not levels_requested:
        levels_requested = list(level_order)

    print(f"[write-essay] Health check: {args.base_url}")
    try:
        check_ollama_health(args.base_url, timeout_s=5.0)
    except Exception as e:
        print(f"[write-essay] ERROR: Ollama not reachable: {e}")
        return 2

    oxford = load_oxford_levels(Path(args.oxford_5000))
    academic_rules = load_academic_rules(Path(args.academic_rules))
    system_by_level = {lvl: build_system_prompt(level_id=lvl, academic_rules=academic_rules) for lvl in levels_requested}
    questions = load_questions(essay_json_path)
    by_id = {int(q.get("id")): q for q in questions if isinstance(q, dict) and str(q.get("id")).strip().isdigit()}

    staging = {"variants": {}} if args.no_resume else load_staging(staging_path)
    staged_variants: Dict[str, Any] = staging.get("variants") if isinstance(staging.get("variants"), dict) else {}

    qa_report: Dict[str, Any] = {
        "meta": {
            "model": args.model,
            "baseUrl": args.base_url,
            "rubricPath": args.rubric,
            "academicRulesPath": args.academic_rules,
            "levelsRequested": levels_requested,
            "essayJson": str(essay_json_path),
            "ids": ids,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        },
        "results": [],
    }
    failures: List[Dict[str, Any]] = []

    # Prompts differ by level, so system prompts are precomputed per level.

    for idx, prompt_id in enumerate(ids, start=1):
        q = by_id.get(prompt_id)
        mapping = PILOT_VARIANTS.get(prompt_id)
        if not mapping and q:
            sr = q.get("sampleResponses", {})
            mapping = {
                "promptType": sr.get("promptType", "unknown"),
                "variants": []
            }
            a2_b1_vars = sr.get("levels", {}).get("a2_b1", {}).get("variants", [])
            for v in a2_b1_vars:
                mapping["variants"].append({
                    "id": v.get("id"),
                    "label": v.get("label"),
                    "stance": v.get("stance"),
                    "stanceStatement": v.get("stance") or v.get("id")
                })
        
        if not q:
            failures.append({"id": prompt_id, "error": "prompt_not_found"})
            continue
        if not mapping or not mapping.get("variants"):
            failures.append({"id": prompt_id, "error": "no_variant_mapping"})
            continue

        title = str(q.get("title") or "").strip()
        prompt_text = str(q.get("prompt") or "").strip()
        target_vocab = q.get("targetVocabulary") if isinstance(q.get("targetVocabulary"), dict) else None

        print(f"[write-essay] ({idx}/{len(ids)}) Prompt {prompt_id}: {title}")

        variants_requested = [v.get("id") for v in mapping.get("variants", []) if isinstance(v, dict) and isinstance(v.get("id"), str)]

        # Reuse already-approved variants in the production JSON to avoid regenerating stable content.
        existing_sr = q.get("sampleResponses")
        existing_approved_by_level_by_id: Dict[str, Dict[str, Dict[str, Any]]] = {}
        if isinstance(existing_sr, dict):
            existing_levels = existing_sr.get("levels")
            if isinstance(existing_levels, dict):
                for lvl_id, lvl_obj in existing_levels.items():
                    if not isinstance(lvl_obj, dict):
                        continue
                    lvl_variants = lvl_obj.get("variants")
                    if not isinstance(lvl_variants, list):
                        continue
                    by_vid: Dict[str, Dict[str, Any]] = {}
                    for vv in lvl_variants:
                        if not isinstance(vv, dict):
                            continue
                        qa = vv.get("qa")
                        if isinstance(qa, dict) and qa.get("status") == "approved" and isinstance(vv.get("id"), str):
                            by_vid[vv["id"]] = vv
                    if by_vid:
                        existing_approved_by_level_by_id[str(lvl_id)] = by_vid

            legacy_variants = existing_sr.get("variants")
            if isinstance(legacy_variants, list):
                by_vid: Dict[str, Dict[str, Any]] = {}
                for vv in legacy_variants:
                    if not isinstance(vv, dict):
                        continue
                    qa = vv.get("qa")
                    if isinstance(qa, dict) and qa.get("status") == "approved" and isinstance(vv.get("id"), str):
                        by_vid[vv["id"]] = vv
                if by_vid:
                    existing_approved_by_level_by_id.setdefault("b2", {}).update(by_vid)

        approved_by_level: Dict[str, List[Dict[str, Any]]] = {}
        for level_id in levels_requested:
            print(f"[write-essay]   Level {level_id} ({LEVEL_SPECS[level_id]['label']})")
            system = system_by_level[level_id]
            approved_variants_level: List[Dict[str, Any]] = []

            for variant in mapping["variants"]:
                # Inject mapping-level promptType so prompt-family rules apply consistently.
                variant_ctx = dict(variant)
                variant_ctx["promptType"] = mapping.get("promptType")
                variant_ctx["stanceStatement"] = resolve_stance_statement(variant_ctx, level_id=level_id)

                existing_prod = existing_approved_by_level_by_id.get(level_id, {}).get(variant_ctx["id"])
                approved = generate_variant_for_level(
                    prompt_id=prompt_id,
                    title=title,
                    prompt_text=prompt_text,
                    level_id=level_id,
                    variant_ctx=variant_ctx,
                    target_vocab=target_vocab,
                    existing_prod=existing_prod,
                    staged_variants=staged_variants,
                    staging_path=staging_path,
                    base_url=args.base_url,
                    model=args.model,
                    timeout_s=args.timeout_s,
                    system=system,
                    academic_rules=academic_rules,
                    oxford_levels=oxford,
                    failures=failures,
                )
                if isinstance(approved, dict):
                    approved_variants_level.append(approved)

            approved_by_level[level_id] = approved_variants_level

        levels_approved_ids = {
            lvl: [v.get("id") for v in approved_by_level.get(lvl, []) if isinstance(v, dict) and isinstance(v.get("id"), str)]
            for lvl in levels_requested
        }
        complete = all(set(levels_approved_ids.get(lvl, [])) == set(variants_requested) for lvl in levels_requested)

        qa_report["results"].append({
            "id": prompt_id,
            "title": title,
            "promptType": mapping.get("promptType"),
            "variantsRequested": variants_requested,
            "levelsRequested": levels_requested,
            "levelsApproved": levels_approved_ids,
            "productionUpdated": bool(complete),
        })

        if complete:
            levels_out: Dict[str, Any] = {}
            for lvl in levels_requested:
                levels_out[lvl] = {
                    "label": str(LEVEL_SPECS[lvl]["label"]),
                    "variants": approved_by_level.get(lvl, []),
                }

            q["sampleResponses"] = {
                "source": f"ollama:{args.model}",
                "rubricVersion": args.rubric,
                "promptType": mapping.get("promptType"),
                "levels": levels_out,
            }

    write_json_pretty(staging_dir / "pilot-qa-report.json", qa_report)
    write_json_pretty(staging_dir / "pilot-failures.json", failures)

    if args.dry_run:
        print("[write-essay] Dry run: not writing production JSON.")
        return 0

    print(f"[write-essay] Writing updated JSON: {essay_json_path}")
    write_json_pretty(essay_json_path, questions)
    print("[write-essay] Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
