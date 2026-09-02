/**
 * CRM Books — Text Quality and Corruption Diagnostics
 * Evaluates embedded and OCR text quality, whitespace ratio, alphabetic runs,
 * suspicious tokens, and calculates line-dehyphenation-tolerant CER/WER.
 */

function calculateWhitespaceRatio(text) {
    if (!text || typeof text !== 'string') return 0;
    if (text.length === 0) return 0;
    const whitespaceMatches = text.match(/\s/g);
    const whitespaceCount = whitespaceMatches ? whitespaceMatches.length : 0;
    return whitespaceCount / text.length;
}

function calculateLongestAlphabeticRun(text) {
    if (!text || typeof text !== 'string') return 0;
    const runs = text.match(/[A-Za-z]+/g);
    if (!runs || runs.length === 0) return 0;
    return Math.max(...runs.map((r) => r.length));
}

const SUSPICIOUS_TOKEN_PATTERNS = [
    /\b(?:jof|itt|IIMIWIN|Specias)\b/,
    /[a-z][A-Z]/, // Internal camel-case fusion e.g. NeglectedSpecias, PronunciationInThe
    /\b[A-Z]{2,}[a-z]{2,}/, // Double capital prefix artifact e.g. ANeglected
    /[A-Za-z]{20,}/ // Excessive fused alphabetic run
];

function detectSuspiciousTokens(text) {
    if (!text || typeof text !== 'string') return [];
    const tokens = text.split(/\s+/).filter(Boolean);
    const detected = [];

    for (const token of tokens) {
        for (const pattern of SUSPICIOUS_TOKEN_PATTERNS) {
            if (pattern.test(token)) {
                detected.push(token);
                break;
            }
        }
    }
    return detected;
}

function normalizeForMetrics(text, options = {}) {
    if (!text || typeof text !== 'string') return '';
    const { dehyphenate = true, caseSensitive = false } = options;
    let normalized = text;
    if (dehyphenate) {
        // Fix line breaks with hyphens: "com-\nmunication" -> "communication"
        normalized = normalized.replace(/(\b[A-Za-z]+)-\s*\r?\n\s*([A-Za-z]+\b)/g, '$1$2');
    }
    // Collapse newlines and whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();
    if (!caseSensitive) {
        normalized = normalized.toLowerCase();
    }
    return normalized;
}

function levenshteinDistance(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1, // deletion
                dp[i][j - 1] + 1, // insertion
                dp[i - 1][j - 1] + cost // substitution
            );
        }
    }
    return dp[m][n];
}

function calculateCER(reference, hypothesis, options = {}) {
    const normRef = normalizeForMetrics(reference, options);
    const normHyp = normalizeForMetrics(hypothesis, options);
    if (!normRef && !normHyp) return 0;
    if (!normRef) return 1.0;
    const dist = levenshteinDistance(normRef, normHyp);
    return dist / normRef.length;
}

function calculateWER(reference, hypothesis, options = {}) {
    const normRef = normalizeForMetrics(reference, options);
    const normHyp = normalizeForMetrics(hypothesis, options);
    const refWords = normRef ? normRef.split(' ') : [];
    const hypWords = normHyp ? normHyp.split(' ') : [];
    if (refWords.length === 0 && hypWords.length === 0) return 0;
    if (refWords.length === 0) return 1.0;
    const dist = levenshteinDistance(refWords, hypWords);
    return dist / refWords.length;
}

function detectDisagreement(embeddedText, ocrText, options = {}) {
    const cer = calculateCER(embeddedText, ocrText, options);
    const wer = calculateWER(embeddedText, ocrText, options);
    const cerThreshold = options.cerThreshold ?? 0.05;
    const werThreshold = options.werThreshold ?? 0.10;
    return {
        cer,
        wer,
        disagrees: cer > cerThreshold || wer > werThreshold
    };
}

const QUALITY_THRESHOLDS = {
    MIN_WHITESPACE_RATIO: 0.05, // less than 5% spaces is highly suspect
    MAX_ALPHABETIC_RUN: 20,     // word > 20 chars without spaces/punct is suspect
    CRITICAL_CORRUPT_SPACE_RATIO: 0.01 // < 1% spaces is definitely corrupt
};

function assessPageTextQuality(text, pageNumber = 1) {
    const str = String(text || '');
    const charCount = str.length;
    const isBlank = charCount === 0 || str.trim().length === 0;
    const whitespaceRatio = calculateWhitespaceRatio(str);
    const longestAlphaRun = calculateLongestAlphabeticRun(str);
    const suspiciousTokens = detectSuspiciousTokens(str);

    const reasons = [];
    if (!isBlank) {
        if (whitespaceRatio < QUALITY_THRESHOLDS.CRITICAL_CORRUPT_SPACE_RATIO) {
            reasons.push(`Collapsed whitespace: ${(whitespaceRatio * 100).toFixed(2)}% spaces`);
        } else if (whitespaceRatio < QUALITY_THRESHOLDS.MIN_WHITESPACE_RATIO) {
            reasons.push(`Low whitespace ratio: ${(whitespaceRatio * 100).toFixed(2)}%`);
        }
        if (longestAlphaRun >= QUALITY_THRESHOLDS.MAX_ALPHABETIC_RUN) {
            reasons.push(`Long alphabetic run: ${longestAlphaRun} characters`);
        }
        if (suspiciousTokens.length > 0) {
            reasons.push(`Suspicious tokens found: ${suspiciousTokens.slice(0, 3).join(', ')}`);
        }
    }

    const isSuspect = reasons.length > 0;

    return {
        pageNumber,
        charCount,
        isBlank,
        whitespaceRatio,
        longestAlphaRun,
        suspiciousTokens,
        isSuspect,
        reasons
    };
}

function assessBookTextQuality(pages) {
    if (!Array.isArray(pages) || pages.length === 0) {
        return {
            totalPages: 0,
            suspectPagesCount: 0,
            isSuspect: true,
            reasons: ['No pages provided'],
            pageDiagnostics: []
        };
    }

    const pageDiagnostics = pages.map((pageText, idx) => assessPageTextQuality(pageText, idx + 1));
    const nonBlankPages = pageDiagnostics.filter((d) => !d.isBlank);
    const suspectPages = nonBlankPages.filter((d) => d.isSuspect);

    const totalWhitespaceRatio = nonBlankPages.reduce((sum, d) => sum + d.whitespaceRatio, 0);
    const avgWhitespaceRatio = nonBlankPages.length > 0 ? totalWhitespaceRatio / nonBlankPages.length : 0;
    const maxAlphaRun = nonBlankPages.reduce((max, d) => Math.max(max, d.longestAlphaRun), 0);
    const totalSuspiciousTokens = nonBlankPages.reduce((sum, d) => sum + d.suspiciousTokens.length, 0);

    const bookReasons = [];
    if (suspectPages.length > 0) {
        bookReasons.push(`${suspectPages.length}/${pages.length} pages flagged as suspect`);
    }
    if (avgWhitespaceRatio < QUALITY_THRESHOLDS.MIN_WHITESPACE_RATIO && nonBlankPages.length > 0) {
        bookReasons.push(`Average whitespace ratio too low (${(avgWhitespaceRatio * 100).toFixed(2)}%)`);
    }
    if (maxAlphaRun >= QUALITY_THRESHOLDS.MAX_ALPHABETIC_RUN) {
        bookReasons.push(`Maximum alphabetic run ${maxAlphaRun} chars exceeds limit`);
    }

    const isSuspect = suspectPages.length > 0 || avgWhitespaceRatio < QUALITY_THRESHOLDS.MIN_WHITESPACE_RATIO;

    return {
        totalPages: pages.length,
        suspectPagesCount: suspectPages.length,
        avgWhitespaceRatio,
        maxAlphaRun,
        totalSuspiciousTokens,
        isSuspect,
        reasons: bookReasons,
        pageDiagnostics
    };
}

module.exports = {
    calculateWhitespaceRatio,
    calculateLongestAlphabeticRun,
    detectSuspiciousTokens,
    normalizeForMetrics,
    calculateCER,
    calculateWER,
    detectDisagreement,
    assessPageTextQuality,
    assessBookTextQuality,
    QUALITY_THRESHOLDS
};
