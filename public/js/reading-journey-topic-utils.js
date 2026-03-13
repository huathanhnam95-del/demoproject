function normalizeScalar(value) {
  return String(value ?? '').trim();
}

export function normalizeTopicTag(raw) {
  return normalizeScalar(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeTopicTags(input) {
  const values = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const normalized = [];

  values.forEach((value) => {
    const tag = normalizeTopicTag(value);
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    normalized.push(tag);
  });

  normalized.sort();
  return normalized;
}

export function formatTopicTagLabel(raw) {
  const tag = normalizeTopicTag(raw);
  if (!tag) return '';

  return tag
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseTagsFromKey(key) {
  const keyText = normalizeScalar(key);
  if (!keyText) return [];

  for (const part of keyText.split('|')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    if (part.slice(0, idx) !== 'tags') continue;
    return normalizeTopicTags(part.slice(idx + 1).split(','));
  }

  return [];
}

function parseLevelFromKey(key) {
  const keyText = normalizeScalar(key);
  if (!keyText) return '';

  for (const part of keyText.split('|')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    if (part.slice(0, idx) !== 'level') continue;
    return normalizeScalar(part.slice(idx + 1)).toUpperCase();
  }

  return '';
}

export function normalizeOutlineRecord(outline) {
  const value = outline && typeof outline === 'object' ? outline : {};
  const title = normalizeScalar(value.title || 'Untitled Story') || 'Untitled Story';
  const level = normalizeScalar(value.level || 'B1').toUpperCase() || 'B1';
  const topicTags = normalizeTopicTags(value.topicTags);

  return {
    ...value,
    title,
    level,
    topicTags
  };
}

export function parseOutlineMeta(entry) {
  const safeEntry = entry && typeof entry === 'object' ? entry : {};
  const value = safeEntry.value && typeof safeEntry.value === 'object' ? safeEntry.value : {};
  const keyTopicTags = parseTagsFromKey(safeEntry.key);
  const valueTopicTags = normalizeTopicTags(value.topicTags);
  const topicTags = valueTopicTags.length ? valueTopicTags : keyTopicTags;
  const level = parseLevelFromKey(safeEntry.key) || normalizeScalar(value.level || 'B1').toUpperCase() || 'B1';

  return {
    outlineId: normalizeScalar(safeEntry.id),
    title: normalizeScalar(value.title || 'Untitled Story') || 'Untitled Story',
    level,
    topicTags
  };
}

export function outlineMatchesActiveFilters(outline, activeFilters) {
  const filters = normalizeTopicTags(activeFilters);
  if (filters.length === 0) return true;

  const tags = normalizeTopicTags(outline && outline.topicTags);
  return filters.every((filterTag) => tags.includes(filterTag));
}

export function filterOutlinesByTags(outlines, activeFilters) {
  const items = Array.isArray(outlines) ? outlines : [];
  const filters = normalizeTopicTags(activeFilters);
  if (filters.length === 0) return items.slice();

  return items.filter((outline) => outlineMatchesActiveFilters(outline, filters));
}
