"""Unit tests for V4 confidence-weighted acoustic partition refinement."""

import sys
import os
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'local_server'))

from server import _refine_partition_boundaries_with_confidence_weighted_acoustic


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


class TestDiagnosticsOutput(unittest.TestCase):
    def test_corrections_have_required_fields(self):
        spans = [
            _make_span(0.0, 0.15, confidence=0.30,
                       partition_start=0.0, partition_end=0.20),
            _make_span(0.22, 0.40, confidence=0.25,
                       nucleus_start=0.24, nucleus_end=0.36,
                       partition_start=0.20, partition_end=0.45),
        ]
        intensity = _make_intensity(0.0, 0.50)
        result = _refine_partition_boundaries_with_confidence_weighted_acoustic(
            spans, intensity, None, [], 0.50,
        )
        required_keys = {'index', 'correction_type', 'confidence', 'blend_weight', 'shift_ms', 'reason'}
        for c in result['corrections']:
            self.assertTrue(required_keys.issubset(c.keys()), f'Missing keys in {c}')
            self.assertIsInstance(c['index'], int)
            self.assertIsInstance(c['blend_weight'], float)
            self.assertIsInstance(c['shift_ms'], float)
            self.assertIsInstance(c['reason'], str)


if __name__ == '__main__':
    unittest.main()
