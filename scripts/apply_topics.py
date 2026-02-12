import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
import pickle
import os

def apply_topics():
    # File usage
    input_file = r'C:\Cursor AI\public\database\RFIB\RFIB_processed.xlsx'
    cache_path = r'C:\Cursor AI\public\database\RFIB\embeddings_cache.pkl'

    # 1. Load Data
    print(f"Loading {input_file}...")
    df = pd.read_excel(input_file, engine='openpyxl')
    
    if 'Full Text' not in df.columns:
        print("Error: 'Full Text' column missing.")
        return

    # 2. Load Embeddings
    if not os.path.exists(cache_path):
        print("Error: Cache not found. Run analyze_topics.py first.")
        return
    
    print("Loading cached embeddings...")
    with open(cache_path, 'rb') as f:
        embeddings = pickle.load(f)

    # 3. Perform Clustering (Reproduce behavior)
    # Note: K-Means is deterministic with random_state=42
    print("Re-running clustering to match IDs...")
    num_clusters = 20
    kmeans = KMeans(n_clusters=num_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(embeddings) # This should yield same labels as analysis step

    # 4. Define Mapping (Based on analysis)
    topic_map = {
        0: "Science: Genetics & Biology",
        1: "Technology & Digital Age",
        2: "Nature: Animals & Evolution",
        3: "Society: Global Issues",
        4: "Science: Space & Physics",
        5: "Business: Marketing",
        6: "Communication & Psychology",
        7: "Environment: Conservation",
        8: "Environment: Climate & Water",
        9: "Education",
        10: "Politics: International Relations",
        11: "Science: Health & Food",
        12: "Society: Sustainability",
        13: "Society: Urban Living",
        14: "Health: Diet & Wellness",
        15: "Psychology: Mind & Behavior",
        16: "Arts: Design & Culture",
        17: "History & Culture",
        18: "Society: Work & Family",
        19: "Business: Leadership & Management"
    }

    # 5. Apply Topics
    print("Applying topics...")
    # Map labels to topics
    df['Topic'] = [topic_map[label] for label in labels]
    
    # 6. Save
    # We want to input the Topic in column E. 
    # If the file has A, B, C, D(Full Text), then E is index 4.
    # Pandas handles column names automatically.
    
    # Reorder columns to ensure Topic is at E (5th column) if possible or just append
    # User said: "Input the Topic in column E."
    # Let's ensure 'Topic' is the 5th column if the dataframe has fewer columns
    # but since we processed it, it likely has A,B,C,Full Text. So Topic will be 5th.
    
    output_path = r'C:\Cursor AI\public\database\RFIB\RFIB_with_topics.xlsx'
    print(f"Saving to {output_path}...")
    df.to_excel(output_path, index=False, engine='openpyxl')
    print("Success! Topics applied.")

    # Verification: Print counts
    print("\nTopic Distribution:")
    print(df['Topic'].value_counts())

if __name__ == "__main__":
    apply_topics()
