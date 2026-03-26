import pandas as pd
import json

def main():
    json_path = "RA_rechunked.json"
    excel_path = "public/database/RA/RA.xlsx"
    
    print(f"Loading {json_path}...")
    with open(json_path, 'r', encoding='utf-8') as f:
        rechunked_data = json.load(f)
        
    # Create lookup dictionary: id -> new_chunked
    chunk_map = {item['id']: item['new_chunked'] for item in rechunked_data}
    
    print(f"Loading {excel_path}...")
    df = pd.read_excel(excel_path)
    
    # Track changes
    updated_count = 0
    
    for idx, row in df.iterrows():
        q_id = row.get("ID")
        if pd.isna(q_id):
            continue
            
        try:
            q_id_int = int(q_id)
            if q_id_int in chunk_map:
                df.at[idx, "ANSWER CHUNKED"] = chunk_map[q_id_int]
                updated_count += 1
        except ValueError:
            pass
            
    output_path = "public/database/RA/RA_updated.xlsx"
    print(f"Saving updated {output_path}...")
    df.to_excel(output_path, index=False)
    print(f"Successfully updated {updated_count} rows in RA_updated.xlsx!")

if __name__ == "__main__":
    main()
