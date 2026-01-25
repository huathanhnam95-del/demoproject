import pandas as pd
import numpy as np

def calculate_score(sentence):
    if not isinstance(sentence, str) or not sentence.strip():
        return 0
    words = sentence.split()
    if not words:
        return 0
    word_count = len(words)
    avg_word_length = sum(len(word) for word in words) / word_count
    return word_count + (avg_word_length * 1.5)

def assign_level(score):
    if score < 17.5:
        return 1
    elif score < 19.0:
        return 2
    else:
        return 3

def main():
    file_path = 'WFD.xlsx'
    print(f"Reading {file_path}...")
    
    xl = pd.ExcelFile(file_path)
    sheets_data = {name: xl.parse(name) for name in xl.sheet_names}
    
    if 'Questions' not in sheets_data:
        print("Error: 'Questions' sheet not found.")
        return

    df = sheets_data['Questions']
    print(f"Processing {len(df)} questions...")
    
    # Assuming 'ANSWER' column contains the sentence
    sentence_col = 'ANSWER' if 'ANSWER' in df.columns else df.columns[2]
        
    df['Level_Score'] = df[sentence_col].apply(calculate_score)
    df['Level'] = df['Level_Score'].apply(assign_level)
    
    # Remove the temporary score column before saving
    df.drop(columns=['Level_Score'], inplace=True)
    
    print("Final Level Distribution:")
    print(df['Level'].value_counts().sort_index())
    
    # Save back to WFD.xlsx
    with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
        for sheet_name, sheet_df in sheets_data.items():
            if sheet_name == 'Questions':
                df.to_excel(writer, sheet_name=sheet_name, index=False)
            else:
                sheet_df.to_excel(writer, sheet_name=sheet_name, index=False)
                
    print(f"Successfully updated {file_path}")

if __name__ == "__main__":
    main()
