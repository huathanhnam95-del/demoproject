import pandas as pd

try:
    xl = pd.ExcelFile('WFD.xlsx')
    for sheet in xl.sheet_names:
        df = xl.parse(sheet)
        print(f"\n--- Sheet: {sheet} ---")
        print(f"Columns: {df.columns.tolist()}")
        print("Sample Data (first 10 rows):")
        print(df.head(10))
        print("-" * 30)
except Exception as e:
    print(f"Error: {e}")
