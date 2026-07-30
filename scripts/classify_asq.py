"""
ASQ Difficulty Classifier
==========================
Classifies Answer Short Question entries by difficulty using:
1. Answer word rarity (Zipf frequency)
2. Prompt vocabulary difficulty
3. Answer complexity (word count)
4. Domain specificity

Usage:
    python scripts/classify_asq.py                # Classify and update ASQ.xlsx
    python scripts/classify_asq.py --dry-run      # Show results without writing
"""

import sys
import io
import re

# Fix Windows console encoding
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import argparse
import shutil
from pathlib import Path
from datetime import datetime
from collections import Counter

import openpyxl
from wordfreq import zipf_frequency

# ============================================================================
# CONFIGURATION
# ============================================================================

ASQ_PATH = Path("public/database/quiz/ASQ/ASQ.xlsx")
SEPARATOR = "---"

# Zipf frequency thresholds (higher Zipf = more common)
# Based on calibration: ASQ answer Zipf median=4.07, stdev=0.91
# Common words: watch=5.34, doctor=4.90, lawyer=4.67
# Medium words: waiter=3.61, anonymous=4.17, peninsula=4.03
# Rare words:   entomologist=2.71, herbivore=2.39, pedagogy=3.12
ANSWER_ZIPF_EASY = 4.8      # >= this -> easy answer (common, everyday words)
ANSWER_ZIPF_HARD = 3.5      # < this -> hard answer (rare, academic terms)

PROMPT_ZIPF_EASY = 5.2      # avg content word Zipf >= this -> easy prompt
PROMPT_ZIPF_HARD = 4.5      # avg content word Zipf < this -> hard prompt

# Stop words for content word filtering
STOP_WORDS = {
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'shall', 'can', 'it', 'its',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we',
    'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
    'our', 'their', 'what', 'which', 'who', 'whom', 'whose', 'where',
    'when', 'how', 'why', 'not', 'no', 'if', 'then', 'than', 'too',
    'very', 'just', 'about', 'also', 'more', 'much', 'some', 'any',
    'all', 'both', 'each', 'few', 'other', 'such', 'only', 'own',
    'same', 'as', 'into', 'through', 'during', 'before', 'after',
    'above', 'below', 'between', 'out', 'off', 'over', 'under',
    'again', 'further', 'once', 'here', 'there', 'up', 'down',
    'so', 'nor'
}

# Domain keyword lists
GENERAL_KEYWORDS = {
    'color', 'colour', 'animal', 'animals', 'family', 'weather', 'food',
    'body', 'time', 'day', 'month', 'year', 'number', 'season', 'week',
    'morning', 'night', 'clothes', 'clothing', 'house', 'home', 'water',
    'fruit', 'vegetable', 'name', 'opposite', 'hot', 'cold', 'big', 'small',
    'wrist', 'watch', 'clock', 'birthday', 'age', 'old', 'young',
}
EVERYDAY_KEYWORDS = {
    'job', 'work', 'profession', 'occupation', 'travel', 'transport',
    'restaurant', 'hospital', 'school', 'teacher', 'student', 'country',
    'city', 'capital', 'money', 'buy', 'sell', 'shop', 'store', 'cook',
    'drive', 'car', 'bus', 'train', 'plane', 'airport', 'hotel',
    'movie', 'film', 'music', 'sport', 'game', 'newspaper', 'magazine',
    'telephone', 'phone', 'computer', 'serves', 'waiter', 'waitress',
}
ACADEMIC_KEYWORDS = {
    'science', 'scientific', 'research', 'study', 'experiment', 'theory',
    'medical', 'medicine', 'doctor', 'surgery', 'diagnosis', 'symptom',
    'law', 'legal', 'court', 'judge', 'attorney', 'legislation',
    'economy', 'economics', 'financial', 'technology', 'engineering',
    'history', 'historical', 'philosophy', 'psychology', 'sociology',
    'biology', 'chemistry', 'physics', 'mathematics', 'literature',
    'architecture', 'astronomy', 'geology', 'archaeology', 'anthropology',
    'taxonomy', 'species', 'genus', 'habitat', 'ecosystem',
    'molecule', 'atom', 'electron', 'proton', 'neutron',
    'hypothesis', 'methodology', 'analysis', 'correlation',
    'manuscript', 'bibliography', 'citation', 'thesis', 'dissertation',
    'anonymous', 'anonymity', 'terminology', 'nomenclature',
}


# ============================================================================
# CLASSIFICATION FUNCTIONS
# ============================================================================

def tokenize(text):
    """Extract words from text."""
    return re.findall(r"[a-zA-Z']+", text.lower())


def get_content_words(words):
    """Filter out stop words and very short words."""
    return [w for w in words if w not in STOP_WORDS and len(w) > 2]


def parse_asq_cell(answer_text):
    """Parse ASQ answer cell into prompt and accepted answers."""
    if not answer_text:
        return "", []
    text = str(answer_text).strip()
    parts = text.split(SEPARATOR, 1)
    prompt = parts[0].strip()
    answers = []
    if len(parts) > 1:
        raw_answers = parts[1].strip()
        answers = [a.strip() for a in raw_answers.split("/") if a.strip()]
    return prompt, answers


def score_answer_rarity(answers):
    """
    Score the rarity of accepted answers using Zipf frequency.
    Uses the MOST COMMON answer (highest Zipf) since that's what
    most students would say.
    Returns: 1 (easy/common), 2 (medium), 3 (hard/rare)
    """
    if not answers:
        return 2  # default medium

    # Get Zipf frequency of each answer (use first word for multi-word answers)
    zipf_scores = []
    for ans in answers:
        words = tokenize(ans)
        if not words:
            continue
        # For multi-word answers, use the average Zipf of content words
        content = get_content_words(words)
        if content:
            avg_zipf = sum(zipf_frequency(w, 'en') for w in content) / len(content)
        else:
            avg_zipf = sum(zipf_frequency(w, 'en') for w in words) / len(words)
        zipf_scores.append(avg_zipf)

    if not zipf_scores:
        return 2

    # Use the easiest (most common) answer since that's what students would typically say
    best_zipf = max(zipf_scores)

    if best_zipf >= ANSWER_ZIPF_EASY:
        return 1
    elif best_zipf < ANSWER_ZIPF_HARD:
        return 3
    else:
        return 2


def score_prompt_vocabulary(prompt):
    """
    Score the vocabulary difficulty of the question prompt.
    Returns: 1 (easy), 2 (medium), 3 (hard)
    """
    words = tokenize(prompt)
    content = get_content_words(words)
    if not content:
        return 1

    avg_zipf = sum(zipf_frequency(w, 'en') for w in content) / len(content)

    if avg_zipf >= PROMPT_ZIPF_EASY:
        return 1
    elif avg_zipf < PROMPT_ZIPF_HARD:
        return 3
    else:
        return 2


def score_answer_complexity(answers):
    """
    Score answer complexity based on word count.
    Returns: 1 (single word), 2 (2 words), 3 (3+ words or phrase)
    """
    if not answers:
        return 2

    # Use shortest accepted answer (easiest path for student)
    min_words = min(len(tokenize(a)) for a in answers)
    if min_words <= 1:
        return 1
    elif min_words <= 2:
        return 2
    else:
        return 3


def score_domain(prompt, answers):
    """
    Score domain specificity based on keywords.
    Returns: 1 (general), 2 (everyday), 3 (academic)
    """
    all_text = (prompt + " " + " ".join(answers)).lower()
    words = set(tokenize(all_text))

    academic_hits = len(words & ACADEMIC_KEYWORDS)
    everyday_hits = len(words & EVERYDAY_KEYWORDS)
    general_hits = len(words & GENERAL_KEYWORDS)

    if academic_hits >= 2:
        return 3
    elif academic_hits == 1 and everyday_hits == 0:
        return 3
    elif everyday_hits >= 1 or academic_hits == 1:
        return 2
    elif general_hits >= 1:
        return 1
    else:
        return 2  # default to medium if no domain match


def classify_question(prompt, answers):
    """
    Classify a single ASQ question into Level 1/2/3.
    Returns: (level, details_dict)
    """
    answer_rarity = score_answer_rarity(answers)
    prompt_vocab = score_prompt_vocabulary(prompt)
    answer_complexity = score_answer_complexity(answers)
    domain = score_domain(prompt, answers)

    # Weighted composite
    weighted = (
        answer_rarity * 0.35 +
        prompt_vocab * 0.25 +
        answer_complexity * 0.15 +
        domain * 0.25
    )

    if weighted <= 1.45:
        level = 1
    elif weighted >= 2.15:
        level = 3
    else:
        level = 2

    return level, {
        'answer_rarity': answer_rarity,
        'prompt_vocab': prompt_vocab,
        'answer_complexity': answer_complexity,
        'domain': domain,
        'weighted_score': round(weighted, 3),
    }


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Classify ASQ questions by difficulty")
    parser.add_argument("--dry-run", action="store_true", help="Show results without writing")
    parser.add_argument("--verbose", action="store_true", help="Show per-question details")
    args = parser.parse_args()

    if not ASQ_PATH.exists():
        print(f"ERROR: {ASQ_PATH} not found")
        return

    # Backup
    if not args.dry_run:
        backup = ASQ_PATH.parent / f"ASQ_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        shutil.copy2(ASQ_PATH, backup)
        print(f"Backup saved to: {backup}")

    # Load workbook
    wb = openpyxl.load_workbook(ASQ_PATH)
    ws = wb.active

    # Check headers
    headers = [cell.value for cell in ws[1]]
    print(f"Current headers: {headers}")

    # Add Level column if not present
    level_col = None
    for i, h in enumerate(headers):
        if h and str(h).strip().lower() in ('level', 'difficulty'):
            level_col = i + 1  # 1-indexed for openpyxl
            break

    if level_col is None:
        level_col = len(headers) + 1
        ws.cell(row=1, column=level_col, value="Level")
        print(f"Added 'Level' column at position {level_col}")
    else:
        print(f"Found existing Level column at position {level_col}")

    # Classify each question
    distribution = Counter()
    total = 0
    examples = {1: [], 2: [], 3: []}

    for row_idx in range(2, ws.max_row + 1):
        id_val = ws.cell(row=row_idx, column=1).value
        answer_cell = ws.cell(row=row_idx, column=2).value

        if not id_val or not answer_cell:
            continue

        prompt, answers = parse_asq_cell(answer_cell)
        if not prompt:
            continue

        level, details = classify_question(prompt, answers)
        distribution[level] += 1
        total += 1

        # Store example for spot-checking
        if len(examples[level]) < 5:
            examples[level].append({
                'id': id_val,
                'prompt': prompt[:80],
                'answers': answers[:3],
                'details': details,
            })

        if args.verbose:
            print(f"  ID={id_val}: L{level} (score={details['weighted_score']}) "
                  f"ans_rare={details['answer_rarity']} pv={details['prompt_vocab']} "
                  f"ac={details['answer_complexity']} dom={details['domain']} | "
                  f"{prompt[:60]}...")

        # Write level
        if not args.dry_run:
            ws.cell(row=row_idx, column=level_col, value=level)

    # Print distribution
    print(f"\n{'='*60}")
    print(f"ASQ Classification Results (Total: {total})")
    print(f"{'='*60}")
    for lvl in [1, 2, 3]:
        count = distribution[lvl]
        pct = round(count / total * 100, 1) if total > 0 else 0
        label = {1: 'Easy', 2: 'Medium', 3: 'Hard'}[lvl]
        print(f"  Level {lvl} ({label}): {count} ({pct}%)")

    # Print examples
    for lvl in [1, 2, 3]:
        label = {1: 'Easy', 2: 'Medium', 3: 'Hard'}[lvl]
        print(f"\n--- Sample Level {lvl} ({label}) ---")
        for ex in examples[lvl]:
            print(f"  ID={ex['id']}: {ex['prompt']}")
            print(f"    Answers: {', '.join(ex['answers'][:3])}")
            print(f"    Scores: {ex['details']}")

    # Save
    if not args.dry_run:
        wb.save(ASQ_PATH)
        print(f"\nSaved updated workbook to: {ASQ_PATH}")
    else:
        print(f"\n[DRY RUN] No changes written.")

    wb.close()


if __name__ == "__main__":
    main()
