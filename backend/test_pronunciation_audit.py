import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

from backend.local_server.pronunciation_reference import (
    build_pronunciation_reference,
    build_pronunciation_variant,
)


SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "scripts",
    "audit",
    "pronunciation-reference-audit.py",
)

WORDS = {
    "car": ("ˈkɑɚ", "car", 1, 0),
    "expire": ("ɪkˈspaɪɚ", "ex·pire", 2, 1),
    "media": ("ˈmidiə", "me·di·a", 3, 0),
    "tunnel": ("ˈtʌnl̩", "tun·nel", 2, 0),
    "record": ("ˈrɛkɚd", "rec·ord", 2, 0),
}


def reference_for(word):
    raw_ipa, headword, _, _ = WORDS[word]
    is_fallback = word == "media"
    variant = build_pronunciation_variant(
        word=word,
        part_of_speech="noun",
        definition=None if is_fallback else "fixture",
        entry_id=word,
        exact_match=True,
        raw_ipa=raw_ipa,
        headword=headword,
        audio_filename=None if is_fallback else f"{word}.mp3",
        audio_url=None if is_fallback else f"https://media.merriam-webster.com/{word}.mp3",
        source_provider=(
            "cmu-pronouncing-dictionary" if is_fallback else "merriam-webster"
        ),
        source_transcription=(
            "cmu-arpabet-converted" if is_fallback else "merriam-webster-ipa"
        ),
    )
    variants = [variant]
    if word == "car":
        variants.append(build_pronunciation_variant(
            word=word,
            part_of_speech="verb",
            definition="metadata-only fixture",
            entry_id="car:2",
            exact_match=True,
            raw_ipa=None,
            headword="car",
            audio_filename=None,
            audio_url=None,
        ))
    return build_pronunciation_reference(
        word=word,
        variants=variants,
        deployment_version="fixture-sha",
    )


class AuditHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def do_GET(self):
        prefix = "/dictionary/v2/"
        if not self.path.startswith(prefix):
            self.send_error(404)
            return
        word = unquote(self.path[len(prefix):])
        if word not in WORDS:
            self.send_error(404)
            return
        payload = reference_for(word)
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/analyze-url/v2":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length) or b"{}")
        count = request["expectedSyllableCount"]
        payload = {
            "analysisVersion": "pronunciation-analysis-v2",
            "variantId": request["variantId"],
            "canonicalSyllableCount": count,
            "quality": {"rateable": True, "confidence": 0.95, "reasons": []},
            "segmentation": {
                "rawCandidateCount": count,
                "evidenceCandidateCount": count,
                "selectedCount": count,
                "method": "acoustic-candidate-selection",
                "confidence": 0.95,
                "conflicts": [],
            },
            "observed": {
                "syllableCount": count,
                "primaryStress": 0,
                "syllables": [
                    {
                        "avgPitch": 180 if index == 0 else 130,
                        "vowelDuration": 0.2 if index == 0 else 0.12,
                        "duration": 0.24 if index == 0 else 0.15,
                        "intensity": 74 if index == 0 else 67,
                    }
                    for index in range(count)
                ],
            },
            "pitch": {"times": [], "values": []},
            "intensity": {"times": [], "values": []},
            "capabilities": {"showNativeGraphs": True},
        }
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class PronunciationReferenceAuditTest(unittest.TestCase):
    def test_parameterized_audit_preserves_machine_readable_evidence(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), AuditHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                output_path = os.path.join(temp_dir, "audit.json")
                completed = subprocess.run(
                    [
                        sys.executable,
                        SCRIPT_PATH,
                        "--base-url",
                        f"http://127.0.0.1:{server.server_port}",
                        "--source-mode",
                        "v2",
                        "--words",
                        ",".join(WORDS),
                        "--sample-size",
                        str(len(WORDS)),
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
                self.assertEqual(report["summary"]["http500s"], 0)
                self.assertEqual(report["summary"]["incorrectScoreable"], 0)
                self.assertEqual(report["summary"]["validated"], len(WORDS))
                self.assertEqual(report["summary"]["graphCountMismatches"], 0)
                self.assertEqual(report["summary"]["runtimeFallbackValidated"], 1)
                self.assertEqual(report["summary"]["selectableConflictVariants"], 0)
                self.assertEqual(report["summary"]["evidenceOnlyConflictVariants"], 1)
                self.assertEqual(report["summary"]["sourceDialectViolations"], 0)
                self.assertEqual(report["summary"]["nonUsSourceLabelViolations"], 0)
                media_row = next(row for row in report["rows"] if row["word"] == "media")
                self.assertFalse(media_row["cmuCorroborated"])
                self.assertTrue(report["gates"]["passed"])
                self.assertEqual(len(report["rows"]), len(WORDS))
                self.assertEqual(len(report["calibrationRecords"]), 3)
                self.assertNotIn(
                    "media",
                    {item["word"] for item in report["calibrationRecords"]},
                )
                self.assertTrue(all(
                    item["source"] == "validated-native-recording-audit"
                    for item in report["calibrationRecords"]
                ))
        finally:
            server.shutdown()
            server.server_close()


class PronunciationAuditLogicTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location("audit_script", SCRIPT_PATH)
        cls.audit = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.audit)

    def test_manifest_determinism_and_hashing(self):
        frame = [f"word{i}" for i in range(100)]
        seed = 20260712
        size = 30
        
        # Test generation
        manifest1, hash1 = self.audit.generate_manifest(frame, seed, size)
        manifest2, hash2 = self.audit.generate_manifest(frame, seed, size)
        
        self.assertEqual(manifest1["words"], manifest2["words"])
        self.assertEqual(hash1, hash2)
        self.assertEqual(len(manifest1["words"]), size)
        self.assertEqual(len(set(manifest1["words"])), size)
        self.assertEqual(manifest1["manifest_hash"], hash1)
        self.assertEqual(manifest1["seed"], seed)
        
        # Test hash stability
        expected_hash = self.audit.calculate_stable_hash(manifest1["words"])
        self.assertEqual(hash1, expected_hash)
        
        # Test validation helper
        self.assertTrue(self.audit.validate_manifest_hash(manifest1))
        
        # Tampering detection
        tampered = json.loads(json.dumps(manifest1))
        tampered["words"][0] = "tampered"
        self.assertFalse(self.audit.validate_manifest_hash(tampered))

    def test_cohort_splitting_disjointness(self):
        frame = [f"word{i}" for i in range(100)]
        seed = 20260712
        size = 30
        manifest, _ = self.audit.generate_manifest(frame, seed, size)
        
        cohorts = self.audit.split_into_cohorts(manifest["words"], 3)
        self.assertEqual(len(cohorts), 3)
        self.assertEqual(len(cohorts[0]), 10)
        self.assertEqual(len(cohorts[1]), 10)
        self.assertEqual(len(cohorts[2]), 10)
        
        # Assert disjoint
        c1 = set(cohorts[0])
        c2 = set(cohorts[1])
        c3 = set(cohorts[2])
        self.assertTrue(c1.isdisjoint(c2))
        self.assertTrue(c1.isdisjoint(c3))
        self.assertTrue(c2.isdisjoint(c3))
        self.assertEqual(c1 | c2 | c3, set(manifest["words"]))

    def test_reject_insufficient_sampling_frame(self):
        frame = ["word1", "word2"]
        with self.assertRaises(ValueError):
            self.audit.generate_manifest(frame, seed=123, manifest_size=10)

    def test_file_lock_mutual_exclusion(self):
        import tempfile
        import threading
        with tempfile.TemporaryDirectory() as temp_dir:
            lock_path = os.path.join(temp_dir, "test.lock")
            lock = self.audit.FileLock(lock_path)
            
            shared_list = []
            def worker():
                with lock:
                    shared_list.append("start")
                    time.sleep(0.1)
                    shared_list.append("end")

            t1 = threading.Thread(target=worker)
            t2 = threading.Thread(target=worker)
            
            t1.start()
            time.sleep(0.02)
            t2.start()
            t1.join()
            t2.join()
            
            # If mutual exclusion works, t2 must wait until t1 finishes,
            # so the list should be ['start', 'end', 'start', 'end']
            self.assertEqual(shared_list, ["start", "end", "start", "end"])

    def test_ledger_resume_and_validation(self):
        import tempfile
        with tempfile.TemporaryDirectory() as temp_dir:
            ledger_path = os.path.join(temp_dir, "ledger.jsonl")
            
            manifest_hash = "hash123"
            deployment = "v1"
            algorithm = "algo1"
            
            # 1. Test empty ledger
            completed = self.audit.get_completed_words_from_ledger(
                ledger_path, manifest_hash, deployment, algorithm
            )
            self.assertEqual(len(completed), 0)
            
            # 2. Test writing events
            self.audit.write_ledger_event(ledger_path, {
                "manifest_hash": manifest_hash,
                "deployment_version": deployment,
                "algorithm_version": algorithm,
                "word": "word1",
                "status": "in_progress",
                "timestamp": "2026-07-12T12:00:00Z"
            })
            
            completed = self.audit.get_completed_words_from_ledger(
                ledger_path, manifest_hash, deployment, algorithm
            )
            self.assertNotIn("word1", completed)  # only in_progress, not completed
            
            # Write complete
            self.audit.write_ledger_event(ledger_path, {
                "manifest_hash": manifest_hash,
                "deployment_version": deployment,
                "algorithm_version": algorithm,
                "word": "word1",
                "status": "complete",
                "timestamp": "2026-07-12T12:01:00Z"
            })
            
            completed = self.audit.get_completed_words_from_ledger(
                ledger_path, manifest_hash, deployment, algorithm
            )
            self.assertIn("word1", completed)
            
            # 3. Test that ledger from another deployment/algorithm is ignored
            completed_other = self.audit.get_completed_words_from_ledger(
                ledger_path, manifest_hash, "v2", algorithm
            )
            self.assertEqual(len(completed_other), 0)
            
            # 4. Test terminal failure is counted as completed (skips rerunning)
            self.audit.write_ledger_event(ledger_path, {
                "manifest_hash": manifest_hash,
                "deployment_version": deployment,
                "algorithm_version": algorithm,
                "word": "word2",
                "status": "terminal_failure",
                "timestamp": "2026-07-12T12:02:00Z"
            })
            completed = self.audit.get_completed_words_from_ledger(
                ledger_path, manifest_hash, deployment, algorithm
            )
            self.assertIn("word2", completed)

    def test_aggregate_reports_correctness(self):
        import tempfile
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = os.path.join(temp_dir, "manifest.json")
            report_path = os.path.join(temp_dir, "report-2000.json")
            
            words = [f"word{i}" for i in range(30)]
            manifest_data = {
                "seed": 20260712,
                "manifest_hash": self.audit.calculate_stable_hash(words),
                "words": words
            }
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest_data, f)
                
            # Create cohort-1-rows.jsonl (first 10 words)
            cohort_1_path = os.path.join(temp_dir, "cohort-1-rows.jsonl")
            with open(cohort_1_path, "w", encoding="utf-8") as f:
                for idx in range(10):
                    row = {
                        "word": words[idx],
                        "validated": True,
                        "cmuCorroborated": True,
                        "httpStatus": 200,
                        "errors": [],
                        "provenance": {
                            "base_url": "http://127.0.0.1",
                            "git_sha": "gitsha1",
                            "deployment_version": "v1",
                            "algorithm_version": "algo1"
                        }
                    }
                    f.write(json.dumps(row) + "\n")
                    
            # Create cohort-2-rows.jsonl (next 10 words)
            cohort_2_path = os.path.join(temp_dir, "cohort-2-rows.jsonl")
            with open(cohort_2_path, "w", encoding="utf-8") as f:
                for idx in range(10, 20):
                    row = {
                        "word": words[idx],
                        "validated": True,
                        "cmuCorroborated": True,
                        "httpStatus": 200,
                        "errors": ["SOURCE_DIALECT_MISMATCH"] if idx == 15 else [],
                        "provenance": {
                            "base_url": "http://127.0.0.1",
                            "git_sha": "gitsha1",
                            "deployment_version": "v1",
                            "algorithm_version": "algo1"
                        }
                    }
                    f.write(json.dumps(row) + "\n")
                    
            # Run aggregation through cohort 2
            # Should fail the gates because word 15 has an error
            exit_code = self.audit.aggregate_reports(manifest_path, 2, report_path)
            self.assertEqual(exit_code, 1)  # failed gates
            
            # Verify report file exists
            self.assertTrue(os.path.exists(report_path))
            with open(report_path, encoding="utf-8") as f:
                report = json.load(f)
            self.assertEqual(report["summary"]["sampleSize"], 20)
            self.assertEqual(report["summary"]["incorrectScoreable"], 1)
            self.assertFalse(report["gates"]["passed"])
            
            # Verify review queue contains the failing word
            review_queue_path = os.path.join(temp_dir, "review-queue.json")
            self.assertTrue(os.path.exists(review_queue_path))
            with open(review_queue_path, encoding="utf-8") as f:
                review_queue = json.load(f)
            self.assertEqual(len(review_queue), 1)
            self.assertEqual(review_queue[0]["word"], "word15")
            self.assertIn("SOURCE_DIALECT_MISMATCH", review_queue[0]["reasons"])
            
            # Verify summary.md exists
            summary_md_path = os.path.join(temp_dir, "summary.md")
            self.assertTrue(os.path.exists(summary_md_path))
            with open(summary_md_path, encoding="utf-8") as f:
                summary_md = f.read()
            self.assertIn("Cohort 1", summary_md)
            self.assertIn("Cohort 2", summary_md)


if __name__ == "__main__":
    unittest.main()

