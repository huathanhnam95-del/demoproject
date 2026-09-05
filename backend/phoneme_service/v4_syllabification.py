"""Deterministic, reference-constrained V4 syllabification.

V4 is deliberately a small phonological layer on top of the existing CTC
recognizer.  It does not run a second model inference and it does not replace
the independent V2/V3 evidence.  The reference IPA supplies the phoneme
classes and stress marks; the one log-probability matrix supplied by
``recognize-v2`` supplies the time spans.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
import unicodedata
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

from backend.phoneme_service.backends import ctc_forced_align


ANALYSIS_VERSION = "pronunciation-analysis-v4.1"
SYLLABIFICATION_VERSION = "pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1"
SPAN_CONTRACT_VERSION = "ctc-alignment-v2"
FRAME_INTERVAL = "half-open"

V4_IPA_TOKENIZATION_FAILED = "V4_IPA_TOKENIZATION_FAILED"
V4_NO_VOWEL_NUCLEUS = "V4_NO_VOWEL_NUCLEUS"
V4_CTC_ALIGNMENT_FAILED = "V4_CTC_ALIGNMENT_FAILED"
V4_INVALID_LOGITS = "V4_INVALID_LOGITS"
V4_TOKEN_SEQUENCE_MISMATCH = "V4_TOKEN_SEQUENCE_MISMATCH"
# Public contract names. The legacy ``reason`` values above are retained for
# callers that already inspect them; ``failureCode`` below exposes the stable
# V4 A2 taxonomy without changing that compatibility surface.
V4_REFERENCE_IPA_INVALID = "V4_REFERENCE_IPA_INVALID"
V4_REFERENCE_COUNT_MISMATCH = "V4_REFERENCE_COUNT_MISMATCH"
V4_TOKENIZATION_UNAVAILABLE = "V4_TOKENIZATION_UNAVAILABLE"
V4_ALIGNMENT_TOKEN_MISMATCH = "V4_ALIGNMENT_TOKEN_MISMATCH"
V4_PHONE_ALIGNMENT_UNAVAILABLE = "V4_PHONE_ALIGNMENT_UNAVAILABLE"

_PUBLIC_FAILURE_CODES = {
    V4_IPA_TOKENIZATION_FAILED: V4_TOKENIZATION_UNAVAILABLE,
    V4_NO_VOWEL_NUCLEUS: V4_REFERENCE_IPA_INVALID,
    V4_CTC_ALIGNMENT_FAILED: V4_PHONE_ALIGNMENT_UNAVAILABLE,
    V4_INVALID_LOGITS: V4_PHONE_ALIGNMENT_UNAVAILABLE,
    V4_TOKEN_SEQUENCE_MISMATCH: V4_ALIGNMENT_TOKEN_MISMATCH,
    V4_REFERENCE_COUNT_MISMATCH: V4_REFERENCE_COUNT_MISMATCH,
}

PROVENANCE_SCHEMA_VERSION = "pronunciation-syllabification-v1"
ONSET_INVENTORY_VERSION = "en-US-onsets-v1"
RULE_VERSION = SYLLABIFICATION_VERSION

_STRESS_MARKS = {"ˈ": "primary", "ˌ": "secondary"}
_STRESS_SYMBOLS = {"primary": "ˈ", "secondary": "ˌ"}
_SPECIAL_TOKENS = {"", "<pad>", "<blank>", "<s>", "</s>", "<unk>"}
_LAX_VOWELS = frozenset({"ɪ", "ɛ", "æ", "ʌ", "ʊ"})
_SYLLABIC_CONSONANTS = frozenset({"m̩", "n̩", "ŋ̩", "l̩", "ɹ̩", "r̩"})

# The English onset inventory is intentionally explicit.  Single consonants
# are legal except /ŋ/ (which is not a normal native word-initial onset).
# Clusters are represented in the same longest-match IPA vocabulary used by
# the recognizer (e.g. ``tʃ`` is one token where the model supplies it).
_SINGLE_CONSONANTS = frozenset({
    "b", "d", "f", "g", "ɡ", "h", "j", "k", "l", "m", "n", "p",
    "r", "s", "t", "v", "w", "z", "ð", "ɹ", "ʃ", "ʒ", "θ", "ʔ",
    "dʒ", "tʃ", "ʤ", "ʧ", "ɲ", "ɾ", "ç", "x", "ɣ", "χ", "ʁ", "ɬ",
})
_LEGAL_ONSET_CLUSTERS = frozenset({
    "pl", "bl", "kl", "gl", "fl", "sl",
    "pr", "br", "tr", "dr", "kr", "gr", "fr", "θr", "ʃr",
    "pj", "bj", "tj", "dj", "kj", "gj", "mj", "nj", "fj", "vj", "sj", "zj",
    "tw", "dw", "kw", "gw", "sw", "θw",
    "sp", "st", "sk", "sm", "sn", "sf", "sl", "sw",
    "spl", "spr", "str", "skr", "skw", "skl",
})


def _classifier_symbol(value: str) -> str:
    """Return the classifier form for the only accepted glyph equivalence."""
    return unicodedata.normalize("NFC", str(value)).replace("ɡ", "g")


def _is_vowel(symbol: str) -> bool:
    value = _classifier_symbol(symbol)
    # Keep this list conservative: the V4 contract is en-US and specifically
    # does not invent dialect or spelling exceptions.
    return value in _SYLLABIC_CONSONANTS or value in {
        "a", "e", "i", "o", "u", "ɑ", "ɒ", "ɔ", "ə", "ɛ", "ɪ", "ʊ", "ʌ",
        "æ", "ɐ", "ɜ", "ɝ", "ɚ", "ɨ", "ɵ", "ʉ", "ɤ", "aː", "eː", "iː",
        "oː", "uː", "ɑː", "ɔː", "ɜː", "aɪ", "aʊ", "eɪ", "oʊ", "ɔɪ", "əʊ",
        "ɪə", "ɛə", "ʊə", "ɑɹ", "ɔɹ", "ɛɹ", "ɪɹ", "ʊɹ", "ɔːɹ", "oːɹ",
    }


def _is_lax(symbol: str) -> bool:
    return _classifier_symbol(symbol) in _LAX_VOWELS


def _is_legal_onset(symbols: Sequence[str]) -> bool:
    if not symbols:
        return True
    normalized = "".join(_classifier_symbol(symbol) for symbol in symbols)
    if len(symbols) == 1:
        return _classifier_symbol(symbols[0]) in {_classifier_symbol(item) for item in _SINGLE_CONSONANTS}
    return normalized in _LEGAL_ONSET_CLUSTERS


class V4SyllabificationError(ValueError):
    """Stable, safe-to-return V4 failure."""

    def __init__(self, code: str, message: str | None = None):
        self.code = code
        super().__init__(message or code)


@dataclass(frozen=True)
class V4Token:
    symbol: str
    token_id: int | None = None
    stress: str | None = None
    source_index: int = 0

    @property
    def is_nucleus(self) -> bool:
        return _is_vowel(self.symbol)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "token_id": self.token_id,
            "stress": self.stress,
            "is_nucleus": self.is_nucleus,
            "source_index": self.source_index,
        }


@dataclass(frozen=True)
class V4Tokenization:
    normalized_ipa: str
    tokens: tuple[V4Token, ...]

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.to_dict().get(key, default)

    def to_dict(self) -> dict[str, Any]:
        return {"normalized_ipa": self.normalized_ipa, "tokens": [item.to_dict() for item in self.tokens]}


@dataclass
class V4Syllable:
    index: int
    syllable_id: str
    ipa: str
    onset: tuple[str, ...]
    nucleus: str
    coda: tuple[str, ...]
    stress: str | None = None
    token_start: int = 0
    token_end: int = 0
    start_frame: int | None = None
    end_frame: int | None = None
    partition_start_frame: int | None = None
    partition_end_frame: int | None = None
    confidence: float | None = None
    start_time: float | None = None
    end_time: float | None = None
    partition_start_time: float | None = None
    partition_end_time: float | None = None
    vowel_start_frame: int | None = None
    vowel_end_frame: int | None = None
    vowel_start_time: float | None = None
    vowel_end_time: float | None = None
    vowel_duration: float | None = None
    ambiguity: dict[str, Any] = field(default_factory=lambda: {
        "status": "deterministic",
        "candidates": [],
    })

    @property
    def is_stressed_lax(self) -> bool:
        return self.stress in {"primary", "secondary"} and _is_lax(self.nucleus)

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.to_dict().get(key, default)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "index": self.index,
            "syllable_id": self.syllable_id,
            "syllableId": self.syllable_id,
            "ipa": self.ipa,
            "onset": list(self.onset),
            "nucleus": self.nucleus,
            "coda": list(self.coda),
            "stress": self.stress,
            "is_stressed_lax": self.is_stressed_lax,
            "token_start": self.token_start,
            "token_end": self.token_end,
            "phone_indexes": list(range(self.token_start, self.token_end)),
            "phoneIndexes": list(range(self.token_start, self.token_end)),
            "phone_ownership": {
                "indexes": list(range(self.token_start, self.token_end)),
                "startIndex": self.token_start,
                "endIndex": self.token_end,
            },
            "phoneOwnership": {
                "indexes": list(range(self.token_start, self.token_end)),
                "startIndex": self.token_start,
                "endIndex": self.token_end,
            },
            "alignment_token_range": {
                "start": self.token_start,
                "end": self.token_end,
                "endExclusive": self.token_end,
            },
            "alignmentTokenRange": {
                "start": self.token_start,
                "end": self.token_end,
                "endExclusive": self.token_end,
            },
            "timing_span_index": self.index,
            "timingSpanIndex": self.index,
            "rule": "stressed-lax-prior-coda-reservation" if self.is_stressed_lax else "maximal-legal-onset",
            "ambiguity": dict(self.ambiguity),
        }
        for name in (
            "start_frame", "end_frame", "partition_start_frame", "partition_end_frame",
            "confidence", "start_time", "end_time", "partition_start_time", "partition_end_time",
            "vowel_start_frame", "vowel_end_frame", "vowel_start_time", "vowel_end_time", "vowel_duration",
        ):
            value = getattr(self, name)
            if value is not None:
                payload[name] = value
        if self.start_time is not None:
            payload["startTime"] = self.start_time
        if self.end_time is not None:
            payload["endTime"] = self.end_time
        if self.partition_start_time is not None:
            payload["partitionStartTime"] = self.partition_start_time
        if self.partition_end_time is not None:
            payload["partitionEndTime"] = self.partition_end_time
        if self.partition_start_frame is not None:
            payload["partitionStartFrame"] = self.partition_start_frame
        if self.partition_end_frame is not None:
            payload["partitionEndFrame"] = self.partition_end_frame
        if self.vowel_start_time is not None:
            payload["vowelStartTime"] = self.vowel_start_time
        if self.vowel_end_time is not None:
            payload["vowelEndTime"] = self.vowel_end_time
        if self.vowel_duration is not None:
            payload["vowelDuration"] = self.vowel_duration
        if self.vowel_start_frame is not None:
            payload["vowelStartFrame"] = self.vowel_start_frame
        if self.vowel_end_frame is not None:
            payload["vowelEndFrame"] = self.vowel_end_frame
        return payload


@dataclass
class V4Syllabification:
    normalized_ipa: str
    syllables: tuple[V4Syllable, ...]
    analysis_version: str = ANALYSIS_VERSION
    syllabification_version: str = SYLLABIFICATION_VERSION
    original_ipa: str = ""
    dialect: str = "en-US"

    @property
    def syllable_count(self) -> int:
        return len(self.syllables)

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.to_dict().get(key, default)

    def to_dict(self) -> dict[str, Any]:
        provenance = _build_provenance(
            original_ipa=self.original_ipa,
            normalized_ipa=self.normalized_ipa,
            dialect=self.dialect,
            syllables=self.syllables,
        )
        return {
            "schemaVersion": PROVENANCE_SCHEMA_VERSION,
            "normalized_ipa": self.normalized_ipa,
            "syllable_count": self.syllable_count,
            "syllables": [item.to_dict() for item in self.syllables],
            "analysis_version": self.analysis_version,
            "syllabification_version": self.syllabification_version,
            "original_ipa": self.original_ipa,
            "dialect": self.dialect,
            "provenance": provenance,
            "v4Provenance": provenance,
            "v4Syllabification": provenance,
            "analysisVersion": self.analysis_version,
            "ruleVersion": self.syllabification_version,
            "onsetInventoryVersion": ONSET_INVENTORY_VERSION,
            "originalIpa": self.original_ipa,
            "normalizedIpa": self.normalized_ipa,
            "displayIpa": f"/{self.normalized_ipa}/" if self.normalized_ipa else "",
            "displaySyllabification": provenance.get("displaySyllabification", ""),
            "exactSyllabification": provenance.get("displaySyllabification", ""),
            "contentHash": provenance.get("contentHash"),
            "content_hash": provenance.get("contentHash"),
        }


@dataclass
class V4Alignment:
    aligned: bool
    syllables: tuple[V4Syllable, ...] = field(default_factory=tuple)
    reason: str | None = None
    normalized_ipa: str | None = None
    analysis_version: str = ANALYSIS_VERSION
    syllabification_version: str = SYLLABIFICATION_VERSION
    alignment: dict[str, Any] | None = None
    original_ipa: str = ""
    dialect: str = "en-US"
    provenance: dict[str, Any] | None = None

    @property
    def syllable_count(self) -> int:
        return len(self.syllables)

    @property
    def failure_code(self) -> str | None:
        """Return the stable public A2 failure taxonomy for this result."""
        return _PUBLIC_FAILURE_CODES.get(self.reason) if self.reason else None

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.to_dict().get(key, default)

    def to_dict(self) -> dict[str, Any]:
        provenance = self.provenance or _build_provenance(
            original_ipa=self.original_ipa,
            normalized_ipa=self.normalized_ipa or "",
            dialect=self.dialect,
            syllables=self.syllables,
        )
        payload: dict[str, Any] = {
            "schemaVersion": PROVENANCE_SCHEMA_VERSION,
            "aligned": self.aligned,
            "syllable_count": self.syllable_count,
            "syllables": [item.to_dict() for item in self.syllables],
            "analysisVersion": self.analysis_version,
            "analysis_version": self.analysis_version,
            "syllabificationVersion": self.syllabification_version,
            "syllabification_version": self.syllabification_version,
            "source": "recognize-v2.log_probs",
            "span_contract_version": SPAN_CONTRACT_VERSION,
            "frame_interval": FRAME_INTERVAL,
            "analysisRuleVersion": RULE_VERSION,
            "ruleVersion": RULE_VERSION,
            "onsetInventoryVersion": ONSET_INVENTORY_VERSION,
            "dialect": self.dialect,
            "originalIpa": self.original_ipa,
            "original_ipa": self.original_ipa,
            "normalizedIpa": self.normalized_ipa,
            "displayIpa": f"/{self.normalized_ipa}/" if self.normalized_ipa else "",
            "displaySyllabification": provenance.get("displaySyllabification", ""),
            "exactSyllabification": provenance.get("displaySyllabification", ""),
            "contentHash": provenance.get("contentHash"),
            "content_hash": provenance.get("contentHash"),
            "timingSpanContractVersion": SPAN_CONTRACT_VERSION,
            "provenance": provenance,
            "v4Provenance": provenance,
            "v4Syllabification": provenance,
        }
        if self.normalized_ipa is not None:
            payload["normalized_ipa"] = self.normalized_ipa
        if self.reason:
            payload["reason"] = self.reason
            payload["failureCode"] = self.failure_code or self.reason
            payload["failure_code"] = payload["failureCode"]
        if self.alignment is not None:
            payload["alignment"] = self.alignment
        return payload


def _normalize_reference(ipa: str) -> str:
    if not isinstance(ipa, str):
        raise V4SyllabificationError(V4_IPA_TOKENIZATION_FAILED, "reference IPA must be a string")
    value = unicodedata.normalize("NFC", ipa).strip()
    if value[:1] in "/[" and value[-1:] in "/]":
        value = value[1:-1]
    value = "".join(value.split())
    return value


def _candidate_symbols(symbol_table: Sequence[str]) -> list[tuple[str, int]]:
    candidates: list[tuple[str, int]] = []
    for token_id, value in enumerate(symbol_table):
        symbol = unicodedata.normalize("NFC", str(value))
        if symbol in _SPECIAL_TOKENS or symbol.startswith("<"):
            continue
        candidates.append((symbol, int(token_id)))
    candidates.sort(key=lambda item: len(item[0]), reverse=True)
    return candidates


def tokenize_reference_ipa(ipa: str, symbol_table: Sequence[str] | None = None) -> V4Tokenization:
    """Tokenize IPA using a longest-match model vocabulary.

    With no model vocabulary the function still performs deterministic IPA
    tokenization using the built-in en-US inventory.  Service alignment always
    supplies the actual model symbol table.
    """
    text = _normalize_reference(ipa)
    supplied = symbol_table is not None
    candidates = _candidate_symbols(symbol_table or [])
    if not candidates:
        fallback = sorted(
            _SINGLE_CONSONANTS | {
                "a", "e", "i", "o", "u", "ɑ", "ɒ", "ɔ", "ə", "ɛ", "ɪ", "ʊ", "ʌ", "æ",
                "ɐ", "ɜ", "ɝ", "ɚ", "aɪ", "aʊ", "eɪ", "oʊ", "ɔɪ", "əʊ", "ɪə", "ɛə", "ʊə",
                "aː", "eː", "iː", "oː", "uː", "ɑː", "ɔː", "ɜː", "ɑɹ", "ɔɹ", "ɛɹ", "ɪɹ",
                "ʊɹ", "ɔːɹ", "oːɹ", "m̩", "n̩", "ŋ̩", "l̩", "ɹ̩", "r̩",
            }, key=len, reverse=True
        )
        candidates = [(item, None) for item in fallback]  # type: ignore[list-item]

    tokens: list[V4Token] = []
    pending_stress: str | None = None
    cursor = 0
    source_index = 0
    while cursor < len(text):
        marker = _STRESS_MARKS.get(text[cursor])
        if marker:
            pending_stress = marker
            cursor += 1
            continue
        if text[cursor] in {".", "·", "-", "'"}:
            # Syllable separators are not phonemes, but stress and IPA token
            # classes remain authoritative.  They are accepted only as input
            # presentation, never used to choose a boundary.
            cursor += 1
            continue
        matched: tuple[str, int | None] | None = None
        for candidate, token_id in candidates:
            if text.startswith(candidate, cursor):
                # Compare g/ɡ in the classifier while retaining the vocabulary
                # glyph in the returned token.
                matched = (candidate, token_id)
                break
            if _classifier_symbol(candidate) != candidate and _classifier_symbol(text[cursor:cursor + len(candidate)]) == _classifier_symbol(candidate):
                matched = (candidate, token_id)
                break
            source = text[cursor:cursor + len(candidate)]
            if len(source) == len(candidate) and _classifier_symbol(source) == _classifier_symbol(candidate):
                matched = (candidate, token_id)
                break
        if matched is None:
            raise V4SyllabificationError(
                V4_IPA_TOKENIZATION_FAILED,
                f"IPA character sequence is not in model vocabulary: {text[cursor:]!r}",
            )
        symbol, token_id = matched
        tokens.append(V4Token(symbol=symbol, token_id=token_id, stress=pending_stress, source_index=source_index))
        pending_stress = None
        source_index += 1
        cursor += len(symbol if text.startswith(symbol, cursor) else text[cursor:cursor + len(symbol)])

    if not tokens:
        raise V4SyllabificationError(V4_IPA_TOKENIZATION_FAILED, "reference IPA contains no phoneme tokens")
    # Stress is commonly written before an onset cluster.  Move it to the
    # corresponding vowel for rule evaluation while retaining the marker in
    # the token stream for diagnostics.
    normalized_tokens = list(tokens)
    for index, token in enumerate(tokens):
        if token.stress and not token.is_nucleus:
            target = next((j for j in range(index + 1, len(tokens)) if tokens[j].is_nucleus), None)
            if target is not None and normalized_tokens[target].stress is None:
                normalized_tokens[target] = V4Token(
                    symbol=normalized_tokens[target].symbol,
                    token_id=normalized_tokens[target].token_id,
                    stress=token.stress,
                    source_index=normalized_tokens[target].source_index,
                )
    return V4Tokenization(text, tuple(normalized_tokens))


def _choose_onset_split(cluster: Sequence[V4Token], reserve_coda: bool) -> int:
    """Return the number of cluster phones assigned to the prior coda."""
    if not cluster:
        return 0
    minimum_coda = 1 if reserve_coda else 0
    for onset_length in range(len(cluster) - minimum_coda, -1, -1):
        onset = [token.symbol for token in cluster[len(cluster) - onset_length:]] if onset_length else []
        if _is_legal_onset(onset):
            return len(cluster) - onset_length
    return len(cluster)


def _syllabify_tokenization(
    tokenization: V4Tokenization,
    *,
    original_ipa: str,
) -> V4Syllabification:
    """Apply the A2 boundary rules to an already-tokenized IPA sequence."""
    tokens = tokenization.tokens
    nuclei = [index for index, token in enumerate(tokens) if token.is_nucleus]
    if not nuclei:
        raise V4SyllabificationError(V4_NO_VOWEL_NUCLEUS, "reference IPA contains no vowel nucleus")

    # Every initial consonant must be a member of the versioned en-US onset
    # inventory. Intervocalic clusters are handled by the weighted split
    # below, but an illegal word-initial run is never silently treated as an
    # onset just because it precedes the first nucleus.
    initial_run = tokens[:nuclei[0]]
    if initial_run and not _is_legal_onset([token.symbol for token in initial_run]):
        raise V4SyllabificationError(V4_IPA_TOKENIZATION_FAILED, "reference IPA begins with an illegal onset run")

    boundaries = [0]
    singleton_ambiguity: dict[int, dict[str, Any]] = {}
    for previous_nucleus, current_nucleus in zip(nuclei, nuclei[1:]):
        cluster = tokens[previous_nucleus + 1:current_nucleus]
        reserve = tokens[previous_nucleus].stress in {"primary", "secondary"} and _is_lax(tokens[previous_nucleus].symbol)
        split = _choose_onset_split(cluster, reserve)
        # A stressed-lax VCV boundary has exactly one intervocalic consonant
        # that the weighted rule deliberately reserves for the prior coda.
        # Preserve the legal maximal-onset alternative as explicit evidence;
        # it must never alter the selected ownership or timing partition.
        if reserve and len(cluster) == 1 and _is_legal_onset([cluster[0].symbol]):
            singleton_ambiguity[len(boundaries) - 1] = {
                "status": "ambiguous",
                "kind": "stressed-lax-singleton-vcv",
                "predicate": "stressed-lax-singleton-vcv",
                "predicateCode": "V4_STRESSED_LAX_SINGLETON_VCV",
                "isSingleton": True,
                "rule": "stressed-lax-prior-coda-reservation",
                "interveningConsonants": [cluster[0].symbol],
                "interveningConsonantCount": 1,
                "phoneIndex": previous_nucleus + 1,
                "affectedPhoneIndex": previous_nucleus + 1,
            }
        boundaries.append(previous_nucleus + 1 + split)
    boundaries.append(len(tokens))

    syllables: list[V4Syllable] = []
    for index, nucleus_index in enumerate(nuclei):
        start = boundaries[index]
        end = boundaries[index + 1]
        onset_tokens = tokens[start:nucleus_index]
        coda_tokens = tokens[nucleus_index + 1:end]
        nucleus = tokens[nucleus_index]
        stress = nucleus.stress
        prefix = _STRESS_SYMBOLS.get(stress or "", "")
        syllable_ipa = prefix + "".join(item.symbol for item in tokens[start:end])
        ambiguity = dict(singleton_ambiguity.get(index, {
            "status": "deterministic",
            "candidates": [],
        }))
        syllables.append(
            V4Syllable(
                index=index,
                syllable_id=f"v4-syllable-{index + 1}",
                ipa=syllable_ipa,
                onset=tuple(item.symbol for item in onset_tokens),
                nucleus=nucleus.symbol,
                coda=tuple(item.symbol for item in coda_tokens),
                stress=stress,
                token_start=start,
                token_end=end,
                ambiguity=ambiguity,
            )
        )
    for index, ambiguity in singleton_ambiguity.items():
        if index >= len(syllables) - 1:
            continue
        previous = syllables[index]
        following = syllables[index + 1]
        consonant = tokens[nuclei[index] + 1].symbol
        selected_display = f"{previous.ipa}.{following.ipa}"
        selected_without_coda = previous.ipa[:-len(consonant)] if previous.ipa.endswith(consonant) else previous.ipa
        stress_prefix = _STRESS_SYMBOLS.get(following.stress or "", "")
        if stress_prefix and following.ipa.startswith(stress_prefix):
            alternative_following = stress_prefix + consonant + following.ipa[len(stress_prefix):]
        else:
            alternative_following = consonant + following.ipa
        alternative_display = f"{selected_without_coda}.{alternative_following}"
        ambiguity.update({
            "selectedDisplay": selected_display,
            "alternativeDisplay": alternative_display,
            "selectedSyllabification": selected_display,
            "alternativeSyllabification": alternative_display,
            "display": {
                "selected": selected_display,
                "alternative": alternative_display,
            },
            "candidates": [
                {"display": selected_display, "coda": [consonant], "nextOnset": []},
                {"display": alternative_display, "coda": [], "nextOnset": [consonant]},
            ],
            "selected": {
                "coda": [consonant],
                "nextOnset": [],
                "display": selected_display,
            },
            "alternative": {
                "coda": [],
                "nextOnset": [consonant],
                "display": alternative_display,
            },
        })
        previous.ambiguity = ambiguity
    return V4Syllabification(
        tokenization.normalized_ipa,
        tuple(syllables),
        original_ipa=str(original_ipa),
    )


def syllabify_reference_ipa(ipa: str, symbol_table: Sequence[str] | None = None) -> V4Syllabification:
    """Syllabify canonical en-US IPA with weighted maximal-onset rules."""
    tokenization = tokenize_reference_ipa(ipa, symbol_table)
    return _syllabify_tokenization(tokenization, original_ipa=ipa)


def _build_provenance(
    *,
    original_ipa: str,
    normalized_ipa: str,
    dialect: str,
    syllables: Sequence[V4Syllable],
) -> dict[str, Any]:
    """Build the immutable structural envelope carried with V4 timings."""
    # Hash only the structural syllabification. Timing/confidence is derived
    # from a particular recording and must not change the immutable reference
    # content hash when the same IPA is aligned against another utterance.
    structural_fields = (
        "index", "syllableId", "ipa", "onset", "nucleus", "coda", "stress",
        "phoneIndexes", "phoneOwnership", "alignmentTokenRange", "timingSpanIndex",
        "rule", "ambiguity",
    )
    ordered = [
        {key: item.to_dict()[key] for key in structural_fields}
        for item in syllables
    ]
    structural = {
        "schemaVersion": PROVENANCE_SCHEMA_VERSION,
        "analysisVersion": ANALYSIS_VERSION,
        "ruleVersion": RULE_VERSION,
        "onsetInventoryVersion": ONSET_INVENTORY_VERSION,
        "dialect": dialect,
        "originalIpa": original_ipa,
        "normalizedIpa": normalized_ipa,
        "displayIpa": f"/{normalized_ipa}/" if normalized_ipa else "",
        "displaySyllabification": f"/{'.'.join(item['ipa'] for item in ordered)}/" if ordered else "",
        "exactSyllabification": f"/{'.'.join(item['ipa'] for item in ordered)}/" if ordered else "",
        "rule": {
            "id": "weighted-maximal-onset",
            "stressPolicy": "primary-secondary-stressed-lax",
            "onsetPolicy": "maximal-legal-onset",
        },
        "ambiguity": {
            "status": "deterministic",
            "candidates": [],
        },
        "timingSpanContractVersion": SPAN_CONTRACT_VERSION,
        "syllables": ordered,
    }
    digest = hashlib.sha256(
        json.dumps(structural, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        **structural,
        "contentHash": digest,
        "content_hash": digest,
        "original_ipa": original_ipa,
        "normalized_ipa": normalized_ipa,
        "display_ipa": structural["displayIpa"],
        "analysis_version": ANALYSIS_VERSION,
        "rule_version": RULE_VERSION,
        "onset_inventory_version": ONSET_INVENTORY_VERSION,
    }


def _time_from_frame(frame: int, frame_count: int, sample_count: int, sample_rate: int) -> float:
    return round(float(frame) / max(1, frame_count) * sample_count / sample_rate, 6)


def align_v4_reference(
    log_probs: np.ndarray,
    reference_ipa: str,
    symbol_table: Sequence[str],
    *,
    blank_id: int = 0,
    sample_count: int | None = None,
    sample_rate: int | None = None,
    canonical_token_ids: Sequence[int] | None = None,
    expected_syllable_count: int | None = None,
    dialect: str = "en-US",
) -> V4Alignment:
    """Attach CTC frame spans to deterministic V4 syllabification."""
    try:
        try:
            logits = np.asarray(log_probs, dtype=float)
        except (TypeError, ValueError) as error:
            raise V4SyllabificationError(V4_INVALID_LOGITS, f"log_probs is not a numeric frame matrix: {error}") from error
        if logits.ndim != 2 or logits.shape[0] == 0:
            raise V4SyllabificationError(V4_INVALID_LOGITS, "log_probs must be a non-empty frame matrix")
        if not np.isfinite(logits).all():
            raise V4SyllabificationError(V4_INVALID_LOGITS, "log_probs must contain only finite values")
        tokenization = tokenize_reference_ipa(reference_ipa, symbol_table)
        syllabification = _syllabify_tokenization(
            tokenization,
            original_ipa=reference_ipa,
        )
        # A fallback IPA tokenizer can classify symbols but cannot supply the
        # model's CTC IDs. Reject that state before attempting ``int(None)``
        # so the caller receives the stable tokenization failure code.
        if any(item.token_id is None for item in tokenization.tokens):
            raise V4SyllabificationError(V4_IPA_TOKENIZATION_FAILED, "reference IPA token has no model id")
        token_ids = [int(item.token_id) for item in tokenization.tokens]
        if canonical_token_ids is not None:
            try:
                canonical_ids = [int(item) for item in canonical_token_ids]
            except (TypeError, ValueError):
                canonical_ids = []
            if token_ids != canonical_ids:
                return V4Alignment(
                    False,
                    reason=V4_TOKEN_SEQUENCE_MISMATCH,
                    normalized_ipa=tokenization.normalized_ipa,
                    original_ipa=str(reference_ipa),
                    dialect=dialect,
                    alignment={
                        "v4_token_ids": token_ids,
                        "canonical_token_ids": canonical_ids,
                    },
                )
        if expected_syllable_count is not None and syllabification.syllable_count != int(expected_syllable_count):
            return V4Alignment(
                False,
                reason=V4_REFERENCE_COUNT_MISMATCH,
                normalized_ipa=tokenization.normalized_ipa,
                original_ipa=str(reference_ipa),
                dialect=dialect,
                alignment={
                    "expected_syllable_count": int(expected_syllable_count),
                    "actual_syllable_count": syllabification.syllable_count,
                },
            )
        forced = ctc_forced_align(logits, token_ids, blank_id=blank_id)
        if not forced.get("aligned"):
            return V4Alignment(False, reason=V4_CTC_ALIGNMENT_FAILED, normalized_ipa=tokenization.normalized_ipa, original_ipa=str(reference_ipa), dialect=dialect, alignment=forced)
        token_spans = forced.get("spans") or []
        frame_count = max(1, int(logits.shape[0]))
        result_syllables = list(syllabification.syllables)
        for syllable in result_syllables:
            selected = token_spans[syllable.token_start:syllable.token_end]
            if not selected:
                return V4Alignment(False, reason=V4_CTC_ALIGNMENT_FAILED, normalized_ipa=tokenization.normalized_ipa, original_ipa=str(reference_ipa), dialect=dialect, alignment=forced)
            syllable.start_frame = min(int(item["start_frame"]) for item in selected)
            syllable.end_frame = max(int(item["end_frame"]) for item in selected)
            syllable.confidence = round(float(np.mean([item.get("confidence", 0.0) for item in selected])), 6)

            vowel_token_idx = next(
                (idx for idx in range(syllable.token_start, syllable.token_end) if tokenization.tokens[idx].is_nucleus),
                None
            )
            if vowel_token_idx is not None and vowel_token_idx < len(token_spans):
                vowel_span = token_spans[vowel_token_idx]
                syllable.vowel_start_frame = int(vowel_span["start_frame"])
                syllable.vowel_end_frame = int(vowel_span["end_frame"])
            else:
                syllable.vowel_start_frame = syllable.start_frame
                syllable.vowel_end_frame = syllable.end_frame

        # Contiguous partition boundary between adjacent syllables aligns to phone token boundaries
        partitions = [result_syllables[0].start_frame or 0]
        for current, following in zip(result_syllables, result_syllables[1:]):
            candidate = current.end_frame or 0
            lower = current.start_frame or 0
            upper = following.end_frame or lower
            candidate = min(upper, max(lower, candidate))
            candidate = max(partitions[-1], candidate)
            partitions.append(candidate)
        partitions.append(result_syllables[-1].end_frame or partitions[-1])
        for index, syllable in enumerate(result_syllables):
            syllable.partition_start_frame = partitions[index]
            syllable.partition_end_frame = partitions[index + 1]
            if sample_count and sample_rate:
                syllable.start_time = _time_from_frame(syllable.start_frame or 0, frame_count, sample_count, sample_rate)
                syllable.end_time = _time_from_frame(syllable.end_frame or 0, frame_count, sample_count, sample_rate)
                syllable.partition_start_time = _time_from_frame(syllable.partition_start_frame or 0, frame_count, sample_count, sample_rate)
                syllable.partition_end_time = _time_from_frame(syllable.partition_end_frame or 0, frame_count, sample_count, sample_rate)
                if syllable.vowel_start_frame is not None and syllable.vowel_end_frame is not None:
                    syllable.vowel_start_time = _time_from_frame(syllable.vowel_start_frame, frame_count, sample_count, sample_rate)
                    syllable.vowel_end_time = _time_from_frame(syllable.vowel_end_frame, frame_count, sample_count, sample_rate)
                    syllable.vowel_duration = round(max(0.0, syllable.vowel_end_time - syllable.vowel_start_time), 6)
        return V4Alignment(
            True,
            tuple(result_syllables),
            normalized_ipa=tokenization.normalized_ipa,
            alignment=forced,
            original_ipa=str(reference_ipa),
            dialect=dialect,
        )
    except V4SyllabificationError as error:
        return V4Alignment(
            False,
            reason=error.code,
            normalized_ipa=str(reference_ipa),
            original_ipa=str(reference_ipa),
            dialect=dialect,
            alignment={"error": str(error)},
        )
    except (KeyError, TypeError, ValueError, IndexError) as error:
        return V4Alignment(False, reason=V4_CTC_ALIGNMENT_FAILED, normalized_ipa=str(reference_ipa), original_ipa=str(reference_ipa), dialect=dialect, alignment={"error": str(error)})


# Names used by callers that describe the result as a generic alignment.
build_v4_alignment = align_v4_reference
tokenize_v4_ipa = tokenize_reference_ipa
syllabify_v4_reference = syllabify_reference_ipa
