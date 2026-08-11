import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "audit"
    / "pronunciation-segmentation-replay.py"
)
SPEC = importlib.util.spec_from_file_location("pronunciation_segmentation_replay", SCRIPT_PATH)
replay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replay)


class SegmentationReplayMetricsTests(unittest.TestCase):
    def test_replay_request_uses_authoritative_syllables_for_reference_ipa(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "v3": {"status": "available", "analysis": {"observed_syllables": []}}
        }
        review = {
            "word": "concoction",
            "referenceIpa": "/k\u0259n\u02c8k\u0251\u02d0k\u0283n/",
            "referenceSyllableIpa": ["k\u0259n", "k\u0251k", "\u0283\u0259n"],
            "primaryStress": 1,
            "expectedCount": 3,
            "audioPath": str(Path(__file__).resolve()),
        }

        with patch("requests.post", return_value=response) as post:
            replay.replay_review(review, "https://127.0.0.1:8081")

        self.assertEqual(
            post.call_args.kwargs["data"]["reference_ipa"],
            "/k\u0259n.\u02c8k\u0251k.\u0283\u0259n/",
        )

    def test_historical_gaps_normalize_to_their_midpoint(self):
        spans = [
            {"startTime": 0.1, "endTime": 0.3},
            {"startTime": 0.5, "endTime": 0.7},
            {"startTime": 0.7, "endTime": 0.9},
        ]
        self.assertEqual(
            replay.contiguous_boundaries(spans),
            [0.1, 0.4, 0.7, 0.9],
        )

    def test_metric_summary_reports_distribution_and_thresholds(self):
        summary = replay.summarize_errors([0.01, 0.02, 0.04, 0.08])
        self.assertAlmostEqual(summary["maeMs"], 37.5)
        self.assertAlmostEqual(summary["medianMs"], 30.0)
        self.assertAlmostEqual(summary["p90Ms"], 68.0)
        self.assertAlmostEqual(summary["maxMs"], 80.0)
        self.assertEqual(summary["within20Pct"], 50.0)
        self.assertEqual(summary["within40Pct"], 75.0)
        self.assertEqual(summary["within60Pct"], 75.0)

    def test_saved_manual_reviews_are_deduplicated_by_wav_sha(self):
        root = Path(__file__).resolve().parents[1] / "test-results" / "pronounce-local-samples"
        reviews, inventory = replay.load_unique_reviews(root)
        unique_hashes = {review["audioSha256"] for review in reviews}

        self.assertEqual(
            inventory["candidateCount"],
            len(reviews) + inventory["duplicateCount"],
        )
        self.assertEqual(inventory["duplicateCount"], 1)
        self.assertEqual(len(unique_hashes), len(reviews))
        self.assertIn(
            "361a889ee872c8110a48bbd8bb51ebbbf8a47459e38df054f5d5a7e9d15ba821",
            unique_hashes,
        )

    def test_count_failures_remain_visible_but_are_excluded_from_metrics(self):
        report = replay.evaluate_replays([
            {
                "id": "rateable",
                "expectedCount": 2,
                "manualSegments": [
                    {"startTime": 0.1, "endTime": 0.3},
                    {"startTime": 0.3, "endTime": 0.5},
                ],
                "displayedSegments": [
                    {"startTime": 0.1, "endTime": 0.32},
                    {"startTime": 0.34, "endTime": 0.5},
                ],
                "replay": {
                    "rateable": True,
                    "rawSegments": [
                        {"startTime": 0.1, "endTime": 0.28},
                        {"startTime": 0.32, "endTime": 0.5},
                    ],
                    "partitionSegments": [
                        {"startTime": 0.1, "endTime": 0.3},
                        {"startTime": 0.3, "endTime": 0.5},
                    ],
                },
            },
            {
                "id": "count-failure",
                "expectedCount": 2,
                "manualSegments": [
                    {"startTime": 0.1, "endTime": 0.3},
                    {"startTime": 0.3, "endTime": 0.5},
                ],
                "displayedSegments": [],
                "replay": {"rateable": True, "rawSegments": [], "partitionSegments": []},
            },
        ])
        self.assertEqual(report["includedCount"], 1)
        self.assertEqual(report["excludedCount"], 1)
        self.assertEqual(report["countFailures"], ["count-failure"])
        self.assertEqual(report["partition"]["maeMs"], 0.0)


if __name__ == "__main__":
    unittest.main()
