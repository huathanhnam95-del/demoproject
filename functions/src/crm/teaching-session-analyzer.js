/* eslint-disable no-console, no-empty */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Load GEMINI_API_KEY from environment
function getGeminiApiKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
    // Check root .env if running locally
    try {
        const rootEnvPath = path.join(__dirname, '../../../.env');
        if (fs.existsSync(rootEnvPath)) {
            const lines = fs.readFileSync(rootEnvPath, 'utf-8').split('\n');
            for (const line of lines) {
                if (line.startsWith('GEMINI_API_KEY=')) {
                    return line.split('=')[1].trim().replace(/['"]/g, '');
                }
            }
        }
    } catch (_) {}
    return '';
}

const PRIMARY_MODEL = process.env.TEACHING_LOGGER_GEMINI_MODEL || 'gemini-3.6-flash';
const FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];

const PEDAGOGICAL_SYSTEM_PROMPT = `
Bạn là một trợ lý sư phạm chuyên nghiệp đồng hành cùng Giáo viên dạy 1-1 tiếng Anh (IELTS/PTE/Academic English).
Nhiệm vụ của bạn là phân tích file ghi âm buổi dạy song ngữ Việt-Anh giữa Giáo viên và Học viên để tạo ra "Thẻ Chuẩn Bị Bài Học (Teacher's Pre-Class Briefing)".

YÊU CẦU VỀ GIỌNG ĐIỆU & VĂN PHONG (TIẾNG VIỆT SƯ PHẠM CHUYÊN NGHIỆP & CHUẨN XÁC):
- Sử dụng văn phong sư phạm chuẩn mực, súc tích, mạch lạc và mang tính ứng dụng thực tế cao (như sổ tay ghi chú giảng dạy của giáo viên chuyên nghiệp).
- KHÔNG dùng từ ngữ suồng sã, tiếng lóng hay văn nói quá đà (tránh: "gò tật", "huề vốn", "sượng trân", "đá nhau", "ổn áp").
- KHÔNG dùng văn phong dịch máy hoặc văn bản hành chính cứng nhắc (tránh câu rườm rà như: "Học viên được hướng dẫn chuyên sâu...", "Mang tính chất thừa thãi...").
- Diễn đạt khúc chiết, chỉ rõ bản chất ngôn ngữ và phương pháp sư phạm:
  + Ví dụ Recap: "Buổi học tập trung hoàn thiện kỹ năng liên kết câu đoạn (Lexical Cohesion) và tính mạch lạc trong bài viết. Trọng tâm là khắc phục xu hướng lạm dụng từ đồng nghĩa gượng ép, đồng thời chuẩn hóa cách phát triển ý theo cấu trúc Tổng - Phân (Hypernym - Hyponym) và lựa chọn từ vựng đúng ngữ cảnh."
  + Ví dụ Phân tích lỗi: "Chỉ rõ lỗi dư thừa thông tin (redundancy) và dùng sai thuật ngữ 'open spaces'. Khi đã diễn đạt xe lấp kín các làn đường, việc thêm mệnh đề đối lập trở nên thừa ý."
  + Ví dụ Sửa lỗi: "Giải thích sự khác biệt về sắc thái thời gian: 'bucket list' dùng cho mục tiêu cả cuộc đời, còn kế hoạch trong năm cần dùng 'wish list'."
- Giữ nguyên các thuật ngữ tiếng Anh chuyên môn, câu trích dẫn của học viên (quotes), collocations, quy tắc ngữ pháp và câu sửa mẫu bằng TIẾNG ANH.

Đầu ra là một "THẺ CHUẨN BỊ BÀI HỌC" hoàn chỉnh, giúp giáo viên đọc nhanh trong 60 giây trước khi bắt đầu buổi học tiếp theo.

Hãy xuất JSON chuẩn theo schema sau:
{
  "title": "Thẻ Chuẩn Bị Bài Học (Teacher's Pre-Class Briefing)",
  "lesson_summary": {
    "focus_skill": "Writing / Speaking / Reading / Listening / Grammar",
    "core_topic": "Tên chủ đề bài học chuẩn xác (VD: Academic Writing: Lexical Cohesion & Paragraph Logic)",
    "quick_recap_60s": "2-3 câu súc tích, chuẩn mực tóm tắt trọng tâm buổi dạy, khó khăn chính của học viên và mức độ tiến bộ để giáo viên nắm nhanh trước giờ lên lớp.",
    "student_readiness_level": "Đã Nắm Vững (Mastered) / Khá (Good) / Trung Bình (Developing) / Cần Củng Cố (Needs Reinforcement)"
  },
  "what_taught": [
    {
      "category": "Chiến Thuật / Từ Vựng / Ngữ Pháp / Phát Âm / Tính Liên Kết",
      "topic": "Tên khái niệm (kèm thuật ngữ Anh-Việt)",
      "key_rule": "Nguyên lý sư phạm / Quy tắc cốt lõi đã dạy (diễn đạt rõ ràng, chuẩn xác)",
      "examples": ["Ví dụ mục tiêu 1", "Ví dụ 2"]
    }
  ],
  "student_problems_and_solutions": [
    {
      "problem_id": "P1",
      "severity": "🔴 Nghiêm trọng / 🟡 Trung bình / 🟢 Nhẹ",
      "issue_summary": "Tên lỗi ngắn gọn, chuẩn xác",
      "student_error": "Trích dẫn nguyên văn câu/từ chưa chuẩn của học viên (English quote)",
      "teacher_fix": "Phân tích của giáo viên: Bản chất lỗi sai + Hướng dẫn sửa chuẩn xác",
      "student_outcome": "Đã Nắm Vững (Mastered) / Cải Thiện Một Phần (Partially Improved) / Cần Củng Cố Thêm (Needs Practice)",
      "outcome_evidence": "Bằng chứng ngắn từ phản hồi của học viên trong buổi học"
    }
  ],
  "next_lesson_briefing": {
    "warmup_quiz_questions": [
      "1-2 câu hỏi hoặc bài tập ngắn đầu giờ để kiểm tra nhanh mức độ ghi nhớ kiến thức của học viên"
    ],
    "teacher_followup_focus": [
      "Nội dung hoặc kỹ năng giáo viên cần tiếp tục theo dõi và củng cố trong buổi học tiếp theo"
    ],
    "student_homework_checklist": [
      "Nhiệm vụ bài tập về nhà cụ thể cần kiểm tra đầu giờ"
    ]
  }
}
`;

const MERMAID_UNIFIED_PROMPT = `
Bạn là một trợ lý trực quan hóa dữ liệu sư phạm song ngữ Việt-Anh chuyên nghiệp.

Từ dữ liệu JSON phân tích buổi dạy, hãy tạo ĐỒNG THỜI 2 sơ đồ Mermaid:
1. "mindmap": Sơ đồ Mindmap bao quát toàn bộ buổi học theo chuẩn Mermaid mindmap syntax:
   - Bắt đầu bằng: mindmap
   - Root: root(("Tên chủ đề bài học"))
   - Nhánh 1: 🎯 Kiến Thức Đã Dạy - Knowledge Taught (gồm category, topic, ví dụ tiêu biểu)
   - Nhánh 2: ⚠️ Lỗi Học Viên - Student Errors (gồm severity, problem_id, tên lỗi, quote sai ngắn, outcome)
   - Nhánh 3: 📋 Buổi Sau - Next Lesson Briefing (gồm Warmup Quiz, Teacher Followup, Homework)
   - KHÔNG dùng ký tự gây lỗi cú pháp Mermaid trong node: tránh (, ), [, ], {, }, #, &, ;, <, >, \`, *, |
   - Giữ mỗi dòng súc tích (< 60 ký tự), thụt lề 2 spaces mỗi cấp.

2. "flowchart": Sơ đồ Flowchart luồng bài học theo chuẩn Mermaid graph TD syntax:
   - Bắt đầu bằng: graph TD
   - Luồng logic: START["Chủ đề"] --> STEP1["Khái niệm 1"] --> STEP2["Khái niệm 2"] --> NEXT["Kế hoạch buổi sau"]
   - Tại các khái niệm có lỗi, liên kết nhánh lỗi (dùng :::critical cho 🔴, :::warning cho 🟡, :::success cho đã nắm vững, :::action cho hành động tiếp theo)
   - Luôn kèm classDef ở cuối:
     classDef critical fill:#ff6b6b,stroke:#c92a2a,color:#fff;
     classDef warning fill:#ffd43b,stroke:#e67700,color:#333;
     classDef success fill:#51cf66,stroke:#2b8a3e,color:#fff;
     classDef action fill:#74c0fc,stroke:#1864ab,color:#fff;

Hãy trả về DUY NHẤT một JSON Object chuẩn theo định dạng sau:
{
  "mindmap": "mindmap\\n  root((\\"...\\"))\\n...",
  "flowchart": "graph TD\\n  START[\\"...\\"]\\n..."
}

JSON DATA:
`;

function formatMarkdownReport(data) {
    if (!data) return '';
    const summary = data.lesson_summary || {};
    const whatTaught = Array.isArray(data.what_taught) ? data.what_taught : [];
    const problems = Array.isArray(data.student_problems_and_solutions) ? data.student_problems_and_solutions : [];
    const nextBriefing = data.next_lesson_briefing || {};

    let md = `# 🎓 ${data.title || "Thẻ Chuẩn Bị Bài Học (Teacher's Pre-Class Briefing)"}\n\n`;
    md += `### 📌 Tóm Tắt Nhanh (60-Second Briefing)\n`;
    md += `- **Kỹ năng trọng tâm:** \`${summary.focus_skill || 'General'}\`\n`;
    md += `- **Chủ đề bài học:** **${summary.core_topic || '1-on-1 Lesson'}**\n`;
    md += `- **Mức độ sẵn sàng của học viên:** \`${summary.student_readiness_level || 'Đang phát triển'}\`\n\n`;
    if (summary.quick_recap_60s) {
        md += `> [!TIP]\n> ${summary.quick_recap_60s}\n\n`;
    }

    if (whatTaught.length > 0) {
        md += `### 📚 Kiến Thức Đã Giảng Dạy (Knowledge Taught)\n`;
        md += `| Phân Loại | Khái Niệm / Chủ Điểm | Nguyên Lý / Quy Tắc Cốt Lõi | Ví Dụ Tiêu Biểu |\n`;
        md += `| :--- | :--- | :--- | :--- |\n`;
        whatTaught.forEach((item) => {
            const examples = Array.isArray(item.examples) ? item.examples.join('; ') : (item.examples || '');
            md += `| **${item.category || ''}** | ${item.topic || ''} | ${item.key_rule || ''} | \`${examples}\` |\n`;
        });
        md += `\n`;
    }

    if (problems.length > 0) {
        md += `### 🔍 Phân Tích Lỗi Sai & Phương Án Sửa (Problems & Solutions)\n\n`;
        problems.forEach((p, idx) => {
            md += `#### ${p.severity || '🟡'} ${p.problem_id || `P${idx + 1}`}: ${p.issue_summary || 'Lỗi học viên'}\n`;
            if (p.student_error) {
                md += `- **Câu chưa chuẩn của học viên:** \`${p.student_error}\`\n`;
            }
            if (p.teacher_fix) {
                md += `- **Phân tích & Hướng dẫn sửa:** ${p.teacher_fix}\n`;
            }
            if (p.student_outcome) {
                md += `- **Kết quả cuối buổi:** **${p.student_outcome}** ${p.outcome_evidence ? `_(${p.outcome_evidence})_` : ''}\n`;
            }
            md += `\n`;
        });
    }

    if (nextBriefing.warmup_quiz_questions || nextBriefing.teacher_followup_focus || nextBriefing.student_homework_checklist) {
        md += `### 📋 Chuẩn Bị Cho Buổi Học Tiếp Theo (Next Lesson Plan)\n\n`;
        if (Array.isArray(nextBriefing.warmup_quiz_questions) && nextBriefing.warmup_quiz_questions.length > 0) {
            md += `**🎯 Câu hỏi khởi động đầu giờ (Warmup Quiz):**\n`;
            nextBriefing.warmup_quiz_questions.forEach((q, i) => {
                md += `${i + 1}. ${q}\n`;
            });
            md += `\n`;
        }
        if (Array.isArray(nextBriefing.teacher_followup_focus) && nextBriefing.teacher_followup_focus.length > 0) {
            md += `**👨‍🏫 Trọng tâm giáo viên cần theo dõi (Followup Focus):**\n`;
            nextBriefing.teacher_followup_focus.forEach((f) => {
                md += `- ${f}\n`;
            });
            md += `\n`;
        }
        if (Array.isArray(nextBriefing.student_homework_checklist) && nextBriefing.student_homework_checklist.length > 0) {
            md += `**📝 Checklist bài tập về nhà của học viên:**\n`;
            nextBriefing.student_homework_checklist.forEach((hw) => {
                md += `- [ ] ${hw}\n`;
            });
            md += `\n`;
        }
    }

    return md;
}

async function callGeminiJson(apiKey, modelList, contents, generationConfig = {}) {
    const genAI = new GoogleGenerativeAI(apiKey);
    let lastError = null;

    for (const modelName of modelList) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.2,
                    ...generationConfig
                }
            });
            const result = await model.generateContent(contents);
            const text = result.response.text();
            if (text) {
                const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(cleaned);
            }
        } catch (err) {
            lastError = err;
            console.warn(`[Teaching Session Analyzer] Model ${modelName} failed:`, err.message);
        }
    }

    throw lastError || new Error('All Gemini models failed to generate response.');
}

async function analyzeTeachingSessionAudio({ audioUrl, audioBuffer, mimeType = 'audio/mp4', focusSkill, notes }) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured in server environment.');
    }

    let base64Data = null;
    let resolvedMimeType = mimeType;

    if (audioBuffer && Buffer.isBuffer(audioBuffer)) {
        base64Data = audioBuffer.toString('base64');
    } else if (audioUrl && typeof audioUrl === 'string') {
        console.log(`[Teaching Session Analyzer] Fetching audio from storage: ${audioUrl.slice(0, 80)}...`);
        const resp = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        const buf = Buffer.from(resp.data);
        base64Data = buf.toString('base64');
        const ct = resp.headers['content-type'];
        if (ct) resolvedMimeType = ct.split(';')[0];
    }

    const promptContext = `
GHI CHÚ / THÔNG TIN BỔ SUNG TỪ GIÁO VIÊN:
- Kỹ năng trọng tâm: ${focusSkill || 'Writing / General'}
- Ghi chú buổi dạy: ${notes || 'Buổi học 1-1'}
`;

    const contents = [];
    if (base64Data) {
        contents.push({
            inlineData: {
                mimeType: resolvedMimeType || 'audio/mp4',
                data: base64Data
            }
        });
    }
    contents.push(PEDAGOGICAL_SYSTEM_PROMPT + '\n\n' + promptContext);

    console.log('[Teaching Session Analyzer] Calling Gemini for pedagogical analysis...');
    const reportJson = await callGeminiJson(apiKey, [PRIMARY_MODEL, ...FALLBACK_MODELS], contents);

    console.log('[Teaching Session Analyzer] Calling Gemini for unified Mermaid mindmap and flowchart...');
    let mermaidJson = { mindmap: '', flowchart: '' };
    try {
        mermaidJson = await callGeminiJson(
            apiKey,
            [PRIMARY_MODEL, ...FALLBACK_MODELS],
            [MERMAID_UNIFIED_PROMPT + '\n\n' + JSON.stringify(reportJson, null, 2)]
        );
    } catch (err) {
        console.warn('[Teaching Session Analyzer] Mermaid generation warning:', err.message);
    }

    const markdownReport = formatMarkdownReport(reportJson);

    return {
        report: reportJson,
        markdownReport,
        mermaidMindmap: mermaidJson.mindmap || '',
        mermaidFlowchart: mermaidJson.flowchart || '',
        status: 'analyzed'
    };
}

async function runSessionAnalysisTask(sessionId, db, serverTimestamp) {
    if (!sessionId || !db) return;
    const ref = db.collection('crmTeachingSessions').doc(sessionId);

    try {
        const snap = await ref.get();
        if (!snap.exists) return;
        const data = snap.data() || {};

        if (!data.audioUrl) {
            console.warn(`[Teaching Session Analyzer] Session ${sessionId} has no audioUrl, skipping.`);
            return;
        }

        // Set status to processing
        await ref.set({
            status: 'processing',
            updatedAt: typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString()
        }, { merge: true });

        const result = await analyzeTeachingSessionAudio({
            audioUrl: data.audioUrl,
            focusSkill: data.focusSkill,
            notes: data.notes
        });

        // Save completed analysis
        await ref.set({
            status: 'analyzed',
            report: result.report,
            markdownReport: result.markdownReport,
            mermaidMindmap: result.mermaidMindmap,
            mermaidFlowchart: result.mermaidFlowchart,
            updatedAt: typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString()
        }, { merge: true });

        console.log(`[Teaching Session Analyzer] Session ${sessionId} successfully analyzed and saved!`);
    } catch (err) {
        console.error(`[Teaching Session Analyzer] Error analyzing session ${sessionId}:`, err);
        await ref.set({
            status: 'error',
            errorMessage: err?.message || String(err),
            updatedAt: typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString()
        }, { merge: true });
    }
}

module.exports = {
    analyzeTeachingSessionAudio,
    runSessionAnalysisTask,
    formatMarkdownReport
};
