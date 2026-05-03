"""
Verify all PTE Write Essay variants using Gemma4.

Reads the production essay-questions-with-vocab.json, extracts every
essay variant, sends it to Gemma4 for scoring against the official PTE
Write Essay Score Guide, and produces a JSON verification report.

Usage:
    python scripts/verify_essays_gemma4.py
    python scripts/verify_essays_gemma4.py --limit 10   # pilot run
    python scripts/verify_essays_gemma4.py --ids 1,2,3   # specific IDs

Requires: Ollama running with gemma4 model.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

# ── Paths ─────────────────────────────────────────────────────────────

ESSAY_JSON_DEFAULT = "public/database/Write Essay/essay-questions-with-vocab.json"
SCORE_GUIDE_DEFAULT = "public/database/knowledge-base/Write Essay Score Guide.txt"
REPORT_DEFAULT = "tmp/essay-verification-report.json"
CHECKPOINT_DEFAULT = "tmp/essay-verification-checkpoint.json"
OLLAMA_URL_DEFAULT = "http://localhost:11434"
MODEL_DEFAULT = "gemma4:latest"

# ── CEFR Level Expected Score Ranges ──────────────────────────────────

CEFR_RANGES = {
    "a2_b1": {
        "content": (3, 4),
        "form": (2, 2),
        "structure": (3, 4),
        "grammar": (1, 1),
        "linguistic": (2, 3),
        "vocabulary": (0, 1),
        "spelling": (1, 2),
        "total": (12, 18),
    },
    "b2": {
        "content": (4, 5),
        "form": (2, 2),
        "structure": (4, 5),
        "grammar": (1, 2),
        "linguistic": (4, 5),
        "vocabulary": (1, 2),
        "spelling": (2, 2),
        "total": (18, 23),
    },
    "c1": {
        "content": (5, 6),
        "form": (2, 2),
        "structure": (5, 6),
        "grammar": (2, 2),
        "linguistic": (5, 6),
        "vocabulary": (2, 2),
        "spelling": (2, 2),
        "total": (23, 26),
    },
}

LEVEL_LABELS = {"a2_b1": "A2-B1 (Beginner)", "b2": "B2 (Intermediate)", "c1": "C1 (Advanced)"}

DIMENSION_MAXES = {
    "content": 6,
    "form": 2,
    "structure": 6,
    "grammar": 2,
    "linguistic": 6,
    "vocabulary": 2,
    "spelling": 2,
}


# ── Ollama Helpers ────────────────────────────────────────────────────


def call_ollama(
    *,
    base_url: str,
    model: str,
    system: str,
    prompt: str,
    timeout_s: float = 180.0,
) -> str:
    """Call Ollama generate endpoint and return the raw response text."""
    payload = json.dumps(
        {
            "model": model,
            "system": system,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1, "num_predict": 1024},
        }
    ).encode()

    req = urllib.request.Request(
        f"{base_url}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = json.loads(resp.read().decode())

    return body.get("response", "")


def parse_json_response(raw: str) -> Optional[Dict[str, Any]]:
    """Try to parse JSON from the Ollama response, handling markdown fences."""
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines (fences)
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object in the text
        import re

        m = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
    return None


def check_health(base_url: str) -> bool:
    """Check if Ollama is reachable."""
    try:
        req = urllib.request.Request(f"{base_url}/api/tags")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


# ── Verification Logic ────────────────────────────────────────────────


def build_verification_prompt(
    *,
    prompt_text: str,
    essay_text: str,
    level_id: str,
    analysis: Dict[str, Any],
    score_guide: str,
) -> tuple:
    """Build the system and user prompts for Gemma4 verification."""

    level_label = LEVEL_LABELS.get(level_id, level_id)
    expected = CEFR_RANGES.get(level_id, CEFR_RANGES["b2"])

    expected_str = "\n".join(
        f"  {dim}: {lo}-{hi}" for dim, (lo, hi) in expected.items()
    )

    system = (
        "You are a PTE Academic examiner. Score this essay using the official "
        f"rubric. The essay is written at {level_label} level — judge it "
        "appropriately for that proficiency band, not against native speaker "
        "expectations."
    )

    # Build analysis section
    analysis_parts = []
    if isinstance(analysis, dict):
        p1 = analysis.get("point1", "")
        p2 = analysis.get("point2", "")
        vocab = analysis.get("vocabulary", [])
        if p1:
            analysis_parts.append(f"Point 1: {p1}")
        if p2:
            analysis_parts.append(f"Point 2: {p2}")
        if vocab and isinstance(vocab, list):
            vocab_str = ", ".join(v.get("term", str(v)) if isinstance(v, dict) else str(v) for v in vocab[:8])
            analysis_parts.append(f"Vocabulary: {vocab_str}")

    analysis_block = "\n".join(analysis_parts) if analysis_parts else "(no analysis provided)"

    user = f"""## Question Prompt
{prompt_text}

## Essay (target: {level_label})
{essay_text}

## Analysis Block (verify accuracy)
{analysis_block}

## Scoring Rubric
{score_guide}

## Expected Score Ranges for {level_label}
{expected_str}

Score this essay on each dimension. Return ONLY a JSON object with these exact keys:
{{
  "content": <0-6>,
  "form": <0-2>,
  "structure": <0-6>,
  "grammar": <0-2>,
  "linguistic": <0-6>,
  "vocabulary": <0-2>,
  "spelling": <0-2>,
  "total": <sum of all scores>,
  "pass": <true if all scores within expected range ±1>,
  "issues": [<list of specific issues found, empty if none>],
  "analysis_accurate": <true if analysis block accurately reflects essay>,
  "analysis_issues": [<list of analysis inaccuracies, empty if none>]
}}"""

    return system, user


def verify_single_essay(
    *,
    prompt_id: int,
    prompt_text: str,
    essay_text: str,
    level_id: str,
    variant_id: str,
    analysis: Dict[str, Any],
    score_guide: str,
    base_url: str,
    model: str,
    timeout_s: float,
) -> Dict[str, Any]:
    """Verify a single essay and return the verdict."""

    system, user = build_verification_prompt(
        prompt_text=prompt_text,
        essay_text=essay_text,
        level_id=level_id,
        analysis=analysis,
        score_guide=score_guide,
    )

    result = {
        "prompt_id": prompt_id,
        "level": level_id,
        "variant": variant_id,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }

    try:
        raw = call_ollama(
            base_url=base_url,
            model=model,
            system=system,
            prompt=user,
            timeout_s=timeout_s,
        )

        verdict = parse_json_response(raw)
        if verdict is None:
            result["error"] = "json_parse_error"
            result["raw_response"] = raw[:500]
            return result

        # Validate and normalize the verdict
        for dim in DIMENSION_MAXES:
            val = verdict.get(dim)
            if not isinstance(val, (int, float)):
                verdict[dim] = 0
            else:
                verdict[dim] = max(0, min(int(val), DIMENSION_MAXES[dim]))

        # Recalculate total
        verdict["total"] = sum(verdict.get(d, 0) for d in DIMENSION_MAXES)

        # Check pass/fail against CEFR ranges (±1 tolerance)
        expected = CEFR_RANGES.get(level_id, CEFR_RANGES["b2"])
        out_of_range = []
        for dim, (lo, hi) in expected.items():
            if dim == "total":
                continue
            score = verdict.get(dim, 0)
            if score < lo - 1 or score > hi + 1:
                out_of_range.append(f"{dim}={score} (expected {lo}-{hi})")

        verdict["out_of_range"] = out_of_range
        verdict["pass"] = len(out_of_range) == 0 and verdict.get("pass", True)

        result["verdict"] = verdict

    except urllib.error.URLError as e:
        result["error"] = f"url_error: {e}"
    except Exception as e:
        result["error"] = f"verification_error: {e}"

    return result


# ── Main ──────────────────────────────────────────────────────────────


def load_checkpoint(path: Path) -> set:
    """Load already-verified essay keys from checkpoint."""
    if not path.exists():
        return set()
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return set(data.get("verified_keys", []))
    except Exception:
        return set()


def save_checkpoint(path: Path, verified_keys: set):
    """Save checkpoint of verified essay keys."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"verified_keys": sorted(verified_keys), "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}, f)


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify PTE essays using Gemma4")
    ap.add_argument("--essay-json", default=ESSAY_JSON_DEFAULT)
    ap.add_argument("--score-guide", default=SCORE_GUIDE_DEFAULT)
    ap.add_argument("--report", default=REPORT_DEFAULT)
    ap.add_argument("--checkpoint", default=CHECKPOINT_DEFAULT)
    ap.add_argument("--base-url", default=OLLAMA_URL_DEFAULT)
    ap.add_argument("--model", default=MODEL_DEFAULT)
    ap.add_argument("--timeout-s", type=float, default=180.0)
    ap.add_argument("--limit", type=int, default=0, help="Max essays to verify (0=all)")
    ap.add_argument("--ids", default="", help="Comma-separated prompt IDs to verify")
    ap.add_argument("--no-resume", action="store_true", help="Ignore checkpoint, start fresh")
    args = ap.parse_args()

    # Load data
    essay_path = Path(args.essay_json)
    if not essay_path.exists():
        print(f"[verify] ERROR: Essay DB not found: {essay_path}")
        return 1

    guide_path = Path(args.score_guide)
    if not guide_path.exists():
        print(f"[verify] ERROR: Score guide not found: {guide_path}")
        return 1

    print(f"[verify] Loading essay DB: {essay_path}")
    with open(essay_path, encoding="utf-8") as f:
        questions = json.load(f)

    print(f"[verify] Loading score guide: {guide_path}")
    with open(guide_path, encoding="utf-8") as f:
        score_guide = f.read()

    # Health check
    print(f"[verify] Checking Ollama: {args.base_url}")
    if not check_health(args.base_url):
        print("[verify] ERROR: Ollama not reachable")
        return 2

    # Filter IDs
    filter_ids = None
    if args.ids:
        filter_ids = set(int(x.strip()) for x in args.ids.split(",") if x.strip())

    # Load checkpoint
    checkpoint_path = Path(args.checkpoint)
    verified_keys = set() if args.no_resume else load_checkpoint(checkpoint_path)
    print(f"[verify] Resuming with {len(verified_keys)} already verified")

    # Collect essays to verify
    essays_to_verify = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        prompt_id = q.get("id")
        if not isinstance(prompt_id, int):
            try:
                prompt_id = int(prompt_id)
            except (ValueError, TypeError):
                continue

        if filter_ids and prompt_id not in filter_ids:
            continue

        prompt_text = str(q.get("prompt", "")).strip()
        sr = q.get("sampleResponses")
        if not isinstance(sr, dict):
            continue

        levels = sr.get("levels")
        if not isinstance(levels, dict):
            continue

        for level_id, level_obj in levels.items():
            if not isinstance(level_obj, dict):
                continue
            variants = level_obj.get("variants")
            if not isinstance(variants, list):
                continue

            for variant in variants:
                if not isinstance(variant, dict):
                    continue
                variant_id = variant.get("id", "unknown")
                essay = variant.get("essay", "")
                analysis = variant.get("analysis", {})

                if not essay or not isinstance(essay, str) or len(essay.strip()) < 50:
                    continue

                key = f"{prompt_id}:{level_id}:{variant_id}"
                if key in verified_keys:
                    continue

                essays_to_verify.append(
                    {
                        "prompt_id": prompt_id,
                        "level_id": level_id,
                        "variant_id": variant_id,
                        "prompt_text": prompt_text,
                        "essay_text": essay,
                        "analysis": analysis if isinstance(analysis, dict) else {},
                    }
                )

    if args.limit > 0:
        essays_to_verify = essays_to_verify[: args.limit]

    total = len(essays_to_verify)
    print(f"[verify] {total} essays to verify")

    if total == 0:
        print("[verify] Nothing to verify. Done.")
        return 0

    # Load existing report
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    existing_results = []
    if report_path.exists() and not args.no_resume:
        try:
            with open(report_path, encoding="utf-8") as f:
                existing_report = json.load(f)
            existing_results = existing_report.get("results", [])
        except Exception:
            pass

    results = list(existing_results)
    pass_count = sum(1 for r in results if r.get("verdict", {}).get("pass"))
    fail_count = sum(1 for r in results if not r.get("error") and not r.get("verdict", {}).get("pass"))
    error_count = sum(1 for r in results if r.get("error"))

    # Process essays
    for idx, essay_info in enumerate(essays_to_verify, start=1):
        key = f"{essay_info['prompt_id']}:{essay_info['level_id']}:{essay_info['variant_id']}"

        print(
            f"[verify] ({idx}/{total}) #{essay_info['prompt_id']} "
            f"{essay_info['level_id']}:{essay_info['variant_id']}",
            end=" ... ",
            flush=True,
        )

        result = verify_single_essay(
            prompt_id=essay_info["prompt_id"],
            prompt_text=essay_info["prompt_text"],
            essay_text=essay_info["essay_text"],
            level_id=essay_info["level_id"],
            variant_id=essay_info["variant_id"],
            analysis=essay_info["analysis"],
            score_guide=score_guide,
            base_url=args.base_url,
            model=args.model,
            timeout_s=args.timeout_s,
        )

        results.append(result)
        verified_keys.add(key)

        if result.get("error"):
            print(f"ERROR: {result['error'][:60]}")
            error_count += 1
        elif result.get("verdict", {}).get("pass"):
            v = result["verdict"]
            print(f"PASS (total={v['total']})")
            pass_count += 1
        else:
            v = result.get("verdict", {})
            issues = v.get("issues", [])
            oor = v.get("out_of_range", [])
            print(f"FAIL (total={v.get('total', '?')}) {oor[:2]}")
            fail_count += 1

        # Periodic save (every 10 essays)
        if idx % 10 == 0 or idx == total:
            report = {
                "meta": {
                    "model": args.model,
                    "base_url": args.base_url,
                    "total_verified": len(results),
                    "pass": pass_count,
                    "fail": fail_count,
                    "errors": error_count,
                    "last_updated": time.strftime("%Y-%m-%dT%H:%M:%S"),
                },
                "results": results,
            }
            with open(report_path, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            save_checkpoint(checkpoint_path, verified_keys)
            print(f"  [checkpoint] {len(results)} verified, {pass_count} pass, {fail_count} fail, {error_count} err")

    # Final summary
    print("\n" + "=" * 60)
    print("VERIFICATION SUMMARY")
    print("=" * 60)
    print(f"Total verified: {len(results)}")
    print(f"  PASS: {pass_count} ({100 * pass_count / max(1, len(results)):.1f}%)")
    print(f"  FAIL: {fail_count} ({100 * fail_count / max(1, len(results)):.1f}%)")
    print(f"  ERROR: {error_count}")
    print(f"Report: {report_path}")

    # Summary by level
    level_stats: Dict[str, Dict[str, int]] = {}
    for r in results:
        lvl = r.get("level", r.get("verdict", {}).get("level", "unknown"))
        if lvl not in level_stats:
            level_stats[lvl] = {"pass": 0, "fail": 0, "error": 0}
        if r.get("error"):
            level_stats[lvl]["error"] += 1
        elif r.get("verdict", {}).get("pass"):
            level_stats[lvl]["pass"] += 1
        else:
            level_stats[lvl]["fail"] += 1

    print("\nBy CEFR Level:")
    for lvl in sorted(level_stats.keys()):
        stats = level_stats[lvl]
        total_lvl = stats["pass"] + stats["fail"] + stats["error"]
        print(
            f"  {lvl}: {stats['pass']}/{total_lvl} pass "
            f"({100 * stats['pass'] / max(1, total_lvl):.0f}%)"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
