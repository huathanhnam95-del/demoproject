import importlib.util
import json
import pathlib
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "benchmarks" / "build_pronunciation_calibration_dataset.py"


def load_module():
    spec = importlib.util.spec_from_file_location("pronunciation_calibration_dataset", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PronunciationCalibrationDatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_validate_score_scale_rejects_unexpected_values(self):
        with self.assertRaises(ValueError):
            self.module.validate_score_scale([0, 1, 9, 10, 11])

    def test_public_stress_scale_rejects_values_outside_documented_set(self):
        self.module.validate_public_stress_scale([5, 10, 10, 5, 10])
        with self.assertRaises(ValueError):
            self.module.validate_public_stress_scale([5, 8, 10, 10, 10])

    def test_four_rater_stress_consensus_requires_extreme_scores(self):
        self.assertEqual(
            self.module.classify_stress_consensus([8, 9, 10, 8, 7]), "correct"
        )
        self.assertEqual(
            self.module.classify_stress_consensus([6, 5, 4, 6, 7]), "incorrect"
        )
        self.assertIsNone(self.module.classify_stress_consensus([8, 7, 9, 6, 6]))

    def test_count_consensus_requires_four_matching_raters(self):
        self.assertEqual(self.module.classify_count_consensus([3, 3, 3, 3, 2]), 3)
        self.assertIsNone(self.module.classify_count_consensus([3, 3, 2, 2, 3]))

    def test_eligibility_excludes_children_and_reports_reason(self):
        row = {
            "speaker_id": "spk-child",
            "age_group": "child",
            "stress_scores": [9, 9, 9, 9, 9],
            "word_accuracy_scores": [9, 9, 9, 9, 9],
            "word": "banana",
            "syllable_count": 3,
        }
        eligible, reasons = self.module.evaluate_eligibility(row, lexical_holdout=set())
        self.assertFalse(eligible)
        self.assertIn("child_speaker", reasons)

    def test_manifest_is_read_dynamically_and_provenance_is_written(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest = pathlib.Path(temp_dir) / "manifest.json"
            output = pathlib.Path(temp_dir) / "dataset.json"
            manifest.write_text(json.dumps({"samples": [{"id": "a", "status": "clean"}]}), encoding="utf-8")
            records = self.module.read_vietnamese_manifest(manifest)
            self.assertEqual(len(records), 1)
            provenance = self.module.build_provenance("https://example.test/archive.tar.gz", "abc", "2026-07-30T00:00:00Z")
            self.assertEqual(provenance["license"], "CC BY 4.0")
            self.assertEqual(provenance["archive_sha256"], "abc")

    def test_official_archive_url_and_format_match_openslr(self):
        self.assertTrue(self.module.SPEECHOCEAN_URL.endswith("speechocean762.tar.gz"))

    def test_observed_count_excludes_deleted_vowels_and_counts_insertions(self):
        self.assertEqual(self.module.observed_vowel_count("B (EH0) R [AH0]"), 1)
        self.assertEqual(self.module.observed_vowel_count("K {AO0} L"), 1)

    def test_parser_flattens_word_ratings_and_excludes_child_speakers(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            (root / "train").mkdir()
            (root / "test").mkdir()
            (root / "train" / "utt2spk").write_text("adultutt 0100\nchildutt 0001\n", encoding="utf-8")
            (root / "train" / "spk2age").write_text("0100 25\n0001 8\n", encoding="utf-8")
            (root / "train" / "spk2gender").write_text("0100 f\n0001 m\n", encoding="utf-8")
            (root / "train" / "wav.scp").write_text(
                "adultutt WAVE/SPEAKER0100/adultutt.WAV\n"
                "childutt WAVE/SPEAKER0001/childutt.WAV\n",
                encoding="utf-8",
            )
            (root / "test" / "utt2spk").write_text("", encoding="utf-8")
            (root / "test" / "spk2age").write_text("", encoding="utf-8")
            (root / "test" / "spk2gender").write_text("", encoding="utf-8")
            (root / "test" / "wav.scp").write_text("", encoding="utf-8")
            scores = {
                "adultutt": {
                    "words": [{
                        "text": "BANANA",
                        "ref-phones": "B AH0 N AE1 N AH0",
                        "accuracy": [10, 9, 10, 9, 10],
                        "stress": [10, 10, 10, 10, 10],
                        "phones": [
                            "B AH0 N AE1 N AH0",
                            "B AH0 N AE1 N AH0",
                            "B AH0 N AE1 N AH0",
                            "B AH0 N AE1 N AH0",
                            "B AH0 N AE1 N AH0"
                        ]
                    }]
                },
                "childutt": {
                    "words": [{
                        "text": "CAMERA",
                        "ref-phones": "K AE1 M ER0 AH0",
                        "accuracy": [10, 10, 10, 10, 10],
                        "stress": [10, 10, 10, 10, 10],
                        "phones": ["K AE1 M ER0 AH0"] * 5
                    }]
                }
            }
            (root / "scores-detail.json").write_text(json.dumps(scores), encoding="utf-8")
            rows = self.module.parse_public_corpus(root)
            self.assertEqual([row["word"] for row in rows], ["banana"])
            self.assertEqual(rows[0]["speaker_id"], "0100")
            self.assertEqual(rows[0]["official_split"], "train")
            self.assertEqual(rows[0]["count_scores"], [3, 3, 3, 3, 3])
            self.assertEqual(rows[0]["expected_primary_stress"], 1)
            self.assertTrue(pathlib.Path(rows[0]["audio_path"]).as_posix().endswith("WAVE/SPEAKER0100/adultutt.WAV"))
            self.assertEqual(rows[0]["utterance_reference_phones"], "B AH0 N AE1 N AH0")
            self.assertEqual(rows[0]["word_phone_range"], [0, 6])

    def test_official_test_speakers_remain_untouched(self):
        rows = [
            {"speaker_id": "train-a", "official_split": "train"},
            {"speaker_id": "train-b", "official_split": "train"},
            {"speaker_id": "test-a", "official_split": "test"},
        ]
        split = self.module.split_speakers(rows)
        self.assertEqual([row["speaker_id"] for row in split["test"]], ["test-a"])

    def test_training_speaker_split_preserves_rare_stress_class_on_both_sides(self):
        rows = []
        for index in range(20):
            rows.append({
                "speaker_id": f"speaker-{index}",
                "official_split": "train",
                "label_stress": 0 if index < 5 else 1,
            })
        split = self.module.split_speakers(rows)
        calibration_rare = {row["speaker_id"] for row in split["calibration"] if row["label_stress"] == 0}
        training_rare = {row["speaker_id"] for row in split["train"] if row["label_stress"] == 0}
        self.assertGreaterEqual(len(calibration_rare), 2)
        self.assertGreaterEqual(len(training_rare), 1)

    def test_lexical_holdout_is_reserved_not_excluded(self):
        rows = [{
            "id": "u1:0",
            "speaker_id": "adult-a",
            "official_split": "train",
            "word": "banana",
            "syllable_count": 3,
            "stress_scores": [10, 10, 10, 10, 10],
            "word_accuracy_scores": [10, 10, 10, 10, 10],
            "count_scores": [3, 3, 3, 3, 3],
        }]
        dataset = self.module.build_dataset(rows, lexical_holdout={"banana"})
        self.assertEqual(len(dataset["records"]), 1)
        self.assertEqual(dataset["records"][0]["split"], "lexical_holdout")
        self.assertTrue(dataset["records"][0]["lexical_holdout"])
        self.assertEqual(dataset["exclusions"], [])

    def test_source_recording_does_not_cross_into_lexical_holdout(self):
        base = {
            "speaker_id": "adult-a",
            "source_recording_id": "utterance-1",
            "official_split": "train",
            "syllable_count": 2,
            "stress_scores": [10, 10, 10, 10, 10],
            "word_accuracy_scores": [10, 10, 10, 10, 10],
            "count_scores": [2, 2, 2, 2, 2],
        }
        rows = [
            dict(base, id="u1:0", word="banana"),
            dict(base, id="u1:1", word="different"),
        ]
        dataset = self.module.build_dataset(rows, lexical_holdout={"banana"})
        self.assertEqual({row["split"] for row in dataset["records"]}, {"lexical_holdout"})
        self.assertTrue(all(row["holdout_group"] for row in dataset["records"]))

    def test_builder_emits_independent_count_and_stress_labels(self):
        rows = [{
            "id": "u1:0",
            "speaker_id": "adult-a",
            "official_split": "train",
            "word": "banana",
            "syllable_count": 3,
            "stress_scores": [10, 10, 10, 10, 5],
            "word_accuracy_scores": [10, 10, 10, 10, 10],
            "count_scores": [3, 3, 3, 3, 2],
            "expected_primary_stress": 1,
            "dictionary_syllable_count": 3,
        }]
        record = self.module.build_dataset(rows)["records"][0]
        self.assertEqual(record["observed_count"], 3)
        self.assertEqual(record["label_count"], 1)
        self.assertEqual(record["stress_label"], "correct")
        self.assertEqual(record["label_stress"], 1)

    def test_monosyllable_remains_eligible_for_count_only(self):
        rows = [{
            "id": "u1:0",
            "speaker_id": "adult-a",
            "official_split": "train",
            "word": "car",
            "syllable_count": 1,
            "stress_scores": [10, 10, 10, 10, 10],
            "word_accuracy_scores": [10, 10, 10, 10, 10],
            "count_scores": [1, 1, 1, 1, 1],
        }]
        record = self.module.build_dataset(rows)["records"][0]
        self.assertEqual(record["label_count"], 1)
        self.assertIsNone(record["label_stress"])
        self.assertIn("monosyllable_for_stress", record["label_exclusions"])

    def test_exclusion_funnel_counts_all_ineligible_reasons(self):
        rows = [{
            "id": "u1:0",
            "speaker_id": "adult-a",
            "official_split": "train",
            "word": "banana",
            "syllable_count": 3,
            "stress_scores": [10, 5, 10, 5, 5],
            "word_accuracy_scores": [5, 5, 5, 5, 5],
            "count_scores": [3, 2, 3, 2, 1],
            "expected_primary_stress": 1,
            "dictionary_syllable_count": 3,
        }]
        dataset = self.module.build_dataset(rows)
        self.assertEqual(dataset["records"], [])
        self.assertEqual(dataset["exclusion_funnel"]["stress_no_four_rater_agreement"], 1)
        self.assertEqual(dataset["exclusion_funnel"]["count_no_four_rater_agreement"], 1)


if __name__ == "__main__":
    unittest.main()
