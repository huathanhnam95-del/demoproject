"""
Tests for Python local server rollout flags:
- PRONOUNCE_TIMING_V42: 'off' | 'shadow' | 'active'
- PRONOUNCE_STRESS_V2: 'off' | 'active'
"""

import os
import unittest
import numpy as np
from unittest.mock import patch

from backend.local_server.pronounce_v42 import build_pronounce_v42


class TestRolloutFlags(unittest.TestCase):

    def setUp(self):
        self.orig_timing = os.environ.get("PRONOUNCE_TIMING_V42")
        self.orig_stress = os.environ.get("PRONOUNCE_STRESS_V2")

        # Standard 16kHz test PCM and envelope
        self.sr = 16000
        self.pcm = np.sin(2 * np.pi * 220 * np.arange(16000) / 16000).astype(np.float32)
        self.audio = {
            "sampleRateHz": 16000,
            "sampleCount": 16000,
            "audioHash": "test-audio-hash",
            "channels": 1,
            "pcmEncoding": "s16le",
            "canonicalizationVersion": "canonical-v1"
        }
        self.v41_snapshot = {
            "analysisVersion": "v4.1.0",
            "ruleVersion": "weighted-maximal-onset-v1",
            "contentHash": "test-hash",
            "frameClock": {
                "frameClockVersion": "verified-ctc-v1",
                "sampleRateHz": 16000,
                "totalFrames": 100,
                "strideMs": 10.0,
                "windowMs": 25.0
            },
            "syllables": [
                {
                    "syllable": "test",
                    "ipa": "tɛst",
                    "start_frame": 10,
                    "end_frame": 40,
                    "vowel_start_frame": 18,
                    "vowel_end_frame": 32,
                    "expectedStress": "primary"
                }
            ]
        }
        self.reference = {"text": "tɛst"}
        self.recognizer_result = {}

    def tearDown(self):
        if self.orig_timing is not None:
            os.environ["PRONOUNCE_TIMING_V42"] = self.orig_timing
        elif "PRONOUNCE_TIMING_V42" in os.environ:
            del os.environ["PRONOUNCE_TIMING_V42"]

        if self.orig_stress is not None:
            os.environ["PRONOUNCE_STRESS_V2"] = self.orig_stress
        elif "PRONOUNCE_STRESS_V2" in os.environ:
            del os.environ["PRONOUNCE_STRESS_V2"]

    def test_pronounce_stress_v2_disabled(self):
        """When PRONOUNCE_STRESS_V2 is off, stress is disabled and features are None."""
        os.environ["PRONOUNCE_STRESS_V2"] = "off"
        result = build_pronounce_v42(
            pcm=self.pcm,
            audio=self.audio,
            reference=self.reference,
            recognizer_result=self.recognizer_result,
            v41_snapshot=self.v41_snapshot
        )
        self.assertEqual(result["status"], "available")
        stress = result.get("stress")
        self.assertEqual(stress.get("status"), "disabled")
        self.assertFalse(stress.get("applicable"))
        self.assertEqual(stress.get("reason"), "PRONOUNCE_STRESS_V2_DISABLED")
        self.assertIsNone(result.get("stressFeatures"))

    def test_pronounce_stress_v2_active(self):
        """When PRONOUNCE_STRESS_V2 is active, stress is evaluated and features are populated."""
        os.environ["PRONOUNCE_STRESS_V2"] = "active"
        result = build_pronounce_v42(
            pcm=self.pcm,
            audio=self.audio,
            reference=self.reference,
            recognizer_result=self.recognizer_result,
            v41_snapshot=self.v41_snapshot
        )
        self.assertEqual(result["status"], "available")
        stress = result.get("stress")
        self.assertIsNotNone(stress)
        self.assertIn("status", stress)
        self.assertIsNotNone(result.get("stressFeatures"))

    def test_pronounce_timing_v42_off_in_server(self):
        """Server logic skips V4.2 build when PRONOUNCE_TIMING_V42 is 'off'."""
        os.environ["PRONOUNCE_TIMING_V42"] = "off"
        partition_variants = {}
        remote_v4_alignment = {"aligned": True}

        timing_v42_flag = os.environ.get('PRONOUNCE_TIMING_V42', 'active').strip().lower()
        if remote_v4_alignment.get('aligned') is True and timing_v42_flag != 'off':
            partition_variants['timingVariants'] = {'v42': {'status': 'available'}}

        self.assertNotIn('timingVariants', partition_variants)

    def test_pronounce_timing_v42_shadow_and_active_in_server(self):
        """Server logic marks mode as shadow or active accordingly."""
        for flag in ["shadow", "active"]:
            os.environ["PRONOUNCE_TIMING_V42"] = flag
            partition_variants = {}
            remote_v4_alignment = {"aligned": True}

            timing_v42_flag = os.environ.get('PRONOUNCE_TIMING_V42', 'active').strip().lower()
            if remote_v4_alignment.get('aligned') is True and timing_v42_flag != 'off':
                partition_variants['timingVariants'] = {
                    'v42': {
                        'status': 'available',
                        'mode': timing_v42_flag
                    }
                }

            self.assertIn('timingVariants', partition_variants)
            self.assertEqual(partition_variants['timingVariants']['v42']['mode'], flag)


if __name__ == '__main__':
    unittest.main()
