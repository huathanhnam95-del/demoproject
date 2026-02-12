import pandas as pd
import os
import time
import json
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def simplify_text():
    # Configuration
    input_file = r'C:\Cursor AI\public\database\RFIB\RFIB_with_topics.xlsx'
    output_file = r'C:\Cursor AI\public\database\RFIB\RFIB_simplified.xlsx'
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        print("Error: GEMINI_API_KEY environment variable not set.")
        print("Please set it with: $env:GEMINI_API_KEY='your_key'")
        return

    print(f"Checking for existing progress in {output_file}...")
    if os.path.exists(output_file):
        print("Found existing simplified file. Resuming...")
        df = pd.read_excel(output_file, engine='openpyxl')
        # Ensure we still have the original columns just in case
        # (Assuming output file has everything)
    else:
        print(f"Starting fresh from {input_file}...")
        df = pd.read_excel(input_file, engine='openpyxl')

    # Initialize Client
    client = genai.Client(api_key=api_key)

    # Initialize new columns if they don't exist
    if 'Beginner Ver' not in df.columns:
        df['Beginner Ver'] = ""
    if 'Inter Ver' not in df.columns:
        df['Inter Ver'] = ""

    # Process rows
    print("Starting simplification process...")
    total_rows = len(df)
    
    # Batch processing parameters
    batch_size = 10
    save_interval = 20
    
    # Find rows that need processing (empty or NaN)
    # Pandas reads empty cells as NaN
    mask = df['Beginner Ver'].isna() | (df['Beginner Ver'] == "")
    rows_to_process = df[mask].index.tolist()
    
    # DRY RUN: Process only first 3 rows for verification if all are empty
    # Or just process all if the user didn't specify dry run, but for safety I'll start with 3
    # Actually, let's just process normally but user can break it. 
    # I'll implement a 'limit' arg later if needed, for now let's just do a small batch for testing if I call it manually.
    
    # For this specific run, let's do the first 5 rows and stop, to let user verify.
    # UNLESS we are confident. The user said "do this very carefully".
    # So I will hardcode a limit for this first run script.
    
    # DRY RUN MODE: Removed for full processing
    # limit = 5
    # print(f"DRY RUN MODE: Processing first {limit} rows only.")
    # rows_to_process = rows_to_process[:limit]
    print(f"Full processing mode: {len(rows_to_process)} rows to process.")

    for i, idx in enumerate(rows_to_process):
        original_text = df.loc[idx, 'Full Text']
        
        if not isinstance(original_text, str) or len(original_text.strip()) < 10:
            print(f"Skipping row {idx}: text too short.")
            continue


        static_prompt = r"""
You are an expert ESL materials writer and CEFR text simplifier. Your job is to rewrite each paragraph I provide into two simplified versions while preserving meaning with very high fidelity.

INPUT
I will paste a multi-paragraph text. Treat each paragraph separated by a blank line as one unit.

TASK
For each paragraph, produce:
1. Beginner version (CEFR A2-B1)
2. Intermediate version (CEFR B1-B2)

NON-NEGOTIABLE FIDELITY RULES (common problems to avoid)
1. Preserve facts exactly:
   - Keep ALL numbers, percentages, dates, centuries, and ranges EXACTLY (e.g., 40%, 44%, 2030, 22nd century, 6,000-7,000, 15,000 years ago).
   - Do NOT convert "22nd century" into "2100s" or change time references.
2. Preserve key terminology consistently:
   - Do NOT swap key terms for near-synonyms when the original term matters (e.g., keep "global heating" if the original says "global heating", not "global warming").
   - Keep official names/titles/institutions exactly (e.g., "Victoria University of Wellington", "Doctor of Science", "Cephalization index", "Pop Shop", "pre-Columbian").
3. Preserve logical relationships and strength of claims:
   - Keep cause/effect, contrasts, comparisons, rankings, and modality (likely vs may vs will) as close as possible.
   - Do NOT add new causes, evaluations, or conclusions.
4. Control register (avoid the drift we saw):
   - Avoid informal/subjective filler like "things are changing", "we don't have time", "great scientist", "event".
   - Do not insert "rich people" unless the original explicitly says it; prefer "elites" if present.
5. Keep essential emphasis/nuance:
   - If the original uses a meaningful rhetorical point (e.g., "literally" in "underground artist, literally"), keep it if it changes meaning.
   - Humor/idioms: you may simplify, but do not change the intended point.
6. Mechanics and standard written English:
   - Use correct plural forms for acronyms (prefer "EQs", not "EQ's", unless the original must be preserved verbatim).
   - Keep capitalization of proper nouns and standard punctuation.

BEGINNER (A2-B1) RULES
- Short, clear sentences (average 8-14 words).
- High-frequency vocabulary; avoid jargon and abstract noun-heavy style.
- Prefer active voice.
- Minimal relative clauses.
- Use simple linking words: because, so, but, however, also, for example.
- If a technical term must remain (e.g., "Cephalization index"), keep it and add a very short gloss in parentheses ONLY once per paragraph.

INTERMEDIATE (B1-B2) RULES
- Clear academic style but not advanced.
- Some longer sentences allowed; keep readability.
- Use a wider range of linking words: therefore, although, however, as a result, in addition, finally.
- Keep important technical terms; brief definitions only if needed.

OUTPUT FORMAT (STRICT)
Return ONLY valid JSON (no markdown, no commentary, no extra text).
Use exactly this schema:

{
  "source_title": "",
  "paragraphs": [
    {
      "id": 1,
      "original": "",
      "beginner_A2_B1": "",
      "intermediate_B1_B2": "",
      "level_estimate": {
        "beginner": "A2/B1",
        "intermediate": "B1/B2"
      },
      "quality_checks": {
        "facts_preserved": true,
        "key_terms_preserved": true,
        "register_appropriate": true,
        "notes": []
      },
      "simplifications": {
        "beginner_changes": [
          { "from": "", "to": "" }
        ],
        "intermediate_changes": [
          { "from": "", "to": "" }
        ]
      }
    }
  ]
}

JSON RULES
- Keep paragraph order and numbering.
- All fields must be present for every paragraph.
- Use plain strings; use \n for line breaks inside strings if needed.
- Escape quotes correctly.
"""
        prompt = static_prompt + f"""
Text to simplify:
"{original_text}"
"""

        try:
            response = client.models.generate_content(
                model="gemini-2.0-flash", 
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            
            result = json.loads(response.text)
            
            # Extract from new schema
            # schema: { "paragraphs": [ { "beginner_A2_B1": "...", "intermediate_B1_B2": "..." } ] }
            if "paragraphs" in result and len(result["paragraphs"]) > 0:
                para = result["paragraphs"][0]
                beginner_text = para.get("beginner_A2_B1", "")
                inter_text = para.get("intermediate_B1_B2", "")
                
                df.at[idx, 'Beginner Ver'] = beginner_text
                df.at[idx, 'Inter Ver'] = inter_text
            else:
                print(f"Warning row {idx}: Unexpected JSON structure")
            
            print(f"Processed row {idx} ({i+1}/{len(rows_to_process)})")
            
            # Rate limiting
            time.sleep(1)
            
            # Incremental Save
            if (i + 1) % save_interval == 0:
                print(f"Saving progress to {output_file}...")
                df.to_excel(output_file, index=False, engine='openpyxl')

        except Exception as e:
            print(f"Error on row {idx}: {e}")
            # Wait longer on error
            time.sleep(5)

    # Save
    print(f"Saving to {output_file}...")
    df.to_excel(output_file, index=False, engine='openpyxl')
    
    # Preview
    print("\n--- Preview ---")
    print(df[['Full Text', 'Beginner Ver', 'Inter Ver']].loc[rows_to_process].to_string())

if __name__ == "__main__":
    simplify_text()
