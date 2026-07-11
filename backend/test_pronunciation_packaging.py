import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class PronunciationPackagingTests(unittest.TestCase):
    def test_dockerfile_packages_the_canonical_server(self):
        dockerfile = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY backend/requirements.txt", dockerfile)
        self.assertIn("COPY backend/local_server/server.py", dockerfile)
        self.assertIn("COPY backend/local_server/pronunciation_reference.py", dockerfile)
        self.assertIn("COPY public/cmudict.json", dockerfile)
        self.assertIn("local_server.server:app", dockerfile)
        self.assertNotIn("COPY server.py", dockerfile)

    def test_native_numeric_dependencies_support_python_310(self):
        requirements = (ROOT / "backend" / "requirements.txt").read_text(
            encoding="utf-8"
        ).splitlines()
        self.assertIn("scipy==1.15.3", requirements)
        self.assertIn("numpy==2.2.6", requirements)

    def test_cloud_build_is_sha_tagged_and_does_not_deploy(self):
        config = (ROOT / "backend" / "cloudbuild.pronunciation.yaml").read_text(
            encoding="utf-8"
        )
        self.assertIn("backend/Dockerfile", config)
        self.assertIn("${_GIT_SHA}", config)
        self.assertIn("us-central1-docker.pkg.dev", config)
        self.assertNotIn("gcloud run deploy", config)

    def test_cloud_build_upload_is_deny_by_default(self):
        ignore_file = (ROOT / ".gcloudignore").read_text(encoding="utf-8")
        patterns = ignore_file.splitlines()
        self.assertEqual(patterns[0], "*")
        self.assertIn("!backend/Dockerfile", patterns)
        self.assertIn("!backend/requirements.txt", patterns)
        self.assertIn("!backend/local_server/server.py", patterns)
        self.assertIn("!backend/local_server/pronunciation_reference.py", patterns)
        self.assertIn("!public/cmudict.json", patterns)
        self.assertNotIn("!Admin account", patterns)
        self.assertFalse(any("test-results" in pattern for pattern in patterns))

    def test_runbook_documents_candidate_audit_promotion_and_rollback(self):
        runbook = (ROOT / "docs" / "runbooks" / "pronunciation-backend.md").read_text(
            encoding="utf-8"
        )
        for required in (
            "parselmouth",
            "us-central1",
            "praat-api",
            "MW_API_KEY",
            "--no-traffic",
            "pronunciation-audit-100.json",
            "pronunciation-audit-1000.json",
            "rollback",
            "explicit authorization",
        ):
            self.assertIn(required, runbook)


if __name__ == "__main__":
    unittest.main()
