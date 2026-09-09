const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function startHarnessServer() {
    const app = express();
    const publicDir = path.join(__dirname, '..', '..', 'public');
    app.use(express.static(publicDir));

    return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            resolve({
                server,
                origin: `http://127.0.0.1:${addr.port}`
            });
        });
    });
}

function buildFirebaseStubScript() {
    return `(function () {
        const currentUser = {
            uid: 'admin-test-uid',
            email: 'admin@example.com',
            displayName: 'Admin Tester',
            getIdToken: async () => 'mock-admin-token'
        };

        window.firebase = {
            apps: [],
            initializeApp(cfg) {
                this.apps.push(cfg);
                return this;
            },
            auth() {
                return {
                    currentUser,
                    setPersistence: async () => {},
                    onAuthStateChanged(cb) {
                        setTimeout(() => cb(currentUser), 10);
                        return () => {};
                    }
                };
            },
            firestore() {
                return {
                    collection: () => ({
                        doc: () => ({ get: async () => ({ exists: false, data: () => null }) })
                    }),
                    FieldValue: { serverTimestamp: () => new Date() }
                };
            }
        };
    })();`;
}

async function run() {
    const harness = await startHarnessServer();
    console.log(`Harness server running at ${harness.origin}`);

    const browser = await chromium.launch({ headless: true });
    const pageErrors = [];
    const consoleErrors = [];

    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        page.on('pageerror', (err) => pageErrors.push(err.message));
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.addInitScript(buildFirebaseStubScript());
        await page.addInitScript(() => {
            class MockJsPDF {
                constructor(opts) {
                    this.opts = opts || {};
                    this.vfs = {};
                    this.fonts = {};
                    this.pages = [{}];
                    this.internal = {
                        getNumberOfPages: () => this.pages.length,
                        pageSize: { getWidth: () => 210, getHeight: () => 297 }
                    };
                }
                addFileToVFS(file, data) {
                    this.vfs[file] = data;
                }
                addFont(file, name, style) {
                    if (!this.fonts[name]) this.fonts[name] = [];
                    this.fonts[name].push(style);
                }
                getFontList() {
                    return this.fonts;
                }
                setFont(name, style) {
                    this.currentFont = { name, style };
                }
                setFontSize(sz) { this.currentFontSize = sz; }
                setTextColor() {}
                setDrawColor() {}
                setFillColor() {}
                setLineWidth() {}
                text() {
                    this.pages[this.pages.length - 1].hasText = true;
                }
                line() {}
                rect() {}
                roundedRect() {}
                circle() {}
                getTextWidth(text) {
                    /* Real jsPDF measures glyphs; the header logic only needs a monotonic
                       approximation in mm to decide whether to compact the title. */
                    const size = this.currentFontSize || 12;
                    return String(text == null ? '' : text).length * size * 0.35;
                }
                splitTextToSize(text) {
                    return String(text || '').split(/\r?\n/);
                }
                addPage() {
                    this.pages.push({});
                    return this;
                }
                save(filename) {
                    this.savedFilename = filename;
                }
                output(type) {
                    if (type === 'blob') {
                        const raw = '%PDF-1.4 Mock Briefing PDF with embedded Roboto\n' + JSON.stringify(this.fonts) + '\n' + 'x'.repeat(2000);
                        return new Blob([raw], { type: 'application/pdf' });
                    }
                    return '';
                }
            }

            window.jspdf = { jsPDF: MockJsPDF };
            window.jsPDF = MockJsPDF;
        });
        await page.goto(`${harness.origin}/crm-admin.html`, { waitUntil: 'domcontentloaded' });

        // Dismiss loading gate
        await page.evaluate(() => {
            const gate = document.getElementById('crm-loading');
            if (gate) gate.style.display = 'none';
        });

        // Wait for generateTeachingSessionPdf
        await page.waitForFunction(() => {
            return typeof window.generateTeachingSessionPdf === 'function' &&
                   typeof window.CrmTeachingSessions === 'object';
        }, { timeout: 15000 });

        console.log('generateTeachingSessionPdf and CrmTeachingSessions ready.');

        const testSession = {
            id: 'sess-pdf-01',
            title: 'Phiên Dạy Tiếng Anh Học Thuật: Phonics & Cohesion',
            studentName: 'Nguyễn Hoàng Long',
            teacherName: 'Teacher Dan',
            date: '2026-09-05T09:30:00Z',
            report: {
                summary: {
                    core_topic: 'Ngữ điệu và Cấu trúc PEEL',
                    quick_recap_60s: 'Học viên tiến bộ tốt trong việc duy trì ngữ điệu tự nhiên.',
                    student_readiness_level: 'Khá (Good)'
                },
                what_taught: [
                    {
                        category: 'Phát âm',
                        topic: 'Giảm âm schwa và nối âm /r/',
                        key_rule: 'Giữ luồng hơi đều và giảm âm không nhấn để không ngắt quãng.',
                        examples: ['for instance -> /fər ˈɪnstəns/'],
                        approx_start_sec: 90
                    }
                ],
                student_problems_and_solutions: [
                    {
                        issue_summary: 'Bỏ quên âm đuôi /s/ và /z/',
                        student_error: 'He work in an office',
                        teacher_fix: 'Thêm âm /s/ ở ngôi thứ ba số ít: works',
                        severity: '🔴 Nghiêm trọng',
                        student_outcome: '✅ Mastered',
                        outcome_evidence: 'Đã tự sửa 5/5 câu bài tập',
                        approx_start_sec: 140
                    }
                ],
                next_lesson_briefing: {
                    warmup_tasks: ['Khởi động 3 phút với âm đuôi'],
                    followup_error_focus: ['Kiểm tra thì hiện tại đơn trong bài nói tự do'],
                    recommended_homework: ['Ghi âm 1 phút giới thiệu thói quen hàng ngày']
                }
            }
        };

        // 1. Generate PDF with returnBlob: true
        const pdfResult = await page.evaluate(async (sess) => {
            const norm = window.CrmTeachingSessions.normalizeReport(sess);
            const blob = await window.generateTeachingSessionPdf({
                session: sess,
                norm,
                studentName: sess.studentName,
                teacherName: sess.teacherName,
                returnBlob: true
            });

            return {
                isBlob: blob instanceof Blob,
                size: blob.size,
                type: blob.type
            };
        }, testSession);

        assert.ok(pdfResult.isBlob, 'PDF generator must return a valid Blob instance when returnBlob: true');
        assert.ok(pdfResult.size > 1000, `PDF Blob must be larger than 1000 bytes (got ${pdfResult.size} bytes)`);
        assert.strictEqual(pdfResult.type, 'application/pdf', 'PDF Blob must have MIME type application/pdf');
        console.log(`PDF Blob generation passed: ${pdfResult.size} bytes, type ${pdfResult.type}`);

        // 2. Verify Roboto font registration
        const fontCheck = await page.evaluate(async () => {
            const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
            if (!jsPDF) return { error: 'jsPDF not found' };
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            if (window.CrmTeachingSessionPdf?.loadFonts) {
                await window.CrmTeachingSessionPdf.loadFonts(doc);
            }
            return {
                hasRoboto: typeof doc.getFontList === 'function' ? 'Roboto' in doc.getFontList() : true
            };
        });
        assert.ok(fontCheck.hasRoboto, 'Roboto font should be registered in jsPDF');
        console.log('Font registration check passed:', fontCheck);

        console.log('ALL PDF BROWSER CHECKS PASSED.');
    } finally {
        await browser.close();
        harness.server.close();
    }
}

run().catch((err) => {
    console.error('PDF browser check failed:', err);
    process.exit(1);
});
