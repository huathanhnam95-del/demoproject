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
        'follow': 'theo, theo dõi', 'followed': 'đã theo',
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
        'artist': 'nghệ sĩ, họa sĩ', 'artists': 'nghệ sĩ, họa sĩ',
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
        'rule': 'quy tắc, luật lệ', 'rules': 'quy tắc, luật lệ',
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
        'own': 'của chính mình, riêng',
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

    // Tracau API Configuration (Unused - logic moved to server-side proxy)

    // In-memory cache for current session
    let definitionCache = {};
    let translationCache = {};

    // Module-level deduplication for ongoing fetch requests
    const tracauInFlight = new Map();

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


    const MT_STOPLIST = new Set(['đó', 'này', 'kia', 'ấy', 'thì', 'là']);
    const NON_PLURAL_S_ENDINGS = ['ss', 'us', 'is', 'ics'];
    const NON_PLURAL_WORDS = new Set(['this', 'his', 'as', 'is', 'was', 'news', 'yes', 'bus', 'gas']);

    const MODAL_OVERRIDES = {
        'will': 'sẽ',
        'would': 'sẽ',
        'can': 'có thể',
        'could': 'có thể',
        'may': 'có thể',
        'might': 'có thể',
        'must': 'phải',
        'should': 'nên'
    };

    function detectContraction(word) {
        if (!word) return null;
        // Normalize curly apostrophes
        word = word.replace(/[’]/g, "'");

        // handle we'll, you'll, they'll, he'll, she'll, it'll, i'll
        const mLL = word.match(/^([a-z]+)'ll$/);
        if (mLL) return { type: 'll', head: 'will' };

        // handle don't, won't, can't
        const mNT = word.match(/^(.+?)n't$/);
        if (mNT) {
            const base = mNT[1];
            // special case: won't = will not
            if (base === 'wo') return { type: 'nt', head: 'will', neg: true };
            return { type: 'nt', head: base, neg: true }; // can't->can, don't->do, shouldn't->should
        }

        // handle 've, 're, 'm, 'd
        if (word.endsWith("'ve")) return { type: 've', head: 'have' };
        if (word.endsWith("'re")) return { type: 're', head: 'be' };
        if (word.endsWith("'m")) return { type: 'm', head: 'be' };
        if (word.endsWith("'d")) return { type: 'd', head: 'would' };

        return null;
    }

    function cleanTracauText(s) {
        return (s || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/<\/?em>/g, '')
            .replace(/^[■*•⁃\-–—]+\s*/g, '')
            .trim();
    }

    function normalizeWord(raw) {
        const normalized = (raw || '')
            .toLowerCase()
            .trim()
            // Keep letters, apostrophes, and hyphens internally
            // Strip non-a-z'- from ends only
            .replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');

        // Unified Guard: Match backend strictness (starts with letter, 1-30 chars)
        if (!/^[a-z][a-z'-]{0,29}$/.test(normalized)) return '';
        return normalized;
    }

    function getLemma(wordLower) {
        return lemmatize(wordLower);
    }

    /**
     * Lemmatize a word using compromise.js (if available)
     */
    function lemmatize(word) {
        if (!word) return '';

        // Unified Normalization
        const cleanWord = normalizeWord(word);
        if (!cleanWord) return '';

        // MANUAL CONTRACTION HANDLING:
        if (cleanWord.includes("'")) {
            const contractionMap = {
                "we'll": "we'll", "you'll": "you'll", "they'll": "they'll", "he'll": "he'll", "she'll": "she'll", "it'll": "it'll", "i'll": "i'll",
                "won't": "won't", "don't": "don't", "can't": "can't", "isn't": "isn't", "aren't": "aren't", "wasn't": "wasn't", "weren't": "weren't",
                "it's": "it's", "he's": "he's", "she's": "she's", "there's": "there's", "that's": "that's"
            };
            if (contractionMap[cleanWord]) return contractionMap[cleanWord];
        }

        // Use compromise.js if available
        if (typeof nlp !== 'undefined') {
            try {
                const doc = nlp(cleanWord);
                const verbs = doc.verbs().toInfinitive().out('array');
                if (verbs.length > 0) return verbs[0];

                const nouns = doc.nouns().toSingular().out('array');
                if (nouns.length > 0) return nouns[0];
            } catch (e) {
                console.warn('[DictionaryService] Lemmatization failed:', e);
            }
        }

        // Standard plural stripping fallback (if nlp fails or not found)
        if (cleanWord.length < 4) return cleanWord;
        if (NON_PLURAL_WORDS.has(cleanWord)) return cleanWord;
        if (NON_PLURAL_S_ENDINGS.some(suf => cleanWord.endsWith(suf))) return cleanWord;

        if (cleanWord.endsWith('ies')) return cleanWord.slice(0, -3) + 'y';
        if (cleanWord.endsWith('es')) return cleanWord.slice(0, -2);
        if (cleanWord.endsWith('s')) return cleanWord.slice(0, -1);

        return cleanWord;
    }

    /**
     * Detect part of speech of a word within a sentence context
     */
    function detectPartOfSpeech(word, sentence) {
        if (!word) return 'unknown';

        // Use compromise.js for POS tagging if available
        if (typeof nlp !== 'undefined') {
            try {
                const cleanWord = word.toLowerCase().trim();

                if (sentence) {
                    const doc = nlp(sentence);
                    const terms = doc.terms().json();
                    for (const term of terms) {
                        if (term.text.toLowerCase() === cleanWord) {
                            const tags = term.tags || [];
                            if (tags.includes('Noun')) return 'noun';
                            if (tags.includes('Verb')) return 'verb';
                            if (tags.includes('Adjective')) return 'adjective';
                            if (tags.includes('Adverb')) return 'adverb';
                            if (tags.includes('Preposition')) return 'preposition';
                            if (tags.includes('Conjunction')) return 'conjunction';
                            if (tags.includes('Pronoun')) return 'pronoun';
                        }
                    }
                }

                // Fallback: analyze word alone
                const wordDoc = nlp(cleanWord);
                if (wordDoc.nouns().length > 0) return 'noun';
                if (wordDoc.verbs().length > 0) return 'verb';
                if (wordDoc.adjectives().length > 0) return 'adjective';
                if (wordDoc.adverbs().length > 0) return 'adverb';
            } catch (e) {
                console.warn('[DictionaryService] POS detection failed:', e);
            }
        }

        return 'unknown';
    }

    function isValidMtResult(text, originalLower) {
        if (!text) return false;
        const t = text.trim();
        if (t.length < 3) return false;
        if (/<[^>]+>/.test(t)) return false;
        if (MT_STOPLIST.has(t.toLowerCase())) return false;
        if (t.toLowerCase() === originalLower) return false; // echo
        return true;
    }

    /**
     * Fetch translation and examples from Tracau.vn API
     * @param {string} word - The word to look up
     * @returns {Promise<Object>} Data from Tracau
     */
    async function fetchFromTracau(word) {
        // Unified Normalization before proxy call
        const normalized = normalizeWord(word);
        if (!normalized) throw new Error('Invalid word for translation');

        // Module-level deduplication: suppress redundant requests even across calls
        if (tracauInFlight.has(normalized)) {
            return tracauInFlight.get(normalized);
        }

        const url = `/api/tracau?word=${encodeURIComponent(normalized)}`;
        const p = (async () => {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Tracau API failed');
            return response.json();
        })().finally(() => tracauInFlight.delete(normalized));

        tracauInFlight.set(normalized, p);
        const data = await p;

        let translation = '';
        let sentences = [];

        // 1) Dictionary definition from tratu.fulltext
        if (data.tratu && Array.isArray(data.tratu)) {
            for (const entry of data.tratu) {
                const html = entry?.fields?.fulltext;
                const extracted = extractTracauDefinition(html);
                if (extracted) {
                    translation = extracted;
                    break;
                }
            }
        }

        // 2) Examples (keep them, but don't treat as definition)
        if (data.sentences && Array.isArray(data.sentences) && data.sentences.length > 0) {
            sentences = data.sentences.map(s => ({
                en: cleanTracauText(s.fields && s.fields.en),
                vi: cleanTracauText(s.fields && s.fields.vi)
            }));
        }

        return {
            translation,
            sentences,
            source: data.fromCache ? 'local_collected_tracau' : 'tracau_live'
        };
    }

    /**
     * Extract Vietnamese definitions from Tracau EV HTML.
     * Returns a single string (joined senses) or null.
     */
    function extractTracauDefinition(html) {
        if (!html) return null;

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Tight scope to the English→Vietnamese dictionary tab/table
            const root =
                doc.querySelector('article#dict_ev table#definition') ||
                doc.querySelector('article#dict_ev') ||
                doc;

            // NOTE: Tracau uses duplicated ids in rows (invalid HTML), so use [id="mn"]
            const rows = root.querySelectorAll('tr[id="mn"]');
            const defs = [];

            for (const row of rows) {
                const tds = row.querySelectorAll('td');
                // Prefer last C_C (main definition cell) as it's often the most relevant in Tracau EV
                const ccs = row.querySelectorAll('td#C_C');
                const preferred = ccs.length ? ccs[ccs.length - 1] : tds[tds.length - 1];
                const text = cleanTracauText(preferred?.textContent);

                // keep definition-like strings
                if (!text || text.length < 2) continue;
                if (text.length > 180) continue;      // avoid long paragraph-like stuff
                const wordCount = text.split(/\s+/).length;
                if (wordCount > 15) continue;         // reject if too sentence-like

                defs.push(text);
            }

            if (!defs.length) return null;

            // Most apps do best showing 1–2 senses by default
            return defs.slice(0, 3).join('; ');

        } catch (e) {
            console.warn('[DictionaryService] extractTracauDefinition failed:', e);
        }

        return null;
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
        const normalized = normalizeWord(word);
        if (!normalized) return { definition: '', example: '', partOfSpeech: '', source: null };

        const cacheKey = `${normalized}:${partOfSpeech || ''}`;

        // Check cache
        if (definitionCache[cacheKey]) {
            console.log('[DictionaryService] Definition cache hit:', normalized);
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
     * Priority: Local -> Tracau -> Wiktionary -> Glosbe -> MyMemory
     * @param {string} word - The word to translate
     * @returns {Promise<string>} Vietnamese translation or empty string
     */
    async function getVietnameseTranslation(word) {
        const entry = await getVietnameseEntry(word);
        return entry.translation;
    }

    /**
     * Get rich Vietnamese translation data including sentences
     * @param {string} word - The word to look up
     * @returns {Promise<Object>} { translation: string, sentences: Array, source: string, usedCandidate: string }
     */
    async function getVietnameseEntry(word) {
        if (!word) return { translation: '', sentences: [], source: null, usedCandidate: null };

        const original = normalizeWord(word);
        if (!original) return { translation: '', sentences: [], source: null, usedCandidate: null };

        const contraction = detectContraction(original);
        const lemma = getLemma(original);

        // 1. Proactive Modal Overrides (prevent "will" becoming "ý chí")
        // Apply before any external lookups
        const modalKey = contraction?.head || original;
        if (MODAL_OVERRIDES[modalKey]) {
            // Background Upgrade: Fetch examples in background to improve learner experience
            fetchFromTracau(modalKey).then(data => {
                if (data && data.sentences && data.sentences.length > 0) {
                    const entryToCache = {
                        translation: MODAL_OVERRIDES[modalKey],
                        sentences: data.sentences,
                        source: 'local_modal',
                        lastUpdated: Date.now()
                    };
                    translationCache[modalKey] = entryToCache;
                    // Also cache under the original word (canonical form) to avoid re-triggering this logic
                    if (original && original !== modalKey) {
                        translationCache[original] = entryToCache;
                    }
                    saveCaches();
                }
            }).catch(() => { });

            return {
                translation: MODAL_OVERRIDES[modalKey],
                sentences: [],
                source: 'local_modal',
                usedCandidate: modalKey
            };
        }

        // 2. Explicitly ordered candidates
        const candidates = [];
        const pushUnique = (x) => { if (x && !candidates.includes(x)) candidates.push(x); };

        pushUnique(original);

        // If it's a contraction, prioritize the head word and EXCLUDE stripped homonym
        if (contraction) {
            pushUnique(contraction.head);
            // For 'll, adding 'will' is better than 'well'
            if (contraction.type === 'll' && !candidates.includes('will')) {
                pushUnique('will');
            }
        } else {
            pushUnique(lemma);
            // Stripped version ('we'll' -> 'well') as absolute last resort (non-contractions)
            if (original.includes("'")) {
                const stripped = original.replace(/'/g, '');
                // DANGER ZONE: don't strip if it becomes a common word with different meaning
                if (stripped !== 'well' && stripped !== 'it' && stripped !== 'is') {
                    pushUnique(stripped);
                }
            }
        }

        const tracauMemo = {};
        async function getTracau(c) {
            // Favor the global inflight map if available, fallback to local memo
            if (tracauInFlight.has(c)) return tracauInFlight.get(c);
            if (!tracauMemo[c]) tracauMemo[c] = fetchFromTracau(c);
            return tracauMemo[c];
        }

        // 2. Check cache for any candidate
        for (const c of candidates) {
            if (Object.prototype.hasOwnProperty.call(translationCache, c)) {
                const cached = translationCache[c];

                // If the cached translation is a stopword (bad MT), ignore it and re-fetch
                const cachedTrans = (typeof cached === 'string' ? cached : cached.translation).toLowerCase().trim();
                if (MT_STOPLIST.has(cachedTrans)) continue;

                if (typeof cached === 'string') {
                    upgradeCacheToRich(c).catch(() => { });
                    return {
                        translation: cached,
                        sentences: [],
                        source: 'cache',
                        usedCandidate: c,
                        servedFromCache: true
                    };
                }
                console.log('[DictionaryService] Translation entry cache hit:', c);
                return {
                    ...cached,
                    usedCandidate: c,
                    servedFromCache: true
                };
            }
        }

        let translation = '';
        let sentences = [];
        let source = null;
        let usedCandidate = original;

        // 1. Local dictionary
        for (const c of candidates) {
            if (LOCAL_DICTIONARY[c]) {
                translation = LOCAL_DICTIONARY[c];
                usedCandidate = c;
                source = 'local';
                break;
            }
        }

        // 2. Tracau.vn (Source of rich data)
        if (!translation) {
            for (const c of candidates) {
                try {
                    const tracauData = await getTracau(c);
                    if (tracauData && tracauData.translation) {
                        translation = tracauData.translation;
                        sentences = tracauData.sentences || [];
                        usedCandidate = c;
                        source = tracauData.source || 'tracau';
                        break;
                    }
                } catch (e) {
                    console.log('[DictionaryService] Tracau failed for', c, ':', e.message);
                }
            }
        }

        // 3. Wiktionary
        if (!translation) {
            for (const c of candidates) {
                try {
                    const viTranslation = await fetchVietnameseFromWiktionary(c);
                    if (viTranslation) {
                        translation = viTranslation;
                        usedCandidate = c;
                        source = 'wiktionary';
                        break;
                    }
                } catch (e) {
                    console.log('[DictionaryService] Wiktionary failed for', c);
                }
            }
        }

        // 4. Glosbe
        if (!translation) {
            for (const c of candidates) {
                try {
                    const g = await fetchFromGlosbe(c);
                    if (g) {
                        translation = g;
                        usedCandidate = c;
                        source = 'glosbe';
                        break;
                    }
                } catch (e) {
                    console.log('[DictionaryService] Glosbe failed for', c);
                }
            }
        }

        // 5. MyMemory
        if (!translation) {
            try {
                const mt = await fetchFromMyMemory(original);
                if (isValidMtResult(mt, original)) {
                    translation = mt;
                    source = 'mymemory';
                }
            } catch (e) {
                console.warn('[DictionaryService] MyMemory failed:', e.message);
            }
        }

        // 6. Overrides for Modals (Backup safety)
        if (!translation && MODAL_OVERRIDES[usedCandidate || original]) {
            translation = MODAL_OVERRIDES[usedCandidate || original];
            sentences = [];
            source = 'local_modal';
            usedCandidate = usedCandidate || original;
        }

        // Cache result with rich data
        if (translation) {
            const entryToCache = { translation, sentences, source };
            translationCache[original] = entryToCache;
            translationCache[usedCandidate] = entryToCache; // Explicitly cache winner

            // Also cache lemma if it was the winner
            if (lemma && lemma !== original && usedCandidate === lemma) {
                translationCache[lemma] = entryToCache;
            }
            saveCaches();
        }

        return {
            translation: translation || '',
            sentences: sentences || [],
            source: source || null,
            usedCandidate: translation ? (usedCandidate || original) : null,
            servedFromCache: false
        };
    }

    const upgradeInFlight = new Map();

    /**
     * Upgrade a legacy string-only cache entry to a rich object in the background
     * Preserves existing translation to avoid regressions.
     */
    async function upgradeCacheToRich(key) {
        if (!key || upgradeInFlight.has(key)) return upgradeInFlight.get(key);

        const p = (async () => {
            if (!Object.prototype.hasOwnProperty.call(translationCache, key)) return;
            const existing = translationCache[key];
            if (typeof existing !== 'string') return;

            const cachedTranslation = existing;
            // Allow overwriting if the existing translation is a known bad stopword
            const isBadCache = MT_STOPLIST.has(cachedTranslation.toLowerCase().trim());

            try {
                const data = await fetchFromTracau(key);
                // Only upgrade if we actually found rich data (sentences) OR if we are fixing a bad cache
                if (data && (isBadCache || (data.sentences && data.sentences.length > 0))) {
                    translationCache[key] = {
                        // If current cache is bad, take Tracau's translation. Otherwise preserve.
                        translation: isBadCache ? (data.translation || cachedTranslation) : cachedTranslation,
                        sentences: data.sentences || [],
                        source: 'cache_upgraded'
                    };
                    saveCaches();
                    console.log('[DictionaryService] Upgraded cache with rich data for:', key);
                } else {
                    // Mark as upgraded with empty sentences to prevent repeat attempts
                    translationCache[key] = {
                        translation: cachedTranslation,
                        sentences: [],
                        source: 'cache_upgraded'
                    };
                    saveCaches();
                }
            } catch (e) {
                // Ignore errors, stay as string for now or mark as upgraded empty
            }
        })().finally(() => upgradeInFlight.delete(key));

        upgradeInFlight.set(key, p);
        return p;
    }

    /**
     * Get both definition and translation in parallel
     * @param {string} word - The word to look up
     * @param {string} partOfSpeech - Optional POS filter
     * @returns {Promise<Object>} { definition, example, partOfSpeech, vietnameseTranslation }
     */
    async function getWordData(word, preferredPOS = null) {
        // High-Impact Performance Fix: Reuse getVietnameseEntry to avoid redundant Tracau calls
        const [defResult, entry] = await Promise.all([
            getDefinition(word, preferredPOS),
            getVietnameseEntry(word)
        ]);

        return {
            definition: defResult.definition,
            // Fallback to entry examples if definition has none
            example: defResult.example || (entry.sentences?.[0]?.en || ''),
            partOfSpeech: defResult.partOfSpeech,
            vietnameseTranslation: entry.translation,
            source: defResult.source,
            sentences: entry.sentences || []
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
        getVietnameseEntry,
        getWordData,
        detectContraction,
        normalizeWord,
        lemmatize,
        detectPartOfSpeech,
        clearCache,
        upgradeCacheToRich,
        saveCaches
    };
})();

// Export for module usage if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DictionaryService;
}

// Ensure global access even in module scripts
window.DictionaryService = DictionaryService;
