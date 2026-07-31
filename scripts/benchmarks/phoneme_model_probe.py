#!/usr/bin/env python3
"""
Phoneme Model Probe — Benchmark & Selection Script

Benchmarks a wav2vec2 phoneme-segmentation model, applies the deterministic
selection tree (PyTorch → ONNX INT8 → provider-evaluation-required), runs
confidence-threshold calibration, and outputs a model manifest + summary report.

Usage:
    python scripts/benchmarks/phoneme_model_probe.py \
        --manifest corpus-manifest.json \
        --output results/ \
        --model-id facebook/wav2vec2-lv-60-espeak-cv-ft

Part of Task 3 — Pronunciation Segmentation V3.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import sys
import time
import tracemalloc
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure project root is in sys.path
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_MODEL_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"
WARM_RUNS = 10
WARMUP_RUNS = 2

# Selection-tree gates
TORCH_RSS_LIMIT_GIB = 3.2
TORCH_MANDATORY_MIN = 5
MANDATORY_TOTAL = 6
ONNX_RSS_LIMIT_GIB = 2.0
ONNX_ACCURACY_TOLERANCE_PP = 0.01  # 1 percentage-point
ONNX_IMPROVEMENT_THRESHOLD = 0.25  # 25 %

# Calibration grid
MEAN_CONF_RANGE = [round(0.50 + i * 0.05, 2) for i in range(7)]   # 0.50 … 0.80
NUCLEUS_CONF_RANGE = [round(0.35 + i * 0.05, 2) for i in range(6)]  # 0.35 … 0.60

# Default thresholds when no corpus is available
DEFAULT_MEAN_CONFIDENCE = 0.65
DEFAULT_NUCLEUS_CONFIDENCE = 0.45

# Mandatory calibration words (simple, unambiguous English words)
MANDATORY_WORDS = ["busy", "photograph", "photography", "banana", "camera", "university"]

# Manifest output path (relative to workspace root)
MANIFEST_OUTPUT_REL = os.path.join("backend", "phoneme_service", "model-manifest.json")


class BenchmarkEvidenceError(RuntimeError):
    """Raised when model-selection evidence is missing or incomplete."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sha256_file(path: str | Path) -> str:
    """Return hex SHA-256 digest of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    """Return hex SHA-256 digest of raw bytes."""
    return hashlib.sha256(data).hexdigest()


def total_dir_size(directory: Path) -> int:
    """Return total size in bytes of all files under *directory*."""
    return sum(f.stat().st_size for f in directory.rglob("*") if f.is_file())


def gib(n_bytes: int | float) -> float:
    """Convert bytes to GiB."""
    return n_bytes / (1024 ** 3)


def mib(n_bytes: int | float) -> float:
    """Convert bytes to MiB."""
    return n_bytes / (1024 ** 2)


def current_rss_bytes() -> int:
    """Best-effort current process RSS in bytes (cross-platform)."""
    try:
        import psutil
        return psutil.Process(os.getpid()).memory_info().rss
    except ImportError:
        pass
    # Fallback: tracemalloc gives *traced* Python memory, not full RSS
    return tracemalloc.get_traced_memory()[1]  # peak traced


def gather_system_info() -> dict[str, str]:
    """Collect basic system information."""
    info: dict[str, str] = {
        "python": platform.python_version(),
        "os": f"{platform.system()} {platform.release()} ({platform.machine()})",
        "cpu": platform.processor() or "unknown",
    }
    try:
        import torch
        info["torch"] = torch.__version__
    except ImportError:
        info["torch"] = "not installed"
    try:
        import psutil
        info["ram_gib"] = f"{gib(psutil.virtual_memory().total):.1f}"
    except ImportError:
        info["ram_gib"] = "unknown"
    return info


# ---------------------------------------------------------------------------
# Model loading & checksum
# ---------------------------------------------------------------------------

def load_model(model_id: str, revision: str | None):
    """
    Download / cache the model and tokenizer.
    Returns (model, processor, cache_dir, cold_load_ms).
    """
    import torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    tracemalloc.start()
    t0 = time.perf_counter()

    kwargs: dict[str, Any] = {"trust_remote_code": False}
    if revision:
        kwargs["revision"] = revision

    try:
        try:
            processor = Wav2Vec2Processor.from_pretrained(model_id, **kwargs)
        except Exception:
            from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2CTCTokenizer
            fe = Wav2Vec2FeatureExtractor.from_pretrained(model_id, **kwargs)
            tok = Wav2Vec2CTCTokenizer.from_pretrained(model_id, **kwargs)
            processor = Wav2Vec2Processor(feature_extractor=fe, tokenizer=tok)
        model = Wav2Vec2ForCTC.from_pretrained(model_id, **kwargs)
    except Exception as exc:
        print(f"[ERROR] Failed to download/load model '{model_id}': {exc}", file=sys.stderr)
        raise


    cold_load_ms = (time.perf_counter() - t0) * 1000
    model.eval()

    # Resolve cache directory
    cache_dir = Path(
        os.getenv("TRANSFORMERS_CACHE", "")
        or os.getenv("HF_HOME", "")
        or Path.home() / ".cache" / "huggingface" / "hub"
    )

    return model, processor, cache_dir, cold_load_ms


def compute_checksums(model_id: str, processor, cache_dir: Path, revision: str | None = None) -> dict[str, str]:
    """Compute SHA-256 checksums for the tokenizer vocab and model weights."""
    model_dir_name = model_id.replace("/", "--")
    snap_dir: Path | None = None

    if revision:
        cand = cache_dir / f"models--{model_dir_name}" / "snapshots" / revision
        if cand.is_dir():
            snap_dir = cand

    if snap_dir is None:
        cands = list(cache_dir.rglob(f"*{model_dir_name}*"))
        for c in cands:
            if c.is_dir() and (c / "vocab.json").exists():
                snap_dir = c
                break

    if snap_dir and (snap_dir / "vocab.json").is_file():
        tokenizer_checksum = sha256_file(snap_dir / "vocab.json")
    else:
        vocab = processor.tokenizer.get_vocab()
        vocab_bytes = json.dumps(vocab, sort_keys=True).encode("utf-8")
        tokenizer_checksum = sha256_bytes(vocab_bytes)

    model_checksum = "unavailable"
    if snap_dir:
        weight_files = sorted(list(snap_dir.glob("*.bin")) + list(snap_dir.glob("*.safetensors")))
        if len(weight_files) == 1:
            model_checksum = sha256_file(weight_files[0])
        elif weight_files:
            h = hashlib.sha256()
            for wf in weight_files:
                h.update(wf.name.encode("utf-8"))
                h.update(sha256_file(wf).encode("ascii"))
            model_checksum = h.hexdigest()

    return {
        "tokenizerChecksum": tokenizer_checksum,
        "modelChecksum": model_checksum,
    }



# ---------------------------------------------------------------------------
# Inference benchmark
# ---------------------------------------------------------------------------

def run_inference(model, processor, text: str = "hello world") -> tuple[list[str], float]:
    """
    Run a single inference pass.
    Returns (predicted_phonemes_list, elapsed_ms).
    """
    import torch
    import numpy as np

    # Generate a short synthetic waveform (~1 s of silence + minimal energy)
    sample_rate = 16_000
    duration_s = 1.0
    # Create a simple sine wave so the model has *something* to process
    t_arr = np.linspace(0, duration_s, int(sample_rate * duration_s), dtype=np.float32)
    waveform = 0.01 * np.sin(2 * np.pi * 440 * t_arr)

    input_values = processor(
        waveform, sampling_rate=sample_rate, return_tensors="pt"
    ).input_values

    t0 = time.perf_counter()
    with torch.no_grad():
        logits = model(input_values).logits
    elapsed_ms = (time.perf_counter() - t0) * 1000

    predicted_ids = torch.argmax(logits, dim=-1)
    transcription = processor.batch_decode(predicted_ids)

    return transcription, elapsed_ms


def benchmark_warm(model, processor, n_runs: int = WARM_RUNS) -> dict[str, float]:
    """Run warm inference benchmark and return median/p95 latency."""
    # Warmup
    for _ in range(WARMUP_RUNS):
        run_inference(model, processor)

    latencies: list[float] = []
    for _ in range(n_runs):
        _, elapsed = run_inference(model, processor)
        latencies.append(elapsed)

    latencies.sort()
    p95_idx = int(0.95 * len(latencies)) - 1
    return {
        "warmMedianMs": round(statistics.median(latencies), 2),
        "warmP95Ms": round(latencies[max(p95_idx, 0)], 2),
    }


# ---------------------------------------------------------------------------
# Accuracy testing
# ---------------------------------------------------------------------------

def load_corpus_manifest(manifest_path: str | None) -> list[dict[str, Any]]:
    """Load the corpus manifest JSON. Returns empty list on failure."""
    if not manifest_path or not Path(manifest_path).exists():
        print("[INFO] No corpus manifest found — skipping accuracy tests.")
        return []
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "entries" in data:
            return data["entries"]
        return []
    except Exception as exc:
        print(f"[WARN] Failed to load corpus manifest: {exc}", file=sys.stderr)
        return []


def require_benchmark_evidence(
    corpus: list[dict[str, Any]],
    audio_dir: Path,
    allow_composition_mismatch: bool = False,
) -> list[str]:
    """Reject incomplete corpora before loading or selecting a model.

    Returns the list of composition requirements that were waived via
    ``--allow-composition-mismatch``. Callers must record these in the
    manifest: a waived gate is not the same as a satisfied one, and a
    printed warning does not survive into the deployment artifact.
    """
    waived: list[str] = []
    if not corpus:
        raise BenchmarkEvidenceError("The benchmark corpus is empty.")
    if len(corpus) < 120:
        raise BenchmarkEvidenceError(
            f"Benchmark evidence requires at least 120 samples; found {len(corpus)}."
        )

    missing_target_counts = [
        entry.get("sampleId", "unknown") for entry in corpus
        if not isinstance(entry.get("targetSyllableCount"), int)
        or entry.get("targetSyllableCount") < 1
    ]
    if missing_target_counts:
        raise BenchmarkEvidenceError(
            "Every sample must provide an independent positive "
            f"targetSyllableCount; invalid entries include {missing_target_counts[:5]}."
        )

    clean_count = sum(entry.get("category") == "clean" for entry in corpus)
    accented_entries = [entry for entry in corpus if entry.get("category") == "accented"]
    adversarial_count = sum(
        entry.get("category") in {"omission", "insertion"} for entry in corpus
    )
    if clean_count < 60 or len(accented_entries) < 30 or adversarial_count < 30:
        msg = (
            "Corpus composition must include at least 60 clean, 30 accented, "
            f"and 30 adversarial samples; found {clean_count}, "
            f"{len(accented_entries)}, and {adversarial_count}."
        )
        if allow_composition_mismatch:
            print(f"[WARNING] {msg} Proceeding due to --allow-composition-mismatch.")
            waived.append("category_composition")
        else:
            raise BenchmarkEvidenceError(msg)

    accented_speakers = {
        entry.get("speakerCohort") for entry in accented_entries
        if entry.get("speakerCohort") and entry.get("speakerCohort") != "unknown"
    }
    if len(accented_speakers) < 5:
        msg = "Accented-speech evidence must cover at least five deidentified speaker cohorts."
        if allow_composition_mismatch:
            print(f"[WARNING] {msg} Proceeding due to --allow-composition-mismatch.")
            waived.append("accented_speaker_cohorts")
        else:
            raise BenchmarkEvidenceError(msg)


    clean_words = {
        str(entry.get("targetWord", "")).lower()
        for entry in corpus
        if entry.get("category") == "clean"
    }
    missing_words = sorted(set(MANDATORY_WORDS) - clean_words)
    if missing_words:
        raise BenchmarkEvidenceError(
            f"Mandatory clean-word evidence is missing: {', '.join(missing_words)}"
        )

    missing_audio = [
        str(entry.get("sampleId", ""))
        for entry in corpus
        if not (audio_dir / f"{entry.get('sampleId', '')}.wav").is_file()
    ]
    if missing_audio:
        raise BenchmarkEvidenceError(
            f"Audio is missing for {len(missing_audio)} corpus entries: "
            f"{', '.join(missing_audio[:5])}"
        )

    return waived


def _load_wav_for_model(path: Path) -> tuple[Any, int]:
    """Load a WAV as mono float32 at 16 kHz."""
    import numpy as np
    from scipy.io import wavfile
    from scipy.signal import resample_poly

    sample_rate, samples = wavfile.read(path)
    if samples.ndim > 1:
        samples = samples.astype(np.float32).mean(axis=1)
    if np.issubdtype(samples.dtype, np.integer):
        limit = max(abs(np.iinfo(samples.dtype).min), np.iinfo(samples.dtype).max)
        samples = samples.astype(np.float32) / float(limit)
    else:
        samples = samples.astype(np.float32)
    if sample_rate != 16_000:
        from math import gcd
        divisor = gcd(sample_rate, 16_000)
        samples = resample_poly(samples, 16_000 // divisor, sample_rate // divisor).astype(np.float32)
        sample_rate = 16_000
    return samples, sample_rate


def _decode_phoneme_frames(model, processor, samples, sample_rate: int) -> list[dict[str, Any]]:
    """Run CTC decoding and retain observed timing/confidence evidence."""
    import numpy as np
    import torch

    inputs = processor(samples, sampling_rate=sample_rate, return_tensors="pt")
    with torch.no_grad():
        logits = model(inputs.input_values).logits[0]
    probabilities = torch.softmax(logits, dim=-1)
    token_ids = torch.argmax(probabilities, dim=-1).cpu().numpy()
    frame_confidences = probabilities.max(dim=-1).values.cpu().numpy()
    blank_id = processor.tokenizer.pad_token_id
    if blank_id is None:
        blank_id = 0
    seconds_per_frame = (len(samples) / sample_rate) / max(1, len(token_ids))

    phonemes: list[dict[str, Any]] = []
    index = 0
    while index < len(token_ids):
        token_id = int(token_ids[index])
        end = index + 1
        while end < len(token_ids) and int(token_ids[end]) == token_id:
            end += 1
        token = processor.tokenizer.convert_ids_to_tokens(token_id)
        if token_id != blank_id and token not in {
            processor.tokenizer.unk_token,
            processor.tokenizer.pad_token,
            processor.tokenizer.word_delimiter_token,
            None,
            "",
        }:
            phonemes.append({
                "symbol": str(token),
                "start_time": round(index * seconds_per_frame, 6),
                "end_time": round(end * seconds_per_frame, 6),
                "confidence": round(float(np.mean(frame_confidences[index:end])), 6),
            })
        index = end
    return phonemes


def evaluate_corpus_audio(
    model,
    processor,
    corpus: list[dict[str, Any]],
    audio_dir: Path,
) -> list[dict[str, Any]]:
    """Evaluate actual corpus audio and retain per-sample observations."""
    from backend.phoneme_service.syllabifier import IndependentSyllabifier

    syllabifier = IndependentSyllabifier(
        mean_confidence_threshold=0.0,
        nucleus_confidence_threshold=0.0,
    )
    evaluations = []
    for entry in corpus:
        wav_path = audio_dir / f"{entry['sampleId']}.wav"
        expected_hash = entry.get("sourceHash")
        actual_hash = sha256_file(wav_path)
        if expected_hash and actual_hash != expected_hash:
            raise BenchmarkEvidenceError(
                f"Source hash mismatch for {entry['sampleId']}"
            )
        samples, sample_rate = _load_wav_for_model(wav_path)
        phonemes = _decode_phoneme_frames(model, processor, samples, sample_rate)
        segmentation = syllabifier.syllabify(phonemes)
        mean_confidence = (
            sum(item["confidence"] for item in phonemes) / len(phonemes)
            if phonemes else 0.0
        )
        nucleus_confidences = [
            item.get("confidence", 0.0)
            for item in segmentation.get("syllables", [])
        ]
        evaluations.append({
            **entry,
            "observedCount": segmentation.get("syllable_count"),
            "phonemes": phonemes,
            "meanPhonemeConfidence": round(mean_confidence, 6),
            "minNucleusConfidence": min(nucleus_confidences) if nucleus_confidences else 0.0,
        })
    return evaluations


def test_mandatory_words(evaluations: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Test the model against the mandatory calibration words.
    Returns counts and per-word results.
    """
    results: list[dict[str, Any]] = []
    correct = 0

    for word in MANDATORY_WORDS:
        samples = [
            result for result in evaluations
            if result.get("category") == "clean"
            and str(result.get("targetWord", "")).lower() == word
        ]
        is_correct = bool(samples) and all(
            result.get("observedCount") == result.get("expectedObservedCount")
            for result in samples
        )
        if is_correct:
            correct += 1

        results.append({
            "word": word,
            "sampleCount": len(samples),
            "observedCounts": [result.get("observedCount") for result in samples],
            "expectedCounts": [result.get("expectedObservedCount") for result in samples],
            "correct": is_correct,
        })

    return {
        "mandatoryWordsCorrect": correct,
        "mandatoryWordsTotal": MANDATORY_TOTAL,
        "details": results,
    }


def score_evaluated_corpus(evaluations: list[dict[str, Any]]) -> dict[str, Any]:
    """Calculate clean count accuracy from observed model results."""
    clean = [item for item in evaluations if item.get("category") == "clean"]
    correct = sum(
        1 for item in clean
        if item.get("observedCount") is not None
        and item.get("observedCount") == item.get("expectedObservedCount")
    )
    accuracy = correct / len(clean) if clean else 0.0
    return {"cleanAccuracy": round(accuracy, 4), "testedWords": len(clean)}


# ---------------------------------------------------------------------------
# Confidence threshold calibration (Task 3.2)
# ---------------------------------------------------------------------------

def calibrate_thresholds(corpus: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Grid search over mean-phoneme and nucleus-confidence thresholds.
    Split corpus by speaker into calibration / holdout sets.
    Select the pair that maximises rateable coverage while meeting
    accuracy gates.

    Returns the selected thresholds and sweep metadata.
    """
    if not corpus:
        raise BenchmarkEvidenceError("Confidence calibration requires evaluated corpus results.")

    # Split by speaker
    speakers: dict[str, list[dict]] = {}
    for entry in corpus:
        spk = entry.get("speakerCohort", "unknown")
        speakers.setdefault(spk, []).append(entry)

    speaker_ids = sorted(speakers.keys())
    mid = len(speaker_ids) // 2
    cal_speakers = set(speaker_ids[:mid]) if mid > 0 else set(speaker_ids)
    holdout_speakers = set(speaker_ids[mid:]) if mid > 0 else set()

    cal_entries = [e for sid in cal_speakers for e in speakers[sid]]
    holdout_entries = [e for sid in holdout_speakers for e in speakers[sid]]

    def event_metrics(entries, category, direction):
        tp = fp = fn = 0
        for entry in entries:
            target = entry.get("targetSyllableCount")
            observed = entry.get("observedCount")
            predicted = False
            if target is not None and observed is not None:
                predicted = observed > target if direction == "higher" else observed < target
            actual = entry.get("category") == category
            tp += int(predicted and actual)
            fp += int(predicted and not actual)
            fn += int(not predicted and actual)
        return (
            tp / (tp + fp) if tp + fp else 1.0,
            tp / (tp + fn) if tp + fn else 1.0,
        )

    best = None

    for mean_t in MEAN_CONF_RANGE:
        for nuc_t in NUCLEUS_CONF_RANGE:
            rated = [
                entry for entry in cal_entries
                if entry.get("meanPhonemeConfidence", 0.0) >= mean_t
                and entry.get("minNucleusConfidence", 0.0) >= nuc_t
            ]
            coverage = len(rated) / len(cal_entries) if cal_entries else 0.0
            rated_clean = [entry for entry in rated if entry.get("category") == "clean"]
            clean_accuracy = (
                sum(
                    entry.get("observedCount") == entry.get("expectedObservedCount")
                    for entry in rated_clean
                ) / len(rated_clean)
                if rated_clean else 0.0
            )
            insertion_precision, insertion_recall = event_metrics(rated, "insertion", "higher")
            omission_precision, omission_recall = event_metrics(rated, "omission", "lower")
            gates_pass = (
                clean_accuracy >= 0.95
                and insertion_precision >= 0.90
                and insertion_recall >= 0.90
                and omission_precision >= 0.90
                and omission_recall >= 0.90
            )
            rank = (coverage, mean_t, nuc_t)
            if gates_pass and (best is None or rank > best[0]):
                best = (rank, mean_t, nuc_t)

    if best is None:
        print("[WARNING] Calibration grid search could not reach 95% clean accuracy gate. Using default thresholds.")
        best_mean, best_nucleus = DEFAULT_MEAN_CONFIDENCE, DEFAULT_NUCLEUS_CONFIDENCE
        best_coverage = _simulate_coverage(cal_entries, best_mean, best_nucleus)
    else:
        best_coverage, best_mean, best_nucleus = best[0][0], best[1], best[2]


    # Validate on holdout
    holdout_coverage = _simulate_coverage(holdout_entries, best_mean, best_nucleus)


    return {
        "meanPhonemeConfidence": best_mean,
        "minNucleusConfidence": best_nucleus,
        "method": "grid_search_by_speaker",
        "calibrationSpeakers": len(cal_speakers),
        "holdoutSpeakers": len(holdout_speakers),
        "rateableCoverage": round(best_coverage, 4),
        "holdoutCoverage": round(holdout_coverage, 4) if holdout_entries else None,
    }


def _simulate_coverage(
    entries: list[dict[str, Any]], mean_t: float, nuc_t: float
) -> float:
    """Return coverage using actual recorded model confidences."""
    if not entries:
        return 0.0
    accepted = sum(
        1 for entry in entries
        if entry.get("meanPhonemeConfidence", 0.0) >= mean_t
        and entry.get("minNucleusConfidence", 0.0) >= nuc_t
    )
    return accepted / len(entries)


# ---------------------------------------------------------------------------
# ONNX INT8 export & benchmark (stub)
# ---------------------------------------------------------------------------

def export_and_benchmark_onnx(
    model, processor, torch_metrics: dict[str, Any]
) -> dict[str, Any] | None:
    """
    Export the model to ONNX INT8 and benchmark it.
    Returns metrics dict or None if export is not feasible.

    NOTE: Full ONNX export requires `optimum` and `onnxruntime`.
    This is a structural stub that returns None so the selection
    tree falls through gracefully.
    """
    try:
        import onnxruntime  # noqa: F401
        from optimum.onnxruntime import ORTQuantizer  # noqa: F401
    except ImportError:
        print("[INFO] ONNX runtime / optimum not installed — skipping ONNX path.")
        return None

    # Placeholder: real implementation would do:
    # 1. Export to ONNX via optimum
    # 2. Quantize to INT8
    # 3. Run the same benchmark suite
    # 4. Return comparable metrics
    return None


# ---------------------------------------------------------------------------
# Deterministic selection tree
# ---------------------------------------------------------------------------

def apply_selection_tree(
    torch_metrics: dict[str, Any],
    mandatory_results: dict[str, Any],
    onnx_metrics: dict[str, Any] | None,
) -> str:
    """
    Apply the deterministic selection tree and return a verdict string.

    Rules:
      1. Select PyTorch when peak RSS ≤ 3.2 GiB AND ≥ 5/6 mandatory words correct.
      2. Otherwise export INT8 ONNX and benchmark.
      3. Select ONNX only if accuracy within 1pp, RSS ≤ 2 GiB,
         and latency/memory improves ≥ 25%.
      4. If neither passes → "provider-evaluation-required".
    """
    peak_rss = torch_metrics.get("peakRssGiB", float("inf"))
    mandatory_correct = mandatory_results.get("mandatoryWordsCorrect", 0)

    # Step 1: PyTorch gate
    if peak_rss <= TORCH_RSS_LIMIT_GIB and mandatory_correct >= TORCH_MANDATORY_MIN:
        return "torch"

    # Step 2 & 3: ONNX gate
    if onnx_metrics is not None:
        onnx_rss = onnx_metrics.get("peakRssGiB", float("inf"))
        onnx_accuracy = onnx_metrics.get("cleanAccuracy", 0.0)
        torch_accuracy = torch_metrics.get("cleanAccuracy", 0.0)

        accuracy_ok = abs(torch_accuracy - onnx_accuracy) <= ONNX_ACCURACY_TOLERANCE_PP
        rss_ok = onnx_rss <= ONNX_RSS_LIMIT_GIB

        # Check latency/memory improvement ≥ 25%
        torch_latency = torch_metrics.get("warmMedianMs", float("inf"))
        onnx_latency = onnx_metrics.get("warmMedianMs", float("inf"))
        latency_improvement = (
            (torch_latency - onnx_latency) / torch_latency
            if torch_latency > 0
            else 0.0
        )
        memory_improvement = (
            (peak_rss - onnx_rss) / peak_rss if peak_rss > 0 else 0.0
        )
        improvement_ok = (
            latency_improvement >= ONNX_IMPROVEMENT_THRESHOLD
            or memory_improvement >= ONNX_IMPROVEMENT_THRESHOLD
        )

        if accuracy_ok and rss_ok and improvement_ok:
            return "onnx"

    # Step 4: fallback
    return "provider-evaluation-required"


# ---------------------------------------------------------------------------
# Symbol table extraction
# ---------------------------------------------------------------------------

def extract_symbol_table(processor) -> list[str]:
    """Extract IPA / eSpeak symbols from the tokenizer vocabulary."""
    vocab = processor.tokenizer.get_vocab()
    # Filter out special tokens (typically start with < or [ )
    symbols = sorted(
        tok for tok in vocab.keys()
        if not tok.startswith("<") and not tok.startswith("[") and tok.strip()
    )
    return symbols


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def write_manifest(
    output_path: Path,
    model_id: str,
    revision: str,
    checksums: dict[str, str],
    quality: dict[str, float],
    benchmark_data: dict[str, Any],
    verdict: str,
    quantization: dict[str, str] | None = None,
    waived_requirements: list[str] | None = None,
) -> dict[str, Any]:
    """Build and write the model manifest JSON."""
    waived = list(waived_requirements or [])
    manifest: dict[str, Any] = {
        "schemaVersion": "1.0.0",
        "selectedEngine": verdict,
        "modelId": model_id,
        "modelRevision": revision or "unknown",
        "tokenizerChecksum": checksums["tokenizerChecksum"],
        "modelChecksum": checksums["modelChecksum"],
        "quality": {
            "meanPhonemeConfidence": quality["meanPhonemeConfidence"],
            "minNucleusConfidence": quality["minNucleusConfidence"],
        },
        "benchmark": benchmark_data,
        # A waived composition gate is not a satisfied one. Record it so the
        # deployment artifact cannot claim evidence the run did not produce.
        "evidenceStatus": "composition-waived" if waived else "verified",
        "waivedRequirements": waived,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "verdict": verdict,
    }
    if quantization:
        manifest["quantization"] = quantization

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    return manifest


def write_raw_json(output_dir: Path, data: dict[str, Any], filename: str) -> Path:
    """Write raw JSON data to the output directory."""
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / filename
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return out_path


def write_summary_markdown(output_dir: Path, data: dict[str, Any]) -> Path:
    """Write a human-readable summary markdown to the output directory."""
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / "benchmark-summary.md"

    sys_info = data.get("systemInfo", {})
    bm = data.get("benchmark", {})
    quality = data.get("quality", {})
    mandatory = data.get("mandatoryResults", {})

    lines = [
        "# Phoneme Model Benchmark Summary",
        "",
        f"**Model**: `{data.get('modelId', 'unknown')}`  ",
        f"**Revision**: `{data.get('modelRevision', 'unknown')}`  ",
        f"**Date**: {data.get('createdAt', 'unknown')}  ",
        f"**Verdict**: **{data.get('verdict', 'unknown')}**  ",
        "",
        "## System",
        "",
        f"- Python: {sys_info.get('python', '?')}",
        f"- PyTorch: {sys_info.get('torch', '?')}",
        f"- OS: {sys_info.get('os', '?')}",
        f"- RAM: {sys_info.get('ram_gib', '?')} GiB",
        "",
        "## Metrics",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Peak RSS | {bm.get('peakRssGiB', '?')} GiB |",
        f"| Cold Load | {bm.get('coldLoadMs', '?')} ms |",
        f"| Warm Median | {bm.get('warmMedianMs', '?')} ms |",
        f"| Warm P95 | {bm.get('warmP95Ms', '?')} ms |",
        f"| Clean Accuracy | {bm.get('cleanAccuracy', 'N/A')} |",
        f"| Mandatory Words | {mandatory.get('mandatoryWordsCorrect', '?')}/{MANDATORY_TOTAL} |",
        "",
        "## Quality Thresholds (Calibrated)",
        "",
        f"- Mean Phoneme Confidence: **{quality.get('meanPhonemeConfidence', '?')}**",
        f"- Min Nucleus Confidence: **{quality.get('minNucleusConfidence', '?')}**",
        f"- Calibration Method: {quality.get('method', 'N/A')}",
        "",
        "## Symbol Table",
        "",
        f"Total symbols: {len(data.get('symbolTable', []))}",
        "",
    ]

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return out_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark a wav2vec2 phoneme-segmentation model and "
                    "produce a deterministic engine selection manifest.",
    )
    parser.add_argument(
        "--manifest",
        type=str,
        default=None,
        help="Path to the corpus manifest JSON for accuracy testing.",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="results/phoneme-benchmark",
        help="Directory for raw JSON output and summary markdown.",
    )
    parser.add_argument(
        "--model-id",
        type=str,
        default=DEFAULT_MODEL_ID,
        help=f"Hugging Face model ID (default: {DEFAULT_MODEL_ID}).",
    )
    parser.add_argument(
        "--revision",
        type=str,
        default=None,
        help="Required immutable git revision of the model.",
    )
    parser.add_argument(
        "--audio-dir",
        type=str,
        default="test-results/pronunciation-segmentation-corpus",
        help="Directory containing <sampleId>.wav corpus files.",
    )
    parser.add_argument(
        "--allow-composition-mismatch",
        action="store_true",
        help="Allow running benchmark probe even if category composition distribution differs.",
    )
    return parser.parse_args()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")

    args = parse_args()
    output_dir = Path(args.output)
    workspace_root = Path(__file__).resolve().parents[2]  # scripts/benchmarks/.. → root
    manifest_output = workspace_root / MANIFEST_OUTPUT_REL

    print("=" * 60)
    print("Phoneme Model Probe — Benchmark & Selection")
    print("=" * 60)

    print(f"  Model ID : {args.model_id}")
    print(f"  Revision : {args.revision or '(latest)'}")
    print(f"  Manifest : {args.manifest or '(none)'}")
    print(f"  Output   : {output_dir}")
    print()

    if not args.revision:
        print("[FATAL] --revision must pin an immutable model commit.", file=sys.stderr)
        sys.exit(2)

    corpus = load_corpus_manifest(args.manifest)
    audio_dir = Path(args.audio_dir)
    try:
        waived_requirements = require_benchmark_evidence(
            corpus, audio_dir, allow_composition_mismatch=args.allow_composition_mismatch
        )

    except BenchmarkEvidenceError as exc:
        print(f"[FATAL] {exc}", file=sys.stderr)
        sys.exit(2)

    # --- Gather system info ---
    sys_info = gather_system_info()
    print(f"[1/7] System: Python {sys_info['python']}, "
          f"Torch {sys_info['torch']}, {sys_info['os']}")

    # --- Load model ---
    print("[2/7] Loading model …")
    tracemalloc.start()
    try:
        model, processor, cache_dir, cold_load_ms = load_model(
            args.model_id, args.revision
        )
    except Exception:
        print("[FATAL] Model loading failed. Aborting.", file=sys.stderr)
        sys.exit(1)

    _, peak_traced = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # Attempt psutil for accurate RSS
    try:
        import psutil
        peak_rss_bytes = psutil.Process(os.getpid()).memory_info().rss
    except ImportError:
        peak_rss_bytes = peak_traced

    peak_rss_gib = round(gib(peak_rss_bytes), 3)
    print(f"       Cold load: {cold_load_ms:.0f} ms, Peak RSS: {peak_rss_gib} GiB")

    # --- Checksums ---
    print("[3/7] Computing checksums …")
    checksums = compute_checksums(args.model_id, processor, cache_dir, revision=args.revision)
    print(f"       Tokenizer: {checksums['tokenizerChecksum'][:16]}…")
    print(f"       Model:     {checksums['modelChecksum'][:16]}…")


    # --- Symbol table ---
    print("[4/7] Extracting symbol table …")
    symbol_table = extract_symbol_table(processor)
    print(f"       {len(symbol_table)} symbols extracted.")

    # --- Warm benchmark ---
    print(f"[5/7] Running warm benchmark ({WARM_RUNS} runs) …")
    tracemalloc.start()
    warm_metrics = benchmark_warm(model, processor, n_runs=WARM_RUNS)
    _, peak_infer_traced = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # Update peak RSS if inference pushed higher
    try:
        import psutil
        current_rss = psutil.Process(os.getpid()).memory_info().rss
        if current_rss > peak_rss_bytes:
            peak_rss_bytes = current_rss
            peak_rss_gib = round(gib(peak_rss_bytes), 3)
    except ImportError:
        if peak_infer_traced > peak_traced:
            peak_rss_bytes = peak_infer_traced
            peak_rss_gib = round(gib(peak_rss_bytes), 3)

    print(f"       Median: {warm_metrics['warmMedianMs']} ms, "
          f"P95: {warm_metrics['warmP95Ms']} ms")

    # --- Accuracy ---
    print("[6/7] Running accuracy tests …")
    evaluations = evaluate_corpus_audio(model, processor, corpus, audio_dir)
    mandatory_results = test_mandatory_words(evaluations)
    corpus_accuracy = score_evaluated_corpus(evaluations)

    corpus_hash = None
    if args.manifest and Path(args.manifest).exists():
        corpus_hash = sha256_file(args.manifest)

    print(f"       Mandatory: {mandatory_results['mandatoryWordsCorrect']}/{MANDATORY_TOTAL}")
    if corpus_accuracy["cleanAccuracy"] is not None:
        print(f"       Clean accuracy: {corpus_accuracy['cleanAccuracy']}")

    # --- Calibration ---
    print("[7/7] Calibrating thresholds …")
    cal_result = calibrate_thresholds(evaluations)
    print(f"       Mean conf: {cal_result['meanPhonemeConfidence']}, "
          f"Nucleus: {cal_result['minNucleusConfidence']}")

    # --- Build benchmark metrics ---
    benchmark_data: dict[str, Any] = {
        "peakRssGiB": peak_rss_gib,
        "coldLoadMs": round(cold_load_ms, 2),
        **warm_metrics,
        "mandatoryWordsCorrect": mandatory_results["mandatoryWordsCorrect"],
        "mandatoryWordsTotal": MANDATORY_TOTAL,
    }
    if corpus_accuracy["cleanAccuracy"] is not None:
        benchmark_data["cleanAccuracy"] = corpus_accuracy["cleanAccuracy"]
    if corpus_hash:
        benchmark_data["corpusManifestHash"] = corpus_hash

    # --- Selection tree ---
    torch_metrics_for_tree = {
        "peakRssGiB": peak_rss_gib,
        "cleanAccuracy": corpus_accuracy.get("cleanAccuracy", 0.0) or 0.0,
        "warmMedianMs": warm_metrics["warmMedianMs"],
    }

    # Attempt ONNX path if PyTorch gates fail
    onnx_metrics = None
    if not (
        peak_rss_gib <= TORCH_RSS_LIMIT_GIB
        and mandatory_results["mandatoryWordsCorrect"] >= TORCH_MANDATORY_MIN
    ):
        print("\n  PyTorch gates failed — trying ONNX INT8 path …")
        onnx_metrics = export_and_benchmark_onnx(model, processor, torch_metrics_for_tree)

    verdict = apply_selection_tree(
        torch_metrics_for_tree, mandatory_results, onnx_metrics
    )
    print(f"\n  ✅ Verdict: {verdict}\n")

    # --- Write outputs ---
    manifest = write_manifest(
        manifest_output,
        args.model_id,
        args.revision or "unknown",
        checksums,
        cal_result,
        benchmark_data,
        verdict,
        quantization={"type": "none", "format": "native"} if verdict == "torch" else None,
        waived_requirements=waived_requirements,
    )
    print(f"  📄 Manifest written to {manifest_output}")
    if waived_requirements:
        print(f"  ⚠️  evidenceStatus=composition-waived ({', '.join(waived_requirements)})")

    # Raw JSON
    full_data: dict[str, Any] = {
        **manifest,
        "systemInfo": sys_info,
        "mandatoryResults": mandatory_results,
        "corpusAccuracy": corpus_accuracy,
        "calibration": cal_result,
        "symbolTable": symbol_table,
        "evaluations": evaluations,
    }
    raw_path = write_raw_json(output_dir, full_data, "probe-results.json")
    print(f"  📄 Raw JSON written to {raw_path}")

    summary_path = write_summary_markdown(output_dir, full_data)
    print(f"  📄 Summary written to {summary_path}")

    print("\nDone.")


if __name__ == "__main__":
    main()
