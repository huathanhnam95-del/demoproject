"""Focused tests for the offline segmentation spectrogram experiment."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import wave
from copy import deepcopy
from pathlib import Path

import numpy as np


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "audit" / "segmentation_spectrogram_reanalysis.py"
SPEC = importlib.util.spec_from_file_location("segmentation_spectrogram_reanalysis", SCRIPT_PATH)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class ManifestTests(unittest.TestCase):
    def test_checked_in_manifest_has_fixed_balanced_split(self):
        root = Path(__file__).resolve().parents[2]
        path = root / "scripts" / "data" / "segmentation-study-v1.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        ipa_entries = json.loads((root / "public" / "ipa-dict.json").read_text(encoding="utf-8"))
        oxford_entries = json.loads((root / "public" / "oxford-american-ipa.json").read_text(encoding="utf-8"))["entries"]
        entries = manifest["entries"]
        self.assertEqual(manifest["studyId"], "segmentation-study-v1")
        self.assertEqual(len(entries), 100)
        self.assertEqual({count: sum(item["targetSyllableCount"] == count for item in entries) for count in range(2, 6)}, {2: 25, 3: 25, 4: 25, 5: 25})
        self.assertEqual(sum(item["split"] == "development" for item in entries), 70)
        self.assertEqual(sum(item["split"] == "holdout" for item in entries), 30)
        self.assertEqual([item["taskId"] for item in entries], [f"segmentation-study-v1-{index:04d}" for index in range(1, 101)])
        for item in entries:
            self.assertEqual(len(item["referenceSyllableIpa"]), item["targetSyllableCount"])
            self.assertEqual(len(item["transitionTypes"]), item["targetSyllableCount"] - 1)
            self.assertIn(item["ipaSource"], {"ipa-dict", "oxford-american-ipa"})
            source = oxford_entries if item["ipaSource"] == "oxford-american-ipa" else ipa_entries
            variants = source[item["targetWord"]]
            self.assertEqual(len(variants), 1, f"{item['targetWord']} must have one unambiguous source pronunciation")

    def test_manifest_builder_is_deterministic(self):
        root = Path(__file__).resolve().parents[2]
        first = module.build_study_manifest(root / "public" / "The_Oxford_5000.csv", root / "public" / "ipa-dict.json", oxford_override_json=root / "public" / "oxford-american-ipa.json")
        second = module.build_study_manifest(root / "public" / "The_Oxford_5000.csv", root / "public" / "ipa-dict.json", oxford_override_json=root / "public" / "oxford-american-ipa.json")
        self.assertEqual(first, second)

    def test_v2_manifest_generation_only_copies_checked_in_explicit_labels(self):
        root = Path(__file__).resolve().parents[2]
        checked_in = root / "scripts" / "data" / "segmentation-study-v2.json"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "copied-v2.json"
            generated = module.copy_explicit_v2_manifest(destination)
            self.assertEqual(destination.read_bytes(), checked_in.read_bytes())
            self.assertEqual(generated["manifestSha256"], json.loads(checked_in.read_text(encoding="utf-8"))["manifestSha256"])

    def test_checked_in_v2_manifest_is_frozen_balanced_and_mirrors_v1_words(self):
        root = Path(__file__).resolve().parents[2]
        v1 = json.loads((root / "scripts" / "data" / "segmentation-study-v1.json").read_text(encoding="utf-8"))
        v2 = json.loads((root / "scripts" / "data" / "segmentation-study-v2.json").read_text(encoding="utf-8"))
        self.assertEqual(v2["studyId"], "segmentation-study-v2")
        self.assertEqual(v2["version"], "2.0.0")
        self.assertEqual(len(v2["entries"]), 100)
        self.assertEqual([entry["targetWord"] for entry in v2["entries"]], [entry["targetWord"] for entry in v1["entries"]])
        self.assertEqual({count: sum(item["targetSyllableCount"] == count for item in v2["entries"]) for count in range(2, 6)}, {2: 25, 3: 25, 4: 25, 5: 25})
        self.assertEqual(sum(item["split"] == "development" for item in v2["entries"]), 70)
        self.assertEqual(sum(item["split"] == "holdout" for item in v2["entries"]), 30)
        self.assertEqual([item["taskId"] for item in v2["entries"]], [f"segmentation-study-v2-{index:04d}" for index in range(1, 101)])
        for item in v2["entries"]:
            self.assertEqual(len(item["referenceSyllableIpa"]), item["targetSyllableCount"])
            self.assertEqual(item["referenceDialect"], "en-US")
            self.assertEqual(item["dialect"], "en-US")
            self.assertEqual(item["referenceProvenance"]["dialect"], "en-US")
            self.assertEqual(item["referenceProvenance"]["method"], "explicit-reviewed-en-US-v1")
            self.assertEqual(item["referenceLabelProvenance"], "explicit-reviewed-en-US-v1")
            self.assertEqual(item["labelProvenance"], "explicit-reviewed-en-US-v1")
            self.assertTrue(item["exceptionRationale"])
            self.assertEqual(item["referenceProvenance"]["exceptionRationale"], item["exceptionRationale"])
            self.assertNotIn("heuristic", item["labelProvenance"].lower())
            self.assertNotEqual(item["labelProvenance"], "deterministic-transform")

    def test_v2_manifest_freezes_corrected_golden_labels_and_ambiguous_rationales(self):
        root = Path(__file__).resolve().parents[2]
        manifest = json.loads((root / "scripts" / "data" / "segmentation-study-v2.json").read_text(encoding="utf-8"))
        by_word = {entry["targetWord"]: entry for entry in manifest["entries"]}
        expected = {
            "abroad": ["ə", "ˈbrɔd"],
            "acquire": ["ə", "ˈkwaɪɝ"],
            "accomplish": ["ə", "ˈkɑm", "plɪʃ"],
            "adjustment": ["ə", "ˈdʒəst", "mənt"],
            "agreement": ["ə", "ˈɡri", "mənt"],
            "accomplishment": ["ə", "ˈkɑm", "plɪʃ", "mənt"],
            "agriculture": ["ˈæɡ", "rɪ", "ˌkəl", "tʃɝ"],
            "analogy": ["ə", "ˈnæ", "lə", "dʒi"],
            "appreciate": ["ə", "ˈpri", "ʃi", "ˌeɪt"],
            "biology": ["baɪ", "ˈɑ", "lə", "dʒi"],
            "congressional": ["kən", "ˈɡrɛ", "ʃə", "nəl"],
            "democratic": ["ˌdɛ", "mə", "ˈkræ", "tɪk"],
            "original": ["ɝ", "ˈɪ", "dʒə", "nəl"],
            "originate": ["ɝ", "ˈɪ", "dʒə", "ˌneɪt"],
            "administration": ["æd", "ˌmɪ", "nɪ", "ˈstreɪ", "ʃən"],
            "administrative": ["əd", "ˈmɪ", "nə", "ˌstreɪ", "tɪv"],
            "administrator": ["əd", "ˈmɪ", "nə", "ˌstreɪ", "tɝ"],
            "appreciation": ["ə", "ˌpri", "ʃi", "ˈeɪ", "ʃən"],
            "approximately": ["ə", "ˈprɑk", "sə", "mət", "li"],
            "experimental": ["ɪk", "ˌspɛ", "rɪ", "ˈmɛn", "təl"],
            "ideology": ["ˌaɪ", "di", "ˈɑ", "lə", "dʒi"],
            "imaginary": ["ˌɪ", "ˈmæ", "dʒə", "ˌnɛ", "ri"],
            "technological": ["ˌtɛk", "nə", "ˈlɑ", "dʒɪ", "kəl"],
        }
        for word, labels in expected.items():
            self.assertEqual(by_word[word]["referenceSyllableIpa"], labels, word)
            self.assertIn("frozen en-us", by_word[word]["exceptionRationale"].lower(), word)
        ambiguous = {
            "accurate", "accuracy", "deteriorate", "immediately", "accuse", "accused",
            "agriculture", "biography", "characteristic", "communicate", "communication",
            "declaration", "diplomatic", "inevitably", "constitutional",
        }
        for word in ambiguous:
            rationale = by_word[word]["exceptionRationale"]
            self.assertNotIn("none;", rationale.lower(), word)
            self.assertGreater(len(rationale.split()), 8, word)

    def test_v2_manifest_sha_is_content_addressed_and_source_bundle_matches(self):
        root = Path(__file__).resolve().parents[2]
        source = json.loads((root / "scripts" / "data" / "segmentation-study-v2.json").read_text(encoding="utf-8"))
        bundled = json.loads((root / "functions" / "src" / "data" / "segmentation-study-v2.json").read_text(encoding="utf-8"))
        self.assertEqual(source, bundled)
        expected = module._json_hash({key: value for key, value in source.items() if key != "manifestSha256"})
        self.assertEqual(source["manifestSha256"], expected)


def _wav(path: Path, sample_rate: int = 16_000) -> None:
    duration = 1.2
    times = np.arange(int(sample_rate * duration), dtype=np.float64) / sample_rate
    signal = 0.03 * np.sin(2 * np.pi * 180 * times)
    signal[int(0.4 * sample_rate) : int(0.43 * sample_rate)] += 0.65 * np.sin(2 * np.pi * 3_500 * times[int(0.4 * sample_rate) : int(0.43 * sample_rate)])
    signal[int(0.8 * sample_rate) : int(0.84 * sample_rate)] += 0.65 * np.sin(2 * np.pi * 2_700 * times[int(0.8 * sample_rate) : int(0.84 * sample_rate)])
    values = np.clip(signal * 32767, -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(values.tobytes())


class FeatureAndCandidateTests(unittest.TestCase):
    def test_stft_mel_features_are_deterministic(self):
        signal = np.sin(2 * np.pi * 220 * np.arange(48_000) / 48_000).astype(np.float32)
        first = module.extract_spectrogram_features(signal, 48_000)
        second = module.extract_spectrogram_features(signal, 48_000)
        self.assertEqual(first["logMel"].shape[1], 40)
        self.assertEqual(first["sampleRate"], 16_000)
        self.assertEqual(first["logMel"].shape, second["logMel"].shape)
        np.testing.assert_array_equal(first["logMel"], second["logMel"])
        self.assertAlmostEqual(float(first["times"][1] - first["times"][0]), 0.005, places=6)

    def test_candidate_families_keep_one_monotonic_boundary_set(self):
        with tempfile.TemporaryDirectory() as temporary:
            audio_path = Path(temporary) / "sample.wav"
            _wav(audio_path)
            features = module.extract_spectrogram_features_from_wav(audio_path)
            sample = {
                "id": "synthetic",
                "word": "synthetic",
                "referenceSyllableIpa": ["kæt", "ə", "ɡɔɹ"],
                "manualSegments": [{"startTime": 0.1, "endTime": 0.4}, {"startTime": 0.4, "endTime": 0.8}, {"startTime": 0.8, "endTime": 1.1}],
                "versions": {
                    "v2": [{"startTime": 0.1, "endTime": 0.39}, {"startTime": 0.39, "endTime": 0.79}, {"startTime": 0.79, "endTime": 1.1}],
                    "v3": [{"startTime": 0.1, "endTime": 0.41}, {"startTime": 0.41, "endTime": 0.81}, {"startTime": 0.81, "endTime": 1.1}],
                    "v4": [{"startTime": 0.1, "endTime": 0.42}, {"startTime": 0.42, "endTime": 0.82}, {"startTime": 0.82, "endTime": 1.1}],
                },
            }
            candidates = module.generate_candidates(sample, features)
        self.assertEqual(set(candidates), {"v2", "v3", "v4", "naiveSpectral", "contextAware"})
        for values in candidates.values():
            self.assertEqual(len(values), 4)
            self.assertEqual(values, sorted(values))

    def test_missing_automatic_baseline_never_uses_manual_boundaries(self):
        sample = {
            "manualSegments": [{"startTime": 0.0, "endTime": 0.3}, {"startTime": 0.3, "endTime": 0.7}],
            "versions": {"v2": [], "v3": [], "v4": []},
        }
        self.assertEqual(module.generate_candidates(sample), {"v2": [], "v3": [], "v4": [], "naiveSpectral": [], "contextAware": []})

    def test_empty_nucleus_intersection_retains_v3_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            audio_path = Path(temporary) / "sample.wav"
            _wav(audio_path)
            features = module.extract_spectrogram_features_from_wav(audio_path)
            v3 = [
                {"startTime": 0.0, "endTime": 0.8, "nucleusStartTime": 0.1, "nucleusEndTime": 0.2},
                {"startTime": 0.8, "endTime": 1.0, "nucleusStartTime": 0.3, "nucleusEndTime": 0.4},
            ]
            sample = {
                "referenceSyllableIpa": ["kæ", "mə"],
                "versions": {"v2": v3, "v3": v3, "v4": v3},
            }
            candidates = module.generate_candidates(sample, features, config={"prominence": 0.0, "agreementMargin": 1.0})
        self.assertEqual(candidates["contextAware"][1], 0.8)
        self.assertEqual(candidates["naiveSpectral"][1], 0.8)


class MetricsAndReportTests(unittest.TestCase):
    def _samples(self):
        base = {
            "split": "development",
            "manualSegments": [{"startTime": 0.0, "endTime": 0.3}, {"startTime": 0.3, "endTime": 0.6}, {"startTime": 0.6, "endTime": 0.9}],
            "versions": {
                "v2": [{"startTime": 0.0, "endTime": 0.31}, {"startTime": 0.31, "endTime": 0.61}, {"startTime": 0.61, "endTime": 0.9}],
                "v3": [{"startTime": 0.0, "endTime": 0.32}, {"startTime": 0.32, "endTime": 0.62}, {"startTime": 0.62, "endTime": 0.9}],
                "v4": [{"startTime": 0.0, "endTime": 0.31}, {"startTime": 0.31, "endTime": 0.61}, {"startTime": 0.61, "endTime": 0.9}],
            },
            "referenceSyllableIpa": ["kæt", "ə", "ɡɔɹ"],
        }
        return [{**base, "id": "a", "word": "alpha"}, {**base, "id": "b", "word": "bravo"}]

    def test_summary_counts_internal_boundaries_once(self):
        samples = self._samples()
        prepared = [{**sample, "candidates": module.generate_candidates(sample)} for sample in samples]
        summary = module.summarize_candidate(prepared, "v3")
        self.assertEqual(summary["edgeCount"], 4)
        self.assertAlmostEqual(summary["maeMs"], 20.0)

    def test_word_cluster_bootstrap_is_reproducible(self):
        samples = self._samples()
        prepared = [{**sample, "candidates": {"v3": [0.0, 0.32, 0.62, 0.9], "v4": [0.0, 0.31, 0.61, 0.9], "contextAware": [0.0, 0.30, 0.60, 0.9]}} for sample in samples]
        first = module.bootstrap_improvement_interval(prepared, "contextAware", "v3", resamples=500, seed=17)
        second = module.bootstrap_improvement_interval(prepared, "contextAware", "v3", resamples=500, seed=17)
        self.assertEqual(first, second)
        self.assertTrue(first["passes"])

    def test_development_tuning_returns_registered_configuration(self):
        samples = self._samples()
        tuning = module.tune_context_parameters(samples, parameter_grid=[{"prominence": 0.55, "agreementMargin": 0.18, "agreementWindowMs": 30.0}])
        self.assertEqual(tuning["reason"], "development-only lexicographic selection")
        self.assertEqual(tuning["selected"]["prominence"], 0.55)
        self.assertEqual(len(tuning["candidates"]), 1)

    def test_report_writes_json_csv_and_markdown(self):
        samples = self._samples()
        with tempfile.TemporaryDirectory() as temporary:
            report = module.run_reanalysis(samples, bootstrap_resamples=100, seed=9)
            paths = module.write_outputs(report, temporary)
            self.assertTrue(all(path.exists() for path in paths.values()))
            payload = json.loads(paths["json"].read_text(encoding="utf-8"))
            self.assertIn("contextAware", payload["summaries"])
            self.assertEqual(payload["endpointSummaries"]["v3"]["edgeCount"], 8)
            self.assertIn("boundaryContexts", payload)
            self.assertIn("beforeAfter", payload["sampleReports"][0])
            self.assertIn("assisted-review promotion gate", payload["promotionGate"]["name"])
            self.assertIn("Automatic V2/V3/V4", payload["anchoringBiasDisclosure"])
            self.assertEqual(payload["developmentConfigHash"], payload["holdoutConfigHash"])
            self.assertIn("Candidate", paths["markdown"].read_text(encoding="utf-8"))

    def test_authoritative_first_holdout_artifacts_are_immutable_and_exploratory_is_explicit(self):
        samples = self._samples()
        with tempfile.TemporaryDirectory() as temporary:
            report = module.run_reanalysis(samples, bootstrap_resamples=20, seed=9)
            first_paths = module.write_outputs(report, temporary)
            first_json = first_paths["json"].read_bytes()
            marker = Path(temporary) / "segmentation-study-v2-authoritative-first.marker.json"
            self.assertTrue(marker.exists())
            with self.assertRaises(FileExistsError):
                module.write_outputs(report, temporary)
            changed_config = module.run_reanalysis(samples, bootstrap_resamples=20, seed=9, feature_config={"prominence": 0.61})
            self.assertNotEqual(changed_config["configurationHash"], report["configurationHash"])
            with self.assertRaises(FileExistsError):
                module.write_outputs(changed_config, temporary)
            exploratory = module.run_reanalysis(samples, bootstrap_resamples=20, seed=9, evaluation_mode="exploratory")
            self.assertEqual(exploratory["evaluationMode"], "exploratory")
            self.assertFalse(exploratory["authoritativeHoldout"])
            self.assertFalse(exploratory["promotionGate"]["eligible"])
            exploratory_paths = module.write_outputs(exploratory, temporary)
            self.assertNotEqual(first_paths["json"], exploratory_paths["json"])
            self.assertEqual(first_json, first_paths["json"].read_bytes())

    def test_unsure_labels_remain_visible_but_are_excluded_from_primary_metrics(self):
        samples = self._samples()
        samples[1]["certainty"] = "unsure"
        report = module.run_reanalysis(samples, bootstrap_resamples=20, seed=9)
        self.assertEqual(report["sampleCounts"]["all"], 2)
        self.assertEqual(report["sampleCounts"]["benchmark"], 1)
        self.assertEqual(report["sampleCounts"]["uncertain"], 1)
        self.assertEqual(report["summaries"]["v3"]["sampleCount"], 1)
        self.assertEqual(report["allIncludingUncertain"]["summaries"]["v3"]["sampleCount"], 2)
        self.assertTrue(any(item["excludedFromPrimary"] for item in report["sampleReports"]))

    def test_historical_samples_are_excluded_from_primary_summary(self):
        samples = self._samples()
        samples[0]["split"] = "development"
        samples[1]["historical"] = True
        report = module.run_reanalysis(samples, bootstrap_resamples=20, seed=9)
        self.assertEqual(report["sampleCounts"]["benchmark"], 1)
        self.assertEqual(report["sampleCounts"]["historical"], 1)
        self.assertEqual(report["summaries"]["v3"]["sampleCount"], 1)
        self.assertEqual(report["historical"]["summaries"]["v3"]["sampleCount"], 1)

    def test_recording_gate_rejects_any_regression_even_under_ten_ms(self):
        report = {
            "holdout": {
                "summaries": {
                    "contextAware": {"edgeCount": 2, "maeMs": 10.0, "within40Pct": 100.0},
                    "v3": {"edgeCount": 2, "maeMs": 20.0, "within40Pct": 50.0},
                    "v4": {"edgeCount": 2, "maeMs": 20.0, "within40Pct": 50.0},
                },
                "perWord": {},
            },
            "historical": {
                "summaries": {
                    "contextAware": {"edgeCount": 2, "maeMs": 10.0},
                    "v3": {"edgeCount": 2, "maeMs": 20.0},
                    "v4": {"edgeCount": 2, "maeMs": 20.0},
                },
                "perSample": {"recording-20260812": {"contextAware": 25.0, "v4": 20.0}},
                "perWord": {},
            },
            "bootstrap": {"v3": {"passes": True}, "v4": {"passes": True}},
        }
        gates = module.evaluate_gates(report, historical_sample_ids=["recording-20260812"])
        self.assertFalse(gates["checks"]["recordingDoesNotRegress"])
        self.assertEqual(gates["status"], "fail")

    def test_canonical_export_v2_requires_all_versions_and_top_level_provenance(self):
        root = Path(__file__).resolve().parents[2]
        manifest = json.loads((root / "scripts" / "data" / "segmentation-study-v2.json").read_text(encoding="utf-8"))
        records = []
        for index, entry in enumerate(manifest["entries"], start=1):
            span = [{"startTime": index / entry["targetSyllableCount"], "endTime": (index + 1) / entry["targetSyllableCount"]} for index in range(entry["targetSyllableCount"])]
            version_data = {
                version: {
                    "spans": span,
                    "variant": version,
                    "analysisVersion": f"pronunciation-analysis-{version}",
                    "source": f"comparison-{version}",
                    "schemaVersion": "pronunciation-comparison-v2" if version == "v2" else "pronunciation-partition-variants-v2",
                }
                for version in ("v2", "v3", "v4")
            }
            automatic_order = module._automatic_order(manifest["manifestSha256"], entry["taskId"])
            automatic_version_order = module._automatic_version_order(manifest["manifestSha256"], entry["taskId"])
            records.append({
                "sampleId": f"sample-{entry['taskId']}",
                "taskId": entry["taskId"],
                "targetWord": entry["targetWord"],
                "speakerCohort": "segmentation-study-v2",
                "split": entry["split"],
                "certainty": "certain",
                "referenceIpa": entry["referenceIpa"],
                "referenceSyllableIpa": entry["referenceSyllableIpa"],
                "referenceProvenance": entry["referenceProvenance"],
                "referenceLabelProvenance": "explicit-reviewed-en-US-v1",
                "targetSyllableCount": entry["targetSyllableCount"],
                "expectedObservedCount": entry["targetSyllableCount"],
                "promotionEligible": True,
                "automaticOrder": automatic_order,
                "automaticVersionOrder": automatic_version_order,
                "versions": version_data,
                "variantProvenance": {version: {key: value[key] for key in ("variant", "analysisVersion", "source", "schemaVersion")} for version, value in version_data.items()},
                "analysisRevision": "pronunciation-analysis-revision-v2",
                "manualSpans": span,
                "sourceHash": f"{index:064x}",
                "captureEligibility": "eligible",
                "captureMetadata": {"captureId": f"capture-{entry['taskId']}", "capturedAt": "2026-08-19T00:00:00Z", "echoCancellation": False, "noiseSuppression": False, "autoGainControl": False},
                "annotationProtocol": "automatic-visible-assisted-v1",
                "assistedMetadata": {"assisted": True, "annotationProtocol": "automatic-visible-assisted-v1", "exposureLog": [{"version": version, "automaticOrder": automatic_order, "viewedAt": f"2026-08-19T00:00:0{offset}.000Z"} for offset, version in enumerate(automatic_version_order)], "tools": []},
            })
        export = {
            "schemaVersion": "segmentation-study-export-v2",
            "studyVersion": "study-v2",
            "manifestVersion": manifest["version"],
            "manifestSha256": manifest["manifestSha256"],
            "samples": records,
        }
        loaded = module.load_canonical_export_v2(export, manifest=manifest)
        self.assertEqual(len(loaded), 100)
        self.assertTrue(all(sample["_canonicalExportV2"] for sample in loaded))
        self.assertTrue(all(sample["promotionEligible"] for sample in loaded))
        first_order = module._automatic_order(manifest["manifestSha256"], manifest["entries"][0]["taskId"])
        first_version_order = module._automatic_version_order(manifest["manifestSha256"], manifest["entries"][0]["taskId"])
        self.assertEqual(loaded[0]["automaticOrder"], first_order)
        self.assertEqual(loaded[0]["automaticVersionOrder"], first_version_order)

        missing_v4 = deepcopy(export)
        missing_v4["samples"][0]["versions"].pop("v4")
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(missing_v4, manifest=manifest)

        nested_manual = deepcopy(export)
        nested_manual["samples"][0]["review"] = {"manualSpans": nested_manual["samples"][0].pop("manualSpans")}
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(nested_manual, manifest=manifest)

        missing_assisted = deepcopy(export)
        missing_assisted["samples"][0].pop("assistedMetadata")
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(missing_assisted, manifest=manifest)
        incomplete_exposure = deepcopy(export)
        incomplete_exposure["samples"][0]["assistedMetadata"]["exposureLog"] = [{"version": "v2", "automaticOrder": "order-v2", "viewedAt": "2026-08-19T00:00:00Z"}]
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(incomplete_exposure, manifest=manifest)

        wrong_order = deepcopy(export)
        wrong_order["samples"][0]["assistedMetadata"]["exposureLog"].reverse()
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(wrong_order, manifest=manifest)

        invalid_token = deepcopy(export)
        invalid_token["samples"][0]["assistedMetadata"]["exposureLog"][0]["automaticOrder"] = "0" * 64
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(invalid_token, manifest=manifest)

        invalid_timestamp = deepcopy(export)
        invalid_timestamp["samples"][0]["assistedMetadata"]["exposureLog"][0]["viewedAt"] = "not-a-timestamp"
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(invalid_timestamp, manifest=manifest)

    def test_canonical_export_v2_rejects_missing_cohort_without_silent_attrition(self):
        root = Path(__file__).resolve().parents[2]
        manifest = json.loads((root / "scripts" / "data" / "segmentation-study-v2.json").read_text(encoding="utf-8"))
        export = {
            "schemaVersion": "segmentation-study-export-v2",
            "studyVersion": "segmentation-study-v2",
            "manifestVersion": manifest["version"],
            "manifestSha256": manifest["manifestSha256"],
            "samples": [],
        }
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(export, manifest=manifest)

    def test_canonical_export_v2_rejects_gaps_aliases_duplicates_and_nonpromotion_metadata(self):
        root = Path(__file__).resolve().parents[2]
        manifest = json.loads((root / "scripts" / "data" / "segmentation-study-v2.json").read_text(encoding="utf-8"))
        records = []
        for index, entry in enumerate(manifest["entries"], start=1):
            span = [{"startTime": 0.0, "endTime": 0.5}, {"startTime": 0.5, "endTime": 1.0}]
            span = span[: entry["targetSyllableCount"]]
            if len(span) < entry["targetSyllableCount"]:
                span.extend({"startTime": 1.0 + offset, "endTime": 1.5 + offset} for offset in range(entry["targetSyllableCount"] - len(span)))
            versions = {
                version: {"spans": span, "variantId": version, "analysisVersion": f"analysis-{version}", "source": f"source-{version}", "schemaVersion": "pronunciation-comparison-v2" if version == "v2" else "pronunciation-partition-variants-v2"}
                for version in ("v2", "v3", "v4")
            }
            automatic_order = module._automatic_order(manifest["manifestSha256"], entry["taskId"])
            automatic_version_order = module._automatic_version_order(manifest["manifestSha256"], entry["taskId"])
            records.append({
                "sampleId": f"strict-{index}", "taskId": entry["taskId"], "targetWord": entry["targetWord"],
                "speakerCohort": "segmentation-study-v2", "split": entry["split"], "certainty": "certain",
                "referenceIpa": entry["referenceIpa"], "referenceSyllableIpa": entry["referenceSyllableIpa"],
                "referenceProvenance": entry["referenceProvenance"], "referenceLabelProvenance": "explicit-reviewed-en-US-v1",
                "targetSyllableCount": entry["targetSyllableCount"], "expectedObservedCount": entry["targetSyllableCount"],
                "promotionEligible": True,
                "automaticOrder": automatic_order, "automaticVersionOrder": automatic_version_order,
                "versions": versions, "variantProvenance": {v: {k: versions[v][k] for k in ("variantId", "analysisVersion", "source", "schemaVersion")} for v in versions},
                "analysisRevision": "revision-v2", "manualSpans": span, "sourceHash": f"{index:064x}",
                "captureEligibility": "eligible", "captureMetadata": {"captureId": f"capture-{index}", "echoCancellation": False, "noiseSuppression": False, "autoGainControl": False},
                "annotationProtocol": "automatic-visible-assisted-v1", "assistedMetadata": {"assisted": True, "annotationProtocol": "automatic-visible-assisted-v1", "exposureLog": [{"version": version, "automaticOrder": automatic_order, "viewedAt": f"2026-08-19T00:00:0{offset}.000Z"} for offset, version in enumerate(automatic_version_order)]},
            })
        export = {"schemaVersion": "segmentation-study-export-v2", "studyVersion": "study-v2", "manifestVersion": manifest["version"], "manifestSha256": manifest["manifestSha256"], "samples": records}
        gap = deepcopy(export)
        gap["samples"][0]["manualSpans"][1]["startTime"] = 0.75
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(gap, manifest=manifest)
        alias = deepcopy(export)
        for version in ("v3", "v4"):
            alias["samples"][0]["versions"][version]["analysisVersion"] = alias["samples"][0]["versions"]["v2"]["analysisVersion"]
            alias["samples"][0]["versions"][version]["source"] = alias["samples"][0]["versions"]["v2"]["source"]
            alias["samples"][0]["versions"][version]["schemaVersion"] = alias["samples"][0]["versions"]["v2"]["schemaVersion"]
            alias["samples"][0]["variantProvenance"][version] = dict(alias["samples"][0]["variantProvenance"]["v2"])
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(alias, manifest=manifest)
        duplicate = deepcopy(export)
        duplicate["samples"][1]["sourceHash"] = duplicate["samples"][0]["sourceHash"]
        with self.assertRaises(ValueError):
            module.load_canonical_export_v2(duplicate, manifest=manifest)

    def test_legacy_loader_requires_explicit_historical_compatibility(self):
        legacy = {"id": "old", "word": "old", "manualReview": {"manualSegments": [{"startTime": 0.0, "endTime": 1.0}]}, "referenceIpa": "/oʊld/"}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "legacy.json"
            path.write_text(json.dumps(legacy), encoding="utf-8")
            with self.assertRaises(ValueError):
                module.load_labeled_samples(path)
            loaded = module.load_labeled_samples(path, compatibility="historical")
            self.assertEqual(len(loaded), 1)
            self.assertFalse(loaded[0]["promotionEligible"])

    def test_historical_selection_never_falls_back_by_word(self):
        samples = [{"id": f"renamed-{index}", "word": "photograph", "sourceHash": f"{index:064x}"} for index in range(6)]
        self.assertEqual(module.select_historical_regression_set(samples), [])


if __name__ == "__main__":
    unittest.main()
