import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class PronunciationPackagingTests(unittest.TestCase):
    def test_dockerfile_packages_the_canonical_server(self):
        dockerfile = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY backend/requirements.txt", dockerfile)
        self.assertIn("COPY backend/local_server", dockerfile)
        self.assertIn("local_server.server:app", dockerfile)
        self.assertNotIn("COPY server.py", dockerfile)

    def test_cloud_build_is_sha_tagged_and_does_not_deploy(self):
        config = (ROOT / "backend" / "cloudbuild.pronunciation.yaml").read_text(
            encoding="utf-8"
        )
        self.assertIn("backend/Dockerfile", config)
        self.assertIn("${_GIT_SHA}", config)
        self.assertIn("us-central1-docker.pkg.dev", config)
        self.assertNotIn("gcloud run deploy", config)

    def test_runbook_documents_candidate_audit_promotion_and_rollback(self):
        runbook = (ROOT / "docs" / "runbooks" / "pronunciation-backend.md").read_text(
            encoding="utf-8"
        )
        for required in (
            "listening-tasks-3ae34",
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
