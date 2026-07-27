import unittest
from unittest.mock import patch, MagicMock
import sys
import os
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import scripts.revise_rfib_explanations as script


class TestRevisionPipelineCore(unittest.TestCase):
    def test_extract_blanks(self):
        answer = "This is __proposal/reform/change__ and __all/all of which__."
        blanks = script.extract_blanks(answer)
        self.assertEqual(len(blanks), 2)
        self.assertEqual(blanks[0]["index"], 1)
        self.assertEqual(blanks[0]["correct"], "proposal")
        self.assertEqual(blanks[0]["options"], ["proposal", "reform", "change"])
        self.assertEqual(blanks[1]["index"], 2)
        self.assertEqual(blanks[1]["correct"], "all")
        self.assertEqual(blanks[1]["options"], ["all", "all of which"])

    def test_clean_model_response(self):
        raw_think = "<think>Deep reasoning steps here...</think>\n{\n  \"diagnostic_blanks\": []\n}"
        cleaned = script.clean_model_response(raw_think)
        self.assertEqual(cleaned, "{\n  \"diagnostic_blanks\": []\n}")

        raw_codeblock = "```json\n{\n  \"synthesized_blanks\": []\n}\n```"
        cleaned_block = script.clean_model_response(raw_codeblock)
        self.assertEqual(cleaned_block, "{\n  \"synthesized_blanks\": []\n}")

    def test_objective_confidence_rubric_high(self):
        revised_blank = {
            "blank_index": 1,
            "correct_answer": "proposal",
            "grammar_tag": "Plural Noun (Syntactic Fit)",
            "final_explanation": "The correct answer is 'proposal' because 'several proposals' requires a plural noun. * Why 'reform' is incorrect: Reform is singular here. * Why 'change' is incorrect: Change is singular here."
        }
        options = ["proposal", "reform", "change"]
        conf, flags = script.compute_objective_confidence(1, "proposal", options, revised_blank)
        self.assertEqual(conf, "high")
        self.assertEqual(flags, [])

    def test_objective_confidence_rubric_bounds(self):
        # Short explanation (<100 chars)
        short_blank = {
            "blank_index": 1,
            "correct_answer": "proposal",
            "grammar_tag": "Grammar",
            "final_explanation": "Short answer without distractor details."
        }
        options = ["proposal", "reform", "change"]
        conf_short, flags_short = script.compute_objective_confidence(1, "proposal", options, short_blank)
        self.assertIn(conf_short, ["medium", "low"])
        self.assertTrue(any("min 100" in f for f in flags_short))

        # Too long explanation (>1000 chars)
        long_blank = {
            "blank_index": 1,
            "correct_answer": "proposal",
            "grammar_tag": "Plural Noun",
            "final_explanation": "The correct answer is 'proposal'. * Why 'reform' is incorrect: Reform is singular. * Why 'change' is incorrect: Change is singular. " + ("x" * 1050)
        }
        conf_long, flags_long = script.compute_objective_confidence(1, "proposal", options, long_blank)
        self.assertTrue(any("max 1000" in f for f in flags_long))

    def test_find_list_key_nested_structures(self):
        nested_data = {
            "response": {
                "payload": {
                    "items": [
                        {"blank_index": 1, "text": "Reason 1"}
                    ]
                }
            }
        }
        extracted = script._find_list_key(nested_data, "diagnostic_blanks", ["items", "blanks"])
        self.assertIsNotNone(extracted)
        self.assertEqual(len(extracted), 1)
        self.assertEqual(extracted[0]["text"], "Reason 1")

    def test_string_item_coercion_across_parsers(self):
        blanks = [{"index": 1, "correct": "proposal", "options": ["proposal", "reform"]}]

        # Phase 1 string item list
        p1_raw = json.dumps({"diagnostic_blanks": ["Grammar rule explanation for blank 1"]})
        p1_parsed = script.parse_phase1_response(p1_raw, blanks)
        self.assertIsNotNone(p1_parsed)
        self.assertEqual(p1_parsed["diagnostic_blanks"][0]["correct_reason"], "Grammar rule explanation for blank 1")
        self.assertEqual(p1_parsed["diagnostic_blanks"][0]["blank_index"], 1)

        # Phase 2 string item list
        p2_raw = json.dumps({"synthesized_blanks": ["Student explanation string for blank 1"]})
        p2_parsed = script.parse_phase2_response(p2_raw, blanks)
        self.assertIsNotNone(p2_parsed)
        self.assertEqual(p2_parsed["synthesized_blanks"][0]["student_explanation"], "Student explanation string for blank 1")

        # Phase 3 string item list
        p3_raw = json.dumps({"reviewed_blanks": ["Final polished explanation for blank 1"]})
        p3_parsed = script.parse_phase3_response(p3_raw, blanks)
        self.assertIsNotNone(p3_parsed)
        self.assertEqual(p3_parsed["reviewed_blanks"][0]["final_explanation"], "Final polished explanation for blank 1")

    def test_parse_phase1_response(self):
        blanks = [{"index": 1, "correct": "proposal", "options": ["proposal", "reform"]}]
        raw = json.dumps({
            "diagnostic_blanks": [
                {
                    "blank_index": 1,
                    "correct_answer": "proposal",
                    "correct_reason": "Noun required after several.",
                    "distractor_analysis": [{"option": "reform", "why_wrong": "Singular"}],
                    "existing_errors": "",
                    "cohesion_tie": ""
                }
            ]
        })
        parsed = script.parse_phase1_response(raw, blanks)
        self.assertIsNotNone(parsed)
        self.assertEqual(len(parsed["diagnostic_blanks"]), 1)
        self.assertEqual(parsed["diagnostic_blanks"][0]["correct_answer"], "proposal")

    def test_parse_phase2_response(self):
        blanks = [{"index": 1, "correct": "proposal", "options": ["proposal", "reform"]}]
        raw = json.dumps({
            "synthesized_blanks": [
                {
                    "blank_index": 1,
                    "correct_answer": "proposal",
                    "grammar_tag": "Plural Noun",
                    "student_explanation": "Proper explanation with * Why 'reform' is incorrect.",
                    "concise_explanation": "Short summary.",
                    "gaps_flagged": ""
                }
            ]
        })
        parsed = script.parse_phase2_response(raw, blanks)
        self.assertIsNotNone(parsed)
        self.assertEqual(len(parsed["synthesized_blanks"]), 1)

    def test_parse_phase3_response(self):
        blanks = [{"index": 1, "correct": "proposal", "options": ["proposal", "reform"]}]
        raw = json.dumps({
            "reviewed_blanks": [
                {
                    "blank_index": 1,
                    "correct_answer": "proposal",
                    "grammar_tag": "Plural Noun",
                    "final_explanation": "Final polished explanation text.",
                    "concise_explanation": "Concise summary.",
                    "review_notes": "",
                    "disagreements": ""
                }
            ]
        })
        parsed = script.parse_phase3_response(raw, blanks)
        self.assertIsNotNone(parsed)
        self.assertEqual(len(parsed["reviewed_blanks"]), 1)

    @patch("scripts.revise_rfib_explanations.query_ollama")
    def test_process_question_untruncated_raw_artifacts(self, mock_query):
        long_dr_raw = json.dumps({
            "diagnostic_blanks": [{
                "blank_index": 1, "correct_answer": "proposal",
                "correct_reason": "Long reason " + ("A" * 2000),
                "distractor_analysis": [], "existing_errors": "", "cohesion_tie": ""
            }]
        })
        long_qw_raw = json.dumps({
            "synthesized_blanks": [{
                "blank_index": 1, "correct_answer": "proposal",
                "grammar_tag": "Grammar",
                "student_explanation": "Long synth " + ("B" * 2000),
                "concise_explanation": "", "gaps_flagged": ""
            }]
        })
        long_gm_raw = json.dumps({
            "reviewed_blanks": [{
                "blank_index": 1, "correct_answer": "proposal",
                "grammar_tag": "Grammar",
                "final_explanation": "The correct answer is 'proposal'. * Why 'reform' is incorrect: Reform is singular. * Why 'change' is incorrect: Change is singular. Explanation text " + ("C" * 200),
                "concise_explanation": "", "review_notes": "", "disagreements": ""
            }]
        })

        mock_query.side_effect = [long_dr_raw, long_qw_raw, long_gm_raw]

        question = {
            "id": 999,
            "answer_text": "Test __proposal/reform/change__.",
            "full_text": "Test proposal.",
            "blanks": [{"index": 1, "correct": "proposal", "options": ["proposal", "reform", "change"]}]
        }

        rec = script.process_question(999, question, None)
        self.assertIsNotNone(rec)
        self.assertEqual(rec["raw_artifacts"]["dr_raw"], long_dr_raw)
        self.assertEqual(rec["raw_artifacts"]["qw_raw"], long_qw_raw)
        self.assertEqual(rec["raw_artifacts"]["gm_raw"], long_gm_raw)

    @patch("scripts.revise_rfib_explanations.process_question")
    @patch("scripts.revise_rfib_explanations.load_workbook_data")
    @patch("scripts.revise_rfib_explanations.load_existing_explanations")
    @patch("scripts.revise_rfib_explanations.load_sidecar")
    @patch("scripts.revise_rfib_explanations.save_sidecar_atomic")
    def test_main_exits_nonzero_on_failed_ids(self, mock_save, mock_load_sidecar, mock_load_exist, mock_load_wb, mock_process):
        mock_load_wb.return_value = {
            10: {"id": 10, "blanks": []},
            20: {"id": 20, "blanks": []}
        }
        mock_load_exist.return_value = {}
        mock_load_sidecar.return_value = {}
        mock_process.side_effect = [{"id": 10}, None]

        test_args = ["script", "--ids", "10,20"]
        with patch.object(sys, "argv", test_args):
            with self.assertRaises(SystemExit) as cm:
                script.main()
            self.assertEqual(cm.exception.code, 1)

    def test_build_translation_prompt_contains_persona_markers(self):
        exp = "The correct answer is 'received' because Past Simple is used."
        prompt = script.build_translation_prompt(exp)
        self.assertIn("em", prompt)
        self.assertIn("Tóm lại", prompt)
        self.assertIn("PARAPHRASE", prompt)
        self.assertIn("Interactive Vietnamese Teacher Explanation:", prompt)
        self.assertIn(exp, prompt)

    @patch("scripts.revise_rfib_explanations.query_ollama_text")
    def test_translate_blanks_adds_vi_fields_without_overwriting(self, mock_query_text):
        mock_query_text.return_value = "Đáp án đúng là 'received' vì..."

        record = {
            "id": 1,
            "blanks": [{
                "blank_index": 1,
                "correct_answer": "received",
                "grammar_tag": "Past Simple",
                "final_explanation": "The correct answer is 'received'.",
                "concise_explanation": "Past Simple for completed actions.",
                "confidence": "high",
                "confidence_flags": [],
            }]
        }

        original_keys = set(record["blanks"][0].keys())
        result = script.translate_blanks(record)

        # Verify new fields added
        self.assertIn("vi_explanation", result["blanks"][0])
        self.assertIn("vi_model", result["blanks"][0])
        self.assertIn("vi_timestamp", result["blanks"][0])
        self.assertEqual(result["blanks"][0]["vi_explanation"], "Đáp án đúng là 'received' vì...")
        self.assertEqual(result["blanks"][0]["vi_model"], "qwen3:14b")

        # Verify ALL original fields are untouched
        for key in original_keys:
            self.assertIn(key, result["blanks"][0])
        self.assertEqual(result["blanks"][0]["final_explanation"], "The correct answer is 'received'.")
        self.assertEqual(result["blanks"][0]["confidence"], "high")

    def test_query_ollama_text_no_json_format(self):
        """Verify query_ollama_text does NOT include format: json in payload."""
        import inspect
        source = inspect.getsource(script.query_ollama_text)
        # The text query helper must NOT contain '"format"' in its body
        self.assertNotIn('"format"', source)


class TestTranslationContracts(unittest.TestCase):
    def test_translation_prompt_utf8_no_mojibake(self):
        exp = "The correct answer is 'received'."
        prompt = script.build_translation_prompt(exp)
        self.assertIn("Tóm lại", prompt)
        self.assertIn("em", prompt)
        self.assertNotIn("TÃ³m", prompt)
        self.assertNotIn("láº¡i", prompt)
        self.assertIn("PARAPHRASE", prompt)
        self.assertIn(exp, prompt)

    @patch("scripts.revise_rfib_explanations.requests.post")
    def test_query_ollama_text_payload_and_nothink_prefix(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"response": "<think>some internal thought</think>Tóm lại, em cần ghi nhớ..."}
        mock_post.return_value = mock_resp

        res = script.query_ollama_text("qwen3:14b", "Test prompt")
        self.assertEqual(res, "Tóm lại, em cần ghi nhớ...")
        mock_post.assert_called_once()
        payload = mock_post.call_args[1]["json"]
        self.assertNotIn("format", payload)
        self.assertTrue(payload["prompt"].startswith("/no_think\n\n"))

    @patch("scripts.revise_rfib_explanations.query_ollama_text")
    def test_translate_blanks_adds_all_four_vi_fields_and_preserves_raw(self, mock_query):
        mock_query.return_value = "Tóm lại, em nhớ chọn 'received' nhé."

        blank = {
            "blank_index": 1,
            "correct_answer": "received",
            "grammar_tag": "Past Simple",
            "final_explanation": "The correct answer is 'received'.",
            "concise_explanation": "Past Simple.",
            "confidence": "high",
            "confidence_flags": [],
        }
        record = {
            "id": 1,
            "blanks": [blank],
            "raw_artifacts": {"dr_raw": "raw1", "qw_raw": "raw2", "gm_raw": "raw3"}
        }

        updated_record, ok_idx, fail_idx = script.translate_blanks(record)
        b = updated_record["blanks"][0]

        # Check all 4 fields added
        self.assertEqual(b["vi_explanation"], "Tóm lại, em nhớ chọn 'received' nhé.")
        self.assertEqual(b["vi_raw"], "Tóm lại, em nhớ chọn 'received' nhé.")
        self.assertEqual(b["vi_model"], "qwen3:14b")
        self.assertTrue("vi_timestamp" in b)
        self.assertEqual(ok_idx, [1])
        self.assertEqual(fail_idx, [])

        # Check Phase 1-3 byte-for-byte unchanged
        self.assertEqual(b["final_explanation"], "The correct answer is 'received'.")
        self.assertEqual(b["concise_explanation"], "Past Simple.")
        self.assertEqual(b["confidence"], "high")
        self.assertEqual(record["raw_artifacts"]["gm_raw"], "raw3")

    @patch("scripts.revise_rfib_explanations.query_ollama_text")
    def test_translate_blanks_resume_skips_complete_and_translates_missing(self, mock_query):
        mock_query.return_value = "Tóm lại, em chọn 'reform'."

        b1 = {
            "blank_index": 1,
            "final_explanation": "Exp 1",
            "vi_explanation": "Tóm lại, em chọn 'proposal'.",
            "vi_raw": "Tóm lại, em chọn 'proposal'.",
            "vi_model": "qwen3:14b",
            "vi_timestamp": "2026-07-27T00:00:00+00:00"
        }
        b2 = {
            "blank_index": 2,
            "final_explanation": "Exp 2"
        }
        record = {"id": 10, "blanks": [b1, b2]}

        # In resume mode (no_resume=False)
        updated_record, ok_idx, fail_idx = script.translate_blanks(record, no_resume=False)

        # Ollama queried only for blank 2
        mock_query.assert_called_once()
        self.assertEqual(b1["vi_explanation"], "Tóm lại, em chọn 'proposal'.") # Untouched
        self.assertEqual(b2["vi_explanation"], "Tóm lại, em chọn 'reform'.")
        self.assertEqual(ok_idx, [2])
        self.assertEqual(fail_idx, [])

    @patch("scripts.revise_rfib_explanations.query_ollama_text")
    def test_translate_blanks_no_resume_retranslates_existing(self, mock_query):
        mock_query.side_effect = [
            "Tóm lại, new 1.",
            "Tóm lại, new 2."
        ]

        b1 = {
            "blank_index": 1,
            "final_explanation": "Exp 1",
            "vi_explanation": "Old 1",
            "vi_raw": "Old 1",
            "vi_model": "qwen3:14b",
            "vi_timestamp": "2026-07-27T00:00:00+00:00"
        }
        b2 = {
            "blank_index": 2,
            "final_explanation": "Exp 2",
            "vi_explanation": "Old 2",
            "vi_raw": "Old 2",
            "vi_model": "qwen3:14b",
            "vi_timestamp": "2026-07-27T00:00:00+00:00"
        }
        record = {"id": 10, "blanks": [b1, b2]}

        updated_record, ok_idx, fail_idx = script.translate_blanks(record, no_resume=True)

        self.assertEqual(mock_query.call_count, 2)
        self.assertEqual(b1["vi_explanation"], "Tóm lại, new 1.")
        self.assertEqual(b2["vi_explanation"], "Tóm lại, new 2.")
        self.assertEqual(ok_idx, [1, 2])

    @patch("scripts.revise_rfib_explanations.load_sidecar")
    @patch("scripts.revise_rfib_explanations.load_workbook_data")
    def test_cli_missing_ids_exits_code_2(self, mock_load_wb, mock_load_sidecar):
        mock_load_wb.return_value = {1: {"id": 1}}
        mock_load_sidecar.return_value = {1: {"id": 1, "blanks": []}}

        test_args = ["script", "--translate", "--ids", "1,999"]
        with patch.object(sys, "argv", test_args):
            with self.assertRaises(SystemExit) as cm:
                script.main()
            self.assertEqual(cm.exception.code, 2)

    @patch("scripts.revise_rfib_explanations.query_ollama_text")
    @patch("scripts.revise_rfib_explanations.load_sidecar")
    @patch("scripts.revise_rfib_explanations.load_workbook_data")
    @patch("scripts.revise_rfib_explanations.save_sidecar_atomic")
    def test_cli_failed_blank_exits_code_1(self, mock_save, mock_load_wb, mock_load_sidecar, mock_query):
        mock_load_wb.return_value = {1: {"id": 1}}
        mock_load_sidecar.return_value = {
            1: {
                "id": 1,
                "blanks": [{"blank_index": 1, "final_explanation": "Exp 1"}]
            }
        }
        mock_query.return_value = None # Failure

        test_args = ["script", "--translate", "--ids", "1"]
        with patch.object(sys, "argv", test_args):
            with self.assertRaises(SystemExit) as cm:
                script.main()
            self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
