import sys
import os

# Mock the parse_mw_response function logic for verification
def verify_logic():
    primary = {
        'partOfSpeech': 'noun',
        'pronunciation': 'ˈfoʊtəˌɡræf',
        'syllables': ['pho', 'to', 'graph'],
        'syllableCount': 3,
        'stressedSyllable': 0,
        'audioUrl': 'http://example.com/audio.mp3'
    }
    
    alt = {
        'partOfSpeech': 'verb',
        'pronunciation': None,
        'syllableCount': 0,
        'syllables': []
    }
    
    # Logic to verify (extracted from server.py)
    if not alt.get('pronunciation'):
        alt['pronunciation'] = primary.get('pronunciation')
        alt['inheritedPronunciation'] = True
        # NEW FIX:
        alt['syllables'] = primary.get('syllables')
        alt['syllableCount'] = primary.get('syllableCount')
        alt['stressedSyllable'] = primary.get('stressedSyllable')
        
    if not alt.get('audioUrl'):
        alt['audioUrl'] = primary.get('audioUrl')
        
    print(f"Alt Form ({alt['partOfSpeech']}):")
    print(f"  IPA: {alt['pronunciation']}")
    print(f"  Syllables: {alt['syllables']} (Count: {alt['syllableCount']})")
    print(f"  Stress: {alt['stressedSyllable']}")
    
    if alt['syllableCount'] == 3 and alt['stressedSyllable'] == 0:
        print("\n✅ LOGIC VERIFICATION PASSED")
    else:
        print("\n❌ LOGIC VERIFICATION FAILED")

if __name__ == "__main__":
    verify_logic()
