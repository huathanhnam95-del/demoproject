const crypto = require('crypto');
const { db } = require('../../utils/firebase');

const DEFAULT_TTL_DAYS = 30;

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function normalizeKeywords(input) {
  const keywords = Array.isArray(input) ? input : [input];
  const out = [];
  const seen = new Set();
  for (const raw of keywords) {
    const value = normalizeScalar(raw).toLowerCase();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort();
  return out;
}

function normalizeTopicTags(input) {
  const tags = Array.isArray(input) ? input : [input];
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const value = normalizeScalar(raw).toLowerCase().replace(/\s+/g, '_');
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort();
  return out;
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function resolveTtlMs(ttlDaysRaw) {
  const ttlDays = Number(ttlDaysRaw || process.env.READING_JOURNEY_CACHE_TTL_DAYS || DEFAULT_TTL_DAYS);
  const safeDays = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : DEFAULT_TTL_DAYS;
  return safeDays * 24 * 60 * 60 * 1000;
}

function computeKeywordTagsCacheKey({ keywords, language = 'en' }) {
  const normalized = normalizeKeywords(keywords);
  const key = `v1|lang:${normalizeScalar(language) || 'en'}|keywords:${normalized.join(',')}`;
  return { key, id: sha256Hex(key), normalizedKeywords: normalized };
}

function computeOutlineCacheKey({ language = 'en', level, topicTags }) {
  const normalizedTags = normalizeTopicTags(topicTags);
  const key = `v1|lang:${normalizeScalar(language) || 'en'}|level:${normalizeScalar(level)}|tags:${normalizedTags.join(',')}`;
  return { key, id: sha256Hex(key), normalizedTopicTags: normalizedTags };
}

function normalizePath(path) {
  const list = Array.isArray(path) ? path : [];
  return list.map((item) => normalizeScalar(item)).filter(Boolean);
}

function computeBeatCacheKey({ outlineId, beatNumber, path }) {
  const safeOutlineId = normalizeScalar(outlineId);
  const safeBeat = Number(beatNumber);
  const safePath = normalizePath(path);
  const key = `v1|outline:${safeOutlineId}|beat:${safeBeat}|path:${safePath.join('.')}`;
  return { key, id: sha256Hex(key), normalizedPath: safePath };
}

const memoryCollections = {
  reading_journey_keyword_tags_v1: new Map(),
  reading_journey_outlines_v1: new Map(),
  reading_journey_beats_v1: new Map()
};

function getMemoryCollection(name) {
  return memoryCollections[name] || null;
}

async function getCachedValue({ collection, id }) {
  const collectionName = normalizeScalar(collection);
  const docId = normalizeScalar(id);
  if (!collectionName || !docId) return null;

  const now = Date.now();

  if (!db) {
    const mem = getMemoryCollection(collectionName);
    if (!mem) return null;
    const record = mem.get(docId) || null;
    if (!record) return null;
    if (Number(record.expiresAtMs) <= now) {
      mem.delete(docId);
      return null;
    }
    return record.value ?? null;
  }

  try {
    const snap = await db.collection(collectionName).doc(docId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (Number(data.expiresAtMs) <= now) return null;
    return data.value ?? null;
  } catch (e) {
    console.warn(`[reading-journey-cache] read failed for ${collectionName}/${docId}:`, e?.message || e);
    return null;
  }
}

async function setCachedValue({ collection, id, key, value, ttlMs }) {
  const collectionName = normalizeScalar(collection);
  const docId = normalizeScalar(id);
  if (!collectionName || !docId) return;

  const now = Date.now();
  const normalizedKey = normalizeScalar(key);
  const ttl = Number(ttlMs);
  const safeTtl = Number.isFinite(ttl) && ttl > 1_000 ? ttl : resolveTtlMs();
  const record = {
    value,
    createdAtMs: now,
    expiresAtMs: now + safeTtl
  };

  if (normalizedKey) {
    record.key = normalizedKey;
  }

  if (!db) {
    const mem = getMemoryCollection(collectionName);
    if (!mem) return;
    mem.set(docId, record);
    return;
  }

  try {
    await db.collection(collectionName).doc(docId).set(record, { merge: true });
  } catch (e) {
    console.warn(`[reading-journey-cache] write failed for ${collectionName}/${docId}:`, e?.message || e);
  }
}

const COLLECTION_OUTLINES = 'reading_journey_outlines_v1';

async function listCachedOutlines() {
  const now = Date.now();
  const results = [];

  if (!db) {
    const mem = getMemoryCollection(COLLECTION_OUTLINES);
    if (!mem) return results;
    for (const [id, record] of mem.entries()) {
      if (Number(record.expiresAtMs) <= now) continue;
      const value = record.value;
      if (!value || typeof value !== 'object') continue;
      results.push({ id, key: record.key || '', value });
    }
    return results;
  }

  try {
    const snap = await db.collection(COLLECTION_OUTLINES).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (Number(data.expiresAtMs) <= now) continue;
      const value = data.value;
      if (!value || typeof value !== 'object') continue;
      results.push({ id: doc.id, key: data.key || '', value });
    }
  } catch (e) {
    console.warn('[reading-journey-cache] listCachedOutlines failed:', e?.message || e);
  }

  return results;
}

module.exports = {
  normalizeKeywords,
  normalizeTopicTags,
  normalizePath,
  resolveTtlMs,
  sha256Hex,
  computeKeywordTagsCacheKey,
  computeOutlineCacheKey,
  computeBeatCacheKey,
  getCachedValue,
  setCachedValue,
  listCachedOutlines
};
