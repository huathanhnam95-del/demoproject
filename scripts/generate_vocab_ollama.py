import json
import urllib.request
import urllib.error
import time

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "gemma4:latest" # Updated to match local tag
INPUT_FILE = "public/database/Write Essay/essay-questions.json"
OUTPUT_FILE = "public/database/Write Essay/essay-questions-with-vocab.json"

SYSTEM_PROMPT = """You are an expert English language assessor and teacher for the PTE Academic exam. 
Your task is to analyze the provided essay prompt and generate topic-specific vocabulary words categorized by CEFR level.

CRITICAL RULES:
1. Generate exactly 10 highly relevant topic-specific words or phrases for EACH level: A2, B1, B2, C1, C2.
2. ONLY include topic-specific words (e.g., if the topic is climate change: A2: "nature", B1: "pollution", B2: "sustainability", C1: "carbon footprint", C2: "environmental degradation").
3. Your ENTIRE output must be a single, valid JSON object with keys "A2", "B1", "B2", "C1", "C2" containing arrays of strings. Do not use markdown code blocks or explanations.

Example Output:
{
  "A2": ["weather", "animals"],
  "B1": ["environment", "pollution"],
  "B2": ["sustainability", "conservation"],
  "C1": ["carbon footprint", "biodiversity"],
  "C2": ["ecological disaster", "environmental degradation"]
}
"""

def generate_vocab(prompt_text):
    prompt = f"Prompt to analyze:\n\"{prompt_text}\""
    
    data = {
        "model": MODEL_NAME,
        "system": SYSTEM_PROMPT,
        "prompt": prompt,
        "stream": False,
        "format": "json" # Forces JSON output format if supported by the model
    }
    
    req = urllib.request.Request(OLLAMA_URL, data=json.dumps(data).encode("utf-8"), headers={"Content-Type": "application/json"})
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode("utf-8"))
            output = result.get("response", "[]").strip()
            
            # Additional cleanup just in case the model returns markdown code blocks
            if output.startswith("```json"):
                output = output.replace("```json", "").replace("```", "").strip()
            elif output.startswith("```"):
                output = output.replace("```", "").strip()
                
            return json.loads(output)
    except Exception as e:
        print(f"Error generating vocab: {e}")
        return []

def main():
    print(f"Loading {INPUT_FILE}...")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        questions = json.load(f)
        
    print(f"Found {len(questions)} questions to process.")
    
    for i, q in enumerate(questions):
        # Allow re-processing to expand vocabulary if count is low (e.g. < 5 words in B2)
        has_full_vocab = False
        if "targetVocabulary" in q and isinstance(q["targetVocabulary"], dict):
            # Check if any level has less than 8 words (user requested ~10)
            counts = [len(v) for v in q["targetVocabulary"].values() if isinstance(v, list)]
            if counts and min(counts) >= 8:
                has_full_vocab = True
        
        if has_full_vocab:
            continue
            
        print(f"[{i+1}/{len(questions)}] Processing: {q['title']}")
        raw_vocab = generate_vocab(q["prompt"])
        
        vocab_dict = {}
        if isinstance(raw_vocab, dict) and "A2" in raw_vocab:
            vocab_dict = raw_vocab
        elif isinstance(raw_vocab, dict):
            # Try to grab the first dict value inside that might have 'A2'
            for val in raw_vocab.values():
                if isinstance(val, dict) and "A2" in val:
                    vocab_dict = val
                    break
            if not vocab_dict:
                vocab_dict = raw_vocab
                
        # Falso fallback if still broken
        if not vocab_dict or not isinstance(vocab_dict, dict):
            vocab_dict = {"A2": [], "B1": [], "B2": [], "C1": [], "C2": []}

        # Calculate word count for printing
        total_words = sum(len(lst) if isinstance(lst, list) else 0 for lst in vocab_dict.values())
        print(f"  -> Generated {total_words} words across 5 CEFR levels.")
        
        q["targetVocabulary"] = vocab_dict
        
        # Save progressively to avoid losing data
        if i % 10 == 0:
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(questions, f, indent=2, ensure_ascii=False)
                
    # Final save
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(questions, f, indent=2, ensure_ascii=False)
    
    print(f"\nDone! Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
