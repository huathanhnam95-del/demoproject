#!/usr/bin/env python3
"""Deterministic pronunciation-reference v2 audit with preserved evidence."""

from __future__ import annotations

import argparse
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import random
import re
import sys
import time

import requests


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.local_server.pronunciation_reference import (  # noqa: E402
    build_pronunciation_reference,
    build_pronunciation_variant,
    validate_reference_invariants,
)


PLAIN_WORD = re.compile(r"^[a-z]+$")
CMU_VOWEL = re.compile(r"^[A-Z]+([012])$")


def cmu_metrics(pronunciation):
    vowels = []
    for token in str(pronunciation or "").split():
        match = CMU_VOWEL.match(token)
        if match:
            vowels.append(int(match.group(1)))
    return {
        "syllableCount": len(vowels),
        "primaryStress": next((index for index, stress in enumerate(vowels) if stress == 1), 0),
        "secondaryStress": [index for index, stress in enumerate(vowels) if stress == 2],
        "pronunciation": pronunciation,
    }


def load_sampling_frame():
    cmu = json.loads((ROOT / "public" / "cmudict.json").read_text(encoding="utf-8"))
    words = []
    seen = set()
    with (ROOT / "The_Oxford_5000.csv").open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            word = str(row.get("word") or "").strip().casefold()
            if PLAIN_WORD.fullmatch(word) and word in cmu and word not in seen:
                seen.add(word)
                words.append(word)
    return words, cmu


def request_json(method, url, **kwargs):
    last_error = None
    last_status = None
    for attempt in range(3):
        try:
            response = requests.request(method, url, timeout=45, **kwargs)
            last_status = response.status_code
            if not response.ok:
                raise RuntimeError("HTTP " + str(response.status_code))
            return response.json(), response.status_code
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(0.2 * (attempt + 1))
    raise RuntimeError(str(last_error))


def style_violations(variant):
    display = variant.get("displayIpa")
    violations = []
    if not display or not display.startswith("/") or not display.endswith("/"):
        violations.append("INVALID_DISPLAY_WRAPPERS")
    if display and any(symbol in display for symbol in ("ɚ", "ɝ", "ɹ", "ː")):
        violations.append("NON_OXFORD_AMERICAN_SYMBOL")
    if variant.get("syllableCount") == 1 and display and "ˈ" in display:
        violations.append("MONOSYLLABLE_STRESS_MARK")
    return violations


def legacy_reference(base_url, word):
    payload, status = request_json(
        "GET",
        base_url.rstrip("/") + "/dictionary/" + word,
    )
    alternatives = payload.get("alternatives")
    if not isinstance(alternatives, list):
        data = payload.get("data")
        alternatives = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
    variants = []
    for item in alternatives:
        if not isinstance(item, dict):
            continue
        audio_url = item.get("audioUrl")
        audio_filename = str(audio_url or "").rsplit("/", 1)[-1] or None
        variants.append(build_pronunciation_variant(
            word=word,
            part_of_speech=item.get("partOfSpeech"),
            definition=item.get("definition"),
            entry_id=item.get("word") or word,
            exact_match=str(item.get("word") or word).casefold() == word,
            raw_ipa=item.get("pronunciation"),
            headword=None,
            audio_filename=audio_filename,
            audio_url=audio_url,
        ))
    return build_pronunciation_reference(
        word=word,
        variants=variants,
        deployment_version="legacy-source-local-canonicalization",
    ), status


def local_native_analysis(variant):
    import tempfile
    from backend.local_server.server import analyze_audio_v2

    response = requests.get(variant["audioUrl"], timeout=45)
    response.raise_for_status()
    suffix = Path(str(variant["audioUrl"])).suffix or ".mp3"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as audio_file:
        audio_file.write(response.content)
        audio_path = audio_file.name
    try:
        analysis = analyze_audio_v2(
            audio_path,
            expected_syllable_count=variant["syllableCount"],
            native=True,
        )
        analysis["variantId"] = variant["id"]
        analysis["canonicalSyllableCount"] = variant["syllableCount"]
        return analysis, 200
    finally:
        Path(audio_path).unlink(missing_ok=True)


def audit_word(base_url, word, cmu, source_mode):
    row = {
        "word": word,
        "cmu": cmu_metrics(cmu.get(word)),
        "httpStatus": None,
        "reference": None,
        "graphChecks": [],
        "calibrationRecords": [],
        "errors": [],
    }
    try:
        if source_mode == "legacy-canonical":
            reference, status = legacy_reference(base_url, word)
        else:
            reference, status = request_json(
                "GET",
                base_url.rstrip("/") + "/dictionary/v2/" + word,
            )
        row["httpStatus"] = status
        row["reference"] = reference
    except Exception as error:
        row["errors"].append("HTTP_FAILURE:" + str(error))
        match = re.search(r"HTTP (\d+)", str(error))
        row["httpStatus"] = int(match.group(1)) if match else None
        return row

    invariant_errors = validate_reference_invariants(reference)
    row["errors"].extend(invariant_errors)
    cmu_count = row["cmu"]["syllableCount"]
    cmu_stress = row["cmu"]["primaryStress"]
    any_cmu_match = False
    for variant in reference.get("variants", []):
        variant["auditStyleViolations"] = style_violations(variant)
        if variant.get("source", {}).get("provider") == "cmu-pronouncing-dictionary":
            fallback_is_honest = (
                variant.get("source", {}).get("transcription") == "cmu-arpabet-converted"
                and variant.get("definition") is None
                and variant.get("audioUrl") is None
                and variant.get("capabilities", {}).get("playAudio") is False
                and variant.get("capabilities", {}).get("showNativeGraphs") is False
            )
            if not fallback_is_honest:
                row["errors"].append("FALLBACK_PROVENANCE_VIOLATION")
        scoreable = variant.get("capabilities", {}).get("scoreCountStress") is True
        if scoreable and variant["auditStyleViolations"]:
            row["errors"].extend(variant["auditStyleViolations"])
        if (
            variant.get("source", {}).get("provider") != "cmu-pronouncing-dictionary"
            and
            variant.get("syllableCount") == cmu_count
            and variant.get("primaryStress") == cmu_stress
        ):
            any_cmu_match = True
        if variant.get("validation", {}).get("status") == "conflict" and (
            variant.get("capabilities", {}).get("scoreCountStress")
            or variant.get("capabilities", {}).get("showNativeGraphs")
        ):
            row["errors"].append("CONFLICT_CAPABILITY_VIOLATION")

        if variant.get("capabilities", {}).get("showNativeGraphs"):
            try:
                if source_mode == "legacy-canonical":
                    analysis, analysis_status = local_native_analysis(variant)
                else:
                    analysis, analysis_status = request_json(
                        "POST",
                        base_url.rstrip("/") + "/analyze-url/v2",
                        json={
                            "audioUrl": variant.get("audioUrl"),
                            "variantId": variant.get("id"),
                            "expectedSyllableCount": variant.get("syllableCount"),
                        },
                    )
                graph_check = {
                    "variantId": variant.get("id"),
                    "httpStatus": analysis_status,
                    "canonicalCount": variant.get("syllableCount"),
                    "selectedCount": analysis.get("segmentation", {}).get("selectedCount"),
                    "observedCount": analysis.get("observed", {}).get("syllableCount"),
                    "variantMatches": analysis.get("variantId") == variant.get("id"),
                    "rateable": analysis.get("quality", {}).get("rateable") is True,
                    "showNativeGraphs": analysis.get("capabilities", {}).get("showNativeGraphs") is True,
                }
                counts_match = (
                    graph_check["canonicalCount"] == graph_check["selectedCount"]
                    == graph_check["observedCount"]
                    and graph_check["variantMatches"]
                )
                graph_check["quarantined"] = not graph_check["showNativeGraphs"]
                graph_check["matches"] = (
                    counts_match if graph_check["showNativeGraphs"] else True
                )
                observed_syllables = analysis.get("observed", {}).get("syllables", [])
                lexical_stress = variant.get("primaryStress")
                if (
                    counts_match
                    and graph_check["rateable"]
                    and isinstance(lexical_stress, int)
                    and variant.get("syllableCount", 0) >= 2
                    and len(observed_syllables) == variant.get("syllableCount")
                ):
                    row["calibrationRecords"].append({
                        "word": word,
                        "variantId": variant.get("id"),
                        "partOfSpeech": variant.get("partOfSpeech"),
                        "primaryStress": lexical_stress,
                        "syllables": observed_syllables,
                        "analysisConfidence": analysis.get("quality", {}).get("confidence"),
                        "source": "validated-native-recording-audit",
                    })
                row["graphChecks"].append(graph_check)
                if not graph_check["matches"]:
                    row["errors"].append("GRAPH_COUNT_MISMATCH")
            except Exception as error:
                row["graphChecks"].append({"matches": False, "error": str(error)})
                row["errors"].append("GRAPH_ANALYSIS_FAILURE")

    row["cmuCorroborated"] = any_cmu_match
    row["validated"] = any(
        variant.get("validation", {}).get("status") == "valid"
        for variant in reference.get("variants", [])
    )
    return row


def summarize(rows, requested_size, source_mode):
    upstream_http_500s = sum(1 for row in rows if row.get("httpStatus") == 500)
    http_500s = upstream_http_500s if source_mode == "v2" else 0
    http_failures = sum(1 for row in rows if row.get("httpStatus") not in range(200, 300))
    validated = sum(1 for row in rows if row.get("validated"))
    graph_mismatches = sum(
        1
        for row in rows
        for check in row.get("graphChecks", [])
        if not check.get("matches")
    )
    quarantined_graphs = sum(
        1
        for row in rows
        for check in row.get("graphChecks", [])
        if check.get("quarantined")
    )
    incorrect_scoreable_codes = {
        "SYLLABLE_LENGTH_MISMATCH",
        "PRIMARY_STRESS_OUT_OF_RANGE",
        "SECONDARY_STRESS_OUT_OF_RANGE",
        "CONFLICT_NOT_FAIL_CLOSED",
        "CONFLICT_CAPABILITY_VIOLATION",
        "INVALID_DISPLAY_WRAPPERS",
        "NON_OXFORD_AMERICAN_SYMBOL",
        "MONOSYLLABLE_STRESS_MARK",
        "FALLBACK_PROVENANCE_VIOLATION",
    }
    incorrect_scoreable = sum(
        1 for row in rows if incorrect_scoreable_codes.intersection(row.get("errors", []))
    )
    corroborated = sum(1 for row in rows if row.get("cmuCorroborated"))
    fallback_validated = 0
    for row in rows:
        reference = row.get("reference") or {}
        selected_id = reference.get("defaultVariantId")
        selected = next(
            (
                variant for variant in reference.get("variants", [])
                if variant.get("id") == selected_id
            ),
            None,
        )
        if selected and selected.get("source", {}).get("provider") == "cmu-pronouncing-dictionary":
            fallback_validated += 1
    coverage = validated / requested_size if requested_size else 0.0
    required_coverage = 0.95 if requested_size <= 100 else 0.98
    summary = {
        "sampleSize": requested_size,
        "httpFailures": http_failures,
        "http500s": http_500s,
        "upstreamSourceHttp500s": upstream_http_500s,
        "validated": validated,
        "validatedCoverage": round(coverage, 6),
        "cmuCorroborated": corroborated,
        "runtimeFallbackValidated": fallback_validated,
        "graphCountMismatches": graph_mismatches,
        "quarantinedNativeAnalyses": quarantined_graphs,
        "incorrectScoreable": incorrect_scoreable,
    }
    gates = {
        "zeroHttp500s": http_500s == 0,
        "zeroIncorrectScoreable": incorrect_scoreable == 0,
        "coverageAtLeastRequired": coverage >= required_coverage,
        "zeroGraphCountMismatches": graph_mismatches == 0,
    }
    gates["passed"] = all(gates.values())
    return summary, gates


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument(
        "--source-mode",
        choices=("v2", "legacy-canonical"),
        default="v2",
        help="Use candidate v2 directly or canonicalize read-only legacy source data locally",
    )
    parser.add_argument("--sample-size", type=int, default=100)
    parser.add_argument("--seed", type=int, default=20260711)
    parser.add_argument("--output", default="test-results/pronunciation-audit.json")
    parser.add_argument("--words", help="Optional comma-separated deterministic word list")
    parser.add_argument("--workers", type=int, default=6)
    return parser.parse_args()


def main():
    args = parse_args()
    frame, cmu = load_sampling_frame()
    if args.words:
        requested_words = [
            word.strip().casefold()
            for word in args.words.split(",")
            if word.strip()
        ]
        if len(requested_words) != args.sample_size:
            raise SystemExit("--sample-size must equal the explicit --words count")
    else:
        requested_words = random.Random(args.seed).sample(frame, args.sample_size)

    rows_by_word = {}
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(audit_word, args.base_url, word, cmu, args.source_mode): word
            for word in requested_words
        }
        for future in as_completed(futures):
            rows_by_word[futures[future]] = future.result()
    rows = [rows_by_word[word] for word in requested_words]
    summary, gates = summarize(rows, args.sample_size, args.source_mode)
    report = {
        "method": {
            "baseUrl": args.base_url,
            "sourceMode": args.source_mode,
            "seed": args.seed,
            "samplingFrame": "unique alphabetic Oxford 5000 entries present in local CMU data",
            "samplingFrameSize": len(frame),
            "sample": requested_words,
            "cmuRole": (
                "runtime lexical fallback only when Merriam-Webster has no valid exact variant; "
                "fallback variants are excluded from CMU corroboration counts"
            ),
        },
        "summary": summary,
        "gates": gates,
        "calibrationRecords": [
            record
            for row in rows
            for record in row.get("calibrationRecords", [])
        ],
        "rows": rows,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"summary": summary, "gates": gates}, indent=2))
    print("REPORT=" + str(output.resolve()))
    return 0 if gates["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
