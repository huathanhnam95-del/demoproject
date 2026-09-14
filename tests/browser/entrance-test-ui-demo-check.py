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
        if clean == "/__fixtures__/entrance-test-ui-lab.html":
            return str(PUBLIC / "entrance-test-ui-lab.html")
        if clean == "/__fixtures__/js/entrance-test-ui-fonts.js":
            return str(PUBLIC / "js" / "entrance-test-ui-fonts.js")
        if clean == "/favicon.ico":
            return str(PUBLIC / "favicon.ico")
        return super().translate_path(path)

    def do_GET(self):
        if unquote(urlsplit(self.path).path) == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        return super().do_GET()

    def copyfile(self, source, outputfile):
        try:
            return super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            return None

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


def assert_screen_layout(page, label: str, screen: str):
    if not label.startswith("mobile"):
        return
    metrics = page.evaluate(
        """() => ({
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth
        })"""
    )
    assert_true(metrics["documentWidth"] <= metrics["viewportWidth"], f"{screen} screen overflows horizontally: {metrics}")
    assert_true(metrics["bodyWidth"] <= metrics["viewportWidth"], f"{screen} body overflows horizontally: {metrics}")


def assert_single_live_region(page, screen: str):
    count = page.locator("[aria-live]").count()
    assert_true(count == 1, f"{screen} exposes {count} aria-live regions; expected one")


def assert_control_geometry(page, screen: str, include_parts: bool = True, include_inline: bool = True):
    sizes = page.evaluate(
        """() => ({
          header: Array.from(document.querySelectorAll('[data-action="locale"], [data-action="scale"]')).map((node) => Math.round(node.getBoundingClientRect().height)),
          parts: Array.from(document.querySelectorAll('[data-action="nav-part"]')).map((node) => Math.round(node.getBoundingClientRect().height)),
          inline: Array.from(document.querySelectorAll('.et-inline-select, .et-inline-text')).map((node) => Math.round(node.getBoundingClientRect().height))
        })"""
    )
    if not include_parts:
        sizes.pop("parts")
    if not include_inline:
        sizes.pop("inline")
    for group, heights in sizes.items():
        assert_true(heights and min(heights) >= 44, f"{screen} {group} controls do not meet 44px target: {sizes}")


def assert_mobile_dock_clear(page, label: str):
    if label != "mobile":
        return
    metrics = page.evaluate(
        """() => {
          window.scrollTo(0, document.body.scrollHeight);
          const stage = document.querySelector('.et-task-stage');
          const dock = document.querySelector('.et-part-dock');
          const stageRect = stage?.getBoundingClientRect();
          const dockRect = dock?.getBoundingClientRect();
          return {
            dockPosition: dock ? getComputedStyle(dock).position : '',
            stageBottom: stageRect?.bottom ?? 0,
            dockTop: dockRect?.top ?? 0,
            scrollY: window.scrollY
          };
        }"""
    )
    assert_true(metrics["dockPosition"] != "sticky" and metrics["dockPosition"] != "fixed", f"Mobile dock still overlays the task: {metrics}")
    assert_true(metrics["dockTop"] >= metrics["stageBottom"] - 1, f"Mobile dock overlaps the task stage: {metrics}")


def candidate_case(page, base: str, output: Path, results: dict, label: str):
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
    assert_true(page.locator("body").get_attribute("data-visual-revision") == "signal-noto-v2", "Demo D visual revision marker is missing")
    assert_true(page.locator(".et-section-row").count() == 4, "Intro does not show all four assessment parts")
    assert_true(page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), f"{label} viewport has horizontal overflow")
    assert_screen_layout(page, label, "intro")
    assert_single_live_region(page, "intro")
    skip_link = page.locator(".et-skip-link")
    assert_true(skip_link.count() == 1, "Visible-on-focus skip link is missing")
    skip_link.focus()
    assert_true(page.evaluate("document.activeElement?.classList.contains('et-skip-link')"), "Skip link did not receive focus")
    assert_true(page.evaluate("(() => { const r = document.querySelector('.et-skip-link').getBoundingClientRect(); return r.width > 0 && r.height > 0; })()"), "Skip link is not visible when focused")
    assert_control_geometry(page, "intro", include_parts=False, include_inline=False)
    page.screenshot(path=str(output / f"candidate-{label}-intro.png"), full_page=True)

    page.locator("[data-action='start-demo']").click()
    page.wait_for_selector("[data-view='miccheck']")
    assert_screen_layout(page, label, "miccheck")
    assert_single_live_region(page, "miccheck")
    page.locator("[data-mic-action='skip']").click()
    page.wait_for_selector("[data-view='question']")
    assert_screen_layout(page, label, "speaking")
    assert_single_live_region(page, "speaking")
    assert_mobile_dock_clear(page, label)
    assert_true("Scientists make observations" in page.locator(".et-passage").inner_text(), "Speaking Q1 passage is missing")
    assert_true("Instruction" not in page.locator(".et-task-instruction").inner_text(), "Generic instruction label leaked into Demo D")
    assert_true(page.locator("[data-action='nav-part']").count() == 4, "Compact part navigation is incomplete")
    page.locator("[data-action='open-overview']").click()
    page.locator("#et-overview-dialog").wait_for(state="visible")
    page.locator("[data-action='close-overview']").click()
    page.screenshot(path=str(output / f"candidate-{label}-speaking.png"), full_page=True)
    page.locator("[data-action='next-question']").click()
    page.wait_for_selector("[data-question-id='speaking_q2']")
    assert_true("Statistics are indicators" in page.locator(".et-passage").inner_text(), "Speaking Q2 passage is missing")
    page.locator("[data-action='next-question']").click()
    page.wait_for_selector("[data-question-id='speaking_q3']")
    assert_true("US student debt" in page.locator(".et-passage").inner_text(), "Speaking Q3 passage is missing")
    page.locator("[data-action='nav-part'][data-section-id='vocab']").click()
    page.wait_for_selector("[data-question-id='vocab_q1']")
    page.locator("[data-action='nav-question'][data-question-id='vocab_q1']").first.click()
    page.wait_for_selector("[data-question-id='vocab_q1']")
    select = page.locator("select[data-answer-question='vocab_q1']").first
    assert_control_geometry(page, "vocabulary")
    select.select_option(index=1)
    assert_screen_layout(page, label, "vocabulary")
    assert_single_live_region(page, "vocabulary")
    filled_background = select.evaluate("(node) => getComputedStyle(node).backgroundColor")
    assert_true(filled_background in ("rgb(240, 240, 240)", "rgb(245, 245, 245)"), f"Filled answer is not neutral gray: {filled_background}")
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
    page.locator("[data-action='locale'][data-value='en']").click()
    page.locator("[data-action='nav-part'][data-section-id='grammar']").click()
    page.wait_for_selector("[data-question-id='grammar_q1']")
    assert_screen_layout(page, label, "grammar")
    assert_single_live_region(page, "grammar")
    assert_true("Choose the correct form" in page.locator(".et-task-instruction").inner_text(), "Grammar instruction was not specific")
    page.locator("[data-action='nav-part'][data-section-id='listen_write']").click()
    page.wait_for_selector("[data-question-id='listen_write_q1']")
    assert_screen_layout(page, label, "listening")
    assert_single_live_region(page, "listening")
    assert_true("Listen to the recording" in page.locator(".et-task-instruction").inner_text(), "Listening instruction was not specific")
    assert_true(page.locator("[data-audio-action='seek']").count() == 1, "Listening player seek control is missing")
    page.locator("[data-audio-action='rate']").select_option("1.2")
    page.evaluate(
        """() => {
          const audio = document.getElementById('et-listening-audio');
          const input = document.querySelector('input[data-answer-question="listen_write_q1"]');
          Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 37 });
          window.__etListeningNode = audio;
          input.value = 'Alpha Bravo Charlie';
          input.focus();
          input.setSelectionRange(6, 11);
          window.__etCaretBeforeInput = { start: input.selectionStart, end: input.selectionEnd };
        }"""
    )
    page.keyboard.insert_text("X")
    page.wait_for_timeout(500)
    continuity = page.evaluate(
        """() => {
          const audio = document.getElementById('et-listening-audio');
          const input = document.querySelector('input[data-answer-question="listen_write_q1"]');
          return {
            sameNode: audio === window.__etListeningNode,
            currentTime: audio?.currentTime,
            playbackRate: audio?.playbackRate,
            value: input?.value,
            selectionStart: input?.selectionStart,
            selectionEnd: input?.selectionEnd
          };
        }"""
    )
    assert_true(continuity["sameNode"], f"Listening audio DOM node was replaced during input: {continuity}")
    assert_true(abs(float(continuity["currentTime"]) - 37) < 0.01, f"Listening playback position was lost during input: {continuity}")
    assert_true(abs(float(continuity["playbackRate"]) - 1.2) < 0.01, f"Listening playback rate was lost during input: {continuity}")
    assert_true(continuity["value"] == "Alpha X Charlie", f"Listening input value changed unexpectedly: {continuity}")
    assert_true(continuity["selectionStart"] == 7 and continuity["selectionEnd"] == 7, f"Mid-string caret was not preserved: {continuity}")

    clean_attempt(page)
    page.locator(".et-qa summary").click()
    page.locator("[data-action='qa-partial']").click()
    page.wait_for_timeout(600)
    page.locator("[data-action='continue-demo'], [data-action='start-demo']").first.click()
    page.wait_for_selector("[data-question-id='speaking_q1']")
    page.locator("[data-action='review']").click()
    page.wait_for_selector("[data-view='review']")
    review_text = page.locator("[data-view='review']").inner_text()
    assert_screen_layout(page, label, "review")
    assert_single_live_region(page, "review")
    assert_true(page.locator(".et-review-section").count() == 4, "Review does not render all four section rows")
    assert_true("recordings saved" in review_text.lower(), "Review omits explicit speaking recording units")
    assert_true("Vocabulary · Question 4" in review_text, "Review missing target is not globally numbered")
    assert_true("vocab_q1" not in review_text and "vocab_q1__" not in review_text, "Raw question or blank IDs leaked into review copy")
    assert_true(page.locator(".et-review-details").count() >= 1, "Review omits disclosure details for missing written answers")
    page.screenshot(path=str(output / f"candidate-{label}-review-partial.png"), full_page=True)

    clean_attempt(page)
    page.locator(".et-qa summary").click()
    page.locator("[data-action='qa-fill-all']").click()
    page.wait_for_timeout(1800)
    page.locator("[data-action='continue-demo'], [data-action='start-demo']").first.click()
    page.wait_for_selector("[data-question-id='speaking_q1']")
    page.locator("[data-action='toggle-flag'][data-question-id='speaking_q1']").click()
    page.locator("[data-action='review']").click()
    page.wait_for_selector("[data-view='review']")
    complete_review_text = page.locator("[data-view='review']").inner_text()
    assert_screen_layout(page, label, "complete review")
    assert_true("recordings saved" in complete_review_text.lower(), "Complete review omits speaking recording units")
    assert_true(page.locator(".et-group-link.is-complete.is-flagged[data-question-id='speaking_q1']").count() == 1, "Complete flagged speaking group is not reachable from review")
    assert_true("speaking_q1" not in complete_review_text, "Raw speaking question ID leaked into visible review copy")
    assert_true(page.locator("[data-view='review'] .et-group-number").all_inner_texts() == [str(index) for index in range(1, 14)], "Review group numbering is not consistently global")
    page.screenshot(path=str(output / f"candidate-{label}-review.png"), full_page=True)
    finish = page.locator("[data-action='submit-demo']")
    finish.click()
    assert_true(finish.is_disabled(), "Finishing state did not disable the submit action immediately")
    assert_true("finishing" in finish.inner_text().lower(), "Finishing state was not rendered before persistence")
    page.wait_for_selector("[data-view='done']", timeout=15000)
    assert_screen_layout(page, label, "done")
    assert_single_live_region(page, "done")
    receipt = page.locator(".et-receipt-id").inner_text()
    assert_true(receipt.startswith("demo-d-"), f"Unexpected local receipt: {receipt}")
    db_names = page.evaluate("indexedDB.databases().then((items) => items.map((item) => item.name))")
    assert_true(DB_NAME in db_names, "Demo D did not create its isolated IndexedDB store")
    assert_true(not any("/api/" in url or "firestore" in url.lower() for url in requests), "Candidate attempted a learner/API write")
    page.screenshot(path=str(output / f"candidate-{label}-done.png"), full_page=True)
    results.setdefault("candidate", {})[label] = {"status": "pass", "font": font_state, "receipt": receipt, "dbNames": db_names, "requestCount": len(requests)}


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
    mic_text = page.locator("[data-view='miccheck']").inner_text().lower()
    assert_true("ready" in mic_text or "sẵn sàng" in mic_text, "Synthetic microphone take was not reported as ready")
    assert_true("record again" in mic_text or "thu lại" in mic_text, "Saved mic-check state does not offer Record again")
    assert_true("elapsed" not in mic_text and "đã trôi qua" not in mic_text, "Saved mic-check state duplicates duration with the native player")
    page.screenshot(path=str(output / "candidate-miccheck.png"), full_page=True)
    results["audio"] = {"status": "pass", "fakeInput": str(fake_audio)}


def host_case(page, base: str, output: Path, results: dict):
    page.goto(base + "/entrance-test-ui-lab.html")
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
    page.goto(base + "/__fixtures__/evaluator-host.html")
    page.wait_for_selector("#et-ui-name")
    page.locator("#et-ui-name").fill("Demo D browser rater")
    page.locator("#et-ui-enter").click()
    page.wait_for_selector("[data-skin='d']")
    skins = page.locator("[data-skin]").count()
    assert_true(skins == 1, f"Evaluator exposes {skins} skins, expected D only")
    page.locator("[data-skin='d']").click()
    page.wait_for_function("document.querySelector('#et-ui-frame')?.getAttribute('src').includes('entrance-test-ui/')")
    frame = page.frame_locator("#et-ui-frame")
    frame.locator("[data-view='intro']").wait_for()
    page.locator("[data-goto='grammar']").click()
    page.wait_for_function("document.querySelector('[data-goto=grammar]')?.classList.contains('is-on')")
    frame.locator("[data-view='question'][data-question-id='grammar_q1']").wait_for(timeout=10000)
    page.locator("[data-rate='visual'][data-value='4']").click()
    assert_true("4/5" in page.locator("[data-crit='visual']").inner_text(), "Demo D star rating did not render")
    assert_true(page.locator("[data-skin='a'],[data-skin='b'],[data-skin='c']").count() == 0, "Legacy controls remain reachable")
    assert_true("/40" in page.locator(".et-guide").inner_text(), "D-only completion does not require 40 scores")
    legacy = page.context.new_page()
    for skin in ["a", "b", "c"]:
        response = legacy.goto(base + "/entrance-test-ui-lab.html?skin=" + skin)
        assert_true(response.ok and legacy.locator("body").inner_text().strip(), "Historical standalone route missing")
    legacy.close()
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
    viewports = {"desktop": {"width": 1440, "height": 1000}, "mobile": {"width": 390, "height": 844}, "mobile-short": {"width": 390, "height": 640}}
    results = {"status": "pass", "startedAt": datetime.now(timezone.utc).isoformat(), "baseUrl": base, "viewports": viewports, "cases": {}}
    console_errors = []
    page_errors = []
    http_errors = []

    def record_console(message):
        if message.type == "error":
            console_errors.append({"text": message.text, "location": message.location})
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", f"--use-file-for-fake-audio-capture={fake_audio}"])
            for label, viewport in viewports.items():
                context = browser.new_context(viewport=viewport, permissions=["microphone"])
                def new_page():
                    case_page = context.new_page()
                    case_page.on("console", record_console)
                    case_page.on("pageerror", lambda error: page_errors.append(str(error)))
                    case_page.on("response", lambda response: http_errors.append({"url": response.url, "status": response.status}) if response.status >= 400 else None)
                    case_page.on("requestfailed", lambda request: http_errors.append({"url": request.url, "status": "failed", "failure": request.failure}))
                    return case_page

                if args.case in ("candidate", "all"):
                    page = new_page()
                    candidate_case(page, base, output, results["cases"], label)
                    page.close()
                if label == "desktop" and args.case in ("audio", "all"):
                    page = new_page()
                    audio_case(page, base, output, fake_audio, results["cases"])
                    page.close()
                if label == "desktop" and args.case in ("host", "all"):
                    page = new_page()
                    host_case(page, base, output, results["cases"])
                    page.close()
                context.close()
            results["browser"] = {"name": "Chrome", "version": browser.version}
            browser.close()
    except Exception as error:
        results["status"] = "fail"
        results["error"] = f"{type(error).__name__}: {error}"
    finally:
        results["consoleErrors"] = console_errors
        results["pageErrors"] = page_errors
        results["httpErrors"] = http_errors
        results["finishedAt"] = datetime.now(timezone.utc).isoformat()
        results["artifacts"] = [{"path": str(path), "sha256": sha256(path)} for path in sorted(output.iterdir()) if path.is_file()]
        (output / "manifest.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
        server.shutdown()
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0 if results["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
