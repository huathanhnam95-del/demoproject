import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/all_832_collocations.json', 'r', encoding='utf-8') as f:
    all_collocs = json.load(f)

# Let's inspect the semantic categories of all 832 terms:
verb_noun = []
adj_noun = []
adv_adj = []
other = []

common_verbs = {
    'accept', 'achieve', 'acquire', 'adopt', 'affect', 'allocate', 'allow', 'apply',
    'assess', 'assume', 'behave', 'begin', 'carry', 'cause', 'change', 'collect',
    'communicate', 'conduct', 'consider', 'contribute', 'convey', 'cover', 'create',
    'deny', 'describe', 'differ', 'discuss', 'draw', 'encourage', 'engage', 'enhance',
    'exercise', 'expand', 'experience', 'explore', 'extract', 'face', 'facilitate',
    'find', 'focus', 'follow', 'foster', 'fulfil', 'gain', 'gather', 'give', 'have',
    'hold', 'impose', 'increase', 'maintain', 'make', 'meet', 'obtain', 'perform',
    'play', 'pose', 'present', 'produce', 'promote', 'provide', 'publish', 'push',
    'raise', 'reach', 'receive', 'reduce', 'remain', 'require', 'resolve', 'seek',
    'serve', 'set', 'share', 'show', 'store', 'take', 'treat', 'undergo', 'use',
    'vary', 'yield'
}

for t in all_collocs:
    w = t.split()
    w1 = w[0]
    if w1 in common_verbs:
        verb_noun.append(t)
    elif w1.endswith('ly'):
        adv_adj.append(t)
    elif len(w) == 2:
        adj_noun.append(t)
    else:
        other.append(t)

print(f"Total: {len(all_collocs)}")
print(f"Verb-led: {len(verb_noun)}")
print(f"Adverb-led: {len(adv_adj)}")
print(f"Adj/Noun-led: {len(adj_noun)}")
print(f"Other (3+ words): {len(other)}")
print("Other:", other)
