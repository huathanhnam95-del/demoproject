import re

file_path = r'c:\Cursor AI\srs-review.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# New definition for displayEnhancedScaffolding
new_function = r'''    /**
     * Display enhanced scaffolding: Syllable Breakdown, Synonyms, POS, Sentence Patterns
     */
    async function displayEnhancedScaffolding(word) {
        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];
        const container = elements.scaffoldingExtras;
        if (!container) return;

        container.innerHTML = '';
        
        // 1. Syllable Breakdown
        let syllables = [];
        if (typeof nlp !== 'undefined' && nlp(word).terms().syllables) {
             const term = nlp(word).terms().data()[0];
             if (term && term.syllables) syllables = term.syllables;
        }
        
        if (!syllables || syllables.length === 0) {
           syllables = word.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi) || [word];
        }

        const breakdownHtml = `
            <div class="breakdown-visual">
                ${syllables.map(s => `<span class="syllable-chip">${s}</span>`).join('<span class="syllable-divider">•</span>')}
            </div>
        `;
        
        // Section 1: Breakdown (Top Left)
        let html = `<div class="scaffold-section"><h4>🧩 Breakdown</h4>${breakdownHtml}</div>`;

        // 2. Part of Speech & Synonyms
        let pos = currentWord?.partOfSpeech?.toLowerCase() || '';
        // Normalize POS
        const posMap = { 'n': 'noun', 'v': 'verb', 'adj': 'adjective', 'adv': 'adverb' };
        if (posMap[pos]) pos = posMap[pos];

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

         if (window.DictionaryService) {
            try {
                const data = await window.DictionaryService.getDefinition(word);
                if (data && data.synonyms && data.synonyms.length > 0) {
                    detailsHtml += `<div class="synonyms-list"><strong>Syns:</strong> ${data.synonyms.slice(0, 2).join(', ')}</div>`;
                }
            } catch(e) {}
        }
        
        // Section 2: Context (Top Right)
        if (detailsHtml) {
            html += `<div class="scaffold-section"><h4>📚 Context</h4><div class="context-content">${detailsHtml}</div></div>`;
        }

        // 3. Pedagogical Sentence Patterns (Full Width)
        let patterns = [];
        const W = `<strong>${word}</strong>`;
        
        if (pos.includes('verb')) {
            patterns = [
                `I like to ${W} because...`,
                `Please ${W} the...`,
                `Yesterday, I ${W}...` 
            ];
        } else if (pos.includes('noun')) {
            patterns = [
                `I have a ${W} that is...`,
                `The ${W} is very...`,
                `Do you like ${W}?`
            ];
        } else if (pos.includes('adjective')) {
            patterns = [
                `It is very ${W} because...`,
                `I feel ${W} when...`,
                `A ${W} person is...`
            ];
        } else if (pos.includes('adverb')) {
            patterns = [
                `He [verb] ${W}...`,
                `She speaks ${W}...`,
                `Do it ${W}!`
            ];
        }

        if (patterns.length > 0) {
            html += `<div class="scaffold-section full-width"><h4>📝 Usage Frames</h4><ul class="pattern-list-compact">${patterns.map(p => `<li>${p}</li>`).join('')}</ul></div>`;
        }
        
        container.innerHTML = html;
    }'''

# Replace the specific function using regex to match start and end roughly or replace the whole block if known markers exist
# Since regex for nested braces is hard, we will rely on finding the start and a unique end string or replacing by known content block if possible.
# Actually, the file content we viewed matches exactly. I will use string replacement with cleaned whitespace.

# Find the start of the function
start_marker = "async function displayEnhancedScaffolding(word) {"
end_marker = "container.innerHTML = html;\n    }"

# Simple regex approach: find the function and replace until the end marker
pattern = re.compile(r'async function displayEnhancedScaffolding\(word\) \{[\s\S]*?container\.innerHTML = html;\s+?\}', re.MULTILINE)

# We need to construct the replacement string carefully to match indentation
if pattern.search(content):
    new_content = pattern.sub(new_function, content)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully replaced function.")
else:
    print("Could not find function to replace.")
