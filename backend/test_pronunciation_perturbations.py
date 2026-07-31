import pathlib
import tempfile
import unittest
import wave

import numpy as np


class PronunciationPerturbationTest(unittest.TestCase):
    def test_crossfade_is_exactly_ten_ms_at_sample_rate(self):
        from scripts.benchmarks.generate_pronunciation_perturbations import crossfade
        left = np.ones(1600, dtype=np.float32)
        right = np.zeros(1600, dtype=np.float32)
        output = crossfade(left, right, 16000)
        self.assertEqual(len(output), 1600 + 1600 - 160)
        self.assertAlmostEqual(float(output[1600 - 80]), 0.5, places=2)

    def test_transform_row_preserves_parent_and_declares_operator(self):
        from scripts.benchmarks.generate_pronunciation_perturbations import build_transform_row
        row = build_transform_row("parent-1", "wrong_stress", {"factor": 1.3})
        self.assertEqual(row["parent_id"], "parent-1")
        self.assertEqual(row["operator"], "wrong_stress")
        self.assertEqual(row["parameters"]["factor"], 1.3)

    def test_audio_filename_is_windows_safe(self):
        from scripts.benchmarks.generate_pronunciation_perturbations import audio_filename

        filename = audio_filename("parent::wrong_stress")
        self.assertEqual(filename, "parent--wrong_stress.wav")
        self.assertNotIn(":", filename)

    def test_speed_variant_preserves_nonempty_audio(self):
        from scripts.benchmarks.generate_pronunciation_perturbations import change_speed
        samples = np.sin(np.linspace(0, 20, 1600)).astype(np.float32)
        changed = change_speed(samples, 1.05)
        self.assertGreater(len(changed), 0)
        self.assertLess(abs(len(changed) - round(len(samples) / 1.05)), 3)

    def test_region_replacement_uses_aligned_bounds_and_crossfade(self):
        from scripts.benchmarks.generate_pronunciation_perturbations import replace_region
        samples = np.zeros(1600, dtype=np.float32)
        replacement = np.ones(640, dtype=np.float32)
        changed = replace_region(samples, 400, 560, replacement, 16000)
        self.assertGreater(len(changed), len(samples))
        self.assertTrue(np.isfinite(changed).all())

    def test_count_edit_uses_declared_nucleus_not_audio_midpoint(self):
        from scripts.benchmarks.generate_pronunciation_perturbations import count_variant
        samples = np.arange(1000, dtype=np.float32) / 1000
        omitted = count_variant(samples, 1000, {"start_time": 0.1, "end_time": 0.2}, insertion=False)
        self.assertLess(len(omitted), len(samples))
        self.assertAlmostEqual(float(omitted[100]), float(samples[200]), places=1)

    def test_edit_windows_expand_one_frame_nuclei_around_alignment_centers(self):
        from scripts.benchmarks.generate_pronunciation_perturbations import expand_nuclei_for_edit

        expanded = expand_nuclei_for_edit(
            16000,
            16000,
            [
                {"start_time": 0.10, "end_time": 0.12},
                {"start_time": 0.30, "end_time": 0.32},
            ],
        )
        self.assertGreaterEqual(expanded[0]["end_time"] - expanded[0]["start_time"], 0.079)
        self.assertGreaterEqual(expanded[1]["end_time"] - expanded[1]["start_time"], 0.079)
        self.assertLess(expanded[0]["end_time"], expanded[1]["start_time"])
