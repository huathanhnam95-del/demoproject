"""
ESL Dictation Sentence Categorizer v2.1 (No-SpaCy Version)
===========================================================
Advanced sentence difficulty classification using:
- Lexical scoring (Zipf frequency, two-rarest average)
- Grammar scoring (regex-based pattern detection)
- Dictation scoring (contractions, numbers, lists, length, density)

This version uses regex-based NLP instead of spaCy to avoid Python 3.14 compatibility issues.

Usage:
    python classify_v2.py                    # Process both WFD.xlsx and RS.xlsx
    python classify_v2.py --file WFD.xlsx    # Process single file
    python classify_v2.py --dry-run          # Show results without writing

Dependencies:
    pip install pandas openpyxl wordfreq
"""

import pandas as pd
import re
import json
import argparse
import shutil
from pathlib import Path
from datetime import datetime
from wordfreq import zipf_frequency

# =============================================================================
# CONFIGURATION CONSTANTS (all tunable)
# =============================================================================

# === LEXICAL THRESHOLDS ===
LEX_HARD_THRESHOLD = 3.0    # rare_avg below this → lex_score = 2
LEX_MED_THRESHOLD = 3.9     # rare_avg below this → lex_score = 1

# === DICTATION THRESHOLDS ===
LONG_WORD_COUNT = 11        # word_count >= this → +1 dictation
DENSE_CONTENT_COUNT = 6     # content_count >= this → +1 dictation

# === SCORE CAPS ===
MAX_GRAMMAR_SCORE = 4
MAX_DICTATION_SCORE = 3

# === UK→US SPELLING NORMALIZATION ===
UK_US_MAP = {
    "enquire": "inquire", "enquiry": "inquiry", "organise": "organize",
    "organisation": "organization", "programme": "program", "analyse": "analyze",
    "labour": "labor", "favour": "favor", "practise": "practice",
    "colour": "color", "honour": "honor", "behaviour": "behavior",
    "travelling": "traveling", "cancelled": "canceled", "centre": "center",
    "metre": "meter", "litre": "liter", "defence": "defense",
    "offence": "offense", "licence": "license", "realise": "realize",
    "recognise": "recognize", "specialise": "specialize", "criticise": "criticize",
    "apologise": "apologize", "enquired": "inquired", "organised": "organized",
    "analysed": "analyzed", "realised": "realized", "recognised": "recognized",
}

# === FUNCTION WORDS (stopwords for lexical scoring) ===
FUNCTION_WORDS = {
    'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
    'at', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'it', 'its', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'our', 'their', 'as', 'if', 'so', 'then', 'than', 'when',
    'what', 'which', 'who', 'whom', 'whose', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'same', 'very', 'just', 'also', 'any', 'about', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again',
    'further', 'once', 'here', 'there', 'up', 'down', 'out', 'off', 'over',
    'too', 'own', 'now', 'even', 'still', 'already', 'yet', 'always', 'never',
}

# === GRAMMAR DETECTION LISTS ===
ADVANCED_SUBORDINATORS = {
    "although", "despite", "whereas", "provided", "providing",
    "unless", "nevertheless", "nonetheless", "notwithstanding"
}

ADVANCED_PHRASES = [
    "even though", "in case", "in which", "ways in which",
    "in order to", "rather than", "as a result", "in terms of",
    "as long as", "so that", "such that"
]

MODALS = {"might", "may", "must", "should", "could", "would"}

RELATIVE_MARKERS = {"who", "which", "whose", "whom", "where"}

# === CONTRACTION PATTERNS ===
CONTRACTION_PATTERN = r"(n't|'re|'ve|'ll|'d|'m|'s)\b"

# === PASSIVE VOICE PATTERNS ===
BE_FORMS = r"\b(is|are|was|were|be|been|being)\b"
PAST_PARTICIPLES = r"\b\w+(?:ed|en|t|wn|nt|built|sent|taught|brought|thought|caught|held|kept|left|led|met|paid|said|sold|set|sat|read|run|written|spoken|broken|chosen|driven|eaten|fallen|forgotten|frozen|gotten|grown|hidden|ridden|risen|shaken|stolen|sworn|torn|worn|woken|been)\b"

# === PERFECT ASPECT PATTERNS ===
HAVE_FORMS = r"\b(have|has|had)\b"

# === DEFAULT FILE PATHS ===
DEFAULT_FILES = [
    ("WFD.xlsx", "ANSWER"),
    ("database/speak/RS.xlsx", "ANSWER"),
]


# =============================================================================
# TEXT PROCESSING FUNCTIONS
# =============================================================================

def normalize_uk_us(word):
    """Convert UK spelling to US for Zipf lookup."""
    return UK_US_MAP.get(word.lower(), word.lower())


def get_words(sentence):
    """Extract words from sentence."""
    return re.findall(r"[a-zA-Z']+", sentence)


def get_content_words(sentence):
    """Extract content words (non-function words) for lexical analysis."""
    words = get_words(sentence)
    content = []
    for word in words:
        lower = word.lower()
        # Skip function words
        if lower in FUNCTION_WORDS:
            continue
        # Skip very short words
        if len(lower) < 2:
            continue
        # Skip words that look like proper nouns (capitalized in middle of sentence)
        # This is a heuristic - not perfect but helps
        content.append(lower)
    return content


def is_likely_proper_noun(word, position, words):
    """Heuristic to detect proper nouns (capitalized words not at start)."""
    if position == 0:
        return False  # First word is always capitalized
    
    # If the previous word ended with a sentence-finishing punctuation, this isn't a proper noun
    prev_word = words[position - 1]
    if any(p in prev_word for p in ".!?"):
        return False
        
    if word[0].isupper() and len(word) > 1:
        return True
    return False


# =============================================================================
# SCORING FUNCTIONS
# =============================================================================

def compute_lexical_score(sentence):
    """
    Compute lexical difficulty using two-rarest-average method.
    Returns: (lex_score, rare_avg, rare_words_info, content_count)
    """
    words = get_words(sentence)
    content_words = []
    
    for i, word in enumerate(words):
        lower = word.lower()
        # Skip function words
        if lower in FUNCTION_WORDS:
            continue
        # Skip very short words
        if len(lower) < 2:
            continue
        # Skip likely proper nouns (capitalized mid-sentence)
        if is_likely_proper_noun(word, i, words):
            continue
        content_words.append(lower)
    
    content_count = len(content_words)
    
    if not content_words:
        return 0, 9.0, [], 0
    
    # Get Zipf frequencies
    zipf_scores = []
    for word in content_words:
        normalized = normalize_uk_us(word)
        zipf = zipf_frequency(normalized, 'en')
        if zipf == 0:  # Unknown word — treat as rare
            zipf = 2.0
        zipf_scores.append((word, zipf))
    
    # Sort by Zipf ascending (rarest first)
    zipf_scores.sort(key=lambda x: x[1])
    
    # Two-rarest average
    if len(zipf_scores) >= 2:
        rare_avg = (zipf_scores[0][1] + zipf_scores[1][1]) / 2
        rare_words = zipf_scores[:2]
    else:
        rare_avg = zipf_scores[0][1]
        rare_words = zipf_scores[:1]
    
    # Assign score
    if rare_avg < LEX_HARD_THRESHOLD:
        lex_score = 2
    elif rare_avg < LEX_MED_THRESHOLD:
        lex_score = 1
    else:
        lex_score = 0
    
    rare_words_info = [f"{w}({z:.2f})" for w, z in rare_words]
    
    return lex_score, rare_avg, rare_words_info, content_count


def compute_grammar_score(sentence):
    """
    Compute grammar complexity score using regex patterns.
    Returns: (grammar_score, grammar_flags)
    """
    score = 0
    flags = []
    sentence_lower = sentence.lower()
    words = get_words(sentence_lower)
    
    # --- Advanced subordinators (+1) ---
    for sub in ADVANCED_SUBORDINATORS:
        pattern = r'\b' + re.escape(sub) + r'\b'
        if re.search(pattern, sentence_lower):
            score += 1
            flags.append(f"adv_sub({sub})")
            break
    
    # --- Advanced phrases (+1) ---
    for phrase in ADVANCED_PHRASES:
        if phrase in sentence_lower:
            score += 1
            flags.append(f"phrase({phrase})")
            break
    
    # --- Modals (+1) ---
    for modal in MODALS:
        if modal in words:
            score += 1
            flags.append(f"modal({modal})")
            break
    
    # --- Passive voice (+1): be-form + past participle pattern (allow adverbs) ---
    # Loosened to allow up to 2 intervening words (e.g., "is not often done")
    # We filter out very short words like "red" or "open" that mimic participles
    passive_pattern = r"\b(is|are|was|were|be|been|being)\s+(?:\w+\s+){0,2}\b([a-zA-Z]{3,}(?:ed|en|wn|nt)|built|sent|taught|brought|thought|caught|held|kept|left|led|met|paid|said|sold|set|sat|read|run|written|spoken|broken|chosen|driven|eaten|fallen|forgotten|frozen|gotten|grown|hidden|ridden|risen|shaken|stolen|sworn|torn|worn|woken|been)\b"
    match = re.search(passive_pattern, sentence_lower)
    if match:
        verb = match.group(2)
        # Exclude common false positives
        if verb not in {"open", "even", "often", "when", "then", "been"}:
            score += 1
            flags.append(f"passive({match.group(0)})")
    
    # --- Perfect aspect (+1): have/has/had + past participle (allow adverbs/not) ---
    perfect_pattern = r"\b(have|has|had)\s+(?:\w+\s+){0,2}\b([a-zA-Z]{3,}(?:ed|en|wn|nt)|built|sent|taught|brought|thought|caught|held|kept|left|led|met|paid|said|sold|set|sat|read|run|written|spoken|broken|chosen|driven|eaten|fallen|forgotten|frozen|gotten|grown|hidden|ridden|risen|shaken|stolen|sworn|torn|worn|woken|been)\b"
    match = re.search(perfect_pattern, sentence_lower)
    if match:
        verb = match.group(2)
        # Avoid double-counting modal perfect
        modal_pref = r"\b(might|may|must|should|could|would)\s+(?:not\s+)?have\b"
        if not re.search(modal_pref, sentence_lower) and verb not in {"open", "even", "often", "when", "then"}:
            score += 1
            flags.append(f"perfect({match.group(0)})")
    
    # --- Modal perfect (+1): modal + have + past participle ---
    modal_perfect_pattern = r"\b(might|may|must|should|could|would)\s+(?:not\s+)?have\s+(?:\w+\s+){0,2}\b" + PAST_PARTICIPLES + r"\b"
    match = re.search(modal_perfect_pattern, sentence_lower)
    if match:
        score += 1
        flags.append(f"modal_perfect({match.group(0)})")
    
    # --- Relative markers (+1) ---
    for marker in RELATIVE_MARKERS:
        if marker in words:
            score += 1
            flags.append(f"relative({marker})")
            break
    
    # Cap the score
    score = min(score, MAX_GRAMMAR_SCORE)
    
    return score, flags


def compute_dictation_score(sentence, word_count, content_count):
    """
    Compute dictation-specific difficulty.
    Returns: (dictation_score, dictation_flags)
    """
    score = 0
    flags = []
    
    # --- Contractions (+1) ---
    if re.search(CONTRACTION_PATTERN, sentence, re.IGNORECASE):
        score += 1
        flags.append("contraction")
    
    # --- Numbers (+1) ---
    if re.search(r'\d', sentence):
        score += 1
        flags.append("number")
    
    # --- List/enumeration (+1) ---
    comma_count = sentence.count(',')
    has_list = False
    if comma_count >= 2:
        has_list = True
    elif comma_count == 1:
        if re.search(r',\s*\w+\s+(and|or)\b', sentence, re.IGNORECASE):
            has_list = True
    if has_list:
        score += 1
        flags.append("list_enum")
    
    # --- Long sentence (+1) ---
    if word_count >= LONG_WORD_COUNT:
        score += 1
        flags.append(f"long({word_count})")
    
    # --- High content density (+1) ---
    if content_count >= DENSE_CONTENT_COUNT:
        score += 1
        flags.append(f"dense({content_count})")
    
    # Cap the score
    score = min(score, MAX_DICTATION_SCORE)
    
    return score, flags


def assign_level(lex_score, grammar_score, dictation_score, word_count, content_count):
    """
    Assign difficulty level 1, 2, or 3.
    Uses two totals to prevent dictation-only escalation to Level 3.
    """
    total_all = lex_score + grammar_score + dictation_score
    total_core = lex_score + grammar_score
    
    # === LEVEL 3 ===
    if lex_score == 2 and grammar_score >= 1:
        return 3
    if grammar_score >= 2:
        return 3
    if total_core >= 4:
        return 3
    
    # === LEVEL 2 ===
    if total_all >= 3:
        return 2
    if word_count >= LONG_WORD_COUNT and (lex_score >= 1 or grammar_score >= 1 or content_count >= DENSE_CONTENT_COUNT):
        return 2
    if dictation_score >= 2 and (lex_score >= 1 or grammar_score >= 1):
        return 2
    
    # === LEVEL 1 ===
    return 1


def build_reasons(lex_score, rare_avg, rare_words_info, grammar_flags, dictation_flags):
    """Build human-readable reasons string."""
    parts = []
    
    if rare_words_info:
        words_str = ", ".join(rare_words_info)
        parts.append(f"lex={lex_score}(rare_avg={rare_avg:.2f}: {words_str})")
    else:
        parts.append(f"lex={lex_score}(no_content_words)")
    
    if grammar_flags:
        parts.append(f"grammar={'; '.join(grammar_flags)}")
    
    if dictation_flags:
        parts.append(f"dictation={'; '.join(dictation_flags)}")
    
    return " | ".join(parts)


# =============================================================================
# CLASSIFICATION FUNCTIONS
# =============================================================================

def classify_sentence(sentence):
    """Classify a single sentence."""
    if not isinstance(sentence, str) or not sentence.strip():
        return {
            "sentence": str(sentence),
            "level": 1,
            "lex_score": 0,
            "grammar_score": 0,
            "dictation_score": 0,
            "word_count": 0,
            "content_count": 0,
            "rare_avg": 9.0,
            "reasons": "empty_sentence"
        }
    
    word_count = len(sentence.split())
    
    lex_score, rare_avg, rare_words_info, content_count = compute_lexical_score(sentence)
    grammar_score, grammar_flags = compute_grammar_score(sentence)
    dictation_score, dictation_flags = compute_dictation_score(sentence, word_count, content_count)
    
    level = assign_level(lex_score, grammar_score, dictation_score, word_count, content_count)
    reasons = build_reasons(lex_score, rare_avg, rare_words_info, grammar_flags, dictation_flags)
    
    return {
        "sentence": sentence,
        "level": level,
        "lex_score": lex_score,
        "grammar_score": grammar_score,
        "dictation_score": dictation_score,
        "word_count": word_count,
        "content_count": content_count,
        "rare_avg": round(rare_avg, 2),
        "reasons": reasons
    }


def classify_all(sentences):
    """Classify all sentences with progress updates."""
    results = []
    total = len(sentences)
    
    for i, sentence in enumerate(sentences):
        if (i + 1) % 500 == 0:
            print(f"  Processing {i+1}/{total}...")
        
        result = classify_sentence(sentence)
        result["id"] = i + 1
        results.append(result)
    
    print(f"  Completed {total} sentences.")
    return results


# =============================================================================
# FILE I/O FUNCTIONS
# =============================================================================

def load_xlsx(file_path, sentence_column):
    """Load XLSX and return DataFrame."""
    df = pd.read_excel(file_path, engine='openpyxl')
    print(f"Loaded {len(df)} rows from {file_path}")
    print(f"Columns: {list(df.columns)}")
    
    if sentence_column not in df.columns:
        raise ValueError(f"Column '{sentence_column}' not found. Available: {list(df.columns)}")
    
    return df


def backup_file(file_path):
    """Create a timestamped backup."""
    path = Path(file_path)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = path.parent / f"{path.stem}_backup_{timestamp}{path.suffix}"
    shutil.copy2(file_path, backup_path)
    print(f"  Backup created: {backup_path}")
    return backup_path


def save_results(df, results, file_path, dry_run=False):
    """Save results back to XLSX and as CSV."""
    df['Level'] = [r['level'] for r in results]
    df['lex_score'] = [r['lex_score'] for r in results]
    df['grammar_score'] = [r['grammar_score'] for r in results]
    df['dictation_score'] = [r['dictation_score'] for r in results]
    df['reasons'] = [r['reasons'] for r in results]
    
    path = Path(file_path)
    csv_path = path.parent / f"{path.stem}_classified.csv"
    
    if dry_run:
        print(f"  [DRY RUN] Would write to: {file_path}")
        print(f"  [DRY RUN] Would export CSV to: {csv_path}")
    else:
        backup_file(file_path)
        df.to_excel(file_path, index=False, engine='openpyxl')
        print(f"  Updated XLSX: {file_path}")
        df.to_csv(csv_path, index=False)
        print(f"  Exported CSV: {csv_path}")
    
    return df


def save_combined_json(all_results, output_path="all_classified.json", dry_run=False):
    """Save combined results as JSON."""
    if dry_run:
        print(f"[DRY RUN] Would write JSON to: {output_path}")
    else:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(all_results, f, indent=2, ensure_ascii=False)
        print(f"Saved combined JSON: {output_path}")


# =============================================================================
# REPORTING FUNCTIONS
# =============================================================================

def print_distribution(results, file_name):
    """Print level distribution."""
    print(f"\n=== LEVEL DISTRIBUTION: {file_name} ===")
    counts = {1: 0, 2: 0, 3: 0}
    for r in results:
        counts[r['level']] = counts.get(r['level'], 0) + 1
    
    total = len(results)
    for level in [1, 2, 3]:
        count = counts.get(level, 0)
        pct = count / total * 100 if total > 0 else 0
        print(f"  Level {level}: {count:>5} ({pct:>5.1f}%)")
    print(f"  Total:   {total:>5}")


def print_samples(results, file_name, n_per_level=10):
    """Print random samples from each level."""
    import random
    
    print(f"\n=== RANDOM SAMPLES: {file_name} ===")
    for level in [1, 2, 3]:
        level_results = [r for r in results if r['level'] == level]
        samples = random.sample(level_results, min(n_per_level, len(level_results)))
        
        print(f"\n--- Level {level} ({len(level_results)} total) ---")
        for r in samples:
            print(f"[{r['id']}] {r['sentence'][:80]}{'...' if len(r['sentence']) > 80 else ''}")
            print(f"    Scores: lex={r['lex_score']}, gram={r['grammar_score']}, dict={r['dictation_score']}")
            print(f"    Reasons: {r['reasons'][:100]}{'...' if len(r['reasons']) > 100 else ''}")
            print()


def test_specific_sentences():
    """Test known problem sentences."""
    test_sentences = [
        ("You should enquire about the direct deposit.", 2, "UK normalization + modal"),
        ("Market research surveys might be conducted by telephone, the internet, or in person.", 2, "modal + passive + list"),
        ("Detailed analysis of population growth has revealed some alarming predictions.", 2, "perfect + density"),
        ("During some stages of sleep, your eyes move rapidly behind your closed eyelids.", 2, "long + density"),
        ("A new report outlines ways in which cities should address transport issues.", 2, "phrase + modal"),
        ("Please confirm that you have received the textbook.", 1, "simple sentence"),
    ]
    
    print("\n=== TEST SENTENCE VALIDATION ===")
    all_passed = True
    
    for sentence, expected, reason in test_sentences:
        result = classify_sentence(sentence)
        status = "✓" if result['level'] == expected else "✗"
        if result['level'] != expected:
            all_passed = False
        
        print(f"\n{status} \"{sentence[:60]}...\"")
        print(f"  Expected: Level {expected} ({reason})")
        print(f"  Got:      Level {result['level']}")
        print(f"  Scores:   lex={result['lex_score']}, gram={result['grammar_score']}, dict={result['dictation_score']}")
        print(f"  Reasons:  {result['reasons']}")
    
    return all_passed


def calibration_helper(results):
    """Show threshold tuning information."""
    print("\n=== CALIBRATION HELPER ===")
    print("Current thresholds:")
    print(f"  LEX_HARD_THRESHOLD = {LEX_HARD_THRESHOLD}")
    print(f"  LEX_MED_THRESHOLD = {LEX_MED_THRESHOLD}")
    print(f"  LONG_WORD_COUNT = {LONG_WORD_COUNT}")
    print(f"  DENSE_CONTENT_COUNT = {DENSE_CONTENT_COUNT}")
    
    rare_avgs = [r["rare_avg"] for r in results]
    word_counts = [r["word_count"] for r in results]
    content_counts = [r["content_count"] for r in results]
    
    print(f"\nrare_avg: Min={min(rare_avgs):.2f}, Max={max(rare_avgs):.2f}, Median={sorted(rare_avgs)[len(rare_avgs)//2]:.2f}")
    
    print(f"\nLEX_MED threshold impact:")
    for threshold in [3.5, 3.7, 3.9, 4.0, 4.2]:
        count_lex1 = sum(1 for r in rare_avgs if r < threshold and r >= LEX_HARD_THRESHOLD)
        count_lex2 = sum(1 for r in rare_avgs if r < LEX_HARD_THRESHOLD)
        count_lex0 = sum(1 for r in rare_avgs if r >= threshold)
        print(f"  If LEX_MED={threshold}: lex=0:{count_lex0}, lex=1:{count_lex1}, lex=2:{count_lex2}")
    
    print(f"\nword_count: Min={min(word_counts)}, Max={max(word_counts)}")
    for wc in [9, 10, 11, 12]:
        count = sum(1 for w in word_counts if w >= wc)
        print(f"  word_count >= {wc}: {count} ({count/len(results)*100:.1f}%)")


# =============================================================================
# MAIN EXECUTION
# =============================================================================

def process_file(file_path, sentence_column, dry_run=False):
    """Process a single XLSX file."""
    print(f"\n{'='*60}")
    print(f"Processing: {file_path}")
    print(f"{'='*60}")
    
    if not Path(file_path).exists():
        print(f"  WARNING: File not found: {file_path}")
        return None, None
    
    df = load_xlsx(file_path, sentence_column)
    sentences = df[sentence_column].astype(str).tolist()
    
    print(f"\nClassifying {len(sentences)} sentences...")
    results = classify_all(sentences)
    
    df = save_results(df, results, file_path, dry_run=dry_run)
    print_distribution(results, Path(file_path).name)
    
    return results, df


def main():
    """Main execution flow."""
    parser = argparse.ArgumentParser(description="ESL Dictation Sentence Categorizer v2.1")
    parser.add_argument("--file", type=str, help="Process a single XLSX file")
    parser.add_argument("--column", type=str, default="ANSWER", help="Sentence column name")
    parser.add_argument("--dry-run", action="store_true", help="Show results without writing")
    parser.add_argument("--test-only", action="store_true", help="Only run test sentences")
    parser.add_argument("--samples", type=int, default=10, help="Samples per level to show")
    args = parser.parse_args()
    
    print("ESL Dictation Categorizer v2.1 (Regex-based, no spaCy)")
    print("=" * 60)
    
    if args.test_only:
        test_specific_sentences()
        return
    
    if args.file:
        files_to_process = [(args.file, args.column)]
    else:
        files_to_process = DEFAULT_FILES
    
    all_results = {}
    for file_path, sentence_column in files_to_process:
        results, df = process_file(file_path, sentence_column, dry_run=args.dry_run)
        if results:
            all_results[file_path] = results
            print_samples(results, Path(file_path).name, n_per_level=args.samples)
    
    if all_results:
        combined = []
        for file_path, results in all_results.items():
            for r in results:
                r['source_file'] = str(file_path)
                combined.append(r)
        save_combined_json(combined, dry_run=args.dry_run)
        calibration_helper(combined)
    
    print("\n")
    test_specific_sentences()
    
    print("\n" + "="*60)
    print("DONE. Next steps:")
    print("  1. Review the _classified.csv files")
    print("  2. Run: node update-database.js WFD.xlsx type")
    print("  3. Run: node update-database.js database/speak/RS.xlsx speak")
    print("="*60)


if __name__ == "__main__":
    main()
