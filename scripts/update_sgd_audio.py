import pandas as pd
import os

files = [
    'C:/Cursor AI/public/database/SGD/SGD/SGD.xlsx',
    'C:/Cursor AI/public/database/SGD/SGD/SGD_enriched.xlsx'
]

for file_path in files:
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        continue
    
    print(f"Updating {file_path}...")
    df = pd.read_excel(file_path)
    
    # Add AUDIO_URL column if it doesn't exist
    if 'AUDIO_URL' not in df.columns:
        df['AUDIO_URL'] = df['ID'].apply(lambda x: f"database/SGD/audio/{int(x)}.mp3" if pd.notnull(x) else "")
    else:
        df['AUDIO_URL'] = df['ID'].apply(lambda x: f"database/SGD/audio/{int(x)}.mp3" if pd.notnull(x) else df.loc[df['ID'] == x, 'AUDIO_URL'].values[0])

    df.to_excel(file_path, index=False)
    print(f"Successfully updated {file_path}")
