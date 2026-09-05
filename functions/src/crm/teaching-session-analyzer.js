/* eslint-disable no-console, no-empty */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
Bạn là một chuyên gia phân tích sư phạm cao cấp đồng hành cùng Giáo viên dạy 1-1 tiếng Anh học thuật (IELTS / PTE / Academic English).
Nhiệm vụ của bạn là phân tích toàn diện, sâu sắc và đầy đủ toàn bộ file ghi âm buổi dạy song ngữ Việt-Anh giữa Giáo viên và Học viên để tạo ra "Thẻ Chuẩn Bị Bài Học (Teacher's Pre-Class Briefing)".

YÊU CẦU CỐT LÕI: TRÍCH XUẤT TOÀN DIỆN & ĐẦY ĐỦ (EXHAUSTIVE PEDAGOGICAL EXTRACTION)
- Trích xuất TẤT CẢ các điểm kiến thức đã dạy (What Was Taught), tất cả các lỗi sai của học viên, phân tích bản chất lỗi, phương án sửa của giáo viên và phản ứng/kết quả của học viên xuyên suốt buổi học.
- TUYỆT ĐỐI KHÔNG tóm tắt sơ sài 2-3 mục chung chung rồi bỏ qua phần còn lại. Mọi chủ điểm ngữ pháp, từ vựng, collocations, phát âm, lỗi logic lập luận xuất hiện trong buổi dạy đều phải được ghi nhận chi tiết.
- Cung cấp timestamp ước lượng theo giây (approx_start_sec) tương ứng với thời điểm diễn ra trong đoạn ghi âm để giáo viên có thể tra cứu và nghe lại.

YÊU CẦU VỀ GIỌNG ĐIỆU & VĂN PHONG SƯ PHẠM:
- Sử dụng văn phong sư phạm chuẩn mực, khúc chiết, mạch lạc, chính xác và mang tính ứng dụng thực tế cao.
- KHÔNG dùng từ ngữ suồng sã, tiếng lóng hay văn nói quá đà (tránh: "gò tật", "huề vốn", "sượng trân", "đá nhau", "ổn áp").
- KHÔNG dùng văn phong dịch máy hoặc văn bản hành chính rườm rà.
- Diễn đạt chỉ rõ bản chất ngôn ngữ và phương pháp sư phạm:
  + Ví dụ Recap: "Buổi học tập trung hoàn thiện kỹ năng liên kết câu đoạn (Lexical Cohesion) và tính mạch lạc trong bài viết. Trọng tâm là khắc phục xu hướng lạm dụng từ đồng nghĩa gượng ép, đồng thời chuẩn hóa cách phát triển ý theo cấu trúc Tổng - Phân (Hypernym - Hyponym) và lựa chọn từ vựng đúng ngữ cảnh."
  + Ví dụ Phân tích lỗi: "Chỉ rõ lỗi dư thừa thông tin (redundancy) và dùng sai thuật ngữ 'open spaces'. Khi đã diễn đạt xe lấp kín các làn đường, việc thêm mệnh đề đối lập trở nên thừa ý."
  + Ví dụ Sửa lỗi: "Giải thích sự khác biệt về sắc thái thời gian: 'bucket list' dùng cho mục tiêu cả cuộc đời, còn kế hoạch trong năm cần dùng 'wish list'."
- Giữ nguyên các thuật ngữ tiếng Anh chuyên môn, câu trích dẫn của học viên (quotes), collocations, quy tắc ngữ pháp và câu sửa mẫu bằng TIẾNG ANH.

Hãy xuất JSON chuẩn theo schema sau:
{
  "title": "Thẻ Chuẩn Bị Bài Học (Teacher's Pre-Class Briefing)",
  "lesson_summary": {
    "focus_skill": "Writing / Speaking / Reading / Listening / Grammar",
    "core_topic": "Tên chủ đề bài học chuẩn xác (VD: Academic Writing: Lexical Cohesion & Paragraph Logic)",
    "quick_recap_60s": "Tóm tắt 2-4 câu chuẩn mực về toàn bộ trọng tâm buổi dạy, khó khăn chính của học viên và mức độ tiến bộ để giáo viên nắm vững tình hình.",
    "student_readiness_level": "Đã Nắm Vững (Mastered) / Khá (Good) / Trung Bình (Developing) / Cần Củng Cố (Needs Reinforcement)"
  },
  "what_taught": [
    {
      "category": "Chiến Thuật / Từ Vựng / Ngữ Pháp / Phát Âm / Tính Liên Kết",
      "topic": "Tên khái niệm (kèm thuật ngữ Anh-Việt)",
      "key_rule": "Nguyên lý sư phạm / Quy tắc cốt lõi đã dạy (phân tích rõ ràng, chi tiết, không cắt cụt)",
      "examples": ["Ví dụ mục tiêu 1", "Ví dụ 2"],
      "approx_start_sec": 120
    },
    {
      "category": "Từ Vựng",
      "topic": "Collocation & Connotation",
      "key_rule": "Quy tắc lựa chọn từ đúng sắc thái ngữ cảnh học thuật thay vì dịch nghĩa đen",
      "examples": ["traffic congestion thay vì too many cars"],
      "approx_start_sec": 480
    },
    {
      "category": "Tính Liên Kết",
      "topic": "Hypernym - Hyponym Ordering",
      "key_rule": "Khi phát triển ý, luôn đi từ danh từ bao quát (hypernym) trước khi chuyển sang các đối tượng cụ thể (hyponyms) để tránh lặp từ",
      "examples": ["vehicles -> passenger cars and trucks"],
      "approx_start_sec": 950
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
      "outcome_evidence": "Bằng chứng cụ thể từ phản hồi hoặc bài làm sửa lại của học viên",
      "approx_start_sec": 310
    },
    {
      "problem_id": "P2",
      "severity": "🟡 Trung bình",
      "issue_summary": "Lạm dụng từ đồng nghĩa gượng ép (Inappropriate synonym substitution)",
      "student_error": "commuters and travelers interchangeably without distinction",
      "teacher_fix": "Chỉ rõ 'travelers' là khách du lịch, không dùng thay thế cho người đi làm hàng ngày 'commuters'",
      "student_outcome": "Cải Thiện Một Phần (Partially Improved)",
      "outcome_evidence": "Học viên nhận biết được sự khác biệt nhưng còn ngập ngừng khi đặt câu mới",
      "approx_start_sec": 750
    },
    {
      "problem_id": "P3",
      "severity": "🔴 Nghiêm trọng",
      "issue_summary": "Lỗi câu chắp vá (Run-on sentence) và thiếu liên từ",
      "student_error": "The infrastructure is poor people still commute every day.",
      "teacher_fix": "Hướng dẫn tách thành 2 câu đơn hoặc sử dụng liên từ chỉ sự nhượng bộ (Although / Despite)",
      "student_outcome": "Đã Nắm Vững (Mastered)",
      "outcome_evidence": "Học viên tự sửa lại thành câu phức hoàn chỉnh không cần giáo viên nhắc lại",
      "approx_start_sec": 1340
    }
  ],
  "next_lesson_briefing": {
    "warmup_quiz_questions": [
      "Câu hỏi hoặc bài tập ngắn đầu giờ 1",
      "Câu hỏi hoặc bài tập ngắn đầu giờ 2"
    ],
    "teacher_followup_focus": [
      "Trọng tâm theo dõi 1",
      "Trọng tâm theo dõi 2"
    ],
    "student_homework_checklist": [
      "Nhiệm vụ bài tập về nhà 1",
      "Nhiệm vụ bài tập về nhà 2"
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
   - Nhánh 1: 🎯 Kiến Thức Đã Dạy - Knowledge Taught: gom nhóm theo các Danh mục (Category) chính làm sub-branches (VD: Chiến thuật, Từ vựng, Ngữ pháp, Liên kết), mỗi sub-branch chứa các topic và quy tắc ngắn.
   - Nhánh 2: ⚠️ Lỗi Học Viên - Student Errors: liệt kê các lỗi chính theo mức độ nghiêm trọng (P1, P2... kèm tên lỗi ngắn, quote sai tiêu biểu và outcome).
   - Nhánh 3: 📋 Buổi Sau - Next Lesson Briefing: chia thành Warmup Quiz, Teacher Followup, Homework.
   - KHÔNG dùng ký tự gây lỗi cú pháp Mermaid trong node: tránh (, ), [, ], {, }, #, &, ;, <, >, \`, *, |
   - Giữ mỗi dòng súc tích (< 80 ký tự), thụt lề 2 spaces mỗi cấp.

2. "flowchart": Sơ đồ Flowchart luồng bài học theo chuẩn Mermaid graph TD syntax:
   - Bắt đầu bằng: graph TD
   - Luồng logic: START["Chủ đề"] --> STEP1["Khái niệm 1"] --> STEP2["Khái niệm 2"] --> NEXT["Kế hoạch buổi sau"]
   - Tại các khái niệm có lỗi hoặc cần rèn luyện, liên kết đến các node lỗi với classDef tương ứng:
     Dùng :::critical cho lỗi Nghiêm trọng (🔴)
     Dùng :::warning cho lỗi Trung bình (🟡)
     Dùng :::success cho đã nắm vững
     Dùng :::action cho nhiệm vụ tiếp theo
   - Luôn định nghĩa classDef ở cuối sơ đồ:
     classDef critical fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#991b1b;
     classDef warning fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#92400e;
     classDef success fill:#dcfce7,stroke:#10b981,stroke-width:2px,color:#065f46;
     classDef action fill:#e0e7ff,stroke:#6366f1,stroke-width:2px,color:#3730a3;

Hãy trả về DUY NHẤT một JSON Object chuẩn theo định dạng sau:
{
  "mindmap": "mindmap\\n  root((\\"...\\"))\\n...",
  "flowchart": "graph TD\\n  START[\\"...\\"]\\n..."
}

JSON DATA:
`;

function escapePipes(str) {
    if (!str) return '';
    return String(str).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function formatSec(seconds) {
    if (seconds == null || Number.isNaN(Number(seconds))) return '';
    const s = Math.round(Number(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatMarkdownReport(data) {
    if (!data) return '';
    const summary = data.lesson_summary || data.summary || data.lessonSummary || {};
    const whatTaught = Array.isArray(data.what_taught) ? data.what_taught : (Array.isArray(data.whatTaught) ? data.whatTaught : []);
    const problems = Array.isArray(data.student_problems_and_solutions) ? data.student_problems_and_solutions : (Array.isArray(data.studentProblemsAndSolutions) ? data.studentProblemsAndSolutions : []);
    const nextBriefing = data.next_lesson_briefing || data.nextLessonBriefing || {};

    const warmups = nextBriefing.warmup_quiz_questions || nextBriefing.warmup_tasks || nextBriefing.warmupQuizQuestions || nextBriefing.warmupTasks || [];
    const followups = nextBriefing.teacher_followup_focus || nextBriefing.followup_error_focus || nextBriefing.teacherFollowupFocus || nextBriefing.followupErrorFocus || [];
    const homework = nextBriefing.student_homework_checklist || nextBriefing.recommended_homework || nextBriefing.studentHomeworkChecklist || nextBriefing.recommendedHomework || [];

    let md = `# 🎓 ${data.title || "Thẻ Chuẩn Bị Bài Học (Teacher's Pre-Class Briefing)"}\n\n`;
    md += `### 📌 Tóm Tắt Nhanh (Pre-Class Briefing)\n`;
    md += `- **Kỹ năng trọng tâm:** \`${summary.focus_skill || summary.focusSkill || 'General'}\`\n`;
    md += `- **Chủ đề bài học:** **${summary.core_topic || summary.coreTopic || '1-on-1 Lesson'}**\n`;
    md += `- **Mức độ sẵn sàng của học viên:** \`${summary.student_readiness_level || summary.studentReadinessLevel || 'Đang phát triển'}\`\n\n`;
    if (summary.quick_recap_60s || summary.quickRecap60s) {
        md += `> [!TIP]\n> ${summary.quick_recap_60s || summary.quickRecap60s}\n\n`;
    }

    if (whatTaught.length > 0) {
        md += `### 📚 Kiến Thức Đã Giảng Dạy (Knowledge Taught)\n`;
        md += `| Phân Loại | Khái Niệm / Chủ Điểm | Nguyên Lý / Quy Tắc Cốt Lõi | Ví Dụ Tiêu Biểu |\n`;
        md += `| :--- | :--- | :--- | :--- |\n`;
        whatTaught.forEach((item) => {
            const examples = Array.isArray(item.examples) ? item.examples.join('; ') : (item.examples || '');
            const timeSec = item.approx_start_sec != null ? item.approx_start_sec : item.approxStartSec;
            const timeStr = timeSec ? ` [⏱️ ~${formatSec(timeSec)}]` : '';
            md += `| **${escapePipes(item.category || '')}** | ${escapePipes(item.topic || '')}${timeStr} | ${escapePipes(item.key_rule || item.rule || '')} | \`${escapePipes(examples)}\` |\n`;
        });
        md += `\n`;
    }

    if (problems.length > 0) {
        md += `### 🔍 Phân Tích Lỗi Sai & Phương Án Sửa (Problems & Solutions)\n\n`;
        problems.forEach((p, idx) => {
            const timeSec = p.approx_start_sec != null ? p.approx_start_sec : p.approxStartSec;
            const timeStr = timeSec ? ` [⏱️ ~${formatSec(timeSec)}]` : '';
            const errorQuote = p.student_error || p.student_error_quote || p.quote;
            const teacherFix = p.teacher_fix || p.teacher_solution || p.solution;
            const outcome = p.student_outcome || p.verdict;
            const evidence = p.outcome_evidence || p.evidence || p.evidence_quote;

            md += `#### ${p.severity || '🟡'} ${p.problem_id || `P${idx + 1}`}: ${p.issue_summary || 'Lỗi học viên'}${timeStr}\n`;
            if (errorQuote) {
                md += `- **Câu chưa chuẩn của học viên:** \`${errorQuote}\`\n`;
            }
            if (teacherFix) {
                md += `- **Phân tích & Hướng dẫn sửa:** ${teacherFix}\n`;
            }
            if (outcome) {
                md += `- **Kết quả cuối buổi:** **${outcome}** ${evidence ? `_(${evidence})_` : ''}\n`;
            }
            md += `\n`;
        });
    }

    if (warmups.length > 0 || followups.length > 0 || homework.length > 0) {
        md += `### 📋 Chuẩn Bị Cho Buổi Học Tiếp Theo (Next Lesson Plan)\n\n`;
        if (Array.isArray(warmups) && warmups.length > 0) {
            md += `**🎯 Câu hỏi khởi động đầu giờ (Warmup Quiz):**\n`;
            warmups.forEach((q, i) => {
                md += `${i + 1}. ${q}\n`;
            });
            md += `\n`;
        }
        if (Array.isArray(followups) && followups.length > 0) {
            md += `**👨‍🏫 Trọng tâm giáo viên cần theo dõi (Followup Focus):**\n`;
            followups.forEach((f) => {
                md += `- ${f}\n`;
            });
            md += `\n`;
        }
        if (Array.isArray(homework) && homework.length > 0) {
            md += `**📝 Checklist bài tập về nhà của học viên:**\n`;
            homework.forEach((hw) => {
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

    const mergedConfig = {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 32768,
        ...generationConfig
    };

    for (const modelName of modelList) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: mergedConfig
            });
            const result = await model.generateContent(contents);
            const candidate = result.response?.candidates?.[0];
            const finishReason = candidate?.finishReason;

            if (finishReason === 'SAFETY') {
                throw new Error(`Model ${modelName} blocked output due to SAFETY settings.`);
            }
            if (finishReason === 'MAX_TOKENS') {
                console.warn(`[Teaching Session Analyzer] Model ${modelName} reached MAX_TOKENS limit (output may be truncated).`);
            }

            const text = result.response?.text?.();
            if (text && text.trim()) {
                const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(cleaned);
            } else {
                console.warn(`[Teaching Session Analyzer] Model ${modelName} returned empty text (finishReason: ${finishReason || 'unknown'}).`);
            }
        } catch (err) {
            lastError = err;
            console.warn(`[Teaching Session Analyzer] Model ${modelName} failed:`, err.message);
        }
    }

    throw lastError || new Error('All Gemini models failed to generate response.');
}

async function analyzeTeachingSessionAudio({ audioUrl, audioBuffer, audioDurationSec, mimeType = 'audio/mp4', focusSkill, notes }) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured in server environment.');
    }

    let fileManager = null;
    let uploadedFileRef = null;
    let tempFilePath = null;
    let base64Data = null;
    let resolvedMimeType = mimeType;
    let audioBytes = 0;

    try {
        let rawBuffer = null;
        if (audioBuffer && Buffer.isBuffer(audioBuffer)) {
            rawBuffer = audioBuffer;
        } else if (audioUrl && typeof audioUrl === 'string') {
            console.log(`[Teaching Session Analyzer] Fetching audio from storage: ${audioUrl.slice(0, 80)}...`);
            const resp = await axios.get(audioUrl, { responseType: 'arraybuffer' });
            rawBuffer = Buffer.from(resp.data);
            const ct = resp.headers['content-type'];
            if (ct) resolvedMimeType = ct.split(';')[0];
        }

        if (rawBuffer) {
            audioBytes = rawBuffer.length;
            const sizeMb = (audioBytes / (1024 * 1024)).toFixed(2);
            console.log(`[Teaching Session Analyzer] Audio loaded: ${sizeMb} MB (${audioBytes} bytes), MIME: ${resolvedMimeType}`);

            // Prefer Gemini Files API for reliable upload without inline request payload limits
            try {
                fileManager = new GoogleAIFileManager(apiKey);
                const ext = resolvedMimeType.includes('mp3') ? 'mp3' : (resolvedMimeType.includes('wav') ? 'wav' : 'm4a');
                tempFilePath = path.join(os.tmpdir(), `teaching_audio_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);
                fs.writeFileSync(tempFilePath, rawBuffer);

                console.log(`[Teaching Session Analyzer] Uploading audio to Gemini Files API (${sizeMb} MB)...`);
                const uploadResult = await fileManager.uploadFile(tempFilePath, {
                    mimeType: resolvedMimeType || 'audio/mp4',
                    displayName: path.basename(tempFilePath)
                });
                uploadedFileRef = uploadResult.file;
                console.log(`[Teaching Session Analyzer] File uploaded successfully to Gemini Files API: ${uploadedFileRef.uri}`);
            } catch (uploadErr) {
                console.warn('[Teaching Session Analyzer] Files API upload failed, falling back to base64 inline:', uploadErr.message);
                if (audioBytes < 20 * 1024 * 1024) {
                    base64Data = rawBuffer.toString('base64');
                } else {
                    throw new Error(`Audio file (${sizeMb} MB) exceeds inline request limits and Files API upload failed: ${uploadErr.message}`);
                }
            }
        }

        // Build rich pedagogical prompt with duration context
        let durationContext = '';
        if (audioDurationSec && !Number.isNaN(Number(audioDurationSec))) {
            const mins = Math.round(Number(audioDurationSec) / 60);
            durationContext = `\n- THỜI LƯỢNG BUỔI HỌC: ~${mins} phút (${audioDurationSec} giây).\n- YÊU CẦU ĐỘ BAO QUÁT: Với thời lượng ~${mins} phút, bắt buộc phải trích xuất toàn diện TẤT CẢ các kiến thức sư phạm và lỗi sai của học viên xuyên suốt buổi học (tối thiểu 1 phát hiện cho mỗi 8-10 phút của buổi học). Tuyệt đối không chỉ trích xuất 2-3 mục rồi dừng lại.\n`;
        }

        const promptContext = `
GHI CHÚ / THÔNG TIN BỔ SUNG TỪ GIÁO VIÊN:
- Kỹ năng trọng tâm: ${focusSkill || 'Writing / Academic English'}
- Ghi chú buổi dạy: ${notes || 'Buổi học 1-1'}
${durationContext}
`;

        const contents = [];
        if (uploadedFileRef && uploadedFileRef.uri) {
            contents.push({
                fileData: {
                    mimeType: uploadedFileRef.mimeType || resolvedMimeType || 'audio/mp4',
                    fileUri: uploadedFileRef.uri
                }
            });
        } else if (base64Data) {
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

    } finally {
        // Clean up temporary local file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (_) {}
        }
        // Clean up uploaded file from Gemini Files API
        if (fileManager && uploadedFileRef && uploadedFileRef.name) {
            try {
                await fileManager.deleteFile(uploadedFileRef.name);
                console.log(`[Teaching Session Analyzer] Cleaned up temporary Gemini file: ${uploadedFileRef.name}`);
            } catch (cleanupErr) {
                console.warn('[Teaching Session Analyzer] Could not delete remote Gemini file:', cleanupErr.message);
            }
        }
    }
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

        const nowIso = typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString();

        // Set status to processing and stamp analysisStartedAt for watchdog
        await ref.set({
            status: 'processing',
            analysisStartedAt: nowIso,
            updatedAt: nowIso
        }, { merge: true });

        const result = await analyzeTeachingSessionAudio({
            audioUrl: data.audioUrl,
            audioDurationSec: data.audioDurationSec,
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
            errorMessage: null,
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
