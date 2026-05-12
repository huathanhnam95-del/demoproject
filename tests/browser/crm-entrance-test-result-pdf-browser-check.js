const assert = require('assert');
const express = require('express');
const fs = require('fs');
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
          state.questionUnifiedCount = shell ? shell.querySelectorAll('.crm-result-pdf-question-unified').length : 0;
          const firstQuestion = shell ? shell.querySelector('.crm-result-pdf-question-unified') : null;
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
        headers: {
          'access-control-allow-origin': '*'
        },
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

    const boot = await page.evaluate(() => ({
      hasJsPdfGlobal: !!(window.jspdf && window.jspdf.jsPDF),
      hasGenerator: typeof window.generateEntranceTestPdf === 'function'
    }));
    assert.ok(boot.hasJsPdfGlobal, 'Expected jsPDF global to be available.');
    assert.ok(boot.hasGenerator, 'Expected PDF generator to be available.');

    fs.mkdirSync('tmp', { recursive: true });
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.click('#crm-export-pdf-btn');
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    assert.ok(/\.pdf$/i.test(filename), `Expected a .pdf download filename. Got: ${filename}`);
    assert.ok(/^entrance-test-/i.test(filename), `Expected entrance test pdf filename prefix. Got: ${filename}`);
    const savePath = path.join('tmp', 'crm-entrance-test-result.pdf');
    await download.saveAs(savePath);
    const stat = fs.statSync(savePath);
    assert.ok(stat.size > 1024, `Expected non-trivial PDF download. size=${stat.size}`);

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
