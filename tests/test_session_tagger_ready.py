#!/usr/bin/env python3
"""
tests/test_session_tagger_ready.py

Unit tests verifying the R4D (Ready for Deployment) (R) session tagging,
lifecycle transitions between plain, (R), and (D) states, and list-ready operations.
"""

import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from scripts.session_tagger import (
    get_session_title,
    get_status,
    list_deployed,
    list_ready,
    mark_deployed,
    mark_ready,
    remove_deployed,
    remove_ready,
    sync_summaries_db_title,
    update_annotation_file,
)


class TestSessionTaggerReady(unittest.TestCase):
    def setUp(self):
        self.rpc_patcher = patch("scripts.session_tagger.update_via_rpc", return_value=True)
        self.mock_rpc = self.rpc_patcher.start()

        self.test_dir = tempfile.mkdtemp(prefix="test_session_tagger_")
        self.annotations_dir = os.path.join(self.test_dir, "annotations")
        self.conv_dir = os.path.join(self.test_dir, "conversations")
        self.summaries_db = os.path.join(self.test_dir, "conversation_summaries.db")
        self.pb_path = os.path.join(self.test_dir, "nonexistent.pb")

        os.makedirs(self.annotations_dir, exist_ok=True)
        os.makedirs(self.conv_dir, exist_ok=True)

        con = sqlite3.connect(self.summaries_db)
        cur = con.cursor()
        cur.execute(
            """
            CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                preview TEXT,
                last_modified_time INTEGER
            );
            """
        )
        con.commit()
        con.close()

    def tearDown(self):
        self.rpc_patcher.stop()
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def _create_session(self, cid: str, title: str):
        update_annotation_file(cid, title, annotations_dir=self.annotations_dir)
        con = sqlite3.connect(self.summaries_db)
        cur = con.cursor()
        cur.execute(
            "INSERT OR REPLACE INTO conversation_summaries (conversation_id, title, preview, last_modified_time) VALUES (?, ?, ?, 1000);",
            (cid, title, title),
        )
        con.commit()
        con.close()

    def test_mark_ready_from_plain(self):
        cid = "conv-101"
        self._create_session(cid, "Feature Implement Login")

        res = mark_ready(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annotations_dir,
            summaries_db=self.summaries_db,
        )
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["new_title"], "(R) Feature Implement Login")
        self.assertTrue(res["is_ready"])

        status = get_status(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annotations_dir,
            summaries_db=self.summaries_db,
        )
        self.assertTrue(status["is_ready"])
        self.assertFalse(status["is_deployed"])
        self.assertEqual(status["title"], "(R) Feature Implement Login")

    def test_mark_ready_idempotency(self):
        cid = "conv-102"
        self._create_session(cid, "(R) Feature Already Ready")

        res = mark_ready(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annotations_dir,
            summaries_db=self.summaries_db,
        )
        self.assertEqual(res["status"], "noop")
        self.assertTrue(res["is_ready"])

    def test_transition_ready_to_deployed_no_stacking(self):
        cid = "conv-103"
        self._create_session(cid, "(R) Feature Batch Release")

        res = mark_deployed(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annotations_dir,
            summaries_db=self.summaries_db,
        )
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["new_title"], "(D) Feature Batch Release")
        self.assertTrue(res["is_deployed"])
        self.assertFalse(res["is_ready"])

        status = get_status(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annotations_dir,
            summaries_db=self.summaries_db,
        )
        self.assertTrue(status["is_deployed"])
        self.assertFalse(status["is_ready"])

    def test_transition_deployed_to_ready_no_stacking(self):
        cid = "conv-104"
        self._create_session(cid, "(D) Old Release Re-prepared")

        res = mark_ready(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annotations_dir,
            summaries_db=self.summaries_db,
        )
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["new_title"], "(R) Old Release Re-prepared")
        self.assertTrue(res["is_ready"])
        self.assertFalse(res["is_deployed"])

    def test_remove_ready(self):
        cid = "conv-105"
        self._create_session(cid, "(R) Ready Feature to Cancel")

        res = remove_ready(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annotations_dir,
            summaries_db=self.summaries_db,
        )
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["new_title"], "Ready Feature to Cancel")
        self.assertFalse(res["is_ready"])

        res2 = remove_ready(
            cid,
            pb_path=self.pb_path,
            conv_dir=self.conv_dir,
            annotations_dir=self.annotations_dir,
            summaries_db=self.summaries_db,
        )
        self.assertEqual(res2["status"], "noop")

    def test_list_ready_and_list_deployed(self):
        self._create_session("conv-a", "(R) Task Alpha Ready")
        self._create_session("conv-b", "(R) Task Beta Ready")
        self._create_session("conv-c", "(D) Task Gamma Deployed")
        self._create_session("conv-d", "Task Delta In Progress")

        ready = list_ready(
            annotations_dir=self.annotations_dir,
            pb_path=self.pb_path,
            summaries_db=self.summaries_db,
        )
        ready_cids = {item["cid"] for item in ready}
        self.assertEqual(ready_cids, {"conv-a", "conv-b"})

        deployed = list_deployed(
            annotations_dir=self.annotations_dir,
            pb_path=self.pb_path,
            summaries_db=self.summaries_db,
        )
        deployed_cids = {item["cid"] for item in deployed}
        self.assertEqual(deployed_cids, {"conv-c"})


if __name__ == "__main__":
    unittest.main()
