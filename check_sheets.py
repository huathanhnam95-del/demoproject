import pandas as pd

try:
    xl = pd.ExcelFile('WFD.xlsx')
    print("Sheets:", xl.sheet_names)
    for sheet in xl.sheet_names:
        df = xl.parse(sheet)
        print(f"\nSheet: {sheet}")
        print(df.head(2))
except Exception as e:
    print(f"Error: {e}")
