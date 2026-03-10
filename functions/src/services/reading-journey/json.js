function extractJsonObject(text) {
    const raw = String(text || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('No JSON object found in response');
    }
    return raw.slice(start, end + 1);
}

function safeJsonParse(text) {
    const jsonText = extractJsonObject(text);
    return JSON.parse(jsonText);
}

function countWords(text) {
    return String(text || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
}

function trimToMaxWords(text, maxWords) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return String(text || '').trim();
    const truncated = words.slice(0, maxWords).join(' ');
    const sentenceMatch = truncated.match(/^(.*[.!?])\s*[^.!?]*$/);
    return (sentenceMatch ? sentenceMatch[1] : truncated).trim();
}

module.exports = {
    extractJsonObject,
    safeJsonParse,
    countWords,
    trimToMaxWords
};
