"""Fail-safe integrity checks for the pronunciation model benchmark."""

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "benchmarks" / "phoneme_model_probe.py"
SPEC = importlib.util.spec_from_file_location("phoneme_model_probe", SCRIPT)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class TestPhonemeModelProbeIntegrity(unittest.TestCase):
    def test_empty_corpus_is_rejected_before_model_selection(self):
        with self.assertRaises(probe.BenchmarkEvidenceError):
            probe.require_benchmark_evidence([], audio_dir=Path("missing"))

    def test_corpus_accuracy_uses_observed_counts(self):
        results = [
            {"category": "clean", "expectedObservedCount": 2, "observedCount": 2},
            {"category": "clean", "expectedObservedCount": 3, "observedCount": 2},
        ]
        metrics = probe.score_evaluated_corpus(results)
        self.assertEqual(metrics["testedWords"], 2)
        self.assertEqual(metrics["cleanAccuracy"], 0.5)

    def test_missing_observation_is_never_counted_correct(self):
        results = [
            {"category": "clean", "expectedObservedCount": 2, "observedCount": None},
        ]
        metrics = probe.score_evaluated_corpus(results)
        self.assertEqual(metrics["cleanAccuracy"], 0.0)

    def test_small_corpus_cannot_claim_benchmark_evidence(self):
        corpus = [{
            "sampleId": f"busy-{index}",
            "targetWord": "busy",
            "category": "clean",
            "targetSyllableCount": 2,
            "expectedObservedCount": 2,
            "speakerCohort": "speaker-a",
            "sourceHash": "a" * 64,
        } for index in range(6)]
        with self.assertRaisesRegex(probe.BenchmarkEvidenceError, "at least 120"):
            probe.require_benchmark_evidence(corpus, audio_dir=Path("missing"))

    def test_every_entry_needs_an_independent_target_count(self):
        entry = {
            "sampleId": "busy-1",
            "targetWord": "busy",
            "category": "clean",
            "expectedObservedCount": 2,
            "speakerCohort": "speaker-a",
            "sourceHash": "a" * 64,
        }
        corpus = [entry] * 120
        with self.assertRaisesRegex(probe.BenchmarkEvidenceError, "targetSyllableCount"):
            probe.require_benchmark_evidence(corpus, audio_dir=Path("missing"))


if __name__ == "__main__":
    unittest.main()
