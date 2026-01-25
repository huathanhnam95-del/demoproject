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
        doc_result = doc_ref.get()
        # Handle both sync and async client results
        import inspect
        if inspect.isawaitable(doc_result):
            import asyncio
            async def wrap_awaitable(aw):
                return await aw
            doc = asyncio.run(wrap_awaitable(doc_result))
        else:
            doc = doc_result
            
        if doc.exists:
            print(f"Deleting '{word}' from collection '{coll_name}'...")
            doc_ref.delete()
            print("Done.")
        else:
            print(f"Word '{word}' not found in collection '{coll_name}'.")

if __name__ == "__main__":
    clear_word_cache("anonymous")
