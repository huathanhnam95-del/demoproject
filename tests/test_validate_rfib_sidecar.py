import unittest
from unittest.mock import patch, MagicMock
import sys
import os
import json
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import scripts.validate_rfib_sidecar as validator


class TestValidateRFIBSidecar(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sidecar_path = os.path.join(self.tmp_dir.name, "sidecar.jsonl")

    def tearDown(self):
        self.tmp_dir.cleanup()

    def _create_sample_record(self, qid=1, num_blanks=1, include_vi=True, tom_lai=True, missing_vi_field=None):
        blanks = []
        for b_idx in range(1, num_blanks + 1):
            b = {
                "blank_index": b_idx,
                "correct_answer": "proposal",
                "grammar_tag": "Plural Noun",
                "final_explanation": "The correct answer is 'proposal'.",
                "concise_explanation": "Plural Noun.",
                "confidence": "high",
                "confidence_flags": []
            }
            if include_vi:
                b["vi_explanation"] = "Tóm lại, em cần chọn 'proposal'." if tom_lai else "Em chọn 'proposal'."
                b["vi_raw"] = "Tóm lại, em cần chọn 'proposal'."
                b["vi_model"] = "qwen3:14b"
                b["vi_timestamp"] = "2026-07-27T00:00:00+00:00"

                if missing_vi_field:
                    del b[missing_vi_field]
            blanks.append(b)

        return {
            "id": qid,
            "blanks": blanks,
            "phase_models": ["deepseek-r1:14b", "qwen3:14b", "gemma4:latest"],
            "raw_artifacts": {"dr_raw": "raw1", "qw_raw": "raw2", "gm_raw": "raw3"}
        }

    def _write_sidecar(self, records):
        with open(self.sidecar_path, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")

    @patch("scripts.validate_rfib_sidecar.load_workbook_data")
    def test_valid_sidecar_with_vi_passes(self, mock_wb):
        mock_wb.return_value = {
            1: {"id": 1, "blanks": [{"index": 1}]}
        }
        rec = self._create_sample_record(qid=1, num_blanks=1, include_vi=True)
        self._write_sidecar([rec])

        ok, errors = validator.validate_rfib_sidecar(
            sidecar_path=self.sidecar_path,
            ids=[1],
            check_vi=True
        )
        self.assertTrue(ok)
        self.assertEqual(errors, [])

    @patch("scripts.validate_rfib_sidecar.load_workbook_data")
    def test_missing_tom_lai_fails_check_vi(self, mock_wb):
        mock_wb.return_value = {
            1: {"id": 1, "blanks": [{"index": 1}]}
        }
        rec = self._create_sample_record(qid=1, num_blanks=1, include_vi=True, tom_lai=False)
        self._write_sidecar([rec])

        ok, errors = validator.validate_rfib_sidecar(
            sidecar_path=self.sidecar_path,
            ids=[1],
            check_vi=True
        )
        self.assertFalse(ok)
        self.assertTrue(any("Tóm lại" in err for err in errors))

    @patch("scripts.validate_rfib_sidecar.load_workbook_data")
    def test_missing_vi_field_fails_check_vi(self, mock_wb):
        mock_wb.return_value = {
            1: {"id": 1, "blanks": [{"index": 1}]}
        }
        rec = self._create_sample_record(qid=1, num_blanks=1, include_vi=True, missing_vi_field="vi_raw")
        self._write_sidecar([rec])

        ok, errors = validator.validate_rfib_sidecar(
            sidecar_path=self.sidecar_path,
            ids=[1],
            check_vi=True
        )
        self.assertFalse(ok)
        self.assertTrue(any("vi_raw" in err for err in errors))

    @patch("scripts.validate_rfib_sidecar.load_workbook_data")
    def test_duplicate_id_fails(self, mock_wb):
        mock_wb.return_value = {1: {"id": 1, "blanks": [{"index": 1}]}}
        rec1 = self._create_sample_record(qid=1)
        rec2 = self._create_sample_record(qid=1)
        self._write_sidecar([rec1, rec2])

        ok, errors = validator.validate_rfib_sidecar(
            sidecar_path=self.sidecar_path,
            ids=[1]
        )
        self.assertFalse(ok)
        self.assertTrue(any("Duplicate" in err for err in errors))


if __name__ == "__main__":
    unittest.main()
