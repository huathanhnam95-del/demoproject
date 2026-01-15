import firebase_admin
from firebase_admin import credentials, firestore
import os

# Initialize Firebase
# Path to service account key from the project root
key_path = "c:\\Cursor AI\\serviceAccountKey.json"

if not os.path.exists(key_path):
    print(f"Error: Service account key not found at {key_path}")
    exit(1)

cred = credentials.Certificate(key_path)
firebase_admin.initialize_app(cred)
db = firestore.client()

def clear_word_cache(word):
    word = word.lower().strip()
    # Check both potential collections
    collections = ['word_references', 'dictionary_cache']
    
    for coll_name in collections:
        doc_ref = db.collection(coll_name).document(word)
        doc = doc_ref.get()
        if doc.exists:
            print(f"Deleting '{word}' from collection '{coll_name}'...")
            doc_ref.delete()
            print("Done.")
        else:
            print(f"Word '{word}' not found in collection '{coll_name}'.")

if __name__ == "__main__":
    clear_word_cache("anonymous")
