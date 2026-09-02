"""
DI (Describe Image) Difficulty Classifier — Hybrid Text-Visual Assessment
==========================================================================
Analyzes DI questions using image type, title, key data points, and the full sample answer
against the official PTE Describe Image scoring rubric.

Usage:
    python scripts/classify_di.py --dry-run     # Test on 10 sample items
    python scripts/classify_di.py               # Full run (all 1170 items)
"""

import sys
import io
import os
import re
import json
import time
import shutil
import argparse
import requests
from pathlib import Path
from datetime import datetime
from collections import Counter

# Fix Windows console encoding and line buffering
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

# ============================================================================
# CONFIGURATION
# ============================================================================

DB_PATH = Path("public/database/Describe Image/describe-image-questions.json")
LOG_PATH = Path("scratch/di_classification_log.json")

OLLAMA_URL = os.getenv("OLLAMA_CHAT_URL", "http://localhost:11434/api/chat")
MODEL_NAME = os.getenv("LOCAL_GEMMA_MODEL", "gemma4:12b")
TIMEOUT = 60  # Seconds per classification call

# ============================================================================
# DI SCORING RUBRIC
# ============================================================================

DI_RUBRIC = """You are an expert PTE (Pearson Test of English) assessor. Classify the difficulty of a "Describe Image" task.

In PTE Describe Image, students see an image and must describe it verbally in 25 seconds.

## Classification Rubric

| Factor | Weight | Level 1 (Easy) | Level 2 (Medium) | Level 3 (Hard) |
|--------|--------|----------------|-------------------|----------------|
| **Visual complexity** | 0.30 | Single chart/simple photo, 2-3 data points, clear layout | Multiple data series, moderate detail, some interpretation needed | Complex multi-panel, dense data, overlapping elements, abstract concepts |
| **Data interpretation** | 0.25 | Obvious trends, simple comparisons (biggest/smallest) | Requires comparison across categories, identifying patterns | Requires correlation, cause-effect reasoning, or multi-step analysis |
| **Vocabulary demand** | 0.20 | Common descriptive words (big, small, increase, decrease) | Domain-specific but common (percentage, proportion, axis) | Technical/academic vocabulary (correlation, exponential, demographic transition) |
| **Image type difficulty** | 0.15 | Simple bar chart, pie chart, single photo | Line graph with multiple series, table, labeled diagram | Flow chart, process diagram, map with overlay, combination chart |
| **Description structure** | 0.10 | Can describe linearly (left to right, top to bottom) | Needs some grouping or categorization | Requires hierarchical description, prioritization of complex elements |

## Response Format
Respond with ONLY a JSON object:
{"level": 1|2|3, "reasoning": "brief explanation"}
"""

# ============================================================================
# CLASSIFICATION LOGIC
# ============================================================================

def call_ollama(prompt, timeout=TIMEOUT):
    """Call Ollama for text classification."""
    payload = {
        "model": MODEL_NAME,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.2, "num_predict": 150}
    }
    try:
        r = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
        r.raise_for_status()
        data = r.json()
        return data.get("message", {}).get("content", "")
    except Exception as e:
        print(f"    [ERROR] Ollama call failed: {e}")
        return None


def parse_level(response_text):
    """Extract level (1/2/3) from LLM response."""
    if not response_text:
        return None

    text = re.sub(r'<think>.*?</think>', '', response_text, flags=re.DOTALL).strip()

    try:
        data = json.loads(text)
        level = data.get('level')
        if level in [1, 2, 3]:
            return level
    except json.JSONDecodeError:
        pass

    json_match = re.search(r'\{[^{}]*"level"\s*:\s*([123])[^{}]*\}', text)
    if json_match:
        return int(json_match.group(1))

    level_match = re.search(r'(?:level|difficulty)\s*[:=]?\s*([123])', text, re.IGNORECASE)
    if level_match:
        return int(level_match.group(1))

    return None


def classify_entry(entry):
    """Classify difficulty of a single DI entry based on title, type, and sample answer."""
    eid = str(entry['id'])
    title = entry.get('title', '')
    img_type = entry.get('type', 'unknown')
    old_level = entry.get('level', 2)
    sample_full = entry.get('sampleAnswer', {}).get('full', '')
    sample_simple = entry.get('sampleAnswer', {}).get('simple', '')

    prompt = f"""{DI_RUBRIC}

## Task Details
- ID: {eid}
- Title: {title}
- Image Type: {img_type}

## Detailed Image Description (Sample Response):
{sample_full}

## Simple Summary:
{sample_simple}

Classify the difficulty level (1=Easy, 2=Medium, 3=Hard) for this task based on the rubric above.
Respond with ONLY JSON: {{"level": 1|2|3, "reasoning": "brief explanation"}}"""

    res = call_ollama(prompt)
    level = parse_level(res)
    if level is None:
        level = old_level

    return {
        'id': eid,
        'title': title,
        'type': img_type,
        'old_level': old_level,
        'new_level': level,
        'reasoning': res
    }


def main():
    parser = argparse.ArgumentParser(description="DI Difficulty Classifier")
    parser.add_argument("--dry-run", action="store_true", help="Test on 10 sample items")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"ERROR: {DB_PATH} not found")
        return

    with open(DB_PATH, 'r', encoding='utf-8') as f:
        entries = json.load(f)
    print(f"Loaded {len(entries)} DI entries from database")

    process_list = entries[:10] if args.dry_run else entries
    results = []
    level_dist = Counter()
    changes = 0
    start_time = time.time()

    print(f"\nProcessing {len(process_list)} items with model {MODEL_NAME}...\n")

    for i, entry in enumerate(process_list):
        eid = str(entry['id'])
        title = entry.get('title', '')
        old_level = entry.get('level', 2)

        # Resume logic: skip already classified items
        if not args.dry_run and entry.get('_classified'):
            print(f"[{i+1}/{len(process_list)}] ID={eid} '{title[:35]}' (type={entry.get('type')}) → Already classified. Skipping.")
            continue

        elapsed = time.time() - start_time
        avg_per_item = elapsed / max(i, 1) if i > 0 else 0
        eta = avg_per_item * (len(process_list) - i)

        res = classify_entry(entry)
        new_level = res['new_level']

        if new_level != old_level:
            changes += 1
        level_dist[new_level] += 1
        results.append(res)

        print(f"[{i+1}/{len(process_list)}] ID={eid} '{title[:35]}' (type={entry.get('type')}) → Old: L{old_level} | New: L{new_level} [ETA: {eta/60:.1f}m]")

        if not args.dry_run:
            entry['level'] = new_level
            entry['_classified'] = True
            
        # Save periodically (every 50 items) to avoid data loss on crash
        if not args.dry_run and (i + 1) % 50 == 0:
            with open(DB_PATH, 'w', encoding='utf-8') as f:
                json.dump(entries, f, ensure_ascii=False, indent=2)
            with open(LOG_PATH, 'w', encoding='utf-8') as f:
                json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"DI Final Classification Summary (Total: {len(process_list)})")
    print(f"{'='*60}")
    for lvl in [1, 2, 3]:
        c = level_dist[lvl]
        pct = (c / len(process_list) * 100) if process_list else 0
        label = {1: 'Easy', 2: 'Medium', 3: 'Hard'}[lvl]
        print(f"  Level {lvl} ({label}): {c} ({pct:.1f}%)")
    print(f"  Changed levels: {changes}/{len(process_list)}")

    if not args.dry_run:
        # Backup DB
        backup = DB_PATH.parent / f"describe-image-questions_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        shutil.copy2(DB_PATH, backup)
        print(f"Backup saved to: {backup}")

        # Update JSON DB
        with open(DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
        print(f"Updated database at {DB_PATH}")

        # Save Log
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_PATH, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"Saved classification log to {LOG_PATH}")


if __name__ == "__main__":
    main()
