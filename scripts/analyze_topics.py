import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
import os
import pickle

def analyze_topics():
    file_path = r'C:\Cursor AI\public\database\RFIB\RFIB_processed.xlsx'
    cache_path = r'C:\Cursor AI\public\database\RFIB\embeddings_cache.pkl'
    
    print(f"Loading {file_path}...")
    df = pd.read_excel(file_path, engine='openpyxl')
    
    # Ensure "Full Text" column exists
    if 'Full Text' not in df.columns:
        print("Error: 'Full Text' column not found.")
        return

    sentences = df['Full Text'].astype(str).tolist()
    
    # Load or Generate Embeddings
    if os.path.exists(cache_path):
        print("Loading cached embeddings...")
        with open(cache_path, 'rb') as f:
            embeddings = pickle.load(f)
    else:
        print("Generating embeddings (this may take a moment)...")
        model = SentenceTransformer('all-MiniLM-L6-v2')
        embeddings = model.encode(sentences, show_progress_bar=True)
        with open(cache_path, 'wb') as f:
            pickle.dump(embeddings, f)
            print("Embeddings cached.")

    # Clustering
    num_clusters = 20
    print(f"Clustering into {num_clusters} topics...")
    kmeans = KMeans(n_clusters=num_clusters, random_state=42, n_init=10)
    kmeans.fit(embeddings)
    
    labels = kmeans.labels_
    
    # Find representative sentences (closest to cluster center)
    print("\n--- Topic Clusters Analysis ---")
    for i in range(num_clusters):
        # Indices of points in this cluster
        cluster_indices = np.where(labels == i)[0]
        
        # Calculate distances to center for points in this cluster
        center = kmeans.cluster_centers_[i]
        cluster_embeddings = embeddings[cluster_indices]
        distances = np.linalg.norm(cluster_embeddings - center, axis=1)
        
        # Get closest and a few random terms
        closest_idx_in_cluster = np.argmin(distances)
        closest_global_idx = cluster_indices[closest_idx_in_cluster]
        
        representative = sentences[closest_global_idx]
        
        print(f"\nCluster {i} (Count: {len(cluster_indices)})")
        print(f"Rep: {representative[:150]}...")
        
        # Show 2 more random samples
        if len(cluster_indices) > 2:
            sample_indices = np.random.choice(cluster_indices, 2, replace=False)
            for idx in sample_indices:
                print(f"   - {sentences[idx][:100]}...")

if __name__ == "__main__":
    analyze_topics()
