"""Canonical American-English pronunciation reference construction.

This module intentionally contains no Flask, network, cache, or acoustic code. It
turns one dictionary pronunciation variant into a self-consistent value object so
IPA, syllables, stress, audio identity, and capabilities cannot drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
import re
import unicodedata
from typing import Any, Iterable, Optional


SCHEMA_VERSION = 9
ALGORITHM_VERSION = "pronunciation-reference-v1"
DIALECT = "en-US"

CONFLICT_ORDER = (
    "NON_EXACT_ENTRY",
    "COUNT_CONFLICT",
    "STRESS_CONFLICT",
    "MISSING_IPA",
    "ACOUSTIC_CONFLICT",
)

_STRESS_MARKS = {"ˈ": "primary", "'": "primary", "ˌ": "secondary"}
_WRAPPER_CHARS = set("/[]() \\")
_HEADWORD_SEPARATORS = re.compile(r"[·•‧*]")
_SYLLABIC_NUCLEI = ("n̩", "l̩", "m̩", "ŋ̩")

# Longest matches are deliberate. A diphthong or a rhotic sequence is one
# phonological nucleus unless explicit dictionary syllabification proves that an
# alternative grouping is required (for example, American "flower").
_COMPOSITE_RHOTIC_NUCLEI = (
    "aɪɚ",
    "aʊɚ",
    "eɪɚ",
    "ɔɪɚ",
    "oʊɚ",
    "ajɚ",
    "awɚ",
    "ejɚ",
    "ojɚ",
    "owɚ",
)
_RHOTIC_NUCLEI = (
    "ɑɚ",
    "iɚ",
    "ɪɚ",
    "eɚ",
    "ɛɚ",
    "oɚ",
    "ɔɚ",
    "uɚ",
    "ʊɚ",
    "əɚ",
)
_DIPHTHONGS = (
    "aɪ",
    "eɪ",
    "ɔɪ",
    "aʊ",
    "oʊ",
    "əʊ",
    "aj",
    "ej",
    "oj",
    "aw",
    "ow",
)
_MONOPHTHONGS = tuple("ɪieɛæəɐʌɑɒɔouʊaɚɝɜɨʉɘɵɤøœyɯɶʏäëïöüé")
_NUCLEUS_PATTERNS = tuple(
    sorted(
        set(_COMPOSITE_RHOTIC_NUCLEI)
        | set(_RHOTIC_NUCLEI)
        | set(_DIPHTHONGS)
        | set(_SYLLABIC_NUCLEI),
        key=len,
        reverse=True,
    )
)

_VALID_ONSETS = {
    "p", "b", "t", "d", "k", "g", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ",
    "h", "m", "n", "r", "l", "w", "j", "tʃ", "dʒ",
    "pl", "pr", "bl", "br", "tr", "dr", "kl", "kr", "gl", "gr", "fl", "fr",
    "θr", "ʃr", "sk", "sl", "sm", "sn", "sp", "st", "sw", "tw", "dw", "kw",
    "gw", "fj", "vj", "pj", "bj", "mj", "nj", "hj", "lj",
    "spl", "spr", "str", "skr", "skw",
}

_DISPLAY_REPLACEMENTS = (
    ("t͡ʃ", "tʃ"),
    ("d͡ʒ", "dʒ"),
    ("t͜ʃ", "tʃ"),
    ("d͜ʒ", "dʒ"),
    ("aɪɚ", "aɪr"),
    ("aʊɚ", "aʊr"),
    ("eɪɚ", "eɪr"),
    ("ɔɪɚ", "ɔɪr"),
    ("oʊɚ", "oʊr"),
    ("ajɚ", "aɪr"),
    ("awɚ", "aʊr"),
    ("ejɚ", "eɪr"),
    ("ojɚ", "ɔɪr"),
    ("owɚ", "oʊr"),
    ("ɑɚ", "ɑr"),
    ("iɚ", "ir"),
    ("ɪɚ", "ɪr"),
    ("eɚ", "er"),
    ("ɛɚ", "ɛr"),
    ("oɚ", "or"),
    ("ɔɚ", "ɔr"),
    ("uɚ", "ur"),
    ("ʊɚ", "ʊr"),
    ("əɚ", "ər"),
    ("ɝ", "ɜr"),
    ("ɚ", "ər"),
    ("aj", "aɪ"),
    ("ej", "eɪ"),
    ("oj", "ɔɪ"),
    ("aw", "aʊ"),
    ("ow", "oʊ"),
    ("ä", "ɑ"),
    ("ȯ", "ɔ"),
    ("ü", "u"),
    ("ᵊ", "ə"),
    ("ɹ", "r"),
    ("ɫ", "l"),
    ("g", "ɡ"),
    ("ː", ""),
    (":", ""),
)


@dataclass(frozen=True)
class Nucleus:
    start: int
    end: int
    text: str
    stress: Optional[str]
    syllabic_consonant: bool = False


@dataclass(frozen=True)
class ParsedPronunciation:
    raw_ipa: str
    display_ipa: str
    syllables: list[dict[str, Any]]
    primary_stress: Optional[int]
    secondary_stress: list[int]
    phonological_count: int
    headword_count: Optional[int]
    headword_count_explicit: bool
    conflicts: list[str]


def _nfc(value: Optional[str]) -> str:
    return unicodedata.normalize("NFC", value or "").strip()


def _normalized_identity_part(value: Optional[str], *, casefold: bool = False) -> str:
    normalized = re.sub(r"\s+", " ", _nfc(value))
    return normalized.casefold() if casefold else normalized


def stable_variant_id(
    word: str,
    part_of_speech: Optional[str],
    raw_ipa: Optional[str],
    audio_filename: Optional[str],
) -> str:
    """Return the contract's stable 16-hex pronunciation variant identity."""
    identity = "|".join(
        (
            _normalized_identity_part(word, casefold=True),
            _normalized_identity_part(part_of_speech, casefold=True),
            _normalized_identity_part(raw_ipa),
            _normalized_identity_part(audio_filename, casefold=True),
        )
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


def _is_single_vowel(character: str) -> bool:
    if character in _MONOPHTHONGS:
        return True
    decomposed = unicodedata.normalize("NFD", character)
    return bool(decomposed) and decomposed[0].casefold() in "aeiouy"


def _match_nucleus(value: str, index: int) -> Optional[str]:
    for pattern in _NUCLEUS_PATTERNS:
        if value.startswith(pattern, index):
            return pattern
    if index < len(value) and _is_single_vowel(value[index]):
        return value[index]
    return None


def _scan_maximal(raw_ipa: str) -> tuple[str, list[Nucleus], Optional[str]]:
    clean_parts: list[str] = []
    nuclei: list[Nucleus] = []
    pending_stress: Optional[str] = None
    clean_length = 0
    index = 0

    while index < len(raw_ipa):
        character = raw_ipa[index]
        if character in _STRESS_MARKS:
            pending_stress = _STRESS_MARKS[character]
            index += 1
            continue
        if character in _WRAPPER_CHARS or character in ".·•‧*":
            index += 1
            continue

        nucleus = _match_nucleus(raw_ipa, index)
        if nucleus is not None:
            start = clean_length
            clean_parts.append(nucleus)
            clean_length += len(nucleus)
            nuclei.append(
                Nucleus(
                    start=start,
                    end=clean_length,
                    text=nucleus,
                    stress=pending_stress,
                    syllabic_consonant=nucleus in _SYLLABIC_NUCLEI,
                )
            )
            pending_stress = None
            index += len(nucleus)
            continue

        clean_parts.append(character)
        clean_length += len(character)
        index += 1

    return "".join(clean_parts), nuclei, pending_stress


def _split_composite_rhotics(nuclei: list[Nucleus], target_count: int) -> list[Nucleus]:
    """Expand only proven ambiguous diphthong+rhotics to an explicit target count."""
    result = list(nuclei)
    expansion_needed = target_count - len(result)
    if expansion_needed <= 0:
        return result

    index = 0
    while index < len(result) and expansion_needed:
        nucleus = result[index]
        if nucleus.text in _COMPOSITE_RHOTIC_NUCLEI:
            base = nucleus.text[:-1]
            first = replace(nucleus, end=nucleus.end - 1, text=base)
            second = Nucleus(
                start=nucleus.end - 1,
                end=nucleus.end,
                text="ɚ",
                stress=None,
                syllabic_consonant=False,
            )
            result[index:index + 1] = [first, second]
            expansion_needed -= 1
            index += 2
        else:
            index += 1
    return result


def _infer_syllabic_sonorants(
    clean: str,
    nuclei: list[Nucleus],
    target_count: int,
) -> list[Nucleus]:
    """Use explicit headword breaks to recognize otherwise unmarked sonorants.

    This is deliberately narrow: every missing nucleus must map to exactly one
    consonant-adjacent n/l/m/ŋ candidate. If more than one grouping remains
    possible, the caller keeps the count conflict instead of guessing.
    """
    needed = target_count - len(nuclei)
    if needed <= 0:
        return list(nuclei)

    occupied = {
        position
        for nucleus in nuclei
        for position in range(nucleus.start, nucleus.end)
    }
    candidates: list[Nucleus] = []
    for index, character in enumerate(clean):
        if character not in {"n", "l", "m", "ŋ"} or index in occupied or index == 0:
            continue
        previous = clean[index - 1]
        previous_is_consonant = _match_nucleus(previous, 0) is None
        at_end_or_before_consonant = (
            index == len(clean) - 1
            or _match_nucleus(clean, index + 1) is None
        )
        if previous_is_consonant and at_end_or_before_consonant:
            candidates.append(
                Nucleus(
                    start=index,
                    end=index + 1,
                    text=character,
                    stress=None,
                    syllabic_consonant=True,
                )
            )

    if len(candidates) != needed:
        return list(nuclei)
    return sorted([*nuclei, *candidates], key=lambda item: item.start)


def _parse_headword(headword: Optional[str]) -> tuple[list[str], Optional[int], bool]:
    normalized = _nfc(headword)
    if not normalized:
        return [], None, False
    explicit = bool(_HEADWORD_SEPARATORS.search(normalized))
    if explicit:
        chunks = [chunk for chunk in _HEADWORD_SEPARATORS.split(normalized) if chunk]
        return chunks, len(chunks), True
    return [normalized], None, False


def _onset_length(cluster: str) -> int:
    if not cluster:
        return 0
    for length in range(min(3, len(cluster)), 0, -1):
        if cluster[-length:] in _VALID_ONSETS:
            return length
    # Maximal-onset fallback: a final non-syllabic segment starts the next
    # syllable, while explicit syllabic consonants were already nuclei.
    return 1


def _segment_clean_ipa(clean: str, nuclei: list[Nucleus]) -> list[str]:
    if not nuclei:
        return []
    boundaries = [0]
    for previous, current in zip(nuclei, nuclei[1:]):
        cluster = clean[previous.end:current.start]
        boundaries.append(current.start - _onset_length(cluster))
    boundaries.append(len(clean))
    return [clean[boundaries[index]:boundaries[index + 1]] for index in range(len(nuclei))]


def _to_oxford_american(value: str) -> str:
    converted = value
    for source, target in _DISPLAY_REPLACEMENTS:
        converted = converted.replace(source, target)
    return unicodedata.normalize("NFC", converted)


def parse_pronunciation(raw_ipa: str, headword: Optional[str] = None) -> ParsedPronunciation:
    normalized_raw = _nfc(raw_ipa)
    headword_chunks, headword_count, headword_explicit = _parse_headword(headword)
    clean, maximal_nuclei, dangling_stress = _scan_maximal(normalized_raw)
    nuclei = maximal_nuclei
    conflicts: list[str] = []
    if dangling_stress is not None:
        conflicts.append("STRESS_CONFLICT")

    if headword_explicit and headword_count is not None and headword_count != len(nuclei):
        nuclei = _split_composite_rhotics(nuclei, headword_count)
        if len(nuclei) != headword_count:
            nuclei = _infer_syllabic_sonorants(clean, nuclei, headword_count)
        if len(nuclei) != headword_count:
            conflicts.append("COUNT_CONFLICT")

    raw_segments = _segment_clean_ipa(clean, nuclei)
    primary_indices = [index for index, item in enumerate(nuclei) if item.stress == "primary"]
    secondary_indices = [index for index, item in enumerate(nuclei) if item.stress == "secondary"]

    if len(nuclei) == 1:
        primary_stress: Optional[int] = 0
    elif len(primary_indices) == 1:
        primary_stress = primary_indices[0]
    else:
        primary_stress = None
        conflicts.append("STRESS_CONFLICT")

    if len(primary_indices) > 1:
        conflicts.append("STRESS_CONFLICT")

    labels: list[Optional[str]] = [None] * len(nuclei)
    if headword_chunks and len(headword_chunks) == len(nuclei):
        labels = headword_chunks

    display_segments = [_to_oxford_american(segment) for segment in raw_segments]
    display_parts: list[str] = []
    for index, segment in enumerate(display_segments):
        if len(nuclei) > 1:
            if primary_stress == index:
                display_parts.append("ˈ")
            elif index in secondary_indices:
                display_parts.append("ˌ")
        display_parts.append(segment)

    syllables = []
    for index, (segment, nucleus) in enumerate(zip(display_segments, nuclei)):
        if primary_stress == index:
            stress = "primary"
        elif index in secondary_indices:
            stress = "secondary"
        else:
            stress = "unstressed"
        syllables.append(
            {
                "index": index,
                "ipa": segment,
                "label": labels[index],
                "stress": stress,
                "syllabicConsonant": nucleus.syllabic_consonant,
            }
        )

    return ParsedPronunciation(
        raw_ipa=normalized_raw,
        display_ipa=f"/{''.join(display_parts)}/" if display_parts else "//",
        syllables=syllables,
        primary_stress=primary_stress,
        secondary_stress=secondary_indices,
        phonological_count=len(nuclei),
        headword_count=headword_count,
        headword_count_explicit=headword_explicit,
        conflicts=_ordered_conflicts(conflicts),
    )


def _ordered_conflicts(conflicts: Iterable[str]) -> list[str]:
    unique = set(conflicts)
    known = [code for code in CONFLICT_ORDER if code in unique]
    return known + sorted(unique.difference(CONFLICT_ORDER))


def build_pronunciation_variant(
    *,
    word: str,
    part_of_speech: Optional[str],
    definition: Optional[str],
    entry_id: Optional[str],
    exact_match: bool,
    raw_ipa: Optional[str],
    headword: Optional[str],
    audio_filename: Optional[str],
    audio_url: Optional[str],
    acoustic_conflict: bool = False,
) -> dict[str, Any]:
    normalized_raw = _nfc(raw_ipa)
    conflicts: list[str] = []
    if not exact_match:
        conflicts.append("NON_EXACT_ENTRY")
    if not normalized_raw:
        conflicts.append("MISSING_IPA")
        _, headword_count, headword_explicit = _parse_headword(headword)
        parsed = ParsedPronunciation(
            raw_ipa="",
            display_ipa="//",
            syllables=[],
            primary_stress=None,
            secondary_stress=[],
            phonological_count=0,
            headword_count=headword_count,
            headword_count_explicit=headword_explicit,
            conflicts=[],
        )
    else:
        parsed = parse_pronunciation(normalized_raw, headword)
        conflicts.extend(parsed.conflicts)
    if acoustic_conflict:
        conflicts.append("ACOUSTIC_CONFLICT")

    ordered_conflicts = _ordered_conflicts(conflicts)
    status = "conflict" if ordered_conflicts else "valid"
    can_play_audio = bool(audio_url and exact_match)
    can_score = status == "valid"
    can_show_graphs = can_score and can_play_audio

    return {
        "id": stable_variant_id(word, part_of_speech, normalized_raw, audio_filename),
        "partOfSpeech": _nfc(part_of_speech) or None,
        "definition": _nfc(definition) or None,
        "source": {
            "provider": "merriam-webster",
            "entryId": _nfc(entry_id) or None,
            "exactMatch": bool(exact_match),
        },
        "rawIpa": normalized_raw or None,
        "displayIpa": parsed.display_ipa if normalized_raw else None,
        "syllableCount": parsed.phonological_count,
        "primaryStress": parsed.primary_stress,
        "secondaryStress": parsed.secondary_stress,
        "syllables": parsed.syllables,
        "audioUrl": _nfc(audio_url) or None,
        "validation": {
            "status": status,
            "conflicts": ordered_conflicts,
            "evidence": {
                "phonologicalCount": parsed.phonological_count,
                "headwordCount": parsed.headword_count,
                "headwordCountExplicit": parsed.headword_count_explicit,
            },
        },
        "capabilities": {
            "playAudio": can_play_audio,
            "scoreCountStress": can_score,
            "showNativeGraphs": can_show_graphs,
        },
    }


def build_pronunciation_reference(
    *,
    word: str,
    variants: Iterable[dict[str, Any]],
    deployment_version: str,
) -> dict[str, Any]:
    deduplicated: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for variant in variants:
        variant_id = variant.get("id")
        if variant_id in seen_ids:
            continue
        seen_ids.add(variant_id)
        deduplicated.append(variant)

    default_variant = next(
        (
            variant
            for variant in deduplicated
            if variant.get("validation", {}).get("status") == "valid"
            and variant.get("source", {}).get("exactMatch") is True
        ),
        None,
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "algorithmVersion": ALGORITHM_VERSION,
        "deploymentVersion": _nfc(deployment_version) or "unknown",
        "word": _nfc(word).casefold(),
        "dialect": DIALECT,
        "defaultVariantId": default_variant.get("id") if default_variant else None,
        "variants": deduplicated,
    }


def validate_reference_invariants(reference: dict[str, Any]) -> list[str]:
    """Return stable invariant error codes without mutating the reference."""
    errors: list[str] = []
    if reference.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("SCHEMA_VERSION_MISMATCH")
    if reference.get("algorithmVersion") != ALGORITHM_VERSION:
        errors.append("ALGORITHM_VERSION_MISMATCH")
    if reference.get("dialect") != DIALECT:
        errors.append("DIALECT_MISMATCH")

    variants = reference.get("variants")
    if not isinstance(variants, list):
        return errors + ["VARIANTS_NOT_ARRAY"]

    ids: set[str] = set()
    valid_default_ids: set[str] = set()
    for variant in variants:
        variant_id = variant.get("id")
        if not isinstance(variant_id, str) or not re.fullmatch(r"[0-9a-f]{16}", variant_id):
            errors.append("INVALID_VARIANT_ID")
        elif variant_id in ids:
            errors.append("DUPLICATE_VARIANT_ID")
        else:
            ids.add(variant_id)

        syllables = variant.get("syllables")
        count = variant.get("syllableCount")
        if not isinstance(syllables, list) or count != len(syllables):
            errors.append("SYLLABLE_LENGTH_MISMATCH")
        safe_count = count if isinstance(count, int) and count >= 0 else 0
        primary = variant.get("primaryStress")
        if primary is not None and (not isinstance(primary, int) or not 0 <= primary < safe_count):
            errors.append("PRIMARY_STRESS_OUT_OF_RANGE")
        for secondary in variant.get("secondaryStress", []):
            if not isinstance(secondary, int) or not 0 <= secondary < safe_count:
                errors.append("SECONDARY_STRESS_OUT_OF_RANGE")

        validation = variant.get("validation", {})
        capabilities = variant.get("capabilities", {})
        if validation.get("status") == "conflict" and (
            capabilities.get("scoreCountStress") or capabilities.get("showNativeGraphs")
        ):
            errors.append("CONFLICT_NOT_FAIL_CLOSED")
        if validation.get("status") == "valid" and variant.get("source", {}).get("exactMatch"):
            valid_default_ids.add(variant_id)

    default_id = reference.get("defaultVariantId")
    if default_id is not None and default_id not in valid_default_ids:
        errors.append("INVALID_DEFAULT_VARIANT")
    return list(dict.fromkeys(errors))


__all__ = [
    "ALGORITHM_VERSION",
    "DIALECT",
    "SCHEMA_VERSION",
    "build_pronunciation_reference",
    "build_pronunciation_variant",
    "parse_pronunciation",
    "stable_variant_id",
    "validate_reference_invariants",
]
