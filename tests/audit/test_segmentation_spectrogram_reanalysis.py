"""Focused tests for the offline segmentation spectrogram experiment."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import wave
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
            self.assertIn("Candidate", paths["markdown"].read_text(encoding="utf-8"))

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


if __name__ == "__main__":
    unittest.main()
