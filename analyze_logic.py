import pandas as pd

try:
    xl = pd.ExcelFile('WFD.xlsx')
    df = xl.parse('Questions')
    
    print(f"Total Questions: {len(df)}")
    print("\nSample Data:")
    for i, row in df.head(5).iterrows():
        sentence = str(row['ANSWER'])
        words = sentence.split()
        print(f"ID: {row['ID']} | Words: {len(words)} | Text: {sentence[:100]}...")

except Exception as e:
    print(f"Error: {e}")
