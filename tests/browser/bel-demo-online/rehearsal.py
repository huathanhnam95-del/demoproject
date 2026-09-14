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
from playwright.sync_api import expect, sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", choices=["chrome"], required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--failover-url")
    parser.add_argument("--failover-signal")
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
    print(f"rehearsal: signing in {account['uid']}", flush=True)
    page.evaluate(
        """async ({email, password}) => {
            await window.firebase.auth().signInWithEmailAndPassword(email, password);
        }""",
        {"email": account["email"], "password": account["password"]},
    )
    print(f"rehearsal: signed in {account['uid']}", flush=True)
    page.reload(wait_until="domcontentloaded")
    print(f"rehearsal: reloaded {account['uid']}", flush=True)
    print(f"rehearsal: auth status {account['uid']} = {page.locator('#pd-auth-status').inner_text()!r}", flush=True)
    wait_for_text(page, "#pd-auth-status", "Signed in", timeout=30000)
    return page


def open_game(page, allow_existing: bool = False):
    with page.expect_popup(timeout=10000) as popup_info:
        page.locator("#pd-open-game").click()
    game = popup_info.value
    game.set_default_timeout(15000)
    game.wait_for_load_state("domcontentloaded")
    try:
        if allow_existing:
            game.locator("#pd-connection-status").wait_for(state="visible", timeout=15000)
        else:
            wait_for_text(game, "#pd-connection-status", "Connected", timeout=15000)
    except PlaywrightTimeoutError:
        status = game.locator("#pd-connection-status").inner_text()
        message = game.locator("#pd-game-message").inner_text()
        raise AssertionError(f"Game connection did not become ready: status={status!r}, message={message!r}, url={game.url!r}")
    return game


def walk_all(games: dict, uids: list[str]) -> None:
    """Create measurable server-side travel for every connected seat."""
    for uid in uids:
        wait_for_text(games[uid], "#pd-connection-status", "Connected", timeout=30000)
    for uid in uids:
        game = games[uid]
        # Notes and other controls may retain focus between route segments;
        # movement keys must reach the game listener rather than a textarea.
        game.locator("#pd-world").click(position={"x": 10, "y": 10})
        game.keyboard.down("d")
        game.wait_for_timeout(750)
        game.keyboard.up("d")
    games[uids[0]].wait_for_timeout(1000)
    for uid in uids:
        wait_for_text(games[uid], "#pd-connection-status", "Connected", timeout=30000)


def advance_slide(
    games: dict,
    presenter: str,
    uids: list[str],
    expected_scene: str,
    expected_slide: int,
    base_url: str,
    room_id: str,
) -> None:
    previous_gates = {uid: games[uid].locator("#pd-gate").inner_text() for uid in uids}
    games[presenter].locator("#pd-slide-next").click()
    presenter_token = games[presenter].evaluate("window.firebase.auth().currentUser.getIdToken()")
    deadline = time.monotonic() + 15
    authoritative_deck = None
    while time.monotonic() < deadline:
        response = games[presenter].request.get(
            f"{base_url}/api/presentation-demo/rooms/{room_id}",
            headers={"Authorization": f"Bearer {presenter_token}"},
        )
        if response.status == 200:
            authoritative_deck = response.json().get("data", {}).get("deck")
            if authoritative_deck and authoritative_deck.get("room") == expected_scene and authoritative_deck.get("slide") == expected_slide:
                break
        games[presenter].wait_for_timeout(200)
    else:
        raise AssertionError(
            f"Authoritative slide did not advance to {expected_scene}/{expected_slide}: deck={authoritative_deck!r}, "
            f"message={games[presenter].locator('#pd-game-message').inner_text()!r}, connection={games[presenter].locator('#pd-connection-status').inner_text()!r}"
        )
    for uid in uids:
        try:
            games[uid].wait_for_function(
                """([selector, expectedScene, expectedSlide, previous]) => {
                    const gate = document.querySelector(selector);
                    const text = gate?.textContent || '';
                    return text.includes(`Scene: ${expectedScene}`) && text !== previous
                        && gate?.dataset.deckRoom === expectedScene
                        && gate?.dataset.deckSlide === String(expectedSlide);
                }""",
                arg=["#pd-gate", expected_scene, expected_slide, previous_gates[uid]],
                timeout=15000,
            )
        except PlaywrightTimeoutError:
            raise AssertionError(
                f"Slide did not advance to {expected_scene}/{expected_slide} for {uid}: gate={games[uid].locator('#pd-gate').inner_text()!r}, "
                f"authoritative_deck={authoritative_deck!r}, "
                f"message={games[uid].locator('#pd-game-message').inner_text()!r}, connection={games[uid].locator('#pd-connection-status').inner_text()!r}"
            )


def notebook_debug_state(page) -> dict:
    return page.evaluate(
        """() => {
            const storage = {};
            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index);
                if (key?.startsWith('bel.presentation.')) storage[key] = localStorage.getItem(key);
            }
            const select = document.querySelector('#pd-note-page');
            return {
                selected: select?.value || null,
                options: select ? [...select.options].map(option => ({ value: option.value, text: option.textContent })) : [],
                title: document.querySelector('#pd-note-title')?.value || '',
                body: document.querySelector('#pd-note-body')?.value || '',
                storage,
            };
        }"""
    )


def main() -> int:
    args = parse_args()
    print("rehearsal: starting", flush=True)
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
        print("rehearsal: browser launched", flush=True)
        contexts = {}
        pages = {}
        games = {}
        try:
            for uid in [presenter, *participants, outsider]:
                print(f"rehearsal: opening lobby {uid}", flush=True)
                context = browser.new_context()
                context.set_default_timeout(10000)
                if args.failover_url:
                    context.add_init_script(f"window.__BEL_PRESENTATION_FAILOVER_ORIGINS = [{json.dumps(args.failover_url)}];")
                context.tracing.start(screenshots=True, snapshots=True, sources=False)
                context.on("page", lambda new_page: new_page.on("websocket", lambda websocket: requests.append(websocket.url)))
                contexts[uid] = context
                page = open_lobby(context, args.base_url, accounts["presenter"] if uid == presenter else next(entry for entry in accounts["participants"] if entry["uid"] == uid) if uid in participants else accounts["outsider"])
                pages[uid] = page
                print(f"rehearsal: lobby ready {uid}", flush=True)
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
                try:
                    wait_for_text(pages[uid], "#pd-room", room_code)
                except PlaywrightTimeoutError:
                    raise AssertionError(
                        f"Participant join did not render room for {uid}: error={pages[uid].locator('#pd-join-error').inner_text()!r}, "
                        f"auth={pages[uid].locator('#pd-auth-message').inner_text()!r}, url={pages[uid].url!r}"
                    )
            pages[outsider].locator("#pd-room-code").fill(room_code)
            pages[outsider].locator("#pd-join-form").press("Enter")
            pages[outsider].locator("#pd-join-error").wait_for(state="visible")
            result["assertions"].append("fifth-player-rejected")

            for uid in [presenter, *participants]:
                games[uid] = open_game(pages[uid])
                print(f"rehearsal: game ready {uid}", flush=True)
                games[uid].on("request", lambda request: requests.append(request.url))
                games[uid].on("websocket", lambda websocket: requests.append(websocket.url))
                games[uid].on("response", lambda response: responses.append((response.status, response.url)) if "/api/presentation-demo" in response.url else None)
            for uid, game in games.items():
                wait_for_text(game, "#pd-game-slots", "p0")
            result["assertions"].append("four-distinct-contexts-connected-p0-p3")

            duplicate_context = browser.new_context()
            duplicate_context.set_default_timeout(12000)
            if args.failover_url:
                duplicate_context.add_init_script(f"window.__BEL_PRESENTATION_FAILOVER_ORIGINS = [{json.dumps(args.failover_url)}];")
            duplicate_context.tracing.start(screenshots=True, snapshots=True, sources=False)
            duplicate_context.on("page", lambda new_page: new_page.on("websocket", lambda websocket: requests.append(websocket.url)))
            duplicate_page = open_lobby(duplicate_context, args.base_url, accounts["participants"][0])
            duplicate_page.locator("#pd-room-code").fill(room_code)
            duplicate_page.locator("#pd-join-form").press("Enter")
            try:
                wait_for_text(duplicate_page, "#pd-room", room_code)
            except PlaywrightTimeoutError:
                raise AssertionError(
                    f"Duplicate join did not render room: error={duplicate_page.locator('#pd-join-error').inner_text()!r}, "
                    f"auth={duplicate_page.locator('#pd-auth-message').inner_text()!r}, url={duplicate_page.url!r}"
                )
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
            try:
                wait_for_text(games[presenter], "#pd-gate", "Scene:")
            except PlaywrightTimeoutError:
                raise AssertionError(
                    f"Presenter transition did not open the route: gate={games[presenter].locator('#pd-gate').inner_text()!r}, "
                    f"message={games[presenter].locator('#pd-game-message').inner_text()!r}, "
                    f"connection={games[presenter].locator('#pd-connection-status').inner_text()!r}"
                )
            result["assertions"].append("initial-bootstrap-gate-opened-only-after-all-four")

            for uid in participants:
                game = games[uid]
                game.locator("#pd-note-title").fill(f"Observation {uid}")
                game.locator("#pd-note-body").fill(f"Private {uid} evidence with Vietnamese: hợp tác.")
                game.locator("#pd-save-note").click()
                wait_for_text(game, "#pd-note-status", "Saved")
            active_base_url = args.base_url
            active_uids = [presenter, *participants]
            for uid in active_uids:
                wait_for_text(games[uid], "#pd-connection-status", "Connected", timeout=30000)
            # The reconnect callback updates the public status before the
            # first post-reconnect command has necessarily reached OPEN.
            games[presenter].wait_for_timeout(1500)
            wait_for_text(games[presenter], "#pd-connection-status", "Connected", timeout=5000)
            advance_slide(games, presenter, active_uids, "A", 2, args.base_url, room_id)
            result["observedSlideGates"] = {uid: games[uid].locator("#pd-gate").inner_text() for uid in [presenter, *participants]}
            result["slideMessage"] = games[presenter].locator("#pd-game-message").inner_text()
            result["recentApiResponses"] = responses[-25:]
            current_room = "A"
            current_slide = 2
            route_ranges = [("A", 3), ("C", 9), ("E", 16), ("G", 18), ("I", 20), ("J", 21)]
            route_trace = [{"room": current_room, "slide": current_slide}]
            for room_name, last_slide in route_ranges:
                while current_room == room_name and current_slide < last_slide:
                    current_slide += 1
                    advance_slide(games, presenter, active_uids, room_name, current_slide, args.base_url, room_id)
                    route_trace.append({"room": current_room, "slide": current_slide})
                if room_name == "J":
                    continue
                next_room = route_ranges[route_ranges.index((room_name, last_slide)) + 1][0]
                walk_all(games, active_uids)
                current_room = next_room
                current_slide = {
                    "A": 1,
                    "C": 4,
                    "E": 10,
                    "G": 17,
                    "I": 19,
                    "J": 21,
                }[next_room]
                advance_slide(games, presenter, active_uids, current_room, current_slide, args.base_url, room_id)
                route_trace.append({"room": current_room, "slide": current_slide})
            if current_room != "J" or current_slide != 21:
                raise AssertionError(f"Full route did not reach Studio J slide 21: {route_trace}")
            result["routeTrace"] = route_trace
            result["assertions"].append("full-authored-route-reached-beyond-studio-a")

            # Hold one save response while typing newer content. The save
            # handler must retain the newer local draft after the old response.
            delayed_game = games[participants[0]]
            delayed_game.locator("#pd-note-title").fill("Delayed older")
            delayed_game.locator("#pd-note-body").fill("OLDER RESPONSE")
            delayed_game.evaluate(
                """() => {
                    const originalFetch = window.fetch.bind(window);
                    let releaseGate;
                    const gate = new Promise(resolve => { releaseGate = resolve; });
                    const state = {
                        seen: false,
                        released: false,
                        originalFetch,
                        release() {
                            if (state.released) return;
                            state.released = true;
                            releaseGate();
                        },
                    };
                    window.__belNotebookDelay = state;
                    window.fetch = async (...args) => {
                        const [input, init = {}] = args;
                        const request = input instanceof Request ? input : null;
                        const method = String(init.method || request?.method || 'GET').toUpperCase();
                        const url = String(request?.url || input);
                        const response = await originalFetch(...args);
                        if (!state.seen && method === 'PUT' && url.includes('/api/presentation-demo/rooms/') && url.includes('/notes/')) {
                            state.seen = true;
                            await gate;
                        }
                        return response;
                    };
                }"""
            )
            delayed_game.locator("#pd-save-note").click()
            delayed_game.wait_for_function("() => window.__belNotebookDelay?.seen === true", timeout=15000)
            delayed_game.locator("#pd-note-title").fill("Newer typing")
            delayed_game.locator("#pd-note-body").fill("NEWER RESPONSE")
            delayed_game.evaluate("() => window.__belNotebookDelay.release()")
            try:
                wait_for_text(delayed_game, "#pd-note-status", "newer edits kept", timeout=15000)
            except PlaywrightTimeoutError:
                raise AssertionError(
                    f"Delayed notebook response did not settle: intercepted={delayed_game.evaluate('window.__belNotebookDelay?.seen')}, "
                    f"status={delayed_game.locator('#pd-note-status').inner_text()!r}, "
                    f"title={delayed_game.locator('#pd-note-title').input_value()!r}, "
                    f"body={delayed_game.locator('#pd-note-body').input_value()!r}, "
                    f"message={delayed_game.locator('#pd-game-message').inner_text()!r}"
                )
            if delayed_game.locator("#pd-note-body").input_value() != "NEWER RESPONSE":
                raise AssertionError("A delayed notebook response overwrote newer typing.")
            delayed_game.evaluate(
                """() => {
                    const state = window.__belNotebookDelay;
                    if (state?.originalFetch) window.fetch = state.originalFetch;
                    delete window.__belNotebookDelay;
                }"""
            )
            result["assertions"].append("delayed-notebook-response-kept-newer-typing")

            # A new page is catalogued before its first server save. Reload the
            # lobby, reopen the game, and require both its identity and draft.
            delayed_game.get_by_role("button", name="New page").click()
            new_page_id = delayed_game.locator("#pd-note-page").input_value()
            delayed_game.locator("#pd-note-title").fill("Unsaved page")
            delayed_game.locator("#pd-note-body").fill("Unsaved Vietnamese: hợp tác")
            delayed_game.wait_for_timeout(500)
            notebook_before_reload = notebook_debug_state(delayed_game)
            delayed_game.close()
            duplicate_page.reload(wait_until="domcontentloaded")
            wait_for_text(duplicate_page, "#pd-auth-status", "Signed in", timeout=30000)
            reopened = open_game(duplicate_page)
            games[participants[0]] = reopened
            try:
                reopened.locator(f"#pd-note-page option[value='{new_page_id}']").wait_for(state="attached", timeout=15000)
                reopened.wait_for_function(
                    "([pageId, body]) => document.querySelector('#pd-note-page')?.value === pageId && document.querySelector('#pd-note-body')?.value === body",
                    arg=[new_page_id, "Unsaved Vietnamese: hợp tác"],
                    timeout=15000,
                )
            except PlaywrightTimeoutError:
                notebook_after_reload = notebook_debug_state(reopened)
                result["notebookReloadDiagnostics"] = {"before": notebook_before_reload, "after": notebook_after_reload}
                raise AssertionError(f"New unsaved notebook page did not reappear after reload: {json.dumps(result['notebookReloadDiagnostics'], ensure_ascii=False)}")
            notebook_after_reload = notebook_debug_state(reopened)
            result["notebookReloadDiagnostics"] = {"before": notebook_before_reload, "after": notebook_after_reload}
            if reopened.locator("#pd-note-body").input_value() != "Unsaved Vietnamese: hợp tác":
                raise AssertionError("New unsaved notebook page draft did not reappear after reload.")
            result["assertions"].append("new-unsaved-notebook-page-restored-after-reload")

            if args.failover_signal:
                print("rehearsal: failover checkpoint", flush=True)
                Path(args.failover_signal).write_text("ready\n", encoding="utf-8")
                wait_for_text(games[presenter], "#pd-connection-status", "Reconnecting", timeout=20000)
                wait_for_text(games[presenter], "#pd-connection-status", "Connected", timeout=30000)
                result["assertions"].append("active-backend-failover-reconnected")
                active_base_url = args.failover_url
                for uid in active_uids:
                    wait_for_text(games[uid], "#pd-connection-status", "Connected", timeout=30000)

            authoritative = {}
            for uid in active_uids:
                token = games[uid].evaluate("window.firebase.auth().currentUser.getIdToken()")
                snapshot_response = games[uid].request.get(
                    f"{active_base_url}/api/presentation-demo/rooms/{room_id}",
                    headers={"Authorization": f"Bearer {token}"},
                )
                if snapshot_response.status != 200:
                    raise AssertionError(f"Authoritative room snapshot returned {snapshot_response.status} for {uid}")
                snapshot = snapshot_response.json()["data"]
                authoritative[uid] = {
                    "lifecycle": snapshot["lifecycle"],
                    "deck": snapshot["deck"],
                    "activity": snapshot.get("activity"),
                    "scenes": {
                        slot_id: {
                            "scene": slot.get("scene"),
                            "instanceId": slot.get("instanceId"),
                            "position": slot.get("position"),
                            "relationship": slot.get("relationship"),
                        }
                        for slot_id, slot in snapshot["slots"].items()
                        if slot.get("uid")
                    },
                }
            result["authoritativeSlideStates"] = authoritative
            reference_state = authoritative[presenter]
            if any(state != reference_state for state in authoritative.values()):
                raise AssertionError(f"Authoritative slide state did not converge: {authoritative}")
            if reference_state["lifecycle"] != "playing" or reference_state["deck"]["room"] != "J" or reference_state["deck"]["slide"] != 21:
                raise AssertionError(f"Unexpected authoritative slide state: {reference_state}")
            if not all("Scene: A" in value for value in result["observedSlideGates"].values()):
                print(json.dumps({"observedSlideGates": result["observedSlideGates"], "slideMessage": result["slideMessage"], "recentApiResponses": result["recentApiResponses"]}, indent=2))
                raise AssertionError(f"Slide state did not converge across contexts: {result['observedSlideGates']}")
            result["assertions"].append("server-authorized-movement-and-route-used")

            # Backend failover must not erase the active local-only page draft.
            wait_for_text(games[participants[0]], "#pd-note-body", "")
            restored_body = games[participants[0]].locator("#pd-note-body").input_value()
            if restored_body != "Unsaved Vietnamese: hợp tác":
                raise AssertionError(f"Reconnected participant lost its active unsaved page draft: {restored_body!r}")
            result["assertions"].append("reconnect-preserved-active-unsaved-page")

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
                f"{active_base_url}/api/presentation-demo/rooms/{room_id}/notes/{participants[1]}",
                headers={"Authorization": f"Bearer {participant_token}"},
            )
            if response.status != 403:
                raise AssertionError(f"Cross-user note read returned {response.status}, expected 403")
            result["assertions"].append("participant-cross-user-notes-denied")

            # The primary HTTP server has intentionally been stopped. Load the
            # surviving gateway and authenticate the same teacher there; a
            # document reload cannot use the in-page API failover transport.
            history_page = open_lobby(contexts[participants[0]], active_base_url, accounts["participants"][0])
            result["historyBaseUrl"] = active_base_url
            history_rows = history_page.locator(".pd-history-row")
            history_rows.first.wait_for(state="visible", timeout=15000)
            current_history = history_rows.first
            current_history.get_by_role("button", name="View archive").click()
            expect(current_history.locator(".pd-history-notes")).to_contain_text("Delayed older", timeout=15000)
            history_notes = current_history.locator(".pd-history-notes").inner_text()
            if "Newer typing" in history_notes or "Unsaved Vietnamese" in history_notes:
                raise AssertionError(f"Archive exposed a local-only notebook draft: {history_notes!r}")
            result["assertions"].append("teacher-history-view-renders-readable-notes")

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
