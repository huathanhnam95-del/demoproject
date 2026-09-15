"""Guarded Chrome rehearsal for the deployed BEL presentation demo.

This runner is intentionally different from ``rehearsal.py``.  It never seeds
Firebase emulators, installs debug hooks, writes fixture state, or cleans up a
room.  A normal run only proves that an approved account can enter the CRM
launcher and open the authenticated presentation lobby.  Room creation,
joining, and game connection require an explicit, expiring approval file.

The final live gate is still four independent Chrome clients on four physical
computers.  This file is the per-client operator runner for that gate, not a
claim that one machine with isolated browser contexts is equivalent evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import math
import os
import re
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse, urlunparse
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[3]
LIVE_PROJECT_ID = "listening-tasks-3ae34"
ROLES = ("presenter", "p1", "p2", "p3", "negative")
EMULATOR_MARKERS = ("emulator", "localhost", "127.0.0.1", "::1", ".invalid", "dev:")
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
EXPIRY_UNIT = "epoch-seconds"
IDENTITY_MAX_AGE_SECONDS = 300
IDENTITY_REQUEST_CLOCK_SKEW_SECONDS = 5
ANNOTATION_STYLESHEET_PATH = "public/css/entrance-test-ui-annotations.css"


class RehearsalError(RuntimeError):
    """A safe configuration or live-observation failure."""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a guarded Chrome-only BEL production rehearsal client."
    )
    parser.add_argument("--channel", choices=("chrome",), required=True)
    parser.add_argument("--role", choices=ROLES, required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--accounts-file", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--room-code", help="Approved room code for p1, p2, p3, or negative.")
    parser.add_argument("--create-room", action="store_true", help="Create the designated canary room.")
    parser.add_argument("--open-game", action="store_true", help="Open and connect the game client.")
    parser.add_argument("--four-player", action="store_true", help="Run the full four-player progression, reconnect, notes, and PDF scenario in four independent Chrome contexts.")
    parser.add_argument("--allow-live-writes", action="store_true", help="Enable only the approved live actions.")
    parser.add_argument("--approval-file", help="External approval JSON for live actions.")
    parser.add_argument("--lease-file", help="External active publisher-lease JSON, reread before every live scenario.")
    parser.add_argument("--candidate-manifest", help="External final candidate manifest binding the browser evidence to a SHA and file hashes.")
    parser.add_argument("--deployed-identities", help="External fresh readback of the deployed identities and state hash.")
    parser.add_argument("--deployed-identities-url", help="HTTPS read-only provider queried immediately before every live scenario.")
    parser.add_argument("--candidate-sha")
    parser.add_argument("--base-sha")
    parser.add_argument("--scope-hash")
    parser.add_argument("--headed", action="store_true", help="Show the physical Chrome client.")
    parser.add_argument("--screenshot", action="store_true", help="Retain a lobby screenshot in the evidence directory.")
    parser.add_argument("--validate-only", action="store_true", help="Validate the production fixture and HTTPS origin without opening Chrome.")
    return parser.parse_args(argv)


def resolved_path(value: str, label: str) -> Path:
    path = Path(value).expanduser().resolve()
    if not str(path):
        raise RehearsalError(f"{label} is required")
    return path


def assert_external(path: Path, label: str) -> Path:
    try:
        path.relative_to(REPO_ROOT)
    except ValueError:
        return path
    raise RehearsalError(f"{label} must be outside the repository")


def normalized_base_url(value: str) -> str:
    parsed = urlparse(str(value).strip())
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise RehearsalError("--base-url must be an HTTPS origin")
    host = (parsed.hostname or "").lower().rstrip(".")
    try:
        host_ip = ipaddress.ip_address(host)
    except ValueError:
        host_ip = None
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local") or host_ip and (host_ip.is_loopback or host_ip.is_private or host_ip.is_link_local or host_ip.is_reserved):
        raise RehearsalError("--base-url must not target a local or emulator host")
    if parsed.username or parsed.password:
        raise RehearsalError("--base-url must not include credentials")
    if parsed.query or parsed.fragment:
        raise RehearsalError("--base-url must not include a query or fragment")
    return urlunparse(("https", parsed.netloc, parsed.path.rstrip("/"), "", "", ""))


def read_json(path: Path, label: str) -> dict:
    if not path.is_file():
        raise RehearsalError(f"{label} does not exist: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RehearsalError(f"{label} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise RehearsalError(f"{label} must contain a JSON object")
    return value


def find_forbidden_fixture_value(value: object, location: str = "$") -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key).lower()
            if any(marker in key_text for marker in EMULATOR_MARKERS):
                return f"{location}.{key}"
            found = find_forbidden_fixture_value(child, f"{location}.{key}")
            if found:
                return found
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found = find_forbidden_fixture_value(child, f"{location}[{index}]")
            if found:
                return found
    elif isinstance(value, str):
        lower = value.lower()
        if any(marker in lower for marker in EMULATOR_MARKERS):
            return location
    return None


def nonempty(value: object, label: str) -> str:
    result = str(value or "").strip()
    if not result:
        raise RehearsalError(f"{label} is required")
    return result


def full_sha(value: object, label: str) -> str:
    result = nonempty(value, label)
    if not FULL_SHA_RE.fullmatch(result):
        raise RehearsalError(f"{label} must be a full lowercase 40-character revision SHA")
    return result


def finite_epoch(value: object, label: str, *, future: bool = False) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise RehearsalError(f"{label} must be a finite epoch-seconds timestamp") from error
    if not math.isfinite(result) or (future and result <= time.time()):
        raise RehearsalError(f"{label} must be a finite future epoch-seconds timestamp")
    return result


def stable_hash(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def candidate_asset_files(manifest: dict[str, object]) -> dict[str, str]:
    publication_files = manifest.get("files", {})
    verification_files = manifest.get("verificationFiles", {})
    if not isinstance(publication_files, dict) or not isinstance(verification_files, dict):
        raise RehearsalError("candidate manifest publication and verification file maps must be objects")
    combined = dict(publication_files)
    for relative, digest in verification_files.items():
        if relative in combined and combined[relative] != digest:
            raise RehearsalError(f"candidate manifest has conflicting hashes for {relative}")
        combined[relative] = digest
    return combined


def hosting_url_to_repo_path(asset_url: str, base_url: str) -> str | None:
    asset = urlparse(str(asset_url or ""))
    base = urlparse(str(base_url or ""))
    if asset.scheme.lower() != base.scheme.lower() or asset.netloc.lower() != base.netloc.lower():
        return None
    asset_path = unquote(asset.path or "/")
    base_path = (base.path or "").rstrip("/")
    if base_path and (asset_path == base_path or asset_path.startswith(base_path + "/")):
        asset_path = asset_path[len(base_path):] or "/"
    if asset_path == "/api" or asset_path.startswith("/api/"):
        return None
    if asset_path.endswith("/"):
        asset_path += "index.html"
    relative = asset_path.lstrip("/")
    return f"public/{relative}" if relative else "public/index.html"


def read_authoritative_notes(page, room_id: str, uid: str) -> dict[str, object]:
    result = page.evaluate(
        """async ({roomId, uid}) => {
            const user = window.firebase?.auth?.()?.currentUser;
            if (!user) return { status: 401, body: { success: false, message: 'No authenticated user' } };
            const token = await user.getIdToken();
            const response = await fetch(`/api/presentation-demo/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(uid)}`, {
                headers: { Authorization: `Bearer ${token}` }, cache: 'no-store'
            });
            return { status: response.status, body: await response.json().catch(() => ({})) };
        }""",
        {"roomId": room_id, "uid": uid},
    )
    if not isinstance(result, dict) or result.get("status") != 200:
        raise RehearsalError("authoritative notebook readback did not return HTTP 200")
    body = result.get("body")
    if not isinstance(body, dict) or body.get("success") is False:
        raise RehearsalError("authoritative notebook readback was rejected by the server")
    data = body.get("data", body)
    if not isinstance(data, dict) or not isinstance(data.get("pages", []), list):
        raise RehearsalError("authoritative notebook readback did not contain a pages list")
    return data


def validate_account(account: object, label: str) -> dict[str, str]:
    if not isinstance(account, dict):
        raise RehearsalError(f"{label} must be an object")
    uid = nonempty(account.get("uid"), f"{label}.uid")
    email = nonempty(account.get("email"), f"{label}.email").lower()
    password = nonempty(account.get("password"), f"{label}.password")
    if "@" not in email or " " in email:
        raise RehearsalError(f"{label}.email is not a valid account email")
    if len(password) < 8:
        raise RehearsalError(f"{label}.password is unexpectedly short")
    return {"uid": uid, "email": email, "password": password}


def validate_fixture(value: dict) -> dict[str, object]:
    if value.get("mode") != "production-approved" or value.get("approved") is not True:
        raise RehearsalError("accounts fixture must declare mode=production-approved and approved=true")
    if value.get("projectId") != LIVE_PROJECT_ID:
        raise RehearsalError(f"accounts fixture projectId must be {LIVE_PROJECT_ID}")
    forbidden = find_forbidden_fixture_value(value)
    if forbidden:
        raise RehearsalError(f"accounts fixture contains a local/emulator marker at {forbidden}")
    accounts = value.get("accounts")
    if not isinstance(accounts, dict):
        raise RehearsalError("accounts fixture must contain accounts.presenter, accounts.participants, and accounts.negative")
    presenter = validate_account(accounts.get("presenter"), "accounts.presenter")
    participants_value = accounts.get("participants")
    if not isinstance(participants_value, list) or len(participants_value) != 3:
        raise RehearsalError("accounts.participants must contain exactly three accounts")
    participants = [validate_account(item, f"accounts.participants[{index}]") for index, item in enumerate(participants_value)]
    negative = validate_account(accounts.get("negative"), "accounts.negative")
    all_accounts = [presenter, *participants, negative]
    uids = [item["uid"] for item in all_accounts]
    emails = [item["email"] for item in all_accounts]
    if len(set(uids)) != 5 or len(set(emails)) != 5:
        raise RehearsalError("all five approved accounts must have distinct uid and email values")
    return {"presenter": presenter, "participants": participants, "negative": negative}


def account_for_role(accounts: dict[str, object], role: str) -> dict[str, str]:
    if role == "presenter":
        return accounts["presenter"]  # type: ignore[return-value]
    if role == "negative":
        return accounts["negative"]  # type: ignore[return-value]
    return accounts["participants"][int(role[1]) - 1]  # type: ignore[index,return-value]


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def safe_url(value: str) -> str:
    parsed = urlparse(value)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))


def requested_actions(args: argparse.Namespace) -> list[str]:
    if args.four_player:
        return [
            "normal-crm-launch",
            "open-presentation-demo",
            "room-create",
            "room-join-p1",
            "room-join-p2",
            "room-join-p3",
            "game-connect-p0",
            "game-connect-p1",
            "game-connect-p2",
            "game-connect-p3",
            "progression",
            "reconnect",
            "notes-p1",
            "notes-p2",
            "notes-p3",
            "end-room",
            "pdf-export"
        ]
    actions = ["normal-crm-launch", "open-presentation-demo"]
    if args.create_room:
        actions.append("create-room")
    if args.room_code:
        actions.append("join-room")
    if args.open_game:
        actions.append("open-game")
    return actions


def validate_action_scope(args: argparse.Namespace) -> None:
    if args.four_player:
        if args.role != "presenter":
            raise RehearsalError("--four-player is run by the presenter operator")
        if args.room_code or args.create_room or args.open_game:
            raise RehearsalError("--four-player cannot be combined with per-client room flags")
        if not args.allow_live_writes:
            raise RehearsalError("--four-player requires --allow-live-writes plus per-scenario approval and lease files")
    if args.create_room and args.role != "presenter":
        raise RehearsalError("--create-room is only valid for the presenter client")
    if args.room_code and args.role == "presenter":
        raise RehearsalError("the presenter creates the room; participant clients use --room-code")
    if args.open_game and args.role == "negative":
        raise RehearsalError("the negative-control client must not open a game connection")
    if (args.role in {"p1", "p2", "p3", "negative"}) and (args.room_code is None) and (args.open_game or args.allow_live_writes):
        raise RehearsalError("participant and negative live runs require --room-code")
    has_live_action = bool(args.create_room or args.room_code or args.open_game)
    if has_live_action and not args.allow_live_writes:
        raise RehearsalError("room and game actions require --allow-live-writes plus an approval file")
    if not args.allow_live_writes:
        if args.approval_file or args.candidate_sha or args.base_sha or args.scope_hash:
            raise RehearsalError("approval arguments are only valid with --allow-live-writes")
        return
    if not args.approval_file or not args.candidate_sha or not args.base_sha or not args.scope_hash:
        raise RehearsalError("live actions require --approval-file, --candidate-sha, --base-sha, and --scope-hash")
    if not args.lease_file:
        raise RehearsalError("live actions require an external --lease-file")
    if not args.candidate_manifest:
        raise RehearsalError("live actions require an external --candidate-manifest")
    if not args.deployed_identities and not getattr(args, "deployed_identities_url", None):
        raise RehearsalError("live actions require an external deployed-identities source")
    if not getattr(args, "validate_only", False) and not getattr(args, "deployed_identities_url", None):
        raise RehearsalError("live actions require --deployed-identities-url; a file readback is configuration-only")


def validate_approval(args: argparse.Namespace, approval_path: Path) -> dict[str, object]:
    approval = read_json(approval_path, "approval file")
    if approval.get("schemaVersion") != 1 or approval.get("expiryUnit") != EXPIRY_UNIT:
        raise RehearsalError("approval file must use schemaVersion 1 and epoch-seconds expiry")
    if approval.get("mode") != "production-approved" or approval.get("owner") in (None, "") or approval.get("leaseId") in (None, ""):
        raise RehearsalError("approval file must declare mode=production-approved, owner, and leaseId")
    finite_epoch(approval.get("expiresAt"), "approval.expiresAt", future=True)
    if not isinstance(approval.get("resources"), list) or not approval["resources"]:
        raise RehearsalError("approval.resources must be a non-empty list")
    full_sha(approval.get("candidateSha"), "approval.candidateSha")
    full_sha(approval.get("baseSha"), "approval.baseSha")
    if approval.get("candidateSha") != args.candidate_sha or approval.get("baseSha") != args.base_sha or approval.get("scopeHash") != args.scope_hash:
        raise RehearsalError("approval does not match the candidate SHA, base SHA, or scope hash")
    full_sha(args.candidate_sha, "--candidate-sha")
    full_sha(args.base_sha, "--base-sha")
    if not SHA256_RE.fullmatch(str(args.scope_hash or "")):
        raise RehearsalError("--scope-hash must be a full SHA-256 hash")
    expected_actions = requested_actions(args)
    if approval.get("actions") != expected_actions:
        raise RehearsalError("approval action sequence does not match this rehearsal client")
    if args.four_player:
        scenarios = approval.get("scenarios")
        if not isinstance(scenarios, dict):
            raise RehearsalError("four-player approval must contain per-scenario approvals")
        for scenario in expected_actions:
            entry = scenarios.get(scenario)
            if not isinstance(entry, dict) or entry.get("action") != scenario:
                raise RehearsalError(f"approval.scenarios.{scenario} is required and must identify its action")
            if entry.get("schemaVersion") != 1 or entry.get("expiryUnit") != EXPIRY_UNIT:
                raise RehearsalError(f"approval.scenarios.{scenario} must use schemaVersion 1 and epoch-seconds expiry")
            if entry.get("owner") != approval.get("owner") or entry.get("leaseId") != approval.get("leaseId") or entry.get("operationId") in (None, ""):
                raise RehearsalError(f"approval.scenarios.{scenario} must retain the approved owner, lease, and operation")
            if entry.get("resources") != approval.get("resources"):
                raise RehearsalError(f"approval.scenarios.{scenario}.resources do not match the approved resource set")
            full_sha(entry.get("candidateSha"), f"approval.scenarios.{scenario}.candidateSha")
            full_sha(entry.get("baseSha"), f"approval.scenarios.{scenario}.baseSha")
            finite_epoch(entry.get("expiresAt"), f"approval.scenarios.{scenario}.expiresAt", future=True)
            if "expectedState" in entry:
                if not isinstance(entry["expectedState"], dict):
                    raise RehearsalError(f"approval.scenarios.{scenario}.expectedState must be an object")
                expected_hash = entry.get("expectedStateHash")
                if not SHA256_RE.fullmatch(str(expected_hash or "")) or expected_hash != stable_hash(entry["expectedState"]):
                    raise RehearsalError(f"approval.scenarios.{scenario}.expectedStateHash does not match expectedState")
    return approval


def validate_deployed_identities(args: argparse.Namespace, identity_source: Path | dict[str, object], approval: dict[str, object], scenario: str | None = None, *, provider: bool = False) -> dict[str, object]:
    identity = read_json(identity_source, "deployed identities readback") if isinstance(identity_source, Path) else identity_source
    if not isinstance(identity, dict):
        raise RehearsalError("deployed identities readback must be an object")
    if identity.get("schemaVersion") != 1 or identity.get("expiryUnit") != EXPIRY_UNIT:
        raise RehearsalError("deployed identities must use schemaVersion 1 and epoch-seconds")
    if identity.get("owner") != approval.get("owner"):
        raise RehearsalError("deployed identities owner no longer matches the approved publisher")
    if identity.get("resources") != approval.get("resources"):
        raise RehearsalError("deployed identities resources no longer match the approved resources")
    for key in ("candidateSha", "baseSha"):
        full_sha(identity.get(key), f"deployed identities {key}")
        if identity.get(key) != approval.get(key):
            raise RehearsalError(f"deployed identities {key} no longer matches the approved candidate")
    if identity.get("scopeHash") != approval.get("scopeHash"):
        raise RehearsalError("deployed identities scope hash no longer matches approval")
    try:
        read_at = float(identity.get("readAt"))
    except (TypeError, ValueError) as error:
        raise RehearsalError("deployed identities readAt must be a finite epoch-seconds timestamp") from error
    if not math.isfinite(read_at) or read_at > time.time() + 5 or time.time() - read_at > IDENTITY_MAX_AGE_SECONDS:
        raise RehearsalError("deployed identities readback is stale or has an invalid timestamp")
    if provider:
        provider_request = identity.get("_providerRequest")
        if not isinstance(provider_request, dict):
            raise RehearsalError("deployed identities provider response is not bound to the current request")
        request_nonce = nonempty(provider_request.get("requestNonce"), "provider request nonce")
        if identity.get("requestNonce") != request_nonce:
            raise RehearsalError("deployed identities provider response nonce does not match the current request")
        try:
            request_started_at = float(provider_request.get("requestStartedAt"))
            request_completed_at = float(provider_request.get("requestCompletedAt"))
        except (TypeError, ValueError) as error:
            raise RehearsalError("provider request timestamps must be finite epoch-seconds values") from error
        if not math.isfinite(request_started_at) or not math.isfinite(request_completed_at) or request_completed_at < request_started_at:
            raise RehearsalError("provider request timestamps must be finite and ordered")
        if read_at < request_started_at - IDENTITY_REQUEST_CLOCK_SKEW_SECONDS or read_at > request_completed_at + IDENTITY_REQUEST_CLOCK_SKEW_SECONDS:
            raise RehearsalError("deployed identities provider sample was not read during the current request")
    if not isinstance(identity.get("state"), dict) or not SHA256_RE.fullmatch(str(identity.get("stateHash") or "")):
        raise RehearsalError("deployed identities must contain a state object and full stateHash")
    if identity["stateHash"] != stable_hash(identity["state"]):
        raise RehearsalError("deployed identities stateHash does not match the state readback")
    if scenario:
        scenario_entry = approval.get("scenarios", {}).get(scenario, {})
        expected = scenario_entry.get("expectedStateHash") if isinstance(scenario_entry, dict) else None
        if not SHA256_RE.fullmatch(str(expected or "")) or expected != identity["stateHash"]:
            raise RehearsalError(f"scenario {scenario} expected state does not match the fresh deployed identity readback")
        expected_state = scenario_entry.get("expectedState") if isinstance(scenario_entry, dict) else None
        if provider:
            if not isinstance(expected_state, dict):
                raise RehearsalError(f"scenario {scenario} requires a complete expectedState for live provider verification")
            if identity["state"] != expected_state:
                raise RehearsalError(f"scenario {scenario} deployed state differs from the complete reviewed expected state")
    if provider and not identity.get("source"):
        raise RehearsalError("deployed identities provider response must identify its read-only source")
    return identity


def normalized_identity_provider_url(value: str) -> str:
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise RehearsalError("--deployed-identities-url must be an HTTPS read-only provider")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RehearsalError("--deployed-identities-url must not include credentials, query, or fragment")
    host = (parsed.hostname or "").lower().rstrip(".")
    try:
        host_ip = ipaddress.ip_address(host)
    except ValueError:
        host_ip = None
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local") or host_ip and (host_ip.is_loopback or host_ip.is_private or host_ip.is_link_local or host_ip.is_reserved):
        raise RehearsalError("--deployed-identities-url must not target a local or emulator host")
    return urlunparse(("https", parsed.netloc, parsed.path.rstrip("/"), "", "", ""))


def read_deployed_identities_provider(args: argparse.Namespace, scenario: str) -> dict[str, object]:
    url = normalized_identity_provider_url(args.deployed_identities_url)
    request_nonce = uuid.uuid4().hex
    request_started_at = time.time()
    headers = {
        "Accept": "application/json",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "X-BEL-Request-Nonce": request_nonce,
    }
    token = os.environ.get("BEL_DEPLOYED_IDENTITIES_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=20) as response:
            if response.status != 200:
                raise RehearsalError(f"deployed identities provider returned HTTP {response.status}")
            body = response.read()
        request_completed_at = time.time()
    except HTTPError as error:
        raise RehearsalError(f"deployed identities provider returned HTTP {error.code}") from error
    except (OSError, URLError) as error:
        raise RehearsalError(f"deployed identities provider read failed: {error}") from error
    try:
        identity = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RehearsalError("deployed identities provider did not return valid UTF-8 JSON") from error
    if not isinstance(identity, dict):
        raise RehearsalError("deployed identities provider must return a JSON object")
    identity = dict(identity)
    identity["source"] = url
    identity["readMethod"] = "GET"
    identity["scenario"] = scenario
    identity["_providerRequest"] = {
        "requestNonce": request_nonce,
        "requestStartedAt": request_started_at,
        "requestCompletedAt": request_completed_at,
    }
    return identity


def current_deployed_identities(args: argparse.Namespace, approval: dict[str, object], scenario: str, identity_provider=None) -> dict[str, object]:
    if identity_provider is not None:
        identity = identity_provider(scenario)
        return validate_deployed_identities(args, identity, approval, scenario, provider=True)
    if getattr(args, "deployed_identities_url", None):
        identity = read_deployed_identities_provider(args, scenario)
        return validate_deployed_identities(args, identity, approval, scenario, provider=True)
    if not getattr(args, "validate_only", False):
        raise RehearsalError("live scenario requires an immediate read-only deployed identity provider URL")
    identity_path = assert_external(resolved_path(args.deployed_identities, "--deployed-identities"), "--deployed-identities")
    return validate_deployed_identities(args, identity_path, approval, scenario)


def validate_scenario_approval(args: argparse.Namespace, approval_path: Path, scenario: str, identity_provider=None) -> dict[str, object]:
    """Reread approval and lease immediately before each state-changing scenario."""
    approval = validate_approval(args, approval_path)
    lease_path = assert_external(resolved_path(args.lease_file, "--lease-file"), "--lease-file")
    lease = read_json(lease_path, "publisher lease file")
    scenario_approval = approval.get("scenarios", {}).get(scenario)
    if not isinstance(scenario_approval, dict):
        raise RehearsalError(f"approval.scenarios.{scenario} is required")
    if scenario_approval.get("action") != scenario:
        raise RehearsalError(f"approval.scenarios.{scenario}.action does not match the requested scenario")
    if scenario_approval.get("schemaVersion") != 1 or scenario_approval.get("expiryUnit") != EXPIRY_UNIT:
        raise RehearsalError(f"scenario {scenario} approval has an invalid schema or expiry unit")
    approval_owner = approval.get("owner")
    if scenario_approval.get("owner") != approval_owner or scenario_approval.get("operationId") in (None, ""):
        raise RehearsalError(f"scenario {scenario} approval owner or operation identity changed")
    for key, expected in (("candidateSha", args.candidate_sha), ("baseSha", args.base_sha), ("scopeHash", args.scope_hash), ("owner", approval_owner), ("leaseId", approval.get("leaseId")), ("operationId", scenario_approval.get("operationId"))):
        if scenario_approval.get(key) != expected or lease.get(key) != expected:
            raise RehearsalError(f"scenario {scenario} or publisher lease does not match {key}")
    if scenario_approval.get("resources") != approval.get("resources") or lease.get("resources") != approval.get("resources"):
        raise RehearsalError(f"scenario {scenario} resource ownership no longer matches approval")
    if lease.get("schemaVersion") != 1 or lease.get("expiryUnit") != EXPIRY_UNIT or lease.get("operationState") != "pending" or lease.get("state") != "ACTIVE":
        raise RehearsalError(f"scenario {scenario} publisher lease is expired or inactive")
    scenario_expiry = finite_epoch(scenario_approval.get("expiresAt"), f"scenario {scenario}.expiresAt", future=True)
    lease_expiry = finite_epoch(lease.get("expiresAt"), f"scenario {scenario} lease.expiresAt", future=True)
    if min(scenario_expiry, lease_expiry) <= time.time():
        raise RehearsalError(f"scenario {scenario} approval or publisher lease is expired or inactive")
    identity = current_deployed_identities(args, approval, scenario, identity_provider)
    reads = getattr(args, "_fresh_deployed_reads", None)
    if reads is not None:
        reads.append({
            "scenario": scenario,
            "source": safe_url(str(identity.get("source") or "file-readback")),
            "readMethod": identity.get("readMethod", "file-readback"),
            "readAt": identity.get("readAt"),
            "stateHash": identity.get("stateHash"),
        })
    return identity


def validate_candidate_manifest(args: argparse.Namespace, manifest_path: Path) -> dict[str, object]:
    manifest = read_json(manifest_path, "candidate manifest")
    full_sha(args.candidate_sha, "--candidate-sha")
    if not FULL_SHA_RE.fullmatch(str(manifest.get("revision") or "")) or manifest.get("revision") != args.candidate_sha:
        raise RehearsalError("candidate manifest revision does not match --candidate-sha")
    if manifest.get("fullRevision", manifest["revision"]) != args.candidate_sha:
        raise RehearsalError("candidate manifest fullRevision does not match --candidate-sha")
    if "baseSha" in manifest and manifest["baseSha"] != args.base_sha:
        raise RehearsalError("candidate manifest baseSha does not match --base-sha")
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise RehearsalError("candidate manifest must contain a non-empty files map")
    verification_files = manifest.get("verificationFiles", {})
    if not isinstance(verification_files, dict):
        raise RehearsalError("candidate manifest verificationFiles must be an object when present")
    bound_files = candidate_asset_files(manifest)
    for relative, digest in bound_files.items():
        if not isinstance(relative, str) or not relative or not SHA256_RE.fullmatch(str(digest)):
            raise RehearsalError(f"candidate manifest has an invalid SHA-256 for {relative}")
        candidate_path = (REPO_ROOT / relative).resolve()
        try:
            candidate_path.relative_to(REPO_ROOT)
        except ValueError as error:
            raise RehearsalError(f"candidate manifest path escapes the repository: {relative}") from error
        if Path(relative).is_absolute() or ".." in Path(relative).parts or not candidate_path.is_file():
            raise RehearsalError(f"candidate manifest path does not identify a repository file: {relative}")
        actual = hashlib.sha256(candidate_path.read_bytes()).hexdigest()
        if actual != digest:
            raise RehearsalError(f"candidate manifest digest does not match candidate bytes for {relative}")
    return {"revision": manifest["revision"], "fullRevision": manifest.get("fullRevision", manifest["revision"]), "baseSha": manifest.get("baseSha"), "files": dict(files), "verificationFiles": dict(verification_files), "publicationFileCount": len(files), "verificationFileCount": len(verification_files), "boundToLocalBytes": True}


def safe_failure(error: BaseException) -> dict[str, str]:
    message = str(error)
    message = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[redacted-email]", message, flags=re.IGNORECASE)
    return {"type": type(error).__name__, "message": message[:500]}


def extract_pdf_text(pdf_path: Path) -> str:
    try:
        from pypdf import PdfReader
        return "\n".join(page.extract_text() or "" for page in PdfReader(str(pdf_path)).pages)
    except ImportError:
        try:
            import pdfplumber
            with pdfplumber.open(str(pdf_path)) as document:
                return "\n".join(page.extract_text() or "" for page in document.pages)
        except ImportError as error:
            raise RehearsalError("PDF text extraction requires pypdf or pdfplumber") from error


def save_and_inspect_pdf(download, pdf_path: Path) -> dict[str, object]:
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    download.save_as(str(pdf_path))
    pdf_bytes = pdf_path.read_bytes()
    if not pdf_bytes.startswith(b"%PDF-"):
        raise RehearsalError("PDF export did not produce a PDF payload")
    text = extract_pdf_text(pdf_path)
    if not text.strip():
        raise RehearsalError("PDF export contained no extractable text")
    return {"path": str(pdf_path), "sha256": hashlib.sha256(pdf_bytes).hexdigest(), "bytes": len(pdf_bytes), "text": text}


def wait_for_text(page, selector: str, text: str, timeout: int = 30000) -> None:
    page.locator(selector).wait_for(state="visible", timeout=timeout)
    page.wait_for_function(
        "([selector, text]) => document.querySelector(selector)?.textContent.includes(text)",
        arg=[selector, text],
        timeout=timeout,
    )


def redacted_text(value: object) -> str:
    text = str(value or "")
    text = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[redacted-email]", text, flags=re.IGNORECASE)
    text = re.sub(r"(?:Bearer\s+|token=)[^\s&]+", "[redacted-token]", text, flags=re.IGNORECASE)
    return text[:500]


def attach_page_diagnostics(page, diagnostics: dict[str, object], role: str, surface: str, base_url: str | None = None, candidate_manifest: dict[str, object] | None = None) -> None:
    bucket = {"console": [], "pageErrors": [], "requestFailures": [], "allowedRequestFailures": 0, "servedAssets": []}
    diagnostics.setdefault(role, {})[surface] = bucket

    def append(key: str, value: object) -> None:
        values = bucket[key]
        if len(values) < 100:
            values.append(redacted_text(value))

    page.on("console", lambda message: append("console", f"{message.type}: {message.text}"))
    page.on("pageerror", lambda error: append("pageErrors", error))
    page.on("requestfailed", lambda request: append("requestFailures", safe_url(request.url)))

    def capture_served_asset(response) -> None:
        repo_path = hosting_url_to_repo_path(response.url, base_url or response.url)
        manifest_files = candidate_asset_files(candidate_manifest) if isinstance(candidate_manifest, dict) else None
        content_type = response.headers.get("content-type", "")
        if repo_path is None or not re.search(r"text/html|(?:java|ecma)script|text/css", content_type, re.IGNORECASE):
            return
        record = {
            "url": safe_url(response.url),
            "repoPath": repo_path,
            "status": response.status,
            "contentType": content_type,
            "expectedSha256": manifest_files.get(repo_path) if manifest_files is not None else None,
        }
        try:
            body = response.body()
            record.update({"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
        except Exception as error:  # noqa: BLE001 - retain the failed byte read as evidence
            record["bodyError"] = redacted_text(error)
        bucket["servedAssets"].append(record)

    page.on("response", capture_served_asset)


def assert_candidate_assets(diagnostics: dict[str, object], role: str, surface: str, candidate_manifest: dict[str, object], result: dict[str, object]) -> None:
    bucket = diagnostics.get(role, {}).get(surface, {})
    responses = bucket.get("servedAssets", [])
    manifest_files = candidate_asset_files(candidate_manifest)
    if not isinstance(manifest_files, dict) or not manifest_files:
        raise RehearsalError("candidate manifest does not contain a non-empty files map")
    if not responses:
        raise RehearsalError(f"{role}/{surface} did not serve any manifest-bound CRM/BEL assets")
    for response in responses:
        repo_path = response.get("repoPath")
        expected = manifest_files.get(repo_path)
        if not SHA256_RE.fullmatch(str(expected or "")):
            raise RehearsalError(f"{role}/{surface} served asset is not bound to the candidate manifest: {repo_path}")
        if response.get("status") != 200 or response.get("bodyError") or response.get("sha256") != expected:
            raise RehearsalError(f"{role}/{surface} served bytes do not match the candidate manifest for {repo_path}")
        asset = {
            "role": role,
            "surface": surface,
            "repoPath": repo_path,
            "url": response["url"],
            "status": response["status"],
            "contentType": response["contentType"],
            "bytes": response["bytes"],
            "sha256": response["sha256"],
            "boundToCandidateManifest": True,
        }
        existing = result.setdefault("browserServedCandidateAssets", [])
        if not any(item.get("role") == role and item.get("surface") == surface and item.get("repoPath") == repo_path and item.get("url") == asset["url"] and item.get("sha256") == asset["sha256"] for item in existing):
            existing.append(asset)


def assert_candidate_asset(diagnostics: dict[str, object], role: str, surface: str, candidate_manifest: dict[str, object], result: dict[str, object]) -> None:
    """Compatibility wrapper retained for callers that assert a completed surface."""
    assert_candidate_assets(diagnostics, role, surface, candidate_manifest, result)


def assert_no_authority_hooks(page, surface: str) -> None:
    if page.evaluate("() => Boolean(window.belOnlineDebug || window.__phase4Login || window.__BEL_EMULATOR__)"):
        raise RehearsalError(f"{surface} exposed a debug or emulator authority hook")


def assert_diagnostics_clean(diagnostics: dict[str, object]) -> None:
    problems = []
    for role, surfaces in diagnostics.items():
        for surface, bucket in surfaces.items():
            unexpected_requests = max(0, len(bucket["requestFailures"]) - int(bucket.get("allowedRequestFailures", 0)))
            if bucket["pageErrors"] or unexpected_requests or any(item.lower().startswith("error:") for item in bucket["console"]):
                problems.append(f"{role}/{surface}: console={len(bucket['console'])}, page={len(bucket['pageErrors'])}, requests={len(bucket['requestFailures'])}")
    if problems:
        raise RehearsalError("browser runtime diagnostics were not clean: " + "; ".join(problems))


def open_authenticated_lobby(browser, base_url: str, account: dict[str, str], role: str, diagnostics: dict[str, object], candidate_manifest: dict[str, object] | None = None, result: dict[str, object] | None = None):
    context = browser.new_context(accept_downloads=True)
    crm = context.new_page()
    attach_page_diagnostics(crm, diagnostics, role, "crm", base_url, candidate_manifest)
    crm.set_default_timeout(30000)
    crm_url = f"{base_url}/crm-admin.html"
    crm.goto(crm_url, wait_until="domcontentloaded")
    crm.wait_for_function("() => window.firebase && typeof window.firebase.auth === 'function'", timeout=30000)
    crm.evaluate(
        """async ({email, password}) => {
            const auth = window.firebase.auth();
            await auth.signOut();
            await auth.signInWithEmailAndPassword(email, password);
        }""",
        {"email": account["email"], "password": account["password"]},
    )
    crm.goto(crm_url, wait_until="domcontentloaded")
    more = crm.locator('[data-label="More"]')
    more.wait_for(state="visible", timeout=30000)
    more.click()
    menu_item = crm.locator('.crm-nav-more-dropdown .crm-dropdown-menu button[data-main="presentation-demo"]')
    menu_item.wait_for(state="visible", timeout=15000)
    menu_item.click()
    panel = crm.locator("#crm-presentation-demo-workspace")
    panel.wait_for(state="visible", timeout=15000)
    open_button = crm.locator("#crm-presentation-demo-open")
    open_button.wait_for(state="visible", timeout=15000)
    with crm.expect_popup(timeout=15000) as popup_info:
        open_button.click()
    lobby = popup_info.value
    attach_page_diagnostics(lobby, diagnostics, role, "lobby", base_url, candidate_manifest)
    lobby.set_default_timeout(30000)
    lobby.wait_for_load_state("domcontentloaded")
    wait_for_text(lobby, "#pd-auth-status", "Signed in", timeout=30000)
    if candidate_manifest is not None and result is not None:
        assert_candidate_assets(diagnostics, role, "crm", candidate_manifest, result)
        assert_candidate_assets(diagnostics, role, "lobby", candidate_manifest, result)
    assert_no_authority_hooks(crm, f"{role} CRM")
    assert_no_authority_hooks(lobby, f"{role} lobby")
    return {"context": context, "crm": crm, "lobby": lobby, "game": None}


def open_game_client(client: dict[str, object], role: str, diagnostics: dict[str, object], base_url: str | None = None, candidate_manifest: dict[str, object] | None = None, result: dict[str, object] | None = None):
    lobby = client["lobby"]
    with lobby.expect_popup(timeout=15000) as popup_info:
        lobby.locator("#pd-open-game").click()
    game = popup_info.value
    attach_page_diagnostics(game, diagnostics, role, "game", base_url, candidate_manifest)
    game.set_default_timeout(30000)
    game.wait_for_load_state("domcontentloaded")
    wait_for_text(game, "#pd-connection-status", "Connected", timeout=45000)
    assert_no_authority_hooks(game, f"{role} game")
    if candidate_manifest is not None and result is not None:
        assert_candidate_assets(diagnostics, role, "game", candidate_manifest, result)
    client["game"] = game
    return game


def exercise_authored_presentation(game, before_mutation=None) -> dict[str, str]:
    """Exercise the authored Studio A monitor; return a recovery label on failure."""
    try:
        game.locator("#pd-world").focus()
        game.keyboard.down("d")
        game.keyboard.down("w")
        try:
            game.wait_for_timeout(3200)
        finally:
            game.keyboard.up("d")
            game.keyboard.up("w")
        game.locator("#pd-interact").click()
        panel = game.locator("#pd-world-panel")
        panel.wait_for(state="visible", timeout=10000)
        start = panel.locator("[data-presentation-start]")
        start.wait_for(state="visible", timeout=10000)
        if start.is_disabled():
            raise RehearsalError("Studio A monitor was reached but the authored presentation was not ready")
        if before_mutation is not None:
            before_mutation()
        start.click()
        wait_for_text(game, "#pd-deck-status", "Synchronized", timeout=30000)
        if before_mutation is not None:
            before_mutation()
        game.locator("#pd-close-presentation").click()
        panel.wait_for(state="hidden", timeout=10000)
        return {"status": "authored-monitor-presentation", "interaction": "monitor-open-close"}
    except Exception as error:  # noqa: BLE001 - bounded recovery is part of the rehearsal evidence
        try:
            close = game.locator("#pd-close-presentation")
            if close.is_visible() and before_mutation is not None:
                before_mutation()
            if close.is_visible():
                close.click()
        except Exception:
            pass
        try:
            game.keyboard.press("Escape")
        except Exception:
            pass
        return {"status": "presenter-skip-recovery", "reason": redacted_text(error)}


def run_four_player_scenario(args: argparse.Namespace, base_url: str, accounts: dict[str, object], evidence: Path, result: dict, approval_path: Path, candidate_manifest: dict[str, object] | None = None) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RehearsalError("Python Playwright is required for the Chrome rehearsal") from error

    diagnostics: dict[str, object] = {}
    clients: dict[str, dict[str, object]] = {}
    browser = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=args.channel, headless=not args.headed)
            for role in ("presenter", "p1", "p2", "p3"):
                validate_scenario_approval(args, approval_path, "normal-crm-launch")
                validate_scenario_approval(args, approval_path, "open-presentation-demo")
                clients[role] = open_authenticated_lobby(browser, base_url, account_for_role(accounts, role), role, diagnostics, candidate_manifest, result)
            result["assertions"].extend(["four-crm-clients-authenticated", "four-lobby-pages-diagnosed"])

            validate_scenario_approval(args, approval_path, "room-create")
            presenter_lobby = clients["presenter"]["lobby"]
            presenter_lobby.locator("#pd-create-room").wait_for(state="visible")
            presenter_lobby.locator("#pd-create-room").click()
            presenter_lobby.locator("#pd-room").wait_for(state="visible", timeout=30000)
            room_code = presenter_lobby.locator("#pd-room-code-display").inner_text().strip()
            if not room_code:
                raise RehearsalError("four-player room creation returned no room code")
            result["createdRoomCodeFingerprint"] = fingerprint(room_code)
            result["assertions"].append("four-player-room-created")

            for role in ("p1", "p2", "p3"):
                validate_scenario_approval(args, approval_path, f"room-join-{role}")
                lobby = clients[role]["lobby"]
                lobby.locator("#pd-join-form").wait_for(state="visible")
                lobby.locator("#pd-room-code").fill(room_code)
                lobby.locator("#pd-join-form button[type='submit']").click()
                lobby.locator("#pd-room").wait_for(state="visible", timeout=30000)
            result["assertions"].append("four-player-room-joins-complete")

            for role in ("presenter", "p1", "p2", "p3"):
                validate_scenario_approval(args, approval_path, f"game-connect-p{0 if role == 'presenter' else role[1:]}")
                open_game_client(clients[role], role, diagnostics, base_url, candidate_manifest, result)
            result["assertions"].append("four-player-game-connections-complete")

            presenter_game = clients["presenter"]["game"]
            presenter_game.locator("#pd-start-room").wait_for(state="visible", timeout=45000)
            validate_scenario_approval(args, approval_path, "progression")
            presenter_game.locator("#pd-start-room").click()
            wait_for_text(presenter_game, "#pd-gate", "Reception", timeout=30000)
            progression = []
            progression_coverage = {}
            for scene in ("A", "B1", "C", "D", "E", "F"):
                validate_scenario_approval(args, approval_path, "progression")
                skip = presenter_game.locator("#pd-skip-activity")
                skip.wait_for(state="visible", timeout=30000)
                skip.click()
                presenter_game.wait_for_function("scene => document.body.dataset.scene === scene", arg=scene, timeout=30000)
                for role in ("presenter", "p1", "p2", "p3"):
                    clients[role]["game"].wait_for_function("scene => document.body.dataset.scene === scene", arg=scene, timeout=30000)
                progression.append(scene)
                if scene == "A":
                    progression_coverage[scene] = exercise_authored_presentation(
                        presenter_game,
                        before_mutation=lambda: validate_scenario_approval(args, approval_path, "progression"),
                    )
                else:
                    progression_coverage[scene] = {"status": "presenter-skip-recovery", "reason": "bounded presenter transition to the next authored scene"}
            result["progressionScenes"] = progression
            result["progressionCoverage"] = progression_coverage
            result["assertions"].append("four-player-authored-progression-and-recovery-coverage")

            validate_scenario_approval(args, approval_path, "reconnect")
            reconnect_client = clients["p2"]
            reconnect_game = reconnect_client["game"]
            reconnect_snapshot = {
                "roomCode": reconnect_game.locator("#pd-game-code").inner_text().strip(),
                "scene": reconnect_game.locator("body").get_attribute("data-scene"),
                "slots": reconnect_game.locator("#pd-game-slots").inner_text().strip(),
            }
            reconnect_client["context"].set_offline(True)
            reconnect_game.wait_for_function(
                "() => /Reconnecting|Disconnected/.test(document.querySelector('#pd-connection-status')?.textContent || '')",
                timeout=15000,
            )
            reconnect_bucket = diagnostics["p2"]["game"]
            reconnect_bucket["allowedRequestFailures"] = len(reconnect_bucket["requestFailures"])
            reconnect_client["context"].set_offline(False)
            wait_for_text(reconnect_game, "#pd-connection-status", "Connected", timeout=45000)
            reconnect_after = {
                "roomCode": reconnect_game.locator("#pd-game-code").inner_text().strip(),
                "scene": reconnect_game.locator("body").get_attribute("data-scene"),
                "slots": reconnect_game.locator("#pd-game-slots").inner_text().strip(),
            }
            if reconnect_after != reconnect_snapshot:
                raise RehearsalError(f"p2 reconnect changed room identity or state: before={reconnect_snapshot} after={reconnect_after}")
            result["reconnect"] = {"before": reconnect_snapshot, "after": reconnect_after}
            result["assertions"].append("p2-reconnect-restored")

            note_values = {
                "p1": ("Ghi chú P1", "Đồng hành cùng nhau trong tháng đầu tiên."),
                "p2": ("Ghi chú P2", "Lắng nghe và xây dựng niềm tin."),
                "p3": ("Ghi chú P3", "Cùng nhau làm việc như những người đồng đẳng."),
            }
            readback = {}
            for role in ("p1", "p2", "p3"):
                validate_scenario_approval(args, approval_path, f"notes-{role}")
                game = clients[role]["game"]
                title, body = note_values[role]
                game.locator("#pd-note-title").fill(title)
                game.locator("#pd-note-body").fill(body)
                game.locator("#pd-save-note").click()
                wait_for_text(game, "#pd-note-status", "Saved", timeout=30000)
                room_id = game.evaluate("() => new URL(window.location.href).searchParams.get('room') || ''")
                uid = game.evaluate("() => window.firebase?.auth?.()?.currentUser?.uid || ''")
                authoritative = read_authoritative_notes(game, room_id, uid)
                server_page = next((page for page in authoritative.get("pages", []) if page.get("id") == "main"), None)
                if not server_page or server_page.get("title") != title or server_page.get("body") != body:
                    raise RehearsalError(f"authoritative Vietnamese note readback failed for {role}")
                game.evaluate("""() => {
                    for (const key of Object.keys(localStorage)) {
                        if (key.startsWith('bel.presentation.draft:') || key.startsWith('bel.presentation.pages:') || key.startsWith('bel.presentation.activePage:')) localStorage.removeItem(key);
                    }
                }""")
                game.reload(wait_until="domcontentloaded")
                wait_for_text(game, "#pd-connection-status", "Connected", timeout=45000)
                game.locator("#pd-note-title").wait_for(state="visible", timeout=30000)
                if game.locator("#pd-note-title").input_value() != title or game.locator("#pd-note-body").input_value() != body:
                    raise RehearsalError(f"persisted Vietnamese note readback failed for {role}")
                readback[role] = {"title": title, "body": body, "version": server_page.get("version"), "serverReadbackVerifiedBeforeReload": True, "localDraftClearedBeforeReload": True}
            result["notes"] = readback
            result["assertions"].extend(["three-participant-vietnamese-notes-saved", "three-participant-notes-read-back-after-reload"])

            validate_scenario_approval(args, approval_path, "end-room")
            presenter_game.once("dialog", lambda dialog: dialog.accept())
            presenter_game.locator("#pd-end-room").wait_for(state="visible")
            presenter_game.locator("#pd-end-room").click()
            wait_for_text(presenter_game, "#pd-gate", "This room has ended", timeout=45000)
            result["assertions"].append("room-ended-without-cleanup-delete")

            validate_scenario_approval(args, approval_path, "pdf-export")
            presenter_game = clients["presenter"]["game"]
            with presenter_game.expect_download(timeout=60000) as presenter_download_info:
                presenter_game.locator("#pd-export-pdf").click()
            presenter_pdf = save_and_inspect_pdf(presenter_download_info.value, evidence / "four-player-presenter-participants-export.pdf")
            participant_game = clients["p1"]["game"]
            with participant_game.expect_download(timeout=60000) as download_info:
                participant_game.locator("#pd-export-pdf").click()
            participant_pdf = save_and_inspect_pdf(download_info.value, evidence / "four-player-p1-export.pdf")
            for role, values in note_values.items():
                for token in values:
                    if token not in presenter_pdf["text"]:
                        raise RehearsalError(f"presenter PDF is missing persisted {role} note text")
            for role in ("p2", "p3"):
                if note_values[role][0] in participant_pdf["text"] or note_values[role][1] in participant_pdf["text"]:
                    raise RehearsalError(f"participant PDF leaked {role} note text")
            if note_values["p1"][0] not in participant_pdf["text"] or note_values["p1"][1] not in participant_pdf["text"]:
                raise RehearsalError("participant PDF is missing its own persisted note text")
            result["pdf"] = {
                "presenterParticipants": {key: value for key, value in presenter_pdf.items() if key != "text"},
                "participantOwn": {key: value for key, value in participant_pdf.items() if key != "text"},
                "presenterIncludesAllParticipantNotes": True,
                "participantExcludesOtherNotes": True,
            }
            result["assertions"].extend(["presenter-participant-pdf-text-verified", "participant-pdf-privacy-verified"])
            if args.screenshot:
                for role, client in clients.items():
                    client["lobby"].screenshot(path=str(evidence / f"four-player-lobby-{role}.png"), full_page=True)
            if candidate_manifest is not None:
                for role in ("presenter", "p1", "p2", "p3"):
                    for surface in ("crm", "lobby", "game"):
                        if diagnostics.get(role, {}).get(surface, {}).get("servedAssets"):
                            assert_candidate_assets(diagnostics, role, surface, candidate_manifest, result)
            assert_diagnostics_clean(diagnostics)
            if candidate_manifest is not None:
                for surface in ("crm", "lobby", "game"):
                    if diagnostics.get(args.role, {}).get(surface, {}).get("servedAssets"):
                        assert_candidate_assets(diagnostics, args.role, surface, candidate_manifest, result)
            result["diagnostics"] = diagnostics
    finally:
        result["diagnostics"] = diagnostics
        for client in clients.values():
            try:
                client["context"].close()
            except Exception:
                pass
        if browser is not None:
            browser.close()


def launch_and_check(args: argparse.Namespace, base_url: str, account: dict[str, str], evidence: Path, result: dict, approval_path: Path | None = None, candidate_manifest: dict[str, object] | None = None) -> None:
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RehearsalError("Python Playwright is required for the Chrome rehearsal") from error

    console_errors: list[str] = []
    page_errors: list[str] = []
    request_failures: list[str] = []
    diagnostics: dict[str, object] = {}
    browser = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=args.channel, headless=not args.headed)
            context = browser.new_context()
            page = context.new_page()
            page.set_default_timeout(20000)

            def on_console(message) -> None:
                if message.type in {"error", "warning"}:
                    console_errors.append(message.type)

            page.on("console", on_console)
            page.on("pageerror", lambda error: page_errors.append(type(error).__name__))
            page.on("requestfailed", lambda request: request_failures.append(safe_url(request.url)))
            attach_page_diagnostics(page, diagnostics, args.role, "crm", base_url, candidate_manifest)

            crm_url = f"{base_url}/crm-admin.html"
            if args.allow_live_writes:
                if approval_path is None:
                    raise RehearsalError("live browser actions require a validated approval file")
                validate_scenario_approval(args, approval_path, "normal-crm-launch")
            page.goto(crm_url, wait_until="domcontentloaded")
            page.wait_for_function("() => window.firebase && typeof window.firebase.auth === 'function'", timeout=30000)
            page.evaluate(
                """async ({email, password}) => {
                    const auth = window.firebase.auth();
                    await auth.signOut();
                    await auth.signInWithEmailAndPassword(email, password);
                }""",
                {"email": account["email"], "password": account["password"]},
            )
            page.goto(crm_url, wait_until="domcontentloaded")

            more = page.locator('[data-label="More"]')
            try:
                more.wait_for(state="visible", timeout=30000)
            except PlaywrightTimeoutError:
                if args.role != "negative":
                    raise
                result["assertions"].append("negative-control-crm-access-not-granted")
                page.goto(f"{base_url}/presentation-demo/index.html", wait_until="domcontentloaded")
                open_button = None
            else:
                if args.allow_live_writes:
                    validate_scenario_approval(args, approval_path, "open-presentation-demo")
                more.click()
                menu_item = page.locator('.crm-nav-more-dropdown .crm-dropdown-menu button[data-main="presentation-demo"]')
                menu_item.wait_for(state="visible", timeout=15000)
                menu_item.click()
                panel = page.locator("#crm-presentation-demo-workspace")
                open_button = page.locator("#crm-presentation-demo-open")
                try:
                    panel.wait_for(state="visible", timeout=15000)
                    open_button.wait_for(state="visible", timeout=15000)
                except PlaywrightTimeoutError:
                    if args.role != "negative":
                        raise
                    result["assertions"].append("negative-control-crm-access-not-granted")
                    page.goto(f"{base_url}/presentation-demo/index.html", wait_until="domcontentloaded")
                    open_button = None
                else:
                    result["assertions"].append("normal-crm-more-presentation-demo-launch")
                    if candidate_manifest is not None:
                        assert_candidate_assets(diagnostics, args.role, "crm", candidate_manifest, result)

            if open_button is not None:
                with page.expect_popup(timeout=15000) as popup_info:
                    open_button.click()
                lobby = popup_info.value
                attach_page_diagnostics(lobby, diagnostics, args.role, "lobby", base_url, candidate_manifest)
            else:
                lobby = page
            lobby.set_default_timeout(20000)
            lobby.wait_for_load_state("domcontentloaded")
            wait_for_text(lobby, "#pd-auth-status", "Signed in", timeout=30000)
            if candidate_manifest is not None:
                assert_candidate_assets(diagnostics, args.role, "lobby", candidate_manifest, result)
            assert_no_authority_hooks(page, f"{args.role} CRM")
            if lobby.evaluate("() => Boolean(window.belOnlineDebug || window.__phase4Login || window.__BEL_EMULATOR__)"):
                raise RehearsalError("production rehearsal detected a debug or emulator authority hook")
            result["assertions"].append("authenticated-production-presentation-lobby")

            if args.screenshot:
                lobby.screenshot(path=str(evidence / f"lobby-{args.role}.png"), full_page=True)

            if args.create_room:
                if args.allow_live_writes:
                    validate_scenario_approval(args, approval_path, "create-room")
                create_button = lobby.locator("#pd-create-room")
                create_button.wait_for(state="visible", timeout=15000)
                create_button.click()
                lobby.locator("#pd-room").wait_for(state="visible", timeout=30000)
                room_code = lobby.locator("#pd-room-code-display").inner_text().strip()
                if not room_code:
                    raise RehearsalError("canary room creation returned no room code")
                result["createdRoomCodeFingerprint"] = fingerprint(room_code)
                result["assertions"].append("designated-canary-room-created")
                print(f"created canary room code for private operator handoff: {room_code}", flush=True)

            if args.room_code:
                if args.allow_live_writes:
                    validate_scenario_approval(args, approval_path, "join-room")
                join_form = lobby.locator("#pd-join-form")
                join_form.wait_for(state="visible", timeout=15000)
                lobby.locator("#pd-room-code").fill(args.room_code)
                join_form.locator('button[type="submit"]').click()
                if args.role == "negative":
                    lobby.locator("#pd-join-error").wait_for(state="visible", timeout=30000)
                    if lobby.locator("#pd-room").is_visible():
                        raise RehearsalError("negative-control account joined the canary room")
                    result["assertions"].append("negative-control-room-join-denied")
                else:
                    lobby.locator("#pd-room").wait_for(state="visible", timeout=30000)
                    result["assertions"].append("authorized-room-join")

            if args.open_game:
                if args.allow_live_writes:
                    validate_scenario_approval(args, approval_path, "open-game")
                if not lobby.locator("#pd-room").is_visible():
                    raise RehearsalError("game connection requested before an authorized room was open")
                with lobby.expect_popup(timeout=15000) as game_info:
                    lobby.locator("#pd-open-game").click()
                game = game_info.value
                attach_page_diagnostics(game, diagnostics, args.role, "game", base_url, candidate_manifest)
                game.set_default_timeout(30000)
                game.wait_for_load_state("domcontentloaded")
                wait_for_text(game, "#pd-connection-status", "Connected", timeout=45000)
                if game.evaluate("() => Boolean(window.belOnlineDebug || window.__phase4Login || window.__BEL_EMULATOR__)"):
                    raise RehearsalError("game client exposed a debug or emulator authority hook")
                result["assertions"].append("authenticated-game-connection")
                game.close()

            result["observations"] = {
                "crmUrl": safe_url(page.url),
                "lobbyUrl": safe_url(lobby.url),
                "consoleErrorCount": len(console_errors),
                "pageErrorCount": len(page_errors),
                "requestFailureCount": len(request_failures),
            }
            result["diagnostics"] = diagnostics
            if console_errors or page_errors or request_failures:
                raise RehearsalError(
                    f"browser runtime diagnostics were not clean: console={len(console_errors)}, "
                    f"page={len(page_errors)}, requests={len(request_failures)}"
                )
            assert_diagnostics_clean(diagnostics)
            context.close()
    finally:
        if browser is not None:
            browser.close()


def write_report(evidence: Path, result: dict) -> None:
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "production-rehearsal.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args._fresh_deployed_reads = []
    approval_path: Path | None = None
    candidate_manifest: dict[str, object] | None = None
    try:
        base_url = normalized_base_url(args.base_url)
        accounts_path = assert_external(resolved_path(args.accounts_file, "--accounts-file"), "--accounts-file")
        evidence = assert_external(resolved_path(args.evidence, "--evidence"), "--evidence")
        fixture = read_json(accounts_path, "accounts fixture")
        accounts = validate_fixture(fixture)
        validate_action_scope(args)
        if args.allow_live_writes:
            approval_path = assert_external(resolved_path(args.approval_file, "--approval-file"), "--approval-file")
            validate_approval(args, approval_path)
            lease_path = assert_external(resolved_path(args.lease_file, "--lease-file"), "--lease-file")
            read_json(lease_path, "publisher lease file")
        if args.candidate_manifest:
            manifest_path = assert_external(resolved_path(args.candidate_manifest, "--candidate-manifest"), "--candidate-manifest")
            candidate_manifest = validate_candidate_manifest(args, manifest_path)
        if args.validate_only and args.allow_live_writes and args.four_player and approval_path is not None:
            for scenario in requested_actions(args):
                validate_scenario_approval(args, approval_path, scenario)
        account = account_for_role(accounts, args.role)
    except RehearsalError as error:
        print(f"production rehearsal configuration failed: {error}", file=sys.stderr)
        return 2

    result: dict[str, object] = {
        "schemaVersion": 1,
        "mode": "live-approved-actions" if args.allow_live_writes else "read-only-launch",
        "channel": args.channel,
        "role": args.role,
        "projectId": LIVE_PROJECT_ID,
        "baseUrl": base_url,
        "accountUidFingerprint": fingerprint(account["uid"]),
        "assertions": [],
        "noProductionCleanup": True,
        "physicalClientGate": "four independent Chrome clients on four physical computers",
        "approvalGate": "top-level approval, lease, and immediate read-only deployed identity are revalidated before every scenario boundary",
        "postDeploymentVerification": "separate future gate; candidate browser evidence must not be presented as live post-deployment verification",
    }
    if args.four_player:
        result["scenario"] = "four-player-progression-reconnect-notes-pdf"
    if candidate_manifest is not None:
        result["candidate"] = candidate_manifest
    result["freshDeployedIdentityReads"] = args._fresh_deployed_reads
    if args.validate_only:
        result["mode"] = "configuration-validation"
        result["assertions"] = ["valid-https-origin", "production-approved-fixture", "role-account-resolved"]
        result["success"] = True
        write_report(evidence, result)
        print(json.dumps(result, indent=2), flush=True)
        return 0
    try:
        if args.four_player:
            result["mode"] = "four-player-approved-scenario"
            run_four_player_scenario(args, base_url, accounts, evidence, result, approval_path, candidate_manifest)
        else:
            launch_and_check(args, base_url, account, evidence, result, approval_path, candidate_manifest)
        result["success"] = True
        write_report(evidence, result)
        print(json.dumps(result, indent=2), flush=True)
        return 0
    except Exception as error:  # noqa: BLE001 - report a sanitized browser failure
        result["success"] = False
        result["failure"] = safe_failure(error)
        write_report(evidence, result)
        print(json.dumps(result, indent=2), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
