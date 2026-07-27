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


if __name__ == "__main__":
    unittest.main()
