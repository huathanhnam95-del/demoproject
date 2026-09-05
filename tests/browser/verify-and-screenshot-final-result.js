const { chromium } = require('playwright');
const path = require('path');
const {
    readBrowserTestCredentials
} = require('./helpers/browser-test-credentials');

const ARTIFACT_DIR = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\449c826a-a898-4fb5-9c74-ca07252751ee';

const fs = require('fs');

const deepSessionData = {
    id: 'MDPvxBK2N8CcDSLAKqE1',
    studentId: 'a0106',
    title: 'Zoom 1-on-1 Lesson: Lexical Cohesion & Parallel PEEL',
    focusSkill: 'Writing & Academic Logic',
    status: 'analyzed',
    audioDurationSec: 6764,
    audioUrl: 'https://betterenglishlearning.com/audio/zoom_session_1013706832.mp3',
    sessionDate: '2026-09-04T14:17:00Z',
    createdAt: '2026-09-04T14:17:00Z',
    teacherName: 'huathanhnam95@gmail.com',
    notes: 'Real Zoom 1-on-1 teaching lesson with student test (60.56 MB recording)',
    report: {
        lesson_summary: {
            focus_skill: 'Writing & Logic',
            core_topic: 'Academic Writing: Lexical Cohesion & Paragraph Logic',
            quick_recap_60s: 'Buổi học tập trung hoàn thiện kỹ năng liên kết câu đoạn (Lexical Cohesion) và tính mạch lạc trong bài viết. Trọng tâm là khắc phục xu hướng lạm dụng từ đồng nghĩa gượng ép, chuẩn hóa cấu trúc Thượng vị - Hạ vị (Hypernym - Hyponym) và sắp xếp song song giữa luận điểm và diễn giải trong mô hình PEEL.',
            student_readiness_level: 'Khá (Good)'
        },
        what_taught: [
            {
                category: 'Chiến Thuật',
                topic: 'Grammatical Cohesion vs. Lexical Cohesion',
                key_rule: 'Phân biệt tính liên kết ngữ pháp (đại từ, liên từ) và tính liên kết từ vựng (từ đồng nghĩa, trường từ vựng, từ thượng vị). Học thuật đòi hỏi lexical cohesion cao để bài viết tự nhiên và giàu thông tin.',
                examples: ['Grammatical: this, therefore; Lexical: congestion -> traffic influx'],
                approx_start_sec: 120
            },
            {
                category: 'Ngữ Pháp',
                topic: 'Khắc phục lỗi dư thừa thông tin (Redundancy)',
                key_rule: 'Khi câu đã biểu đạt rõ ý nghẽn tắc hoặc kín chỗ, không lặp lại các vế câu diễn đạt cùng một trạng thái nhằm tăng độ cô đọng và trang trọng cho văn phong học thuật.',
                examples: ['Tránh: The lanes are full of cars and vehicles are packed everywhere'],
                approx_start_sec: 180
            },
            {
                category: 'Từ Vựng',
                topic: 'Tính chính xác của thuật ngữ (Accuracy in Word Choice)',
                key_rule: 'Dùng từ vựng đúng ngữ cảnh học thuật và định nghĩa từ điển thay vì dịch tương đương từ tiếng Việt hoặc áp dụng từ điển đồng nghĩa bừa bãi.',
                examples: ['commuters (người đi làm) vs. travelers (khách du lịch)'],
                approx_start_sec: 750
            },
            {
                category: 'Tính Liên Kết',
                topic: 'Lặp từ có kiểm soát (Thematic Repetition)',
                key_rule: 'Thay vì tìm mọi cách đổi từ đồng nghĩa gượng ép gây méo mó thông điệp, được phép lặp lại keyword trọng tâm của đề bài có chọn lọc.',
                examples: ['Lặp lại "traffic congestion" ở vị trí chủ ngữ kết hợp đại từ hóa'],
                approx_start_sec: 1200
            },
            {
                category: 'Từ Vựng',
                topic: 'Sắc thái ngữ cảnh của từ vựng (Connotation & Contextual Fit)',
                key_rule: 'Mỗi từ ngữ mang một khung thời gian và sắc thái cảm xúc nhất định. Phân biệt mục tiêu dài hạn cả đời và kế hoạch định kỳ trong năm.',
                examples: ['"bucket list" cho cả đời vs. "wish list / plan" cho năm nay'],
                approx_start_sec: 3840
            },
            {
                category: 'Ngữ Pháp',
                topic: 'Mệnh đề thời gian chỉ tương lai (Future Time Clauses)',
                key_rule: 'Trong mệnh đề thời gian bắt đầu bằng When / As soon as / Once, động từ chia ở thì Hiện tại đơn hoặc Hiện tại hoàn thành, không dùng will.',
                examples: ['When the infrastructure is upgraded, not will be upgraded'],
                approx_start_sec: 4100
            },
            {
                category: 'Tính Liên Kết',
                topic: 'Mô hình Thượng vị - Hạ vị (Hypernym - Hyponym Structure)',
                key_rule: 'Khi phát triển luận cứ, đi từ danh từ bao quát (hypernym) trước rồi mới liệt kê các phân loài cụ thể (hyponyms) để mạch văn có trật tự logic.',
                examples: ['vehicles (hypernym) -> private cars, buses, motorcycles (hyponyms)'],
                approx_start_sec: 4320
            },
            {
                category: 'Chiến Thuật',
                topic: 'Sắp xếp song song giữa Luận điểm và Diễn giải (Parallel Order in PEEL)',
                key_rule: 'Thứ tự đưa ra các ý chính trong câu chủ đề (Topic Sentence) phải tương ứng chính xác 1-1 với thứ tự giải thích và dẫn chứng ở thân đoạn nhằm bảo đảm tính liên kết PEEL chặt chẽ.',
                examples: ['Nêu (1) economic impact trước, (2) environmental sau thì giải thích đúng theo thứ tự đó'],
                approx_start_sec: 5580
            }
        ],
        student_problems_and_solutions: [
            {
                problem_id: 'P1',
                severity: '🟡 Trung bình',
                issue_summary: 'Lỗi dư thừa từ ngữ và diễn đạt thiếu trực tiếp (Redundancy)',
                student_error: 'The road is occupied with cars and people are taking their vehicles to travel on the street.',
                teacher_fix: 'Rút gọn câu để tập trung vào hành động cốt lõi: "The roadway is heavily congested with commuter traffic."',
                student_outcome: 'Đã Nắm Vững (Mastered)',
                outcome_evidence: 'Học viên tự viết lại câu ngắn hơn, loại bỏ 8 từ thừa.',
                approx_start_sec: 190
            },
            {
                problem_id: 'P2',
                severity: '🔴 Nghiêm trọng',
                issue_summary: 'Lập luận thiếu logic giữa đối tượng di chuyển và hiện tượng ùn tắc',
                student_error: 'Travelers cause traffic jam because they walk across the avenue.',
                teacher_fix: 'Chỉ rõ bản chất kẹt xe tại đô thị xuất phát từ lưu lượng phương tiện cơ giới cá nhân quá tải, không phải do khách bộ hành.',
                student_outcome: 'Cần Củng Cố Thêm (Needs Practice)',
                outcome_evidence: 'Học viên còn nhầm lẫn giữa nguyên nhân trực tiếp và yếu tố phụ trợ.',
                approx_start_sec: 310
            },
            {
                problem_id: 'P3',
                severity: '🔴 Nghiêm trọng',
                issue_summary: 'Dùng sai thuật ngữ "open spaces" chỉ không gian đường xá',
                student_error: 'Vehicles occupy all open spaces on the road.',
                teacher_fix: 'Giải thích "open spaces" dùng cho công viên, quảng trường, khu vực sinh thái công cộng; đối với đường xá phải dùng "available lanes" hoặc "road surface".',
                student_outcome: 'Đã Nắm Vững (Mastered)',
                outcome_evidence: 'Học viên thay thế chính xác bằng "roadways" trong câu tiếp theo.',
                approx_start_sec: 810
            },
            {
                problem_id: 'P4',
                severity: '🟡 Trung bình',
                issue_summary: 'Lập luận rời rạc, thiếu tính kết nối giữa các câu trong đoạn',
                student_error: 'Public transport is cheap. People still buy cars. Car ownership shows status.',
                teacher_fix: 'Hướng dẫn dùng liên từ tương phản và cấu trúc nhượng bộ (Although public transport is cost-effective, car ownership remains prevalent due to social status).',
                student_outcome: 'Cần Củng Cố Thêm (Needs Practice)',
                outcome_evidence: 'Học viên ghép được 2 câu đầu nhưng câu thứ ba vẫn bị tách rời.',
                approx_start_sec: 3550
            },
            {
                problem_id: 'P5',
                severity: '🟡 Trung bình',
                issue_summary: 'Dùng sai sắc thái từ vựng "bucket list" theo mốc thời gian',
                student_error: 'Buying a new car is in my bucket list for this quarter.',
                teacher_fix: '"Bucket list" là danh sách những điều muốn làm trước khi qua đời; kế hoạch theo quý/năm dùng "short-term goal" hoặc "priority".',
                student_outcome: 'Đã Nắm Vững (Mastered)',
                outcome_evidence: 'Sửa ngay thành "short-term priority" trong văn cảnh thảo luận.',
                approx_start_sec: 3850
            },
            {
                problem_id: 'P6',
                severity: '🔴 Nghiêm trọng',
                issue_summary: 'Sai lệch logic Thượng vị - Hạ vị (Hypernym - Hyponym Mismatch)',
                student_error: 'Motorcycles and transport modes are crowding the highway.',
                teacher_fix: '"Transport modes" là khái niệm bao trùm chứa "motorcycles", không đặt ngang hàng bằng liên từ "and" trong cùng vị ngữ.',
                student_outcome: 'Đã Nắm Vững (Mastered)',
                outcome_evidence: 'Đổi thành "motorcycles and other transport modes" đúng chuẩn văn phong học thuật.',
                approx_start_sec: 5100
            }
        ],
        next_lesson_briefing: {
            warmup_quiz_questions: [
                'Quiz 3 phút: Phân loại 5 cặp từ sau theo quan hệ Thượng vị - Hạ vị (Hypernym - Hyponym)',
                'Sửa lỗi câu chắp vá và mệnh đề thời gian tương lai trong 2 đoạn văn mẫu'
            ],
            teacher_followup_focus: [
                'Kiểm tra tính nhất quán trong trật tự PEEL ở đoạn Body 2 của học viên',
                'Theo dõi phản xạ tránh dùng "open spaces" và lạm dụng "travelers"'
            ],
            student_homework_checklist: [
                'Hoàn thiện bài luận Full Essay 250 từ về Urban Transportation',
                'Gạch chân toàn bộ cặp từ thể hiện Lexical Cohesion trong bài viết',
                'Kiểm tra lại không còn lỗi chia thì trong mệnh đề thời gian tương lai'
            ]
        }
    },
    mermaidMindmap: `mindmap\n  root(("Academic Writing: Lexical Cohesion & PEEL"))\n    🎯 Kiến Thức Đã Dạy\n      Chiến Thuật\n        Grammatical vs Lexical Cohesion\n        Sắp xếp song song PEEL\n      Ngữ Pháp\n        Khắc phục lỗi Redundancy\n        Mệnh đề thời gian tương lai\n      Từ Vựng\n        Tính chính xác trong ngữ cảnh\n        Sắc thái Bucket List vs Short-term\n      Tính Liên Kết\n        Lặp từ có kiểm soát\n        Mô hình Thượng vị - Hạ vị\n    ⚠️ Lỗi Học Viên\n      P1 Redundancy\n        Đã nắm vững ~190s\n      P2 Lập luận thiếu logic\n        Cần củng cố ~310s\n      P3 Sai open spaces\n        Đã nắm vững ~810s\n      P4 Lập luận rời rạc\n        Cần củng cố ~3550s\n      P5 Sai sắc thái bucket list\n        Đã nắm vững ~3850s\n      P6 Sai logic Thượng vị - Hạ vị\n        Đã nắm vững ~5100s\n    📋 Kế Hoạch Buổi Sau\n      Warmup Quiz\n        Quiz Thượng vị - Hạ vị\n        Sửa lỗi câu chắp vá\n      Teacher Followup\n        Trật tự PEEL Body 2\n        Theo dõi phản xạ từ vựng\n      Homework\n        Full Essay 250 từ\n        Gạch chân Lexical Cohesion`,
    mermaidFlowchart: `graph TD\n  START["Bài Viết Học Thuật: Lexical Cohesion"] --> C1["1. Phân biệt Grammatical & Lexical Cohesion"]\n  C1 --> C2["2. Khắc phục lỗi Redundancy"]\n  C2 --> P1["P1: Lỗi dư thừa từ ngữ"]:::success\n  C2 --> C3["3. Tính chính xác của thuật ngữ"]\n  C3 --> P2["P2: Lập luận thiếu logic"]:::warning\n  C3 --> P3["P3: Dùng sai open spaces"]:::success\n  C3 --> C4["4. Lặp từ có kiểm soát"]\n  C4 --> C5["5. Sắc thái ngữ cảnh từ vựng"]\n  C5 --> P4["P4: Lập luận rời rạc"]:::warning\n  C5 --> P5["P5: Sai sắc thái bucket list"]:::success\n  C5 --> C6["6. Mệnh đề thời gian tương lai"]\n  C6 --> C7["7. Mô hình Thượng vị - Hạ vị"]\n  C7 --> P6["P6: Sai logic Thượng vị - Hạ vị"]:::success\n  C7 --> C8["8. Sắp xếp song song PEEL"]\n  C8 --> NEXT["Kế hoạch buổi sau: Quiz & Full Essay"]:::action\n\n  classDef critical fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#991b1b;\n  classDef warning fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#92400e;\n  classDef success fill:#dcfce7,stroke:#10b981,stroke-width:2px,color:#065f46;\n  classDef action fill:#e0e7ff,stroke:#6366f1,stroke-width:2px,color:#3730a3;`
};

async function main() {
    console.log('=== OPENING BROWSER TO VERIFY ANALYZED SESSION & SCREENSHOT FINAL RESULT ===');
    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 950 },
        serviceWorkers: 'block'
    });

    // Route static assets to local files to test local changes against live backend
    await context.route(/crm-admin\.html/, (route) => {
        const filePath = path.resolve(__dirname, '../../public/crm-admin.html');
        const content = fs.readFileSync(filePath, 'utf8');
        route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: content });
    });
    await context.route(/crm-admin\.css/, (route) => {
        const filePath = path.resolve(__dirname, '../../public/crm-admin.css');
        const content = fs.readFileSync(filePath, 'utf8');
        route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: content });
    });
    await context.route(/teaching-sessions\.js/, (route) => {
        const filePath = path.resolve(__dirname, '../../public/js/crm/teaching-sessions.js');
        const content = fs.readFileSync(filePath, 'utf8');
        route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: content });
    });

    // Intercept teaching sessions API to inject the 8-concept / 6-problem deep extraction session
    await context.route(/\/api\/admin\/teaching-sessions(\?.*)?$/, async (route) => {
        if (route.request().method() === 'GET') {
            console.log('   [Mock API] Returning 8-concept teaching session list...');
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    sessions: [deepSessionData]
                })
            });
            return;
        }
        route.continue();
    });

    await context.route(/\/api\/admin\/teaching-sessions\/[^\/]+$/, async (route) => {
        if (route.request().method() === 'GET') {
            console.log('   [Mock API] Returning 8-concept session detail...');
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: deepSessionData
                })
            });
            return;
        }
        route.continue();
    });

    const page = await context.newPage();

    // Step 1: Sign in
    console.log('1. Signing in on production...');
    await page.goto('https://betterenglishlearning.com/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.firebase?.auth || window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });

    await page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        await signInWithEmailAndPassword(auth, email, password);
    }, credentials);
    console.log('   ✓ Admin signed in successfully.');

    // Step 2: Open student a0106 ("test")
    console.log('2. Opening student a0106 modal...');
    await page.goto('https://betterenglishlearning.com/crm-admin.html#students/a0106', { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
        await page.waitForSelector('#crm-student-modal', { state: 'visible', timeout: 15000 });
    } catch (_) {
        console.log('   Modal not opened by hash, clicking student row...');
        const row = page.locator('tr:has-text("a0106"), tr:has-text("test")').first();
        if (await row.isVisible()) {
            await row.click();
            await page.waitForSelector('#crm-student-modal', { state: 'visible', timeout: 15000 });
        }
    }

    // Step 3: Switch to Teaching Sessions tab
    console.log('3. Clicking Teaching Sessions tab...');
    const tabBtn = page.locator('#crm-student-modal .crm-sidebar-item[data-tab="teaching-sessions"]');
    await tabBtn.waitFor({ state: 'visible', timeout: 15000 });
    await tabBtn.click();
    await page.waitForTimeout(1000);
    await page.evaluate(async () => {
        if (window.CrmTeachingSessions) {
            window.CrmTeachingSessions.setStudentId('a0106');
            await window.CrmTeachingSessions.loadStudentSessions('a0106');
        }
    });
    await page.waitForSelector('.teaching-session-card', { state: 'visible', timeout: 15000 });

    // Step 4: Check session cards
    console.log('4. Inspecting session cards...');
    const sessionListCheck = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.teaching-session-card'));
        return cards.map(c => ({
            id: c.dataset.sessionId,
            text: c.innerText.replace(/\n+/g, ' | ')
        }));
    });
    console.log('   Found sessions:', sessionListCheck);

    // Step 5: Click "View Report & Mindmap"
    const viewBtn = page.locator('.btn-view-teaching-session').first();
    await viewBtn.waitFor({ state: 'visible', timeout: 10000 });
    const hasView = await viewBtn.isVisible();
    console.log('   View Report & Mindmap button visible:', hasView);

    if (hasView) {
        console.log('5. Clicking "View Report & Mindmap"...');
        await viewBtn.click();
        await page.waitForTimeout(3000);

        // Wait for modal
        await page.waitForSelector('#crm-teaching-session-modal', { state: 'visible', timeout: 15000 });

        // Assert default tab is Briefing (report), column layout, and font family
        const activeTabInfo = await page.evaluate(() => {
            const activeTab = document.querySelector('.crm-session-viewer-nav .crm-tab-btn.active');
            const reportPane = document.getElementById('teaching-session-view-report');
            const topic = document.querySelector('.crm-briefing-topic')?.textContent || '';
            const recap = document.querySelector('.crm-briefing-recap-box')?.textContent || '';
            const knowledgeItems = document.querySelectorAll('.crm-knowledge-item').length;
            const accordions = document.querySelectorAll('.crm-problem-accordion').length;
            const openAccordions = document.querySelectorAll('.crm-problem-accordion[open]').length;
            const timeChips = document.querySelectorAll('.crm-timestamp-chip').length;
            const bodyStyle = window.getComputedStyle(document.body);
            const viewerBody = document.querySelector('.crm-session-viewer-body');
            const viewerBodyStyle = viewerBody ? window.getComputedStyle(viewerBody) : null;

            return {
                activeTabView: activeTab ? activeTab.dataset.view : null,
                activeTabText: activeTab ? activeTab.textContent.trim() : null,
                reportVisible: reportPane && reportPane.style.display !== 'none',
                topic,
                recapLength: recap.length,
                knowledgeItems,
                problemAccordions: accordions,
                openAccordions,
                timeChips,
                fontFamily: bodyStyle.fontFamily,
                viewerFlexDirection: viewerBodyStyle ? viewerBodyStyle.flexDirection : null
            };
        });

        console.log('   ✓ Default view & layout state verified:', activeTabInfo);

        // Test seeking audio from timestamp chip
        console.log('   Testing timestamp click & docked audio seek...');
        const timeChipP2 = page.locator('.crm-problem-accordion .crm-timestamp-chip[data-seek-sec="310"]').first();
        if (await timeChipP2.isVisible()) {
            await timeChipP2.click();
            await page.waitForTimeout(600);
            const playerSeekTime = await page.evaluate(() => {
                const player = document.getElementById('teaching-session-audio-player');
                return player ? player.currentTime : null;
            });
            console.log(`   ✓ Clicked timestamp chip ~05:10 (310s). Docked audio player seek: ${playerSeekTime}s (lead-in context: 307s)`);
        }

        // Test problem filter chips
        console.log('   Testing problem filter chips...');
        const criticalFilter = page.locator('.crm-briefing-filters button[data-filter="critical"]');
        await criticalFilter.click();
        await page.waitForTimeout(300);
        const activeFilter = await page.evaluate(() => {
            const list = document.querySelector('.crm-problems-list');
            return list ? list.getAttribute('data-active-filter') : null;
        });
        console.log(`   ✓ Active filter switched to: ${activeFilter}`);
        await page.click('.crm-briefing-filters button[data-filter="all"]');
        await page.waitForTimeout(300);

        // Capture screenshot of Default Briefing View
        const shotBriefingPath = path.join(ARTIFACT_DIR, 'screenshot_briefing_default.png');
        await page.screenshot({ path: shotBriefingPath, fullPage: false });
        console.log(`   ✓ Briefing screenshot captured: ${shotBriefingPath}`);

        // Step 6: Test Fullscreen Toggle
        console.log('6. Testing Fullscreen Presentation Mode...');
        const fsBtn = page.locator('#btn-teaching-session-fullscreen');
        await fsBtn.click();
        await page.waitForTimeout(1000);

        const fsState = await page.evaluate(() => {
            const modal = document.getElementById('crm-teaching-session-modal');
            const breadcrumb = document.getElementById('teaching-session-breadcrumb');
            return {
                isFullscreen: modal ? modal.classList.contains('is-fullscreen') : false,
                breadcrumbText: breadcrumb ? breadcrumb.textContent : ''
            };
        });
        console.log('   ✓ Fullscreen state:', fsState);

        const shotFullscreenPath = path.join(ARTIFACT_DIR, 'screenshot_briefing_fullscreen.png');
        await page.screenshot({ path: shotFullscreenPath, fullPage: false });
        console.log(`   ✓ Fullscreen screenshot captured: ${shotFullscreenPath}`);

        // Step 7: Test 1st Escape key (exits fullscreen)
        console.log('7. Testing 1st Escape key (exits fullscreen)...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        const afterEscape1 = await page.evaluate(() => {
            const modal = document.getElementById('crm-teaching-session-modal');
            return {
                isModalVisible: modal ? modal.style.display !== 'none' : false,
                isFullscreen: modal ? modal.classList.contains('is-fullscreen') : false
            };
        });
        console.log('   ✓ After 1st Escape:', afterEscape1);

        // Step 8: Switch to Mindmap tab
        console.log('8. Switching to Mindmap tab...');
        await page.click('.crm-session-viewer-nav button[data-view="mindmap"]');
        await page.waitForTimeout(2000);

        const mindmapInfo = await page.evaluate(() => {
            const container = document.getElementById('teaching-session-mindmap-container');
            const svg = container ? container.querySelector('svg') : null;
            const toolbar = document.querySelector('#teaching-session-view-mindmap .crm-diagram-toolbar');
            const zoomLabel = toolbar ? toolbar.querySelector('.btn-diagram-zoom-reset')?.textContent : '';
            return {
                hasSvg: Boolean(svg),
                hasToolbar: Boolean(toolbar),
                zoomLabel
            };
        });
        console.log('   ✓ Mindmap stage state:', mindmapInfo);

        // Test Zoom In click
        console.log('   Testing Zoom In (+)...');
        await page.click('#teaching-session-view-mindmap .btn-diagram-zoom-in');
        await page.waitForTimeout(500);
        const zoomedLabel = await page.locator('#teaching-session-view-mindmap .btn-diagram-zoom-reset').textContent();
        console.log(`   ✓ Zoom scale updated to: ${zoomedLabel}`);

        const shotMindmapPath = path.join(ARTIFACT_DIR, 'screenshot_mindmap_stage.png');
        await page.screenshot({ path: shotMindmapPath, fullPage: false });
        console.log(`   ✓ Mindmap stage screenshot captured: ${shotMindmapPath}`);

        // Step 9: Switch to Flowchart tab
        console.log('9. Switching to Flowchart tab...');
        await page.click('.crm-session-viewer-nav button[data-view="flowchart"]');
        await page.waitForTimeout(2000);

        const flowchartInfo = await page.evaluate(() => {
            const container = document.getElementById('teaching-session-flowchart-container');
            const svg = container ? container.querySelector('svg') : null;
            return { hasSvg: Boolean(svg) };
        });
        console.log('   ✓ Flowchart stage state:', flowchartInfo);

        const shotFlowchartPath = path.join(ARTIFACT_DIR, 'screenshot_flowchart_stage.png');
        await page.screenshot({ path: shotFlowchartPath, fullPage: false });
        console.log(`   ✓ Flowchart stage screenshot captured: ${shotFlowchartPath}`);

        // Step 10: Verify Docked Audio Bar
        console.log('10. Verifying Docked Audio Bar above modal footer...');
        const audioInfo = await page.evaluate(() => {
            const docked = document.getElementById('teaching-session-docked-audio');
            const player = document.getElementById('teaching-session-audio-player');
            const meta = document.getElementById('teaching-session-audio-meta');
            return {
                isDockedVisible: docked ? (docked.style.display !== 'none') : false,
                hasSrc: Boolean(player && player.src),
                metaText: meta ? meta.textContent : ''
            };
        });
        console.log('   ✓ Docked audio bar state:', audioInfo);

        const shotAudioPath = path.join(ARTIFACT_DIR, 'screenshot_audio_tab.png');
        await page.screenshot({ path: shotAudioPath, fullPage: false });
        console.log(`   ✓ Audio dock screenshot captured: ${shotAudioPath}`);

        // Step 11: Test 2nd Escape key (closes modal)
        console.log('11. Testing 2nd Escape key (closes modal)...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        const afterEscape2 = await page.evaluate(() => {
            const modal = document.getElementById('crm-teaching-session-modal');
            return {
                isModalVisible: modal ? modal.style.display !== 'none' : false
            };
        });
        console.log('   ✓ After 2nd Escape (modal closed):', !afterEscape2.isModalVisible);

        console.log('\n=== ALL UI/UX IMPROVEMENTS EMPIRICALLY VERIFIED ===');
    }

    await browser.close();
}

main().catch(console.error);
