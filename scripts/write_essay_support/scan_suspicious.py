import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/all_832_draft_vi.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

print(f"Total entries: {len(d)}")

# Check for single-word translations where term is multi-word
suspicious = []
for k, v in sorted(d.items()):
    # Check length
    if len(v.split()) == 1 and len(k.split()) > 1:
        suspicious.append((k, v, "Single word translation for multi-word phrase"))
    # Check if translation is identical to English
    if v.lower() == k.lower():
        suspicious.append((k, v, "Translation identical to English"))
    # Check for English words remaining in Vietnamese translation
    words = [w.strip("(),/") for w in v.split()]
    for w in words:
        if re.match(r'^[a-zA-Z]{4,}$', w) and w.lower() not in ['internet', 'online', 'stress', 'pr', 'marketing', 'video', 'radio', 'tv', 'tourist', 'tour']:
            suspicious.append((k, v, f"English word in translation: {w}"))
            break

print(f"Suspicious entries: {len(suspicious)}")
for k, v, reason in suspicious:
    print(f"  {k:30} -> {v:30} ({reason})")
