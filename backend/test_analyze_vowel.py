#!/usr/bin/env python3
import io
import os
import sys
import unittest
import wave

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'local_server'))
import server  # type: ignore


def build_vowel_like_wav_bytes(
    sample_rate: int = 16000,
    duration_seconds: float = 0.45,
    f0: float = 120.0
) -> bytes:
    sample_count = int(sample_rate * duration_seconds)
    times = np.arange(sample_count, dtype=np.float32) / sample_rate

    # Shape the harmonic spectrum so Praat sees a voiced, vowel-like region.
    formants = ((700.0, 90.0), (1200.0, 120.0), (2600.0, 180.0))
    signal = np.zeros(sample_count, dtype=np.float32)
    for harmonic in range(1, 61):
        freq = harmonic * f0
        envelope = 0.0
        for center, bandwidth in formants:
            envelope += np.exp(-0.5 * ((freq - center) / bandwidth) ** 2)
        signal += (envelope / harmonic) * np.sin(2 * np.pi * freq * times)

    attack = max(1, int(sample_rate * 0.05))
    release = max(1, int(sample_rate * 0.07))
    amplitude = np.ones(sample_count, dtype=np.float32)
    amplitude[:attack] = np.linspace(0.0, 1.0, attack, endpoint=False)
    amplitude[-release:] = np.linspace(1.0, 0.0, release, endpoint=False)
    signal *= amplitude

    peak = float(np.max(np.abs(signal)) or 1.0)
    signal = signal / peak

    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes((signal * 32767.0).astype(np.int16).tobytes())
    return wav_buffer.getvalue()


class AnalyzeVowelEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.app.testing = True
        cls.client = server.app.test_client()
        cls.wav_bytes = build_vowel_like_wav_bytes()

    def test_returns_exploratory_vowel_hint(self):
        response = self.client.post(
            '/analyze-vowel',
            data={
                'audio': (io.BytesIO(self.wav_bytes), 'vowel.wav'),
                'itemId': 'core-sheep-001',
                'targetPhoneme': 'i',
                'category': 'vowel'
            },
            content_type='multipart/form-data'
        )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertTrue(payload.get('exploratory'))
        self.assertTrue(payload.get('usable'))
        self.assertIsNone(payload.get('reason'))
        self.assertIn('nucleusStart', payload)
        self.assertIn('nucleusEnd', payload)
        self.assertGreater(len(payload.get('samples', [])), 0)
        self.assertEqual(len(payload['samples']), 3)
        self.assertIn('midPitch', payload)

    def test_rejects_non_vowel_items(self):
        response = self.client.post(
            '/analyze-vowel',
            data={
                'audio': (io.BytesIO(self.wav_bytes), 'consonant.wav'),
                'itemId': 'core-thin-001',
                'targetPhoneme': 'th',
                'category': 'consonant'
            },
            content_type='multipart/form-data'
        )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertTrue(payload.get('exploratory'))
        self.assertFalse(payload.get('usable'))
        self.assertEqual(payload.get('reason'), 'non_vowel_item')


if __name__ == '__main__':
    unittest.main()
