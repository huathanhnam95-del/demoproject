"""Loopback-only entrypoint for the local phoneme recognizer.

The standalone service entrypoint intentionally binds ``0.0.0.0`` for
container deployments. Local development must use this module instead so the
auth-disabled client can never expose the recognizer beyond loopback.
"""

from __future__ import annotations

import os

from .app import create_app


def _port() -> int:
    """Read and validate the local service port from ``PORT``."""
    try:
        port = int(os.environ.get("PORT", "8082"))
    except (TypeError, ValueError) as exc:
        raise ValueError("PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    return port


def main() -> None:
    """Start the recognizer on loopback using the configured local port."""
    app = create_app()
    app.run(host="127.0.0.1", port=_port(), debug=False)


if __name__ == "__main__":
    main()
