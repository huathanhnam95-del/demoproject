"""Strict ARPAbet-to-model-IPA conversion used by calibration tooling."""
from __future__ import annotations

BASE = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "EH": "ɛ", "ER": "ɜː", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ",
    "OY": "ɔɪ", "UH": "ʊ", "UW": "u", "B": "b", "CH": "tʃ", "D": "d",
    "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "dʒ", "K": "k", "L": "l",
    "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ",
    "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}


def arpabet_to_ipa(tokens: list[str] | tuple[str, ...]) -> list[str]:
    result: list[str] = []
    for raw in tokens:
        token = str(raw).upper()
        stress = token[-1] if token[-1:].isdigit() else None
        base = token[:-1] if stress else token
        if base not in BASE:
            raise ValueError(f"unsupported ARPAbet token: {raw}")
        symbol = BASE[base]
        if base == "AH" and stress == "0":
            symbol = "ə"
        elif base == "ER" and stress == "0":
            symbol = "ɚ"
        result.append(symbol)
    return result
