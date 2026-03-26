import os
import json
import time
import re
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# Load API key
load_dotenv('.env')
API_KEY = os.getenv('GEMINI_API_KEY')
if not API_KEY:
    raise ValueError("GEMINI_API_KEY not found in .env")

# Use Gemini 2.5 Pro for highest quality natural language understanding
MODEL = "gemini-2.5-pro"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

SYSTEM_PROMPT = """You are an expert in English prosody, phonetics, and ESL pronunciation coaching.
Your task is to chunk (insert pause markers '/') into reading passages to help ESL learners read aloud naturally.

## What is chunking?
Chunking means inserting a forward slash ' / ' to indicate where a natural, brief pause should occur.
The goal is to produce speech that sounds like a PROFICIENT NATIVE SPEAKER reading aloud — smooth rhythm, natural breath groups, and clear phrasing.

## Rules for Natural Chunking (Prosodic Phrasing)

### WHERE to place pauses:
1. **After introductory elements**: Adverbs, transitional phrases, or short openers (e.g. "However," / "In contrast," / "For example,")
2. **At punctuation boundaries**: After commas, semicolons, colons, and dashes — these are the strongest natural pause points
3. **Before prepositional phrases** that modify the preceding clause (e.g. "...accepted for publication / in the Astrophysical Journal")
4. **Before relative clauses**: "...a paper / that's been accepted..."
5. **Between subject and predicate** when the subject is long (e.g. "These large structures / would have had sheets of ice...")
6. **Before conjunctions** connecting independent clauses ("...in recent years, / and this trend...")
7. **Before infinitive/purpose clauses**: "...over the winter / to provide year-round ice"
8. **At natural breath group boundaries**: Where a native speaker would naturally take a micro-breath

### What to AVOID:
- **Rigid word-count rules**: Do NOT force every chunk to be a minimum number of words. Natural speech has varied chunk lengths.
- **Back-to-back very short chunks**: Avoid sequences like "2 words / 2 words / 2 words" which sound staccato. But a single short chunk followed by a longer one is perfectly fine.
- **Breaking fixed phrases**: Never split collocations, compound nouns, or idiomatic expressions (e.g. don't split "ice cream", "climate change", "sugar tax")
- **Over-chunking**: Too many pauses make speech sound choppy. Aim for the MINIMUM number of pauses needed for natural phrasing.
- **Under-chunking**: Very long unbroken segments (15+ words) are hard to read fluently. Break them at natural points.

### Key principle:
Think about HOW A NATIVE SPEAKER WOULD ACTUALLY READ THIS ALOUD. Place pauses where they would naturally breathe and phrase.

## Output format
Return ONLY a valid JSON object:
{
  "chunked": "The text with ' / ' inserted at natural pause locations"
}

CRITICAL: The text content must match the original EXACTLY — only insert ' / ' markers. Do not change any words."""

def process_question(q):
    if not q.get('current_chunked') and not q.get('text'):
        return None
    
    text = q['text']
    
    prompt = f"""Chunk this passage for natural Read Aloud delivery:

"{text}"

For reference, here is the current (possibly flawed) chunking:
"{q.get('current_chunked', text)}"

Re-chunk this passage following the prosodic phrasing rules. Place ' / ' ONLY where a native speaker would naturally pause."""

    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }
    
    max_retries = 5
    for attempt in range(max_retries):
        try:
            resp = requests.post(GEMINI_URL, json=payload, headers={"Content-Type": "application/json"}, timeout=60)
            if resp.status_code == 429:
                wait_time = 2 ** attempt + 5
                print(f"  Rate limited on ID {q['id']}, waiting {wait_time}s...")
                time.sleep(wait_time)
                continue
            resp.raise_for_status()
            
            result_json = resp.json()
            text_response = result_json['candidates'][0]['content']['parts'][0]['text']
            
            # Clean markdown formatting if present
            if text_response.startswith("```json"):
                text_response = text_response.split("```json")[-1].split("```")[0].strip()
            
            parsed = json.loads(text_response)
            
            # Normalize spacing around '/'
            new_chunked_text = parsed.get("chunked", "")
            new_chunked_text = re.sub(r'\s*/\s*', ' / ', new_chunked_text).strip()
            
            return {
                "id": q["id"],
                "text": q["text"],
                "old_chunked": q.get("current_chunked", ""),
                "new_chunked": new_chunked_text,
            }
        except Exception as e:
            time.sleep(1)
            if attempt == max_retries - 1:
                print(f"  FAILED ID {q['id']}: {e}")
                return None

CHECKPOINT_FILE = "read-aloud-chunking-checkpoint.json"

def main():
    print(f"Using model: {MODEL}")
    print("Loading RA_extracted.json...")
    with open('RA_extracted.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    print(f"Total questions: {len(data)}")
    
    # Load completed from checkpoint
    completed_ids = set()
    results = []
    if os.path.exists(CHECKPOINT_FILE):
        try:
            with open(CHECKPOINT_FILE, 'r', encoding='utf-8') as f:
                results = json.load(f)
                completed_ids = {r['id'] for r in results}
                print(f"Loaded {len(results)} completed from checkpoint.")
        except json.JSONDecodeError:
            print("Failed to decode checkpoint. Starting fresh.")
            
    # Filter targets
    targets = [q for q in data if q['id'] not in completed_ids and (q.get('current_chunked') or q.get('text'))]
    print(f"Remaining to process: {len(targets)}")
    
    if not targets:
        print("Nothing to process!")
        return
    
    start_time = time.time()
    
    # Use fewer workers for Pro model (heavier, rate limits stricter)
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_question, q): q for q in targets}
        
        for i, future in enumerate(as_completed(futures)):
            res = future.result()
            if res:
                results.append(res)
                
            if (i + 1) % 50 == 0 or (i + 1) == len(targets):
                elapsed = time.time() - start_time
                print(f"Completed {len(results)} / {len(data)} (Elapsed: {elapsed:.1f}s)")
                with open(CHECKPOINT_FILE, 'w', encoding='utf-8') as f:
                    json.dump(results, f, indent=2, ensure_ascii=False)

    print("Saving final results to RA_rechunked.json")
    with open('RA_rechunked.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        
    print("Done!")

if __name__ == '__main__':
    main()
