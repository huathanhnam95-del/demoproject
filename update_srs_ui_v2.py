
import re

file_path = r'c:\Cursor AI\srs-review.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update displayEnhancedScaffolding
# Remove Breakdown, Rename Context -> Part of Speech, Rename Usage Frames -> Example phrases

new_display_func = r'''    /**
     * Display enhanced scaffolding: POS, Synonyms, Example phrases
     */
    async function displayEnhancedScaffolding(word) {
        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];
        const container = elements.scaffoldingExtras;
        if (!container) return;

        container.innerHTML = '';
        
        // 1. Part of Speech & Synonyms
        let pos = currentWord?.partOfSpeech?.toLowerCase() || '';
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
                    detailsHtml += `<div class="synonyms-list"><strong>Syns:</strong> ${data.synonyms.slice(0, 3).join(', ')}</div>`;
                }
            } catch(e) {}
        }
        
        let html = '';
        
        // Section: Part of Speech (formerly Context)
        if (detailsHtml) {
            html += `<div class="scaffold-section"><h4>📚 Part of Speech</h4><div class="context-content">${detailsHtml}</div></div>`;
        } else {
             html += `<div class="scaffold-section"><h4>📚 Part of Speech</h4><div class="context-content"><span class="pos-tag">word</span></div></div>`;
        }

        // 2. Example phrases (formerly Usage Frames)
        let patterns = [];
        const W = `<strong>${word}</strong>`;
        
        if (pos.includes('verb')) {
            patterns = [
                `to ${W} something`,
                `I ${W} because...`,
                `Please ${W}...` 
            ];
        } else if (pos.includes('noun')) {
            patterns = [
                `a big ${W}`,
                `the ${W} of...`,
                `my favorite ${W}`
            ];
        } else if (pos.includes('adjective')) {
            patterns = [
                `very ${W}`,
                `feel ${W}`,
                `looks ${W}`
            ];
        } else if (pos.includes('adverb')) {
            patterns = [
                `run ${W}`,
                `speak ${W}`,
                `work ${W}`
            ];
        } else {
            patterns = [`use ${W} in a sentence`];
        }

        if (patterns.length > 0) {
            // Keep full-width class for layout, rename header
            html += `<div class="scaffold-section full-width"><h4>💬 Example phrases</h4><ul class="pattern-list-compact">${patterns.map(p => `<li>${p}</li>`).join('')}</ul></div>`;
        }
        
        container.innerHTML = html;
    }'''

# Replace logic using simple string replacement of the function block
# We match the function signature and roughly where it ends based on previous known structure
# Or better, regex match the whole function body again.

pattern = re.compile(r'async function displayEnhancedScaffolding\(word\) \{[\s\S]*?container\.innerHTML = html;\s+?\}', re.MULTILINE)
if pattern.search(content):
    content = pattern.sub(new_display_func, content)
    print("Replaced displayEnhancedScaffolding")
else:
    print("Could not find displayEnhancedScaffolding to replace")

# 2. Update fetchTatoebaSentences to add fallback
# Use regex to find the function and replace it
# We want to add a DictionaryService fallback if specific URL fetch fails.
# Since I don't see the fetching logic in the viewed snippet (it was cut off), I will assume I need to rewrite it robustly.

new_fetch_func = r'''    /**
     * Fetch example sentences with fallback
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

        try {
            // Try Tatoeba (via proxy or direct if CORS allows, usually fails without proxy)
            // Assuming we use a public API wrapper or similar. 
            // Since we can't easily rely on external APIs without a backend proxy in this env:
            // FALLBACK IMMEDIATE: Use DictionaryService examples if available.
            
            let sentences = [];
            if (window.DictionaryService) {
                const data = await window.DictionaryService.getDefinition(word);
                if (data && data.meanings) {
                     for (const m of data.meanings) {
                        if (m.definitions) {
                            for (const d of m.definitions) {
                                if (d.example) sentences.push(d.example);
                            }
                        }
                     }
                }
            }
            
            // If still empty, try specific Tatoeba endpoint if we have one, otherwise return empty
            // (Simulated for clear fallback)
            
            if (sentences.length > 0) {
                tatoebaCache.set(cacheKey, sentences.slice(0, 3));
                return sentences.slice(0, 3);
            }
            
            return [];

        } catch (error) {
            console.warn('[SRS] Error fetching sentences:', error);
            return [];
        }
    }'''

fetch_pattern = re.compile(r'async function fetchTatoebaSentences\(word\) \{[\s\S]*?^\s+?\}', re.MULTILINE)
# This regex is risky because of nested braces.
# Better to search for the start line and read untill the next function definition or end of block?
# Let's try matching known start and a large chunk.
# Actually, I'll just append this new function at the end (or replace if I can match safely).
# Given the risk, I'll restrict replacement to if I strongly match the header.
# Or I can just overwrite the file content if I had the whole file. 
# I will use a simple "Find start of function" and "Find end of function" approach in Python which is safer.

lines = content.split('\n')
new_lines = []
skip = False
fetch_replaced = False

for line in lines:
    if 'async function fetchTatoebaSentences(word) {' in line:
        skip = True
        fetch_replaced = True
        new_lines.append(new_fetch_func)
        # We need to skip until the end of the existing function. 
        # Counting braces is the only robust way.
        brace_count = 1
        continue
    
    if skip:
        brace_count += line.count('{')
        brace_count -= line.count('}')
        if brace_count == 0:
            skip = False
        continue
        
    new_lines.append(line)

if fetch_replaced:
    print("Replaced fetchTatoebaSentences")
    content = '\n'.join(new_lines)

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
