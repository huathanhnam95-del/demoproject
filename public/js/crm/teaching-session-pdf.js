/**
 * CRM Teaching Session PDF Briefing Generator
 * Generates an executive pre-class briefing PDF with full Vietnamese diacritics
 * using custom embedded Roboto TrueType fonts.
 */
(function (global) {
    'use strict';

    const PAGE_W = 210;     // A4 width mm
    const PAGE_H = 297;     // A4 height mm
    const MARGIN_L = 18;
    const MARGIN_R = 18;
    const MARGIN_T = 20;
    const MARGIN_B = 20;
    const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

    const COLOR_TEAL = [27, 67, 50];       // #1B4332
    const COLOR_GREEN = [45, 106, 79];     // #2D6A4F
    const COLOR_BLACK = [33, 33, 33];
    const COLOR_GRAY = [120, 120, 120];
    const COLOR_LIGHT = [226, 232, 240];
    const COLOR_CARD_BG = [248, 250, 252];
    const COLOR_AMBER = [217, 119, 6];
    const COLOR_RED = [220, 38, 38];

    const FONT_TITLE = 16;
    const FONT_SECTION = 12.5;
    const FONT_SUBTITLE = 10.5;
    const FONT_BODY = 9.5;
    const FONT_SMALL = 8;
    const FONT_FOOTER = 7.5;

    const LINE_H = 4.8;
    const FONT_NAME = 'Roboto';

    const fontBase64Cache = new Map();

    function uint8ArrayToBase64(bytes) {
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    function stripEmoji(str) {
        if (!str) return '';
        return String(str).replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').trim();
    }

    function safeStr(v) {
        return v == null ? '' : stripEmoji(String(v));
    }

    function classifySeverity(str) {
        if (!str) return 'minor';
        const s = String(str).toLowerCase();
        if (s.includes('critical') || s.includes('nghiêm trọng') || s.includes('🔴') || s.includes('high') || s.includes('p1') || s.includes('cao')) return 'critical';
        if (s.includes('warning') || s.includes('trung bình') || s.includes('🟡') || s.includes('medium') || s.includes('p2') || s.includes('p3') || s.includes('vừa')) return 'warning';
        return 'minor';
    }

    function formatTimestamp(seconds) {
        const sec = Number(seconds);
        if (Number.isNaN(sec) || sec < 0) return '';
        const mins = Math.floor(sec / 60);
        const secs = Math.floor(sec % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function formatDuration(sec) {
        const s = Number(sec);
        if (Number.isNaN(s) || s <= 0) return 'N/A';
        const mins = Math.floor(s / 60);
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        if (hours > 0) return `${hours}h ${remMins}m`;
        return `${mins} min`;
    }

    let jspdfLoadPromise = null;
    async function ensureJsPdfLoaded() {
        if (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) {
            return window.jspdf.jsPDF;
        }
        if (typeof window !== 'undefined' && window.jsPDF) {
            return window.jsPDF;
        }
        if (jspdfLoadPromise) return jspdfLoadPromise;
        if (typeof document === 'undefined') {
            throw new Error('document is not available for lazy script injection');
        }

        jspdfLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.onload = () => {
                const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
                if (jsPDF) resolve(jsPDF);
                else reject(new Error('jsPDF failed to initialize'));
            };
            script.onerror = (err) => reject(new Error('Failed to load jsPDF CDN: ' + (err?.message || 'Network error')));
            document.head.appendChild(script);
        });
        return jspdfLoadPromise;
    }

    async function loadFonts(doc) {
        const fontFiles = [
            { file: 'Roboto-Regular.ttf', style: 'normal' },
            { file: 'Roboto-Bold.ttf', style: 'bold' },
            { file: 'Roboto-Italic.ttf', style: 'italic' }
        ];

        let loadedAny = false;
        for (const { file, style } of fontFiles) {
            try {
                let base64 = fontBase64Cache.get(file);
                if (!base64) {
                    const res = await fetch('/fonts/' + file);
                    if (!res.ok) throw new Error('Font fetch failed: ' + res.status);
                    const buffer = await res.arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    base64 = uint8ArrayToBase64(bytes);
                    fontBase64Cache.set(file, base64);
                }
                doc.addFileToVFS(file, base64);
                doc.addFont(file, FONT_NAME, style);
                loadedAny = true;
            } catch (e) {
                console.warn('[Teaching Sessions PDF] Font load note (' + file + '):', e?.message);
            }
        }

        if (loadedAny) {
            doc.setFont(FONT_NAME, 'normal');
        } else {
            doc.setFont('helvetica', 'normal');
        }
    }

    function checkPageBreak(doc, y, needed, headerInfo, footerText) {
        if (y + needed > PAGE_H - MARGIN_B) {
            drawPageFooter(doc, footerText);
            doc.addPage();
            drawPageHeader(doc, headerInfo);
            return MARGIN_T + 12;
        }
        return y;
    }

    function forceNewPage(doc, y, headerInfo, footerText) {
        drawPageFooter(doc, footerText);
        doc.addPage();
        drawPageHeader(doc, headerInfo);
        return MARGIN_T + 12;
    }

    function drawPageHeader(doc, headerInfo) {
        doc.setFontSize(8);
        doc.setTextColor(...COLOR_TEAL);
        doc.setFont(FONT_NAME, 'bold');
        doc.text('BEL CRM', MARGIN_L, 10);
        doc.setFont(FONT_NAME, 'normal');
        doc.setFontSize(8.5);
        doc.text('Báo Cáo Phiên Dạy & Briefing', MARGIN_L + 18, 10);
        doc.setFontSize(8);
        doc.setTextColor(...COLOR_GRAY);
        doc.text(safeStr(headerInfo), PAGE_W - MARGIN_R, 10, { align: 'right' });

        doc.setDrawColor(...COLOR_LIGHT);
        doc.setLineWidth(0.3);
        doc.line(MARGIN_L, 13, PAGE_W - MARGIN_R, 13);
    }

    function drawPageFooter(doc, footerText) {
        const pageNum = doc.internal.getNumberOfPages();
        doc.setFontSize(FONT_FOOTER);
        doc.setTextColor(...COLOR_GRAY);
        doc.setFont(FONT_NAME, 'normal');
        doc.text(safeStr(footerText), MARGIN_L, PAGE_H - 10);
        doc.text('Trang ' + pageNum, PAGE_W - MARGIN_R, PAGE_H - 10, { align: 'right' });
    }

    function wrapText(doc, text, maxWidth) {
        if (!text) return [];
        return doc.splitTextToSize(safeStr(text), maxWidth);
    }

    function drawSectionHeader(doc, y, title, headerInfo, footerText) {
        y = checkPageBreak(doc, y, 16, headerInfo, footerText);
        y += 4;
        doc.setFontSize(FONT_SECTION);
        doc.setFont(FONT_NAME, 'bold');
        doc.setTextColor(...COLOR_TEAL);
        doc.text(title, MARGIN_L, y);
        y += 2;
        doc.setDrawColor(...COLOR_TEAL);
        doc.setLineWidth(0.5);
        doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y);
        y += 6;
        return y;
    }

    /**
     * Main PDF Generation Function
     */
    async function generateTeachingSessionPdf(options) {
        const opts = options || {};
        const session = opts.session || {};
        let norm = opts.norm;

        if (!norm && window.CrmTeachingSessions?.normalizeReport) {
            norm = window.CrmTeachingSessions.normalizeReport(session);
        }
        if (!norm && session.report) {
            norm = session.report;
        }

        const jsPDFClass = await ensureJsPdfLoaded();
        const doc = new jsPDFClass({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        await loadFonts(doc);

        const studentName = opts.studentName || session.studentName || session.studentId || 'Học viên';
        const teacherName = opts.teacherName || session.teacherName || 'Giáo viên phụ trách';
        const sessionTitle = session.title || 'Buổi Dạy Học Thuật';
        const focusSkill = session.focusSkill || 'Tổng quát';
        const sessionDate = session.sessionDate ? new Date(session.sessionDate).toLocaleDateString('vi-VN') : 'N/A';
        const durationText = session.audioDurationSec ? formatDuration(session.audioDurationSec) : 'N/A';
        const headerInfo = `${studentName} — ${sessionTitle}`;
        const footerText = `BEL CRM Briefing • Ngày xuất: ${new Date().toLocaleDateString('vi-VN')} • Tài liệu nội bộ`;

        let y = MARGIN_T;
        drawPageHeader(doc, headerInfo);
        y += 6;

        // Document Main Title Banner
        doc.setFontSize(FONT_TITLE);
        doc.setFont(FONT_NAME, 'bold');
        doc.setTextColor(...COLOR_TEAL);
        doc.text('BÁO CÁO PHIÊN DẠY & BRIEFING TRƯỚC GIỜ HỌC', MARGIN_L, y);
        y += 6;

        // Meta Band Card
        doc.setFillColor(...COLOR_CARD_BG);
        doc.setDrawColor(...COLOR_LIGHT);
        doc.setLineWidth(0.3);
        doc.roundedRect(MARGIN_L, y, CONTENT_W, 22, 2, 2, 'FD');

        doc.setFontSize(FONT_BODY);
        doc.setTextColor(...COLOR_BLACK);
        
        // Row 1
        doc.setFont(FONT_NAME, 'bold');
        doc.text('Học viên:', MARGIN_L + 4, y + 6);
        doc.setFont(FONT_NAME, 'normal');
        doc.text(safeStr(studentName), MARGIN_L + 24, y + 6);

        doc.setFont(FONT_NAME, 'bold');
        doc.text('Kỹ năng:', MARGIN_L + 95, y + 6);
        doc.setFont(FONT_NAME, 'normal');
        doc.text(safeStr(focusSkill), MARGIN_L + 115, y + 6);

        // Row 2
        doc.setFont(FONT_NAME, 'bold');
        doc.text('Chủ đề:', MARGIN_L + 4, y + 13);
        doc.setFont(FONT_NAME, 'normal');
        doc.text(safeStr(sessionTitle), MARGIN_L + 24, y + 13);

        doc.setFont(FONT_NAME, 'bold');
        doc.text('Thời lượng:', MARGIN_L + 95, y + 13);
        doc.setFont(FONT_NAME, 'normal');
        doc.text(safeStr(durationText), MARGIN_L + 115, y + 13);

        // Row 3
        doc.setFont(FONT_NAME, 'bold');
        doc.text('Ngày học:', MARGIN_L + 4, y + 19);
        doc.setFont(FONT_NAME, 'normal');
        doc.text(safeStr(sessionDate), MARGIN_L + 24, y + 19);

        doc.setFont(FONT_NAME, 'bold');
        doc.text('Giáo viên:', MARGIN_L + 95, y + 19);
        doc.setFont(FONT_NAME, 'normal');
        doc.text(safeStr(teacherName), MARGIN_L + 115, y + 19);

        y += 28;

        // 60-Second Quick Recap & Readiness
        const summary = norm?.summary || norm?.lesson_summary || {};
        const recapText = summary.quick_recap_60s || summary.quickRecap60s || '';
        const readiness = summary.student_readiness_level || summary.readiness || '';

        if (recapText || readiness) {
            y = checkPageBreak(doc, y, 30, headerInfo, footerText);
            doc.setFillColor(240, 253, 244);
            doc.setDrawColor(187, 247, 208);
            doc.setLineWidth(0.3);

            const recapLines = wrapText(doc, recapText, CONTENT_W - 8);
            const boxH = Math.max(16, 10 + recapLines.length * LINE_H);
            doc.roundedRect(MARGIN_L, y, CONTENT_W, boxH, 2, 2, 'FD');

            doc.setFontSize(FONT_SUBTITLE);
            doc.setFont(FONT_NAME, 'bold');
            doc.setTextColor(...COLOR_TEAL);
            doc.text('Tóm tắt 60 giây:', MARGIN_L + 4, y + 6);

            if (readiness) {
                doc.setFontSize(FONT_SMALL);
                doc.setTextColor(...COLOR_GREEN);
                doc.text(`Độ sẵn sàng: ${readiness}`, PAGE_W - MARGIN_R - 4, y + 6, { align: 'right' });
            }

            doc.setFontSize(FONT_BODY);
            doc.setFont(FONT_NAME, 'normal');
            doc.setTextColor(...COLOR_BLACK);
            doc.text(recapLines, MARGIN_L + 4, y + 12);

            y += boxH + 6;
        }

        // Section I: Đã giảng dạy
        const whatTaught = norm?.whatTaught || norm?.what_taught || [];
        if (whatTaught.length > 0) {
            y = drawSectionHeader(doc, y, 'I. KIẾN THỨC ĐÃ GIẢNG DẠY', headerInfo, footerText);

            whatTaught.forEach((item, idx) => {
                const topicLines = wrapText(doc, `${idx + 1}. [${item.category || 'Kiến thức'}] ${item.topic || ''}`, CONTENT_W);
                const ruleLines = item.key_rule ? wrapText(doc, `• Quy tắc: ${item.key_rule}`, CONTENT_W - 6) : [];
                const exampleLines = Array.isArray(item.examples) && item.examples.length > 0
                    ? wrapText(doc, `• Ví dụ: ${item.examples.join('; ')}`, CONTENT_W - 6)
                    : [];

                const itemH = (topicLines.length + ruleLines.length + exampleLines.length) * LINE_H + 4;
                y = checkPageBreak(doc, y, itemH, headerInfo, footerText);

                doc.setFontSize(FONT_SUBTITLE);
                doc.setFont(FONT_NAME, 'bold');
                doc.setTextColor(...COLOR_BLACK);
                doc.text(topicLines, MARGIN_L, y);

                if (item.approx_start_sec != null) {
                    doc.setFontSize(FONT_SMALL);
                    doc.setFont(FONT_NAME, 'normal');
                    doc.setTextColor(...COLOR_GRAY);
                    doc.text(`~${formatTimestamp(item.approx_start_sec)}`, PAGE_W - MARGIN_R, y, { align: 'right' });
                }
                y += topicLines.length * LINE_H;

                if (ruleLines.length > 0) {
                    doc.setFontSize(FONT_BODY);
                    doc.setFont(FONT_NAME, 'normal');
                    doc.setTextColor(30, 41, 59);
                    doc.text(ruleLines, MARGIN_L + 4, y);
                    y += ruleLines.length * LINE_H;
                }

                if (exampleLines.length > 0) {
                    doc.setFontSize(FONT_BODY);
                    doc.setFont(FONT_NAME, 'italic');
                    doc.setTextColor(71, 85, 105);
                    doc.text(exampleLines, MARGIN_L + 4, y);
                    y += exampleLines.length * LINE_H;
                }

                y += 3;
            });
        }

        // Section II: Lỗi & Cách sửa
        const problems = norm?.problems || norm?.student_problems_and_solutions || [];
        if (problems.length > 0) {
            y = drawSectionHeader(doc, y, 'II. LỖI HỌC VIÊN & CÁCH GIẢI QUYẾT', headerInfo, footerText);

            problems.forEach((prob, idx) => {
                const issueHeader = `${idx + 1}. ${prob.issue_summary || prob.student_error || 'Vấn đề phát sinh'}`;
                const issueLines = wrapText(doc, issueHeader, CONTENT_W - 24);
                const errorQuote = prob.student_error || prob.student_error_quote || '';
                const errorLines = errorQuote ? wrapText(doc, `Lỗi học viên: "${errorQuote}"`, CONTENT_W - 8) : [];
                const fixText = prob.teacher_fix || prob.teacher_solution || '';
                const fixLines = fixText ? wrapText(doc, `Giáo viên sửa: ${fixText}`, CONTENT_W - 8) : [];
                const outcomeText = prob.student_outcome ? `Đánh giá: ${prob.student_outcome} ${prob.outcome_evidence ? `(${prob.outcome_evidence})` : ''}` : '';
                const outcomeLines = outcomeText ? wrapText(doc, outcomeText, CONTENT_W - 8) : [];

                const cardHeight = (issueLines.length + errorLines.length + fixLines.length + outcomeLines.length) * LINE_H + 6;
                y = checkPageBreak(doc, y, cardHeight, headerInfo, footerText);

                // Severity dot
                let dotColor = COLOR_TEAL;
                const sev = classifySeverity(prob.severity);
                if (sev === 'critical') {
                    dotColor = COLOR_RED;
                } else if (sev === 'warning') {
                    dotColor = COLOR_AMBER;
                }
                doc.setFillColor(...dotColor);
                if (typeof doc.circle === 'function') {
                    doc.circle(MARGIN_L + 1.5, y - 1, 1.2, 'F');
                }

                doc.setFontSize(FONT_SUBTITLE);
                doc.setFont(FONT_NAME, 'bold');
                doc.setTextColor(...COLOR_BLACK);
                doc.text(issueLines, MARGIN_L + 4, y);

                if (prob.severity) {
                    doc.setFontSize(FONT_SMALL);
                    doc.setFont(FONT_NAME, 'bold');
                    doc.setTextColor(...dotColor);
                    doc.text(safeStr(prob.severity), PAGE_W - MARGIN_R, y, { align: 'right' });
                }
                y += issueLines.length * LINE_H;

                if (errorLines.length > 0) {
                    doc.setFontSize(FONT_BODY);
                    doc.setFont(FONT_NAME, 'italic');
                    doc.setTextColor(153, 27, 27);
                    doc.text(errorLines, MARGIN_L + 4, y);
                    y += errorLines.length * LINE_H;
                }

                if (fixLines.length > 0) {
                    doc.setFontSize(FONT_BODY);
                    doc.setFont(FONT_NAME, 'normal');
                    doc.setTextColor(22, 101, 52);
                    doc.text(fixLines, MARGIN_L + 4, y);
                    y += fixLines.length * LINE_H;
                }

                if (outcomeLines.length > 0) {
                    doc.setFontSize(FONT_SMALL);
                    doc.setFont(FONT_NAME, 'bold');
                    doc.setTextColor(...COLOR_TEAL);
                    doc.text(outcomeLines, MARGIN_L + 4, y);
                    y += outcomeLines.length * LINE_H;
                }

                y += 4;
            });
        }

        // Section III: Kế hoạch buổi học tiếp theo
        const nextBriefing = norm?.nextBriefing || norm?.next_lesson_briefing || {};
        const warmups = nextBriefing.warmup_quiz_questions || nextBriefing.warmup_tasks || [];
        const followups = nextBriefing.teacher_followup_focus || nextBriefing.followup_error_focus || [];
        const homework = nextBriefing.student_homework_checklist || nextBriefing.recommended_homework || [];

        if (warmups.length > 0 || followups.length > 0 || homework.length > 0) {
            y = drawSectionHeader(doc, y, 'III. KẾ HOẠCH CHO BUỔI HỌC TIẾP THEO', headerInfo, footerText);

            if (warmups.length > 0) {
                y = checkPageBreak(doc, y, 16, headerInfo, footerText);
                doc.setFontSize(FONT_SUBTITLE);
                doc.setFont(FONT_NAME, 'bold');
                doc.setTextColor(...COLOR_TEAL);
                doc.text('1. Câu hỏi / Bài tập khởi động:', MARGIN_L, y);
                y += 5;

                warmups.forEach((w, idx) => {
                    const lines = wrapText(doc, `${idx + 1}. ${w}`, CONTENT_W - 6);
                    y = checkPageBreak(doc, y, lines.length * LINE_H, headerInfo, footerText);
                    doc.setFontSize(FONT_BODY);
                    doc.setFont(FONT_NAME, 'normal');
                    doc.setTextColor(...COLOR_BLACK);
                    doc.text(lines, MARGIN_L + 4, y);
                    y += lines.length * LINE_H + 1;
                });
                y += 3;
            }

            if (followups.length > 0) {
                y = checkPageBreak(doc, y, 16, headerInfo, footerText);
                doc.setFontSize(FONT_SUBTITLE);
                doc.setFont(FONT_NAME, 'bold');
                doc.setTextColor(...COLOR_TEAL);
                doc.text('2. Trọng tâm giáo viên cần theo dõi:', MARGIN_L, y);
                y += 5;

                followups.forEach((f) => {
                    const lines = wrapText(doc, `• ${f}`, CONTENT_W - 6);
                    y = checkPageBreak(doc, y, lines.length * LINE_H, headerInfo, footerText);
                    doc.setFontSize(FONT_BODY);
                    doc.setFont(FONT_NAME, 'normal');
                    doc.setTextColor(...COLOR_BLACK);
                    doc.text(lines, MARGIN_L + 4, y);
                    y += lines.length * LINE_H + 1;
                });
                y += 3;
            }

            if (homework.length > 0) {
                y = checkPageBreak(doc, y, 16, headerInfo, footerText);
                doc.setFontSize(FONT_SUBTITLE);
                doc.setFont(FONT_NAME, 'bold');
                doc.setTextColor(...COLOR_TEAL);
                doc.text('3. Bài tập về nhà giao cho học viên:', MARGIN_L, y);
                y += 5;

                // Calculate default due date from Phase C
                let dueDateFormatted = '';
                const sessionDateStr = session.sessionDate || session.date || session.createdAt;
                let dueYmd = null;
                if (window.CrmTeachingSessions && typeof window.CrmTeachingSessions.calculateDefaultDueDate === 'function') {
                    dueYmd = window.CrmTeachingSessions.calculateDefaultDueDate(sessionDateStr);
                } else {
                    const now = new Date();
                    const minDue = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                    let baseDate = sessionDateStr ? new Date(sessionDateStr) : new Date(now.getTime());
                    if (Number.isNaN(baseDate.getTime())) baseDate = new Date(now.getTime());
                    let targetDate = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
                    targetDate.setHours(20, 0, 0, 0);
                    if (targetDate < minDue) {
                        targetDate = new Date(minDue.getTime());
                        targetDate.setHours(20, 0, 0, 0);
                        if (targetDate < minDue) targetDate.setDate(targetDate.getDate() + 1);
                    }
                    const yyyy = targetDate.getFullYear();
                    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
                    const dd = String(targetDate.getDate()).padStart(2, '0');
                    dueYmd = `${yyyy}-${mm}-${dd}`;
                }
                if (dueYmd) {
                    const parts = dueYmd.split('-');
                    if (parts.length === 3) {
                        dueDateFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
                    }
                }

                homework.forEach((hw) => {
                    const hwText = dueDateFormatted ? `${hw} [Hạn nộp: 20:00 ngày ${dueDateFormatted}]` : hw;
                    const lines = wrapText(doc, hwText, CONTENT_W - 12);
                    y = checkPageBreak(doc, y, lines.length * LINE_H + 2, headerInfo, footerText);

                    // Checkbox box
                    doc.setDrawColor(...COLOR_GRAY);
                    doc.rect(MARGIN_L + 4, y - 3, 3.5, 3.5);

                    doc.setFontSize(FONT_BODY);
                    doc.setFont(FONT_NAME, 'normal');
                    doc.setTextColor(...COLOR_BLACK);
                    doc.text(lines, MARGIN_L + 10, y);
                    y += lines.length * LINE_H + 2;
                });
            }
        }

        drawPageFooter(doc, footerText);

        // Clean ASCII-folded filename trick
        const fileStudentName = (studentName || 'student')
            .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^0-9a-zA-Z\s_-]/g, '')
            .trim().replace(/\s+/g, '-') || 'student';
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const filename = `teaching-session-briefing-${fileStudentName}-${dateStr}.pdf`;

        if (opts.returnBlob) {
            return doc.output('blob');
        }

        doc.save(filename);
        return { filename, success: true };
    }

    const api = {
        generateTeachingSessionPdf,
        loadFonts,
        ensureJsPdfLoaded
    };

    global.generateTeachingSessionPdf = generateTeachingSessionPdf;
    global.CrmTeachingSessionPdf = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
