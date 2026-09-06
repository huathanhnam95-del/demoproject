import json

with open('scripts/write_essay_support/all_832_collocations.json', 'r', encoding='utf-8') as f:
    terms = json.load(f)

with open('scripts/write_essay_support/all_collocations_list.txt', 'w', encoding='utf-8') as f:
    for t in sorted(terms):
        f.write(t + '\n')

print(f"Wrote {len(terms)} terms to scripts/write_essay_support/all_collocations_list.txt")
