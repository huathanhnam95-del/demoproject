/**
 * Dictionary Service Module
 * Provides definitions (English) and translations (Vietnamese) for vocabulary words.
 * 
 * Primary Sources:
 * - Definitions: Wiktionary REST API
 * - Translations: Glosbe API (dictionary-based, more accurate for single words)
 * 
 * Fallback Sources:
 * - Definitions: Free Dictionary API (dictionaryapi.dev)
 * - Translations: MyMemory API (machine translation)
 */

const DictionaryService = (function () {
    'use strict';

    // Local dictionary for common words (most reliable source)
    const LOCAL_DICTIONARY = {
        // Common verbs
        'receive': 'nhận', 'received': 'đã nhận', 'receiving': 'đang nhận',
        'give': 'cho', 'gave': 'đã cho', 'given': 'được cho',
        'take': 'lấy', 'took': 'đã lấy', 'taken': 'được lấy',
        'make': 'làm', 'made': 'đã làm', 'making': 'đang làm',
        'be': 'là', 'being': 'đang là', 'been': 'đã là', 'am': 'là', 'is': 'là', 'are': 'là', 'was': 'đã là', 'were': 'đã là',
        'do': 'làm', 'did': 'đã làm', 'done': 'xong',
        'go': 'đi', 'went': 'đã đi', 'gone': 'đã đi',
        'come': 'đến', 'came': 'đã đến', 'coming': 'đang đến',
        'see': 'thấy', 'saw': 'đã thấy', 'seen': 'đã thấy',
        'know': 'biết', 'knew': 'đã biết', 'known': 'được biết',
        'think': 'nghĩ', 'thought': 'đã nghĩ', 'thinking': 'đang nghĩ',
        'get': 'lấy', 'got': 'đã lấy', 'getting': 'đang lấy',
        'say': 'nói', 'said': 'đã nói', 'saying': 'đang nói',
        'tell': 'kể', 'told': 'đã kể', 'telling': 'đang kể',
        'use': 'sử dụng', 'used': 'đã sử dụng', 'using': 'đang sử dụng',
        'find': 'tìm', 'found': 'đã tìm', 'finding': 'đang tìm',
        'want': 'muốn', 'wanted': 'đã muốn', 'wanting': 'đang muốn',
        'need': 'cần', 'needed': 'đã cần', 'needing': 'đang cần',
        'learn': 'học', 'learned': 'đã học', 'learning': 'đang học',
        'try': 'thử', 'tried': 'đã thử', 'trying': 'đang thử',
        'ask': 'hỏi', 'asked': 'đã hỏi', 'asking': 'đang hỏi',
        'work': 'làm việc', 'worked': 'đã làm việc', 'working': 'đang làm việc',
        'play': 'chơi', 'played': 'đã chơi', 'playing': 'đang chơi',
        'run': 'chạy', 'ran': 'đã chạy', 'running': 'đang chạy',
        'write': 'viết', 'wrote': 'đã viết', 'written': 'đã viết',
        'read': 'đọc', 'reading': 'đang đọc',
        'speak': 'nói', 'spoke': 'đã nói', 'spoken': 'đã nói',
        'listen': 'nghe', 'listened': 'đã nghe', 'listening': 'đang nghe',
        'understand': 'hiểu', 'understood': 'đã hiểu',
        'remember': 'nhớ', 'remembered': 'đã nhớ',
        'forget': 'quên', 'forgot': 'đã quên', 'forgotten': 'đã quên',
        'help': 'giúp', 'helped': 'đã giúp', 'helping': 'đang giúp',
        'start': 'bắt đầu', 'started': 'đã bắt đầu',
        'stop': 'dừng', 'stopped': 'đã dừng',
        'change': 'thay đổi', 'changed': 'đã thay đổi',
        'move': 'di chuyển', 'moved': 'đã di chuyển',
        'live': 'sống', 'lived': 'đã sống', 'living': 'đang sống',
        'believe': 'tin', 'believed': 'đã tin',
        'happen': 'xảy ra', 'happened': 'đã xảy ra',
        'include': 'bao gồm', 'included': 'đã bao gồm',
        'continue': 'tiếp tục', 'continued': 'đã tiếp tục',
        'create': 'tạo', 'created': 'đã tạo', 'creating': 'đang tạo',
        'provide': 'cung cấp', 'provided': 'đã cung cấp',
        'consider': 'xem xét', 'considered': 'đã xem xét',
        'allow': 'cho phép', 'allowed': 'đã cho phép',
        'meet': 'gặp', 'met': 'đã gặp', 'meeting': 'cuộc họp',
        'lead': 'dẫn đầu', 'led': 'đã dẫn đầu',
        'begin': 'bắt đầu', 'began': 'đã bắt đầu', 'begun': 'đã bắt đầu',
        'feel': 'cảm thấy', 'felt': 'đã cảm thấy',
        'seem': 'có vẻ', 'seemed': 'có vẻ như',
        'leave': 'rời', 'left': 'đã rời',
        'call': 'gọi', 'called': 'đã gọi',
        'keep': 'giữ', 'kept': 'đã giữ',
        'let': 'để', 'put': 'đặt',
        'mean': 'có nghĩa', 'meant': 'có nghĩa',
        'become': 'trở thành', 'became': 'đã trở thành',
        'show': 'cho thấy', 'showed': 'đã cho thấy', 'shown': 'được cho thấy',
        'bring': 'mang', 'brought': 'đã mang',
        'hold': 'giữ', 'held': 'đã giữ',
        'follow': 'theo', 'followed': 'đã theo',
        'turn': 'quay', 'turned': 'đã quay',
        'reach': 'đạt', 'reached': 'đã đạt',
        'send': 'gửi', 'sent': 'đã gửi',
        'build': 'xây', 'built': 'đã xây',
        'grow': 'phát triển', 'grew': 'đã phát triển', 'grown': 'đã phát triển',
        'open': 'mở', 'opened': 'đã mở',
        'close': 'đóng', 'closed': 'đã đóng',
        'spend': 'tiêu', 'spent': 'đã tiêu',
        'win': 'thắng', 'won': 'đã thắng',
        'lose': 'thua', 'lost': 'đã thua',
        'pay': 'trả', 'paid': 'đã trả',
        'buy': 'mua', 'bought': 'đã mua',
        'sell': 'bán', 'sold': 'đã bán',
        'choose': 'chọn', 'chose': 'đã chọn', 'chosen': 'được chọn',
        'decide': 'quyết định', 'decided': 'đã quyết định',
        'explain': 'giải thích', 'explained': 'đã giải thích',

        // Common nouns
        'opportunity': 'cơ hội', 'opportunities': 'cơ hội',
        'challenge': 'thử thách', 'challenges': 'thử thách',
        'problem': 'vấn đề', 'problems': 'vấn đề',
        'solution': 'giải pháp', 'solutions': 'giải pháp',
        'question': 'câu hỏi', 'questions': 'câu hỏi',
        'answer': 'câu trả lời', 'answers': 'câu trả lời',
        'idea': 'ý tưởng', 'ideas': 'ý tưởng',
        'example': 'ví dụ', 'examples': 'ví dụ',
        'experience': 'kinh nghiệm', 'experiences': 'kinh nghiệm',
        'information': 'thông tin',
        'knowledge': 'kiến thức',
        'skill': 'kỹ năng', 'skills': 'kỹ năng',
        'ability': 'khả năng', 'abilities': 'khả năng',
        'success': 'thành công',
        'failure': 'thất bại',
        'result': 'kết quả', 'results': 'kết quả',
        'reason': 'lý do', 'reasons': 'lý do',
        'way': 'cách', 'ways': 'cách',
        'time': 'thời gian',
        'year': 'năm', 'years': 'năm',
        'month': 'tháng', 'months': 'tháng',
        'week': 'tuần', 'weeks': 'tuần',
        'day': 'ngày', 'days': 'ngày',
        'hour': 'giờ', 'hours': 'giờ',
        'minute': 'phút', 'minutes': 'phút',
        'second': 'giây', 'seconds': 'giây',
        'person': 'người', 'people': 'mọi người',
        'family': 'gia đình', 'families': 'gia đình',
        'friend': 'bạn', 'friends': 'bạn bè',
        'child': 'trẻ em', 'children': 'trẻ em',
        'student': 'học sinh', 'students': 'học sinh',
        'teacher': 'giáo viên', 'teachers': 'giáo viên',
        'school': 'trường', 'schools': 'trường',
        'class': 'lớp', 'classes': 'lớp',
        'lesson': 'bài học', 'lessons': 'bài học',
        'book': 'sách', 'books': 'sách',
        'word': 'từ', 'words': 'từ',
        'language': 'ngôn ngữ', 'languages': 'ngôn ngữ',
        'country': 'quốc gia', 'countries': 'quốc gia',
        'city': 'thành phố', 'cities': 'thành phố',
        'world': 'thế giới',
        'life': 'cuộc sống', 'lives': 'cuộc sống',
        'work': 'công việc',
        'job': 'việc làm', 'jobs': 'việc làm',
        'company': 'công ty', 'companies': 'công ty',
        'business': 'kinh doanh',
        'money': 'tiền',
        'price': 'giá', 'prices': 'giá',
        'market': 'thị trường', 'markets': 'thị trường',
        'health': 'sức khỏe',
        'food': 'thức ăn', 'foods': 'thức ăn',
        'water': 'nước',
        'part': 'phần', 'parts': 'phần',
        'place': 'nơi', 'places': 'nơi',
        'case': 'trường hợp', 'cases': 'trường hợp',
        'point': 'điểm', 'points': 'điểm',
        'fact': 'sự thật', 'facts': 'sự thật',
        'issue': 'vấn đề', 'issues': 'vấn đề',
        'area': 'khu vực', 'areas': 'khu vực',
        'level': 'mức độ', 'levels': 'mức độ',
        'end': 'kết thúc',
        'member': 'thành viên', 'members': 'thành viên',
        'law': 'luật', 'laws': 'luật',
        'power': 'quyền lực',
        'state': 'trạng thái', 'states': 'trạng thái',
        'system': 'hệ thống', 'systems': 'hệ thống',
        'program': 'chương trình', 'programs': 'chương trình',
        'service': 'dịch vụ', 'services': 'dịch vụ',
        'course': 'khóa học', 'courses': 'khóa học',
        'development': 'phát triển',
        'government': 'chính phủ',
        'community': 'cộng đồng', 'communities': 'cộng đồng',
        'history': 'lịch sử',
        'study': 'nghiên cứu', 'studies': 'nghiên cứu',
        'research': 'nghiên cứu',
        'report': 'báo cáo', 'reports': 'báo cáo',
        'president': 'chủ tịch',
        'team': 'đội', 'teams': 'đội',
        'game': 'trò chơi', 'games': 'trò chơi',
        'story': 'câu chuyện', 'stories': 'câu chuyện',

        // Common adjectives
        'good': 'tốt', 'better': 'tốt hơn', 'best': 'tốt nhất',
        'bad': 'xấu', 'worse': 'tệ hơn', 'worst': 'tệ nhất',
        'new': 'mới', 'old': 'cũ',
        'big': 'lớn', 'small': 'nhỏ',
        'great': 'tuyệt vời',
        'important': 'quan trọng',
        'different': 'khác',
        'same': 'giống',
        'possible': 'có thể',
        'impossible': 'không thể',
        'difficult': 'khó',
        'easy': 'dễ',
        'happy': 'vui', 'sad': 'buồn',
        'beautiful': 'đẹp',
        'interesting': 'thú vị',
        'amazing': 'tuyệt vời',
        'wonderful': 'tuyệt vời',
        'excellent': 'xuất sắc',
        'perfect': 'hoàn hảo',
        'available': 'có sẵn',
        'free': 'miễn phí',
        'young': 'trẻ',
        'long': 'dài', 'short': 'ngắn',
        'high': 'cao', 'low': 'thấp',
        'true': 'đúng', 'false': 'sai',
        'right': 'đúng', 'wrong': 'sai',
        'certain': 'chắc chắn',
        'clear': 'rõ ràng',
        'full': 'đầy', 'empty': 'trống',
        'strong': 'mạnh', 'weak': 'yếu',
        'fast': 'nhanh', 'slow': 'chậm',
        'early': 'sớm', 'late': 'muộn',
        'hard': 'khó',
        'simple': 'đơn giản',
        'special': 'đặc biệt',
        'common': 'phổ biến',
        'real': 'thật',
        'main': 'chính',
        'necessary': 'cần thiết',
        'public': 'công cộng',
        'private': 'riêng tư',
        'political': 'chính trị',
        'social': 'xã hội',
        'economic': 'kinh tế',
        'national': 'quốc gia'
    };

    // Cache keys
    const DEFINITION_CACHE_KEY = 'vocab_definitions_cache';
    const TRANSLATION_CACHE_KEY = 'vocab_translations_cache';

    // Cache expiry (7 days in milliseconds)
    const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000;

    // Tracau API Configuration
    const TRACAU_API_KEY = 'WBBcwnwQpV89'; // Default key for non-profit use
    const TRACAU_BASE_URL = 'https://api.tracau.vn';

    // In-memory cache for current session
    let definitionCache = {};
    let translationCache = {};

    /**
     * Initialize caches from localStorage
     */
    function initCaches() {
        try {
            const storedDefs = localStorage.getItem(DEFINITION_CACHE_KEY);
            const storedTrans = localStorage.getItem(TRANSLATION_CACHE_KEY);

            if (storedDefs) {
                const parsed = JSON.parse(storedDefs);
                // Check expiry
                if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_EXPIRY) {
                    definitionCache = parsed.data || {};
                }
            }

            if (storedTrans) {
                const parsed = JSON.parse(storedTrans);
                if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_EXPIRY) {
                    translationCache = parsed.data || {};
                }
            }
        } catch (e) {
            console.warn('[DictionaryService] Failed to load cache:', e);
        }
    }

    /**
     * Save caches to localStorage
     */
    function saveCaches() {
        try {
            localStorage.setItem(DEFINITION_CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                data: definitionCache
            }));
            localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                data: translationCache
            }));
        } catch (e) {
            console.warn('[DictionaryService] Failed to save cache:', e);
        }
    }

    /**
     * Fetch definition from Wiktionary REST API
     * @param {string} word - The word to look up
     * @param {string} preferredPOS - Optional part of speech filter
     * @returns {Promise<Object>} Definition object
     */
    async function fetchFromWiktionary(word, preferredPOS) {
        const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word.toLowerCase())}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Wiktionary not found');

        const data = await response.json();

        // Parse Wiktionary response (structure: { en: [{ partOfSpeech, definitions: [...] }] })
        if (!data.en || data.en.length === 0) {
            throw new Error('No English definitions');
        }

        // POS mapping
        const posMap = {
            'n': 'noun', 'noun': 'noun',
            'v': 'verb', 'verb': 'verb',
            'adj': 'adjective', 'adjective': 'adjective',
            'adv': 'adverb', 'adverb': 'adverb'
        };
        const targetPOS = preferredPOS ? (posMap[preferredPOS.toLowerCase()] || preferredPOS.toLowerCase()) : null;

        // Find best matching entry
        let bestEntry = data.en[0];
        if (targetPOS) {
            const found = data.en.find(entry =>
                entry.partOfSpeech && entry.partOfSpeech.toLowerCase() === targetPOS
            );
            if (found) bestEntry = found;
        }

        // Extract definition and example
        let definition = '';
        let example = '';
        let partOfSpeech = bestEntry.partOfSpeech || '';

        // Quality filter: Skip definitions that are likely obscure or technical
        const OBSCURE_KEYWORDS = [
            'iso 639', 'language code', 'symbol for', 'abbreviation',
            'obsolete', 'archaic', 'rare', 'dialect', 'slang',
            'dated', 'nonstandard', 'eye dialect', 'misspelling'
        ];

        function isObscureDefinition(defText) {
            if (!defText) return true;
            const lower = defText.toLowerCase();
            return OBSCURE_KEYWORDS.some(kw => lower.includes(kw));
        }

        if (bestEntry.definitions && bestEntry.definitions.length > 0) {
            // Find the first NON-obscure definition
            let chosenDef = null;
            for (const def of bestEntry.definitions) {
                const defText = stripHtml(def.definition || '');
                if (!isObscureDefinition(defText)) {
                    chosenDef = def;
                    break;
                }
            }

            // Fallback to first if all are obscure
            if (!chosenDef) {
                chosenDef = bestEntry.definitions[0];
            }

            // Wiktionary returns HTML, strip tags
            definition = stripHtml(chosenDef.definition || '');

            // Look for example in parsedExamples or examples
            if (chosenDef.parsedExamples && chosenDef.parsedExamples.length > 0) {
                example = stripHtml(chosenDef.parsedExamples[0].example || '');
            } else if (chosenDef.examples && chosenDef.examples.length > 0) {
                example = stripHtml(chosenDef.examples[0] || '');
            }
        }

        return { definition, example, partOfSpeech, source: 'wiktionary' };
    }

    /**
     * Fetch Vietnamese translation from Wiktionary
     * @param {string} word - The English word to translate
     * @returns {Promise<string>} Vietnamese translation or empty string
     */
    async function fetchVietnameseFromWiktionary(word) {
        // Wiktionary has a different endpoint for translations
        // We can try the Vietnamese Wiktionary which has English-Vietnamese entries
        const url = `https://vi.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word.toLowerCase())}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Vietnamese Wiktionary not found');

        const data = await response.json();

        // Vietnamese Wiktionary stores English words with Vietnamese definitions
        // Look for the Vietnamese definition of the English word
        if (data && data.vi && data.vi.length > 0) {
            const entry = data.vi[0];
            if (entry.definitions && entry.definitions.length > 0) {
                const defText = stripHtml(entry.definitions[0].definition || '');
                if (defText && defText.length < 50) { // Keep only short, clean translations
                    return defText;
                }
            }
        }

        throw new Error('No Vietnamese translation in Wiktionary');
    }

    /**
     * Fetch definition from Free Dictionary API (fallback)
     * @param {string} word - The word to look up
     * @param {string} preferredPOS - Optional part of speech filter
     * @returns {Promise<Object>} Definition object
     */
    async function fetchFromFreeDictionary(word, preferredPOS) {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Free Dictionary not found');

        const data = await response.json();
        if (!data || data.length === 0) throw new Error('No entries');

        const entry = data[0];

        // POS mapping
        const posMap = {
            'n': 'noun', 'noun': 'noun',
            'v': 'verb', 'verb': 'verb',
            'adj': 'adjective', 'adjective': 'adjective',
            'adv': 'adverb', 'adverb': 'adverb'
        };
        const targetPOS = preferredPOS ? (posMap[preferredPOS.toLowerCase()] || preferredPOS.toLowerCase()) : null;

        // Find best meaning
        let meaning = entry.meanings[0];
        if (targetPOS && entry.meanings.length > 1) {
            const found = entry.meanings.find(m =>
                m.partOfSpeech && m.partOfSpeech.toLowerCase() === targetPOS
            );
            if (found) meaning = found;
        }

        let definition = '';
        let example = '';
        let partOfSpeech = meaning.partOfSpeech || '';

        if (meaning.definitions && meaning.definitions.length > 0) {
            definition = meaning.definitions[0].definition || '';
            example = meaning.definitions[0].example || '';
        }

        return { definition, example, partOfSpeech, source: 'freedictionary' };
    }

    /**
     * Fetch Vietnamese translation from MyMemory API
     * @param {string} word - The word to translate
     * @returns {Promise<string>} Vietnamese translation
     */
    async function fetchFromMyMemory(word) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|vi`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('MyMemory failed');

        const data = await response.json();

        if (data.responseStatus !== 200 || !data.responseData) {
            throw new Error('MyMemory no result');
        }

        const translation = data.responseData.translatedText;

        // MyMemory sometimes returns the same word if no translation found
        if (!translation || translation.toLowerCase() === word.toLowerCase()) {
            throw new Error('No translation available');
        }

        return translation;
    }

    /**
     * Fetch Vietnamese translation from Glosbe API (fallback)
     * Note: Glosbe has strict rate limits, use sparingly
     * @param {string} word - The word to translate
     * @returns {Promise<string>} Vietnamese translation
     */
    async function fetchFromGlosbe(word) {
        // Glosbe API endpoint
        const url = `https://glosbe.com/gapi/translate?from=en&dest=vi&format=json&phrase=${encodeURIComponent(word)}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Glosbe failed');

        const data = await response.json();

        if (!data.tuc || data.tuc.length === 0) {
            throw new Error('No Glosbe translation');
        }

        // Get first translation
        const firstResult = data.tuc[0];
        if (firstResult.phrase && firstResult.phrase.text) {
            return firstResult.phrase.text;
        }

        // Sometimes meanings are in 'meanings' array
        if (firstResult.meanings && firstResult.meanings.length > 0) {
            return stripHtml(firstResult.meanings[0].text || '');
        }

        throw new Error('No valid translation');
    }

    /**
     * Fetch translation and examples from Tracau.vn API
     * @param {string} word - The word to look up
     * @returns {Promise<Object>} Data from Tracau
     */
    async function fetchFromTracau(word) {
        // Use local proxy to bypass CORS
        const url = `/api/tracau?word=${encodeURIComponent(word.toLowerCase())}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Tracau API failed');

        const data = await response.json();

        let translation = '';
        let sentences = [];

        // Extract translation from 'sentences' or 'tratu'
        if (data.sentences && data.sentences.length > 0) {
            // Take the first Vietnamese translation part from the first sentence if it's short
            // Usually data.sentences are bilingual pairs
            sentences = data.sentences.map(s => ({
                en: s.fields.en.replace(/<\/?em>/g, ''),
                vi: s.fields.vi.replace(/<\/?em>/g, '')
            }));

            // Try to find a short translation in tratu if available
            if (data.tratu && data.tratu.length > 0) {
                // Tratu fulltext contains HTML, we might just use the first sentence vi for now 
                // if it looks like a direct translation
                const firstVi = sentences[0].vi;
                if (firstVi.length < 50) {
                    translation = firstVi;
                }
            }
        }

        // Fallback: Use sentence-based translation if direct translation not found
        if (!translation && sentences.length > 0) {
            translation = sentences[0].vi;
        }

        return { translation, sentences };
    }

    /**
     * Strip HTML tags from text
     * @param {string} html - HTML string
     * @returns {string} Plain text
     */
    function stripHtml(html) {
        if (!html) return '';
        // Create temp element to parse HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent || temp.innerText || '';
    }

    /**
     * Get definition for a word (with caching)
     * @param {string} word - The word to look up
     * @param {string} partOfSpeech - Optional POS filter
     * @returns {Promise<Object>} { definition, example, partOfSpeech, source }
     */
    async function getDefinition(word, partOfSpeech = null) {
        if (!word) return { definition: '', example: '', partOfSpeech: '', source: null };

        const cacheKey = `${word.toLowerCase()}:${partOfSpeech || ''}`;

        // Check cache
        if (definitionCache[cacheKey]) {
            console.log('[DictionaryService] Definition cache hit:', word);
            return definitionCache[cacheKey];
        }

        let result = { definition: '', example: '', partOfSpeech: '', source: null };

        // Try Wiktionary first
        try {
            result = await fetchFromWiktionary(word, partOfSpeech);
            console.log('[DictionaryService] Wiktionary success:', word);
        } catch (e) {
            console.log('[DictionaryService] Wiktionary failed, trying fallback:', e.message);

            // Try Free Dictionary fallback
            try {
                result = await fetchFromFreeDictionary(word, partOfSpeech);
                console.log('[DictionaryService] Free Dictionary success:', word);
            } catch (e2) {
                console.warn('[DictionaryService] All definition sources failed for:', word);
            }
        }

        // Cache result
        definitionCache[cacheKey] = result;
        saveCaches();

        return result;
    }

    /**
     * Get Vietnamese translation for a word (with caching)
     * Priority: Wiktionary -> Local Dictionary -> Glosbe -> MyMemory
     * @param {string} word - The word to translate
     * @returns {Promise<string>} Vietnamese translation or empty string
     */
    async function getVietnameseTranslation(word) {
        if (!word) return '';

        const cacheKey = word.toLowerCase();

        // Check cache
        if (translationCache[cacheKey]) {
            console.log('[DictionaryService] Translation cache hit:', word);
            return translationCache[cacheKey];
        }

        let translation = '';

        // 1. Try Tracau.vn first (high quality English-Vietnamese)
        try {
            const tracauData = await fetchFromTracau(word);
            if (tracauData && tracauData.translation) {
                translation = tracauData.translation;
                console.log('[DictionaryService] Tracau success:', word, '->', translation);
            }
        } catch (e) {
            console.log('[DictionaryService] Tracau failed:', e.message);
        }

        // 2. Try Wiktionary next (structured dictionary data)
        if (!translation) {
            try {
                const viTranslation = await fetchVietnameseFromWiktionary(word);
                if (viTranslation) {
                    translation = viTranslation;
                    console.log('[DictionaryService] Wiktionary VI success:', word, '->', translation);
                }
            } catch (e) {
                console.log('[DictionaryService] Wiktionary VI failed:', e.message);
            }
        }

        // 2. Fallback to local dictionary (for common words Wiktionary missed)
        if (!translation && LOCAL_DICTIONARY[cacheKey]) {
            translation = LOCAL_DICTIONARY[cacheKey];
            console.log('[DictionaryService] Local dictionary hit:', word, '->', translation);
        }

        // 3. Try Glosbe as fallback
        if (!translation) {
            try {
                translation = await fetchFromGlosbe(word);
                console.log('[DictionaryService] Glosbe success:', word, '->', translation);
            } catch (e) {
                console.log('[DictionaryService] Glosbe failed:', e.message);
            }
        }

        // 4. Try MyMemory as last resort
        if (!translation) {
            try {
                translation = await fetchFromMyMemory(word);
                console.log('[DictionaryService] MyMemory success:', word, '->', translation);
            } catch (e) {
                console.warn('[DictionaryService] All translation sources failed for:', word);
            }
        }

        // Cache result (even empty to avoid re-fetching)
        translationCache[cacheKey] = translation;
        saveCaches();

        return translation;
    }

    /**
     * Get both definition and translation in parallel
     * @param {string} word - The word to look up
     * @param {string} partOfSpeech - Optional POS filter
     * @returns {Promise<Object>} { definition, example, partOfSpeech, vietnameseTranslation }
     */
    async function getWordData(word, preferredPOS = null) {
        // Fetch everything in parallel
        const [defResult, translation, tracauData] = await Promise.all([
            getDefinition(word, preferredPOS),
            getVietnameseTranslation(word),
            fetchFromTracau(word).catch(() => ({ sentences: [] }))
        ]);

        return {
            definition: defResult.definition,
            example: defResult.example || (tracauData.sentences.length > 0 ? tracauData.sentences[0].en : ''),
            partOfSpeech: defResult.partOfSpeech,
            vietnameseTranslation: translation,
            source: defResult.source,
            sentences: tracauData.sentences // Include all bilingual sentences
        };
    }

    /**
     * Clear all caches
     */
    function clearCache() {
        definitionCache = {};
        translationCache = {};
        localStorage.removeItem(DEFINITION_CACHE_KEY);
        localStorage.removeItem(TRANSLATION_CACHE_KEY);
        console.log('[DictionaryService] Cache cleared');
    }

    // Initialize on load
    initCaches();

    // Public API
    return {
        getDefinition,
        getVietnameseTranslation,
        getWordData,
        clearCache
    };
})();

// Export for module usage if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DictionaryService;
}
