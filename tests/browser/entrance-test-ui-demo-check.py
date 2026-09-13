"""Chrome-only acceptance checks for the isolated Demo D entrance-test UI.

The server exposes public/ plus one explicitly mapped evaluator fixture. The
fixture data is synthetic and no learner API or Firebase client is loaded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import threading
import wave
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
FIXTURE = ROOT / "tests" / "fixtures" / "entrance-test-ui" / "evaluator-host.html"
DB_NAME = "bel-entrance-test-ui-demo"


class FixtureHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def translate_path(self, path: str) -> str:
        clean = unquote(urlsplit(path).path)
        if clean == "/__fixtures__/evaluator-host.html":
            return str(FIXTURE)
        return super().translate_path(path)

    def log_message(self, fmt, *args):
        return


def start_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_port}"


def write_fake_audio(output: Path) -> Path:
    path = output / "synthetic-mic.wav"
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        frames = bytearray()
        for index in range(16000):
            sample = int(9000 * ((index % 80) / 80 - 0.5))
            frames.extend(int(sample).to_bytes(2, "little", signed=True))
        handle.writeframes(bytes(frames))
    return path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_attempt(page):
    page.goto(page.url.split("/entrance-test-ui/")[0] + "/entrance-test-ui/")
    page.evaluate(
        """async (name) => {
          localStorage.clear();
          await new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          });
        }""",
        DB_NAME,
    )
    page.reload()
    page.wait_for_selector("[data-view='intro']")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def candidate_case(page, base: str, output: Path, results: dict):
    requests = []
    page.on("request", lambda request: requests.append(request.url))
    page.goto(base + "/entrance-test-ui/")
    page.wait_for_selector("[data-view='intro']")
    page.evaluate(
        """async (name) => {
          localStorage.clear();
          await new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          });
        }""",
        DB_NAME,
    )
    page.reload()
    page.wait_for_selector("[data-view='intro']")

    font_state = page.evaluate(
        """async () => {
          await document.fonts.ready;
          return {
            status: document.fonts.status,
            checks: [400, 500, 600].map((weight) => document.fonts.check(`${weight} 16px "Noto Sans"`)),
            label: document.querySelector('[data-demo-font-default]')?.dataset.demoFontDefault || ''
          };
        }"""
    )
    assert_true(font_state["status"] == "loaded", "Noto Sans font set did not reach loaded state")
    assert_true(all(font_state["checks"]), f"Noto Sans weight checks failed: {font_state}")
    assert_true(font_state["label"] == "Noto Sans", "Demo D does not advertise Noto Sans as its default")

    page.locator("[data-action='start-demo']").click()
    page.wait_for_selector("[data-view='miccheck']")
    page.locator("[data-mic-action='skip']").click()
    page.wait_for_selector("[data-view='question']")
    page.locator("[data-action='nav-question'][data-question-id='vocab_q1']").first.click()
    page.wait_for_selector("[data-question-id='vocab_q1']")
    select = page.locator("select[data-answer-question='vocab_q1']").first
    select.select_option(index=1)
    page.locator("[data-action='locale'][data-value='vi']").click()
    page.locator("[data-action='scale'][data-value='130']").click()
    page.wait_for_timeout(500)
    exact_value = select.input_value()
    assert_true(exact_value == "primates", f"Inline select lost exact choice: {exact_value!r}")
    assert_true(page.locator("html").get_attribute("lang") == "vi", "Vietnamese guidance toggle did not update document language")
    assert_true(page.locator("body").evaluate("(node) => getComputedStyle(node).fontFamily").lower().find("noto sans") >= 0, "Body did not use Noto Sans")

    page.reload()
    page.wait_for_selector("[data-question-id='vocab_q1']")
    assert_true(page.locator("select[data-answer-question='vocab_q1']").first.input_value() == "primates", "Saved exact choice did not survive reload")

    clean_attempt(page)
    page.locator(".et-qa summary").click()
    page.locator("[data-action='qa-complete']").click()
    page.wait_for_selector("[data-view='done']", timeout=15000)
    receipt = page.locator(".et-receipt-id").inner_text()
    assert_true(receipt.startswith("demo-d-"), f"Unexpected local receipt: {receipt}")
    db_names = page.evaluate("indexedDB.databases().then((items) => items.map((item) => item.name))")
    assert_true(DB_NAME in db_names, "Demo D did not create its isolated IndexedDB store")
    assert_true(not any("/api/" in url or "firestore" in url.lower() for url in requests), "Candidate attempted a learner/API write")
    page.screenshot(path=str(output / "candidate-done.png"), full_page=True)
    results["candidate"] = {"status": "pass", "font": font_state, "receipt": receipt, "dbNames": db_names, "requestCount": len(requests)}


def audio_case(page, base: str, output: Path, fake_audio: Path, results: dict):
    page.goto(base + "/entrance-test-ui/")
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_selector("[data-view='intro']")
    page.locator("[data-action='start-demo']").click()
    page.wait_for_selector("[data-view='miccheck']")
    page.locator("[data-mic-action='start']").click()
    page.wait_for_timeout(700)
    page.wait_for_selector("[data-mic-action='stop']", timeout=5000)
    page.locator("[data-mic-action='stop']").click()
    page.wait_for_selector("[data-mic-action='continue']", timeout=15000)
    assert_true("ready" in page.locator("[data-view='miccheck']").inner_text().lower() or "sẵn sàng" in page.locator("[data-view='miccheck']").inner_text().lower(), "Synthetic microphone take was not reported as ready")
    page.screenshot(path=str(output / "candidate-miccheck.png"), full_page=True)
    results["audio"] = {"status": "pass", "fakeInput": str(fake_audio)}


def host_case(page, base: str, output: Path, results: dict):
    page.goto(base + "/__fixtures__/evaluator-host.html")
    page.wait_for_selector("#et-ui-name")
    page.locator("#et-ui-name").fill("Demo D browser rater")
    page.locator("#et-ui-enter").click()
    page.wait_for_selector("[data-skin='d']")
    skins = page.locator("[data-skin]").count()
    assert_true(skins == 4, f"Evaluator exposes {skins} skins, expected four")
    page.evaluate(
        """async (name) => {
          localStorage.removeItem('entrance_test_ui_demo_v1:activeAttemptId');
          await new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          });
        }""",
        DB_NAME,
    )
    page.locator("[data-skin='d']").click()
    page.wait_for_function("document.querySelector('#et-ui-frame')?.getAttribute('src').includes('entrance-test-ui/')")
    frame = page.frame_locator("#et-ui-frame")
    frame.locator("[data-view='intro']").wait_for()
    page.locator("[data-goto='grammar']").click()
    page.wait_for_function("document.querySelector('[data-goto=grammar]')?.classList.contains('is-on')")
    frame.locator("[data-view='question'][data-question-id='grammar_q1']").wait_for(timeout=10000)
    page.locator("[data-rate='visual'][data-value='4']").click()
    assert_true("4/5" in page.locator("[data-crit='visual']").inner_text(), "Demo D star rating did not render")
    page.locator("[data-skin='a']").click()
    page.wait_for_function("document.querySelector('#et-ui-frame')?.getAttribute('src').includes('entrance-test-ui-lab.html?skin=a')")
    page.locator("[data-skin='b']").click()
    page.wait_for_function("document.querySelector('#et-ui-frame')?.getAttribute('src').includes('entrance-test-ui-lab.html?skin=b')")
    page.locator("[data-skin='d']").click()
    page.wait_for_function("document.querySelector('#et-ui-frame')?.getAttribute('src').includes('entrance-test-ui/')")
    assert_true("bốn" in page.locator(".et-guide").inner_text().lower(), "Evaluator requirement copy was not extended to four demos")
    page.screenshot(path=str(output / "evaluator-demo-d.png"), full_page=True)
    results["host"] = {"status": "pass", "skinCount": skins, "dFrame": True, "dRating": "4/5", "historicalFrames": ["a", "b"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", choices=["candidate", "audio", "host", "all"], default="all")
    parser.add_argument("--output", default=str(ROOT / "test-results" / "entrance-test-ui-demo-browser"))
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    fake_audio = write_fake_audio(output)
    server, base = start_server()
    results = {"status": "pass", "startedAt": datetime.now(timezone.utc).isoformat(), "baseUrl": base, "viewport": {"width": 1440, "height": 1000}, "cases": {}}
    console_errors = []
    page_errors = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", f"--use-file-for-fake-audio-capture={fake_audio}"])
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, permissions=["microphone"])
            page = context.new_page()
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            if args.case in ("candidate", "all"):
                candidate_case(page, base, output, results["cases"])
            if args.case in ("audio", "all"):
                audio_case(page, base, output, fake_audio, results["cases"])
            if args.case in ("host", "all"):
                host_case(page, base, output, results["cases"])
            results["browser"] = {"name": "Chrome", "version": browser.version}
            context.close()
            browser.close()
    except Exception as error:
        results["status"] = "fail"
        results["error"] = f"{type(error).__name__}: {error}"
    finally:
        results["consoleErrors"] = console_errors
        results["pageErrors"] = page_errors
        results["finishedAt"] = datetime.now(timezone.utc).isoformat()
        results["artifacts"] = [{"path": str(path), "sha256": sha256(path)} for path in sorted(output.iterdir()) if path.is_file()]
        (output / "manifest.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
        server.shutdown()
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0 if results["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
