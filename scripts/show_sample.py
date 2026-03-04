import pandas as pd
import sys

# Set encoding to utf-8 for stdout
sys.stdout.reconfigure(encoding='utf-8')

file_path = r'C:\Cursor AI\public\database\RFIB\RFIB_simplified.xlsx'
df = pd.read_excel(file_path, engine='openpyxl')

# Get first row with data
df = df[df['Beginner Ver'].notna() & (df['Beginner Ver'] != "")]
if len(df) > 0:
    row = df.iloc[0]
    print("Dumping to sample_out.json...")
    sample_data = {
        "original": row['Full Text'],
        "beginner": row['Beginner Ver'],
        "intermediate": row['Inter Ver']
    }
    import json
    with open(r'C:\Cursor AI\scripts\sample_out.json', 'w', encoding='utf-8') as f:
        json_str = json.dumps(sample_data, indent=2, ensure_ascii=False)
        f.write(json_str)
    print("Done.")
else:
    print("No simplified data found.")
