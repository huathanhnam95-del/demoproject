import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/all_832_draft_vi.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

target_words = [
    'novel', 'sound', 'fine', 'gross', 'plant', 'raw', 'hard', 'soft', 'sharp',
    'bear', 'fall', 'spring', 'shed', 'prime', 'lead', 'strike', 'draw', 'cast',
    'stem', 'yield', 'weigh', 'pose', 'mount', 'fuel', 'drive', 'harness', 'foster',
    'spark', 'curb', 'broad', 'narrow', 'deep', 'profound', 'striking', 'compelling'
]

print("Subtle terms matched:")
for k, v in d.items():
    words = k.split()
    matched = [w for w in words if w in target_words]
    if matched:
        print(f"  {k:30} -> {v:30} (matched: {matched})")
