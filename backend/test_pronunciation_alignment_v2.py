import io
import unittest
from unittest.mock import patch

import numpy as np

from backend.local_server import server


def candidate(time, intensity, confidence, *, voiced=True):
    return {
        "time": time,
        "intensity": intensity,
        "confidence": confidence,
        "voiced": voiced,
        "syllable": {
            "startTime": max(0.0, time - 0.08),
            "endTime": time + 0.08,
            "duration": 0.16,
            "vowelDuration": 0.11,
            "avgPitch": 150.0,
            "maxPitch": 165.0,
            "intensity": intensity,
        },
    }


class PronunciationAlignmentV2Test(unittest.TestCase):
    def test_stress_runtime_uses_empirical_calibration(self):
        self.assertEqual(server.AnalysisConfig.STRESS_CALIBRATION_VERSION, "candidate-audit-20260711-447")
        self.assertEqual(server.AnalysisConfig.STRESS_WEIGHT_PITCH, 0.30)
        self.assertEqual(server.AnalysisConfig.STRESS_WEIGHT_DURATION, 0.60)
        self.assertEqual(server.AnalysisConfig.STRESS_WEIGHT_INTENSITY, 0.10)
        self.assertEqual(server.AnalysisConfig.STRESS_FINAL_LENGTHENING_PENALTY, 0.0)
        self.assertEqual(server.AnalysisConfig.STRESS_CONFIDENCE_THRESHOLD, 0.65)

    def test_one_syllable_rhotic_is_never_split(self):
        result = server.select_native_acoustic_candidates(
            [candidate(0.22, 74.0, 0.96)],
            target_count=1,
        )
        self.assertEqual(result["rawCandidateCount"], 1)
        self.assertEqual(result["selectedCount"], 1)
        self.assertEqual(result["method"], "acoustic-candidate-selection")
        self.assertEqual(result["conflicts"], [])

    def test_diphthong_internal_dip_can_discard_only_low_confidence_noise(self):
        result = server.select_native_acoustic_candidates(
            [
                candidate(0.18, 76.0, 0.94),
                candidate(0.27, 68.0, 0.21),
            ],
            target_count=1,
        )
        self.assertEqual(result["rawCandidateCount"], 2)
        self.assertEqual(result["selectedCount"], 1)
        self.assertEqual(result["selected"][0]["time"], 0.18)
        self.assertEqual(result["conflicts"], [])

    def test_weak_unstressed_syllable_remains_real_candidate(self):
        result = server.select_native_acoustic_candidates(
            [
                candidate(0.15, 74.0, 0.90),
                candidate(0.38, 68.0, 0.58),
                candidate(0.62, 75.0, 0.92),
            ],
            target_count=3,
        )
        self.assertEqual(result["selectedCount"], 3)
        self.assertEqual(result["conflicts"], [])

    def test_extra_high_confidence_nucleus_fails_closed(self):
        result = server.select_native_acoustic_candidates(
            [
                candidate(0.15, 74.0, 0.91),
                candidate(0.38, 72.0, 0.81),
                candidate(0.62, 75.0, 0.92),
            ],
            target_count=2,
        )
        self.assertEqual(result["selectedCount"], 0)
        self.assertIn("ACOUSTIC_COUNT_MISMATCH", result["conflicts"])
        self.assertEqual(result["method"], "unresolved-extra-candidates")

    def test_fewer_candidates_never_synthesizes_nuclei(self):
        result = server.select_native_acoustic_candidates(
            [candidate(0.22, 74.0, 0.96)],
            target_count=3,
        )
        self.assertEqual(result["rawCandidateCount"], 1)
        self.assertEqual(result["selectedCount"], 0)
        self.assertEqual(result["selected"], [])
        self.assertIn("ACOUSTIC_COUNT_MISMATCH", result["conflicts"])

    def test_native_v2_uses_canonical_count_for_acoustic_alignment(self):
        def fake_analyze_audio(_path, expected_syllables=None):
            count = expected_syllables or 3
            syllables = [
                candidate(0.12 + (index * 0.18), 72.0 + index, 0.9)["syllable"]
                for index in range(count)
            ]
            return {
                "duration": 0.9,
                "sampleRate": 16000,
                "pitch": {"times": [0.1, 0.3], "values": [150.0, 145.0]},
                "intensity": {"times": [0.1, 0.3], "values": [70.0, 69.0]},
                "syllables": syllables,
            }

        with patch.object(server, "analyze_audio", side_effect=fake_analyze_audio) as analyze:
            result = server.analyze_audio_v2(
                "native.mp3",
                expected_syllable_count=4,
                native=True,
            )

        analyze.assert_called_once_with("native.mp3", expected_syllables=4)
        self.assertEqual(result["segmentation"]["selectedCount"], 4)
        self.assertTrue(result["quality"]["rateable"])

    def test_learner_v2_uses_target_aligned_acoustic_feedback(self):
        raw = {
            "duration": 0.4,
            "sampleRate": 16000,
            "pitch": {"times": [0.1], "values": [150.0]},
            "intensity": {"times": [0.1], "values": [70.0]},
            "syllables": [candidate(0.2, 72.0, 0.9)["syllable"]],
        }
        with patch.object(server, "analyze_audio", return_value=raw) as analyze:
            server.analyze_audio_v2(
                "learner.wav",
                expected_syllable_count=4,
                native=False,
            )

        analyze.assert_called_once_with(
            "learner.wav",
            expected_syllables=4,
        )

    def test_learner_v2_labels_target_aligned_feedback(self):
        raw = {
            "duration": 0.5,
            "sampleRate": 16000,
            "pitch": {"times": [0.1, 0.3], "values": [150.0, 140.0]},
            "intensity": {"times": [0.1, 0.3], "values": [72.0, 68.0]},
            "syllables": [
                candidate(0.15, 72.0, 0.9)["syllable"],
                candidate(0.35, 68.0, 0.8)["syllable"],
            ],
        }

        result = server.build_analysis_v2_response(
            raw,
            expected_syllable_count=2,
            native=False,
        )

        self.assertEqual(
            result["segmentation"]["method"],
            "target-aligned-acoustic-feedback",
        )
        self.assertEqual(result["observed"]["syllableCount"], 2)

    def test_learner_target_alignment_keeps_unvoiced_duration_region(self):
        raw = {
            "duration": 0.7,
            "sampleRate": 16000,
            "pitch": {"times": [0.1, 0.3, 0.5], "values": [145.0, None, 130.0]},
            "intensity": {"times": [0.1, 0.3, 0.5], "values": [72.0, 64.0, 69.0]},
            "syllables": [
                candidate(0.12, 72.0, 0.9)["syllable"],
                {
                    "startTime": 0.22,
                    "endTime": 0.38,
                    "duration": 0.16,
                    "avgPitch": 0,
                    "maxPitch": 0,
                    "intensity": 64.0,
                },
                candidate(0.52, 69.0, 0.8)["syllable"],
            ],
        }

        result = server.build_analysis_v2_response(
            raw,
            expected_syllable_count=3,
            native=False,
        )

        self.assertEqual(result["segmentation"]["selectedCount"], 3)
        self.assertEqual(result["observed"]["syllableCount"], 3)
        self.assertEqual(len(result["observed"]["syllables"]), 3)
        self.assertTrue(result["quality"]["rateable"])
        self.assertFalse(result["observed"]["stressEvidence"]["rateable"])

    def test_native_target_alignment_keeps_unvoiced_duration_region(self):
        raw = {
            "duration": 0.7,
            "sampleRate": 16000,
            "pitch": {"times": [0.1, 0.3, 0.5], "values": [145.0, None, 130.0]},
            "intensity": {"times": [0.1, 0.3, 0.5], "values": [72.0, 64.0, 69.0]},
            "syllables": [
                candidate(0.12, 72.0, 0.9)["syllable"],
                {
                    "startTime": 0.22,
                    "endTime": 0.38,
                    "duration": 0.16,
                    "avgPitch": 0,
                    "maxPitch": 0,
                    "intensity": 64.0,
                },
                candidate(0.52, 69.0, 0.8)["syllable"],
            ],
        }

        result = server.build_analysis_v2_response(
            raw,
            expected_syllable_count=3,
            native=True,
        )

        self.assertEqual(result["segmentation"]["selectedCount"], 3)
        self.assertEqual(result["observed"]["syllableCount"], 3)
        self.assertEqual(len(result["observed"]["syllables"]), 3)
        self.assertTrue(result["quality"]["rateable"])
        self.assertFalse(result["observed"]["stressEvidence"]["rateable"])
        self.assertTrue(result["capabilities"]["showNativeGraphs"])

    def test_independent_detection_retries_weak_syllable_thresholds(self):
        times = np.arange(0.0, 0.61, 0.01)
        values = np.full(times.shape, 65.0)

        class FakeIntensity:
            def xs(self):
                return times

            def get_value(self, time_value):
                index = int(np.argmin(np.abs(times - time_value)))
                return values[index]

        class FakePitch:
            @staticmethod
            def get_value_at_time(_time_value):
                return 150.0

        one_peak = [{"index": 20, "time": 0.20, "intensity": 72.0}]
        two_peaks = [
            {"index": 20, "time": 0.20, "intensity": 72.0},
            {"index": 42, "time": 0.42, "intensity": 68.0},
        ]

        with patch.object(
            server,
            "find_intensity_peaks",
            side_effect=[one_peak, two_peaks, two_peaks],
        ) as find_peaks, patch.object(
            server,
            "peaks_to_syllables",
            side_effect=lambda peaks, *_args: list(peaks),
        ):
            result = server.detect_syllables(
                object(),
                FakePitch(),
                FakeIntensity(),
                expected_syllables=None,
            )

        self.assertEqual(find_peaks.call_count, 3)
        self.assertEqual(len(result), 2)

    def test_learner_hint_uses_shallow_dip_pass_for_smooth_second_vowel(self):
        times = np.arange(0.0, 0.61, 0.01)
        values = np.full(times.shape, 65.0)

        class FakeIntensity:
            def xs(self):
                return times

            def get_value(self, time_value):
                return values[int(np.argmin(np.abs(times - time_value)))]

        class FakePitch:
            @staticmethod
            def get_value_at_time(_time_value):
                return 150.0

        one_peak = [{"index": 20, "time": 0.20, "intensity": 72.0}]
        two_peaks = [
            {"index": 20, "time": 0.20, "intensity": 72.0},
            {"index": 42, "time": 0.42, "intensity": 69.0},
        ]
        with patch.object(
            server,
            "find_intensity_peaks",
            side_effect=[one_peak, one_peak, one_peak, two_peaks],
        ) as find_peaks, patch.object(
            server,
            "peaks_to_syllables",
            side_effect=lambda peaks, *_args: list(peaks),
        ):
            result = server.detect_syllables(
                object(),
                FakePitch(),
                FakeIntensity(),
                expected_syllables=2,
                allow_expected_adjustment=False,
            )

        self.assertEqual(find_peaks.call_count, 4)
        self.assertEqual(len(result), 2)

    def test_weak_onset_noise_is_removed_without_a_target_count(self):
        times = np.arange(0.0, 0.61, 0.01)
        values = np.full(times.shape, 55.0)
        for center, height in ((0.13, 64.0), (0.23, 80.0), (0.42, 76.0)):
            index = int(round(center / 0.01))
            values[index - 2:index + 3] = [56.0, height - 3.0, height, height - 3.0, 56.0]

        class FakePitch:
            @staticmethod
            def get_value_at_time(_time_value):
                return 150.0

        peaks = server.find_intensity_peaks(
            times,
            values,
            threshold=60.0,
            start_idx=10,
            end_idx=55,
            pitch_obj=FakePitch(),
            min_dip=1.5,
        )

        self.assertEqual(
            [round(item["time"], 2) for item in peaks],
            [0.23, 0.42],
        )

    def test_weak_edge_nucleus_far_from_neighbor_is_preserved(self):
        times = np.arange(0.0, 0.61, 0.01)
        values = np.full(times.shape, 55.0)
        for center, height in ((0.20, 80.0), (0.50, 70.0)):
            index = int(round(center / 0.01))
            values[index - 2:index + 3] = [56.0, height - 3.0, height, height - 3.0, 56.0]

        class FakePitch:
            @staticmethod
            def get_value_at_time(_time_value):
                return 150.0

        peaks = server.find_intensity_peaks(
            times,
            values,
            threshold=60.0,
            start_idx=10,
            end_idx=55,
            pitch_obj=FakePitch(),
            min_dip=1.5,
        )

        self.assertEqual(
            [round(item["time"], 2) for item in peaks],
            [0.20, 0.50],
        )

    def test_learner_hint_preserves_weaker_interior_extra_nucleus(self):
        peaks = [
            {"index": 15, "time": 0.15, "intensity": 80.0},
            {"index": 35, "time": 0.35, "intensity": 65.0},
            {"index": 58, "time": 0.58, "intensity": 76.0},
        ]

        times = np.arange(0.0, 0.61, 0.01)
        values = np.full(times.shape, 65.0)

        class FakeIntensity:
            def xs(self):
                return times

            def get_value(self, time_value):
                return values[int(np.argmin(np.abs(times - time_value)))]

        class FakePitch:
            @staticmethod
            def get_value_at_time(_time_value):
                return 150.0

        with patch.object(
            server,
            "find_intensity_peaks",
            side_effect=[peaks, peaks, peaks, peaks],
        ), patch.object(
            server,
            "peaks_to_syllables",
            side_effect=lambda selected, *_args: list(selected),
        ):
            selected = server.detect_syllables(
                object(),
                FakePitch(),
                FakeIntensity(),
                expected_syllables=2,
                allow_expected_adjustment=False,
            )

        self.assertEqual(selected, peaks)

    def test_close_acoustic_nuclei_are_consolidated_before_counting(self):
        times = np.arange(0.0, 0.81, 0.01)
        values = np.full(times.shape, 60.0)
        for center, height in ((0.15, 70.0), (0.38, 69.0), (0.44, 67.0), (0.68, 71.0)):
            index = int(round(center / 0.01))
            values[index - 2:index + 3] = [61.0, height - 3.0, height, height - 3.0, 61.0]

        class FakePitch:
            @staticmethod
            def get_value_at_time(_time_value):
                return 150.0

        peaks = server.find_intensity_peaks(
            times,
            values,
            threshold=62.0,
            start_idx=0,
            end_idx=len(times) - 1,
            pitch_obj=FakePitch(),
            min_dip=1.5,
        )

        self.assertEqual([round(item["time"], 2) for item in peaks], [0.15, 0.38, 0.68])

    def test_expected_peak_alignment_uses_acoustic_maximum_in_gap(self):
        times = np.arange(0.0, 1.01, 0.1)
        values = np.array([0.0, 2.0, 8.0, 3.0, 1.0, 2.0, 9.0, 2.0, 7.0, 2.0, 0.0])
        peaks = [
            {"index": 2, "time": 0.2, "intensity": 8.0},
            {"index": 8, "time": 0.8, "intensity": 7.0},
        ]

        aligned = server.adjust_peaks_to_expected(
            peaks,
            3,
            times,
            values,
            speech_start=0.0,
            speech_end=1.0,
        )

        self.assertEqual([round(item["time"], 1) for item in aligned], [0.2, 0.6, 0.8])

    def test_expected_peak_alignment_does_not_invent_silence_peak(self):
        times = np.arange(0.0, 1.01, 0.1)
        peaks = [{"index": 2, "time": 0.2, "intensity": 8.0}]

        aligned = server.adjust_peaks_to_expected(
            peaks,
            2,
            times,
            np.zeros_like(times),
            speech_start=0.0,
            speech_end=1.0,
        )

        self.assertEqual(len(aligned), 1)
        self.assertEqual(aligned[0]["time"], 0.2)

    def test_candidates_require_voicing_and_finite_intensity_evidence(self):
        result = server.select_native_acoustic_candidates(
            [
                candidate(0.2, 72.0, 0.9, voiced=False),
                candidate(0.4, float("nan"), 0.9),
            ],
            target_count=1,
        )
        self.assertEqual(result["rawCandidateCount"], 2)
        self.assertEqual(result["evidenceCandidateCount"], 0)
        self.assertEqual(result["selectedCount"], 0)
        self.assertIn("ACOUSTIC_COUNT_MISMATCH", result["conflicts"])

    def test_native_analysis_contract_keeps_raw_contours_on_count_conflict(self):
        raw = {
            "duration": 0.8,
            "sampleRate": 16000,
            "pitch": {"times": [0.1], "values": [150.0]},
            "intensity": {"times": [0.1], "values": [70.0]},
            "syllables": [
                candidate(0.2, 72.0, 0.9)["syllable"],
                candidate(0.5, 73.0, 0.9)["syllable"],
            ],
        }
        result = server.build_analysis_v2_response(
            raw,
            expected_syllable_count=1,
            native=True,
        )
        self.assertEqual(result["analysisVersion"], "pronunciation-analysis-v2")
        self.assertFalse(result["quality"]["rateable"])
        self.assertIn("ACOUSTIC_COUNT_MISMATCH", result["quality"]["reasons"])
        self.assertTrue(result["capabilities"]["showNativeGraphs"])
        self.assertEqual(result["segmentation"]["rawCandidateCount"], 2)

    def test_native_graphs_remain_available_when_count_is_valid_but_stress_is_uncertain(self):
        raw = {
            "duration": 0.6,
            "sampleRate": 16000,
            "pitch": {"times": [0.1, 0.3], "values": [150.0, 151.0]},
            "intensity": {"times": [0.1, 0.3], "values": [70.0, 70.1]},
            "syllables": [
                {
                    "startTime": 0.0, "endTime": 0.2, "duration": 0.2,
                    "vowelDuration": 0.15, "avgPitch": 150.0, "maxPitch": 155.0,
                    "intensity": 70.0,
                },
                {
                    "startTime": 0.2, "endTime": 0.4, "duration": 0.2,
                    "vowelDuration": 0.15, "avgPitch": 151.0, "maxPitch": 156.0,
                    "intensity": 70.1,
                },
            ],
        }
        result = server.build_analysis_v2_response(
            raw,
            expected_syllable_count=2,
            native=True,
        )
        self.assertTrue(result["quality"]["rateable"])
        self.assertTrue(result["capabilities"]["showNativeGraphs"])
        self.assertFalse(result["observed"]["stressEvidence"]["rateable"])

    def test_final_lengthening_alone_does_not_override_other_prominence(self):
        syllables = [
            {"avgPitch": 220, "vowelDuration": 0.24, "duration": 0.27, "intensity": 78},
            {"avgPitch": 140, "vowelDuration": 0.15, "duration": 0.33, "intensity": 69},
        ]
        result = server.score_lexical_stress_v2(syllables)
        self.assertEqual(result["primaryStress"], 0)
        self.assertTrue(result["rateable"])

    def test_low_prominence_margin_is_unrateable(self):
        syllables = [
            {"avgPitch": 150, "vowelDuration": 0.18, "duration": 0.20, "intensity": 70},
            {"avgPitch": 151, "vowelDuration": 0.18, "duration": 0.20, "intensity": 70.1},
        ]
        result = server.score_lexical_stress_v2(syllables)
        self.assertIsNone(result["primaryStress"])
        self.assertFalse(result["rateable"])
        self.assertIn("LOW_STRESS_CONFIDENCE", result["reasons"])

    def test_learner_v2_endpoint_forwards_expected_count_as_hint(self):
        server.app.testing = True
        client = server.app.test_client()
        fake_result = {
            "analysisVersion": "pronunciation-analysis-v2",
            "quality": {"rateable": False, "confidence": 0, "reasons": ["NO_SPEECH"]},
            "segmentation": {"rawCandidateCount": 0, "selectedCount": 0},
            "observed": {"syllableCount": 0, "primaryStress": None, "syllables": []},
            "pitch": {"times": [], "values": []},
            "intensity": {"times": [], "values": []},
        }
        with patch.object(server, "analyze_audio_v2", return_value=fake_result) as analyze:
            response = client.post(
                "/analyze/v2",
                data={
                    "audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav"),
                    "expected_syllables": "7",
                },
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        analyze.assert_called_once()
        self.assertEqual(analyze.call_args.kwargs["expected_syllable_count"], 7)
        self.assertFalse(analyze.call_args.kwargs["native"])


# ============================================================================
# V3 PHONEME ALIGNMENT / COMPARISON TESTS
# ============================================================================


class PronunciationAlignmentV3EditOpsTest(unittest.TestCase):
    """Tests for _phoneme_align_edit_ops and _build_v3_comparison."""

    def test_perfect_match_all_ops_are_match(self):
        ops = server._phoneme_align_edit_ops(['h', 'ɛ', 'l'], ['h', 'ɛ', 'l'])
        self.assertEqual(len(ops), 3)
        for op in ops:
            self.assertEqual(op['op'], 'match')

    def test_substitution_detected(self):
        ops = server._phoneme_align_edit_ops(['h', 'ɛ', 'l'], ['h', 'æ', 'l'])
        op_types = [o['op'] for o in ops]
        self.assertIn('substitution', op_types)
        sub = [o for o in ops if o['op'] == 'substitution'][0]
        self.assertEqual(sub['ref'], 'ɛ')
        self.assertEqual(sub['obs'], 'æ')

    def test_deletion_when_observed_shorter(self):
        ops = server._phoneme_align_edit_ops(['h', 'ɛ', 'l', 'oʊ'], ['h', 'ɛ', 'l'])
        op_types = [o['op'] for o in ops]
        self.assertIn('deletion', op_types)
        deleted = [o for o in ops if o['op'] == 'deletion']
        self.assertEqual(len(deleted), 1)
        self.assertEqual(deleted[0]['ref'], 'oʊ')
        self.assertIsNone(deleted[0]['obs'])

    def test_insertion_when_observed_longer(self):
        ops = server._phoneme_align_edit_ops(['h', 'ɛ'], ['h', 'ɛ', 'l'])
        op_types = [o['op'] for o in ops]
        self.assertIn('insertion', op_types)
        inserted = [o for o in ops if o['op'] == 'insertion']
        self.assertEqual(len(inserted), 1)
        self.assertIsNone(inserted[0]['ref'])
        self.assertEqual(inserted[0]['obs'], 'l')

    def test_mixed_operations(self):
        # Reference: h ɛ l oʊ
        # Observed:  h æ l oʊ z
        ops = server._phoneme_align_edit_ops(
            ['h', 'ɛ', 'l', 'oʊ'],
            ['h', 'æ', 'l', 'oʊ', 'z'],
        )
        op_types = [o['op'] for o in ops]
        self.assertIn('match', op_types)
        self.assertIn('substitution', op_types)
        self.assertIn('insertion', op_types)

    def test_count_delta_positive_when_more_observed(self):
        comparison = server._build_v3_comparison('hɛl', ['h', 'ɛ', 'l'], 3, 2)
        self.assertIsNotNone(comparison)
        self.assertEqual(comparison['count_delta'], 1)  # 3 - 2

    def test_reference_ipa_is_tokenized_into_phonemes_not_characters(self):
        comparison = server._build_v3_comparison(
            '/foʊˈtæɡrəf/',
            ['f', 'oʊ', 't', 'æ', 'ɡ', 'r', 'ə', 'f'],
            3,
            3,
        )
        self.assertEqual(
            [operation['op'] for operation in comparison['edit_operations']],
            ['match'] * 8,
        )
        self.assertNotIn('/', [operation['ref'] for operation in comparison['edit_operations']])
        self.assertNotIn('ˈ', [operation['ref'] for operation in comparison['edit_operations']])

    def test_count_delta_negative_when_fewer_observed(self):
        comparison = server._build_v3_comparison('hɛl', ['h', 'ɛ', 'l'], 1, 2)
        self.assertIsNotNone(comparison)
        self.assertEqual(comparison['count_delta'], -1)  # 1 - 2

    def test_count_delta_zero_when_equal(self):
        comparison = server._build_v3_comparison('hɛl', ['h', 'ɛ', 'l'], 2, 2)
        self.assertIsNotNone(comparison)
        self.assertEqual(comparison['count_delta'], 0)

    def test_count_delta_none_when_no_expected(self):
        comparison = server._build_v3_comparison('hɛl', ['h', 'ɛ', 'l'], 2, None)
        self.assertIsNotNone(comparison)
        self.assertIsNone(comparison['count_delta'])

    def test_comparison_none_when_no_reference(self):
        comparison = server._build_v3_comparison(None, ['h', 'ɛ', 'l'], 2, 2)
        self.assertIsNone(comparison)

    def test_comparison_none_when_empty_reference(self):
        comparison = server._build_v3_comparison('', ['h', 'ɛ', 'l'], 2, 2)
        self.assertIsNone(comparison)

    def test_empty_observed_all_deletions(self):
        ops = server._phoneme_align_edit_ops(['h', 'ɛ', 'l'], [])
        self.assertEqual(len(ops), 3)
        for op in ops:
            self.assertEqual(op['op'], 'deletion')

    def test_empty_reference_all_insertions(self):
        ops = server._phoneme_align_edit_ops([], ['h', 'ɛ', 'l'])
        self.assertEqual(len(ops), 3)
        for op in ops:
            self.assertEqual(op['op'], 'insertion')

    def test_both_empty_no_ops(self):
        ops = server._phoneme_align_edit_ops([], [])
        self.assertEqual(len(ops), 0)

    def test_tie_breaking_prefers_match_over_substitution(self):
        # When a match is possible on diagonal, it should be taken
        ops = server._phoneme_align_edit_ops(['a', 'b'], ['a', 'b'])
        self.assertEqual(ops[0]['op'], 'match')
        self.assertEqual(ops[1]['op'], 'match')

    def test_single_phoneme_match(self):
        ops = server._phoneme_align_edit_ops(['ɛ'], ['ɛ'])
        self.assertEqual(len(ops), 1)
        self.assertEqual(ops[0]['op'], 'match')

    def test_single_phoneme_substitution(self):
        ops = server._phoneme_align_edit_ops(['ɛ'], ['æ'])
        self.assertEqual(len(ops), 1)
        self.assertEqual(ops[0]['op'], 'substitution')
        self.assertEqual(ops[0]['ref'], 'ɛ')
        self.assertEqual(ops[0]['obs'], 'æ')


if __name__ == "__main__":
    unittest.main()
