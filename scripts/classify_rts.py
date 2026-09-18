import sys
import io
import json
import urllib.request
import urllib.error
import shutil
import os
import time
from collections import Counter
import re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

# Paths
DATA_PATH = r"C:\Cursor AI\public\database\RTS\rts_questions.json"
BACKUP_PATH = r"C:\Cursor AI\public\database\RTS\rts_questions_backup.json"
LOG_PATH = r"C:\Cursor AI\scratch\rts_classification_log.json"

# Models
MODELS = [os.getenv("LOCAL_GEMMA_MODEL", "gemma4:12b")]
API_URL = os.getenv("OLLAMA_CHAT_URL", "http://localhost:11434/api/chat")

RUBRIC = """RTS Classification Rubric:
| Factor | Weight | Level 1 (Easy) | Level 2 (Medium) | Level 3 (Hard) |
|--------|--------|----------------|-------------------|----------------|
| Speech act difficulty | 0.40 | Requesting, describing, informing, greeting | Explaining, suggesting, apologizing, persuading | Negotiating, complaining diplomatically, mediating conflict, declining professionally |
| Situational complexity | 0.35 | Personal/casual (friend, family, roommate) | Semi-formal (customer service, school, community, library) | Professional/institutional (supervisor, client, workplace policy, management) |
| Register requirement | 0.15 | Casual/informal tone acceptable | Some politeness strategies needed | Formal register, diplomatic language required |
| Scenario comprehension | 0.10 | Short, clear scenario | Moderate detail, some context to parse | Long, multi-layered scenario with competing concerns |

Based on this rubric, classify the following scenario.
You must respond with ONLY a valid JSON object in this format:
{{"level": 1|2|3, "speechAct": "requesting|explaining|negotiating|...", "context": "personal|semi-formal|professional", "reasoning": "..."}}

Scenario:
{scenario}
"""

def backup_data():
    if not os.path.exists(BACKUP_PATH):
        if os.path.exists(DATA_PATH):
            shutil.copy2(DATA_PATH, BACKUP_PATH)
            print(f"Backed up to {BACKUP_PATH}")
        else:
            print(f"Data file not found at {DATA_PATH}!")
            sys.exit(1)

def query_ollama(model, prompt):
    data = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": "json"
    }
    if not any(r in model.lower() for r in ["deepseek-r1", "-r1", "/r1", "reasoner", "qwq"]):
        data["think"] = False
    
    req = urllib.request.Request(API_URL, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            result = json.loads(response.read().decode('utf-8'))
            response_text = result.get('message', {}).get('content', '{}')
            try:
                # Some models might wrap in <think> tags or code blocks despite format=json
                response_text = re.sub(r'<think>.*?</think>', '', response_text, flags=re.DOTALL).strip()
                match = re.search(r'```(?:json)?\s*(.*?)\s*```', response_text, re.DOTALL)
                if match:
                    response_text = match.group(1).strip()
                parsed = json.loads(response_text)
                return parsed
            except json.JSONDecodeError:
                print(f"Failed to parse JSON from {model}: {response_text}")
                return None
    except Exception as e:
        print(f"Error querying {model}: {e}")
        return None

def process_items(dry_run=True):
    with open(DATA_PATH, 'r', encoding='utf-8') as f:
        items = json.load(f)
    
    items_to_process = items[:3] if dry_run else items
    log_file = LOG_PATH if not dry_run else LOG_PATH.replace(".json", "_dry_run.json")
    
    existing_logs = []
    if os.path.exists(log_file):
        try:
            with open(log_file, 'r', encoding='utf-8') as lf:
                existing_logs = json.load(lf)
        except json.JSONDecodeError:
            pass
            
    existing_results_by_id = {log['id']: log for log in existing_logs}
    logs = []
    
    for i, item in enumerate(items_to_process):
        item_id = item.get('id')
        scenario = item.get('answer', '')
        prompt = RUBRIC.format(scenario=scenario)
        # Actually better to just use %s or manually format
        # Wait, the RUBRIC definition above already has single {}. I should fix it in the string literal.

        print(f"\nProcessing {i+1}/{len(items_to_process)}: ID {item_id}")
        
        # Load existing if available
        item_log = existing_results_by_id.get(item_id, {
            "id": item_id,
            "scenario": scenario,
            "raw_results": {},
            "final_level": 2,
            "final_act": "unknown",
            "final_context": "unknown"
        })
        
        raw_results = item_log.get('raw_results', {})
        
        levels = []
        acts = []
        contexts = []
        
        for model in MODELS:
            if model in raw_results and raw_results[model] is not None and ('level' in raw_results[model] or raw_results[model] == {}):
                print(f"  Skipping {model} (already processed).")
                res = raw_results[model]
            else:
                print(f"  Querying {model}...", end='', flush=True)
                res = query_ollama(model, prompt)
                print(" Done.", flush=True)
                raw_results[model] = res
                
            if res:
                if 'level' in res:
                    try:
                        level = int(res['level'])
                        if level in [1,2,3]:
                            levels.append(level)
                    except:
                        pass
                if 'speechAct' in res:
                    acts.append(str(res['speechAct']).lower())
                if 'context' in res:
                    contexts.append(str(res['context']).lower())
                    
        if levels:
            final_level = Counter(levels).most_common(1)[0][0]
        else:
            final_level = 2
            print(f"Warning: No valid levels for ID {item_id}. Defaulting to 2.")
            
        if acts:
            final_act = Counter(acts).most_common(1)[0][0]
        else:
            final_act = "unknown"
            
        if contexts:
            final_context = Counter(contexts).most_common(1)[0][0]
        else:
            final_context = "unknown"
            
        item['level'] = final_level
        item['speechAct'] = final_act
        item['context'] = final_context
        
        item_log['raw_results'] = raw_results
        item_log['final_level'] = final_level
        item_log['final_act'] = final_act
        item_log['final_context'] = final_context
        
        # Update existing logs list
        if item_id in existing_results_by_id:
            idx = next((index for (index, d) in enumerate(existing_logs) if d["id"] == item_id), None)
            if idx is not None:
                existing_logs[idx] = item_log
        else:
            existing_logs.append(item_log)
            existing_results_by_id[item_id] = item_log
            
        # Save intermediate log
        os.makedirs(os.path.dirname(log_file), exist_ok=True)
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(existing_logs, f, indent=4, ensure_ascii=False)
            
    if not dry_run:
        with open(DATA_PATH, 'w', encoding='utf-8') as f:
            json.dump(items, f, indent=4, ensure_ascii=False)
        print("\nUpdated original file.")
        
    distribution = Counter(item.get('level') for item in items_to_process)
    print("Distribution:", dict(distribution))

if __name__ == "__main__":
    backup_data()
    
    if len(sys.argv) > 1 and sys.argv[1] == "full":
        print("Running full dataset...")
        process_items(dry_run=False)
        print("Full run complete.")
    else:
        print("Running dry run (3 items)...")
        process_items(dry_run=True)
        print("Dry run complete.")
