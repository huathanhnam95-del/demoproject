#!/usr/bin/env python3
"""Deterministic pronunciation-reference v2 audit with preserved evidence."""

from __future__ import annotations

import argparse
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import os
import random
import re
import sys
import time

try:
    import requests
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    requests = None


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.local_server.pronunciation_reference import (  # noqa: E402
    build_pronunciation_reference,
    build_pronunciation_variant,
    validate_reference_invariants,
)


PLAIN_WORD = re.compile(r"^[a-z]+$")
CMU_VOWEL = re.compile(r"^[A-Z]+([012])$")
NON_US_SOURCE_REGIONS = (
    "australian",
    "british",
    "canadian",
    "irish",
    "new zealand",
    "scottish",
    "south african",
)


def calculate_stable_hash(words: list[str]) -> str:
    import hashlib
    words_str = "\n".join(words)
    return hashlib.sha256(words_str.encode("utf-8")).hexdigest()


def generate_manifest(frame: list[str], seed: int, manifest_size: int) -> tuple[dict, str]:
    normalized_frame = sorted(list(set(w.strip().casefold() for w in frame)))
    if len(normalized_frame) < manifest_size:
        raise ValueError(f"Insufficient sampling frame: have {len(normalized_frame)}, need {manifest_size}")
    rng = random.Random(seed)
    selected = rng.sample(normalized_frame, manifest_size)
    manifest_hash = calculate_stable_hash(selected)
    manifest_data = {
        "seed": seed,
        "manifest_hash": manifest_hash,
        "words": selected
    }
    return manifest_data, manifest_hash


def split_into_cohorts(words: list[str], num_cohorts: int) -> list[list[str]]:
    cohort_size = len(words) // num_cohorts
    return [words[i * cohort_size : (i + 1) * cohort_size] for i in range(num_cohorts)]


def validate_manifest_hash(manifest_data: dict) -> bool:
    words = manifest_data.get("words", [])
    stored_hash = manifest_data.get("manifest_hash")
    calculated_hash = calculate_stable_hash(words)
    return stored_hash == calculated_hash


class FileLock:
    def __init__(self, lock_path: str):
        self.lock_path = lock_path

    def __enter__(self):
        while True:
            try:
                os.mkdir(self.lock_path)
                break
            except FileExistsError:
                time.sleep(0.05)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            os.rmdir(self.lock_path)
        except OSError:
            pass


def write_ledger_event(ledger_path: str, event: dict):
    Path(ledger_path).parent.mkdir(parents=True, exist_ok=True)
    lock_path = ledger_path + ".lock"
    with FileLock(lock_path):
        with open(ledger_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")


def get_completed_words_from_ledger(ledger_path: str, manifest_hash: str, deployment_version: str, algorithm_version: str) -> set[str]:
    completed = set()
    path = Path(ledger_path)
    if not path.exists():
        return completed
    lock_path = ledger_path + ".lock"
    with FileLock(lock_path):
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                    if (
                        event.get("manifest_hash") == manifest_hash
                        and event.get("deployment_version") == deployment_version
                        and event.get("algorithm_version") == algorithm_version
                    ):
                        word = event.get("word")
                        status = event.get("status")
                        if status in ("complete", "terminal_failure"):
                            completed.add(word)
                except Exception:
                    pass
    return completed


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
    if "verify" not in kwargs:
        kwargs["verify"] = False
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


def is_learner_selectable(variant):
    return (
        variant.get("validation", {}).get("status") == "valid"
        and variant.get("source", {}).get("exactMatch") is True
        and variant.get("capabilities", {}).get("scoreCountStress") is True
        and isinstance(variant.get("displayIpa"), str)
        and bool(variant.get("displayIpa"))
        and isinstance(variant.get("syllableCount"), int)
        and variant.get("syllableCount") > 0
    )


def source_labels_are_en_us_compatible(labels):
    if not isinstance(labels, list) or not all(
        isinstance(label, str) and label for label in labels
    ):
        return False
    label_text = " ".join(labels).casefold()
    explicitly_us = (
        re.search(r"\bu\.?s\.?(?:a\.?)?\b", label_text) is not None
        or "united states" in label_text
        or "american" in label_text
    )
    return explicitly_us or not any(
        region in label_text for region in NON_US_SOURCE_REGIONS
    )


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

    response = requests.get(variant["audioUrl"], timeout=45, verify=False)
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
        variant["auditLearnerSelectable"] = is_learner_selectable(variant)
        source = variant.get("source", {})
        if source.get("dialect") != "en-US":
            row["errors"].append("SOURCE_DIALECT_MISMATCH")
        if not source_labels_are_en_us_compatible(source.get("labels")):
            row["errors"].append("NON_US_SOURCE_LABEL")
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
        if (
            variant.get("validation", {}).get("status") == "conflict"
            and variant["auditLearnerSelectable"]
        ):
            row["errors"].append("CONFLICT_SELECTABLE")

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
        "CONFLICT_SELECTABLE",
        "INVALID_DISPLAY_WRAPPERS",
        "NON_OXFORD_AMERICAN_SYMBOL",
        "MONOSYLLABLE_STRESS_MARK",
        "FALLBACK_PROVENANCE_VIOLATION",
        "SOURCE_DIALECT_MISMATCH",
        "NON_US_SOURCE_LABEL",
    }
    incorrect_scoreable = sum(
        1 for row in rows if incorrect_scoreable_codes.intersection(row.get("errors", []))
    )
    corroborated = sum(1 for row in rows if row.get("cmuCorroborated"))
    selectable_conflicts = sum(
        1
        for row in rows
        for variant in (row.get("reference") or {}).get("variants", [])
        if (
            variant.get("validation", {}).get("status") == "conflict"
            and variant.get("auditLearnerSelectable") is True
        )
    )
    evidence_only_conflicts = sum(
        1
        for row in rows
        for variant in (row.get("reference") or {}).get("variants", [])
        if (
            variant.get("validation", {}).get("status") == "conflict"
            and variant.get("auditLearnerSelectable") is not True
        )
    )
    source_dialect_violations = sum(
        1
        for row in rows
        for variant in (row.get("reference") or {}).get("variants", [])
        if variant.get("source", {}).get("dialect") != "en-US"
    )
    non_us_source_label_violations = sum(
        1
        for row in rows
        for variant in (row.get("reference") or {}).get("variants", [])
        if not source_labels_are_en_us_compatible(
            variant.get("source", {}).get("labels")
        )
    )
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
        "selectableConflictVariants": selectable_conflicts,
        "evidenceOnlyConflictVariants": evidence_only_conflicts,
        "sourceDialectViolations": source_dialect_violations,
        "nonUsSourceLabelViolations": non_us_source_label_violations,
        "graphCountMismatches": graph_mismatches,
        "quarantinedNativeAnalyses": quarantined_graphs,
        "incorrectScoreable": incorrect_scoreable,
    }
    gates = {
        "zeroHttp500s": http_500s == 0,
        "zeroIncorrectScoreable": incorrect_scoreable == 0,
        "coverageAtLeastRequired": coverage >= required_coverage,
        "zeroGraphCountMismatches": graph_mismatches == 0,
        "zeroSelectableConflictVariants": selectable_conflicts == 0,
        "zeroSourceDialectViolations": source_dialect_violations == 0,
        "zeroNonUsSourceLabelViolations": non_us_source_label_violations == 0,
    }
    gates["passed"] = all(gates.values())
    return summary, gates


def get_local_git_sha():
    import subprocess
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True
        )
        return completed.stdout.strip()
    except Exception:
        return "unknown"


def get_health_info(base_url: str) -> dict:
    try:
        response = requests.get(base_url.rstrip("/") + "/health", timeout=10)
        if response.ok:
            return response.json()
    except Exception:
        pass
    return {}


def aggregate_reports(manifest_path: str, aggregate_through: int, output_report_path: str) -> int:
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not validate_manifest_hash(manifest):
        raise ValueError("Manifest integrity check failed: calculated hash does not match stored hash")
    
    manifest_hash = manifest["manifest_hash"]
    cohorts_to_load = list(range(1, aggregate_through + 1))
    parent_dir = Path(output_report_path).parent
    
    combined_rows = []
    seen_words = set()
    git_shas = set()
    deployment_versions = set()
    algorithm_versions = set()
    base_urls = set()
    
    for c in cohorts_to_load:
        cohort_file = parent_dir / f"cohort-{c}-rows.jsonl"
        if not cohort_file.exists():
            raise FileNotFoundError(f"Missing required cohort row file: {cohort_file}")
        
        with cohort_file.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                word = row.get("word")
                if not word:
                    continue
                if word in seen_words:
                    raise ValueError(f"Duplicate word found in cohort files: {word}")
                seen_words.add(word)
                combined_rows.append(row)
                
                meta = row.get("provenance", {})
                if meta.get("git_sha"):
                    git_shas.add(meta["git_sha"])
                if meta.get("deployment_version"):
                    deployment_versions.add(meta["deployment_version"])
                if meta.get("algorithm_version"):
                    algorithm_versions.add(meta["algorithm_version"])
                if meta.get("base_url"):
                    base_urls.add(meta["base_url"])
    
    if len(deployment_versions) > 1:
        raise ValueError(f"Mixed deployment versions found: {deployment_versions}")
    if len(algorithm_versions) > 1:
        raise ValueError(f"Mixed algorithm versions found: {algorithm_versions}")
    
    word_to_index = {word: idx for idx, word in enumerate(manifest["words"])}
    combined_rows.sort(key=lambda r: word_to_index.get(r["word"], 999999))
    
    total_manifest_words = len(manifest["words"])
    cohort_size = total_manifest_words // 3
    sample_size = aggregate_through * cohort_size
    if len(combined_rows) != sample_size:
        raise ValueError(f"Combined rows count {len(combined_rows)} does not match expected aggregate size {sample_size}")
        
    summary, gates = summarize(combined_rows, sample_size, "v2")
    
    review_queue = []
    incorrect_scoreable_codes = {
        "SYLLABLE_LENGTH_MISMATCH",
        "PRIMARY_STRESS_OUT_OF_RANGE",
        "SECONDARY_STRESS_OUT_OF_RANGE",
        "CONFLICT_NOT_FAIL_CLOSED",
        "CONFLICT_CAPABILITY_VIOLATION",
        "CONFLICT_SELECTABLE",
        "INVALID_DISPLAY_WRAPPERS",
        "NON_OXFORD_AMERICAN_SYMBOL",
        "MONOSYLLABLE_STRESS_MARK",
        "FALLBACK_PROVENANCE_VIOLATION",
        "SOURCE_DIALECT_MISMATCH",
        "NON_US_SOURCE_LABEL",
    }
    for row in combined_rows:
        has_error = False
        reasons = []
        if row.get("httpStatus") != 200:
            has_error = True
            reasons.append(f"HTTP_STATUS_{row.get('httpStatus')}")
        for err in row.get("errors", []):
            has_error = True
            reasons.append(err)
        for check in row.get("graphChecks", []):
            if not check.get("matches"):
                has_error = True
                reasons.append("GRAPH_COUNT_MISMATCH")
        reference = row.get("reference") or {}
        for variant in reference.get("variants", []):
            if variant.get("validation", {}).get("status") == "conflict":
                has_error = True
                reasons.append("CONFLICT_VARIANT")
        
        if has_error:
            review_queue.append({
                "word": row["word"],
                "reasons": list(set(reasons)),
                "errors": row.get("errors", []),
                "httpStatus": row.get("httpStatus"),
                "reference": row.get("reference")
            })
            
    review_path = parent_dir / "review-queue.json"
    review_path.write_text(json.dumps(review_queue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    
    report = {
        "manifest_hash": manifest_hash,
        "cohorts_aggregated": cohorts_to_load,
        "summary": summary,
        "gates": gates,
        "provenance": {
            "base_url": list(base_urls)[0] if base_urls else "unknown",
            "deployment_version": list(deployment_versions)[0] if deployment_versions else "unknown",
            "algorithm_version": list(algorithm_versions)[0] if algorithm_versions else "unknown",
            "git_shas": list(git_shas),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        },
        "review_queue_ref": "review-queue.json",
        "rows_files": [f"cohort-{c}-rows.jsonl" for c in cohorts_to_load]
    }
    Path(output_report_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_report_path).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    
    summary_md_path = parent_dir / "summary.md"
    table_rows = []
    for c_idx in range(1, 4):
        c_file = parent_dir / f"cohort-{c_idx}-rows.jsonl"
        if c_file.exists():
            c_rows = []
            with c_file.open("r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        c_rows.append(json.loads(line))
            if c_rows:
                c_sum, c_gates = summarize(c_rows, len(c_rows), "v2")
                coverage = c_sum["validatedCoverage"]
                fallback_rate = round(c_sum["runtimeFallbackValidated"] / len(c_rows), 4) if len(c_rows) else 0.0
                conflict_rate = round(c_sum["evidenceOnlyConflictVariants"] / len(c_rows), 4) if len(c_rows) else 0.0
                quarantine_rate = round(c_sum["quarantinedNativeAnalyses"] / len(c_rows), 4) if len(c_rows) else 0.0
                corroboration_rate = round(c_sum["cmuCorroborated"] / len(c_rows), 4) if len(c_rows) else 0.0
                table_rows.append(
                    f"| Cohort {c_idx} | {len(c_rows)} | {coverage*100:.2f}% | {fallback_rate*100:.2f}% | {conflict_rate*100:.2f}% | {quarantine_rate*100:.2f}% | {corroboration_rate*100:.2f}% |"
                )
                
    table_rows_str = "\n".join(table_rows)
    summary_md_content = f"""# Pronunciation Audit Campaign Summary

**Manifest Hash:** `{manifest_hash}`

## Cohort Comparison

| Cohort | Sample Size | Coverage | Fallback Rate | Conflict Rate | Graph Quarantine Rate | CMU Corroboration Rate |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
{table_rows_str}

*Generated at: {time.strftime("%Y-%m-%d %H:%M:%S GMT", time.gmtime())}*
"""
    summary_md_path.write_text(summary_md_content, encoding="utf-8")
    print(f"Aggregated report written to {output_report_path}")
    print(json.dumps({"summary": summary, "gates": gates}, indent=2))
    return 0 if gates["passed"] else 1


def run_cohort_audit(args, cmu):
    if not args.base_url:
        raise ValueError("--base-url is required to run cohort audit")
    
    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not validate_manifest_hash(manifest):
        raise ValueError("Manifest integrity check failed: calculated hash does not match stored hash")
    
    manifest_hash = manifest["manifest_hash"]
    words = manifest["words"]
    cohorts = split_into_cohorts(words, 3)
    cohort_idx = args.cohort - 1
    cohort_words = cohorts[cohort_idx]
    
    git_sha = get_local_git_sha()
    health_info = get_health_info(args.base_url)
    deployment_version = health_info.get("deploymentVersion", "unknown")
    algorithm_version = health_info.get("algorithmVersion", "unknown")
    schema_version = health_info.get("schemaVersion", "unknown")
    analysis_version = health_info.get("analysisVersion", "unknown")
    
    print(f"Audit campaign execution for Cohort {args.cohort}")
    print(f"Base URL: {args.base_url}")
    print(f"Git SHA: {git_sha}")
    print(f"Server deploymentVersion: {deployment_version}")
    print(f"Server algorithmVersion: {algorithm_version}")
    
    ledger_path = args.ledger
    if not ledger_path:
        ledger_path = str(Path(args.output).parent / "ledger.jsonl")
        
    completed_words = get_completed_words_from_ledger(
        ledger_path, manifest_hash, deployment_version, algorithm_version
    )
    print(f"Already completed in ledger: {len(completed_words)} words out of {len(cohort_words)}")
    
    pending_words = [w for w in cohort_words if w not in completed_words]
    print(f"Pending execution: {len(pending_words)} words")
    
    if not pending_words:
        print("All words in this cohort are already completed. Done.")
        return 0
        
    rows_by_word = {}
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    def process_and_log_word(word):
        write_ledger_event(ledger_path, {
            "manifest_hash": manifest_hash,
            "deployment_version": deployment_version,
            "algorithm_version": algorithm_version,
            "word": word,
            "status": "in_progress",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })
        
        row = audit_word(args.base_url, word, cmu, args.source_mode)
        row["provenance"] = {
            "base_url": args.base_url,
            "git_sha": git_sha,
            "deployment_version": deployment_version,
            "algorithm_version": algorithm_version,
            "schema_version": schema_version,
            "analysis_version": analysis_version,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        
        is_failed = row.get("httpStatus") != 200 or len(row.get("errors", [])) > 0
        status = "terminal_failure" if is_failed else "complete"
        
        lock_path = str(output_path) + ".lock"
        with FileLock(lock_path):
            with output_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                
        write_ledger_event(ledger_path, {
            "manifest_hash": manifest_hash,
            "deployment_version": deployment_version,
            "algorithm_version": algorithm_version,
            "word": word,
            "status": status,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "result": {"errors": row.get("errors", []), "httpStatus": row.get("httpStatus")}
        })
        return row

    completed_count = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(process_and_log_word, word): word
            for word in pending_words
        }
        for future in as_completed(futures):
            word = futures[future]
            try:
                row = future.result()
                rows_by_word[word] = row
                completed_count += 1
                if completed_count % 100 == 0:
                    print(f"Progress: completed {completed_count}/{len(pending_words)} words...")
            except Exception as e:
                print(f"Error auditing word {word}: {e}")
                
    print(f"Cohort {args.cohort} audit execution completed. {completed_count} words processed.")
    return 0


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("PRONUNCIATION_AUDIT_BASE_URL"), required=False)
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
    
    # Non-repeating campaign options
    parser.add_argument("--create-manifest", help="Create manifest JSON file with words using seed")
    parser.add_argument("--manifest", help="Use an existing manifest JSON file")
    parser.add_argument("--cohort", type=int, choices=(1, 2, 3), help="Select cohort index (1, 2, or 3)")
    parser.add_argument("--aggregate-through", type=int, choices=(1, 2, 3), help="Aggregate reports through cohort index")
    parser.add_argument("--ledger", help="Path to resume ledger.jsonl file")
    
    return parser.parse_args()


def main():
    args = parse_args()
    
    # Create manifest mode
    if args.create_manifest:
        frame, cmu = load_sampling_frame()
        manifest_data, manifest_hash = generate_manifest(frame, args.seed, args.sample_size)
        output_path = Path(args.create_manifest)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(manifest_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Created manifest at {output_path.resolve()} with hash {manifest_hash}")
        return 0
        
    # Aggregate mode
    if args.aggregate_through:
        if not args.manifest:
            raise ValueError("--manifest is required for aggregation mode")
        return aggregate_reports(args.manifest, args.aggregate_through, args.output)
        
    # Cohort audit mode
    if args.manifest and args.cohort:
        frame, cmu = load_sampling_frame()
        return run_cohort_audit(args, cmu)
        
    # Legacy default mode
    if not args.base_url:
        raise ValueError("--base-url is required when running audits")
        
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
