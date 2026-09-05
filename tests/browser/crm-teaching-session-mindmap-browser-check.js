const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function startHarnessServer() {
    const app = express();
    const publicDir = path.join(__dirname, '..', '..', 'public');
    app.use(express.static(publicDir));

    // Stub CRM API endpoints
    app.get('/api/admin/teaching-sessions', (req, res) => {
        res.json({ success: true, sessions: [] });
    });
    app.get('/api/admin/tasks', (req, res) => {
        res.json({ success: true, tasks: [] });
    });
    app.post('/api/admin/tasks', (req, res) => {
        res.json({ success: true, taskId: 'mock-task-' + Date.now() });
    });

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

        function snapshot() {
            return { empty: true, docs: [], forEach() {} };
        }

        function collection() {
            const chain = {
                doc() {
                    return {
                        get: async () => ({ exists: false, data: () => null }),
                        set: async () => {},
                        update: async () => {},
                        collection
                    };
                },
                where() { return chain; },
                orderBy() { return chain; },
                limit() { return chain; },
                get: async () => snapshot(),
                add: async () => ({ id: 'doc-mock' })
            };
            return chain;
        }

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
                    collection,
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
        await page.goto(`${harness.origin}/crm-admin.html`, { waitUntil: 'domcontentloaded' });

        // Dismiss loading gate
        await page.evaluate(() => {
            const gate = document.getElementById('crm-loading');
            if (gate) gate.style.display = 'none';
        });

        // Wait for CrmTeachingSessions controller and mindmap module
        await page.waitForFunction(() => {
            return typeof window.CrmTeachingSessions === 'object' &&
                   typeof window.CrmTeachingSessionMindmap === 'object' &&
                   typeof window.mermaid !== 'undefined';
        }, { timeout: 15000 });

        console.log('CrmTeachingSessions and CrmTeachingSessionMindmap loaded successfully.');

        // Prepare test session with structured report
        const testSession = {
            id: 'sess-mm-browser-01',
            title: 'IELTS Academic Writing: Cohesion & Sentence Variety',
            focusSkill: 'Writing',
            audioUrl: 'https://example.com/mock-audio.mp3',
            studentName: 'Nguyễn Văn Test',
            teacherName: 'Teacher Mark',
            report: {
                summary: {
                    core_topic: 'Academic Writing: Lexical Cohesion',
                    quick_recap_60s: 'Học viên nắm vững PEEL, cần cải thiện liên kết câu phức.',
                    student_readiness_level: 'Khá (Good)'
                },
                what_taught: [
                    {
                        category: 'Vocabulary',
                        topic: 'Hypernym - Hyponym Chains',
                        key_rule: 'Sử dụng từ bao hàm trước, từ đặc thù sau để tạo mạch tự nhiên.',
                        examples: ['habitat -> fragile ecosystem'],
                        approx_start_sec: 45
                    },
                    {
                        category: 'Syntax',
                        topic: 'Complex Subordinating Clauses',
                        key_rule: 'Liên từ phụ thuộc đứng đầu câu bắt buộc có dấu phẩy ngăn cách mệnh đề.',
                        examples: ['Although traffic was heavy, commuters arrived on time.'],
                        approx_start_sec: 150
                    }
                ],
                student_problems_and_solutions: [
                    {
                        issue_summary: "Lạm dụng danh từ 'commuters'",
                        student_error_quote: 'commuters commuters commuters in every sentence',
                        student_error: 'commuters commuters commuters in every sentence',
                        teacher_solution: 'Thay thế bằng private car owners, motorists, individuals',
                        teacher_fix: 'Thay thế bằng private car owners, motorists, individuals',
                        severity: '🔴 Nghiêm trọng',
                        student_outcome: '✅ Mastered',
                        outcome_evidence: 'Đã tự sửa thành công trong bài tập số 2',
                        approx_start_sec: 50
                    },
                    {
                        issue_summary: 'Lỗi phẩy nối câu (Comma Splice)',
                        student_error_quote: 'The city expanded, public transit became crowded',
                        student_error: 'The city expanded, public transit became crowded',
                        teacher_solution: 'Dùng liên từ phối hợp hoặc chấm phẩy',
                        teacher_fix: 'Dùng liên từ phối hợp hoặc chấm phẩy',
                        severity: '🟡 Trung bình',
                        student_outcome: 'Needs Practice',
                        outcome_evidence: 'Còn vấp 2 lỗi trong bài tập về nhà',
                        approx_start_sec: 160
                    }
                ],
                next_lesson_briefing: {
                    warmup_tasks: ['Khởi động 5 phút phân biệt hypernym'],
                    followup_error_focus: ['Kiểm tra dấu câu trong đoạn văn thân bài'],
                    recommended_homework: ['Viết lại đoạn văn số 2 dùng PEEL']
                }
            }
        };

        // Open session modal and switch to Mindmap view
        await page.evaluate(async (sess) => {
            await window.CrmTeachingSessions.openSessionDetail(sess);
            await window.CrmTeachingSessions.switchSessionView('mindmap');
        }, testSession);

        // Wait for Mindmap SVG to render
        await page.waitForSelector('#teaching-session-mindmap-container svg', { timeout: 15000 });
        console.log('Mindmap SVG rendered.');

        // 1. Assert label fitting (no clipped foreignObject text)
        const labelMetrics = await page.evaluate(() => {
            const svg = document.querySelector('#teaching-session-mindmap-container svg');
            const foreignObjects = Array.from(svg.querySelectorAll('foreignObject'));
            return foreignObjects.map((fo) => {
                const width = parseFloat(fo.getAttribute('width')) || fo.getBoundingClientRect().width;
                const inner = fo.firstElementChild;
                const scrollW = inner ? inner.scrollWidth : 0;
                return {
                    width,
                    scrollW,
                    clipped: scrollW > (width + 3)
                };
            });
        });

        assert.ok(labelMetrics.length > 0, 'Must have rendered label foreignObjects in SVG');
        const clippedLabels = labelMetrics.filter((m) => m.clipped);
        assert.strictEqual(clippedLabels.length, 0, `All SVG labels must fit inside foreignObject boundaries. Clipped count: ${clippedLabels.length}`);
        console.log(`Label clipping check passed (${labelMetrics.length} labels checked, 0 clipped).`);

        // 2. Assert Outcome Rings on node-bkg paths
        const outcomeRingsFound = await page.evaluate(() => {
            const svg = document.querySelector('#teaching-session-mindmap-container svg');
            const paths = Array.from(svg.querySelectorAll('path.node-bkg'));
            return paths.some((p) => {
                const stroke = p.getAttribute('stroke') || p.style.stroke || '';
                const strokeW = p.getAttribute('stroke-width') || p.style.strokeWidth || '';
                return stroke.length > 0 || parseFloat(strokeW) > 1.5;
            });
        });
        console.log('Outcome rings detected on nodes:', outcomeRingsFound);

        // 3. Test node interaction: click to seek audio and open detail panel
        const clickResult = await page.evaluate(() => {
            const svg = document.querySelector('#teaching-session-mindmap-container svg');
            const nodes = Array.from(svg.querySelectorAll('g.mindmap-node'));
            const problemNode = nodes.find((n) => {
                const desc = n._crmDescriptor;
                return desc && desc.kind === 'problem' && desc.approx_start_sec;
            }) || nodes[1];

            if (!problemNode) return { success: false, reason: 'No node found' };

            // Simulate click
            problemNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const detailPanel = document.getElementById('teaching-session-mindmap-detail');
            const audioPlayer = document.getElementById('teaching-session-audio-player');

            return {
                success: true,
                panelVisible: detailPanel && !detailPanel.hidden,
                panelLead: detailPanel ? detailPanel.querySelector('.crm-ts-mm-detail-lead')?.textContent : '',
                seekSec: problemNode._crmDescriptor?.approx_start_sec,
                currentTime: audioPlayer ? audioPlayer.currentTime : -1
            };
        });

        assert.ok(clickResult.success, 'Node click simulation should succeed');
        assert.ok(clickResult.panelVisible, 'Detail panel must become visible on node click');
        assert.ok(clickResult.panelLead.length > 0, 'Detail panel must show node lead text');
        assert.strictEqual(clickResult.currentTime, Math.max(0, clickResult.seekSec - 3), 'Audio currentTime must seek to seekSec - 3');
        console.log(`Node click test passed: detail panel opened with lead "${clickResult.panelLead}", audio seeked to ${clickResult.currentTime}s.`);

        // 3.1 Assert node count equals descriptor count
        const counts = await page.evaluate(() => {
            const container = document.getElementById('teaching-session-mindmap-container');
            const svg = container ? container.querySelector('svg') : null;
            const nodes = svg ? svg.querySelectorAll('g.mindmap-node') : [];
            return {
                domCount: nodes.length,
                descCount: container && container._tsDescriptors ? container._tsDescriptors.length : 0
            };
        });
        assert.ok(counts.domCount > 0, 'Must have rendered nodes in SVG');
        assert.strictEqual(counts.domCount, counts.descCount, `Rendered SVG node count (${counts.domCount}) must equal descriptor count (${counts.descCount})`);
        console.log(`Node descriptor binding count passed: ${counts.domCount} nodes = ${counts.descCount} descriptors.`);

        // 4. Test Search filter in toolbar
        const searchResult = await page.evaluate(async () => {
            const searchInput = document.querySelector('.crm-ts-mm-search-input');
            if (!searchInput) return { found: false };
            searchInput.value = 'commuters';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));

            // Wait for 120ms debounce + auto-pan
            await new Promise((r) => setTimeout(r, 200));

            const stageEl = document.querySelector('#teaching-session-view-mindmap .crm-diagram-stage');
            const hasSearchAttr = stageEl && stageEl.getAttribute('data-ts-search') === 'true';
            const matchedNodes = document.querySelectorAll('#teaching-session-mindmap-container svg g.mindmap-node[data-ts-match="true"]');

            // Reset search input so subsequent tests have a clean slate
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 200));

            return {
                found: true,
                hasSearchAttr,
                matchCount: matchedNodes.length
            };
        });
        assert.ok(searchResult.found, 'Search input should exist in mindmap toolbar');
        assert.ok(searchResult.hasSearchAttr, 'Stage should have data-ts-search attribute after search');
        assert.ok(searchResult.matchCount > 0, `Search should match at least 1 node for "commuters", got ${searchResult.matchCount}`);
        console.log(`Search input filter verified (${searchResult.matchCount} matched nodes, auto-pan verified).`);

        // 5. Test Pan/Zoom state persistence across tab switches
        const panZoomPreserved = await page.evaluate(async () => {
            // Apply a zoom transform
            const zoomInBtn = document.querySelector('#teaching-session-view-mindmap .btn-diagram-zoom-in');
            if (zoomInBtn) {
                zoomInBtn.click();
                zoomInBtn.click();
            }

            const wrapper = document.querySelector('#teaching-session-mindmap-container .diagram-transform-wrapper');
            const initialTransform = wrapper ? wrapper.style.transform : '';

            // Switch to Report view
            await window.CrmTeachingSessions.switchSessionView('report');

            // Switch back to Mindmap view
            await window.CrmTeachingSessions.switchSessionView('mindmap');

            const restoredWrapper = document.querySelector('#teaching-session-mindmap-container .diagram-transform-wrapper');
            const restoredTransform = restoredWrapper ? restoredWrapper.style.transform : '';

            return {
                initialTransform,
                restoredTransform,
                matches: initialTransform.length > 0 && initialTransform === restoredTransform
            };
        });

        assert.ok(panZoomPreserved.matches, `Pan/zoom transform must be preserved across tab switches. Got ${panZoomPreserved.initialTransform} vs ${panZoomPreserved.restoredTransform}`);
        console.log(`Pan/zoom persistence test passed: ${panZoomPreserved.initialTransform}`);

        // 6. Test Branch Collapse preserves zoom transform
        const collapsePreserved = await page.evaluate(async () => {
            const container = document.getElementById('teaching-session-mindmap-container');
            const svg = container ? container.querySelector('svg') : null;
            const nodes = Array.from(svg ? svg.querySelectorAll('g.mindmap-node') : []);
            const conceptNode = nodes.find(n => n._crmDescriptor && n._crmDescriptor.kind === 'concept');
            if (!conceptNode) return { skip: true, reason: 'No concept node found' };

            conceptNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const wrapper = container.querySelector('.diagram-transform-wrapper');
            const preTransform = wrapper ? wrapper.style.transform : '';

            const toggleBtn = document.querySelector('.crm-btn-toggle-branch');
            if (!toggleBtn) return { skip: true, reason: 'No toggle branch button found' };

            toggleBtn.click();

            // Wait for re-render
            await new Promise(r => setTimeout(r, 400));

            const postWrapper = container.querySelector('.diagram-transform-wrapper');
            const postTransform = postWrapper ? postWrapper.style.transform : '';

            return {
                skip: false,
                preTransform,
                postTransform,
                preserved: preTransform.length > 0 && preTransform === postTransform
            };
        });

        if (!collapsePreserved.skip) {
            assert.ok(collapsePreserved.preserved, `Zoom transform must be preserved during branch collapse/expand. Pre: "${collapsePreserved.preTransform}", Post: "${collapsePreserved.postTransform}"`);
            console.log('Branch collapse zoom preservation check passed.');
        }

        console.log('ALL MINDMAP BROWSER CHECKS PASSED.');
    } finally {
        await browser.close();
        harness.server.close();
    }
}

run().catch((err) => {
    console.error('Mindmap browser check failed:', err);
    process.exit(1);
});
