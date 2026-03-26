import pandas as pd
import json
import re

def smart_chunk_text(text):
    # Remove existing chunks to start fresh
    text = re.sub(r'\s*/\s*', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    words = text.split()
    if not words: return text
    
    chunks = []
    current_chunk = []
    
    punct = {',', '.', ';', ':', '-', '—', '?', '!'}
    
    # Grammatical break triggers
    rel_pronouns = {'which', 'that', 'who', 'where', 'when', "that's", "who's"}
    conjunctions = {'and', 'but', 'or', 'so', 'yet'}
    prepositions = {'in', 'on', 'at', 'for', 'with', 'by', 'to', 'from', 'of', 'about', 'into', 'through', 'over', 'under', 'between', 'among', 'during'}
    
    for i, word in enumerate(words):
        # 1. Break after punctuation
        if current_chunk and current_chunk[-1][-1] in punct:
            # Don't break if it's an acronym like U.S. or e.g.
            if len(current_chunk[-1]) > 2 or current_chunk[-1] == "I.":
                chunks.append(" ".join(current_chunk))
                current_chunk = [word]
                continue
                
        clean_word = word.lower().strip(',.;:-?!\"\']')
        
        should_break = False
        
        # 2. Break before relative pronouns and conjunctions if the chunk is getting long enough
        if len(current_chunk) >= 5:
            if clean_word in rel_pronouns or clean_word in conjunctions:
                should_break = True
                
        # 3. Break before prepositions only if the chunk is quite long
        if len(current_chunk) >= 7:
            if clean_word in prepositions:
                should_break = True
                
        # 4. Force break if chunk is extremely long (e.g. 12+ words) and we hit any minor boundary
        if len(current_chunk) >= 12 and (clean_word in prepositions or clean_word in rel_pronouns or clean_word in conjunctions or clean_word in {'as', 'if', 'because'}):
            should_break = True
            
        if should_break:
            chunks.append(" ".join(current_chunk))
            current_chunk = [word]
        else:
            current_chunk.append(word)
            
    if current_chunk:
        chunks.append(" ".join(current_chunk))
        
    # Clean up any leftover punctuation chunks
    final_output = " / ".join(chunks)
    
    return final_output

def main():
    json_path = "RA_extracted.json"
    excel_path = "public/database/RA/RA.xlsx"
    out_excel_path = "public/database/RA/RA_updated.xlsx"
    
    print("Loading data...")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    df = pd.read_excel(excel_path)
    
    chunk_map = {}
    for item in data:
        text = item.get('text', '')
        if not text:
            text = item.get('current_chunked', '').replace('/', '')
        if not text: continue
            
        new_chunked = smart_chunk_text(text)
        chunk_map[item['id']] = new_chunked

    # Apply to dataframe
    updated = 0
    for idx, row in df.iterrows():
        q_id = row.get("ID")
        if pd.isna(q_id): continue
            
        try:
            q_id_int = int(q_id)
            if q_id_int in chunk_map:
                df.at[idx, "ANSWER CHUNKED"] = chunk_map[q_id_int]
                updated += 1
        except ValueError:
            pass
            
    # Save the updated Excel
    print(f"Saving {out_excel_path}...")
    df.to_excel(out_excel_path, index=False)
    
    print(f"Done! Rechunked {updated} questions directly and instantly.")
    
    # Print an example for ID 8
    ex_8 = chunk_map.get(8)
    if ex_8:
        print("\nExample (ID 8):")
        print(ex_8)

if __name__ == "__main__":
    main()
