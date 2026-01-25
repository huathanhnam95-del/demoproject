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
    
    # Let's try to base it on quantiles for better distribution
    q33 = df['Level_Score'].quantile(0.33)
    q66 = df['Level_Score'].quantile(0.66)
    
    print(f"33rd percentile: {q33}")
    print(f"66th percentile: {q66}")
    
    def get_level(score):
        if score < q33: return 1
        if score < q66: return 2
        return 3
    
    df['New_Level'] = df['Level_Score'].apply(get_level)
    print("\nNew Level Distribution:")
    print(df['New_Level'].value_counts().sort_index())
    
    print("\nSamples from each level:")
    for l in [1, 2, 3]:
        print(f"\n--- Level {l} ---")
        samples = df[df['New_Level'] == l].sample(5)['ANSWER'].tolist()
        for s in samples:
            print(f"- {s}")

except Exception as e:
    print(f"Error: {e}")
