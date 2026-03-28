/**
 * SRS Browser Audit Runner
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const { chromium } = require('playwright');

const {
    createAuditUser,
    destroyAuditUser,
    getManifestPath,
    listOpenManifests,
    readCard,
    readJson,
    readSummary,
    resetAuditUserState,
    seedScenario,
    sanitizeRunId,
    waitForCard,
    waitForSummary,
    waitForUserAlgorithm,
    writeJson,
    writeSummary
} = require('../srs/browser-audit-fixture-lib');

function parseArgs(argv) {
    const today = new Date().toISOString().slice(0, 10);
    const args = {
        baseUrl: 'https://localhost:8443',
        outputRoot: path.join('docs', 'audits', `${today}-srs-browser-audit`, 'artifacts'),
        startServer: true,
        headed: false,
        keepArtifacts: false,
        keepUser: false,
        scenarios: []
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--base-url') {
            args.baseUrl = argv[i + 1];
            i += 1;
            continue;
        }
        if (arg === '--output-root') {
            args.outputRoot = argv[i + 1];
            i += 1;
            continue;
        }
        if (arg === '--no-server') {
            args.startServer = false;
            continue;
        }
        if (arg === '--headed') {
            args.headed = true;
            continue;
        }
        if (arg === '--keep-artifacts') {
            args.keepArtifacts = true;
            continue;
        }
        if (arg === '--keep-user') {
            args.keepUser = true;
            continue;
        }
        if (arg === '--scenario') {
            args.scenarios.push(String(argv[i + 1] || '').trim());
            i += 1;
        }
    }

    return args;
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function nowRunId() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function sanitizeFilePart(value) {
    return String(value || '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 180);
}

function fetchJson(url, timeoutMs = 10_000) {
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;
    return new Promise((resolve, reject) => {
        const requestOptions = { timeout: timeoutMs };
        if (isHttps) {
            try {
                const hostname = new URL(url).hostname;
                if (hostname === 'localhost' || hostname === '127.0.0.1') {
                    requestOptions.agent = new https.Agent({ rejectUnauthorized: false });
                }
            } catch {
                // ignore
            }
        }

        const req = lib.get(url, requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode || 0, data: null, raw: data });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error(`Timeout fetching ${url}`)));
    });
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
    const start = Date.now();
    const healthUrl = `${baseUrl.replace(/\/$/, '')}/api/health`;
    while (true) {
        try {
            const res = await fetchJson(healthUrl, 5_000);
            if (res.status === 200 && res.data && res.data.success === true) return true;
        } catch {
            // ignore and retry
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Server health check timed out: ${healthUrl}`);
        }
        await new Promise((r) => setTimeout(r, 500));
    }
}

function startLocalServer(port) {
    const child = spawn(process.execPath, ['server.js'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(port) }
    });
    const lines = [];
    child.stdout.on('data', (d) => lines.push(String(d)));
    child.stderr.on('data', (d) => lines.push(String(d)));
    return { child, getOutput: () => lines.join('') };
}

async function stopLocalServer(serverProc) {
    if (!serverProc || !serverProc.child || serverProc.child.killed) return;
    serverProc.child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!serverProc.child.killed) serverProc.child.kill('SIGKILL');
}

async function safeScreenshot(page, filePath, { fullPage = false } = {}) {
    ensureDir(path.dirname(filePath));
    await page.screenshot({ path: filePath, fullPage, timeout: 15_000 });
}

async function isVisible(page, selector) {
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }, selector).catch(() => false);
}

async function waitForVisible(page, selector, timeoutMs = 20_000) {
    await page.waitForFunction(
        (sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        },
        selector,
        { timeout: timeoutMs }
    );
}

async function waitForHidden(page, selector, timeoutMs = 20_000) {
    await page.waitForFunction(
        (sel) => {
            const el = document.querySelector(sel);
            if (!el) return true;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
            const rect = el.getBoundingClientRect();
            return rect.width === 0 || rect.height === 0;
        },
        selector,
        { timeout: timeoutMs }
    );
}

async function dismissKnownOverlays(page) {
    const clickIfVisible = async (modalSel, btnSel) => {
        if (!(await isVisible(page, modalSel))) return false;
        const clicked = await page.locator(btnSel).click({ timeout: 4_000 }).then(() => true).catch(() => false);
        if (!clicked) {
            await page.evaluate((selector) => {
                const button = document.querySelector(selector);
                if (button && typeof button.click === 'function') button.click();
            }, btnSel).catch(() => {});
        }
        return true;
    };

    await clickIfVisible('#tutorial-overlay', '#tutorial-skip');
    await clickIfVisible('#shop-alert-modal', '#shop-alert-modal-ok');
    await clickIfVisible('#shop-modal', '#shop-close-btn');
    await clickIfVisible('#mode-helper-modal', '#mode-helper-close-btn');
    await clickIfVisible('#grammar-warning-modal', '#grammar-warning-ok-btn');
    await clickIfVisible('#vocab-alert-modal', '#vocab-alert-ok');
    await clickIfVisible('#explanation-modal', '#explanation-close-btn');
    await clickIfVisible('#vocab-add-modal', '#vocab-add-close');
    await clickIfVisible('#vocab-tutorial-overlay', '#vocab-tutorial-skip');
    await clickIfVisible('#srs-writing-modal', '#srs-writing-close-btn');
}

async function bypassPreloaderIfPresent(page) {
    if (!(await isVisible(page, '#app-preloader'))) return false;
    const bypassBtn = page.locator('#preloader-bypass-btn');
    const dismissBtn = page.locator('#preloader-dismiss-btn');

    if (await bypassBtn.count().then((c) => c > 0).catch(() => false)) {
        await bypassBtn.click({ timeout: 4_000 }).catch(() => {});
        return true;
    }
    if (await dismissBtn.count().then((c) => c > 0).catch(() => false)) {
        await dismissBtn.click({ timeout: 4_000 }).catch(() => {});
        return true;
    }
    return false;
}

async function resolveLevelSelectionModal(page, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isVisible(page, '#level-selection-modal')) {
            const beginnerBtn = page.locator('#level-selection-modal .level-btn[data-level="beginner"]');
            if (await beginnerBtn.count().then((count) => count > 0).catch(() => false)) {
                const clicked = await beginnerBtn.click({ timeout: 5_000 }).then(() => true).catch(() => false);
                if (!clicked) {
                    await page.evaluate(() => {
                        const btn = document.querySelector('#level-selection-modal .level-btn[data-level="beginner"]');
                        if (btn) btn.click();
                    }).catch(() => {});
                }
                await waitForHidden(page, '#level-selection-modal', 10_000).catch(() => {});
                if (!(await isVisible(page, '#level-selection-modal'))) {
                    return true;
                }
            }
        }
        await page.waitForTimeout(250);
    }
    return false;
}

async function setLocalStorage(page, entries = {}) {
    await page.evaluate((data) => {
        for (const [key, value] of Object.entries(data)) {
            if (value === null || typeof value === 'undefined') {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, String(value));
            }
        }
    }, entries);
}

async function clearLocalStorageKeys(page, keys) {
    await page.evaluate((list) => {
        for (const key of list) {
            localStorage.removeItem(key);
        }
    }, keys);
}

async function waitForAppReady(page) {
    await page.waitForFunction(() => !!window.SRSReview && typeof window.SRSReview.getWordsDueForReview === 'function', { timeout: 60_000 });
}

async function openApp(page, appUrl) {
    await page.goto(appUrl, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForTimeout(500);
    await dismissKnownOverlays(page);
    await bypassPreloaderIfPresent(page);
    await waitForAppReady(page);
}

async function ensureLoggedIn(page, provisionedUser, appUrl) {
    await openApp(page, appUrl);

    if (await isVisible(page, '#entry-modal')) {
        await page.locator('#login-choice-btn').click({ timeout: 10_000 });
    } else if (await isVisible(page, '#panel-logged-out')) {
        if (!(await isVisible(page, '#account-panel-side'))) {
            await page.locator('#account-panel-toggle').click({ timeout: 10_000 });
        } else {
            const expanded = await page.evaluate(() => {
                const panel = document.getElementById('account-panel-side');
                return !!panel && panel.classList.contains('expanded');
            });
            if (!expanded) {
                await page.locator('#account-panel-toggle').click({ timeout: 10_000 });
            }
        }
        await page.locator('#panel-login-btn').click({ timeout: 10_000 });
    } else if (await isVisible(page, '#panel-guest-mode')) {
        await page.locator('#panel-guest-login-btn').click({ timeout: 10_000 });
    }

    await page.waitForSelector('#login-form-element', { state: 'visible', timeout: 20_000 });
    await page.fill('#login-email', provisionedUser.email);
    await page.fill('#login-password', provisionedUser.password);
    await page.locator('#login-form-element button[type="submit"]').click({ timeout: 10_000 });

    await page.waitForFunction(() => {
        const overlay = document.getElementById('auth-overlay');
        const style = overlay ? window.getComputedStyle(overlay) : null;
        const hidden = !overlay || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        return hidden && !!window.auth?.currentUser?.uid;
    }, { timeout: 60_000 });

    await resolveLevelSelectionModal(page);

    await page.waitForTimeout(750);
    await dismissKnownOverlays(page);
}

function canonicalizeCard(card) {
    if (!card) return null;
    const fsrs = card.fsrs && typeof card.fsrs === 'object' ? {
        difficulty: card.fsrs.difficulty,
        stability: card.fsrs.stability,
        retrievability: card.fsrs.retrievability,
        lastReview: card.fsrs.lastReview,
        lapses: card.fsrs.lapses,
        reps: card.fsrs.reps
    } : null;

    return {
        algorithm: card.algorithm,
        state: card.state,
        interval: card.interval,
        nextReviewDate: card.nextReviewDate,
        lastReviewDate: card.lastReviewDate,
        repetitions: card.repetitions,
        stepIndex: card.stepIndex,
        easeFactor: card.easeFactor,
        fsrs
    };
}

function matchesAuditConsoleIssue(msg) {
    const text = String(msg || '');
    if (/SRS test hook: failNext(Card|Summary)SaveOnce/i.test(text)) {
        return false;
    }
    return /SRS|scheduler|Firestore/i.test(text);
}

let captureAuditErrors = false;

async function openSrsPanel(page) {
    await dismissKnownOverlays(page);
    await resolveLevelSelectionModal(page).catch(() => {});
    await bypassPreloaderIfPresent(page);
    const panelButton = page.locator('#btn-panel-srs');
    try {
        await panelButton.click({ timeout: 10_000 });
    } catch (err) {
        await page.evaluate(() => {
            const button = document.querySelector('#btn-panel-srs');
            if (button) button.click();
        });
    }
    await page.waitForFunction(() => {
        const panel = document.getElementById('panel-srs');
        return !!panel && panel.style.display !== 'none';
    }, { timeout: 20_000 });
    // Allow CSS transitions to settle so .srs-card-modern becomes stable
    await page.waitForTimeout(500);
}

async function clickSrsCard(page) {
    // Use JS evaluate to directly trigger SRSReview.startReviewSession()
    // instead of clicking .srs-card-modern, which can fail Playwright's
    // "stable" check due to CSS card entrance animations.
    await page.evaluate(() => {
        if (window.SRSReview && typeof window.SRSReview.startReviewSession === 'function') {
            window.SRSReview.startReviewSession();
        } else {
            const card = document.querySelector('.srs-card-modern');
            if (card) card.click();
        }
    });
}

async function startFreshScenarioState(page, uid, scenarioName, options) {
    captureAuditErrors = false;
    const now = new Date();
    await resetAuditUserState(uid, {
        email: options.email,
        algorithm: options.algorithm || null
    });
    await seedScenario(uid, scenarioName, now, { prefix: options.prefix });
    await clearLocalStorageKeys(page, [
        'srs_algorithm_preference',
        'srs_preferred_algorithm',
        'srs_onboarding_complete',
        'srs_tutorial_seen',
        'srs_pending_data',
        'typeTutorialReplay',
        'speakTutorialReplay',
        'extendedTutorialReplay',
        'writingTutorialReplay',
        'shopUnlockTutorialReplay',
        'watchTutorialReplay',
        'notesTutorialReplay',
        'pronounceTutorialReplay',
        'readAloudTutorialReplay',
        'survivalTutorialReplay',
        'vocabTutorialState',
        'vocabTutorialReplay'
    ]);
    if (options.localStorage) {
        await setLocalStorage(page, options.localStorage);
    }
    await setLocalStorage(page, {
        vocabTutorialState: JSON.stringify({
            vocabBookIntro: true,
            vocabAddModalIntro: true,
            srsListenType: true,
            srsListenRepeat: true,
            srsCloze: true,
            writingChallenge: true
        }),
        vocabTutorialReplay: JSON.stringify({})
    });
    await page.reload({ waitUntil: 'load', timeout: 60_000 });
    await waitForAppReady(page);
    await dismissKnownOverlays(page);
    await page.evaluate(() => {
        window.handleDualTrackScoring = async () => ({ success: true });
        window.firebaseFirestoreFunctions = window.firebaseFirestoreFunctions || {};
        window.firebaseFirestoreFunctions.addPoints = async () => ({ success: true });
        window.__SRS_TEST_HOOKS__ = window.__SRS_TEST_HOOKS__ || {};
        window.__SRS_TEST_HOOKS__.srs = window.__SRS_TEST_HOOKS__.srs || {};
        window.__SRS_TEST_HOOKS__.srs.disableAwardPoints = true;
    });
    captureAuditErrors = true;
}

function makeArtifactPaths(outputDirs, runId, scenarioName) {
    const safeName = sanitizeFilePart(scenarioName);
    return {
        screenshot: path.join(outputDirs.screenshots, `${runId}__${safeName}.png`)
    };
}

function formatScenarioResult(name) {
    return { name, status: 'passed', assertions: [], artifacts: [] };
}

async function executeScenario(page, outputDirs, runId, user, scenarioName) {
    const result = formatScenarioResult(scenarioName);
    const artifacts = makeArtifactPaths(outputDirs, runId, scenarioName);
    const prefix = `qa_srs_${runId}`;
    const baseLocalState = {
        srs_onboarding_complete: 'true'
    };

    try {
        switch (scenarioName) {
            case 'onboarding_local_persistence': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    localStorage: {}
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await waitForVisible(page, '#srs-algo-select-modal', 20_000);
                result.assertions.push('onboarding modal visible');
                await page.locator('#srs-algo-fsrs').click({ timeout: 10_000 });
                await page.waitForFunction(() => localStorage.getItem('srs_algorithm_preference') === 'FSRS', { timeout: 20_000 });
                await page.reload({ waitUntil: 'load', timeout: 60_000 });
                await waitForAppReady(page);
                await openSrsPanel(page);
                await clickSrsCard(page);
                await dismissKnownOverlays(page);
                await page.evaluate(() => window.SRSReview.openSettings());
                await waitForVisible(page, '#srs-settings-modal', 20_000);
                const selected = await page.evaluate(() => {
                    const input = document.querySelector('input[name="srs-algo"][value="FSRS"]');
                    return !!input && input.checked === true;
                });
                if (!selected) throw new Error('FSRS was not selected after reload');
                result.assertions.push('FSRS persisted across reload');
                break;
            }
            case 'settings_firestore_persistence': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    localStorage: {
                        ...baseLocalState,
                        srs_algorithm_preference: 'FSRS'
                    }
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await dismissKnownOverlays(page);
                await page.evaluate(() => window.SRSReview.openSettings());
                await waitForVisible(page, '#srs-settings-modal', 20_000);
                await page.evaluate(() => {
                    const input = document.querySelector('input[name="srs-algo"][value="SM2"]');
                    if (input) input.click();
                });
                await page.locator('#save-settings-btn').click({ timeout: 10_000 });
                await waitForUserAlgorithm(user.uid, 'SM2', 20_000);
                await page.reload({ waitUntil: 'load', timeout: 60_000 });
                await waitForAppReady(page);
                await openSrsPanel(page);
                await page.evaluate(() => window.SRSReview.openSettings());
                await waitForVisible(page, '#srs-settings-modal', 20_000);
                const selected = await page.evaluate(() => {
                    const input = document.querySelector('input[name="srs-algo"][value="SM2"]');
                    return !!input && input.checked === true;
                });
                if (!selected) throw new Error('SM2 was not selected after reload');
                result.assertions.push('SM2 persisted to vocabularyBook/data and reload');
                break;
            }
            case 'legacy_summary_compatibility': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    localStorage: {
                        ...baseLocalState
                    }
                });
                const baselineSummary = await readSummary(user.uid);
                await writeSummary(user.uid, {
                    ...baselineSummary,
                    algorithm: 'FSRS',
                    updatedAt: new Date().toISOString()
                }, { merge: false });
                await page.reload({ waitUntil: 'load', timeout: 60_000 });
                await waitForAppReady(page);
                await openSrsPanel(page);
                await page.evaluate(() => window.SRSReview.openSettings());
                await waitForVisible(page, '#srs-settings-modal', 20_000);
                const selected = await page.evaluate(() => {
                    const input = document.querySelector('input[name="srs-algo"][value="FSRS"]');
                    return !!input && input.checked === true;
                });
                const storedPreference = await page.evaluate(() => localStorage.getItem('srs_algorithm_preference'));
                if (!selected) throw new Error('Legacy summary.algorithm did not restore FSRS selection');
                if (storedPreference !== 'FSRS') {
                    throw new Error(`Expected FSRS in localStorage after legacy summary load, got ${storedPreference}`);
                }
                result.assertions.push('legacy summary.algorithm fallback restored FSRS');
                result.assertions.push('canonical localStorage preference refreshed from legacy summary');
                break;
            }
            case 'sm2_good_due_parity':
            case 'fsrs_good_due_parity': {
                const expectedAlgorithm = scenarioName.startsWith('fsrs') ? 'FSRS' : 'SM2';
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    algorithm: expectedAlgorithm,
                    localStorage: {
                        ...baseLocalState,
                        srs_algorithm_preference: expectedAlgorithm
                    }
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await waitForVisible(page, '#srs-review-panel', 20_000);
                await waitForVisible(page, '#srs-flashcard', 20_000);
                await dismissKnownOverlays(page);
                const due = await page.evaluate(() => window.SRSReview.getWordsDueForReview().map((w) => w.lemma));
                if (due.length !== 1) throw new Error(`Expected one due card, found ${due.length}`);
                const lemma = due[0];
                const snapshot = await page.evaluate(() => window.SRSReview.getCurrentReviewSnapshot());
                if (!snapshot || snapshot.currentLemma !== lemma) {
                    throw new Error(`Current lemma mismatch: ${snapshot?.currentLemma || 'null'}`);
                }
                const goodLabel = snapshot.ratingOutcomes?.good?.label;
                if (!goodLabel || goodLabel === '0m') {
                    throw new Error(`Invalid Good label: ${goodLabel}`);
                }
                await page.locator('#srs-flashcard').click({ timeout: 10_000 });
                await page.locator('button[data-quality="3"]').click({ timeout: 10_000 });
                const expectedCard = snapshot.ratingOutcomes.good.nextCard;
                const initialRepetitions = Number(snapshot.currentWord?.repetitions || 0);
                const stored = await waitForCard(
                    user.uid,
                    lemma,
                    (card) => Number(card?.repetitions || 0) !== initialRepetitions || String(card?.nextReviewDate || '') !== String(snapshot.currentWord?.nextReviewDate || ''),
                    30_000
                );
                const storedCanonical = canonicalizeCard(stored);
                const expectedCanonical = canonicalizeCard(expectedCard);
                const compareKeys = Object.keys(expectedCanonical).filter((key) => expectedCanonical[key] !== undefined && key !== 'fsrs');
                const storedComparable = Object.fromEntries(compareKeys.map((key) => [key, storedCanonical[key]]));
                const expectedComparable = Object.fromEntries(compareKeys.map((key) => [key, expectedCanonical[key]]));
                if (JSON.stringify(storedComparable) !== JSON.stringify(expectedComparable)) {
                    throw new Error(`Persisted card did not match cached Good outcome for ${lemma}\nstored=${JSON.stringify(storedComparable)}\nexpected=${JSON.stringify(expectedComparable)}\nfsrs=${JSON.stringify(storedCanonical.fsrs || null)}`);
                }
                result.assertions.push(`Good label ${goodLabel}`);
                result.assertions.push(`${expectedAlgorithm} Good schedule matched persisted card`);
                break;
            }
            case 'mastered_hidden': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    localStorage: {
                        ...baseLocalState,
                        srs_algorithm_preference: 'SM2'
                    }
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await waitForVisible(page, '#srs-review-panel', 20_000);
                await waitForVisible(page, '#srs-flashcard', 20_000);
                await dismissKnownOverlays(page);
                const due = await page.evaluate(() => window.SRSReview.getWordsDueForReview().map((w) => w.lemma));
                if (due.some((lemma) => /mastered/i.test(lemma))) {
                    throw new Error(`Mastered lemma appeared in due queue: ${due.join(', ')}`);
                }
                const tableText = await page.locator('#srs-schedule-body').innerText({ timeout: 10_000 });
                if (/mastered/i.test(tableText)) {
                    throw new Error('Mastered lemma appeared in schedule table');
                }
                if (!/future/i.test(tableText)) {
                    throw new Error('Expected future lemma in schedule table');
                }
                result.assertions.push('mastered lemma absent from queue and schedule table');
                break;
            }
            case 'switch_sm2_to_fsrs':
            case 'switch_fsrs_to_sm2': {
                const targetAlgorithm = scenarioName === 'switch_sm2_to_fsrs' ? 'FSRS' : 'SM2';
                const storedAlgorithm = scenarioName === 'switch_sm2_to_fsrs' ? 'SM2' : 'FSRS';
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    algorithm: targetAlgorithm,
                    localStorage: {
                        ...baseLocalState,
                        srs_algorithm_preference: targetAlgorithm
                    }
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await waitForVisible(page, '#srs-review-panel', 20_000);
                await waitForVisible(page, '#srs-flashcard', 20_000);
                await dismissKnownOverlays(page);
                const due = await page.evaluate(() => window.SRSReview.getWordsDueForReview().map((w) => w.lemma));
                if (due.length !== 1) throw new Error(`Expected one due card, found ${due.length}`);
                const lemma = due[0];
                const before = await page.evaluate((currentLemma) => window.SRSReview.getWordData(currentLemma), lemma);
                if (!before || before.algorithm !== storedAlgorithm) {
                    throw new Error(`Expected stored card algorithm ${storedAlgorithm}, got ${before?.algorithm || 'null'}`);
                }
                await page.locator('#srs-flashcard').click({ timeout: 10_000 });
                await page.locator('button[data-quality="3"]').click({ timeout: 10_000 });
                const stored = await waitForCard(user.uid, lemma, (card) => {
                    const normalized = canonicalizeCard(card);
                    return normalized && normalized.algorithm === targetAlgorithm && Number(normalized.repetitions || 0) !== Number(before.repetitions || 0);
                }, 30_000);
                if (!stored || stored.algorithm !== targetAlgorithm) {
                    throw new Error(`Expected persisted algorithm ${targetAlgorithm}`);
                }
                result.assertions.push(`algorithm switched to ${targetAlgorithm} on review`);
                break;
            }
            case 'subday_relearning_labels': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    localStorage: {
                        ...baseLocalState,
                        srs_algorithm_preference: 'SM2'
                    }
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await waitForVisible(page, '#srs-review-panel', 20_000);
                await waitForVisible(page, '#srs-flashcard', 20_000);
                await dismissKnownOverlays(page);
                await page.locator('#srs-flashcard').click({ timeout: 10_000 });
                const snapshot = await page.evaluate(() => window.SRSReview.getCurrentReviewSnapshot());
                const labels = Object.values(snapshot.ratingOutcomes || {}).map((outcome) => outcome?.label || '');
                if (labels.some((label) => label === '0m')) {
                    throw new Error(`Found 0m interval label: ${labels.join(', ')}`);
                }
                result.assertions.push(`labels: ${labels.join(', ')}`);
                break;
            }
            case 'early_review_only': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    localStorage: {
                        ...baseLocalState,
                        srs_algorithm_preference: 'SM2'
                    }
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await waitForVisible(page, '#srs-early-confirm-overlay', 20_000);
                const due = await page.evaluate(() => window.SRSReview.getWordsDueForReview().length);
                if (due !== 0) throw new Error(`Expected zero due cards, found ${due}`);
                await dismissKnownOverlays(page);
                await page.locator('#srs-early-yes').click({ timeout: 10_000 });
                await waitForVisible(page, '#srs-review-panel', 20_000);
                const dueText = await page.locator('#srs-due-count').innerText({ timeout: 10_000 });
                if (!/Early review/i.test(dueText)) {
                    throw new Error(`Expected early review label, got "${dueText}"`);
                }
                result.assertions.push('early review confirmation accepted');
                result.assertions.push('header showed Early review');
                break;
            }
            case 'legacy_pending_payload_compatibility': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    localStorage: {
                        ...baseLocalState
                    }
                });
                const lemma = `${prefix}_due`;
                const storedCard = await readCard(user.uid, lemma);
                if (!storedCard) throw new Error(`Seeded card missing for ${lemma}`);
                const legacyPendingCard = {
                    ...storedCard,
                    algorithm: 'FSRS',
                    repetitions: Number(storedCard.repetitions || 0) + 3,
                    nextReviewDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
                    fsrs: {
                        difficulty: 5.1,
                        stability: 2.2,
                        retrievability: 0.98,
                        lastReview: new Date().toISOString(),
                        lapses: 0,
                        reps: Number(storedCard.repetitions || 0) + 3
                    }
                };
                await page.evaluate(({ userId, pendingLemma, pendingCard }) => {
                    localStorage.setItem('srs_pending_data', JSON.stringify({
                        userId,
                        updatedAt: new Date().toISOString(),
                        summary: {
                            reviewStats: { totalReviews: 1, dailyCount: 1, currentStreak: 1 },
                            masteredWords: [],
                            totalPoints: 0,
                            algorithm: 'FSRS'
                        },
                        cardsByLemma: {
                            [pendingLemma]: pendingCard
                        }
                    }));
                }, { userId: user.uid, pendingLemma: lemma, pendingCard: legacyPendingCard });
                await page.reload({ waitUntil: 'load', timeout: 60_000 });
                await waitForAppReady(page);
                await waitForUserAlgorithm(user.uid, 'FSRS', 30_000);
                await waitForCard(user.uid, lemma, (card) =>
                    String(card?.algorithm || '') === 'FSRS'
                    && Number(card?.repetitions || 0) === Number(legacyPendingCard.repetitions || 0)
                    && String(card?.nextReviewDate || '') === String(legacyPendingCard.nextReviewDate || ''),
                30_000);
                await waitForSummary(user.uid, (summary) =>
                    Number(summary?.reviewStats?.totalReviews || 0) === 1
                    && String(summary?.srsSettings?.algorithm || '') === 'FSRS',
                30_000);
                const pendingAfter = await page.evaluate(() => localStorage.getItem('srs_pending_data'));
                if (pendingAfter) throw new Error('Legacy pending payload was not cleared after replay');
                result.assertions.push('legacy pending summary.algorithm replayed to canonical summary path');
                result.assertions.push('legacy pending card replayed and cleared');
                break;
            }
            case 'pending_recovery': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    localStorage: {
                        ...baseLocalState,
                        srs_algorithm_preference: 'SM2'
                    }
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await waitForVisible(page, '#srs-review-panel', 20_000);
                await waitForVisible(page, '#srs-flashcard', 20_000);
                await dismissKnownOverlays(page);
                const due = await page.evaluate(() => window.SRSReview.getWordsDueForReview().map((w) => w.lemma));
                const lemma = due[0];
                await page.evaluate(() => {
                    window.__SRS_TEST_HOOKS__.srs.failNextCardSaveOnce = true;
                    window.__SRS_TEST_HOOKS__.srs.failNextSummarySaveOnce = true;
                });
                await page.locator('#srs-flashcard').click({ timeout: 10_000 });
                await page.locator('button[data-quality="3"]').click({ timeout: 10_000 });
                await page.waitForFunction(() => !!localStorage.getItem('srs_pending_data'), { timeout: 20_000 });
                const pendingBefore = await page.evaluate(() => localStorage.getItem('srs_pending_data'));
                if (!pendingBefore) throw new Error('Expected pending sync data after forced save failure');
                const cardBefore = await readCard(user.uid, lemma);
                if (cardBefore && Number(cardBefore.repetitions || 0) > 2) {
                    throw new Error('Remote card updated before recovery replay');
                }

                await page.reload({ waitUntil: 'load', timeout: 60_000 });
                await waitForAppReady(page);
                await waitForCard(user.uid, lemma, (card) => Number(card?.repetitions || 0) !== Number(cardBefore?.repetitions || 0), 30_000);
                await waitForSummary(user.uid, (summary) => Number(summary?.reviewStats?.totalReviews || 0) === 1, 30_000);
                const pendingAfter = await page.evaluate(() => localStorage.getItem('srs_pending_data'));
                if (pendingAfter) throw new Error('Pending sync data was not cleared after replay');
                result.assertions.push('pending sync replayed and cleared');
                break;
            }
            case 'rapid_save_reload_race': {
                await startFreshScenarioState(page, user.uid, scenarioName, {
                    email: user.email,
                    prefix,
                    algorithm: 'FSRS',
                    localStorage: {
                        ...baseLocalState,
                        srs_algorithm_preference: 'FSRS'
                    }
                });
                await openSrsPanel(page);
                await clickSrsCard(page);
                await dismissKnownOverlays(page);
                await page.evaluate(() => window.SRSReview.openSettings());
                await waitForVisible(page, '#srs-settings-modal', 20_000);
                await page.evaluate(() => {
                    const input = document.querySelector('input[name="srs-algo"][value="SM2"]');
                    if (input) input.click();
                    const saveButton = document.querySelector('#save-settings-btn');
                    if (saveButton) saveButton.click();
                });
                await page.reload({ waitUntil: 'load', timeout: 60_000 });
                await waitForAppReady(page);
                await waitForUserAlgorithm(user.uid, 'SM2', 30_000);
                await openSrsPanel(page);
                await page.evaluate(() => window.SRSReview.openSettings());
                await waitForVisible(page, '#srs-settings-modal', 20_000);
                const selected = await page.evaluate(() => {
                    const input = document.querySelector('input[name="srs-algo"][value="SM2"]');
                    return !!input && input.checked === true;
                });
                const pendingAfter = await page.evaluate(() => localStorage.getItem('srs_pending_data'));
                if (!selected) throw new Error('SM2 was not selected after rapid save/reload');
                if (pendingAfter) throw new Error('Pending sync data was not cleared after rapid save/reload recovery');
                result.assertions.push('rapid save/reload preserved algorithm change');
                result.assertions.push('pending sync cleared after recovery flush');
                break;
            }
            default:
                throw new Error(`Unknown scenario: ${scenarioName}`);
        }

        return result;
    } catch (error) {
        result.status = 'failed';
        result.error = String(error?.stack || error);
        try {
            await safeScreenshot(page, artifacts.screenshot, { fullPage: true });
        } catch {
            // ignore
        }
        result.artifacts.push(path.relative(outputDirs.outputRoot, artifacts.screenshot));
        return result;
    } finally {
        try {
            await safeScreenshot(page, artifacts.screenshot);
        } catch {
            // ignore
        }
        if (!result.artifacts.includes(path.relative(outputDirs.outputRoot, artifacts.screenshot))) {
            result.artifacts.push(path.relative(outputDirs.outputRoot, artifacts.screenshot));
        }
    }
}

async function cleanStaleManifests(report) {
    const openRuns = listOpenManifests();
    for (const entry of openRuns) {
        const manifest = entry.manifest || {};
        const uid = String(manifest?.user?.uid || '').trim();
        if (!uid) continue;
        try {
            await destroyAuditUser(uid);
            writeJson(entry.filePath, {
                ...manifest,
                cleanupCompleted: true,
                cleanupCompletedAt: new Date().toISOString(),
                staleCleanup: true
            });
            report.staleCleanups.push({ filePath: entry.filePath, uid, cleaned: true });
        } catch (error) {
            report.staleCleanups.push({ filePath: entry.filePath, uid, cleaned: false, error: String(error?.stack || error) });
        }
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const runId = nowRunId();
    const outputRoot = path.resolve(args.outputRoot);
    const outputDirs = {
        outputRoot,
        screenshots: path.join(outputRoot, 'screenshots'),
        videos: path.join(outputRoot, 'videos'),
        logs: path.join(outputRoot, 'logs'),
        reports: path.join(outputRoot, 'reports')
    };
    const tmpManifestPath = getManifestPath(runId);
    ensureDir(outputDirs.outputRoot);
    ensureDir(outputDirs.screenshots);
    ensureDir(outputDirs.videos);
    ensureDir(outputDirs.logs);
    ensureDir(outputDirs.reports);
    ensureDir(path.dirname(tmpManifestPath));

    const report = {
        runId,
        baseUrl: args.baseUrl,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        userUid: null,
        scenarioResults: [],
        consoleErrors: [],
        pageErrors: [],
        cleanupCompleted: false,
        staleCleanups: []
    };

    await cleanStaleManifests(report);

    let serverProc = null;
    let browser = null;
    let context = null;
    let page = null;
    let provisioned = null;

    try {
        const baseUrl = new URL(args.baseUrl);
        const port = Number(baseUrl.port || (baseUrl.protocol === 'https:' ? 443 : 80));

        if (args.startServer) {
            serverProc = startLocalServer(port);
            await waitForHealth(args.baseUrl);
        }

        provisioned = await createAuditUser(runId, { email: `srs.audit+${runId}@bel.local` });
        report.userUid = provisioned.uid;

        writeJson(tmpManifestPath, {
            runId,
            createdAt: new Date().toISOString(),
            baseUrl: args.baseUrl,
            artifactsRoot: outputRoot,
            cleanupCompleted: false,
            serverStartedByRunner: !!args.startServer,
            user: {
                uid: provisioned.uid,
                email: provisioned.email,
                password: provisioned.password
            },
            scenarioHistory: []
        });

        browser = await chromium.launch({ headless: !args.headed });
        context = await browser.newContext({
            ignoreHTTPSErrors: true,
            viewport: { width: 1440, height: 900 },
            recordVideo: { dir: outputDirs.videos, size: { width: 1440, height: 900 } }
        });
        page = await context.newPage();
        await page.addInitScript(() => {
            window.__SRS_TEST_HOOKS__ = window.__SRS_TEST_HOOKS__ || {};
            window.__SRS_TEST_HOOKS__.srs = window.__SRS_TEST_HOOKS__.srs || {};
            window.__SRS_TEST_HOOKS__.srs.failNextCardSaveOnce = false;
            window.__SRS_TEST_HOOKS__.srs.failNextSummarySaveOnce = false;
            window.__SRS_TEST_HOOKS__.srs.disableAwardPoints = true;
        });

        page.on('console', (msg) => {
            if (captureAuditErrors && msg.type() === 'error') {
                report.consoleErrors.push({ type: msg.type(), text: msg.text(), url: msg.location().url || '' });
            }
        });
        page.on('pageerror', (err) => {
            if (captureAuditErrors) {
                report.pageErrors.push(String(err));
            }
        });

        const appUrl = `${args.baseUrl.replace(/\/$/, '')}/index.html`;
        await ensureLoggedIn(page, provisioned, appUrl);
        captureAuditErrors = false;

        const scenarios = [
            'onboarding_local_persistence',
            'settings_firestore_persistence',
            'legacy_summary_compatibility',
            'sm2_good_due_parity',
            'fsrs_good_due_parity',
            'mastered_hidden',
            'switch_sm2_to_fsrs',
            'switch_fsrs_to_sm2',
            'subday_relearning_labels',
            'early_review_only',
            'legacy_pending_payload_compatibility',
            'pending_recovery',
            'rapid_save_reload_race'
        ].filter((name) => args.scenarios.length === 0 || args.scenarios.includes(name));

        for (const scenarioName of scenarios) {
            await page.goto(appUrl, { waitUntil: 'load', timeout: 60_000 });
            await waitForAppReady(page);
            await dismissKnownOverlays(page);
            await bypassPreloaderIfPresent(page);
            const result = await executeScenario(page, outputDirs, runId, provisioned, scenarioName);
            report.scenarioResults.push(result);
            const manifest = readJson(tmpManifestPath);
            manifest.scenarioHistory = [...(manifest.scenarioHistory || []), scenarioName];
            writeJson(tmpManifestPath, manifest);
        }

        if (!args.keepUser) {
            await destroyAuditUser(provisioned.uid);
        }

        const manifest = readJson(tmpManifestPath);
        writeJson(tmpManifestPath, {
            ...manifest,
            cleanupCompleted: !args.keepUser,
            cleanupCompletedAt: new Date().toISOString(),
            retainedByFlag: args.keepUser
        });
        report.cleanupCompleted = !args.keepUser;
        report.finishedAt = new Date().toISOString();
        writeJson(path.join(outputDirs.reports, `${runId}__audit-run.json`), report);

        const failed = report.scenarioResults.some((item) => item.status !== 'passed')
            || report.pageErrors.length > 0
            || report.consoleErrors.some((entry) => matchesAuditConsoleIssue(entry.text));
        if (failed) process.exitCode = 1;
    } catch (error) {
        report.finishedAt = new Date().toISOString();
        report.error = String(error?.stack || error);
        writeJson(path.join(outputDirs.reports, `${runId}__audit-run.json`), report);
        process.exitCode = 1;
    } finally {
        if (context) {
            try { await context.close(); } catch {}
        }
        if (browser) {
            try { await browser.close(); } catch {}
        }
        if (serverProc) {
            await stopLocalServer(serverProc);
        }

        if (provisioned && !args.keepUser) {
            try {
                await destroyAuditUser(provisioned.uid);
            } catch {
                // ignore; manifest/report will show the failure via exit code
            }
        }

        if (fs.existsSync(tmpManifestPath)) {
            const manifest = readJson(tmpManifestPath);
            writeJson(tmpManifestPath, {
                ...manifest,
                cleanupCompleted: !args.keepUser,
                cleanupCompletedAt: new Date().toISOString(),
                retainedByFlag: args.keepUser
            });
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
