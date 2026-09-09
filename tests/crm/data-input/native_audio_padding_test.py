"""Offline fixture checks; requires an external CRM_NATIVE_AUDIO_TEST_OUTPUT_ROOT."""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import wave

spec = importlib.util.spec_from_file_location('native_runner', Path(__file__).parents[2] / 'browser/crm-data-input-native/run.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class PaddingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ['CRM_NATIVE_AUDIO_TEST_OUTPUT_ROOT'])
        self.addCleanup(self.temp.cleanup)
        self.raw = Path(self.temp.name) / 'raw.wav'
        self.padded = Path(self.temp.name) / 'microphone.wav'

    def write_raw(self, frames, channels=1, rate=16000):
        with wave.open(str(self.raw), 'wb') as wav:
            wav.setparams((channels, 2, rate, 0, 'NONE', 'not compressed'))
            wav.writeframes(frames)

    def test_exact_pcm_and_silence_with_separate_hashes_and_durations(self):
        pcm = b'\x01\x02\xff\xfe' * 8000
        self.write_raw(pcm)
        original = self.raw.read_bytes()
        evidence = runner.pad_microphone_wav(self.raw, self.padded)
        self.assertEqual(self.raw.read_bytes(), original)
        with wave.open(str(self.padded), 'rb') as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 16000))
            padded = wav.readframes(wav.getnframes())
        offset = 5 * 16000 * 2
        self.assertEqual(padded[:offset], bytes(offset))
        self.assertEqual(padded[offset:offset + len(pcm)], pcm)
        self.assertEqual(padded[offset + len(pcm):], bytes(2 * 16000 * 2))
        self.assertEqual(evidence['raw']['sha256'], hashlib.sha256(original).hexdigest())
        self.assertEqual(evidence['padded']['sha256'], hashlib.sha256(self.padded.read_bytes()).hexdigest())
        self.assertEqual(evidence['raw']['durationSeconds'], 1)
        self.assertEqual(evidence['padded']['durationSeconds'], 8)
        self.assertEqual(evidence['originalPcmOffsetFrames'], 80000)
        self.assertEqual(evidence['originalPcmSha256'], hashlib.sha256(pcm).hexdigest())

    def test_rejects_wrong_format_and_duration_before_output(self):
        for frames, channels, rate in [(b'\0' * 8, 2, 16000), (b'\0' * 8, 1, 8000), (b'', 1, 16000), (bytes(49 * 16000 * 2), 1, 16000)]:
            self.write_raw(frames, channels, rate)
            with self.assertRaises(ValueError):
                runner.pad_microphone_wav(self.raw, self.padded)
            self.assertFalse(self.padded.exists())

    def test_rejects_truncated_pcm(self):
        self.write_raw(bytes(32000))
        self.raw.write_bytes(self.raw.read_bytes()[:-2])
        with self.assertRaises(ValueError):
            runner.pad_microphone_wav(self.raw, self.padded)
        self.assertFalse(self.padded.exists())

    def test_never_overwrites_raw_or_existing_output(self):
        self.write_raw(bytes(32000))
        original = self.raw.read_bytes()
        with self.assertRaises(FileExistsError):
            runner.pad_microphone_wav(self.raw, self.raw)
        self.assertEqual(self.raw.read_bytes(), original)
        self.padded.write_bytes(b'existing')
        with self.assertRaises(FileExistsError):
            runner.pad_microphone_wav(self.raw, self.padded)
        self.assertEqual(self.padded.read_bytes(), b'existing')


if __name__ == '__main__':
    unittest.main()
