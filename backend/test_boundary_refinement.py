"""Unit tests for BEL Pronounce V4.2 boundary refinement."""

import unittest
import numpy as np

from backend.phoneme_service.boundary_refinement import (
    FeatureTimeline,
    BoundaryWindow,
    Candidate,
    extract_boundary_features,
    make_boundary_windows,
    propose_boundary_candidates,
    select_consistent_boundaries,
    refine_nucleus_edges
)


class TestBoundaryRefinement(unittest.TestCase):

    def setUp(self):
        self.sample_rate = 16000
        # 1.0 second synthetic signal: 0.0-0.4s low sine, 0.4-0.6s noise burst (fricative/burst), 0.6-1.0s silence
        t = np.linspace(0, 1.0, self.sample_rate, endpoint=False)
        self.pcm = np.zeros(self.sample_rate, dtype=np.float32)
        # Vowel 1
        self.pcm[0:6400] = 0.5 * np.sin(2 * np.pi * 200 * t[0:6400])
        # Fricative burst
        np.random.seed(42)
        self.pcm[6400:9600] = 0.3 * np.random.randn(3200)
        # Vowel 2
        self.pcm[9600:14400] = 0.5 * np.sin(2 * np.pi * 300 * t[9600:14400])

    def test_extract_boundary_features(self):
        features = extract_boundary_features(self.pcm, sample_rate_hz=self.sample_rate)
        self.assertIsInstance(features, FeatureTimeline)
        self.assertGreater(features.frame_count, 10)
        self.assertEqual(len(features.spectral_flux), features.frame_count)
        self.assertEqual(len(features.high_band_ratio), features.frame_count)
        self.assertEqual(len(features.rms_envelope), features.frame_count)
        self.assertEqual(len(features.voicing_energy), features.frame_count)

        # High band ratio should be distinctly higher in the noise burst region (around sample 8000)
        burst_frames = np.where((features.frame_centers_samples >= 6400) & (features.frame_centers_samples <= 9600))[0]
        vowel_frames = np.where(features.frame_centers_samples < 6000)[0]
        self.assertGreater(np.mean(features.high_band_ratio[burst_frames]), np.mean(features.high_band_ratio[vowel_frames]))

    def test_make_boundary_windows(self):
        # 2 internal boundaries
        initial_boundaries = [6400, 10000]
        nuclei = [(1000, 5000), (7000, 9000), (11000, 13000)]
        windows = make_boundary_windows(
            initial_sample_boundaries=initial_boundaries,
            syllable_nuclei_samples=nuclei,
            total_samples=self.sample_rate,
            max_shift_ms=25.0,
            sample_rate_hz=self.sample_rate
        )
        self.assertEqual(len(windows), 2)
        # Window 0 must not cross left nucleus end (5000) or right nucleus start (7000)
        self.assertGreaterEqual(windows[0].lower_sample, 5000)
        self.assertLessEqual(windows[0].upper_sample, 7000)
        # Window 1 must not cross left nucleus end (9000) or right nucleus start (11000)
        self.assertGreaterEqual(windows[1].lower_sample, 9000)
        self.assertLessEqual(windows[1].upper_sample, 11000)

    def test_propose_boundary_candidates(self):
        features = extract_boundary_features(self.pcm, sample_rate_hz=self.sample_rate)
        window = BoundaryWindow(
            boundary_index=0,
            original_sample=6400,
            lower_sample=6000,
            upper_sample=6800,
            left_phone="æ",
            right_phone="s"
        )
        candidates = propose_boundary_candidates(window, features)
        self.assertGreater(len(candidates), 0)
        # Baseline must be included
        baseline_cands = [c for c in candidates if c.cue_family == "baseline"]
        self.assertEqual(len(baseline_cands), 1)
        self.assertEqual(baseline_cands[0].sample, 6400)

    def test_select_consistent_boundaries(self):
        w1 = BoundaryWindow(0, 5000, 4500, 5500)
        w2 = BoundaryWindow(1, 10000, 9500, 10500)
        cands1 = [Candidate(4800, 0.8, "spectral_flux", 200), Candidate(5000, 0.5, "baseline", 0)]
        cands2 = [Candidate(10200, 0.9, "high_band_ratio", 200), Candidate(10000, 0.5, "baseline", 0)]

        decisions = select_consistent_boundaries([w1, w2], [cands1, cands2])
        self.assertEqual(len(decisions), 2)
        self.assertLess(decisions[0].selected_sample, decisions[1].selected_sample)
        self.assertEqual(decisions[0].selected_sample, 4800)
        self.assertEqual(decisions[1].selected_sample, 10200)

    def test_refine_nucleus_edges(self):
        features = extract_boundary_features(self.pcm, sample_rate_hz=self.sample_rate)
        nuclei = [(1000, 5000), (10500, 13500)]
        syllables = [(0, 6400), (9600, 16000)]
        decisions = refine_nucleus_edges(nuclei, syllables, features)
        self.assertEqual(len(decisions), 2)
        for i, dec in enumerate(decisions):
            # Must remain within syllable span
            self.assertGreaterEqual(dec.refined_span[0], syllables[i][0])
            self.assertLessEqual(dec.refined_span[1], syllables[i][1])
            self.assertLess(dec.refined_span[0], dec.refined_span[1])


if __name__ == "__main__":
    unittest.main()
