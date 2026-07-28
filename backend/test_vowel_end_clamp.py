#!/usr/bin/env python3
"""
Test script to verify vowel-end clamping fix.
Tests words with onset clusters that previously caused leakage.
"""
import requests
import json

BASE_URL = "http://127.0.0.1:8080"

def run_analyze_url(word):
    """Test by analyzing the native audio from MW dictionary."""
    print(f"\n{'='*60}")
    print(f"Testing: {word}")
    print('='*60)
    
    # First get the dictionary data
    dict_resp = requests.get(f"{BASE_URL}/dictionary/{word}", timeout=10)
    if dict_resp.status_code != 200:
        print(f"Dictionary error: {dict_resp.status_code}")
        return
    
    dict_data = dict_resp.json()
    if not dict_data.get('found'):
        print(f"Word not found in dictionary")
        return
        
    audio_url = dict_data.get('audio_url')
    syllables = dict_data.get('syllables', [])
    num_syls = len(syllables)
    
    if not audio_url:
        print("No audio URL found")
        return
        
    print(f"Audio URL: {audio_url}")
    print(f"Syllable count: {num_syls}")
    print(f"Syllables: {dict_data.get('syllable_spans')}")
    
    # Now post to analyze-url
    payload = {
        "audioUrl": audio_url,
        "expectedSyllables": num_syls
    }
    
    resp = requests.post(f"{BASE_URL}/analyze-url", json=payload, timeout=30)
    if resp.status_code != 200:
        print(f"Analyze error: {resp.status_code} - {resp.text}")
        return
        
    result = resp.json()
    analyzed_syls = result.get('syllables', [])
    
    print("\nResults:")
    for s in analyzed_syls:
        print(f"  Syl {s['syllable']}: {s['startTime']:.3f}s - {s['endTime']:.3f}s (dur: {s['duration']:.3f}s)")
        
    if len(analyzed_syls) >= 2:
        syl1_dur = analyzed_syls[0]['duration']
        avg_dur = sum(s['duration'] for s in analyzed_syls) / len(analyzed_syls)
        ratio = syl1_dur / avg_dur if avg_dur > 0 else 0
        
        print(f"\nSyl1 / Avg ratio: {ratio:.2f}x")
        if ratio > 1.4:
            print("⚠️  WARNING: Syl1 duration seems unusually long!")
            print("     This may indicate onset cluster leakage!")
        else:
            print(f"\n✅ Syl1 duration looks reasonable (avg: {avg_dur:.3f}s)")
    
    return result

if __name__ == "__main__":
    # Test words with onset clusters
    test_words = [
        "improve",     # /ɪmˈpruːv/ - /pr/ cluster
        "approve",     # /əˈpruːv/ - /pr/ cluster  
        "embrace",     # /ɪmˈbreɪs/ - /br/ cluster (voiced)
        "springy",     # /ˈsprɪŋi/ - /spr/ cluster
    ]
    
    for word in test_words:
        try:
            run_analyze_url(word)
        except Exception as e:
            print(f"Error testing {word}: {e}")
