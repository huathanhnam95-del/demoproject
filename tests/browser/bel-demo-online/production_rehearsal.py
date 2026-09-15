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
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, urlunparse


REPO_ROOT = Path(__file__).resolve().parents[3]
LIVE_PROJECT_ID = "listening-tasks-3ae34"
ROLES = ("presenter", "p1", "p2", "p3", "negative")
EMULATOR_MARKERS = ("emulator", "localhost", "127.0.0.1", "::1", ".test", ".invalid", "dev:")


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
    parser.add_argument("--allow-live-writes", action="store_true", help="Enable only the approved live actions.")
    parser.add_argument("--approval-file", help="External approval JSON for live actions.")
    parser.add_argument("--candidate-sha")
    parser.add_argument("--base-sha")
    parser.add_argument("--scope-hash")
    parser.add_argument("--headed", action="store_true", help="Show the physical Chrome client.")
    parser.add_argument("--screenshot", action="store_true", help="Retain a lobby screenshot in the evidence directory.")
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
    if parsed.scheme != "https:" or not parsed.netloc:
        raise RehearsalError("--base-url must be an HTTPS origin")
    host = (parsed.hostname or "").lower().rstrip(".")
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local") or host.endswith(".test"):
        raise RehearsalError("--base-url must not target a local or emulator host")
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
    actions = ["normal-crm-launch", "open-presentation-demo"]
    if args.create_room:
        actions.append("create-room")
    if args.room_code:
        actions.append("join-room")
    if args.open_game:
        actions.append("open-game")
    return actions


def validate_action_scope(args: argparse.Namespace) -> None:
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


def validate_approval(args: argparse.Namespace, approval_path: Path) -> None:
    approval = read_json(approval_path, "approval file")
    if approval.get("mode") != "production-approved" or approval.get("owner") in (None, ""):
        raise RehearsalError("approval file must declare mode=production-approved and an owner")
    try:
        expires_at = float(approval.get("expiresAt"))
    except (TypeError, ValueError) as error:
        raise RehearsalError("approval.expiresAt must be a Unix timestamp") from error
    if expires_at <= time.time():
        raise RehearsalError("approval file has expired")
    if approval.get("candidateSha") != args.candidate_sha or approval.get("baseSha") != args.base_sha or approval.get("scopeHash") != args.scope_hash:
        raise RehearsalError("approval does not match the candidate SHA, base SHA, or scope hash")
    expected_actions = requested_actions(args)
    if approval.get("actions") != expected_actions:
        raise RehearsalError("approval action sequence does not match this rehearsal client")


def safe_failure(error: BaseException) -> dict[str, str]:
    message = str(error)
    message = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[redacted-email]", message, flags=re.IGNORECASE)
    return {"type": type(error).__name__, "message": message[:500]}


def wait_for_text(page, selector: str, text: str, timeout: int = 30000) -> None:
    page.locator(selector).wait_for(state="visible", timeout=timeout)
    page.wait_for_function(
        "([selector, text]) => document.querySelector(selector)?.textContent.includes(text)",
        arg=[selector, text],
        timeout=timeout,
    )


def launch_and_check(args: argparse.Namespace, base_url: str, account: dict[str, str], evidence: Path, result: dict) -> None:
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RehearsalError("Python Playwright is required for the Chrome rehearsal") from error

    console_errors: list[str] = []
    page_errors: list[str] = []
    request_failures: list[str] = []
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

            crm_url = f"{base_url}/crm-admin.html#presentation-demo"
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
                more.click()
                demo_link = page.locator('.crm-nav-more-dropdown [data-main="presentation-demo"]')
                try:
                    demo_link.wait_for(state="visible", timeout=10000)
                except PlaywrightTimeoutError:
                    if args.role != "negative":
                        raise
                    result["assertions"].append("negative-control-crm-access-not-granted")
                    page.goto(f"{base_url}/presentation-demo/index.html", wait_until="domcontentloaded")
                    open_button = None
                else:
                    demo_link.click()
                    panel = page.locator('[data-panel="presentation-demo"]')
                    panel.wait_for(state="visible", timeout=15000)
                    open_button = page.locator("#crm-presentation-demo-open")
                    open_button.wait_for(state="visible", timeout=15000)
                    result["assertions"].append("normal-crm-more-presentation-demo-launch")

            if open_button is not None:
                with page.expect_popup(timeout=15000) as popup_info:
                    open_button.click()
                lobby = popup_info.value
            else:
                lobby = page
            lobby.set_default_timeout(20000)
            lobby.wait_for_load_state("domcontentloaded")
            wait_for_text(lobby, "#pd-auth-status", "Signed in", timeout=30000)
            if lobby.evaluate("() => Boolean(window.belOnlineDebug || window.__phase4Login || window.__BEL_EMULATOR__)"):
                raise RehearsalError("production rehearsal detected a debug or emulator authority hook")
            result["assertions"].append("authenticated-production-presentation-lobby")

            if args.screenshot:
                lobby.screenshot(path=str(evidence / f"lobby-{args.role}.png"), full_page=True)

            if args.create_room:
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
                if not lobby.locator("#pd-room").is_visible():
                    raise RehearsalError("game connection requested before an authorized room was open")
                with lobby.expect_popup(timeout=15000) as game_info:
                    lobby.locator("#pd-open-game").click()
                game = game_info.value
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
            if console_errors or page_errors or request_failures:
                raise RehearsalError(
                    f"browser runtime diagnostics were not clean: console={len(console_errors)}, "
                    f"page={len(page_errors)}, requests={len(request_failures)}"
                )
            context.close()
    finally:
        if browser is not None:
            browser.close()


def write_report(evidence: Path, result: dict) -> None:
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "production-rehearsal.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
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
    }
    try:
        launch_and_check(args, base_url, account, evidence, result)
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
