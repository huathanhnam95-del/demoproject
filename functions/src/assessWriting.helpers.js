function truncateForLog(value, max = 400) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function extractJsonObject(text) {
    const rawText = String(text || '').trim();
    if (!rawText) {
        throw new Error('Empty model response');
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('No JSON object found in model response');
    }

    return JSON.parse(jsonMatch[0]);
}

function extractVertexText(response) {
    if (typeof response?.text === 'function') {
        return response.text();
    }

    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
        return parts.map((part) => part?.text || '').join('');
    }

    throw new Error('No text found in Vertex AI response');
}

function buildModelPrompt(text, context = {}) {
    const contextLines = [
        context?.entryType ? `Entry type: ${context.entryType}` : '',
        context?.word ? `Target word: ${context.word}` : '',
        context?.lemma ? `Lemma: ${context.lemma}` : '',
        context?.partOfSpeech ? `Part of speech: ${context.partOfSpeech}` : '',
        context?.promptText ? `Task shown to learner: ${context.promptText}` : '',
        context?.usedCollocation ? `Selected collocation: ${context.usedCollocation}` : '',
        context?.validationTarget ? `Required target: ${context.validationTarget}` : ''
    ].filter(Boolean);

    return `
        Context:
        ${contextLines.length > 0 ? contextLines.join('\n') : 'General writing'}
        Text: "${text}"
    `;
}

module.exports = {
    buildModelPrompt,
    extractJsonObject,
    extractVertexText,
    truncateForLog
};
