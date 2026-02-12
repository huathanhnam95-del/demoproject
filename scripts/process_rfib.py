import pandas as pd
import re
import os

def process_blanks(text):
    if not isinstance(text, str):
        return text
    
    # Regex to find patterns like __opt1/opt2/opt3__
    # This matches "__" followed by anything (not greedy) up to the next "__"
    pattern = r'__(.*?)__'
    
    def replacer(match):
        options_str = match.group(1)
        # Split by '/' and take the first option
        options = options_str.split('/')
        if options:
            return options[0].strip()
        return match.group(0) # Fallback to original if something goes wrong
    
    # Use re.sub with the replacer function
    return re.sub(pattern, replacer, text)

def main():
    file_path = r'C:\Cursor AI\public\database\RFIB\RFIB.xlsx'
    
    if not os.path.exists(file_path):
        print(f"Error: File not found at {file_path}")
        return

    print(f"Reading {file_path}...")
    # Load the Excel file
    # We use engine='openpyxl' for .xlsx files
    df = pd.read_excel(file_path, engine='openpyxl')
    
    # Assume Column C is the 3rd column (index 2)
    # The user said "Text in column C is a reading paragraph with blanks"
    # Let's use iloc to be safe or check columns
    if len(df.columns) < 3:
        print(f"Error: Expected at least 3 columns, found {len(df.columns)}")
        return
    
    # Apply processing to column index 2 (Column C)
    col_c_name = df.columns[2]
    print(f"Processing column: {col_c_name}")
    
    df['Full Text'] = df[col_c_name].apply(process_blanks)
    
    # Debug: Print first 3 rows to verify
    print("\n--- Verification (First 3 rows) ---")
    for i in range(min(3, len(df))):
        original = str(df.iloc[i, 2])
        processed = str(df.loc[i, 'Full Text'])
        print(f"Row {i+1} Original: {original[:100]}...")
        print(f"Row {i+1} Processed: {processed[:100]}...")
        print("-" * 30)

    # Save to a new file to avoid PermissionError if original is open
    output_path = r'C:\Cursor AI\public\database\RFIB\RFIB_processed.xlsx'
    print(f"Saving to {output_path}...")
    df.to_excel(output_path, index=False, engine='openpyxl')
    print(f"Success! Processed paragraphs saved in {output_path}")

if __name__ == "__main__":
    main()
