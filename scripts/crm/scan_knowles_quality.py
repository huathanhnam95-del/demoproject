# scripts/crm/scan_knowles_quality.py
import json
import re
import os
import sys

def is_scanner_noise_line(line: str) -> bool:
    if not line:
        return False
    trimmed = line.strip()
    if re.match(r'^\d{1,4}$', trimmed) or re.match(r'^\d+(?:\.\d+)+$', trimmed):
        return False
    letters = re.findall(r'[a-zA-Z]', trimmed)
    letter_count = len(letters)
    if letter_count == 0:
        return True
    if len(trimmed) < 3 and letter_count < 2:
        return True
    if re.search(r'(?:,{2,}|\[;|;{2,}|\.{3,}|-{3,}|%{2,})', trimmed):
        return True
    puncts = re.findall(r'[^a-zA-Z0-9\s]', trimmed)
    punct_count = len(puncts)
    if punct_count > 3 and punct_count >= letter_count:
        return True
    if punct_count >= 3 and re.search(r'[[\];%,]', trimmed) and letter_count < 15:
        return True
    if re.match(r'^[%#*~_+|=]{1,3}[.,;:\s-]*$', trimmed):
        return True
    return False

def analyze_page(page_num: int, raw_text: str):
    text = (raw_text or '').replace('\r\n', '\n')
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    chars = len(text)
    words = text.split()
    word_count = len(words)
    
    noise_lines = [l for l in lines if is_scanner_noise_line(l)]
    glued_words = [w for w in words if len(w) > 25 and not re.search(r'https?://', w)]
    hyphen_breaks = re.findall(r'[a-zA-Z]+-\s*\n\s*[a-zA-Z]+', text)
    
    # Suspicious OCR symbols like isolated digits in words, repeated symbols
    ocr_anomalies = []
    for w in words:
        if re.search(r'[a-z][0-9][a-z]', w): # e.g. l0ve
            ocr_anomalies.append(w)
        elif re.search(r'^[A-Z]{4,}[0-9]+', w): # e.g. KNOVII6
            ocr_anomalies.append(w)
            
    # Page classification
    flags = []
    if len(noise_lines) > 0:
        flags.append(f'noise_lines_{len(noise_lines)}')
    if len(glued_words) > 0:
        flags.append(f'glued_words_{len(glued_words)}')
    if len(ocr_anomalies) > 0:
        flags.append(f'ocr_anomalies_{len(ocr_anomalies)}')
    if chars < 150:
        flags.append('short_page')
    if page_num <= 15:
        flags.append('front_matter')
    elif page_num >= 195:
        flags.append('end_matter')
        
    return {
        'page': page_num,
        'chars': chars,
        'words': word_count,
        'lines': len(lines),
        'noise_lines': noise_lines,
        'glued_words': glued_words,
        'hyphen_breaks': len(hyphen_breaks),
        'ocr_anomalies': ocr_anomalies,
        'flags': flags,
        'is_anomaly': len(flags) > 0 and any('noise' in f or 'glued' in f or 'ocr' in f for f in flags)
    }

def main():
    with open('tmp/knowles_rev001_pages.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    pages = data.get('pages', [])
    print(f'Analyzing {len(pages)} pages of Knowles...')
    
    results = []
    anomaly_pages = []
    
    for i, p in enumerate(pages):
        res = analyze_page(i + 1, p)
        results.append(res)
        if res['is_anomaly']:
            anomaly_pages.append(res)
            
    print(f'Total pages analyzed: {len(results)}')
    print(f'Anomaly pages flagged: {len(anomaly_pages)}')
    
    os.makedirs('reports', exist_ok=True)
    with open('reports/knowles_heuristic_scan.json', 'w', encoding='utf-8') as f:
        json.dump({
            'total_pages': len(results),
            'anomaly_count': len(anomaly_pages),
            'anomaly_pages': [p['page'] for p in anomaly_pages],
            'details': results
        }, f, indent=2)
        
    print('Summary written to reports/knowles_heuristic_scan.json')
    
    # Print top 15 anomaly pages
    print('\n=== TOP FLAGGED ANOMALY PAGES ===')
    for p in anomaly_pages[:15]:
        print(f"Page {p['page']}: chars={p['chars']}, flags={p['flags']}, noise={p['noise_lines'][:2]}, ocr={p['ocr_anomalies'][:2]}")

if __name__ == '__main__':
    main()
