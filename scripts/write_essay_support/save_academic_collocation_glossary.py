#!/usr/bin/env python3
"""
Writes the comprehensive 833-term academic collocation glossary to:
scripts/write_essay_support/academic_collocation_glossary.json
"""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.write_essay_support.generate_all_832_collocation_glossary import VIETNAMESE_CURATED
from scripts.write_essay_support.collocation_definitions import SPECIFIC_EN

GLOSSARY_PATH = Path('scripts/write_essay_support/academic_collocation_glossary.json')

glossary = {}
for term in sorted(VIETNAMESE_CURATED.keys()):
    glossary[term] = {
        "enGloss": SPECIFIC_EN[term],
        "viGloss": VIETNAMESE_CURATED[term]
    }

with open(GLOSSARY_PATH, 'w', encoding='utf-8') as f:
    json.dump(glossary, f, ensure_ascii=False, indent=2)

print(f"Successfully wrote {len(glossary)} collocations to {GLOSSARY_PATH}")
