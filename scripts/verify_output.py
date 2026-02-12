import pandas as pd

def show_samples():
    file_path = r'C:\Cursor AI\public\database\RFIB\RFIB_simplified.xlsx'
    df = pd.read_excel(file_path, engine='openpyxl')
    
    # Get first 5 valid rows
    df = df[df['Beginner Ver'].notna() & (df['Beginner Ver'] != "")]
    samples = df.head(5)
    
    output_path = r'C:\Cursor AI\scripts\samples_debug.txt'
    with open(output_path, 'w', encoding='utf-8') as f:
        for i, row in samples.iterrows():
            f.write(f"\n--- ROW {i} ---\n")
            f.write(f"ORIGINAL: {row['Full Text'][:200]}...\n")
            f.write(f"BEGINNER: {row['Beginner Ver']}\n")
            f.write(f"INTERMED: {row['Inter Ver']}\n")
            f.write("-" * 50 + "\n")

    print("Samples saved to samples.txt")

if __name__ == "__main__":
    show_samples()
