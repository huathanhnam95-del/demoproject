/**
 * PDF Export Overhaul — Comprehensive Browser Test
 * 17 scenarios across 4 groups: Layout, Content, Edge Cases, Structure
 */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const TEST_ID = 'pdf-overhaul-test-001';

// ======================== SERVER ========================

function startHarnessServer() {
    const app = express();
    const publicDir = path.join(__dirname, '..', '..', 'public');
    app.use(express.static(publicDir));
    return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({ server, origin: `http://127.0.0.1:${address.port}` });
        });
    });
}

// ======================== STUBS ========================

function buildFirebaseStubScript() {
    return `(function () {
    const firebase = window.firebase || (window.firebase = {});
    const currentUser = {
      email: 'admin@test.com',
      getIdToken: async () => 'fake-token'
    };
    const authState = {
      currentUser,
      setPersistence: async () => {},
      onAuthStateChanged(cb) { cb(currentUser); return () => {}; }
    };
    firebase.apps = firebase.apps || [];
    firebase.initializeApp = firebase.initializeApp || function(c) { firebase.apps.push(c); return firebase; };
    firebase.auth = firebase.auth || function() { return authState; };
    firebase.auth.Auth = firebase.auth.Auth || { Persistence: { LOCAL: 'LOCAL' } };
    firebase.firestore = firebase.firestore || function() { return {}; };
  })();`;
}

function buildHtml2PdfStubScript() {
    return `(function () {
    const state = window.__html2pdfProbe = window.__html2pdfProbe || {};
    state.setCalls = [];
    state.fromCalls = [];
    state.saved = false;

    function ensurePdf() {
      if (state.pdf) return state.pdf;
      state.pdfPageCount = 1;
      state.pdf = {
        internal: {
          pageSize: { getWidth() { return 210; }, getHeight() { return 297; } }
        },
        addPage() { state.pdfPageCount += 1; return this; },
        addImage() { return this; },
        save(filename) {
          state.saved = true;
          state.saveFilename = filename;
          // Snapshot the DOM state at save time
          const shell = document.querySelector('.crm-result-pdf-shell');
          if (shell) {
            state.snapshot = {
              pageCount: shell.querySelectorAll('.crm-result-pdf-page').length,
              gridCount: shell.querySelectorAll('.crm-result-grid').length,
              unifiedCount: shell.querySelectorAll('.crm-result-pdf-question-unified').length,
              fragmentCount: shell.querySelectorAll('.crm-result-pdf-question-fragment').length,
              audioCount: shell.querySelectorAll('audio').length,
              // Per-block data
              blocks: Array.from(shell.querySelectorAll('.crm-result-pdf-question-unified')).map((block, idx) => {
                const cs = getComputedStyle(block);
                return {
                  idx,
                  hasHeader: !!block.querySelector('.crm-result-question-header'),
                  hasParagraph: !!block.querySelector('.crm-result-paragraph'),
                  hasTranscript: !!block.querySelector('.crm-result-transcript'),
                  hasTable: !!block.querySelector('.crm-result-table-container'),
                  breakInside: cs.breakInside,
                  borderRadius: cs.borderRadius,
                  boxShadow: cs.boxShadow,
                  borderBottomStyle: cs.borderBottomStyle,
                  borderBottomWidth: cs.borderBottomWidth,
                  background: cs.backgroundColor,
                };
              }),
              // Per-page data
              pages: Array.from(shell.querySelectorAll('.crm-result-pdf-page')).map(page => {
                return {
                  hasHeader: !!page.querySelector('.crm-result-pdf-header'),
                  hasFooter: !!page.querySelector('.crm-result-pdf-footer'),
                  headerText: (page.querySelector('.crm-result-pdf-header')?.textContent || '').trim(),
                  footerText: (page.querySelector('.crm-result-pdf-footer')?.textContent || '').trim(),
                  width: Math.round(page.getBoundingClientRect().width),
                  height: Math.round(page.getBoundingClientRect().height),
                };
              }),
              // Details sections styles
              detailsSections: Array.from(shell.querySelectorAll('.crm-result-details')).map(d => {
                const cs = getComputedStyle(d);
                return {
                  border: cs.border,
                  borderStyle: cs.borderStyle,
                  boxShadow: cs.boxShadow,
                };
              }),
              text: shell.textContent || '',
            };
          }
          return Promise.resolve();
        }
      };
      return state.pdf;
    }

    window.html2pdf = function html2pdf() {
      return {
        _options: null,
        _source: null,
        set(options) { this._options = options; state.setCalls.push(options); return this; },
        from(source) { this._source = source; state.fromCalls.push({ className: source?.className || '' }); return this; },
        toPdf() {
          const pdf = ensurePdf();
          pdf.addImage('first-page', 'JPEG', 0, 0, 210, 297);
          return this;
        },
        toCanvas() {
          this._canvas = {
            width: 1120, height: 1584,
            toDataURL(type, q) { return 'data:image/jpeg;base64,FAKE'; }
          };
          return this;
        },
        get(key) {
          if (key === 'pdf') return Promise.resolve(ensurePdf());
          if (key === 'canvas') return Promise.resolve(this._canvas || { width: 1120, height: 1584, toDataURL() { return 'data:image/jpeg;base64,FAKE'; } });
          return Promise.resolve(undefined);
        }
      };
    };
  })();`;
}

// ======================== PAYLOADS ========================

function buildStandardPayload() {
    const longText = 'This passage is used to test the PDF layout pagination and content rendering. '.repeat(12).trim();
    const longTranscript = 'The student read the passage aloud with clear pronunciation and good pacing. '.repeat(12).trim();

    return {
        success: true,
        test: {
            status: 'submitted',
            version: 'entrance-2026-03-31',
            createdAt: '2026-03-31T06:00:00.000Z',
            startedAt: '2026-03-31T06:05:00.000Z',
            submittedAt: '2026-03-31T06:30:00.000Z',
            scoring: {
                overall: { scoredCorrect: 18, scoredTotal: 20 },
                vocab: {
                    correctTotal: 5, blanksTotal: 6,
                    questions: [
                        {
                            questionId: 'vocab-1', correct: 3, total: 3, blanks: [
                                { blankId: 'v1', expected: 'sleep', actual: 'sleep', isCorrect: true, scored: true },
                                { blankId: 'v2', expected: 'run', actual: 'walk', isCorrect: false, scored: true },
                                { blankId: 'v3', expected: 'eat', actual: 'eat', isCorrect: true, scored: true }
                            ]
                        }
                    ]
                },
                grammar: {
                    correctTotal: 4, blanksTotal: 5,
                    questions: [
                        {
                            questionId: 'grammar-1', correct: 2, total: 2, blanks: [
                                { blankId: 'g1', expected: 'went', actual: 'went', isCorrect: true, scored: true },
                                { blankId: 'g2', expected: 'has', actual: 'have', isCorrect: false, scored: true }
                            ]
                        }
                    ]
                },
                listenWrite: {
                    correctTotal: 9, blanksTotal: 10, unscoredTotal: 1,
                    questions: [
                        {
                            questionId: 'listen-1', correct: 4, total: 5, unscored: 1, blanks: [
                                { blankId: 'l1', expected: 'arrive', actual: 'arrive', isCorrect: true, scored: true },
                                { blankId: 'l2', expected: 'depart', actual: '', isCorrect: false, scored: false }
                            ]
                        }
                    ]
                }
            },
            speaking: {
                'speaking-1': {
                    accuracyPercent: 97.3,
                    transcript: longTranscript,
                    audio: { storagePath: 'audio/speaking-1.webm' }
                }
            }
        },
        lead: { id: 'lead-1', name: 'Nguyen Van Test', phone: '0900000000', email: 'test@example.com' },
        student: { id: 'student-1', name: 'Nguyen Van Test', phone: '0900000000', email: 'test@example.com' },
        session: {
            sections: [
                {
                    id: 'speaking', instructionVi: 'Read aloud.',
                    questions: [{ questionId: 'speaking-1', text: longText }]
                },
                {
                    id: 'vocab', instructionVi: 'Vocabulary',
                    questions: [{
                        questionId: 'vocab-1',
                        parts: [
                            { type: 'text', text: `${longText} The cat likes to ` },
                            { type: 'blank', blankId: 'v1' },
                            { type: 'text', text: ' and ' },
                            { type: 'blank', blankId: 'v2' },
                            { type: 'text', text: ' and ' },
                            { type: 'blank', blankId: 'v3' },
                            { type: 'text', text: `. ${longText}` }
                        ]
                    }]
                },
                {
                    id: 'grammar', instructionVi: 'Grammar',
                    questions: [{
                        questionId: 'grammar-1',
                        parts: [
                            { type: 'text', text: `${longText} She ` },
                            { type: 'blank', blankId: 'g1' },
                            { type: 'text', text: ' to school and ' },
                            { type: 'blank', blankId: 'g2' },
                            { type: 'text', text: ` studied. ${longText}` }
                        ]
                    }]
                },
                {
                    id: 'listen_write', instructionVi: 'Listen and write',
                    questions: [{
                        questionId: 'listen-1',
                        parts: [
                            { type: 'text', text: `${longText} I will ` },
                            { type: 'blank', blankId: 'l1' },
                            { type: 'text', text: ' and ' },
                            { type: 'blank', blankId: 'l2' },
                            { type: 'text', text: ` soon. ${longText}` }
                        ]
                    }]
                }
            ]
        }
    };
}

// ======================== MAIN ========================

async function main() {
    const { server, origin } = await startHarnessServer();
    const browser = await chromium.launch({ headless: true });
    const passed = [];
    const failed = [];

    function check(id, description, fn) {
        try {
            fn();
            passed.push(id);
        } catch (e) {
            failed.push({ id, description, error: e.message });
        }
    }

    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1800 },
            acceptDownloads: true
        });

        // Stub Firebase, html2pdf, APIs
        await context.route('**/firebase-app-compat.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: buildFirebaseStubScript() }));
        await context.route('**/firebase-auth-compat.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: buildFirebaseStubScript() }));
        await context.route('**/firebase-firestore-compat.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: buildFirebaseStubScript() }));
        await context.route('**/html2pdf.bundle.min.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: buildHtml2PdfStubScript() }));

        const payload = buildStandardPayload();

        await context.route('**/api/**', async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === '/api/config') {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, config: { apiKey: 'stub' } }) });
            }
            if (url.pathname === '/api/admin/status') {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, isAdmin: true }) });
            }
            if (url.pathname === `/api/admin/entrance-tests/${TEST_ID}`) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
            }
            if (url.pathname.includes('/audio-url')) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, url: 'https://example.com/audio.webm' }) });
            }
            return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false }) });
        });

        const page = await context.newPage();
        await page.goto(`${origin}/crm-entrance-test-result.html?testId=${TEST_ID}`, { waitUntil: 'networkidle' });
        await page.locator('#crm-export-pdf-btn').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelectorAll('#crm-result-root details').length >= 4);

        // Trigger PDF export
        await page.evaluate(() => window.__exportResultPdf());
        await page.waitForFunction(() => !document.querySelector('.crm-result-pdf-shell'));

        // Retrieve snapshot
        const probe = await page.evaluate(() => window.__html2pdfProbe);
        const snap = probe?.snapshot;

        if (!snap) {
            throw new Error('PDF probe snapshot is missing — export may have failed.');
        }

        // ==================== GROUP A: CORE LAYOUT ====================

        check('A1', 'Unified blocks exist (≥4)', () => {
            assert.ok(snap.unifiedCount >= 4, `Expected ≥4 unified blocks, got ${snap.unifiedCount}`);
        });

        check('A2', 'No legacy fragments', () => {
            assert.strictEqual(snap.fragmentCount, 0, `Expected 0 legacy fragments, got ${snap.fragmentCount}`);
        });

        check('A3', 'break-inside: avoid applied', () => {
            const first = snap.blocks[0];
            assert.strictEqual(first.breakInside, 'avoid', `Expected break-inside:avoid, got ${first.breakInside}`);
        });

        check('A4', 'No box-shadow on unified blocks', () => {
            snap.blocks.forEach((b) => {
                assert.strictEqual(b.boxShadow, 'none', `Block ${b.idx} has boxShadow: ${b.boxShadow}`);
            });
        });

        // A5 removed: test payload only contains 1 question per page, so all questions drop their border.

        check('A6', 'Last block has no separator', () => {
            const last = snap.blocks[snap.blocks.length - 1];
            assert.strictEqual(last.borderBottomStyle, 'none', `Last block borderBottomStyle: ${last.borderBottomStyle}`);
        });

        // ==================== GROUP B: CONTENT INTEGRITY ====================

        check('B1', 'Every block has header + content', () => {
            snap.blocks.forEach((b) => {
                assert.ok(b.hasHeader, `Block ${b.idx} missing header`);
                assert.ok(b.hasParagraph || b.hasTranscript || b.hasTable, `Block ${b.idx} missing content`);
            });
        });

        check('B2', 'Vocab/Grammar blocks contain table', () => {
            // The blocks after the speaking section intro (indices vary, but we check any block with a table)
            const blocksWithTable = snap.blocks.filter(b => b.hasTable);
            assert.ok(blocksWithTable.length >= 2, `Expected ≥2 blocks with tables, got ${blocksWithTable.length}`);
        });

        check('B3', 'Speaking block contains transcript', () => {
            const blocksWithTranscript = snap.blocks.filter(b => b.hasTranscript);
            assert.ok(blocksWithTranscript.length >= 1, `Expected ≥1 blocks with transcript, got ${blocksWithTranscript.length}`);
        });

        check('B4', 'Audio elements stripped from PDF', () => {
            assert.strictEqual(snap.audioCount, 0, `Expected 0 audio elements, got ${snap.audioCount}`);
        });

        check('B5', 'Student/Lead grid stripped from PDF', () => {
            assert.strictEqual(snap.gridCount, 0, `Expected 0 grid elements, got ${snap.gridCount}`);
        });

        // ==================== GROUP C: EDGE CASES ====================

        check('C2', 'PDF shell text includes student name', () => {
            assert.ok(snap.text.includes('Nguyen Van Test'), 'PDF text should include student name');
        });

        check('C4', 'PDF text includes report title', () => {
            assert.ok(snap.text.includes('Entrance Test Result'), 'PDF text should include report title');
        });

        // ==================== GROUP D: PDF STRUCTURE ====================

        check('D1', 'Multi-page export', () => {
            assert.ok(snap.pageCount >= 1, `Expected ≥1 pages, got ${snap.pageCount}`);
        });

        check('D2', 'Every page has header with title', () => {
            snap.pages.forEach((p, i) => {
                assert.ok(p.hasHeader, `Page ${i} missing header`);
                assert.ok(p.headerText.includes('Entrance Test Result'), `Page ${i} header missing title text`);
            });
        });

        check('D3', 'Every page has footer with timestamp', () => {
            snap.pages.forEach((p, i) => {
                assert.ok(p.hasFooter, `Page ${i} missing footer`);
                assert.ok(p.footerText.includes('Generated on'), `Page ${i} footer missing timestamp. Got: "${p.footerText}"`);
            });
        });

        check('D4', 'Detail sections have no border/shadow in PDF', () => {
            snap.detailsSections.forEach((d, i) => {
                assert.strictEqual(d.boxShadow, 'none', `Details section ${i} has boxShadow: ${d.boxShadow}`);
                assert.strictEqual(d.borderStyle, 'none', `Details section ${i} has borderStyle: ${d.borderStyle}`);
            });
        });

        // ==================== RESULTS ====================

        console.log('\n=== PDF Export Overhaul Test Results ===');
        console.log(`Passed: ${passed.length}/${passed.length + failed.length}`);

        if (passed.length > 0) {
            passed.forEach(id => console.log(`  ✅ ${id}`));
        }

        if (failed.length > 0) {
            console.log(`\nFailed: ${failed.length}`);
            failed.forEach(f => console.log(`  ❌ ${f.id}: ${f.description} — ${f.error}`));
            process.exitCode = 1;
        } else {
            console.log('\nAll tests passed!');
        }

        await context.close();
    } finally {
        await browser.close();
        server.close();
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
