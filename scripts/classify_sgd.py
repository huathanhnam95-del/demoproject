import sys
import io
import json
import requests
import pandas as pd
import shutil
import time
import argparse
from pathlib import Path
import re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

OLLAMA_URL = "http://localhost:11434/api/generate"
MODELS = ["gemma4:latest"]
TIMEOUT = 120

RUBRIC = """Classify this group discussion transcript's difficulty for a PTE "Summarize Group Discussion" task.
Level 1 (Easy): Everyday topic, simple vocabulary, single viewpoint, clear structure
Level 2 (Medium): Semi-specialized topic, some academic terms, 2 perspectives
Level 3 (Hard): Specialized/abstract topic, heavy jargon, 3+ complex perspectives"""

def generate_prompt(title, transcript, model):
    excerpt = transcript[:2000] if isinstance(transcript, str) else ""
    prompt = f"{RUBRIC}\n\nTitle: {title}\nTranscript (excerpt):\n{excerpt}\n\nRespond with ONLY JSON: {{\"level\": 1|2|3, \"reasoning\": \"brief\"}}"
    return prompt

def call_ollama(model, prompt):
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {
            "num_predict": 150
        }
    }
    try:
        response = requests.post(OLLAMA_URL, json=payload, timeout=TIMEOUT)
        response.raise_for_status()
        data = response.json()
        response_text = data.get("response", "")
        # Remove think tags if any
        response_text = re.sub(r'<think>.*?</think>', '', response_text, flags=re.DOTALL).strip()
        
        # Try to parse JSON
        match = re.search(r'\{.*?\}', response_text.replace('\n', ' '))
        if match:
            json_str = match.group(0)
        else:
            json_str = response_text
            
        parsed = json.loads(json_str)
        level = int(parsed.get("level", 0))
        if level not in [1, 2, 3]:
            level = -1
        return level, parsed.get("reasoning", "")
    except Exception as e:
        print(f"  [!] Error with {model}: {e}")
        return -1, str(e)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Run only 3 items')
    args = parser.parse_args()

    excel_path = Path(r"C:\Cursor AI\public\database\SGD\SGD\SGD.xlsx")
    backup_path = excel_path.with_name("SGD_backup.xlsx")
    log_path = Path(r"C:\Cursor AI\scratch\sgd_classification_log.json")
    log_path.parent.mkdir(parents=True, exist_ok=True)

    if not backup_path.exists():
        shutil.copy2(excel_path, backup_path)
        print(f"Created backup at {backup_path}")

    try:
        df = pd.read_excel(excel_path)
    except ImportError:
        print("Missing openpyxl. Please pip install openpyxl pandas.")
        sys.exit(1)
    
    total = len(df)
    if args.dry_run:
        total = min(3, total)
        print(f"DRY RUN: Processing {total} items")

    logs = []
    
    for idx in range(total):
        title = df.iloc[idx, 1]
        transcript = df.iloc[idx, 2]
        
        print(f"[{idx+1}/{total}] Processing: {title}")
        
        votes = []
        item_log = {
            "index": idx,
            "title": str(title),
            "responses": {}
        }
        
        for model in MODELS:
            print(f"  -> Querying {model}...", end="", flush=True)
            prompt = generate_prompt(title, transcript, model)
            start_t = time.time()
            level, reasoning = call_ollama(model, prompt)
            elapsed = time.time() - start_t
            print(f" done in {elapsed:.1f}s. Level: {level}")
            
            item_log["responses"][model] = {
                "level": level,
                "reasoning": reasoning,
                "time": elapsed
            }
            if level in [1, 2, 3]:
                votes.append(level)
                
        # Majority voting (with 1 model, it just takes its vote)
        if votes:
            from collections import Counter
            counts = Counter(votes)
            majority_level, count = counts.most_common(1)[0]
            if len(counts) == 3 or (len(counts) == 2 and counts.most_common(2)[0][1] == counts.most_common(2)[1][1]):
                print("  [!] Tie detected, defaulting to first valid vote")
                majority_level = votes[0]
            
            print(f"  => Final Level: {majority_level}")
            df.iloc[idx, 8] = majority_level
            item_log["final_level"] = int(majority_level)
            item_log["disagreement"] = len(set(votes)) > 1
        else:
            print("  => Failed to get valid votes")
            item_log["final_level"] = -1
            item_log["disagreement"] = False
            
        logs.append(item_log)
        
        # Save log continuously
        with open(log_path, 'w', encoding='utf-8') as f:
            json.dump(logs, f, indent=2)

    if not args.dry_run:
        df.to_excel(excel_path, index=False)
        print(f"Saved updated Excel to {excel_path}")
        
        # Distribution
        dist = df.iloc[:, 8].value_counts().to_dict()
        print(f"Final distribution: {dist}")
    else:
        print("Dry run completed. Skipping save.")

if __name__ == "__main__":
    main()
