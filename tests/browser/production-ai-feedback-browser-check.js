/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PRODUCTION_URL = 'https://listening-tasks-3ae34.web.app';
const CREDENTIALS_PATH = path.join(process.cwd(), '.local', 'browser-test-credentials.md');

function parseCredentials() {
  const text = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0];
  const passwordLine = text
    .split(/\r?\n/)
    .find((line) => /password/i.test(line));
  const password = passwordLine
    ? passwordLine
      .replace(/^\s*[-*]?\s*/, '')
      .replace(/`|\*\*/g, '')
      .replace(/^password\s*[:=-]\s*/i, '')
      .trim()
    : '';

  if (!email || !password || /^password$/i.test(password)) {
    throw new Error(`Could not parse email/password from ${CREDENTIALS_PATH}`);
  }

  return { email, password };
}

function buildPayloads() {
  const essayRubricPath = path.join(process.cwd(), 'public', 'database', 'knowledge-base', 'Write Essay Score Guide.txt');
  const essayRubric = fs.readFileSync(essayRubricPath, 'utf8').slice(0, 12000);

  return {
    assessWriting: {
      text: 'I improve my academic writing by checking grammar carefully and revising unclear sentences.',
      context: {
        challengeId: 'prod-browser-smoke-writing-challenge',
        contextId: `prod-browser-smoke-${Date.now()}`,
        word: 'improve',
        lemma: 'improve',
        promptText: 'Write a sentence using improve.',
        validationTarget: 'improve'
      }
    },
    scoreEssay: {
      text: 'Technology has changed the way people study and work. It gives students faster access to information, but it also requires discipline because distractions are easy to find. In my view, technology is helpful when learners use it to research, practise, and review their mistakes instead of replacing their own thinking.',
      promptText: 'Do you think technology has improved education?',
      rubricText: essayRubric
    },
    scoreSWT: {
      text: 'Major sports events are adopting climate initiatives to reduce emissions and encourage broader environmental action among fans and host cities.',
      sourceText: 'Major sports events now face pressure to reduce their environmental impact. Organizers are measuring travel emissions, changing stadium operations, and encouraging fans to use public transport. These initiatives are intended not only to lower pollution during events but also to influence long-term behavior in host cities.',
      mainPoints: [
        'Sports events are reducing environmental impact.',
        'Organizers target travel emissions and stadium operations.',
        'The initiatives aim to influence public behavior beyond the event.'
      ]
    },
    scoreRTS: {
      transcript: 'Good morning Professor, I am sorry that my report is delayed because I am still waiting for data from my teammate. Could I send you a short progress update today and submit the final version on Thursday?',
      situationText: 'You promised your professor a report by today, but you are waiting for important data from a teammate. Explain the situation and ask for a short extension.',
      questionId: 'prod-browser-smoke-rts'
    }
  };
}

async function signInOnPage(page, { email, password }) {
  return page.evaluate(async ({ email: userEmail, password: userPassword }) => {
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const auth = window.__FIREBASE_INTERNAL__?.auth || window.auth;
    if (!auth) throw new Error('Firebase auth instance is not available on the production page');
    const credential = await signInWithEmailAndPassword(auth, userEmail, userPassword);
    return { signedIn: Boolean(credential?.user?.uid) };
  }, { email, password });
}

async function runCallableFromPage(page, name, payload) {
  return page.evaluate(async ({ name: functionName, payload: functionPayload }) => {
    const startedAt = Date.now();
    try {
      const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
      const functions = window.__FIREBASE_INTERNAL__?.functions;
      if (!functions) throw new Error('Firebase functions instance is not available on the production page');
      const callable = httpsCallable(functions, functionName);
      const response = await callable(functionPayload);
      const result = response?.data || null;
      return {
        name: functionName,
        latencyMs: Date.now() - startedAt,
        ok: Boolean(result?.success || result?.limited),
        limited: result?.limited === true,
        hasOverall: Boolean(result?.overall),
        hasScore: result?.score !== undefined,
        teacherAdviceChars: String(result?.teacherAdvice || result?.teacherAdviceChat || '').length
      };
    } catch (error) {
      return {
        name: functionName,
        latencyMs: Date.now() - startedAt,
        ok: false,
        errorCode: error?.code || null,
        errorMessage: error?.message || String(error)
      };
    }
  }, { name, payload });
}

(async () => {
  const credentials = parseCredentials();
  const payloads = buildPayloads();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(PRODUCTION_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#panel-tutorials', { timeout: 15000 });
    await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth && window.__FIREBASE_INTERNAL__?.functions), null, { timeout: 15000 });
    const signInState = await signInOnPage(page, credentials);
    assert.strictEqual(signInState.signedIn, true, 'Production page Firebase sign-in should succeed');

    const results = [];
    for (const [name, payload] of Object.entries(payloads)) {
      results.push(await runCallableFromPage(page, name, payload));
    }

    console.log(JSON.stringify({
      productionUrl: PRODUCTION_URL,
      credentialSource: CREDENTIALS_PATH,
      pageTitle: await page.title(),
      results
    }, null, 2));

    const failed = results.filter((result) => !result.ok);
    assert.deepStrictEqual(failed, [], 'All production AI feedback callables should return a success or quota-limited payload');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
