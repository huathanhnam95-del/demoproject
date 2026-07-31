#!/usr/bin/env python3
"""Build the immutable, adult-only pronunciation calibration dataset.

The builder is deliberately conservative: it records exclusions instead of
silently dropping rows, keeps public audio outside git, and never opens the
official test speakers for model fitting.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.request import urlopen, Request

SPEECHOCEAN_URL = "https://openslr.trmal.net/resources/101/speechocean762.tar.gz"
LICENSE = "CC BY 4.0"
SEED = 20260730
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VI_MANIFEST = ROOT / "tests" / "fixtures" / "pronunciation-segmentation" / "manifest.json"
DEFAULT_CMU_DICTIONARY = ROOT / "public" / "cmudict.json"
DEFAULT_KOKORO_AUDIO = ROOT / "test-results" / "pronunciation-kokoro-benchmark" / "audio"
MANDATORY_WORDS = {"busy", "photograph", "photography", "banana", "camera", "university"}


def validate_score_scale(values: Iterable[float]) -> None:
    values = list(values)
    if not values or any(value < 0 or value > 10 for value in values):
        raise ValueError("SpeechOcean scores must be on the documented 0-10 scale")


def validate_public_stress_scale(values: Iterable[float]) -> None:
    values = [float(value) for value in values]
    if not values or any(value not in {5.0, 10.0} for value in values):
        raise ValueError("SpeechOcean word-stress scores must use the documented {5, 10} scale")


def classify_stress_consensus(scores: Iterable[float]) -> str | None:
    scores = list(scores)
    validate_score_scale(scores)
    if len(scores) != 5:
        raise ValueError("expected five expert scores")
    if sum(score >= 8 for score in scores) >= 4:
        return "correct"
    if sum(score <= 6 for score in scores) >= 4:
        return "incorrect"
    return None


def classify_count_consensus(counts: Iterable[int]) -> int | None:
    counts = [int(value) for value in counts]
    if len(counts) != 5:
        raise ValueError("expected five expert count labels")
    for candidate in sorted(set(counts)):
        if sum(value == candidate for value in counts) >= 4:
            return candidate
    return None


def evaluate_eligibility(row: dict[str, Any], lexical_holdout: set[str]) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    age_group = str(row.get("age_group", row.get("age", "adult"))).lower()
    if age_group in {"child", "children", "minor"} or row.get("is_child") is True:
        reasons.append("child_speaker")
    stress_scores = row.get("stress_scores") or row.get("stress")
    if stress_scores:
        try:
            stress_label = classify_stress_consensus(stress_scores)
        except ValueError as exc:
            reasons.append(f"invalid_stress_scores:{exc}")
        else:
            if stress_label is None:
                reasons.append("stress_no_four_rater_agreement")
            if int(row.get("syllable_count", row.get("expected_syllable_count", 1))) < 2:
                reasons.append("monosyllable_for_stress")
        accuracy = row.get("word_accuracy_scores") or row.get("accuracy_scores")
        if accuracy:
            validate_score_scale(accuracy)
            ordered = sorted(float(value) for value in accuracy)
            median = ordered[len(ordered) // 2]
            if median < 8:
                reasons.append("median_word_accuracy_below_8")
    counts = row.get("count_scores") or row.get("observed_counts")
    if counts and classify_count_consensus(counts) is None:
        reasons.append("count_no_four_rater_agreement")
    return not reasons, reasons


def derive_labels(row: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Derive count and stress labels independently from five-rater evidence."""
    reasons: list[str] = []
    labels: dict[str, Any] = {
        "observed_count": None,
        "label_count": None,
        "stress_label": None,
        "label_stress": None,
    }
    age_group = str(row.get("age_group", row.get("age", "adult"))).lower()
    if age_group in {"child", "children", "minor"} or row.get("is_child") is True:
        return labels, ["child_speaker"]

    expected_count = int(row.get("syllable_count", row.get("expected_syllable_count", 0)) or 0)
    counts = row.get("count_scores") or row.get("observed_counts")
    if counts:
        observed_count = classify_count_consensus(counts)
        if observed_count is None:
            reasons.append("count_no_four_rater_agreement")
        else:
            labels["observed_count"] = observed_count
            labels["label_count"] = int(observed_count == expected_count)
    else:
        reasons.append("missing_count_labels")

    stress_scores = row.get("stress_scores") or row.get("stress")
    if expected_count < 2:
        reasons.append("monosyllable_for_stress")
    elif not isinstance(row.get("expected_primary_stress"), int):
        reasons.append("missing_dictionary_primary_stress")
    elif int(row.get("dictionary_syllable_count", expected_count)) != expected_count:
        reasons.append("dictionary_count_conflict")
    elif not stress_scores:
        reasons.append("missing_stress_labels")
    else:
        try:
            stress_label = classify_stress_consensus(stress_scores)
        except ValueError as exc:
            reasons.append(f"invalid_stress_scores:{exc}")
        else:
            if stress_label is None:
                reasons.append("stress_no_four_rater_agreement")
            else:
                accuracy = row.get("word_accuracy_scores") or row.get("accuracy_scores")
                if not accuracy:
                    reasons.append("missing_word_accuracy")
                else:
                    validate_score_scale(accuracy)
                    ordered = sorted(float(value) for value in accuracy)
                    if ordered[len(ordered) // 2] < 8:
                        reasons.append("median_word_accuracy_below_8")
                    else:
                        labels["stress_label"] = stress_label
                        labels["label_stress"] = int(stress_label == "correct")
    return labels, reasons


def read_vietnamese_manifest(path: str | Path = DEFAULT_VI_MANIFEST) -> list[dict[str, Any]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    entries = payload.get("entries", payload.get("samples", payload if isinstance(payload, list) else []))
    if not isinstance(entries, list):
        raise ValueError("Vietnamese manifest must contain an entries/samples array")
    return [dict(entry) for entry in entries]


def discover_lexical_holdout(kokoro_audio_dir: str | Path = DEFAULT_KOKORO_AUDIO) -> set[str]:
    words = set(MANDATORY_WORDS)
    for path in Path(kokoro_audio_dir).glob("kokoro-*-*.wav"):
        parts = path.stem.split("-", 2)
        if len(parts) == 3 and parts[2]:
            words.add(parts[2].lower())
    return words


def discover_label_scale(rows: Iterable[dict[str, Any]]) -> tuple[float, float]:
    values: list[float] = []
    for row in rows:
        for key in ("stress_scores", "accuracy_scores", "word_accuracy_scores", "scores"):
            candidate = row.get(key)
            if isinstance(candidate, list):
                values.extend(float(value) for value in candidate if isinstance(value, (int, float)))
    if not values:
        raise ValueError("no labelled scores discovered")
    validate_score_scale(values)
    return min(values), max(values)


def split_speakers(rows: list[dict[str, Any]], seed: int = SEED) -> dict[str, list[dict[str, Any]]]:
    """Deterministically split by speaker while keeping derivative groups together."""
    official_test = [row for row in rows if row.get("official_split") == "test"]
    official_train = [row for row in rows if row.get("official_split") != "test"]
    speakers = sorted({str(row.get("speaker_id", row.get("speaker", "unknown"))) for row in official_train})
    # A stable hash avoids dependence on Python's randomized hash seed.
    import hashlib as _hashlib
    ordered = sorted(speakers, key=lambda speaker: _hashlib.sha256(f"{seed}:{speaker}".encode()).hexdigest())
    calibration_count = max(1, round(len(ordered) * 0.2)) if ordered else 0
    calibration_speakers = set(ordered[:calibration_count])
    rare_stress_speakers = {
        str(row.get("speaker_id", row.get("speaker", "unknown")))
        for row in official_train
        if row.get("label_stress") == 0
    }
    if len(rare_stress_speakers) >= 2 and calibration_count:
        target_rare = min(2, len(rare_stress_speakers) - 1, calibration_count)
        rare_order = [speaker for speaker in ordered if speaker in rare_stress_speakers]
        while len(calibration_speakers & rare_stress_speakers) < target_rare:
            candidate = next(speaker for speaker in rare_order if speaker not in calibration_speakers)
            donor = next(speaker for speaker in reversed(ordered[:calibration_count]) if speaker in calibration_speakers and speaker not in rare_stress_speakers)
            calibration_speakers.remove(donor)
            calibration_speakers.add(candidate)
        if rare_stress_speakers.issubset(calibration_speakers):
            rare_to_train = next(speaker for speaker in reversed(rare_order) if speaker in calibration_speakers)
            nonrare_to_calibration = next(speaker for speaker in ordered if speaker not in calibration_speakers and speaker not in rare_stress_speakers)
            calibration_speakers.remove(rare_to_train)
            calibration_speakers.add(nonrare_to_calibration)
    return {
        "test": official_test,
        "calibration": [row for row in official_train if str(row.get("speaker_id", row.get("speaker", "unknown"))) in calibration_speakers],
        "train": [row for row in official_train if str(row.get("speaker_id", row.get("speaker", "unknown"))) not in calibration_speakers],
        "train_calibration": official_train,
    }


ARPABET_VOWELS = {
    "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER",
    "EY", "IH", "IY", "OW", "OY", "UH", "UW",
}


def observed_vowel_count(phone_annotation: str) -> int:
    """Count produced vowel nuclei in one expert's annotated phone string."""
    count = 0
    for raw_token in str(phone_annotation or "").split():
        if raw_token.startswith("(") and raw_token.endswith(")"):
            continue
        token = raw_token.strip("[]{}()")
        base = token[:-1] if token[-1:].isdigit() else token
        if base.upper() in ARPABET_VOWELS:
            count += 1
    return count


def _read_kaldi_map(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        parts = line.split(maxsplit=1)
        if len(parts) == 2:
            result[parts[0]] = parts[1].strip()
    return result


def _dictionary_stress_contract(word: str, cmu: dict[str, Any]) -> tuple[int | None, int | None, str | None]:
    pronunciation = cmu.get(str(word).lower())
    if not isinstance(pronunciation, str) or not pronunciation.strip():
        return None, None, None
    vowel_tokens = [
        token
        for token in pronunciation.split()
        if (token[:-1] if token[-1:].isdigit() else token) in ARPABET_VOWELS
    ]
    primary = [index for index, token in enumerate(vowel_tokens) if token.endswith("1")]
    return (primary[0] if len(primary) == 1 else None), len(vowel_tokens), pronunciation


def parse_public_corpus(
    corpus_dir: str | Path,
    cmu_path: str | Path = DEFAULT_CMU_DICTIONARY,
) -> list[dict[str, Any]]:
    """Parse adult SpeechOcean word rows from raw five-rater annotations."""
    corpus_dir = Path(corpus_dir)
    detail_candidates = list(corpus_dir.rglob("scores-detail.json"))
    if not detail_candidates:
        return []
    detail_path = detail_candidates[0]
    payload = json.loads(detail_path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError("scores-detail.json must contain an utterance object")
    cmu = json.loads(Path(cmu_path).read_text(encoding="utf-8"))

    utterance_meta: dict[str, dict[str, str]] = {}
    for official_split in ("train", "test"):
        split_dirs = [path for path in corpus_dir.rglob(official_split) if path.is_dir()]
        if not split_dirs:
            continue
        split_dir = split_dirs[0]
        utt2spk = _read_kaldi_map(split_dir / "utt2spk")
        spk2age = _read_kaldi_map(split_dir / "spk2age")
        spk2gender = _read_kaldi_map(split_dir / "spk2gender")
        wav_scp = _read_kaldi_map(split_dir / "wav.scp")
        for utterance_id, speaker_id in utt2spk.items():
            raw_audio_path = wav_scp.get(utterance_id, "")
            audio_path = Path(raw_audio_path)
            if raw_audio_path and not audio_path.is_absolute():
                audio_path = split_dir.parent / audio_path
            utterance_meta[utterance_id] = {
                "speaker_id": speaker_id,
                "age": spk2age.get(speaker_id, ""),
                "gender": spk2gender.get(speaker_id, ""),
                "official_split": official_split,
                "audio_path": str(audio_path) if raw_audio_path else "",
            }

    rows: list[dict[str, Any]] = []
    for utterance_id, utterance in sorted(payload.items()):
        if not isinstance(utterance, dict):
            continue
        meta = utterance_meta.get(str(utterance_id))
        if not meta:
            continue
        try:
            age = int(float(meta["age"]))
        except (TypeError, ValueError):
            continue
        if age < 18:
            continue
        word_items = utterance.get("words") or []
        utterance_reference_phones = " ".join(
            str(word_data.get("ref-phones") or "").strip()
            for word_data in word_items
            if isinstance(word_data, dict)
        ).strip()
        phone_cursor = 0
        for word_index, word_data in enumerate(word_items):
            if not isinstance(word_data, dict):
                continue
            stress_scores = word_data.get("stress")
            accuracy_scores = word_data.get("accuracy")
            phone_scores = word_data.get("phones")
            if not all(isinstance(values, list) and len(values) == 5 for values in (stress_scores, accuracy_scores, phone_scores)):
                continue
            validate_score_scale(stress_scores)
            validate_public_stress_scale(stress_scores)
            validate_score_scale(accuracy_scores)
            reference_phones = str(word_data.get("ref-phones") or "")
            word = str(word_data.get("text") or "").strip().lower()
            expected_primary_stress, dictionary_syllable_count, dictionary_reference_phones = _dictionary_stress_contract(word, cmu)
            reference_phone_count = len(reference_phones.split())
            word_phone_range = [phone_cursor, phone_cursor + reference_phone_count]
            phone_cursor += reference_phone_count
            rows.append({
                "id": f"{utterance_id}:{word_index}",
                "source_recording_id": str(utterance_id),
                "word_index": word_index,
                "word": word,
                "speaker_id": meta["speaker_id"],
                "age": age,
                "age_group": "adult",
                "gender": meta["gender"],
                "official_split": meta["official_split"],
                "audio_path": meta["audio_path"],
                "utterance_text": str(utterance.get("text") or ""),
                "utterance_reference_phones": utterance_reference_phones,
                "word_phone_range": word_phone_range,
                "reference_phones": reference_phones,
                "syllable_count": observed_vowel_count(reference_phones),
                "expected_primary_stress": expected_primary_stress,
                "dictionary_syllable_count": dictionary_syllable_count,
                "dictionary_reference_phones": dictionary_reference_phones,
                "stress_scores": [float(value) for value in stress_scores],
                "word_accuracy_scores": [float(value) for value in accuracy_scores],
                "count_scores": [observed_vowel_count(value) for value in phone_scores],
                "source_file": str(detail_path),
            })
    return rows


def build_provenance(url: str, archive_sha256: str, extracted_at: str | None = None) -> dict[str, str]:
    return {
        "license": LICENSE,
        "url": url,
        "archive_sha256": archive_sha256,
        "extracted_at": extracted_at or datetime.now(timezone.utc).isoformat(),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download_and_extract(destination: Path, url: str = SPEECHOCEAN_URL) -> dict[str, str]:
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / "speechocean762.tar.gz"
    if not archive.exists():
        request = Request(url, headers={"User-Agent": "pronunciation-calibration-builder/1"})
        with urlopen(request, timeout=120) as response, archive.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    archive_hash = sha256_file(archive)
    marker = destination / ".extracted"
    if not marker.exists():
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(destination, filter="data")
        marker.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return build_provenance(url, archive_hash, marker.read_text(encoding="utf-8"))


def existing_provenance(destination: Path, url: str = SPEECHOCEAN_URL) -> dict[str, str] | None:
    archive = destination / "speechocean762.tar.gz"
    marker = destination / ".extracted"
    if not archive.exists() or not marker.exists():
        return None
    return build_provenance(url, sha256_file(archive), marker.read_text(encoding="utf-8"))


def build_dataset(rows: list[dict[str, Any]], lexical_holdout: set[str] | None = None) -> dict[str, Any]:
    lexical_holdout = {word.lower() for word in (lexical_holdout or set())}
    records: list[dict[str, Any]] = []
    exclusions: list[dict[str, Any]] = []
    funnel: Counter[str] = Counter()
    for index, row in enumerate(rows):
        labels, reasons = derive_labels(row)
        item = dict(row)
        item["source_row"] = index
        item.update(labels)
        item["label_exclusions"] = reasons
        if labels["label_count"] is not None or labels["label_stress"] is not None:
            records.append(item)
        else:
            exclusions.append({"source_row": index, "sample_id": row.get("id", row.get("sample_id")), "reasons": reasons})
            funnel.update(reasons)

    split_rows = split_speakers(records)
    split_by_identity: dict[int, str] = {}
    for split_name in ("train", "calibration", "test"):
        split_by_identity.update({id(row): split_name for row in split_rows[split_name]})
    for item in records:
        word = str(item.get("word", item.get("target_word", ""))).lower()
        is_holdout = word in lexical_holdout
        item["lexical_holdout"] = is_holdout
        assigned = split_by_identity.get(id(item), "train")
        item["split"] = "lexical_holdout" if is_holdout and assigned != "test" else assigned
    holdout_source_ids = {
        str(item.get("source_recording_id", item.get("id", item["source_row"])))
        for item in records
        if item["split"] == "lexical_holdout"
    }
    for item in records:
        source_id = str(item.get("source_recording_id", item.get("id", item["source_row"])))
        item["holdout_group"] = source_id in holdout_source_ids
        if item["holdout_group"] and item["split"] != "test":
            item["split"] = "lexical_holdout"

    return {
        "schema_version": "pronunciation-calibration-v1",
        "seed": SEED,
        "records": records,
        "exclusions": exclusions,
        "exclusion_funnel": dict(sorted(funnel.items())),
        "coverage_denominator": len(rows),
        "class_support": {
            "eligible": len(records),
            "excluded": len(exclusions),
            "count_correct": sum(item["label_count"] == 1 for item in records),
            "count_incorrect": sum(item["label_count"] == 0 for item in records),
            "stress_correct": sum(item["label_stress"] == 1 for item in records),
            "stress_incorrect": sum(item["label_stress"] == 0 for item in records),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "test-results" / "pronunciation-calibration" / "dataset.json")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_VI_MANIFEST)
    parser.add_argument("--public-corpus-dir", type=Path, default=ROOT / "test-results" / "public-corpora" / "speechocean762")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--lexical-holdout", action="append", default=[])
    args = parser.parse_args()

    vietnamese_rows = read_vietnamese_manifest(args.manifest)
    holdout = discover_lexical_holdout()
    holdout.update(word.strip().lower() for word in args.lexical_holdout if word.strip())
    provenance = None
    if not args.skip_download and not args.validate_only:
        provenance = download_and_extract(args.public_corpus_dir)
    elif args.public_corpus_dir.exists():
        provenance = existing_provenance(args.public_corpus_dir)
    rows = parse_public_corpus(args.public_corpus_dir) if args.public_corpus_dir.exists() else []
    if not rows and not args.validate_only:
        raise SystemExit("SpeechOcean corpus was not parsed; refusing to substitute Vietnamese external evidence for calibration data")
    dataset = build_dataset(rows, lexical_holdout=holdout)
    dataset["lexical_holdout_words"] = sorted(holdout)
    dataset["vietnamese_external"] = {
        "manifest_path": str(args.manifest),
        "manifest_sha256": sha256_file(args.manifest),
        "discovered_count": len(vietnamese_rows),
        "status_counts": dict(sorted(Counter(str(row.get("category", row.get("status", "unknown"))) for row in vietnamese_rows).items())),
        "role": "external_evidence_only",
    }
    dataset["provenance"] = provenance
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "eligible": len(dataset["records"]), "excluded": len(dataset["exclusions"]), "provenance": provenance}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
