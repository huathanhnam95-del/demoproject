"""Download a real PDF in cold Chrome under the CRM's unchanged CSP.

Only the PDF module and bundled fonts are served on an owned ephemeral port.
No Firebase, provider or production API is used. Requires Playwright, installed
Chrome, pdfplumber, and --output-dir outside Git.
"""
import argparse
import html
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from urllib.parse import parse_qs, urlparse
import pdfplumber

ROOT = Path(__file__).resolve().parents[2]
public = ROOT / "public"
source = (public / "crm-admin.html").read_text(encoding="utf-8")
csp = re.search(r'<meta http-equiv="Content-Security-Policy"\s+content="([^"]+)"', source).group(1)


def build_rich_report():
    return {
        "summary": {"quick_recap_60s": "Điểm đầu vào và kế hoạch luyện tập."},
        "whatTaught": [
            {
                "category": "Writing",
                "topic": f"Structured argument checkpoint {index}",
                "key_rule": "Connect each claim to evidence and explain the consequence before moving on.",
                "examples": ["Claim -> evidence -> explanation", "Topic sentence -> supporting detail"],
            }
            for index in range(1, 13)
        ],
        "problems": [
            {
                "issue_summary": f"Sentence cohesion review {index}",
                "student_error": "The paragraph changes direction before the link is clear.",
                "teacher_fix": "Add a precise transition and restate the relationship between the ideas.",
                "student_outcome": "Needs Practice",
                "severity": "Trung bình",
            }
            for index in range(1, 7)
        ],
        "nextBriefing": {
            "warmup_quiz_questions": [f"Rewrite the cohesion example {index}." for index in range(1, 5)],
            "teacher_followup_focus": [f"Check the evidence link in paragraph {index}." for index in range(1, 5)],
            "student_homework_checklist": [f"Revise paragraph {index} using PEEL." for index in range(1, 4)],
        },
    }

CASES = {
    "short": {
        "title": "Vietnamese briefing",
        "studentName": "Nguyễn Thị Mỹ",
        "durationSec": 125,
        "durationText": "2 min",
    },
    "long-english": {
        "title": "IELTS Academic Writing: Cohesion and Sentence Variety for Integrated Task Responses",
        "studentName": "Nguyen Van Test",
        "durationSec": 3725,
        "durationText": "1h 2m",
    },
    "long-vietnamese": {
        "title": "Hướng dẫn viết bài luận học thuật chuyên sâu và phát triển lập luận mạch lạc trong mọi dạng đề",
        "studentName": "Nguyễn Văn Minh",
        "durationSec": 3665,
        "durationText": "1h 1m",
        "minPages": 2,
        "report": build_rich_report(),
    },
}


def inspect_pdf(path: Path, fixture: dict):
    data = path.read_bytes()
    assert data.startswith(b"%PDF-") and b"%%EOF" in data[-100:], "Invalid PDF structure"
    assert len(data) > 10000, "Expected real content and embedded fonts"

    with pdfplumber.open(path) as pdf:
        assert pdf.pages, "PDF has no pages"
        if fixture.get("minPages"):
            assert len(pdf.pages) >= fixture["minPages"], f"Expected at least {fixture['minPages']} pages, got {len(pdf.pages)}"
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        collapsed = " ".join(text.split())
        for token in fixture["title"].split():
            assert token in collapsed, f"Topic token missing from PDF text: {token!r}"

        page = pdf.pages[0]
        words = page.extract_words()
        topic_label = next((word for word in words if word["text"] == "Chủ"), None)
        duration_label = next((
            word for word in words
            if word["x0"] > 300 and abs(word["top"] - (topic_label or {"top": 0})["top"]) < 3
        ), None)
        date_label = next((word for word in words if word["text"] == "Ngày"), None)
        assert topic_label and duration_label and date_label, "Metadata labels missing"
        left_value_x = topic_label["x1"] + 5
        overlap_limit = duration_label["x0"] - 4
        topic_crop = page.crop((left_value_x, topic_label["top"] - 3, overlap_limit, date_label["top"] - 3))
        topic_crop_text = " ".join((topic_crop.extract_text() or "").split())
        normalized_title = " ".join(fixture["title"].split())
        assert normalized_title in topic_crop_text, (
            f"Topic is not fully retained inside the left metadata column: {topic_crop_text!r}"
        )
        topic_words = [word for word in words if word["x0"] >= left_value_x and word["x0"] < overlap_limit
                       and word["top"] >= topic_label["top"] - 3 and word["top"] < date_label["top"] - 3]
        assert topic_words, "Topic value is missing from metadata row"
        assert all(word["x1"] <= overlap_limit for word in topic_words), (
            f"Topic overlaps duration column: {[(w['text'], w['x0'], w['x1']) for w in topic_words]}"
        )
        assert fixture["durationText"] in collapsed, "Duration missing from PDF text"
        header_words = [word for word in words if word["top"] < 35]
        brand_tokens = {"BEL", "CRM", "Báo", "Cáo", "Phiên", "Dạy", "&", "Briefing"}
        brand_words = [word for word in header_words if word["text"] in brand_tokens]
        header_info_words = [word for word in header_words if word["text"] not in brand_tokens]
        assert brand_words and header_info_words, "Header text is missing"
        header_brand_end = max(word["x1"] for word in brand_words)
        assert min(word["x0"] for word in header_info_words) >= header_brand_end + 4, (
            f"Header info overlaps the fixed brand: {[(w['text'], w['x0'], w['x1']) for w in header_info_words]}"
        )
        assert max(word["x1"] for word in header_info_words) <= page.width - 45, "Header info is clipped"
        for page_number, current_page in enumerate(pdf.pages, start=1):
            current_words = current_page.extract_words()
            current_text = " ".join((current_page.extract_text() or "").split())
            assert f"Trang {page_number}" in current_text, f"Page {page_number} footer number missing"
            assert "BEL CRM Briefing" in current_text, f"Page {page_number} footer text missing"
            assert all(word["bottom"] <= current_page.height + 1 for word in current_words), (
                f"Page {page_number} has text beyond the page bottom"
            )
        for repeated_page in pdf.pages[1:]:
            repeated_words = repeated_page.extract_words()
            repeated_header = [word for word in repeated_words if word["top"] < 35]
            repeated_brand = [word for word in repeated_header if word["text"] in brand_tokens]
            repeated_info = [word for word in repeated_header if word["text"] not in brand_tokens]
            assert repeated_brand and repeated_info, "Repeated header text is missing"
            repeated_brand_end = max(word["x1"] for word in repeated_brand)
            assert min(word["x0"] for word in repeated_info) >= repeated_brand_end + 4, "Repeated header overlaps the brand"
            assert max(word["x1"] for word in repeated_info) <= repeated_page.width - 45, "Repeated header is clipped"
        return {
            "bytes": len(data),
            "pages": len(pdf.pages),
            "textChars": len(text),
            "topicWords": len(topic_words),
            "headerWords": len(header_words),
        }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            case_name = parse_qs(parsed.query).get("case", ["short"])[0]
            fixture = CASES[case_name]
            fixture_json = json.dumps(fixture, ensure_ascii=False)
            body = (f'<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{html.escape(csp, quote=True)}">'
                    '<button id="export">Export</button><div id="status"></div>'
                    '<script src="/js/crm/teaching-session-pdf.js"></script>'
                    '<script>document.getElementById("export").onclick=async()=>{try{'
                    f'const fixture={fixture_json}; await generateTeachingSessionPdf({{session:{{title:fixture.title,'
                    'studentName:fixture.studentName,audioDurationSec:fixture.durationSec,'
                    'report:fixture.report||{summary:{quick_recap_60s:"Điểm đầu vào và kế hoạch luyện tập."}}}});'
                    'document.getElementById("status").textContent="Complete";'
                    '}catch(e){document.getElementById("status").textContent=e.message;}};</script>').encode()
            content_type = "text/html; charset=utf-8"
        elif self.path == "/js/crm/teaching-session-pdf.js":
            body = (public / self.path.lstrip("/")).read_bytes()
            content_type = "application/javascript"
        elif self.path in ("/fonts/Roboto-Regular.ttf", "/fonts/Roboto-Bold.ttf", "/fonts/Roboto-Italic.ttf"):
            body = (public / self.path.lstrip("/")).read_bytes()
            content_type = "font/ttf"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError("PDF evidence must stay outside the repository")
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            results = {}
            try:
                for case_name, fixture in CASES.items():
                    page = browser.new_page(accept_downloads=True)
                    errors = []
                    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
                    try:
                        page.goto(f"http://127.0.0.1:{server.server_port}/?case={case_name}")
                        with page.expect_download(timeout=15000) as pending:
                            page.locator("#export").click()
                        download = pending.value
                        destination = output / f"teaching-session-{case_name}.pdf"
                        download.save_as(destination)
                        assert not any("Content Security Policy" in error for error in errors), errors
                        results[case_name] = {
                            "pdf": str(destination),
                            "fixture": fixture,
                            "inspection": inspect_pdf(destination, fixture),
                            "cspErrors": 0,
                        }
                    except Exception as error:
                        print(json.dumps({"case": case_name, "status": page.locator("#status").inner_text(), "consoleErrors": errors, "error": str(error)}, ensure_ascii=True))
                        raise
                    finally:
                        page.close()
                (output / "wrap-final.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
                print(json.dumps(results, ensure_ascii=True))
            except Exception:
                print(json.dumps({"results": results}, ensure_ascii=True))
                raise
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
