import json
import urllib.parse
import urllib.request
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

def translate_batch_online(terms, source='en', target='vi'):
    if not terms:
        return {}
    text = '\n'.join(terms)
    url = f'https://translate.googleapis.com/translate_a/single?client=gtx&sl={source}&tl={target}&dt=t&q={urllib.parse.quote(text)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
            translated_text = ''.join([part[0] for part in data[0] if part[0]])
            lines = [l.strip() for l in translated_text.split('\n')]
            mapping = {}
            for i, term in enumerate(terms):
                if i < len(lines) and lines[i]:
                    mapping[term] = lines[i]
                else:
                    mapping[term] = term
            return mapping
    except Exception as e:
        print(f"Error: {e}")
        return {term: term for term in terms}

with open('scripts/write_essay_support/missing_375_collocations.json', 'r', encoding='utf-8') as f:
    missing = json.load(f)

results = {}
batch_size = 40
for i in range(0, len(missing), batch_size):
    chunk = missing[i:i+batch_size]
    print(f"Translating {i} to {i+len(chunk)}...")
    res = translate_batch_online(chunk)
    results.update(res)
    time.sleep(0.3)

with open('scripts/write_essay_support/raw_translated_375.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"Done! Translated {len(results)} terms saved to raw_translated_375.json")
