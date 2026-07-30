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

try:
    from mutagen.mp3 import MP3
    HAS_MUTAGEN = True
except ImportError:
    HAS_MUTAGEN = False
    print("WARNING: mutagen not installed. Audio duration features will be disabled. (pip install mutagen)")

# =============================================================================
# CONFIGURATION CONSTANTS (all tunable)
# =============================================================================

# === LEXICAL THRESHOLDS ===
LEX_HARD_THRESHOLD = 3.0    # rare_avg below this → lex_score = 2
LEX_MED_THRESHOLD = 3.9     # rare_avg below this → lex_score = 1

# === DICTATION THRESHOLDS ===
LONG_WORD_COUNT = 12        # +1 dictation score if count >= this
DENSE_CONTENT_COUNT = 7     # +1 dictation score if count >= this
WPM_MED_THRESHOLD = 165     # WPM higher than this -> faster
WPM_HARD_THRESHOLD = 185    # WPM higher than this -> fast_wpm flag
MAX_DICTATION_SCORE = 4     # Cap for dictation sub-score (raised from 3 to accommodate length factor)

# === SCORE CAPS ===
MAX_GRAMMAR_SCORE = 4
# MAX_DICTATION_SCORE = 3 # Moved to DICTATION THRESHOLDS

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

BASIC_SUBORDINATORS = {"because", "if", "when", "while", "after", "before", "since"}

MODALS = {"might", "may", "must", "should", "could", "would"}

RELATIVE_MARKERS = {"who", "which", "whose", "whom", "where"}

# === CONTRACTION PATTERNS ===
CONTRACTION_PATTERN = r"(n't|'re|'ve|'ll|'d|'m|'s|'clock)\b"

# === NUMBER WORDS PATTERN ===
NUMBER_WORD_PATTERN = r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b"

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

# === AUDIO CONFIGURATION ===
DEFAULT_AUDIO_DIR = "public/database/type/audio"
DEFAULT_INDEX_JSON = "public/database/type/index.json"
DEFAULT_CACHE_FILE = ".audio_cache.json"


# =============================================================================
# DATA RESOLUTION FUNCTIONS
# =============================================================================

def normalize_row_id(x):
    """Normalize Excel IDs (float/int/string) to a consistent string."""
    if x is None:
        return None
    # handle floats from Excel (e.g., 1.0 -> "1")
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    # handle ints
    if isinstance(x, int):
        return str(int(x))
    # handle strings like "001"
    s = str(x).strip()
    # if "1.0" as string
    if re.fullmatch(r"\d+\.0", s):
        return str(int(float(s)))
    # if digits
    if re.fullmatch(r"\d+", s):
        return str(int(s))
    return s

def resolve_audio_path(row_id, audio_dir, index_data=None):
    """
    Resolve audio file path for a given row ID.
    Priority:
    1. Direct file check: {audio_dir}/{row_id}.mp3
    2. Index JSON lookup (if provided)
    """
    if not row_id:
        return None
    
    # 1. Direct check
    direct_path = Path(audio_dir) / f"{row_id}.mp3"
    if direct_path.exists():
        return direct_path
        
    # 2. Index lookup
    if index_data and str(row_id) in index_data:
        filename = index_data[str(row_id)].get("audioFile")
        if filename:
            json_path = Path(audio_dir) / filename
            if json_path.exists():
                return json_path
                
    return None

def get_audio_metadata(audio_path):
    """
    Get duration in seconds from MP3 file.
    Returns: duration_sec (float) or None
    """
    if not HAS_MUTAGEN or not audio_path:
        return None
    
    try:
        audio = MP3(audio_path)
        if audio.info:
            return audio.info.length
        return None
    except Exception as e:
        # print(f"Error reading audio {audio_path}: {e}")
        return None

def compute_audio_features(row_id, word_count, audio_dir, index_data=None):
    """
    Compute audio-based features (duration, WPM).
    Returns: (duration, wpm, path)
    """
    if not audio_dir:
        return None, None, None
        
    path = resolve_audio_path(row_id, audio_dir, index_data)
    if not path:
        return None, None, None
        
    duration = get_audio_metadata(path)
    if not duration or duration <= 0:
        return None, None, str(path)
        
    # Calculate WPM (Words Per Minute)
    # wpm = (words / seconds) * 60
    wpm = (word_count / duration) * 60
    
    return duration, wpm, str(path)


def load_audio_cache(cache_path):
    """Load audio metadata cache from JSON."""
    if cache_path and Path(cache_path).exists():
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"  WARNING: Failed to load audio cache: {e}")
    return {}

def save_audio_cache(cache, cache_path):
    """Save audio metadata cache to JSON."""
    if not cache_path:
        return
    try:
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        print(f"  WARNING: Failed to save audio cache: {e}")

def load_index_json(json_path):
    """Load index.json and return a dict keyed by ID (str)."""
    if not json_path or not Path(json_path).exists():
        return None
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Create lookup dict: str(id) -> item
            lookup = {}
            if isinstance(data, dict) and "items" in data:
                for item in data["items"]:
                    lookup[str(item.get("id"))] = item
            elif isinstance(data, list):
                for item in data:
                    lookup[str(item.get("id"))] = item
            return lookup
    except Exception as e:
        print(f"  WARNING: Failed to load index JSON: {e}")
        return None

def normalize_uk_us(word):
    """Convert UK spelling to US for Zipf lookup."""
    return UK_US_MAP.get(word.lower(), word.lower())

def get_words(sentence):
    """Clean and tokenize sentence into words (no punctuation)."""
    # Remove punctuation and split
    # Keep apostrophes inside words (e.g. don't)
    return re.findall(r"\b[a-zA-Z']+\b", sentence)

def get_raw_tokens(sentence):
    """Tokenize ensuring punctuation is preserved for context."""
    # Matches words (with optional apostrophe part), digits, or sentence-ending punctuation
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?|\d+|[.!?]", sentence)

def is_likely_proper_noun(token_index, raw_tokens):
    """
    Check if a word is likely a proper noun based on context.
    Uses raw tokens to check for sentence-ending punctuation in the previous token.
    """
    if token_index == 0:
        return False # Start of sentence usually capitalized
        
    prev_token = raw_tokens[token_index - 1]
    if prev_token in {'.', '!', '?'}:
        return False # Start of new sentence/fragment
        
    token = raw_tokens[token_index]
    # If mid-sentence and capitalized, likely proper noun
    if token and len(token) > 0 and token[0].isupper() and token[1:].islower():
         return True
         
    return False

# NOTE: get_content_words logic is moved into compute_lexical_score to use raw_tokens context


# =============================================================================
# SCORING FUNCTIONS
# =============================================================================

def compute_lexical_score(sentence):
    """
    Compute lexical difficulty using two-rarest-average method.
    Returns: (lex_score, rare_avg, rare_words_info, content_count)
    """
    # Use raw tokens for proper noun context
    raw_tokens = get_raw_tokens(sentence)
    
    content_words = []
    
    # Iterate raw tokens to find content words
    for i, token in enumerate(raw_tokens):
        # Check if it's a word (letters/apostrophe)
        if not re.match(r"^[a-zA-Z']+$", token):
            continue
            
        lower = token.lower()
        
        # Skip function words
        if lower in FUNCTION_WORDS:
            continue
        # Skip very short words
        if len(lower) < 2:
            continue
            
        # Check proper noun (skip if likely proper noun)
        if is_likely_proper_noun(i, raw_tokens):
            continue
            
        content_words.append(lower)
    
    content_count = len(content_words)
    
    if not content_words:
        return 0, 9.0, [], 0, 9.0, 0.0, 0
    
    # Get Zipf frequencies
    zipf_scores = []
    oov_count = 0
    
    for word in content_words:
        normalized = normalize_uk_us(word)
        zipf = zipf_frequency(normalized, 'en')
        if zipf == 0:  # Unknown word - treat as rare
            oov_count += 1
            zipf = 2.0
        zipf_scores.append((word, zipf))
    
    # Sort by Zipf ascending (rarest first)
    zipf_scores.sort(key=lambda x: x[1])
    
    # Metrics
    zipf_values = [z for w, z in zipf_scores]
    min_zipf = zipf_values[0]
    pct_rare = sum(1 for z in zipf_values if z < 3.5) / len(zipf_values)
    
    # Two-rarest average
    if len(zipf_scores) >= 2:
        rare_avg = (zipf_scores[0][1] + zipf_scores[1][1]) / 2
        rare_words = zipf_scores[:2]
    else:
        rare_avg = zipf_scores[0][1]
        rare_words = zipf_scores[:1]
    
    rare_words_info = [f"{w}({z:.2f})" for w, z in rare_words]
    
    # Assign score (New Logic)
    # oov >= 1 or min_zipf < 2.8 or pct_rare >= 0.34 => Level 2 (Hard)
    # min_zipf < 3.4 or pct_rare >= 0.17 or rare_avg < 3.7 => Level 1 (Med)
    
    if oov_count >= 1 or min_zipf < 2.8 or pct_rare >= 0.34:
        lex_score = 2
    elif min_zipf < 3.4 or pct_rare >= 0.17 or rare_avg < 3.7:
        lex_score = 1
    else:
        lex_score = 0
    
    return lex_score, rare_avg, rare_words_info, content_count, min_zipf, pct_rare, oov_count


def relative_marker_heuristic(words):
    """
    Check for relative markers, excluding sentence-initial interrogatives.
    """
    for i, w in enumerate(words):
        if w in RELATIVE_MARKERS:
            if i == 0:  # "Where are you going?" -> interrogate, not relative
                continue
            if i > 0 and words[i-1] in FUNCTION_WORDS: # e.g. "of which" (often advanced phrase)
                continue
            return w
    return None

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
    
    # --- Basic subordinators (+1) ---
    for sub in BASIC_SUBORDINATORS:
        if sub in words:
            # Only count if not at start of sentence (heuristically)
            if words[0] == sub:
                 # Check if there's a comma later
                 if ',' in sentence_lower:
                      score += 1
                      flags.append(f"subord({sub})")
                      break
            else:
                 score += 1
                 flags.append(f"subord({sub})")
                 break

    # --- Relative markers (+1) ---
    rel = relative_marker_heuristic(words)
    if rel:
        score += 1
        flags.append(f"relative({rel})")

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
    
    # --- Perfect aspect (+1): have/has/had/having + past participle (allow adverbs/not) ---
    perfect_pattern = r"\b(have|has|had|having)\s+(?:\w+\s+){0,2}\b([a-zA-Z]{3,}(?:ed|en|wn|nt)|built|sent|taught|brought|thought|caught|held|kept|left|led|met|paid|said|sold|set|sat|read|run|written|spoken|broken|chosen|driven|eaten|fallen|forgotten|frozen|gotten|grown|hidden|ridden|risen|shaken|stolen|sworn|torn|worn|woken|been)\b"
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
    
    # Cap the score
    score = min(score, MAX_GRAMMAR_SCORE)
    
    return score, flags


def compute_dictation_score(sentence, word_count, content_count, wpm=None):
    """
    Compute dictation-specific difficulty.
    New v2.1 Logic:
    - Number words / Digits (+1)
    - Proper Nouns / Acronyms (+1 for significant presence)
    - High content ratio (density) (+1)
    - WPM Speed (+1 if fast)
    Returns: (dictation_score, dictation_flags)
    """
    score = 0
    flags = []
    
    # --- Contractions (+1) ---
    if re.search(CONTRACTION_PATTERN, sentence, re.IGNORECASE):
        score += 1
        flags.append("contraction")
    
    # --- Numbers / Number Words (+1) ---
    has_number = False
    if re.search(r'\d', sentence):
        has_number = True
        flags.append("digits")
    if re.search(NUMBER_WORD_PATTERN, sentence, re.IGNORECASE):
        has_number = True
        flags.append("num_words")
        
    if has_number:
        score += 1
        
    # --- Proper Nouns / Acronyms (+1) ---
    # We use raw_tokens to check for upper-case words not at start
    raw_tokens = get_raw_tokens(sentence)
    proper_noun_count = 0
    for i, token in enumerate(raw_tokens):
        # Skip start of sentence
        if i == 0: continue
            
        # Check if previous was punctuation (new sentence start)
        if raw_tokens[i-1] in {'.', '!', '?'}: continue
            
        if token[0].isupper() and token[1:].islower() and len(token) > 2:
            proper_noun_count += 1
        elif token.isupper() and len(token) >= 2 and not token.isdigit(): # Acronyms like USA, NASA (ignore single letter I or A)
             # "I" specific check
             if token == 'I': continue
             proper_noun_count += 1
             
    if proper_noun_count >= 2:
        score += 1
        flags.append(f"proper_nouns({proper_noun_count})")
    
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
    
    # --- Content Density (Ratio instead of absolute count) (+1) ---
    # > 60% content words is dense
    if word_count > 0:
        ratio = content_count / word_count
        if ratio >= 0.60:
            score += 1
            flags.append(f"dense_ratio({ratio:.2f})")
    
    # --- Sentence Length / Memory Span (+1 or +2) ---
    # RS tests auditory short-term memory; longer sentences are harder to repeat
    if word_count >= LONG_WORD_COUNT:  # 12 words
        score += 1
        flags.append(f"long({word_count}w)")
    if word_count >= 16:  # Extra penalty for very long memory span
        score += 1
        flags.append(f"very_long({word_count}w)")
    
    # --- Audio Rate (WPM) (+1) ---
    if wpm is not None:
        if wpm >= WPM_HARD_THRESHOLD:
            score += 1
            flags.append(f"fast_wpm({wpm:.0f})")
    
    # Cap the score
    score = min(score, MAX_DICTATION_SCORE)
    
    return score, flags


def assign_level(lex_score, grammar_score, dictation_score, word_count, content_count):
    """
    Assign difficulty level 1, 2, or 3 using a weighted model.
    Logic:
    - Core = 2*Lex + 2*Grammar
    - Total = Core + Dictation
    Levels:
    - 3: Core >= 5 OR (Lex=2 AND Gram>=1) OR Total >= 6
    - 2: Total >= 3 OR Core >= 3
    - 1: Default
    
    Note: Thresholds calibrated for RS (short spoken sentences, avg 11 words).
    RS sentences are inherently simpler than reading passages, so thresholds
    are lower than academic text classifiers.
    """
    core = 2 * lex_score + 2 * grammar_score
    total = core + dictation_score

    # L3: strong core complexity OR high overall difficulty (including memory span)
    if core >= 5 or (lex_score == 2 and grammar_score >= 1) or total >= 6:
        return 3

    # L2: moderate combined evidence
    if total >= 3 or core >= 3:
        return 2

    return 1


def build_reasons(lex_score, rare_avg, rare_words_info, grammar_flags, dictation_flags, duration=None, wpm=None):
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
    
    if duration and wpm:
        parts.append(f"audio={duration:.1f}s({wpm:.0f}wpm)")
    
    return " | ".join(parts)


# =============================================================================
# CLASSIFICATION FUNCTIONS
# =============================================================================

def classify_sentence(sentence, audio_features=None):
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
    
    # 1. Word stats
    # Use consistent tokenization found in get_words (no punctuation)
    words = get_words(sentence)
    word_count = len(words)
    
    # Audio features
    duration = None
    wpm = None
    audio_path = None
    if audio_features:
        duration = audio_features.get('duration')
        wpm = audio_features.get('wpm')
        audio_path = audio_features.get('path')
    
    # 2. Compute scores
    lex_score, rare_avg, rare_words_info, content_count, min_zipf, pct_rare, oov_count = compute_lexical_score(sentence)
    grammar_score, grammar_flags = compute_grammar_score(sentence)
    dictation_score, dictation_flags = compute_dictation_score(sentence, word_count, content_count, wpm=wpm)
    
    # 3. Assign Level
    level = assign_level(lex_score, grammar_score, dictation_score, word_count, content_count)
    reasons = build_reasons(lex_score, rare_avg, rare_words_info, grammar_flags, dictation_flags, duration=duration, wpm=wpm)
    
    return {
        "sentence": sentence,
        "level": level,
        "lex_score": lex_score,
        "grammar_score": grammar_score,
        "dictation_score": dictation_score,
        "word_count": word_count,
        "content_count": content_count,
        "rare_avg": round(rare_avg, 2),
        "min_zipf": round(min_zipf, 2),
        "pct_rare": round(pct_rare, 2),
        "oov_count": oov_count,
        "duration": duration,
        "wpm": wpm,
        "audio_path": audio_path,
        "reasons": reasons
    }


def classify_all(sentences, row_ids=None, audio_data_list=None):
    """Classify all sentences with progress updates."""
    results = []
    total = len(sentences)
    
    for i, sentence in enumerate(sentences):
        if (i + 1) % 500 == 0:
            print(f"  Processing {i+1}/{total}...")
        
        audio_feat = audio_data_list[i] if audio_data_list and i < len(audio_data_list) else None
        result = classify_sentence(sentence, audio_features=audio_feat)
        result["id"] = row_ids[i] if row_ids and i < len(row_ids) else (i + 1)
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
    
    print(f"Columns: {list(df.columns)}")
    
    if sentence_column not in df.columns:
        raise ValueError(f"Column '{sentence_column}' not found. Available: {list(df.columns)}")
        
    # Auto-detect ID column
    id_col = None
    for col in ["ID", "id", "Id", "Rank", "No."]:
        if col in df.columns:
            id_col = col
            break
            
    if id_col:
        print(f"  ID Column detected: {id_col}")
    else:
        print("  WARNING: No ID column found (ID/id/Id). Using row index.")
    
    return df, id_col


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
    df['min_zipf'] = [r.get('min_zipf', 9.0) for r in results]
    df['pct_rare'] = [r.get('pct_rare', 0.0) for r in results]
    df['oov_count'] = [r.get('oov_count', 0) for r in results]
    df['audio_path'] = [r.get('audio_path') for r in results]
    df['duration'] = [r.get('duration') for r in results]
    df['wpm'] = [r.get('wpm') for r in results]
    df['reasons'] = [r['reasons'] for r in results]
    
    path = Path(file_path)
    csv_path = path.parent / f"{path.stem}_classified.csv"
    
    if dry_run:
        print(f"  [DRY RUN] Would write to: {file_path}")
        print(f"  [DRY RUN] Would export CSV to: {csv_path}")
    else:
        backup_file(file_path)
        try:
            df.to_excel(file_path, index=False, engine='openpyxl')
            print(f"  Updated XLSX: {file_path}")
        except Exception as e:
            print(f"  WARNING: Could not update XLSX: {e}")
            
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
        # Verification Cases for v2.1
        ("The results were good. However, the data was bad.", 1, "However start of sentence (not PN)"),
        ("I saw John yesterday.", 1, "John is PN (skipped)"),
        ("The World Bank is an organization.", 1, "World Bank is PN (skipped)"),
        # Verification Cases for Dictation (v2.1)
        ("Twenty five students attended the first lecture.", 1, "Number words (Twenty, five, first) -> +1 Dictation"),
        ("NASA and USA are acronyms.", 1, "Acronyms (NASA, USA) -> +1 Dictation"),
        ("The very dense sentence has many heavy concepts packed inside.", 2, "High density ratio"),
        # Grammar Precision Tests (v2.1)
        ("Where are you going today?", 1, "Initial WH-question -> NO relative marker flag"),
        ("This is the house where I live.", 2, "Mid-sentence WH -> Relative marker flag"),
        ("I stayed because it rained.", 2, "Subordinator (because)"),
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
    print(f"  WPM_MED_THRESHOLD = {WPM_MED_THRESHOLD}")
    print(f"  WPM_HARD_THRESHOLD = {WPM_HARD_THRESHOLD}")
    
    rare_avgs = [r["rare_avg"] for r in results]
    word_counts = [r["word_count"] for r in results]
    wpms = [r["wpm"] for r in results if r.get("wpm")]
    path_count = sum(1 for r in results if r.get("audio_path"))
    
    total = len(results)
    print(f"\nAudio Connectivity: {path_count}/{total} ({path_count/total*100:.1f}%)")
    
    if rare_avgs:
        print(f"\nrare_avg: Min={min(rare_avgs):.2f}, Max={max(rare_avgs):.2f}, Median={sorted(rare_avgs)[len(rare_avgs)//2]:.2f}")
        print(f"LEX_MED threshold impact:")
        for threshold in [3.5, 3.7, 3.9, 4.0, 4.2]:
            count_lex1 = sum(1 for r in rare_avgs if r < threshold and r >= LEX_HARD_THRESHOLD)
            count_lex2 = sum(1 for r in rare_avgs if r < LEX_HARD_THRESHOLD)
            count_lex0 = sum(1 for r in rare_avgs if r >= threshold)
            print(f"  If LEX_MED={threshold}: lex=0:{count_lex0}, lex=1:{count_lex1}, lex=2:{count_lex2}")
    
    if word_counts:
        print(f"\nword_count distribution:")
        for wc in [9, 10, 11, 12]:
            count = sum(1 for w in word_counts if w >= wc)
            print(f"  word_count >= {wc}: {count} ({count/total*100:.1f}%)")

    if wpms:
        wpms_sorted = sorted(wpms)
        p50 = wpms_sorted[len(wpms_sorted)//2]
        p90 = wpms_sorted[int(len(wpms_sorted)*0.9)]
        print(f"\nWPM stats (n={len(wpms)}):")
        print(f"  Min:    {min(wpms):.0f}")
        print(f"  Median: {p50:.0f} <-- Suggested WPM_MED")
        print(f"  90th%:  {p90:.0f} <-- Suggested WPM_HARD")
        print(f"  Max:    {max(wpms):.0f}")


# =============================================================================
# MAIN EXECUTION
# =============================================================================

def process_file(file_path, sentence_column, audio_dir=None, index_data=None, dry_run=False, audio_cache_path=None):
    """Process a single XLSX file."""
    print(f"\n{'='*60}")
    print(f"Processing: {file_path}")
    print(f"{'='*60}")
    
    if not Path(file_path).exists():
        print(f"  WARNING: File not found: {file_path}")
        return None, None
    
    df, id_col = load_xlsx(file_path, sentence_column)
    sentences = df[sentence_column].astype(str).tolist()
    
    # Resolve audio paths and compute features
    audio_data_list = []
    row_ids = []
    
    # Load cache if enabled
    cache = load_audio_cache(audio_cache_path) if audio_cache_path else {}
    cache_hits = 0
    
    if audio_dir:
        print(f"  Resolving audio from: {audio_dir}")
        resolved_count = 0
        for idx, row in df.iterrows():
            row_id = normalize_row_id(row[id_col]) if id_col else str(int(str(idx)) + 1)
            row_ids.append(row_id)
            
            # Check cache
            if row_id in cache:
                cached = cache[row_id]
                # Check if path still exists
                if isinstance(cached, dict) and cached.get('path') and Path(cached['path']).exists():
                    audio_data_list.append(cached)
                    cache_hits += 1
                    resolved_count += 1
                    continue

            # Estimate word count if column exists, else 0
            sent_text = str(row[sentence_column])
            word_count = len(re.findall(r"\b[a-zA-Z']+\b", sent_text))
            
            duration, wpm, path = compute_audio_features(row_id, word_count, audio_dir, index_data)
            
            entry = {
                'duration': duration, 
                'wpm': wpm, 
                'path': path
            }
            audio_data_list.append(entry)
            
            if path:
                resolved_count += 1
                # Update cache
                cache[row_id] = entry
                
        print(f"  Resolved {resolved_count}/{len(df)} audio files ({cache_hits} from cache).")
        if cache_hits < resolved_count and audio_cache_path:
            save_audio_cache(cache, audio_cache_path)
    else:
        # Build row_ids even if no audio
        for idx, row in df.iterrows():
            row_id = normalize_row_id(row[id_col]) if id_col else str(int(str(idx)) + 1)
            row_ids.append(row_id)
        audio_data_list = [None] * len(df)
    
    print(f"\nClassifying {len(sentences)} sentences...")
    results = classify_all(sentences, row_ids=row_ids, audio_data_list=audio_data_list)
    
    # Merge audio paths back into results (optional redundant but keeps it safe)
    for i, r in enumerate(results):
        if audio_data_list and i < len(audio_data_list):
            entry = audio_data_list[i]
            if isinstance(entry, dict):
                audio_path = str(entry.get('path', '')) or ""
                if not audio_path:
                    audio_path = str(entry.get('audio_path', '')) or "" # Fallback if 'path' isn't set
                r['audio_path'] = audio_path
            else:
                r['audio_path'] = "" # Handle None entry
        else:
            r['audio_path'] = ""
    
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
    
    # New v2.1 args
    parser.add_argument("--audio-dir", type=str, default=DEFAULT_AUDIO_DIR, help="Directory containing audio files")
    parser.add_argument("--index-json", type=str, default=DEFAULT_INDEX_JSON, help="Path to index.json for ID mapping")
    parser.add_argument("--audio-cache", type=str, default=DEFAULT_CACHE_FILE, help="Path to audio features cache JSON")
    
    args = parser.parse_args()
    
    print("ESL Dictation Categorizer v2.1 (Regex-based, no spaCy)")
    print("=" * 60)
    
    if args.test_only:
        test_specific_sentences()
        return
    
    # Load index JSON once
    index_data = load_index_json(args.index_json)
    if index_data:
        print(f"Loaded index data for {len(index_data)} items.")
    else:
        print("No index data loaded (will rely on direct file ID checks).")
    
    if args.file:
        files_to_process = [(args.file, args.column)]
    else:
        files_to_process = DEFAULT_FILES
    
    all_results = {}
    for file_path, sentence_column in files_to_process:
        # Auto-disable audio for RS.xlsx if using default type-dir
        current_audio_dir = args.audio_dir
        if "RS.xlsx" in str(file_path) and args.audio_dir == DEFAULT_AUDIO_DIR:
             print(f"  NOTE: Auto-disabling audio for {file_path} (speak mode)")
             current_audio_dir = None

        results, df = process_file(file_path, sentence_column, 
                                 audio_dir=current_audio_dir, 
                                 index_data=index_data, 
                                 dry_run=args.dry_run,
                                 audio_cache_path=args.audio_cache)
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
