import json

with open('/tmp/asq_files.txt', 'r') as f:
    files = f.read().splitlines()

manifest = {}
for filename in files:
    if filename.endswith('.mp3'):
        # Map "123.mp3" to key "123"
        item_id = filename[:-4]
        manifest[item_id] = filename

with open('c:/Cursor AI/public/database/quiz/ASQ/audio/manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2)

print(f"Created manifest with {len(manifest)} entries.")
