#!/usr/bin/env python3
"""
Populate Describe Image keyPoints from sampleAnswer.full
"""

import json
import os
import shutil
import datetime
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

TARGET_FILE = 'public/database/Describe Image/describe-image-questions.json'

def clean_key_point(text):
    t = text.strip()
    t = re.sub(r'^\((?:In addition,?\s*(?:the chart highlights that)?)?', '', t)
    t = re.sub(r'\)$', '', t)
    t = re.sub(r'^(?:To begin with|Firstly|Secondly|Thirdly|First|Second|Third|However|On the other hand|In addition|Furthermore|Moreover|Besides|Next|Then|Lastly|Finally),?\s*(?:\(?(?:we can see that|it\'s clear that|the chart highlights that)\)?)?\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'^(?:To\s+(?:sum\s+up|conclude)|In\s+conclusion|Overall),?\s*(?:the\s+image\s+(?:shows|highlights)\s+that|there\s+is)?\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'^(?:To the left of this image|In the middle of (?:the|this) image|To the right of the image|At the top of this image|At the bottom of this image|On the left side of this image|On the right side of this image),?\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'^(?:I can see|we can see)\s+(?:that)?\s*', '', t, flags=re.IGNORECASE)
    t = t.strip()
    if t and t[0].islower():
        t = t[0].upper() + t[1:]
    return t

def extract_key_points(q):
    full = q.get('sampleAnswer', {}).get('full', '')
    if not full:
        return [f"Topic: {q.get('title', 'Image Overview')}"]
    
    raw_lines = [l.strip() for l in full.split('\n') if l.strip()]
    if len(raw_lines) < 2:
        raw_lines = [s.strip() for s in re.split(r'(?<=[.!?])\s+', full) if s.strip()]
        
    cleaned_points = []
    
    # 1. Topic/Intro
    intro = clean_key_point(raw_lines[0])
    cleaned_points.append(intro)
    
    # 2. Body features
    body_lines = raw_lines[1:-1] if len(raw_lines) > 2 else raw_lines[1:]
    for bl in body_lines[:2]:
        cleaned = clean_key_point(bl)
        if cleaned and cleaned not in cleaned_points:
            cleaned_points.append(cleaned)
            
    # 3. Conclusion/Trend
    if len(raw_lines) > 2:
        conc = clean_key_point(raw_lines[-1])
        if conc and conc not in cleaned_points:
            cleaned_points.append(conc)
            
    return cleaned_points[:4]

def main():
    backup_dir = os.path.join('.local', 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')

    bak_path = os.path.join(backup_dir, f"describe-image-questions.json.{timestamp}.bak")
    shutil.copy2(TARGET_FILE, bak_path)
    print(f"Backed up to {bak_path}")

    with open(TARGET_FILE, 'r', encoding='utf-8') as f:
        questions = json.load(f)

    updated_count = 0
    for q in questions:
        points = extract_key_points(q)
        assert len(points) >= 2, f"Question {q.get('id')} has fewer than 2 key points: {points}"
        q['keyPoints'] = points
        updated_count += 1

    with open(TARGET_FILE, 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print(f"Successfully populated keyPoints for {updated_count}/{len(questions)} Describe Image questions.")

if __name__ == '__main__':
    main()
