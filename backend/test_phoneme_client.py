#!/usr/bin/env python3
"""
Tests for backend.local_server.phoneme_client
==============================================

All tests run without real Google credentials or a running service.
External dependencies (google.auth, google.oauth2, requests) are
fully mocked.
"""

from __future__ import annotations

import io
import json
import logging
import os
import time
import unittest
from unittest import mock

# ---------------------------------------------------------------------------
# Mock google.auth / google.oauth2 BEFORE importing the module under test.
# This avoids ImportError when google-auth is not installed locally.
# ---------------------------------------------------------------------------

_mock_google_auth = mock.MagicMock()
_mock_google_oauth2 = mock.MagicMock()
_mock_id_token_mod = mock.MagicMock()
_mock_auth_request = mock.MagicMock()

# Wire the id_token attribute so `from google.oauth2 import id_token`
# resolves to the same mock we configure in tests.
_mock_google_oauth2.id_token = _mock_id_token_mod

import sys

sys.modules["google"] = _mock_google_auth
sys.modules["google.auth"] = _mock_google_auth
sys.modules["google.auth.transport"] = mock.MagicMock()
sys.modules["google.auth.transport.requests"] = _mock_auth_request
sys.modules["google.oauth2"] = _mock_google_oauth2
sys.modules["google.oauth2.id_token"] = _mock_id_token_mod

from backend.local_server.phoneme_client import (
    ConfigurationError,
    PhonemeClient,
    REASON_RECOGNIZER_AUTH_FAILED,
    REASON_RECOGNIZER_BUSY,
    RecognizerError,
    create_phoneme_client,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_TOKEN_A = "eyJ0b2tlbl9h"
_FAKE_TOKEN_B = "eyJ0b2tlbl9i"

_SERVICE_URL = "https://phoneme-recognizer-abc123-uc.a.run.app"
_LOCALHOST_URL = "http://localhost:8080"
_LOOPBACK_URL = "http://127.0.0.1:8080"


def _ok_response(body: dict | None = None) -> mock.MagicMock:
    resp = mock.MagicMock()
    resp.status_code = 200
    resp.json.return_value = body or {"phonemes": [], "ok": True}
    return resp


def _error_response(status: int, body: str = "") -> mock.MagicMock:
    resp = mock.MagicMock()
    resp.status_code = status
    resp.text = body
    resp.json.return_value = {"error": body}
    resp.raise_for_status.side_effect = Exception(
        f"HTTP {status}: {body}"
    )
    return resp


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPhonemeClient(unittest.TestCase):
    """Unit tests for PhonemeClient."""

    def setUp(self):
        # Reset the google.oauth2.id_token.fetch_id_token mock.
        _mock_id_token_mod.fetch_id_token = mock.MagicMock(
            return_value=_FAKE_TOKEN_A
        )
        # Ensure K_SERVICE is not set by default.
        self._env_patcher = mock.patch.dict(
            os.environ, {}, clear=False
        )
        self._env_patcher.start()
        os.environ.pop("K_SERVICE", None)

    def tearDown(self):
        self._env_patcher.stop()

    # -- 1. Token caching ---------------------------------------------------

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_token_cached_within_validity(self, mock_session_cls):
        """Token is fetched once and reused for subsequent calls."""
        session = mock_session_cls.return_value
        session.post.return_value = _ok_response()

        client = PhonemeClient(_SERVICE_URL, auth_mode="google")

        # Wrap _fetch_id_token so it also sets internal state like the real one.
        original_fetch = client._fetch_id_token

        def _mock_fetch():
            client._cached_token = _FAKE_TOKEN_A
            client._token_expiry = time.time() + 3600
            return _FAKE_TOKEN_A

        with mock.patch.object(
            client, "_fetch_id_token", side_effect=_mock_fetch
        ) as mock_fetch:
            client.recognize(b"wav1")
            client.recognize(b"wav2")

            # fetch_id_token should be called exactly once.
            mock_fetch.assert_called_once()

        # Both requests should carry the same Bearer header.
        calls = session.post.call_args_list
        self.assertEqual(len(calls), 2)
        for call in calls:
            auth_header = call.kwargs.get("headers", {}).get("Authorization")
            self.assertEqual(auth_header, f"Bearer {_FAKE_TOKEN_A}")

    # -- 2. Token refresh on 401 --------------------------------------------

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_401_triggers_token_refresh_and_retry(self, mock_session_cls):
        """A 401 should refresh the token and retry once."""
        session = mock_session_cls.return_value
        session.post.side_effect = [
            _error_response(401, "Unauthorized"),
            _ok_response({"phonemes": ["p"], "ok": True}),
        ]

        client = PhonemeClient(_SERVICE_URL, auth_mode="google")
        with mock.patch.object(
            client, "_fetch_id_token",
            side_effect=[_FAKE_TOKEN_A, _FAKE_TOKEN_B],
        ) as mock_fetch:
            result = client.recognize(b"wav")

            self.assertTrue(result["ok"])
            self.assertEqual(mock_fetch.call_count, 2)

    # -- 3. Token refresh on 403 --------------------------------------------

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_403_triggers_token_refresh_and_retry(self, mock_session_cls):
        """A 403 should also refresh the token and retry once."""
        session = mock_session_cls.return_value
        session.post.side_effect = [
            _error_response(403, "Forbidden"),
            _ok_response({"phonemes": ["p"], "ok": True}),
        ]

        client = PhonemeClient(_SERVICE_URL, auth_mode="google")
        with mock.patch.object(
            client, "_fetch_id_token",
            side_effect=[_FAKE_TOKEN_A, _FAKE_TOKEN_B],
        ) as mock_fetch:
            result = client.recognize(b"wav")

            self.assertTrue(result["ok"])
            self.assertEqual(mock_fetch.call_count, 2)

    # -- 4. Persistent auth failure maps to RECOGNIZER_AUTH_FAILED ----------

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_persistent_401_maps_to_auth_failed(self, mock_session_cls):
        """Two consecutive 401s → RECOGNIZER_AUTH_FAILED."""
        session = mock_session_cls.return_value
        session.post.return_value = _error_response(401, "Unauthorized")

        client = PhonemeClient(_SERVICE_URL, auth_mode="google")
        with mock.patch.object(
            client, "_fetch_id_token",
            side_effect=[_FAKE_TOKEN_A, _FAKE_TOKEN_B],
        ):
            with self.assertRaises(RecognizerError) as ctx:
                client.recognize(b"wav")

        self.assertEqual(ctx.exception.reason, REASON_RECOGNIZER_AUTH_FAILED)
        self.assertEqual(ctx.exception.status_code, 401)

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_persistent_403_maps_to_auth_failed(self, mock_session_cls):
        """Two consecutive 403s → RECOGNIZER_AUTH_FAILED."""
        session = mock_session_cls.return_value
        session.post.return_value = _error_response(403, "Forbidden")

        client = PhonemeClient(_SERVICE_URL, auth_mode="google")
        with mock.patch.object(
            client, "_fetch_id_token",
            side_effect=[_FAKE_TOKEN_A, _FAKE_TOKEN_B],
        ):
            with self.assertRaises(RecognizerError) as ctx:
                client.recognize(b"wav")

        self.assertEqual(ctx.exception.reason, REASON_RECOGNIZER_AUTH_FAILED)

    # -- 5. Localhost bypass allowed ----------------------------------------

    def test_localhost_bypass_allowed(self):
        """auth=disabled with localhost URL and no K_SERVICE succeeds."""
        os.environ.pop("K_SERVICE", None)
        # Should not raise
        client = PhonemeClient(_LOCALHOST_URL, auth_mode="disabled")
        self.assertEqual(client.auth_mode, "disabled")

    # -- 6. 127.0.0.1 bypass allowed ---------------------------------------

    def test_loopback_bypass_allowed(self):
        """auth=disabled with 127.0.0.1 URL and no K_SERVICE succeeds."""
        os.environ.pop("K_SERVICE", None)
        client = PhonemeClient(_LOOPBACK_URL, auth_mode="disabled")
        self.assertEqual(client.auth_mode, "disabled")

    # -- 7. Cloud Run startup rejection ------------------------------------

    def test_cloud_run_k_service_rejects_disabled_auth(self):
        """auth=disabled with K_SERVICE env var raises ConfigurationError."""
        with mock.patch.dict(os.environ, {"K_SERVICE": "praat-api"}):
            with self.assertRaises(ConfigurationError) as ctx:
                PhonemeClient(_LOCALHOST_URL, auth_mode="disabled")
            self.assertIn("K_SERVICE", str(ctx.exception))

    # -- 8. Non-localhost disabled rejected ---------------------------------

    def test_non_localhost_disabled_rejected(self):
        """auth=disabled with a non-localhost URL raises ConfigurationError."""
        os.environ.pop("K_SERVICE", None)
        with self.assertRaises(ConfigurationError):
            PhonemeClient(_SERVICE_URL, auth_mode="disabled")

    # -- 9. Successful recognize --------------------------------------------

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_successful_recognize(self, mock_session_cls):
        """200 response returns the parsed result dict."""
        expected = {"phonemes": [{"symbol": "k"}], "engine": "v1"}
        session = mock_session_cls.return_value
        session.post.return_value = _ok_response(expected)

        client = PhonemeClient(_SERVICE_URL, auth_mode="google")
        result = client.recognize(b"wavdata")

        self.assertEqual(result, expected)
        # Verify the correct URL was called.
        call_url = session.post.call_args[0][0]
        self.assertTrue(call_url.endswith("/recognize/v1"))

    # -- 10. 503 busy handling -----------------------------------------------

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_503_maps_to_recognizer_busy(self, mock_session_cls):
        """503 response maps to RECOGNIZER_BUSY."""
        session = mock_session_cls.return_value
        session.post.return_value = _error_response(503, "Service Unavailable")

        client = PhonemeClient(_SERVICE_URL, auth_mode="google")

        with self.assertRaises(RecognizerError) as ctx:
            client.recognize(b"wav")

        self.assertEqual(ctx.exception.reason, REASON_RECOGNIZER_BUSY)
        self.assertEqual(ctx.exception.status_code, 503)

    # -- 11. No model retry (400) -------------------------------------------

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_400_validation_errors_not_retried(self, mock_session_cls):
        """4xx validation errors (e.g. 400) are NOT retried."""
        session = mock_session_cls.return_value
        session.post.return_value = _error_response(400, "Bad Request")

        client = PhonemeClient(_SERVICE_URL, auth_mode="google")

        with self.assertRaises(Exception):
            client.recognize(b"wav")

        # Only one HTTP call — no retry.
        self.assertEqual(session.post.call_count, 1)

    # -- 12. No token contents logged ----------------------------------------

    @mock.patch("backend.local_server.phoneme_client.requests.Session")
    def test_no_token_contents_in_logs(self, mock_session_cls):
        """Verify no token values appear in log output."""
        session = mock_session_cls.return_value
        session.post.return_value = _ok_response()

        log_stream = io.StringIO()
        handler = logging.StreamHandler(log_stream)
        handler.setLevel(logging.DEBUG)
        client_logger = logging.getLogger(
            "backend.local_server.phoneme_client"
        )
        client_logger.addHandler(handler)
        client_logger.setLevel(logging.DEBUG)

        try:
            client = PhonemeClient(_SERVICE_URL, auth_mode="google")
            with mock.patch.object(
                client, "_fetch_id_token", return_value=_FAKE_TOKEN_A
            ):
                client.recognize(b"wav")

            log_output = log_stream.getvalue()
            self.assertNotIn(
                _FAKE_TOKEN_A,
                log_output,
                "Token value must not appear in log output",
            )
        finally:
            client_logger.removeHandler(handler)


# ---------------------------------------------------------------------------
# Factory tests
# ---------------------------------------------------------------------------


class TestCreatePhonemeClient(unittest.TestCase):
    """Tests for the create_phoneme_client factory function."""

    def test_factory_reads_env_vars(self):
        """Factory reads PHONEME_SERVICE_URL and PHONEME_SERVICE_AUTH."""
        env = {
            "PHONEME_SERVICE_URL": _LOCALHOST_URL,
            "PHONEME_SERVICE_AUTH": "disabled",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            os.environ.pop("K_SERVICE", None)
            client = create_phoneme_client()
            self.assertEqual(client.service_url, _LOCALHOST_URL)
            self.assertEqual(client.auth_mode, "disabled")

    def test_factory_missing_url_raises(self):
        """Missing PHONEME_SERVICE_URL raises ConfigurationError."""
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ConfigurationError):
                create_phoneme_client()

    def test_factory_defaults_to_google_auth(self):
        """Default auth_mode is 'google' when PHONEME_SERVICE_AUTH is unset."""
        env = {"PHONEME_SERVICE_URL": _SERVICE_URL}
        with mock.patch.dict(os.environ, env, clear=True):
            client = create_phoneme_client()
            self.assertEqual(client.auth_mode, "google")


if __name__ == "__main__":
    unittest.main()
