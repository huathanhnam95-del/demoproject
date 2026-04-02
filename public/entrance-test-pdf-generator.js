/**
 * Entrance Test PDF Generator — Direct jsPDF Draw
 * Generates a professional PDF from raw test data without DOM cloning.
 * Uses embedded Roboto font for Vietnamese diacritics support.
 */
(function () {
    'use strict';

    // ==================== CONSTANTS ====================
    const PAGE_W = 210;     // A4 width mm
    const PAGE_H = 297;     // A4 height mm
    const MARGIN_L = 18;
    const MARGIN_R = 18;
    const MARGIN_T = 22;
    const MARGIN_B = 20;
    const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

    const COLOR_TEAL = [27, 67, 50];       // #1B4332
    const COLOR_GREEN = [45, 106, 79];     // #2D6A4F
    const COLOR_BLACK = [33, 33, 33];
    const COLOR_GRAY = [120, 120, 120];
    const COLOR_LIGHT = [200, 200, 200];
    const COLOR_CORRECT = [34, 139, 34];   // green
    const COLOR_WRONG = [200, 40, 40];     // red
    const COLOR_BLANK_BG = [255, 224, 130]; // vivid amber background for blanks
    const COLOR_BLANK_TEXT = [13, 71, 161]; // strong blue for blank text in paragraph
    const COLOR_CARD_BG = [240, 248, 244];  // very light teal for score card background
    const COLOR_CARD_BORDER = [180, 215, 200]; // teal border for score card

    const FONT_TITLE = 16;
    const FONT_SECTION = 13;
    const FONT_QUESTION = 11;
    const FONT_BODY = 9.5;
    const FONT_SMALL = 8;
    const FONT_FOOTER = 7.5;

    const LINE_H = 5;    // line height for body text (increased for readability)
    const FONT_NAME = 'Roboto';

    // Max objective questions per page before forced break
    const OBJ_QUESTIONS_PER_PAGE = 2;

    // ==================== HELPERS ====================

    function safeStr(v) { return v == null ? '' : String(v); }
    function dash() { return '\u2014'; }

    function percentFromFraction(n, d) {
        if (!d || d <= 0) return null;
        return Math.round((n / d) * 1000) / 10;
    }

    function formatPercent(pct) {
        return pct == null ? dash() : pct + '%';
    }

    function formatDateTime(v) {
        if (!v) return dash();
        const d = typeof v === 'string' ? new Date(v) : (v.toDate ? v.toDate() : new Date(v));
        if (isNaN(d.getTime())) return dash();
        return d.toLocaleString();
    }

    function normalizeScoring(test) {
        const scoring = test?.scoring && typeof test.scoring === 'object' ? test.scoring : null;
        return {
            scoring,
            vocab: scoring?.vocab || null,
            grammar: scoring?.grammar || null,
            listenWrite: scoring?.listenWrite || null,
            overall: scoring?.overall || null
        };
    }

    function findSection(session, id) {
        const sections = Array.isArray(session?.sections) ? session.sections : [];
        return sections.find(s => String(s?.id || '') === id) || null;
    }

    function findScoredQuestion(sectionScoring, questionId) {
        const questions = Array.isArray(sectionScoring?.questions) ? sectionScoring.questions : [];
        return questions.find(q => String(q?.questionId || '') === questionId) || null;
    }

    function buildBlankMap(sectionScoring) {
        const out = new Map();
        const questions = Array.isArray(sectionScoring?.questions) ? sectionScoring.questions : [];
        for (const q of questions) {
            const blanks = Array.isArray(q?.blanks) ? q.blanks : [];
            for (const b of blanks) {
                if (!b?.blankId) continue;
                out.set(String(b.blankId), b);
            }
        }
        return out;
    }

    /**
     * Build structured paragraph segments from parts.
     * Returns array of { text, isBlank, blankDetail }.
     * Blanks are marked so the renderer can highlight them.
     */
    function buildParagraphSegments(parts, blankMap) {
        const safeParts = Array.isArray(parts) ? parts : [];
        const segments = [];
        for (const part of safeParts) {
            if (!part || typeof part !== 'object') continue;
            if (part.type !== 'blank') {
                segments.push({ text: safeStr(part.text), isBlank: false });
                continue;
            }
            const blankId = safeStr(part.blankId);
            const detail = blankMap?.get ? blankMap.get(blankId) : null;
            const actual = detail?.actual ? safeStr(detail.actual) : '___';
            segments.push({ text: actual, isBlank: true, blankDetail: detail });
        }
        return segments;
    }

    // Simple word-level diff for transcript
    function computeTranscriptDiff(expectedText, transcriptText) {
        if (!expectedText && !transcriptText) return [];
        if (!expectedText) return [{ type: 'added', word: transcriptText }];
        if (!transcriptText) return [{ type: 'missing', word: expectedText }];

        function tokenize(text) { return text.trim().split(/\s+/); }
        function isMatch(a, b) {
            const na = a.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const nb = b.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            return na === nb;
        }

        const aWords = tokenize(expectedText);
        const bWords = tokenize(transcriptText);
        const aLen = aWords.length;
        const bLen = bWords.length;

        const dp = Array(aLen + 1).fill(null).map(() => Array(bLen + 1).fill(0));
        for (let i = 1; i <= aLen; i++) {
            for (let j = 1; j <= bLen; j++) {
                if (isMatch(aWords[i - 1], bWords[j - 1])) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        let i = aLen, j = bLen;
        const result = [];
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && isMatch(aWords[i - 1], bWords[j - 1])) {
                result.unshift({ type: 'correct', word: bWords[j - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                result.unshift({ type: 'added', word: bWords[j - 1] });
                j--;
            } else if (i > 0) {
                result.unshift({ type: 'missing', word: aWords[i - 1] });
                i--;
            }
        }
        return result;
    }

    // ==================== FONT LOADING ====================

    async function loadFonts(doc) {
        const fontFiles = [
            { file: 'Roboto-Regular.ttf', style: 'normal' },
            { file: 'Roboto-Bold.ttf', style: 'bold' },
            { file: 'Roboto-Italic.ttf', style: 'italic' }
        ];

        for (const { file, style } of fontFiles) {
            try {
                const res = await fetch('/fonts/' + file);
                if (!res.ok) throw new Error('Font fetch failed: ' + res.status);
                const buffer = await res.arrayBuffer();
                // Convert ArrayBuffer to base64 string for jsPDF VFS
                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);
                doc.addFileToVFS(file, base64);
                doc.addFont(file, FONT_NAME, style);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn('[PDF] Failed to load font ' + file + ':', e.message);
            }
        }

        doc.setFont(FONT_NAME, 'normal');
    }

    // ==================== PDF DRAWING ====================

    function checkPageBreak(doc, y, needed, studentName, footerText) {
        if (y + needed > PAGE_H - MARGIN_B) {
            drawPageFooter(doc, footerText);
            doc.addPage();
            drawPageHeader(doc, studentName);
            return MARGIN_T + 14;
        }
        return y;
    }

    function forceNewPage(doc, y, studentName, footerText) {
        drawPageFooter(doc, footerText);
        doc.addPage();
        drawPageHeader(doc, studentName);
        return MARGIN_T + 14;
    }

    function drawPageHeader(doc, studentName) {
        doc.setFontSize(8);
        doc.setTextColor(...COLOR_TEAL);
        doc.setFont(FONT_NAME, 'bold');
        doc.text('BEL CRM', MARGIN_L, 10);
        doc.setFont(FONT_NAME, 'normal');
        doc.setFontSize(10);
        doc.text('Entrance Test Result', MARGIN_L + 20, 10);
        doc.setFontSize(8);
        doc.setTextColor(...COLOR_GRAY);
        doc.text(safeStr(studentName), PAGE_W - MARGIN_R, 10, { align: 'right' });

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
        doc.text('Page ' + pageNum, PAGE_W - MARGIN_R, PAGE_H - 10, { align: 'right' });
    }

    function wrapText(doc, text, maxWidth) {
        if (!text) return [];
        return doc.splitTextToSize(safeStr(text), maxWidth);
    }

    function drawSectionHeader(doc, y, title, studentName, footerText) {
        y = checkPageBreak(doc, y, 18, studentName, footerText);
        y += 3; // extra top spacing
        doc.setFontSize(FONT_SECTION);
        doc.setFont(FONT_NAME, 'bold');
        doc.setTextColor(...COLOR_TEAL);
        doc.text(title, MARGIN_L, y);
        y += 2;
        doc.setDrawColor(...COLOR_TEAL);
        doc.setLineWidth(0.5);
        doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y);
        y += 7; // more spacing after section header
        return y;
    }

    function drawQuestionHeader(doc, y, questionNum, rightText) {
        doc.setFontSize(FONT_QUESTION);
        doc.setFont(FONT_NAME, 'bold');
        doc.setTextColor(...COLOR_BLACK);
        const qLabel = 'Question ' + questionNum;
        doc.text(qLabel, MARGIN_L, y);

        // Place "Correct: X/Y" right next to question label
        const qLabelW = doc.getTextWidth(qLabel);
        doc.setFont(FONT_NAME, 'bold');
        doc.setFontSize(FONT_SMALL + 2);
        doc.setTextColor(...COLOR_TEAL);
        doc.text(rightText, MARGIN_L + qLabelW + 6, y);

        y += 6;
        return y;
    }

    function drawBodyText(doc, y, text, studentName, footerText) {
        doc.setFontSize(FONT_BODY);
        doc.setFont(FONT_NAME, 'normal');
        doc.setTextColor(...COLOR_BLACK);
        const lines = wrapText(doc, text, CONTENT_W);
        for (const line of lines) {
            y = checkPageBreak(doc, y, LINE_H + 1, studentName, footerText);
            doc.text(line, MARGIN_L, y);
            y += LINE_H;
        }
        return y;
    }

    /**
     * Draw paragraph with highlighted blanks.
     * Segments = [{ text, isBlank, blankDetail }, ...]
     * Blanks are drawn with bold blue text + light background pill.
     */
    function drawHighlightedParagraph(doc, y, segments, studentName, footerText) {
        doc.setFontSize(FONT_BODY);
        const maxW = CONTENT_W;

        // Flatten segments into word-level tokens preserving blank info
        const tokens = [];
        for (const seg of segments) {
            if (seg.isBlank) {
                // The entire blank answer is one token
                tokens.push({ word: seg.text, isBlank: true, detail: seg.blankDetail });
            } else {
                // Split normal text into words
                const words = seg.text.split(/(\s+)/);
                for (const w of words) {
                    if (w.trim()) tokens.push({ word: w, isBlank: false });
                    else if (w) tokens.push({ word: w, isBlank: false, isSpace: true });
                }
            }
        }

        // Wrap tokens into lines
        const lines = [];
        let currentLine = [];
        let currentW = 0;

        for (const token of tokens) {
            if (token.isSpace) {
                currentLine.push(token);
                doc.setFont(FONT_NAME, 'normal');
                currentW += doc.getTextWidth(token.word);
                continue;
            }
            doc.setFont(FONT_NAME, token.isBlank ? 'bold' : 'normal');
            const tw = doc.getTextWidth(token.word);
            if (currentW + tw > maxW && currentLine.length > 0) {
                lines.push([...currentLine]);
                currentLine = [];
                currentW = 0;
            }
            currentLine.push(token);
            currentW += tw;
            // Add implicit space after word
            doc.setFont(FONT_NAME, 'normal');
            currentW += doc.getTextWidth(' ');
        }
        if (currentLine.length > 0) lines.push(currentLine);

        // Draw each line
        for (const lineTokens of lines) {
            y = checkPageBreak(doc, y, LINE_H + 1, studentName, footerText);
            let x = MARGIN_L;
            for (const token of lineTokens) {
                if (token.isSpace) {
                    x += doc.getTextWidth(token.word);
                    continue;
                }
                if (token.isBlank) {
                    // Draw intensely highlighted blank — vivid amber bg + bold blue text + underline
                    doc.setFont(FONT_NAME, 'bold');
                    doc.setFontSize(FONT_BODY + 0.5);
                    const tw = doc.getTextWidth(token.word);
                    // Vivid amber background pill (larger padding)
                    doc.setFillColor(...COLOR_BLANK_BG);
                    doc.roundedRect(x - 1, y - 3.5, tw + 2, 4.8, 1, 1, 'F');
                    // Thin border around pill
                    doc.setDrawColor(255, 180, 0);
                    doc.setLineWidth(0.3);
                    doc.roundedRect(x - 1, y - 3.5, tw + 2, 4.8, 1, 1, 'S');
                    // Strong blue bold text
                    doc.setTextColor(...COLOR_BLANK_TEXT);
                    doc.text(token.word, x, y);
                    // Underline
                    doc.setDrawColor(...COLOR_BLANK_TEXT);
                    doc.setLineWidth(0.25);
                    doc.line(x, y + 0.8, x + tw, y + 0.8);
                    doc.setFontSize(FONT_BODY);
                    x += tw + doc.getTextWidth(' ');
                } else {
                    doc.setFont(FONT_NAME, 'normal');
                    doc.setFontSize(FONT_BODY);
                    doc.setTextColor(...COLOR_BLACK);
                    doc.text(token.word, x, y);
                    x += doc.getTextWidth(token.word) + doc.getTextWidth(' ');
                }
            }
            y += LINE_H;
        }

        doc.setFont(FONT_NAME, 'normal');
        doc.setTextColor(...COLOR_BLACK);
        return y;
    }

    function drawTranscriptBlock(doc, y, diffTokens, studentName, footerText) {
        y = checkPageBreak(doc, y, 12, studentName, footerText);

        doc.setFontSize(FONT_SMALL);
        doc.setFont(FONT_NAME, 'bold');
        doc.setTextColor(...COLOR_BLACK);
        doc.text('Transcript:', MARGIN_L + 2, y);
        y += 4;

        doc.setFontSize(FONT_BODY);
        doc.setFont(FONT_NAME, 'normal');

        let currentLine = [];
        let currentLineWidth = 0;
        const maxW = CONTENT_W - 4;
        const allLines = [];

        for (const token of diffTokens) {
            const wordW = doc.getTextWidth(token.word + ' ');
            if (currentLineWidth + wordW > maxW && currentLine.length > 0) {
                allLines.push([...currentLine]);
                currentLine = [];
                currentLineWidth = 0;
            }
            currentLine.push(token);
            currentLineWidth += wordW;
        }
        if (currentLine.length > 0) allLines.push(currentLine);

        for (const lineTokens of allLines) {
            y = checkPageBreak(doc, y, LINE_H + 1, studentName, footerText);
            let x = MARGIN_L + 2;
            for (const token of lineTokens) {
                if (token.type === 'correct') {
                    doc.setTextColor(...COLOR_CORRECT);
                    doc.setFont(FONT_NAME, 'normal');
                } else if (token.type === 'added') {
                    doc.setTextColor(...COLOR_WRONG);
                    doc.setFont(FONT_NAME, 'bold');
                } else if (token.type === 'missing') {
                    doc.setTextColor(...COLOR_GRAY);
                    doc.setFont(FONT_NAME, 'italic');
                }
                doc.text(token.word, x, y);
                x += doc.getTextWidth(token.word + ' ');
            }
            y += LINE_H;
        }

        doc.setFont(FONT_NAME, 'normal');
        doc.setTextColor(...COLOR_BLACK);
        return y;
    }

    function drawBlanksTable(doc, y, blanks, studentName, footerText) {
        if (!blanks || blanks.length === 0) return y;

        const colX = [MARGIN_L, MARGIN_L + 12, MARGIN_L + 65];

        y = checkPageBreak(doc, y, 8, studentName, footerText);

        doc.setFontSize(FONT_SMALL);
        doc.setFont(FONT_NAME, 'bold');
        doc.setTextColor(...COLOR_GRAY);
        doc.text('#', colX[0], y);
        doc.text('CORRECT ANSWER', colX[1], y);
        doc.text('YOUR ANSWER', colX[2], y);
        y += 1.5;
        doc.setDrawColor(...COLOR_LIGHT);
        doc.setLineWidth(0.2);
        doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y);
        y += 3.5;

        doc.setFontSize(FONT_BODY);
        for (let i = 0; i < blanks.length; i++) {
            y = checkPageBreak(doc, y, 6, studentName, footerText);
            const b = blanks[i];
            const expected = safeStr(b?.expected) || dash();
            const actual = safeStr(b?.actual) || dash();
            const isCorrect = b?.isCorrect === true;
            const isWrong = b?.isCorrect === false;

            doc.setFont(FONT_NAME, 'bold');
            doc.setTextColor(...COLOR_BLACK);
            doc.text(String(i + 1), colX[0], y);

            // Correct Answer column first
            doc.setFont(FONT_NAME, 'normal');
            doc.setTextColor(...COLOR_BLACK);
            doc.text(expected, colX[1], y);

            // Your Answer column second (colored)
            if (isCorrect) {
                doc.setTextColor(...COLOR_CORRECT);
                doc.setFont(FONT_NAME, 'bold');
            } else if (isWrong) {
                doc.setTextColor(...COLOR_WRONG);
                doc.setFont(FONT_NAME, 'bold');
            } else {
                doc.setTextColor(...COLOR_GRAY);
                doc.setFont(FONT_NAME, 'normal');
            }
            doc.text(actual, colX[2], y);
            y += 5;
        }

        doc.setFont(FONT_NAME, 'normal');
        doc.setTextColor(...COLOR_BLACK);
        return y;
    }

    function drawSeparator(doc, y) {
        doc.setDrawColor(...COLOR_LIGHT);
        doc.setLineWidth(0.15);
        doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y);
        return y + 4;
    }

    // ==================== SECTION RENDERERS ====================

    function drawScoreSummary(doc, y, test, studentName, footerText) {
        const { scoring, vocab, grammar, listenWrite, overall } = normalizeScoring(test);

        // ---- REDESIGNED SCORE CARD ----
        doc.setFontSize(FONT_TITLE + 2);
        doc.setFont(FONT_NAME, 'bold');
        doc.setTextColor(...COLOR_TEAL);
        doc.text('Entrance Test Result', MARGIN_L, y);
        y += 8;

        if (!scoring) {
            doc.setFontSize(FONT_BODY);
            doc.setFont(FONT_NAME, 'normal');
            doc.setTextColor(...COLOR_GRAY);
            doc.text('Test has not been submitted yet.', MARGIN_L, y);
            return y + 8;
        }

        const overallScore = overall ? (overall.scoredCorrect || 0) + '/' + (overall.scoredTotal || 0) : dash();
        const overallPct = overall ? percentFromFraction(overall.scoredCorrect || 0, overall.scoredTotal || 0) : null;

        // Card background with rounded rect
        const cardX = MARGIN_L;
        const cardW = CONTENT_W;
        const cardH = 42;
        doc.setFillColor(...COLOR_CARD_BG);
        doc.roundedRect(cardX, y - 4, cardW, cardH, 3, 3, 'F');
        doc.setDrawColor(...COLOR_CARD_BORDER);
        doc.setLineWidth(0.4);
        doc.roundedRect(cardX, y - 4, cardW, cardH, 3, 3, 'S');

        // Left side: Score
        const innerX = cardX + 6;
        doc.setFontSize(8);
        doc.setFont(FONT_NAME, 'normal');
        doc.setTextColor(...COLOR_GRAY);
        doc.text('OVERALL SCORE (OBJECTIVE)', innerX, y + 2);

        doc.setFontSize(28);
        doc.setFont(FONT_NAME, 'bold');
        doc.setTextColor(...COLOR_TEAL);
        doc.text(overallScore, innerX, y + 14);

        // Right side: Percentage badge
        const pctText = formatPercent(overallPct);
        doc.setFontSize(18);
        doc.setFont(FONT_NAME, 'bold');
        const pctW = doc.getTextWidth(pctText);
        const badgeX = cardX + cardW - 8 - pctW;
        // Badge background
        doc.setFillColor(...COLOR_GREEN);
        doc.roundedRect(badgeX - 4, y - 1, pctW + 8, 12, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(pctText, badgeX, y + 8);

        // Progress bar inside card
        const barY = y + 20;
        const barW = cardW - 12;
        const barH = 4;
        doc.setFillColor(220, 230, 225);
        doc.roundedRect(innerX, barY, barW, barH, 2, 2, 'F');
        const fillW = Math.max(0, Math.min(barW, barW * ((overallPct || 0) / 100)));
        doc.setFillColor(...COLOR_GREEN);
        doc.roundedRect(innerX, barY, fillW, barH, 2, 2, 'F');

        // Section breakdown inside card
        const vocabLabel = vocab ? 'Vocab ' + (vocab.correctTotal || 0) + '/' + (vocab.blanksTotal || 0) : 'Vocab ' + dash();
        const grammarLabel = grammar ? 'Grammar ' + (grammar.correctTotal || 0) + '/' + (grammar.blanksTotal || 0) : 'Grammar ' + dash();
        const listenLabel = listenWrite ? 'Listen & Write ' + (listenWrite.correctTotal || 0) + '/' + (listenWrite.blanksTotal || 0) : 'Listen & Write ' + dash();
        const vocabPct = vocab ? percentFromFraction(vocab.correctTotal || 0, vocab.blanksTotal || 0) : null;
        const grammarPct = grammar ? percentFromFraction(grammar.correctTotal || 0, grammar.blanksTotal || 0) : null;
        const listenPct = listenWrite ? percentFromFraction(listenWrite.correctTotal || 0, listenWrite.blanksTotal || 0) : null;

        const pillY = y + 31;
        doc.setFontSize(FONT_SMALL + 0.5);
        doc.setFont(FONT_NAME, 'normal');

        const pills = [
            { label: vocabLabel, pct: vocabPct },
            { label: grammarLabel, pct: grammarPct },
            { label: listenLabel, pct: listenPct }
        ];
        let pillX = innerX;
        for (const pill of pills) {
            doc.setTextColor(...COLOR_BLACK);
            doc.setFont(FONT_NAME, 'bold');
            doc.text(pill.label, pillX, pillY);
            const labelW = doc.getTextWidth(pill.label);
            doc.setTextColor(...COLOR_GREEN);
            doc.setFont(FONT_NAME, 'normal');
            doc.text(' ' + formatPercent(pill.pct), pillX + labelW, pillY);
            pillX += labelW + doc.getTextWidth(' ' + formatPercent(pill.pct)) + 10;
        }

        y += cardH + 8;
        return y;
    }

    function drawSpeakingSection(doc, y, test, session, studentName, footerText) {
        y = drawSectionHeader(doc, y, 'I. Speaking (\u0110\u1eccC & N\u00d3I)', studentName, footerText);

        const speakingSession = findSection(session, 'speaking');
        const questions = Array.isArray(speakingSession?.questions) ? speakingSession.questions : [];
        const speaking = test?.speaking && typeof test.speaking === 'object' ? test.speaking : {};

        for (let idx = 0; idx < questions.length; idx++) {
            const q = questions[idx];
            const qId = safeStr(q?.questionId || q?.id);
            const entry = speaking[qId] || null;
            const accuracy = typeof entry?.accuracyPercent === 'number' ? entry.accuracyPercent + '%' : dash();
            const transcript = entry?.transcript ? safeStr(entry.transcript) : '';
            const expectedText = q?.text ? safeStr(q.text) : '';

            y = checkPageBreak(doc, y, 20, studentName, footerText);
            y = drawQuestionHeader(doc, y, idx + 1, 'Accuracy: ' + accuracy);

            y = drawBodyText(doc, y, expectedText, studentName, footerText);
            y += 2;

            if (transcript) {
                const diffTokens = computeTranscriptDiff(expectedText, transcript);
                y = drawTranscriptBlock(doc, y, diffTokens, studentName, footerText);
            }

            y += 4; // more spacing between speaking questions
            if (idx < questions.length - 1) {
                y = drawSeparator(doc, y);
                y += 2;
            }
        }

        return y;
    }

    function drawObjectiveSection(doc, y, title, sectionId, session, sectionScoring, studentName, footerText) {
        y = drawSectionHeader(doc, y, title, studentName, footerText);

        const sec = findSection(session, sectionId);
        const questions = Array.isArray(sec?.questions) ? sec.questions : [];
        const blankMap = buildBlankMap(sectionScoring);

        let questionsOnPage = 0;

        for (let idx = 0; idx < questions.length; idx++) {
            // Force page break after every OBJ_QUESTIONS_PER_PAGE questions
            if (questionsOnPage >= OBJ_QUESTIONS_PER_PAGE) {
                y = forceNewPage(doc, y, studentName, footerText);
                questionsOnPage = 0;
            }

            const q = questions[idx];
            const qId = safeStr(q?.questionId || q?.id);
            const scoredQ = findScoredQuestion(sectionScoring, qId);
            const correct = typeof scoredQ?.correct === 'number' ? scoredQ.correct : 0;
            const total = typeof scoredQ?.total === 'number' ? scoredQ.total : 0;

            y = checkPageBreak(doc, y, 20, studentName, footerText);
            y = drawQuestionHeader(doc, y, idx + 1, 'Correct: ' + correct + '/' + total);

            // Draw paragraph with highlighted blanks
            if (q?.parts) {
                const segments = buildParagraphSegments(q.parts, blankMap);
                y = drawHighlightedParagraph(doc, y, segments, studentName, footerText);
            } else {
                y = drawBodyText(doc, y, 'Question text unavailable.', studentName, footerText);
            }
            y += 2;

            // Blanks table
            if (scoredQ) {
                const blanks = Array.isArray(scoredQ.blanks) ? scoredQ.blanks : [];
                y = drawBlanksTable(doc, y, blanks, studentName, footerText);
            }

            y += 4; // more spacing after blanks table
            if (idx < questions.length - 1 && questionsOnPage < OBJ_QUESTIONS_PER_PAGE - 1) {
                y = drawSeparator(doc, y);
                y += 2; // extra spacing between questions
            }

            questionsOnPage++;
        }

        return y;
    }

    // ==================== MAIN GENERATOR ====================

    window.generateEntranceTestPdf = async function generateEntranceTestPdf(data) {
        var JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || null;
        if (!JsPDF) {
            throw new Error('jsPDF is not available. Ensure the jsPDF script is loaded.');
        }

        var doc = new JsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

        // Load Vietnamese-capable Roboto fonts
        await loadFonts(doc);

        var testId = safeStr(data?.testId);
        var test = data?.test || {};
        var lead = data?.lead || null;
        var student = data?.student || null;
        var session = data?.session || null;

        var studentName = safeStr(student?.name || lead?.name || 'Student');
        var now = new Date();
        var footerText = 'Generated on ' + now.toLocaleString() + ' \u2022 BEL Entrance Test';

        // ---- Page 1: Header + Score Summary + Speaking ----
        drawPageHeader(doc, studentName);
        var y = MARGIN_T + 14;

        doc.setFontSize(FONT_SMALL);
        doc.setFont(FONT_NAME, 'normal');
        doc.setTextColor(...COLOR_GRAY);
        doc.text('Student: ' + studentName + '  \u2022  Test ID: ' + testId.substring(0, 16) + '...', MARGIN_L, y);

        var version = safeStr(test.version || '');
        if (version) {
            doc.text('Version: ' + version, PAGE_W - MARGIN_R, y, { align: 'right' });
        }
        y += 3;

        var submitted = formatDateTime(test.submittedAt);
        if (submitted !== dash()) {
            doc.text('Submitted: ' + submitted, MARGIN_L, y);
        }
        y += 6;

        y = drawScoreSummary(doc, y, test, studentName, footerText);

        var { scoring, vocab, grammar, listenWrite } = normalizeScoring(test);

        y = drawSpeakingSection(doc, y, test, session, studentName, footerText);

        // ---- Vocab section (forced page break) ----
        y = forceNewPage(doc, y, studentName, footerText);
        if (scoring) {
            y = drawObjectiveSection(doc, y, 'II. Vocab (T\u1eea V\u1ef0NG)', 'vocab', session, vocab, studentName, footerText);
        }

        // ---- Grammar section (forced page break) ----
        y = forceNewPage(doc, y, studentName, footerText);
        if (scoring) {
            y = drawObjectiveSection(doc, y, 'III. Grammar (NG\u1eee PH\u00c1P)', 'grammar', session, grammar, studentName, footerText);
        }

        // ---- Listen & Write section (forced page break) ----
        y = forceNewPage(doc, y, studentName, footerText);
        if (scoring) {
            y = drawObjectiveSection(doc, y, 'IV. Listening (NGHE & VI\u1ebeT)', 'listen_write', session, listenWrite, studentName, footerText);
        }

        drawPageFooter(doc, footerText);

        var fileStudentName = studentName
            .normalize('NFD').replace(/([\u0300-\u036f]|[^0-9a-zA-Z\s])/g, '')
            .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
            .replace(/\s+/g, '-') || 'student';
        var dateStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
        var filename = 'entrance-test-' + fileStudentName + '-' + dateStr + '.pdf';

        doc.save(filename);
    };
})();
