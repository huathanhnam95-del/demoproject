import importlib.util
import json
import pathlib
import sys
import unittest
from datetime import datetime, timedelta, timezone


ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKER_PATH = ROOT / "scripts" / "essay_local_batch_worker.py"
SPEC = importlib.util.spec_from_file_location("essay_local_batch_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


class EssayLocalBatchWorkerContractTests(unittest.TestCase):
    def test_queue_id_matches_shared_unicode_fixtures(self):
        fixtures = json.loads((ROOT / "tests" / "fixtures" / "essay-ai" / "queue-id-cases.json").read_text(encoding="utf-8"))
        for fixture in fixtures:
            self.assertEqual(worker.compute_queue_id(fixture["uid"], fixture["attemptId"]), fixture["queueId"])

    def test_archive_payload_uses_server_owned_snapshots(self):
        attempt = {
            "ownerUid": "owner-essay-001",
            "practiceScope": "pte",
            "canonicalMode": "write_essay",
            "status": "submitted",
            "promptSnapshot": {"promptId": "prompt-001", "text": "Prompt text"},
            "responseSnapshot": {"text": "A" * 100},
        }
        payload = worker.extract_archive_payload(attempt)
        self.assertEqual(payload["essayText"], "A" * 100)
        self.assertEqual(payload["promptText"], "Prompt text")
        self.assertEqual(payload["questionId"], "prompt-001")

    def test_parse_model_output_removes_multiple_think_blocks_and_fences(self):
        raw = "<think>hidden one</think>\n<think>hidden two</think>\n```json\n{\"scores\": {}}\n```"
        self.assertEqual(worker.parse_model_output(raw), {"scores": {}})

    def test_normalize_result_clamps_scores_and_array_strings(self):
        phase1 = {"scores": {
            "content": {"score": 99, "max": 999, "rationale": "R" * 3000, "evidence": ["E" * 2000] * 5},
            "form": {"score": -4},
        }}
        phase2 = {"sentenceRewrites": [{"original": "o", "improved": "i", "explanation": "x"}] * 5}
        result = worker.normalize_result_snapshot(phase1, phase2, "A" * 10000)
        self.assertEqual(result["scores"]["content"]["score"], 6)
        self.assertEqual(result["scores"]["content"]["max"], 6)
        self.assertEqual(result["scores"]["form"]["score"], 0)
        self.assertLessEqual(len(result["scores"]["content"]["evidence"]), 3)
        self.assertLessEqual(len(result["sentenceRewrites"]), 3)
        self.assertLessEqual(len(result["teacherAdviceChat"]), 4000)
        self.assertEqual(result["overall"]["maxTotal"], 26)

    def test_ollama_error_classification_does_not_consume_model_retry_budget(self):
        self.assertEqual(worker.classify_ollama_error(ConnectionError("connection refused")), "infrastructure")
        self.assertEqual(worker.classify_ollama_error(worker.OllamaHttpError(503, "model loading")), "infrastructure")
        self.assertEqual(worker.classify_ollama_error(worker.ModelOutputError("bad JSON")), "model_output")
        self.assertEqual(worker.classify_ollama_error(RuntimeError("firestore unavailable")), "infrastructure")

    def test_runtime_mode_defaults_to_emulator_and_production_requires_key(self):
        emulator = worker.resolve_runtime_config({})
        self.assertEqual(emulator.mode, "emulator")
        self.assertEqual(emulator.firestore_emulator_host, "127.0.0.1:8080")
        with self.assertRaises(worker.RuntimeConfigurationError):
            worker.resolve_runtime_config({"production": True, "service_account_path": "missing-key.json"})

    def test_claim_accepts_pending_or_expired_processing_and_rejects_active_lease(self):
        now = datetime(2026, 7, 26, tzinfo=timezone.utc)
        pending = {"status": "pending", "retryCount": 0}
        claimed = worker.claim_document_data(pending, "worker-a", now, lease_seconds=600)
        self.assertEqual(claimed["status"], "processing")
        self.assertEqual(claimed["workerId"], "worker-a")
        self.assertIsNone(worker.claim_document_data({"status": "processing", "workerId": "worker-b", "leaseExpiresAt": now + timedelta(minutes=1)}, "worker-a", now, 600))
        reclaimed = worker.claim_document_data({"status": "processing", "workerId": "worker-b", "leaseExpiresAt": now - timedelta(seconds=1)}, "worker-a", now, 600)
        self.assertEqual(reclaimed["workerId"], "worker-a")

    def test_terminal_ids_include_run_generation(self):
        self.assertEqual(worker.completion_notification_id("queue-1", 2), "deep-ai:queue-1:g2:completed")
        self.assertEqual(worker.failure_alert_id("queue-1", 2), "deep-ai-failure:queue-1:g2")
        self.assertEqual(worker.failure_notification_id("queue-1", 2), "deep-ai:queue-1:g2:failed")

    def test_terminal_side_effects_are_deterministic_and_generation_scoped(self):
        effects = worker.build_terminal_side_effects(
            {"uid": "user-1", "attemptId": "attempt-1"},
            "queue-1",
            2,
            "failed",
            "bad output",
            datetime(2026, 7, 26, tzinfo=timezone.utc),
        )
        self.assertEqual(effects["notificationId"], "deep-ai:queue-1:g2:failed")
        self.assertEqual(effects["alertId"], "deep-ai-failure:queue-1:g2")
        self.assertEqual(effects["notification"]["uid"], "user-1")
        self.assertEqual(effects["alert"]["status"], "unresolved")

    def test_failed_reset_increments_generation_and_clears_terminal_fields(self):
        reset = worker.reset_failed_queue_data({
            "status": "failed", "runGeneration": 0, "retryCount": 3,
            "resultSnapshot": {"overall": {"total": 20}}, "error": "bad output",
            "workerId": "old", "isRead": True, "resetCount": 0,
        }, "job-1", datetime(2026, 7, 26, tzinfo=timezone.utc))
        self.assertEqual(reset["status"], "pending")
        self.assertEqual(reset["runGeneration"], 1)
        self.assertEqual(reset["resetCount"], 1)
        self.assertEqual(reset["retryCount"], 0)
        self.assertIsNone(reset["resultSnapshot"])
        self.assertFalse(reset["isRead"])

    def test_scan_cursor_is_ordered_by_timestamp_then_attempt_id(self):
        cursor = worker.encode_scan_cursor(datetime(2026, 7, 26, tzinfo=timezone.utc), "attempt-2")
        self.assertEqual(cursor, {"submittedAt": "2026-07-26T00:00:00+00:00", "attemptId": "attempt-2"})
        self.assertEqual(worker.decode_scan_cursor(cursor)[1], "attempt-2")

    def test_invalid_scan_timestamp_is_rejected_instead_of_using_current_time(self):
        with self.assertRaises(ValueError):
            worker.EssayWorker._coerce_datetime("not-a-date")

    def test_worker_status_readiness_requires_fresh_healthy_heartbeat(self):
        now = datetime(2026, 7, 26, 0, 1, tzinfo=timezone.utc)
        self.assertTrue(worker.is_worker_ready({"lastHeartbeatAt": now, "ollamaReachable": True, "modelsReady": True}, now))
        self.assertFalse(worker.is_worker_ready({"lastHeartbeatAt": now - timedelta(seconds=46), "ollamaReachable": True, "modelsReady": True}, now))
        self.assertFalse(worker.is_worker_ready({"lastHeartbeatAt": now, "ollamaReachable": False, "modelsReady": True}, now))
        self.assertFalse(worker.is_worker_ready({"lastHeartbeatAt": now + timedelta(minutes=5), "ollamaReachable": True, "modelsReady": True}, now))
        self.assertFalse(worker.is_worker_ready({"state": "stopping", "lastHeartbeatAt": now, "ollamaReachable": True, "modelsReady": True}, now))

    def test_scan_lease_refresh_rejects_lost_lease_and_extends_owned_lease(self):
        now = datetime(2026, 7, 26, tzinfo=timezone.utc)
        owned = worker.refresh_scan_lease_data({
            "status": "processing",
            "workerId": "worker-a",
            "leaseExpiresAt": now + timedelta(seconds=1),
        }, "worker-a", now, lease_seconds=600)
        self.assertEqual(owned["leaseExpiresAt"], now + timedelta(seconds=600))
        self.assertIsNone(worker.refresh_scan_lease_data({
            "status": "processing",
            "workerId": "worker-b",
            "leaseExpiresAt": now + timedelta(seconds=1),
        }, "worker-a", now, lease_seconds=600))
        self.assertIsNone(worker.refresh_scan_lease_data({
            "status": "processing",
            "workerId": "worker-a",
            "leaseExpiresAt": now - timedelta(seconds=1),
        }, "worker-a", now, lease_seconds=600))

    def test_completed_scan_does_not_clear_another_jobs_active_lock(self):
        updates = worker.build_control_completion_updates(
            {"activePreviewJobId": "new-job"},
            {"mode": "preview"},
            "old-job",
            datetime(2026, 7, 26, tzinfo=timezone.utc),
        )
        self.assertNotIn("activePreviewJobId", updates)
        self.assertEqual(updates["latestCompletedPreviewJobId"], "old-job")

    def test_worker_loop_honors_single_run_and_continuous_modes(self):
        class FakeWorker:
            def __init__(self, stop_after):
                self.calls = 0
                self.stop_event = worker.threading.Event()
                self.stop_after = stop_after

            def run_once(self):
                self.calls += 1
                if self.calls >= self.stop_after:
                    self.stop_event.set()
                return 1

        once = FakeWorker(stop_after=99)
        self.assertEqual(worker.run_worker_loop(once, single_run=True, poll_seconds=0), 1)
        self.assertEqual(once.calls, 1)

        continuous = FakeWorker(stop_after=2)
        self.assertEqual(worker.run_worker_loop(continuous, single_run=False, poll_seconds=0), 2)
        self.assertEqual(continuous.calls, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
