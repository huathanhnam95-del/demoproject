import requests

if __name__ == '__main__':
    r = requests.post('http://127.0.0.1:8080/analyze-url', 
        json={'audioUrl': 'https://media.merriam-webster.com/audio/prons/en/us/mp3/i/improv01.mp3', 
              'expectedSyllables': 2}, timeout=30)
    d = r.json()
    syls = d.get('syllables', [])
    print('IMPROVE SYLLABLES:')
    for s in syls:
        print(f"  Syl {s['syllable']}: {s['startTime']:.3f}s - {s['endTime']:.3f}s (dur: {s['duration']:.3f}s)")
    print()
    avg = sum(s['duration'] for s in syls) / len(syls) if syls else 0
    print(f"Average duration: {avg:.3f}s")
    if len(syls) >= 2 and syls[0]['duration'] > avg * 1.5:
        print("WARNING: Syl1 may have leakage")
    else:
        print("OK: Syl1 duration looks reasonable")
