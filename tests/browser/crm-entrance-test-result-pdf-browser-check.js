const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const TEST_ID = '14947400dbffa3defa47121610d37d49ee5c791b00ae3d98c5a44db1420dec8b';

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

function buildFirebaseStubScript() {
  return `(function () {
    const firebase = window.firebase || (window.firebase = {});
    const currentUser = {
      email: 'admin@example.com',
      getIdToken: async () => 'fake-admin-token'
    };
    const authState = {
      currentUser,
      setPersistence: async () => {},
      onAuthStateChanged(callback) {
        callback(currentUser);
        return () => {};
      }
    };

    firebase.apps = firebase.apps || [];
    firebase.initializeApp = firebase.initializeApp || function initializeApp(config) {
      firebase.apps.push(config);
      return firebase;
    };
    firebase.auth = firebase.auth || function auth() {
      return authState;
    };
    firebase.auth.Auth = firebase.auth.Auth || { Persistence: { LOCAL: 'LOCAL' } };
    firebase.firestore = firebase.firestore || function firestore() {
      return {};
    };
  })();`;
}

function buildHtml2PdfStubScript() {
  return `(function () {
    const state = window.__html2pdfProbe = window.__html2pdfProbe || {};
    state.setCalls = [];
    state.fromCalls = [];
    state.renderCalls = [];
    state.toPdfCount = 0;
    state.toCanvasCount = 0;
    state.pdfAddPageCount = 0;
    state.pdfAddImageCount = 0;
    state.canvasCount = 0;
    state.saved = false;

    function ensurePdf() {
      if (state.pdf) return state.pdf;
      state.pdfPageCount = 1;
      state.pdf = {
        internal: {
          pageSize: {
            getWidth() { return 210; },
            getHeight() { return 297; }
          }
        },
        addPage() {
          state.pdfAddPageCount += 1;
          state.pdfPageCount += 1;
          return this;
        },
        addImage(data, type, x, y, width, height) {
          state.pdfAddImageCount += 1;
          state.lastAddImage = { data, type, x, y, width, height };
          return this;
        },
        save(filename) {
          state.saved = true;
          state.saveFilename = filename;
          const shell = document.querySelector('.crm-result-pdf-shell');
          state.pageCount = shell ? shell.querySelectorAll('.crm-result-pdf-page').length : 0;
          state.gridCount = shell ? shell.querySelectorAll('.crm-result-grid').length : 0;
          state.questionFragmentCount = shell ? shell.querySelectorAll('.crm-result-pdf-question-fragment').length : 0;
          const firstQuestion = shell ? shell.querySelector('.crm-result-pdf-question-fragment') : null;
          state.questionBreakInside = firstQuestion ? getComputedStyle(firstQuestion).breakInside : '';
          state.audioCount = shell ? shell.querySelectorAll('audio').length : 0;
          state.crmHeaderCount = shell ? shell.querySelectorAll('.crm-header').length : 0;
          state.exportBtnCount = shell ? shell.querySelectorAll('.crm-export-btn').length : 0;
          state.sourceText = shell ? (shell.textContent || '') : '';
          return Promise.resolve();
        }
      };
      return state.pdf;
    }

    function createCanvas(source, options) {
      const width = Math.round(options?.html2canvas?.width || source?.getBoundingClientRect?.().width || 0);
      const height = Math.round(options?.html2canvas?.height || source?.getBoundingClientRect?.().height || 0);
      return {
        width,
        height,
        toDataURL(type, quality) {
          state.lastToDataURL = {
            type,
            quality,
            width,
            height,
            sourceClassName: source ? source.className : ''
          };
          return 'data:' + (type || 'image/jpeg') + ';base64,FAKE';
        }
      };
    }

    window.html2pdf = function html2pdf() {
      return {
        _options: null,
        _source: null,
        _canvas: null,
        set(options) {
          this._options = options;
          state.setCalls.push(options);
          return this;
        },
        from(source) {
          this._source = source;
          state.fromCalls.push({
            className: source ? source.className : '',
            width: Math.round(source?.getBoundingClientRect?.().width || 0),
            height: Math.round(source?.getBoundingClientRect?.().height || 0),
            scrollWidth: source ? source.scrollWidth : 0,
            scrollHeight: source ? source.scrollHeight : 0
          });
          return this;
        },
        toPdf() {
          state.toPdfCount += 1;
          state.renderCalls.push({
            kind: 'toPdf',
            sourceClassName: this._source ? this._source.className : '',
            width: this._options?.html2canvas?.width || 0,
            height: this._options?.html2canvas?.height || 0
          });
          const pdf = ensurePdf();
          pdf.addImage('first-page', 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
          return this;
        },
        toCanvas() {
          state.toCanvasCount += 1;
          state.renderCalls.push({
            kind: 'toCanvas',
            sourceClassName: this._source ? this._source.className : '',
            width: this._options?.html2canvas?.width || 0,
            height: this._options?.html2canvas?.height || 0
          });
          this._canvas = createCanvas(this._source, this._options);
          state.canvasCount += 1;
          return this;
        },
        get(key) {
          if (key === 'pdf') return Promise.resolve(ensurePdf());
          if (key === 'canvas') return Promise.resolve(this._canvas || createCanvas(this._source, this._options));
          return Promise.resolve(undefined);
        }
      };
    };
  })();`;
}

function buildApiPayload() {
  const longSpeakingPrompt = 'Please read this sentence aloud. '.repeat(18).trim();
  const longSpeakingTranscript = 'I can read the sentence clearly for the entrance test. '.repeat(18).trim();
  const longObjectiveLead = 'This passage is intentionally long so the PDF exporter must paginate across multiple pages without clipping lines. '.repeat(10).trim();

  return {
    success: true,
    test: {
      status: 'submitted',
      version: 'entrance-2026-03-30',
      createdAt: '2026-03-30T06:15:00.000Z',
      startedAt: '2026-03-30T06:19:00.000Z',
      submittedAt: '2026-03-30T06:33:00.000Z',
      scoring: {
        overall: {
          scoredCorrect: 18,
          scoredTotal: 20
        },
        vocab: {
          correctTotal: 5,
          blanksTotal: 6,
          questions: [
            {
              questionId: 'vocab-1',
              blanks: [
                {
                  blankId: 'vocab-b1',
                  expected: 'sleep',
                  actual: 'sleep',
                  isCorrect: true,
                  scored: true
                }
              ]
            }
          ]
        },
        grammar: {
          correctTotal: 4,
          blanksTotal: 5,
          questions: [
            {
              questionId: 'grammar-1',
              blanks: [
                {
                  blankId: 'grammar-b1',
                  expected: 'went',
                  actual: 'went',
                  isCorrect: true,
                  scored: true
                }
              ]
            }
          ]
        },
        listenWrite: {
          correctTotal: 9,
          blanksTotal: 10,
          unscoredTotal: 1,
          questions: [
            {
              questionId: 'listen-1',
              blanks: [
                {
                  blankId: 'listen-b1',
                  expected: 'arrive',
                  actual: '',
                  isCorrect: false,
                  scored: false
                }
              ]
            }
          ]
        }
      },
      speaking: {
        'speaking-1': {
          accuracyPercent: 97.8,
          transcript: longSpeakingTranscript,
          audio: {
            storagePath: 'audio/speaking-1.webm'
          }
        }
      }
    },
    lead: {
      id: 'lead-1',
      name: 'Bui Do Minh Nguyen',
      phone: '0900000000',
      email: 'student@example.com'
    },
    student: {
      id: 'student-1',
      name: 'Bui Do Minh Nguyen',
      phone: '0900000000',
      email: 'student@example.com',
      label: 'entrance'
    },
    session: {
      sections: [
        {
          id: 'speaking',
          instructionVi: 'Read aloud.',
          questions: [
            {
              questionId: 'speaking-1',
              text: longSpeakingPrompt
            }
          ]
        },
        {
          id: 'vocab',
          instructionVi: 'Vocabulary',
          questions: [
            {
              questionId: 'vocab-1',
              parts: [
                { type: 'text', text: `${longObjectiveLead} The cat likes to ` },
                { type: 'blank', blankId: 'vocab-b1' },
                { type: 'text', text: `. ${longObjectiveLead}` }
              ]
            }
          ]
        },
        {
          id: 'grammar',
          instructionVi: 'Grammar',
          questions: [
            {
              questionId: 'grammar-1',
              parts: [
                { type: 'text', text: `${longObjectiveLead} She ` },
                { type: 'blank', blankId: 'grammar-b1' },
                { type: 'text', text: ` to school yesterday. ${longObjectiveLead}` }
              ]
            }
          ]
        },
        {
          id: 'listen_write',
          instructionVi: 'Listen and write',
          questions: [
            {
              questionId: 'listen-1',
              parts: [
                { type: 'text', text: `${longObjectiveLead} I will ` },
                { type: 'blank', blankId: 'listen-b1' },
                { type: 'text', text: ` soon. ${longObjectiveLead}` }
              ]
            }
          ]
        }
      ]
    }
  };
}

async function main() {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1800 },
      acceptDownloads: true
    });

    await context.addInitScript(() => {
      window.__html2pdfProbe = window.__html2pdfProbe || {};
    });

    await context.route('**/firebase-app-compat.js*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildFirebaseStubScript()
      });
    });

    await context.route('**/firebase-auth-compat.js*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildFirebaseStubScript()
      });
    });

    await context.route('**/firebase-firestore-compat.js*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildFirebaseStubScript()
      });
    });

    await context.route('**/html2pdf.bundle.min.js*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildHtml2PdfStubScript()
      });
    });

    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const payload = buildApiPayload();

      if (url.pathname === '/api/config') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            config: {
              apiKey: 'stub-api-key'
            }
          })
        });
        return;
      }

      if (url.pathname === '/api/admin/status') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            isAdmin: true
          })
        });
        return;
      }

      if (url.pathname === `/api/admin/entrance-tests/${TEST_ID}`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload)
        });
        return;
      }

      if (url.pathname === `/api/admin/entrance-tests/${TEST_ID}/speaking/speaking-1/audio-url`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            url: 'https://example.com/audio/speaking-1.webm'
          })
        });
        return;
      }

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: `Unexpected API route: ${url.pathname}`
        })
      });
    });

    const page = await context.newPage();
    const pageUrl = `${origin}/crm-entrance-test-result.html?testId=${TEST_ID}`;
    await page.goto(pageUrl, { waitUntil: 'networkidle' });

    await page.locator('#crm-export-pdf-btn').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('#crm-result-root details').length >= 4);

    await page.evaluate(() => window.__exportResultPdf());

    await page.waitForFunction(() => !document.querySelector('.crm-result-pdf-shell'));

    const probe = await page.evaluate(() => window.__html2pdfProbe);

    assert(probe, 'PDF export probe data should be available.');
    assert.ok(Array.isArray(probe.setCalls) && probe.setCalls.length >= 1, 'PDF export should create at least one html2pdf worker call.');
    assert.ok(Array.isArray(probe.fromCalls) && probe.fromCalls.length >= 1, 'PDF export should render at least one page node.');
    assert.strictEqual(probe.toPdfCount, 1, 'PDF export should create the initial PDF exactly once.');
    assert.strictEqual(probe.toCanvasCount, Math.max(probe.fromCalls.length - 1, 0), 'PDF export should render later pages as canvases.');
    assert.strictEqual(probe.pdfAddPageCount, Math.max(probe.fromCalls.length - 1, 0), 'PDF export should add one jsPDF page for each additional rendered page.');
    assert.strictEqual(probe.pdfAddImageCount, probe.fromCalls.length, 'PDF export should draw one image per rendered PDF page.');
    assert.ok(Array.isArray(probe.renderCalls) && probe.renderCalls.length === probe.fromCalls.length, 'PDF export should record one render call per page node.');
    assert.ok(probe.pageCount > 1, 'The sample export should span multiple PDF pages.');
    assert.ok(probe.renderCalls.every((call) => call.sourceClassName === 'crm-result-pdf-page'), 'Each render call should target a dedicated PDF page wrapper.');
    assert.ok(probe.renderCalls.every((call) => call.width === 1120), `Each render call should use the fixed 1120px PDF page width. Got: ${JSON.stringify(probe.renderCalls.map((call) => call.width))}`);
    assert.ok(probe.renderCalls.every((call) => call.height === 1584), `Each render call should use the fixed 1584px PDF page height. Got: ${JSON.stringify(probe.renderCalls.map((call) => call.height))}`);
    assert.strictEqual(probe.setCalls.every((call) => call?.html2canvas?.windowWidth === undefined), true, 'html2canvas should not force windowWidth because that shrinks wide-screen captures.');
    assert.strictEqual(probe.setCalls.every((call) => call?.html2canvas?.width === 1120), true, 'html2canvas should pin width to each PDF page width.');
    assert.strictEqual(probe.setCalls.every((call) => call?.html2canvas?.height === 1584), true, 'html2canvas should pin height to each PDF page height.');
    assert.strictEqual(probe.setCalls.every((call) => call?.pagebreak === undefined), true, 'Per-page rendering should not depend on html2pdf page-break mode.');
    assert.strictEqual(probe.pageCount, probe.fromCalls.length, 'Export shell page count should match the number of rendered page nodes.');
    assert.strictEqual(probe.gridCount, 0, 'PDF capture should omit the lead and student card grid.');
    assert.ok(probe.questionFragmentCount >= 4, 'PDF capture should split questions into safe fragments for pagination.');
    assert.strictEqual(probe.questionBreakInside, 'avoid', 'Individual questions should stay intact within the PDF capture.');
    assert.strictEqual(probe.audioCount, 0, 'Audio players should be removed from the PDF capture.');
    assert.strictEqual(probe.crmHeaderCount, 0, 'Live CRM header controls should not be inside the PDF capture.');
    assert.strictEqual(probe.exportBtnCount, 0, 'Export button should not be inside the PDF capture.');
    assert.match(probe.sourceText || '', /Entrance Test Result/, 'PDF shell should include the report header.');
    assert.match(probe.sourceText || '', /Bui Do Minh Nguyen/, 'PDF shell should still include the student name in the header.');
    assert.match(probe.sourceText || '', /Generated on/, 'PDF shell should include the generated timestamp footer.');
    assert.ok(!/Enquiry/.test(probe.sourceText || ''), 'PDF shell should exclude the enquiry card.');
    assert.ok(!/Student\s*\n/.test(probe.sourceText || ''), 'PDF shell should not include the full Student card.');

    console.log('crm entrance test pdf browser check passed');

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
