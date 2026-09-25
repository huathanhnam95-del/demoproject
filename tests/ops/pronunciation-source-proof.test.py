"""Behavioral source archive checks without Cloud Build or live services."""

import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/release/verify-pronunciation-source.py"
SPEC = importlib.util.spec_from_file_location("pronunciation_source_proof", SCRIPT)
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)


def archive(files):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as tar:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            tar.addfile(member, io.BytesIO(content))
    return stream.getvalue()


class SourceProofTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        (self.root / "backend").mkdir(parents=True)
        (self.root / ".gcloudignore").write_bytes(b"node_modules\n")
        (self.root / "backend/Dockerfile").write_bytes(b"FROM python:3.14\n")
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "core.autocrlf", "false"], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.name", "Test"], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.email", "test@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(self.root), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "fixture"], check=True)
        self.sha = subprocess.check_output(["git", "-C", str(self.root), "rev-parse", "HEAD"]).decode().strip()
        self.build_id = "11111111-2222-3333-4444-555555555555"
        self.digest = "sha256:" + "a" * 64
        self.image = "example.invalid/acoustic"
        self.files = {".gcloudignore": b"node_modules\n", "backend/Dockerfile": b"FROM python:3.14\n"}
        self.bytes = archive(self.files)

    def build(self, payload):
        uri = "gs://fixture/source.tgz#42"
        source = {"bucket": "fixture", "object": "source.tgz", "generation": "42"}
        encoded = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode().rstrip("=")
        return {
            "id": self.build_id, "status": "SUCCESS", "substitutions": {"_GIT_SHA": self.sha},
            "source": {"storageSource": source.copy()},
            "sourceProvenance": {"resolvedStorageSource": source.copy(),
                                 "fileHashes": {uri: {"fileHash": [{"type": "SHA256", "value": encoded}]}}},
            "results": {"images": [{"name": f"{self.image}:{self.sha}", "digest": self.digest}]},
        }

    def execute(self, payload=None, build_mutation=None):
        payload = self.bytes if payload is None else payload
        build = self.build(payload)
        if build_mutation:
            build_mutation(build)
        real_run = proof.run

        def fake_run(argv, *, cwd=None):
            if argv[:2] == ["gcloud", "meta"]:
                return b".gcloudignore\nbackend/Dockerfile\n"
            if argv[:2] == ["gcloud", "builds"]:
                return json.dumps(build).encode()
            if argv[:2] == ["gcloud", "storage"]:
                Path(argv[4]).write_bytes(payload)
                return b""
            return real_run(argv, cwd=cwd)

        args = [str(SCRIPT), "--project", "fixture", "--build-id", self.build_id,
                "--source-root", str(self.root), "--sha", self.sha,
                "--image-repository", self.image, "--digest", self.digest]
        with patch.object(proof, "run", side_effect=fake_run), patch.object(sys, "argv", args):
            return proof.main()

    def test_exact_archive_and_image_pass(self):
        self.assertEqual(self.execute(), 0)

    def test_hashed_archive_with_changed_source_fails(self):
        changed = archive({**self.files, "backend/Dockerfile": b"FROM altered\n"})
        with self.assertRaisesRegex(proof.VerificationError, "content differs"):
            self.execute(changed)

    def test_wrong_generation_or_image_digest_fails(self):
        with self.assertRaisesRegex(proof.VerificationError, "source and resolved"):
            self.execute(build_mutation=lambda b: b["sourceProvenance"]["resolvedStorageSource"].update(generation="43"))
        with self.assertRaisesRegex(proof.VerificationError, "image tag, or digest"):
            self.execute(build_mutation=lambda b: b["results"]["images"][0].update(digest="sha256:" + "b" * 64))

    def test_unsafe_archive_member_fails(self):
        with self.assertRaisesRegex(proof.VerificationError, "Unsafe archive path"):
            self.execute(archive({**self.files, "../escape": b"x"}))


if __name__ == "__main__":
    unittest.main()
