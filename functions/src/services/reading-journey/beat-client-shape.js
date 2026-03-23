const CANONICAL_CHOICE_ID_SET = new Set(['investigate', 'ask', 'wait']);

function normalizeChoiceText(choice) {
    return String(choice?.label || choice?.text || '').trim();
}

function normalizeChoiceId(choice) {
    return String(choice?.id || choice?.choice_id || '').trim().toLowerCase();
}

function normalizeChoices(choiceItems) {
    if (!Array.isArray(choiceItems)) return [];

    return choiceItems
        .map((choice) => ({
            id: normalizeChoiceId(choice),
            text: normalizeChoiceText(choice)
        }))
        .filter((choice) => choice.id && choice.text);
}

function normalizeBeatForClient(rawBeat) {
    if (!rawBeat || typeof rawBeat !== 'object') return rawBeat;

    const beat = { ...rawBeat };
    const questionChoices = normalizeChoices(beat.choiceQuestion?.options);
    const hasCanonicalQuestionChoices = questionChoices.length > 0
        && questionChoices.every((choice) => CANONICAL_CHOICE_ID_SET.has(choice.id));

    if (hasCanonicalQuestionChoices) {
        beat.choices = questionChoices;
        return beat;
    }

    if (Array.isArray(beat.choices)) {
        beat.choices = normalizeChoices(beat.choices);
    }

    return beat;
}

module.exports = {
    normalizeBeatForClient
};
