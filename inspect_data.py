import pandas as pd

try:
    df = pd.read_excel('WFD.xlsx')
    print("Columns:", df.columns.tolist())
    print("\nFirst 5 rows:")
    print(df.head())
    print("\nValue counts for 'Mode' or similar column if it exists:")
    # Look for a mode column
    mode_cols = [col for col in df.columns if 'mode' in col.lower()]
    if mode_cols:
        for col in mode_cols:
            print(f"\nValue counts for {col}:")
            print(df[col].value_counts())
    else:
        print("\nNo 'Mode' column found. Printing unique values of each column to identify content:")
        for col in df.columns:
            print(f"- {col}: {df[col].nunique()} unique values")
except Exception as e:
    print(f"Error: {e}")
