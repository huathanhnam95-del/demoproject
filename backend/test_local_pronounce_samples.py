import io
import json
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.local_server import server


def make_wav(sample_count=160):
    sample_rate = 16_000
    pcm = b'\x00\x00' * sample_count
    header = b''.join([
        b'RIFF',
        struct.pack('<I', 36 + len(pcm)),
        b'WAVE',
        b'fmt ',
        struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16),
        b'data',
        struct.pack('<I', len(pcm)),
    ])
    return header + pcm


class LocalPronounceSampleRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.app.testing = True
        cls.client = server.app.test_client()

    def test_saves_audio_and_analysis_metadata_under_local_debug_directory(self):
        metadata = {
            'format': 'bel-pronounce-local-sample',
            'schemaVersion': 1,
            'source': 'pronounce-mode-local',
            'sampleId': 'industrial-off-analysis',
            'word': 'industrial',
            'reference': {'syllableCount': 4, 'syllables': [{'label': 'in'}, {'label': 'dus'}, {'label': 'tri'}, {'label': 'al'}]},
            'analysis': {'observedSyllables': [{'startTime': 0.1, 'endTime': 0.2}]},
        }
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {'PRONUNCIATION_DEBUG_SAMPLE_DIR': directory},
            clear=False,
        ):
            response = self.client.post(
                '/debug/pronounce-samples',
                data={
                    'audio': (io.BytesIO(make_wav()), 'industrial-off-analysis.wav'),
                    'metadata': json.dumps(metadata),
                },
                headers={'Origin': 'https://localhost:8443'},
                environ_overrides={'REMOTE_ADDR': '127.0.0.1'},
                content_type='multipart/form-data',
            )

            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            payload = response.get_json()
            self.assertEqual(payload['sampleId'], 'industrial-off-analysis')
            audio_path = Path(payload['audioPath'])
            metadata_path = Path(payload['metadataPath'])
            self.assertTrue(audio_path.exists())
            self.assertTrue(metadata_path.exists())
            self.assertEqual(audio_path.read_bytes(), make_wav())
            saved_metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
            self.assertEqual(saved_metadata['source'], 'pronounce-mode-local')
            self.assertEqual(saved_metadata['audio']['format'], 'wav')
            self.assertEqual(saved_metadata['audio']['bytes'], len(make_wav()))
            self.assertEqual(len(saved_metadata['audio']['sha256']), 64)

    def test_rejects_non_local_origin(self):
        response = self.client.post(
            '/debug/pronounce-samples',
            data={
                'audio': (io.BytesIO(make_wav()), 'sample.wav'),
                'metadata': json.dumps({
                    'source': 'pronounce-mode-local',
                    'word': 'industrial',
                }),
            },
            headers={'Origin': 'https://betterenglishlearning.com'},
            environ_overrides={'REMOTE_ADDR': '127.0.0.1'},
            content_type='multipart/form-data',
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['code'], 'LOCAL_ONLY')


if __name__ == '__main__':
    unittest.main()
