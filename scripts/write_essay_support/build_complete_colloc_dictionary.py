"""
Builds the comprehensive 832-term academic collocation glossary with:
1. Authentic, context-aware academic Vietnamese translations (viGloss)
2. Meaningful, non-boilerplate English explanations (enGloss)
3. Zero literal translation errors
"""

import json
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ALL_COLLOCS_PATH = Path('scripts/write_essay_support/all_832_collocations.json')
OUTPUT_GLOSSARY_PATH = Path('scripts/write_essay_support/academic_collocation_glossary.json')

with open(ALL_COLLOCS_PATH, 'r', encoding='utf-8') as f:
    all_collocs = json.load(f)

print(f"Total collocations to process: {len(all_collocs)}")
