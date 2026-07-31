import importlib.util
import pathlib
import tempfile
import unittest
import wave


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "build_kokoro_reference_dataset.py"


def load_module():
    spec = importlib.util.spec_from_file_location("build_kokoro_reference_dataset", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class KokoroReferenceDatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_filename_parser_keeps_voice_and_word_separate(self):
        voice, word = self.module.parse_source(pathlib.Path("kokoro-af_bella-actual.wav"))
        self.assertEqual(voice, "af_bella")
        self.assertEqual(word, "actual")

    def test_build_uses_cmu_count_and_isolated_word_range(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            audio = root / "audio"
            audio.mkdir()
            wav_path = audio / "kokoro-af_bella-actual.wav"
            with wave.open(str(wav_path), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                output.writeframes(b"\0\0" * 160)
            cmu = root / "cmu.json"
            cmu.write_text(json.dumps({"actual": "AE1 K CH AH0 W AH0 L"}), encoding="utf-8")
            result = self.module.build(audio, cmu)
        self.assertEqual(result["records"][0]["syllable_count"], 3)
        self.assertEqual(result["records"][0]["word_phone_range"], [0, 7])


if __name__ == "__main__":
    unittest.main()
