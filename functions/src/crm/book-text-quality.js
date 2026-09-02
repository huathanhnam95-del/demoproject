const TOKEN_PATTERN = /[A-Za-z][A-Za-z'-]*/g;
const ALPHA_PATTERN = /[A-Za-z]+/g;

function asText(value) {
    return typeof value === 'string' ? value : String(value ?? '');
}

function normalizeText(value) {
    return asText(value)
        .replace(/-\s+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizedCharacters(value) {
    return normalizeText(value).replace(/\s/g, '');
}

function tokenize(value) {
    return normalizeText(value).match(TOKEN_PATTERN) || [];
}

function editDistance(left, right) {
    const a = Array.isArray(left) ? left : [...asText(left)];
    const b = Array.isArray(right) ? right : [...asText(right)];
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

    for (let row = 1; row <= a.length; row++) {
        const current = [row];
        for (let column = 1; column <= b.length; column++) {
            const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
            const insertion = current[column - 1] + 1;
            const deletion = previous[column] + 1;
            current[column] = Math.min(substitution, insertion, deletion);
        }
        previous = current;
    }

    return previous[b.length];
}

function errorRate(distance, referenceLength) {
    if (referenceLength === 0) return distance === 0 ? 0 : 1;
    return Number((distance / referenceLength).toFixed(6));
}

function compareTextQuality(embeddedText, referenceText) {
    const embeddedCharacters = normalizedCharacters(embeddedText);
    const referenceCharacters = normalizedCharacters(referenceText);
    const embeddedWords = tokenize(embeddedText);
    const referenceWords = tokenize(referenceText);
    const characterDistance = editDistance(embeddedCharacters, referenceCharacters);
    const wordDistance = editDistance(embeddedWords, referenceWords);

    return {
        cer: errorRate(characterDistance, referenceCharacters.length),
        wer: errorRate(wordDistance, referenceWords.length),
        characterDistance,
        wordDistance,
        normalizedEmbeddedText: normalizeText(embeddedText),
        normalizedReferenceText: normalizeText(referenceText)
    };
}

function whitespaceRatio(value) {
    const text = asText(value);
    if (text.length === 0) return 0;
    const whitespaceCount = (text.match(/\s/g) || []).length;
    return Number((whitespaceCount / text.length).toFixed(6));
}

function longestAlphaRun(value) {
    const runs = asText(value).match(ALPHA_PATTERN) || [];
    return runs.reduce((longest, run) => Math.max(longest, run.length), 0);
}

function unique(values) {
    return [...new Set(values)];
}

function heuristicSuspiciousTokens(value) {
    const text = asText(value);
    const tokens = text.match(TOKEN_PATTERN) || [];
    return tokens.filter((token) => {
        const hasCaseBreak = /[a-z][A-Z]/.test(token);
        const isLongAllCaps = token.length >= 4 && token === token.toUpperCase();
        const isLongUnspacedToken = token.length >= 15 && !/\s/.test(text);
        return hasCaseBreak || isLongAllCaps || isLongUnspacedToken;
    });
}

function referenceDisagreementTokens(embeddedText, referenceText) {
    const referenceTokens = new Set(tokenize(referenceText));
    return (asText(embeddedText).match(TOKEN_PATTERN) || [])
        .filter((token) => !referenceTokens.has(token.toLowerCase()));
}

function analyzeTextQuality({ pages = [], referencePages = [], physicalPageCount } = {}) {
    const embeddedPages = Array.isArray(pages) ? pages : [];
    const references = Array.isArray(referencePages) ? referencePages : [];
    const count = Number.isInteger(physicalPageCount) && physicalPageCount >= 0
        ? physicalPageCount
        : Math.max(embeddedPages.length, references.length);
    const diagnostics = Array.from({ length: count }, (_, index) => {
        const embeddedText = asText(embeddedPages[index]);
        const referenceText = references[index] === undefined ? null : asText(references[index]);
        const comparison = referenceText === null
            ? { cer: null, wer: null, characterDistance: null, wordDistance: null }
            : compareTextQuality(embeddedText, referenceText);
        const suspicious = heuristicSuspiciousTokens(embeddedText);
        const disagreementTokens = referenceText === null
            ? []
            : referenceDisagreementTokens(embeddedText, referenceText);

        return {
            pageNumber: index + 1,
            embeddedText,
            referenceText,
            isBlank: embeddedText.trim().length === 0,
            extractedTextBlank: embeddedText.trim().length === 0,
            confirmedPhysicalBlank: referenceText === null ? null : referenceText.trim().length === 0,
            whitespaceRatio: whitespaceRatio(embeddedText),
            longestAlphaRun: longestAlphaRun(embeddedText),
            suspiciousTokens: unique([...suspicious, ...disagreementTokens]),
            cer: comparison.cer,
            wer: comparison.wer,
            embeddedVsReferenceDisagreement: referenceText !== null && comparison.cer > 0,
            referenceProvided: referenceText !== null
        };
    });
    const pagesWithReference = diagnostics.filter((page) => page.referenceProvided);
    const disagreement = pagesWithReference.some((page) => page.embeddedVsReferenceDisagreement);
    const suspiciousTokens = unique(diagnostics.flatMap((page) => page.suspiciousTokens));
    const cerValues = pagesWithReference.map((page) => page.cer).filter((value) => value !== null);
    const werValues = pagesWithReference.map((page) => page.wer).filter((value) => value !== null);
    const average = (values) => values.length === 0
        ? null
        : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
    const extractedTextBlankPages = diagnostics
        .filter((page) => page.extractedTextBlank)
        .map((page) => page.pageNumber);
    const blankPages = diagnostics
        .filter((page) => page.confirmedPhysicalBlank === true)
        .map((page) => page.pageNumber);
    const hasCompleteReferences = count > 0 && references.length === count &&
        diagnostics.every((page) => page.referenceProvided);
    const sourceAccuracyStatus = hasCompleteReferences && !disagreement ? 'verified' : 'unverified';

    return {
        physicalPageCount: count,
        extractedPageCount: embeddedPages.length,
        blankPageCount: blankPages.length,
        blankPages,
        extractedTextBlankCount: extractedTextBlankPages.length,
        extractedTextBlankPages,
        pages: diagnostics,
        whitespaceRatio: diagnostics.length === 0
            ? 0
            : Number((diagnostics.reduce((sum, page) => sum + page.whitespaceRatio, 0) / diagnostics.length).toFixed(6)),
        longestAlphaRun: diagnostics.reduce((longest, page) => Math.max(longest, page.longestAlphaRun), 0),
        suspiciousTokens,
        cer: average(cerValues),
        wer: average(werValues),
        embeddedVsReferenceDisagreement: disagreement,
        sourceAccuracyStatus,
        sourceAccurate: sourceAccuracyStatus === 'verified' ? true : null
    };
}

module.exports = {
    analyzeTextQuality,
    compareTextQuality,
    editDistance,
    longestAlphaRun,
    normalizeText,
    whitespaceRatio
};
