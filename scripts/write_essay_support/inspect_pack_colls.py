import glob
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

for p in sorted(glob.glob('public/database/Write Essay/support/v1/packs/q*.json'))[1:6]:
    d = json.load(open(p, encoding='utf-8'))
    qid = d.get('questionId')
    for lvl in ['a2_b1', 'b2', 'c1']:
        colls = d.get('levels', {}).get(lvl, {}).get('languageKit', {}).get('collocations', [])
        for c in colls:
            print(f"q{qid:4} {lvl:5} {c.get('term'):25} -> {c.get('viGloss')}")
