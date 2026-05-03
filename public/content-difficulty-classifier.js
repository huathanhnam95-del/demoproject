(function (globalScope, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    globalScope.ContentDifficultyClassifier = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STOP_WORDS = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
        'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare',
        'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
        'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
        'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs', 'what',
        'which', 'who', 'whom', 'whose', 'where', 'when', 'how', 'why',
        'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
        'just', 'about', 'also', 'more', 'much', 'some', 'any', 'all',
        'both', 'each', 'few', 'other', 'such', 'only', 'own', 'same',
        'as', 'into', 'through', 'during', 'before', 'after', 'above',
        'below', 'between', 'out', 'off', 'over', 'under', 'again',
        'further', 'once', 'here', 'there', 'up', 'down', 'well', 'ok',
        'okay', 'um', 'uh', 'like', 'know', 'think', 'say', 'said',
        'get', 'got', 'go', 'going', 'went', 'come', 'came', 'make',
        'made', 'take', 'took', 'see', 'saw', 'look', 'thing', 'things',
        'really', 'actually', 'basically', 'right', 'now', 'even', 'still'
    ]);

    const ACADEMIC_SUFFIXES = [
        'tion', 'sion', 'ment', 'ness', 'ity', 'ism', 'ance', 'ence',
        'ship', 'ology', 'ical', 'ious', 'eous', 'ible', 'able',
        'ization', 'isation', 'ative', 'itive'
    ];

    function normalizeText(value) {
        return String(value || '').trim();
    }

    function tokenize(text) {
        return normalizeText(text)
            .toLowerCase()
            .replace(/[^a-z0-9\s'-]/g, ' ')
            .split(/\s+/)
            .filter((word) => word.length > 0);
    }

    function countSentences(text) {
        const matches = normalizeText(text).match(/[.!?]+/g);
        return Math.max(1, matches ? matches.length : 1);
    }

    function countSyllables(word) {
        let sanitized = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
        if (sanitized.length <= 2) return 1;
        sanitized = sanitized.replace(/e$/, '');
        const vowelGroups = sanitized.match(/[aeiouy]+/g);
        return Math.max(1, vowelGroups ? vowelGroups.length : 1);
    }

    function isAcademic(word) {
        const lower = String(word || '').toLowerCase();
        return ACADEMIC_SUFFIXES.some((suffix) => lower.endsWith(suffix) && lower.length > suffix.length + 2);
    }

    function computeMetrics(text) {
        const words = tokenize(text);
        const wordCount = words.length;

        if (wordCount < 5) {
            return {
                wordCount,
                avgWordLen: 0,
                longWordPct: 0,
                academicPct: 0,
                avgWPS: 0,
                avgSylPerWord: 0,
                contentRatio: 0,
                uniqueContentRatio: 0
            };
        }

        const sentenceCount = countSentences(text);
        const avgWordLen = words.reduce((sum, word) => sum + word.length, 0) / wordCount;
        const longWordPct = words.filter((word) => word.length >= 7).length / wordCount;
        const academicPct = words.filter((word) => isAcademic(word)).length / wordCount;
        const avgWPS = wordCount / sentenceCount;
        const avgSylPerWord = words.reduce((sum, word) => sum + countSyllables(word), 0) / wordCount;

        const contentWords = words.filter((word) => !STOP_WORDS.has(word) && word.length > 2);
        const contentRatio = contentWords.length / wordCount;
        const uniqueContent = new Set(contentWords);
        const uniqueContentRatio = uniqueContent.size / Math.max(1, contentWords.length);

        return {
            wordCount,
            avgWordLen,
            longWordPct,
            academicPct,
            avgWPS,
            avgSylPerWord,
            contentRatio,
            uniqueContentRatio
        };
    }

    function computeComposite(metrics) {
        const {
            wordCount,
            avgWordLen,
            longWordPct,
            academicPct,
            avgWPS,
            avgSylPerWord,
            contentRatio,
            uniqueContentRatio
        } = metrics;

        let lengthScore = 0;
        if (wordCount > 230) lengthScore = 2;
        else if (wordCount > 150) lengthScore = 1;

        const vocabRaw = (avgWordLen - 3.5) * 1.5 + longWordPct * 8 + academicPct * 12;
        let vocabScore = 0;
        if (vocabRaw >= 3.5) vocabScore = 2;
        else if (vocabRaw >= 2.0) vocabScore = 1;

        const sentenceRaw = avgWPS * 0.12 + avgSylPerWord * 1.5;
        let sentScore = 0;
        if (sentenceRaw >= 4.5) sentScore = 2;
        else if (sentenceRaw >= 3.5) sentScore = 1;

        const infoRaw = contentRatio * 4 + uniqueContentRatio * 3;
        let infoScore = 0;
        if (infoRaw >= 5.0) infoScore = 2;
        else if (infoRaw >= 4.0) infoScore = 1;

        return {
            composite: (lengthScore * 3) + (vocabScore * 2) + (sentScore * 1.5) + (infoScore * 1.5),
            lengthScore,
            vocabScore,
            sentScore,
            infoScore
        };
    }

    function computePercentileThresholds(scores) {
        if (!Array.isArray(scores) || scores.length === 0) {
            return { p33: 0, p66: 0 };
        }

        const sorted = [...scores].sort((a, b) => a - b);
        return {
            p33: sorted[Math.floor(sorted.length * 0.33)],
            p66: sorted[Math.floor(sorted.length * 0.66)]
        };
    }

    function assignLevelsFromCompositeScores(scores, thresholds) {
        const safeThresholds = thresholds || computePercentileThresholds(scores);
        return (scores || []).map((score) => {
            if (score <= safeThresholds.p33) return 1;
            if (score <= safeThresholds.p66) return 2;
            return 3;
        });
    }

    function classifyEntriesByText(entries, getText) {
        const safeEntries = Array.isArray(entries) ? entries : [];
        if (safeEntries.length === 0) return [];

        const extractor = typeof getText === 'function'
            ? getText
            : (entry) => entry?.transcript || entry?.text || '';

        const analyzedEntries = safeEntries.map((entry, index) => {
            const text = normalizeText(extractor(entry, index));
            const metrics = computeMetrics(text);
            const scores = computeComposite(metrics);
            return { entry, text, metrics, scores };
        });

        const compositeScores = analyzedEntries.map((item) => item.scores.composite);
        const thresholds = computePercentileThresholds(compositeScores);
        const levels = assignLevelsFromCompositeScores(compositeScores, thresholds);

        return analyzedEntries.map((item, index) => ({
            ...item.entry,
            text: item.text,
            metrics: item.metrics,
            scores: item.scores,
            level: levels[index]
        }));
    }

    return {
        STOP_WORDS,
        ACADEMIC_SUFFIXES,
        tokenize,
        countSentences,
        countSyllables,
        isAcademic,
        computeMetrics,
        computeComposite,
        computePercentileThresholds,
        assignLevelsFromCompositeScores,
        classifyEntriesByText
    };
});
