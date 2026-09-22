"""Unit and contract tests for BEL Pronounce V4.2 orchestrator."""

import unittest
import numpy as np

from backend.local_server.pronounce_v42 import (
    validate_frame_clock,
    frame_to_canonical_sample,
    build_pronounce_v42
)
from backend.local_server.segment_contract import validate_timing_envelope


class TestPronounceV42(unittest.TestCase):

    def setUp(self):
        self.sample_rate = 16000
        self.num_samples = 32000  # 2.0 seconds
        self.pcm = np.zeros(self.num_samples, dtype=np.float32)
        # Syllable 1 (220 Hz)
        self.pcm[0:16000] = 0.4 * np.sin(2 * np.pi * 220 * np.linspace(0, 1.0, 16000, endpoint=False))
        # Syllable 2 (880 Hz)
        self.pcm[16000:32000] = 0.4 * np.sin(2 * np.pi * 880 * np.linspace(0, 1.0, 16000, endpoint=False))
        self.audio = {
            "sampleRateHz": self.sample_rate,
            "sampleCount": self.num_samples,
            "audioHash": "a" * 64,
            "channels": 1,
            "pcmEncoding": "s16le",
            "canonicalizationVersion": "canonical-v1"
        }
        self.valid_clock = {
            "frameClockVersion": "model-frontend-v1",
            "sampleRateHz": self.sample_rate,
            "sampleCount": self.num_samples,
            "frameCount": 100,
            "frameStrideSamples": 320,
            "offsetSamples": 0
        }
        self.v41_snapshot = {
            "schemaVersion": "pronunciation-syllabification-v1",
            "analysisVersion": "pronunciation-analysis-v4.1",
            "ruleVersion": "weighted-maximal-onset-v1",
            "contentHash": "c" * 64,
            "aligned": True,
            "syllables": [
                {
                    "index": 0,
                    "syllableId": "v4-syllable-1",
                    "ipa": "kæ",
                    "onset": ["k"],
                    "nucleus": "æ",
                    "coda": [],
                    "stress": "primary",
                    "token_start": 0,
                    "token_end": 2,
                    "phoneIndexes": [0, 1],
                    "start_frame": 10,
                    "end_frame": 45,
                    "partition_start_frame": 5,
                    "partition_end_frame": 50,
                    "vowel_start_frame": 20,
                    "vowel_end_frame": 40,
                },
                {
                    "index": 1,
                    "syllableId": "v4-syllable-2",
                    "ipa": "mər",
                    "onset": ["m"],
                    "nucleus": "ər",
                    "coda": [],
                    "stress": None,
                    "token_start": 2,
                    "token_end": 4,
                    "phoneIndexes": [2, 3],
                    "start_frame": 55,
                    "end_frame": 90,
                    "partition_start_frame": 50,
                    "partition_end_frame": 95,
                    "vowel_start_frame": 65,
                    "vowel_end_frame": 85,
                }
            ]
        }

    def test_validate_frame_clock(self):
        # 1. Valid clock
        valid, clock, reason = validate_frame_clock(self.valid_clock, self.audio)
        self.assertTrue(valid)
        self.assertEqual(reason, "VERIFIED")
        self.assertEqual(clock["frameStrideSamples"], 320)

        # 2. Mismatched sample rate
        bad_rate = dict(self.valid_clock, sampleRateHz=8000)
        valid, clock, reason = validate_frame_clock(bad_rate, self.audio)
        self.assertFalse(valid)
        self.assertEqual(reason, "TIME_MAPPING_UNVERIFIED")

        # 3. None clock
        valid, clock, reason = validate_frame_clock(None, self.audio)
        self.assertFalse(valid)
        self.assertEqual(reason, "TIME_MAPPING_UNVERIFIED")

    def test_frame_to_canonical_sample(self):
        sample = frame_to_canonical_sample(10, self.valid_clock, self.num_samples)
        self.assertEqual(sample, 3200)

        # Edge cases
        self.assertEqual(frame_to_canonical_sample(0, self.valid_clock, self.num_samples), 0)
        self.assertEqual(frame_to_canonical_sample(200, self.valid_clock, self.num_samples), self.num_samples)

    def test_build_pronounce_v42_with_valid_clock(self):
        rec_result = {
            "frameClock": self.valid_clock,
            "log_probs_shape": [100, 40]
        }
        result = build_pronounce_v42(
            pcm=self.pcm,
            audio=self.audio,
            reference={"text": "camera"},
            recognizer_result=rec_result,
            v41_snapshot=self.v41_snapshot
        )

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["clockStatus"], "VERIFIED")
        timing = result["timing"]
        self.assertIsNotNone(timing)
        self.assertEqual(timing["schemaVersion"], "pronounce-timing-v2")
        self.assertEqual(len(timing["syllables"]), 2)

        # Verify against segment contract
        validate_timing_envelope(timing)

        syl0 = timing["syllables"][0]
        self.assertEqual(syl0["playbackQuality"], "accepted")
        self.assertLess(syl0["syllableSpan"]["startSample"], syl0["syllableSpan"]["endSample"])
        self.assertLessEqual(syl0["syllableSpan"]["startSample"], syl0["nucleusSpan"]["startSample"])
        self.assertLessEqual(syl0["nucleusSpan"]["endSample"], syl0["syllableSpan"]["endSample"])

        # Boundary decisions recorded
        self.assertGreaterEqual(len(result["boundaryDecisions"]), 1)
        self.assertEqual(len(result["nucleusDecisions"]), 2)

    def test_build_pronounce_v42_with_unverified_clock(self):
        rec_result = {
            "frameClock": None,  # No clock
            "log_probs_shape": [100, 40]
        }
        result = build_pronounce_v42(
            pcm=self.pcm,
            audio=self.audio,
            reference={"text": "camera"},
            recognizer_result=rec_result,
            v41_snapshot=self.v41_snapshot
        )

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["clockStatus"], "TIME_MAPPING_UNVERIFIED")
        timing = result["timing"]
        self.assertIsNotNone(timing)

        # Envelope must still satisfy contract
        validate_timing_envelope(timing)

        # But playback quality must be flagged as uncertain
        syl0 = timing["syllables"][0]
        self.assertEqual(syl0["playbackQuality"], "uncertain")
        self.assertIn("TIME_MAPPING_UNVERIFIED", syl0["reasonCodes"])


if __name__ == "__main__":
    unittest.main()
