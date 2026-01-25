import pandas as pd

try:
    xl = pd.ExcelFile('WFD.xlsx')
    df = xl.parse('Questions', header=None)
    print("\n--- Sheet: Questions (header=None) ---")
    print(df.head(10))
except Exception as e:
    print(f"Error: {e}")
