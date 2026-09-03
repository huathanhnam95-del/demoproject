window.CrmBooksWorkspace = (function () {
    'use strict';

    // ─── SVG Icon Constants ───
    const ICON_BOOK = '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>';
    const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
    const ICON_PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
    const ICON_SEND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
    const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>';
    const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    const ICON_ERROR = '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
    const ICON_UPLOAD = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>';
    const ICON_DOC = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';
    const ICON_MUSIC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

    function fallbackEscapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    function clean(value) {
        return String(value ?? '').trim();
    }

    const AUTO_THREAD_TITLE_LENGTH = 72;
    const MAX_THREAD_TITLE_LENGTH = 120;
    const READER_FONT_SCALE_MIN = 80;
    const READER_FONT_SCALE_MAX = 180;
    const READER_FONT_SCALE_STEP = 10;
    const READER_FONT_SCALE_DEFAULT = 100;
    const READER_FONT_SCALE_STORAGE_KEY = 'crm_books_reader_font_scale';

    function clampReaderFontScale(value) {
        if (value == null || String(value).trim() === '') return READER_FONT_SCALE_DEFAULT;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return READER_FONT_SCALE_DEFAULT;
        const stepped = Math.round(numeric / READER_FONT_SCALE_STEP) * READER_FONT_SCALE_STEP;
        return Math.min(READER_FONT_SCALE_MAX, Math.max(READER_FONT_SCALE_MIN, stepped));
    }

    function normalizeCitationText(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function deriveThreadTitle(question) {
        const normalized = String(question ?? '').replace(/\s+/g, ' ').trim();
        if (normalized.length <= AUTO_THREAD_TITLE_LENGTH) return normalized;
        return `${normalized.slice(0, AUTO_THREAD_TITLE_LENGTH - 1).trimEnd()}…`;
    }

    function formatElaborateParagraphs(text, escaper = escapeHtml) {
        if (!text) return '';
        const escapeFn = typeof escaper === 'function' ? escaper : (s => String(s ?? ''));
        const escaped = escapeFn(String(text));
        return escaped
            .replace(/(?:\r?\n\s*\r?\n|\\n\s*\\n)/g, '</p><p>')
            .replace(/(?:\r?\n|\\n)/g, '<br>');
    }

    function generateElaborationMarkdown(result) {
        if (!result) return '';
        let md = `# Deep-Dive Elaboration: ${result.bookTitle || 'Book'}\n\n`;
        if (result.bookAuthor) md += `*Author: ${result.bookAuthor}*\n\n`;
        if (result.synthesis) {
            md += `## 🎯 Conceptual Synthesis\n\n${result.synthesis}\n\n---\n\n`;
        }
        (result.elaborations || []).forEach((el, idx) => {
            md += `### #${idx + 1} ${el.concept || 'Concept'} ${el.pageRef ? `(${el.pageRef})` : ''}\n\n`;
            if (el.snippetText) md += `> "${el.snippetText}"\n\n`;
            if (el.detailedExplanation) md += `${el.detailedExplanation}\n\n`;
            if (el.sourceEvidence) {
                md += `**📖 Source Grounding:**\n${el.sourceEvidence}\n\n`;
            }
            if (Array.isArray(el.keyTakeaways) && el.keyTakeaways.length > 0) {
                md += `**💡 Key Takeaways:**\n` + el.keyTakeaways.map(t => `- ${t}`).join('\n') + '\n\n';
            }
            md += `---\n\n`;
        });
        return md;
    }

    function reflowPageText(text) {
        const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
        if (!source) return '';
        return source
            .split(/\n\s*\n/)
            .map((block) => {
                const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
                let output = '';
                lines.forEach((line) => {
                    if (!output) {
                        output = line;
                        return;
                    }
                    const previous = output.slice(-1);
                    if (previous === '-' && /^[\p{L}\p{N}]/u.test(line)) {
                        output = output.slice(0, -1) + line;
                    } else {
                        output += ` ${line}`;
                    }
                });
                return output;
            })
            .filter(Boolean)
            .join('\n\n');
    }

    /**
     * Reconstructs missing spaces between words from PDF text extraction using
     * client-side dynamic programming dictionary segmentation.
     */
    function repairMissingSpaces(text) {
        if (!text || typeof text !== 'string') return text;
        if (typeof window !== 'undefined' && window.CrmWordSegmenter && typeof window.CrmWordSegmenter.repairText === 'function') {
            return window.CrmWordSegmenter.repairText(text);
        }

        // Lightweight fallback if segmenter script is not loaded
        let result = text.replace(/([.,;:!?])([A-Za-z])/g, '$1 $2');
        result = result.replace(/([a-zA-Z])([0-9])/g, '$1 $2');
        result = result.replace(/([0-9])([a-zA-Z])/g, '$1 $2');
        result = result.replace(/([a-z])([A-Z])/g, '$1 $2');
        result = result.replace(/([a-zA-Z])\(/g, '$1 (');
        result = result.replace(/\)([a-zA-Z])/g, ') $1');
        return result;
    }

    function deduplicateRepeatedPhrases(text) {
        if (!text || typeof text !== 'string') return text;
        const lines = text.split('\n');
        const processedLines = lines.map((line) => {
            let trimmed = line.trim();
            if (!trimmed) return line;
            let prev = '';
            let iteration = 0;
            while (prev !== trimmed && iteration < 5) {
                prev = trimmed;
                iteration++;
                // Collapse consecutive runs of repeating chunks (4 to 70 chars), with or without spaces
                trimmed = trimmed.replace(/([A-Za-z0-9][A-Za-z0-9\s()/,.'’–—-]{3,70}?)(?:\s*\1)+/g, '$1');
            }
            return trimmed;
        });
        return processedLines.join('\n');
    }

    function repairArchivalOcrText(text) {
        if (!text || typeof text !== 'string') return text;
        let s = text;
        // Faded typewriter dropouts & broken ribbons from historical archival scans (e.g. Knowles 1973)
        s = s.replace(/\bth-\s*Ty\.?\b/g, 'theory');
        s = s.replace(/\beducatioual\b/g, 'educational');
        s = s.replace(/\beducatioul\b/g, 'educational');
        s = s.replace(/\bexaTiples\b/g, 'examples');
        s = s.replace(/\bizSpeiecs\b/g, 'Species');
        s = s.replace(/\bLeqrning\b/g, 'Learning');
        s = s.replace(/\bGovenment\b/g, 'Government');
        s = s.replace(/\bKidl\b(?=,?\s*195\d)/g, 'Kidd');
        s = s.replace(/\bLased\b(?=\s+on\b)/g, 'Based');
        s = s.replace(/\bapplicab\?e\b/g, 'applicable');
        return s;
    }

    function isScannerNoiseLine(line) {
        if (!line) return false;
        const trimmed = line.trim();
        if (/^\d{1,4}$/.test(trimmed)) return false; // preserve valid page numbers
        if (/^\d+(?:\.\d+)+$/.test(trimmed)) return false; // preserve section numbers like 4.9.3

        // Preserve legitimate author citations in square brackets e.g. [Bruner, 1966, pp. 4-5], [Kidd, 1959]
        if (/^\[[A-Z][a-zA-Z\s.,&'’–-]+,\s*(?:19|20)\d{2}(?:,\s*pp?\.?\s*[\d-]+)?\]$/.test(trimmed)) return false;
        if (/^\[Ibid\.(?:,\s*pp?\.?\s*[\d-]+)?\]$/i.test(trimmed)) return false;

        // Filter archival catalog/microfiche stamp codes
        if (/^(?:ED|CE)\s*\d{3}\s*\d{3}$/i.test(trimmed)) return true;
        if (/^MF-?\$[\d.]+/i.test(trimmed)) return true;

        // Filter single isolated stray characters e.g. 'N', '1,', 'v' on their own line
        if (/^[a-zA-Z0-9][,.]?$/.test(trimmed)) return true;

        const letterCount = (trimmed.match(/[a-zA-ZÀ-ɏ]/g) || []).length;
        if (letterCount === 0) return true; // pure punctuation/symbols without letters
        if (trimmed.length < 3 && letterCount < 2) return true;
        if (/(?:,{2,}|\[;|;{2,}|\.{3,}|-{3,}|%{2,})/.test(trimmed)) return true;
        const punctCount = (trimmed.match(/[^a-zA-Z0-9\s]/g) || []).length;
        if (punctCount > 3 && punctCount >= letterCount) return true;
        if (punctCount >= 3 && /[[\];%,]/.test(trimmed) && letterCount < 15) return true;
        if (/^[%#*~_+|=]{1,3}[.,;:\s-]*$/.test(trimmed)) return true;
        return false;
    }

    function pageHeadingLevel(line, nextLine) {
        if (!line) return 0;
        const trimmed = line.trim();
        if (/^(?:Part\s+[IVXLCDM]+|Chapter\s+\d+)\b/i.test(trimmed)) return 2;
        if (/^(?:Learning Objectives|Outline|Contents|References|Introduction|Conclusion|Summary|Further Reading|Video contents|Detailed contents|Preface)$/i.test(trimmed)) return 3;

        // Lettered activity or task headings: e.g. "A Friend or foe?", "B Same or different?", "C How would I do it?", "D What can I steal?"
        if (/^[A-Z][.)]?\s+[A-ZÀ-ɏ“‘"'][a-zA-Z0-9\s,/'’()–—?-]+$/.test(trimmed) && trimmed.length <= 60) {
            return 4;
        }

        // Reject lines ending with trailing prepositions, articles, or conjunctions (broken prose lines)
        if (/\b(?:to|the|of|and|or|in|on|with|for|at|by|from|a|an|into|through|as|is|are|that|which)\s*$/i.test(trimmed)) {
            return 0;
        }

        // Reject lines starting with sentence pronouns or common openers
        if (/^(?:Welcome|It is|This is|There are|They are|We |As |When |If |Because |Although |In |On |For )\b/i.test(trimmed)) {
            return 0;
        }

        // Reject lines followed by lowercase sentence continuation (not a question or dialogue)
        if (nextLine && /^[a-zà-ÿ]/.test(nextLine.trim()) && !/[?:]$/.test(nextLine.trim())) {
            return 0;
        }

        // Short standalone headings (allowing ending question mark '?' or colon ':')
        if (trimmed.length <= 60 && !/[.,;—]$/.test(trimmed)) {
            if (/^[A-ZÀ-ɏ“‘"'][a-zA-Z0-9\s,/'’()–—?-]+$/.test(trimmed)) {
                const words = trimmed.split(/\s+/);
                if (words.length >= 1 && words.length <= 8) {
                    if (!nextLine || /^[a-zA-ZÀ-ɏ“‘"'(]/.test(nextLine.trim())) {
                        return 4;
                    }
                }
            }
        }
        return 0;
    }

    function pageListItemStart(line) {
        const numbered = line.match(/^((?:\d+\.)+\d+[.)]?|\d+[.)])\s+(.+)$/);
        if (numbered) return { text: numbered[2], explicit: true, marker: numbered[1] };
        const bullet = line.match(/^(?:[•●▪◦‣]|[-*])\s+(.+)$/);
        if (bullet) return { text: bullet[1], explicit: true };
        if (/^To\s+/.test(line)) return { text: line, explicit: false };
        return null;
    }

    function splitInlineNumberedListLine(line) {
        const matches = [];
        const pattern = /(?:^|\s)((?:\d+\.)+\d+[.)]?|\d+[.)])(?=\s)/g;
        let match;
        while ((match = pattern.exec(line))) {
            const markerStart = match.index + match[0].lastIndexOf(match[1]);
            matches.push({ marker: match[1], start: markerStart, contentStart: markerStart + match[1].length });
        }
        if (matches.length < 2 || matches[0].start !== 0) return null;

        const markerParts = matches.map(({ marker }) => marker
            .replace(/[.)]$/, '')
            .split('.')
            .map(Number));
        const markerDepth = markerParts[0].length;
        const markerPrefix = markerParts[0].slice(0, -1).join('.');
        const isConsecutiveSequence = markerParts.every((parts, index) => {
            const previousParts = markerParts[index - 1];
            return parts.length === markerDepth
                && parts.every(Number.isFinite)
                && parts.slice(0, -1).join('.') === markerPrefix
                && (index === 0 || parts[markerDepth - 1] === previousParts[markerDepth - 1] + 1);
        });
        if (!isConsecutiveSequence) return null;

        return matches.map((item, index) => ({
            text: line.slice(item.contentStart, matches[index + 1]?.start ?? line.length).trim(),
            marker: item.marker
        })).filter((item) => item.text);
    }

    function inferParagraphBreaks(lines) {
        const contentLines = lines.filter((l) => l.length > 0);
        const emptyCount = lines.length - contentLines.length;
        if (contentLines.length < 5 || emptyCount >= contentLines.length * 0.1) return 0;
        const lengths = contentLines.map((l) => l.length).filter((n) => n > 15).sort((a, b) => a - b);
        if (lengths.length < 3) return 0;
        return lengths[Math.floor(lengths.length * 0.75)] * 0.85;
    }

    function looksLikeParagraphEnd(line, nextLine, threshold) {
        if (!line || !nextLine) return false;
        const nextTrim = nextLine.trim();
        if (/^\d+(?:\.\d+)+$/.test(nextTrim)) return true;
        if (pageHeadingLevel(nextTrim, '') > 0) return true;
        if (/^[A-Z][.)]?\s+[A-ZÀ-ɏ“‘"']/.test(nextTrim) && nextTrim.length <= 60) return true;
        if (!threshold) return false;
        if (line.length >= threshold) return false;
        if (!/[.!?:]["'”’)]*\s*$/.test(line)) return false;
        if (!/^[A-ZÀ-ɏ“‘"'(]/.test(nextTrim)) return false;
        return true;
    }

    function formatPageBlocks(text, escHtml = fallbackEscapeHtml, highlightQuote = '', options = {}) {
        const escape = typeof escHtml === 'function' ? escHtml : fallbackEscapeHtml;
        const rendererContract = (typeof options === 'string' ? options : options?.rendererContract)
            || (typeof window !== 'undefined' && window.__currentBookRendererContract ? window.__currentBookRendererContract : null)
            || (typeof pagesData !== 'undefined' && pagesData ? pagesData.rendererContract : null)
            || 'legacy';
        let rawText = deduplicateRepeatedPhrases(String(text ?? '').replace(/\r\n?/g, '\n'));
        rawText = repairArchivalOcrText(rawText);
        rawText = rawText.replace(/^(\d{1,4})([A-Za-z])/gm, '$1\n$2');
        const repaired = rendererContract === 'ocr-v2' ? rawText : repairMissingSpaces(rawText);
        const lines = repaired
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => !isScannerNoiseLine(line));
        const fullLineThreshold = inferParagraphBreaks(lines);
        const html = [];
        let paragraphLines = [];

        const renderInline = (value) => highlightQuote
            ? highlightPageText(value, highlightQuote, escape).html
            : escape(value);
        const renderList = (items) => '<ul>' +
            items.map((item) => {
                const marker = item.marker ? `<span class="crm-books-page-list-marker">${renderInline(item.marker)}</span> ` : '';
                return `<li>${marker}${renderInline(item.text)}</li>`;
            }).join('') +
            `</ul>`;
        const flushParagraph = () => {
            if (!paragraphLines.length) return;
            const value = reflowPageText(paragraphLines.join('\n'));
            if (value) html.push(`<p>${renderInline(value)}</p>`);
            paragraphLines = [];
        };

        let index = 0;

        // Check for running header / folio at the top of the page
        if (lines.length >= 2 && /^\d{1,4}$/.test(lines[0])) {
            const folio = lines[0];
            const secondLine = lines[1];
            if (secondLine && (pageHeadingLevel(secondLine, lines[2]) || (/^[A-ZÀ-ɏ][a-zA-Z0-9\s,–—-]+$/i.test(secondLine) && secondLine.length <= 50))) {
                const isChapter = /^chapter\s+\d+/i.test(secondLine);
                const titleDisplay = isChapter
                    ? secondLine.replace(/^chapter\s+(\d+)/i, 'Chapter $1')
                    : secondLine;
                html.push(
                    `<header class="crm-books-page-header">` +
                    `<span class="crm-books-header-folio">${renderInline(folio)}</span>` +
                    `<span class="crm-books-header-title">${renderInline(titleDisplay)}</span>` +
                    `</header>`
                );
                index = 2;
            }
        } else if (lines.length >= 1 && /^(\d{1,4})\s+(.+)$/.test(lines[0])) {
            const m = lines[0].match(/^(\d{1,4})\s+(.+)$/);
            if (m && (pageHeadingLevel(m[2], lines[1]) || m[2].length <= 50)) {
                const isChapter = /^chapter\s+\d+/i.test(m[2]);
                const titleDisplay = isChapter
                    ? m[2].replace(/^chapter\s+(\d+)/i, 'Chapter $1')
                    : m[2];
                html.push(
                    `<header class="crm-books-page-header">` +
                    `<span class="crm-books-header-folio">${renderInline(m[1])}</span>` +
                    `<span class="crm-books-header-title">${renderInline(titleDisplay)}</span>` +
                    `</header>`
                );
                index = 1;
            }
        }

        while (index < lines.length) {
            const line = lines[index];
            if (!line) {
                flushParagraph();
                index += 1;
                continue;
            }

            // Standalone section numbers e.g. "4.9.3", "4.9.4"
            if (/^\d+(?:\.\d+)+$/.test(line)) {
                flushParagraph();
                html.push(`<div class="crm-books-section-marker"><span class="crm-books-section-badge">${renderInline(line)}</span></div>`);
                index += 1;
                continue;
            }

            const inlineNumberedItems = splitInlineNumberedListLine(line);
            if (inlineNumberedItems) {
                flushParagraph();
                html.push(renderList(inlineNumberedItems));
                index += 1;
                continue;
            }

            const firstItem = pageListItemStart(line);
            if (firstItem) {
                const items = [];
                let cursor = index;
                while (cursor < lines.length && lines[cursor]) {
                    const itemStart = pageListItemStart(lines[cursor]);
                    if (!itemStart) break;
                    const itemLines = [itemStart.text];
                    cursor += 1;
                    while (cursor < lines.length && lines[cursor]
                        && !pageHeadingLevel(lines[cursor], lines[cursor + 1])
                        && !pageListItemStart(lines[cursor])
                        && !/^\d+(?:\.\d+)+$/.test(lines[cursor])) {
                        const prev = itemLines[itemLines.length - 1];
                        if (/[.!?]["'”’)]*$/.test(prev)) {
                            break;
                        }
                        itemLines.push(lines[cursor]);
                        cursor += 1;
                    }
                    items.push({
                        text: reflowPageText(itemLines.join('\n')),
                        explicit: itemStart.explicit,
                        marker: itemStart.marker
                    });
                }

                if (items.length > 1 || items[0]?.explicit) {
                    flushParagraph();
                    html.push(renderList(items));
                    index = cursor;
                    continue;
                }
            }

            const headingLevel = pageHeadingLevel(line, lines[index + 1]);
            if (headingLevel) {
                flushParagraph();
                const headingText = /^chapter\s+\d+/i.test(line)
                    ? line.replace(/^chapter\s+(\d+)/i, 'Chapter $1')
                    : line;
                html.push(`<h${headingLevel}>${renderInline(headingText)}</h${headingLevel}>`);
                index += 1;
                continue;
            }

            if (paragraphLines.length > 0
                && looksLikeParagraphEnd(paragraphLines[paragraphLines.length - 1], line, fullLineThreshold)) {
                flushParagraph();
            }

            paragraphLines.push(line);
            index += 1;
        }
        flushParagraph();
        return html;
    }

    function formatPageText(text, escHtml = fallbackEscapeHtml, highlightQuote = '', options = {}) {
        return formatPageBlocks(text, escHtml, highlightQuote, options).join('');
    }

    function getReadablePageNumbers(pages) {
        return (Array.isArray(pages) ? pages : [])
            .map((text, index) => clean(text) ? index + 1 : null)
            .filter((page) => page != null);
    }

    function findAdjacentReadablePage(pages, currentPage, direction) {
        const source = Array.isArray(pages) ? pages : [];
        const step = Number(direction) < 0 ? -1 : 1;
        let page = Number(currentPage) + step;
        while (page >= 1 && page <= source.length) {
            if (clean(source[page - 1])) return page;
            page += step;
        }
        return Number(currentPage);
    }

    function normalizeWithSourceMap(value) {
        const source = String(value ?? '');
        let normalized = '';
        const sourceIndexes = [];
        let pendingSpace = false;

        for (let i = 0; i < source.length; i += 1) {
            const char = source[i];
            if (/\s/.test(char)) {
                if (normalized && !pendingSpace) {
                    pendingSpace = true;
                }
                continue;
            }

            if (pendingSpace) {
                normalized += ' ';
                sourceIndexes.push(i - 1);
                pendingSpace = false;
            }

            const canonical = char
                .normalize('NFKC')
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/[\u201C\u201D]/g, '"')
                .replace(/[\u2013\u2014]/g, '-')
                .toLowerCase();
            normalized += canonical;
            for (let offset = 0; offset < canonical.length; offset += 1) sourceIndexes.push(i);
        }

        return { normalized, sourceIndexes };
    }

    function findCitationMatch(pageText, quote) {
        const target = normalizeCitationText(quote);
        if (!target) return null;
        const mapped = normalizeWithSourceMap(pageText);
        const normalizedTarget = normalizeCitationText(target);
        const start = mapped.normalized.indexOf(normalizedTarget);
        if (start < 0) return null;
        const endIndex = start + normalizedTarget.length - 1;
        const startOffset = mapped.sourceIndexes[start];
        const endOffset = mapped.sourceIndexes[endIndex];
        if (startOffset == null || endOffset == null) return null;
        return { start: startOffset, end: endOffset + 1 };
    }

    function highlightPageText(pageText, quote, escHtml = fallbackEscapeHtml) {
        const text = String(pageText ?? '');
        const match = findCitationMatch(text, quote);
        if (!match) return { html: escHtml(text), matched: false };
        return {
            html: `${escHtml(text.slice(0, match.start))}<mark class="crm-books-citation-highlight">${escHtml(text.slice(match.start, match.end))}</mark>${escHtml(text.slice(match.end))}`,
            matched: true
        };
    }

    function buildCitationQuoteCandidates(citation) {
        const candidates = [];
        const seen = new Set();
        const add = (value) => {
            const quote = reflowPageText(value);
            const normalized = normalizeCitationText(quote);
            if (normalized.length < 12 || seen.has(normalized)) return;
            seen.add(normalized);
            candidates.push(quote);
        };

        add(citation?.highlightText);

        const snippet = String(citation?.snippet || '').replace(/\r\n?/g, '\n').trim();
        const blocks = snippet.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
        blocks.forEach((block) => {
            add(block);
            const sentences = reflowPageText(block).match(/[^.!?]+[.!?]+(?:["']|$)?/g) || [];
            sentences.forEach(add);

            const words = reflowPageText(block).split(/\s+/).filter(Boolean);
            [18, 12, 8].forEach((windowSize) => {
                if (words.length <= windowSize) return;
                const step = Math.max(1, Math.floor(windowSize / 2));
                for (let start = 0; start + windowSize <= words.length; start += step) {
                    add(words.slice(start, start + windowSize).join(' '));
                }
                add(words.slice(words.length - windowSize).join(' '));
            });
        });

        return candidates;
    }

    function resolveCitationLocation(pages, citation) {
        const sourcePages = Array.isArray(pages) ? pages : [];
        const totalPages = sourcePages.length;
        if (!totalPages) return { page: 1, quote: '', matched: false };

        const startPage = Math.max(1, Math.min(Number(citation?.pageStart) || 1, totalPages));
        const endPage = Math.max(startPage, Math.min(Number(citation?.pageEnd) || startPage, totalPages));
        const candidates = buildCitationQuoteCandidates(citation);

        for (let page = startPage; page <= endPage; page += 1) {
            const readingText = reflowPageText(sourcePages[page - 1] || '');
            for (const quote of candidates) {
                if (findCitationMatch(readingText, quote)) {
                    return { page, quote, matched: true };
                }
            }
        }

        return { page: startPage, quote: '', matched: false };
    }

    function citationMarker(citation, fallbackIndex = 0) {
        const raw = clean(citation?.marker).toUpperCase();
        return /^C\d+$/.test(raw) ? raw : `C${fallbackIndex + 1}`;
    }

    function citationNumber(citation, fallbackIndex = 0) {
        const marker = citationMarker(citation, fallbackIndex);
        return Number(marker.slice(1)) || fallbackIndex + 1;
    }

    function normalizeBooks(source) {
        return (Array.isArray(source) ? source : [])
            .map((item) => ({
                bookId: clean(item?.bookId),
                title: clean(item?.title),
                author: clean(item?.author),
                description: clean(item?.description),
                collectionId: clean(item?.collectionId),
                tags: Array.isArray(item?.tags) ? item.tags.map(clean).filter(Boolean) : [],
                pageCount: item?.pageCount ?? null,
                sizeBytes: item?.sizeBytes ?? null,
                sha256: item?.sha256 || null,
                status: clean(item?.status || 'awaiting_upload'),
                ingest: item?.ingest || null,
                source: item?.source || null,
                createdAt: item?.createdAt || null
            }))
            .filter((item) => item.bookId);
    }

    function normalizeTagName(name) {
        return clean(name).toLowerCase();
    }

    function filterBooksByTags(booksList, tagIds, matchMode = 'and') {
        if (!Array.isArray(booksList)) return [];
        if (!Array.isArray(tagIds) || tagIds.length === 0) return booksList;
        const normalizedTargetTags = tagIds.map(t => clean(t).toLowerCase()).filter(Boolean);
        if (normalizedTargetTags.length === 0) return booksList;

        return booksList.filter(book => {
            const bTags = (book.tags || []).map(t => clean(t).toLowerCase());
            if (matchMode === 'or') {
                return normalizedTargetTags.some(t => bTags.includes(t));
            }
            return normalizedTargetTags.every(t => bTags.includes(t));
        });
    }

    function groupBooksByCollection(booksList, collectionsList) {
        const result = {};
        const safeCollections = Array.isArray(collectionsList) ? collectionsList : [];
        const safeBooks = Array.isArray(booksList) ? booksList : [];

        safeCollections.forEach(c => {
            result[c.id] = [];
        });

        const pronunciationCol = safeCollections.find(c => (c.name || '').trim().toLowerCase() === 'pronunciation');
        const fallbackColId = pronunciationCol ? pronunciationCol.id : (safeCollections[0]?.id || 'default');
        if (!result[fallbackColId]) result[fallbackColId] = [];

        safeBooks.forEach(b => {
            const cId = b.collectionId;
            if (cId && result[cId]) {
                result[cId].push(b);
            } else {
                result[fallbackColId].push(b);
            }
        });

        return result;
    }

    function buildIngestLabel(ingest, status) {
        if (!ingest && status === 'awaiting_upload') return 'Upload incomplete';
        if (!ingest && status === 'ready') return 'Ready';
        if (!ingest) return status || '';
        const stage = clean(ingest.stage);
        const percent = typeof ingest.percent === 'number' ? ingest.percent : 0;
        if (status === 'failed') {
            const errRaw = ingest.error;
            const rawError = (typeof errRaw === 'string') ? clean(errRaw)
                : clean(errRaw?.message) || clean(errRaw?.code) || '';
            const codeMatch = rawError.match(/^\[([A-Z_]+)\]/);
            const code = codeMatch ? codeMatch[1]
                : (typeof errRaw === 'object' ? clean(errRaw?.code) : '');
            const map = {
                SCANNED_PDF_NO_TEXT: 'This PDF is scanned images with no selectable text. Run OCR on it first, then re-upload.',
                PDF_PARSE_FAILED: 'Could not read this PDF. It may be encrypted or corrupt.',
                EMBED_QUOTA: 'The AI service was busy. Nothing was lost — processing resumes from where it stopped.',
                AI_UNAVAILABLE: 'The AI service was busy. Nothing was lost — processing resumes from where it stopped.',
                INGEST_ERROR: rawError.replace(/^\[[A-Z_]+\]\s*/, '') || 'Processing failed'
            };
            return map[code] || rawError || 'Processing failed';
        }
        if (status === 'ready') return 'Ready';
        const stageLabels = {
            extract: 'Extracting text',
            chunk: 'Chunking',
            chunk_done: 'Chunking complete',
            embed: 'Embedding',
            summarize: 'Summarizing'
        };
        const label = stageLabels[stage] || stage || 'Processing';
        if (stage === 'embed' && ingest.totalChunks > 0) {
            return `${label} ${ingest.embeddedChunks || 0} / ${ingest.totalChunks}`;
        }
        return `${label}${percent > 0 ? ` ${Math.round(percent)}%` : ''}`;
    }

    function formatEta(ingest) {
        if (!ingest || ingest.stage !== 'embed') return null;
        const embedded = ingest.embeddedChunks || 0;
        const total = ingest.totalChunks || 0;
        if (embedded < 10 || total <= embedded) return null;
        const started = ingest.startedAt;
        if (!started) return null;
        const startMs = typeof started === 'number' ? started :
            (started?.seconds ? started.seconds * 1000 : new Date(started).getTime());
        if (!startMs || isNaN(startMs)) return null;
        const elapsedMs = Date.now() - startMs;
        if (elapsedMs < 5000) return null;
        const ratePerMs = embedded / elapsedMs;
        const remaining = total - embedded;
        const etaMs = remaining / ratePerMs;
        const etaMin = Math.ceil(etaMs / 60000);
        if (etaMin < 1) return 'less than a minute left';
        if (etaMin === 1) return 'about 1 min left';
        return `about ${etaMin} min left`;
    }

    function renderCitations(citations, escHtml) {
        if (!Array.isArray(citations) || citations.length === 0) return '';
        return `<div class="crm-books-msg-citations">${citations.map((c, i) => {
            const marker = citationMarker(c, i);
            const num = citationNumber(c, i);
            const pageStart = Number(c.pageStart) || 1;
            const pageEnd = Number(c.pageEnd) || pageStart;
            const pages = pageStart === pageEnd
                ? `p. ${pageStart}`
                : `pp. ${pageStart}\u2013${pageEnd}`;
            const snippet = escHtml(clean(c.snippet || c.highlightText).slice(0, 240));
            return `<span class="crm-books-citation-wrap" data-citation-marker="${escHtml(marker)}">` +
                `<button type="button" class="crm-books-citation-ref crm-books-citation-source" data-citation-marker="${escHtml(marker)}" title="Open ${escHtml(pages)}" aria-label="Open citation ${num}, ${escHtml(pages)}"><span class="crm-books-citation-number">${num}</span><span class="crm-books-citation-button-page">${escHtml(pages)}</span></button>` +
                `<span class="crm-books-citation-preview" role="tooltip">` +
                `<span class="crm-books-citation-pages">${escHtml(pages)}</span>` +
                `<span class="crm-books-citation-snippet">${snippet}</span>` +
                `</span></span>`;
        }).join('')}</div>`;
    }

    function ingestWeightedPercent(ingest, status) {
        if (status === 'ready') return 100;
        if (status === 'failed' || !ingest) return 0;
        const stage = clean(ingest.stage);
        const normalizedStage = stage === 'chunk_done' ? 'embed' : stage;
        const weights = { extract: 10, chunk: 5, embed: 60, summarize: 25 };
        const order = ['extract', 'chunk', 'embed', 'summarize'];
        let base = 0;
        for (const s of order) {
            if (s === normalizedStage) break;
            base += weights[s] || 0;
        }
        const stageWeight = weights[normalizedStage] || 0;
        let stageProgress = 0;
        if (stage === 'embed' && ingest.totalChunks > 0) {
            stageProgress = (ingest.embeddedChunks || 0) / ingest.totalChunks;
        } else if (typeof ingest.percent === 'number' && ingest.percent > 0) {
            stageProgress = ingest.percent / 100;
        }
        return Math.min(100, Math.round(base + stageWeight * stageProgress));
    }

    async function computeSha256(file) {
        const buffer = await file.arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function extractTitleAndAuthorFromFileName(filename) {
        if (!filename) return { title: '', author: '' };

        let name = String(filename || '').trim();
        name = name.replace(/\.[^/.]+$/, '');
        name = name.replace(/[-_]\d{8,14}$/, '');
        name = name.replace(/\s*\(\d+\)$/, '');

        let title = '';
        let author = '';

        if (/\s+by\s+/i.test(name)) {
            const parts = name.split(/\s+by\s+/i);
            title = parts[0];
            author = parts.slice(1).join(' by ');
        } else if (name.includes(' - ')) {
            const parts = name.split(' - ');
            author = parts[0];
            title = parts.slice(1).join(' - ');
        } else if (name.includes('_-_')) {
            const parts = name.split('_-_');
            author = parts[0];
            title = parts.slice(1).join(' - ');
        } else {
            title = name;
        }

        const formatSegment = (str) => {
            if (!str) return '';
            const s = str.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!s) return '';
            if (s === s.toLowerCase() || s === s.toUpperCase()) {
                return s.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
            }
            return s;
        };

        return {
            title: formatSegment(title),
            author: formatSegment(author)
        };
    }

    function extractPdfMetadata(file) {
        return new Promise((resolve) => {
            if (!file || !file.slice) return resolve({ title: '', author: '' });
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const text = String(reader.result || '');
                    let title = '';
                    let author = '';

                    const titleMatch = text.match(/\/Title\s*\(([^)]+)\)/i);
                    if (titleMatch && titleMatch[1]) {
                        title = titleMatch[1].replace(/\\([()\\])/g, '$1').trim();
                    }
                    const authorMatch = text.match(/\/Author\s*\(([^)]+)\)/i);
                    if (authorMatch && authorMatch[1]) {
                        author = authorMatch[1].replace(/\\([()\\])/g, '$1').trim();
                    }
                    resolve({ title, author });
                } catch (_) {
                    resolve({ title: '', author: '' });
                }
            };
            reader.onerror = () => resolve({ title: '', author: '' });
            reader.readAsText(file.slice(0, 16384), 'latin1');
        });
    }

    // ─── Controller ───
    function createController(deps = {}) {
        const elements = deps.elements || {};
        const showToast = typeof deps.showToast === 'function' ? deps.showToast : null;
        const apiFetchJson = typeof deps.apiFetchJson === 'function' ? deps.apiFetchJson : null;
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : fallbackEscapeHtml;
        const formatDateTime = typeof deps.formatDateTime === 'function' ? deps.formatDateTime : (v) => clean(v) || '-'; // Reserved — kept for controller interface contract
        const firebaseApp = deps.firebase || (typeof firebase !== 'undefined' ? firebase : null);

        let bound = false;
        let books = [];
        let selectedBookId = '';
        let selectionCounter = 0;
        let selectedBook = null;
        let selectedSummary = null;
        let activeTab = 'summary';
        let activePageSubTab = 'text'; // 'text' | 'pdf'
        let cachedSourcePdfUrl = '';
        let cachedSourcePdfBookId = '';
        let isLoadingSourcePdf = false;
        let uploadTask = null;
        let snapshotUnsubscribe = null;
        let threads = [];
        let selectedThreadId = '';
        let messages = [];
        let renderListTimer = null;
        let searchQuery = '';
        let bookTags = [];
        let activeSidebarTagFilters = new Set();
        let openFolderIds = new Set();

        try {
            const savedFolders = JSON.parse(localStorage.getItem('crm_books_open_folders') || '[]');
            if (Array.isArray(savedFolders)) openFolderIds = new Set(savedFolders);
        } catch (_ignored) {
            // ignore localStorage read failure
        }

        function saveOpenFolders() {
            try {
                localStorage.setItem('crm_books_open_folders', JSON.stringify(Array.from(openFolderIds)));
            } catch (_ignored) {
                // ignore localStorage write failure
            }
        }
        let collapsedOutline = {};
        let expandedNotes = {};
        let currentPage = 1;
        let pagesData = null;
        let activeCitation = null;
        let pageNotice = '';
        let readerFontScale = READER_FONT_SCALE_DEFAULT;
        let pageTurnInFlight = false;
        let pageTurnTimer = null;
        let pageTurnAnimationCleanup = null;
        let pageTurnToken = 0;
        let bookViewOpen = false;
        let splitViewEnabled = false;
        const BOOK_THEMES = [
            { id: 'classic', name: 'Classic', swatch: '#e8e0d4' },
            { id: 'ink', name: 'Ink', swatch: '#28282e' },
            { id: 'campfire', name: 'Campfire', swatch: '#d4873a' },
            { id: 'ocean', name: 'Ocean', swatch: '#2d8a9a' },
            { id: 'forest', name: 'Forest', swatch: '#4a7a3a' },
            { id: 'lavender', name: 'Lavender', swatch: '#9a7ab0' },
            { id: 'sunset', name: 'Sunset', swatch: '#d07060' },
            { id: 'midnight', name: 'Midnight', swatch: '#2a3458' },
            { id: 'potter', name: 'Potter', swatch: '#6a1830' }
        ];
        const BOOK_THEME_STORAGE_KEY = 'crm_books_reader_theme';
        let bookViewTheme = (function() {
            try {
                const stored = localStorage.getItem(BOOK_THEME_STORAGE_KEY);
                if (stored && BOOK_THEMES.some(t => t.id === stored)) return stored;
                // Backward compat: if old dark mode was saved, map to 'ink'
                const oldDark = localStorage.getItem('crm_books_reader_dark');
                if (oldDark === 'true') { localStorage.removeItem('crm_books_reader_dark'); return 'ink'; }
            } catch (_) {
                /* ignore */
            }
            return 'classic';
        })();
        let bookViewFontScale = (function() {
            try {
                const stored = parseInt(localStorage.getItem('crm_books_bv_font_scale'), 10);
                if (Number.isFinite(stored)) return clampReaderFontScale(stored);
            } catch (_) { /* ignore */ }
            return 100;
        })();
        let bookViewSpread = 1;
        let bookViewTurning = false;
        const BOOK_VIEW_FONT_MIN = 80;
        const BOOK_VIEW_FONT_MAX = 180;
        const BOOK_VIEW_FONT_STEP = 10;
        let editingThreadId = '';
        let editingThreadTitle = '';
        let usageData = null;
        let summaryMode = '';
        let sectionDigests = null;
        let sectionsLoading = false;
        let isElaborateModeActive = false;
        let elaborateSnippets = [];
        let isElaborating = false;
        let lastElaborationResult = null;

        const panel = elements.booksPanel || document.querySelector('[data-panel="books"]');

        try {
            readerFontScale = clampReaderFontScale(localStorage.getItem(READER_FONT_SCALE_STORAGE_KEY));
        } catch (_ignored) {
            readerFontScale = READER_FONT_SCALE_DEFAULT;
        }

        function qs(sel) { return panel ? panel.querySelector(sel) : document.querySelector(sel); }

        // --- API helpers ---
        async function apiGet(path) {
            if (!apiFetchJson) throw new Error('No API client');
            return apiFetchJson(path);
        }

        async function apiPost(path, body) {
            if (!apiFetchJson) throw new Error('No API client');
            return apiFetchJson(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        }

        async function apiPatch(path, body) {
            if (!apiFetchJson) throw new Error('No API client');
            return apiFetchJson(path, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        }

        async function apiDelete(path, body = null) {
            if (!apiFetchJson) throw new Error('No API client');
            const options = { method: 'DELETE' };
            if (body !== null && body !== undefined) {
                options.body = JSON.stringify(body);
                options.headers = { 'Content-Type': 'application/json' };
            }
            return apiFetchJson(path, options);
        }

        function renderBookListItem(b) {
            const isSelected = b.bookId === selectedBookId;
            const statusIcon = b.status === 'ready' ? '<span class="crm-books-status-icon ready" title="Ready">&#10003;</span>'
                : b.status === 'failed' ? '<span class="crm-books-status-icon failed" title="Failed">&#9888;</span>'
                    : '';
            const ingestLine = (b.status !== 'ready' && b.status !== 'awaiting_upload')
                ? `<div class="crm-books-ingest-line"><div class="crm-books-progress-bar"><div class="crm-books-progress-fill" style="width:${ingestWeightedPercent(b.ingest, b.status)}%"></div></div><span class="crm-books-list-stage">${escapeHtml(buildIngestLabel(b.ingest, b.status))}</span></div>`
                : b.status === 'awaiting_upload'
                    ? `<div class="crm-books-ingest-line"><span class="crm-books-list-stage">Upload incomplete</span></div>`
                    : '';
            const progressLine = b.status === 'ready' ? renderProgressBar(b.bookId, b.pageCount) : '';

            const tagChips = (b.tags || []).map(tId => {
                const tObj = bookTags.find(t => t.id === tId || t.name.toLowerCase() === tId.toLowerCase());
                const tName = tObj ? tObj.name : tId;
                const tColor = tObj?.color || '#0f766e';
                return `<span class="crm-books-tag-chip" style="border-color:${tColor}; color:${tColor}; background:${tColor}18;">🏷️ ${escapeHtml(tName)}</span>`;
            }).join('');

            return `<div class="crm-books-list-item${isSelected ? ' selected' : ''}" data-book-id="${escapeHtml(b.bookId)}">` +
                `<div class="crm-books-list-item-header">` +
                `<span class="crm-books-list-title">${escapeHtml(b.title)}</span>` +
                `<div style="display:flex; align-items:center; gap:4px;">` +
                `<button type="button" class="crm-books-card-quick-tag-btn" data-quick-tag-book-id="${escapeHtml(b.bookId)}" title="Add or manage tags">+🏷️</button>` +
                statusIcon +
                `</div>` +
                `</div>` +
                `<div class="crm-books-list-author">${escapeHtml(b.author || '')}</div>` +
                (tagChips ? `<div class="crm-books-card-tags-row">${tagChips}</div>` : '') +
                ingestLine +
                progressLine +
                `</div>`;
        }

        // --- Render: Sources Panel (left) ---
        function renderSourcesPanel() {
            const list = qs('.crm-books-list');
            const countBadge = qs('.crm-books-sources-count');
            if (!list) return;

            renderSidebarTagFilter();

            let filtered = books;
            if (searchQuery) {
                filtered = filtered.filter((b) => b.title.toLowerCase().includes(searchQuery.toLowerCase()) || b.author.toLowerCase().includes(searchQuery.toLowerCase()));
            }

            if (activeSidebarTagFilters.size > 0) {
                filtered = filtered.filter(b => {
                    const bTags = b.tags || [];
                    for (const tId of activeSidebarTagFilters) {
                        if (bTags.includes(tId)) return true;
                        const tObj = bookTags.find(t => t.id === tId);
                        if (tObj && bTags.includes(tObj.name)) return true;
                    }
                    return false;
                });
            }

            if (countBadge) countBadge.textContent = String(books.length);

            if (filtered.length === 0) {
                list.innerHTML = `<li class="crm-books-empty-item">${books.length === 0 ? 'No books yet. Add a source to get started.' : 'No matching books.'}</li>`;
                return;
            }

            if (bookCollections.length === 0) {
                list.innerHTML = filtered.map(renderBookListItem).join('');
                return;
            }

            const grouped = groupBooksByCollection(filtered, bookCollections);
            const hasFilter = searchQuery || activeSidebarTagFilters.size > 0;

            let html = '<div class="crm-books-folders-container">';
            bookCollections.forEach(col => {
                const colBooks = grouped[col.id] || [];
                const isExpanded = hasFilter ? (colBooks.length > 0) : openFolderIds.has(col.id);

                const booksListHtml = colBooks.length === 0
                    ? `<div class="crm-books-folder-empty">No books in this collection</div>`
                    : colBooks.map(renderBookListItem).join('');

                html += `
                <div class="crm-books-folder" data-folder-id="${escapeHtml(col.id)}">
                  <div class="crm-books-folder-header">
                    <div class="crm-books-folder-title-wrap" data-folder-toggle="${escapeHtml(col.id)}">
                      <span class="crm-books-folder-chevron${isExpanded ? '' : ' collapsed'}">▾</span>
                      <span class="crm-books-folder-icon">📁</span>
                      <span class="crm-books-folder-name" title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</span>
                      <span class="crm-books-folder-count">${colBooks.length}</span>
                    </div>
                    <div class="crm-books-folder-actions">
                      <button type="button" class="crm-books-folder-btn rename" data-folder-rename="${escapeHtml(col.id)}" title="Rename collection">✏️</button>
                      <button type="button" class="crm-books-folder-btn delete" data-folder-delete="${escapeHtml(col.id)}" title="Delete collection">✕</button>
                    </div>
                  </div>
                  <div class="crm-books-folder-content${isExpanded ? '' : ' collapsed'}" data-folder-content="${escapeHtml(col.id)}">
                    ${booksListHtml}
                  </div>
                </div>
                `;
            });
            html += '</div>';

            list.innerHTML = html;
        }

        // --- Render: Explorer Panel (center) ---
        function renderExplorerPanel() {
            if (pageTurnInFlight) cancelPageTurn();
            const detail = qs('.crm-books-detail');
            if (!detail) return;

            if (!selectedBook) {
                detail.innerHTML = `<div class="crm-books-empty-detail">` +
                    `<div class="crm-books-empty-icon">${ICON_BOOK}</div>` +
                    `<h3 style="margin:12px 0 6px; font-weight:600;">Select a book</h3>` +
                    `<p class="crm-muted">Choose a source from the library to explore its summary, chat, or pages.</p>` +
                    `</div>`;
                return;
            }

            const b = selectedBook;
            const pageLabel = b.pageCount ? `${b.pageCount} pages` : '';

            let tabsHtml = '';
            let contentHtml = '';

            if (b.status === 'ready') {
                tabsHtml = `<div class="crm-books-tabs">` +
                    `<button class="crm-books-tab${activeTab === 'summary' ? ' active' : ''}" data-books-tab="summary">Summary</button>` +
                    `<button class="crm-books-tab${activeTab === 'chat' ? ' active' : ''}" data-books-tab="chat">Chat</button>` +
                    `<button class="crm-books-tab${activeTab === 'history' ? ' active' : ''}" data-books-tab="history">Chat History</button>` +
                    `<button class="crm-books-tab${activeTab === 'pages' ? ' active' : ''}" data-books-tab="pages">Pages</button>` +
                    `<button class="crm-books-tab${activeTab === 'notes' ? ' active' : ''}" data-books-tab="notes">Notes</button>` +
                    `</div>`;
                contentHtml = renderTabContent();
            } else if (b.status === 'failed') {
                contentHtml = renderFailedState(b);
            } else if (b.status === 'awaiting_upload') {
                contentHtml = renderAwaitingUpload(b);
            } else {
                contentHtml = renderProcessingState(b);
            }

            const isDark = panel?.classList.contains('books-dark');
            const darkIcon = isDark
                ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>'
                : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>';
            const usageHtml = renderUsageIndicator();
            const curCol = bookCollections.find(c => c.id === b.collectionId);
            const colName = curCol ? curCol.name : 'Pronunciation';
            const colBadge = `<span class="crm-books-header-folder-badge" data-book-id="${escapeHtml(b.bookId)}" title="Click to move to another collection">📁 ${escapeHtml(colName)} ▾</span>`;

            const bookTagChips = (b.tags || []).map(tId => {
                const tagObj = bookTags.find(t => t.id === tId || t.name.toLowerCase() === tId.toLowerCase());
                const tagName = tagObj ? tagObj.name : tId;
                const tagColor = tagObj?.color || '#0f766e';
                return `<span class="crm-books-tag-chip" style="border-color:${tagColor}; color:${tagColor}; background:${tagColor}18;">` +
                    `🏷️ ${escapeHtml(tagName)} ` +
                    `<button type="button" class="crm-books-tag-chip-remove" data-book-id="${escapeHtml(b.bookId)}" data-tag-id="${escapeHtml(tId)}" title="Remove tag">✕</button>` +
                    `</span>`;
            }).join('');

            const addTagBtn = `<button type="button" class="crm-books-header-add-tag-btn" data-book-id="${escapeHtml(b.bookId)}">+ Add Tag</button>`;
            const tagsBarHtml = `<div class="crm-books-header-tags-bar">${colBadge}${bookTagChips}${addTagBtn}</div>`;

            const headerHtml = `<div class="crm-books-explorer-header">` +
                `<div class="crm-books-explorer-title-group">` +
                `<h3 class="crm-books-explorer-title">${escapeHtml(b.title)}</h3>` +
                `<p class="crm-books-explorer-meta">${[escapeHtml(b.author), pageLabel].filter(Boolean).join(' \u00b7 ')}</p>` +
                tagsBarHtml +
                `</div>` +
                usageHtml +
                `<button class="crm-books-elaborate-btn${isElaborateModeActive ? ' active' : ''}" data-book-id="${escapeHtml(b.bookId)}" title="Elaborate tool: Highlight texts to deep dive with AI" aria-label="Elaborate tool">✨<span>Elaborate</span></button>` +
                `<button class="crm-books-bgm-btn" data-book-id="${escapeHtml(b.bookId)}" title="Upload & manage background music (MP3)" aria-label="Manage music">${ICON_MUSIC}<span>Manage Music</span></button>` +
                `<button class="crm-books-download-btn" data-book-id="${escapeHtml(b.bookId)}" title="Download source" aria-label="Download source">${ICON_DOWNLOAD}<span>Download source</span></button>` +
                `<button class="crm-books-dark-toggle" title="Toggle dark mode">${darkIcon}</button>` +
                `<button class="crm-books-delete-btn" data-book-id="${escapeHtml(b.bookId)}" title="Delete this book">${ICON_TRASH}</button>` +
                `</div>`;

            const budgetHtml = renderBudgetBanner();
            detail.innerHTML = headerHtml + tabsHtml + budgetHtml +
                `<div class="crm-books-tab-body${activeTab === 'chat' ? ' chat-active' : ''}" style="--crm-books-reader-font-scale:${readerFontScale}%">${contentHtml}</div>`;

            // Auto-scroll chat to bottom
            if (activeTab === 'chat') {
                const msgContainer = detail.querySelector('.crm-books-chat-messages');
                if (msgContainer) {
                    requestAnimationFrame(() => { msgContainer.scrollTop = msgContainer.scrollHeight; });
                }
            }
        }

        // --- Combined render ---
        function renderAll() {
            renderSourcesPanel();
            renderExplorerPanel();
        }


        // --- Tab content ---
        function renderTabContent() {
            if (activeTab === 'summary') return renderSummaryTab();
            if (activeTab === 'chat') return renderChatTab();
            if (activeTab === 'history') return renderHistoryTab();
            if (activeTab === 'pages') return splitViewEnabled ? renderSplitView() : renderPagesTab();
            if (activeTab === 'notes') return renderNotesTab();
            return '';
        }

        function renderSplitView() {
            const pagesHtml = renderPagesTab();
            const chatHtml = renderChatTab();
            return `<div class="crm-books-split-view">` +
                `<div class="crm-books-split-page">${pagesHtml}</div>` +
                `<div class="crm-books-split-divider"></div>` +
                `<div class="crm-books-split-chat">${chatHtml}</div>` +
                `</div>`;
        }

        function renderSummaryTab() {
            if (!selectedSummary) return '<div class="crm-books-summary-empty"><p class="crm-muted">No summary available yet.</p></div>';
            const s = selectedSummary;

            if (!summaryMode) {
                return renderSummaryModeSelector(s);
            }
            if (summaryMode === 'chapters') {
                return renderChapterSummary(s);
            }
            return renderWholeSummary(s);
        }

        function renderSummaryModeSelector(s) {
            let html = '';
            if (s.oneLiner) {
                html += `<div class="crm-books-section-card">` +
                    `<p class="crm-books-one-liner">${escapeHtml(s.oneLiner)}</p>` +
                    `</div>`;
            }
            html += `<div class="crm-books-summary-mode-picker">` +
                `<h4 class="crm-books-section-title">How would you like to explore the summary?</h4>` +
                `<div class="crm-books-mode-options">` +
                `<button class="crm-books-mode-card" data-summary-mode="whole">` +
                `<span class="crm-books-mode-icon">${ICON_BOOK}</span>` +
                `<span class="crm-books-mode-label">Summarize whole book</span>` +
                `<span class="crm-books-mode-desc">A detailed overview of the entire book with key topics and structure.</span>` +
                `</button>` +
                `<button class="crm-books-mode-card" data-summary-mode="chapters">` +
                `<span class="crm-books-mode-icon">${ICON_DOC}</span>` +
                `<span class="crm-books-mode-label">Summarize each chapter</span>` +
                `<span class="crm-books-mode-desc">Chapter-by-chapter breakdown with a short book overview.</span>` +
                `</button>` +
                `</div>` +
                `</div>`;
            return html;
        }

        function renderWholeSummary(s) {
            let html = `<div class="crm-books-summary-mode-bar">` +
                `<button class="crm-books-mode-back" data-summary-mode="">&larr; Summary options</button>` +
                `</div>`;

            if (s.oneLiner) {
                html += `<div class="crm-books-section-card">` +
                    `<p class="crm-books-one-liner">${escapeHtml(s.oneLiner)}</p>` +
                    `</div>`;
            }

            if (s.overview) {
                html += `<div class="crm-books-section-card">` +
                    `<h4 class="crm-books-section-title">Overview</h4>` +
                    `<div class="crm-books-overview"><p>${escapeHtml(s.overview).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>` +
                    `</div>`;
            }

            if (s.audience) {
                html += `<div class="crm-books-section-card" data-section="audience">` +
                    `<h4 class="crm-books-section-title">Target Audience</h4>` +
                    `<p class="crm-books-audience-text">${escapeHtml(s.audience)}</p>` +
                    `</div>`;
            }

            if (Array.isArray(s.keyTopics) && s.keyTopics.length > 0) {
                html += `<div class="crm-books-section-card" data-section="topics">` +
                    `<h4 class="crm-books-section-title">Key Topics</h4>` +
                    `<div class="crm-books-topics">${s.keyTopics.map((t) =>
                        `<button class="crm-books-topic-chip" data-topic="${escapeHtml(t.topic)}">${escapeHtml(t.topic)}${t.pages?.length ? ` <span class="crm-books-topic-pages">p. ${escapeHtml(String(t.pages.join(', ')))}</span>` : ''}</button>`
                    ).join('')}</div>` +
                    `</div>`;
            }

            if (Array.isArray(s.outline) && s.outline.length > 0) {
                html += `<div class="crm-books-section-card" data-section="outline">` +
                    `<h4 class="crm-books-section-title">Outline</h4>` +
                    renderOutline(s.outline) +
                    `</div>`;
            }

            return html || '<div class="crm-books-summary-empty"><p class="crm-muted">Summary is empty.</p></div>';
        }

        function renderChapterSummary(s) {
            let html = `<div class="crm-books-summary-mode-bar">` +
                `<button class="crm-books-mode-back" data-summary-mode="">&larr; Summary options</button>` +
                `</div>`;

            if (s.oneLiner) {
                html += `<div class="crm-books-section-card">` +
                    `<p class="crm-books-one-liner">${escapeHtml(s.oneLiner)}</p>` +
                    `</div>`;
            }

            if (s.overview) {
                html += `<div class="crm-books-section-card">` +
                    `<h4 class="crm-books-section-title">Book Overview</h4>` +
                    `<div class="crm-books-overview"><p>${escapeHtml(s.overview).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>` +
                    `</div>`;
            }

            if (sectionsLoading) {
                html += `<div class="crm-books-section-card"><p class="crm-muted">Loading chapter summaries…</p></div>`;
                return html;
            }

            if (!Array.isArray(sectionDigests) || sectionDigests.length === 0) {
                html += `<div class="crm-books-section-card"><p class="crm-muted">No chapter-level summaries available.</p></div>`;
                return html;
            }

            html += sectionDigests.map((sec, idx) => {
                const pages = sec.pageStart != null && sec.pageEnd != null
                    ? `<button class="crm-books-outline-page-link" data-goto-page="${sec.pageStart}" title="Jump to page ${sec.pageStart}">pp. ${escapeHtml(String(sec.pageStart))}–${escapeHtml(String(sec.pageEnd))}</button>` : '';
                const keyPointsHtml = Array.isArray(sec.keyPoints) && sec.keyPoints.length > 0
                    ? `<ul class="crm-books-chapter-points">${sec.keyPoints.map((kp) => `<li>${escapeHtml(kp)}</li>`).join('')}</ul>` : '';
                return `<div class="crm-books-section-card crm-books-chapter-card">` +
                    `<h4 class="crm-books-section-title"><span class="crm-books-chapter-number">${idx + 1}</span>${escapeHtml(sec.title)}${pages ? ` ${pages}` : ''}</h4>` +
                    (sec.gist ? `<p class="crm-books-chapter-gist">${escapeHtml(sec.gist)}</p>` : '') +
                    keyPointsHtml +
                    `<div class="crm-books-section-actions" style="margin-top:12px; display:flex; gap:8px;">` +
                    `<button type="button" class="crm-btn crm-btn-secondary crm-btn-sm crm-books-generate-notes-btn" data-section-index="${idx}">⚡ Generate Study Module</button>` +
                    `</div>` +
                    `</div>`;
            }).join('');


            return html;
        }

        function renderOutline(items, depth = 0) {
            if (!Array.isArray(items) || items.length === 0) return '';
            return `<ol class="crm-books-outline${depth > 0 ? ' crm-books-outline-nested' : ''}">` +
                items.map((item, idx) => {
                    const key = `${depth}-${idx}`;
                    const isCollapsed = collapsedOutline[key];
                    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
                    const pages = item.pageStart != null && item.pageEnd != null
                        ? ` <button class="crm-books-outline-page-link" data-goto-page="${item.pageStart}" title="Jump to page ${item.pageStart}">pp. ${escapeHtml(String(item.pageStart))}\u2013${escapeHtml(String(item.pageEnd))}</button>` : '';
                    const summary = item.summary ? `<p class="crm-books-outline-summary">${escapeHtml(item.summary)}</p>` : '';
                    const toggleBtn = hasChildren
                        ? `<button class="crm-books-outline-toggle" data-outline-key="${key}">${isCollapsed ? '\u25b6' : '\u25bc'}</button>`
                        : '<span class="crm-books-outline-toggle-spacer"></span>';
                    const children = (hasChildren && !isCollapsed) ? renderOutline(item.children, depth + 1) : '';
                    return `<li>${toggleBtn}<strong>${escapeHtml(item.title || '')}</strong>${pages}${summary}${children}</li>`;
                }).join('') +
                `</ol>`;
        }

        function renderChatTab() {
            let messagesHtml = '';
            if (messages.length === 0) {
                const starters = buildStarterQuestions();
                messagesHtml = `<div class="crm-books-chat-starters">` +
                    `<p class="crm-books-starters-label">Ask a question about this book, or try one of these:</p>` +
                    `<div class="crm-books-starters-grid">${starters.map((q) => `<button class="crm-books-starter-btn">${escapeHtml(q)}</button>`).join('')}</div>` +
                    `</div>`;
            } else {
                messagesHtml = `<div class="crm-books-chat-messages">${messages.map(renderMessage).join('')}</div>`;
            }

            const activeThread = threads.find((thread) => thread.threadId === selectedThreadId) || null;
            const titleHtml = activeThread
                ? renderThreadTitle(activeThread)
                : `<div class="crm-books-chat-draft-title"><span class="crm-books-chat-draft-label">New chat</span><span class="crm-books-chat-draft-hint">Your first question will start a thread.</span></div>`;

            return `<div class="crm-books-chat-header">` +
                `<div class="crm-books-chat-header-left">${titleHtml}</div>` +
                `<button class="crm-books-new-chat-btn crm-books-new-thread-btn" title="Start a new chat">${ICON_PLUS} New chat</button>` +
                `</div>` +
                `<div class="crm-books-composer">` +
                `<textarea class="crm-books-composer-input" placeholder="Ask about the book\u2026" rows="1"></textarea>` +
                `<button class="crm-books-send-btn" title="Send">${ICON_SEND}</button>` +
                `</div>` +
                messagesHtml;
        }

        function renderThreadTitle(thread) {
            if (!thread) return '';
            if (editingThreadId === thread.threadId) {
                return `<form class="crm-books-thread-title-editor" data-thread-id="${escapeHtml(thread.threadId)}">` +
                    `<label class="crm-books-sr-only" for="crm-books-thread-title-input">Thread name</label>` +
                    `<input id="crm-books-thread-title-input" class="crm-books-thread-title-input" type="text" maxlength="${MAX_THREAD_TITLE_LENGTH}" value="${escapeHtml(editingThreadTitle)}" autocomplete="off">` +
                    `<button type="submit" class="crm-books-thread-title-save">Save</button>` +
                    `<button type="button" class="crm-books-thread-title-cancel">Cancel</button>` +
                    `</form>`;
            }
            return `<div class="crm-books-thread-title-view">` +
                `<span class="crm-books-thread-title-text">${escapeHtml(thread.title || 'Untitled chat')}</span>` +
                `<button type="button" class="crm-books-thread-rename-btn" data-thread-id="${escapeHtml(thread.threadId)}" aria-label="Edit thread name" title="Edit thread name">✎</button>` +
                `</div>`;
        }

        function renderHistoryTab() {
            const newChatButton = `<button class="crm-books-new-chat-btn crm-books-history-new-chat" title="Start a new chat">${ICON_PLUS} New chat</button>`;
            if (threads.length === 0) {
                return `<section class="crm-books-history" aria-labelledby="crm-books-history-title">` +
                    `<div class="crm-books-history-header"><div><h4 id="crm-books-history-title">Chat History</h4><p>Saved conversations about this book.</p></div>${newChatButton}</div>` +
                    `<div class="crm-books-history-empty"><p>No saved chats yet.</p><p>Ask your first question from the Chat tab to create one.</p></div>` +
                    `</section>`;
            }

            const rows = threads.map((thread) => {
                const updated = thread.updatedAt ? new Date(thread.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'No activity yet';
                if (editingThreadId === thread.threadId) {
                    return `<div class="crm-books-history-row editing" data-thread-id="${escapeHtml(thread.threadId)}">` +
                        `<div class="crm-books-history-row-editor">${renderThreadTitle(thread)}</div>` +
                        `<div class="crm-books-history-meta">${thread.messageCount || 0} messages · ${escapeHtml(updated)}</div>` +
                        `</div>`;
                }
                return `<div class="crm-books-history-row${thread.threadId === selectedThreadId ? ' selected' : ''}" data-thread-id="${escapeHtml(thread.threadId)}">` +
                    `<button type="button" class="crm-books-history-open" data-history-thread-id="${escapeHtml(thread.threadId)}">` +
                    `<span class="crm-books-history-row-title">${escapeHtml(thread.title || 'Untitled chat')}</span>` +
                    `<span class="crm-books-history-meta">${thread.messageCount || 0} messages · ${escapeHtml(updated)}</span>` +
                    `</button>` +
                    `<button type="button" class="crm-books-thread-rename-btn crm-books-history-rename-btn" data-thread-id="${escapeHtml(thread.threadId)}" aria-label="Edit thread name" title="Edit thread name">✎</button>` +
                    `</div>`;
            }).join('');

            return `<section class="crm-books-history" aria-labelledby="crm-books-history-title">` +
                `<div class="crm-books-history-header"><div><h4 id="crm-books-history-title">Chat History</h4><p>${threads.length} saved conversation${threads.length === 1 ? '' : 's'} about this book.</p></div>${newChatButton}</div>` +
                `<div class="crm-books-history-list">${rows}</div>` +
                `</section>`;
        }

        function renderMessage(msg) {
            const isUser = msg.role === 'user';
            const cls = isUser ? 'crm-books-msg-user' : 'crm-books-msg-assistant';

            if (msg._loading) {
                return `<div class="crm-books-msg ${cls}">` +
                    `<div class="crm-books-msg-text crm-books-msg-loading">` +
                    `<span class="crm-books-typing-indicator"><span></span><span></span><span></span></span> Searching the book\u2026` +
                    `</div></div>`;
            }

            const answered = msg.answered !== false;
            const textCls = answered ? '' : ' crm-books-msg-unanswered';
            const citationsHtml = !isUser && msg.citations?.length > 0
                ? renderCitations(msg.citations, escapeHtml) : '';
            const saveBtn = !isUser && msg.text
                ? `<div class="crm-books-msg-actions"><button class="crm-books-msg-save-btn" title="Save to Notes"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z"/></svg> Save</button></div>` : '';
            return `<div class="crm-books-msg ${cls}${textCls}">` +
                `<div class="crm-books-msg-text">${isUser ? escapeHtml(msg.text || '') : formatMessageText(msg.text || '', msg.citations, escapeHtml)}</div>` +
                citationsHtml +
                saveBtn +
                `</div>`;
        }

        function buildStarterQuestions() {
            if (!selectedSummary?.keyTopics?.length) {
                return ['What is this book about?', 'What are the main topics?', 'Who is the target audience?', 'Summarize the key takeaways.'];
            }
            return selectedSummary.keyTopics.slice(0, 4).map((t) =>
                `What does the book say about ${t.topic.toLowerCase()}?`
            );
        }

        const PAGE_TURN_DURATION_MS = 820;
        const PAGE_TURN_FALLBACK_MS = PAGE_TURN_DURATION_MS + 240;

        function renderPagePaperHtml(pageNumber, sheetClass = '', citationOverride) {
            const physicalPage = Number(pageNumber) || 1;
            const pageText = pagesData?.pages?.[physicalPage - 1] ?? '';
            const citation = citationOverride === undefined ? activeCitation : citationOverride;
            const formattedText = clean(pageText)
                ? formatPageText(pageText, escapeHtml, citation?.page === physicalPage ? citation.quote : '', { rendererContract: pagesData?.rendererContract })
                : '<p class="crm-books-page-empty">No extractable text was found on this physical page.</p>';
            const classes = ['crm-books-page-paper', 'crm-books-page-sheet', sheetClass].filter(Boolean).join(' ');
            return `<article class="${classes}" data-page-number="${physicalPage}" tabindex="-1" aria-label="Reading view page ${physicalPage} of ${pagesData?.totalPages || 0}">` +
                `<div class="crm-books-page-content">${formattedText}</div>` +
                `</article>`;
        }

        function isReducedMotionPreferred() {
            return typeof window !== 'undefined'
                && typeof window.matchMedia === 'function'
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        }

        function setNavigationButtonDisabled(button, disabled) {
            if (!button) return;
            button.disabled = disabled;
            button.setAttribute('aria-disabled', String(disabled));
        }

        function getPageNavigationState() {
            const pages = pagesData?.pages || [];
            const previousPage = findAdjacentReadablePage(pages, currentPage, -1);
            const nextPage = findAdjacentReadablePage(pages, currentPage, 1);
            return {
                previousPage,
                nextPage,
                prevDisabled: previousPage === currentPage || pageTurnInFlight,
                nextDisabled: nextPage === currentPage || pageTurnInFlight
            };
        }

        function setPageTurnControlsDisabled(disabled) {
            setNavigationButtonDisabled(qs('.crm-books-page-prev'), disabled);
            setNavigationButtonDisabled(qs('.crm-books-page-next'), disabled);
        }

        function syncPageNavigationControls() {
            const navigation = getPageNavigationState();
            setNavigationButtonDisabled(qs('.crm-books-page-prev'), navigation.prevDisabled);
            setNavigationButtonDisabled(qs('.crm-books-page-next'), navigation.nextDisabled);
        }

        function clearPageTurnCompletionWait() {
            if (pageTurnTimer) {
                clearTimeout(pageTurnTimer);
                pageTurnTimer = null;
            }
            if (pageTurnAnimationCleanup) {
                pageTurnAnimationCleanup();
                pageTurnAnimationCleanup = null;
            }
        }

        function cancelPageTurn() {
            pageTurnToken += 1;
            pageTurnInFlight = false;
            clearPageTurnCompletionWait();
            const stage = qs('.crm-books-page-stage');
            if (stage) {
                stage.classList.remove('turning-next', 'turning-prev');
                stage.style.removeProperty('height');
                stage.querySelectorAll('.crm-books-page-sheet.is-incoming').forEach((sheet) => sheet.remove());
                stage.querySelector('.crm-books-page-sheet.is-outgoing')?.classList.remove('is-outgoing');
            }
            syncPageNavigationControls();
        }

        function focusAndAnnouncePage(pageNumber, focusSelector = '') {
            requestAnimationFrame(() => {
                const preferred = focusSelector ? qs(focusSelector) : null;
                const fallback = preferred && !preferred.disabled
                    ? preferred
                    : qs('.crm-books-page-prev:not(:disabled)') || qs('.crm-books-page-next:not(:disabled)');
                fallback?.focus({ preventScroll: true });
                const status = qs('.crm-books-page-turn-status');
                if (status && pagesData) status.textContent = `Page ${pageNumber} of ${pagesData.totalPages}`;
            });
        }

        function commitPageNavigation(targetPage, focusSelector) {
            currentPage = targetPage;
            resetPageCitation();
            renderExplorerPanel();
            const tabBody = qs('.crm-books-tab-body');
            if (tabBody) tabBody.scrollTop = 0;
            focusAndAnnouncePage(targetPage, focusSelector);
            if (selectedBookId) markPageRead(selectedBookId, targetPage);
            requestAnimationFrame(() => applyHighlightsToPage(targetPage));
        }

        function finishPageTurn(targetPage, focusSelector, token) {
            if (token !== pageTurnToken) return;
            clearPageTurnCompletionWait();
            pageTurnInFlight = false;
            commitPageNavigation(targetPage, focusSelector);
        }

        function startPageTurn(direction) {
            if (pageTurnInFlight || !pagesData || activeTab !== 'pages') return;
            const navigation = getPageNavigationState();
            const targetPage = direction === 'prev' ? navigation.previousPage : navigation.nextPage;
            if (targetPage === currentPage) return;

            const focusSelector = direction === 'prev' ? '.crm-books-page-prev' : '.crm-books-page-next';
            if (activePageSubTab === 'pdf' || isReducedMotionPreferred()) {
                commitPageNavigation(targetPage, focusSelector);
                return;
            }

            const stage = qs('.crm-books-page-stage');
            const outgoing = stage?.querySelector('.crm-books-page-sheet');
            if (!stage || !outgoing) {
                commitPageNavigation(targetPage, focusSelector);
                return;
            }

            pageTurnInFlight = true;
            pageTurnToken += 1;
            const token = pageTurnToken;
            setPageTurnControlsDisabled(true);

            stage.insertAdjacentHTML('beforeend', renderPagePaperHtml(targetPage, 'is-incoming', null));
            const incoming = stage.querySelector('.crm-books-page-sheet.is-incoming');
            if (!incoming) {
                finishPageTurn(targetPage, focusSelector, token);
                return;
            }

            outgoing.classList.add('is-outgoing');
            const outgoingHeight = outgoing.getBoundingClientRect().height;
            const incomingHeight = incoming.getBoundingClientRect().height;
            stage.style.height = `${Math.max(outgoingHeight, incomingHeight)}px`;

            const animatedSheet = direction === 'next' ? outgoing : incoming;
            const complete = () => finishPageTurn(targetPage, focusSelector, token);
            const expectedAnimationName = direction === 'next' ? 'crmBooksPageTurnNext' : 'crmBooksPageTurnPrev';
            const onAnimationEnd = (event) => {
                if (event.target !== animatedSheet || event.animationName !== expectedAnimationName) return;
                complete();
            };
            animatedSheet.addEventListener('animationend', onAnimationEnd);
            pageTurnAnimationCleanup = () => animatedSheet.removeEventListener('animationend', onAnimationEnd);
            pageTurnTimer = setTimeout(complete, PAGE_TURN_FALLBACK_MS);
            stage.classList.add(`turning-${direction}`);
        }

        async function loadSourcePdfUrl(bookId) {
            if (!bookId) return '';
            if (cachedSourcePdfBookId === bookId && cachedSourcePdfUrl) {
                return cachedSourcePdfUrl;
            }
            try {
                const res = await apiGet(`/api/admin/books/${encodeURIComponent(bookId)}/source?inline=true`);
                const downloadUrl = res?.downloadUrl || res?.data?.downloadUrl;
                if (downloadUrl) {
                    cachedSourcePdfUrl = downloadUrl;
                    cachedSourcePdfBookId = bookId;
                    return downloadUrl;
                }
            } catch (err) {
                console.error('[CRM Books] Failed to load source PDF URL:', err);
            }
            return '';
        }

        function renderSourcePdfStage(bookId, pageNum) {
            const pdfUrl = (cachedSourcePdfBookId === bookId && cachedSourcePdfUrl) ? cachedSourcePdfUrl : '';
            if (isLoadingSourcePdf) {
                return `<div class="crm-books-pdf-container loading">` +
                    `<div class="crm-books-pdf-loading">` +
                    `<div class="crm-spinner" style="width:28px; height:28px; border-width:3px; margin:0 auto 12px;"></div>` +
                    `<p style="color:var(--books-text-muted); font-size:0.95rem;">Loading original source PDF…</p>` +
                    `</div>` +
                    `</div>`;
            }
            if (!pdfUrl) {
                return `<div class="crm-books-pdf-container empty">` +
                    `<div class="crm-books-pdf-empty-state">` +
                    `<div class="crm-books-empty-icon" style="margin-bottom:12px;">${ICON_DOC}</div>` +
                    `<h4 style="margin:0 0 6px; font-weight:600;">Source PDF Not Loaded</h4>` +
                    `<p class="crm-muted" style="margin:0 0 16px;">View the original publication alongside extracted text.</p>` +
                    `<button type="button" class="crm-books-jump-to-source-btn crm-books-load-pdf-btn">Load Source PDF</button>` +
                    `</div>` +
                    `</div>`;
            }
            const frameSrc = `${pdfUrl}#page=${pageNum}&toolbar=1&navpanes=1`;
            return `<div class="crm-books-pdf-container">` +
                `<div class="crm-books-pdf-header-bar">` +
                `<div class="crm-books-pdf-meta">` +
                `<span class="crm-books-pdf-badge">Original Document</span>` +
                `<span class="crm-books-pdf-page-indicator">Synchronized to Page <strong>${pageNum}</strong> of ${pagesData?.totalPages || ''}</span>` +
                `</div>` +
                `<div class="crm-books-pdf-actions">` +
                `<a href="${pdfUrl}#page=${pageNum}" target="_blank" rel="noopener" class="crm-books-pdf-action-link" title="Open PDF in a new browser tab">Open in new tab ↗</a>` +
                `<button type="button" class="crm-books-pdf-download-btn" data-book-id="${escapeHtml(bookId)}" title="Download source PDF">${ICON_DOWNLOAD}<span>Download</span></button>` +
                `</div>` +
                `</div>` +
                `<iframe class="crm-books-pdf-iframe" src="${frameSrc}" title="Source PDF Reader" data-current-page="${pageNum}"></iframe>` +
                `</div>`;
        }

        function renderPagesTab() {
            if (!pagesData) {
                loadPagesMetadata();
                return `<div class="crm-books-pages-placeholder">` +
                    `<div class="crm-books-empty-icon" style="margin-bottom:12px;">${ICON_DOC}</div>` +
                    `<p class="crm-muted">Loading pages…</p></div>`;
            }
            if (pagesData.totalPages === 0) {
                return `<div class="crm-books-pages-placeholder">` +
                    `<div class="crm-books-empty-icon" style="margin-bottom:12px;">${ICON_DOC}</div>` +
                    `<h4>No Pages</h4><p class="crm-muted">Page data is not available for this book.</p></div>`;
            }
            const navigation = getPageNavigationState();
            const prevDisabled = navigation.prevDisabled ? ' disabled aria-disabled="true"' : '';
            const nextDisabled = navigation.nextDisabled ? ' disabled aria-disabled="true"' : '';

            const subtabsHtml = `<div class="crm-books-pages-subtabs" role="tablist" aria-label="Page viewing mode">` +
                `<button type="button" class="crm-books-subtab-btn${activePageSubTab === 'text' ? ' active' : ''}" data-page-subtab="text" role="tab" aria-selected="${activePageSubTab === 'text'}" title="Read extracted and formatted book text">` +
                `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>` +
                `<span>Extracted Text</span>` +
                `</button>` +
                `<button type="button" class="crm-books-subtab-btn${activePageSubTab === 'pdf' ? ' active' : ''}" data-page-subtab="pdf" role="tab" aria-selected="${activePageSubTab === 'pdf'}" title="Read original source PDF document">` +
                `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>` +
                `<span>Source PDF</span>` +
                `</button>` +
                `</div>`;

            const jumpBtnHtml = activePageSubTab === 'text'
                ? `<button type="button" class="crm-books-jump-to-source-btn" data-target-page="${currentPage}" title="View page ${currentPage} in original source PDF">` +
                  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l3 3m0 0l3-3m-3 3V11"/></svg>` +
                  `<span>View in Source PDF</span>` +
                  `</button>`
                : `<button type="button" class="crm-books-jump-to-text-btn" data-target-page="${currentPage}" title="View page ${currentPage} in extracted text reader">` +
                  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/><path d="M15 15l-3-3m0 0l-3 3m3-3v8"/></svg>` +
                  `<span>View Extracted Text</span>` +
                  `</button>`;

            const navHtml = `<div class="crm-books-pages-nav">` +
                `<div class="crm-books-page-navigation-group">` +
                `<button class="crm-books-page-prev"${prevDisabled}>← Prev</button>` +
                `<span class="crm-books-pages-indicator">Page <input type="number" class="crm-books-page-input" value="${currentPage}" min="1" max="${pagesData.totalPages}"> of ${pagesData.totalPages}</span>` +
                `<button class="crm-books-page-next"${nextDisabled}>Next →</button>` +
                `</div>` +
                jumpBtnHtml +
                (activePageSubTab === 'text'
                    ? `<label class="crm-books-font-controls" for="crm-books-font-scale">` +
                      `<span class="crm-books-font-scale-label">Text size</span>` +
                      `<span class="crm-books-font-scale-small" aria-hidden="true">A</span>` +
                      `<input id="crm-books-font-scale" class="crm-books-font-scale" type="range" min="${READER_FONT_SCALE_MIN}" max="${READER_FONT_SCALE_MAX}" step="${READER_FONT_SCALE_STEP}" value="${readerFontScale}" aria-label="Reader text size" aria-valuetext="${readerFontScale} percent">` +
                      `<span class="crm-books-font-scale-large" aria-hidden="true">A</span>` +
                      `<output class="crm-books-font-scale-output" for="crm-books-font-scale">${readerFontScale}%</output>` +
                      `</label>` +
                      `<button class="crm-books-open-bookview" title="Open book view">` +
                      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>` +
                      `<span>Open book view</span></button>` +
                      `<button class="crm-books-bookmark-toggle${isPageBookmarked(selectedBookId, currentPage) ? ' bookmarked' : ''}" title="${isPageBookmarked(selectedBookId, currentPage) ? 'Page bookmarked' : 'Bookmark this page'}">` +
                      `<svg viewBox="0 0 24 24" width="16" height="16" fill="${isPageBookmarked(selectedBookId, currentPage) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>` +
                      `<span>Bookmark</span></button>` +
                      `<button class="crm-books-bookmarks-open" title="View all bookmarks">` +
                      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 10h16M4 14h10"/></svg>` +
                      `<span>All bookmarks${bookmarks.length ? ` (${bookmarks.length})` : ''}</span></button>` +
                      `<button class="crm-books-split-toggle${splitViewEnabled ? ' active' : ''}" title="${splitViewEnabled ? 'Exit split view' : 'Split view: page + chat'}">` +
                      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v18M3 3h18v18H3z"/></svg>` +
                      `<span>Split</span></button>`
                    : `<button type="button" class="crm-books-download-btn" data-book-id="${escapeHtml(selectedBookId)}" title="Download source PDF">` +
                      `${ICON_DOWNLOAD}<span>Download PDF</span></button>`) +
                `<span class="crm-books-page-turn-status crm-books-sr-only" role="status" aria-live="polite" aria-atomic="true">Page ${currentPage} of ${pagesData.totalPages}</span>` +
                `</div>`;

            const stickyBarHtml = `<div class="crm-books-pages-sticky-bar">` +
                subtabsHtml +
                navHtml +
                `</div>`;

            if (activePageSubTab === 'pdf') {
                return stickyBarHtml +
                    renderProgressHeatmap(pagesData.totalPages) +
                    renderSourcePdfStage(selectedBookId, currentPage);
            }

            return stickyBarHtml +
                renderProgressHeatmap(pagesData.totalPages) +
                `<div class="crm-books-reading-label">Reading view · extracted text</div>` +
                (pageNotice ? `<div class="crm-books-page-notice" role="status">${escapeHtml(pageNotice)}</div>` : '') +
                `<div class="crm-books-page-stage" data-page-stage>${renderPagePaperHtml(currentPage)}</div>`;
        }

        // ─── Fullscreen Book View ───
        const ICON_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
        const ICON_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>';

        // ─── Background Music & Player State ───
        let bookAudioTracks = [];
        let bookAudioIndex = 0;
        let bookAudioEl = null;
        let isBookAudioPlaying = false;
        let bookAudioVolume = 0.5;
        try {
            const storedVol = parseFloat(localStorage.getItem('crm_books_bgm_vol'));
            if (Number.isFinite(storedVol)) bookAudioVolume = Math.max(0, Math.min(1, storedVol));
        } catch (_) {
            bookAudioVolume = 0.5;
        }

        const DEFAULT_BGM_TRACKS = [
            { id: 'default-1', title: 'Study Ambience', downloadUrl: 'audio/survival_bgm_01.mp3' }
        ];

        async function loadBookAudio(bookId) {
            try {
                const res = await apiGet(`/api/admin/books/${bookId}/audio`);
                const tracks = Array.isArray(res?.tracks) ? res.tracks : [];
                bookAudioTracks = tracks.length > 0 ? tracks : DEFAULT_BGM_TRACKS;
            } catch (err) {
                console.warn('[CRM Books] Failed to load audio tracks via API, trying Firestore:', err);
                try {
                    const db = firebaseApp?.firestore?.() || (typeof firebase !== 'undefined' ? firebase.firestore() : null);
                    if (db) {
                        const snap = await db.collection('crmBooks').doc(bookId).collection('audio').orderBy('createdAt', 'asc').get();
                        const tracks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        bookAudioTracks = tracks.length > 0 ? tracks : DEFAULT_BGM_TRACKS;
                    } else {
                        bookAudioTracks = DEFAULT_BGM_TRACKS;
                    }
                } catch (_) {
                    bookAudioTracks = DEFAULT_BGM_TRACKS;
                }
            }
            if (bookAudioIndex >= bookAudioTracks.length) {
                bookAudioIndex = 0;
            }
            updateBookPlayerUi();
        }

        function updateBookPlayerUi(overlay) {
            if (!overlay) overlay = document.querySelector('.crm-bv-overlay');
            if (!overlay) return;

            const playerEl = overlay.querySelector('.crm-bv-player');
            const playIcon = overlay.querySelector('.crm-bv-play-icon');
            const pauseIcon = overlay.querySelector('.crm-bv-pause-icon');
            const trackText = overlay.querySelector('.crm-bv-player-track-text');
            const trackEl = overlay.querySelector('.crm-bv-player-track');
            const slider = overlay.querySelector('.crm-bv-volume-slider');

            if (playerEl) {
                playerEl.classList.toggle('is-playing', isBookAudioPlaying);
            }
            if (playIcon && pauseIcon) {
                playIcon.style.display = isBookAudioPlaying ? 'none' : 'block';
                pauseIcon.style.display = isBookAudioPlaying ? 'block' : 'none';
            }
            const currentTrack = bookAudioTracks[bookAudioIndex];
            const total = bookAudioTracks.length;
            const title = currentTrack?.title || 'Background Music';
            if (trackText) {
                trackText.textContent = total > 1 ? `${bookAudioIndex + 1}/${total}: ${title}` : title;
            }
            if (trackEl) {
                trackEl.title = title;
            }
            if (slider && !slider.matches(':focus')) {
                slider.value = Math.round(bookAudioVolume * 100);
            }
        }

        function playBookAudio(overlay) {
            if (!bookAudioTracks || bookAudioTracks.length === 0) return;
            const track = bookAudioTracks[bookAudioIndex];
            if (!track || !track.downloadUrl) return;

            if (!bookAudioEl) {
                bookAudioEl = new Audio();
                bookAudioEl.addEventListener('ended', () => {
                    const liveOverlay = document.querySelector('.crm-bv-overlay');
                    nextBookAudio(liveOverlay, true);
                });
                bookAudioEl.addEventListener('error', (e) => {
                    console.warn('[CRM Books Audio] Playback error:', e);
                    isBookAudioPlaying = false;
                    updateBookPlayerUi();
                });
            }

            if (bookAudioEl.src !== track.downloadUrl && !bookAudioEl.src.endsWith(track.downloadUrl)) {
                bookAudioEl.src = track.downloadUrl;
            }
            bookAudioEl.volume = bookAudioVolume;

            bookAudioEl.play().then(() => {
                isBookAudioPlaying = true;
                updateBookPlayerUi(overlay);
            }).catch((err) => {
                console.warn('[CRM Books Audio] Autoplay/play error:', err);
                isBookAudioPlaying = false;
                updateBookPlayerUi(overlay);
            });
        }

        function pauseBookAudio(overlay) {
            if (bookAudioEl) {
                bookAudioEl.pause();
            }
            isBookAudioPlaying = false;
            updateBookPlayerUi(overlay);
        }

        function togglePlayBookAudio(overlay) {
            if (isBookAudioPlaying) {
                pauseBookAudio(overlay);
            } else {
                playBookAudio(overlay);
            }
        }

        function nextBookAudio(overlay, autoPlay = false) {
            if (!bookAudioTracks || bookAudioTracks.length === 0) return;
            bookAudioIndex = (bookAudioIndex + 1) % bookAudioTracks.length;
            const track = bookAudioTracks[bookAudioIndex];
            if (isBookAudioPlaying || autoPlay) {
                if (bookAudioEl) {
                    bookAudioEl.src = track.downloadUrl;
                    bookAudioEl.play().then(() => {
                        isBookAudioPlaying = true;
                        updateBookPlayerUi(overlay);
                    }).catch(() => {});
                } else {
                    playBookAudio(overlay);
                }
            }
            updateBookPlayerUi(overlay);
        }

        function prevBookAudio(overlay) {
            if (!bookAudioTracks || bookAudioTracks.length === 0) return;
            bookAudioIndex = (bookAudioIndex - 1 + bookAudioTracks.length) % bookAudioTracks.length;
            const track = bookAudioTracks[bookAudioIndex];
            if (isBookAudioPlaying) {
                if (bookAudioEl) {
                    bookAudioEl.src = track.downloadUrl;
                    bookAudioEl.play().then(() => {
                        isBookAudioPlaying = true;
                        updateBookPlayerUi(overlay);
                    }).catch(() => {});
                } else {
                    playBookAudio(overlay);
                }
            }
            updateBookPlayerUi(overlay);
        }

        function setBookAudioVolume(volumeFraction, overlay) {
            bookAudioVolume = Math.max(0, Math.min(1, volumeFraction));
            try {
                localStorage.setItem('crm_books_bgm_vol', String(bookAudioVolume));
            } catch (_) {
                /* ignore */
            }
            if (bookAudioEl) {
                bookAudioEl.volume = bookAudioVolume;
            }
            updateBookPlayerUi(overlay);
        }

        function fadeOutAndStopBookAudio() {
            if (!bookAudioEl || !isBookAudioPlaying) return;
            let vol = bookAudioVolume;
            const fadeTimer = setInterval(() => {
                if (vol > 0.08) {
                    vol = Math.max(0, vol - 0.1);
                    if (bookAudioEl) bookAudioEl.volume = vol;
                } else {
                    clearInterval(fadeTimer);
                    pauseBookAudio();
                    if (bookAudioEl) bookAudioEl.volume = bookAudioVolume;
                }
            }, 35);
        }

        function setBookViewTheme(themeId) {
            if (!BOOK_THEMES.some(t => t.id === themeId)) return;
            bookViewTheme = themeId;
            try {
                localStorage.setItem(BOOK_THEME_STORAGE_KEY, themeId);
            } catch (_) {
                /* ignore */
            }
            const container = document.querySelector('.crm-bv-container');
            if (container) {
                BOOK_THEMES.forEach(t => container.classList.remove('crm-bv-theme-' + t.id));
                container.classList.add('crm-bv-theme-' + themeId);
            }
            // Update swatch active states
            const panel = document.querySelector('.crm-bv-theme-panel');
            if (panel) {
                panel.querySelectorAll('.crm-bv-theme-swatch').forEach(sw => {
                    sw.classList.toggle('active', sw.dataset.theme === themeId);
                });
            }
        }

        let bookViewPages = [];

        function splitBlocksIntoReaderPages(rawBlocks, targetWords) {
            const pages = [];
            let currentBlocks = [];
            let currentWords = 0;

            for (const block of rawBlocks) {
                const textOnly = block.replace(/<[^>]+>/g, ' ').trim();
                const words = textOnly.split(/\s+/).filter(Boolean).length;

                if (words > targetWords) {
                    if (currentBlocks.length > 0) {
                        pages.push(currentBlocks.join(''));
                        currentBlocks = [];
                        currentWords = 0;
                    }

                    const tagMatch = block.match(/^<([a-z0-9]+)[^>]*>([\s\S]*)<\/[a-z0-9]+>$/i);
                    const tag = tagMatch ? tagMatch[1] : 'p';
                    const inner = tagMatch ? tagMatch[2] : block;

                    const sentences = inner.match(/[^.!?]+[.!?]+(?:["'”’)]|\s|$)+|[^.!?]+$/g) || [inner];
                    let subSentences = [];
                    let subWords = 0;

                    for (const s of sentences) {
                        const sWords = s.trim().split(/\s+/).filter(Boolean).length;
                        if (subWords > 0 && subWords + sWords > targetWords) {
                            pages.push(`<${tag}>${subSentences.join('')}</${tag}>`);
                            subSentences = [s];
                            subWords = sWords;
                        } else {
                            subSentences.push(s);
                            subWords += sWords;
                        }
                    }
                    if (subSentences.length > 0) {
                        currentBlocks.push(`<${tag}>${subSentences.join('')}</${tag}>`);
                        currentWords = subWords;
                    }
                    continue;
                }

                if (currentWords > 0 && currentWords + words > targetWords) {
                    pages.push(currentBlocks.join(''));
                    currentBlocks = [block];
                    currentWords = words;
                } else {
                    currentBlocks.push(block);
                    currentWords += words;
                }
            }

            if (currentBlocks.length > 0) {
                pages.push(currentBlocks.join(''));
            }

            return pages.length > 0 ? pages : ['<p class="crm-bv-page-empty">No extractable text on this page.</p>'];
        }

        function buildBookViewPages(pData, fontScale = 100) {
            if (!pData || !Array.isArray(pData.pages) || pData.pages.length === 0) {
                return [];
            }

            // Target word count per page based on font scale to avoid vertical overflow
            const targetWords = Math.max(90, Math.floor(180 * (100 / fontScale)));
            const result = [];

            pData.pages.forEach((rawText, idx) => {
                const pdfPageNum = idx + 1;
                if (!clean(rawText)) {
                    result.push({
                        pdfPageNum,
                        partIndex: 0,
                        partCount: 1,
                        pageLabel: `${pdfPageNum}`,
                        html: '<p class="crm-bv-page-empty">No extractable text on this page.</p>'
                    });
                    return;
                }
                const blocks = formatPageBlocks(rawText, escapeHtml, '', { rendererContract: pagesData?.rendererContract });
                const subPages = splitBlocksIntoReaderPages(blocks, targetWords);

                subPages.forEach((html, partIdx) => {
                    const pageLabel = subPages.length > 1
                        ? `${pdfPageNum} (${partIdx + 1}/${subPages.length})`
                        : `${pdfPageNum}`;

                    result.push({
                        pdfPageNum,
                        partIndex: partIdx,
                        partCount: subPages.length,
                        pageLabel,
                        html
                    });
                });
            });

            return result;
        }

        function rebuildBookViewPages() {
            bookViewPages = buildBookViewPages(pagesData, bookViewFontScale);
        }

        function getBookViewVirtualPage(index) {
            if (!bookViewPages || index < 0 || index >= bookViewPages.length) return null;
            return bookViewPages[index];
        }

        function openBookView() {
            if (!pagesData || pagesData.totalPages === 0) return;
            rebuildBookViewPages();
            const startingIdx = bookViewPages.findIndex((p) => p.pdfPageNum >= currentPage);
            bookViewSpread = startingIdx >= 0 ? startingIdx + 1 : 1;
            if (bookViewSpread % 2 === 0) bookViewSpread -= 1;
            bookViewOpen = true;
            bookViewTurning = false;
            if (selectedBookId) {
                loadBookAudio(selectedBookId);
            }
            renderBookView();
            document.addEventListener('keydown', handleBookViewKeydown);
        }

        function closeBookView() {
            bookViewOpen = false;
            bookViewTurning = false;
            document.removeEventListener('keydown', handleBookViewKeydown);
            fadeOutAndStopBookAudio();
            const overlay = document.querySelector('.crm-bv-overlay');
            if (overlay) {
                overlay.classList.add('crm-bv-closing');
                setTimeout(() => overlay.remove(), 250);
            }
            const currentVirtual = getBookViewVirtualPage(bookViewSpread - 1);
            if (currentVirtual) {
                currentPage = currentVirtual.pdfPageNum;
            }
            resetPageCitation();
            renderExplorerPanel();
        }

        function handleBookViewKeydown(e) {
            if (!bookViewOpen) return;
            if (e.key === 'Escape') { closeBookView(); return; }
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); bookViewNext(); return; }
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); bookViewPrev(); return; }
        }

        function renderBookPageHtml(virtualPageData, isLeft) {
            const b = selectedBook || {};
            const footerText = isLeft ? (b.title || '') : (b.author || '');
            const num = virtualPageData ? virtualPageData.pageLabel : '';
            const body = virtualPageData ? virtualPageData.html : '<p class="crm-bv-page-empty">End of book.</p>';
            return `<div class="crm-bv-page-fold"></div>` +
                `<div class="crm-bv-page-num">${escapeHtml(num)}</div>` +
                `<div class="crm-bv-page-body">${body}</div>` +
                `<div class="crm-bv-page-footer">${escapeHtml(footerText)}</div>`;
        }

        function bookViewNext() {
            if (bookViewTurning) return;
            const total = bookViewPages.length;
            if (bookViewSpread + 2 > total) return;
            const overlay = document.querySelector('.crm-bv-overlay');
            if (!overlay) return;
            const spread = overlay.querySelector('.crm-bv-spread');
            if (!spread) return;

            const isNarrow = window.innerWidth <= 740;
            const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (isNarrow || prefersReducedMotion) {
                bookViewSpread += 2;
                updateBookViewPages(overlay);
                return;
            }

            bookViewTurning = true;
            const currentRightData = getBookViewVirtualPage(bookViewSpread);
            const nextLeftData = getBookViewVirtualPage(bookViewSpread + 1);
            const nextRightData = getBookViewVirtualPage(bookViewSpread + 2);

            // 1. Prepare base right page to immediately display next right page (so it's visible underneath as leaf flips away)
            const rightPageEl = spread.querySelector('.crm-bv-page-right');
            if (rightPageEl) {
                rightPageEl.innerHTML = renderBookPageHtml(nextRightData, false);
            }

            // 2. Create the 3D flipping leaf with dual faces (Front = current right page, Back = next left page)
            const leaf = document.createElement('div');
            leaf.className = 'crm-bv-leaf crm-bv-leaf-next';
            leaf.innerHTML =
                `<div class="crm-bv-leaf-face crm-bv-leaf-front">${renderBookPageHtml(currentRightData, false)}</div>` +
                `<div class="crm-bv-leaf-face crm-bv-leaf-back">${renderBookPageHtml(nextLeftData, true)}</div>`;
            spread.appendChild(leaf);

            // Trigger animation on next frame for smooth GPU transition
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    leaf.classList.add('is-flipping');
                });
            });

            const FLIP_DURATION = 850; // Smooth, natural 0.85s book turn
            setTimeout(() => {
                bookViewSpread += 2;
                leaf.remove();
                bookViewTurning = false;
                updateBookViewPages(overlay);
            }, FLIP_DURATION);
        }

        function bookViewPrev() {
            if (bookViewTurning) return;
            if (bookViewSpread <= 1) return;
            const overlay = document.querySelector('.crm-bv-overlay');
            if (!overlay) return;
            const spread = overlay.querySelector('.crm-bv-spread');
            if (!spread) return;

            const isNarrow = window.innerWidth <= 740;
            const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (isNarrow || prefersReducedMotion) {
                bookViewSpread = Math.max(1, bookViewSpread - 2);
                updateBookViewPages(overlay);
                return;
            }

            bookViewTurning = true;
            const currentLeftData = getBookViewVirtualPage(bookViewSpread - 1);
            const prevRightData = getBookViewVirtualPage(bookViewSpread - 2);
            const prevLeftData = getBookViewVirtualPage(bookViewSpread - 3);

            // 1. Prepare base left page to immediately display prev left page (so it's visible underneath as leaf flips away)
            const leftPageEl = spread.querySelector('.crm-bv-page-left');
            if (leftPageEl) {
                leftPageEl.innerHTML = renderBookPageHtml(prevLeftData, true);
            }

            // 2. Create the 3D flipping leaf with dual faces (Front = current left page, Back = prev right page)
            const leaf = document.createElement('div');
            leaf.className = 'crm-bv-leaf crm-bv-leaf-prev';
            leaf.innerHTML =
                `<div class="crm-bv-leaf-face crm-bv-leaf-front">${renderBookPageHtml(currentLeftData, true)}</div>` +
                `<div class="crm-bv-leaf-face crm-bv-leaf-back">${renderBookPageHtml(prevRightData, false)}</div>`;
            spread.appendChild(leaf);

            // Trigger animation on next frame
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    leaf.classList.add('is-flipping');
                });
            });

            const FLIP_DURATION = 850; // Smooth, natural 0.85s book turn
            setTimeout(() => {
                bookViewSpread = Math.max(1, bookViewSpread - 2);
                leaf.remove();
                bookViewTurning = false;
                updateBookViewPages(overlay);
            }, FLIP_DURATION);
        }

        function updateBookViewPages(overlay) {
            if (!overlay) return;
            const total = bookViewPages.length;
            const totalPdf = pagesData?.totalPages || 0;
            const leftData = getBookViewVirtualPage(bookViewSpread - 1);
            const rightData = getBookViewVirtualPage(bookViewSpread);

            const leftPage = overlay.querySelector('.crm-bv-page-left');
            const rightPage = overlay.querySelector('.crm-bv-page-right');

            if (leftPage) leftPage.innerHTML = renderBookPageHtml(leftData, true);
            if (rightPage) rightPage.innerHTML = renderBookPageHtml(rightData, false);

            overlay.querySelectorAll('.crm-bv-leaf').forEach(l => l.remove());

            const navInfo = overlay.querySelector('.crm-bv-nav-info');
            if (navInfo) {
                const leftLabel = leftData ? leftData.pageLabel : '';
                const rightLabel = rightData ? rightData.pageLabel : leftLabel;
                navInfo.textContent = leftLabel === rightLabel
                    ? `Page ${leftLabel} of ${totalPdf}`
                    : `Pages ${leftLabel}–${rightLabel} of ${totalPdf}`;
            }
            const prevBtn = overlay.querySelector('.crm-bv-prev');
            const nextBtn = overlay.querySelector('.crm-bv-next');
            if (prevBtn) prevBtn.disabled = bookViewSpread <= 1;
            if (nextBtn) nextBtn.disabled = bookViewSpread + 2 > total;
        }

        function applyBookViewFontScale(overlay) {
            const spread = overlay?.querySelector('.crm-bv-spread');
            if (spread) spread.style.setProperty('--crm-bv-font-scale', String(bookViewFontScale));
            const output = overlay?.querySelector('.crm-bv-font-output');
            if (output) output.textContent = `${bookViewFontScale}%`;
        }

        function renderBookView() {
            let overlay = document.querySelector('.crm-bv-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'crm-bv-overlay';
                document.body.appendChild(overlay);
            }
            overlay.classList.remove('crm-bv-closing');

            const total = bookViewPages.length;
            const totalPdf = pagesData?.totalPages || 0;
            const b = selectedBook || {};
            const leftData = getBookViewVirtualPage(bookViewSpread - 1);
            const rightData = getBookViewVirtualPage(bookViewSpread);
            const leftLabel = leftData ? leftData.pageLabel : '';
            const rightLabel = rightData ? rightData.pageLabel : leftLabel;
            const themeClass = 'crm-bv-theme-' + bookViewTheme;

            // Build theme swatch buttons
            const themePanelHtml = BOOK_THEMES.map(t =>
                `<button class="crm-bv-theme-swatch${t.id === bookViewTheme ? ' active' : ''}" data-theme="${t.id}" title="${t.name}" style="background:${t.swatch}"></button>`
            ).join('');

            overlay.innerHTML =
                `<div class="crm-bv-container ${themeClass}">` +
                    `<div class="crm-bv-topbar">` +
                        `<div class="crm-bv-topbar-left">` +
                            `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>` +
                            `<div class="crm-bv-topbar-info">` +
                                `<div class="crm-bv-topbar-title">${escapeHtml(b.title || 'Untitled')}</div>` +
                                `<div class="crm-bv-topbar-meta">${escapeHtml(b.author || '')}${b.pageCount ? ' · ' + b.pageCount + ' pages' : ''}</div>` +
                            `</div>` +
                        `</div>` +
                        `<div class="crm-bv-topbar-right">` +
                            `<div class="crm-bv-player${isBookAudioPlaying ? ' is-playing' : ''}">` +
                                `<button class="crm-bv-player-btn crm-bv-player-prev" title="Previous track">` +
                                    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>` +
                                `</button>` +
                                `<button class="crm-bv-player-btn crm-bv-player-play" title="Play / Pause BGM">` +
                                    `<svg class="crm-bv-play-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:${isBookAudioPlaying ? 'none' : 'block'};"><path d="M8 5v14l11-7z"/></svg>` +
                                    `<svg class="crm-bv-pause-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:${isBookAudioPlaying ? 'block' : 'none'};"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>` +
                                `</button>` +
                                `<button class="crm-bv-player-btn crm-bv-player-next" title="Next track">` +
                                    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>` +
                                `</button>` +
                                `<div class="crm-bv-wave" aria-hidden="true">` +
                                    `<span class="crm-bv-wave-bar"></span>` +
                                    `<span class="crm-bv-wave-bar"></span>` +
                                    `<span class="crm-bv-wave-bar"></span>` +
                                `</div>` +
                                `<div class="crm-bv-player-track" title="${escapeHtml(bookAudioTracks[bookAudioIndex]?.title || 'Background Music')}">` +
                                    `<span class="crm-bv-player-track-text">${escapeHtml(bookAudioTracks.length > 1 ? `${bookAudioIndex + 1}/${bookAudioTracks.length}: ${bookAudioTracks[bookAudioIndex]?.title || 'BGM'}` : (bookAudioTracks[bookAudioIndex]?.title || 'Study Ambience'))}</span>` +
                                `</div>` +
                                `<div class="crm-bv-volume-wrapper">` +
                                    `<button class="crm-bv-player-btn crm-bv-volume-btn" title="Volume">` +
                                        `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>` +
                                    `</button>` +
                                    `<div class="crm-bv-volume-slider-box">` +
                                        `<input type="range" class="crm-bv-volume-slider" min="0" max="100" step="1" value="${Math.round(bookAudioVolume * 100)}" aria-label="BGM Volume">` +
                                    `</div>` +
                                `</div>` +
                                `<button class="crm-bv-player-btn crm-bv-player-upload" title="Upload & Manage BGM Tracks">${ICON_PLUS}</button>` +
                            `</div>` +
                            `<div class="crm-bv-font-controls">` +
                                `<button class="crm-bv-font-btn crm-bv-font-down" title="Decrease font size">A−</button>` +
                                `<input type="range" class="crm-bv-font-slider" min="${BOOK_VIEW_FONT_MIN}" max="${BOOK_VIEW_FONT_MAX}" step="${BOOK_VIEW_FONT_STEP}" value="${bookViewFontScale}">` +
                                `<button class="crm-bv-font-btn crm-bv-font-up" title="Increase font size">A+</button>` +
                                `<span class="crm-bv-font-output">${bookViewFontScale}%</span>` +
                            `</div>` +
                            `<button class="crm-bv-close" title="Exit book view (Esc)">${ICON_CLOSE}</button>` +
                        `</div>` +
                    `</div>` +
                    `<div class="crm-bv-stage">` +
                        `<div class="crm-bv-theme-panel">${themePanelHtml}</div>` +
                        `<div class="crm-bv-spread" style="--crm-bv-font-scale:${bookViewFontScale}">` +
                            `<div class="crm-bv-page crm-bv-page-left">${renderBookPageHtml(leftData, true)}</div>` +
                            `<div class="crm-bv-spine"></div>` +
                            `<div class="crm-bv-page crm-bv-page-right">${renderBookPageHtml(rightData, false)}</div>` +
                        `</div>` +
                    `</div>` +
                    `<div class="crm-bv-controls">` +
                        `<button class="crm-bv-nav-btn crm-bv-prev"${bookViewSpread <= 1 ? ' disabled' : ''} title="Previous spread (A / ←)">${ICON_CHEVRON_LEFT}</button>` +
                        `<div class="crm-bv-nav-info">${leftLabel === rightLabel ? `Page ${leftLabel} of ${totalPdf}` : `Pages ${leftLabel}–${rightLabel} of ${totalPdf}`}</div>` +
                        `<button class="crm-bv-nav-btn crm-bv-next"${bookViewSpread + 2 > total ? ' disabled' : ''} title="Next spread (D / →)">${ICON_CHEVRON_RIGHT}</button>` +
                    `</div>` +
                    `<div class="crm-bv-shortcuts">A / ← previous · D / → next · Esc exit</div>` +
                `</div>`;

            overlay.querySelector('.crm-bv-close')?.addEventListener('click', closeBookView);
            overlay.querySelector('.crm-bv-prev')?.addEventListener('click', bookViewPrev);
            overlay.querySelector('.crm-bv-next')?.addEventListener('click', bookViewNext);

            // Audio player controls
            overlay.querySelector('.crm-bv-player-play')?.addEventListener('click', () => togglePlayBookAudio(overlay));
            overlay.querySelector('.crm-bv-player-prev')?.addEventListener('click', () => prevBookAudio(overlay));
            overlay.querySelector('.crm-bv-player-next')?.addEventListener('click', () => nextBookAudio(overlay));
            overlay.querySelector('.crm-bv-player-upload')?.addEventListener('click', () => { if (selectedBookId) openBookBgmModal(selectedBookId); });
            overlay.querySelector('.crm-bv-volume-slider')?.addEventListener('input', (e) => setBookAudioVolume(Number(e.target.value) / 100, overlay));
            overlay.querySelector('.crm-bv-volume-btn')?.addEventListener('click', () => {
                if (bookAudioVolume > 0) {
                    setBookAudioVolume(0, overlay);
                } else {
                    setBookAudioVolume(0.5, overlay);
                }
            });

            // Theme panel: delegate click to individual swatches
            overlay.querySelector('.crm-bv-theme-panel')?.addEventListener('click', (e) => {
                const swatch = e.target.closest('.crm-bv-theme-swatch');
                if (swatch && swatch.dataset.theme) {
                    setBookViewTheme(swatch.dataset.theme);
                }
            });

            const onFontScaleChange = (newScale) => {
                const currentPdf = bookViewPages[bookViewSpread - 1]?.pdfPageNum || 1;
                bookViewFontScale = clampReaderFontScale(newScale);
                try { localStorage.setItem('crm_books_bv_font_scale', String(bookViewFontScale)); } catch (_) { /* ignore */ }
                rebuildBookViewPages();
                const newIdx = bookViewPages.findIndex((p) => p.pdfPageNum >= currentPdf);
                bookViewSpread = Math.max(1, newIdx >= 0 ? newIdx + 1 : 1);
                if (bookViewSpread % 2 === 0) bookViewSpread -= 1;
                applyBookViewFontScale(overlay);
                updateBookViewPages(overlay);
            };

            overlay.querySelector('.crm-bv-font-slider')?.addEventListener('input', (e) => {
                onFontScaleChange(e.target.value);
            });
            overlay.querySelector('.crm-bv-font-down')?.addEventListener('click', () => {
                const nextVal = clampReaderFontScale(bookViewFontScale - BOOK_VIEW_FONT_STEP);
                const slider = overlay.querySelector('.crm-bv-font-slider');
                if (slider) slider.value = nextVal;
                onFontScaleChange(nextVal);
            });
            overlay.querySelector('.crm-bv-font-up')?.addEventListener('click', () => {
                const nextVal = clampReaderFontScale(bookViewFontScale + BOOK_VIEW_FONT_STEP);
                const slider = overlay.querySelector('.crm-bv-font-slider');
                if (slider) slider.value = nextVal;
                onFontScaleChange(nextVal);
            });
        }

        async function loadPagesMetadata(force = false) {
            if (!selectedBookId) return;
            const currentActiveRev = selectedBook?.activeTextRevisionId || null;
            if (!force && pagesData && pagesData.bookId === selectedBookId && (!currentActiveRev || pagesData.textRevisionId === currentActiveRev)) {
                return;
            }
            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}/pages`);
                pagesData = res?.data || res;
                if (!pagesData) pagesData = { totalPages: 0, pages: [] };
                pagesData.bookId = selectedBookId;
                if (typeof window !== 'undefined') window.__currentBookRendererContract = pagesData?.rendererContract || null;
                const lastRead = readingProgress.lastPage;
                currentPage = (lastRead && lastRead >= 1 && lastRead <= (pagesData.totalPages || 0))
                    ? lastRead
                    : getReadablePageNumbers(pagesData.pages)[0] || 1;
                if (activeTab === 'pages') {
                    renderExplorerPanel();
                    if (selectedBookId) markPageRead(selectedBookId, currentPage);
                    requestAnimationFrame(() => applyHighlightsToPage(currentPage));
                }
            } catch (err) {
                console.error('[CRM Books] Failed to load pages:', err);
                pagesData = { totalPages: 0, pages: [], bookId: selectedBookId };
                if (activeTab === 'pages') renderExplorerPanel();
            }
        }

        async function loadSectionDigests() {
            if (!selectedBookId || sectionDigests) return;
            sectionsLoading = true;
            renderExplorerPanel();
            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}/sections`);
                sectionDigests = Array.isArray(res?.sections) ? res.sections
                    : Array.isArray(res?.data?.sections) ? res.data.sections : [];
            } catch (err) {
                console.error('[CRM Books] Failed to load sections:', err);
                sectionDigests = [];
            }
            sectionsLoading = false;
            renderExplorerPanel();
        }

        async function jumpToPage(pageNumber) {
            if (!selectedBookId) return;
            cancelPageTurn();
            activeTab = 'pages';
            pageNotice = '';
            if (!pagesData) await loadPagesMetadata();
            if (!pagesData || pagesData.totalPages === 0) return;
            const page = Math.max(1, Math.min(Number(pageNumber) || 1, pagesData.totalPages));
            currentPage = page;
            resetPageCitation();
            pageNotice = `Jumped to page ${page}.`;
            renderExplorerPanel();
            requestAnimationFrame(() => {
                const paper = qs('.crm-books-page-paper');
                paper?.focus({ preventScroll: true });
            });
        }

        function findMessageCitation(marker) {
            const target = clean(marker).toUpperCase();
            for (const message of messages) {
                if (message.role === 'user' || !Array.isArray(message.citations)) continue;
                for (let i = 0; i < message.citations.length; i += 1) {
                    const citation = message.citations[i];
                    if (citationMarker(citation, i) === target) return citation;
                }
            }
            return null;
        }

        function resetPageCitation() {
            activeCitation = null;
            pageNotice = '';
        }

        async function openCitation(marker) {
            const citation = findMessageCitation(marker);
            if (!citation || !selectedBookId) return;

            cancelPageTurn();
            activeTab = 'pages';
            pageNotice = '';
            if (!pagesData) await loadPagesMetadata();
            if (!pagesData || pagesData.totalPages === 0) {
                pageNotice = 'The cited page text is unavailable.';
                renderExplorerPanel();
                return;
            }

            const location = resolveCitationLocation(pagesData.pages, citation);
            currentPage = location.page;
            activeCitation = {
                marker: citationMarker(citation),
                page: currentPage,
                quote: location.quote
            };
            pageNotice = location.matched
                ? `Citation ${citationMarker(citation)} opened on page ${currentPage}.`
                : `Citation ${citationMarker(citation)} opened at cited page ${currentPage}.`;
            renderExplorerPanel();

            requestAnimationFrame(() => {
                const page = qs('.crm-books-page-paper');
                const mark = page?.querySelector('mark.crm-books-citation-highlight');
                page?.focus({ preventScroll: true });
                mark?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
        }

        function showCitationPreview(wrap) {
            const preview = wrap?.querySelector('.crm-books-citation-preview');
            const trigger = wrap?.querySelector('.crm-books-citation-ref');
            if (!preview || !trigger) return;
            preview.classList.add('visible');
            const rect = trigger.getBoundingClientRect();
            const viewportMargin = 12;
            const previewRect = preview.getBoundingClientRect();
            let left = rect.left;
            let top = rect.bottom + 8;
            if (left + previewRect.width > window.innerWidth - viewportMargin) {
                left = window.innerWidth - previewRect.width - viewportMargin;
            }
            if (top + previewRect.height > window.innerHeight - viewportMargin) {
                top = rect.top - previewRect.height - 8;
            }
            const maxLeft = Math.max(viewportMargin, window.innerWidth - previewRect.width - viewportMargin);
            const maxTop = Math.max(viewportMargin, window.innerHeight - previewRect.height - viewportMargin);
            preview.style.left = `${Math.min(maxLeft, Math.max(viewportMargin, left))}px`;
            preview.style.top = `${Math.min(maxTop, Math.max(viewportMargin, top))}px`;
        }

        function hideCitationPreview(wrap) {
            const preview = wrap?.querySelector('.crm-books-citation-preview');
            if (preview) preview.classList.remove('visible');
        }

        function loadBookNotes(bookId) {
            if (!bookId) return [];
            try {
                const raw = localStorage.getItem(`crm_books_notes_${bookId}`);
                return raw ? JSON.parse(raw) : [];
            } catch (_) {
                return [];
            }
        }

        function saveBookNote(bookId, text) {
            if (!bookId || !text) return null;
            const notes = loadBookNotes(bookId);
            const newNote = {
                id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                text,
                savedAt: Date.now()
            };
            notes.unshift(newNote);
            try {
                localStorage.setItem(`crm_books_notes_${bookId}`, JSON.stringify(notes));
            } catch (e) {
                console.error('Failed to save book note:', e);
            }
            return apiPost(`/api/admin/books/${bookId}/notes`, { text }).then((res) => {
                const saved = res?.note || res?.data?.note;
                if (saved?.id) {
                    newNote.firestoreId = saved.id;
                    try { localStorage.setItem(`crm_books_notes_${bookId}`, JSON.stringify(loadBookNotes(bookId).map(n => n.id === newNote.id ? newNote : n))); } catch (err) { void err; }
                }
                return newNote;
            }).catch((err) => {
                console.warn('[CRM Books] Background note sync warning:', err);
                return newNote;
            });
        }

        function deleteBookNote(bookId, noteId) {
            if (!bookId || !noteId) return;
            let notes = loadBookNotes(bookId);
            const target = notes.find(n => n.id === noteId);
            notes = notes.filter(n => n.id !== noteId);
            try {
                localStorage.setItem(`crm_books_notes_${bookId}`, JSON.stringify(notes));
            } catch (e) {
                void e;
            }
            const fsId = target?.firestoreId;
            if (fsId) {
                apiDelete(`/api/admin/books/${bookId}/notes/${fsId}`).catch(() => {});
            }
        }

        async function syncNotesFromFirestore(bookId) {
            if (!bookId) return;
            try {
                const res = await apiGet(`/api/admin/books/${bookId}/notes`);
                const remote = res?.notes || res?.data?.notes;
                if (!Array.isArray(remote) || remote.length === 0) return;
                const local = loadBookNotes(bookId);
                const localIds = new Set(local.map(n => n.firestoreId).filter(Boolean));
                let merged = [...local];
                for (const rn of remote) {
                    if (!localIds.has(rn.id)) {
                        merged.push({ id: 'fs_' + rn.id, firestoreId: rn.id, text: rn.text, savedAt: rn.savedAt || Date.now() });
                    }
                }
                merged.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
                try { localStorage.setItem(`crm_books_notes_${bookId}`, JSON.stringify(merged)); } catch (err) { void err; }
                if (activeTab === 'notes') {
                    const container = qs('.crm-books-content');
                    if (container) container.innerHTML = renderNotesTab();
                }
            } catch (err) { void err; }
        }

        function formatMessageText(text, citations, escHtml) {
            if (!text) return '';
            let html = escHtml(text);

            const citationMap = new Map((Array.isArray(citations) ? citations : []).map((citation, index) => [
                citationMarker(citation, index), citation
            ]));

            html = html.replace(/\[C?(\d+)(?:\s*,\s*C?(\d+))*\]/gi, (match) => {
                const nums = match.match(/\d+/g);
                if (!nums || nums.length === 0) return match;

                const pills = nums.map((nStr) => {
                    const idx = parseInt(nStr, 10);
                    const marker = `C${idx}`;
                    const c = citationMap.get(marker);
                    if (c) {
                        const pages = c.pageStart === c.pageEnd ? `p. ${c.pageStart}` : `pp. ${c.pageStart}\u2013${c.pageEnd}`;
                        const actualMarker = citationMarker(c, idx - 1);
                        return `<button type="button" class="crm-books-citation-ref crm-books-inline-citation" title="Open ${escHtml(pages)}" aria-label="Open citation ${idx}, ${escHtml(pages)}" data-citation-marker="${escHtml(actualMarker)}">${idx}</button>`;
                    }
                    return escHtml(match);
                });

                return pills.join(' ');
            });

            return html;
        }

        let currentMindMapData = null;
        let mindMapZoom = 1.0;
        let mindMapPanX = 0;
        let mindMapPanY = 0;
        let isMindMapPanning = false;
        let mindMapStartMouseX = 0;
        let mindMapStartMouseY = 0;
        let mindMapEventsBound = false;
        let mindMapPositions = {};
        let mindMapUserNodes = [];
        let mindMapUserEdits = {};
        let mindMapCustomConnections = [];
        let mindMapHiddenConnections = [];
        let mindMapDirty = false;
        let mindMapNodeDrag = null;
        let mindMapDragRafId = null;
        let mindMapSaveTimeout = null;
        let mindMapContextNodeId = null;
        let mindMapCollapsedCategories = new Set();
        let mindMapActiveMapId = 'default';
        let mindMapAvailableMaps = {};
        let mindMapAnchorDrag = null;
        let mindMapResizeDrag = null;
        const mindMapCitationUpgradeAttempts = new Set();
        let mindMapUndoStack = [];
        let mindMapRedoStack = [];
        const UNDO_MAX = 50;

        function isLegacyMindMapData(data) {
            return !!data && data.citationSchemaVersion !== 1;
        }

        function mindMapCitationUpgradeKey(bookId, mapId = mindMapActiveMapId) {
            return `${bookId}:${mapId || 'default'}`;
        }

        function saveMapState(bookId, mapId) {
            if (!bookId || !mapId) return;
            const state = {
                data: currentMindMapData,
                positions: mindMapPositions,
                userNodes: mindMapUserNodes,
                userEdits: mindMapUserEdits,
                customConnections: mindMapCustomConnections,
                hiddenConnections: mindMapHiddenConnections
            };
            try {
                localStorage.setItem(`crm_books_mapstate_${bookId}_${mapId}`, JSON.stringify(state));
            } catch (_) {
                /* ignore storage error */
            }
        }

        function loadMapState(bookId, mapId) {
            if (!bookId || !mapId) return null;
            try {
                const raw = localStorage.getItem(`crm_books_mapstate_${bookId}_${mapId}`);
                return raw ? JSON.parse(raw) : null;
            } catch (_) {
                return null;
            }
        }

        async function switchToMap(bookId, mapId) {
            if (mindMapDirty) await saveMindMapEdits();
            saveMapState(bookId, mindMapActiveMapId);
            mindMapActiveMapId = mapId;

            const saved = loadMapState(bookId, mapId);
            if (saved && saved.data) {
                currentMindMapData = saved.data;
                mindMapPositions = saved.positions || {};
                mindMapUserNodes = Array.isArray(saved.userNodes) ? saved.userNodes : [];
                mindMapUserEdits = saved.userEdits || {};
                mindMapCustomConnections = Array.isArray(saved.customConnections) ? saved.customConnections : [];
                mindMapHiddenConnections = Array.isArray(saved.hiddenConnections) ? saved.hiddenConnections : [];
                mindMapDirty = false;

                const titleEl = docQs('#crm-mindmap-title');
                const subtitleEl = docQs('#crm-mindmap-subtitle');
                if (titleEl) titleEl.textContent = `🧠 ${currentMindMapData.centralTopic || 'Mind Map'}`;
                if (subtitleEl) subtitleEl.textContent = `${currentMindMapData.categories?.length || 0} categories • ${currentMindMapData.noteCount || 0} notes synthesized`;

                renderMindMapNodes(currentMindMapData);
                updateSaveStatus('');

                if (isLegacyMindMapData(currentMindMapData)) {
                    const maps = JSON.parse(localStorage.getItem(`crm_books_maps_${bookId}`) || '{}');
                    const noteIds = maps[mapId]?.noteIds;
                    const upgradeKey = mindMapCitationUpgradeKey(bookId, mapId);
                    if (!mindMapCitationUpgradeAttempts.has(upgradeKey)) {
                        mindMapCitationUpgradeAttempts.add(upgradeKey);
                        openMindMapModal(bookId, true, noteIds && noteIds.length > 0 ? noteIds : null).catch(() => {});
                    }
                }
            } else {
                const maps = JSON.parse(localStorage.getItem(`crm_books_maps_${bookId}`) || '{}');
                const mapMeta = maps[mapId];
                const noteIds = mapMeta?.noteIds;
                if (noteIds && noteIds.length > 0) {
                    await openMindMapModal(bookId, false, noteIds);
                } else {
                    await openMindMapModal(bookId, false);
                }
            }
        }

        function showNewMapDialog(bookId, maps, updateMapUI) {
            const notes = loadBookNotes(bookId);
            const modal = docQs('#crm-books-mindmap-modal');
            if (!modal) return;

            const overlay = document.createElement('div');
            overlay.className = 'crm-mindmap-newmap-overlay';
            overlay.innerHTML = `
              <div class="crm-mindmap-newmap-dialog">
                <h3>Create new mind map</h3>
                <label class="crm-mindmap-newmap-label">Map name</label>
                <input type="text" class="crm-mindmap-newmap-input" placeholder="e.g. Chapter 3 Focus" autofocus />
                <label class="crm-mindmap-newmap-label">Select notes to include</label>
                <div class="crm-mindmap-newmap-actions-row">
                  <button class="crm-mindmap-newmap-sel-btn" data-sel="all">Select all</button>
                  <button class="crm-mindmap-newmap-sel-btn" data-sel="none">Select none</button>
                  <span class="crm-mindmap-newmap-count">${notes.length} notes</span>
                </div>
                <div class="crm-mindmap-newmap-notes">${notes.length === 0 ? '<div style="padding:12px; color:var(--crm-text-muted, #9CA3AF); text-align:center;">No saved notes for this book.</div>' : notes.map(n => {
                    const ex = typeof extractNoteTitle === 'function' ? extractNoteTitle(n.text) : { title: n.text?.substring(0, 60) || 'Note' };
                    return `<label class="crm-mindmap-newmap-note-item">
                      <input type="checkbox" value="${escapeHtml(n.id)}" checked />
                      <span>${escapeHtml(ex.title?.substring(0, 80) || 'Untitled')}</span>
                    </label>`;
                }).join('')}</div>
                <div class="crm-mindmap-newmap-btns">
                  <button class="crm-btn crm-btn-secondary crm-btn-sm" data-action="cancel">Cancel</button>
                  <button class="crm-btn crm-btn-primary crm-btn-sm" data-action="create">Create Map</button>
                </div>
              </div>`;

            modal.appendChild(overlay);

            const nameInput = overlay.querySelector('.crm-mindmap-newmap-input');
            nameInput?.focus();

            overlay.querySelector('[data-sel="all"]')?.addEventListener('click', () => {
                overlay.querySelectorAll('.crm-mindmap-newmap-note-item input').forEach(cb => cb.checked = true);
            });
            overlay.querySelector('[data-sel="none"]')?.addEventListener('click', () => {
                overlay.querySelectorAll('.crm-mindmap-newmap-note-item input').forEach(cb => cb.checked = false);
            });

            overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

            overlay.querySelector('[data-action="create"]')?.addEventListener('click', async () => {
                const name = nameInput?.value?.trim();
                if (!name) { nameInput?.focus(); return; }
                const selectedIds = [...overlay.querySelectorAll('.crm-mindmap-newmap-note-item input:checked')].map(cb => cb.value);
                const newId = 'map_' + Date.now();
                maps[newId] = { name, createdAt: Date.now(), noteIds: selectedIds };
                localStorage.setItem(`crm_books_maps_${bookId}`, JSON.stringify(maps));
                overlay.remove();
                if (mindMapDirty) await saveMindMapEdits();
                saveMapState(bookId, mindMapActiveMapId);
                mindMapActiveMapId = newId;
                updateMapUI();
                await openMindMapModal(bookId, false, selectedIds.length > 0 && selectedIds.length < notes.length ? selectedIds : null);
            });
        }

        const DEFAULT_TEAM_MEMBERS = [
            { id: 'member_1', name: 'Member 1', color: '#EF4444', emoji: '🔴' },
            { id: 'member_2', name: 'Member 2', color: '#3B82F6', emoji: '🔵' },
            { id: 'member_3', name: 'Member 3', color: '#22C55E', emoji: '🟢' },
            { id: 'member_4', name: 'Member 4', color: '#EAB308', emoji: '🟡' }
        ];

        function getTeamMembers() {
            try {
                const raw = localStorage.getItem('crm_books_team_members');
                if (raw) return JSON.parse(raw);
            } catch (_) {
                /* fallback to defaults */
            }
            return DEFAULT_TEAM_MEMBERS;
        }

        function saveTeamMembers(members) {
            try {
                localStorage.setItem('crm_books_team_members', JSON.stringify(members));
            } catch (_) {
                /* ignore storage error */
            }
        }

        function getActiveTeamMember() {
            try {
                const raw = sessionStorage.getItem('crm_books_active_member');
                if (raw) return JSON.parse(raw);
            } catch (_) {
                /* fallback to first member */
            }
            return getTeamMembers()[0];
        }

        function setActiveTeamMember(member) {
            try {
                sessionStorage.setItem('crm_books_active_member', JSON.stringify(member));
            } catch (_) {
                /* ignore storage error */
            }
        }

        const MINDMAP_TAGS = [
            { id: 'objective', label: 'Objective', emoji: '🎯', color: '#8B5CF6' },
            { id: 'outcome', label: 'Outcome', emoji: '📊', color: '#059669' },
            { id: 'key-concept', label: 'Key Concept', emoji: '💡', color: '#F59E0B' },
            { id: 'action-item', label: 'Action Item', emoji: '✅', color: '#3B82F6' },
            { id: 'research', label: 'Research', emoji: '🔬', color: '#EC4899' }
        ];
        let mindMapActiveTagFilter = null; // null = show all, or tag id string

        function docQs(sel) { return document.querySelector(sel); }

        function applyMindMapTransform() {
            const canvas = docQs('#crm-mindmap-canvas');
            const svg = docQs('#crm-mindmap-svg');
            const transformStr = `translate(${mindMapPanX}px, ${mindMapPanY}px) scale(${mindMapZoom})`;
            if (canvas) canvas.style.transform = transformStr;
            if (svg) svg.style.transform = transformStr;
            if (typeof updateMinimap === 'function') updateMinimap();
        }

        function zoomMindMap(factor, anchorScreenX = null, anchorScreenY = null) {
            const viewport = docQs('#crm-mindmap-viewport');
            if (!viewport) return;
            const rect = viewport.getBoundingClientRect();
            const localX = anchorScreenX !== null && Number.isFinite(anchorScreenX)
                ? anchorScreenX - rect.left
                : viewport.clientWidth / 2;
            const localY = anchorScreenY !== null && Number.isFinite(anchorScreenY)
                ? anchorScreenY - rect.top
                : viewport.clientHeight / 2;
            const oldZoom = mindMapZoom;
            const newZoom = Math.max(0.3, Math.min(2.5, oldZoom * factor));
            if (Math.abs(newZoom - oldZoom) < 0.0001) return;
            const canvasX = (localX - mindMapPanX) / oldZoom;
            const canvasY = (localY - mindMapPanY) / oldZoom;
            mindMapPanX = localX - canvasX * newZoom;
            mindMapPanY = localY - canvasY * newZoom;
            mindMapZoom = newZoom;
            applyMindMapTransform();
        }

        // ─── Force-Directed Physics Engine ───
        let physicsEnabled = false;
        let physicsNodes = [];
        let physicsEdges = [];
        let physicsRAF = null;
        let physicsDragNodeId = null;
        const PHYSICS_REPULSION = 120000;
        const PHYSICS_SPRING_K = 0.005;
        const PHYSICS_DAMPING = 0.88;
        const PHYSICS_CENTER_GRAVITY = 0.0003;
        const PHYSICS_MAX_SPEED = 15;

        function initPhysicsNodes() {
            physicsNodes = [];
            physicsEdges = [];
            const canvas = docQs('#crm-mindmap-canvas');
            if (!canvas) return;
            canvas.querySelectorAll('.crm-mindmap-node').forEach(node => {
                const id = node.dataset.nodeId;
                if (!id) return;
                const x = parseFloat(node.style.left) || 0;
                const y = parseFloat(node.style.top) || 0;
                const w = node.offsetWidth || 200;
                const h = node.offsetHeight || 60;
                physicsNodes.push({ id, x, y, vx: 0, vy: 0, w, h, pinned: id === 'central', el: node });
            });
            const nodeMap = new Map(physicsNodes.map(n => [n.id, n]));
            if (currentMindMapData && currentMindMapData.categories) {
                currentMindMapData.categories.forEach((cat, ci) => {
                    const catId = cat.id || `cat_${ci}`;
                    if (nodeMap.has('central') && nodeMap.has(catId)) {
                        physicsEdges.push({ source: 'central', target: catId, restLength: 480 });
                    }
                    (cat.subtopics || []).forEach((sub, si) => {
                        const subId = sub.id || `sub_${ci}_${si}`;
                        if (nodeMap.has(catId) && nodeMap.has(subId)) {
                            physicsEdges.push({ source: catId, target: subId, restLength: 350 });
                        }
                    });
                });
            }
            mindMapUserNodes.forEach(un => {
                if (un.parentId && nodeMap.has(un.parentId) && nodeMap.has(un.id)) {
                    physicsEdges.push({ source: un.parentId, target: un.id, restLength: 250 });
                }
            });
        }

        function stepPhysics() {
            const nodeMap = new Map(physicsNodes.map(n => [n.id, n]));
            const cx = 1500, cy = 1000;
            for (let i = 0; i < physicsNodes.length; i++) {
                const a = physicsNodes[i];
                if (a.pinned) continue;
                const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
                for (let j = i + 1; j < physicsNodes.length; j++) {
                    const b = physicsNodes[j];
                    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
                    let dx = ax - bx, dy = ay - by;
                    const distSq = dx * dx + dy * dy + 1;
                    const dist = Math.sqrt(distSq);
                    const force = PHYSICS_REPULSION / distSq;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    a.vx += fx; a.vy += fy;
                    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
                }
                a.vx += (cx - ax) * PHYSICS_CENTER_GRAVITY;
                a.vy += (cy - ay) * PHYSICS_CENTER_GRAVITY;
            }
            for (const edge of physicsEdges) {
                const a = nodeMap.get(edge.source);
                const b = nodeMap.get(edge.target);
                if (!a || !b) continue;
                const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
                const bx = b.x + b.w / 2, by = b.y + b.h / 2;
                let dx = bx - ax, dy = by - ay;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const displacement = dist - edge.restLength;
                const force = PHYSICS_SPRING_K * displacement;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                if (!a.pinned) { a.vx += fx; a.vy += fy; }
                if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
            }
            let totalKE = 0;
            for (const n of physicsNodes) {
                if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
                n.vx *= PHYSICS_DAMPING;
                n.vy *= PHYSICS_DAMPING;
                const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
                if (speed > PHYSICS_MAX_SPEED) {
                    n.vx = (n.vx / speed) * PHYSICS_MAX_SPEED;
                    n.vy = (n.vy / speed) * PHYSICS_MAX_SPEED;
                }
                n.x += n.vx;
                n.y += n.vy;
                n.el.style.left = n.x + 'px';
                n.el.style.top = n.y + 'px';
                totalKE += n.vx * n.vx + n.vy * n.vy;
            }
            return totalKE;
        }

        let physicsFrameCount = 0;
        function runPhysicsLoop() {
            if (!physicsEnabled) return;
            const ke = stepPhysics();
            physicsFrameCount++;
            if (physicsFrameCount % 3 === 0) rebuildSVGPaths();
            if (physicsFrameCount % 10 === 0 && typeof updateMinimap === 'function') updateMinimap();
            if (ke < 0.01 && !physicsDragNodeId) {
                physicsRAF = null;
                rebuildSVGPaths();
                return;
            }
            physicsRAF = requestAnimationFrame(runPhysicsLoop);
        }

        function startPhysics() {
            physicsEnabled = true;
            physicsFrameCount = 0;
            initPhysicsNodes();
            const viewport = docQs('#crm-mindmap-viewport');
            if (viewport) viewport.classList.add('crm-mindmap-physics-active');
            const btn = docQs('#crm-mindmap-physics-btn');
            if (btn) btn.classList.add('active');
            if (!physicsRAF) physicsRAF = requestAnimationFrame(runPhysicsLoop);
        }

        function stopPhysics() {
            physicsEnabled = false;
            if (physicsRAF) { cancelAnimationFrame(physicsRAF); physicsRAF = null; }
            const viewport = docQs('#crm-mindmap-viewport');
            if (viewport) viewport.classList.remove('crm-mindmap-physics-active');
            const btn = docQs('#crm-mindmap-physics-btn');
            if (btn) btn.classList.remove('active');
            const userNodeMap = new Map(mindMapUserNodes.map(u => [u.id, u]));
            physicsNodes.forEach(n => {
                mindMapPositions[n.id] = { x: n.x, y: n.y };
                const un = userNodeMap.get(n.id);
                if (un) { un.x = n.x; un.y = n.y; }
            });
            scheduleMindMapAutoSave();
        }

        function togglePhysics() {
            if (physicsEnabled) stopPhysics();
            else startPhysics();
        }

        function nudgePhysics() {
            if (physicsEnabled && !physicsRAF) {
                physicsRAF = requestAnimationFrame(runPhysicsLoop);
            }
        }

        // ─── Reactions & Comments ───
        const MINDMAP_REACTIONS = [
            { id: 'lightbulb', emoji: '\u{1F4A1}', label: 'Insight' },
            { id: 'fire', emoji: '\u{1F525}', label: 'Hot take' },
            { id: 'question', emoji: '❓', label: 'Question' },
            { id: 'checkmark', emoji: '✅', label: 'Agreed' },
            { id: 'star', emoji: '⭐', label: 'Important' }
        ];

        function toggleReaction(nodeId, reactionId) {
            if (!mindMapUserEdits[nodeId]) mindMapUserEdits[nodeId] = {};
            if (!mindMapUserEdits[nodeId].reactions) mindMapUserEdits[nodeId].reactions = {};
            const reactions = mindMapUserEdits[nodeId].reactions;
            if (!reactions[reactionId]) reactions[reactionId] = [];
            const memberId = getActiveTeamMember().id;
            const idx = reactions[reactionId].indexOf(memberId);
            if (idx >= 0) reactions[reactionId].splice(idx, 1);
            else reactions[reactionId].push(memberId);
            scheduleMindMapAutoSave();
        }

        function addNodeComment(nodeId, text) {
            if (!text || !text.trim()) return;
            if (!mindMapUserEdits[nodeId]) mindMapUserEdits[nodeId] = {};
            if (!mindMapUserEdits[nodeId].comments) mindMapUserEdits[nodeId].comments = [];
            const member = getActiveTeamMember();
            mindMapUserEdits[nodeId].comments.push({
                id: 'cmt_' + Date.now(),
                text: text.trim(),
                author: member.id,
                authorName: member.name,
                authorEmoji: member.emoji,
                createdAt: Date.now()
            });
            scheduleMindMapAutoSave();
        }

        function deleteNodeComment(nodeId, commentId) {
            const comments = mindMapUserEdits[nodeId]?.comments;
            if (!comments) return;
            const idx = comments.findIndex(c => c.id === commentId);
            if (idx >= 0) { comments.splice(idx, 1); scheduleMindMapAutoSave(); }
        }

        function renderInspectorReactions(nodeId) {
            const container = docQs('#crm-mindmap-inspector-reactions');
            if (!container) return;
            const reactions = mindMapUserEdits[nodeId]?.reactions || {};
            const memberId = getActiveTeamMember().id;
            container.innerHTML = MINDMAP_REACTIONS.map(r => {
                const voters = reactions[r.id] || [];
                const isActive = voters.includes(memberId);
                return `<button class="crm-mindmap-reaction-btn${isActive ? ' active' : ''}" data-reaction="${r.id}" data-node-id="${escapeHtml(nodeId)}" title="${r.label}">` +
                    `<span class="crm-mindmap-reaction-emoji">${r.emoji}</span>` +
                    (voters.length > 0 ? `<span class="crm-mindmap-reaction-count">${voters.length}</span>` : '') +
                    `</button>`;
            }).join('');
        }

        function renderInspectorComments(nodeId) {
            const container = docQs('#crm-mindmap-inspector-comments');
            if (!container) return;
            const comments = mindMapUserEdits[nodeId]?.comments || [];
            if (comments.length === 0) {
                container.innerHTML = '<p style="font-size:0.8em;color:var(--mm-text-muted,#94a3b8);margin:4px 0;">No comments yet.</p>';
                return;
            }
            container.innerHTML = comments.map(c => {
                const timeStr = c.createdAt ? new Date(c.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                return `<div class="crm-mindmap-comment-item">` +
                    `<div class="crm-mindmap-comment-header">` +
                    `<span class="crm-mindmap-comment-author">${c.authorEmoji || ''} ${escapeHtml(c.authorName || c.author || 'Member')}</span>` +
                    `<span class="crm-mindmap-comment-time">${escapeHtml(timeStr)}</span>` +
                    `<button class="crm-mindmap-comment-delete" data-comment-id="${escapeHtml(c.id)}" data-node-id="${escapeHtml(nodeId)}" title="Delete">&times;</button>` +
                    `</div>` +
                    `<div class="crm-mindmap-comment-text">${escapeHtml(c.text)}</div>` +
                    `</div>`;
            }).join('');
        }

        // ─── Voting System ───
        let heatmapEnabled = false;

        function upvoteNode(nodeId) {
            if (!mindMapUserEdits[nodeId]) mindMapUserEdits[nodeId] = {};
            if (!mindMapUserEdits[nodeId].votes) mindMapUserEdits[nodeId].votes = {};
            const memberId = getActiveTeamMember().id;
            const current = mindMapUserEdits[nodeId].votes[memberId];
            mindMapUserEdits[nodeId].votes[memberId] = current === 1 ? 0 : 1;
            scheduleMindMapAutoSave();
        }

        function downvoteNode(nodeId) {
            if (!mindMapUserEdits[nodeId]) mindMapUserEdits[nodeId] = {};
            if (!mindMapUserEdits[nodeId].votes) mindMapUserEdits[nodeId].votes = {};
            const memberId = getActiveTeamMember().id;
            const current = mindMapUserEdits[nodeId].votes[memberId];
            mindMapUserEdits[nodeId].votes[memberId] = current === -1 ? 0 : -1;
            scheduleMindMapAutoSave();
        }

        function getVoteCount(nodeId) {
            const votes = mindMapUserEdits[nodeId]?.votes;
            if (!votes) return 0;
            return Object.values(votes).reduce((sum, v) => sum + (v || 0), 0);
        }

        function renderInspectorVotes(nodeId) {
            const container = docQs('#crm-mindmap-inspector-votes');
            if (!container) return;
            const count = getVoteCount(nodeId);
            const memberId = getActiveTeamMember().id;
            const myVote = mindMapUserEdits[nodeId]?.votes?.[memberId] || 0;
            container.innerHTML = `<div class="crm-mindmap-vote-controls">` +
                `<button class="crm-mindmap-vote-btn crm-mindmap-vote-up${myVote === 1 ? ' active' : ''}" data-node-id="${escapeHtml(nodeId)}" data-vote="up" title="Upvote">` +
                `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 3l5 7H3z"/></svg></button>` +
                `<span class="crm-mindmap-vote-count${count > 0 ? ' positive' : count < 0 ? ' negative' : ''}">${count > 0 ? '+' : ''}${count}</span>` +
                `<button class="crm-mindmap-vote-btn crm-mindmap-vote-down${myVote === -1 ? ' active' : ''}" data-node-id="${escapeHtml(nodeId)}" data-vote="down" title="Downvote">` +
                `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 13l5-7H3z"/></svg></button>` +
                `</div>`;
        }

        function applyHeatmapOverlay() {
            const canvas = docQs('#crm-mindmap-canvas');
            if (!canvas) return;
            if (!heatmapEnabled) {
                canvas.classList.remove('crm-mindmap-heatmap-active');
                canvas.querySelectorAll('.crm-mindmap-node').forEach(n => n.style.removeProperty('--heat-intensity'));
                return;
            }
            canvas.classList.add('crm-mindmap-heatmap-active');
            let maxAbs = 1;
            canvas.querySelectorAll('.crm-mindmap-node').forEach(n => {
                const count = getVoteCount(n.dataset.nodeId);
                maxAbs = Math.max(maxAbs, Math.abs(count));
            });
            canvas.querySelectorAll('.crm-mindmap-node').forEach(n => {
                const count = getVoteCount(n.dataset.nodeId);
                const intensity = Math.abs(count) / maxAbs;
                n.style.setProperty('--heat-intensity', intensity.toFixed(2));
                n.style.setProperty('--heat-direction', count >= 0 ? '1' : '-1');
            });
        }

        function toggleHeatmap() {
            heatmapEnabled = !heatmapEnabled;
            const btn = docQs('#crm-mindmap-heatmap-btn');
            if (btn) btn.classList.toggle('active', heatmapEnabled);
            applyHeatmapOverlay();
        }

        // ─── AI Node Expansion ───
        async function expandNodeWithAI(nodeId) {
            if (!selectedBookId || !currentMindMapData) return;
            const canvas = docQs('#crm-mindmap-canvas');
            const node = canvas?.querySelector(`[data-node-id="${nodeId}"]`);
            if (!node) return;

            const nodeTitle = mindMapUserEdits[nodeId]?.title || node.dataset.title || '';
            const nodeSummary = node.dataset.summary || node.dataset.fulltext || '';
            const catTitle = node.dataset.catTitle || nodeTitle;

            node.classList.add('crm-mindmap-expanding');
            try {
                const res = await apiPost(`/api/admin/books/${selectedBookId}/mind-map/expand`, {
                    nodeId,
                    nodeTitle,
                    nodeSummary,
                    parentCategory: catTitle
                });
                const children = res.subtopics || res.childNodes || [];
                if (children.length === 0) {
                    node.classList.remove('crm-mindmap-expanding');
                    return;
                }
                const parentX = parseFloat(node.style.left) || 0;
                const parentY = parseFloat(node.style.top) || 0;
                const parentW = node.offsetWidth || 200;
                const parentH = node.offsetHeight || 60;
                const parentCx = parentX + parentW / 2;
                const parentCy = parentY + parentH / 2;
                const existingAngles = [];
                mindMapUserNodes.filter(u => u.parentId === nodeId).forEach(u => {
                    const angle = Math.atan2((u.y || 0) - parentCy, (u.x || 0) - parentCx);
                    existingAngles.push(angle);
                });
                const startAngle = existingAngles.length > 0 ? Math.max(...existingAngles) + 0.5 : -Math.PI / 2;
                const arcSpan = Math.min(Math.PI, 0.4 * children.length);
                children.forEach((child, i) => {
                    const angle = startAngle + (children.length > 1 ? (-arcSpan / 2 + i * (arcSpan / (children.length - 1))) : 0);
                    const radius = 280;
                    const cx = parentCx + radius * Math.cos(angle) - 100;
                    const cy = parentCy + radius * Math.sin(angle) - 30;
                    const id = 'ai_' + Date.now() + '_' + i;
                    const createdBy = getActiveTeamMember().id;
                    mindMapUserNodes.push({
                        id,
                        title: child.title || 'Subtopic',
                        text: child.summary || '',
                        color: node.style.getPropertyValue('--node-color') || '#8B5CF6',
                        x: cx,
                        y: cy,
                        parentId: nodeId,
                        createdBy,
                        aiGenerated: true
                    });
                });
                renderMindMapNodes(currentMindMapData, true);
                scheduleMindMapAutoSave();
                if (physicsEnabled) {
                    initPhysicsNodes();
                    nudgePhysics();
                }
            } catch (err) {
                console.error('AI expansion failed:', err);
                showToast?.('AI expansion failed: ' + (err.message || 'Unknown error'), 'error');
            } finally {
                if (node) node.classList.remove('crm-mindmap-expanding');
            }
        }

        function getNodeId(node) {
            return node?.dataset?.nodeId || '';
        }

        function getNodeNoteIds(nodeId) {
            if (!currentMindMapData || !currentMindMapData.categories) return [];
            let noteIds = new Set();
            for (const cat of currentMindMapData.categories) {
                if (cat.id === nodeId) {
                    (cat.subtopics || []).forEach(sub => {
                        (sub.noteIds || []).forEach(id => noteIds.add(id));
                    });
                } else {
                    const sub = (cat.subtopics || []).find(s => s.id === nodeId);
                    if (sub) {
                        (sub.noteIds || []).forEach(id => noteIds.add(id));
                    }
                }
            }
            return Array.from(noteIds);
        }

        function getNodeSubtopics(nodeId) {
            if (!currentMindMapData || !Array.isArray(currentMindMapData.categories)) return [];
            const subtopics = [];
            currentMindMapData.categories.forEach(category => {
                if (category.id === nodeId) {
                    (category.subtopics || []).forEach(subtopic => subtopics.push(subtopic));
                } else {
                    const subtopic = (category.subtopics || []).find(item => item.id === nodeId);
                    if (subtopic) subtopics.push(subtopic);
                }
            });
            return subtopics;
        }

        function getNodeCitations(nodeId) {
            const citations = [];
            getNodeSubtopics(nodeId).forEach(subtopic => {
                if (subtopic?.evidenceStatus === 'insufficient') return;
                (Array.isArray(subtopic?.citations) ? subtopic.citations : []).forEach(citation => citations.push(citation));
            });
            return citations;
        }

        function nodeHasInsufficientEvidence(nodeId) {
            return getNodeSubtopics(nodeId).some(subtopic => {
                if (subtopic?.evidenceStatus === 'insufficient') return true;
                return Array.isArray(subtopic?.noteIds)
                    && subtopic.noteIds.length > 0
                    && (!Array.isArray(subtopic?.citations) || subtopic.citations.length === 0);
            });
        }

        function getTagsHtml(nodeId) {
            const tags = mindMapUserEdits[nodeId]?.tags || [];
            if (tags.length === 0) return '';
            let html = '<div class="crm-mindmap-node-tags">';
            tags.forEach(tId => {
                const tag = MINDMAP_TAGS.find(t => t.id === tId);
                if (tag) {
                    html += `<span class="crm-mindmap-tag-pill" style="background:${tag.color}20; color:${tag.color}; border: 1px solid ${tag.color}40">${tag.emoji} ${tag.label}</span>`;
                }
            });
            html += '</div>';
            return html;
        }

        function getBadgeHtml(createdBy) {
            if (!createdBy) return '';
            const member = getTeamMembers().find(m => m.id === createdBy);
            if (!member) return '';
            return `<span class="crm-mindmap-node-badge" style="background:${member.color}" title="${escapeHtml(member.name)}">${member.emoji}</span>`;
        }

        function getVoteBadgeHtml(nodeId) {
            const count = getVoteCount(nodeId);
            if (count === 0) return '';
            const cls = count > 0 ? 'positive' : 'negative';
            return `<span class="crm-mindmap-vote-badge ${cls}">${count > 0 ? '▲' : '▼'} ${Math.abs(count)}</span>`;
        }

        function getReactionBadgeHtml(nodeId) {
            const reactions = mindMapUserEdits[nodeId]?.reactions;
            if (!reactions) return '';
            let total = 0;
            let emojis = '';
            for (const r of MINDMAP_REACTIONS) {
                const voters = reactions[r.id];
                if (voters && voters.length > 0) { total += voters.length; emojis += r.emoji; }
            }
            if (total === 0) return '';
            return `<span class="crm-mindmap-reaction-badge">${emojis.slice(0, 3)} ${total}</span>`;
        }

        function getCommentBadgeHtml(nodeId) {
            const comments = mindMapUserEdits[nodeId]?.comments;
            if (!comments || comments.length === 0) return '';
            return `<span class="crm-mindmap-comment-badge">\u{1F4AC} ${comments.length}</span>`;
        }

        function updateNodeDimming() {
            const canvas = docQs('#crm-mindmap-canvas');
            if (!canvas) return;
            canvas.querySelectorAll('.crm-mindmap-node[data-node-id]').forEach(node => {
                if (!mindMapActiveTagFilter) {
                    node.classList.remove('crm-mindmap-dimmed');
                } else {
                    const nid = node.dataset.nodeId;
                    const tags = mindMapUserEdits[nid]?.tags || [];
                    if (tags.includes(mindMapActiveTagFilter)) {
                        node.classList.remove('crm-mindmap-dimmed');
                    } else {
                        node.classList.add('crm-mindmap-dimmed');
                    }
                }
            });
        }

        function getNodeCenter(nodeEl) {
            const left = parseFloat(nodeEl.style.left) || 0;
            const top = parseFloat(nodeEl.style.top) || 0;
            const w = nodeEl.offsetWidth || 200;
            const h = nodeEl.offsetHeight || 50;
            return { x: left + w / 2, y: top + h / 2 };
        }

        function buildBezier(fromNode, toNode, fromSideHint, toSideHint) {
            const fromSide = fromSideHint || findClosestAnchor(fromNode, getNodeCenter(toNode));
            const toSide = toSideHint || findClosestAnchor(toNode, getNodeCenter(fromNode));
            const fp = getAnchorPoint(fromNode, fromSide);
            const tp = getAnchorPoint(toNode, toSide);
            const dist = Math.hypot(tp.x - fp.x, tp.y - fp.y);
            const offset = Math.min(dist * 0.35, 120);
            let c1x = fp.x, c1y = fp.y, c2x = tp.x, c2y = tp.y;
            if (fromSide === 'right') c1x += offset;
            else if (fromSide === 'left') c1x -= offset;
            else if (fromSide === 'top') c1y -= offset;
            else if (fromSide === 'bottom') c1y += offset;
            if (toSide === 'right') c2x += offset;
            else if (toSide === 'left') c2x -= offset;
            else if (toSide === 'top') c2y -= offset;
            else if (toSide === 'bottom') c2y += offset;
            return { fp, tp, c1x, c1y, c2x, c2y, d: `M ${fp.x} ${fp.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${tp.x} ${tp.y}` };
        }

        function rebuildSVGPaths() {
            const svg = docQs('#crm-mindmap-svg');
            const canvas = docQs('#crm-mindmap-canvas');
            if (!svg || !canvas) return;

            const nodes = canvas.querySelectorAll('.crm-mindmap-node[data-node-id]');
            const nodeMap = {};
            nodes.forEach(n => { nodeMap[n.dataset.nodeId] = n; });

            let pathsHtml = '';
            const centralNode = nodeMap['central'];
            if (!centralNode) { svg.innerHTML = ''; return; }
            const hiddenSet = new Set(mindMapHiddenConnections || []);

            const categories = currentMindMapData?.categories || [];
            categories.forEach((cat, cIdx) => {
                const catId = cat.id || `cat_${cIdx}`;
                const catNode = nodeMap[catId];
                if (!catNode) return;
                const catColor = mindMapUserEdits[catId]?.color || cat.color || '#4f46e5';
                const connId = `struct_central_${catId}`;
                if (!hiddenSet.has(connId)) {
                    const b = buildBezier(centralNode, catNode);
                    pathsHtml += `<path d="${b.d}" stroke="${catColor}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.4" />`;
                    pathsHtml += `<path class="crm-mindmap-conn-hitarea" data-conn-id="${connId}" data-conn-type="structural" d="${b.d}" stroke="transparent" stroke-width="14" fill="none" />`;
                }

                const subtopics = cat.subtopics || [];
                subtopics.forEach((sub, sIdx) => {
                    const subId = sub.id || `sub_${cIdx}_${sIdx}`;
                    const subNode = nodeMap[subId];
                    if (!subNode) return;
                    const subConnId = `struct_${catId}_${subId}`;
                    if (!hiddenSet.has(subConnId)) {
                        const sb = buildBezier(catNode, subNode);
                        pathsHtml += `<path d="${sb.d}" stroke="${catColor}" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.35" />`;
                        pathsHtml += `<path class="crm-mindmap-conn-hitarea" data-conn-id="${subConnId}" data-conn-type="structural" d="${sb.d}" stroke="transparent" stroke-width="14" fill="none" />`;
                    }
                });
            });

            mindMapUserNodes.forEach(un => {
                if (un.parentId) {
                    const userConnId = `user_${un.parentId}_${un.id}`;
                    if (hiddenSet.has(userConnId)) return;
                    const parentNode = nodeMap[un.parentId];
                    const childNode = nodeMap[un.id];
                    if (parentNode && childNode) {
                        const b = buildBezier(parentNode, childNode);
                        pathsHtml += `<path d="${b.d}" stroke="${un.color || '#F59E0B'}" stroke-width="1.5" stroke-dasharray="5,4" fill="none" opacity="0.4" />`;
                        pathsHtml += `<path class="crm-mindmap-conn-hitarea" data-conn-id="${userConnId}" data-conn-type="user" d="${b.d}" stroke="transparent" stroke-width="14" fill="none" />`;
                    }
                }
            });

            mindMapCustomConnections.forEach(conn => {
                const fromNode = nodeMap[conn.from];
                const toNode = nodeMap[conn.to];
                if (!fromNode || !toNode) return;
                const b = buildBezier(fromNode, toNode, conn.fromAnchor, conn.toAnchor);
                const color = conn.color || '#6366F1';
                pathsHtml += `<path class="crm-mindmap-custom-conn" data-conn-id="${conn.id}" d="${b.d}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.65" />`;
                const arrowSize = 7;
                const angle = Math.atan2(b.tp.y - b.c2y, b.tp.x - b.c2x);
                const a1x = b.tp.x - arrowSize * Math.cos(angle - 0.4);
                const a1y = b.tp.y - arrowSize * Math.sin(angle - 0.4);
                const a2x = b.tp.x - arrowSize * Math.cos(angle + 0.4);
                const a2y = b.tp.y - arrowSize * Math.sin(angle + 0.4);
                pathsHtml += `<polygon points="${b.tp.x},${b.tp.y} ${a1x},${a1y} ${a2x},${a2y}" fill="${color}" opacity="0.65" />`;
                pathsHtml += `<path class="crm-mindmap-conn-hitarea" data-conn-id="${conn.id}" data-conn-type="custom" d="${b.d}" stroke="transparent" stroke-width="14" fill="none" />`;
            });

            svg.innerHTML = pathsHtml;
        }

        // === Branch Highlighting ===
        function highlightBranch(nodeId) {
            const canvas = docQs('#crm-mindmap-canvas');
            if (!canvas || isMindMapPanning || mindMapNodeDrag) return;

            const related = new Set([nodeId, 'central']);
            const cats = currentMindMapData?.categories || [];

            cats.forEach((cat, ci) => {
                const catId = cat.id || `cat_${ci}`;
                const subs = (cat.subtopics || []).map((s, si) => s.id || `sub_${ci}_${si}`);

                if (catId === nodeId || subs.includes(nodeId)) {
                    related.add(catId);
                    subs.forEach(s => related.add(s));
                }
            });

            mindMapUserNodes.forEach(un => {
                if (un.id === nodeId || un.parentId === nodeId) {
                    related.add(un.id);
                    if (un.parentId) related.add(un.parentId);
                }
            });

            canvas.classList.add('mm-branch-highlight');
            canvas.querySelectorAll('.crm-mindmap-node').forEach(n => {
                n.classList.toggle('mm-branch-active', related.has(n.dataset.nodeId));
            });
        }

        function clearBranchHighlight() {
            const canvas = docQs('#crm-mindmap-canvas');
            if (!canvas) return;
            canvas.classList.remove('mm-branch-highlight');
            canvas.querySelectorAll('.mm-branch-active').forEach(n => n.classList.remove('mm-branch-active'));
        }

        // === Ripple Effect ===
        function createRipple(node, e) {
            const rect = node.getBoundingClientRect();
            const ripple = document.createElement('span');
            ripple.className = 'crm-mindmap-ripple';
            const size = Math.max(rect.width, rect.height);
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
            ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
            node.style.overflow = 'hidden';
            node.appendChild(ripple);
            ripple.addEventListener('animationend', () => {
                ripple.remove();
                node.style.overflow = '';
            });
        }

        function updateSaveStatus(status, tempMsg) {
            const el = docQs('#crm-mindmap-save-status');
            if (!el) return;
            el.className = 'crm-mindmap-save-status';
            if (tempMsg) {
                el.textContent = tempMsg;
                setTimeout(() => { el.textContent = ''; }, 2000);
                return;
            }
            if (status === 'saving') { el.textContent = 'Saving...'; el.classList.add('is-saving'); }
            else if (status === 'saved') { el.textContent = 'Saved'; }
            else if (status === 'error') { el.textContent = 'Save failed'; el.classList.add('is-error'); }
            else if (status === 'unsaved') { el.textContent = 'Unsaved changes'; }
            else { el.textContent = ''; }
        }

        function mmCaptureState() {
            return JSON.stringify({
                positions: mindMapPositions,
                userNodes: mindMapUserNodes,
                userEdits: mindMapUserEdits,
                customConnections: mindMapCustomConnections,
                hiddenConnections: mindMapHiddenConnections
            });
        }

        function mmPushUndo() {
            const snap = mmCaptureState();
            if (mindMapUndoStack.length && mindMapUndoStack[mindMapUndoStack.length - 1] === snap) return;
            mindMapUndoStack.push(snap);
            if (mindMapUndoStack.length > UNDO_MAX) mindMapUndoStack.shift();
            mindMapRedoStack = [];
            mmUpdateUndoButtons();
        }

        function mmRestoreState(json) {
            const s = JSON.parse(json);
            mindMapPositions = s.positions || {};
            mindMapUserNodes = Array.isArray(s.userNodes) ? s.userNodes : [];
            mindMapUserEdits = s.userEdits || {};
            mindMapCustomConnections = Array.isArray(s.customConnections) ? s.customConnections : [];
            mindMapHiddenConnections = Array.isArray(s.hiddenConnections) ? s.hiddenConnections : [];
            renderMindMapNodes(currentMindMapData, true);
            scheduleMindMapAutoSave();
        }

        function mmUndo() {
            if (!mindMapUndoStack.length) return;
            mindMapRedoStack.push(mmCaptureState());
            mmRestoreState(mindMapUndoStack.pop());
            mmUpdateUndoButtons();
        }

        function mmRedo() {
            if (!mindMapRedoStack.length) return;
            mindMapUndoStack.push(mmCaptureState());
            mmRestoreState(mindMapRedoStack.pop());
            mmUpdateUndoButtons();
        }

        function mmUpdateUndoButtons() {
            const undo = docQs('#crm-mindmap-undo-btn');
            const redo = docQs('#crm-mindmap-redo-btn');
            if (undo) undo.disabled = !mindMapUndoStack.length;
            if (redo) redo.disabled = !mindMapRedoStack.length;
        }

        function changeNodeShape(nodeId, shape) {
            if (!mindMapUserEdits[nodeId]) mindMapUserEdits[nodeId] = {};
            mindMapUserEdits[nodeId].shape = shape === 'default' ? undefined : shape;
            const canvas = docQs('#crm-mindmap-canvas');
            const node = canvas?.querySelector(`[data-node-id="${nodeId}"]`);
            if (node) {
                node.classList.remove('shape-rounded', 'shape-pill', 'shape-circle');
                if (shape && shape !== 'default') node.classList.add(`shape-${shape}`);
            }
            rebuildSVGPaths();
            scheduleMindMapAutoSave();
        }

        function scheduleMindMapAutoSave() {
            mindMapDirty = true;
            updateSaveStatus('unsaved');
            if (mindMapSaveTimeout) clearTimeout(mindMapSaveTimeout);
            mindMapSaveTimeout = setTimeout(() => saveMindMapEdits(), 2000);
        }

        async function saveMindMapEdits() {
            if (!mindMapDirty || !selectedBookId) return;
            if (mindMapActiveMapId !== 'default') {
                mindMapDirty = false;
                saveMapState(selectedBookId, mindMapActiveMapId);
                updateSaveStatus('saved');
                return;
            }
            updateSaveStatus('saving');
            try {
                await apiPatch(`/api/admin/books/${selectedBookId}/mind-map`, {
                    positions: mindMapPositions,
                    userNodes: mindMapUserNodes,
                    userEdits: mindMapUserEdits,
                    customConnections: mindMapCustomConnections,
                    hiddenConnections: mindMapHiddenConnections
                });
                mindMapDirty = false;
                updateSaveStatus('saved');
                saveMapState(selectedBookId, mindMapActiveMapId);
            } catch (err) {
                console.error('Failed to save mind map edits:', err);
                updateSaveStatus('error');
            }
        }

        function applyNotesIndicators() {
            const canvas = docQs('#crm-mindmap-canvas');
            if (!canvas) return;
            canvas.querySelectorAll('.crm-mindmap-node[data-node-id]').forEach(node => {
                const nid = node.dataset.nodeId;
                const hasNotes = mindMapUserEdits[nid]?.notes?.trim();
                node.classList.toggle('has-notes', !!hasNotes);
            });
        }

        function getAnchorHtml() {
            return '<div class="crm-mindmap-anchors">' +
                '<div class="crm-mindmap-anchor" data-anchor="top"></div>' +
                '<div class="crm-mindmap-anchor" data-anchor="right"></div>' +
                '<div class="crm-mindmap-anchor" data-anchor="bottom"></div>' +
                '<div class="crm-mindmap-anchor" data-anchor="left"></div>' +
                '</div>';
        }

        function getAnchorPoint(nodeEl, side) {
            const left = parseFloat(nodeEl.style.left) || 0;
            const top = parseFloat(nodeEl.style.top) || 0;
            const w = nodeEl.offsetWidth || 200;
            const h = nodeEl.offsetHeight || 50;
            if (side === 'top') return { x: left + w / 2, y: top };
            if (side === 'bottom') return { x: left + w / 2, y: top + h };
            if (side === 'left') return { x: left, y: top + h / 2 };
            if (side === 'right') return { x: left + w, y: top + h / 2 };
            return { x: left + w / 2, y: top + h / 2 };
        }

        function findClosestAnchor(nodeEl, targetPt) {
            const sides = ['top', 'right', 'bottom', 'left'];
            let best = 'right', bestDist = Infinity;
            sides.forEach(s => {
                const p = getAnchorPoint(nodeEl, s);
                const d = Math.hypot(p.x - targetPt.x, p.y - targetPt.y);
                if (d < bestDist) { bestDist = d; best = s; }
            });
            return best;
        }

        function addCustomConnection(fromId, fromAnchor, toId, toAnchor) {
            const exists = mindMapCustomConnections.some(c =>
                (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId));
            if (exists || fromId === toId) return;
            mmPushUndo();
            mindMapCustomConnections.push({
                id: 'conn_' + Date.now(),
                from: fromId,
                fromAnchor,
                to: toId,
                toAnchor,
                color: '#6366F1'
            });
            rebuildSVGPaths();
            scheduleMindMapAutoSave();
        }

        function removeCustomConnection(connId) {
            mmPushUndo();
            mindMapCustomConnections = mindMapCustomConnections.filter(c => c.id !== connId);
            rebuildSVGPaths();
            scheduleMindMapAutoSave();
        }

        function getShapeClass(nodeId) {
            const shape = mindMapUserEdits[nodeId]?.shape;
            return shape ? ` shape-${shape}` : '';
        }

        function getNodeWidth(nodeId, defaultW) {
            return mindMapUserEdits[nodeId]?.width || defaultW;
        }

        function getResizeHandleHtml() {
            return '<div class="crm-mindmap-resize-handle"></div>';
        }

        function renderMindMapNodes(data, preserveTransform = false) {
            const canvas = docQs('#crm-mindmap-canvas');
            const svg = docQs('#crm-mindmap-svg');
            if (!canvas || !svg) return;

            const categories = Array.isArray(data.categories) ? data.categories : [];
            const centralTitle = data.centralTopic || 'Mind Map';

            const canvasWidth = 3000;
            const canvasHeight = 2000;
            const centerX = canvasWidth / 2;
            const centerY = canvasHeight / 2;

            canvas.style.width = `${canvasWidth}px`;
            canvas.style.height = `${canvasHeight}px`;
            svg.setAttribute('width', canvasWidth);
            svg.setAttribute('height', canvasHeight);

            let canvasHtml = '';
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            const centralW = 340;
            const centralEstH = 80;
            let centralLeft = centerX - centralW / 2;
            let centralTop = centerY - centralEstH / 2;
            if (mindMapPositions['central']) {
                centralLeft = mindMapPositions['central'].x;
                centralTop = mindMapPositions['central'].y;
            }

            canvasHtml += `<div class="crm-mindmap-node central${getShapeClass('central')}" data-node-id="central" style="left:${centralLeft}px; top:${centralTop}px; width:${centralW}px; max-width:${centralW}px;"><div class="crm-mindmap-node-title">${escapeHtml(mindMapUserEdits['central']?.title || centralTitle)}</div>${getAnchorHtml()}${getResizeHandleHtml()}</div>`;
            minX = Math.min(minX, centralLeft); minY = Math.min(minY, centralTop);
            maxX = Math.max(maxX, centralLeft + centralW); maxY = Math.max(maxY, centralTop + centralEstH);

            const numCats = categories.length;
            const radiusCat = 480;

            categories.forEach((cat, cIdx) => {
                const catId = cat.id || `cat_${cIdx}`;
                const catColor = mindMapUserEdits[catId]?.color || cat.color || '#4f46e5';
                const angle = (cIdx * 2 * Math.PI / Math.max(1, numCats)) - (Math.PI / 2);
                const defaultCatX = centerX + radiusCat * Math.cos(angle);
                const defaultCatY = centerY + radiusCat * Math.sin(angle);

                const catW = 200;
                const catEstH = 50;
                let catLeft = defaultCatX - catW / 2;
                let catTop = defaultCatY - catEstH / 2;
                if (mindMapPositions[catId]) {
                    catLeft = mindMapPositions[catId].x;
                    catTop = mindMapPositions[catId].y;
                }

                minX = Math.min(minX, catLeft); minY = Math.min(minY, catTop);
                maxX = Math.max(maxX, catLeft + catW); maxY = Math.max(maxY, catTop + catEstH);

                const catTitle = mindMapUserEdits[catId]?.title || cat.title || 'Category';
                const isCollapsed = mindMapCollapsedCategories.has(catId);
                const subtopics = Array.isArray(cat.subtopics) ? cat.subtopics : [];
                
                let collapseBtnHtml = `<button class="crm-mindmap-collapse-btn" data-cat-id="${escapeHtml(catId)}">${isCollapsed ? '+' : '−'}</button>`;
                let collapseBadgeHtml = (isCollapsed && subtopics.length > 0) ? `<div class="crm-mindmap-collapse-badge">+${subtopics.length}</div>` : '';

                const isDark = document.querySelector('.crm-books-mindmap-modal')?.classList.contains('books-dark');
                const catTintOpacity = isDark ? '0A' : '08';
                const catTintOpacity2 = isDark ? '05' : '03';
                const catNodeW = getNodeWidth(catId, catW);
                canvasHtml += `<div class="crm-mindmap-node category${getShapeClass(catId)}" data-node-id="${escapeHtml(catId)}" data-cat-id="${escapeHtml(catId)}" data-title="${escapeHtml(catTitle)}" data-summary="${escapeHtml(cat.summary || '')}" data-fulltext="${escapeHtml(cat.summary || cat.title || '')}" style="left:${catLeft}px; top:${catTop}px; width:${catNodeW}px; --node-color:${catColor}; background: linear-gradient(135deg, ${catColor}${catTintOpacity}, ${catColor}${catTintOpacity2});">` +
                    collapseBtnHtml + collapseBadgeHtml +
                    `<div class="crm-mindmap-node-title">${escapeHtml(catTitle)}</div>` +
                    getTagsHtml(catId) +
                    getVoteBadgeHtml(catId) + getReactionBadgeHtml(catId) + getCommentBadgeHtml(catId) +
                    getAnchorHtml() + getResizeHandleHtml() +
                    `</div>`;

                const numSubs = subtopics.length;
                const radiusSub = 350;
                const angleStep = 2 * Math.PI / Math.max(1, numCats);
                const maxArcSpan = Math.min(angleStep * 0.75, Math.PI);
                const arcSpan = Math.min(maxArcSpan, 0.35 * numSubs);

                if (!isCollapsed) {
                    subtopics.forEach((sub, sIdx) => {
                        const subId = sub.id || `sub_${cIdx}_${sIdx}`;
                        const subColor = mindMapUserEdits[subId]?.color || catColor;
                        const subAngle = angle + (numSubs > 1 ? (-arcSpan / 2 + sIdx * (arcSpan / (numSubs - 1))) : 0);
                        const defaultSubX = (mindMapPositions[catId] ? mindMapPositions[catId].x + catW / 2 : defaultCatX) + radiusSub * Math.cos(subAngle);
                        const defaultSubY = (mindMapPositions[catId] ? mindMapPositions[catId].y + catEstH / 2 : defaultCatY) + radiusSub * Math.sin(subAngle);

                        const subW = 220;
                        const subEstH = 80;
                        let subLeft = defaultSubX - subW / 2;
                        let subTop = defaultSubY - subEstH / 2;
                        if (mindMapPositions[subId]) {
                            subLeft = mindMapPositions[subId].x;
                            subTop = mindMapPositions[subId].y;
                        }

                        minX = Math.min(minX, subLeft); minY = Math.min(minY, subTop);
                        maxX = Math.max(maxX, subLeft + subW); maxY = Math.max(maxY, subTop + subEstH);

                        const subTitle = mindMapUserEdits[subId]?.title || sub.title || 'Subtopic';
                        const subTintOpacity = isDark ? '08' : '06';
                        const subTintOpacity2 = isDark ? '04' : '02';
                        const subNodeW = getNodeWidth(subId, subW);
                        canvasHtml += `<div class="crm-mindmap-node subtopic${getShapeClass(subId)}" data-node-id="${escapeHtml(subId)}" data-sub-id="${escapeHtml(subId)}" data-cat-title="${escapeHtml(catTitle)}" data-cat-color="${subColor}" data-title="${escapeHtml(subTitle)}" data-summary="${escapeHtml(sub.summary || '')}" data-fulltext="${escapeHtml(sub.fullText || '')}" style="left:${subLeft}px; top:${subTop}px; width:${subNodeW}px; --node-color:${subColor}; background: linear-gradient(135deg, ${subColor}${subTintOpacity}, ${subColor}${subTintOpacity2});">` +
                            `<div class="crm-mindmap-node-title">${escapeHtml(subTitle)}</div>` +
                            `<div class="crm-mindmap-node-summary">${escapeHtml(sub.summary || '')}</div>` +
                            getTagsHtml(subId) +
                            getVoteBadgeHtml(subId) + getReactionBadgeHtml(subId) + getCommentBadgeHtml(subId) +
                            getAnchorHtml() + getResizeHandleHtml() +
                            `</div>`;
                    });
                }
            });

            mindMapUserNodes.forEach(un => {
                const unColor = un.color || '#F59E0B';
                const unW = 200;
                const unEstH = 60;
                const unLeft = un.x ?? (centerX - unW / 2);
                const unTop = un.y ?? (centerY + 200);
                minX = Math.min(minX, unLeft); minY = Math.min(minY, unTop);
                maxX = Math.max(maxX, unLeft + unW); maxY = Math.max(maxY, unTop + unEstH);

                const unNodeW = getNodeWidth(un.id, unW);
                canvasHtml += `<div class="crm-mindmap-node user-node${getShapeClass(un.id)}" data-node-id="${escapeHtml(un.id)}" data-title="${escapeHtml(un.title || '')}" data-summary="${escapeHtml(un.text || '')}" data-fulltext="${escapeHtml(un.text || '')}" data-cat-title="Your Note" data-cat-color="${unColor}" style="left:${unLeft}px; top:${unTop}px; width:${unNodeW}px; --node-color:${unColor};">` +
                    `<div class="crm-mindmap-node-title">${escapeHtml(un.title || 'New thought')}</div>` +
                    (un.text ? `<div class="crm-mindmap-node-summary">${escapeHtml(un.text)}</div>` : '') +
                    getTagsHtml(un.id) +
                    getVoteBadgeHtml(un.id) + getReactionBadgeHtml(un.id) + getCommentBadgeHtml(un.id) +
                    getBadgeHtml(un.createdBy) +
                    getAnchorHtml() + getResizeHandleHtml() +
                    `</div>`;
            });

            canvas.innerHTML = canvasHtml;
            
            canvas.querySelectorAll('.crm-mindmap-collapse-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const catId = e.target.dataset.catId;
                    if (mindMapCollapsedCategories.has(catId)) {
                        mindMapCollapsedCategories.delete(catId);
                    } else {
                        mindMapCollapsedCategories.add(catId);
                    }
                    renderMindMapNodes(currentMindMapData, true);
                });
            });

            // Branch highlighting on hover
            canvas.querySelectorAll('.crm-mindmap-node').forEach(node => {
                node.addEventListener('mouseenter', () => highlightBranch(node.dataset.nodeId));
                node.addEventListener('mouseleave', clearBranchHighlight);
            });

            // Staggered entrance animations (only on first render, not drag/collapse re-renders)
            if (!preserveTransform) {
                const allNodes = canvas.querySelectorAll('.crm-mindmap-node');
                allNodes.forEach((node, i) => {
                    node.classList.add('mm-entering');
                    const isCentral = node.classList.contains('central');
                    const isCat = node.classList.contains('category');
                    const baseDelay = isCentral ? 0 : (isCat ? 80 : 160);
                    node.style.animationDelay = `${baseDelay + i * 40}ms`;
                    node.addEventListener('animationend', () => {
                        node.classList.remove('mm-entering');
                        node.style.animationDelay = '';
                    }, { once: true });
                });
            }

            rebuildSVGPaths();
            applyNotesIndicators();
            updateNodeDimming();
            if (heatmapEnabled) applyHeatmapOverlay();
            if (typeof renderOutlineTree === 'function') renderOutlineTree();
            if (typeof updateMinimap === 'function') updateMinimap();

            if (!preserveTransform) {
                const viewport = docQs('#crm-mindmap-viewport');
                const vw = viewport ? viewport.clientWidth : window.innerWidth;
                const vh = viewport ? viewport.clientHeight : window.innerHeight;
                const margin = 80;

                if (minX === Infinity) { minX = 0; minY = 0; maxX = canvasWidth; maxY = canvasHeight; }
                const contentW = maxX - minX;
                const contentH = maxY - minY;
                const contentCenterX = minX + contentW / 2;
                const contentCenterY = minY + contentH / 2;

                mindMapZoom = Math.max(0.3, Math.min(
                    (vw - 2 * margin) / contentW,
                    (vh - 2 * margin) / contentH,
                    1.2
                ));
                mindMapPanX = (vw / 2) - (contentCenterX * mindMapZoom);
                mindMapPanY = (vh / 2) - (contentCenterY * mindMapZoom);
            }
            applyMindMapTransform();
        }

        function handleNodeClick(nodeId) {
            const canvas = docQs('#crm-mindmap-canvas');
            const inspector = docQs('#crm-mindmap-inspector');
            if (!canvas || !inspector) return;

            const node = canvas.querySelector(`[data-node-id="${nodeId}"]`);
            if (!node) return;
            if (node.classList.contains('central')) return;

            const catTitle = node.dataset.catTitle || node.dataset.title || 'Category';
            const catColor = node.dataset.catColor || node.style.getPropertyValue('--node-color') || '#4f46e5';
            const title = mindMapUserEdits[nodeId]?.title || node.dataset.title || 'Node';
            const summary = node.dataset.summary || '';
            const fullText = node.dataset.fulltext || summary || 'No additional note content.';

            const tagEl = docQs('#crm-mindmap-inspector-tag');
            const titleEl = docQs('#crm-mindmap-inspector-title');
            const summaryEl = docQs('#crm-mindmap-inspector-summary');
            const fullTextEl = docQs('#crm-mindmap-inspector-fulltext');
            const notesEl = docQs('#crm-mindmap-inspector-notes');
            const attrEl = docQs('#crm-mindmap-inspector-attribution');
            const tagsEl = docQs('#crm-mindmap-inspector-tags');
            const sourcesEl = docQs('#crm-mindmap-inspector-sources');

            if (tagEl) { tagEl.textContent = catTitle; tagEl.style.setProperty('--node-color', catColor); }
            if (titleEl) titleEl.textContent = title;
            if (summaryEl) summaryEl.textContent = summary;
            if (fullTextEl) {
                if (typeof formatStudyNotesMarkdown === 'function') {
                    fullTextEl.innerHTML = formatStudyNotesMarkdown(fullText);
                } else {
                    fullTextEl.textContent = fullText;
                }
            }
            if (notesEl) {
                notesEl.value = mindMapUserEdits[nodeId]?.notes || '';
                notesEl.dataset.nodeId = nodeId;
            }

            if (attrEl) {
                const userNode = mindMapUserNodes.find(u => u.id === nodeId);
                const createdBy = userNode?.createdBy || mindMapUserEdits[nodeId]?.editedBy;
                if (createdBy) {
                    const member = getTeamMembers().find(m => m.id === createdBy);
                    if (member) {
                        attrEl.innerHTML = `${member.emoji} <strong>${escapeHtml(member.name)}</strong>`;
                    } else {
                        attrEl.innerHTML = '';
                    }
                } else {
                    attrEl.innerHTML = '';
                }
            }

            if (tagsEl) {
                tagsEl.innerHTML = getTagsHtml(nodeId);
            }

            if (sourcesEl) {
                const noteIds = getNodeNoteIds(nodeId);
                const citations = getNodeCitations(nodeId);
                const hasInsufficientEvidence = nodeHasInsufficientEvidence(nodeId);
                sourcesEl.innerHTML = '';
                const sectionEl = sourcesEl.closest('.crm-mindmap-inspector-section');
                if (citations.length > 0) {
                    if (sectionEl) sectionEl.style.display = 'block';
                    try {
                        const allNotes = loadBookNotes(selectedBookId);
                        let html = '';
                        let matchCount = 0;
                        let invalidCitationCount = 0;
                        const seen = new Set();
                        citations.forEach((citation, citationIndex) => {
                            const nid = String(citation?.noteId || '');
                            const quote = String(citation?.quote || '').trim();
                            const note = allNotes.find(n => n.id === nid || n.firestoreId === nid || n.id === 'fs_' + nid);
                            const sourceText = note?.text || '';
                            const quoteMatchesSource = typeof normalizeCitationText === 'function'
                                && quote
                                && normalizeCitationText(sourceText).includes(normalizeCitationText(quote));
                            const citationKey = `${note?.id || nid}\n${typeof normalizeCitationText === 'function' ? normalizeCitationText(quote) : quote.toLowerCase()}`;
                            if (note && quoteMatchesSource && !seen.has(citationKey)) {
                                seen.add(citationKey);
                                matchCount++;
                                const extracted = typeof extractNoteTitle === 'function' ? extractNoteTitle(note.text) : { title: 'Note' };
                                const title = extracted?.title || 'Note';
                                const dateStr = note.savedAt ? new Date(note.savedAt).toLocaleString([], {month:'short', day:'numeric', year:'numeric'}) : '';
                                const noteText = note.text || '';
                                html += `<button type="button" class="crm-mindmap-source-ref" data-note-text="${escapeHtml(noteText)}" data-note-title="${escapeHtml(title)}" data-note-date="${escapeHtml(dateStr)}" data-citation-quote="${escapeHtml(quote)}">` +
                                  `<span class="crm-source-ref-meta">` +
                                    `<span class="crm-source-ref-icon">📖</span>` +
                                    `<span class="crm-source-ref-title">${escapeHtml(title)}</span>` +
                                    `<span class="crm-source-ref-date">${escapeHtml(dateStr)}</span>` +
                                    `<span class="crm-source-ref-read">Read cited note</span>` +
                                  `</span>` +
                                  `<span class="crm-source-ref-citation" data-citation-number="${citationIndex + 1}">“${escapeHtml(quote)}”</span>` +
                                `</button>`;
                            } else if (!note || !quoteMatchesSource) {
                                invalidCitationCount++;
                            }
                        });
                        if (matchCount === 0) html = '<div class="crm-mindmap-source-empty">Insufficient evidence — no verified source passage was found for this thought.</div>';
                        if (matchCount > 0 && (hasInsufficientEvidence || invalidCitationCount > 0)) html += '<div class="crm-mindmap-source-empty">Insufficient evidence — one or more related thoughts have no verified source passage.</div>';
                        sourcesEl.innerHTML = html;
                        sourcesEl.querySelectorAll('.crm-mindmap-source-ref').forEach(el => {
                            el.addEventListener('click', () => {
                                openSourceNoteReader(el.dataset.noteTitle || 'Source Note', el.dataset.noteDate || '', el.dataset.noteText || '', el.dataset.citationQuote || '');
                            });
                        });
                    } catch (err) {
                        console.error('Failed to load source notes:', err);
                    }
                } else if (hasInsufficientEvidence || noteIds.length > 0) {
                    if (sectionEl) sectionEl.style.display = 'block';
                    sourcesEl.innerHTML = '<div class="crm-mindmap-source-empty">Insufficient evidence — no verified source passage was found for this thought.</div>';
                } else {
                    if (sectionEl) sectionEl.style.display = 'block';
                    sourcesEl.innerHTML = '<div class="crm-mindmap-source-empty">No source notes linked to this node.</div>';
                }
            }

            inspector.dataset.activeNodeId = nodeId;
            renderInspectorReactions(nodeId);
            renderInspectorComments(nodeId);
            renderInspectorVotes(nodeId);
            inspector.style.display = 'flex';
        }

        function openSourceNoteReader(title, dateStr, rawText, citationQuote = '') {
            let overlay = docQs('#crm-mindmap-reader-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'crm-mindmap-reader-overlay';
                overlay.className = 'crm-mindmap-reader-overlay';
                overlay.innerHTML = `
                    <div class="crm-mindmap-reader-card">
                        <div class="crm-mindmap-reader-header">
                            <div>
                                <h3 class="crm-mindmap-reader-title"></h3>
                                <span class="crm-mindmap-reader-date"></span>
                            </div>
                            <button class="crm-mindmap-reader-close" aria-label="Close">&times;</button>
                        </div>
                        <div class="crm-mindmap-reader-citation" style="display:none;"></div>
                        <div class="crm-mindmap-reader-body"></div>
                    </div>`;
                const modal = docQs('#crm-books-mindmap-modal');
                if (modal) modal.appendChild(overlay);
                overlay.querySelector('.crm-mindmap-reader-close').addEventListener('click', () => {
                    overlay.style.display = 'none';
                });
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) overlay.style.display = 'none';
                });
            }
            overlay.querySelector('.crm-mindmap-reader-title').textContent = title;
            overlay.querySelector('.crm-mindmap-reader-date').textContent = dateStr;
            const citationEl = overlay.querySelector('.crm-mindmap-reader-citation');
            if (citationEl) {
                citationEl.textContent = citationQuote ? `Cited passage: “${citationQuote}”` : '';
                citationEl.style.display = citationQuote ? 'block' : 'none';
            }
            const body = overlay.querySelector('.crm-mindmap-reader-body');
            if (typeof formatStudyNotesMarkdown === 'function') {
                body.innerHTML = formatStudyNotesMarkdown(rawText);
            } else {
                body.textContent = rawText;
            }
            overlay.style.display = 'flex';
        }

        function startInlineEdit(nodeId) {
            const canvas = docQs('#crm-mindmap-canvas');
            if (!canvas) return;
            const node = canvas.querySelector(`[data-node-id="${nodeId}"]`);
            if (!node) return;
            const titleEl = node.querySelector('.crm-mindmap-node-title');
            if (!titleEl) return;

            mmPushUndo();
            titleEl.contentEditable = 'true';
            titleEl.focus();
            const range = document.createRange();
            range.selectNodeContents(titleEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            const finishEdit = () => {
                titleEl.contentEditable = 'false';
                const newText = titleEl.textContent.trim() || 'Untitled';
                titleEl.textContent = newText;
                node.dataset.title = newText;

                const userNode = mindMapUserNodes.find(u => u.id === nodeId);
                if (userNode) {
                    userNode.title = newText;
                } else {
                    if (!mindMapUserEdits[nodeId]) mindMapUserEdits[nodeId] = {};
                    mindMapUserEdits[nodeId].title = newText;
                }
                scheduleMindMapAutoSave();
                if (typeof renderOutlineTree === 'function') renderOutlineTree();
                titleEl.removeEventListener('blur', finishEdit);
                titleEl.removeEventListener('keydown', handleKey);
            };

            const handleKey = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
                if (e.key === 'Escape') { titleEl.blur(); }
            };

            titleEl.addEventListener('blur', finishEdit);
            titleEl.addEventListener('keydown', handleKey);
        }

        function addUserNode(canvasX, canvasY, parentId) {
            mmPushUndo();
            const id = 'user_' + Date.now();
            const createdBy = getActiveTeamMember().id;
            const newNode = { id, title: 'New thought', text: '', color: '#F59E0B', x: canvasX, y: canvasY, parentId: parentId || null, createdBy };
            mindMapUserNodes.push(newNode);

            const canvas = docQs('#crm-mindmap-canvas');
            if (canvas) {
                const nodeHtml = `<div class="crm-mindmap-node user-node${getShapeClass(id)}" data-node-id="${escapeHtml(id)}" data-title="New thought" data-summary="" data-fulltext="" data-cat-title="Your Note" data-cat-color="#F59E0B" style="left:${canvasX}px; top:${canvasY}px; width:200px; --node-color:#F59E0B;">` +
                    `<div class="crm-mindmap-node-title">New thought</div>` +
                    getAnchorHtml() +
                    getResizeHandleHtml() +
                    `</div>`;
                canvas.insertAdjacentHTML('beforeend', nodeHtml);
                const newNodeEl = canvas.querySelector(`[data-node-id="${newNode.id}"]`);
                if (newNodeEl) newNodeEl.classList.add('mm-pop-in');
                rebuildSVGPaths();
                if (typeof renderOutlineTree === 'function') renderOutlineTree();
                scheduleMindMapAutoSave();
                setTimeout(() => startInlineEdit(id), 50);
            }
        }

        function deleteUserNode(nodeId) {
            const idx = mindMapUserNodes.findIndex(u => u.id === nodeId);
            if (idx === -1) return;
            mmPushUndo();
            mindMapUserNodes.splice(idx, 1);
            mindMapCustomConnections = mindMapCustomConnections.filter(c => c.from !== nodeId && c.to !== nodeId);
            delete mindMapPositions[nodeId];
            delete mindMapUserEdits[nodeId];
            const canvas = docQs('#crm-mindmap-canvas');
            const node = canvas?.querySelector(`[data-node-id="${nodeId}"]`);
            if (node) node.remove();
            rebuildSVGPaths();
            if (typeof renderOutlineTree === 'function') renderOutlineTree();
            scheduleMindMapAutoSave();
        }

        function changeNodeColor(nodeId, color) {
            mmPushUndo();
            const canvas = docQs('#crm-mindmap-canvas');
            const node = canvas?.querySelector(`[data-node-id="${nodeId}"]`);
            if (node) {
                node.style.setProperty('--node-color', color);
                node.dataset.catColor = color;
            }
            const userNode = mindMapUserNodes.find(u => u.id === nodeId);
            if (userNode) {
                userNode.color = color;
            } else {
                if (!mindMapUserEdits[nodeId]) mindMapUserEdits[nodeId] = {};
                mindMapUserEdits[nodeId].color = color;
            }
            rebuildSVGPaths();
            if (typeof renderOutlineTree === 'function') renderOutlineTree();
            scheduleMindMapAutoSave();
        }

        function showContextMenu(nodeId, clientX, clientY) {
            mindMapContextNodeId = nodeId;
            const menu = docQs('#crm-mindmap-context-menu');
            if (!menu) return;

            const isUserNode = mindMapUserNodes.some(u => u.id === nodeId);
            const deleteBtn = menu.querySelector('[data-action="delete-node"]');
            if (deleteBtn) deleteBtn.style.display = isUserNode ? '' : 'none';

            const tagBtns = menu.querySelectorAll('.crm-mindmap-tag-option');
            const currentTags = mindMapUserEdits[nodeId]?.tags || [];
            tagBtns.forEach(btn => {
                if (currentTags.includes(btn.dataset.tag)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            const currentShape = mindMapUserEdits[nodeId]?.shape || 'default';
            const shapeBtns = menu.querySelectorAll('.crm-mindmap-shape-option');
            shapeBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.shape === currentShape);
            });

            menu.style.left = clientX + 'px';
            menu.style.top = clientY + 'px';
            menu.style.display = 'block';
        }

        function hideContextMenu() {
            const menu = docQs('#crm-mindmap-context-menu');
            if (menu) menu.style.display = 'none';
            mindMapContextNodeId = null;
            hideConnectionContextMenu();
        }

        function showConnectionContextMenu(clientX, clientY, connId, connType) {
            hideContextMenu();
            let menu = docQs('#crm-mindmap-conn-context');
            if (!menu) {
                menu = document.createElement('div');
                menu.id = 'crm-mindmap-conn-context';
                menu.className = 'crm-mindmap-conn-context';
                const viewport = docQs('#crm-mindmap-viewport');
                if (viewport) viewport.appendChild(menu);
                menu.addEventListener('click', (e) => {
                    const action = e.target.closest('[data-action]')?.dataset.action;
                    const id = menu.dataset.connId;
                    const type = menu.dataset.connType;
                    if (action === 'delete' && id) {
                        if (type === 'custom') {
                            removeCustomConnection(id);
                        } else {
                            mmPushUndo();
                            if (!mindMapHiddenConnections) mindMapHiddenConnections = [];
                            mindMapHiddenConnections.push(id);
                            rebuildSVGPaths();
                            scheduleMindMapAutoSave?.();
                        }
                    }
                    hideConnectionContextMenu();
                });
            }
            menu.innerHTML = `<button class="crm-mindmap-conn-ctx-btn" data-action="delete">${connType === 'custom' ? '🗑️ Remove connection' : '👁️ Hide connection'}</button>`;
            menu.dataset.connId = connId;
            menu.dataset.connType = connType || 'structural';
            menu.style.left = clientX + 'px';
            menu.style.top = clientY + 'px';
            menu.style.display = 'block';
        }

        function hideConnectionContextMenu() {
            const menu = docQs('#crm-mindmap-conn-context');
            if (menu) menu.style.display = 'none';
        }

        function updateMinimap() {
            const canvas = docQs('#crm-mindmap-minimap-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const nodes = docQs('#crm-mindmap-canvas')?.querySelectorAll('.crm-mindmap-node');
            if (!nodes || nodes.length === 0) return;
            
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const nodeData = [];
            nodes.forEach(node => {
                const left = parseFloat(node.style.left) || 0;
                const top = parseFloat(node.style.top) || 0;
                const width = parseFloat(node.style.width) || 200;
                const height = node.offsetHeight || 50;
                const color = node.style.getPropertyValue('--node-color') || '#e2e8f0';
                
                minX = Math.min(minX, left);
                minY = Math.min(minY, top);
                maxX = Math.max(maxX, left + width);
                maxY = Math.max(maxY, top + height);
                
                nodeData.push({ left, top, width, height, color });
            });
            
            minX -= 500; minY -= 500; maxX += 500; maxY += 500;
            const contentW = maxX - minX;
            const contentH = maxY - minY;
            
            const scaleX = canvas.width / contentW;
            const scaleY = canvas.height / contentH;
            const scale = Math.min(scaleX, scaleY);
            
            const offsetX = (canvas.width - contentW * scale) / 2 - minX * scale;
            const offsetY = (canvas.height - contentH * scale) / 2 - minY * scale;
            
            nodeData.forEach(n => {
                ctx.fillStyle = n.color;
                ctx.fillRect(n.left * scale + offsetX, n.top * scale + offsetY, n.width * scale, n.height * scale);
            });
            
            const viewportEl = docQs('#crm-mindmap-viewport');
            const minimapVp = docQs('#crm-mindmap-minimap-viewport');
            if (viewportEl && minimapVp) {
                const vw = viewportEl.clientWidth;
                const vh = viewportEl.clientHeight;
                
                const vpLeft = (-mindMapPanX) / mindMapZoom;
                const vpTop = (-mindMapPanY) / mindMapZoom;
                const vpWidth = vw / mindMapZoom;
                const vpHeight = vh / mindMapZoom;
                
                minimapVp.style.left = (vpLeft * scale + offsetX) + 'px';
                minimapVp.style.top = (vpTop * scale + offsetY) + 'px';
                minimapVp.style.width = (vpWidth * scale) + 'px';
                minimapVp.style.height = (vpHeight * scale) + 'px';
            }
        }

        function zoomToNode(nodeId) {
            const canvas = docQs('#crm-mindmap-canvas');
            if (!canvas) return;
            const node = canvas.querySelector(`[data-node-id="${nodeId}"]`);
            if (!node) return;
            
            const viewport = docQs('#crm-mindmap-viewport');
            if (!viewport) return;
            
            const vw = viewport.clientWidth;
            const vh = viewport.clientHeight;
            
            const left = parseFloat(node.style.left) || 0;
            const top = parseFloat(node.style.top) || 0;
            const w = parseFloat(node.style.width) || 200;
            const h = 100;
            
            const targetZoom = 1.0;
            const targetPanX = (vw / 2) - ((left + w / 2) * targetZoom);
            const targetPanY = (vh / 2) - ((top + h / 2) * targetZoom);
            
            const startZoom = mindMapZoom;
            const startPanX = mindMapPanX;
            const startPanY = mindMapPanY;
            const duration = 400;
            let start = null;
            
            function step(timestamp) {
                if (!start) start = timestamp;
                const progress = Math.min((timestamp - start) / duration, 1);
                const ease = 1 - Math.pow(1 - progress, 3);
                
                mindMapZoom = startZoom + (targetZoom - startZoom) * ease;
                mindMapPanX = startPanX + (targetPanX - startPanX) * ease;
                mindMapPanY = startPanY + (targetPanY - startPanY) * ease;
                
                applyMindMapTransform();
                
                if (progress < 1) {
                    requestAnimationFrame(step);
                }
            }
            requestAnimationFrame(step);
            
            const tEl = node.querySelector('.crm-mindmap-node-title');
            if (tEl) {
                tEl.style.transition = 'color 0.3s';
                tEl.style.color = '#3B82F6';
                setTimeout(() => { tEl.style.color = ''; }, 1000);
            }
        }

        function renderOutlineTree() {
            const tree = docQs('#crm-mindmap-outline-tree');
            const panel = docQs('#crm-mindmap-outline');
            if (!tree || !currentMindMapData) return;
            if (panel && panel.style.display === 'none') return;
            
            let html = '';
            
            const renderItem = (id, title, color) => {
                const tagsHtml = getTagsHtml(id);
                return `<div class="crm-outline-item" data-node-id="${escapeHtml(id)}">
                  <span class="crm-outline-color" style="background:${color}"></span>
                  <span class="crm-outline-title">${escapeHtml(title)}</span>
                  <div class="crm-outline-tags">${tagsHtml}</div>
                </div>`;
            };

            const categories = currentMindMapData.categories || [];
            categories.forEach(cat => {
                const catId = cat.id;
                const catTitle = mindMapUserEdits[catId]?.title || cat.title || 'Category';
                const catColor = mindMapUserEdits[catId]?.color || cat.color || '#4f46e5';
                const subs = cat.subtopics || [];
                
                const isOpen = !mindMapCollapsedCategories.has(catId);
                
                html += `<div class="crm-outline-category">
                  <div class="crm-outline-category-header" data-node-id="${escapeHtml(catId)}">
                    <span class="crm-outline-toggle ${isOpen ? 'is-open' : ''}">▸</span>
                    <span class="crm-outline-color" style="background:${catColor}"></span>
                    <span class="crm-outline-title">${escapeHtml(catTitle)}</span>
                    <span class="crm-outline-count">${subs.length} subtopics</span>
                  </div>
                  <div class="crm-outline-children ${isOpen ? 'is-open' : ''}">`;
                  
                subs.forEach(sub => {
                    const subId = sub.id;
                    const subTitle = mindMapUserEdits[subId]?.title || sub.title || 'Subtopic';
                    const subColor = mindMapUserEdits[subId]?.color || catColor;
                    html += renderItem(subId, subTitle, subColor);
                });
                html += `</div></div>`;
            });
            
            if (mindMapUserNodes.length > 0) {
                html += `<div class="crm-outline-category">
                  <div class="crm-outline-category-header" data-node-id="user_nodes_cat">
                    <span class="crm-outline-toggle is-open">▸</span>
                    <span class="crm-outline-color" style="background:#F59E0B"></span>
                    <span class="crm-outline-title">Custom Notes</span>
                    <span class="crm-outline-count">${mindMapUserNodes.length} notes</span>
                  </div>
                  <div class="crm-outline-children is-open">`;
                mindMapUserNodes.forEach(un => {
                    html += renderItem(un.id, un.title || 'New thought', un.color || '#F59E0B');
                });
                html += `</div></div>`;
            }
            
            tree.innerHTML = html;
        }

        function bindMindMapModalEvents() {
            if (mindMapEventsBound) return;
            mindMapEventsBound = true;

            const modal = docQs('#crm-books-mindmap-modal');
            const viewport = docQs('#crm-mindmap-viewport');
            const closeBtn = docQs('#crm-mindmap-close-btn');
            const regenBtn = docQs('#crm-mindmap-regenerate-btn');
            const zoomInBtn = docQs('#crm-mindmap-zoom-in');
            const zoomOutBtn = docQs('#crm-mindmap-zoom-out');
            const zoomResetBtn = docQs('#crm-mindmap-zoom-reset');
            const inspector = docQs('#crm-mindmap-inspector');
            const inspectorClose = docQs('#crm-mindmap-inspector-close');
            const contextMenu = docQs('#crm-mindmap-context-menu');
            const addNodeBtn = docQs('#crm-mindmap-add-node-btn');
            
            // Outline View binding
            // Physics toggle
            const physicsBtn = docQs('#crm-mindmap-physics-btn');
            physicsBtn?.addEventListener('click', togglePhysics);

            // Heatmap toggle
            const heatmapBtn = docQs('#crm-mindmap-heatmap-btn');
            heatmapBtn?.addEventListener('click', toggleHeatmap);

            // Share mind map
            const shareBtn = docQs('#crm-mindmap-share-btn');
            shareBtn?.addEventListener('click', shareMindMap);

            // Inspector reactions click
            const inspectorEl = docQs('#crm-mindmap-inspector');
            inspectorEl?.addEventListener('click', (e) => {
                const reactionBtn = e.target.closest('.crm-mindmap-reaction-btn');
                if (reactionBtn) {
                    const nodeId = reactionBtn.dataset.nodeId;
                    const reactionId = reactionBtn.dataset.reaction;
                    if (nodeId && reactionId) {
                        toggleReaction(nodeId, reactionId);
                        renderInspectorReactions(nodeId);
                        renderMindMapNodes(currentMindMapData, true);
                    }
                    return;
                }
                const voteBtn = e.target.closest('.crm-mindmap-vote-btn');
                if (voteBtn) {
                    const nodeId = voteBtn.dataset.nodeId;
                    const direction = voteBtn.dataset.vote;
                    if (nodeId && direction) {
                        if (direction === 'up') upvoteNode(nodeId);
                        else downvoteNode(nodeId);
                        renderInspectorVotes(nodeId);
                        renderMindMapNodes(currentMindMapData, true);
                    }
                    return;
                }
                const commentDel = e.target.closest('.crm-mindmap-comment-delete');
                if (commentDel) {
                    const nodeId = commentDel.dataset.nodeId;
                    const commentId = commentDel.dataset.commentId;
                    if (nodeId && commentId) {
                        deleteNodeComment(nodeId, commentId);
                        renderInspectorComments(nodeId);
                        renderMindMapNodes(currentMindMapData, true);
                    }
                    return;
                }
            });

            // Comment post button
            const commentSendBtn = docQs('#crm-mindmap-comment-send');
            commentSendBtn?.addEventListener('click', () => {
                const input = docQs('#crm-mindmap-comment-input');
                const inspector = docQs('#crm-mindmap-inspector');
                if (!input || !inspector) return;
                const nodeId = inspector.dataset.activeNodeId;
                if (!nodeId) return;
                addNodeComment(nodeId, input.value);
                input.value = '';
                renderInspectorComments(nodeId);
                renderMindMapNodes(currentMindMapData, true);
            });

            const outlineBtn = docQs('#crm-mindmap-outline-btn');
            const outlinePanel = docQs('#crm-mindmap-outline');
            const outlineClose = docQs('#crm-mindmap-outline-close');
            const outlineTree = docQs('#crm-mindmap-outline-tree');
            
            outlineBtn?.addEventListener('click', () => {
                if (outlinePanel) {
                    outlinePanel.style.display = outlinePanel.style.display === 'none' ? 'flex' : 'none';
                    if (outlinePanel.style.display === 'flex') {
                        renderOutlineTree();
                    }
                }
            });
            
            outlineClose?.addEventListener('click', () => {
                if (outlinePanel) outlinePanel.style.display = 'none';
            });
            
            outlineTree?.addEventListener('click', (e) => {
                const header = e.target.closest('.crm-outline-category-header');
                if (header) {
                    const catId = header.dataset.nodeId;
                    if (catId === 'user_nodes_cat') {
                        const children = header.nextElementSibling;
                        const toggle = header.querySelector('.crm-outline-toggle');
                        if (children.classList.contains('is-open')) {
                            children.classList.remove('is-open');
                            toggle.classList.remove('is-open');
                        } else {
                            children.classList.add('is-open');
                            toggle.classList.add('is-open');
                        }
                        return;
                    }
                    if (mindMapCollapsedCategories.has(catId)) {
                        mindMapCollapsedCategories.delete(catId);
                    } else {
                        mindMapCollapsedCategories.add(catId);
                    }
                    renderMindMapNodes(currentMindMapData, true);
                    return;
                }
                
                const item = e.target.closest('.crm-outline-item');
                if (item) {
                    const nodeId = item.dataset.nodeId;
                    zoomToNode(nodeId);
                    handleNodeClick(nodeId);
                }
            });
            
            // Minimap drag
            const minimap = docQs('#crm-mindmap-minimap');
            const minimapCanvas = docQs('#crm-mindmap-minimap-canvas');
            if (minimap && minimapCanvas && !minimap.dataset.bound) {
                minimap.dataset.bound = '1';
                let isDragging = false;
                const handleDrag = (e) => {
                    if (!isDragging) return;
                    const rect = minimapCanvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    
                    const nodes = docQs('#crm-mindmap-canvas')?.querySelectorAll('.crm-mindmap-node');
                    if (!nodes || nodes.length === 0) return;
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    nodes.forEach(node => {
                        const left = parseFloat(node.style.left) || 0;
                        const top = parseFloat(node.style.top) || 0;
                        const width = parseFloat(node.style.width) || 200;
                        const height = node.offsetHeight || 50;
                        minX = Math.min(minX, left); minY = Math.min(minY, top);
                        maxX = Math.max(maxX, left + width); maxY = Math.max(maxY, top + height);
                    });
                    minX -= 500; minY -= 500; maxX += 500; maxY += 500;
                    const contentW = maxX - minX;
                    const contentH = maxY - minY;
                    
                    const scaleX = minimapCanvas.width / contentW;
                    const scaleY = minimapCanvas.height / contentH;
                    const scale = Math.min(scaleX, scaleY);
                    const offsetX = (minimapCanvas.width - contentW * scale) / 2 - minX * scale;
                    const offsetY = (minimapCanvas.height - contentH * scale) / 2 - minY * scale;
                    
                    const canvasX = (x - offsetX) / scale;
                    const canvasY = (y - offsetY) / scale;
                    
                    const vp = docQs('#crm-mindmap-viewport');
                    if (vp) {
                        mindMapPanX = (vp.clientWidth / 2) - canvasX * mindMapZoom;
                        mindMapPanY = (vp.clientHeight / 2) - canvasY * mindMapZoom;
                        applyMindMapTransform();
                        updateMinimap();
                    }
                };
                minimap.addEventListener('mousedown', (e) => {
                    isDragging = true;
                    handleDrag(e);
                });
                window.addEventListener('mousemove', handleDrag);
                window.addEventListener('mouseup', () => { isDragging = false; });
            }

            // Map selector setup
            const mapBtn = docQs('#crm-mindmap-map-btn');
            const mapDropdown = docQs('#crm-mindmap-map-dropdown');
            const mapNameSpan = docQs('#crm-mindmap-map-name');
            
            if (mapBtn && mapDropdown && !mapBtn.dataset.bound) {
                mapBtn.dataset.bound = '1';
                
                const updateMapUI = () => {
                    const maps = JSON.parse(localStorage.getItem(`crm_books_maps_${selectedBookId}`) || '{"default": {"name": "Default Map"}}');
                    const currentMap = maps[mindMapActiveMapId] || { name: 'Default Map' };
                    if (mapNameSpan) mapNameSpan.textContent = currentMap.name;
                    
                    mapDropdown.innerHTML = '';
                    Object.entries(maps).forEach(([id, map]) => {
                        const btn = document.createElement('button');
                        btn.className = 'crm-mindmap-map-option' + (id === mindMapActiveMapId ? ' active' : '');
                        btn.textContent = map.name;
                        btn.onclick = async () => {
                            if (id === mindMapActiveMapId) { mapDropdown.style.display = 'none'; return; }
                            mapDropdown.style.display = 'none';
                            await switchToMap(selectedBookId, id);
                            updateMapUI();
                        };
                        mapDropdown.appendChild(btn);
                    });
                    
                    const divider = document.createElement('div');
                    divider.className = 'crm-mindmap-map-divider';
                    mapDropdown.appendChild(divider);
                    
                    const newBtn = document.createElement('button');
                    newBtn.className = 'crm-mindmap-map-option';
                    newBtn.textContent = '+ New Map';
                    newBtn.onclick = () => {
                        mapDropdown.style.display = 'none';
                        showNewMapDialog(selectedBookId, maps, updateMapUI);
                    };
                    mapDropdown.appendChild(newBtn);
                };
                
                mapBtn.onclick = (e) => {
                    e.stopPropagation();
                    updateMapUI();
                    mapDropdown.style.display = mapDropdown.style.display === 'none' ? 'block' : 'none';
                };
            }

            // Member selector setup
            const memberBtn = docQs('#crm-mindmap-member-btn');
            const memberDropdown = docQs('#crm-mindmap-member-dropdown');
            if (memberBtn && memberDropdown && !memberBtn.dataset.bound) {
                memberBtn.dataset.bound = '1';
                
                const updateMemberUI = () => {
                    const active = getActiveTeamMember();
                    const emojiEl = docQs('#crm-mindmap-member-emoji');
                    const nameEl = docQs('#crm-mindmap-member-name');
                    if (emojiEl) emojiEl.textContent = active.emoji;
                    if (nameEl) nameEl.textContent = active.name;
                    
                    memberDropdown.innerHTML = '';
                    getTeamMembers().forEach(m => {
                        const btn = document.createElement('button');
                        btn.className = 'crm-mindmap-member-option' + (m.id === active.id ? ' active' : '');
                        btn.innerHTML = `${m.emoji} ${escapeHtml(m.name)}`;
                        btn.onclick = () => {
                            setActiveTeamMember(m);
                            updateMemberUI();
                            memberDropdown.style.display = 'none';
                        };
                        memberDropdown.appendChild(btn);
                    });
                }
                updateMemberUI();
                
                memberBtn.onclick = (e) => {
                    e.stopPropagation();
                    memberDropdown.style.display = memberDropdown.style.display === 'none' ? 'block' : 'none';
                };
            }

            // Tag Filter Chips setup
            const toolbar = docQs('#crm-mindmap-toolbar');
            if (toolbar && !toolbar.dataset.filtersBound) {
                toolbar.dataset.filtersBound = '1';
                const saveStatus = docQs('#crm-mindmap-save-status');
                if (saveStatus) {
                    MINDMAP_TAGS.forEach(tag => {
                        const chip = document.createElement('button');
                        chip.className = 'crm-mindmap-filter-chip';
                        chip.innerHTML = `${tag.emoji} ${tag.label}`;
                        chip.style.setProperty('--chip-color', tag.color);
                        chip.onclick = () => {
                            if (mindMapActiveTagFilter === tag.id) {
                                mindMapActiveTagFilter = null;
                                chip.classList.remove('active');
                                chip.style.background = 'transparent';
                            } else {
                                mindMapActiveTagFilter = tag.id;
                                toolbar.querySelectorAll('.crm-mindmap-filter-chip').forEach(c => {
                                    c.classList.remove('active');
                                    c.style.background = 'transparent';
                                });
                                chip.classList.add('active');
                                chip.style.background = tag.color;
                            }
                            updateNodeDimming();
                        };
                        toolbar.insertBefore(chip, saveStatus);
                    });
                    const div = document.createElement('div');
                    div.className = 'crm-mindmap-toolbar-divider';
                    toolbar.insertBefore(div, saveStatus);
                }
            }

            closeBtn?.addEventListener('click', () => {
                if (mindMapDirty) saveMindMapEdits();
                if (modal) modal.style.display = 'none';
            });

            inspectorClose?.addEventListener('click', () => {
                if (inspector) inspector.style.display = 'none';
            });

            const notesEl = docQs('#crm-mindmap-inspector-notes');
            notesEl?.addEventListener('blur', () => {
                const nodeId = notesEl.dataset.nodeId;
                if (!nodeId) return;
                if (!mindMapUserEdits[nodeId]) mindMapUserEdits[nodeId] = {};
                mindMapUserEdits[nodeId].notes = notesEl.value;
                mindMapUserEdits[nodeId].editedBy = getActiveTeamMember().id;
                applyNotesIndicators();
                scheduleMindMapAutoSave();
            });

            regenBtn?.addEventListener('click', () => {
                if (!selectedBookId) return;

                const overlay = document.createElement('div');
                overlay.className = 'crm-mindmap-confirm-overlay';
                overlay.innerHTML = `
                  <div class="crm-mindmap-confirm-card">
                    <h3>⚡ Regenerate Mind Map?</h3>
                    <p>This will re-synthesize the map from your current saved notes. The AI structure (categories/subtopics) will be rebuilt.</p>
                    <p style="font-weight:600; color:#059669;">✓ Your custom nodes, annotations, and tags will be preserved.</p>
                    <p style="font-weight:600; color:#059669;">✓ A snapshot of the current map will be saved to History.</p>
                    <div class="crm-mindmap-confirm-actions">
                      <button class="crm-btn crm-btn-secondary" data-action="cancel">Cancel</button>
                      <button class="crm-btn crm-btn-primary" data-action="confirm">Regenerate</button>
                    </div>
                  </div>
                `;
                const modal = docQs('#crm-books-mindmap-modal');
                if (modal && modal.classList.contains('books-dark')) {
                    overlay.classList.add('books-dark');
                }
                (modal || document.body).appendChild(overlay);

                overlay.addEventListener('click', async (e) => {
                    const action = e.target.closest('button')?.dataset.action;
                    if (action === 'cancel') {
                        overlay.remove();
                    } else if (action === 'confirm') {
                        overlay.remove();
                        try {
                            const btn = docQs('#crm-mindmap-regenerate-btn');
                            if (btn) btn.disabled = true;
                            await apiPost(`/api/admin/books/${selectedBookId}/mind-map/snapshot`, { name: 'Before regeneration' });
                            await openMindMapModal(selectedBookId, true);
                        } catch (err) {
                            console.error(err);
                            alert('Failed to regenerate: ' + err.message);
                        } finally {
                            const btn = docQs('#crm-mindmap-regenerate-btn');
                            if (btn) btn.disabled = false;
                        }
                    }
                });
            });

            const searchInput = docQs('#crm-mindmap-search');
            searchInput?.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const nodes = Array.from(docQs('#crm-mindmap-canvas').querySelectorAll('.crm-mindmap-node'));
                if (!query) {
                    nodes.forEach(n => {
                        n.classList.remove('crm-mindmap-search-match');
                        n.classList.remove('crm-mindmap-search-dim');
                    });
                    return;
                }

                let matches = [];
                nodes.forEach(n => {
                    const title = (n.dataset.title || '').toLowerCase();
                    const summary = (n.dataset.summary || '').toLowerCase();
                    if (title.includes(query) || summary.includes(query)) {
                        n.classList.add('crm-mindmap-search-match');
                        n.classList.remove('crm-mindmap-search-dim');
                        matches.push(n);
                    } else {
                        n.classList.remove('crm-mindmap-search-match');
                        n.classList.add('crm-mindmap-search-dim');
                    }
                });

                if (matches.length === 1) {
                    zoomToNode(matches[0].dataset.nodeId);
                }
            });

            const historyBtn = docQs('#crm-mindmap-history-btn');
            const historyCloseBtn = docQs('#crm-mindmap-versions-close');
            
            historyBtn?.addEventListener('click', openVersionHistoryPanel);
            historyCloseBtn?.addEventListener('click', () => {
                const panel = docQs('#crm-mindmap-versions');
                if (panel) panel.style.display = 'none';
            });

            const exportBtn = docQs('#crm-mindmap-export-btn');
            const exportDropdown = docQs('#crm-mindmap-export-dropdown');
            
            exportBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (exportDropdown) {
                    exportDropdown.style.display = exportDropdown.style.display === 'none' ? 'block' : 'none';
                }
            });
            
            docQs('#crm-mindmap-export-dropdown')?.addEventListener('click', (e) => {
                const action = e.target.closest('.crm-mindmap-export-option')?.dataset.export;
                if (!action) return;
                
                if (action === 'png') {
                    exportMindMapPNG();
                } else if (action === 'markdown') {
                    exportMindMapMarkdown(false);
                } else if (action === 'clipboard') {
                    exportMindMapMarkdown(true);
                }
            });

            zoomInBtn?.addEventListener('click', () => {
                zoomMindMap(1.25);
            });

            zoomOutBtn?.addEventListener('click', () => {
                zoomMindMap(1 / 1.25);
            });

            zoomResetBtn?.addEventListener('click', () => {
                if (currentMindMapData) renderMindMapNodes(currentMindMapData);
            });

            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
                    hideContextMenu();
                    if (inspector && inspector.style.display !== 'none') {
                        inspector.style.display = 'none';
                    } else {
                        if (mindMapDirty) saveMindMapEdits();
                        modal.style.display = 'none';
                    }
                }
            });

            viewport?.addEventListener('mousedown', (e) => {
                hideContextMenu();
                if (e.button === 1) {
                    e.preventDefault();
                    return;
                }
                if (e.target.closest('#crm-mindmap-inspector') || e.target.closest('.crm-mindmap-toolbar')) return;

                const resizeHandle = e.target.closest('.crm-mindmap-resize-handle');
                if (resizeHandle && e.button === 0) {
                    const node = resizeHandle.closest('.crm-mindmap-node');
                    const nodeId = getNodeId(node);
                    if (!nodeId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    mmPushUndo();
                    mindMapResizeDrag = {
                        nodeId,
                        nodeEl: node,
                        startX: e.clientX,
                        startY: e.clientY,
                        origWidth: node.offsetWidth
                    };
                    return;
                }

                const anchor = e.target.closest('.crm-mindmap-anchor');
                if (anchor && e.button === 0) {
                    const node = anchor.closest('.crm-mindmap-node');
                    const nodeId = getNodeId(node);
                    const side = anchor.dataset.anchor;
                    if (!nodeId || !side) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const vp = docQs('#crm-mindmap-viewport');
                    const vpRect = vp ? vp.getBoundingClientRect() : { left: 0, top: 0 };
                    const anchorPt = getAnchorPoint(node, side);
                    mindMapAnchorDrag = {
                        fromId: nodeId,
                        fromAnchor: side,
                        fromNode: node,
                        startCanvasX: anchorPt.x,
                        startCanvasY: anchorPt.y,
                        vpLeft: vpRect.left,
                        vpTop: vpRect.top
                    };
                    node.classList.add('anchor-dragging');
                    const svg = docQs('#crm-mindmap-svg');
                    if (svg) {
                        let dragLine = svg.querySelector('.crm-mindmap-drag-line');
                        if (!dragLine) {
                            dragLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                            dragLine.classList.add('crm-mindmap-drag-line');
                            dragLine.setAttribute('stroke', '#6366F1');
                            dragLine.setAttribute('stroke-width', '2');
                            dragLine.setAttribute('stroke-dasharray', '6,4');
                            dragLine.setAttribute('fill', 'none');
                            dragLine.setAttribute('opacity', '0.6');
                            svg.appendChild(dragLine);
                        }
                        dragLine.setAttribute('d', `M ${anchorPt.x} ${anchorPt.y} L ${anchorPt.x} ${anchorPt.y}`);
                        dragLine.style.display = '';
                    }
                    return;
                }

                const node = e.target.closest('.crm-mindmap-node');
                if (node && e.button === 0) {
                    const nodeId = getNodeId(node);
                    if (!nodeId) return;
                    createRipple(node, e);
                    mindMapNodeDrag = {
                        nodeId,
                        nodeEl: node,
                        startX: e.clientX,
                        startY: e.clientY,
                        origLeft: parseFloat(node.style.left) || 0,
                        origTop: parseFloat(node.style.top) || 0,
                        active: false
                    };
                    e.preventDefault();
                    return;
                }

                if (e.button === 0) {
                    isMindMapPanning = true;
                    mindMapStartMouseX = e.clientX - mindMapPanX;
                    mindMapStartMouseY = e.clientY - mindMapPanY;
                    viewport.classList.add('is-panning');
                }
            });

            window.addEventListener('mousemove', (e) => {
                if (mindMapResizeDrag) {
                    const rd = mindMapResizeDrag;
                    const dx = (e.clientX - rd.startX) / mindMapZoom;
                    const newWidth = Math.max(100, rd.origWidth + dx);
                    rd.nodeEl.style.width = newWidth + 'px';
                    if (mindMapDragRafId) cancelAnimationFrame(mindMapDragRafId);
                    mindMapDragRafId = requestAnimationFrame(() => rebuildSVGPaths());
                    return;
                }

                if (mindMapAnchorDrag) {
                    const ad = mindMapAnchorDrag;
                    const canvasX = (e.clientX - ad.vpLeft - mindMapPanX) / mindMapZoom;
                    const canvasY = (e.clientY - ad.vpTop - mindMapPanY) / mindMapZoom;
                    const svg = docQs('#crm-mindmap-svg');
                    const dragLine = svg?.querySelector('.crm-mindmap-drag-line');
                    if (dragLine) {
                        const fx = ad.startCanvasX;
                        const fy = ad.startCanvasY;
                        const dx = canvasX - fx;
                        const dy = canvasY - fy;
                        const dist = Math.hypot(dx, dy);
                        const off = Math.min(dist * 0.3, 80);
                        let c1x = fx, c1y = fy;
                        if (ad.fromAnchor === 'right') c1x += off;
                        else if (ad.fromAnchor === 'left') c1x -= off;
                        else if (ad.fromAnchor === 'top') c1y -= off;
                        else if (ad.fromAnchor === 'bottom') c1y += off;
                        dragLine.setAttribute('d', `M ${fx} ${fy} C ${c1x} ${c1y} ${canvasX} ${canvasY} ${canvasX} ${canvasY}`);
                    }
                    const canvas = docQs('#crm-mindmap-canvas');
                    const anchorPad = 20;
                    const hoverNode = canvas ? Array.from(canvas.querySelectorAll('.crm-mindmap-node')).find(n => {
                        if (getNodeId(n) === ad.fromId) return false;
                        const l = parseFloat(n.style.left) || 0;
                        const t = parseFloat(n.style.top) || 0;
                        const w = n.offsetWidth || 200;
                        const h = n.offsetHeight || 50;
                        return canvasX >= l - anchorPad && canvasX <= l + w + anchorPad && canvasY >= t - anchorPad && canvasY <= t + h + anchorPad;
                    }) : null;
                    canvas?.querySelectorAll('.crm-mindmap-node.anchor-target').forEach(n => n.classList.remove('anchor-target'));
                    if (hoverNode) hoverNode.classList.add('anchor-target');
                    return;
                }

                if (mindMapNodeDrag) {
                    const dx = e.clientX - mindMapNodeDrag.startX;
                    const dy = e.clientY - mindMapNodeDrag.startY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (!mindMapNodeDrag.active && dist < 6) return;

                    if (!mindMapNodeDrag.active) {
                        mmPushUndo();
                        mindMapNodeDrag.active = true;
                        mindMapNodeDrag.nodeEl.classList.add('is-dragging');
                        if (physicsEnabled) {
                            physicsDragNodeId = mindMapNodeDrag.nodeId;
                            const pn = physicsNodes.find(n => n.id === physicsDragNodeId);
                            if (pn) pn.pinned = true;
                        }
                    }

                    const newLeft = mindMapNodeDrag.origLeft + dx / mindMapZoom;
                    const newTop = mindMapNodeDrag.origTop + dy / mindMapZoom;
                    mindMapNodeDrag.nodeEl.style.left = newLeft + 'px';
                    mindMapNodeDrag.nodeEl.style.top = newTop + 'px';

                    if (physicsEnabled) {
                        const pn = physicsNodes.find(n => n.id === mindMapNodeDrag.nodeId);
                        if (pn) { pn.x = newLeft; pn.y = newTop; }
                        nudgePhysics();
                    }

                    if (mindMapDragRafId) cancelAnimationFrame(mindMapDragRafId);
                    mindMapDragRafId = requestAnimationFrame(() => rebuildSVGPaths());
                    return;
                }

                if (isMindMapPanning) {
                    mindMapPanX = e.clientX - mindMapStartMouseX;
                    mindMapPanY = e.clientY - mindMapStartMouseY;
                    applyMindMapTransform();
                }
            });

            window.addEventListener('mouseup', (e) => {
                if (mindMapResizeDrag) {
                    const rd = mindMapResizeDrag;
                    mindMapResizeDrag = null;
                    const newWidth = rd.nodeEl.offsetWidth;
                    if (!mindMapUserEdits[rd.nodeId]) mindMapUserEdits[rd.nodeId] = {};
                    mindMapUserEdits[rd.nodeId].width = newWidth;
                    rebuildSVGPaths();
                    scheduleMindMapAutoSave();
                    return;
                }

                if (mindMapAnchorDrag) {
                    const ad = mindMapAnchorDrag;
                    mindMapAnchorDrag = null;
                    ad.fromNode.classList.remove('anchor-dragging');
                    const svg = docQs('#crm-mindmap-svg');
                    const dragLine = svg?.querySelector('.crm-mindmap-drag-line');
                    if (dragLine) dragLine.style.display = 'none';
                    const canvas = docQs('#crm-mindmap-canvas');
                    const targetNode = canvas?.querySelector('.crm-mindmap-node.anchor-target');
                    if (targetNode) {
                        targetNode.classList.remove('anchor-target');
                        const toId = getNodeId(targetNode);
                        if (toId && toId !== ad.fromId) {
                            const toAnchor = findClosestAnchor(targetNode, { x: ad.startCanvasX, y: ad.startCanvasY });
                            addCustomConnection(ad.fromId, ad.fromAnchor, toId, toAnchor);
                        }
                    }
                    canvas?.querySelectorAll('.anchor-target').forEach(n => n.classList.remove('anchor-target'));
                    return;
                }

                if (mindMapNodeDrag) {
                    const drag = mindMapNodeDrag;
                    mindMapNodeDrag = null;
                    drag.nodeEl.classList.remove('is-dragging');

                    if (physicsEnabled && physicsDragNodeId) {
                        const pn = physicsNodes.find(n => n.id === physicsDragNodeId);
                        if (pn) { pn.pinned = (pn.id === 'central'); }
                        physicsDragNodeId = null;
                        nudgePhysics();
                    }

                    if (drag.active) {
                        drag.nodeEl.classList.add('mm-drop-bounce');
                        drag.nodeEl.addEventListener('animationend', () => {
                            drag.nodeEl.classList.remove('mm-drop-bounce');
                        }, { once: true });
                    }

                    if (!drag.active) {
                        handleNodeClick(drag.nodeId);
                    } else {
                        const finalLeft = parseFloat(drag.nodeEl.style.left) || 0;
                        const finalTop = parseFloat(drag.nodeEl.style.top) || 0;
                        mindMapPositions[drag.nodeId] = { x: finalLeft, y: finalTop };
                        const userNode = mindMapUserNodes.find(u => u.id === drag.nodeId);
                        if (userNode) { userNode.x = finalLeft; userNode.y = finalTop; }
                        scheduleMindMapAutoSave();
                    }
                    return;
                }

                if (isMindMapPanning) {
                    isMindMapPanning = false;
                    viewport?.classList.remove('is-panning');
                }
            });

            viewport?.addEventListener('wheel', (e) => {
                e.preventDefault();
                const factor = e.deltaY > 0 ? 0.9 : 1.1;
                zoomMindMap(factor, e.clientX, e.clientY);
            }, { passive: false });

            viewport?.addEventListener('auxclick', (e) => {
                if (e.button === 1) e.preventDefault();
            });

            // === Touch Events (Phase 4 deferred — mobile/tablet support) ===
            let touchState = { type: null, startX: 0, startY: 0, startPanX: 0, startPanY: 0, startZoom: 1, startDist: 0, nodeEl: null, nodeId: null, origLeft: 0, origTop: 0, moved: false };

            viewport?.addEventListener('touchstart', (e) => {
                hideContextMenu();
                const touches = e.touches;

                if (touches.length === 1) {
                    const touch = touches[0];
                    const node = touch.target.closest ? touch.target.closest('.crm-mindmap-node') : null;
                    if (touch.target.closest('#crm-mindmap-inspector') || touch.target.closest('.crm-mindmap-toolbar')) return;

                    if (node) {
                        const nodeId = getNodeId(node);
                        if (nodeId) {
                            touchState = {
                                type: 'node-drag',
                                startX: touch.clientX, startY: touch.clientY,
                                startPanX: 0, startPanY: 0, startZoom: mindMapZoom, startDist: 0,
                                nodeEl: node, nodeId,
                                origLeft: parseFloat(node.style.left) || 0,
                                origTop: parseFloat(node.style.top) || 0,
                                moved: false
                            };
                            e.preventDefault();
                            return;
                        }
                    }

                    touchState = {
                        type: 'pan',
                        startX: touch.clientX - mindMapPanX,
                        startY: touch.clientY - mindMapPanY,
                        startPanX: mindMapPanX, startPanY: mindMapPanY, startZoom: mindMapZoom, startDist: 0,
                        nodeEl: null, nodeId: null, origLeft: 0, origTop: 0, moved: false
                    };
                    viewport.classList.add('is-panning');
                    e.preventDefault();
                } else if (touches.length === 2) {
                    const dx = touches[0].clientX - touches[1].clientX;
                    const dy = touches[0].clientY - touches[1].clientY;
                    touchState = {
                        type: 'pinch',
                        startX: (touches[0].clientX + touches[1].clientX) / 2,
                        startY: (touches[0].clientY + touches[1].clientY) / 2,
                        startPanX: mindMapPanX, startPanY: mindMapPanY,
                        startZoom: mindMapZoom,
                        startDist: Math.sqrt(dx * dx + dy * dy),
                        nodeEl: null, nodeId: null, origLeft: 0, origTop: 0, moved: false
                    };
                    e.preventDefault();
                }
            }, { passive: false });

            viewport?.addEventListener('touchmove', (e) => {
                const touches = e.touches;

                if (touchState.type === 'node-drag' && touches.length === 1) {
                    const touch = touches[0];
                    const dx = touch.clientX - touchState.startX;
                    const dy = touch.clientY - touchState.startY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (!touchState.moved && dist < 8) return;
                    touchState.moved = true;
                    e.preventDefault();

                    if (touchState.nodeEl) {
                        touchState.nodeEl.classList.add('is-dragging');
                        const newLeft = touchState.origLeft + dx / mindMapZoom;
                        const newTop = touchState.origTop + dy / mindMapZoom;
                        touchState.nodeEl.style.left = newLeft + 'px';
                        touchState.nodeEl.style.top = newTop + 'px';
                        if (mindMapDragRafId) cancelAnimationFrame(mindMapDragRafId);
                        mindMapDragRafId = requestAnimationFrame(() => rebuildSVGPaths());
                    }
                } else if (touchState.type === 'pan' && touches.length === 1) {
                    const touch = touches[0];
                    mindMapPanX = touch.clientX - touchState.startX;
                    mindMapPanY = touch.clientY - touchState.startY;
                    touchState.moved = true;
                    applyMindMapTransform();
                    e.preventDefault();
                } else if (touchState.type === 'pinch' && touches.length === 2) {
                    const dx = touches[0].clientX - touches[1].clientX;
                    const dy = touches[0].clientY - touches[1].clientY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (touchState.startDist > 0) {
                        const scale = dist / touchState.startDist;
                        const targetZoom = Math.max(0.3, Math.min(2.5, touchState.startZoom * scale));
                        const viewportRect = viewport.getBoundingClientRect();
                        const midX = (touches[0].clientX + touches[1].clientX) / 2;
                        const midY = (touches[0].clientY + touches[1].clientY) / 2;
                        const localX = midX - viewportRect.left;
                        const localY = midY - viewportRect.top;
                        const canvasX = (localX - touchState.startPanX) / touchState.startZoom;
                        const canvasY = (localY - touchState.startPanY) / touchState.startZoom;
                        mindMapPanX = localX - canvasX * targetZoom;
                        mindMapPanY = localY - canvasY * targetZoom;
                        mindMapZoom = targetZoom;
                        applyMindMapTransform();
                    }
                    touchState.moved = true;
                    e.preventDefault();
                }
            }, { passive: false });

            viewport?.addEventListener('touchend', (e) => {
                if (touchState.type === 'node-drag') {
                    const state = { ...touchState };
                    if (state.nodeEl) state.nodeEl.classList.remove('is-dragging');

                    if (!state.moved && state.nodeId) {
                        // Tap on node → open inspector
                        handleNodeClick(state.nodeId);
                    } else if (state.moved && state.nodeId && state.nodeEl) {
                        // Save dragged position
                        const finalLeft = parseFloat(state.nodeEl.style.left) || 0;
                        const finalTop = parseFloat(state.nodeEl.style.top) || 0;
                        mindMapPositions[state.nodeId] = { x: finalLeft, y: finalTop };
                        const userNode = mindMapUserNodes.find(u => u.id === state.nodeId);
                        if (userNode) { userNode.x = finalLeft; userNode.y = finalTop; }
                        scheduleMindMapAutoSave();
                    }
                } else if (touchState.type === 'pan') {
                    viewport?.classList.remove('is-panning');
                }
                touchState = { type: null, startX: 0, startY: 0, startPanX: 0, startPanY: 0, startZoom: 1, startDist: 0, nodeEl: null, nodeId: null, origLeft: 0, origTop: 0, moved: false };
            });

            viewport?.addEventListener('dblclick', (e) => {
                if (e.target.closest('.crm-mindmap-node')) {
                    const node = e.target.closest('.crm-mindmap-node');
                    const nodeId = getNodeId(node);
                    if (nodeId) startInlineEdit(nodeId);
                    return;
                }
            });

            docQs('#crm-mindmap-undo-btn')?.addEventListener('click', mmUndo);
            docQs('#crm-mindmap-redo-btn')?.addEventListener('click', mmRedo);

            window.addEventListener('keydown', (e) => {
                const modal = docQs('#crm-books-mindmap-modal');
                if (!modal || modal.style.display === 'none') return;
                if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); mmUndo(); }
                if (e.ctrlKey && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); mmRedo(); }
            });

            addNodeBtn?.addEventListener('click', () => {
                const vp = docQs('#crm-mindmap-viewport');
                if (!vp) return;
                const cx = (vp.clientWidth / 2 - mindMapPanX) / mindMapZoom;
                const cy = (vp.clientHeight / 2 - mindMapPanY) / mindMapZoom;
                addUserNode(cx, cy);
            });

            viewport?.addEventListener('contextmenu', (e) => {
                const hitArea = e.target.closest('.crm-mindmap-conn-hitarea');
                if (hitArea) {
                    e.preventDefault();
                    e.stopPropagation();
                    const connId = hitArea.dataset.connId;
                    const connType = hitArea.dataset.connType || 'custom';
                    if (connId) showConnectionContextMenu(e.clientX, e.clientY, connId, connType);
                    return;
                }
                const node = e.target.closest('.crm-mindmap-node');
                if (!node) return;
                const nodeId = getNodeId(node);
                if (!nodeId || node.classList.contains('central')) return;
                e.preventDefault();
                showContextMenu(nodeId, e.clientX, e.clientY);
            });

            contextMenu?.addEventListener('click', (e) => {
                const item = e.target.closest('[data-action]');
                const swatch = e.target.closest('.crm-mindmap-color-swatch');
                if (swatch && mindMapContextNodeId) {
                    changeNodeColor(mindMapContextNodeId, swatch.dataset.color);
                    hideContextMenu();
                    return;
                }
                const shapeBtn = e.target.closest('.crm-mindmap-shape-option');
                if (shapeBtn && mindMapContextNodeId) {
                    mmPushUndo();
                    changeNodeShape(mindMapContextNodeId, shapeBtn.dataset.shape);
                    hideContextMenu();
                    return;
                }
                const tagBtn = e.target.closest('.crm-mindmap-tag-option');
                if (tagBtn && mindMapContextNodeId) {
                    const tagId = tagBtn.dataset.tag;
                    if (!mindMapUserEdits[mindMapContextNodeId]) mindMapUserEdits[mindMapContextNodeId] = {};
                    if (!mindMapUserEdits[mindMapContextNodeId].tags) mindMapUserEdits[mindMapContextNodeId].tags = [];
                    const tags = mindMapUserEdits[mindMapContextNodeId].tags;
                    if (tags.includes(tagId)) {
                        tags.splice(tags.indexOf(tagId), 1);
                    } else {
                        tags.push(tagId);
                    }
                    scheduleMindMapAutoSave();
                    renderMindMapNodes(currentMindMapData, true);
                    hideContextMenu();
                    return;
                }
                if (!item || !mindMapContextNodeId) return;
                const action = item.dataset.action;
                const nid = mindMapContextNodeId;
                hideContextMenu();

                if (action === 'edit-title') startInlineEdit(nid);
                else if (action === 'add-child') {
                    const parentNode = docQs(`#crm-mindmap-canvas [data-node-id="${nid}"]`);
                    if (parentNode) {
                        const px = parseFloat(parentNode.style.left) || 0;
                        const py = parseFloat(parentNode.style.top) || 0;
                        addUserNode(px + 250, py + 60, nid);
                    }
                }
                else if (action === 'add-note') handleNodeClick(nid);
                else if (action === 'expand-ai') expandNodeWithAI(nid);
                else if (action === 'delete-node') deleteUserNode(nid);
            });

            document.addEventListener('click', (e) => {
                if (!e.target.closest('#crm-mindmap-context-menu') && !e.target.closest('#crm-mindmap-conn-context')) hideContextMenu();
                const memberDropdown = docQs('#crm-mindmap-member-dropdown');
                if (memberDropdown && !e.target.closest('#crm-mindmap-member-selector')) {
                    memberDropdown.style.display = 'none';
                }
                const mapDropdown = docQs('#crm-mindmap-map-dropdown');
                if (mapDropdown && !e.target.closest('#crm-mindmap-map-selector')) {
                    mapDropdown.style.display = 'none';
                }
                const exportDropdown = docQs('#crm-mindmap-export-dropdown');
                if (exportDropdown && !e.target.closest('.crm-mindmap-export-wrap')) {
                    exportDropdown.style.display = 'none';
                }
            });
        }

        async function openVersionHistoryPanel() {
            const panel = docQs('#crm-mindmap-versions');
            const list = docQs('#crm-mindmap-versions-list');
            if (!panel || !list || !selectedBookId) return;

            panel.style.display = 'flex';
            list.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--crm-text-muted);">Loading versions...</div>`;

            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}/mind-map/versions`);
                const versions = res?.versions || [];

                if (versions.length === 0) {
                    list.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--crm-text-muted);">No saved versions yet.</div>`;
                    return;
                }

                list.innerHTML = versions.map(v => `
                    <div class="crm-mindmap-version-item">
                        <div class="crm-mindmap-version-item-name">${escapeHtml(v.name || 'Untitled Version')}</div>
                        <div class="crm-mindmap-version-item-meta">
                            ${new Date(v.timestamp).toLocaleString()} • ${v.categoryCount || 0} categories, ${v.noteCount || 0} notes
                        </div>
                        <button class="crm-mindmap-version-restore-btn" data-id="${v.id}">Restore</button>
                    </div>
                `).join('');

                list.querySelectorAll('.crm-mindmap-version-restore-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const versionId = e.target.dataset.id;
                        if (!confirm('Are you sure you want to restore this version? Your current map will be overwritten.')) return;
                        
                        try {
                            e.target.disabled = true;
                            e.target.textContent = 'Restoring...';
                            const res = await apiPost(`/api/admin/books/${selectedBookId}/mind-map/restore/${versionId}`);
                            if (res && res.mindMap) {
                                currentMindMapData = res.mindMap;
                                mindMapPositions = res.mindMap.positions || {};
                                mindMapUserNodes = Array.isArray(res.mindMap.userNodes) ? res.mindMap.userNodes : [];
                                mindMapUserEdits = res.mindMap.userEdits || {};
                                mindMapCustomConnections = Array.isArray(res.mindMap.customConnections) ? res.mindMap.customConnections : [];
                                mindMapHiddenConnections = Array.isArray(res.mindMap.hiddenConnections) ? res.mindMap.hiddenConnections : [];
                                mindMapDirty = false;
                                renderMindMapNodes(currentMindMapData);
                                panel.style.display = 'none';
                                updateSaveStatus(null, '✅ Version restored');
                            }
                        } catch (err) {
                            console.error(err);
                            alert('Failed to restore version: ' + err.message);
                            e.target.disabled = false;
                            e.target.textContent = 'Restore';
                        }
                    });
                });
            } catch (err) {
                console.error(err);
                list.innerHTML = `<div style="text-align:center; padding: 20px; color: #EF4444;">Failed to load versions.</div>`;
            }
        }

        function exportMindMapPNG() {
            try {
                const canvas = docQs('#crm-mindmap-canvas');
                const svg = docQs('#crm-mindmap-svg');
                if (!canvas || !svg) return;

                const exportCanvas = document.createElement('canvas');
                exportCanvas.width = parseInt(canvas.style.width) || 3000;
                exportCanvas.height = parseInt(canvas.style.height) || 2000;
                const ctx = exportCanvas.getContext('2d');
                
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

                // Draw connecting lines
                ctx.strokeStyle = '#D1D5DB';
                ctx.lineWidth = 2;
                const paths = svg.querySelectorAll('path');
                paths.forEach(path => {
                    const d = path.getAttribute('d');
                    if (d) {
                        const p = new Path2D(d);
                        ctx.stroke(p);
                    }
                });

                // Draw nodes
                const nodes = canvas.querySelectorAll('.crm-mindmap-node');
                nodes.forEach(node => {
                    const rect = node.getBoundingClientRect();
                    const canvasRect = canvas.getBoundingClientRect();
                    
                    const left = parseFloat(node.style.left) || 0;
                    const top = parseFloat(node.style.top) || 0;
                    const width = parseFloat(node.style.width) || 200;
                    const height = node.offsetHeight;
                    
                    const bgColor = window.getComputedStyle(node).backgroundColor;
                    const borderColor = window.getComputedStyle(node).borderColor;
                    
                    ctx.fillStyle = bgColor;
                    ctx.strokeStyle = borderColor;
                    ctx.lineWidth = 1;
                    
                    // rounded rect
                    ctx.beginPath();
                    ctx.roundRect(left, top, width, height, 8);
                    ctx.fill();
                    ctx.stroke();

                    // text
                    ctx.fillStyle = window.getComputedStyle(node).color || '#111827';
                    ctx.font = 'bold 14px "Inter", sans-serif';
                    const title = node.querySelector('.crm-mindmap-node-title')?.textContent || '';
                    
                    const textMargin = 16;
                    let yPos = top + textMargin + 14;
                    ctx.fillText(title.substring(0, 30) + (title.length > 30 ? '...' : ''), left + textMargin, yPos);
                    
                    const summary = node.querySelector('.crm-mindmap-node-summary')?.textContent || '';
                    if (summary) {
                        ctx.fillStyle = '#4B5563';
                        ctx.font = '12px "Inter", sans-serif';
                        yPos += 20;
                        ctx.fillText(summary.substring(0, 40) + (summary.length > 40 ? '...' : ''), left + textMargin, yPos);
                    }
                });

                exportCanvas.toBlob(blob => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `mindmap_${selectedBookId}.png`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 'image/png');
            } catch (err) {
                console.error('Export PNG failed', err);
                alert('Failed to export PNG: ' + err.message);
            }
        }

        function exportMindMapMarkdown(toClipboard = false) {
            if (!currentMindMapData) return;
            
            let md = `# ${currentMindMapData.centralTopic || 'Mind Map'}\n\n`;
            
            const categories = currentMindMapData.categories || [];
            categories.forEach(cat => {
                const catTitle = mindMapUserEdits[cat.id]?.title || cat.title || 'Category';
                md += `## ${catTitle}\n`;
                if (cat.summary) md += `*${cat.summary}*\n\n`;
                
                const subtopics = cat.subtopics || [];
                subtopics.forEach(sub => {
                    const subTitle = mindMapUserEdits[sub.id]?.title || sub.title || 'Subtopic';
                    md += `- **${subTitle}**: ${sub.summary || ''}\n`;
                    
                    if (mindMapUserEdits[sub.id]?.notes) {
                        md += `  - *Notes:* ${mindMapUserEdits[sub.id].notes.replace(/\\n/g, ' ')}\n`;
                    }
                });
                md += '\n';
            });
            
            if (mindMapUserNodes && mindMapUserNodes.length > 0) {
                md += `## Custom Notes\n`;
                mindMapUserNodes.forEach(un => {
                    md += `- **${un.title || 'Note'}**: ${un.text || ''}\n`;
                });
                md += '\n';
            }
            
            if (toClipboard) {
                navigator.clipboard.writeText(md).then(() => {
                    updateSaveStatus(null, '\ud83d\udccb Copied to clipboard!');
                }).catch(err => {
                    alert('Failed to copy: ' + err.message);
                });
            } else {
                const blob = new Blob([md], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `mindmap_${selectedBookId}.md`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        }

        async function openMindMapModal(bookId, force = false, noteIds = null) {
            bindMindMapModalEvents();
            const modal = docQs('#crm-books-mindmap-modal');
            const titleEl = docQs('#crm-mindmap-title');
            const subtitleEl = docQs('#crm-mindmap-subtitle');
            const canvas = docQs('#crm-mindmap-canvas');
            const svg = docQs('#crm-mindmap-svg');

            if (!modal) return;
            modal.style.display = 'flex';

            // Sync dark mode from books panel (modal is body-level, not nested)
            const booksPanel = document.querySelector('[data-panel="books"]');
            const isDark = booksPanel?.classList.contains('books-dark');
            modal.classList.toggle('books-dark', !!isDark);

            updateSaveStatus('');

            if (canvas) {
                canvas.innerHTML = `<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#6B7280; font-size:1.1rem; font-weight:600; text-align:center;">` +
                    `<div style="margin-bottom:12px; font-size:2rem;">🧠</div>` +
                    `Synthesizing saved notes into Mind Map...` +
                    `</div>`;
            }
            if (svg) svg.innerHTML = '';

            try {
                const priorMindMapData = currentMindMapData;
                const oldPositions = { ...mindMapPositions };
                const oldUserNodes = [ ...mindMapUserNodes ];
                const oldUserEdits = { ...mindMapUserEdits };
                const oldCustomConnections = [ ...mindMapCustomConnections ];

                const payload = { force };
                if (noteIds && noteIds.length > 0) payload.noteIds = noteIds;
                let res = await apiPost(`/api/admin/books/${bookId}/mind-map`, payload);
                if (!res || !res.mindMap) {
                    throw new Error(res?.message || 'Failed to generate Mind Map.');
                }

                let autoUpgradeFailed = false;
                if (isLegacyMindMapData(res.mindMap)) {
                    const upgradeKey = mindMapCitationUpgradeKey(bookId);
                    if (!mindMapCitationUpgradeAttempts.has(upgradeKey)) {
                        mindMapCitationUpgradeAttempts.add(upgradeKey);
                        try {
                            const upgradePayload = { force: true };
                            if (noteIds && noteIds.length > 0) upgradePayload.noteIds = noteIds;
                            const upgraded = await apiPost(`/api/admin/books/${bookId}/mind-map`, upgradePayload);
                            if (!upgraded?.mindMap || isLegacyMindMapData(upgraded.mindMap)) {
                                throw new Error('Citation upgrade did not return a versioned mind map.');
                            }
                            res = upgraded;
                        } catch (upgradeError) {
                            autoUpgradeFailed = true;
                            console.warn('[CRM Books] Mind-map citation upgrade failed:', upgradeError?.message || String(upgradeError));
                            showToast?.('Insufficient evidence: the mind map could not be upgraded.', 'warning');
                        }
                    }
                }

                currentMindMapData = res.mindMap;

                if (force || (!autoUpgradeFailed && res.mindMap.citationSchemaVersion === 1 && isLegacyMindMapData(priorMindMapData))) {
                    mindMapPositions = { ...(res.mindMap.positions || {}), ...oldPositions };
                    mindMapUserNodes = oldUserNodes;
                    mindMapUserEdits = { ...(res.mindMap.userEdits || {}), ...oldUserEdits };
                    mindMapCustomConnections = oldCustomConnections;
                    if (mindMapActiveMapId === 'default') {
                        mindMapDirty = true;
                        saveMindMapEdits();
                    } else {
                        mindMapDirty = false;
                    }
                } else {
                    mindMapPositions = res.mindMap.positions || {};
                    mindMapUserNodes = Array.isArray(res.mindMap.userNodes) ? res.mindMap.userNodes : [];
                    mindMapUserEdits = res.mindMap.userEdits || {};
                    mindMapCustomConnections = Array.isArray(res.mindMap.customConnections) ? res.mindMap.customConnections : [];
                    mindMapHiddenConnections = Array.isArray(res.mindMap.hiddenConnections) ? res.mindMap.hiddenConnections : [];
                    mindMapDirty = false;
                }

                mindMapUndoStack = [];
                mindMapRedoStack = [];
                mmUpdateUndoButtons();

                if (titleEl) titleEl.textContent = `🧠 ${currentMindMapData.centralTopic || 'Mind Map'}`;
                if (subtitleEl) subtitleEl.textContent = `${currentMindMapData.categories?.length || 0} categories • ${currentMindMapData.noteCount || 0} notes synthesized`;

                renderMindMapNodes(currentMindMapData);
                saveMapState(bookId, mindMapActiveMapId);
            } catch (err) {
                console.error('Failed to open mind map:', err);
                if (force && currentMindMapData && isLegacyMindMapData(currentMindMapData)) {
                    renderMindMapNodes(currentMindMapData);
                    saveMapState(bookId, mindMapActiveMapId);
                    showToast?.('Insufficient evidence: the legacy mind map could not be upgraded.', 'warning');
                    return;
                }
                if (canvas) {
                    canvas.innerHTML = `<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#EF4444; font-size:1rem; text-align:center; max-width:400px; padding:24px; background:#FEF2F2; border:1px solid #FECACA; border-radius:12px;">` +
                        `<div style="font-size:1.8rem; margin-bottom:8px;">⚠️</div>` +
                        `<div style="font-weight:700; margin-bottom:6px; color:#991B1B;">Mind Map Error</div>` +
                        `<div style="color:#7F1D1D;">${escapeHtml(err?.message || 'Failed to generate mind map.')}</div>` +
                        `</div>`;
                }
            }
        }

        function extractNoteTitle(text) {
            if (!text) return { title: 'Untitled Note', body: '' };
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const headingMatch = line.match(/^#{1,4}\s+(.+)/);
                if (headingMatch) {
                    return { title: headingMatch[1].replace(/\*\*/g, '').trim(), body: lines.slice(i + 1).join('\n').trim() };
                }
                if (line.startsWith('Q:')) {
                    return { title: line.substring(2).trim().slice(0, 80), body: lines.slice(i + 1).join('\n').trim() };
                }
                return { title: line.replace(/\*\*/g, '').slice(0, 80), body: lines.slice(i + 1).join('\n').trim() };
            }
            return { title: 'Untitled Note', body: '' };
        }

        function renderNotesTab() {
            if (!selectedBookId) return '<div class="crm-books-notes-empty">Select a book first.</div>';
            const notes = loadBookNotes(selectedBookId);
            if (notes.length === 0) {
                return `<div class="crm-books-notes-empty">` +
                    `<p>No saved notes yet.</p>` +
                    `<p style="font-size:0.8em; margin-top:8px; color:var(--books-text-muted);">Save interesting chat responses using the Save button on messages.</p>` +
                    `</div>`;
            }
            return `<div class="crm-books-notes-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--books-border, #e2e8f0); gap:8px;">` +
                `<span style="font-size:0.85em; font-weight:600; color:var(--books-text-muted);">${notes.length} note${notes.length === 1 ? '' : 's'} saved</span>` +
                `<div style="display:flex; gap:6px;">` +
                `<button type="button" class="crm-btn crm-btn-secondary crm-btn-sm crm-books-compile-open-btn">📝 Compile Research</button>` +
                `<button type="button" class="crm-btn crm-btn-secondary crm-btn-sm crm-books-create-mindmap-btn">🧠 Create Mind Map</button>` +
                `</div>` +
                `</div>` +
                `<div class="crm-books-notes-list">${notes.map((n) => {
                const timeStr = n.savedAt ? new Date(n.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                const isOpen = !!expandedNotes[n.id];
                const { title, body } = extractNoteTitle(n.text);
                const preview = body ? body.replace(/[#*>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
                return `<div class="crm-books-note-card${isOpen ? ' open' : ''}" data-note-id="${escapeHtml(n.id)}">` +
                    `<div class="crm-books-note-header" data-note-toggle="${escapeHtml(n.id)}">` +
                    `<span class="crm-books-note-chevron">${isOpen ? '▾' : '▸'}</span>` +
                    `<div class="crm-books-note-header-content">` +
                    `<span class="crm-books-note-title">${escapeHtml(title)}</span>` +
                    `<span class="crm-books-note-time">${escapeHtml(timeStr)}</span>` +
                    `</div>` +
                    `<button class="crm-books-note-delete-btn" data-note-id="${escapeHtml(n.id)}" title="Remove note">&times;</button>` +
                    `</div>` +
                    (!isOpen && preview ? `<div class="crm-books-note-preview">${escapeHtml(preview)}${preview.length >= 120 ? '…' : ''}</div>` : '') +
                    (isOpen ? `<div class="crm-books-note-body">${formatStudyNotesMarkdown(n.text)}</div>` : '') +
                    `</div>`;
            }).join('')}</div>`;
        }


        function renderUsageIndicator() {
            if (!usageData) return '';
            const pct = Math.min(100, Math.round((usageData.estimatedCostUsd / usageData.budgetLimitUsd) * 100));
            const colorCls = pct < 60 ? 'green' : pct < 90 ? 'yellow' : 'red';
            return `<div class="crm-books-usage-wrap">` +
                `<span class="crm-books-usage-label">$${usageData.estimatedCostUsd.toFixed(2)} / $${usageData.budgetLimitUsd.toFixed(2)}</span>` +
                `<div class="crm-books-usage-bar"><div class="crm-books-usage-fill ${colorCls}" style="width:${pct}%"></div></div>` +
                `</div>`;
        }

        function renderBudgetBanner() {
            if (!usageData || usageData.estimatedCostUsd < usageData.budgetLimitUsd || usageData.approved) return '';
            return `<div class="crm-books-budget-banner">` +
                `<span>Monthly AI budget ($${usageData.budgetLimitUsd.toFixed(2)}) exceeded.</span>` +
                `<input type="text" class="crm-books-approve-input" placeholder="Type approve">` +
                `<button class="crm-books-approve-btn">Confirm</button>` +
                `</div>`;
        }

        async function loadUsage() {
            try {
                const res = await apiGet('/api/admin/books/usage');
                usageData = res;
            } catch (_) {
                usageData = null;
            }
        }

        function renderFailedState(b) {
            const label = buildIngestLabel(b.ingest, b.status);
            const rawError = clean(b.ingest?.error);
            const codeMatch = rawError.match(/^\[([A-Z_]+)\]/);
            const code = codeMatch ? codeMatch[1] : clean(b.ingest?.error?.code);
            const nonRetryable = new Set(['SCANNED_PDF_NO_TEXT', 'PDF_PARSE_FAILED']);
            const canRetry = !nonRetryable.has(code);
            return `<div class="crm-books-state-notice">` +
                `<div class="crm-books-state-icon danger">${ICON_ERROR}</div>` +
                `<p class="crm-books-state-notice-title">Processing failed</p>` +
                `<p class="crm-muted">${escapeHtml(label)}</p>` +
                `<div class="crm-books-state-notice-actions">` +
                (canRetry ? `<button class="crm-books-retry-btn" data-book-id="${escapeHtml(b.bookId)}">Retry</button>` : '') +
                `<button class="crm-books-delete-btn danger" data-book-id="${escapeHtml(b.bookId)}">Remove</button>` +
                `</div></div>`;
        }

        function renderAwaitingUpload(b) {
            return `<div class="crm-books-state-notice">` +
                `<div class="crm-books-state-icon">${ICON_UPLOAD}</div>` +
                `<p class="crm-books-state-notice-title">Upload needed</p>` +
                `<p class="crm-muted">This book's PDF has not been uploaded yet.</p>` +
                `<div class="crm-books-state-notice-actions">` +
                `<button class="crm-books-reupload-btn" data-book-id="${escapeHtml(b.bookId)}">Upload PDF</button>` +
                `<button class="crm-books-delete-btn danger" data-book-id="${escapeHtml(b.bookId)}">Remove</button>` +
                `</div></div>`;
        }

        function renderProcessingState(b) {
            const percent = ingestWeightedPercent(b.ingest, b.status);
            const label = buildIngestLabel(b.ingest, b.status);
            const eta = formatEta(b.ingest);
            return `<div class="crm-books-state-notice">` +
                `<div class="crm-books-processing-ring">` +
                `<svg viewBox="0 0 48 48" width="56" height="56"><circle cx="24" cy="24" r="20" fill="none" stroke="#E8E2D9" stroke-width="3"/><circle cx="24" cy="24" r="20" fill="none" stroke="#B8860B" stroke-width="3" stroke-dasharray="${Math.round(125.6 * percent / 100)} 125.6" stroke-linecap="round" transform="rotate(-90 24 24)" style="transition:stroke-dasharray 0.5s;"/></svg>` +
                `<span class="crm-books-processing-pct">${percent}%</span>` +
                `</div>` +
                `<p class="crm-books-state-notice-title">Processing…</p>` +
                `<p class="crm-muted">${escapeHtml(label)}</p>` +
                (eta ? `<p class="crm-muted crm-books-eta">${escapeHtml(eta)}</p>` : '') +
                `</div>`;
        }

        // --- Data loading ---
        async function refresh() {
            try {
                const res = await apiGet('/api/admin/books');
                books = normalizeBooks(res.books);
                renderSourcesPanel();
                if (selectedBookId) {
                    selectedBook = books.find((b) => b.bookId === selectedBookId) || null;
                    if (selectedBook) {
                        renderExplorerPanel();
                    }
                }
            } catch (err) {
                console.error('[CRM Books] Failed to refresh books:', err);
            }
        }

        async function selectBook(bookId) {
            cancelPageTurn();
            selectedBookId = clean(bookId);
            const thisSelection = ++selectionCounter;
            selectedBook = books.find((b) => b.bookId === selectedBookId) || null;
            selectedSummary = null;
            threads = [];
            messages = [];
            selectedThreadId = '';
            activeTab = 'summary';
            summaryMode = '';
            sectionDigests = null;
            sectionsLoading = false;
            collapsedOutline = {};
            pagesData = null;
            if (typeof window !== 'undefined') window.__currentBookRendererContract = null;
            currentPage = 1;
            activePageSubTab = 'text';
            cachedSourcePdfUrl = '';
            cachedSourcePdfBookId = '';
            isLoadingSourcePdf = false;
            resetPageCitation();
            editingThreadId = '';
            editingThreadTitle = '';
            activeHighlights = loadHighlights(selectedBookId);
            readingProgress = loadProgress(selectedBookId);

            detachSnapshot();
            renderSourcesPanel();

            if (!selectedBook) {
                renderExplorerPanel();
                return;
            }

            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}`);
                if (thisSelection !== selectionCounter) return;
                if (res.book) {
                    selectedBook = res.book;
                    const idx = books.findIndex((b) => b.bookId === selectedBookId);
                    if (idx >= 0) books[idx] = { ...books[idx], ...selectedBook };
                }
                selectedSummary = res.summary || null;
            } catch (err) {
                if (thisSelection !== selectionCounter) return;
                console.error('[CRM Books] Failed to load book detail:', err);
            }

            renderExplorerPanel();

            if (selectedBook.status === 'ready') {
                loadThreads().catch(console.error);
            }

            if (selectedBook.status !== 'ready' && selectedBook.status !== 'failed') {
                attachSnapshot(selectedBookId);
            }

            updateHash();
        }

        async function loadThreads() {
            if (!selectedBookId) return;
            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}/threads`);
                threads = Array.isArray(res.threads) ? res.threads : [];
                renderExplorerPanel();
            } catch (err) {
                console.error('[CRM Books] Failed to load threads:', err);
            }
        }

        async function loadMessages() {
            if (!selectedBookId || !selectedThreadId) { messages = []; return; }
            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}/threads/${selectedThreadId}/messages`);
                messages = Array.isArray(res.messages) ? res.messages : [];
            } catch (err) {
                console.error('[CRM Books] Failed to load messages:', err);
                messages = [];
            }
        }

        // --- Snapshot listener for live ingest progress ---
        function attachSnapshot(bookId) {
            detachSnapshot();
            try {
                const db = firebaseApp?.firestore?.() || (typeof firebase !== 'undefined' ? firebase.firestore() : null);
                if (!db) return;
                snapshotUnsubscribe = db.collection('crmBooks').doc(bookId)
                    .onSnapshot((snap) => {
                        if (!snap.exists) return;
                        const data = snap.data() || {};
                        const idx = books.findIndex((b) => b.bookId === bookId);
                        const updated = {
                            ...(idx >= 0 ? books[idx] : {}),
                            status: data.status,
                            ingest: data.ingest,
                            pageCount: data.pageCount ?? null
                        };
                        if (idx >= 0) books[idx] = updated;
                        if (selectedBookId === bookId) {
                            selectedBook = updated;
                            renderExplorerPanel();
                        }
                        renderSourcesPanel();
                        if (data.status === 'ready' || data.status === 'failed') {
                            detachSnapshot();
                            if (data.status === 'ready' && selectedBookId === bookId) {
                                selectBook(bookId).catch(console.error);
                            }
                        }
                    }, (err) => {
                        console.warn('[CRM Books] Snapshot error, falling back to polling:', err);
                        detachSnapshot();
                    });
            } catch (err) {
                console.warn('[CRM Books] Could not attach snapshot:', err);
            }
        }

        function detachSnapshot() {
            if (snapshotUnsubscribe) {
                snapshotUnsubscribe();
                snapshotUnsubscribe = null;
            }
        }

        // --- Hash management ---
        function updateHash() {
            if (selectedBookId) {
                const hash = `#books/${selectedBookId}`;
                if (window.location.hash !== hash) {
                    history.replaceState(null, '', hash);
                }
            }
        }

        // --- Background Music Modal ---
        async function openBookBgmModal(bookId) {
            if (!bookId) return;
            const existing = qs('.crm-books-bgm-modal');
            if (existing) existing.remove();

            const book = books.find(b => b.bookId === bookId) || selectedBook || {};
            const isDark = panel?.classList.contains('books-dark');
            const darkClass = isDark ? ' books-dark' : '';

            const modal = document.createElement('div');
            modal.className = `crm-modal-overlay crm-books-modal-overlay crm-books-bgm-modal${darkClass}`;
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML =
                `<div class="crm-modal-container">` +
                    `<div class="crm-modal-header">` +
                        `<h2>Background Music &middot; ${escapeHtml(book.title || 'Book')}</h2>` +
                        `<button class="crm-icon-btn crm-books-modal-close" title="Close">${ICON_CLOSE}</button>` +
                    `</div>` +
                    `<div class="crm-modal-body" style="flex-direction:column; padding:20px;">` +
                        `<div class="crm-books-bgm-dropzone" id="crm-books-bgm-dropzone">` +
                            `<div class="crm-books-bgm-dropzone-icon">🎵</div>` +
                            `<p><strong>Click to browse</strong> or drag &amp; drop MP3 files here</p>` +
                            `<span>Supported: MP3 audio files up to 30 MB</span>` +
                            `<input type="file" accept="audio/mp3,audio/mpeg,.mp3" style="display:none;" id="crm-books-bgm-file-input">` +
                        `</div>` +
                        `<div class="crm-books-bgm-progress-bar">` +
                            `<div class="crm-books-bgm-progress-fill"></div>` +
                        `</div>` +
                        `<div style="margin-bottom:8px; font-weight:600; font-size:0.85rem; color:var(--books-text, inherit);">` +
                            `Uploaded Audio Tracks (<span class="crm-books-bgm-count">0</span>)` +
                        `</div>` +
                        `<div class="crm-books-bgm-list" id="crm-books-bgm-list">` +
                            `<div style="text-align:center; padding:20px; color:var(--books-text-muted, #6b7280); font-size:0.82rem;">Loading tracks...</div>` +
                        `</div>` +
                    `</div>` +
                    `<div class="crm-modal-footer" style="padding:12px 20px; display:flex; justify-content:flex-end;">` +
                        `<button class="crm-btn-secondary crm-books-modal-close-btn">Done</button>` +
                    `</div>` +
                `</div>`;

            document.body.appendChild(modal);
            modal.style.display = 'flex';

            let previewAudio = null;
            let playingTrackId = null;

            const closeModal = () => {
                if (previewAudio) {
                    previewAudio.pause();
                    previewAudio = null;
                }
                modal.style.display = 'none';
                modal.remove();
            };

            modal.querySelector('.crm-books-modal-close').addEventListener('click', closeModal);
            modal.querySelector('.crm-books-modal-close-btn').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            const dropzone = modal.querySelector('#crm-books-bgm-dropzone');
            const fileInput = modal.querySelector('#crm-books-bgm-file-input');
            const progressBar = modal.querySelector('.crm-books-bgm-progress-bar');
            const progressFill = modal.querySelector('.crm-books-bgm-progress-fill');
            const listEl = modal.querySelector('#crm-books-bgm-list');
            const countEl = modal.querySelector('.crm-books-bgm-count');

            let tracks = [];

            async function loadTracks() {
                try {
                    const res = await apiGet(`/api/admin/books/${bookId}/audio`);
                    tracks = Array.isArray(res?.tracks) ? res.tracks : [];
                    renderTracks();
                } catch (err) {
                    console.warn('[CRM Books] API load failed, trying Firestore fallback:', err);
                    try {
                        const db = firebaseApp?.firestore?.() || (typeof firebase !== 'undefined' ? firebase.firestore() : null);
                        if (db) {
                            const snap = await db.collection('crmBooks').doc(bookId).collection('audio').orderBy('createdAt', 'asc').get();
                            tracks = snap.docs.map(doc => {
                                const d = doc.data();
                                return {
                                    id: doc.id,
                                    title: d.title || 'Untitled Track',
                                    storagePath: d.storagePath || '',
                                    downloadUrl: d.downloadUrl || '',
                                    originalFilename: d.originalFilename || '',
                                    sizeBytes: d.sizeBytes || null,
                                    duration: d.duration || null,
                                    createdAt: d.createdAt?.toDate?.() ?? d.createdAt ?? null
                                };
                            });
                            renderTracks();
                            return;
                        }
                    } catch (fsErr) {
                        console.warn('[CRM Books] Firestore fallback failed:', fsErr);
                    }
                    tracks = [];
                    renderTracks();
                }
            }

            function renderTracks() {
                countEl.textContent = String(tracks.length);
                if (tracks.length === 0) {
                    listEl.innerHTML = `<div style="text-align:center; padding:24px; color:var(--books-text-muted, #6b7280); font-size:0.82rem;">No custom background music uploaded yet.<br><span style="font-size:0.75rem; opacity:0.8;">Default study ambience will be played during book reading.</span></div>`;
                    return;
                }

                listEl.innerHTML = tracks.map(t => {
                    const sizeMb = t.sizeBytes ? (t.sizeBytes / (1024 * 1024)).toFixed(1) + ' MB' : '';
                    const isPlaying = playingTrackId === t.id;
                    return `<div class="crm-books-bgm-item" data-audio-id="${escapeHtml(t.id)}">` +
                        `<div class="crm-books-bgm-item-left">` +
                            `<button class="crm-books-bgm-preview-btn" data-audio-id="${escapeHtml(t.id)}" title="${isPlaying ? 'Pause preview' : 'Play preview'}">` +
                                (isPlaying
                                    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
                                    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>') +
                            `</button>` +
                            `<div class="crm-books-bgm-item-info">` +
                                `<div class="crm-books-bgm-item-title">${escapeHtml(t.title)}</div>` +
                                `<div class="crm-books-bgm-item-meta">${[escapeHtml(t.originalFilename), sizeMb].filter(Boolean).join(' &middot; ')}</div>` +
                            `</div>` +
                        `</div>` +
                        `<div class="crm-books-bgm-item-actions">` +
                            `<button class="crm-books-bgm-delete-btn" data-audio-id="${escapeHtml(t.id)}" title="Delete track">${ICON_TRASH}</button>` +
                        `</div>` +
                    `</div>`;
                }).join('');
            }

            listEl.addEventListener('click', async (e) => {
                const previewBtn = e.target.closest('.crm-books-bgm-preview-btn');
                if (previewBtn) {
                    const audioId = previewBtn.dataset.audioId;
                    const track = tracks.find(t => t.id === audioId);
                    if (!track || !track.downloadUrl) return;

                    if (playingTrackId === audioId && previewAudio && !previewAudio.paused) {
                        previewAudio.pause();
                        playingTrackId = null;
                        renderTracks();
                        return;
                    }

                    if (previewAudio) previewAudio.pause();
                    previewAudio = new Audio(track.downloadUrl);
                    previewAudio.addEventListener('ended', () => {
                        playingTrackId = null;
                        renderTracks();
                    });
                    playingTrackId = audioId;
                    renderTracks();
                    previewAudio.play().catch(err => {
                        console.warn('[CRM Books] Preview failed:', err);
                        playingTrackId = null;
                        renderTracks();
                    });
                    return;
                }

                const deleteBtn = e.target.closest('.crm-books-bgm-delete-btn');
                if (deleteBtn) {
                    const audioId = deleteBtn.dataset.audioId;
                    if (!confirm('Are you sure you want to remove this background music track?')) return;
                    if (playingTrackId === audioId && previewAudio) {
                        previewAudio.pause();
                        previewAudio = null;
                        playingTrackId = null;
                    }
                    deleteBtn.disabled = true;
                    try {
                        await apiDelete(`/api/admin/books/${bookId}/audio/${audioId}`);
                        tracks = tracks.filter(t => t.id !== audioId);
                        renderTracks();
                        showToast?.('Track removed.', 'info');
                        if (selectedBookId === bookId) {
                            await loadBookAudio(bookId);
                        }
                    } catch (err) {
                        console.error('[CRM Books] Failed to delete audio:', err);
                        showToast?.('Failed to delete track: ' + (err.message || 'Error'), 'error');
                        deleteBtn.disabled = false;
                    }
                }
            });

            // Upload handling
            dropzone.addEventListener('click', () => fileInput.click());
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                const file = e.dataTransfer?.files?.[0];
                if (file) handleAudioUpload(file);
            });

            fileInput.addEventListener('change', () => {
                const file = fileInput.files?.[0];
                if (file) handleAudioUpload(file);
            });

            async function handleAudioUpload(file) {
                if (!file) return;
                if (!file.name.toLowerCase().endsWith('.mp3') && !file.type.includes('audio')) {
                    showToast?.('Please select an MP3 audio file.', 'error');
                    return;
                }
                if (file.size > 30 * 1024 * 1024) {
                    showToast?.('Audio file must be under 30 MB.', 'error');
                    return;
                }

                const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim();
                const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const storagePath = `crm-books/${bookId}/bgm/${Date.now()}_${safeFilename}`;

                progressBar.style.display = 'block';
                progressFill.style.width = '0%';

                try {
                    const storageRef = firebaseApp.storage().ref(storagePath);
                    const uploadTask = storageRef.put(file, { contentType: 'audio/mpeg' });

                    uploadTask.on('state_changed',
                        (snapshot) => {
                            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                            progressFill.style.width = `${pct}%`;
                        },
                        (err) => {
                            console.error('[CRM Books] Audio upload failed:', err);
                            progressBar.style.display = 'none';
                            showToast?.('Audio upload failed: ' + (err.message || 'Error'), 'error');
                        },
                        async () => {
                            try {
                                const downloadUrl = await uploadTask.snapshot.ref.getDownloadURL();
                                const res = await apiPost(`/api/admin/books/${bookId}/audio`, {
                                    title: cleanTitle,
                                    storagePath,
                                    downloadUrl,
                                    originalFilename: file.name,
                                    sizeBytes: file.size
                                });
                                progressBar.style.display = 'none';
                                showToast?.('Background music uploaded successfully!', 'success');
                                if (res?.track) {
                                    tracks.push(res.track);
                                    renderTracks();
                                } else {
                                    await loadTracks();
                                }
                                if (selectedBookId === bookId) {
                                    await loadBookAudio(bookId);
                                }
                            } catch (postErr) {
                                console.error('[CRM Books] Failed to save audio metadata:', postErr);
                                progressBar.style.display = 'none';
                                showToast?.('Failed to save audio record: ' + (postErr.message || 'Error'), 'error');
                            }
                        }
                    );
                } catch (err) {
                    console.error('[CRM Books] Upload error:', err);
                    progressBar.style.display = 'none';
                    showToast?.('Failed to start audio upload: ' + (err.message || 'Error'), 'error');
                }
            }

            await loadTracks();
        }

        // --- Upload ---
        function openAddBookModal() {
            const existing = qs('.crm-books-add-modal');
            if (existing) existing.remove();

            const defaultCol = bookCollections.find(c => (c.name || '').toLowerCase() === 'pronunciation') || bookCollections[0];
            const targetColId = selectedBook?.collectionId || defaultCol?.id || '';
            const colOptionsHtml = bookCollections.length > 0
                ? bookCollections.map(c => `<option value="${escapeHtml(c.id)}"${targetColId === c.id ? ' selected' : ''}>📁 ${escapeHtml(c.name)}</option>`).join('')
                : `<option value="">📁 Pronunciation</option>`;

            const modal = document.createElement('div');
            modal.className = 'crm-modal-overlay crm-books-add-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML =
                `<div class="crm-modal-container" style="max-width:480px;">` +
                `<div class="crm-modal-header"><h2>Add Book</h2>` +
                `<button class="crm-icon-btn crm-books-modal-close" title="Close">${ICON_CLOSE}</button>` +
                `</div>` +
                `<div class="crm-modal-body" style="flex-direction:column; padding:20px;">` +
                `<div class="crm-form-grid" style="grid-template-columns:1fr;">` +
                `<div class="crm-form-group"><label for="crm-book-title">Title <span style="color:var(--danger-color,#e53e3e);">*</span></label><input id="crm-book-title" class="crm-input" type="text" placeholder="e.g. Sound Foundations"></div>` +
                `<div class="crm-form-group"><label for="crm-book-author">Author</label><input id="crm-book-author" class="crm-input" type="text" placeholder="e.g. Adrian Underhill"></div>` +
                `<div class="crm-form-group"><label for="crm-book-collection">Collection</label><select id="crm-book-collection" class="crm-input">${colOptionsHtml}</select></div>` +
                `<div class="crm-form-group"><label for="crm-book-file">PDF file <span style="color:var(--danger-color,#e53e3e);">*</span></label><input id="crm-book-file" class="crm-input" type="file" accept=".pdf,application/pdf"></div>` +
                `<p class="crm-books-modal-error crm-muted" style="color:var(--danger-color,#e53e3e); display:none;"></p>` +
                `</div></div>` +
                `<div class="crm-modal-footer" style="padding:12px 20px; display:flex; justify-content:flex-end; gap:8px;">` +
                `<button class="crm-btn-secondary crm-books-modal-cancel">Cancel</button>` +
                `<button class="crm-btn-primary crm-books-modal-submit">Upload</button>` +
                `</div></div>`;

            document.body.appendChild(modal);
            modal.style.display = 'flex';

            const closeModal = () => { modal.style.display = 'none'; modal.remove(); };
            modal.querySelector('.crm-books-modal-close').addEventListener('click', closeModal);
            modal.querySelector('.crm-books-modal-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            const fileInput = modal.querySelector('#crm-book-file');
            const titleInput = modal.querySelector('#crm-book-title');
            const authorInput = modal.querySelector('#crm-book-author');

            fileInput?.addEventListener('change', () => {
                const file = fileInput?.files?.[0];
                if (!file) return;

                const extracted = extractTitleAndAuthorFromFileName(file.name);
                if (extracted.title && !titleInput.value.trim()) {
                    titleInput.value = extracted.title;
                }
                if (extracted.author && !authorInput.value.trim()) {
                    authorInput.value = extracted.author;
                }

                extractPdfMetadata(file).then((meta) => {
                    if (meta.title && (!titleInput.value || titleInput.value === extracted.title)) {
                        titleInput.value = meta.title;
                    }
                    if (meta.author && !authorInput.value) {
                        authorInput.value = meta.author;
                    }
                }).catch(() => {});
            });

            const submitBtn = modal.querySelector('.crm-books-modal-submit');
            const errorEl = modal.querySelector('.crm-books-modal-error');
            submitBtn.addEventListener('click', async () => {
                errorEl.style.display = 'none';
                const title = clean(modal.querySelector('#crm-book-title').value);
                const author = clean(modal.querySelector('#crm-book-author').value);
                const fileInput = modal.querySelector('#crm-book-file');
                const file = fileInput?.files?.[0];

                if (!title) { errorEl.textContent = 'Title is required.'; errorEl.style.display = 'block'; return; }
                if (!file) { errorEl.textContent = 'Please select a PDF file.'; errorEl.style.display = 'block'; return; }
                if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                    errorEl.textContent = 'Only PDF files are supported.'; errorEl.style.display = 'block'; return;
                }
                if (file.size > 100 * 1024 * 1024) {
                    errorEl.textContent = 'File must be under 100 MB.'; errorEl.style.display = 'block'; return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = 'Preparing...';

                try {
                    const sha256 = await computeSha256(file);

                    const collectionSelect = modal.querySelector('#crm-book-collection');
                    const collectionId = collectionSelect ? collectionSelect.value : (bookCollections[0]?.id || '');

                    const res = await apiPost('/api/admin/books', {
                        title,
                        author,
                        sha256,
                        collectionId,
                        originalFilename: file.name
                    });

                    if (!res.success && res.error === 'DUPLICATE_BOOK') {
                        errorEl.textContent = res.message || 'A book with this file already exists.';
                        errorEl.style.display = 'block';
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Upload';
                        return;
                    }

                    const book = res.book;
                    if (!book?.bookId) throw new Error('No book ID returned');

                    closeModal();

                    books.unshift({
                        bookId: book.bookId,
                        title,
                        author,
                        collectionId: book.collectionId || collectionId,
                        tags: [],
                        status: 'awaiting_upload',
                        ingest: null,
                        pageCount: null,
                        sizeBytes: null,
                        sha256,
                        source: { storagePath: book.storagePath }
                    });
                    if (collectionId) {
                        openFolderIds.add(collectionId);
                        saveOpenFolders();
                    }
                    renderSourcesPanel();

                    await startUpload(book.bookId, book.storagePath || `crm-books/${book.bookId}/source.pdf`, file);
                } catch (err) {
                    console.error('[CRM Books] Create/upload error:', err);
                    errorEl.textContent = err?.message || 'Failed to create book.';
                    errorEl.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Upload';
                }
            });
        }

        async function startUpload(bookId, storagePath, file) {
            try {
                const storageRef = firebaseApp.storage().ref(storagePath);
                uploadTask = storageRef.put(file, { contentType: 'application/pdf' });

                uploadTask.on('state_changed',
                    (snapshot) => {
                        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                        const idx = books.findIndex((b) => b.bookId === bookId);
                        if (idx >= 0) {
                            books[idx] = {
                                ...books[idx],
                                status: 'uploading',
                                ingest: { stage: 'upload', percent: pct, totalPages: 0, totalChunks: 0, embeddedChunks: 0, error: null }
                            };
                            if (!renderListTimer) {
                                renderListTimer = setTimeout(() => { renderListTimer = null; renderSourcesPanel(); }, 250);
                            }
                            if (selectedBookId === bookId) {
                                selectedBook = books[idx];
                                renderExplorerPanel();
                            }
                        }
                    },
                    async (error) => {
                        if (error?.code === 'storage/canceled') {
                            showToast?.('Upload cancelled.', 'info');
                            return;
                        }
                        console.error('[CRM Books] Upload error:', error);
                        showToast?.('Upload failed: ' + (error?.message || 'Unknown error'), 'error');
                        const idx = books.findIndex((b) => b.bookId === bookId);
                        if (idx >= 0) {
                            books[idx].status = 'awaiting_upload';
                            books[idx].ingest = null;
                            renderSourcesPanel();
                            if (selectedBookId === bookId) { selectedBook = books[idx]; renderExplorerPanel(); }
                        }
                    },
                    async () => {
                        uploadTask = null;
                        showToast?.('PDF uploaded. Queuing for processing...', 'info');
                        try {
                            await apiPost(`/api/admin/books/${bookId}/ingest`, {});
                            await refresh();
                            if (selectedBookId === bookId) {
                                attachSnapshot(bookId);
                            }
                        } catch (err) {
                            console.error('[CRM Books] Failed to queue ingest:', err);
                            showToast?.('Uploaded but failed to start processing. You can retry from the book detail.', 'error');
                            await refresh();
                        }
                    }
                );
            } catch (err) {
                console.error('[CRM Books] startUpload error:', err);
                showToast?.('Upload failed: ' + (err?.message || 'Unknown error'), 'error');
            }
        }

        // --- Actions ---
        async function downloadSource(bookId) {
            try {
                const res = await apiGet(`/api/admin/books/${encodeURIComponent(bookId)}/source`);
                const downloadUrl = res?.downloadUrl || res?.data?.downloadUrl;
                if (!downloadUrl) throw new Error('Download link missing from server response.');
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = res?.filename || res?.data?.filename || 'source.pdf';
                link.target = '_blank';
                link.rel = 'noopener';
                link.click();
            } catch (err) {
                console.error('[CRM Books] Source download error:', err);
                showToast?.(err?.message || 'Failed to download source.', 'error');
            }
        }

        function showDownloadSourceModal(initialBookId) {
            const existing = qs('.crm-books-download-modal');
            if (existing) existing.remove();

            if (!books || books.length === 0) {
                showToast?.('No sources available in your library.', 'info');
                return;
            }

            const isDark = document.querySelector('[data-panel="books"]')?.classList.contains('books-dark');
            const darkClass = isDark ? ' books-dark' : '';

            const modal = document.createElement('div');
            modal.className = `crm-modal-overlay crm-books-modal-overlay crm-books-download-modal${darkClass}`;
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'crm-books-download-title');

            const availableBooks = books;
            const initialSelectedMap = {};
            if (initialBookId) {
                initialSelectedMap[initialBookId] = true;
            } else {
                availableBooks.forEach(b => { initialSelectedMap[b.bookId] = true; });
            }

            const itemsHtml = availableBooks.map((b) => {
                const isChecked = !!initialSelectedMap[b.bookId];
                const pageLabel = b.pageCount ? `${b.pageCount} pages` : '';
                const metaStr = [escapeHtml(b.author || ''), pageLabel].filter(Boolean).join(' \u00b7 ');
                return `<label class="crm-books-download-item${isChecked ? ' selected' : ''}" data-book-id="${escapeHtml(b.bookId)}" style="display:flex; align-items:center; gap:12px; padding:10px 14px; border:1px solid var(--books-border, #E8E2D9); border-radius:8px; cursor:pointer; transition:background 0.15s ease, border-color 0.15s ease; user-select:none;">` +
                    `<input type="checkbox" class="crm-books-source-item-cb" data-book-id="${escapeHtml(b.bookId)}" ${isChecked ? 'checked' : ''} style="width:18px; height:18px; accent-color:var(--accent-color, #C25E00); cursor:pointer; flex-shrink:0;">` +
                    `<div style="flex:1; min-width:0;">` +
                    `<div style="font-weight:500; font-size:0.9rem; color:var(--books-text, #2D2926); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(b.title)}</div>` +
                    (metaStr ? `<div class="crm-muted" style="font-size:0.78rem; margin-top:2px;">${metaStr}</div>` : '') +
                    `</div>` +
                    `</label>`;
            }).join('');

            const allInitiallyChecked = availableBooks.length > 0 && availableBooks.every(b => initialSelectedMap[b.bookId]);

            modal.innerHTML =
                `<div class="crm-modal-container crm-books-download-dialog" style="max-width:520px; width:100%;">` +
                `<div class="crm-modal-header" style="padding:16px 20px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--books-border, #E8E2D9);">` +
                `<div style="display:flex; align-items:center; gap:8px;">` +
                `<span style="display:flex; color:var(--accent-color, #C25E00);">${ICON_DOWNLOAD}</span>` +
                `<h2 id="crm-books-download-title" style="margin:0; font-size:1.1rem; font-weight:600;">Download Sources</h2>` +
                `</div>` +
                `<button class="crm-icon-btn crm-books-download-modal-close" title="Close" aria-label="Close modal">${ICON_CLOSE}</button>` +
                `</div>` +
                `<div class="crm-modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:12px; max-height:420px; overflow-y:auto;">` +
                `<p class="crm-muted" style="margin:0; font-size:0.875rem;">Choose which source files to download from your library:</p>` +
                `<div class="crm-books-download-toolbar" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--books-card-bg, #F9F6F0); border:1px solid var(--books-border, #E8E2D9); border-radius:8px;">` +
                `<label style="display:flex; align-items:center; gap:10px; font-weight:600; cursor:pointer; user-select:none; margin:0; font-size:0.9rem;">` +
                `<input type="checkbox" id="crm-books-download-all-cb" ${allInitiallyChecked ? 'checked' : ''} style="width:18px; height:18px; accent-color:var(--accent-color, #C25E00); cursor:pointer;">` +
                `<span>Download all</span>` +
                `</label>` +
                `<span class="crm-books-download-count-badge crm-muted" style="font-size:0.8rem;">0 selected</span>` +
                `</div>` +
                `<div class="crm-books-download-list" style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">` +
                itemsHtml +
                `</div>` +
                `</div>` +
                `<div class="crm-modal-footer" style="padding:12px 20px; display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--books-border, #E8E2D9);">` +
                `<button class="crm-btn-secondary crm-books-download-modal-cancel">Cancel</button>` +
                `<button class="crm-btn-primary crm-books-download-modal-submit">${ICON_DOWNLOAD}<span>Download</span></button>` +
                `</div>` +
                `</div>`;

            document.body.appendChild(modal);
            modal.style.display = 'flex';

            const closeModal = () => {
                modal.style.display = 'none';
                modal.remove();
                document.removeEventListener('keydown', handleEsc);
            };

            const handleEsc = (e) => {
                if (e.key === 'Escape') closeModal();
            };
            document.addEventListener('keydown', handleEsc);

            modal.querySelector('.crm-books-download-modal-close').addEventListener('click', closeModal);
            modal.querySelector('.crm-books-download-modal-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            const downloadAllCb = modal.querySelector('#crm-books-download-all-cb');
            const itemCbs = Array.from(modal.querySelectorAll('.crm-books-source-item-cb'));
            const countBadge = modal.querySelector('.crm-books-download-count-badge');
            const submitBtn = modal.querySelector('.crm-books-download-modal-submit');
            const submitSpan = submitBtn.querySelector('span');

            const updateState = () => {
                const checkedCount = itemCbs.filter(cb => cb.checked).length;
                const totalCount = itemCbs.length;

                if (downloadAllCb) {
                    downloadAllCb.checked = totalCount > 0 && checkedCount === totalCount;
                    downloadAllCb.indeterminate = checkedCount > 0 && checkedCount < totalCount;
                }

                itemCbs.forEach(cb => {
                    const itemLabel = cb.closest('.crm-books-download-item');
                    if (itemLabel) {
                        if (cb.checked) {
                            itemLabel.classList.add('selected');
                            itemLabel.style.borderColor = 'var(--accent-color, #C25E00)';
                        } else {
                            itemLabel.classList.remove('selected');
                            itemLabel.style.borderColor = 'var(--books-border, #E8E2D9)';
                        }
                    }
                });

                if (countBadge) {
                    countBadge.textContent = `${checkedCount} of ${totalCount} selected`;
                }

                if (submitBtn) {
                    submitBtn.disabled = checkedCount === 0;
                    if (submitSpan) {
                        submitSpan.textContent = checkedCount > 0 ? `Download (${checkedCount})` : 'Download';
                    }
                }
            };

            if (downloadAllCb) {
                downloadAllCb.addEventListener('change', () => {
                    const isChecked = downloadAllCb.checked;
                    itemCbs.forEach(cb => { cb.checked = isChecked; });
                    updateState();
                });
            }

            itemCbs.forEach(cb => {
                cb.addEventListener('change', updateState);
            });

            updateState();

            submitBtn.addEventListener('click', async () => {
                const selectedBookIds = itemCbs.filter(cb => cb.checked).map(cb => cb.dataset.bookId).filter(Boolean);
                if (selectedBookIds.length === 0) return;

                submitBtn.disabled = true;
                if (submitSpan) submitSpan.textContent = 'Downloading...';

                showToast?.(`Starting download for ${selectedBookIds.length} source file(s)...`, 'info');

                closeModal();

                for (let i = 0; i < selectedBookIds.length; i++) {
                    const bookId = selectedBookIds[i];
                    try {
                        await downloadSource(bookId);
                    } catch (err) {
                        console.error('[CRM Books] Error in batch download for book:', bookId, err);
                    }
                    if (i < selectedBookIds.length - 1) {
                        await new Promise(r => setTimeout(r, 250));
                    }
                }
            });
        }

        async function deleteBook(bookId) {
            if (!confirm('Delete this book? It will be moved to the recycle bin.')) return;
            try {
                await apiDelete(`/api/admin/books/${bookId}`);
                showToast?.('Book deleted.', 'info');
                books = books.filter((b) => b.bookId !== bookId);
                bookCollections.forEach(c => {
                    if (Array.isArray(c.bookIds)) {
                        c.bookIds = c.bookIds.filter(id => id !== bookId);
                    }
                });
                if (selectedBookId === bookId) {
                    selectedBookId = '';
                    selectedBook = null;
                    selectedSummary = null;
                    detachSnapshot();
                }
                renderAll();
            } catch (err) {
                console.error('[CRM Books] Delete error:', err);
                showToast?.('Failed to delete book.', 'error');
            }
        }

        async function retryIngest(bookId) {
            try {
                await apiPost(`/api/admin/books/${bookId}/ingest`, {});
                showToast?.('Re-queued for processing.', 'info');
                await refresh();
                if (selectedBookId === bookId) {
                    attachSnapshot(bookId);
                }
            } catch (err) {
                console.error('[CRM Books] Retry error:', err);
                showToast?.('Failed to retry.', 'error');
            }
        }

        async function createThread(title = 'New thread') {
            if (!selectedBookId) return null;
            try {
                const threadTitle = clean(title) || 'New thread';
                const res = await apiPost(`/api/admin/books/${selectedBookId}/threads`, { title: threadTitle });
                if (res.threadId) {
                    selectedThreadId = res.threadId;
                    messages = [];
                    threads = [
                        { threadId: res.threadId, title: res.title || threadTitle, messageCount: 0, createdAt: new Date(), updatedAt: new Date() },
                        ...threads.filter((thread) => thread.threadId !== res.threadId)
                    ];
                    renderExplorerPanel();
                }
                return res;
            } catch (err) {
                console.error('[CRM Books] Create thread error:', err);
                showToast?.('Failed to create thread.', 'error');
                return null;
            }
        }

        function startNewChat() {
            selectedThreadId = '';
            messages = [];
            editingThreadId = '';
            editingThreadTitle = '';
            activeTab = 'chat';
            resetPageCitation();
            renderExplorerPanel();
            requestAnimationFrame(() => qs('.crm-books-composer-input')?.focus());
        }

        function beginThreadRename(threadId) {
            const thread = threads.find((item) => item.threadId === threadId);
            if (!thread) return;
            editingThreadId = threadId;
            editingThreadTitle = thread.title || '';
            renderExplorerPanel();
            requestAnimationFrame(() => {
                const input = qs('.crm-books-thread-title-input');
                input?.focus();
                input?.select();
            });
        }

        function cancelThreadRename() {
            editingThreadId = '';
            editingThreadTitle = '';
            renderExplorerPanel();
        }

        async function saveThreadTitle() {
            const threadId = editingThreadId;
            if (!threadId) return;
            const input = qs('.crm-books-thread-title-input');
            const title = clean(input?.value ?? editingThreadTitle);
            if (!title || title.length > MAX_THREAD_TITLE_LENGTH) {
                showToast?.(`Thread name must be between 1 and ${MAX_THREAD_TITLE_LENGTH} characters.`, 'error');
                input?.focus();
                return;
            }
            try {
                const res = await apiPatch(`/api/admin/books/${selectedBookId}/threads/${threadId}`, { title });
                const savedTitle = res.thread?.title || title;
                threads = threads.map((thread) => thread.threadId === threadId ? { ...thread, title: savedTitle } : thread);
                editingThreadId = '';
                editingThreadTitle = '';
                renderExplorerPanel();
                showToast?.('Thread renamed.', 'info');
            } catch (err) {
                console.error('[CRM Books] Rename thread error:', err);
                showToast?.(err?.message || 'Failed to rename thread.', 'error');
            }
        }

        let chatInFlight = false;

        async function sendMessage(text) {
            if (!selectedBookId || chatInFlight) return;
            if (!text || text.length < 2) return;

            chatInFlight = true;

            if (!selectedThreadId) {
                try {
                    const res = await createThread(deriveThreadTitle(text));
                    if (!res?.threadId) throw new Error('Thread creation failed.');
                } catch (err) {
                    chatInFlight = false;
                    console.error('[CRM Books] Auto-create thread failed:', err);
                    showToast?.('Could not start a new conversation.', 'error');
                    return;
                }
            }

            messages.push({ role: 'user', text, citations: [] });
            messages.push({ role: 'assistant', text: '', citations: [], _loading: true });
            renderExplorerPanel();

            let liveInput = qs('.crm-books-composer-input');
            let liveSendBtn = qs('.crm-books-send-btn');
            if (liveSendBtn) liveSendBtn.disabled = true;
            if (liveInput) { liveInput.value = ''; liveInput.disabled = true; }

            try {
                const res = await apiPost(
                    `/api/admin/books/${selectedBookId}/threads/${selectedThreadId}/messages`,
                    { text }
                );

                messages.pop();
                messages.pop();

                if (res.userMessage) messages.push(res.userMessage);
                if (res.assistantMessage) messages.push(res.assistantMessage);

                threads = threads.map((thread) => thread.threadId === selectedThreadId
                    ? { ...thread, messageCount: (thread.messageCount || 0) + 2, updatedAt: new Date() }
                    : thread);

                if (res.quota && res.quota.remaining <= 10) {
                    showToast?.(`${res.quota.remaining} chat messages remaining today.`, 'info');
                }

                renderExplorerPanel();
            } catch (err) {
                console.error('[CRM Books] Chat error:', err);
                messages.pop();
                messages.pop();

                const errorCode = err?.error || err?.code || '';
                if (errorCode === 'QUOTA_EXHAUSTED') {
                    showToast?.('Daily chat limit reached. Resets tomorrow.', 'error');
                } else {
                    showToast?.('Failed to get a response. Your message is still in the box \u2014 try again.', 'error');
                }
                renderExplorerPanel();
                const retryInput = qs('.crm-books-composer-input');
                if (retryInput && errorCode !== 'QUOTA_EXHAUSTED') retryInput.value = text;
            } finally {
                chatInFlight = false;
                liveInput = qs('.crm-books-composer-input');
                liveSendBtn = qs('.crm-books-send-btn');
                if (liveInput) liveInput.disabled = false;
                if (liveSendBtn) liveSendBtn.disabled = false;
            }
        }


        // ─── Phase 2: Text Highlighting ───
        const HIGHLIGHT_COLORS = ['#FDE68A', '#BBF7D0', '#BFDBFE', '#FBCFE8'];
        let activeHighlights = {};

        function getHighlightStorageKey(bookId) {
            return `crm_books_highlights_${bookId}`;
        }

        function loadHighlights(bookId) {
            if (!bookId) return {};
            try {
                const raw = localStorage.getItem(getHighlightStorageKey(bookId));
                return raw ? JSON.parse(raw) : {};
            } catch (_) {
                return {};
            }
        }

        function saveHighlights(bookId, highlights) {
            try {
                localStorage.setItem(getHighlightStorageKey(bookId), JSON.stringify(highlights));
            } catch (_) {
                // ignore storage error
            }
        }

        function addHighlight(bookId, pageNum, text, color) {
            if (!bookId || !text) return null;
            const id = 'hl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            if (!activeHighlights[pageNum]) activeHighlights[pageNum] = [];
            const hl = { id, text, color, createdAt: new Date().toISOString() };
            activeHighlights[pageNum].push(hl);
            saveHighlights(bookId, activeHighlights);
            return id;
        }

        function removeHighlight(bookId, pageNum, highlightId) {
            if (!activeHighlights[pageNum]) return;
            activeHighlights[pageNum] = activeHighlights[pageNum].filter(h => h.id !== highlightId);
            if (activeHighlights[pageNum].length === 0) delete activeHighlights[pageNum];
            saveHighlights(bookId, activeHighlights);
        }

        function applyHighlightsToPage(pageNum) {
            const stage = qs('.crm-books-page-stage');
            if (!stage) return;
            const content = stage.querySelector('.crm-books-page-content');
            if (!content) return;
            const pageHighlights = activeHighlights[pageNum] || [];
            if (pageHighlights.length === 0) return;

            const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);

            for (const hl of pageHighlights) {
                for (const textNode of textNodes) {
                    const idx = textNode.textContent.indexOf(hl.text);
                    if (idx === -1) continue;
                    const range = document.createRange();
                    range.setStart(textNode, idx);
                    range.setEnd(textNode, idx + hl.text.length);
                    const mark = document.createElement('mark');
                    mark.className = 'crm-highlight';
                    mark.style.setProperty('--hl-color', hl.color);
                    mark.dataset.highlightId = hl.id;
                    mark.dataset.pageNum = pageNum;
                    range.surroundContents(mark);
                    break;
                }
            }
        }

        function showHighlightPopup(x, y, selectedText) {
            hideHighlightPopup();
            const popup = document.createElement('div');
            popup.className = 'crm-highlight-popup';
            popup.innerHTML = HIGHLIGHT_COLORS.map(c =>
                `<button class="crm-highlight-color-btn" data-hl-color="${c}" style="background:${c};"></button>`
            ).join('');
            popup.style.left = x + 'px';
            popup.style.top = y + 'px';
            popup.dataset.selectedText = selectedText;
            const stage = qs('.crm-books-page-stage');
            if (stage) {
                stage.style.position = 'relative';
                stage.appendChild(popup);
            }
        }

        function hideHighlightPopup() {
            const existing = document.querySelector('.crm-highlight-popup');
            if (existing) existing.remove();
        }

        // ─── Phase 2: Reading Progress Tracker ───
        let readingProgress = {};

        function getProgressStorageKey(bookId) {
            return `crm_books_progress_${bookId}`;
        }

        function loadProgress(bookId) {
            if (!bookId) return {};
            try {
                const raw = localStorage.getItem(getProgressStorageKey(bookId));
                return raw ? JSON.parse(raw) : {};
            } catch (_) {
                return {};
            }
        }

        function saveProgress(bookId, progress) {
            try {
                localStorage.setItem(getProgressStorageKey(bookId), JSON.stringify(progress));
            } catch (_) {
                // ignore storage error
            }
        }

        function markPageRead(bookId, pageNum) {
            if (!bookId || !pageNum) return;
            if (!readingProgress.pagesRead) readingProgress.pagesRead = {};
            if (readingProgress.pagesRead[pageNum]) return;
            readingProgress.pagesRead[pageNum] = Date.now();
            readingProgress.lastPage = pageNum;
            readingProgress.lastReadAt = Date.now();
            saveProgress(bookId, readingProgress);
        }

        function getProgressPercent(bookId, totalPages) {
            const prog = loadProgress(bookId);
            if (!totalPages || !prog.pagesRead) return 0;
            const readCount = Object.keys(prog.pagesRead).length;
            return Math.round((readCount / totalPages) * 100);
        }

        function renderProgressBar(bookId, totalPages) {
            const pct = getProgressPercent(bookId, totalPages);
            if (pct === 0) return '';
            return `<div class="crm-books-reading-progress"><div class="crm-books-reading-progress-fill" style="width:${pct}%"></div><span class="crm-books-reading-progress-text">${pct}%</span></div>`;
        }

        function renderProgressHeatmap(totalPages) {
            if (!totalPages || !readingProgress.pagesRead) return '';
            let html = '<div class="crm-books-progress-heatmap">';
            for (let p = 1; p <= totalPages; p++) {
                const isRead = !!readingProgress.pagesRead[p];
                html += `<div class="crm-books-progress-cell${isRead ? ' read' : ''}" title="Page ${p}${isRead ? ' ✓' : ''}" data-progress-page="${p}"></div>`;
            }
            html += '</div>';
            return html;
        }

        // ─── Phase 2: Bookmark System ───
        let bookmarks = [];

        function loadBookmarks() {
            try {
                const raw = localStorage.getItem('crm_books_bookmarks');
                return raw ? JSON.parse(raw) : [];
            } catch (_) {
                return [];
            }
        }

        function saveBookmarks() {
            try {
                localStorage.setItem('crm_books_bookmarks', JSON.stringify(bookmarks));
            } catch (_) {
                // ignore storage error
            }
        }

        function addBookmark(bookId, pageNum, label, color) {
            const id = 'bm_' + Date.now();
            const book = books.find(b => b.bookId === bookId);
            bookmarks.push({
                id,
                bookId,
                bookTitle: book?.title || '',
                page: pageNum,
                label: label || `Page ${pageNum}`,
                color: color || HIGHLIGHT_COLORS[0],
                createdAt: new Date().toISOString()
            });
            saveBookmarks();
            return id;
        }

        function removeBookmark(bookmarkId) {
            bookmarks = bookmarks.filter(b => b.id !== bookmarkId);
            saveBookmarks();
        }

        function isPageBookmarked(bookId, pageNum) {
            return bookmarks.some(b => b.bookId === bookId && b.page === pageNum);
        }

        function renderBookmarksPanel() {
            const currentBookmarks = bookmarks.filter(b => b.bookId === selectedBookId);
            const otherBookmarks = bookmarks.filter(b => b.bookId !== selectedBookId);
            let html = '<div class="crm-books-bookmarks-panel">';
            html += '<div class="crm-books-bookmarks-header"><h4>Bookmarks</h4><button class="crm-books-bookmarks-close" title="Close">✕</button></div>';

            if (currentBookmarks.length > 0) {
                html += '<div class="crm-books-bookmarks-group"><h5>This Book</h5>';
                currentBookmarks.forEach(bm => {
                    html += `<div class="crm-books-bookmark-item" data-bookmark-id="${bm.id}" data-book-id="${bm.bookId}" data-page="${bm.page}">` +
                        `<span class="crm-books-bookmark-color" style="background:${bm.color}"></span>` +
                        `<span class="crm-books-bookmark-label">${escapeHtml(bm.label)}</span>` +
                        `<span class="crm-books-bookmark-page">p.${bm.page}</span>` +
                        `<button class="crm-books-bookmark-delete" data-bookmark-id="${bm.id}" title="Remove">✕</button>` +
                        `</div>`;
                });
                html += '</div>';
            }

            if (otherBookmarks.length > 0) {
                html += '<div class="crm-books-bookmarks-group"><h5>Other Books</h5>';
                otherBookmarks.forEach(bm => {
                    html += `<div class="crm-books-bookmark-item" data-bookmark-id="${bm.id}" data-book-id="${bm.bookId}" data-page="${bm.page}">` +
                        `<span class="crm-books-bookmark-color" style="background:${bm.color}"></span>` +
                        `<span class="crm-books-bookmark-label">${escapeHtml(bm.bookTitle)}: ${escapeHtml(bm.label)}</span>` +
                        `<span class="crm-books-bookmark-page">p.${bm.page}</span>` +
                        `<button class="crm-books-bookmark-delete" data-bookmark-id="${bm.id}" title="Remove">✕</button>` +
                        `</div>`;
                });
                html += '</div>';
            }

            if (bookmarks.length === 0) {
                html += '<p class="crm-muted" style="padding:12px;">No bookmarks yet. Use the bookmark button while reading.</p>';
            }
            html += '</div>';
            return html;
        }

        // ─── Phase 3: Send to Chat popup ───
        function showSendToChatPopup(x, y, selectedText) {
            hideSendToChatPopup();
            const popup = document.createElement('div');
            popup.className = 'crm-books-send-to-chat-popup';
            popup.innerHTML = `<button class="crm-books-send-to-chat-btn">💬 Send to Chat</button>`;
            popup.dataset.selectedText = selectedText;
            popup.style.left = x + 'px';
            popup.style.top = y + 'px';
            const stage = qs('.crm-books-page-stage') || qs('.crm-books-split-page');
            if (stage) {
                stage.style.position = 'relative';
                stage.appendChild(popup);
            }
        }

        function hideSendToChatPopup() {
            document.querySelector('.crm-books-send-to-chat-popup')?.remove();
        }

        // ─── Phase 3: Research Compilation ───
        let compilationOpen = false;

        function openCompilationModal() {
            document.querySelector('.crm-books-compile-overlay')?.remove();
            compilationOpen = true;
            const notes = loadBookNotes(selectedBookId);
            const highlights = activeHighlights;
            const mindMapCats = currentMindMapData?.categories || [];

            let html = '<div class="crm-books-compile-overlay">';
            html += '<div class="crm-books-compile-modal">';
            html += '<div class="crm-books-compile-header"><h3>Research Compilation</h3><button class="crm-books-compile-close">✕</button></div>';
            html += '<div class="crm-books-compile-body">';
            html += '<div class="crm-books-compile-sources">';
            html += '<h4>Select sources to include</h4>';

            // Notes section
            if (notes.length > 0) {
                html += '<div class="crm-books-compile-group"><h5>Notes</h5>';
                notes.forEach(n => {
                    const title = n.text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60);
                    html += `<label class="crm-books-compile-item"><input type="checkbox" data-compile-type="note" data-compile-id="${n.id}" checked><span>${escapeHtml(title)}</span></label>`;
                });
                html += '</div>';
            }

            // Highlights section
            const hlPages = Object.keys(highlights);
            if (hlPages.length > 0) {
                html += '<div class="crm-books-compile-group"><h5>Highlights</h5>';
                hlPages.forEach(page => {
                    (highlights[page] || []).forEach(hl => {
                        html += `<label class="crm-books-compile-item"><input type="checkbox" data-compile-type="highlight" data-compile-id="${hl.id}" data-compile-page="${page}" checked><span style="border-left:3px solid ${hl.color}; padding-left:6px;">${escapeHtml(hl.text.slice(0, 80))}</span></label>`;
                    });
                });
                html += '</div>';
            }

            // Mind map branches
            if (mindMapCats.length > 0) {
                html += '<div class="crm-books-compile-group"><h5>Mind Map Branches</h5>';
                mindMapCats.forEach(cat => {
                    html += `<label class="crm-books-compile-item"><input type="checkbox" data-compile-type="mindmap" data-compile-id="${cat.id}"><span>${escapeHtml(cat.title || '')}</span></label>`;
                });
                html += '</div>';
            }

            // Chat messages
            if (messages.length > 0) {
                html += '<div class="crm-books-compile-group"><h5>Chat Messages</h5>';
                html += `<label class="crm-books-compile-item"><input type="checkbox" data-compile-type="chat" data-compile-id="all"><span>Include current chat thread (${messages.length} messages)</span></label>`;
                html += '</div>';
            }

            html += '</div>'; // sources
            html += '<div class="crm-books-compile-preview"><div class="crm-books-compile-preview-placeholder">Select sources and click "Compile" to generate a research document.</div></div>';
            html += '</div>'; // body
            html += '<div class="crm-books-compile-footer"><button class="crm-books-compile-run crm-btn crm-btn-primary">Compile with AI</button><button class="crm-books-compile-download crm-btn crm-btn-secondary" disabled>Download .md</button></div>';
            html += '</div></div>';

            document.body.insertAdjacentHTML('beforeend', html);
        }

        function closeCompilationModal() {
            compilationOpen = false;
            document.querySelector('.crm-books-compile-overlay')?.remove();
        }

        function gatherCompilationSources() {
            const overlay = document.querySelector('.crm-books-compile-overlay');
            if (!overlay) return { notes: [], highlights: [], mindMapBranches: [], chatMessages: [] };

            const checked = [...overlay.querySelectorAll('input[type="checkbox"]:checked')];
            const result = { notes: [], highlights: [], mindMapBranches: [], chatMessages: [] };

            checked.forEach(cb => {
                const type = cb.dataset.compileType;
                const id = cb.dataset.compileId;
                if (type === 'note') {
                    const allNotes = loadBookNotes(selectedBookId);
                    const n = allNotes.find(n => n.id === id);
                    if (n) result.notes.push(n.text);
                } else if (type === 'highlight') {
                    const page = cb.dataset.compilePage;
                    const hl = (activeHighlights[page] || []).find(h => h.id === id);
                    if (hl) result.highlights.push({ text: hl.text, page });
                } else if (type === 'mindmap') {
                    const cat = (currentMindMapData?.categories || []).find(c => c.id === id);
                    if (cat) {
                        const subtopics = (cat.subtopics || []).map(s => `  - ${s.title}: ${s.summary || ''}`).join('\n');
                        result.mindMapBranches.push(`${cat.title}\n${subtopics}`);
                    }
                } else if (type === 'chat' && id === 'all') {
                    result.chatMessages = messages.map(m => `${m.role === 'user' ? 'Q' : 'A'}: ${m.text || ''}`);
                }
            });
            return result;
        }

        async function runCompilation() {
            const sources = gatherCompilationSources();
            const preview = document.querySelector('.crm-books-compile-preview');
            const runBtn = document.querySelector('.crm-books-compile-run');
            const dlBtn = document.querySelector('.crm-books-compile-download');
            if (!preview || !runBtn) return;

            runBtn.disabled = true;
            runBtn.textContent = 'Compiling…';
            preview.innerHTML = '<div class="crm-books-compile-preview-placeholder">AI is synthesizing your research…</div>';

            try {
                const res = await apiPost(`/api/admin/books/${selectedBookId}/compile`, {
                    bookTitle: selectedBook?.title || '',
                    sources
                });
                const markdown = res.markdown || res.document || '# Research Compilation\n\nNo content generated.';
                preview.innerHTML = `<pre class="crm-books-compile-result">${escapeHtml(markdown)}</pre>`;
                preview.dataset.compiledMarkdown = markdown;
                if (dlBtn) dlBtn.disabled = false;
            } catch (err) {
                preview.innerHTML = `<div class="crm-books-compile-preview-placeholder" style="color:#dc2626;">Compilation failed: ${escapeHtml(err.message || 'Unknown error')}</div>`;
            } finally {
                runBtn.disabled = false;
                runBtn.textContent = 'Compile with AI';
            }
        }

        function downloadCompilation() {
            const preview = document.querySelector('.crm-books-compile-preview');
            const md = preview?.dataset.compiledMarkdown;
            if (!md) return;
            const blob = new Blob([md], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(selectedBook?.title || 'research').replace(/[^a-zA-Z0-9]/g, '_')}_compilation.md`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        // ─── Phase 4: Cross-Book Knowledge Graph ───
        let bookLinks = [];
        let knowledgeGraphOpen = false;

        async function loadBookLinks() {
            try {
                const res = await apiGet('/api/admin/book-links');
                bookLinks = Array.isArray(res?.links) ? res.links : [];
            } catch (_) {
                bookLinks = [];
            }
        }

        async function createBookLink(sourceBookId, sourceNodeId, sourceTitle, targetBookId, targetNodeId, targetTitle, label) {
            try {
                const res = await apiPost('/api/admin/book-links', {
                    sourceBookId, sourceNodeId, sourceTitle,
                    targetBookId, targetNodeId, targetTitle,
                    label: label || 'related'
                });
                bookLinks.push({ id: res.id, sourceBookId, sourceNodeId, sourceTitle, targetBookId, targetNodeId, targetTitle, label });
                return res.id;
            } catch (err) {
                showToast?.('Failed to create link: ' + (err.message || ''), 'error');
                return null;
            }
        }

        async function deleteBookLink(linkId) {
            try {
                await apiDelete(`/api/admin/book-links/${linkId}`);
                bookLinks = bookLinks.filter(l => l.id !== linkId);
            } catch (err) {
                showToast?.('Failed to delete link.', 'error');
            }
        }

        function openKnowledgeGraph() {
            knowledgeGraphOpen = true;
            loadBookLinks().then(() => renderKnowledgeGraphModal());
        }

        function closeKnowledgeGraph() {
            knowledgeGraphOpen = false;
            document.querySelector('.crm-books-kg-overlay')?.remove();
        }

        function renderKnowledgeGraphModal() {
            document.querySelector('.crm-books-kg-overlay')?.remove();

            const bookNodes = books.filter(b => b.status === 'ready').map(b => ({
                id: b.bookId,
                title: b.title,
                type: 'book'
            }));

            const linkEdges = bookLinks.map(l => ({
                source: l.sourceBookId,
                target: l.targetBookId,
                label: l.label || 'related',
                id: l.id
            }));

            const nodeRadius = 200;
            const cx = 400, cy = 300;
            const nodePositions = {};
            bookNodes.forEach((n, i) => {
                const angle = (2 * Math.PI * i) / bookNodes.length - Math.PI / 2;
                nodePositions[n.id] = { x: cx + nodeRadius * Math.cos(angle), y: cy + nodeRadius * Math.sin(angle) };
            });

            let svgEdges = linkEdges.map(e => {
                const s = nodePositions[e.source];
                const t = nodePositions[e.target];
                if (!s || !t) return '';
                return `<line x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}" stroke="#94a3b8" stroke-width="2" data-link-id="${e.id}"/>` +
                    `<text x="${(s.x + t.x) / 2}" y="${(s.y + t.y) / 2 - 8}" fill="#64748b" font-size="11" text-anchor="middle">${escapeHtml(e.label)}</text>`;
            }).join('');

            let svgNodes = bookNodes.map(n => {
                const pos = nodePositions[n.id];
                const isSelected = n.id === selectedBookId;
                return `<g class="crm-books-kg-node" data-kg-book-id="${n.id}" style="cursor:pointer;">` +
                    `<circle cx="${pos.x}" cy="${pos.y}" r="30" fill="${isSelected ? '#3B82F6' : '#E2E8F0'}" stroke="${isSelected ? '#1D4ED8' : '#94A3B8'}" stroke-width="2"/>` +
                    `<text x="${pos.x}" y="${pos.y + 45}" fill="#334155" font-size="12" text-anchor="middle" font-weight="500">${escapeHtml(n.title.slice(0, 20))}</text>` +
                    `<text x="${pos.x}" y="${pos.y + 5}" fill="${isSelected ? '#fff' : '#334155'}" font-size="16" text-anchor="middle">📖</text>` +
                    `</g>`;
            }).join('');

            let html = '<div class="crm-books-kg-overlay">';
            html += '<div class="crm-books-kg-modal">';
            html += '<div class="crm-books-kg-header"><h3>Knowledge Graph</h3><div class="crm-books-kg-actions">';
            html += '<button class="crm-books-kg-add-link crm-btn crm-btn-secondary crm-btn-sm">+ Link Books</button>';
            html += '<button class="crm-books-kg-close">✕</button></div></div>';
            html += `<div class="crm-books-kg-viewport"><svg viewBox="0 0 800 600" width="100%" height="100%">${svgEdges}${svgNodes}</svg></div>`;

            if (bookLinks.length > 0) {
                html += '<div class="crm-books-kg-links-list"><h4>Links</h4>';
                bookLinks.forEach(l => {
                    html += `<div class="crm-books-kg-link-item"><span>${escapeHtml(l.sourceTitle || l.sourceBookId)} → ${escapeHtml(l.targetTitle || l.targetBookId)}</span><span class="crm-books-kg-link-label">${escapeHtml(l.label || '')}</span><button class="crm-books-kg-link-delete" data-link-id="${l.id}">✕</button></div>`;
                });
                html += '</div>';
            }

            html += '</div></div>';
            document.body.insertAdjacentHTML('beforeend', html);
        }

        function showLinkBooksPicker() {
            const overlay = document.querySelector('.crm-books-kg-overlay');
            if (!overlay) return;
            const existingPicker = overlay.querySelector('.crm-books-kg-picker');
            if (existingPicker) { existingPicker.remove(); return; }

            const readyBooks = books.filter(b => b.status === 'ready');
            let html = '<div class="crm-books-kg-picker">';
            html += '<h4>Create Link</h4>';
            html += '<label>From:<select class="crm-books-kg-from">' + readyBooks.map(b => `<option value="${b.bookId}"${b.bookId === selectedBookId ? ' selected' : ''}>${escapeHtml(b.title)}</option>`).join('') + '</select></label>';
            html += '<label>To:<select class="crm-books-kg-to">' + readyBooks.map(b => `<option value="${b.bookId}">${escapeHtml(b.title)}</option>`).join('') + '</select></label>';
            html += '<label>Label:<input class="crm-books-kg-label" type="text" value="related" placeholder="e.g. related, builds on, contrasts"></label>';
            html += '<button class="crm-books-kg-confirm crm-btn crm-btn-primary crm-btn-sm">Create Link</button>';
            html += '</div>';
            overlay.querySelector('.crm-books-kg-modal')?.insertAdjacentHTML('beforeend', html);
        }

        // ─── Phase 4: Shareable Mind Map Links ───
        async function shareMindMap() {
            if (!selectedBookId) return;
            try {
                const res = await apiPost(`/api/admin/books/${selectedBookId}/mind-map/share`, {});
                const shareUrl = window.location.origin + (res.shareUrl || '');
                await navigator.clipboard?.writeText(shareUrl).catch(() => {});
                showToast?.(`Share link copied! Expires in 30 days.\n${shareUrl}`, 'info');
            } catch (err) {
                showToast?.('Failed to create share link: ' + (err.message || ''), 'error');
            }
        }

        // ─── Phase 4: Shared Book Collections & Tags ───
        let bookCollections = [];
        let activeCollectionFilter = '';

        async function loadBookCollections() {
            try {
                const res = await apiGet('/api/admin/book-collections');
                bookCollections = Array.isArray(res?.collections) ? res.collections : [];
                if (openFolderIds.size === 0 && bookCollections.length > 0) {
                    bookCollections.forEach(c => openFolderIds.add(c.id));
                    saveOpenFolders();
                }
            } catch (_) {
                bookCollections = [];
            }
        }

        async function loadBookTags() {
            try {
                const res = await apiGet('/api/admin/book-tags');
                bookTags = Array.isArray(res?.tags) ? res.tags : [];
            } catch (_) {
                bookTags = [];
            }
        }

        async function createBookCollection(name, description, bookIds) {
            const cleanName = clean(name);
            if (!cleanName) {
                showToast?.('Collection name is required.', 'warning');
                return null;
            }
            if (bookCollections.some(c => c.name.trim().toLowerCase() === cleanName.toLowerCase())) {
                showToast?.(`A collection named "${cleanName}" already exists.`, 'warning');
                return null;
            }
            try {
                const res = await apiPost('/api/admin/book-collections', { name: cleanName, description, bookIds });
                const newCol = { id: res.id, name: cleanName, description, bookIds: bookIds || [] };
                bookCollections.push(newCol);
                openFolderIds.add(res.id);
                saveOpenFolders();

                if (Array.isArray(bookIds) && bookIds.length > 0) {
                    bookIds.forEach(bId => {
                        const b = books.find(item => item.bookId === bId);
                        if (b) b.collectionId = res.id;
                    });
                    bookCollections.forEach(c => {
                        if (c.id !== res.id && Array.isArray(c.bookIds)) {
                            c.bookIds = c.bookIds.filter(id => !bookIds.includes(id));
                        }
                    });
                }

                showToast?.('Collection created.', 'info');
                renderSourcesPanel();
                if (selectedBook) renderExplorerPanel();
                return newCol;
            } catch (err) {
                showToast?.(err?.message || 'Failed to create collection.', 'error');
                return null;
            }
        }

        async function renameBookCollection(collectionId) {
            const col = bookCollections.find(c => c.id === collectionId);
            if (!col) return;
            const newName = prompt('New collection name:', col.name);
            if (!newName || !newName.trim() || newName.trim() === col.name) return;
            const cleanName = newName.trim();
            if (bookCollections.some(c => c.id !== collectionId && c.name.trim().toLowerCase() === cleanName.toLowerCase())) {
                showToast?.(`A collection named "${cleanName}" already exists.`, 'warning');
                return;
            }
            try {
                await apiPatch(`/api/admin/book-collections/${collectionId}`, { name: cleanName });
                col.name = cleanName;
                renderSourcesPanel();
                if (selectedBook) renderExplorerPanel();
                showToast?.('Collection renamed.', 'info');
            } catch (err) {
                showToast?.(err?.message || 'Failed to rename collection.', 'error');
            }
        }

        async function deleteBookCollection(collectionId) {
            const col = bookCollections.find(c => c.id === collectionId);
            if (!col) return;
            const bookCount = (col.bookIds || []).length;
            if (bookCollections.length <= 1) {
                showToast?.('Cannot delete the only collection. At least one collection must exist.', 'warning');
                return;
            }
            if (bookCount > 0) {
                const otherCol = bookCollections.find(c => c.id !== collectionId);
                const confirmMsg = `Collection "${col.name}" contains ${bookCount} book(s). Move them to "${otherCol.name}" and delete this collection?`;
                if (!confirm(confirmMsg)) return;
                try {
                    await apiDelete(`/api/admin/book-collections/${collectionId}`, { targetCollectionId: otherCol.id });
                    col.bookIds.forEach(bId => {
                        const b = books.find(item => item.bookId === bId);
                        if (b) b.collectionId = otherCol.id;
                    });
                    if (!otherCol.bookIds) otherCol.bookIds = [];
                    otherCol.bookIds = Array.from(new Set([...otherCol.bookIds, ...col.bookIds]));
                    bookCollections = bookCollections.filter(c => c.id !== collectionId);
                    openFolderIds.delete(collectionId);
                    openFolderIds.add(otherCol.id);
                    saveOpenFolders();
                    showToast?.(`Collection deleted. Books moved to "${otherCol.name}".`, 'info');
                    renderSourcesPanel();
                    if (selectedBook) renderExplorerPanel();
                } catch (err) {
                    showToast?.('Failed to delete collection.', 'error');
                }
            } else {
                if (!confirm(`Delete empty collection "${col.name}"?`)) return;
                try {
                    await apiDelete(`/api/admin/book-collections/${collectionId}`);
                    bookCollections = bookCollections.filter(c => c.id !== collectionId);
                    openFolderIds.delete(collectionId);
                    saveOpenFolders();
                    showToast?.('Collection deleted.', 'info');
                    renderSourcesPanel();
                } catch (err) {
                    showToast?.('Failed to delete collection.', 'error');
                }
            }
        }

        async function moveBookToCollection(bookId, targetCollectionId) {
            const book = books.find(b => b.bookId === bookId);
            if (!book) return;
            const oldColId = book.collectionId;
            if (oldColId === targetCollectionId) return;

            book.collectionId = targetCollectionId;
            openFolderIds.add(targetCollectionId);
            saveOpenFolders();

            bookCollections.forEach(c => {
                if (!Array.isArray(c.bookIds)) c.bookIds = [];
                if (c.id === targetCollectionId && !c.bookIds.includes(bookId)) {
                    c.bookIds.push(bookId);
                } else if (c.id !== targetCollectionId && c.bookIds.includes(bookId)) {
                    c.bookIds = c.bookIds.filter(id => id !== bookId);
                }
            });

            renderSourcesPanel();
            if (selectedBookId === bookId) {
                selectedBook = book;
                renderExplorerPanel();
            }

            try {
                await apiPatch(`/api/admin/books/${bookId}/collection`, { collectionId: targetCollectionId });
                showToast?.('Book moved to collection.', 'info');
            } catch (err) {
                showToast?.('Failed to move book to collection.', 'error');
            }
        }

        async function createBookTag(name, color = '#10b981') {
            const cleanName = clean(name);
            if (!cleanName) return null;
            try {
                const res = await apiPost('/api/admin/book-tags', { name: cleanName, color });
                const tagObj = { id: res.id, name: cleanName, color };
                const existingIdx = bookTags.findIndex(t => t.id === res.id || t.name.toLowerCase() === cleanName.toLowerCase());
                if (existingIdx >= 0) {
                    bookTags[existingIdx] = tagObj;
                } else {
                    bookTags.push(tagObj);
                }
                renderSidebarTagFilter();
                renderSourcesPanel();
                if (selectedBook) renderExplorerPanel();
                return tagObj;
            } catch (err) {
                showToast?.('Failed to create tag: ' + (err.message || ''), 'error');
                return null;
            }
        }

        async function deleteBookTag(tagId) {
            try {
                await apiDelete(`/api/admin/book-tags/${tagId}`);
                bookTags = bookTags.filter(t => t.id !== tagId);
                activeSidebarTagFilters.delete(tagId);
                books.forEach(b => {
                    if (b.tags) b.tags = b.tags.filter(t => t !== tagId);
                });
                renderSidebarTagFilter();
                renderSourcesPanel();
                if (selectedBook) renderExplorerPanel();
                showToast?.('Tag deleted.', 'info');
            } catch (err) {
                showToast?.('Failed to delete tag.', 'error');
            }
        }

        async function toggleBookTag(bookId, tagIdOrName) {
            const book = books.find(b => b.bookId === bookId);
            if (!book) return;
            if (!Array.isArray(book.tags)) book.tags = [];

            let tagObj = bookTags.find(t => t.id === tagIdOrName || t.name.toLowerCase() === tagIdOrName.toLowerCase());
            if (!tagObj) {
                tagObj = await createBookTag(tagIdOrName);
                if (!tagObj) return;
            }

            const tagId = tagObj.id;
            const hasTag = book.tags.includes(tagId) || book.tags.includes(tagObj.name);

            if (hasTag) {
                book.tags = book.tags.filter(t => t !== tagId && t !== tagObj.name);
            } else {
                book.tags.push(tagId);
            }

            renderSourcesPanel();
            renderSidebarTagFilter();
            if (selectedBookId === bookId) {
                selectedBook = book;
                renderExplorerPanel();
            }

            try {
                await apiPatch(`/api/admin/books/${bookId}/tags`, { tags: book.tags });
            } catch (err) {
                showToast?.('Failed to update book tags.', 'error');
            }
        }

        function renderSidebarTagFilter() {
            const bar = qs('.crm-books-sidebar-tag-filter-bar');
            if (!bar) return;
            if (bookTags.length === 0) {
                bar.innerHTML = '';
                bar.style.display = 'none';
                return;
            }
            bar.style.display = 'flex';
            let html = `<button type="button" class="crm-books-sidebar-tag-pill${activeSidebarTagFilters.size === 0 ? ' active' : ''}" data-sidebar-tag-id="">All</button>`;
            bookTags.forEach(t => {
                const count = books.filter(b => (b.tags || []).includes(t.id) || (b.tags || []).includes(t.name)).length;
                const isActive = activeSidebarTagFilters.has(t.id);
                html += `<button type="button" class="crm-books-sidebar-tag-pill${isActive ? ' active' : ''}" data-sidebar-tag-id="${escapeHtml(t.id)}" style="${isActive ? `background:${t.color || '#0f766e'}; border-color:${t.color || '#0f766e'}; color:#fff;` : ''}">🏷️ ${escapeHtml(t.name)} (${count})</button>`;
            });
            if (activeSidebarTagFilters.size > 0) {
                html += `<button type="button" class="crm-books-sidebar-tag-pill clear-btn" data-clear-sidebar-tags="1">Clear</button>`;
            }
            bar.innerHTML = html;
        }

        function openNewCollectionModal() {
            document.querySelector('#crm-books-new-collection-modal')?.remove();

            const modalTagFilter = new Set();
            let modalMatchMode = 'and';
            let modalSearchQuery = '';
            const selectedBookIds = new Set(selectedBookId ? [selectedBookId] : []);

            function getFilteredModalBooks() {
                let list = books;
                if (modalSearchQuery) {
                    const q = modalSearchQuery.toLowerCase();
                    list = list.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
                }
                if (modalTagFilter.size > 0) {
                    const tagIds = Array.from(modalTagFilter);
                    list = filterBooksByTags(list, tagIds, modalMatchMode);
                }
                return list;
            }

            function renderModal() {
                const filteredBooks = getFilteredModalBooks();
                const tagChipsHtml = bookTags.map(t => {
                    const isSelected = modalTagFilter.has(t.id) || modalTagFilter.has(t.name);
                    const count = books.filter(b => (b.tags || []).includes(t.id) || (b.tags || []).includes(t.name)).length;
                    return `<button type="button" class="crm-books-sidebar-tag-pill${isSelected ? ' active' : ''}" data-modal-tag-id="${escapeHtml(t.id)}">🏷️ ${escapeHtml(t.name)} (${count})</button>`;
                }).join('');

                const booksChecklistHtml = filteredBooks.length === 0
                    ? `<div style="padding:16px; text-align:center; color:#94a3b8; font-size:0.8rem;">No books match the filters.</div>`
                    : filteredBooks.map(b => {
                        const isChecked = selectedBookIds.has(b.bookId);
                        const curCol = bookCollections.find(c => c.id === b.collectionId);
                        const colName = curCol ? curCol.name : 'Pronunciation';
                        const tagsStr = (b.tags || []).map(tId => {
                            const tObj = bookTags.find(t => t.id === tId || t.name.toLowerCase() === tId.toLowerCase());
                            return tObj ? tObj.name : tId;
                        }).join(', ');

                        return `<label class="crm-books-candidate-item${isChecked ? ' selected' : ''}" data-modal-book-id="${escapeHtml(b.bookId)}">` +
                            `<input type="checkbox" class="crm-books-candidate-cb" data-book-id="${escapeHtml(b.bookId)}"${isChecked ? ' checked' : ''}/>` +
                            `<div class="crm-books-candidate-info">` +
                            `<div class="crm-books-candidate-title">${escapeHtml(b.title)}</div>` +
                            `<div class="crm-books-candidate-sub">` +
                            `<span>${escapeHtml(b.author || 'Unknown author')}</span>` +
                            `<span class="crm-books-candidate-current-col">📁 In ${escapeHtml(colName)}</span>` +
                            (tagsStr ? `<span>🏷️ ${escapeHtml(tagsStr)}</span>` : '') +
                            `</div>` +
                            `</div>` +
                            `</label>`;
                    }).join('');

                const panel = document.querySelector('.crm-books-panel');
                const isDark = panel?.classList.contains('books-dark');
                const html = `
                <div id="crm-books-new-collection-modal" class="crm-books-modal-overlay${isDark ? ' books-dark' : ''}">
                  <div class="crm-books-modal-card">
                    <div class="crm-books-modal-header">
                      <h3>📁 Create New Collection</h3>
                      <button type="button" class="crm-books-modal-close-btn" data-modal-close="1">✕</button>
                    </div>
                    <div class="crm-books-modal-body">
                      <div style="margin-bottom: 14px;">
                        <label style="display:block; font-size:0.8rem; font-weight:600; margin-bottom:4px; color:var(--books-text,#334155);">Collection Name *</label>
                        <input type="text" id="crm-books-new-col-name" class="crm-input" style="width:100%; box-sizing:border-box; padding:8px 10px; font-size:0.85rem;" placeholder="e.g. Acoustic Phonetics" autofocus />
                      </div>

                      <div style="margin-bottom: 8px;">
                        <label style="display:block; font-size:0.8rem; font-weight:600; margin-bottom:4px; color:var(--books-text,#334155);">Select Books for Collection</label>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                          <div style="display:flex; align-items:center; gap:8px; font-size:0.75rem; color:#64748b;">
                            <span>Filter by Tag:</span>
                            <label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;">
                              <input type="radio" name="modal_match_mode" value="and" ${modalMatchMode === 'and' ? 'checked' : ''} /> Match All (AND)
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;">
                              <input type="radio" name="modal_match_mode" value="or" ${modalMatchMode === 'or' ? 'checked' : ''} /> Match Any (OR)
                            </label>
                          </div>
                        </div>
                        <div class="crm-books-sidebar-tag-filter-bar" style="padding: 2px 0 6px;">
                          ${tagChipsHtml || '<span style="color:#94a3b8; font-size:0.75rem;">No tags created yet.</span>'}
                        </div>
                        <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
                          <input type="text" id="crm-books-modal-search" class="crm-input" style="flex:1; padding:5px 8px; font-size:0.75rem;" placeholder="Search books in list below..." value="${escapeHtml(modalSearchQuery)}" />
                          <button type="button" class="crm-btn crm-btn-sm crm-btn-secondary" id="crm-books-modal-select-all">Select All Filtered</button>
                          <button type="button" class="crm-btn crm-btn-sm crm-btn-secondary" id="crm-books-modal-deselect-all">Deselect All</button>
                        </div>
                      </div>

                      <div class="crm-books-candidate-list">
                        ${booksChecklistHtml}
                      </div>
                      <div style="font-size:0.72rem; color:#64748b; margin-top:6px; display:flex; justify-content:space-between;">
                        <span>Selected: <strong id="crm-books-selected-count">${selectedBookIds.size}</strong> book(s)</span>
                        <span>Showing: ${filteredBooks.length} of ${books.length}</span>
                      </div>
                    </div>
                    <div class="crm-books-modal-footer">
                      <button type="button" class="crm-btn crm-btn-secondary" data-modal-close="1">Cancel</button>
                      <button type="button" class="crm-btn crm-btn-primary" id="crm-books-modal-submit-btn">Create Collection</button>
                    </div>
                  </div>
                </div>
                `;

                document.body.insertAdjacentHTML('beforeend', html);
                bindModal();
            }

            function bindModal() {
                const overlay = document.querySelector('#crm-books-new-collection-modal');
                if (!overlay) return;

                function closeModal() {
                    overlay.remove();
                    document.removeEventListener('keydown', escHandler);
                }

                const escHandler = (e) => {
                    if (e.key === 'Escape') closeModal();
                };
                document.addEventListener('keydown', escHandler);

                overlay.querySelectorAll('[data-modal-close]').forEach(btn => {
                    btn.onclick = closeModal;
                });
                overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

                const nameInput = overlay.querySelector('#crm-books-new-col-name');
                if (nameInput) setTimeout(() => nameInput.focus(), 50);

                overlay.querySelectorAll('[data-modal-tag-id]').forEach(chip => {
                    chip.onclick = () => {
                        const tId = chip.dataset.modalTagId;
                        if (modalTagFilter.has(tId)) modalTagFilter.delete(tId);
                        else modalTagFilter.add(tId);
                        refreshChecklist();
                    };
                });

                overlay.querySelectorAll('input[name="modal_match_mode"]').forEach(radio => {
                    radio.onchange = () => {
                        modalMatchMode = radio.value;
                        refreshChecklist();
                    };
                });

                const searchInput = overlay.querySelector('#crm-books-modal-search');
                if (searchInput) {
                    searchInput.oninput = (e) => {
                        modalSearchQuery = clean(e.target.value);
                        refreshChecklist();
                    };
                }

                const selectAllBtn = overlay.querySelector('#crm-books-modal-select-all');
                if (selectAllBtn) {
                    selectAllBtn.onclick = () => {
                        getFilteredModalBooks().forEach(b => selectedBookIds.add(b.bookId));
                        refreshChecklist();
                    };
                }
                const deselectAllBtn = overlay.querySelector('#crm-books-modal-deselect-all');
                if (deselectAllBtn) {
                    deselectAllBtn.onclick = () => {
                        getFilteredModalBooks().forEach(b => selectedBookIds.delete(b.bookId));
                        refreshChecklist();
                    };
                }

                overlay.querySelectorAll('.crm-books-candidate-cb').forEach(cb => {
                    cb.onchange = () => {
                        const bId = cb.dataset.bookId;
                        if (cb.checked) selectedBookIds.add(bId);
                        else selectedBookIds.delete(bId);
                        const countEl = overlay.querySelector('#crm-books-selected-count');
                        if (countEl) countEl.textContent = String(selectedBookIds.size);
                        cb.closest('.crm-books-candidate-item')?.classList.toggle('selected', cb.checked);
                    };
                });

                const submitBtn = overlay.querySelector('#crm-books-modal-submit-btn');
                if (submitBtn) {
                    submitBtn.onclick = async () => {
                        const name = clean(nameInput?.value);
                        if (!name) {
                            alert('Please enter a collection name.');
                            nameInput?.focus();
                            return;
                        }
                        submitBtn.disabled = true;
                        submitBtn.textContent = 'Creating...';
                        await createBookCollection(name, '', Array.from(selectedBookIds));
                        overlay.remove();
                    };
                }

                function refreshChecklist() {
                    const listContainer = overlay.querySelector('.crm-books-candidate-list');
                    const filtered = getFilteredModalBooks();
                    if (listContainer) {
                        listContainer.innerHTML = filtered.length === 0
                            ? `<div style="padding:16px; text-align:center; color:#94a3b8; font-size:0.8rem;">No books match the filters.</div>`
                            : filtered.map(b => {
                                const isChecked = selectedBookIds.has(b.bookId);
                                const curCol = bookCollections.find(c => c.id === b.collectionId);
                                const colName = curCol ? curCol.name : 'Pronunciation';
                                const tagsStr = (b.tags || []).map(tId => {
                                    const tObj = bookTags.find(t => t.id === tId || t.name.toLowerCase() === tId.toLowerCase());
                                    return tObj ? tObj.name : tId;
                                }).join(', ');

                                return `<label class="crm-books-candidate-item${isChecked ? ' selected' : ''}" data-modal-book-id="${escapeHtml(b.bookId)}">` +
                                    `<input type="checkbox" class="crm-books-candidate-cb" data-book-id="${escapeHtml(b.bookId)}"${isChecked ? ' checked' : ''}/>` +
                                    `<div class="crm-books-candidate-info">` +
                                    `<div class="crm-books-candidate-title">${escapeHtml(b.title)}</div>` +
                                    `<div class="crm-books-candidate-sub">` +
                                    `<span>${escapeHtml(b.author || 'Unknown author')}</span>` +
                                    `<span class="crm-books-candidate-current-col">📁 In ${escapeHtml(colName)}</span>` +
                                    (tagsStr ? `<span>🏷️ ${escapeHtml(tagsStr)}</span>` : '') +
                                    `</div>` +
                                    `</div>` +
                                    `</label>`;
                            }).join('');

                        listContainer.querySelectorAll('.crm-books-candidate-cb').forEach(cb => {
                            cb.onchange = () => {
                                const bId = cb.dataset.bookId;
                                if (cb.checked) selectedBookIds.add(bId);
                                else selectedBookIds.delete(bId);
                                const countEl = overlay.querySelector('#crm-books-selected-count');
                                if (countEl) countEl.textContent = String(selectedBookIds.size);
                                cb.closest('.crm-books-candidate-item')?.classList.toggle('selected', cb.checked);
                            };
                        });
                    }

                    const countEl = overlay.querySelector('#crm-books-selected-count');
                    if (countEl) countEl.textContent = String(selectedBookIds.size);

                    overlay.querySelectorAll('[data-modal-tag-id]').forEach(chip => {
                        const tId = chip.dataset.modalTagId;
                        chip.classList.toggle('active', modalTagFilter.has(tId));
                    });
                }
            }

            renderModal();
        }

        function openCreateTagModal() {
            document.querySelector('#crm-books-create-tag-modal')?.remove();

            const PRESET_COLORS = [
                { name: 'Emerald', color: '#10b981' },
                { name: 'Indigo', color: '#6366f1' },
                { name: 'Amber', color: '#f59e0b' },
                { name: 'Purple', color: '#a855f7' },
                { name: 'Rose', color: '#f43f5e' },
                { name: 'Cyan', color: '#06b6d4' }
            ];
            let selectedColor = PRESET_COLORS[0].color;

            const colorDotsHtml = PRESET_COLORS.map((c, i) => `
                <div class="crm-books-color-dot${i === 0 ? ' active' : ''}" data-color="${c.color}" style="background:${c.color};" title="${c.name}"></div>
            `).join('');

            const isDark = panel?.classList.contains('books-dark');
            const html = `
            <div id="crm-books-create-tag-modal" class="crm-books-modal-overlay${isDark ? ' books-dark' : ''}">
              <div class="crm-books-modal-card" style="max-width: 420px;">
                <div class="crm-books-modal-header">
                  <h3>🏷️ Create New Tag</h3>
                  <button type="button" class="crm-books-modal-close-btn" data-modal-close="1">✕</button>
                </div>
                <div class="crm-books-modal-body">
                  <div style="margin-bottom: 14px;">
                    <label style="display:block; font-size:0.8rem; font-weight:600; margin-bottom:4px; color:var(--books-text,#334155);">Tag Name *</label>
                    <input type="text" id="crm-books-new-tag-name" class="crm-input" style="width:100%; box-sizing:border-box; padding:8px 10px; font-size:0.85rem;" placeholder="e.g. Phonetics" autofocus />
                  </div>
                  <div>
                    <label style="display:block; font-size:0.8rem; font-weight:600; margin-bottom:4px; color:var(--books-text,#334155);">Color</label>
                    <div class="crm-books-color-picker">
                      ${colorDotsHtml}
                    </div>
                  </div>
                </div>
                <div class="crm-books-modal-footer">
                  <button type="button" class="crm-btn crm-btn-secondary" data-modal-close="1">Cancel</button>
                  <button type="button" class="crm-btn crm-btn-primary" id="crm-books-create-tag-submit-btn">Create Tag</button>
                </div>
              </div>
            </div>
            `;

            document.body.insertAdjacentHTML('beforeend', html);
            const overlay = document.querySelector('#crm-books-create-tag-modal');
            if (!overlay) return;

            function closeModal() {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            }

            const escHandler = (e) => {
                if (e.key === 'Escape') closeModal();
            };
            document.addEventListener('keydown', escHandler);

            overlay.querySelectorAll('[data-modal-close]').forEach(btn => {
                btn.onclick = closeModal;
            });
            overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

            const input = overlay.querySelector('#crm-books-new-tag-name');
            if (input) setTimeout(() => input.focus(), 50);

            overlay.querySelectorAll('.crm-books-color-dot').forEach(dot => {
                dot.onclick = () => {
                    overlay.querySelectorAll('.crm-books-color-dot').forEach(d => d.classList.remove('active'));
                    dot.classList.add('active');
                    selectedColor = dot.dataset.color;
                };
            });

            async function handleCreateTag() {
                const name = clean(input?.value);
                if (!name) {
                    showToast?.('Please enter a tag name.', 'warning');
                    input?.focus();
                    return;
                }
                const submitBtn = overlay.querySelector('#crm-books-create-tag-submit-btn');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Saving...';
                }
                const created = await createBookTag(name, selectedColor);
                if (created) {
                    closeModal();
                    showToast?.(`Tag "${name}" created.`, 'info');
                } else if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Create Tag';
                }
            }

            const submitBtn = overlay.querySelector('#crm-books-create-tag-submit-btn');
            if (submitBtn) submitBtn.onclick = handleCreateTag;

            if (input) {
                input.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateTag();
                    }
                };
            }
        }

        function openQuickTagPopover(bookId, anchorEl) {
            document.querySelector('#crm-books-quick-tag-popover')?.remove();
            const book = books.find(b => b.bookId === bookId);
            if (!book) return;
            if (!Array.isArray(book.tags)) book.tags = [];

            const isDark = panel?.classList.contains('books-dark');
            const rect = anchorEl.getBoundingClientRect();
            let left = rect.left;
            let top = rect.bottom + 4;
            if (left + 260 > window.innerWidth) left = window.innerWidth - 270;
            if (top + 280 > window.innerHeight) top = rect.top - 280;

            const popover = document.createElement('div');
            popover.id = 'crm-books-quick-tag-popover';
            popover.className = 'crm-books-quick-tag-popover' + (isDark ? ' books-dark' : '');
            popover.style.left = `${Math.max(10, left)}px`;
            popover.style.top = `${Math.max(10, top)}px`;

            let tagSearchQuery = '';

            function closePopover() {
                popover.remove();
                document.removeEventListener('click', outsideHandler);
                document.removeEventListener('keydown', keydownHandler);
            }

            const outsideHandler = (e) => {
                if (!popover.contains(e.target) && !anchorEl.contains(e.target)) {
                    closePopover();
                }
            };
            const keydownHandler = (e) => {
                if (e.key === 'Escape') closePopover();
            };

            function renderPopoverContent() {
                const query = tagSearchQuery.trim().toLowerCase();
                const matchedTags = query
                    ? bookTags.filter(t => (t.name || '').toLowerCase().includes(query))
                    : bookTags;

                const hasExactMatch = bookTags.some(t => (t.name || '').toLowerCase() === query);

                const bookTagsList = matchedTags.map(t => {
                    const isSelected = book.tags.includes(t.id) || book.tags.includes(t.name);
                    return `<div class="crm-books-quick-tag-item${isSelected ? ' selected' : ''}" data-popover-tag-id="${escapeHtml(t.id)}">` +
                        `<span><span class="crm-books-quick-tag-dot" style="background:${t.color || '#10b981'};"></span>${escapeHtml(t.name)}</span>` +
                        `<span>${isSelected ? '✓' : ''}</span>` +
                        `</div>`;
                }).join('');

                const createPromptHtml = (query && !hasExactMatch)
                    ? `<div class="crm-books-quick-tag-create-item" data-create-tag-name="${escapeHtml(tagSearchQuery.trim())}">` +
                      `<span>+ Create "<b>${escapeHtml(tagSearchQuery.trim())}</b>"</span>` +
                      `<span style="font-size:0.68rem; color:#94a3b8;">Enter ↵</span>` +
                      `</div>`
                    : '';

                popover.innerHTML = `
                    <div style="font-weight:600; margin-bottom:6px; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center;">
                      <span>🏷️ Tags for Book</span>
                      <span style="font-size:0.7rem; color:#94a3b8; cursor:pointer;" data-close-popover="1">✕</span>
                    </div>
                    <input type="text" class="crm-books-quick-tag-input" placeholder="Search or type new tag..." value="${escapeHtml(tagSearchQuery)}" autofocus />
                    <div class="crm-books-quick-tag-hint">Press Enter to assign or create</div>
                    <div class="crm-books-quick-tag-list">
                      ${createPromptHtml}
                      ${bookTagsList || (query ? '<div style="color:#94a3b8; font-size:0.72rem; padding:4px;">No existing tags match.</div>' : '<div style="color:#94a3b8; font-size:0.72rem; padding:4px;">No tags yet. Type above to create.</div>')}
                    </div>
                `;

                const input = popover.querySelector('.crm-books-quick-tag-input');
                if (input) {
                    setTimeout(() => {
                        input.focus();
                        input.setSelectionRange(input.value.length, input.value.length);
                    }, 20);

                    input.oninput = (e) => {
                        tagSearchQuery = e.target.value;
                        renderListOnly();
                    };

                    input.onkeydown = async (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = clean(input.value);
                            if (val) {
                                await toggleBookTag(bookId, val);
                                closePopover();
                            }
                        } else if (e.key === 'Escape') {
                            closePopover();
                        }
                    };
                }

                bindItems();
            }

            function renderListOnly() {
                const listEl = popover.querySelector('.crm-books-quick-tag-list');
                if (!listEl) return;
                const query = tagSearchQuery.trim().toLowerCase();
                const matchedTags = query
                    ? bookTags.filter(t => (t.name || '').toLowerCase().includes(query))
                    : bookTags;

                const hasExactMatch = bookTags.some(t => (t.name || '').toLowerCase() === query);

                const bookTagsList = matchedTags.map(t => {
                    const isSelected = book.tags.includes(t.id) || book.tags.includes(t.name);
                    return `<div class="crm-books-quick-tag-item${isSelected ? ' selected' : ''}" data-popover-tag-id="${escapeHtml(t.id)}">` +
                        `<span><span class="crm-books-quick-tag-dot" style="background:${t.color || '#10b981'};"></span>${escapeHtml(t.name)}</span>` +
                        `<span>${isSelected ? '✓' : ''}</span>` +
                        `</div>`;
                }).join('');

                const createPromptHtml = (query && !hasExactMatch)
                    ? `<div class="crm-books-quick-tag-create-item" data-create-tag-name="${escapeHtml(tagSearchQuery.trim())}">` +
                      `<span>+ Create "<b>${escapeHtml(tagSearchQuery.trim())}</b>"</span>` +
                      `<span style="font-size:0.68rem; color:#94a3b8;">Enter ↵</span>` +
                      `</div>`
                    : '';

                listEl.innerHTML = createPromptHtml +
                    (bookTagsList || (query ? '<div style="color:#94a3b8; font-size:0.72rem; padding:4px;">No existing tags match.</div>' : '<div style="color:#94a3b8; font-size:0.72rem; padding:4px;">No tags yet. Type above to create.</div>'));

                bindItems();
            }

            function bindItems() {
                popover.querySelectorAll('[data-popover-tag-id]').forEach(item => {
                    item.onclick = async () => {
                        const tId = item.dataset.popoverTagId;
                        await toggleBookTag(bookId, tId);
                        renderListOnly();
                    };
                });

                const createBtn = popover.querySelector('[data-create-tag-name]');
                if (createBtn) {
                    createBtn.onclick = async () => {
                        const name = createBtn.dataset.createTagName;
                        if (name) {
                            await toggleBookTag(bookId, name);
                            closePopover();
                        }
                    };
                }

                popover.querySelector('[data-close-popover]')?.addEventListener('click', closePopover);
            }

            renderPopoverContent();
            document.body.appendChild(popover);

            setTimeout(() => {
                document.addEventListener('click', outsideHandler);
                document.addEventListener('keydown', keydownHandler);
            }, 10);
        }

        function openCollectionMovePopover(bookId, anchorEl) {
            document.querySelector('#crm-books-move-col-popover')?.remove();
            const book = books.find(b => b.bookId === bookId);
            if (!book) return;

            const isDark = panel?.classList.contains('books-dark');
            const rect = anchorEl.getBoundingClientRect();
            let left = rect.left;
            let top = rect.bottom + 4;
            if (left + 220 > window.innerWidth) left = window.innerWidth - 230;

            const popover = document.createElement('div');
            popover.id = 'crm-books-move-col-popover';
            popover.className = 'crm-books-quick-tag-popover' + (isDark ? ' books-dark' : '');
            popover.style.width = '200px';
            popover.style.left = `${Math.max(10, left)}px`;
            popover.style.top = `${Math.max(10, top)}px`;

            function closePopover() {
                popover.remove();
                document.removeEventListener('click', outsideHandler);
                document.removeEventListener('keydown', keydownHandler);
            }

            const outsideHandler = (e) => {
                if (!popover.contains(e.target) && !anchorEl.contains(e.target)) {
                    closePopover();
                }
            };
            const keydownHandler = (e) => {
                if (e.key === 'Escape') closePopover();
            };

            const colList = bookCollections.map(c => {
                const isCur = c.id === book.collectionId;
                return `<div class="crm-books-quick-tag-item${isCur ? ' selected' : ''}" data-move-col-id="${escapeHtml(c.id)}">` +
                    `<span>📁 ${escapeHtml(c.name)}</span>` +
                    `<span>${isCur ? '✓' : ''}</span>` +
                    `</div>`;
            }).join('');

            popover.innerHTML = `
                <div style="font-weight:600; margin-bottom:6px; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center;">
                  <span>Move to Collection:</span>
                  <span style="font-size:0.7rem; color:#94a3b8; cursor:pointer;" data-close-col-popover="1">✕</span>
                </div>
                <div class="crm-books-quick-tag-list">
                  ${colList}
                </div>
            `;

            popover.querySelectorAll('[data-move-col-id]').forEach(item => {
                item.onclick = async () => {
                    const cId = item.dataset.moveColId;
                    await moveBookToCollection(bookId, cId);
                    closePopover();
                };
            });

            popover.querySelector('[data-close-col-popover]')?.addEventListener('click', closePopover);

            document.body.appendChild(popover);
            setTimeout(() => {
                document.addEventListener('click', outsideHandler);
                document.addEventListener('keydown', keydownHandler);
            }, 10);
        }

        // ─── Phase 5: Multi-Surface "Elaborate" Tool ───
        function toggleElaborateMode(forceState) {
            const nextState = typeof forceState === 'boolean' ? forceState : !isElaborateModeActive;
            isElaborateModeActive = nextState;

            if (panel) {
                if (isElaborateModeActive) {
                    panel.classList.add('crm-books-elaborate-active');
                } else {
                    panel.classList.remove('crm-books-elaborate-active');
                }
            }

            const mmModal = docQs('#crm-books-mindmap-modal');
            if (mmModal) {
                if (isElaborateModeActive) {
                    mmModal.classList.add('crm-books-elaborate-active');
                } else {
                    mmModal.classList.remove('crm-books-elaborate-active');
                }
            }

            document.querySelectorAll('.crm-books-elaborate-btn, #crm-mindmap-elaborate-btn').forEach(btn => {
                if (isElaborateModeActive) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            if (!isElaborateModeActive) {
                clearElaborateMarks();
                elaborateSnippets = [];
                hideElaborateTray();
            } else {
                renderElaborateTray();
                showToast?.('✨ Elaborate Mode active: Highlight text across Summary, Notes, Chat, or Mind Map.', 'info');
            }
        }

        const MAX_ELABORATE_SNIPPETS = 12;
        const MAX_SNIPPET_TEXT_LENGTH = 600;

        function addElaborateSnippet(text, sourceTab, sectionTitle, targetRange, nodeId = null) {
            let cleanText = String(text || '').trim();
            if (!cleanText || cleanText.length < 2) return null;

            if (elaborateSnippets.length >= MAX_ELABORATE_SNIPPETS) {
                showToast?.(`Maximum of ${MAX_ELABORATE_SNIPPETS} highlights reached. Click Done to elaborate.`, 'warning');
                return null;
            }

            if (cleanText.length > MAX_SNIPPET_TEXT_LENGTH) {
                cleanText = cleanText.slice(0, MAX_SNIPPET_TEXT_LENGTH) + '…';
            }

            const snippetId = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const index = elaborateSnippets.length + 1;

            if (targetRange) {
                try {
                    const mark = document.createElement('mark');
                    mark.className = 'crm-books-elaborate-mark';
                    mark.dataset.snippetId = snippetId;
                    const badge = document.createElement('span');
                    badge.className = 'crm-books-elaborate-badge';
                    badge.textContent = `#${index}`;
                    
                    const contents = targetRange.extractContents();
                    mark.appendChild(badge);
                    mark.appendChild(contents);
                    targetRange.insertNode(mark);
                } catch (e) {
                    console.warn('[CRM Books] Could not wrap selection in mark element:', e);
                }
            }

            const snippetObj = {
                id: snippetId,
                index,
                text: cleanText,
                sourceTab: sourceTab || activeTab || 'summary',
                section: sectionTitle || '',
                nodeId: nodeId ? String(nodeId) : null
            };
            elaborateSnippets.push(snippetObj);
            renderElaborateTray();
            return snippetId;
        }

        function removeElaborateSnippet(snippetOrNodeId) {
            if (!snippetOrNodeId) return;
            const targetSnippet = elaborateSnippets.find(s => s.id === snippetOrNodeId || (s.nodeId && s.nodeId === snippetOrNodeId));
            if (!targetSnippet) return;

            const snippetId = targetSnippet.id;
            const associatedNodeId = targetSnippet.nodeId;

            elaborateSnippets = elaborateSnippets.filter(s => s.id !== snippetId);

            elaborateSnippets.forEach((s, idx) => {
                s.index = idx + 1;
            });

            document.querySelectorAll(`mark.crm-books-elaborate-mark[data-snippet-id="${snippetId}"]`).forEach(mark => {
                const parent = mark.parentNode;
                if (!parent) return;
                while (mark.firstChild) {
                    if (mark.firstChild.classList && mark.firstChild.classList.contains('crm-books-elaborate-badge')) {
                        mark.removeChild(mark.firstChild);
                    } else {
                        parent.insertBefore(mark.firstChild, mark);
                    }
                }
                parent.removeChild(mark);
                parent.normalize();
            });

            elaborateSnippets.forEach((s) => {
                const mark = document.querySelector(`mark.crm-books-elaborate-mark[data-snippet-id="${s.id}"]`);
                const badge = mark?.querySelector('.crm-books-elaborate-badge');
                if (badge) badge.textContent = `#${s.index}`;
            });

            if (associatedNodeId) {
                document.querySelectorAll(`.crm-mindmap-node[data-node-id="${associatedNodeId}"]`).forEach(n => {
                    n.classList.remove('crm-mindmap-node-elaborate-selected');
                });
            }

            renderElaborateTray();
        }

        function clearElaborateMarks() {
            document.querySelectorAll('mark.crm-books-elaborate-mark').forEach((mark) => {
                const parent = mark.parentNode;
                if (!parent) return;
                while (mark.firstChild) {
                    if (mark.firstChild.classList && mark.firstChild.classList.contains('crm-books-elaborate-badge')) {
                        mark.removeChild(mark.firstChild);
                    } else {
                        parent.insertBefore(mark.firstChild, mark);
                    }
                }
                parent.removeChild(mark);
                parent.normalize();
            });
            document.querySelectorAll('.crm-mindmap-node-elaborate-selected').forEach(n => {
                n.classList.remove('crm-mindmap-node-elaborate-selected');
            });
        }

        function renderElaborateTray() {
            const tray = docQs('#crm-books-elaborate-tray');
            if (!tray) return;

            if (!isElaborateModeActive) {
                tray.style.display = 'none';
                return;
            }

            tray.style.display = 'flex';
            const countEl = docQs('#crm-books-elaborate-tray-count');
            if (countEl) {
                countEl.textContent = `${elaborateSnippets.length} selected`;
            }

            const doneBtn = docQs('#crm-books-elaborate-tray-done-btn');
            if (doneBtn) {
                doneBtn.disabled = elaborateSnippets.length === 0 || isElaborating;
                doneBtn.innerHTML = isElaborating
                    ? `<span class="crm-spinner" style="width:12px;height:12px;display:inline-block;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:4px;"></span> Elaborating…`
                    : `✓ Done (${elaborateSnippets.length})`;
            }

            const chipsContainer = docQs('#crm-books-elaborate-tray-chips');
            if (chipsContainer) {
                if (elaborateSnippets.length === 0) {
                    chipsContainer.innerHTML = '<span class="crm-books-elaborate-tray-empty-hint">Highlight any text across Summary, Notes, Chat, or Mind Map</span>';
                } else {
                    chipsContainer.innerHTML = elaborateSnippets.map((s) => {
                        const snippetPreview = s.text.length > 32 ? s.text.slice(0, 32) + '…' : s.text;
                        return `<div class="crm-books-elaborate-chip" title="${escapeHtml(s.text)}">` +
                            `<span class="crm-books-elaborate-chip-idx">#${s.index}</span>` +
                            `<span class="crm-books-elaborate-chip-src">${escapeHtml(s.sourceTab)}</span>` +
                            `<span class="crm-books-elaborate-chip-text">${escapeHtml(snippetPreview)}</span>` +
                            `<button type="button" class="crm-books-elaborate-chip-remove" data-snippet-id="${escapeHtml(s.id)}" title="Remove this highlight">&times;</button>` +
                            `</div>`;
                    }).join('');
                }
            }
        }

        function hideElaborateTray() {
            const tray = docQs('#crm-books-elaborate-tray');
            if (tray) tray.style.display = 'none';
        }

        function openElaborationDrawer(loading = false) {
            const drawer = docQs('#crm-books-elaborate-drawer');
            if (!drawer) return;
            drawer.style.display = 'flex';
            requestAnimationFrame(() => {
                drawer.classList.add('open');
                drawer.setAttribute('aria-hidden', 'false');
            });

            const bookTitleEl = docQs('#crm-books-elaborate-drawer-book-title');
            if (bookTitleEl) {
                bookTitleEl.textContent = selectedBook?.title || 'Book Source Grounding';
            }

            if (loading) {
                const body = docQs('#crm-books-elaborate-drawer-body');
                if (body) {
                    body.innerHTML = `<div class="crm-books-elaborate-loading">` +
                        `<div class="crm-books-elaborate-spinner"></div>` +
                        `<h4>Unpacking and Grounding Excerpts…</h4>` +
                        `<p class="crm-muted">Retrieving source text from "${escapeHtml(selectedBook?.title || 'the book')}" and building source-grounded elaboration.</p>` +
                        `</div>`;
                }
            }
        }

        function closeElaborationDrawer() {
            const drawer = docQs('#crm-books-elaborate-drawer');
            if (!drawer) return;
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
            setTimeout(() => {
                if (!drawer.classList.contains('open')) {
                    drawer.style.display = 'none';
                }
            }, 300);
        }

        function renderElaborationResult(result) {
            openElaborationDrawer(false);
            const body = docQs('#crm-books-elaborate-drawer-body');
            if (!body || !result) return;

            const synthesisHtml = result.synthesis ? (
                `<div class="crm-books-elaborate-synthesis-card">` +
                `<div class="crm-books-elaborate-card-header">` +
                `<span class="crm-books-elaborate-synthesis-icon">🎯</span>` +
                `<h4>Core Synthesis & Conceptual Framework</h4>` +
                `</div>` +
                `<div class="crm-books-elaborate-synthesis-text">` +
                `<p>${formatElaborateParagraphs(result.synthesis)}</p>` +
                `</div>` +
                `</div>`
            ) : '';

            const itemsHtml = (result.elaborations || []).map((item, idx) => {
                const takeawaysHtml = (Array.isArray(item.keyTakeaways) && item.keyTakeaways.length > 0) ? (
                    `<div class="crm-books-elaborate-takeaways">` +
                    `<div class="crm-books-elaborate-takeaways-label">💡 Key Takeaways:</div>` +
                    `<ul>${item.keyTakeaways.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` +
                    `</div>`
                ) : '';

                const evidenceHtml = item.sourceEvidence ? (
                    `<div class="crm-books-elaborate-evidence">` +
                    `<div class="crm-books-elaborate-evidence-label">📖 Source Grounding & Direct Reference:</div>` +
                    `<div class="crm-books-elaborate-evidence-text">${escapeHtml(item.sourceEvidence)}</div>` +
                    `</div>`
                ) : '';

                const pageRefHtml = item.pageRef ? `<span class="crm-books-elaborate-item-pages">${escapeHtml(item.pageRef)}</span>` : '';

                return `<div class="crm-books-elaborate-item-card">` +
                    `<div class="crm-books-elaborate-item-header">` +
                    `<span class="crm-books-elaborate-item-badge">#${idx + 1}</span>` +
                    `<h4 class="crm-books-elaborate-item-title">${escapeHtml(item.concept || `Concept #${idx + 1}`)}</h4>` +
                    pageRefHtml +
                    `</div>` +
                    `<blockquote class="crm-books-elaborate-quote">"${escapeHtml(item.snippetText || '')}"</blockquote>` +
                    `<div class="crm-books-elaborate-explanation">` +
                    `<p>${formatElaborateParagraphs(item.detailedExplanation)}</p>` +
                    `</div>` +
                    evidenceHtml +
                    takeawaysHtml +
                    `</div>`;
            }).join('');

            body.innerHTML = `<div class="crm-books-elaborate-content">` +
                synthesisHtml +
                `<div class="crm-books-elaborate-items-title">` +
                `<h4>Detailed Elaboration (${(result.elaborations || []).length} excerpt${(result.elaborations || []).length === 1 ? '' : 's'})</h4>` +
                `</div>` +
                `<div class="crm-books-elaborate-items-list">${itemsHtml}</div>` +
                `</div>`;
        }

        async function executeElaboration() {
            if (!selectedBookId) {
                showToast?.('Please select a book first.', 'warning');
                return;
            }
            if (elaborateSnippets.length === 0) {
                showToast?.('Please highlight at least one passage to elaborate.', 'warning');
                return;
            }

            isElaborating = true;
            renderElaborateTray();
            openElaborationDrawer(true);

            try {
                const res = await apiPost(`/api/admin/books/${selectedBookId}/elaborate`, {
                    snippets: elaborateSnippets
                });
                const data = res?.data || res;
                lastElaborationResult = {
                    bookId: selectedBookId,
                    bookTitle: selectedBook?.title || 'Book',
                    bookAuthor: selectedBook?.author || '',
                    synthesis: data.synthesis || '',
                    elaborations: Array.isArray(data.elaborations) ? data.elaborations : [],
                    snippets: [...elaborateSnippets],
                    model: data.model || ''
                };
                renderElaborationResult(lastElaborationResult);
                showToast?.('Elaboration generated from source material.', 'success');
            } catch (err) {
                console.error('[CRM Books] Elaborate failed:', err);
                const body = docQs('#crm-books-elaborate-drawer-body');
                if (body) {
                    body.innerHTML = `<div class="crm-books-elaborate-error">` +
                        `<p class="crm-text-danger">⚠️ Failed to generate elaboration: ${escapeHtml(err?.message || 'Unknown error')}</p>` +
                        `<button type="button" class="crm-btn crm-btn-secondary crm-btn-sm crm-books-elaborate-retry-btn">Retry</button>` +
                        `</div>`;
                }
                showToast?.('Elaboration failed: ' + (err?.message || 'Error'), 'error');
            } finally {
                isElaborating = false;
                renderElaborateTray();
            }
        }

        async function saveElaborationToNotes() {
            if (!lastElaborationResult || !selectedBookId) {
                showToast?.('No elaboration result to save.', 'warning');
                return;
            }
            const md = generateElaborationMarkdown(lastElaborationResult);
            try {
                await saveBookNote(selectedBookId, md);
                showToast?.('Saved elaboration as a new note in Notes tab.', 'success');
            } catch (err) {
                showToast?.('Failed to save elaboration to notes: ' + (err?.message || 'Error'), 'error');
            }
        }

        function discussElaborationInChat() {
            if (!lastElaborationResult) {
                showToast?.('No elaboration result to discuss.', 'warning');
                return;
            }
            const concepts = (lastElaborationResult.elaborations || []).map(e => e.concept).filter(Boolean);
            const topicStr = concepts.length > 0 ? concepts.slice(0, 2).map(c => `"${c}"`).join(' and ') : 'the highlighted concepts';
            const starterMsg = `Can you elaborate further on how ${topicStr} in "${lastElaborationResult.bookTitle}" connect to real-world applications?`;

            closeElaborationDrawer();
            activeTab = 'chat';
            renderExplorerPanel();

            setTimeout(() => {
                const composer = docQs('.crm-books-composer-input');
                if (composer) {
                    composer.value = starterMsg;
                    composer.focus();
                    composer.style.height = 'auto';
                    composer.style.height = Math.min(composer.scrollHeight, 120) + 'px';
                }
            }, 100);
            showToast?.('Switched to Chat with elaboration context.', 'info');
        }

        async function copyElaborationMarkdown() {
            if (!lastElaborationResult) {
                showToast?.('No elaboration result to copy.', 'warning');
                return;
            }
            const md = generateElaborationMarkdown(lastElaborationResult);
            try {
                await navigator.clipboard.writeText(md);
                showToast?.('Elaboration markdown copied to clipboard!', 'success');
            } catch (err) {
                showToast?.('Failed to copy to clipboard.', 'error');
            }
        }

        // --- Event binding ---
        function bindEvents() {
            if (bound || !panel) return;
            bound = true;

            // Search filter
            panel.addEventListener('input', (e) => {
                if (e.target.classList.contains('crm-books-search')) {
                    searchQuery = clean(e.target.value);
                    renderSourcesPanel();
                }
                // Auto-resize composer textarea
                if (e.target.classList.contains('crm-books-composer-input')) {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }
            });

            panel.addEventListener('click', async (e) => {
                const quickTagBtn = e.target.closest('[data-quick-tag-book-id]');
                if (quickTagBtn) {
                    e.stopPropagation();
                    openQuickTagPopover(quickTagBtn.dataset.quickTagBookId, quickTagBtn);
                    return;
                }
                const target = e.target.closest('[data-book-id]');
                if (target) {
                    const bookId = target.dataset.bookId;
                    if (target.classList.contains('crm-books-delete-btn')) {
                        e.stopPropagation();
                        await deleteBook(bookId);
                        return;
                    }
                    if (target.classList.contains('crm-books-bgm-btn')) {
                        e.stopPropagation();
                        openBookBgmModal(bookId || selectedBookId);
                        return;
                    }
                    if (target.classList.contains('crm-books-download-btn')) {
                        e.stopPropagation();
                        showDownloadSourceModal(bookId);
                        return;
                    }
                    if (target.classList.contains('crm-books-retry-btn')) {
                        e.stopPropagation();
                        await retryIngest(bookId);
                        return;
                    }
                    if (target.classList.contains('crm-books-reupload-btn')) {
                        e.stopPropagation();
                        const book = books.find((b) => b.bookId === bookId);
                        if (!book) return;
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'application/pdf';
                        input.addEventListener('change', async () => {
                            const file = input.files?.[0];
                            if (!file) return;
                            if (file.size > 100 * 1024 * 1024) {
                                showToast?.('File must be under 100 MB.', 'error');
                                return;
                            }
                            const path = book.source?.storagePath || `crm-books/${bookId}/source.pdf`;
                            await startUpload(bookId, path, file);
                        });
                        input.click();
                        return;
                    }
                    if (target.classList.contains('crm-books-list-item')) {
                        await selectBook(bookId);
                        return;
                    }
                }

                const tab = e.target.closest('[data-books-tab]');
                if (tab) {
                    activeTab = tab.dataset.booksTab;
                    renderExplorerPanel();
                    if ((activeTab === 'chat' || activeTab === 'history') && threads.length === 0 && selectedBook?.status === 'ready') {
                        loadThreads().catch(console.error);
                    }
                    if (activeTab === 'notes' && selectedBookId) {
                        syncNotesFromFirestore(selectedBookId).catch(() => {});
                    }
                    return;
                }

                if (e.target.closest('.crm-books-add-btn')) {
                    openAddBookModal();
                    return;
                }

                if (e.target.closest('.crm-books-new-chat-btn')) {
                    startNewChat();
                    return;
                }

                const historyOpen = e.target.closest('.crm-books-history-open');
                if (historyOpen) {
                    selectedThreadId = clean(historyOpen.dataset.historyThreadId);
                    activeTab = 'chat';
                    await loadMessages();
                    renderExplorerPanel();
                    return;
                }

                const renameButton = e.target.closest('.crm-books-thread-rename-btn');
                if (renameButton) {
                    beginThreadRename(clean(renameButton.dataset.threadId));
                    return;
                }

                if (e.target.closest('.crm-books-thread-title-cancel')) {
                    cancelThreadRename();
                    return;
                }

                if (e.target.closest('.crm-books-send-btn')) {
                    const input = qs('.crm-books-composer-input');
                    const text = clean(input?.value);
                    if (text) {
                        await sendMessage(text);
                    }
                    return;
                }

                if (e.target.closest('.crm-books-starter-btn')) {
                    const text = clean(e.target.closest('.crm-books-starter-btn').textContent);
                    if (text) await sendMessage(text);
                    return;
                }

                // Topic chip → prefill chat
                const topicChip = e.target.closest('.crm-books-topic-chip');
                if (topicChip) {
                    const topic = topicChip.dataset.topic;
                    if (topic) {
                        activeTab = 'chat';
                        renderExplorerPanel();
                        if (threads.length === 0 && selectedBook?.status === 'ready') {
                            await loadThreads();
                        }
                        requestAnimationFrame(() => {
                            const input = qs('.crm-books-composer-input');
                            if (input) {
                                input.value = `What does the book say about ${topic.toLowerCase()}?`;
                                input.focus();
                            }
                        });
                    }
                    return;
                }

                // Save to notes
                const saveBtn = e.target.closest('.crm-books-msg-save-btn');
                if (saveBtn && selectedBookId) {
                    const msgEl = saveBtn.closest('.crm-books-msg');
                    if (msgEl) {
                        const answerText = msgEl.querySelector('.crm-books-msg-text')?.textContent || '';
                        let questionText = '';
                        let prev = msgEl.previousElementSibling;
                        while (prev) {
                            if (prev.classList.contains('crm-books-msg-user')) {
                                questionText = prev.querySelector('.crm-books-msg-text')?.textContent || '';
                                break;
                            }
                            prev = prev.previousElementSibling;
                        }

                        const fullNoteText = questionText.trim()
                            ? `Q: ${questionText.trim()}\n\nA: ${answerText.trim()}`
                            : answerText.trim();

                        saveBookNote(selectedBookId, fullNoteText);
                        showToast?.('Saved to notes.', 'info');
                        if (activeTab === 'notes') renderExplorerPanel();
                    }
                    return;
                }

                // Toggle note accordion
                const noteToggle = e.target.closest('[data-note-toggle]');
                if (noteToggle && !e.target.closest('.crm-books-note-delete-btn')) {
                    const noteId = noteToggle.dataset.noteToggle;
                    if (noteId) {
                        expandedNotes[noteId] = !expandedNotes[noteId];
                        renderExplorerPanel();
                    }
                    return;
                }

                // Delete note
                const noteDeleteBtn = e.target.closest('.crm-books-note-delete-btn');
                if (noteDeleteBtn && selectedBookId) {
                    const noteId = noteDeleteBtn.dataset.noteId;
                    if (noteId) {
                        deleteBookNote(selectedBookId, noteId);
                        renderExplorerPanel();
                    }
                    return;
                }

                // Open book view button
                if (e.target.closest('.crm-books-open-bookview')) {
                    openBookView();
                    return;
                }

                // Create Mind Map button
                const createMindMapBtn = e.target.closest('.crm-books-create-mindmap-btn');
                if (createMindMapBtn && selectedBookId) {
                    openMindMapModal(selectedBookId).catch(console.error);
                    return;
                }

                if (e.target.closest('.crm-books-compile-open-btn') && selectedBookId) {
                    openCompilationModal();
                    return;
                }


                const citationButton = e.target.closest('.crm-books-citation-ref[data-citation-marker]');
                if (citationButton) {
                    await openCitation(citationButton.dataset.citationMarker);
                    return;
                }

                // Summary mode selector
                const modeBtn = e.target.closest('[data-summary-mode]');
                if (modeBtn) {
                    const mode = modeBtn.dataset.summaryMode;
                    summaryMode = mode;
                    if (mode === 'chapters' && !sectionDigests && !sectionsLoading) {
                        loadSectionDigests().catch(console.error);
                    }
                    renderExplorerPanel();
                    return;
                }

                // Outline / chapter page jump
                const pageLink = e.target.closest('[data-goto-page]');
                if (pageLink) {
                    const page = Number(pageLink.dataset.gotoPage);
                    if (page > 0) {
                        await jumpToPage(page);
                    }
                    return;
                }

                // Outline toggle
                const outlineToggle = e.target.closest('.crm-books-outline-toggle');
                if (outlineToggle) {
                    const key = outlineToggle.dataset.outlineKey;
                    if (key) {
                        collapsedOutline[key] = !collapsedOutline[key];
                        renderExplorerPanel();
                    }
                    return;
                }
            });

            panel.addEventListener('submit', async (e) => {
                if (e.target.classList.contains('crm-books-thread-title-editor')) {
                    e.preventDefault();
                    await saveThreadTitle();
                }
            });

            panel.addEventListener('keydown', (e) => {
                if (e.target.classList.contains('crm-books-composer-input') && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = clean(e.target.value);
                    if (text) sendMessage(text);
                }
                if (e.target.classList.contains('crm-books-thread-title-input') && e.key === 'Escape') {
                    e.preventDefault();
                    cancelThreadRename();
                }
            });

            // Citation hover tooltips — target the wrapper to avoid flicker
            panel.addEventListener('mouseenter', (e) => {
                const wrap = e.target.closest?.('.crm-books-citation-wrap');
                if (wrap) {
                    showCitationPreview(wrap);
                }
            }, true);

            panel.addEventListener('mouseleave', (e) => {
                const wrap = e.target.closest?.('.crm-books-citation-wrap');
                if (wrap && !wrap.contains(e.relatedTarget)) {
                    hideCitationPreview(wrap);
                }
            }, true);

            panel.addEventListener('focusin', (e) => {
                const wrap = e.target.closest?.('.crm-books-citation-wrap');
                if (wrap) showCitationPreview(wrap);
            });
            panel.addEventListener('focusout', (e) => {
                const wrap = e.target.closest?.('.crm-books-citation-wrap');
                if (wrap && !wrap.contains(e.relatedTarget)) hideCitationPreview(wrap);
            });

            // Sources toggle
            panel.addEventListener('click', (e) => {
                const toggle = e.target.closest('.crm-books-sources-header-toggle');
                if (toggle) {
                    const workspace = panel.querySelector('.crm-books-workspace');
                    if (workspace) {
                        const collapsed = workspace.classList.toggle('sources-collapsed');
                        toggle.setAttribute('aria-expanded', String(!collapsed));
                        toggle.setAttribute('aria-label', collapsed ? 'Expand sources panel' : 'Collapse sources panel');
                    }
                }
            });

            // Dark mode toggle
            panel.addEventListener('click', (e) => {
                if (e.target.closest('.crm-books-dark-toggle')) {
                    panel.classList.toggle('books-dark');
                    localStorage.setItem('crm_books_dark_mode', panel.classList.contains('books-dark') ? '1' : '0');
                    renderExplorerPanel();
                }
            });

            // Pages navigation
            panel.addEventListener('click', (e) => {
                if (e.target.closest('.crm-books-page-prev')) {
                    startPageTurn('prev');
                    return;
                }
                if (e.target.closest('.crm-books-page-next')) {
                    startPageTurn('next');
                    return;
                }
                const subtabBtn = e.target.closest('.crm-books-subtab-btn[data-page-subtab]');
                if (subtabBtn) {
                    const mode = subtabBtn.getAttribute('data-page-subtab');
                    if (mode && mode !== activePageSubTab) {
                        activePageSubTab = mode;
                        if (mode === 'pdf' && (!cachedSourcePdfUrl || cachedSourcePdfBookId !== selectedBookId)) {
                            isLoadingSourcePdf = true;
                            renderExplorerPanel();
                            loadSourcePdfUrl(selectedBookId).then(() => {
                                isLoadingSourcePdf = false;
                                renderExplorerPanel();
                            }).catch(() => {
                                isLoadingSourcePdf = false;
                                renderExplorerPanel();
                            });
                        } else {
                            renderExplorerPanel();
                        }
                    }
                    return;
                }
                if (e.target.closest('.crm-books-jump-to-source-btn') || e.target.closest('.crm-books-load-pdf-btn')) {
                    activePageSubTab = 'pdf';
                    if (!cachedSourcePdfUrl || cachedSourcePdfBookId !== selectedBookId) {
                        isLoadingSourcePdf = true;
                        renderExplorerPanel();
                        loadSourcePdfUrl(selectedBookId).then(() => {
                            isLoadingSourcePdf = false;
                            renderExplorerPanel();
                        }).catch(() => {
                            isLoadingSourcePdf = false;
                            renderExplorerPanel();
                        });
                    } else {
                        renderExplorerPanel();
                    }
                    return;
                }
                if (e.target.closest('.crm-books-jump-to-text-btn')) {
                    activePageSubTab = 'text';
                    renderExplorerPanel();
                    return;
                }
                const pdfDownloadBtn = e.target.closest('.crm-books-pdf-download-btn');
                if (pdfDownloadBtn) {
                    const bId = pdfDownloadBtn.getAttribute('data-book-id') || selectedBookId;
                    if (bId) downloadSource(bId);
                    return;
                }
            });
            panel.addEventListener('change', (e) => {
                if (e.target.classList.contains('crm-books-page-input') && pagesData) {
                    cancelPageTurn();
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= pagesData.totalPages) {
                        currentPage = val;
                        resetPageCitation();
                        renderExplorerPanel();
                    } else {
                        e.target.value = currentPage;
                    }
                }
            });
            panel.addEventListener('input', (e) => {
                if (!e.target.classList.contains('crm-books-font-scale')) return;
                readerFontScale = clampReaderFontScale(e.target.value);
                e.target.value = String(readerFontScale);
                e.target.setAttribute('aria-valuetext', `${readerFontScale} percent`);
                const output = qs('.crm-books-font-scale-output');
                if (output) output.textContent = `${readerFontScale}%`;
                const tabBody = qs('.crm-books-tab-body');
                tabBody?.style.setProperty('--crm-books-reader-font-scale', `${readerFontScale}%`);
                try {
                    localStorage.setItem(READER_FONT_SCALE_STORAGE_KEY, String(readerFontScale));
                } catch (_ignored) {
                    // Reader scaling remains available for this session when storage is blocked.
                }
            });

            // Budget approval
            panel.addEventListener('click', async (e) => {
                if (e.target.closest('.crm-books-approve-btn')) {
                    const input = panel.querySelector('.crm-books-approve-input');
                    if (input && clean(input.value).toLowerCase() === 'approve') {
                        try {
                            await apiPost('/api/admin/books/usage/approve', { confirm: 'approve' });
                            showToast?.('Budget approved. Counter reset.', 'info');
                            await loadUsage();
                            renderExplorerPanel();
                        } catch (err) {
                            showToast?.('Failed to approve budget.', 'error');
                        }
                    } else {
                        showToast?.('Type "approve" to confirm.', 'error');
                    }
                }
            });

            // Chapter Study Notes click handler
            panel.addEventListener('click', async (e) => {
                const notesBtn = e.target.closest('.crm-books-generate-notes-btn');
                if (notesBtn) {
                    const sectionIdx = notesBtn.dataset.sectionIndex;
                    if (sectionIdx != null && selectedBookId) {
                        await handleGenerateOrViewStudyNotes(sectionIdx, notesBtn);
                    }
                }
            });

            // Text selection → highlight popup
            panel.addEventListener('mouseup', (e) => {
                if (!e.target.closest('.crm-books-page-content')) return;
                const sel = window.getSelection();
                const text = sel?.toString().trim();
                if (!text || text.length < 3) { hideHighlightPopup(); return; }
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                const stage = qs('.crm-books-page-stage');
                if (!stage) return;
                const stageRect = stage.getBoundingClientRect();
                showHighlightPopup(rect.left - stageRect.left + rect.width / 2 - 50, rect.top - stageRect.top - 40, text);
            });

            // Highlight color selection
            panel.addEventListener('click', (e) => {
                const colorBtn = e.target.closest('.crm-highlight-color-btn');
                if (colorBtn) {
                    const popup = colorBtn.closest('.crm-highlight-popup');
                    const text = popup?.dataset.selectedText;
                    const color = colorBtn.dataset.hlColor;
                    if (text && color && selectedBookId) {
                        addHighlight(selectedBookId, currentPage, text, color);
                        window.getSelection()?.removeAllRanges();
                        hideHighlightPopup();
                        renderExplorerPanel();
                        requestAnimationFrame(() => applyHighlightsToPage(currentPage));
                    }
                    return;
                }

                // Remove highlight on click
                const mark = e.target.closest('mark.crm-highlight');
                if (mark && mark.dataset.highlightId) {
                    removeHighlight(selectedBookId, Number(mark.dataset.pageNum) || currentPage, mark.dataset.highlightId);
                    renderExplorerPanel();
                    requestAnimationFrame(() => applyHighlightsToPage(currentPage));
                    return;
                }
            });

            // Dismiss highlight popup on outside click
            document.addEventListener('mousedown', (e) => {
                if (!e.target.closest('.crm-highlight-popup') && !e.target.closest('.crm-books-page-content')) {
                    hideHighlightPopup();
                }
            });

            // Bookmark toggle
            panel.addEventListener('click', (e) => {
                if (e.target.closest('.crm-books-bookmark-toggle')) {
                    if (!selectedBookId || !pagesData) return;
                    const existing = bookmarks.find(b => b.bookId === selectedBookId && b.page === currentPage);
                    if (existing) {
                        removeBookmark(existing.id);
                        showToast?.('Bookmark removed.', 'info');
                    } else {
                        const label = prompt('Bookmark label:', `Page ${currentPage}`);
                        if (label !== null) {
                            addBookmark(selectedBookId, currentPage, label, HIGHLIGHT_COLORS[0]);
                            showToast?.('Page bookmarked.', 'info');
                        }
                    }
                    renderExplorerPanel();
                    return;
                }

                // Open bookmarks panel
                if (e.target.closest('.crm-books-bookmarks-open')) {
                    const existing = panel.querySelector('.crm-books-bookmarks-panel');
                    if (existing) { existing.remove(); return; }
                    const detail = qs('.crm-books-detail');
                    if (!detail) return;
                    detail.insertAdjacentHTML('beforeend', renderBookmarksPanel());
                    return;
                }

                // Close bookmarks panel
                if (e.target.closest('.crm-books-bookmarks-close')) {
                    panel.querySelector('.crm-books-bookmarks-panel')?.remove();
                    return;
                }

                // Click on bookmark item → jump to page
                const bmItem = e.target.closest('.crm-books-bookmark-item');
                if (bmItem && !e.target.closest('.crm-books-bookmark-delete')) {
                    const bmBookId = bmItem.dataset.bookId;
                    const bmPage = parseInt(bmItem.dataset.page, 10);
                    if (bmBookId && bmPage) {
                        if (bmBookId !== selectedBookId) {
                            selectBook(bmBookId).then(() => {
                                activeTab = 'pages';
                                loadPagesMetadata().then(() => {
                                    currentPage = bmPage;
                                    renderExplorerPanel();
                                });
                            });
                        } else {
                            activeTab = 'pages';
                            currentPage = bmPage;
                            renderExplorerPanel();
                            requestAnimationFrame(() => applyHighlightsToPage(currentPage));
                        }
                        panel.querySelector('.crm-books-bookmarks-panel')?.remove();
                    }
                    return;
                }

                // Delete bookmark
                const bmDel = e.target.closest('.crm-books-bookmark-delete');
                if (bmDel) {
                    removeBookmark(bmDel.dataset.bookmarkId);
                    const bmPanel = panel.querySelector('.crm-books-bookmarks-panel');
                    if (bmPanel) bmPanel.outerHTML = renderBookmarksPanel();
                    renderExplorerPanel();
                    return;
                }

                // Progress heatmap cell click → jump to page
                const cell = e.target.closest('.crm-books-progress-cell');
                if (cell && cell.dataset.progressPage) {
                    currentPage = parseInt(cell.dataset.progressPage, 10);
                    renderExplorerPanel();
                    if (selectedBookId) markPageRead(selectedBookId, currentPage);
                    requestAnimationFrame(() => applyHighlightsToPage(currentPage));
                    return;
                }

                // Split view toggle
                if (e.target.closest('.crm-books-split-toggle')) {
                    splitViewEnabled = !splitViewEnabled;
                    if (splitViewEnabled && threads.length === 0 && selectedBook?.status === 'ready') {
                        loadThreads().catch(console.error);
                    }
                    renderExplorerPanel();
                    return;
                }

                // Send to Chat button
                if (e.target.closest('.crm-books-send-to-chat-btn')) {
                    const popup = e.target.closest('.crm-books-send-to-chat-popup');
                    const text = popup?.dataset.selectedText;
                    if (text) {
                        if (!splitViewEnabled) {
                            splitViewEnabled = true;
                            if (threads.length === 0 && selectedBook?.status === 'ready') {
                                loadThreads().catch(console.error);
                            }
                        }
                        renderExplorerPanel();
                        requestAnimationFrame(() => {
                            const input = qs('.crm-books-composer-input');
                            if (input) {
                                input.value = `Regarding this passage: "${text.slice(0, 300)}"\n\nCan you explain this?`;
                                input.focus();
                                input.style.height = 'auto';
                                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
                            }
                        });
                    }
                    hideSendToChatPopup();
                    return;
                }
            });

            // Show "Send to Chat" popup on text selection in split view
            panel.addEventListener('mouseup', (e) => {
                if (!splitViewEnabled) return;
                if (!e.target.closest('.crm-books-split-page .crm-books-page-content')) return;
                const sel = window.getSelection();
                const text = sel?.toString().trim();
                if (!text || text.length < 5) { hideSendToChatPopup(); return; }
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                const stage = qs('.crm-books-split-page') || qs('.crm-books-page-stage');
                if (!stage) return;
                const stageRect = stage.getBoundingClientRect();
                showSendToChatPopup(rect.left - stageRect.left + rect.width / 2 - 60, rect.top - stageRect.top - 40, text);
            });

            // Compilation modal events (delegated to document since modal is appended to body)
            document.addEventListener('click', (e) => {
                if (e.target.closest('.crm-books-compile-close')) {
                    closeCompilationModal();
                    return;
                }
                if (e.target.closest('.crm-books-compile-run')) {
                    runCompilation();
                    return;
                }
                if (e.target.closest('.crm-books-compile-download')) {
                    downloadCompilation();
                    return;
                }
                if (e.target.classList.contains('crm-books-compile-overlay')) {
                    closeCompilationModal();
                    return;
                }

                // Knowledge Graph modal events
                if (e.target.closest('.crm-books-kg-close') || e.target.classList.contains('crm-books-kg-overlay')) {
                    closeKnowledgeGraph();
                    return;
                }
                if (e.target.closest('.crm-books-kg-add-link')) {
                    showLinkBooksPicker();
                    return;
                }
                if (e.target.closest('.crm-books-kg-confirm')) {
                    const overlay = document.querySelector('.crm-books-kg-overlay');
                    if (overlay) {
                        const fromSel = overlay.querySelector('.crm-books-kg-from');
                        const toSel = overlay.querySelector('.crm-books-kg-to');
                        const labelInput = overlay.querySelector('.crm-books-kg-label');
                        const fromId = fromSel?.value;
                        const toId = toSel?.value;
                        const fromBook = books.find(b => b.bookId === fromId);
                        const toBook = books.find(b => b.bookId === toId);
                        if (fromId && toId && fromId !== toId) {
                            createBookLink(fromId, '', fromBook?.title || '', toId, '', toBook?.title || '', labelInput?.value || 'related').then(() => renderKnowledgeGraphModal());
                        } else {
                            showToast?.('Select two different books.', 'error');
                        }
                    }
                    return;
                }
                const kgDeleteBtn = e.target.closest('.crm-books-kg-link-delete');
                if (kgDeleteBtn) {
                    deleteBookLink(kgDeleteBtn.dataset.linkId).then(() => renderKnowledgeGraphModal());
                    return;
                }
            });

            // Knowledge Graph + Collections + Tags buttons in sources panel
            panel.addEventListener('click', async (e) => {
                if (e.target.closest('.crm-books-kg-open-btn')) {
                    openKnowledgeGraph();
                    return;
                }
                if (e.target.closest('.crm-books-new-collection-btn')) {
                    openNewCollectionModal();
                    return;
                }
                if (e.target.closest('.crm-books-create-tag-btn')) {
                    openCreateTagModal();
                    return;
                }
                const renameBtn = e.target.closest('[data-folder-rename]');
                if (renameBtn) {
                    e.stopPropagation();
                    renameBookCollection(renameBtn.dataset.folderRename);
                    return;
                }
                const deleteColBtn = e.target.closest('[data-folder-delete]');
                if (deleteColBtn) {
                    e.stopPropagation();
                    deleteBookCollection(deleteColBtn.dataset.folderDelete);
                    return;
                }
                const folderToggle = e.target.closest('[data-folder-toggle]');
                if (folderToggle) {
                    const fId = folderToggle.dataset.folderToggle;
                    if (openFolderIds.has(fId)) openFolderIds.delete(fId);
                    else openFolderIds.add(fId);
                    saveOpenFolders();
                    const fCard = folderToggle.closest('.crm-books-folder');
                    if (fCard) {
                        fCard.querySelector('.crm-books-folder-chevron')?.classList.toggle('collapsed', !openFolderIds.has(fId));
                        fCard.querySelector('.crm-books-folder-content')?.classList.toggle('collapsed', !openFolderIds.has(fId));
                    }
                    return;
                }
                const sidebarTagPill = e.target.closest('[data-sidebar-tag-id]');
                if (sidebarTagPill) {
                    const tId = sidebarTagPill.dataset.sidebarTagId;
                    if (!tId) {
                        activeSidebarTagFilters.clear();
                    } else if (activeSidebarTagFilters.has(tId)) {
                        activeSidebarTagFilters.delete(tId);
                    } else {
                        activeSidebarTagFilters.add(tId);
                    }
                    renderSourcesPanel();
                    return;
                }
                if (e.target.closest('[data-clear-sidebar-tags]')) {
                    activeSidebarTagFilters.clear();
                    renderSourcesPanel();
                    return;
                }
                const folderBadge = e.target.closest('.crm-books-header-folder-badge');
                if (folderBadge) {
                    openCollectionMovePopover(folderBadge.dataset.bookId, folderBadge);
                    return;
                }
                const headerAddTagBtn = e.target.closest('.crm-books-header-add-tag-btn');
                if (headerAddTagBtn) {
                    openQuickTagPopover(headerAddTagBtn.dataset.bookId, headerAddTagBtn);
                    return;
                }
                const removeTagBtn = e.target.closest('.crm-books-tag-chip-remove');
                if (removeTagBtn) {
                    e.stopPropagation();
                    await toggleBookTag(removeTagBtn.dataset.bookId, removeTagBtn.dataset.tagId);
                    return;
                }
            });

            // ─── Elaborate Mode: Text Selection & Highlighting (Non-Pages Surfaces) ───
            document.addEventListener('mouseup', (e) => {
                if (!isElaborateModeActive) return;
                if (e.target.closest('.crm-books-elaborate-tray') || e.target.closest('.crm-books-elaborate-drawer')) return;
                // Exclude Pages tab (source reading mode)
                if (e.target.closest('.crm-books-page-content') || e.target.closest('.crm-books-page-stage')) return;

                const mmModal = docQs('#crm-books-mindmap-modal');
                const isInsideBooks = panel && panel.contains(e.target);
                const isInsideMindMap = mmModal && mmModal.contains(e.target) && mmModal.style.display !== 'none';

                if (!isInsideBooks && !isInsideMindMap) return;

                const sel = window.getSelection();
                const text = sel?.toString().trim();
                if (!text || text.length < 2) return;

                const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
                if (!range) return;

                let sectionTitle = '';
                const secCard = e.target.closest('.crm-books-section-card, .crm-books-chapter-card');
                if (secCard) {
                    sectionTitle = secCard.querySelector('.crm-books-section-title')?.textContent?.trim() || 'Summary';
                } else if (activeTab === 'notes') {
                    sectionTitle = 'Notes';
                } else if (activeTab === 'chat') {
                    sectionTitle = 'Chat';
                } else if (isInsideMindMap) {
                    sectionTitle = 'Mind Map';
                } else {
                    sectionTitle = activeTab ? activeTab.toUpperCase() : 'Summary';
                }

                addElaborateSnippet(text, isInsideMindMap ? 'mindmap' : (activeTab || 'summary'), sectionTitle, range);
                sel.removeAllRanges();
            });

            // ─── Elaborate Mode: Click Delegations ───
            document.addEventListener('click', async (e) => {
                // Header / MindMap Elaborate Button
                if (e.target.closest('.crm-books-elaborate-btn') || e.target.closest('#crm-mindmap-elaborate-btn')) {
                    e.stopPropagation();
                    toggleElaborateMode();
                    return;
                }

                // Tray Cancel
                if (e.target.closest('#crm-books-elaborate-tray-cancel-btn')) {
                    e.stopPropagation();
                    toggleElaborateMode(false);
                    return;
                }

                // Tray Done
                if (e.target.closest('#crm-books-elaborate-tray-done-btn')) {
                    e.stopPropagation();
                    await executeElaboration();
                    return;
                }

                // Tray Chip Remove
                const removeChipBtn = e.target.closest('.crm-books-elaborate-chip-remove');
                if (removeChipBtn) {
                    e.stopPropagation();
                    removeElaborateSnippet(removeChipBtn.dataset.snippetId);
                    return;
                }

                // Remove mark on direct click
                const mark = e.target.closest('mark.crm-books-elaborate-mark');
                if (mark && mark.dataset.snippetId) {
                    e.stopPropagation();
                    removeElaborateSnippet(mark.dataset.snippetId);
                    return;
                }

                // Drawer Close
                if (e.target.closest('#crm-books-elaborate-drawer-close')) {
                    e.stopPropagation();
                    closeElaborationDrawer();
                    return;
                }

                // Drawer Save to Notes
                if (e.target.closest('#crm-books-elaborate-save-notes-btn')) {
                    e.stopPropagation();
                    saveElaborationToNotes();
                    return;
                }

                // Drawer Discuss in Chat
                if (e.target.closest('#crm-books-elaborate-chat-btn')) {
                    e.stopPropagation();
                    discussElaborationInChat();
                    return;
                }

                // Drawer Copy Markdown
                if (e.target.closest('#crm-books-elaborate-copy-btn')) {
                    e.stopPropagation();
                    await copyElaborationMarkdown();
                    return;
                }

                // Drawer Retry
                if (e.target.closest('.crm-books-elaborate-retry-btn')) {
                    e.stopPropagation();
                    await executeElaboration();
                    return;
                }

                // Mind Map Node Click in Elaborate Mode
                if (isElaborateModeActive) {
                    const node = e.target.closest('.crm-mindmap-node');
                    if (node) {
                        e.stopPropagation();
                        const nodeId = node.dataset.nodeId || '';
                        const existingSnippet = nodeId ? elaborateSnippets.find(s => s.nodeId === nodeId) : null;
                        if (existingSnippet) {
                            removeElaborateSnippet(existingSnippet.id);
                        } else {
                            const nodeTitle = node.dataset.title || node.querySelector('.crm-mindmap-node-title')?.textContent?.trim() || '';
                            const nodeSummary = node.dataset.summary || node.querySelector('.crm-mindmap-node-summary')?.textContent?.trim() || '';
                            const text = nodeSummary ? `${nodeTitle}: ${nodeSummary}` : nodeTitle;
                            if (text) {
                                const snippetId = addElaborateSnippet(text, 'mindmap', node.dataset.catTitle || nodeTitle, null, nodeId);
                                if (snippetId) {
                                    node.classList.add('crm-mindmap-node-elaborate-selected');
                                }
                            }
                        }
                        return;
                    }
                }
            });
        }

        async function handleGenerateOrViewStudyNotes(sectionIndex, buttonEl, forceRegenerate = false) {
            if (!selectedBookId) return;

            const originalLabel = buttonEl.innerHTML;
            buttonEl.disabled = true;
            buttonEl.innerHTML = `⚡ Processing Study Notes...`;

            try {
                let studyNotes = null;

                if (!forceRegenerate) {
                    const notesRes = await apiGet(`/api/admin/books/${selectedBookId}/sections/${sectionIndex}/study-notes`);
                    studyNotes = notesRes?.studyNotes || notesRes?.data?.studyNotes;
                }

                if (!studyNotes) {
                    buttonEl.innerHTML = `⚡ Synthesizing Study Notes...`;
                    const genRes = await apiPost(`/api/admin/books/${selectedBookId}/sections/${sectionIndex}/study-notes`, { force: forceRegenerate });
                    studyNotes = genRes?.studyNotes || genRes?.data?.studyNotes;
                }

                if (studyNotes) {
                    showStudyNotesModal(studyNotes, sectionIndex);
                    buttonEl.innerHTML = `📖 View Study Module`;
                } else {
                    showToast?.('Failed to load or generate study notes.', 'error');
                    buttonEl.innerHTML = originalLabel;
                }
            } catch (err) {
                console.error('[CRM Books] Error in study notes handler:', err);
                const msg = err?.message || 'Error generating study notes.';
                showToast?.(msg, 'error');
                buttonEl.innerHTML = originalLabel;
            } finally {
                buttonEl.disabled = false;
            }
        }

        function showStudyNotesModal(studyNotes, sectionIndex) {
            const existing = document.getElementById('crm-books-study-notes-modal');
            if (existing) existing.remove();

            const isDark = document.querySelector('[data-panel="books"]')?.classList.contains('books-dark');
            const darkClass = isDark ? ' books-dark' : '';

            const title = studyNotes.title || 'Comprehensive Study Notes';
            const overview = studyNotes.overview ? `<p class="crm-books-notes-overview"><strong>Overview:</strong> ${escapeHtml(studyNotes.overview)}</p>` : '';
            const content = studyNotes.content || '';

            let keyTermsHtml = '';
            if (Array.isArray(studyNotes.keyTerms) && studyNotes.keyTerms.length > 0) {
                keyTermsHtml = `<div class="crm-books-study-keyterms" style="margin-bottom:20px;">` +
                    `<h4 style="margin-bottom:10px; font-size:1.05em; font-family:var(--books-font-display, inherit); color:var(--books-text, #1B1B1F);">Key Terms & Concepts</h4>` +
                    `<div class="crm-books-keyterms-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:10px;">` +
                    studyNotes.keyTerms.map((kt) =>
                        `<div class="crm-books-keyterm-card">` +
                        `<strong style="color:var(--books-accent, #B8860B);">${escapeHtml(kt.term || '')}:</strong> ${escapeHtml(kt.definition || '')}` +
                        (kt.example ? `<br><small style="font-size:0.85em; color:var(--books-text-muted, #6B6560);">Example: ${escapeHtml(kt.example)}</small>` : '') +
                        `</div>`
                    ).join('') +
                    `</div></div>`;
            }

            const contentHtml = formatStudyNotesMarkdown(content);

            const modalHtml = `
            <div id="crm-books-study-notes-modal" class="crm-books-modal-overlay${darkClass}" role="dialog" aria-modal="true" aria-labelledby="crm-books-study-notes-title">
              <div class="crm-books-modal-content crm-books-study-notes-dialog">
                <div class="crm-books-modal-header" style="padding:16px 20px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--books-border, #E8E2D9);">
                  <h3 id="crm-books-study-notes-title" style="margin:0; font-size:1.15em; font-family:var(--books-font-display, inherit); display:flex; align-items:center; gap:8px; color:var(--books-text, #1B1B1F);">⚡ ${escapeHtml(title)}</h3>
                  <button type="button" class="crm-books-modal-close" style="background:none; border:none; font-size:1.5em; cursor:pointer; color:var(--books-text-muted, #6B6560);" aria-label="Close">&times;</button>
                </div>
                <div class="crm-books-modal-body crm-books-study-notes-body" style="padding:20px; overflow-y:auto; flex:1; font-size:1.02em; line-height:1.8;">
                  ${overview}
                  ${keyTermsHtml}
                  <div class="crm-books-study-notes-markdown" style="line-height:1.85;">${contentHtml}</div>
                </div>
                <div class="crm-books-modal-footer" style="padding:14px 20px; display:flex; align-items:center; justify-content:flex-end; gap:10px; border-top:1px solid var(--books-border, #E8E2D9);">
                  <button type="button" class="crm-btn crm-btn-secondary crm-books-regenerate-notes-btn" data-section-index="${sectionIndex != null ? sectionIndex : ''}" title="Re-generate study notes from scratch">🔄 Regenerate</button>
                  <button type="button" class="crm-btn crm-btn-secondary crm-books-copy-notes-btn">📋 Copy Notes</button>
                  <button type="button" class="crm-btn crm-btn-primary crm-books-save-notes-btn">💾 Save to Notes</button>
                  <button type="button" class="crm-btn crm-btn-secondary crm-books-modal-cancel">Close</button>
                </div>
              </div>
            </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modal = document.getElementById('crm-books-study-notes-modal');

            const handleKeyDown = (e) => {
                if (e.key === 'Escape') closeModal();
            };

            const closeModal = () => {
                document.removeEventListener('keydown', handleKeyDown);
                modal.remove();
            };

            document.addEventListener('keydown', handleKeyDown);

            modal.querySelector('.crm-books-modal-close').addEventListener('click', closeModal);
            modal.querySelector('.crm-books-modal-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });


            modal.querySelector('.crm-books-copy-notes-btn').addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(`${title}\n\n${content}`);
                    showToast?.('Study notes copied to clipboard!', 'info');
                } catch (_) {
                    showToast?.('Failed to copy to clipboard.', 'error');
                }
            });

            modal.querySelector('.crm-books-save-notes-btn').addEventListener('click', async () => {
                if (selectedBookId) {
                    const noteText = `### ${title}\n\n${content}`;
                    saveBookNote(selectedBookId, noteText);
                    apiPost(`/api/admin/books/${selectedBookId}/notes`, { text: noteText }).catch((err) => {
                        console.error('[CRM Books] Firestore note save failed:', err);
                    });
                    showToast?.('Saved study module to Notes!', 'info');
                }
            });

            modal.querySelector('.crm-books-regenerate-notes-btn').addEventListener('click', async () => {
                if (sectionIndex == null || !selectedBookId) return;
                closeModal();
                const btn = panel?.querySelector(`.crm-books-generate-notes-btn[data-section-index="${sectionIndex}"]`);
                if (btn) {
                    await handleGenerateOrViewStudyNotes(sectionIndex, btn, true);
                }
            });
        }

        function formatStudyNotesMarkdown(md) {
            if (!md) return '';
            let html = escapeHtml(md);
            html = html
                .replace(/^### (.*$)/gim, '<h4 style="margin-top:16px; margin-bottom:8px; font-size:1.08em; font-family:var(--books-font-display, inherit); color:var(--books-text, #1B1B1F);">$1</h4>')
                .replace(/^## (.*$)/gim, '<h3 style="margin-top:20px; margin-bottom:10px; font-size:1.18em; font-family:var(--books-font-display, inherit); border-bottom:1px solid var(--books-border, #E8E2D9); padding-bottom:4px; color:var(--books-text, #1B1B1F);">$1</h3>')
                .replace(/^# (.*$)/gim, '<h2 style="margin-top:24px; margin-bottom:12px; font-size:1.3em; font-family:var(--books-font-display, inherit); color:var(--books-text, #1B1B1F);">$1</h2>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/^&gt; (.*$)/gim, '<blockquote style="margin:12px 0; padding:8px 14px; background:var(--books-surface-dim, #F3F0EA); border-left:4px solid var(--books-accent, #B8860B); font-style:italic; color:var(--books-text, #1B1B1F);">$1</blockquote>')
                .replace(/^- (.*$)/gim, '<li style="margin-bottom:4px;">$1</li>')
                .replace(/\n\n/g, '<br><br>');
            html = html.replace(/(<li style="margin-bottom:4px;">.*?<\/li>(?:\s*<li style="margin-bottom:4px;">.*?<\/li>)*)/gim, (block) => {
                return '<ul style="padding-left:20px; margin:8px 0;">' + block + '</ul>';
            });
            return html;
        }


        // --- Lifecycle ---
        async function init() {
            if (localStorage.getItem('crm_books_dark_mode') === '1' && panel) {
                panel.classList.add('books-dark');
            }
            bookmarks = loadBookmarks();
            bindEvents();
            loadUsage().catch(() => {});
            try {
                await apiPost('/api/admin/books/ensure-seed', {}).catch(() => {});
            } catch (_ignored) {
                // ignore seed error
            }
            await Promise.all([
                loadBookCollections(),
                loadBookTags()
            ]).catch(() => {});
            await refresh();
        }

        function dispose() {
            detachSnapshot();
            cancelPageTurn();
            if (uploadTask) {
                try { uploadTask.cancel(); } catch (_ignored) {
                    // Ignore cancel error if upload task is already completed or cancelled
                }
                uploadTask = null;
            }
        }

        function activateWithBookId(bookId) {
            if (bookId && bookId !== selectedBookId) {
                selectBook(bookId).catch(console.error);
            } else {
                refresh().catch(console.error);
            }
        }

        return {
            init,
            activate: activateWithBookId,
            refresh,
            dispose,
            selectBook,
            sendMessage,
            toggleElaborateMode,
            addElaborateSnippet,
            removeElaborateSnippet,
            clearElaborateMarks,
            getElaborateSnippets: () => [...elaborateSnippets],
            isElaborateModeActive: () => isElaborateModeActive
        };
    }

    return {
        createController,
        normalizeBooks,
        buildIngestLabel,
        formatEta,
        renderCitations,
        ingestWeightedPercent,
        deriveThreadTitle,
        formatElaborateParagraphs,
        generateElaborationMarkdown,
        reflowPageText,
        formatPageText,
        getReadablePageNumbers,
        findAdjacentReadablePage,
        findCitationMatch,
        highlightPageText,
        normalizeCitationText,
        resolveCitationLocation,
        clampReaderFontScale,
        normalizeTagName,
        filterBooksByTags,
        groupBooksByCollection,
        deduplicateRepeatedPhrases,
        isScannerNoiseLine,
        repairArchivalOcrText
    };
})();
