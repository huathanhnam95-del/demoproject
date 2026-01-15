#!/usr/bin/env python3
"""
Test script to verify vowel-end clamping fix.
Tests words with onset clusters that previously caused leakage.
"""
import requests
import json

BASE_URL = "http://127.0.0.1:8080"

def test_analyze_url(word):
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
    
    data = dict_data['data']
    print(f"Syllables: {data.get('syllables')} ({data.get('syllableCount')})")
    print(f"Stressed: syllable {data.get('stressedSyllable', 0) + 1}")
    print(f"Audio URL: {data.get('audioUrl')}")
    
    audio_url = data.get('audioUrl')
    if not audio_url:
        print("No audio URL available")
        return
    
    # Analyze the native audio
    analyze_resp = requests.post(
        f"{BASE_URL}/analyze-url",
        json={
            "audioUrl": audio_url,
            "expectedSyllables": data.get('syllableCount')
        },
        timeout=30
    )
    
    if analyze_resp.status_code != 200:
        print(f"Analyze error: {analyze_resp.status_code}")
        print(analyze_resp.text[:500])
        return
    
    result = analyze_resp.json()
    
    print(f"\nAnalysis Result:")
    print(f"  Duration: {result.get('duration')}s")
    print(f"  Syllables detected: {len(result.get('syllables', []))}")
    
    syllables = result.get('syllables', [])
    for i, syl in enumerate(syllables):
        stressed = " ★" if syl.get('isStressed') else ""
        print(f"  Syl {i+1}: {syl['startTime']:.3f}s - {syl['endTime']:.3f}s "
              f"(dur: {syl['duration']:.3f}s, pitch: {syl.get('avgPitch', 0):.0f}Hz){stressed}")
    
    # Check for potential leakage (Syl1 too long relative to avg)
    if len(syllables) >= 2:
        avg_dur = sum(s['duration'] for s in syllables) / len(syllables)
        if syllables[0]['duration'] > avg_dur * 1.8:
            print(f"\n⚠️  WARNING: Syl1 duration ({syllables[0]['duration']:.3f}s) is >1.8x average ({avg_dur:.3f}s)")
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
            test_analyze_url(word)
        except Exception as e:
            print(f"Error testing {word}: {e}")
