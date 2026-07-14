#!/usr/bin/env python3
"""
Authenticated client for the phoneme recognizer Cloud Run service.
=================================================================

Sends WAV audio to a remote ``/recognize/v1`` endpoint, handling
Google Cloud IAM identity-token authentication, token caching,
and safe localhost bypass for local development.

Security invariants
-------------------
* Token *contents* are never logged — only presence/absence metadata.
* ``auth_mode="disabled"`` is rejected at startup if the Cloud Run
  marker ``K_SERVICE`` is set **or** the target is not localhost.

Usage::

    from backend.local_server.phoneme_client import create_phoneme_client

    client = create_phoneme_client()   # reads env vars
    result = client.recognize(wav_bytes)
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Error codes — aligned with syllabifier.py reason codes
# ---------------------------------------------------------------------------

REASON_RECOGNIZER_AUTH_FAILED = "RECOGNIZER_AUTH_FAILED"
REASON_RECOGNIZER_BUSY = "RECOGNIZER_BUSY"

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ConfigurationError(Exception):
    """Raised when the client detects an unsafe or invalid configuration."""


class RecognizerError(Exception):
    """Raised when the remote recognizer returns a non-recoverable error."""

    def __init__(self, message: str, reason: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.reason = reason
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

# Refresh the token 5 minutes before its actual expiry so that in-flight
# requests are unlikely to hit an expired credential.
_TOKEN_REFRESH_MARGIN_SEC = 5 * 60

_LOCALHOST_HOSTS = frozenset({"localhost", "127.0.0.1"})


def _audience_from_url(service_url: str) -> str:
    """Extract ``scheme://host[:port]`` as the ID-token audience."""
    parsed = urlparse(service_url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _is_localhost(service_url: str) -> bool:
    parsed = urlparse(service_url)
    hostname = parsed.hostname or ""
    return hostname in _LOCALHOST_HOSTS


# ---------------------------------------------------------------------------
# PhonemeClient
# ---------------------------------------------------------------------------


class PhonemeClient:
    """HTTP client for the phoneme recognizer service.

    Parameters
    ----------
    service_url : str
        Base URL of the phoneme recognizer (e.g. a Cloud Run URL).
    auth_mode : str
        ``"google"`` — acquire a Google Cloud ID token and send it as a
        Bearer header.  ``"disabled"`` — skip authentication (local dev
        only).
    """

    def __init__(self, service_url: str, auth_mode: str = "google") -> None:
        self.service_url = service_url.rstrip("/")
        self.auth_mode = auth_mode.lower()

        # --- safety checks for disabled auth ---------------------------------
        if self.auth_mode == "disabled":
            if os.environ.get("K_SERVICE"):
                raise ConfigurationError(
                    "PHONEME_SERVICE_AUTH=disabled is not allowed when "
                    "running on Cloud Run (K_SERVICE is set). "
                    "Set PHONEME_SERVICE_AUTH=google for production."
                )
            if not _is_localhost(self.service_url):
                raise ConfigurationError(
                    "PHONEME_SERVICE_AUTH=disabled is only permitted when "
                    f"the target is localhost or 127.0.0.1, got: "
                    f"{urlparse(self.service_url).hostname}"
                )
            logger.info(
                "Phoneme client initialised with auth DISABLED (localhost dev mode)"
            )

        # --- token cache (google mode only) ----------------------------------
        self._cached_token: Optional[str] = None
        self._token_expiry: float = 0.0  # epoch seconds

        self._session = requests.Session()
        logger.info(
            "PhonemeClient ready — url=%s auth_mode=%s",
            self.service_url,
            self.auth_mode,
        )

    # -- token management ---------------------------------------------------

    def _fetch_id_token(self) -> str:
        """Obtain a fresh Google ID token for the service audience.

        Uses ``google.oauth2.id_token.fetch_id_token`` which works with
        Application Default Credentials, the GCE metadata server, or
        service-account JSON.  The token payload is never logged.
        """
        # Lazy import — avoids hard dependency when auth is disabled.
        from google.auth.transport.requests import Request as AuthRequest
        from google.oauth2 import id_token

        audience = _audience_from_url(self.service_url)
        token = id_token.fetch_id_token(AuthRequest(), audience)
        # Tokens from the metadata server live ~3600 s; conservatively
        # assume 1 hour and refresh 5 minutes early.
        self._cached_token = token
        self._token_expiry = time.time() + 3600 - _TOKEN_REFRESH_MARGIN_SEC
        logger.debug("ID token acquired (expiry in ~55 min)")
        return token

    def _get_token(self, *, force_refresh: bool = False) -> str:
        """Return a cached token or fetch a new one."""
        if (
            force_refresh
            or self._cached_token is None
            or time.time() >= self._token_expiry
        ):
            return self._fetch_id_token()
        return self._cached_token

    def _invalidate_token(self) -> None:
        """Clear the cached token so the next call forces a refresh."""
        self._cached_token = None
        self._token_expiry = 0.0

    # -- auth header --------------------------------------------------------

    def _auth_headers(self, *, force_refresh: bool = False) -> dict:
        if self.auth_mode == "disabled":
            return {}
        token = self._get_token(force_refresh=force_refresh)
        return {"Authorization": f"Bearer {token}"}

    # -- public API ---------------------------------------------------------

    def recognize(self, wav_bytes: bytes) -> dict:
        """Send WAV audio to the recognizer and return the parsed result.

        Parameters
        ----------
        wav_bytes : bytes
            Raw WAV file content.

        Returns
        -------
        dict
            Parsed JSON response from the recognizer.

        Raises
        ------
        RecognizerError
            On auth failure (after one retry) or 503 busy.
        requests.HTTPError
            On other unexpected HTTP errors.
        """
        url = f"{self.service_url}/recognize/v1"
        files = {"audio": ("audio.wav", wav_bytes, "audio/wav")}

        response = self._session.post(
            url,
            files=files,
            headers=self._auth_headers(),
            timeout=60,
        )

        # --- happy path ------------------------------------------------------
        if response.status_code == 200:
            return response.json()

        # --- auth errors: retry ONCE with a fresh token ----------------------
        if response.status_code in (401, 403):
            if self.auth_mode == "disabled":
                # No token to refresh — surface immediately.
                raise RecognizerError(
                    f"Recognizer returned {response.status_code} but auth is disabled",
                    reason=REASON_RECOGNIZER_AUTH_FAILED,
                    status_code=response.status_code,
                )
            logger.warning(
                "Received %d from recognizer — refreshing token and retrying",
                response.status_code,
            )
            self._invalidate_token()
            retry_resp = self._session.post(
                url,
                files={"audio": ("audio.wav", wav_bytes, "audio/wav")},
                headers=self._auth_headers(force_refresh=True),
                timeout=60,
            )
            if retry_resp.status_code == 200:
                return retry_resp.json()
            raise RecognizerError(
                f"Recognizer auth failed after token refresh "
                f"(status {retry_resp.status_code})",
                reason=REASON_RECOGNIZER_AUTH_FAILED,
                status_code=retry_resp.status_code,
            )

        # --- 503 busy --------------------------------------------------------
        if response.status_code == 503:
            raise RecognizerError(
                "Phoneme recognizer is temporarily unavailable (503)",
                reason=REASON_RECOGNIZER_BUSY,
                status_code=503,
            )

        # --- other errors (4xx model/validation) — never retry ---------------
        response.raise_for_status()
        # Fallback (should not be reached after raise_for_status)
        return response.json()


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_phoneme_client() -> PhonemeClient:
    """Create a :class:`PhonemeClient` from environment variables.

    Environment
    -----------
    PHONEME_SERVICE_URL : str (required)
        Full URL of the phoneme recognizer Cloud Run service.
    PHONEME_SERVICE_AUTH : str (optional, default ``"google"``)
        ``"google"`` or ``"disabled"``.
    """
    service_url = os.environ.get("PHONEME_SERVICE_URL")
    if not service_url:
        raise ConfigurationError(
            "PHONEME_SERVICE_URL environment variable is required"
        )

    auth_mode = os.environ.get("PHONEME_SERVICE_AUTH", "google")
    return PhonemeClient(service_url=service_url, auth_mode=auth_mode)
