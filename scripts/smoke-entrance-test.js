#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let firestoreDb = null;

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i++;
        } else {
            out[key] = true;
        }
    }
    return out;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const res = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
            if (res.ok) return;
        } catch (_) {
            // ignore until timeout
        }
        await wait(400);
    }
    throw new Error(`Server did not become ready at ${baseUrl}`);
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function getFirestoreDb() {
    if (firestoreDb) return firestoreDb;

    const worktreeRoot = path.resolve(__dirname, '..');
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const previousCwd = process.cwd();

    try {
        process.chdir(repoRoot);
        const rootFirebase = require(path.join(repoRoot, 'src', 'utils', 'firebase'));
        firestoreDb = rootFirebase.db || null;
    } catch (error) {
        firestoreDb = null;
    } finally {
        process.chdir(previousCwd);
    }

    if (firestoreDb) return firestoreDb;

    try {
        const localFirebase = require(path.join(worktreeRoot, 'src', 'utils', 'firebase'));
        firestoreDb = localFirebase.db || null;
    } catch (error) {
        firestoreDb = null;
    }

    return firestoreDb;
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const json = await response.json().catch(() => null);
    return { response, json };
}

function resolveAdminPassword(args) {
    if (args['admin-password']) return String(args['admin-password']).trim();
    if (process.env.ADMIN_PASSWORD) return String(process.env.ADMIN_PASSWORD).trim();

    const localAccountFile = path.join(process.cwd(), 'Admin account');
    if (!fs.existsSync(localAccountFile)) return '';
    const text = fs.readFileSync(localAccountFile, 'utf8');
    const match = text.match(/Password:\s*(.+)/i);
    return match ? String(match[1]).trim() : '';
}

function getHeaders(idToken, isJson) {
    if (isJson) {
        return {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        };
    }
    return {
        Authorization: `Bearer ${idToken}`
    };
}

function buildResponses(session) {
    const responses = { vocab: {}, grammar: {}, listen_write: {} };
    const sections = Array.isArray(session?.sections) ? session.sections : [];

    for (const section of sections) {
        const sectionId = String(section?.id || '');
        const questions = Array.isArray(section?.questions) ? section.questions : [];
        for (const question of questions) {
            const questionId = String(question?.questionId || '').trim();
            if (!questionId) continue;

            const blanks = Array.isArray(question?.parts)
                ? question.parts.filter((part) => part && part.type === 'blank')
                : [];

            if (sectionId === 'vocab' || sectionId === 'grammar') {
                responses[sectionId][questionId] = blanks.map((blank) => {
                    const options = Array.isArray(blank?.options) ? blank.options : [];
                    return String(options[0] || '');
                });
                continue;
            }

            if (sectionId === 'listen_write') {
                responses.listen_write[questionId] = blanks.map((_, index) => `ans${index + 1}`);
            }
        }
    }

    return responses;
}

async function runSmoke(baseUrl, args) {
    const db = getFirestoreDb();
    const apiKey = String(process.env.FIREBASE_API_KEY || '').trim();
    const adminEmail = String(args['admin-email'] || process.env.ADMIN_EMAIL || '').trim();
    const adminPassword = resolveAdminPassword(args);

    assert(apiKey, 'Missing FIREBASE_API_KEY in environment.');
    assert(adminEmail, 'Missing ADMIN_EMAIL (or --admin-email).');
    assert(adminPassword, 'Missing admin password (set ADMIN_PASSWORD or --admin-password).');
    assert(db, 'Missing Firestore admin initialization for smoke test.');

    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
    const signIn = await fetchJson(signInUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword, returnSecureToken: true })
    });
    assert(signIn.response.ok && signIn.json?.idToken, `Firebase sign-in failed: ${JSON.stringify(signIn.json)}`);
    const idToken = String(signIn.json.idToken);

    const leadRef = db.collection('crmLeads').doc();
    await leadRef.set({
        name: `Smoke Lead ${Date.now()}`,
        email: `smoke-${Date.now()}@example.com`,
        stage: 'contacted',
        createdAt: new Date(),
        updatedAt: new Date()
    });

    const createStudent = await fetchJson(`${baseUrl}/api/admin/students`, {
        method: 'POST',
        headers: getHeaders(idToken, true),
        body: JSON.stringify({
            name: `Smoke ${Date.now()}`,
            email: `smoke-student-${Date.now()}@example.com`,
            leadId: leadRef.id
        })
    });
    assert(createStudent.response.ok && createStudent.json?.success, `Create student failed: ${JSON.stringify(createStudent.json)}`);
    const studentId = String(createStudent.json.studentId || '');
    assert(studentId, 'Missing studentId in create student response.');

    const createTest = await fetchJson(`${baseUrl}/api/admin/students/${encodeURIComponent(studentId)}/entrance-tests`, {
        method: 'POST',
        headers: getHeaders(idToken, false)
    });
    assert(createTest.response.ok && createTest.json?.success, `Create test failed: ${JSON.stringify(createTest.json)}`);
    const testId = String(createTest.json.testId || '');
    const testLink = String(createTest.json.testLink || '');
    assert(testId && testLink, 'Missing testId/testLink.');

    const leadAfterCreate = await leadRef.get();
    assert(leadAfterCreate.exists, 'Lead document missing after test creation.');
    assert(
        String(leadAfterCreate.data()?.stage || '') === 'test_scheduled',
        `Expected lead stage=test_scheduled after creation, got ${leadAfterCreate.data()?.stage}`
    );

    const token = new URL(testLink).searchParams.get('token');
    assert(token, 'Missing token in testLink.');

    const session = await fetchJson(`${baseUrl}/api/entrance-tests/session?token=${encodeURIComponent(token)}`);
    assert(session.response.ok && session.json?.success && session.json?.session, `Session failed: ${JSON.stringify(session.json)}`);

    const draftResponses = { vocab: {}, grammar: {}, listen_write: {} };
    const vocabSection = (session.json.session.sections || []).find((section) => section?.id === 'vocab');
    const firstVocabQuestion = vocabSection?.questions?.[0] || null;
    if (firstVocabQuestion?.questionId) {
        const blanks = Array.isArray(firstVocabQuestion.parts)
            ? firstVocabQuestion.parts.filter((part) => part && part.type === 'blank')
            : [];
        draftResponses.vocab[firstVocabQuestion.questionId] = blanks.map((blank) => {
            const options = Array.isArray(blank?.options) ? blank.options : [];
            return String(options[0] || '');
        });
    }

    const saveProgress = await fetchJson(`${baseUrl}/api/entrance-tests/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token,
            stepIndex: 4,
            responses: draftResponses
        })
    });
    assert(saveProgress.response.ok && saveProgress.json?.success, `Save progress failed: ${JSON.stringify(saveProgress.json)}`);

    const resumedSession = await fetchJson(`${baseUrl}/api/entrance-tests/session?token=${encodeURIComponent(token)}`);
    assert(resumedSession.response.ok && resumedSession.json?.success, `Resumed session failed: ${JSON.stringify(resumedSession.json)}`);
    assert(Number(resumedSession.json?.progress?.stepIndex) === 4, `Expected saved stepIndex=4, got ${resumedSession.json?.progress?.stepIndex}`);
    if (firstVocabQuestion?.questionId) {
        const resumedAnswers = resumedSession.json?.progress?.responses?.vocab?.[firstVocabQuestion.questionId] || [];
        const expectedAnswers = draftResponses.vocab[firstVocabQuestion.questionId] || [];
        assert(
            JSON.stringify(resumedAnswers) === JSON.stringify(expectedAnswers),
            `Resumed draft answers mismatch: expected ${JSON.stringify(expectedAnswers)}, got ${JSON.stringify(resumedAnswers)}`
        );
    }

    const speakingSection = (session.json.session.sections || []).find((section) => section?.id === 'speaking');
    const firstSpeakingQuestion = speakingSection?.questions?.[0] || null;
    if (firstSpeakingQuestion?.questionId) {
        const upload = await fetchJson(
            `${baseUrl}/api/entrance-tests/speaking/upload?token=${encodeURIComponent(token)}&questionId=${encodeURIComponent(firstSpeakingQuestion.questionId)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'audio/wav' },
                body: Buffer.alloc(512, 2)
            }
        );
        assert(upload.response.ok && upload.json?.success, `Speaking upload failed: ${JSON.stringify(upload.json)}`);
    }

    const responses = buildResponses(session.json.session);
    const submit = await fetchJson(`${baseUrl}/api/entrance-tests/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, responses })
    });
    assert(submit.response.ok && submit.json?.success, `Submit failed: ${JSON.stringify(submit.json)}`);

    const leadAfterSubmit = await leadRef.get();
    assert(
        String(leadAfterSubmit.data()?.stage || '') === 'test_completed',
        `Expected lead stage=test_completed after submission, got ${leadAfterSubmit.data()?.stage}`
    );

    const submitAgain = await fetchJson(`${baseUrl}/api/entrance-tests/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, responses })
    });
    assert(submitAgain.response.status === 410, `Second submit must return 410, got ${submitAgain.response.status}`);

    const sessionAfter = await fetchJson(`${baseUrl}/api/entrance-tests/session?token=${encodeURIComponent(token)}`);
    assert(sessionAfter.response.status === 410, `Session after submit must return 410, got ${sessionAfter.response.status}`);

    const listTests = await fetchJson(`${baseUrl}/api/admin/students/${encodeURIComponent(studentId)}/entrance-tests`, {
        method: 'GET',
        headers: getHeaders(idToken, false)
    });
    assert(listTests.response.ok && listTests.json?.success, `List tests failed: ${JSON.stringify(listTests.json)}`);
    const tests = Array.isArray(listTests.json.tests) ? listTests.json.tests : [];
    const listed = tests.find((item) => item?.testId === testId);
    assert(listed, 'Created test not found in list.');
    assert(String(listed.status || '').toLowerCase() === 'submitted', `Expected submitted status, got ${listed.status}`);

    const details = await fetchJson(`${baseUrl}/api/admin/entrance-tests/${encodeURIComponent(testId)}`, {
        method: 'GET',
        headers: getHeaders(idToken, false)
    });
    assert(details.response.ok && details.json?.success && details.json?.session, `Details failed: ${JSON.stringify(details.json)}`);

    if (firstSpeakingQuestion?.questionId) {
        const audioUrl = await fetchJson(
            `${baseUrl}/api/admin/entrance-tests/${encodeURIComponent(testId)}/speaking/${encodeURIComponent(firstSpeakingQuestion.questionId)}/audio-url`,
            { method: 'GET', headers: getHeaders(idToken, false) }
        );
        assert(audioUrl.response.ok && audioUrl.json?.success && audioUrl.json?.url, `Audio URL failed: ${JSON.stringify(audioUrl.json)}`);
    }

    return {
        ok: true,
        baseUrl,
        studentId,
        testId,
        submitStatus: submit.response.status,
        submitAgainStatus: submitAgain.response.status,
        sessionAfterStatus: sessionAfter.response.status
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const port = String(args.port || process.env.PORT || '8787');
    const baseUrl = String(args['base-url'] || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
    const timeoutMs = Number(args['timeout-ms'] || 45000);
    const shouldStartServer = !!args['start-server'];
    const keepServer = !!args['keep-server'];

    let child = null;
    if (shouldStartServer) {
        child = spawn('node', ['server.js'], {
            cwd: process.cwd(),
            env: { ...process.env, PORT: port },
            stdio: 'inherit'
        });
    }

    try {
        await waitForServer(baseUrl, timeoutMs);
        const result = await runSmoke(baseUrl, args);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
        if (child && !keepServer && !child.killed) {
            child.kill('SIGTERM');
            await wait(250);
            if (!child.killed) {
                child.kill('SIGKILL');
            }
        }
    }
}

main().catch((error) => {
    const message = error?.stack || String(error);
    process.stderr.write(`SMOKE_TEST_FAILED\n${message}\n`);
    process.exit(1);
});
