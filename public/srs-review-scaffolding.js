/**
 * Fetch example sentences from Tatoeba API
 * @param {string} word - The word to search for
 * @returns {Promise<string[]>} Array of example sentences
 */
async function fetchTatoebaSentences(word) {
    const currentWord = reviewSession.wordsToReview.find(w =>
        (w.originalWord || w.lemma).toLowerCase() === word.toLowerCase()
    ) || reviewSession.wordsToReview[reviewSession.currentIndex];

    if (currentWord && (currentWord.example || currentWord.sentence)) {
        return [currentWord.example || currentWord.sentence];
    }

    const cacheKey = word.toLowerCase();
    if (tatoebaCache.has(cacheKey)) {
        return tatoebaCache.get(cacheKey);
    }

    if (window.DictionaryService && typeof window.DictionaryService.getDefinition === 'function') {
        try {
            const data = await window.DictionaryService.getDefinition(word);
            if (data && data.example) {
                tatoebaCache.set(cacheKey, [data.example]);
                return [data.example];
            }
        } catch (e) { }
    }
    return [];
}

/**
 * Display enhanced scaffolding: Syllable Breakdown, Synonyms, POS, Sentence Patterns
 */
async function displayEnhancedScaffolding(word) {
    const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];
    const container = elements.youglishContainer; // Reuse container for "Word Breakdown"
    if (!container) return;

    // Reset container content
    container.innerHTML = '';
    container.className = 'word-breakdown-container';

    // 1. Syllable Breakdown (Heuristic using nlp-syllables logic or dictionary data)
    let syllables = [];
    if (typeof nlp !== 'undefined' && nlp(word).terms().syllables()) {
        syllables = nlp(word).terms().syllables()[0];
    }

    // Fallback or if nlp fails
    if (!syllables || syllables.length === 0) {
        // Rough heuristic split
        syllables = word.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi) || [word];
    }

    // Create visual breakdown
    const breakdownHtml = `
            <div class="breakdown-visual">
                ${syllables.map(s => `<span class="syllable-chip">${s}</span>`).join('<span class="syllable-divider">•</span>')}
            </div>
        `;

    let html = `<div class="scaffold-section"><h4>🧩 Word Breakdown</h4>${breakdownHtml}</div>`;

    // 2. Part of Speech & Synonyms
    let pos = currentWord?.partOfSpeech?.toLowerCase() || '';
    if ((!pos || pos === 'unknown') && typeof nlp !== 'undefined') {
        const doc = nlp(word);
        if (doc.nouns().found) pos = 'noun';
        else if (doc.verbs().found) pos = 'verb';
        else if (doc.adjectives().found) pos = 'adjective';
    }

    let detailsHtml = '';
    if (pos) {
        detailsHtml += `<span class="pos-tag">${pos}</span>`;
    }

    // Fetch Synonyms
    if (window.DictionaryService) {
        try {
            const data = await window.DictionaryService.getDefinition(word);
            if (data && data.synonyms && data.synonyms.length > 0) {
                detailsHtml += `<div class="synonyms-list"><strong>Synonyms:</strong> ${data.synonyms.slice(0, 3).join(', ')}</div>`;
            }
        } catch (e) { }
    }

    if (detailsHtml) {
        html += `<div class="scaffold-section"><h4>📚 Context</h4><div class="context-content">${detailsHtml}</div></div>`;
    }

    // 3. Sentence Patterns
    let patterns = [];
    if (pos.includes('verb')) {
        patterns = [`Subject + <strong>${word}</strong> + object`, `I <strong>${word}</strong> when...`];
    } else if (pos.includes('noun')) {
        patterns = [`The <strong>${word}</strong> is...`, `A <strong>${word}</strong>...`];
    }

    if (patterns.length > 0) {
        html += `<div class="scaffold-section"><h4>📝 Patterns</h4><ul class="pattern-list-compact">${patterns.map(p => `<li>${p}</li>`).join('')}</ul></div>`;
    }

    container.innerHTML = html;
}

/**
 * Display example sentences in the scaffolding panel
 */
function displayExampleSentences(sentences, word) {
    const list = elements.exampleSentencesList;
    if (!list) return;

    if (sentences.length === 0) {
        list.innerHTML = '<li class="example-sentence-item no-examples">No examples available.</li>';
        return;
    }

    list.innerHTML = sentences.map(s =>
        `<li class="example-sentence-item">${highlightWord(s, word)}</li>`
    ).join('');
}

function highlightWord(sentence, word) {
    const regex = new RegExp(`\\b(${word})\\b`, 'gi');
    return sentence.replace(regex, '<strong class="highlight-word">$1</strong>');
}
