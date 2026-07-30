import json

with open(r'C:\Cursor AI\public\database\speak\index.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

items = data.get('items', []) if isinstance(data, dict) else data

if not items:
    print('No items found')
else:
    # Look for sentence or text
    text_key = 'correctSentence'
        
    level2 = [i for i in items if i.get('level') == 2]
    level3 = [i for i in items if i.get('level') == 3]
    
    level2.sort(key=lambda x: len(x.get(text_key, '')), reverse=True)
    
    print('=== Level 2 Samples (Top 20 Longest) ===')
    for i in level2[:20]:
        print(f"ID: {i.get('id')} | Length: {len(i.get(text_key, ''))} | Text: {i.get(text_key, '')}")
        
    print('\n=== Level 3 Samples (First 10) ===')
    for i in level3[:10]:
        print(f"ID: {i.get('id')} | Length: {len(i.get(text_key, ''))} | Text: {i.get(text_key, '')}")
