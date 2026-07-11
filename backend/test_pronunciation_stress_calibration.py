import json
import os
import subprocess
import sys
import tempfile
import unittest


SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "scripts",
    "audit",
    "pronunciation-stress-calibration.py",
)


def build_calibration_records(count=240):
    records = []
    for index in range(count):
        syllable_count = 2 + (index % 3)
        primary = index % syllable_count
        syllables = []
        for syllable_index in range(syllable_count):
            stressed = syllable_index == primary
            syllables.append({
                "avgPitch": 185 + (index % 7) if stressed else 132 + (syllable_index * 3),
                "vowelDuration": 0.21 if stressed else 0.12,
                "duration": 0.24 if stressed else (0.23 if syllable_index == syllable_count - 1 else 0.15),
                "intensity": 75 if stressed else 67 + (syllable_index % 2),
            })
        records.append({
            "word": f"calibration{index:03d}",
            "primaryStress": primary,
            "syllables": syllables,
            "source": "validated-native-recording-fixture",
        })
    return records


class PronunciationStressCalibrationScriptTest(unittest.TestCase):
    def test_fixed_seed_calibration_meets_heldout_gates(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "records.json")
            output_path = os.path.join(temp_dir, "report.json")
            with open(input_path, "w", encoding="utf-8") as output:
                json.dump(build_calibration_records(), output)

            completed = subprocess.run(
                [
                    sys.executable,
                    SCRIPT_PATH,
                    "--input",
                    input_path,
                    "--seed",
                    "20260711",
                    "--output",
                    output_path,
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            with open(output_path, encoding="utf-8") as report_file:
                report = json.load(report_file)
            self.assertEqual(report["sampleSize"], 240)
            self.assertGreaterEqual(report["heldout"]["exactStressAccuracy"], 0.90)
            self.assertGreaterEqual(report["heldout"]["scoredAccuracy"], 0.95)
            self.assertTrue(report["gates"]["passed"])
            self.assertAlmostEqual(sum(report["configuration"]["weights"].values()), 1.0)
            self.assertEqual(
                report["configuration"]["weights"],
                {"pitch": 0.5, "duration": 0.3, "intensity": 0.2},
            )
            self.assertEqual(report["configuration"]["confidenceThreshold"], 0.65)


if __name__ == "__main__":
    unittest.main()
