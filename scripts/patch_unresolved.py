import json
import os

def load_jsonl(path):
    records = {}
    if not os.path.exists(path):
        return records
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                r = json.loads(line)
                records[r['id']] = r
    return records

def save_jsonl(path, records):
    with open(path, 'w', encoding='utf-8') as f:
        for rid in sorted(records.keys()):
            f.write(json.dumps(records[rid], ensure_ascii=False) + '\n')

# 1. Update RFIB_3model_revision.jsonl
revised = load_jsonl('public/database/RFIB/RFIB_3model_revision.jsonl')

if 146 in revised:
    for b in revised[146].get('blanks', []):
        if b.get('blank_index') == 3:
            b['grammar_tag'] = 'Collocation (Verb + Predicate Adjective)'
            b['final_explanation'] = "The correct answer is 'open' because it pairs with the verb 'leaves' to form the fixed collocation 'leave open the possibility,' which means to allow for a chance, alternative interpretation, or unresolved outcome. In this sentence, the object noun clause ('the possibility that they are not...') is placed after the adjective 'open' for syntactic balance. The other options are incorrect: 'go' is a base verb and cannot function as an adjective complement; 'covered' does not fit the idiom and creates a semantic contradiction; and 'undoubted' means certain, which contradicts the concept of maintaining possibility."
            b['concise_explanation'] = "'Leaves open the possibility' is a fixed collocation meaning to allow for an alternative interpretation. The distractors fail grammatically ('go' is a verb) or semantically ('covered' and 'undoubted' contradict maintaining possibility)."

if 520 in revised:
    for b in revised[520].get('blanks', []):
        if b.get('blank_index') == 4:
            b['grammar_tag'] = 'Grammar/Usage (Catenative Verb of Tendency / Habit)'
            b['final_explanation'] = "The correct answer is 'tend' because it functions as a lexical verb expressing a general inclination, habit, or typical characteristic when paired with a to-infinitive ('tend to be'). In this context, 'tend to be higher-priced' accurately states that B2B transactions are typically or usually more expensive than consumer sales. The other options are incorrect: 'extend' means to make physically or temporally longer; 'contend' means to argue or struggle; and 'pretend' means to act deceptively or simulate an imaginary state."
            b['concise_explanation'] = "'Tend to be' is a standard construction expressing a general habit or typical state (B2B sales are usually higher-priced). The rhyming distractors mean to lengthen ('extend'), argue ('contend'), or fake ('pretend')."

save_jsonl('public/database/RFIB/RFIB_3model_revision.jsonl', revised)
print('Patched Q146 and Q520 in RFIB_3model_revision.jsonl successfully!')

# 2. Update RFIB_audited_sample20.jsonl
audited = load_jsonl('public/database/RFIB/RFIB_audited_sample20.jsonl')
if 146 in audited and 146 in revised:
    audited[146] = revised[146]
    audited[146]['audit_status'] = 'MANUAL_VERIFIED_GOLD'
if 520 in audited and 520 in revised:
    audited[520] = revised[520]
    audited[520]['audit_status'] = 'MANUAL_VERIFIED_GOLD'

save_jsonl('public/database/RFIB/RFIB_audited_sample20.jsonl', audited)
print('Patched Q146 and Q520 in RFIB_audited_sample20.jsonl successfully!')
