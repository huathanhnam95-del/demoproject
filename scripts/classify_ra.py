import pandas as pd
import requests
import json
import time
import os
import sys
import io

# Fix encoding for Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

MODELS = ['gemma4:latest', 'qwen3:14b', 'deepseek-r1:14b']
OLLAMA_URL = "http://localhost:11434/api/generate"

RUBRIC = """
Evaluate the difficulty of the following Read Aloud (RA) prompt.
Assign a difficulty level from 1 (Easy), 2 (Medium), to 3 (Hard) based on these 7 linguistic factors:
1. Word Frequency: Level 1 has very common words. Level 3 has high frequency of rare, long words.
2. Spelling Complexity: Level 1 is phonetic. Level 3 has irregular orthography (e.g., 'ough', 'ieu').
3. Pronounceability: Level 1 has simple syllables. Level 3 has heavy consonant clusters.
4. Syntactic Complexity: Level 1 has short, simple sentences. Level 3 has long sentences (22+ words), embedded clauses.
5. Conceptual Density: Level 1 has spread out info. Level 3 has a high ratio of content words to stop words.
6. Abstractness: Level 1 has physical topics. Level 3 has highly abstract nominalizations (e.g. -tion, -ism).
7. Vocab Familiarity: Level 1 is everyday topics. Level 3 has heavy academic/domain-specific jargon.

Output strictly valid JSON with the exact following structure:
{"level": 1, "reasoning": "your reasoning here"}
"""

def query_ollama(model, prompt_text):
    full_prompt = RUBRIC + "\n\nRA Prompt Text:\n" + prompt_text
    
    if model == 'qwen3:14b':
        full_prompt += "\n/no_think"
        
    payload = {
        "model": model,
        "prompt": full_prompt,
        "stream": False,
        "format": "json"
    }
    
    try:
        response = requests.post(OLLAMA_URL, json=payload, timeout=120)
        if response.status_code == 200:
            data = response.json()
            response_text = data.get('response', '')
            try:
                # Some models might wrap JSON in markdown blocks
                if "```json" in response_text:
                    response_text = response_text.split("```json")[1].split("```")[0].strip()
                elif "```" in response_text:
                    response_text = response_text.split("```")[1].split("```")[0].strip()
                
                parsed = json.loads(response_text)
                level = int(parsed.get('level', 2))
                # clamp
                level = max(1, min(3, level))
                return {"level": level, "reasoning": parsed.get('reasoning', ''), "raw": response_text}
            except json.JSONDecodeError:
                return {"level": 2, "reasoning": "Failed to parse JSON", "raw": response_text}
        else:
            return {"level": 2, "reasoning": f"HTTP {response.status_code}", "raw": ""}
    except Exception as e:
        return {"level": 2, "reasoning": f"Error: {str(e)}", "raw": ""}

def main():
    input_file = r'C:\Cursor AI\public\database\RA\RA.xlsx'
    output_file = r'C:\Cursor AI\public\database\RA\RA_classified.xlsx'
    log_file = r'C:\Cursor AI\scratch\ra_classification_log.json'
    
    # Ensure scratch dir exists
    os.makedirs(r'C:\Cursor AI\scratch', exist_ok=True)
    
    if os.path.exists(output_file):
        print(f"Resuming from {output_file}...")
        df = pd.read_excel(output_file)
    else:
        print(f"Loading {input_file}...")
        df = pd.read_excel(input_file)
        
    # Check if 'Difficulty' column exists, if not create it
    if 'Difficulty' not in df.columns:
        df['Difficulty'] = 2
    if '_classified' not in df.columns:
        df['_classified'] = False
        
    total_rows = len(df)
    print(f"Total rows to process: {total_rows}")
    
    logs = []
    
    # Determine dry run limit from argv if any
    limit = total_rows
    if len(sys.argv) > 1 and sys.argv[1] == '--dry-run':
        limit = 5
        print("DRY RUN MODE: Only processing first 5 rows.")
        output_file = r'C:\Cursor AI\public\database\RA\RA_classified_dry_run.xlsx'
        log_file = r'C:\Cursor AI\scratch\ra_classification_log_dry_run.json'

    start_time = time.time()
    
    for i, row in df.head(limit).iterrows():
        item_id = row.get('ID', i)
        
        # Resume logic
        if row.get('_classified') == True:
            print(f"[{i+1}/{limit}] ID={item_id} | Already classified. Skipping.")
            continue
            
        text = str(row.get('ANSWER FOR COMPARE OR TRANSCRIPT', ''))
        if text.strip() == 'nan' or not text.strip():
            text = str(row.get('ANSWER', ''))
            
        if not text.strip() or text.strip() == 'nan':
            df.at[i, 'Difficulty'] = 2
            print(f"[{i+1}/{limit}] ID={item_id} | Empty text, defaulted to 2.")
            continue
            
        model_results = {}
        votes = []
        for model in MODELS:
            res = query_ollama(model, text)
            model_results[model] = res
            votes.append(res['level'])
            
        # Majority vote
        vote_counts = {1: votes.count(1), 2: votes.count(2), 3: votes.count(3)}
        majority_level = max(vote_counts, key=vote_counts.get)
        
        # Tie breaker: if all 3 disagree (1, 2, 3), max count is 1. Default to 2.
        if list(vote_counts.values()).count(1) == 3:
            majority_level = 2
            
        df.at[i, 'Difficulty'] = majority_level
        df.at[i, '_classified'] = True
        
        log_entry = {
            "index": i,
            "id": item_id,
            "text": text[:50] + "...",
            "votes": votes,
            "final_level": majority_level,
            "results": model_results
        }
        logs.append(log_entry)
        
        elapsed = time.time() - start_time
        avg_time = elapsed / (i + 1)
        remaining = limit - (i + 1)
        eta_min = (remaining * avg_time) / 60
        
        print(f"[{i+1}/{limit}] ID={item_id} | Votes: {votes} -> Final: {majority_level} [ETA: {eta_min:.1f}m]")
        
        # Save every 20 rows
        if (i + 1) % 20 == 0:
            df.to_excel(output_file, index=False)
            with open(log_file, 'w', encoding='utf-8') as f:
                json.dump(logs, f, indent=2, ensure_ascii=False)
                
    # Final save
    df.to_excel(output_file, index=False)
    with open(log_file, 'w', encoding='utf-8') as f:
        json.dump(logs, f, indent=2, ensure_ascii=False)
        
    print(f"Classification completed! Saved to {output_file}")
    
if __name__ == "__main__":
    main()
