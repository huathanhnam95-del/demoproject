"""Chrome-only four-account rehearsal for the authenticated online demo.

The accounts file is intentionally external to the repository. Accounts are
created in the local Firebase Auth emulator and every application request uses
the resulting bearer token; no production credential is accepted here.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", choices=["chrome"], required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--accounts-file", required=True)
    parser.add_argument("--evidence", required=True)
    return parser.parse_args()


def wait_for_text(page, selector: str, text: str, timeout: int = 10000) -> None:
    page.locator(selector).wait_for(state="visible", timeout=timeout)
    page.wait_for_function(
        "([selector, text]) => document.querySelector(selector)?.textContent.includes(text)",
        arg=[selector, text],
        timeout=timeout,
    )


def open_lobby(context, base_url: str, account: dict):
    page = context.new_page()
    page.set_default_timeout(10000)
    page.goto(f"{base_url}/presentation-demo/index.html", wait_until="domcontentloaded")
    page.wait_for_function("() => window.firebase && typeof window.firebase.auth === 'function'")
    page.evaluate(
        """async ({email, password}) => {
            await window.firebase.auth().signInWithEmailAndPassword(email, password);
        }""",
        {"email": account["email"], "password": account["password"]},
    )
    page.reload(wait_until="domcontentloaded")
    wait_for_text(page, "#pd-auth-status", "Signed in")
    return page


def open_game(page, allow_existing: bool = False):
    with page.expect_popup(timeout=10000) as popup_info:
        page.locator("#pd-open-game").click()
    game = popup_info.value
    game.set_default_timeout(15000)
    game.wait_for_load_state("domcontentloaded")
    if allow_existing:
        game.locator("#pd-connection-status").wait_for(state="visible", timeout=15000)
    else:
        wait_for_text(game, "#pd-connection-status", "Connected", timeout=15000)
    return game


def main() -> int:
    args = parse_args()
    evidence = Path(args.evidence).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    accounts = json.loads(Path(args.accounts_file).read_text(encoding="utf-8"))
    if accounts.get("mode") != "firebase-emulator":
        raise RuntimeError("The rehearsal requires the explicit Firebase Auth emulator account fixture.")
    presenter = accounts["presenter"]["uid"]
    participants = [entry["uid"] for entry in accounts["participants"]]
    outsider = accounts["outsider"]["uid"]
    requests: list[str] = []
    responses: list[tuple[int, str]] = []
    console_errors: list[str] = []
    result = {"channel": args.channel, "baseUrl": args.base_url, "accounts": [presenter, *participants], "assertions": []}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.channel, headless=True)
        contexts = {}
        pages = {}
        games = {}
        try:
            for uid in [presenter, *participants, outsider]:
                context = browser.new_context()
                context.set_default_timeout(10000)
                context.tracing.start(screenshots=True, snapshots=True, sources=False)
                context.on("page", lambda new_page: new_page.on("websocket", lambda websocket: requests.append(websocket.url)))
                contexts[uid] = context
                page = open_lobby(context, args.base_url, accounts["presenter"] if uid == presenter else next(entry for entry in accounts["participants"] if entry["uid"] == uid) if uid in participants else accounts["outsider"])
                pages[uid] = page
                page.on("request", lambda request: requests.append(request.url))
                page.on("websocket", lambda websocket: requests.append(websocket.url))
                page.on("response", lambda response: responses.append((response.status, response.url)) if "/api/presentation-demo" in response.url else None)
                page.on("console", lambda message, account=uid: console_errors.append(f"{account}: {message.type}: {message.text}") if message.type == "error" else None)

            pages[presenter].locator("#pd-create-room").click()
            wait_for_text(pages[presenter], "#pd-room", "")
            room_code = pages[presenter].locator("#pd-room-code-display").inner_text()
            room_id = parse_qs(urlparse(pages[presenter].url).query)["room"][0]
            result["roomId"] = room_id
            result["roomCode"] = room_code
            result["assertions"].append("admin-created-one-room")

            for uid in participants:
                pages[uid].locator("#pd-room-code").fill(room_code)
                pages[uid].locator("#pd-join-form").press("Enter")
                wait_for_text(pages[uid], "#pd-room", room_code)
            pages[outsider].locator("#pd-room-code").fill(room_code)
            pages[outsider].locator("#pd-join-form").press("Enter")
            pages[outsider].locator("#pd-join-error").wait_for(state="visible")
            result["assertions"].append("fifth-player-rejected")

            for uid in [presenter, *participants]:
                games[uid] = open_game(pages[uid])
                games[uid].on("request", lambda request: requests.append(request.url))
                games[uid].on("websocket", lambda websocket: requests.append(websocket.url))
                games[uid].on("response", lambda response: responses.append((response.status, response.url)) if "/api/presentation-demo" in response.url else None)
            for uid, game in games.items():
                wait_for_text(game, "#pd-game-slots", "p0")
            result["assertions"].append("four-distinct-contexts-connected-p0-p3")

            duplicate_context = browser.new_context()
            duplicate_context.set_default_timeout(12000)
            duplicate_context.tracing.start(screenshots=True, snapshots=True, sources=False)
            duplicate_context.on("page", lambda new_page: new_page.on("websocket", lambda websocket: requests.append(websocket.url)))
            duplicate_page = open_lobby(duplicate_context, args.base_url, accounts["participants"][0])
            duplicate_page.locator("#pd-room-code").fill(room_code)
            duplicate_page.locator("#pd-join-form").press("Enter")
            wait_for_text(duplicate_page, "#pd-room", room_code)
            duplicate_game = open_game(duplicate_page, allow_existing=True)
            # The original connection is still live, so takeover is explicit.
            duplicate_game.locator("#pd-replace-connection").wait_for(state="visible")
            games[participants[0]].close()
            duplicate_game.locator("#pd-replace-connection").click()
            wait_for_text(duplicate_game, "#pd-connection-status", "Connected")
            games[participants[0]] = duplicate_game
            contexts[f"duplicate-{participants[0]}"] = duplicate_context
            pages[f"duplicate-{participants[0]}"] = duplicate_page
            result["assertions"].append("same-account-takeover-kept-one-seat")

            wait_for_text(games[presenter], "#pd-start-room", "")
            games[presenter].locator("#pd-start-room").click()
            wait_for_text(games[presenter], "#pd-gate", "Scene:")
            result["assertions"].append("initial-bootstrap-gate-opened-only-after-all-four")

            for uid in participants:
                game = games[uid]
                game.locator("#pd-note-title").fill(f"Observation {uid}")
                game.locator("#pd-note-body").fill(f"Private {uid} evidence with Vietnamese: hợp tác.")
                game.locator("#pd-save-note").click()
                wait_for_text(game, "#pd-note-status", "Saved")
            games[presenter].locator("#pd-slide-next").click()
            wait_for_text(games[participants[1]], "#pd-gate", "Scene:")
            time.sleep(1.2)
            result["observedSlideGates"] = {uid: games[uid].locator("#pd-gate").inner_text() for uid in [presenter, *participants]}
            result["slideMessage"] = games[presenter].locator("#pd-game-message").inner_text()
            result["recentApiResponses"] = responses[-25:]
            if not all("Scene: A" in value for value in result["observedSlideGates"].values()):
                print(json.dumps({"observedSlideGates": result["observedSlideGates"], "slideMessage": result["slideMessage"], "recentApiResponses": result["recentApiResponses"]}, indent=2))
                raise AssertionError(f"Slide state did not converge across contexts: {result['observedSlideGates']}")
            games[presenter].locator("#pd-skip-activity").click()
            games[participants[1]].locator("#pd-world").click(position={"x": 700, "y": 300})
            games[participants[1]].keyboard.press("d")
            result["assertions"].append("movement-note-slide-and-assisted-control-used")

            # The takeover tab reloads the notebook from the server-owned store.
            wait_for_text(games[participants[0]], "#pd-note-body", "")
            restored_body = games[participants[0]].locator("#pd-note-body").input_value()
            if f"Private {participants[0]} evidence" not in restored_body:
                raise AssertionError(f"Reconnected participant did not restore its saved notebook: {restored_body!r}")
            result["assertions"].append("reconnect-restored-own-note")

            games[presenter].once("dialog", lambda dialog: dialog.accept())
            games[presenter].locator("#pd-end-room").click()
            wait_for_text(games[presenter], "#pd-gate", "ended", timeout=15000)
            result["assertions"].append("explicit-end-left-terminal-room")

            for uid in [presenter, participants[0]]:
                with games[uid].expect_download(timeout=15000) as download_info:
                    games[uid].locator("#pd-export-pdf").click()
                download = download_info.value
                target = evidence / f"{uid}-export.pdf"
                download.save_as(str(target))
                pdf = target.read_bytes()
                if not pdf.startswith(b"%PDF-"):
                    raise AssertionError(f"{uid} export is not a PDF")
                result.setdefault("pdf", {})[uid] = {"path": str(target), "bytes": len(pdf)}
            result["assertions"].append("presenter-and-participant-pdf-exports")

            participant_token = pages[participants[0]].evaluate("window.firebase.auth().currentUser.getIdToken()")
            response = pages[participants[0]].request.get(
                f"{args.base_url}/api/presentation-demo/rooms/{room_id}/notes/{participants[1]}",
                headers={"Authorization": f"Bearer {participant_token}"},
            )
            if response.status != 403:
                raise AssertionError(f"Cross-user note read returned {response.status}, expected 403")
            result["assertions"].append("participant-cross-user-notes-denied")

            if not any("/api/presentation-demo/ws" in url for url in requests):
                raise AssertionError("No authenticated presentation WebSocket was observed")
            if any("BroadcastChannel" in url for url in requests):
                raise AssertionError("Unexpected BroadcastChannel request observed")
            unexpected_console_errors = [entry for entry in console_errors if not entry.startswith(f"{outsider}:")]
            if unexpected_console_errors:
                raise AssertionError(f"Unexpected browser console errors: {unexpected_console_errors}")
            result["assertions"].append("network-transport-observed-no-same-profile-channel")
        finally:
            result["requestCount"] = len(requests)
            result["networkRequests"] = sorted({url.split("?")[0] for url in requests if "/api/presentation-demo" in url})
            result["expectedConsoleErrors"] = [entry for entry in console_errors if entry.startswith(f"{outsider}:")]
            result["consoleErrors"] = [entry for entry in console_errors if not entry.startswith(f"{outsider}:")][:30]
            for name, context in contexts.items():
                try:
                    context.tracing.stop(path=str(evidence / f"trace-{name}.zip"))
                except Exception:
                    pass
                try:
                    context.close()
                except Exception:
                    pass
            browser.close()

    (evidence / "rehearsal.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
