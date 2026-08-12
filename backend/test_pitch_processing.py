import unittest

from backend.local_server.pitch_processing import (
    PITCH_PROCESSING_VERSION,
    apply_canonical_pitch_to_syllables,
    canonicalize_pitch_track,
)


class PitchProcessingTests(unittest.TestCase):
    def test_perfect_style_harmonic_run_is_folded_without_mutating_raw_values(self):
        times = [0.00, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07]
        raw = [188.0, 190.0, 187.0, None, None, 465.0, 474.8, 468.0]

        result = canonicalize_pitch_track(times, raw)

        self.assertEqual(result["version"], PITCH_PROCESSING_VERSION)
        self.assertEqual(result["rawValues"], raw)
        self.assertEqual(raw[-2], 474.8, "input/raw provenance must remain immutable")
        self.assertAlmostEqual(result["values"][5], 232.5, places=1)
        self.assertAlmostEqual(result["values"][6], 237.4, places=1)
        self.assertEqual(result["status"], "corrected")
        self.assertEqual(result["correctedRunCount"], 1)
        self.assertGreater(result["confidence"], 0.7)

    def test_large_but_non_harmonic_pitch_movement_is_not_folded(self):
        times = [0.00, 0.01, 0.02, None, 0.04, 0.05, 0.06]
        raw = [220.0, 215.0, 210.0, None, 150.0, 145.0, 140.0]

        result = canonicalize_pitch_track(times, raw)

        self.assertEqual(result["values"], raw)
        self.assertEqual(result["status"], "clean")
        self.assertEqual(result["correctedRunCount"], 0)

    def test_unresolved_extreme_run_is_removed_from_canonical_track(self):
        times = [0.00, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06]
        raw = [155.0, 158.0, 156.0, None, 495.0, 490.0, 492.0]

        result = canonicalize_pitch_track(times, raw)

        self.assertEqual(result["rawValues"], raw)
        self.assertEqual(result["values"][4:], [None, None, None])
        self.assertEqual(result["status"], "unrateable")
        self.assertIn("UNRESOLVED_HARMONIC_RUN", result["reasons"])

    def test_syllable_pitch_features_are_recomputed_from_canonical_track(self):
        syllables = [
            {"startTime": 0.0, "endTime": 0.03, "avgPitch": 188.0, "maxPitch": 190.0},
            {"startTime": 0.05, "endTime": 0.08, "avgPitch": 469.0, "maxPitch": 474.8},
        ]
        times = [0.00, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07]
        values = [188.0, 190.0, 187.0, None, None, 232.5, 237.4, 234.0]

        updated = apply_canonical_pitch_to_syllables(syllables, times, values)

        self.assertEqual(syllables[1]["maxPitch"], 474.8)
        self.assertAlmostEqual(updated[1]["maxPitch"], 237.4, places=1)
        self.assertAlmostEqual(updated[1]["avgPitch"], 234.6, places=1)


if __name__ == "__main__":
    unittest.main()
