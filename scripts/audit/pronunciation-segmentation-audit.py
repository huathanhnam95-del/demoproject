#!/usr/bin/env python3
"""Pronunciation Segmentation V3 Audit — Verification Script

Runs automated verification gates against the /analyze/v3 endpoint
using the evaluation corpus manifest. Evaluates all promotion gates
and outputs markdown and raw JSON results.

Part of Task 9 — Pronunciation Segmentation V3.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

# Default configuration
DEFAULT_BASE_URL = "http://localhost:8080"
DEFAULT_MANIFEST_PATH = "tests/fixtures/pronunciation-segmentation/manifest.json"
DEFAULT_MODEL_MANIFEST_PATH = "backend/phoneme_service/model-manifest.json"
DEFAULT_OUTPUT_DIR = "test-results/audit-results"

MANDATORY_WORDS = {"busy", "photograph", "photography", "banana", "camera", "university"}


def load_json(path: Path) -> Optional[dict]:
    """Load JSON file safely."""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[ERROR] Failed to load JSON from {path}: {e}", file=sys.stderr)
        return None


def align_and_compute_mae(observed: list[dict], verified: list[dict]) -> Optional[float]:
    """Compute Mean Absolute Error (MAE) of syllable boundaries in seconds.

    Aligns observed syllables to verified spans one-to-one.
    """
    if not observed or not verified:
        return None

    # Align up to the shorter list length
    n = min(len(observed), len(verified))
    errors = []
    for i in range(n):
        obs_start = observed[i].get("start_time", observed[i].get("startTime"))
        obs_end = observed[i].get("end_time", observed[i].get("endTime"))
        ver_start = verified[i].get("start_time", verified[i].get("start"))
        ver_end = verified[i].get("end_time", verified[i].get("end"))

        if (
            obs_start is not None
            and obs_end is not None
            and ver_start is not None
            and ver_end is not None
        ):
            errors.append(abs(obs_start - ver_start))
            errors.append(abs(obs_end - ver_end))

    if not errors:
        return None
    return sum(errors) / len(errors)


def calculate_precision_recall(tp: int, fp: int, fn: int) -> tuple[float, float]:
    """Calculate precision and recall safely."""
    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    return precision, recall


def native_graph_payload_available(payload: dict) -> bool:
    """Return True only when the native analysis can render both contours."""
    capabilities = payload.get("capabilities") or {}
    pitch = payload.get("pitch") or {}
    intensity = payload.get("intensity") or {}
    return bool(
        capabilities.get("showNativeGraphs")
        and pitch.get("times")
        and pitch.get("values")
        and intensity.get("times")
        and intensity.get("values")
    )


def target_forcing_probe_passed(primary: dict, probe: dict) -> bool:
    """Verify that changing the target hint does not change the observed count."""
    primary_count = primary.get("syllable_count")
    probe_count = probe.get("syllable_count")
    return bool(
        isinstance(primary_count, int)
        and isinstance(probe_count, int)
        and primary_count == probe_count
    )


def manifest_target_syllable_count(entry: dict) -> int:
    """Read the independently verified target count from corpus metadata."""
    count = entry.get("targetSyllableCount")
    if isinstance(count, int) and count > 0:
        return count
    raise ValueError(
        f"Manifest entry {entry.get('sampleId') or entry.get('targetWord')!r} "
        "must provide a positive integer targetSyllableCount"
    )


def probe_native_reference_graphs(base_url: str, words: set[str]) -> list[bool]:
    """Exercise fresh dictionary audio through /analyze-url/v2."""
    results: list[bool] = []
    for word in sorted(words):
        try:
            encoded_word = requests.utils.quote(word, safe="")
            dictionary_response = requests.get(
                f"{base_url}/dictionary/v2/{encoded_word}", timeout=10,
            )
            dictionary_response.raise_for_status()
            variants = dictionary_response.json().get("variants") or []
            eligible = [
                variant for variant in variants
                if (variant.get("validation") or {}).get("status") == "valid"
                and variant.get("audioUrl")
                and isinstance(variant.get("syllableCount"), int)
                and variant.get("syllableCount") > 0
            ]
            if not eligible:
                print(f"  [WARNING] No valid audio-backed native variant for {word}")
                results.append(False)
                continue
            for variant in eligible:
                analysis_response = requests.post(
                    f"{base_url}/analyze-url/v2",
                    json={
                        "audioUrl": variant["audioUrl"],
                        "variantId": variant["id"],
                        "expectedSyllableCount": variant["syllableCount"],
                    },
                    timeout=20,
                )
                available = (
                    analysis_response.status_code == 200
                    and native_graph_payload_available(analysis_response.json())
                )
                results.append(available)
                print(
                    f"  Native graph {word}/{variant['id']}: "
                    f"{'available' if available else 'unavailable'}"
                )
        except Exception as error:
            print(f"  [ERROR] Native graph probe failed for {word}: {error}")
            results.append(False)
    return results


def evaluate_promotion_gates(
    results: list[dict],
    model_manifest: Optional[dict],
    latencies: list[float],
    native_graph_results: Optional[list[bool]] = None,
    target_forcing_verified: bool = False,
) -> tuple[dict[str, Any], bool]:
    """Evaluate Task 9.3 promotion gates against audit results."""
    gates_status = {}
    all_pass = True

    # 1. Clean words correct (6/6)
    clean_words_results = {w: False for w in MANDATORY_WORDS}
    for res in results:
        word = res["targetWord"].lower()
        if word in MANDATORY_WORDS and res["category"] == "clean":
            # Correct if it matches the expected observed count
            if res.get("syllable_count") == res.get("expectedObservedCount"):
                clean_words_results[word] = True

    correct_mandatory = sum(1 for w in MANDATORY_WORDS if clean_words_results[w])
    gates_status["mandatory_clean_words"] = {
        "description": "Mandatory clean words (6/6)",
        "expected": "6/6",
        "actual": f"{correct_mandatory}/6",
        "passed": correct_mandatory == 6,
    }
    if not gates_status["mandatory_clean_words"]["passed"]:
        all_pass = False

    # 2. Overall clean count accuracy (>= 95%)
    clean_entries = [r for r in results if r["category"] == "clean"]
    clean_correct = sum(
        1 for r in clean_entries if r.get("syllable_count") == r.get("expectedObservedCount")
    )
    clean_acc = clean_correct / len(clean_entries) if clean_entries else None
    gates_status["overall_clean_accuracy"] = {
        "description": "Overall clean count accuracy (>= 95%)",
        "expected": ">= 95.0%",
        "actual": f"{clean_acc * 100:.1f}%" if clean_acc is not None else "N/A (no clean samples)",
        "passed": clean_acc is not None and clean_acc >= 0.95,
    }
    if not gates_status["overall_clean_accuracy"]["passed"]:
        all_pass = False

    # 3 & 4. Insertion and Omission Precision/Recall (each >= 90%)
    # Omissions (deletions)
    predicts_omission = lambda r: (
        isinstance(r.get("syllable_count"), int)
        and r.get("syllable_count") < r.get("expected_syllables_target", 99)
    )
    omission_tp = sum(1 for r in results if r["category"] == "omission" and predicts_omission(r))
    omission_fp = sum(1 for r in results if r["category"] != "omission" and predicts_omission(r))
    omission_fn = sum(1 for r in results if r["category"] == "omission" and not predicts_omission(r))
    has_omission_samples = any(r["category"] == "omission" for r in results)
    omission_prec, omission_rec = calculate_precision_recall(omission_tp, omission_fp, omission_fn)

    gates_status["omission_precision"] = {
        "description": "Omission precision (>= 90%)",
        "expected": ">= 90.0%",
        "actual": f"{omission_prec * 100:.1f}%" if has_omission_samples else "N/A (no omission samples)",
        "passed": has_omission_samples and omission_prec >= 0.90,
    }
    gates_status["omission_recall"] = {
        "description": "Omission recall (>= 90%)",
        "expected": ">= 90.0%",
        "actual": f"{omission_rec * 100:.1f}%" if has_omission_samples else "N/A (no omission samples)",
        "passed": has_omission_samples and omission_rec >= 0.90,
    }
    if not gates_status["omission_precision"]["passed"] or not gates_status["omission_recall"]["passed"]:
        all_pass = False

    # Insertions
    predicts_insertion = lambda r: (
        isinstance(r.get("syllable_count"), int)
        and r.get("syllable_count") > r.get("expected_syllables_target", 0)
    )
    insertion_tp = sum(1 for r in results if r["category"] == "insertion" and predicts_insertion(r))
    insertion_fp = sum(1 for r in results if r["category"] != "insertion" and predicts_insertion(r))
    insertion_fn = sum(1 for r in results if r["category"] == "insertion" and not predicts_insertion(r))
    insertion_prec, insertion_rec = calculate_precision_recall(insertion_tp, insertion_fp, insertion_fn)
    has_insertion_samples = any(r["category"] == "insertion" for r in results)

    gates_status["insertion_precision"] = {
        "description": "Insertion precision (>= 90%)",
        "expected": ">= 90.0%",
        "actual": f"{insertion_prec * 100:.1f}%" if has_insertion_samples else "N/A (no insertion samples)",
        "passed": has_insertion_samples and insertion_prec >= 0.90,
    }
    gates_status["insertion_recall"] = {
        "description": "Insertion recall (>= 90%)",
        "expected": ">= 90.0%",
        "actual": f"{insertion_rec * 100:.1f}%" if has_insertion_samples else "N/A (no insertion samples)",
        "passed": has_insertion_samples and insertion_rec >= 0.90,
    }
    if not gates_status["insertion_precision"]["passed"] or not gates_status["insertion_recall"]["passed"]:
        all_pass = False

    # 5. Vietnamese-accented count accuracy (>= 90%)
    accented_entries = [r for r in results if r["category"] == "accented"]
    accented_correct = sum(
        1 for r in accented_entries if r.get("syllable_count") == r.get("expectedObservedCount")
    )
    accented_acc = accented_correct / len(accented_entries) if accented_entries else None
    gates_status["accented_accuracy"] = {
        "description": "Vietnamese-accented count accuracy (>= 90%)",
        "expected": ">= 90.0%",
        "actual": f"{accented_acc * 100:.1f}%" if accented_acc is not None else "N/A (no accented samples)",
        "passed": accented_acc is not None and accented_acc >= 0.90,
    }
    if not gates_status["accented_accuracy"]["passed"]:
        all_pass = False

    # 6. Boundary mean absolute error (<= 60 ms)
    mae_values = [r["boundary_mae"] for r in results if r.get("boundary_mae") is not None]
    avg_mae = sum(mae_values) / len(mae_values) if mae_values else None
    gates_status["boundary_mae"] = {
        "description": "Boundary mean absolute error (<= 60 ms)",
        "expected": "<= 60 ms",
        "actual": f"{avg_mae * 1000:.1f} ms" if avg_mae is not None else "N/A (no verified boundaries)",
        "passed": avg_mae is not None and avg_mae <= 0.060,
    }
    if not gates_status["boundary_mae"]["passed"]:
        all_pass = False

    # 7. Duration available for at least 98% of rateable recordings
    rateable_entries = [r for r in results if r.get("is_rateable") is True]
    duration_valid = sum(
        1
        for r in rateable_entries
        if r.get("syllable_durations_available") is True
    )
    duration_ratio = duration_valid / len(rateable_entries) if rateable_entries else None
    gates_status["duration_availability"] = {
        "description": "Duration available for rateable recordings (>= 98%)",
        "expected": ">= 98.0%",
        "actual": f"{duration_ratio * 100:.1f}%" if duration_ratio is not None else "N/A (no rateable samples)",
        "passed": duration_ratio is not None and duration_ratio >= 0.98,
    }
    if not gates_status["duration_availability"]["passed"]:
        all_pass = False

    # 8. Warm /analyze/v3 p95 (<= 2 seconds)
    sorted_latencies = sorted(latencies)
    p95_latency = 0.0
    if sorted_latencies:
        p95_idx = int(len(sorted_latencies) * 0.95)
        p95_latency = sorted_latencies[min(p95_idx, len(sorted_latencies) - 1)]

    gates_status["warm_p95_latency"] = {
        "description": "Warm /analyze/v3 p95 latency (<= 2.0s)",
        "expected": "<= 2.0 s",
        "actual": f"{p95_latency:.2f} s" if sorted_latencies else "N/A (no live requests)",
        "passed": bool(sorted_latencies) and p95_latency <= 2.0,
    }
    if not gates_status["warm_p95_latency"]["passed"]:
        all_pass = False

    # 9. Peak recognizer RSS (<= 3.5 GiB)
    peak_rss = None
    if model_manifest:
        peak_rss = model_manifest.get("benchmark", {}).get("peakRssGiB")

    gates_status["peak_rss"] = {
        "description": "Peak recognizer RSS (<= 3.5 GiB)",
        "expected": "<= 3.5 GiB",
        "actual": f"{peak_rss:.2f} GiB" if isinstance(peak_rss, (int, float)) else "N/A (not measured)",
        "passed": isinstance(peak_rss, (int, float)) and peak_rss > 0 and peak_rss <= 3.5,
    }
    if not gates_status["peak_rss"]["passed"]:
        all_pass = False

    # 10. Fresh native graph availability (>= 99%)
    # In V3, whenever rateable is true, pitch/intensity/contours must be present
    graph_checks = list(native_graph_results or [])
    graph_valid = sum(1 for available in graph_checks if available)
    graph_ratio = graph_valid / len(graph_checks) if graph_checks else None
    gates_status["graph_availability"] = {
        "description": "Fresh native graph availability (>= 99%)",
        "expected": ">= 99.0%",
        "actual": f"{graph_ratio * 100:.1f}%" if graph_ratio is not None else "N/A (native graphs not audited)",
        "passed": graph_ratio is not None and graph_ratio >= 0.99,
    }
    if not gates_status["graph_availability"]["passed"]:
        all_pass = False

    # 11. Zero target-forced learner counts
    # Verified by checking if the observed syllable count ever exactly mirrors
    # a wrong expectedObservedCount or is affected by expected_syllables
    # We check if there are any counts that were forced (this is a design property,
    # but dynamically we verify the endpoint reports observed syllables independent of hints).
    gates_status["zero_target_forced_counts"] = {
        "description": "Zero target-forced learner counts",
        "expected": "Yes",
        "actual": "Yes" if target_forcing_verified else "N/A (A/B observation check not run)",
        "passed": bool(target_forcing_verified),
    }
    if not gates_status["zero_target_forced_counts"]["passed"]:
        all_pass = False

    # 12. Zero unexplained blank graphs
    blank_graphs = sum(1 for available in graph_checks if not available)
    gates_status["zero_blank_graphs"] = {
        "description": "Zero unexplained blank graphs",
        "expected": "0",
        "actual": str(blank_graphs) if graph_checks else "N/A (native graphs not audited)",
        "passed": bool(graph_checks) and blank_graphs == 0,
    }
    if not gates_status["zero_blank_graphs"]["passed"]:
        all_pass = False

    return gates_status, all_pass


def write_reports(
    output_dir: Path,
    gates: dict[str, Any],
    all_pass: bool,
    results: list[dict],
    health_info: Optional[dict],
) -> tuple[Path, Path]:
    """Write markdown summary and raw JSON logs."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. JSON report
    json_path = output_dir / "audit-results.json"
    report_data = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "health": health_info,
        "summary": {
            "all_gates_passed": all_pass,
            "total_samples": len(results),
            "rateable_samples": sum(1 for r in results if r.get("is_rateable") is True),
        },
        "gates": gates,
        "results": results,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # 2. Markdown report
    md_path = output_dir / "pronunciation-v3-audit-report.md"
    lines = [
        "# Pronunciation V3 Segmentation Audit Report",
        "",
        f"- **Date**: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}",
        f"- **Status**: {'✅ PASSED' if all_pass else '❌ FAILED'}",
        f"- **V3 Mode**: {health_info.get('pronunciationV3Mode', 'unknown') if health_info else 'unknown'}",
        "",
        "## Promotion Gates Summary",
        "",
        "| Gate | Expected | Actual | Status |",
        "|------|----------|--------|--------|",
    ]
    for key, gate in gates.items():
        status_icon = "✅" if gate["passed"] else "❌"
        lines.append(
            f"| {gate['description']} | {gate['expected']} | {gate['actual']} | {status_icon} |"
        )

    lines.extend([
        "",
        "## Detailed Results",
        "",
        f"Total evaluated samples: {len(results)}",
        "",
        "| Sample ID | Target Word | Expected Count | Observed Count | Rateable | MAE | Status |",
        "|-----------|-------------|----------------|----------------|----------|-----|--------|",
    ])
    for r in results:
        status_icon = "✅" if r.get("syllable_count") == r.get("expectedObservedCount") else "❌"
        mae_str = f"{r['boundary_mae'] * 1000:.1f} ms" if r.get("boundary_mae") is not None else "N/A"
        lines.append(
            f"| {r['sampleId']} | {r['targetWord']} | {r['expectedObservedCount']} | "
            f"{r.get('syllable_count', 'N/A')} | {r.get('is_rateable', 'N/A')} | {mae_str} | {status_icon} |"
        )

    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        f.write("\n")

    return json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Pronunciation Segmentation V3 Audit Script")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Base URL of praat-api orchestrator")
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST_PATH, help="Path to corpus manifest file")
    parser.add_argument("--model-manifest", default=DEFAULT_MODEL_MANIFEST_PATH, help="Path to model manifest file")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_DIR, help="Output directory for reports")
    parser.add_argument("--dry-run", action="store_true", help="Perform a dry run without calling the live API")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    model_manifest_path = Path(args.model_manifest)
    output_dir = Path(args.output)

    print("=" * 60)
    print("Pronunciation Segmentation V3 Audit")
    print("=" * 60)

    # 1. Health check
    health_info = None
    if not args.dry_run:
        try:
            print(f"Connecting to backend at {args.base_url} …")
            resp = requests.get(f"{args.base_url}/health", timeout=5)
            if resp.status_code == 200:
                health_info = resp.json()
                print(f"Backend status: OK (Mode: {health_info.get('pronunciationV3Mode', 'unknown')})")
            else:
                print(f"[WARNING] Health check returned status {resp.status_code}")
        except Exception as e:
            print(f"[WARNING] Health check failed to connect to {args.base_url}: {e}")

    # 2. Load manifest & model manifest
    manifest = load_json(manifest_path)
    model_manifest = load_json(model_manifest_path)

    results = []
    latencies = []
    target_forcing_results: list[bool] = []
    warmup_complete = False

    if not manifest or not manifest.get("entries"):
        print("[ERROR] Manifest has no entries; promotion evidence is unavailable.")
        gates, all_pass = evaluate_promotion_gates([], model_manifest, [])
        json_path, md_path = write_reports(output_dir, gates, all_pass, [], health_info)
        print("Audit completed: Failure (empty manifest).")
        print(f"Summary report written to {md_path}")
        sys.exit(2)

    print(f"Evaluating {len(manifest['entries'])} entries from manifest …")
    # For actual evaluation, we query the live backend if WAV files are present
    audio_dir = manifest_path.parent / "audio"

    for entry in manifest["entries"]:
        sample_id = entry["sampleId"]
        target_word = entry["targetWord"]
        expected_observed = entry["expectedObservedCount"]
        category = entry["category"]

        try:
            target_syllable_count = manifest_target_syllable_count(entry)
        except ValueError as error:
            print(f"  [ERROR] {error}")
            target_syllable_count = None

        # Basic result template
        result_item = {
            "sampleId": sample_id,
            "targetWord": target_word,
            "expectedObservedCount": expected_observed,
            "expected_syllables_target": target_syllable_count,
            "category": category,
            "syllable_count": None,
            "is_rateable": None,
            "boundary_mae": None,
            "total_duration": None,
            "syllable_durations_available": False,
            "has_pitch": False,
            "has_intensity": False,
            "status": "pending",
        }

        if target_syllable_count is None:
            result_item["status"] = "invalid_manifest"
            results.append(result_item)
            continue

        wav_path = audio_dir / f"{sample_id}.wav"
        if not wav_path.exists():
            print(f"  [ERROR] Missing audio for {sample_id} ({target_word})")
            result_item["status"] = "missing_audio"
            results.append(result_item)
            continue
        if args.dry_run:
            print(f"  [INFO] Dry run did not evaluate {sample_id} ({target_word})")
            result_item["status"] = "not_evaluated_dry_run"
            results.append(result_item)
            continue

        # Query live API
        try:
            print(f"  Querying {sample_id} ({target_word}) …")
            t0 = time.perf_counter()
            with open(wav_path, "rb") as audio_file:
                files = {"audio": (wav_path.name, audio_file, "audio/wav")}
                data = {}
                if entry.get("referenceIpa"):
                    data["reference_ipa"] = entry["referenceIpa"]
                if expected_observed > 0:
                    data["expected_syllables"] = str(expected_observed)
                data["target_word"] = target_word

                resp = requests.post(
                    f"{args.base_url}/analyze/v3",
                    files=files,
                    data=data,
                    timeout=20,
                )

            latency = time.perf_counter() - t0
            result_item["latencySeconds"] = latency
            if warmup_complete:
                latencies.append(latency)
                result_item["latencyClass"] = "warm"
            else:
                warmup_complete = True
                result_item["latencyClass"] = "warmup"

            if resp.status_code == 200:
                body = resp.json()
                observed_syl = body.get("observed_syllables", [])
                timed_syllables = [
                    syllable for syllable in observed_syl
                    if isinstance(syllable.get("duration"), (int, float))
                    and syllable.get("duration") > 0
                ]
                result_item.update({
                    "syllable_count": body.get("syllable_count"),
                    "is_rateable": body.get("is_rateable"),
                    "total_duration": body.get("total_duration"),
                    "syllable_durations_available": bool(
                        observed_syl
                        and len(timed_syllables) == len(observed_syl)
                        and (body.get("capabilities") or {}).get("syllable_duration") is True
                    ),
                    "has_pitch": len(body.get("pitch", {}).get("values", [])) > 0,
                    "has_intensity": len(body.get("intensity", {}).get("values", [])) > 0,
                    "status": "evaluated",
                })

                # MAE if ground truth spans exist
                verified_spans = entry.get("verifiedSpans")
                if verified_spans:
                    result_item["boundary_mae"] = align_and_compute_mae(observed_syl, verified_spans)

                # Submit the same recording with a deliberately different target
                # hint. The recognizer observation must remain unchanged.
                probe_hint = 1 if expected_observed != 1 else target_syllable_count + 1
                with open(wav_path, "rb") as probe_audio_file:
                    probe_response = requests.post(
                        f"{args.base_url}/analyze/v3",
                        files={"audio": (wav_path.name, probe_audio_file, "audio/wav")},
                        data={
                            "reference_ipa": entry.get("referenceIpa", ""),
                            "expected_syllables": str(probe_hint),
                            "target_word": target_word,
                        },
                        timeout=20,
                    )
                probe_body = probe_response.json() if probe_response.status_code == 200 else {}
                forcing_passed = target_forcing_probe_passed(body, probe_body)
                target_forcing_results.append(forcing_passed)
                result_item["targetForcingProbe"] = {
                    "hint": probe_hint,
                    "primaryCount": body.get("syllable_count"),
                    "probeCount": probe_body.get("syllable_count"),
                    "passed": forcing_passed,
                }

                print(f"    Success: syllable_count={body.get('syllable_count')} rateable={body.get('is_rateable')} ({latency:.2f}s)")
            else:
                print(f"    [ERROR] API returned status {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"    [ERROR] Query failed: {e}")

        results.append(result_item)

    native_graph_results = probe_native_reference_graphs(
        args.base_url,
        {entry["targetWord"] for entry in manifest["entries"] if entry.get("category") == "clean"},
    ) if not args.dry_run else []
    active_mode = (health_info or {}).get("pronunciationV3Mode") == "active"
    target_forcing_verified = bool(target_forcing_results) and all(target_forcing_results) and active_mode

    # Evaluate gates
    gates, all_pass = evaluate_promotion_gates(
        results,
        model_manifest,
        latencies,
        native_graph_results=native_graph_results,
        target_forcing_verified=target_forcing_verified,
    )
    json_path, md_path = write_reports(output_dir, gates, all_pass, results, health_info)

    print("\nPromotion Gates Evaluation:")
    for key, gate in gates.items():
        status = "PASSED" if gate["passed"] else "FAILED"
        print(f"  - {gate['description']}: {gate['actual']} (Expected: {gate['expected']}) -> {status}")

    print(f"\nAudit completed: {'Success' if all_pass else 'Failure'}.")
    print(f"Summary report: {md_path}")
    print(f"Raw log data: {json_path}")

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
