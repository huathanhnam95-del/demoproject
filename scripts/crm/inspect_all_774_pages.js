// scripts/crm/inspect_all_774_pages.js
/**
 * Exhaustive Page-by-Page Inspection across all 774 pages:
 * - Harmer 5th Edition: Pages 1 - 459
 * - Teaching Pronunciation with Confidence: Pages 1 - 315
 * 
 * Evaluates every single page using the production books-workspace.js reflow engine.
 */

const fs = require('fs');
const path = require('path');

// Initialize window global for books-workspace.js
global.window = {};
require('../../public/js/crm/books-workspace.js');
const workspace = global.window.CrmBooksWorkspace;

const HARMER_PATH = path.join(__dirname, '../../tmp/harmer_pages.json');
const PRON_PATH = path.join(__dirname, '../../tmp/pronunciation_rev001_pages.json');

const IPA_REGEX = /[\u0250-\u02AF\u1D00-\u1D7F\u0370-\u03FF]|(?:[/\[][^/\]\n]{1,15}[/\]])/g;
const TIMESTAMP_REGEX = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const CITATION_REGEX = /\[\s*[A-Z][a-zA-Z\s.,&'’–-]+\s*,\s*(?:19|20)\d{2}[^\]]*\]/g;
const GLUED_WORD_REGEX = /\b[A-Za-z]{28,}\b/g;

function inspectPage(text, bookKey, pageNum) {
    const raw = String(text ?? '');
    const trimmed = raw.trim();
    const charCount = raw.length;
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lineCount = lines.length;
    const words = raw.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // Check blank
    if (trimmed.length === 0) {
        return {
            book: bookKey,
            page: pageNum,
            status: 'INFO_BLANK',
            char_count: 0,
            word_count: 0,
            line_count: 0,
            ipa_symbols: [],
            timestamps: [],
            citations: [],
            repeated_phrases: [],
            noise_lines: [],
            glued_words: [],
            rendered_html_length: 0,
            notes: 'Blank page (flyleaf or section spacer)'
        };
    }

    // Check IPA symbols
    const ipaMatches = Array.from(new Set(raw.match(IPA_REGEX) || []));

    // Check timestamps
    const timestampMatches = Array.from(new Set(raw.match(TIMESTAMP_REGEX) || []));

    // Check citations
    const citationMatches = Array.from(new Set(raw.match(CITATION_REGEX) || []));

    // Check glued words
    const gluedMatches = Array.from(new Set(raw.match(GLUED_WORD_REGEX) || []));

    // Check noise lines
    const noiseLines = [];
    lines.forEach(line => {
        if (workspace.isScannerNoiseLine(line)) {
            noiseLines.push(line);
        }
    });

    // Check repeated phrases (InDesign drop-shadows)
    const repeatedPhrases = [];
    lines.forEach(line => {
        const match = line.match(/([A-Za-z0-9][A-Za-z0-9\s()/,.'’–—-]{4,50}?)(?:\s*\1){2,}/);
        if (match) {
            repeatedPhrases.push(match[1].trim());
        }
    });

    // Run production reflow engine
    const renderedHtml = workspace.formatPageText(raw, (v) => String(v));
    const renderedLength = renderedHtml.length;

    // Determine classification
    let status = 'PASS';
    const notes = [];

    if (repeatedPhrases.length > 0) {
        status = 'DEDUP_APPLIED';
        notes.push(`Deduplicated ${repeatedPhrases.length} layered InDesign drop-shadow phrases`);
    }

    if (noiseLines.length > 0) {
        if (status === 'PASS') status = 'NOISE_FILTERED';
        notes.push(`Filtered ${noiseLines.length} scanner noise lines`);
    }

    if (charCount < 150) {
        if (status === 'PASS') status = 'INFO_SHORT';
        notes.push(`Short page (${charCount} chars) - title, half-title or section divider`);
    }

    if (gluedMatches.length > 0) {
        notes.push(`Found abnormally long token: ${gluedMatches.join(', ')}`);
    }

    if (ipaMatches.length > 0) {
        notes.push(`Contains ${ipaMatches.length} IPA phonetic elements`);
    }

    if (timestampMatches.length > 0) {
        notes.push(`Contains ${timestampMatches.length} video/audio timestamps`);
    }

    return {
        book: bookKey,
        page: pageNum,
        status,
        char_count: charCount,
        word_count: wordCount,
        line_count: lineCount,
        ipa_symbols: ipaMatches.slice(0, 10),
        timestamps: timestampMatches.slice(0, 5),
        citations: citationMatches.slice(0, 5),
        repeated_phrases: repeatedPhrases,
        noise_lines: noiseLines.slice(0, 5),
        glued_words: gluedMatches,
        rendered_html_length: renderedLength,
        notes: notes.join('; ') || 'Clean text reflow'
    };
}

function runExhaustiveInspection() {
    console.log('='.repeat(70));
    console.log('EXHAUSTIVE PAGE-BY-PAGE INSPECTION (ALL 774 PAGES)');
    console.log('='.repeat(70));

    // 1. Harmer (5th Edition)
    const harmerData = JSON.parse(fs.readFileSync(HARMER_PATH, 'utf8'));
    const harmerPages = harmerData.pages || [];
    console.log(`\n1. Inspecting Harmer (5th Edition) - ${harmerPages.length} pages...`);

    const harmerResults = [];
    const harmerStats = { total: harmerPages.length, pass: 0, blank: 0, short: 0, dedup: 0, noise: 0, ipa: 0, timestamps: 0 };

    for (let i = 0; i < harmerPages.length; i++) {
        const pageNum = i + 1;
        const res = inspectPage(harmerPages[i], 'harmer', pageNum);
        harmerResults.push(res);

        if (res.status === 'PASS') harmerStats.pass++;
        else if (res.status === 'INFO_BLANK') harmerStats.blank++;
        else if (res.status === 'INFO_SHORT') harmerStats.short++;
        else if (res.status === 'DEDUP_APPLIED') harmerStats.dedup++;
        else if (res.status === 'NOISE_FILTERED') harmerStats.noise++;

        if (res.ipa_symbols.length > 0) harmerStats.ipa++;
        if (res.timestamps.length > 0) harmerStats.timestamps++;
    }

    console.log('Harmer Inspection Complete:');
    console.log(`  Total pages: ${harmerStats.total}`);
    console.log(`  Clean PASS pages: ${harmerStats.pass}`);
    console.log(`  InDesign Dedup Applied pages: ${harmerStats.dedup}`);
    console.log(`  Noise Filtered pages: ${harmerStats.noise}`);
    console.log(`  Short/Divider pages: ${harmerStats.short}`);
    console.log(`  Blank pages: ${harmerStats.blank}`);
    console.log(`  Pages with Video Timestamps: ${harmerStats.timestamps}`);
    console.log(`  Pages with Phonetic Symbols: ${harmerStats.ipa}`);

    // 2. Teaching Pronunciation with Confidence
    const pronData = JSON.parse(fs.readFileSync(PRON_PATH, 'utf8'));
    const pronPages = pronData.pages || [];
    console.log(`\n2. Inspecting Teaching Pronunciation with Confidence - ${pronPages.length} pages...`);

    const pronResults = [];
    const pronStats = { total: pronPages.length, pass: 0, blank: 0, short: 0, dedup: 0, noise: 0, ipa: 0, timestamps: 0 };

    for (let i = 0; i < pronPages.length; i++) {
        const pageNum = i + 1;
        const res = inspectPage(pronPages[i], 'pronunciation', pageNum);
        pronResults.push(res);

        if (res.status === 'PASS') pronStats.pass++;
        else if (res.status === 'INFO_BLANK') pronStats.blank++;
        else if (res.status === 'INFO_SHORT') pronStats.short++;
        else if (res.status === 'DEDUP_APPLIED') pronStats.dedup++;
        else if (res.status === 'NOISE_FILTERED') pronStats.noise++;

        if (res.ipa_symbols.length > 0) pronStats.ipa++;
        if (res.timestamps.length > 0) pronStats.timestamps++;
    }

    console.log('Teaching Pronunciation Inspection Complete:');
    console.log(`  Total pages: ${pronStats.total}`);
    console.log(`  Clean PASS pages: ${pronStats.pass}`);
    console.log(`  InDesign Dedup Applied pages: ${pronStats.dedup}`);
    console.log(`  Noise Filtered pages: ${pronStats.noise}`);
    console.log(`  Short/Divider pages: ${pronStats.short}`);
    console.log(`  Blank pages: ${pronStats.blank}`);
    console.log(`  Pages with Phonetic IPA notation: ${pronStats.ipa}`);

    // Combined Report
    const combinedReport = {
        inspected_at: new Date().toISOString(),
        total_pages: harmerPages.length + pronPages.length,
        summary: {
            harmer: harmerStats,
            pronunciation: pronStats
        },
        harmer_pages: harmerResults,
        pronunciation_pages: pronResults
    };

    const outPath = path.join(__dirname, '../../reports/all_774_pages_inspection_report.json');
    fs.writeFileSync(outPath, JSON.stringify(combinedReport, null, 2), 'utf8');
    console.log(`\nFull 774-page inspection report saved to: ${outPath}`);
}

runExhaustiveInspection();
