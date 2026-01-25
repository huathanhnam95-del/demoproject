import pandas as pd

try:
    xl = pd.ExcelFile('WFD.xlsx')
    if 'Sheet1' in xl.sheet_names:
        df = xl.parse('Sheet1')
        print("\n--- Sheet: Sheet1 ---")
        print(f"Columns: {df.columns.tolist()}")
        print("Sample Data (first 10 rows):")
        print(df.head(10))
    else:
        print("Sheet1 not found.")
except Exception as e:
    print(f"Error: {e}")
