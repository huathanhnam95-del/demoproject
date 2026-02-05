const fs = require('fs');
const path = require('path');

const LOCAL_DICT_PATH = path.join(process.cwd(), 'local_dictionary.json');
const TMP_PATH = LOCAL_DICT_PATH + '.tmp';
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 3000;

let localDict = {};
let dirty = false;
let saveTimer = null;

// Load local dictionary at startup
try {
    if (fs.existsSync(LOCAL_DICT_PATH)) {
        localDict = JSON.parse(fs.readFileSync(LOCAL_DICT_PATH, 'utf8'));
        console.log(`[Dict] Loaded ${Object.keys(localDict).length} words.`);
    }
} catch (e) {
    console.warn('[Dict] Failed to load local dictionary:', e.message);
}

const isCacheableKey = (wordLower) => {
    return /^[a-z][a-z'-]{0,29}$/.test(wordLower);
};

const isValidTracauPayload = (p) => {
    if (!p || typeof p !== 'object') return false;
    const hasTratu = Array.isArray(p.tratu) && p.tratu.length > 0;
    const hasSentences = Array.isArray(p.sentences) && p.sentences.length > 0;
    return hasTratu || hasSentences;
};

const isFresh = (entry) => {
    return entry && (Date.now() - entry.timestamp) < MAX_AGE_MS;
};

const scheduleSave = () => {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        if (!dirty) return;
        dirty = false;
        try {
            fs.writeFileSync(TMP_PATH, JSON.stringify(localDict, null, 2));
            fs.renameSync(TMP_PATH, LOCAL_DICT_PATH);
            console.log('[Dict] Periodic atomic save completed.');
        } catch (e) {
            console.error('[Dict] Atomic save failed:', e.message);
        }
    }, 2000);
};

const saveToLocalDict = (wordLower, data) => {
    localDict[wordLower] = { data, timestamp: Date.now() };

    // Eviction Policy
    const keys = Object.keys(localDict);
    if (keys.length > MAX_ENTRIES) {
        const sorted = keys.sort((a, b) => localDict[a].timestamp - localDict[b].timestamp);
        const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES);
        toRemove.forEach(k => delete localDict[k]);
        console.log(`[Dict] Evicted ${toRemove.length} oldest entries.`);
    }

    scheduleSave();
};

const getFromLocalDict = (wordLower) => {
    return localDict[wordLower];
};

module.exports = {
    isCacheableKey,
    isValidTracauPayload,
    isFresh,
    saveToLocalDict,
    getFromLocalDict
};
