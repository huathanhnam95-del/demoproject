"""Opt-in paid native Chrome acceptance. Never imported by the normal test suite."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
from urllib.parse import urlparse
import wave

HERE = Path(__file__).resolve().parent
IMAGE_SCENARIOS = {'image', 'image-payment', 'image-ambiguous-date', 'image-adversarial'}


def pad_microphone_wav(raw_path, padded_path):
    """Keep offline speech intact while fake capture waits for relay readiness."""
    raw_path, padded_path = Path(raw_path), Path(padded_path)
    with wave.open(str(raw_path), 'rb') as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, 16000, 'NONE'):
            raise ValueError('Expected mono 16-bit 16 kHz PCM fixture')
        frames, rate = wav.getnframes(), wav.getframerate()
        if frames <= 0 or frames / rate + 7 > 55:
            raise ValueError('Padded synthetic microphone fixture must be at most 55 seconds')
        pcm = wav.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError('Truncated offline PCM fixture')
    leading, trailing = 5 * rate, 2 * rate
    with padded_path.open('xb') as output:
        with wave.open(output, 'wb') as wav:
            wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
            wav.writeframes(bytes(leading * 2) + pcm + bytes(trailing * 2))
    return {
        'raw': {'file': raw_path.name, 'sha256': hashlib.sha256(raw_path.read_bytes()).hexdigest(), 'durationSeconds': frames / rate},
        'padded': {'file': padded_path.name, 'sha256': hashlib.sha256(padded_path.read_bytes()).hexdigest(), 'durationSeconds': (leading + frames + trailing) / rate},
        'sampleRate': rate, 'leadingSilenceSeconds': 5, 'trailingSilenceSeconds': 2,
        'originalPcmOffsetFrames': leading, 'originalPcmSha256': hashlib.sha256(pcm).hexdigest()
    }


def url_evidence(value):
    """Only fixed routes; never persist credentials, query strings or fragments."""
    parsed = urlparse(value)
    known = {'/__native/login', '/crm-admin.html', '/index.html', '/api/admin/status', '/api/config'}
    return {'host': parsed.hostname, 'path': parsed.path if parsed.path in known else '[other]'}


def is_crm_page(value):
    return urlparse(value).path == '/crm-admin.html'


def expected_field(actual, expected, scenario):
    return actual == expected if scenario == 'image' else isinstance(actual, str) and actual.casefold() == expected.casefold()


def create_redactor(secrets):
    def redact(value):
        if isinstance(value, str):
            for secret in secrets:
                value = value.replace(secret, '[redacted]')
            return re.sub(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}", '[redacted-contact]', value, flags=re.I)[:16000]
        if isinstance(value, list):
            return [redact(item) for item in value]
        if isinstance(value, dict):
            return {key: redact(item) for key, item in value.items() if not re.search(r'^(token|dispatchToken|sendPermit|tokenHash|confirmationToken|ticket|ticketHash|secret|password|authorization)$|handle|signature|email|link', key, re.I)}
        return value
    return redact


def config(scenario):
    if os.environ.get('CRM_NATIVE_PAID_TEST') != 'true':
        raise RuntimeError('Paid native harness disabled; explicit CRM_NATIVE_PAID_TEST=true required')
    names = ['CRM_NATIVE_RUN_ID', 'CRM_NATIVE_OUTPUT_ROOT', 'CRM_NATIVE_NODE', 'CRM_NATIVE_HTTP_PORT',
             'CRM_NATIVE_EXPECTED_SHA', 'CRM_NATIVE_EMAIL', 'CRM_NATIVE_PASSWORD', 'CRM_NATIVE_CONTROL',
             'GCLOUD_PROJECT', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'CRM_NATIVE_MAX_FLASH_CALLS']
    names += [] if scenario in IMAGE_SCENARIOS else ['CRM_NATIVE_INSTRUCTION_VOICE', 'CRM_NATIVE_CONFIRMATION_VOICE']
    for name in names:
        if not os.environ.get(name):
            raise RuntimeError('Missing ' + name)
    run_id = os.environ['CRM_NATIVE_RUN_ID']
    if not re.fullmatch(r'[a-z][a-z0-9-]{7,31}', run_id):
        raise RuntimeError('Invalid unique run ID')
    out = Path(os.environ['CRM_NATIVE_OUTPUT_ROOT']) / run_id
    if out.exists() or not out.is_absolute():
        raise RuntimeError('New absolute external output required; no overwrite')
    env = dict(os.environ, CRM_NATIVE_SCENARIO=scenario)
    return out, env


def run(scenario):
    out, env = config(scenario)
    from image_cases import run_image_case, fixture_expectations, CONTACT, SCENARIOS as EXTRA_IMAGE_SCENARIOS
    # Fail before server startup or paid work when an offline voice is unavailable.
    if scenario not in IMAGE_SCENARIOS:
        installed = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
            'Add-Type -AssemblyName System.Speech; @((New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }) | ConvertTo-Json -Compress'],
            check=True, capture_output=True, text=True, timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        voices = json.loads(installed.stdout)
        if isinstance(voices, str):
            voices = [voices]
        for name in ['CRM_NATIVE_INSTRUCTION_VOICE', 'CRM_NATIVE_CONFIRMATION_VOICE']:
            if env[name] not in voices:
                raise RuntimeError('Requested offline voice unavailable: ' + name)
    # Gate above runs before importing Playwright or spawning anything.
    from playwright.sync_api import sync_playwright, expect
    # The server owns private-file resolution and sanitizes its provider evidence.
    # Never copy the private key into Python or a persisted browser profile.
    secrets = [value for value in [env.get('CRM_VOICE_GEMINI_API_KEY'), env.get('GEMINI_API_KEY'), env['CRM_NATIVE_PASSWORD'], env['CRM_NATIVE_CONTROL'], env['CRM_NATIVE_EMAIL']] if value]

    redact = create_redactor(secrets)

    def save(name, value):
        (out / name).write_text(json.dumps(redact(value), ensure_ascii=False, indent=2), encoding='utf-8')

    process = subprocess.Popen([env['CRM_NATIVE_NODE'], str(HERE / 'server.cjs')], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    base = 'http://127.0.0.1:' + env['CRM_NATIVE_HTTP_PORT']
    browser = None
    browser_handle = None
    results, ui_errors, http = [], [], []
    record_clarification = None
    transient_preview = {}
    timings = {'clock': 'monotonic', 'environment': 'loopback emulators; real provider',
               'syntheticMicrophone': scenario not in IMAGE_SCENARIOS, 'productionSloClaim': False}

    def control(name, post=False, payload=None):
        request = urllib.request.Request(base + '/__native/' + name, data=json.dumps(payload or {}).encode() if post else None,
                                         headers={'x-native-control': env['CRM_NATIVE_CONTROL'], 'content-type': 'application/json'})
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)

    def healthy():
        state = control('status')
        if state['failure']:
            capture_failure_ui()
            raise AssertionError('Paid run stopped: ' + state['failure']['code'])

    def capture_failure_ui():
        if browser and browser.pages:
            try:
                page = browser.pages[0]
                save('failure-ui.json', {'text': page.locator('#bel-chat-drawer').inner_text(timeout=1000)})
                page.screenshot(path=str(out / 'failure.png'), full_page=True,
                                mask=[page.locator('input'), page.get_by_text(CONTACT, exact=True), page.locator('img')])
            except Exception:
                pass

    def wait_for(predicate, seconds=75):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            healthy()
            value = predicate()
            if value:
                return value
            time.sleep(.25)
        capture_failure_ui()
        raise AssertionError('Acceptance condition timed out; no retry')

    def audio(label, text, voice):
        text_path, wav_path = out / (label + '.txt'), out / (label + '.wav')
        text_path.write_text(text, encoding='utf-8')
        subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(HERE / 'speech.ps1'),
                        '-TextFile', str(text_path), '-OutputFile', str(wav_path), '-Voice', voice],
                       check=True, timeout=45, capture_output=True,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        microphone_path = out / (label + '-microphone.wav')
        padding = pad_microphone_wav(wav_path, microphone_path)
        save(label + '-audio.json', {'text': text, 'voice': voice, 'source': 'offline System.Speech', **padding})
        return microphone_path, padding['padded']['durationSeconds']

    def response_seen(response):
        if '/api/admin/data-input/' not in response.url:
            return
        item = {'status': response.status, 'path': urlparse(response.url).path}
        try:
            item['body'] = response.json()
            if scenario == 'image-payment' and item['path'].endswith('/preview') and response.status == 200:
                transient_preview.clear()
                transient_preview.update({key: item['body'][key] for key in ['previewId', 'confirmationToken']})
        except Exception:
            item['body'] = 'Non-JSON response'
        http.append(redact(item))

    try:
        deadline = time.monotonic() + 45
        while not (out / 'ready.json').exists():
            if process.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError('Native assembly failed; inspect external startup-error.json')
            time.sleep(.2)
        ready = json.loads((out / 'ready.json').read_text(encoding='utf-8'))
        name = ready['fixtureName']
        instruction = (f'Create one new CRM lead named {name}. Set source to website. Set notes to Native acceptance created. Do not create a student.'
                       if scenario != 'edit' else
                       f'Find the existing CRM lead with exact name {name}. Change only its notes to Native acceptance edited. Do not create a new lead or student.')
        if scenario in IMAGE_SCENARIOS:
            image_file = out / 'enquiry.png'
            subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(HERE / 'image.ps1'), '-OutputFile', str(image_file), '-Case', scenario],
                           check=True, timeout=20, capture_output=True,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            save('image-fixture.json', {'source': 'offline System.Drawing', 'scenario': scenario, 'sha256': hashlib.sha256(image_file.read_bytes()).hexdigest(),
                                      **fixture_expectations(scenario, name)})
            speech_file, duration = None, 0
        else:
            speech_file, duration = audio('instruction', instruction, env['CRM_NATIVE_INSTRUCTION_VOICE'])
        expected_notes = 'Native image acceptance' if scenario == 'image' else 'Native acceptance edited' if scenario == 'edit' else 'Native acceptance created'
        with sync_playwright() as p:
            def open_chrome(wav_path):
                nonlocal browser, browser_handle
                storage = browser.storage_state() if browser else None
                if browser:
                    browser.close()
                    browser_handle.close()
                args = ['--autoplay-policy=no-user-gesture-required']
                if wav_path:
                    args += ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + str(wav_path) + '%noloop']
                browser_handle = p.chromium.launch(channel='chrome', headless=True, args=args)
                browser = browser_handle.new_context(storage_state=storage, permissions=['microphone'], viewport={'width': 1400, 'height': 1000})
                allowed = {'127.0.0.1', 'localhost', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'}
                browser.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname in allowed else route.abort())
                page = browser.pages[0] if browser.pages else browser.new_page()
                page.on('pageerror', lambda error: ui_errors.append(redact(str(error))))
                page.on('response', response_seen)
                navigation_events = []
                def record_navigation(kind, url, status=None):
                    if len(navigation_events) < 100:
                        navigation_events.append({'kind': kind, **url_evidence(url), 'status': status})
                page.on('requestfailed', lambda request: record_navigation('requestfailed', request.url))
                page.on('response', lambda response: record_navigation('response', response.url, response.status))
                try:
                    page.goto(base + '/__native/login', wait_until='domcontentloaded')
                    page.get_by_label('Email', exact=True).fill(env['CRM_NATIVE_EMAIL'])
                    page.get_by_label('Password', exact=True).fill(env['CRM_NATIVE_PASSWORD'])
                    page.get_by_role('button', name='Sign in locally', exact=True).click()
                    page.wait_for_url(is_crm_page, wait_until='domcontentloaded', timeout=30000)
                    page.locator('#bel-chat-launcher').click(timeout=30000)
                    drawer = page.locator('#bel-chat-drawer')
                    expect(drawer).to_be_visible()
                    return page, drawer
                except Exception:
                    # Capture while Playwright and Chrome are still alive.
                    details = {'url': url_evidence(page.url), 'events': navigation_events, 'authCode': None}
                    try:
                        status = page.locator('[role=status]').first
                        text = status.inner_text(timeout=1000) if status.count() else ''
                        details['authCode'] = text if re.fullmatch(r'auth/[a-z-]+', text) else None
                    except Exception:
                        pass
                    save('login-failure.json', details)
                    try:
                        page.screenshot(path=str(out / 'login-failure.png'), full_page=True, mask=[page.locator('input')])
                    except Exception:
                        pass
                    raise

            def speak(drawer, seconds):
                healthy()
                drawer.get_by_role('button', name='Start voice', exact=True).click()
                wait_for(lambda: drawer.get_by_text('Microphone on.', exact=True).is_visible(), 25)
                deadline = time.monotonic() + seconds + .5
                while time.monotonic() < deadline:
                    healthy()
                    time.sleep(.25)
                finished_at = time.monotonic()
                drawer.get_by_role('button', name='Finish speaking', exact=True).click()
                return finished_at

            page, drawer = open_chrome(speech_file)
            if scenario in EXTRA_IMAGE_SCENARIOS:
                try:
                    results.extend(run_image_case(scenario, page=page, drawer=drawer, ready=ready, image_file=image_file, out=out,
                                                  control=control, save=save, wait_for=wait_for, expect=expect, latest_preview=lambda: dict(transient_preview)))
                except Exception:
                    # Capture while Playwright is still alive, before its context exits.
                    try:
                        save('failure-ui.json', {'text': drawer.inner_text(timeout=1000)})
                        page.screenshot(path=str(out / 'failure.png'), full_page=True,
                                        mask=[page.locator('input'), page.get_by_text(CONTACT, exact=True), page.locator('img')])
                    except Exception as capture_error:
                        save('failure-capture.json', {'type': type(capture_error).__name__})
                    raise
                assert not ui_errors, 'Chrome page errors occurred'
                healthy()
                return
            if scenario == 'image':
                drawer.get_by_label('Image to attach', exact=True).set_input_files(str(image_file))
                drawer.get_by_role('button', name='Attach image', exact=True).click()
                use_image = drawer.get_by_role('button', name='Use image 1', exact=True)
                expect(use_image).to_be_enabled(timeout=30000)
                drawer.get_by_label('Instruction', exact=True).fill('Create one enquiry using exactly the three fields shown in this image. Do not create a student.')
                use_image.click()
                wait_for(lambda: drawer.get_by_label('Name', exact=True).count() == 1 and drawer.get_by_label('Name', exact=True).input_value() == name)
                assert not control('evidence')['leads']
                drawer.get_by_role('button', name='Review changes', exact=True).click()
            else:
                instruction_finished_at = speak(drawer, duration)
                if scenario == 'edit':
                    review_heading = drawer.get_by_role('heading', name='Review changes before saving', exact=True)
                    unresolved = drawer.get_by_text(re.compile(r'^(No matching record\.|Multiple records match\.|More matches exist\.)'))
                    wait_for(lambda: review_heading.is_visible() or unresolved.count() > 0 and unresolved.first.is_visible())
                    if not review_heading.is_visible():
                        # One explicit staff clarification, never guessed identity
                        # or a retry of a failed provider request.
                        lookup = drawer.locator('.crm-input-lookup')
                        expect(lookup).to_have_count(1)
                        prior_value = lookup.get_by_label('Exact value', exact=True).input_value()
                        unchanged = control('evidence')
                        assert not unchanged['receipts'] and len(unchanged['leads']) == 1
                        assert unchanged['leads'][0]['id'] == ready['seedId']
                        assert unchanged['leads'][0]['notes'] == 'Before native edit'
                        lookup.get_by_label('Search field', exact=True).select_option('name')
                        lookup.get_by_label('Exact value', exact=True).fill(name)
                        lookup.get_by_role('button', name='Search records', exact=True).click()
                        choose = lookup.get_by_role('button', name=re.compile(r'^Choose: ' + re.escape(name) + r'(?: ·|$)'))
                        expect(choose).to_have_count(1)
                        expect(choose).to_be_enabled()
                        query = next(item['body']['queries'][0]['result'] for item in reversed(http)
                                     if item['path'].endswith('/lookups') and item['status'] == 200 and item['body'].get('queries'))
                        records = [query['record']] if query['status'] == 'resolved' else query.get('candidates', [])
                        matches = [item for item in records if item['id'] == ready['seedId'] and item['values']['name'] == name]
                        assert len(matches) == 1, 'Explicit selection must be the exact seeded record'
                        choose.click()
                        record_clarification = {'kind': 'explicit typed identity correction', 'originalLookupValue': prior_value,
                                                'correctedValue': name, 'selectedId': ready['seedId'], 'count': 1}
                        save('record-clarification.json', record_clarification)
                        continued_at = time.monotonic()
                        drawer.get_by_role('button', name='Continue instruction', exact=True).click()
                        wait_for(lambda: review_heading.is_visible())
                        timings['clarificationContinueToVisiblePreviewMs'] = round((time.monotonic() - continued_at) * 1000)
            wait_for(lambda: drawer.get_by_role('heading', name='Review changes before saving', exact=True).is_visible())
            if scenario not in IMAGE_SCENARIOS:
                timings['instructionFinishToVisiblePreviewMs'] = round((time.monotonic() - instruction_finished_at) * 1000)
            preview = page.locator('#bel-chat-preview')
            preview_expected = name if scenario != 'edit' else 'Native acceptance edited'
            if scenario == 'image':
                expect(preview).to_contain_text(preview_expected)
            else:
                assert preview_expected.casefold() in preview.inner_text().casefold()
            before = control('evidence')
            assert not before['receipts'], 'No save before separate confirmation'
            assert len(before['leads']) == (1 if scenario == 'edit' else 0)
            if scenario == 'edit':
                assert before['leads'][0]['notes'] == 'Before native edit'
            draft = next(item for item in before['drafts'] if item['status'] == 'review')
            assert len(draft['actions']) == 1
            action = draft['actions'][0]
            assert action['kind'] == ('updateLead' if scenario == 'edit' else 'createLead')
            assert expected_field(action['values']['notes'], expected_notes, scenario)
            reviewed_notes = action['values']['notes']
            reviewed_name = action['values'].get('name', name)
            if scenario == 'edit':
                assert action['values']['leadId'] == ready['seedId']
                assert set(action['values']) == {'leadId', 'notes'}, 'Edit must change only notes'
            else:
                assert expected_field(action['values']['name'], name, scenario) and action['values']['source'] == 'website'
                assert set(action['values']) == {'name', 'source', 'notes'}, 'Unexpected creation fields'
                expect(preview).to_contain_text('website')
                expect(preview).to_contain_text(reviewed_notes)
            if scenario == 'image':
                assert len(before['attachments']) == 1 and len(before['interpretations']) == 1 and len(before['descriptors']) == 1
                attachment, interpretation, descriptor = before['attachments'][0], before['interpretations'][0], before['descriptors'][0]
                assert descriptor['descriptorDigest'] == interpretation['requestDigest']
                assert descriptor['image']['sha256'] == descriptor['image']['actualBytesDigest'] == attachment['sha256']
                for field in ['name', 'source', 'notes']:
                    assert action['provenance'][field]['kind'] == 'image' and action['provenance'][field]['attachmentId'] == attachment['id']
                assert before['flashCalls'] == 1 and before['liveCalls'] == 0
                assert 'inlineData' not in json.dumps(before['reservations'])
                preview.get_by_text('Sources of the proposed fields', exact=True).click()
                expect(preview.get_by_text('Image', exact=True).first).to_be_visible()
            save('visible-preview.json', {'text': preview.inner_text(), 'draft': draft, 'serverPreviews': before['previews']})
            page.screenshot(path=str(out / 'preview.png'), full_page=True)
            results.append({'case': 'image upload produced exact sourced preview without domain write' if scenario == 'image' else 'spoken instruction produced exact visible preview without domain write',
                            'recordClarification': record_clarification, 'passed': True})
            if scenario == 'discard-reconnect':
                drawer.get_by_role('button', name='Discard draft', exact=True).click()
                wait_for(lambda: any(item['id'] == draft['id'] and item['status'] == 'cancelled'
                                     and item['hasPreview'] is False and item['hasConfirmation'] is False
                                     for item in control('evidence')['drafts']))
                page.reload(); page.locator('#bel-chat-launcher').click(timeout=30000)
                after = control('evidence')
                cancelled = next(item for item in after['drafts'] if item['id'] == draft['id'])
                assert cancelled['status'] == 'cancelled' and cancelled['hasPreview'] is False and cancelled['hasConfirmation'] is False
                assert not after['receipts'] and not after['leads']
                assert after['liveCalls'] == before['liveCalls'] == 1 and after['flashCalls'] == before['flashCalls']
                results.append({'case': 'discard before save and reconnect/reload have no domain effects or automatic paid reconnect', 'passed': True})
            else:
                if scenario == 'image':
                    drawer.get_by_role('button', name='Confirm and save', exact=True).click()
                else:
                    phrase = preview.get_by_text(re.compile(r'^Voice confirmation \(English\): ')).inner_text().removeprefix('Voice confirmation (English): ')
                    assert phrase.startswith('I confirm saving preview number ')
                    confirm_file, confirm_duration = audio('confirmation', phrase, env['CRM_NATIVE_CONFIRMATION_VOICE'])
                    page, drawer = open_chrome(confirm_file)
                    expect(page.locator('#bel-chat-preview')).to_contain_text(phrase)
                    assert not control('evidence')['receipts'], 'Browser reconnect must not save'
                    confirmation_finished_at = speak(drawer, confirm_duration)
                wait_for(lambda: drawer.get_by_role('heading', name='Saved successfully', exact=True).is_visible())
                if scenario not in IMAGE_SCENARIOS:
                    timings['confirmationFinishToVisibleSavedMs'] = round((time.monotonic() - confirmation_finished_at) * 1000)
                after = control('evidence')
                assert len(after['receipts']) == 1 and len(after['leads']) == 1
                lead = after['leads'][0]
                assert lead['name'] == reviewed_name
                assert lead['notes'] == reviewed_notes
                if scenario == 'edit':
                    assert lead['id'] == ready['seedId'] and lead['source'] == 'website' and lead['stage'] == 'new'
                assert len([item for item in after['attestations'] if item.get('consumedReceiptId')]) == (0 if scenario == 'image' else 1)
                assert any(item.get('state') == 'settled' for item in after['reservations'])
                assert all(item.get('engineeringOnly') is False for item in after['sessions'])
                finals = [item for item in after['utterances'] if item.get('audioEvidence')]
                assert len(finals) >= (0 if scenario == 'image' else 2), 'Spoken instruction and confirmation require captured audio evidence'
                for item in finals:
                    proof = item['audioEvidence']['transcription']
                    assert proof['source'] == 'captured_user_audio' and proof['finishReason'] == 'STOP'
                    assert proof['audioDigest'] == item['audioEvidence']['audioDigest']
                receipt = after['receipts'][0]
                page.reload(); page.locator('#bel-chat-launcher').click(timeout=30000)
                expect(drawer.get_by_role('heading', name='Saved successfully', exact=True)).to_be_visible(timeout=30000)
                recovered = control('evidence')
                assert recovered['receipts'] == [receipt] and recovered['leads'] == after['leads']
                assert recovered['liveCalls'] == (0 if scenario == 'image' else 2)
                if scenario == 'image':
                    assert recovered['flashCalls'] == 1
                page.screenshot(path=str(out / 'saved.png'), full_page=True)
                results.append({'case': 'explicit confirmation persisted exact record once; reload has no duplicate receipt or paid reconnect', 'confirmation': 'click' if scenario == 'image' else 'speech', 'passed': True})
            assert not ui_errors, 'Chrome page errors occurred'
            healthy()
    except Exception as error:
        if out.exists():
            save('failure.json', {'type': type(error).__name__, 'message': str(error)})
            if browser and browser.pages:
                try:
                    browser.pages[0].screenshot(path=str(out / 'failure.png'), full_page=True,
                                               mask=[browser.pages[0].locator('input'), browser.pages[0].get_by_text(CONTACT, exact=True), browser.pages[0].locator('img')])
                    save('failure-ui.json', {'text': browser.pages[0].locator('#bel-chat-drawer').inner_text()})
                except Exception:
                    pass
        raise
    finally:
        if browser:
            try:
                browser.close()
                browser_handle.close()
            except Exception:
                pass
        if out.exists():
            save('chrome-results.json', {'scenario': scenario, 'results': results, 'pageErrors': ui_errors, 'http': http,
                                        'timings': timings,
                                        'native': True, 'syntheticAudio': scenario not in IMAGE_SCENARIOS, 'confirmationLanguage': None if scenario in IMAGE_SCENARIOS else 'English', 'vietnameseAsrTested': False, 'postSaveUndoTested': False, 'nativePaymentImageTested': scenario == 'image-payment' and bool(results),
                                        'nativeAmbiguousDateTested': scenario == 'image-ambiguous-date' and bool(results),
                                        'nativeAdversarialImageTested': scenario == 'image-adversarial' and bool(results)})
        try:
            control('evidence'); control('close', post=True)
        except Exception:
            pass
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)
    print(json.dumps({'scenario': scenario, 'passed': len(results), 'evidence': str(out)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario', required=True, choices=['create', 'edit', 'discard-reconnect', *sorted(IMAGE_SCENARIOS)])
    args = parser.parse_args()
    run(args.scenario)
