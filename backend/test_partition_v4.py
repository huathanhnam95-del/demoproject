"""Unit tests for V4 confidence-weighted acoustic partition refinement."""

import sys
import os
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'local_server'))

from server import (
    _build_v3_active_response,
    _refine_partition_boundaries_with_confidence_weighted_acoustic,
)


def _make_span(start, end, confidence=0.5, nucleus_start=None, nucleus_end=None,
               partition_start=None, partition_end=None):
    nucleus_start = nucleus_start if nucleus_start is not None else start
    nucleus_end = nucleus_end if nucleus_end is not None else end
    partition_start = partition_start if partition_start is not None else start
    partition_end = partition_end if partition_end is not None else end
    return {
        'start_time': start,
        'end_time': end,
        'confidence': confidence,
        'nucleus_start_time': nucleus_start,
        'nucleus_end_time': nucleus_end,
        'partition_start_time': partition_start,
        'partition_end_time': partition_end,
    }


def _make_intensity(start, end, step=0.01, base_db=60.0, profile=None):
    times = []
    values = []
    t = start
    i = 0
    while t <= end + 0.0001:
        times.append(round(t, 4))
        if profile and i < len(profile):
            values.append(profile[i])
        else:
            values.append(base_db)
        t += step
        i += 1
    return {'times': times, 'values': values}


def _make_pitch(start, end, step=0.01, base_hz=150.0, voiced_until=None):
    times = []
    values = []
    t = start
    while t <= end + 0.0001:
        times.append(round(t, 4))
        if voiced_until is not None and t > voiced_until:
            values.append(None)
        else:
            values.append(base_hz)
        t += step
    return {'times': times, 'values': values}


def _make_acoustic_syl(start, end):
    return {
        'startTime': start,
        'endTime': end,
        'duration': end - start,
        'intensity': 65.0,
    }


class TestHighConfidencePassthrough(unittest.TestCase):
    def test_no_change_above_threshold(self):
        spans = [
            _make_span(0.0, 0.15, confidence=0.60, partition_start=0.0, partition_end=0.20),
            _make_span(0.20, 0.40, confidence=0.70, partition_start=0.20, partition_end=0.50),
        ]
        intensity = _make_intensity(0.0, 0.50)
        pitch = _make_pitch(0.0, 0.50)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, pitch, [], 0.50,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(len(result['corrections']), 2)
        for c in result['corrections']:
            self.assertEqual(c['correction_type'], 'none')
            self.assertEqual(c['blend_weight'], 0.0)
            self.assertEqual(c['shift_ms'], 0.0)


class TestCloudRunPackaging(unittest.TestCase):
    def test_pronunciation_dockerfile_packages_pitch_processing_module(self):
        dockerfile = Path(__file__).with_name('Dockerfile').read_text(encoding='utf-8')
        self.assertIn('COPY backend/local_server/pitch_processing.py ./local_server/pitch_processing.py', dockerfile)
        gcloudignore = Path(__file__).parents[1].joinpath('.gcloudignore').read_text(encoding='utf-8')
        self.assertIn('!backend/local_server/pitch_processing.py', gcloudignore)


class TestBlendWeight(unittest.TestCase):
    def test_low_confidence_full_weight(self):
        spans = [
            _make_span(0.0, 0.15, confidence=0.10, partition_start=0.0, partition_end=0.20),
        ]
        intensity = _make_intensity(0.0, 0.30)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.30,
        )
        self.assertEqual(result['corrections'][0]['blend_weight'], 1.0)

    def test_mid_confidence_partial_weight(self):
        spans = [
            _make_span(0.0, 0.15, confidence=0.375, partition_start=0.0, partition_end=0.20),
        ]
        intensity = _make_intensity(0.0, 0.30)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.30,
        )
        w = result['corrections'][0]['blend_weight']
        self.assertGreater(w, 0.0)
        self.assertLess(w, 1.0)
        self.assertAlmostEqual(w, 0.5, places=1)

    def test_position_penalty_increases_weight(self):
        spans = [
            _make_span(0.0, 0.10, confidence=0.50, partition_start=0.0, partition_end=0.15),
            _make_span(0.15, 0.30, confidence=0.50, partition_start=0.15, partition_end=0.35),
            _make_span(0.35, 0.50, confidence=0.50, partition_start=0.35, partition_end=0.55),
        ]
        intensity = _make_intensity(0.0, 0.55)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.55,
        )
        w_first = result['corrections'][0]['blend_weight']
        w_last = result['corrections'][2]['blend_weight']
        self.assertGreater(w_last, w_first)


class TestOnsetCorrection(unittest.TestCase):
    def test_earlier_praat_anchor_cannot_replace_missing_post_valley_crossing(self):
        spans = [
            _make_span(0.0, 0.18, confidence=0.70,
                       nucleus_start=0.05, nucleus_end=0.15,
                       partition_start=0.0, partition_end=0.35),
            _make_span(0.38, 0.55, confidence=0.10,
                       nucleus_start=0.40, nucleus_end=0.50,
                       partition_start=0.35, partition_end=0.60),
        ]
        # The valley is real, but the post-valley rise stays below the 6 dB
        # threshold.  Praat's earlier start must not synthesize an onset.
        intensity = {
            'times': [0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35],
            'values': [65.0, 65.0, 65.0, 65.0, 45.0, 50.0, 50.0, 50.0, 50.0],
        }
        acoustic_syllables = [
            _make_acoustic_syl(0.02, 0.12),
            _make_acoustic_syl(0.30, 0.42),
        ]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, acoustic_syllables, 0.60,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(spans[1]['partition_start_time'], 0.35)
        self.assertFalse(any(c['correction_type'] == 'onset' for c in result['diagnostics']))

    def test_onset_uses_post_valley_rise_not_pre_valley_frame(self):
        spans = [
            _make_span(0.0, 0.18, confidence=0.70,
                       nucleus_start=0.05, nucleus_end=0.15,
                       partition_start=0.0, partition_end=0.35),
            _make_span(0.38, 0.55, confidence=0.10,
                       nucleus_start=0.40, nucleus_end=0.50,
                       partition_start=0.35, partition_end=0.60),
        ]
        # The first frame in the search window is already above the rise
        # threshold, but it precedes the valley at 0.31s.  The onset must be
        # the first qualifying rise after that valley (0.32s).
        intensity = {
            'times': [0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35],
            'values': [65.0, 65.0, 65.0, 65.0, 45.0, 52.0, 58.0, 64.0, 65.0],
        }
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.60,
        )
        self.assertTrue(result['changed'])
        self.assertAlmostEqual(spans[1]['partition_start_time'], 0.32, places=6)
        onset = next(c for c in result['corrections'] if c['correction_type'] == 'onset')
        self.assertGreater(onset['new'], 0.30)

    def test_onset_moves_earlier_for_low_confidence(self):
        profile_len = 60
        profile = [60.0] * profile_len
        for i in range(20, 30):
            profile[i] = 45.0
        for i in range(30, 40):
            profile[i] = 52.0 + (i - 30)
        for i in range(40, 60):
            profile[i] = 65.0

        spans = [
            _make_span(0.0, 0.18, confidence=0.60,
                       partition_start=0.0, partition_end=0.35),
            _make_span(0.38, 0.55, confidence=0.15,
                       nucleus_start=0.40, nucleus_end=0.50,
                       partition_start=0.35, partition_end=0.60),
        ]
        intensity = _make_intensity(0.0, 0.60, step=0.01, base_db=60.0, profile=profile)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.60,
        )
        self.assertTrue(result['changed'])
        onset_correction = next(
            (c for c in result['corrections'] if c['correction_type'] == 'onset'), None
        )
        self.assertIsNotNone(onset_correction)
        self.assertLess(onset_correction['shift_ms'], 0)

    def test_onset_respects_max_cap(self):
        profile_len = 100
        profile = [60.0] * profile_len
        for i in range(0, 30):
            profile[i] = 40.0
        for i in range(30, 50):
            profile[i] = 55.0 + (i - 30) * 0.5

        spans = [
            _make_span(0.0, 0.20, confidence=0.60,
                       partition_start=0.0, partition_end=0.50),
            _make_span(0.55, 0.90, confidence=0.10,
                       nucleus_start=0.60, nucleus_end=0.80,
                       partition_start=0.50, partition_end=1.0),
        ]
        intensity = _make_intensity(0.0, 1.0, step=0.01, base_db=60.0, profile=profile)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 1.0,
        )
        if result['changed']:
            onset_c = next(
                (c for c in result['corrections'] if c['correction_type'] == 'onset'), None
            )
            if onset_c:
                self.assertGreaterEqual(onset_c['shift_ms'], -80.0)


class TestFinalExtension(unittest.TestCase):
    def test_extends_truncated_final_syllable(self):
        profile = []
        for i in range(50):
            profile.append(65.0)
        for i in range(10):
            profile.append(62.0)
        for i in range(5):
            profile.append(40.0)

        spans = [
            _make_span(0.0, 0.40, confidence=0.15,
                       partition_start=0.0, partition_end=0.50),
        ]
        intensity = _make_intensity(0.0, 0.65, step=0.01, base_db=60.0, profile=profile)
        pitch = _make_pitch(0.0, 0.65, voiced_until=0.58)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, pitch, [], 0.65,
        )
        self.assertTrue(result['changed'])
        ext_c = next(
            (c for c in result['corrections'] if c['correction_type'] == 'final_extension'), None
        )
        self.assertIsNotNone(ext_c)
        self.assertGreater(ext_c['shift_ms'], 0)

    def test_no_extension_for_high_confidence(self):
        spans = [
            _make_span(0.0, 0.40, confidence=0.70,
                       partition_start=0.0, partition_end=0.50),
        ]
        intensity = _make_intensity(0.0, 0.65)
        pitch = _make_pitch(0.0, 0.65, voiced_until=0.60)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, pitch, [], 0.65,
        )
        self.assertFalse(result['changed'])

    def test_extension_capped_at_max(self):
        profile = [65.0] * 80
        spans = [
            _make_span(0.0, 0.40, confidence=0.10,
                       partition_start=0.0, partition_end=0.40),
        ]
        intensity = _make_intensity(0.0, 0.80, step=0.01, base_db=65.0, profile=profile)
        pitch = _make_pitch(0.0, 0.80, voiced_until=0.75)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, pitch, [], 0.80,
        )
        if result['changed']:
            ext_c = next(
                (c for c in result['corrections'] if c['correction_type'] == 'final_extension'), None
            )
            if ext_c:
                self.assertLessEqual(ext_c['shift_ms'], 100.0)


class TestCountMismatchAlignment(unittest.TestCase):
    def test_3ctc_vs_2praat_alignment(self):
        spans = [
            _make_span(0.0, 0.10, confidence=0.30,
                       nucleus_start=0.02, nucleus_end=0.08,
                       partition_start=0.0, partition_end=0.15),
            _make_span(0.15, 0.25, confidence=0.20,
                       nucleus_start=0.17, nucleus_end=0.23,
                       partition_start=0.15, partition_end=0.30),
            _make_span(0.30, 0.45, confidence=0.25,
                       nucleus_start=0.32, nucleus_end=0.42,
                       partition_start=0.30, partition_end=0.50),
        ]
        acoustic_syls = [
            _make_acoustic_syl(0.01, 0.09),
            _make_acoustic_syl(0.28, 0.44),
        ]
        intensity = _make_intensity(0.0, 0.50)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, acoustic_syls, 0.50,
        )
        self.assertEqual(len(result['corrections']), 3)
        self.assertIsInstance(result['changed'], bool)


class TestContiguityInvariant(unittest.TestCase):
    def test_boundaries_remain_contiguous(self):
        profile = [60.0] * 30
        for i in range(10, 20):
            profile[i] = 45.0
        for i in range(20, 30):
            profile.append(65.0)

        spans = [
            _make_span(0.0, 0.10, confidence=0.20,
                       nucleus_start=0.02, nucleus_end=0.08,
                       partition_start=0.0, partition_end=0.15),
            _make_span(0.18, 0.28, confidence=0.15,
                       nucleus_start=0.20, nucleus_end=0.26,
                       partition_start=0.15, partition_end=0.30),
            _make_span(0.32, 0.45, confidence=0.18,
                       nucleus_start=0.34, nucleus_end=0.42,
                       partition_start=0.30, partition_end=0.50),
        ]
        intensity = _make_intensity(0.0, 0.55, step=0.01, base_db=60.0, profile=profile)
        _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.55,
        )
        for i in range(len(spans) - 1):
            self.assertAlmostEqual(
                spans[i]['partition_end_time'],
                spans[i + 1]['partition_start_time'],
                places=6,
                msg=f'Contiguity broken between spans {i} and {i+1}',
            )


class TestGracefulDegradation(unittest.TestCase):
    def test_missing_confidence_diagnostic_survives_none_intensity(self):
        spans = [_make_span(0.0, 0.20, confidence=None,
                            partition_start=0.0, partition_end=0.30)]
        before = [dict(span) for span in spans]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, None, None, [], 0.30,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(len(result['corrections']), 1)
        self.assertEqual(result['corrections'][0]['reason'], 'missing confidence')
        self.assertEqual(result['corrections'][0]['blend_weight'], 0.0)
        self.assertFalse(result['corrections'][0]['mutation'])
        self.assertEqual(result['diagnostics'], [])
        self.assertEqual(spans, before)

    def test_invalid_confidence_diagnostic_survives_empty_intensity(self):
        spans = [_make_span(0.0, 0.20, confidence='bad',
                            partition_start=0.0, partition_end=0.30)]
        before = [dict(span) for span in spans]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, {'times': [], 'values': []}, None, [], 0.30,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(len(result['corrections']), 1)
        self.assertEqual(result['corrections'][0]['reason'], 'invalid confidence')
        self.assertEqual(result['corrections'][0]['blend_weight'], 0.0)
        self.assertFalse(result['corrections'][0]['mutation'])
        self.assertEqual(result['diagnostics'], [])
        self.assertEqual(spans, before)

    def test_none_intensity(self):
        spans = [_make_span(0.0, 0.20, confidence=0.10, partition_start=0.0, partition_end=0.30)]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, None, None, [], 0.30,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(result['corrections'], [])

    def test_empty_spans(self):
        intensity = _make_intensity(0.0, 0.50)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            [], intensity, None, [], 0.50,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(result['corrections'], [])

    def test_missing_pitch(self):
        spans = [
            _make_span(0.0, 0.20, confidence=0.15,
                       partition_start=0.0, partition_end=0.30),
        ]
        intensity = _make_intensity(0.0, 0.40)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.40,
        )
        self.assertIsInstance(result, dict)
        self.assertIn('changed', result)
        self.assertIn('corrections', result)

    def test_empty_acoustic_syllables(self):
        spans = [
            _make_span(0.0, 0.20, confidence=0.15,
                       partition_start=0.0, partition_end=0.30),
        ]
        intensity = _make_intensity(0.0, 0.40)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.40,
        )
        self.assertIsInstance(result, dict)

    def test_invalid_intensity_format(self):
        spans = [_make_span(0.0, 0.20, confidence=0.10, partition_start=0.0, partition_end=0.30)]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, {'times': [0.0], 'values': []}, None, [], 0.30,
        )
        self.assertFalse(result['changed'])


class TestConfidenceValidation(unittest.TestCase):
    def test_all_invalid_confidence_still_reports_zero_weight_diagnostics(self):
        spans = [
            _make_span(0.0, 0.20, confidence=value,
                       partition_start=index * 0.30,
                       partition_end=(index + 1) * 0.30)
            for index, value in enumerate((None, 'bad', float('nan'), -0.1, 1.1))
        ]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, _make_intensity(0.0, 1.50), None, [], 1.50,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(len(result['corrections']), len(spans))
        self.assertEqual(result['diagnostics'], [])
        for correction in result['corrections']:
            self.assertEqual(correction['correction_type'], 'none')
            self.assertEqual(correction['confidence'], 0.0)
            self.assertEqual(correction['blend_weight'], 0.0)

    def test_invalid_or_missing_confidence_is_zero_weight_and_never_raises(self):
        invalid_values = (None, '0.1', float('nan'), -0.1, 1.1)
        intensity = {
            'times': [0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35],
            'values': [65.0, 65.0, 65.0, 65.0, 45.0, 52.0, 58.0, 64.0, 65.0],
        }
        for invalid in invalid_values:
            with self.subTest(confidence=invalid):
                spans = [
                    _make_span(0.0, 0.18, confidence=0.70,
                               nucleus_start=0.05, nucleus_end=0.15,
                               partition_start=0.0, partition_end=0.35),
                    _make_span(0.38, 0.55, confidence=invalid,
                               nucleus_start=0.40, nucleus_end=0.50,
                               partition_start=0.35, partition_end=0.60),
                ]
                result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
                    spans, intensity, None, [], 0.60,
                )
                self.assertFalse(result['changed'])
                confidence_diagnostic = result['corrections'][1]
                self.assertEqual(confidence_diagnostic['correction_type'], 'none')
                self.assertEqual(confidence_diagnostic['confidence'], 0.0)
                self.assertEqual(confidence_diagnostic['blend_weight'], 0.0)
                self.assertFalse(confidence_diagnostic['mutation'])
                self.assertIn(
                    confidence_diagnostic['reason'],
                    {'missing confidence', 'invalid confidence'},
                )

    def test_missing_adjacent_confidence_cannot_enable_interior_correction(self):
        spans = [
            _make_span(0.0, 0.10, confidence=0.70,
                       nucleus_start=0.05, nucleus_end=0.08,
                       partition_start=0.0, partition_end=0.20),
            _make_span(0.30, 0.40, confidence=0.70,
                       nucleus_start=0.32, nucleus_end=0.38,
                       partition_start=0.20, partition_end=0.50),
            _make_span(0.60, 0.70, confidence=None,
                       nucleus_start=0.62, nucleus_end=0.68,
                       partition_start=0.50, partition_end=0.90),
        ]
        acoustic_syllables = [
            _make_acoustic_syl(0.02, 0.12),
            _make_acoustic_syl(0.31, 0.37),
            _make_acoustic_syl(0.52, 0.78),
        ]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, _make_intensity(0.0, 0.90), None, acoustic_syllables, 0.90,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(spans[1]['partition_end_time'], 0.50)
        self.assertEqual(result['corrections'][2]['reason'], 'missing confidence')
        self.assertEqual(result['corrections'][2]['blend_weight'], 0.0)
        self.assertEqual(result['diagnostics'], [])


class TestDiagnosticsOutput(unittest.TestCase):
    def test_compound_final_start_and_end_emit_one_diagnostic_each(self):
        spans = [
            _make_span(0.0, 0.18, confidence=0.70,
                       nucleus_start=0.05, nucleus_end=0.15,
                       partition_start=0.0, partition_end=0.35),
            _make_span(0.38, 0.55, confidence=0.10,
                       nucleus_start=0.40, nucleus_end=0.50,
                       partition_start=0.35, partition_end=0.50),
        ]
        intensity = {
            'times': [round(index * 0.01, 2) for index in range(71)],
            'values': [
                45.0 if 31 <= index <= 31 else
                (52.0 if index == 32 else
                 (58.0 if index == 33 else 65.0))
                for index in range(71)
            ],
        }
        pitch = _make_pitch(0.0, 0.70, voiced_until=0.60)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, pitch, [], 0.70,
        )
        self.assertTrue(result['changed'])
        self.assertEqual(len(result['diagnostics']), 2)
        self.assertEqual(
            {correction['correction_type'] for correction in result['diagnostics']},
            {'onset', 'final_extension'},
        )
        for correction in result['diagnostics']:
            self.assertIn(correction['boundary'], {'partition_start_time', 'partition_end_time'})
            self.assertEqual(
                correction['side'],
                'start' if correction['correction_type'] == 'onset' else 'end',
            )
            self.assertAlmostEqual(
                correction['signed_shift'], correction['new'] - correction['old'], places=6,
            )
            self.assertAlmostEqual(
                correction['signed_shift_ms'], correction['signed_shift'] * 1000.0, places=1,
            )
            self.assertAlmostEqual(
                correction['shift_ms'], correction['signed_shift_ms'], places=1,
            )
            self.assertIn('index', correction)
            self.assertIn('confidence', correction)
            self.assertIn('blend_weight', correction)
            self.assertIn('reason', correction)

    def test_interior_diagnostic_identifies_end_side(self):
        spans = [
            _make_span(0.0, 0.10, confidence=0.70,
                       nucleus_start=0.05, nucleus_end=0.08,
                       partition_start=0.0, partition_end=0.20),
            _make_span(0.30, 0.40, confidence=0.10,
                       nucleus_start=0.32, nucleus_end=0.38,
                       partition_start=0.20, partition_end=0.50),
            _make_span(0.60, 0.70, confidence=0.10,
                       nucleus_start=0.62, nucleus_end=0.68,
                       partition_start=0.50, partition_end=0.90),
        ]
        acoustic_syllables = [
            _make_acoustic_syl(0.02, 0.12),
            _make_acoustic_syl(0.31, 0.37),
            _make_acoustic_syl(0.52, 0.78),
        ]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, _make_intensity(0.0, 0.90), None, acoustic_syllables, 0.90,
        )
        interior = next(c for c in result['diagnostics'] if c['correction_type'] == 'interior')
        self.assertEqual(interior['side'], 'end')
        self.assertEqual(interior['boundary'], 'partition_end_time')

    def test_diagnostics_only_describe_actual_mutations(self):
        spans = [
            _make_span(0.0, 0.15, confidence=0.70, partition_start=0.0, partition_end=0.20),
            _make_span(0.20, 0.40, confidence=0.70, partition_start=0.20, partition_end=0.50),
        ]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, _make_intensity(0.0, 0.50), _make_pitch(0.0, 0.50), [], 0.50,
        )
        self.assertFalse(result['changed'])
        self.assertEqual(result['diagnostics'], [])


class TestPartitionInvariants(unittest.TestCase):
    def test_mutations_remain_monotonic_and_contiguous(self):
        spans = [
            _make_span(0.0, 0.10, confidence=0.10,
                       nucleus_start=0.04, nucleus_end=0.08,
                       partition_start=0.0, partition_end=0.30),
            _make_span(0.20, 0.32, confidence=0.10,
                       nucleus_start=0.22, nucleus_end=0.28,
                       partition_start=0.30, partition_end=0.45),
            _make_span(0.40, 0.55, confidence=0.10,
                       nucleus_start=0.42, nucleus_end=0.50,
                       partition_start=0.45, partition_end=0.60),
        ]
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, _make_intensity(0.0, 0.60), None, [], 0.60,
        )
        self.assertIsInstance(result['changed'], bool)
        boundaries = [spans[0]['partition_start_time']]
        for span in spans:
            boundaries.append(span['partition_end_time'])
        self.assertEqual(boundaries, sorted(boundaries))
        for index, span in enumerate(spans):
            self.assertLess(span['partition_start_time'], span['partition_end_time'])
            if index:
                self.assertEqual(
                    span['partition_start_time'], spans[index - 1]['partition_end_time'],
                )


class TestV3Isolation(unittest.TestCase):
    def test_partition_variants_v4_does_not_mutate_raw_or_measurement_spans(self):
        spans = [
            _make_span(0.0, 0.18, confidence=0.10,
                       nucleus_start=0.05, nucleus_end=0.15,
                       partition_start=0.0, partition_end=0.35),
            _make_span(0.38, 0.55, confidence=0.10,
                       nucleus_start=0.40, nucleus_end=0.50,
                       partition_start=0.35, partition_end=0.60),
        ]
        for span in spans:
            span['measurement_start_time'] = span['start_time']
            span['measurement_end_time'] = span['end_time']
        raw_before = [
            (span['start_time'], span['end_time'],
             span['measurement_start_time'], span['measurement_end_time'])
            for span in spans
        ]
        praat = {
            'duration': 0.70,
            'intensity': _make_intensity(0.0, 0.70),
            'pitch': _make_pitch(0.0, 0.70, voiced_until=0.60),
            'sampleRate': 16000,
            'observed': {'syllables': []},
        }
        response = _build_v3_active_response(
            praat,
            {
                'contract_version': 'recognize-v2',
                'decoded_syllable_count': 2,
                'decoded_is_rateable': True,
                'canonical_alignment': {
                    'syllables': spans,
                    'partition_span_type': 'ctc-interspan-midpoint-contiguous-v1',
                },
            },
            include_partition_variants=True,
        )
        self.assertEqual(
            response['partitionVariants']['schemaVersion'],
            'pronunciation-partition-variants-v2',
        )
        self.assertEqual(
            raw_before,
            [
                (span['start_time'], span['end_time'],
                 span['measurement_start_time'], span['measurement_end_time'])
                for span in spans
            ],
        )
        self.assertEqual(
            [span['partitionStartTime'] for span in response['observed_syllables']],
            [span['startTime'] for span in response['partitionVariants']['v3']],
        )


if __name__ == '__main__':
    unittest.main()
