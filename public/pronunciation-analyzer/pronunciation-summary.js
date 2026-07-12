function invariant(condition, message) {
    if (!condition) throw new Error(`Invalid pronunciation summary: ${message}`);
}

function isStressIndex(value, count) {
    return Number.isInteger(value) && value >= 0 && value < count;
}

function displaySyllableLabel(syllable, emphasized) {
    const orthographicLabel = String(syllable?.label || '').trim();
    const source = orthographicLabel || String(syllable?.ipa || '').trim();
    invariant(source.length > 0, 'syllable label or IPA is required');
    return emphasized && orthographicLabel
        ? source.toLocaleUpperCase('en-US')
        : source;
}

export function buildPronunciationSummary(variant) {
    invariant(variant && typeof variant === 'object', 'variant is required');
    const count = variant.syllableCount;
    const syllables = variant.syllables;
    invariant(Number.isInteger(count) && count > 0, 'syllable count must be positive');
    invariant(Array.isArray(syllables) && syllables.length === count, 'syllable count mismatch');

    const primaryStress = variant.primaryStress;
    invariant(isStressIndex(primaryStress, count), 'primary stress index is out of range');
    const secondaryStress = Array.isArray(variant.secondaryStress)
        ? variant.secondaryStress
        : [];
    invariant(
        secondaryStress.every((index) => isStressIndex(index, count)),
        'secondary stress index is out of range'
    );

    const secondarySet = new Set(secondaryStress);
    const modeledSyllables = syllables.map((syllable, index) => {
        const stress = count === 1
            ? 'single'
            : index === primaryStress
                ? 'primary'
                : secondarySet.has(index)
                    ? 'secondary'
                    : 'unstressed';
        return {
            index,
            ipa: String(syllable?.ipa || ''),
            label: displaySyllableLabel(syllable, stress !== 'unstressed'),
            stress
        };
    });

    const primaryLabel = count === 1
        ? null
        : modeledSyllables[primaryStress].label;
    const secondaryLabels = count === 1
        ? []
        : secondaryStress.map((index) => modeledSyllables[index].label);
    const countLabel = `${count} ${count === 1 ? 'syllable' : 'syllables'}`;

    let accessibleText = `${countLabel}. `;
    if (count === 1) {
        accessibleText += 'Single-syllable word.';
    } else {
        accessibleText += `Primary stress on ${primaryLabel}, syllable ${primaryStress + 1}.`;
        if (secondaryStress.length) {
            const details = secondaryStress.map(
                (index) => `${modeledSyllables[index].label}, syllable ${index + 1}`
            );
            accessibleText += ` Secondary stress on ${details.join('; ')}.`;
        }
    }

    return {
        ipa: String(variant.displayIpa || ''),
        countLabel,
        primaryLabel,
        secondaryLabels,
        syllables: modeledSyllables,
        accessibleText
    };
}
