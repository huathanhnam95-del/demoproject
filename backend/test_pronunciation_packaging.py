"""
Tests for pronunciation segmentation v3 packaging and build reproducibility.

These tests validate packaging artifacts without requiring Docker.
"""

import os
import pathlib
import re
import unittest

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.join(_PROJECT_ROOT, "backend")


class TestDockerfilePhoneme(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(_BACKEND, "Dockerfile.phoneme")
        self.assertTrue(os.path.isfile(self.path), f"Missing {self.path}")
        with open(self.path, encoding="utf-8") as f:
            self.content = f.read()

    def test_base_image_pinned(self):
        self.assertIn("FROM python:3.11-slim", self.content)

    def test_system_deps(self):
        self.assertIn("libsndfile1", self.content)
        self.assertIn("ffmpeg", self.content)

    def test_build_args(self):
        for arg in ("GIT_SHA", "MODEL_REVISION", "INFERENCE_ENGINE"):
            self.assertRegex(self.content, rf"ARG\s+{arg}")

    def test_env_vars(self):
        self.assertIn("BUILD_SHA", self.content)
        self.assertRegex(self.content, r"PORT=8081")

    def test_expose_port(self):
        self.assertRegex(self.content, r"EXPOSE\s+.*8081|EXPOSE\s+\$\{?PORT\}?")

    def test_health_probes_documented(self):
        self.assertIn("/healthz", self.content)
        self.assertIn("/readyz", self.content)

    def test_gunicorn_cmd(self):
        self.assertIn("gunicorn", self.content)
        self.assertRegex(self.content, r"--workers\s+1")
        self.assertRegex(self.content, r"--threads\s+2")

    def test_model_pre_download(self):
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
    def setUp(self):
        self.path = os.path.join(_BACKEND, "cloudbuild.phoneme.yaml")
        self.assertTrue(os.path.isfile(self.path), f"Missing {self.path}")
        with open(self.path, encoding="utf-8") as f:
            self.content = f.read()

    def test_timeout(self):
        self.assertIn("1800s", self.content)

    def test_machine_type(self):
        self.assertIn("E2_HIGHCPU_8", self.content)

    def test_substitutions(self):
        for sub in ("_GIT_SHA", "_MODEL_REVISION", "_INFERENCE_ENGINE", "_REPOSITORY"):
            self.assertIn(sub, self.content)

    def test_no_deploy_step(self):
        content_lower = self.content.lower()
        self.assertNotIn("gcloud run deploy", content_lower)
        self.assertNotIn("set-traffic", content_lower)

    def test_image_tag(self):
        self.assertIn("phoneme-recognizer:${_GIT_SHA}", self.content)


class TestRequirementsFiles(unittest.TestCase):
    def _read_req(self, filename):
        path = os.path.join(_BACKEND, filename)
        self.assertTrue(os.path.isfile(path), f"Missing {path}")
        with open(path, encoding="utf-8") as f:
            return f.read()

    def _assert_packages(self, content, packages):
        for pkg in packages:
            self.assertRegex(content, rf"(?m)^{re.escape(pkg)}[><=]", f"Package '{pkg}' not pinned")

    def test_praat_api_requirements_include_recognizer_auth(self):
        # phoneme_client.py imports google.auth to mint the Cloud Run ID token
        # whenever PHONEME_SERVICE_AUTH=google, which is the default in
        # shadow/active mode. Without the pin the container fails at request
        # time, not build time.
        self._assert_packages(self._read_req("requirements.txt"), ["flask", "requests", "google-auth"])

    def test_torch_requirements(self):
        self._assert_packages(self._read_req("requirements.phoneme-torch.txt"), ["torch", "transformers", "flask", "gunicorn", "numpy", "scipy"])

    def test_torch_pins_the_cpu_wheel_index(self):
        # Cloud Run runs this CPU-only. Without the CPU index, pip resolves the
        # CUDA build and adds multiple GB of unused nvidia-* wheels that Cloud
        # Run must stream on every cold start.
        content = self._read_req("requirements.phoneme-torch.txt")
        self.assertIn("https://download.pytorch.org/whl/cpu", content)
        self.assertRegex(content, r"(?m)^torch==[\d.]+\+cpu\b")

    def test_onnx_requirements(self):
        self._assert_packages(self._read_req("requirements.phoneme-onnx.txt"), ["onnxruntime", "transformers", "flask", "gunicorn", "numpy", "scipy"])

    def test_torch_has_no_onnx(self):
        self.assertNotIn("onnxruntime", self._read_req("requirements.phoneme-torch.txt"))

    def test_onnx_has_no_torch(self):
        lines = [line.strip() for line in self._read_req("requirements.phoneme-onnx.txt").splitlines() if line.strip() and not line.strip().startswith("#")]
        pkg_names = [re.split(r"[><=!]", line)[0] for line in lines]
        self.assertNotIn("torch", pkg_names)


class TestRecognizerReasonContract(unittest.TestCase):
    """The learner UI must treat every recognizer outage as non-consuming.

    These two files are in different languages, so nothing else stops the
    backend from adding a reason code the frontend silently charges a
    re-record attempt for.
    """

    def test_every_recognizer_reason_is_non_consuming_in_the_ui(self):
        client_path = os.path.join(_BACKEND, "local_server", "phoneme_client.py")
        with open(client_path, encoding="utf-8") as handle:
            client_source = handle.read()
        reasons = set(re.findall(r'^REASON_[A-Z_]+\s*=\s*"([A-Z_]+)"', client_source, re.M))
        reasons |= set(re.findall(r'reason="([A-Z_]+)"', client_source))
        self.assertTrue(reasons, "no recognizer reason codes found")

        policy_path = os.path.join(
            os.path.dirname(_BACKEND), "public", "pronunciation-analyzer",
            "verification-attempt-policy.js",
        )
        with open(policy_path, encoding="utf-8") as handle:
            policy_source = handle.read()
        block = re.search(
            r"SERVICE_UNAVAILABLE_REASONS\s*=\s*new Set\(\[(.*?)\]\)",
            policy_source, re.S,
        )
        self.assertIsNotNone(block, "SERVICE_UNAVAILABLE_REASONS not found")
        allowed = set(re.findall(r"'([A-Z_0-9]+)'", block.group(1)))

        missing = sorted(reasons - allowed)
        self.assertEqual(
            missing, [],
            f"recognizer reasons missing from SERVICE_UNAVAILABLE_REASONS: {missing}",
        )


class TestBenchmarkEvidenceHonesty(unittest.TestCase):
    """A waived corpus gate must reach the deployment artifact.

    The probe used to print a warning and still write
    `evidenceStatus: verified`, so a bypassed gate was indistinguishable from
    a satisfied one in the file the recognizer gates readiness on.
    """

    def _probe_source(self):
        path = os.path.join(
            os.path.dirname(_BACKEND), "scripts", "benchmarks", "phoneme_model_probe.py",
        )
        with open(path, encoding="utf-8") as handle:
            return handle.read()

    def test_probe_records_waived_requirements_in_the_manifest(self):
        source = self._probe_source()
        self.assertIn('"waivedRequirements"', source)
        self.assertIn('"composition-waived" if waived else "verified"', source)

    def test_probe_collects_a_waiver_for_each_overridable_gate(self):
        source = self._probe_source()
        for requirement in ("category_composition", "accented_speaker_cohorts"):
            self.assertIn(f'waived.append("{requirement}")', source)
        # Every --allow-composition-mismatch branch must record something.
        overrides = source.count("Proceeding due to --allow-composition-mismatch.")
        self.assertEqual(overrides, source.count("waived.append("))

    def test_recognizer_accepts_waived_evidence_but_never_unverified(self):
        path = os.path.join(_BACKEND, "phoneme_service", "app.py")
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
        self.assertIn('evidence_status == "composition-waived"', source)
        self.assertIn('elif evidence_status != "verified"', source)


class TestGcloudIgnore(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(_PROJECT_ROOT, ".gcloudignore")
        self.assertTrue(os.path.isfile(self.path), f"Missing {self.path}")
        with open(self.path, encoding="utf-8") as f:
            self.content = f.read()

    def test_whitelists_artifacts(self):
        for entry in ("!backend/Dockerfile.phoneme", "!backend/cloudbuild.phoneme.yaml", "!backend/requirements.phoneme-torch.txt", "!backend/requirements.phoneme-onnx.txt", "!backend/phoneme_service/", "!backend/phoneme_service/model-manifest.schema.json"):
            self.assertIn(entry, self.content)

    def test_excludes_tests_results_and_credentials(self):
        for entry in ("!backend/test_", "!test-results", "!credentials", "!.env"):
            self.assertNotIn(entry, self.content)


class TestRuntimeShapeDocumented(unittest.TestCase):
    def test_runtime_shape_in_dockerfile(self):
        content = pathlib.Path(_BACKEND, "Dockerfile.phoneme").read_text(encoding="utf-8")
        self.assertRegex(content, r"2.?vCPU")
        self.assertRegex(content, r"4\s*GiB")
        self.assertRegex(content, r"--workers\s+1")


class PronunciationPackagingTest(unittest.TestCase):
    def test_dockerfile_packages_v2_client_and_json_verifier(self):
        source = pathlib.Path(_BACKEND, "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("phoneme_client.py", source)
        self.assertIn("pronunciation_verifier.py", source)
        self.assertIn("pronunciation-verifier-v1.json", source)

    def test_v3_degraded_response_is_always_unrateable(self):
        from backend.local_server.server import _build_v3_degraded_response
        result = _build_v3_degraded_response({"duration": 1.0}, "TIMEOUT")
        self.assertEqual(result["verification"]["status"], "unrateable")


if __name__ == "__main__":
    unittest.main()
