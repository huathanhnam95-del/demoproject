import importlib.util
import json
import pathlib
import tempfile
import unittest
import wave


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "build_vietnamese_external_dataset.py"


def load_module():
    spec = importlib.util.spec_from_file_location("build_vietnamese_external_dataset", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VietnameseExternalDatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_builder_preserves_exact_ipa_variant_and_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            audio = root / "audio"
            audio.mkdir()
            sample_id = "actual-clean-l1-vn-01-fixture"
            with wave.open(str(audio / f"{sample_id}.wav"), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                output.writeframes(b"\0\0" * 160)
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"entries": [{
                "sampleId": sample_id,
                "targetWord": "actual",
                "referenceIpa": "/\u02c8\u00e6k.t\u0283u.\u0259l/",
                "targetSyllableCount": 3,
                "category": "clean",
                "speakerCohort": "l1-vn-01",
            }]}), encoding="utf-8")
            result = self.module.build(manifest, audio)
        row = result["records"][0]
        self.assertEqual(row["reference_syllables"], ["\u00e6k", "t\u0283u", "\u0259l"])
        self.assertEqual(row["expected_stress"], 0)
        self.assertEqual(row["label_count"], 1)
        self.assertEqual(row["label_stress"], 1)


if __name__ == "__main__":
    unittest.main()
