"""Real Chrome + demo Firebase emulator gate for Speech Assessment V3.

Run with BEL_V3_EVIDENCE_DIR pointing outside the repository. All business
responses come from the local app and emulators; provider calls use the local
server's environment. No credential or recording bytes are written to reports.
"""
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json
import hashlib
import os
import re
import sys
import uuid
from playwright.sync_api import sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError


PROJECT = "demo-crm-projects"
BASE = "http://127.0.0.1:8787"
FS = f"http://127.0.0.1:18080/v1/projects/{PROJECT}/databases/(default)/documents"
STORAGE = "http://127.0.0.1:19199"
UID = "xs8PCyZljJzU897Lil9WriFBUnMh"
EVIDENCE = Path(os.environ["BEL_V3_EVIDENCE_DIR"])
FIXTURES = EVIDENCE / "fixtures"


def emulator_json(url):
    req = Request(url, headers={"Authorization": "Bearer owner"})
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def field(doc, name, kind="stringValue"):
    return doc.get("fields", {}).get(name, {}).get(kind)


def credentials():
    text = Path("C:/Cursor AI/.local/browser-test-credentials.md").read_text(encoding="utf-8")
    email = re.search(r"^[-*]?\s*Username:\s*`?([^\s`]+)", text, re.M | re.I).group(1)
    password = re.search(r"^[-*]?\s*Password:\s*`?([^\r\n`]+)", text, re.M | re.I).group(1)
    return email, password


def block_production_firebase(route):
    url = route.request.url
    path = urlparse(url).path
    if path.endswith("/database/Describe%20Image/DI/1.png") or path.endswith("/database/Describe Image/DI/1.png"):
        return route.fulfill(path=str(FIXTURES / "solar-system.svg"), content_type="image/svg+xml")
    for suffix, fixture in (
        ("/database/Take%20Notes/RL/audio/1.mp3", "rl-stimulus.mp3"),
        ("/database/SGD/audio/2.mp3", "sgd-stimulus.mp3"),
        ("/database/RTS/audio/RTS_1.mp3", "rts-stimulus.mp3"),
    ):
        if path.endswith(suffix):
            return route.fulfill(path=str(FIXTURES / fixture), content_type="audio/mpeg")
    if url.startswith(("http://127.0.0.1:", "http://localhost:")):
        return route.continue_()
    if any(host in url for host in (
        "firestore.googleapis.com", "identitytoolkit.googleapis.com",
        "firebasestorage.googleapis.com", "firebaseio.com",
        "storage.googleapis.com"
    )):
        return route.abort()
    return route.continue_()


def login(page, query=""):
    page.goto(BASE + "/" + query, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_function("() => !!window.firebaseAuthFunctions && !!window.firebase?.apps?.length", timeout=30000)
    config = page.request.get(BASE + "/api/config").json()
    assert config["config"]["projectId"] == PROJECT
    assert {key: config["emulators"][key]["port"] for key in ("auth", "firestore", "storage")} == {
        "auth": 19099, "firestore": 18080, "storage": 19199
    }
    browser_projects = page.evaluate("""() => ({
      compat: window.firebase.app().options.projectId,
      modular: window.__FIREBASE_INTERNAL__.auth.app.options.projectId
    })""")
    assert browser_projects == {"compat": PROJECT, "modular": PROJECT}
    page.locator("#login-choice-btn").wait_for(state="visible", timeout=30000)
    email, password = credentials()
    page.locator("#login-choice-btn").click()
    page.locator("#login-email").fill(email)
    page.locator("#login-password").fill(password)
    page.locator("#login-password").press("Enter")
    page.wait_for_function("""() => window.__FIREBASE_INTERNAL__?.auth?.currentUser?.uid
      && window.firebase?.auth?.()?.currentUser?.uid""", timeout=30000)
    identities = page.evaluate("""() => ({
      modular: window.__FIREBASE_INTERNAL__.auth.currentUser.uid,
      compat: window.firebase.auth().currentUser.uid
    })""")
    assert identities["modular"] == identities["compat"] == UID


def create_entrance_test(page):
    student_id = "v3-chrome-" + uuid.uuid4().hex[:12]
    student = {"fields": {
        "firstName": {"stringValue": "Demo"},
        "lastName": {"stringValue": "Speaking"},
        "status": {"stringValue": "active"},
    }}
    req = Request(FS + "/crmStudents/" + student_id,
        data=json.dumps(student).encode(), method="PATCH",
        headers={"Authorization": "Bearer owner", "Content-Type": "application/json"})
    with urlopen(req, timeout=20) as response:
        assert response.status == 200
    bearer = page.evaluate("() => window.__FIREBASE_INTERNAL__.auth.currentUser.getIdToken()")
    response = page.request.post(BASE + f"/api/admin/students/{student_id}/entrance-tests",
        data={"testType": "entrance_test_36plus_v1"},
        headers={"Authorization": "Bearer " + bearer})
    payload = response.json()
    assert response.ok, {"status": response.status, "body": payload}
    data = payload.get("data") or payload
    assert data.get("testId") and data.get("testLink") and data.get("resultLink")
    return {"studentId": student_id, "testId": data["testId"],
        "testLink": data["testLink"], "resultLink": data["resultLink"]}


def run_entrance_setup(browser):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.route("**/*", block_production_firebase)
    login(page)
    entrance = create_entrance_test(page)
    (EVIDENCE / "entrance-setup-private.json").write_text(json.dumps(entrance), encoding="utf-8")
    result = {key: entrance[key] for key in ("studentId", "testId")}
    page.close()
    return result


def run_entrance_question(browser, number):
    setup = json.loads((EVIDENCE / "entrance-setup-private.json").read_text(encoding="utf-8"))
    parsed = urlparse(setup["testLink"])
    link = BASE + parsed.path + "?" + parsed.query
    page = browser.new_page(viewport={"width": 390 if number == 2 else 1440,
        "height": 844 if number == 2 else 900})
    page.route("**/*", block_production_firebase)
    calls = []
    page.on("response", lambda response: calls.append({"status": response.status,
        "path": urlparse(response.url).path}) if "/api/entrance-tests/" in response.url else None)
    page.goto(link, wait_until="domcontentloaded", timeout=60000)
    page.locator("#et-card").wait_for(state="visible", timeout=30000)
    for _ in range(2):
        if page.locator("#et-next").count():
            page.locator("#et-next").click()
        elif page.locator("#et-start-section").count():
            page.locator("#et-start-section").click()
    page.locator("#btn-start-rec").wait_for(state="visible", timeout=180000)
    assert f"Q{number}" in page.locator("#et-card").inner_text()[:80]
    page.locator("#btn-start-rec").click()
    page.locator("#btn-stop-rec").wait_for(state="visible", timeout=30000)
    page.wait_for_timeout({1:14500, 2:23000, 3:24000}[number])
    page.locator("#btn-stop-rec").click(force=True)
    page.locator("#btn-submit").wait_for(state="visible", timeout=30000)
    with page.expect_response(lambda response: "/api/entrance-tests/speaking/upload" in response.url,
        timeout=90000) as response_info:
        page.locator("#btn-submit").click()
    upload = response_info.value
    assert upload.ok, {"status": upload.status, "body": upload.text()[:500]}
    queued = upload.json()
    assert queued.get("status") == "queued" and queued.get("revisionId")
    if number == 2:
        page.reload(wait_until="domcontentloaded")
        page.locator(".et-saved-assessment").wait_for(state="visible", timeout=180000)
        assert "Q2" in page.locator("#et-card").inner_text()[:80]
        page.locator("#btn-submit").click()
    if number < 3:
        page.wait_for_function("""() => document.querySelector('#et-card')?.innerText.includes('Q' + String(%d))
            && !!document.querySelector('#btn-start-rec')""" % (number + 1), timeout=180000)
    else:
        page.wait_for_function("() => !document.querySelector('#et-card')?.innerText.includes('Q3')",
            timeout=180000)
    page.screenshot(path=str(EVIDENCE / f"entrance-q{number}-after.png"), full_page=True)
    test = emulator_json(FS + "/entranceTests/" + setup["testId"])
    evidence = {"question": number, "testId": setup["testId"],
        "studentId": setup["studentId"], "queuedRevisionId": queued["revisionId"],
        "status": field(test, "status"), "requests": calls}
    (EVIDENCE / f"entrance-q{number}-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    page.close()
    return evidence


def resume_entrance_question_2(browser):
    setup = json.loads((EVIDENCE / "entrance-setup-private.json").read_text(encoding="utf-8"))
    parsed = urlparse(setup["testLink"])
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.route("**/*", block_production_firebase)
    page.goto(BASE + parsed.path + "?" + parsed.query, wait_until="domcontentloaded")
    page.locator(".et-saved-assessment").wait_for(state="visible", timeout=30000)
    assert "Q2" in page.locator("#et-card").inner_text()[:80]
    assert "Assessment saved" in page.locator(".et-saved-assessment").inner_text()
    page.screenshot(path=str(EVIDENCE / "entrance-q2-recovered-mobile.png"), full_page=True)
    page.locator("#btn-submit").click()
    page.locator("#btn-start-rec").wait_for(state="visible", timeout=30000)
    assert "Q3" in page.locator("#et-card").inner_text()[:80]
    test = emulator_json(FS + "/entranceTests/" + setup["testId"])
    q2 = test["fields"]["speaking"]["mapValue"]["fields"]["speaking_q2"]["mapValue"]["fields"]
    assert q2["v3"]["mapValue"]["fields"]["status"]["stringValue"] == "ready"
    result = {"question": 2, "testId": setup["testId"], "recoveredReady": True,
        "advancedToQuestion3": True}
    (EVIDENCE / "entrance-q2-recovery.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    page.close()
    return result


def finish_entrance_test(browser):
    setup = json.loads((EVIDENCE / "entrance-setup-private.json").read_text(encoding="utf-8"))
    parsed = urlparse(setup["testLink"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.route("**/*", block_production_firebase)
    calls = []
    page.on("response", lambda response: calls.append({"status": response.status,
        "path": urlparse(response.url).path}) if "/api/entrance-tests/" in response.url else None)
    page.goto(BASE + parsed.path + "?" + parsed.query, wait_until="domcontentloaded")
    for step in range(24):
        page.locator("#et-card").wait_for(state="visible", timeout=30000)
        if page.locator("#et-progress-text").inner_text() == "Completed":
            break
        page.locator("#et-next, #et-start-section, #btn-submit").first.wait_for(
            state="visible", timeout=30000)
        if page.locator(".et-title").count() and "Submitted" in page.locator(".et-title").inner_text():
            break
        if page.locator("#et-start-section").count():
            page.locator("#et-start-section").click()
        elif page.locator("#et-next").count():
            page.locator("#et-next").click()
        elif page.locator("#btn-submit").count():
            if page.locator(".et-saved-assessment").count():
                page.locator("#btn-submit").click()
            else:
                for select in page.locator("select.et-blank-select").all():
                    options = select.locator("option").count()
                    assert options > 1
                    select.select_option(index=1)
                for input_box in page.locator("input.et-blank-input").all():
                    input_box.fill("test")
                page.locator("#btn-submit").click()
        else:
            raise AssertionError("Entrance Test has no next control: " + page.locator("#et-card").inner_text()[:300])
        page.wait_for_timeout(600)
    page.wait_for_function("() => document.querySelector('#et-progress-text')?.innerText === 'Completed'",
        timeout=60000)
    page.screenshot(path=str(EVIDENCE / "entrance-submitted-desktop.png"), full_page=True)
    test = emulator_json(FS + "/entranceTests/" + setup["testId"])
    assert field(test, "status") == "submitted"
    speaking = test["fields"]["speaking"]["mapValue"]["fields"]
    revisions = {}
    for number in (1, 2, 3):
        q = speaking[f"speaking_q{number}"]["mapValue"]["fields"]
        v3 = q["v3"]["mapValue"]["fields"]
        assert v3["status"]["stringValue"] == "ready"
        assert "mapValue" in v3.get("resultRef", {})
        revisions[number] = v3["revisionId"]["stringValue"]
    assert len(set(revisions.values())) == 3
    created = test["createTime"]
    ledger = emulator_json(FS + "/aiCreditLedger?pageSize=1000").get("documents", [])
    reservations = emulator_json(FS + "/aiCreditReservations?pageSize=1000").get("documents", [])
    new_ledger = [doc["name"] for doc in ledger if doc.get("createTime", "") > created
        and field(doc, "uid") == UID]
    new_reservations = [doc["name"] for doc in reservations if doc.get("createTime", "") > created
        and field(doc, "uid") == UID]
    assert not new_ledger and not new_reservations, {"ledger": new_ledger,
        "reservations": new_reservations}
    result = {"testId": setup["testId"], "studentId": setup["studentId"],
        "status": field(test, "status"), "speakingRevisionIds": revisions,
        "newCreditLedgerEntries": 0, "newCreditReservations": 0, "requests": calls}
    (EVIDENCE / "entrance-submitted-records.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    page.close()
    return result


def verify_entrance_records():
    setup = json.loads((EVIDENCE / "entrance-setup-private.json").read_text(encoding="utf-8"))
    test = emulator_json(FS + "/entranceTests/" + setup["testId"])
    assert field(test, "status") == "submitted"
    speaking = test["fields"]["speaking"]["mapValue"]["fields"]
    revisions = {}
    for number in (1, 2, 3):
        fields = speaking[f"speaking_q{number}"]["mapValue"]["fields"]["v3"]["mapValue"]["fields"]
        assert fields["status"]["stringValue"] == "ready"
        assert "mapValue" in fields["resultRef"]
        revisions[number] = fields["revisionId"]["stringValue"]
    assert len(set(revisions.values())) == 3
    created = test["createTime"]
    ledger = emulator_json(FS + "/aiCreditLedger?pageSize=1000").get("documents", [])
    reservations = emulator_json(FS + "/aiCreditReservations?pageSize=1000").get("documents", [])
    late_ledger = [doc["name"] for doc in ledger if doc.get("createTime", "") > created
        and field(doc, "uid") == UID]
    late_reservations = [doc["name"] for doc in reservations if doc.get("createTime", "") > created
        and field(doc, "uid") == UID]
    assert not late_ledger and not late_reservations, {"ledger": late_ledger,
        "reservations": late_reservations}
    result = {"testId": setup["testId"], "studentId": setup["studentId"],
        "status": "submitted", "speakingRevisionIds": revisions,
        "newCreditLedgerEntries": 0, "newCreditReservations": 0}
    (EVIDENCE / "entrance-submitted-records.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def verify_crm_result(browser, width):
    setup = json.loads((EVIDENCE / "entrance-setup-private.json").read_text(encoding="utf-8"))
    parsed = urlparse(setup["resultLink"])
    context = browser.new_context(viewport={"width": width, "height": 844 if width == 390 else 900},
        accept_downloads=True)
    page = context.new_page()
    page.route("**/*", block_production_firebase)
    login(page)
    responses = []
    firebase_hosts = []
    page.on("response", lambda response: responses.append({"status": response.status,
        "path": urlparse(response.url).path}) if "/api/admin/entrance-tests/" in response.url else None)
    page.on("request", lambda request: firebase_hosts.append(urlparse(request.url).netloc)
        if ("firestore" in request.url or "identitytoolkit" in request.url)
        and urlparse(request.url).netloc != "www.gstatic.com" else None)
    page.goto(BASE + parsed.path + "?" + parsed.query, wait_until="domcontentloaded")
    page.locator(".crm-v3-token").first.wait_for(state="visible", timeout=30000)
    assert page.evaluate("() => firebase.app().options.projectId") == PROJECT
    assert page.locator(".crm-result-question[data-question-id^='speaking_q']").count() == 3
    assert page.locator(".crm-v3-syllable").count() > 0
    page.evaluate("""() => {
      const coordinator=window.SegmentPlaybackCoordinator.defaultCoordinator;
      window.__crmPlayObservations=[];
      const original=coordinator.playSampleSpan.bind(coordinator);
      coordinator.playSampleSpan=(args)=>{
        window.__crmPlayObservations.push({startSample:args.span.startSample,
          endSample:args.span.endSample, sampleRate:args.buffer.sampleRate,
          bufferLength:args.buffer.length, token:coordinator.activeToken});
        return original(args);
      };
    }""")
    page.locator(".crm-v3-token[data-v3-start]").first.click()
    page.wait_for_function("() => window.__crmPlayObservations.length >= 1", timeout=30000)
    page.locator(".crm-v3-syllable[data-v3-start]").first.click()
    page.wait_for_function("() => window.__crmPlayObservations.length >= 2", timeout=30000)
    spans = page.evaluate("window.__crmPlayObservations")
    assert all(span["sampleRate"] == 16000 and
        0 <= span["startSample"] < span["endSample"] <= span["bufferLength"] for span in spans)
    assert spans[1]["token"] > spans[0]["token"]
    assert any(call["status"] == 200 and "/canonical-audio" in call["path"] for call in responses)
    assert not any("/audio-url" in call["path"] for call in responses)
    assert all(host in ("127.0.0.1:18080", "127.0.0.1:19099", "localhost:18080", "localhost:19099")
        for host in firebase_hosts), firebase_hosts
    page.screenshot(path=str(EVIDENCE / f"crm-result-{width}.png"), full_page=True)
    with page.expect_download(timeout=120000) as pdf_info:
        page.locator("#crm-export-pdf-btn").click()
    download = pdf_info.value
    pdf_path = EVIDENCE / f"crm-result-{width}.pdf"
    download.save_as(str(pdf_path))
    assert pdf_path.stat().st_size > 1000
    assert pdf_path.read_bytes()[:4] == b"%PDF"
    result = {"testId": setup["testId"], "viewportWidth": width,
        "wordCount": page.locator(".crm-v3-token").count(),
        "syllableCount": page.locator(".crm-v3-syllable").count(),
        "sampleSpans": spans, "pdfBytes": pdf_path.stat().st_size,
        "firebaseDataHosts": sorted(set(firebase_hosts)), "requests": responses}
    (EVIDENCE / f"crm-result-{width}-records.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    context.close()
    return result


def verify_saved_history(browser, name):
    info = {
        "rs": ("repeat_sentence", "speak", 390),
        "ra": ("read_aloud", "read-aloud", 1440),
        "di": ("describe_image", "describe-image", 390),
        "rl": ("retell_lecture", "notes", 390),
        "rts": ("respond_to_situation", "rts", 1440),
        "sgd": ("summarize_group_discussion", "sgd", 390),
    }
    _, mode, width = info[name]
    record = json.loads((EVIDENCE / f"{name}-records.json").read_text(encoding="utf-8"))
    assessment_id = record["assessmentId"]
    context = browser.new_context(viewport={"width": width, "height": 844 if width == 390 else 900})
    page = context.new_page()
    page.route("**/*", block_production_firebase)
    login(page)
    page.locator(f"#mode-btn-{mode}").click()
    try:
        page.locator("#tutorial-overlay.active").wait_for(state="visible", timeout=5000)
        page.locator("#tutorial-skip").click()
    except PlaywrightTimeoutError:
        pass
    panel = page.locator(f"#mode-{mode}")
    panel.locator(".pte-attempts__scope button").nth(1).wait_for(state="visible", timeout=30000)
    panel.locator(".pte-attempts__scope button").nth(1).click()
    panel.locator(".pte-attempts__row").first.wait_for(state="visible", timeout=30000)
    with page.expect_response(lambda response: "/api/ai-scoring/assessments/" + assessment_id in response.url,
        timeout=30000) as result_response:
        panel.locator(".pte-attempts__row").first.get_by_role("button", name="Open feedback").click()
    assert result_response.value.ok
    review = page.locator(".pte-attempt-review-v3")
    review.locator("[data-occurrence-id]").first.wait_for(state="visible", timeout=30000)
    assert review.locator(".word-token").count() > 0
    assert review.locator(".syllable-chip").count() > 0
    if name in ("di", "rts", "sgd", "rl"):
        assert "Completeness unavailable" in review.inner_text(), "Open-response null completeness was hidden"
    page.evaluate("""() => {
      const coordinator=window.SegmentPlaybackCoordinator.defaultCoordinator;
      window.__v3PlayObservations=[];
      const original=coordinator.playSampleSpan.bind(coordinator);
      coordinator.playSampleSpan=(args)=>{
        window.__v3PlayObservations.push({startSample:args.span.startSample,
          endSample:args.span.endSample, sampleRate:args.buffer.sampleRate,
          bufferLength:args.buffer.length, token:coordinator.activeToken});
        return original(args);
      };
    }""")
    audio_responses = []
    page.on("response", lambda response: audio_responses.append(response.status)
        if "/api/ai-scoring/audio/" in response.url else None)
    review.locator(".word-token").first.click()
    page.wait_for_function("() => window.__v3PlayObservations.length >= 1", timeout=30000)
    review.locator(".syllable-chip").first.click()
    page.wait_for_function("() => window.__v3PlayObservations.length >= 2", timeout=30000)
    spans = page.evaluate("window.__v3PlayObservations")
    assert all(span["sampleRate"] == 16000 and
        0 <= span["startSample"] < span["endSample"] <= span["bufferLength"] for span in spans)
    assert spans[1]["token"] > spans[0]["token"], spans
    assert 200 in audio_responses, audio_responses
    page.screenshot(path=str(EVIDENCE / f"{name}-history-{'mobile' if width == 390 else 'desktop'}.png"),
        full_page=True)
    evidence = {"mode": name, "assessmentId": assessment_id,
        "wordCount": review.locator(".word-token").count(),
        "syllableCount": review.locator(".syllable-chip").count(),
        "canonicalAudioStatuses": audio_responses, "sampleSpans": spans}
    (EVIDENCE / f"{name}-history-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    context.close()
    return evidence


def verify_rl_config(browser):
    expected = os.environ.get("BEL_V3_EXPECT_RL", "1") == "1"
    # Start with the opposite URL preference, then require the real server
    # response to replace it. This verifies both true and false settings.
    query = "?rlSpoken=0" if expected else "?rlSpoken=1"
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.route("**/*", block_production_firebase)
    page.goto(BASE + "/" + query, wait_until="domcontentloaded", timeout=60000)
    config = page.request.get(BASE + "/api/config").json()
    assert config["config"]["projectId"] == PROJECT
    assert config["features"]["rlSpokenAssessment"] is expected
    page.wait_for_function("expected => window.PteShellConfig?.rlSpokenAssessment === expected",
        arg=expected, timeout=30000)
    result = {"serverEnabled": expected, "browserEnabled": page.evaluate(
        "() => window.PteShellConfig.rlSpokenAssessment")}
    (EVIDENCE / f"rl-config-{'on' if expected else 'off'}.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8")
    page.close()
    return result


def verify_audio_authorization(browser):
    record = json.loads((EVIDENCE / "di-records.json").read_text(encoding="utf-8"))
    job = emulator_json(FS + "/aiScoringJobs/" + record["assessmentId"])
    audio_id = field(job, "audioId")
    assert audio_id and re.fullmatch(r"aud-[0-9a-f]{40}", audio_id)
    page = browser.new_page()
    page.route("**/*", block_production_firebase)
    login(page)
    owner_token = page.evaluate("() => window.__FIREBASE_INTERNAL__.auth.currentUser.getIdToken()")
    path = BASE + "/api/ai-scoring/audio/" + audio_id
    owner = page.request.get(path, headers={"Authorization": "Bearer " + owner_token})
    anonymous = page.request.get(path)
    invalid = page.request.get(BASE + "/api/ai-scoring/audio/not-an-audio-id",
        headers={"Authorization": "Bearer " + owner_token})
    missing = page.request.get(BASE + "/api/ai-scoring/audio/aud-" + "0" * 40,
        headers={"Authorization": "Bearer " + owner_token})
    signup = page.request.post("http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo",
        data={"email": "v3-other-" + uuid.uuid4().hex[:12] + "@example.test",
            "password": "DemoAudio123!", "returnSecureToken": True})
    assert signup.ok
    other_token = signup.json()["idToken"]
    cross_user = page.request.get(path, headers={"Authorization": "Bearer " + other_token})
    assert owner.status == 200 and owner.headers.get("content-type", "").startswith("audio/wav")
    assert owner.body()[:4] == b"RIFF"
    assert anonymous.status == 401
    assert invalid.status == 400
    assert missing.status == 404
    assert cross_user.status == 404
    deleting_id = "aud-" + uuid.uuid4().hex + "00000000"
    deleting = {"fields": {"uid": {"stringValue": UID},
        "status": {"stringValue": "deleting"},
        "attemptId": {"stringValue": "retired-demo-attempt"}}}
    req = Request(FS + "/aiScoringAudio/" + deleting_id,
        data=json.dumps(deleting).encode(), method="PATCH",
        headers={"Authorization": "Bearer owner", "Content-Type": "application/json"})
    with urlopen(req, timeout=20) as response:
        assert response.status == 200
    retired = page.request.get(BASE + "/api/ai-scoring/audio/" + deleting_id,
        headers={"Authorization": "Bearer " + owner_token})
    assert retired.status == 410
    evidence = {"audioId": audio_id, "ownerStatus": owner.status,
        "wavBytes": len(owner.body()), "anonymousStatus": anonymous.status,
        "crossUserStatus": cross_user.status, "invalidIdStatus": invalid.status,
        "missingIdStatus": missing.status, "deletingStatus": retired.status}
    (EVIDENCE / "audio-authorization-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    page.close()
    return evidence


def verify_persisted_practice_records():
    results = []
    for name in ("ra", "rs", "di", "rts", "sgd"):
        recorded = json.loads((EVIDENCE / f"{name}-records.json").read_text(encoding="utf-8"))
        assessment_id = recorded["assessmentId"]
        job = emulator_json(FS + "/aiScoringJobs/" + assessment_id)
        quote_doc = emulator_json(FS + "/aiCreditQuotes/" + field(job, "quoteId"))
        reservation = emulator_json(FS + "/aiCreditReservations/" + assessment_id)
        capture = emulator_json(FS + "/aiCreditLedger/" + assessment_id + ":capture")
        attempt = emulator_json(FS + "/speakingAttempts/" + field(job, "attemptId"))
        asset = emulator_json(FS + "/aiScoringAudio/" + field(job, "audioId"))
        assert field(job, "status") == "ready"
        assert field(quote_doc, "state") == "consumed"
        assert field(reservation, "status") == "captured"
        assert field(capture, "type") == "capture"
        assert int(field(capture, "credits", "integerValue")) == int(field(reservation, "credits", "integerValue"))
        assert field(attempt, "v3AssessmentId") == assessment_id
        assert field(attempt, "v3AudioId") == field(job, "audioId")
        assert field(asset, "status") == "active"
        ref = job["fields"]["resultRef"]["mapValue"]["fields"]
        result_path = ref["path"]["stringValue"]
        result_generation = ref["generation"]["stringValue"]
        result_hash = ref["sha256"]["stringValue"]
        object_url = STORAGE + "/v0/b/" + PROJECT + ".appspot.com/o/" + quote(result_path, safe="")
        metadata = emulator_json(object_url)
        assert str(metadata["generation"]) == result_generation
        media_request = Request(object_url + "?alt=media&generation=" + result_generation,
            headers={"Authorization": "Bearer owner"})
        with urlopen(media_request, timeout=20) as response:
            result_bytes = response.read()
        assert hashlib.sha256(result_bytes).hexdigest() == result_hash
        assert json.loads(result_bytes)["schemaVersion"] == "bel.speech.v3"
        results.append({"mode": name, "assessmentId": assessment_id,
            "attemptId": field(job, "attemptId"), "creditsCaptured": int(field(capture, "credits", "integerValue")),
            "resultGeneration": result_generation, "resultSha256": result_hash})
    (EVIDENCE / "practice-persistence-records.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return {"verifiedModes": len(results), "records": results}


def verify_deadline_recovery():
    assessment_id = "asmt-aba72849622f84f5c10acdfa"
    job = emulator_json(FS + "/aiScoringJobs/" + assessment_id)
    reservation = emulator_json(FS + "/aiCreditReservations/" + assessment_id)
    attempt = emulator_json(FS + "/speakingAttempts/" + field(job, "attemptId"))
    release = emulator_json(FS + "/aiCreditLedger/" + assessment_id + ":release")
    wallet = emulator_json(FS + "/aiCreditAccounts/" + UID)
    assert field(job, "status") == "failed"
    assert field(job, "error") == "JOB_DEADLINE_EXPIRED"
    assert field(reservation, "status") == "released"
    assert field(attempt, "v3AssessmentState") == "failed"
    assert field(release, "type") == "release"
    try:
        emulator_json(FS + "/aiScoringOutbox/" + assessment_id)
    except HTTPError as error:
        assert error.code == 404
    else:
        raise AssertionError("Expired outbox was not removed")
    baseline_path = EVIDENCE / "deadline-recovery-records.json"
    evidence = {"assessmentId": assessment_id, "jobStatus": "failed",
        "reservationStatus": "released", "archiveStatus": "failed",
        "outboxRemoved": True, "releaseLedgerUpdateTime": release["updateTime"],
        "walletSpentCredits": field(wallet, "spentCredits", "integerValue"),
        "walletReservedCredits": field(wallet, "reservedCredits", "integerValue")}
    if baseline_path.exists():
        previous = json.loads(baseline_path.read_text(encoding="utf-8"))
        assert evidence == previous, {"before": previous, "after": evidence}
    else:
        baseline_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    return evidence


def run_repeat_sentence(browser, cancel_only=False, failure_mode=None):
    wallet_before = emulator_json(FS + "/aiCreditAccounts/" + UID)
    before_spent = int(field(wallet_before, "spentCredits", "integerValue") or 0)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.route("**/*", block_production_firebase)
    calls = []
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)[:400]))
    page.on("console", lambda message: errors.append(message.text[:400]) if message.type == "error" else None)
    page.on("response", lambda response: calls.append({
        "status": response.status,
        "path": urlparse(response.url).path
    }) if "/api/ai-scoring/" in response.url or "/api/practice-attempts/" in response.url else None)
    if failure_mode == "dropped":
        page.route("**/api/ai-scoring/quotes", lambda route: route.abort())
    login(page)
    page.locator("#mode-btn-speak").click()
    page.locator("#spc-picker-speak").wait_for(state="visible", timeout=30000)
    try:
        page.locator("#tutorial-overlay.active").wait_for(state="visible", timeout=7000)
        page.locator("#tutorial-skip").click()
    except PlaywrightTimeoutError:
        pass
    page.locator("#spc-picker-speak").click()
    page.get_by_placeholder("Search by ID, title, or prompt…").fill("215")
    page.locator('li.spc-sheet-item[data-id="215"]').click()
    page.get_by_text("Next question", exact=True).click()
    page.locator("#speak-pte-stop").wait_for(state="visible", timeout=30000)
    page.wait_for_timeout(3000)
    page.locator("#speak-pte-stop").click()
    page.locator("#check-btn-speak").wait_for(state="visible", timeout=20000)
    page.locator("#check-btn-speak").click()
    if failure_mode:
        before_reservations = len(emulator_json(FS + "/aiCreditReservations?pageSize=1000").get("documents", []))
        page.wait_for_timeout(4500)
        assert not page.locator("#ai-credit-btn-confirm:visible").count()
        assert not any("/confirm" in call["path"] for call in calls)
        if failure_mode == "disabled":
            assert any(call["path"].endswith("/quotes") and call["status"] == 503 for call in calls)
        if failure_mode == "shadow":
            assert any(call["path"].endswith("/quotes") and call["status"] == 200 for call in calls)
        after_reservations = len(emulator_json(FS + "/aiCreditReservations?pageSize=1000").get("documents", []))
        wallet_after_failure = emulator_json(FS + "/aiCreditAccounts/" + UID)
        assert after_reservations == before_reservations
        assert int(field(wallet_after_failure, "spentCredits", "integerValue") or 0) == before_spent
        page.screenshot(path=str(EVIDENCE / f"rs-{failure_mode}-closed-desktop.png"), full_page=True)
        evidence = {"mode": "repeat_sentence", "failureMode": failure_mode,
            "reservationsCreated": 0, "creditsCaptured": 0, "requests": calls}
        (EVIDENCE / f"rs-{failure_mode}-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        context.close()
        return {**evidence, "attemptId": None, "assessmentId": None}
    page.get_by_role("button", name=re.compile(r"^Confirm")).wait_for(state="visible", timeout=20000)
    page.screenshot(path=str(EVIDENCE / "rs-consent-desktop.png"), full_page=True)
    if cancel_only:
        before_reservations = len(emulator_json(FS + "/aiCreditReservations?pageSize=1000").get("documents", []))
        page.locator("#ai-credit-btn-cancel").click()
        page.wait_for_timeout(800)
        after_reservations = len(emulator_json(FS + "/aiCreditReservations?pageSize=1000").get("documents", []))
        wallet_after_cancel = emulator_json(FS + "/aiCreditAccounts/" + UID)
        assert after_reservations == before_reservations
        assert int(field(wallet_after_cancel, "spentCredits", "integerValue") or 0) == before_spent
        assert not any("/assessments/confirm" in call["path"] for call in calls)
        page.screenshot(path=str(EVIDENCE / "rs-consent-canceled-desktop.png"), full_page=True)
        evidence = {"mode": "repeat_sentence", "attemptId": None, "assessmentId": None,
            "creditsCaptured": 0, "reservationsCreated": 0,
            "walletBeforeSpent": before_spent,
            "walletAfterSpent": int(field(wallet_after_cancel, "spentCredits", "integerValue") or 0),
            "requests": calls}
        (EVIDENCE / "rs-consent-canceled-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        context.close()
        return evidence
    page.get_by_role("button", name=re.compile(r"^Confirm")).click()
    page.wait_for_function("() => window.lastRepeatSentenceAssessment?.schemaVersion === 'bel.speech.v3'", timeout=120000)
    page.wait_for_function("() => document.querySelector('#mode-speak .pte-dock')?.innerText.includes('Saved to Previous attempts')", timeout=20000)
    page.screenshot(path=str(EVIDENCE / "rs-result-desktop.png"), full_page=True)
    assessment_urls = [call["path"] for call in calls if "/api/ai-scoring/assessments/" in call["path"]]
    assert assessment_urls
    assessment_id = assessment_urls[-1].rsplit("/", 1)[-1]
    job = emulator_json(FS + "/aiScoringJobs/" + assessment_id)
    reservation = emulator_json(FS + "/aiCreditReservations/" + assessment_id)
    capture = emulator_json(FS + "/aiCreditLedger/" + assessment_id + ":capture")
    wallet_after = emulator_json(FS + "/aiCreditAccounts/" + UID)
    assert field(job, "status") == "ready"
    assert field(reservation, "status") == "captured"
    assert field(capture, "type") == "capture"
    assert int(field(wallet_after, "spentCredits", "integerValue")) - before_spent == 1
    attempt_id = field(job, "attemptId")
    attempt = emulator_json(FS + "/speakingAttempts/" + attempt_id)
    assert field(attempt, "v3AssessmentId") == assessment_id
    assert field(attempt, "v3AssessmentState") == "ready"
    assert field(attempt, "status") == "submitted"
    assert attempt["fields"]["resultSnapshot"].get("mapValue")
    result_ref = job["fields"]["resultRef"]["mapValue"]["fields"]
    result_path = result_ref["path"]["stringValue"]
    metadata = emulator_json(STORAGE + "/v0/b/" + PROJECT + ".appspot.com/o/" + quote(result_path, safe=""))
    assert str(metadata["generation"]) == result_ref["generation"]["stringValue"]
    assert any(call["path"] == "/api/ai-scoring/audio" and call["status"] == 200 for call in calls)
    assert any(call["path"] == "/api/ai-scoring/quotes" and call["status"] == 200 for call in calls)
    assert any(call["status"] == 202 and call["path"].endswith("/confirm") for call in calls)
    assert all(call["status"] < 400 for call in calls)
    evidence = {"mode": "repeat_sentence", "attemptId": attempt_id,
        "assessmentId": assessment_id, "storageGeneration": metadata["generation"],
        "creditsCaptured": 1, "walletBeforeSpent": before_spent,
        "walletAfterSpent": int(field(wallet_after, "spentCredits", "integerValue")),
        "requests": calls}
    (EVIDENCE / "rs-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    context.close()
    return evidence


def run_read_aloud(browser):
    wallet_before = emulator_json(FS + "/aiCreditAccounts/" + UID)
    before_spent = int(field(wallet_before, "spentCredits", "integerValue") or 0)
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.route("**/*", block_production_firebase)
    calls = []
    browser_errors = []
    page.on("console", lambda message: browser_errors.append(message.text[:300]) if message.type == "error" else None)
    page.on("pageerror", lambda error: browser_errors.append(str(error)[:300]))
    page.on("response", lambda response: calls.append({
        "status": response.status, "path": urlparse(response.url).path
    }) if "/api/ai-scoring/" in response.url or "/api/practice-attempts/" in response.url else None)
    login(page)
    page.locator("#mode-btn-read-aloud").click()
    try:
        page.locator("#tutorial-overlay.active").wait_for(state="visible", timeout=7000)
        page.locator("#tutorial-skip").click()
    except PlaywrightTimeoutError:
        pass
    page.locator("#spc-picker-read-aloud").click()
    page.get_by_placeholder("Search by ID, title, or prompt…").fill("Industrial Revolution")
    page.locator('li.spc-sheet-item[data-id="546"]').click()
    assert page.evaluate("window.ReadAloudMode?.currentQuestionId") == "150"
    page.locator("#ra-record-btn").click()
    page.locator("#ra-stop-btn").wait_for(state="visible", timeout=20000)
    page.wait_for_timeout(22000)
    page.locator("#ra-stop-btn").click()
    page.locator("#ra-check-btn").wait_for(state="visible", timeout=20000)
    page.locator("#ra-check-btn").click()
    try:
        page.get_by_role("button", name=re.compile(r"^Confirm")).wait_for(state="visible", timeout=30000)
    except PlaywrightTimeoutError:
        page.screenshot(path=str(EVIDENCE / "ra-no-consent-mobile.png"), full_page=True)
        print(json.dumps({"raBeforeConsent": page.locator("body").inner_text()[-3000:], "calls": calls, "browserErrors": browser_errors}), flush=True)
        raise
    page.screenshot(path=str(EVIDENCE / "ra-consent-mobile.png"), full_page=True)
    page.get_by_role("button", name=re.compile(r"^Confirm")).click()
    page.wait_for_function("() => window.ReadAloudMode?.state === 'RESULTS'", timeout=180000)
    page.screenshot(path=str(EVIDENCE / "ra-result-mobile.png"), full_page=True)
    assessment_urls = [call["path"] for call in calls if "/api/ai-scoring/assessments/" in call["path"]]
    assert assessment_urls
    assessment_id = assessment_urls[-1].rsplit("/", 1)[-1]
    job = emulator_json(FS + "/aiScoringJobs/" + assessment_id)
    reservation = emulator_json(FS + "/aiCreditReservations/" + assessment_id)
    wallet_after = emulator_json(FS + "/aiCreditAccounts/" + UID)
    assert field(job, "status") == "ready"
    assert field(reservation, "status") == "captured"
    spent = int(field(wallet_after, "spentCredits", "integerValue")) - before_spent
    assert spent == 6, spent
    attempt_id = field(job, "attemptId")
    attempt = emulator_json(FS + "/speakingAttempts/" + attempt_id)
    assert field(attempt, "v3AssessmentId") == assessment_id
    evidence = {"mode": "read_aloud", "attemptId": attempt_id,
        "assessmentId": assessment_id, "creditsCaptured": spent,
        "walletBeforeSpent": before_spent,
        "walletAfterSpent": int(field(wallet_after, "spentCredits", "integerValue")),
        "requests": calls}
    (EVIDENCE / "ra-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    context.close()
    return evidence


def run_describe_image(browser, cancel_only=False):
    before = int(field(emulator_json(FS + "/aiCreditAccounts/" + UID), "spentCredits", "integerValue") or 0)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.route("**/*", block_production_firebase)
    calls = []
    errors = []
    page.on("response", lambda response: calls.append({"status": response.status, "path": urlparse(response.url).path})
        if "/api/ai-scoring/" in response.url or "/api/practice-attempts/" in response.url else None)
    page.on("console", lambda message: errors.append(message.text[:400]) if message.type == "error" else None)
    login(page)
    page.locator("#mode-btn-describe-image").click()
    try:
        page.locator("#tutorial-overlay.active").wait_for(state="visible", timeout=7000)
        page.locator("#tutorial-skip").click()
    except PlaywrightTimeoutError:
        pass
    page.locator("#di-image-container img").wait_for(state="visible", timeout=30000)
    assert page.locator("#di-image-container img").evaluate("e => e.complete && e.naturalWidth > 0")
    page.locator("#di-record-btn").click()
    page.locator("#di-stop-btn").wait_for(state="visible", timeout=20000)
    page.wait_for_timeout(5500)
    page.locator("#di-stop-btn").click()
    page.locator("#di-submit-btn").wait_for(state="visible", timeout=20000)
    page.locator("#di-submit-btn").click()
    try:
        page.get_by_role("button", name=re.compile(r"^Confirm")).wait_for(state="visible", timeout=30000)
    except PlaywrightTimeoutError:
        page.screenshot(path=str(EVIDENCE / "di-no-consent-desktop.png"), full_page=True)
        print(json.dumps({"diBeforeConsent": page.locator("body").inner_text()[-2000:], "calls": calls, "errors": errors[-12:]}), flush=True)
        raise
    page.screenshot(path=str(EVIDENCE / "di-consent-desktop.png"), full_page=True)
    if cancel_only:
        before_reservations = len(emulator_json(FS + "/aiCreditReservations?pageSize=1000").get("documents", []))
        page.locator("#ai-credit-btn-cancel").click()
        page.wait_for_timeout(800)
        after_reservations = len(emulator_json(FS + "/aiCreditReservations?pageSize=1000").get("documents", []))
        wallet_after_cancel = emulator_json(FS + "/aiCreditAccounts/" + UID)
        assert after_reservations == before_reservations
        assert int(field(wallet_after_cancel, "spentCredits", "integerValue") or 0) == before
        assert not any("/assessments/confirm" in call["path"] for call in calls)
        page.screenshot(path=str(EVIDENCE / "di-consent-canceled-desktop.png"), full_page=True)
        evidence = {"mode": "describe_image", "attemptId": None, "assessmentId": None,
            "creditsCaptured": 0, "reservationsCreated": 0,
            "walletBeforeSpent": before,
            "walletAfterSpent": int(field(wallet_after_cancel, "spentCredits", "integerValue") or 0),
            "requests": calls}
        (EVIDENCE / "di-consent-canceled-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        context.close()
        return evidence
    page.get_by_role("button", name=re.compile(r"^Confirm")).click()
    page.wait_for_function("() => !!document.querySelector('#di-transcript [data-occurrence-id]')", timeout=180000)
    assert page.locator(".reference-confirmation-box").count() == 0, "V3 asked for a word choice"
    page.screenshot(path=str(EVIDENCE / "di-result-desktop.png"), full_page=True)
    assessment_urls = [call["path"] for call in calls if "/api/ai-scoring/assessments/" in call["path"]]
    assert assessment_urls
    assessment_id = assessment_urls[-1].rsplit("/", 1)[-1]
    job = emulator_json(FS + "/aiScoringJobs/" + assessment_id)
    reservation = emulator_json(FS + "/aiCreditReservations/" + assessment_id)
    after = int(field(emulator_json(FS + "/aiCreditAccounts/" + UID), "spentCredits", "integerValue"))
    credits = int(field(reservation, "credits", "integerValue"))
    assert field(job, "status") == "ready"
    assert field(reservation, "status") == "captured"
    assert field(reservation, "packageId") == "speaking.acoustic.transcript.v1"
    assert after - before == credits
    attempt_id = field(job, "attemptId")
    attempt = emulator_json(FS + "/speakingAttempts/" + attempt_id)
    evidence = {"mode": "describe_image", "attemptId": attempt_id,
        "assessmentId": assessment_id, "creditsCaptured": credits,
        "walletBeforeSpent": before, "walletAfterSpent": after,
        "archiveAssessmentId": field(attempt, "v3AssessmentId"),
        "archiveHasResultSnapshot": "mapValue" in attempt["fields"].get("resultSnapshot", {}),
        "requests": calls}
    (EVIDENCE / "di-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    assert evidence["archiveAssessmentId"] == assessment_id
    assert evidence["archiveHasResultSnapshot"], "Describe Image history lost its result snapshot"
    context.close()
    return evidence


def run_respond_to_situation(browser):
    before = int(field(emulator_json(FS + "/aiCreditAccounts/" + UID), "spentCredits", "integerValue") or 0)
    context = browser.new_context(viewport={"width": 390, "height": 844})
    context.add_init_script("window.__PTE_TEST_TIME_SCALE = 0.05")
    page = context.new_page()
    page.route("**/*", block_production_firebase)
    calls = []
    errors = []
    page.on("response", lambda response: calls.append({"status": response.status, "path": urlparse(response.url).path})
        if "/api/ai-scoring/" in response.url or "/api/practice-attempts/" in response.url else None)
    page.on("console", lambda message: errors.append(message.text[:300]) if message.type == "error" else None)
    login(page)
    page.locator("#mode-btn-rts").click()
    try:
        page.locator("#tutorial-overlay.active").wait_for(state="visible", timeout=7000)
        page.locator("#tutorial-skip").click()
    except PlaywrightTimeoutError:
        pass
    page.locator("#rts-stop-btn").wait_for(state="visible", timeout=60000)
    page.wait_for_timeout(5500)
    page.locator("#rts-stop-btn").click()
    page.locator("#rts-submit-btn").wait_for(state="visible", timeout=20000)
    page.locator("#rts-submit-btn").click()
    page.locator("#rts-ai-score-btn").wait_for(state="visible", timeout=20000)
    page.locator("#rts-ai-score-btn").click()
    try:
        page.get_by_role("button", name=re.compile(r"^Confirm")).wait_for(state="visible", timeout=30000)
    except PlaywrightTimeoutError:
        page.screenshot(path=str(EVIDENCE / "rts-no-consent-mobile.png"), full_page=True)
        print(json.dumps({"rtsBeforeConsent": page.locator("body").inner_text()[-1800:], "calls": calls, "errors": errors[-12:]}), flush=True)
        raise
    page.screenshot(path=str(EVIDENCE / "rts-consent-mobile.png"), full_page=True)
    page.get_by_role("button", name=re.compile(r"^Confirm")).click()
    page.wait_for_function("() => !!document.querySelector('#rts-v3-transcript-disclosure [data-occurrence-id]')", timeout=180000)
    page.screenshot(path=str(EVIDENCE / "rts-result-mobile.png"), full_page=True)
    assessment_urls = [call["path"] for call in calls if "/api/ai-scoring/assessments/" in call["path"]]
    assert assessment_urls
    assessment_id = assessment_urls[-1].rsplit("/", 1)[-1]
    job = emulator_json(FS + "/aiScoringJobs/" + assessment_id)
    reservation = emulator_json(FS + "/aiCreditReservations/" + assessment_id)
    after = int(field(emulator_json(FS + "/aiCreditAccounts/" + UID), "spentCredits", "integerValue"))
    credits = int(field(reservation, "credits", "integerValue"))
    assert field(job, "status") == field(reservation, "status").replace("captured", "ready")
    assert field(reservation, "packageId") == "speaking.acoustic.transcript.v1"
    assert after - before == credits
    attempt_id = field(job, "attemptId")
    attempt = emulator_json(FS + "/speakingAttempts/" + attempt_id)
    evidence = {"mode": "respond_to_situation", "attemptId": attempt_id,
        "assessmentId": assessment_id, "creditsCaptured": credits,
        "walletBeforeSpent": before, "walletAfterSpent": after,
        "archiveAssessmentId": field(attempt, "v3AssessmentId"),
        "archiveHasResultSnapshot": "mapValue" in attempt["fields"].get("resultSnapshot", {}),
        "requests": calls}
    (EVIDENCE / "rts-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    assert evidence["archiveAssessmentId"] == assessment_id
    assert evidence["archiveHasResultSnapshot"]
    context.close()
    return evidence


def run_retell_lecture(browser):
    before = int(field(emulator_json(FS + "/aiCreditAccounts/" + UID), "spentCredits", "integerValue") or 0)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.add_init_script("window.__PTE_TEST_TIME_SCALE = 0.05")
    page = context.new_page()
    page.route("**/*", block_production_firebase)
    calls = []
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)[:400]))
    page.on("console", lambda message: errors.append(message.text[:400]) if message.type == "error" else None)
    page.on("response", lambda response: calls.append({"status": response.status,
        "path": urlparse(response.url).path}) if "/api/ai-scoring/" in response.url
        or "/api/practice-attempts/" in response.url else None)
    login(page)
    print("RL Chrome: authenticated", flush=True)
    page.locator("#mode-btn-notes").click(timeout=30000)
    print("RL Chrome: mode opened", flush=True)
    print("RL Chrome state: " + json.dumps(page.evaluate("""() => ({
      panelVisible: !!document.querySelector('#mode-notes')?.offsetParent,
      stagePresent: !!document.querySelector('#notes-pte-stage'),
      phase: window.TakeNotesMode?.getPtePhase?.(),
      modeModule: !!window.TakeNotesMode,
      shellEnabled: window.PteShellConfig?.enabled,
      rlEnabled: window.PteShellConfig?.rlSpokenAssessment,
      moduleMethods: Object.keys(window.TakeNotesMode || {}).slice(0, 12),
      entryStatus: document.querySelector('#notes-entry-status')?.textContent?.slice(0, 300),
      entryState: document.querySelector('#notes-entry-status')?.dataset.notesStatus,
      readyStatus: document.querySelector('#notes-loading-status')?.textContent?.slice(0, 300)
    })""")) + " errors=" + json.dumps(errors[-8:]), flush=True)
    try:
        page.locator("#tutorial-overlay.active").wait_for(state="visible", timeout=7000)
        page.locator("#tutorial-skip").click()
    except PlaywrightTimeoutError:
        pass
    page.locator("#notes-pte-stage").wait_for(state="visible", timeout=60000)
    print("RL Chrome: practice stage visible", flush=True)
    page.wait_for_function("() => window.TakeNotesMode?.getPtePhase?.() === 'prep'", timeout=180000)
    print("RL Chrome: recording preparation visible", flush=True)
    page.locator("#notes-user-input").fill("The speaker described the beach and the early departure.")
    page.locator("#notes-record-btn").click()
    page.locator("#notes-stop-btn").wait_for(state="visible", timeout=30000)
    page.wait_for_timeout(5500)
    page.locator("#notes-stop-btn").click()
    page.wait_for_function("() => window.TakeNotesMode?.getPtePhase?.() === 'complete'", timeout=30000)
    page.locator("#notes-submit-btn").click()
    page.locator("#rl-spoken-record-btn").wait_for(state="visible", timeout=60000)
    page.locator("#rl-spoken-record-btn").click()
    page.locator("#rl-spoken-stop-btn").wait_for(state="visible", timeout=30000)
    page.wait_for_timeout(5500)
    page.locator("#rl-spoken-stop-btn").click()
    page.locator("#rl-spoken-assess-btn").wait_for(state="visible", timeout=30000)
    page.locator("#rl-spoken-assess-btn").click()
    page.get_by_role("button", name=re.compile(r"^Confirm")).wait_for(state="visible", timeout=90000)
    page.screenshot(path=str(EVIDENCE / "rl-consent-desktop.png"), full_page=True)
    page.get_by_role("button", name=re.compile(r"^Confirm")).click()
    page.locator("#rl-spoken-disclosure-container [data-occurrence-id]").first.wait_for(
        state="visible", timeout=180000)
    page.screenshot(path=str(EVIDENCE / "rl-result-desktop.png"), full_page=True)
    assessment_urls = [call["path"] for call in calls if "/api/ai-scoring/assessments/" in call["path"]]
    assert assessment_urls
    assessment_id = assessment_urls[-1].rsplit("/", 1)[-1]
    job = emulator_json(FS + "/aiScoringJobs/" + assessment_id)
    reservation = emulator_json(FS + "/aiCreditReservations/" + assessment_id)
    after = int(field(emulator_json(FS + "/aiCreditAccounts/" + UID), "spentCredits", "integerValue"))
    credits = int(field(reservation, "credits", "integerValue"))
    assert field(job, "status") == "ready"
    assert field(reservation, "status") == "captured"
    assert after - before == credits
    attempt_id = field(job, "attemptId")
    page.wait_for_timeout(2000)
    attempt = emulator_json(FS + "/speakingAttempts/" + attempt_id)
    evidence = {"mode": "retell_lecture", "attemptId": attempt_id,
        "assessmentId": assessment_id, "creditsCaptured": credits,
        "walletBeforeSpent": before, "walletAfterSpent": after,
        "archiveAssessmentId": field(attempt, "v3AssessmentId"), "requests": calls}
    (EVIDENCE / "rl-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    assert evidence["archiveAssessmentId"] == assessment_id
    context.close()
    return evidence


def run_group_discussion(browser):
    before = int(field(emulator_json(FS + "/aiCreditAccounts/" + UID), "spentCredits", "integerValue") or 0)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.add_init_script("window.__PTE_TEST_TIME_SCALE = 0.05")
    page = context.new_page()
    page.route("**/*", block_production_firebase)
    calls = []
    errors = []
    page.on("response", lambda response: calls.append({"status": response.status, "path": urlparse(response.url).path})
        if "/api/ai-scoring/" in response.url or "/api/practice-attempts/" in response.url else None)
    page.on("console", lambda message: errors.append(message.text[:300]) if message.type == "error" else None)
    login(page)
    page.locator("#mode-btn-sgd").click()
    try:
        page.locator("#tutorial-overlay.active").wait_for(state="visible", timeout=7000)
        page.locator("#tutorial-skip").click()
    except PlaywrightTimeoutError:
        pass
    page.locator("#sgd-stop-btn").wait_for(state="visible", timeout=60000)
    page.wait_for_timeout(5500)
    page.locator("#sgd-stop-btn").click()
    page.locator("#sgd-submit-btn").wait_for(state="visible", timeout=20000)
    page.locator("#sgd-submit-btn").click()
    page.locator("#sgd-v3-ai-score-btn").wait_for(state="visible", timeout=20000)
    page.locator("#sgd-v3-ai-score-btn").click()
    try:
        page.get_by_role("button", name=re.compile(r"^Confirm")).wait_for(state="visible", timeout=30000)
    except PlaywrightTimeoutError:
        page.screenshot(path=str(EVIDENCE / "sgd-no-consent-desktop.png"), full_page=True)
        print(json.dumps({"sgdBeforeConsent": page.locator("body").inner_text()[-1800:], "calls": calls, "errors": errors[-12:]}), flush=True)
        raise
    page.screenshot(path=str(EVIDENCE / "sgd-consent-desktop.png"), full_page=True)
    page.get_by_role("button", name=re.compile(r"^Confirm")).click()
    page.wait_for_function("() => !!document.querySelector('#sgd-v3-transcript-disclosure [data-occurrence-id]')", timeout=180000)
    page.screenshot(path=str(EVIDENCE / "sgd-result-desktop.png"), full_page=True)
    assessment_urls = [call["path"] for call in calls if "/api/ai-scoring/assessments/" in call["path"]]
    assert assessment_urls
    assessment_id = assessment_urls[-1].rsplit("/", 1)[-1]
    job = emulator_json(FS + "/aiScoringJobs/" + assessment_id)
    reservation = emulator_json(FS + "/aiCreditReservations/" + assessment_id)
    after = int(field(emulator_json(FS + "/aiCreditAccounts/" + UID), "spentCredits", "integerValue"))
    credits = int(field(reservation, "credits", "integerValue"))
    assert field(job, "status") == "ready"
    assert field(reservation, "status") == "captured"
    assert after - before == credits
    attempt_id = field(job, "attemptId")
    attempt = emulator_json(FS + "/speakingAttempts/" + attempt_id)
    evidence = {"mode": "summarize_group_discussion", "attemptId": attempt_id,
        "assessmentId": assessment_id, "creditsCaptured": credits,
        "walletBeforeSpent": before, "walletAfterSpent": after,
        "archiveAssessmentId": field(attempt, "v3AssessmentId"),
        "archiveHasV3Snapshot": field(attempt, "resultSnapshot", "mapValue") is not None
            and "schemaVersion" in attempt["fields"]["resultSnapshot"]["mapValue"].get("fields", {}),
        "requests": calls}
    (EVIDENCE / "sgd-records.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    assert evidence["archiveAssessmentId"] == assessment_id
    assert evidence["archiveHasV3Snapshot"]
    context.close()
    return evidence


def main():
    assert FIXTURES.joinpath("rs215-16k.wav").is_file()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
            "--use-file-for-fake-audio-capture=" + str(FIXTURES / ("entrance" + sys.argv[1][-1] + "-16k.wav" if sys.argv[1].startswith("entrance-q") else "ra-16k.wav" if "ra" in sys.argv else "open-16k.wav" if any(mode in sys.argv[1] for mode in ("di", "rl", "rts", "sgd")) else "rs215-16k.wav"))
        ])
        try:
            result = verify_deadline_recovery() if sys.argv[1] == "deadline-recovery" else verify_persisted_practice_records() if sys.argv[1] == "persistence" else verify_audio_authorization(browser) if sys.argv[1] == "audio-authorization" else verify_rl_config(browser) if sys.argv[1] == "rl-config" else verify_crm_result(browser, 390 if sys.argv[1] == "crm-mobile" else 1440) if sys.argv[1].startswith("crm-") else verify_saved_history(browser, sys.argv[2]) if sys.argv[1] == "history" else verify_entrance_records() if sys.argv[1] == "entrance-records" else finish_entrance_test(browser) if sys.argv[1] == "entrance-finish" else resume_entrance_question_2(browser) if sys.argv[1] == "entrance-resume-q2" else run_entrance_question(browser, int(sys.argv[1][-1])) if sys.argv[1].startswith("entrance-q") else run_entrance_setup(browser) if "entrance-setup" in sys.argv else run_read_aloud(browser) if sys.argv[1] == "ra" else run_describe_image(browser, cancel_only=sys.argv[1] == "cancel-di") if sys.argv[1] in ("di", "cancel-di") else run_retell_lecture(browser) if sys.argv[1] == "rl" else run_respond_to_situation(browser) if sys.argv[1] == "rts" else run_group_discussion(browser) if sys.argv[1] == "sgd" else run_repeat_sentence(browser, cancel_only=sys.argv[1] == "cancel-rs", failure_mode=sys.argv[1].removeprefix("fail-rs-") if sys.argv[1].startswith("fail-rs-") else None)
            print(json.dumps(result if "entrance" in sys.argv[1] or sys.argv[1] in ("history", "audio-authorization", "persistence", "deadline-recovery", "rl-config") or sys.argv[1].startswith("crm-") else {key: result[key] for key in ("mode", "attemptId", "assessmentId", "creditsCaptured")}))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
