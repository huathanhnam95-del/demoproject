"""
Advanced Question Classification Script
Uses WordFreq for vocabulary analysis and regex-based grammar detection.
Fallback implementation without SpaCy due to compatibility issues.
"""
import pandas as pd
import re
from wordfreq import zipf_frequency

# Function words to ignore for lex_score calculation
FUNCTION_WORDS = set([
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
    'further', 'once', 'here', 'there', 'up', 'down', 'out', 'off', 'over'
])

# Subordinating conjunctions
SUBORDINATORS = [
    'although', 'though', 'despite', 'unless', 'whereas', 'while', 'because',
    'since', 'if', 'even if', 'in case', 'provided', 'as long as', 'whenever',
    'wherever', 'whether', 'until', 'after', 'before'
]

# Modal verbs for modal perfect detection
MODALS = ['would', 'could', 'should', 'might', 'may', 'must']


def clean_sentence(sentence):
    """Normalize sentence for analysis (keep contractions as apostrophe)."""
    if not isinstance(sentence, str):
        return ""
    # Lowercase, keep apostrophes for contractions
    text = sentence.lower()
    # Remove punctuation except apostrophes inside words
    text = re.sub(r"[^\w\s']", ' ', text)
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def get_content_words(sentence):
    """Extract content words (non-function words)."""
    clean = clean_sentence(sentence)
    words = clean.split()
    return [w for w in words if w not in FUNCTION_WORDS and len(w) > 1]


def calculate_lex_score(sentence):
    """
    Calculate lexical score based on minimum Zipf frequency of content words.
    Returns: (lex_score, min_zipf, rarest_word)
    """
    content_words = get_content_words(sentence)
    if not content_words:
        return 0, None, None
    
    min_zipf = float('inf')
    rarest_word = None
    
    for word in content_words:
        # Remove apostrophe for lookup (e.g., "don't" -> "dont" or handle separately)
        clean_word = word.replace("'", "")
        freq = zipf_frequency(clean_word, 'en')
        if freq < min_zipf:
            min_zipf = freq
            rarest_word = word
    
    if min_zipf == float('inf'):
        return 0, None, None
    
    # Scoring rules from ChatGPT plan
    if min_zipf < 3.0:
        lex_score = 2
    elif min_zipf < 3.5:
        lex_score = 1
    else:
        lex_score = 0
    
    return lex_score, min_zipf, rarest_word


def calculate_grammar_score(sentence):
    """
    Calculate grammar score based on linguistic patterns.
    Uses regex-based heuristics instead of SpaCy.
    """
    score = 0
    reasons = []
    clean = clean_sentence(sentence)
    
    # Check for subordinators
    for sub in SUBORDINATORS:
        pattern = r'\b' + re.escape(sub) + r'\b'
        if re.search(pattern, clean):
            score += 1
            reasons.append(f'subordinator({sub})')
            break  # Only count one subordinator
    
    # Check for passive voice: form of "be" + past participle pattern
    # Simplified: "is/are/was/were/be/been/being" + word ending in -ed or common irregular past participles
    passive_pattern = r'\b(is|are|was|were|be|been|being)\s+(\w+ed|made|done|given|taken|seen|known|found|told|shown|built|sent|taught|brought|thought|caught|held|kept|left|led|met|paid|said|sold|set|sat|read|run|written|spoken|broken|chosen|driven|eaten|fallen|forgotten|frozen|gotten|grown|hidden|ridden|risen|shaken|stolen|sworn|torn|worn|woken)\b'
    if re.search(passive_pattern, clean):
        score += 1
        reasons.append('passive_voice')
    
    # Check for perfect aspect: "have/has/had" + past participle
    perfect_pattern = r'\b(have|has|had)\s+(\w+ed|made|done|given|taken|seen|known|found|told|shown|built|sent|taught|brought|thought|caught|held|kept|left|led|met|paid|said|sold|set|sat|read|run|written|spoken|broken|chosen|driven|eaten|fallen|forgotten|frozen|gotten|grown|hidden|ridden|risen|shaken|stolen|sworn|torn|worn|woken)\b'
    if re.search(perfect_pattern, clean):
        score += 1
        reasons.append('perfect_aspect')
    
    # Check for modal perfect: modal + "have" + past participle
    for modal in MODALS:
        modal_perf_pattern = r'\b' + modal + r'\s+have\s+(\w+ed|made|done|given|taken|seen|known|been)\b'
        if re.search(modal_perf_pattern, clean):
            score += 1
            reasons.append(f'modal_perfect({modal})')
            break  # Only count once
    
    # Cap at 3
    return min(score, 3), reasons


def calculate_dictation_score(sentence):
    """
    Calculate dictation-specific difficulty score.
    """
    score = 0
    reasons = []
    
    # Check for contractions (apostrophe pattern)
    if re.search(r"'\w", sentence) or re.search(r"n't", sentence.lower()):
        score += 1
        reasons.append('contraction')
    
    # Check for numbers
    if re.search(r'\d', sentence):
        score += 1
        reasons.append('numbers')
    
    # Cap at 2
    return min(score, 2), reasons


def assign_level(lex_score, grammar_score, dictation_score):
    """
    Assign difficulty level based on scores.
    Level 3: (lex_score == 2) OR (grammar_score >= 2) OR (total >= 4)
    Level 2: total >= 2
    Level 1: Otherwise
    """
    total = lex_score + grammar_score + dictation_score
    
    if lex_score == 2 or grammar_score >= 2 or total >= 4:
        return 3
    elif total >= 2:
        return 2
    else:
        return 1


def process_sentence(sentence):
    """Process a single sentence and return all scores and level."""
    lex_score, min_zipf, rarest_word = calculate_lex_score(sentence)
    grammar_score, grammar_reasons = calculate_grammar_score(sentence)
    dictation_score, dictation_reasons = calculate_dictation_score(sentence)
    
    level = assign_level(lex_score, grammar_score, dictation_score)
    
    # Build reasons string
    all_reasons = []
    if rarest_word and min_zipf:
        all_reasons.append(f"rare_vocab(min_zipf={min_zipf:.2f}: {rarest_word})")
    all_reasons.extend(grammar_reasons)
    all_reasons.extend(dictation_reasons)
    reasons_str = "; ".join(all_reasons) if all_reasons else "simple_sentence"
    
    return {
        'lex_score': lex_score,
        'grammar_score': grammar_score,
        'dictation_score': dictation_score,
        'level': level,
        'reasons': reasons_str
    }


def main():
    import sys
    file_path = sys.argv[1] if len(sys.argv) > 1 else 'WFD.xlsx'
    print(f"Reading {file_path}...")
    
    xl = pd.ExcelFile(file_path)
    sheets_data = {name: xl.parse(name) for name in xl.sheet_names}
    
    # Try different common sheet names
    sheet_name = None
    for name in ['Questions', 'Sheet1', xl.sheet_names[0]]:
        if name in sheets_data:
            sheet_name = name
            break
            
    if not sheet_name:
        print(f"Error: No suitable sheet found in {file_path}.")
        return
    
    df = sheets_data[sheet_name]
    print(f"Processing {len(df)} questions from sheet '{sheet_name}'...")
    
    # Determine sentence column
    sentence_col = None
    for col in ['ANSWER', 'Sentence', 'correctSentence', df.columns[2] if len(df.columns) > 2 else df.columns[0]]:
        if col in df.columns:
            sentence_col = col
            break
            
    if not sentence_col:
        print(f"Error: Could not determine sentence column in {file_path}.")
        return
    
    # Process all sentences
    results = []
    for idx, row in df.iterrows():
        sentence = row[sentence_col]
        result = process_sentence(sentence)
        results.append(result)
        
        if (idx + 1) % 500 == 0:
            print(f"  Processed {idx + 1}/{len(df)}...")
    
    # Add results to dataframe
    df['Level'] = [r['level'] for r in results]
    df['lex_score'] = [r['lex_score'] for r in results]
    df['grammar_score'] = [r['grammar_score'] for r in results]
    df['dictation_score'] = [r['dictation_score'] for r in results]
    df['reasons'] = [r['reasons'] for r in results]
    
    # Print distribution
    print("\n=== Level Distribution ===")
    print(df['Level'].value_counts().sort_index())
    
    # Print samples from each level
    print("\n=== Sample Sentences by Level ===")
    for level in [1, 2, 3]:
        print(f"\n--- Level {level} ---")
        samples = df[df['Level'] == level].sample(min(5, len(df[df['Level'] == level])))
        for _, sample in samples.iterrows():
            print(f"  [{sample['reasons'][:60]}...]")
            print(f"  → {sample[sentence_col][:80]}...")
    
    # Save back to WFD.xlsx
    with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
        for sheet_name, sheet_df in sheets_data.items():
            if sheet_name == 'Questions':
                df.to_excel(writer, sheet_name=sheet_name, index=False)
            else:
                sheet_df.to_excel(writer, sheet_name=sheet_name, index=False)
    
    print(f"\n✅ Successfully updated {file_path}")
    print(f"   Level 1: {len(df[df['Level'] == 1])} questions")
    print(f"   Level 2: {len(df[df['Level'] == 2])} questions")
    print(f"   Level 3: {len(df[df['Level'] == 3])} questions")


if __name__ == "__main__":
    main()
