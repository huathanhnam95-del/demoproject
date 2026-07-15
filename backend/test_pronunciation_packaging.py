"""
Tests for pronunciation segmentation v3 – Task 8: Package & build reproducibly.

Validates that all packaging artifacts exist and are correctly configured.
Does NOT require Docker to be installed.
"""

import os
import re
import unittest

# Resolve project root (two levels up from this file, or CWD if run via -m)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.join(_PROJECT_ROOT, "backend")


class TestDockerfilePhoneme(unittest.TestCase):
    """Dockerfile.phoneme exists and contains required directives."""

    def setUp(self):
        self.path = os.path.join(_BACKEND, "Dockerfile.phoneme")
        self.assertTrue(os.path.isfile(self.path), f"Missing {self.path}")
        with open(self.path, encoding="utf-8") as f:
            self.content = f.read()

    def test_base_image_pinned(self):
        """Base image is python:3.11-slim."""
        self.assertIn("FROM python:3.11-slim", self.content)

    def test_system_deps(self):
        """System dependencies include libsndfile1 and ffmpeg."""
        self.assertIn("libsndfile1", self.content)
        self.assertIn("ffmpeg", self.content)

    def test_build_args(self):
        """Accepts GIT_SHA, MODEL_REVISION, INFERENCE_ENGINE build args."""
        for arg in ("GIT_SHA", "MODEL_REVISION", "INFERENCE_ENGINE"):
            self.assertRegex(self.content, rf"ARG\s+{arg}")

    def test_env_vars(self):
        """Sets BUILD_SHA and PORT=8081."""
        self.assertIn("BUILD_SHA", self.content)
        self.assertRegex(self.content, r"PORT=8081")

    def test_expose_port(self):
        """Exposes port 8081."""
        self.assertRegex(self.content, r"EXPOSE\s+.*8081|EXPOSE\s+\$\{?PORT\}?")

    def test_health_probes_documented(self):
        """/healthz and /readyz endpoints are referenced."""
        self.assertIn("/healthz", self.content)
        self.assertIn("/readyz", self.content)

    def test_gunicorn_cmd(self):
        """CMD runs gunicorn with 1 worker, 2 threads."""
        self.assertIn("gunicorn", self.content)
        self.assertRegex(self.content, r"--workers\s+1")
        self.assertRegex(self.content, r"--threads\s+2")

    def test_model_pre_download(self):
        """Model is pre-downloaded during build."""
        self.assertIn("from_pretrained", self.content)

    def test_container_package_layout_matches_imports(self):
        self.assertIn("COPY backend/__init__.py backend/__init__.py", self.content)
        self.assertIn("COPY backend/phoneme_service/ backend/phoneme_service/", self.content)
        self.assertIn('"backend.phoneme_service.app:create_app()"', self.content)

    def test_runtime_is_offline_and_revision_matches_manifest(self):
        self.assertIn("TRANSFORMERS_OFFLINE=1", self.content)
        self.assertIn("HF_HUB_OFFLINE=1", self.content)
        self.assertIn("modelRevision", self.content)


class TestCloudBuildPhoneme(unittest.TestCase):
    """cloudbuild.phoneme.yaml exists and has correct settings."""

    def setUp(self):
        self.path = os.path.join(_BACKEND, "cloudbuild.phoneme.yaml")
        self.assertTrue(os.path.isfile(self.path), f"Missing {self.path}")
        with open(self.path, encoding="utf-8") as f:
            self.content = f.read()

    def test_timeout(self):
        """Timeout is 1800s."""
        self.assertIn("1800s", self.content)

    def test_machine_type(self):
        """Machine type is E2_HIGHCPU_8."""
        self.assertIn("E2_HIGHCPU_8", self.content)

    def test_substitutions(self):
        """Required substitutions are defined."""
        for sub in ("_GIT_SHA", "_MODEL_REVISION", "_INFERENCE_ENGINE", "_REPOSITORY"):
            self.assertIn(sub, self.content)

    def test_no_deploy_step(self):
        """Does NOT contain deploy or set-traffic steps."""
        content_lower = self.content.lower()
        self.assertNotIn("gcloud run deploy", content_lower)
        self.assertNotIn("set-traffic", content_lower)

    def test_image_tag(self):
        """Image is tagged with phoneme-recognizer:$_GIT_SHA."""
        self.assertIn("phoneme-recognizer:${_GIT_SHA}", self.content)


class TestRequirementsFiles(unittest.TestCase):
    """Requirements files exist and pin expected packages."""

    def _read_req(self, filename):
        path = os.path.join(_BACKEND, filename)
        self.assertTrue(os.path.isfile(path), f"Missing {path}")
        with open(path, encoding="utf-8") as f:
            return f.read()

    def _assert_packages(self, content, packages):
        for pkg in packages:
            self.assertRegex(
                content,
                rf"(?m)^{re.escape(pkg)}[><=]",
                f"Package '{pkg}' not pinned in requirements",
            )

    def test_torch_requirements(self):
        """Torch requirements pin torch, transformers, flask, gunicorn, numpy, scipy."""
        content = self._read_req("requirements.phoneme-torch.txt")
        self._assert_packages(
            content, ["torch", "transformers", "flask", "gunicorn", "numpy", "scipy"]
        )

    def test_onnx_requirements(self):
        """ONNX requirements pin onnxruntime, transformers, flask, gunicorn, numpy, scipy."""
        content = self._read_req("requirements.phoneme-onnx.txt")
        self._assert_packages(
            content,
            ["onnxruntime", "transformers", "flask", "gunicorn", "numpy", "scipy"],
        )

    def test_torch_has_no_onnx(self):
        """Torch requirements must NOT include onnxruntime."""
        content = self._read_req("requirements.phoneme-torch.txt")
        self.assertNotIn("onnxruntime", content)

    def test_onnx_has_no_torch(self):
        """ONNX requirements must NOT include torch."""
        content = self._read_req("requirements.phoneme-onnx.txt")
        # "torch" could match "onnxruntime" substring – check for standalone
        lines = [
            l.strip()
            for l in content.splitlines()
            if l.strip() and not l.strip().startswith("#")
        ]
        pkg_names = [re.split(r"[><=!]", l)[0] for l in lines]
        self.assertNotIn("torch", pkg_names)


class TestGcloudIgnore(unittest.TestCase):
    """`.gcloudignore` whitelists phoneme service files and excludes secrets."""

    def setUp(self):
        self.path = os.path.join(_PROJECT_ROOT, ".gcloudignore")
        self.assertTrue(os.path.isfile(self.path), f"Missing {self.path}")
        with open(self.path, encoding="utf-8") as f:
            self.content = f.read()

    def test_whitelists_dockerfile(self):
        self.assertIn("!backend/Dockerfile.phoneme", self.content)

    def test_whitelists_cloudbuild(self):
        self.assertIn("!backend/cloudbuild.phoneme.yaml", self.content)

    def test_whitelists_torch_requirements(self):
        self.assertIn("!backend/requirements.phoneme-torch.txt", self.content)

    def test_whitelists_onnx_requirements(self):
        self.assertIn("!backend/requirements.phoneme-onnx.txt", self.content)

    def test_whitelists_service_python_files(self):
        self.assertIn("!backend/phoneme_service/", self.content)

    def test_whitelists_manifest_schema(self):
        self.assertIn("!backend/phoneme_service/model-manifest.schema.json", self.content)

    def test_excludes_tests(self):
        """Tests should NOT be whitelisted in .gcloudignore."""
        self.assertNotIn("!backend/test_", self.content)

    def test_excludes_test_results(self):
        """test-results directory should NOT be whitelisted."""
        self.assertNotIn("!test-results", self.content)

    def test_excludes_credentials(self):
        """Credentials should NOT be whitelisted."""
        self.assertNotIn("!credentials", self.content)
        self.assertNotIn("!.env", self.content)


class TestRuntimeShapeDocumented(unittest.TestCase):
    """Runtime shape values are documented in packaging artifacts."""

    def test_runtime_shape_in_dockerfile(self):
        """Dockerfile documents 2 vCPU, 4 GiB, concurrency 1 shape."""
        path = os.path.join(_BACKEND, "Dockerfile.phoneme")
        with open(path, encoding="utf-8") as f:
            content = f.read()
        # Check that the Dockerfile comments mention the expected shape
        self.assertRegex(content, r"2.?vCPU", "Should document 2 vCPU")
        self.assertRegex(content, r"4\s*GiB", "Should document 4 GiB")
        # Concurrency 1 is implied by --workers 1
        self.assertRegex(content, r"--workers\s+1")


if __name__ == "__main__":
    unittest.main()
