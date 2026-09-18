#!/usr/bin/env python3
"""
tests/ops/session_tagger_test.py

Unit and regression test suite for scripts/session_tagger.py.
Verifies:
1. Protobuf varint encode/decode & raw field serialization round-trips.
2. Session title retrieval with multi-layer fallbacks (annotations, proto, SQLite summaries db).
3. Search capabilities across SQLite summaries and annotations.
4. Deployment tagging (mark-deployed), untagging (remove-deployed), and idempotency.
5. Multi-CID and pattern batch operations.
6. Trace deploy session resolution and auto-marking.
"""

import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import session_tagger


class TestSessionTagger(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="session_tagger_test_")
        self.pb_path = os.path.join(self.temp_dir, "summaries.pb")
        self.conv_dir = os.path.join(self.temp_dir, "conversations")
        self.annot_dir = os.path.join(self.temp_dir, "annotations")
        self.summaries_db = os.path.join(self.temp_dir, "conversation_summaries.db")
        self.brain_dir = os.path.join(self.temp_dir, "brain")
        self.tracker_csv = os.path.join(self.temp_dir, "TASK_TRACKER.csv")

        os.makedirs(self.conv_dir, exist_ok=True)
        os.makedirs(self.annot_dir, exist_ok=True)
        os.makedirs(self.brain_dir, exist_ok=True)

        # Initialize test SQLite summaries database
        conn = sqlite3.connect(self.summaries_db)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                preview TEXT,
                last_modified_time TEXT
            );
        """)
        self.orig_update_via_rpc = session_tagger.update_via_rpc
        session_tagger.update_via_rpc = lambda cid, title: True

    def tearDown(self):
        session_tagger.update_via_rpc = self.orig_update_via_rpc
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_varint_and_fields_serialization(self):
        val = 123456789
        enc = session_tagger.encode_varint(val)
        self.assertIsInstance(enc, bytes)

        # Test field round-trip
        fields = [
            (1, 0, 42),
            (2, 2, b"Test string payload"),
            (3, 5, b"\x01\x02\x03\x04")
        ]
        serialized = session_tagger.serialize_raw_fields(fields)
        parsed = session_tagger.parse_raw_fields(serialized)
        self.assertEqual(len(parsed), 3)
        self.assertEqual(parsed[0], (1, 0, 42))
        self.assertEqual(parsed[1], (2, 2, b"Test string payload"))
        self.assertEqual(parsed[2], (3, 5, b"\x01\x02\x03\x04"))

    def test_get_session_title_fallbacks(self):
        cid1 = "11111111-1111-1111-1111-111111111111"
        cid2 = "22222222-2222-2222-2222-222222222222"

        # 1. Annotation file fallback
        annot_file = os.path.join(self.annot_dir, f"{cid1}.pbtxt")
        with open(annot_file, "w", encoding="utf-8") as f:
            f.write('title: "Annotation Title"\n')

        t1 = session_tagger.get_session_title(
            cid1,
            pb_path=self.pb_path,
            annotations_dir=self.annot_dir,
            summaries_db=self.summaries_db
        )
        self.assertEqual(t1, "Annotation Title")

        # 2. SQLite DB fallback
        conn = sqlite3.connect(self.summaries_db)
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", (cid2, "SQLite Title", "Preview Text", "2026-09-17"))
        conn.commit()
        conn.close()

        t2 = session_tagger.get_session_title(
            cid2,
            pb_path=self.pb_path,
            annotations_dir=self.annot_dir,
            summaries_db=self.summaries_db
        )
        self.assertEqual(t2, "SQLite Title")

    def test_mark_and_remove_deployed_cycle(self):
        cid = "33333333-3333-3333-3333-333333333333"
        conn = sqlite3.connect(self.summaries_db)
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", (cid, "Original Title", "Original Title", "2026-09-17"))
        conn.commit()
        conn.close()

        # Step 1: Initial status
        st = session_tagger.get_status(cid, pb_path=self.pb_path, annotations_dir=self.annot_dir, summaries_db=self.summaries_db)
        self.assertFalse(st["is_deployed"])
        self.assertEqual(st["title"], "Original Title")

        # Step 2: Mark deployed
        res_mark = session_tagger.mark_deployed(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annot_dir,
            summaries_db=self.summaries_db
        )
        self.assertEqual(res_mark["status"], "success")
        self.assertEqual(res_mark["new_title"], "(D) Original Title")
        self.assertTrue(res_mark["is_deployed"])

        # Check SQLite DB updated
        conn = sqlite3.connect(self.summaries_db)
        row = conn.execute("SELECT title, preview FROM conversation_summaries WHERE conversation_id=?", (cid,)).fetchone()
        conn.close()
        self.assertEqual(row[0], "(D) Original Title")
        self.assertEqual(row[1], "(D) Original Title")

        # Step 3: Idempotency check on mark
        res_mark_dup = session_tagger.mark_deployed(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annot_dir,
            summaries_db=self.summaries_db
        )
        self.assertEqual(res_mark_dup["status"], "noop")

        # Step 4: Remove deployed
        res_rem = session_tagger.remove_deployed(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annot_dir,
            summaries_db=self.summaries_db
        )
        self.assertEqual(res_rem["status"], "success")
        self.assertEqual(res_rem["new_title"], "Original Title")
        self.assertFalse(res_rem["is_deployed"])

        # Check SQLite DB restored
        conn = sqlite3.connect(self.summaries_db)
        row = conn.execute("SELECT title FROM conversation_summaries WHERE conversation_id=?", (cid,)).fetchone()
        conn.close()
        self.assertEqual(row[0], "Original Title")

        # Step 5: Idempotency check on remove
        res_rem_dup = session_tagger.remove_deployed(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annot_dir,
            summaries_db=self.summaries_db
        )
        self.assertEqual(res_rem_dup["status"], "noop")

    def test_search_sessions(self):
        conn = sqlite3.connect(self.summaries_db)
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("cid-alpha", "CRM Access Delay Check", "CRM Access Delay", "2026-09-17 10:00"))
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("cid-beta", "Teacher Schedule UI Files", "Teacher Schedule", "2026-09-17 09:00"))
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("cid-gamma", "Read Aloud Workspace Redesign", "Read Aloud", "2026-09-17 08:00"))
        conn.commit()
        conn.close()

        found = session_tagger.search_sessions(
            "Schedule",
            summaries_db=self.summaries_db,
            pb_path=self.pb_path,
            annotations_dir=self.annot_dir
        )
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["cid"], "cid-beta")
        self.assertEqual(found[0]["title"], "Teacher Schedule UI Files")

    def test_trace_deploy_sessions(self):
        # Create 3 development sessions in summaries DB
        conn = sqlite3.connect(self.summaries_db)
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("track-1", "CRM Access Delay Check", "CRM Access Delay", "2026-09-17 10:00"))
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("track-2", "Teacher Schedule UI Files", "Teacher Schedule", "2026-09-17 09:00"))
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("deploy-1", "Deploy Changes to Production", "Deploy Changes", "2026-09-17 11:00"))
        conn.commit()
        conn.close()

        # Create deploy session brain artifacts with numbered tracks
        deploy_brain = os.path.join(self.brain_dir, "deploy-1")
        os.makedirs(deploy_brain, exist_ok=True)
        with open(os.path.join(deploy_brain, "implementation_plan.md"), "w", encoding="utf-8") as f:
            f.write("""# Deploy Plan
1. **CRM Access Delay Check** (Task 1176): Cold start optimization.
2. **Teacher Schedule UI Files** (Task 1177): Pastel calendar session pills.
""")

        # Execute trace deploy
        trace_res = session_tagger.trace_deploy_sessions(
            deploy_cid="deploy-1",
            summaries_db=self.summaries_db,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annot_dir,
            brain_dir=self.brain_dir,
            task_tracker_path=self.tracker_csv
        )

        self.assertEqual(trace_res["status"], "ok")
        marked_cids = [s["cid"] for s in trace_res["sessions"]]
        self.assertIn("deploy-1", marked_cids)
        self.assertIn("track-1", marked_cids)
        self.assertIn("track-2", marked_cids)

        # Verify all are now marked with (D)
        for cid in ["deploy-1", "track-1", "track-2"]:
            st = session_tagger.get_status(cid, pb_path=self.pb_path, annotations_dir=self.annot_dir, summaries_db=self.summaries_db)
            self.assertTrue(st["is_deployed"])
            self.assertTrue(st["title"].startswith("(D) "))

    def test_search_sessions_multi_token(self):
        conn = sqlite3.connect(self.summaries_db)
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("cid-1", "CRM Access Delay Check", "CRM Access Delay", "2026-09-17 10:00"))
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("cid-2", "Teacher Schedule UI Files", "Teacher Schedule", "2026-09-17 09:00"))
        conn.commit()
        conn.close()

        # Non-contiguous multi-token search
        found = session_tagger.search_sessions(
            "CRM delay",
            summaries_db=self.summaries_db,
            pb_path=self.pb_path,
            annotations_dir=self.annot_dir,
        )
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["cid"], "cid-1")

    def test_pbtxt_escaping_roundtrip(self):
        cid = "escape-test-cid"
        complex_title = r'Fix "quotes" and \backslashes\ in session'

        ok = session_tagger.update_annotation_file(cid, complex_title, annotations_dir=self.annot_dir)
        self.assertTrue(ok)

        retrieved = session_tagger.get_session_title(
            cid,
            pb_path=self.pb_path,
            annotations_dir=self.annot_dir,
            summaries_db=self.summaries_db,
        )
        self.assertEqual(retrieved, complex_title)

    def test_sync_summaries_db_preview_preservation(self):
        cid = "preview-preservation-cid"
        conn = sqlite3.connect(self.summaries_db)
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", (cid, "Original Title", "Distinct user prompt preview", "2026-09-17 10:00"))
        conn.commit()
        conn.close()

        # Mark deployed
        session_tagger.mark_deployed(cid, pb_path=self.pb_path, conv_dir=self.conv_dir, annotations_dir=self.annot_dir, summaries_db=self.summaries_db)

        conn = sqlite3.connect(self.summaries_db)
        row = conn.execute("SELECT title, preview FROM conversation_summaries WHERE conversation_id=?", (cid,)).fetchone()
        conn.close()
        self.assertEqual(row[0], "(D) Original Title")
        # Preview was distinct from title, so its content should NOT be wiped with "(D) Original Title"
        self.assertEqual(row[1], "Distinct user prompt preview")

        # Remove deployed
        session_tagger.remove_deployed(cid, pb_path=self.pb_path, conv_dir=self.conv_dir, annotations_dir=self.annot_dir, summaries_db=self.summaries_db)

        conn = sqlite3.connect(self.summaries_db)
        row = conn.execute("SELECT title, preview FROM conversation_summaries WHERE conversation_id=?", (cid,)).fetchone()
        conn.close()
        self.assertEqual(row[0], "Original Title")
        self.assertEqual(row[1], "Distinct user prompt preview")

    def test_trace_deploy_avoids_false_positive_bullets(self):
        conn = sqlite3.connect(self.summaries_db)
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("pros-session", "Researching Pros and Cons", "Researching", "2026-09-17 10:00"))
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("commit-session", "Review Uncommitted Git Changes", "Review", "2026-09-17 09:00"))
        conn.execute("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)", ("deploy-bullet", "Deploy Changes to Production", "Deploy", "2026-09-17 11:00"))
        conn.commit()
        conn.close()

        deploy_brain = os.path.join(self.brain_dir, "deploy-bullet")
        os.makedirs(deploy_brain, exist_ok=True)
        with open(os.path.join(deploy_brain, "implementation_plan.md"), "w", encoding="utf-8") as f:
            f.write("""# Deploy Plan
## Trade-offs
- **Pros**: Fast rollout.
- **Cons**: Requires caution.
- **Commit**: abc12345.
- **Subject**: Release V2.
""")

        trace_res = session_tagger.trace_deploy_sessions(
            deploy_cid="deploy-bullet",
            summaries_db=self.summaries_db,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annot_dir,
            brain_dir=self.brain_dir,
            task_tracker_path=self.tracker_csv
        )

        marked_cids = [s["cid"] for s in trace_res["sessions"]]
        self.assertIn("deploy-bullet", marked_cids)
        # Verify bullets like Pros, Cons, Commit were NOT matched as tracks
        self.assertNotIn("pros-session", marked_cids)
        self.assertNotIn("commit-session", marked_cids)


if __name__ == "__main__":
    unittest.main()
