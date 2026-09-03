"""
Connected Speech Preprocessor for Read Aloud & Voice Cloning
Transforms formal English orthography into connected speech representations:
- Weak-form vowel reductions (for -> fer, and -> an', to -> ta, of -> uv)
- Consonant-to-vowel catenation / liaison (sheets-of-ice, began-as-a)
- Alveolar flapping & elisions
- Visual annotation generator for educational UI display
"""

import re
from typing import Dict, List, Tuple, Any

# Common grammatical weak-form targets (only reduced when unstressed / non-terminal)
WEAK_FORMS = {
    "for": "fer",
    "and": "an'",
    "to": "ta",
    "of": "uv",
    "than": "thun",
    "can": "cun",
    "them": "'em",
}

# Common alveolar flapping targets (intervocalic /t/ and /d/)
FLAP_WORDS = {
    "water": "wadder",
    "better": "bedder",
    "writing": "wriding",
    "city": "cidy",
    "vital": "vidal",
    "critical": "cridical",
    "criticisms": "cridicisms",
}

# Vowel sounds regex for liaison detection (words starting with vowel sounds)
VOWEL_START_REGEX = re.compile(r"^[aeiou]", re.IGNORECASE)
CONSONANT_END_REGEX = re.compile(r"[bcdfghjklmnpqrstvwxyz]$", re.IGNORECASE)


class ConnectedSpeechPreprocessor:
    """
    Transforms formal academic text into natural connected speech with weak forms,
    liaison, and flapping for F5-TTS continuous flow synthesis and pedagogical visualization.
    """

    def __init__(self):
        pass

    def transform(self, text: str) -> Dict[str, Any]:
        """
        Transforms input text into connected speech text and returns annotations.

        Returns:
            Dict containing:
                - original_text: raw input text
                - speech_ready_text: text optimized for F5-TTS flow matching
                - annotations: list of visual badge annotations for UI
                - stats: count of reductions, liaisons, and flaps applied
        """
        words = text.split()
        transformed_words = []
        annotations = []
        reductions_count = 0
        liaisons_count = 0
        flaps_count = 0

        i = 0
        n = len(words)
        while i < n:
            word = words[i]
            # Strip punctuation for matching, preserve leading/trailing punctuation
            match = re.match(r"^([^\w]*)(.*?)([^\w]*)$", word)
            if not match:
                transformed_words.append(word)
                i += 1
                continue

            lead_punct, core_word, trail_punct = match.groups()
            lower_core = core_word.lower()

            # 1. Check for Alveolar Flapping
            if lower_core in FLAP_WORDS:
                flapped = FLAP_WORDS[lower_core]
                if core_word.istitle():
                    flapped = flapped.capitalize()
                transformed_words.append(f"{lead_punct}{flapped}{trail_punct}")
                annotations.append({
                    "original": core_word,
                    "spoken": flapped,
                    "type": "flap",
                    "note": f"Alveolar flap [ɾ] softens /{core_word}/ into '{flapped}'"
                })
                flaps_count += 1
                i += 1
                continue

            # 2. Check for Weak-Form Reduction (avoid reducing terminal words before periods)
            is_terminal = bool(trail_punct and any(c in ".?!" for c in trail_punct))
            if lower_core in WEAK_FORMS and not is_terminal and (i + 1 < n):
                reduced = WEAK_FORMS[lower_core]
                if core_word.istitle():
                    reduced = reduced.capitalize()

                # Check if this weak form can link to the next word (e.g. for example -> fer-example)
                next_word = words[i + 1] if i + 1 < n else ""
                next_clean = re.sub(r"[^\w]", "", next_word).lower()

                transformed_words.append(f"{lead_punct}{reduced}{trail_punct}")
                annotations.append({
                    "original": core_word,
                    "spoken": reduced,
                    "type": "reduction",
                    "note": f"Weak-form vowel reduction to schwa /ə/ ('{core_word}' → '{reduced}')"
                })
                reductions_count += 1
                i += 1
                continue

            # 3. Check for Consonant-to-Vowel Liaison between consecutive words
            if i + 1 < n and not trail_punct:
                next_word = words[i + 1]
                next_match = re.match(r"^([^\w]*)(.*?)([^\w]*)$", next_word)
                if next_match:
                    next_lead, next_core, next_trail = next_match.groups()
                    # Do not link across pauses / punctuation
                    if not next_lead and not next_trail and CONSONANT_END_REGEX.search(core_word) and VOWEL_START_REGEX.search(next_core):
                        # Both words qualify for linking (e.g. began as -> began-as)
                        if len(core_word) <= 7 and len(next_core) <= 7:
                            # Also check if next_core is a weak form
                            spoken_next = WEAK_FORMS.get(next_core.lower(), next_core)
                            transformed_words.append(f"{lead_punct}{core_word}-{spoken_next}{next_trail}")
                            annotations.append({
                                "original": f"{core_word} {next_core}",
                                "spoken": f"{core_word}_{spoken_next}",
                                "type": "liaison",
                                "note": f"Consonant-to-vowel catenation ({core_word} -> {spoken_next})"
                            })
                            liaisons_count += 1
                            i += 2
                            continue

            transformed_words.append(word)
            i += 1

        speech_ready_text = " ".join(transformed_words)

        return {
            "original_text": text,
            "speech_ready_text": speech_ready_text,
            "annotations": annotations,
            "stats": {
                "reductions": reductions_count,
                "liaisons": liaisons_count,
                "flaps": flaps_count,
                "total_features": reductions_count + liaisons_count + flaps_count
            }
        }


# Quick CLI verification
if __name__ == "__main__":
    import io, sys
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    prep = ConnectedSpeechPreprocessor()
    sample = "Certain types of methodology are more suitable for some research projects than others. For example, the use of questionnaires and surveys is more suitable for quantitative research."
    res = prep.transform(sample)
    print("ORIGINAL:")
    print(res["original_text"])
    print("\nSPEECH READY:")
    print(res["speech_ready_text"])
    print("\nANNOTATIONS:")
    for a in res["annotations"]:
        print(f"  • [{a['type'].upper()}] {a['original']} -> {a['spoken']} ({a['note']})")
    print(f"\nStats: {res['stats']}")
