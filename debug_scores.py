import pandas as pd

def calculate_score(sentence):
    if not isinstance(sentence, str) or not sentence.strip():
        return 0
    words = sentence.split()
    if not words:
        return 0
    word_count = len(words)
    avg_word_length = sum(len(word) for word in words) / word_count
    return word_count + (avg_word_length * 1.5)

try:
    df = pd.read_excel('WFD.xlsx')
    df['Level_Score'] = df['ANSWER'].apply(calculate_score)
    
    print("\nTop 10 highest scorers:")
    print(df.sort_values(by='Level_Score', ascending=False)[['ANSWER', 'Level_Score', 'Level']].head(10))
    
    print("\nScore range statistics:")
    print(df['Level_Score'].describe())
    
except Exception as e:
    print(f"Error: {e}")
