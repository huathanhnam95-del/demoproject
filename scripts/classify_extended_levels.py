"""
Classify Fill mode (extended) items into difficulty levels 1..3.

Usage:
  python scripts/classify_extended_levels.py --dry-run
  python scripts/classify_extended_levels.py --write
  python scripts/classify_extended_levels.py --input public/database/extended/index.json --write
"""

from __future__ import annotations

import argparse
import json
import random
import re
import shutil
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from wordfreq import zipf_frequency

GAP_PATTERN = re.compile(r"__([^_]+)__")

# Concept thresholds
CONCEPT_HARD_RARE2 = 3.0
CONCEPT_MED_RARE2 = 3.8
CONCEPT_HARD_MIN = 2.6
CONCEPT_MED_MIN = 3.2

# Collocation thresholds
COLLOC_HARD_RARE2 = 2.8
COLLOC_MED_RARE2 = 3.4
COLLOC_HARD_MIN = 2.4
COLLOC_MED_MIN = 3.0

# Load thresholds
LOAD_HARD_GAPS = 9
LOAD_MED_GAPS = 6

ABSTRACT_SUFFIXES = (
    "tion",
    "sion",
    "ment",
    "ness",
    "ity",
    "ism",
    "ance",
    "ence",
    "ship",
    "ology",
    "logy",
    "ics",
    "graphy",
    "phobia",
    "philia",
    "ization",
    "isation",
)

TOKEN_STRIP_CHARS = "\"'.,!?;:()[]{}<>`"


@dataclass
class ItemMetrics:
    gap_count: int
    abstract_gap_count: int
    gap_min_zipf: float
    gap_rare2_avg: float
    colloc_min_zipf: float
    colloc_rare2_avg: float


@dataclass
class ItemScores:
    concept_score: int
    collocation_score: int
    load_score: int
    core_score: int
    level: int


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for raw in re.split(r"\s+", text.lower()):
        token = raw.strip(TOKEN_STRIP_CHARS)
        if token:
            tokens.append(token)
    return tokens


def replace_gaps_with_slots(transcript: str) -> tuple[str, list[str]]:
    gaps: list[str] = []

    def replacer(match: re.Match[str]) -> str:
        slot = f"gapslot_{len(gaps)}"
        gap_word = match.group(1).strip().lower()
        gaps.append(gap_word)
        return f" {slot} "

    slotted = GAP_PATTERN.sub(replacer, transcript)
    return slotted, gaps


def get_rare2_average(values: list[float], default_value: float) -> float:
    if not values:
        return default_value
    sorted_values = sorted(values)
    first = sorted_values[0]
    second = sorted_values[1] if len(sorted_values) > 1 else first
    return (first + second) / 2


def get_gap_context_phrases(tokens: list[str], gap_position: int) -> list[str]:
    candidates: set[str] = set()
    token_count = len(tokens)

    if gap_position - 1 >= 0:
        candidates.add(f"{tokens[gap_position - 1]} {tokens[gap_position]}")
    if gap_position + 1 < token_count:
        candidates.add(f"{tokens[gap_position]} {tokens[gap_position + 1]}")
    if gap_position - 1 >= 0 and gap_position + 1 < token_count:
        candidates.add(
            f"{tokens[gap_position - 1]} {tokens[gap_position]} {tokens[gap_position + 1]}"
        )
    if gap_position - 2 >= 0:
        candidates.add(
            f"{tokens[gap_position - 2]} {tokens[gap_position - 1]} {tokens[gap_position]}"
        )
    if gap_position + 2 < token_count:
        candidates.add(
            f"{tokens[gap_position]} {tokens[gap_position + 1]} {tokens[gap_position + 2]}"
        )

    return [phrase for phrase in candidates if phrase]


def compute_item_metrics(transcript: str) -> ItemMetrics:
    slotted_text, gaps = replace_gaps_with_slots(transcript)
    gap_count = len(gaps)

    if gap_count == 0:
        return ItemMetrics(
            gap_count=0,
            abstract_gap_count=0,
            gap_min_zipf=9.0,
            gap_rare2_avg=9.0,
            colloc_min_zipf=9.0,
            colloc_rare2_avg=9.0,
        )

    gap_zipf_scores = [zipf_frequency(word, "en") for word in gaps]
    gap_min_zipf = min(gap_zipf_scores) if gap_zipf_scores else 9.0
    gap_rare2_avg = get_rare2_average(gap_zipf_scores, 9.0)
    abstract_gap_count = sum(
        1 for word in gaps if any(word.endswith(suffix) for suffix in ABSTRACT_SUFFIXES)
    )

    tokens = tokenize(slotted_text)
    gap_positions: dict[int, int] = {}
    for idx, token in enumerate(tokens):
        if token.startswith("gapslot_"):
            suffix = token.split("_", 1)[1]
            if suffix.isdigit():
                gap_positions[int(suffix)] = idx

    per_gap_colloc_min_scores: list[float] = []
    for gap_idx, gap_word in enumerate(gaps):
        position = gap_positions.get(gap_idx)
        if position is None:
            continue

        tokens_with_gap = list(tokens)
        tokens_with_gap[position] = gap_word
        phrases = get_gap_context_phrases(tokens_with_gap, position)
        if not phrases:
            continue

        phrase_scores = [zipf_frequency(phrase, "en") for phrase in phrases]
        non_zero_scores = [score for score in phrase_scores if score > 0]
        active_scores = non_zero_scores if non_zero_scores else phrase_scores
        per_gap_colloc_min_scores.append(min(active_scores))

    colloc_min_zipf = (
        min(per_gap_colloc_min_scores) if per_gap_colloc_min_scores else 9.0
    )
    colloc_rare2_avg = get_rare2_average(per_gap_colloc_min_scores, 9.0)

    return ItemMetrics(
        gap_count=gap_count,
        abstract_gap_count=abstract_gap_count,
        gap_min_zipf=gap_min_zipf,
        gap_rare2_avg=gap_rare2_avg,
        colloc_min_zipf=colloc_min_zipf,
        colloc_rare2_avg=colloc_rare2_avg,
    )


def compute_scores(metrics: ItemMetrics) -> ItemScores:
    if metrics.gap_rare2_avg < CONCEPT_HARD_RARE2 or metrics.gap_min_zipf < CONCEPT_HARD_MIN:
        concept_score = 2
    elif metrics.gap_rare2_avg < CONCEPT_MED_RARE2 or metrics.gap_min_zipf < CONCEPT_MED_MIN:
        concept_score = 1
    else:
        concept_score = 0

    if metrics.abstract_gap_count >= 2 and concept_score < 2:
        concept_score += 1

    if (
        metrics.colloc_rare2_avg < COLLOC_HARD_RARE2
        or metrics.colloc_min_zipf < COLLOC_HARD_MIN
    ):
        collocation_score = 2
    elif (
        metrics.colloc_rare2_avg < COLLOC_MED_RARE2
        or metrics.colloc_min_zipf < COLLOC_MED_MIN
    ):
        collocation_score = 1
    else:
        collocation_score = 0

    if metrics.gap_count >= LOAD_HARD_GAPS:
        load_score = 2
    elif metrics.gap_count >= LOAD_MED_GAPS:
        load_score = 1
    else:
        load_score = 0

    core_score = 2 * concept_score + 2 * collocation_score + load_score

    if core_score >= 6 or (concept_score == 2 and collocation_score >= 1):
        level = 3
    elif core_score >= 3:
        level = 2
    else:
        level = 1

    return ItemScores(
        concept_score=concept_score,
        collocation_score=collocation_score,
        load_score=load_score,
        core_score=core_score,
        level=level,
    )


def build_reason(metrics: ItemMetrics, scores: ItemScores) -> str:
    return (
        f"concept={scores.concept_score}(rare2={metrics.gap_rare2_avg:.2f}; "
        f"min={metrics.gap_min_zipf:.2f}; abstract={metrics.abstract_gap_count}) | "
        f"collocation={scores.collocation_score}(rare2={metrics.colloc_rare2_avg:.2f}; "
        f"min={metrics.colloc_min_zipf:.2f}) | "
        f"load={scores.load_score}(gaps={metrics.gap_count}) | "
        f"core={scores.core_score}"
    )


def classify_items(items: list[dict]) -> tuple[Counter, dict[int, list[dict]]]:
    distribution: Counter = Counter()
    samples_by_level: dict[int, list[dict]] = defaultdict(list)

    for item in items:
        transcript = str(item.get("transcript", ""))
        metrics = compute_item_metrics(transcript)
        scores = compute_scores(metrics)
        item["level"] = scores.level
        distribution[scores.level] += 1

        samples_by_level[scores.level].append(
            {
                "id": item.get("id"),
                "category": item.get("category", ""),
                "reason": build_reason(metrics, scores),
            }
        )

    return distribution, samples_by_level


def print_summary(
    item_count: int,
    distribution: Counter,
    samples_by_level: dict[int, list[dict]],
    sample_count: int,
) -> None:
    print(f"Processed {item_count} items.")
    for level in (1, 2, 3):
        print(f"  Level {level}: {distribution.get(level, 0)}")

    random.seed(42)
    for level in (1, 2, 3):
        level_samples = samples_by_level.get(level, [])
        if not level_samples:
            continue
        selected = random.sample(level_samples, min(sample_count, len(level_samples)))
        print(f"\nSample Level {level} items:")
        for entry in selected:
            print(
                f"  id={entry['id']} category={entry['category']} reason={entry['reason']}"
            )


def write_output(path: Path, payload: dict) -> None:
    backup_path = path.with_name(f"{path.name}.backup.levels.{int(time.time())}")
    shutil.copy2(path, backup_path)
    print(f"Backup created: {backup_path}")

    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote updated levels to: {path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Classify Fill mode extended item levels.")
    parser.add_argument(
        "--input",
        default="public/database/extended/index.json",
        help="Path to extended index.json",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Persist computed levels back to the input file",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write output (default behavior)",
    )
    parser.add_argument(
        "--sample-count",
        type=int,
        default=3,
        help="How many sample items per level to print",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        return 1

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    items = payload.get("items", [])
    if not isinstance(items, list):
        print("Invalid payload: expected 'items' list.")
        return 1

    distribution, samples_by_level = classify_items(items)
    print_summary(len(items), distribution, samples_by_level, max(0, args.sample_count))

    should_write = args.write and not args.dry_run
    if should_write:
        write_output(input_path, payload)
    else:
        print("\nDry run complete (no files written).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
