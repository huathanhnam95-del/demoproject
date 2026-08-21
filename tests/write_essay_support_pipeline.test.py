import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.write_essay_support.pipeline import (  # noqa: E402
    AuditEngine,
    build_manifest,
    run_batch,
)
from scripts.write_essay_support.sources import load_question_sources  # noqa: E402


COMPONENTS = ("promptBreakdown", "angles", "languageKit", "plans", "scaffolds", "faq", "eltAudit")


class FakeModelClient:
    def __init__(self, *, initial="PASS", revised="PASS", fail_model=None):
        self.calls = []
        self.initial = initial
        self.revised = revised
        self.fail_model = fail_model
        self.audit_round = 0

    def generate_json(self, model, stage, payload):
        self.calls.append((model, stage))
        if stage == "audit":
            self.audit_round += 1
            verdict = self.initial if self.audit_round <= 3 else self.revised
            if self.fail_model == model:
                verdict = "FAIL"
            return {"components": {component: {"verdict": verdict, "reason": f"{model} {verdict}"} for component in COMPONENTS}}
        if stage == "debate":
            return {"revision": {"common": {}, "levels": {}}}
        if stage == "deepseek_plan":
            return {"plan": {"focus": "prompt-specific writing support"}}
        if stage == "qwen_material":
            return {"material": {}}
        if stage == "gemma_review":
            return {"review": {}}
        raise AssertionError(f"unexpected stage {stage}")


class DependencyAuditClient(FakeModelClient):
    def generate_json(self, model, stage, payload):
        self.calls.append((model, stage))
        if stage == "audit":
            self.audit_round += 1
            if self.audit_round <= 3:
                verdicts = {component: "PASS" for component in COMPONENTS}
                if model != "gemma4:latest": verdicts["promptBreakdown"] = "FAIL"
            else:
                verdicts = {component: "PASS" for component in COMPONENTS}
            return {"components": {component: {"verdict": verdict} for component, verdict in verdicts.items()}}
        if stage == "debate": return {"revision": {"common": {}, "levels": {}}}
        if stage == "deepseek_plan": return {"plan": {}}
        if stage == "qwen_material": return {"material": {}}
        if stage == "gemma_review": return {"review": {}}
        raise AssertionError(f"unexpected stage {stage}")


class WriteEssaySupportPipelineTest(unittest.TestCase):
    def test_audit_engine_records_three_independent_votes_and_majority_status(self):
        client = FakeModelClient(fail_model="gemma4:latest")
        source = load_question_sources(ROOT)
        engine = AuditEngine(client)
        result = engine.audit(source.questions["1"], {"questionId": "1", "common": {}, "levels": {}})
        self.assertEqual(result["components"]["promptBreakdown"]["status"], "PASSED_MAJORITY")
        self.assertEqual(result["components"]["promptBreakdown"]["votes"], {"dr": "PASS", "qw": "PASS", "gm": "FAIL"})
        self.assertEqual(len([call for call in client.calls if call[1] == "audit"]), 3)

    def test_failed_initial_audit_is_quarantined_when_revision_is_not_unanimous(self):
        client = FakeModelClient(initial="FAIL", revised="FAIL")
        source = load_question_sources(ROOT)
        engine = AuditEngine(client)
        result = engine.audit(source.questions["1"], {"questionId": "1", "common": {}, "levels": {}})
        self.assertEqual(result["components"]["promptBreakdown"]["status"], "QUARANTINED")
        self.assertTrue(result["components"]["promptBreakdown"]["debateHistory"])
        self.assertEqual(result["status"], "QUARANTINED")

    def test_upstream_revision_invalidates_and_reaudits_dependents(self):
        client = DependencyAuditClient()
        source = load_question_sources(ROOT)
        result = AuditEngine(client).audit(source.questions["1"], {"questionId": "1", "common": {}, "levels": {}})
        self.assertTrue(result["components"]["angles"]["dependencyInvalidated"])
        self.assertEqual(result["components"]["angles"]["passCount"], 3)
        self.assertEqual(result["components"]["promptBreakdown"]["status"], "REVISED_WITH_UNANIMOUS_CONSENSUS")

    def test_template_batch_publishes_valid_questions_and_reports_invalid_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir)
            report = run_batch(ROOT, output, question_ids=["1", "370"], template_only=True)
            self.assertEqual(report["questionsProcessed"], 2)
            self.assertEqual(report["publishedCount"], 1)
            self.assertEqual(report["sourceInvalidIds"], ["370"])
            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(list(manifest["questions"]), ["1"])
            self.assertEqual(len(list((output / "packs").glob("*.json"))), 1)

    def test_manifest_builder_uses_only_published_pack_records(self):
        manifest = build_manifest([
            {"questionId": "1", "status": "PUBLISHED", "url": "/database/Write Essay/support/v1/packs/q0001.a.json", "sha256": "a" * 64},
            {"questionId": "2", "status": "QUARANTINED", "url": "", "sha256": ""},
        ])
        self.assertEqual(list(manifest["questions"]), ["1"])

    def test_quarantine_rerun_preserves_prior_record_and_does_not_overwrite_full_report(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir)
            first = run_batch(ROOT, output, question_ids=["1"], client=FakeModelClient(initial="FAIL", revised="FAIL"))
            self.assertEqual(first["quarantinedIds"], ["1"])
            original_report = (output / "report.json").read_text(encoding="utf-8")
            rerun = run_batch(ROOT, output, template_only=True, quarantine_only=True)
            self.assertEqual(rerun["publishedCount"], 1)
            self.assertEqual((output / "report.json").read_text(encoding="utf-8"), original_report)
            records = json.loads((output / "audit-records.json").read_text(encoding="utf-8"))
            self.assertEqual(records[0]["status"], "PUBLISHED")
            self.assertEqual(records[0]["previousAuditRecord"]["status"], "QUARANTINED")
            self.assertTrue(rerun["targetedReportPath"])


if __name__ == "__main__":
    unittest.main()
