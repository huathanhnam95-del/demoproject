import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.write_essay_support.audit import (  # noqa: E402
    aggregate_audit_records,
    apply_component_decision,
    component_dependencies,
)
from scripts.write_essay_support.generator import build_template_candidate  # noqa: E402
from scripts.write_essay_support.contracts import (  # noqa: E402
    SupportContractError,
    validate_manifest,
    validate_pack,
)
from scripts.write_essay_support.sources import (  # noqa: E402
    load_collocation_allowlist,
    load_question_sources,
)


class WriteEssaySupportContractsTest(unittest.TestCase):
    def test_real_sources_cover_all_questions_and_levels(self):
        source = load_question_sources(ROOT)
        self.assertEqual(len(source.questions), 453)
        self.assertEqual(source.invalid_questions, {"370": ["missing_prompt"]})
        self.assertEqual(set(source.questions), {
            str(int(row[0]))
            for row in __import__("openpyxl").load_workbook(
                ROOT / "public/database/Write Essay/PTE_453_Cleaned_Prompts_Topics_Task_Types.xlsx",
                read_only=True,
                data_only=True,
            )["453 Prompts"].iter_rows(min_row=5, values_only=True)
            if row[0]
        })
        for question in source.questions.values():
            if question["id"] != "370":
                self.assertTrue(question["prompt"])
            self.assertIn(question["promptType"], {
                "agree_disagree",
                "advantages_disadvantages",
                "choose_between",
                "problems_solutions",
                "other",
                "discuss_both_views",
                "responsibility",
            })
            levels = question["sampleResponses"]["levels"]
            self.assertEqual(set(levels), {"a2_b1", "b2", "c1"})
            self.assertTrue(any(v.get("essay")
                                for level in levels.values()
                                for v in level.get("variants", [])))

    def test_collocation_allowlist_is_normalized_from_pearson_workbook(self):
        allowlist = load_collocation_allowlist(ROOT)
        self.assertGreaterEqual(len(allowlist), 2000)
        self.assertIn("academic achievement", allowlist)
        self.assertIn("government intervention", allowlist)

    def test_pack_contract_requires_all_levels_and_provenance(self):
        pack = {
            "schemaVersion": "EssaySupportPackV1",
            "questionId": "1",
            "prompt": "A prompt for testing.",
            "source": {"promptSha256": __import__("hashlib").sha256(b"A prompt for testing.").hexdigest()},
            "common": {
                "promptSegments": [],
                "requirements": [],
                "angles": [],
                "promptTraps": [],
                "faq": [],
            },
            "levels": {
                level: {
                    "cefrEvidence": "evidence",
                    "coreTargets": [],
                    "languageKit": {"vocabulary": [], "grammar": [], "cohesion": []},
                    "plans": [],
                    "scaffolds": {},
                }
                for level in ("a2_b1", "b2", "c1")
            },
            "audit": {"status": "PASSED_MAJORITY", "components": {}},
        }
        self.assertIs(validate_pack(pack), pack)
        invalid = dict(pack)
        invalid["levels"] = {"b2": pack["levels"]["b2"]}
        with self.assertRaises(SupportContractError):
            validate_pack(invalid)

    def test_manifest_rejects_quarantined_or_stale_entries(self):
        manifest = {
            "schemaVersion": "EssaySupportManifestV1",
            "contentVersion": "v1",
            "questions": {
                "1": {"url": "/database/Write Essay/support/v1/packs/q0001.ab.json", "sha256": "a" * 64,
                       "levels": ["a2_b1", "b2", "c1"], "status": "PUBLISHED"},
            },
        }
        self.assertIs(validate_manifest(manifest), manifest)
        invalid = json.loads(json.dumps(manifest))
        invalid["questions"]["1"]["status"] = "QUARANTINED"
        with self.assertRaises(SupportContractError):
            validate_manifest(invalid)

    def test_pack_rejects_unsupported_collocation_and_unsafe_html(self):
        source = load_question_sources(ROOT)
        candidate = build_template_candidate(source.questions["1"], source.collocations)
        candidate["levels"]["b2"]["languageKit"]["collocations"] = [{
            "term": "invented unsupported collocation",
            "enGloss": "not official",
            "viGloss": "không chính thức",
        }]
        with self.assertRaises(SupportContractError):
            validate_pack(candidate, source.collocations)
        candidate = build_template_candidate(source.questions["1"], source.collocations)
        candidate["common"]["faq"][0]["answerEn"] = "<script>alert(1)</script>"
        with self.assertRaises(SupportContractError):
            validate_pack(candidate, source.collocations)

    def test_majority_pass_is_accepted_but_debate_revision_requires_three_passes(self):
        majority = apply_component_decision(
            {"dr": "PASS", "qw": "PASS", "gm": "FAIL"},
            revised=False,
        )
        self.assertEqual(majority["status"], "PASSED_MAJORITY")
        revised = apply_component_decision(
            {"dr": "PASS", "qw": "PASS", "gm": "FAIL"},
            revised=True,
        )
        self.assertEqual(revised["status"], "QUARANTINED")
        unanimous = apply_component_decision(
            {"dr": "PASS", "qw": "PASS", "gm": "PASS"},
            revised=True,
        )
        self.assertEqual(unanimous["status"], "REVISED_WITH_UNANIMOUS_CONSENSUS")

    def test_aggregate_counts_are_derived_and_dependencies_are_explicit(self):
        records = [
            {"questionId": "1", "components": {
                "promptBreakdown": {"status": "PASSED_MAJORITY"},
                "angles": {"status": "REVISED_WITH_UNANIMOUS_CONSENSUS"},
            }},
            {"questionId": "2", "components": {
                "promptBreakdown": {"status": "QUARANTINED"},
            }},
        ]
        aggregate = aggregate_audit_records(records)
        self.assertEqual(aggregate["questionsProcessed"], 2)
        self.assertEqual(aggregate["componentStatusCounts"]["PASSED_MAJORITY"], 1)
        self.assertEqual(aggregate["componentStatusCounts"]["REVISED_WITH_UNANIMOUS_CONSENSUS"], 1)
        self.assertEqual(aggregate["componentStatusCounts"]["QUARANTINED"], 1)
        self.assertEqual(component_dependencies("promptBreakdown"), {"angles", "languageKit", "plans", "scaffolds", "faq"})

    def test_template_candidate_is_question_specific_and_has_progressive_scaffolds(self):
        source = load_question_sources(ROOT)
        candidate = build_template_candidate(source.questions["1"], source.collocations)
        self.assertEqual(candidate["questionId"], "1")
        self.assertIn("Education", candidate["common"]["topics"])
        for level in ("a2_b1", "b2", "c1"):
            level_data = candidate["levels"][level]
            self.assertLessEqual(len(level_data["coreTargets"]), 6)
            self.assertTrue(level_data["scaffolds"])
            for scaffold_list in level_data["scaffolds"].values():
                for scaffold in scaffold_list:
                    self.assertTrue(all(field in scaffold for field in ("purpose", "ideaCue", "frame", "modelSentence")))

    def test_template_candidate_rejects_missing_prompt_source(self):
        source = load_question_sources(ROOT)
        with self.assertRaises(ValueError):
            build_template_candidate(source.questions["370"], source.collocations)


if __name__ == "__main__":
    unittest.main()
