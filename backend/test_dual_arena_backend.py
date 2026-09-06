"""Tests for Dual Arena Option B and Nucleus Prosody endpoints and duration normalization."""

import json
import io
import unittest
import numpy as np
from pathlib import Path
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'local_server'))
from server import (
    app,
    find_stressed_with_corrections,
    normalize_syllable_pattern,
)


def _make_dummy_wav(duration_s=0.5, freq=200.0, sample_rate=16000):
    t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False)
    # Generate simple sine wave
    data = 0.5 * np.sin(2 * np.pi * freq * t)
    # Convert to 16-bit PCM
    pcm = (data * 32767).astype(np.int16)
    
    buf = io.BytesIO()
    # Write WAV header
    data_size = len(pcm) * 2
    buf.write(b'RIFF')
    buf.write((36 + data_size).to_bytes(4, 'little'))
    buf.write(b'WAVEfmt ')
    buf.write((16).to_bytes(4, 'little'))
    buf.write((1).to_bytes(2, 'little'))  # PCM
    buf.write((1).to_bytes(2, 'little'))  # Mono
    buf.write(sample_rate.to_bytes(4, 'little'))
    buf.write((sample_rate * 2).to_bytes(4, 'little'))
    buf.write((2).to_bytes(2, 'little'))
    buf.write((16).to_bytes(2, 'little'))
    buf.write(b'data')
    buf.write(data_size.to_bytes(4, 'little'))
    buf.write(pcm.tobytes())
    buf.seek(0)
    return buf


class TestDurationNormalization(unittest.TestCase):
    def test_normalize_syllable_pattern_prefers_vowel_duration(self):
        syllables = [
            {'maxPitch': 220, 'avgPitch': 210, 'duration': 0.40, 'vowelDuration': 0.15, 'intensity': 75},
            {'maxPitch': 180, 'avgPitch': 175, 'duration': 0.30, 'vowelDuration': 0.25, 'intensity': 70},
        ]
        norm = normalize_syllable_pattern(syllables)
        self.assertEqual(len(norm), 2)
        # Max vowel duration is 0.25, so second syllable should have dur_rel = 1.0, first = 0.15/0.25 = 0.6
        self.assertAlmostEqual(norm[0]['dur_rel'], 0.15 / 0.25, places=3)
        self.assertAlmostEqual(norm[1]['dur_rel'], 1.0, places=3)

    def test_find_stressed_with_corrections_uses_vowel_duration(self):
        # Without vowel duration, syllable 0 has larger total duration (0.40 vs 0.25)
        # But syllable 1 has longer vowel duration (0.22 vs 0.10) and higher pitch
        syllables = [
            {'maxPitch': 190, 'avgPitch': 180, 'duration': 0.45, 'vowelDuration': 0.10, 'intensity': 70},
            {'maxPitch': 240, 'avgPitch': 230, 'duration': 0.25, 'vowelDuration': 0.22, 'intensity': 75},
        ]
        stressed_idx = find_stressed_with_corrections(syllables)
        # Syllable 1 should win because of higher pitch + longer vowel duration
        self.assertEqual(stressed_idx, 1)


class TestDualArenaEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_analyze_nucleus_prosody_endpoint(self):
        wav_buf = _make_dummy_wav(duration_s=0.6, freq=220.0)
        intervals = [
            {'id': 0, 'phoneme': 'oʊ', 'startTime': 0.05, 'endTime': 0.25},
            {'id': 1, 'phoneme': 'ə', 'startTime': 0.30, 'endTime': 0.45},
        ]
        response = self.client.post(
            '/analyze-nucleus-prosody',
            data={
                'audio': (wav_buf, 'test.wav', 'audio/wav'),
                'intervals': json.dumps(intervals),
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get('success'))
        self.assertIn('intervals', data)
        self.assertEqual(len(data['intervals']), 2)
        item0 = data['intervals'][0]
        self.assertEqual(item0['phoneme'], 'oʊ')
        self.assertGreater(item0['maxPitch'], 0)
        self.assertGreater(item0['peakIntensity'], 0)
        self.assertAlmostEqual(item0['vowelDuration'], 0.20, places=2)

    def test_analyze_option_b_endpoint(self):
        wav_buf = _make_dummy_wav(duration_s=0.6, freq=210.0)
        response = self.client.post(
            '/analyze/option-b',
            data={
                'audio': (wav_buf, 'test.wav', 'audio/wav'),
                'word': 'record',
                'reference_ipa': 'ˈrɛk.ɚd',
                'expected_syllables': '2',
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('engine'), 'option-b')
        self.assertEqual(data.get('targetWord'), 'record')
        self.assertIn('syllables', data)
        self.assertIn('detectedStressedIndex', data)
        self.assertTrue(len(data['syllables']) > 0)
        s0 = data['syllables'][0]
        self.assertIn('sylStartTime', s0)
        self.assertIn('sylEndTime', s0)
        self.assertIn('nucleusStartTime', s0)
        self.assertIn('nucleusEndTime', s0)

    def test_analyze_option_b_infers_syllables_from_reference_ipa(self):
        wav_buf = _make_dummy_wav(duration_s=0.7, freq=220.0)
        # Without explicit expected_syllables parameter
        response = self.client.post(
            '/analyze/option-b',
            data={
                'audio': (wav_buf, 'test.wav', 'audio/wav'),
                'word': 'photograph',
                'reference_ipa': 'ˈfoʊ.tə.ɡræf',
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('targetWord'), 'photograph')
        self.assertIn('syllables', data)
        self.assertIn('v4Syllabification', data)

    def test_analyze_nucleus_prosody_empty_intervals(self):
        wav_buf = _make_dummy_wav(duration_s=0.4, freq=200.0)
        response = self.client.post(
            '/analyze-nucleus-prosody',
            data={
                'audio': (wav_buf, 'test.wav', 'audio/wav'),
                'intervals': '[]',
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('intervals'), [])

    def test_analyze_nucleus_prosody_silence(self):
        # Silent audio buffer
        wav_buf = _make_dummy_wav(duration_s=0.4, freq=0.0)
        intervals = [{'id': 0, 'phoneme': 'ə', 'startTime': 0.1, 'endTime': 0.3}]
        response = self.client.post(
            '/analyze-nucleus-prosody',
            data={
                'audio': (wav_buf, 'test.wav', 'audio/wav'),
                'intervals': json.dumps(intervals),
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get('success'))
        self.assertEqual(len(data['intervals']), 1)
        self.assertEqual(data['intervals'][0]['maxPitch'], 0.0)

    def test_audio_duration_guard_under_90ms_option_b(self):
        # 50ms audio buffer should trigger 90ms duration guard with HTTP 400
        short_wav = _make_dummy_wav(duration_s=0.05, freq=220.0)
        response = self.client.post(
            '/analyze/option-b',
            data={
                'audio': (short_wav, 'short.wav', 'audio/wav'),
                'word': 'test',
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertFalse(data.get('success'))
        self.assertIn('90ms', data.get('error', ''))

    def test_audio_duration_guard_under_90ms_nucleus_prosody(self):
        short_wav = _make_dummy_wav(duration_s=0.06, freq=220.0)
        response = self.client.post(
            '/analyze-nucleus-prosody',
            data={
                'audio': (short_wav, 'short.wav', 'audio/wav'),
                'intervals': '[]',
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertFalse(data.get('success'))
        self.assertIn('90ms', data.get('error', ''))

    def test_option_b_prominence_syncs_with_detected_stress(self):
        wav_buf = _make_dummy_wav(duration_s=0.6, freq=220.0)
        response = self.client.post(
            '/analyze/option-b',
            data={
                'audio': (wav_buf, 'test.wav', 'audio/wav'),
                'word': 'photograph',
                'reference_ipa': 'ˈfoʊ.tə.ɡræf',
                'expected_syllables': '3',
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        syllables = data.get('syllables', [])
        detected_idx = data.get('detectedStressedIndex', 0)
        self.assertTrue(len(syllables) > 0)
        # Verify detected_idx has highest prominence
        stressed_prom = syllables[detected_idx].get('prominence', 0)
        for i, s in enumerate(syllables):
            self.assertLessEqual(s.get('prominence', 0), stressed_prom + 0.001)
            self.assertEqual(s.get('isStressed'), i == detected_idx)


if __name__ == '__main__':
    unittest.main()
