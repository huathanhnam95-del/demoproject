'use strict';

// Ranks are exact reduced rationals. Firestore stores the canonical string
// "numerator/denominator" and the API sorts in memory, so no precision is
// lost and no midpoint can silently exhaust a dense sibling set.
const MAX_REBALANCE_WRITES = 128;
const MAX_DENOMINATOR_DIGITS = 24;
const MAX_RANK_CHARS = 256;

class RankIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RankIntegrityError';
        this.code = 'INVALID_RANK';
    }
}

function gcd(left, right) {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b) { const next = a % b; a = b; b = next; }
    return a || 1n;
}

function rational(numerator, denominator = 1n) {
    let n = BigInt(numerator);
    let d = BigInt(denominator);
    if (d === 0n) throw new Error('Rank denominator cannot be zero.');
    if (d < 0n) { n = -n; d = -d; }
    const divisor = gcd(n, d);
    return { n: n / divisor, d: d / divisor };
}

function parseRank(value) {
    const text = String(value ?? '').trim();
    if (!text) throw new RankIntegrityError('Missing sibling rank; explicit migration is required before ordering.');
    if (text.length > MAX_RANK_CHARS) throw new RankIntegrityError('Sibling rank exceeds the bounded record size.');
    const parts = text.split('/');
    try {
        if (parts.length === 1 && /^-?\d+$/.test(parts[0])) return rational(BigInt(parts[0]), 1n);
        if (parts.length === 2 && /^-?\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) return rational(BigInt(parts[0]), BigInt(parts[1]));
    } catch (_) { /* convert to an explicit integrity failure below */ }
    throw new RankIntegrityError(`Malformed sibling rank: ${text}`);
}

function formatRank(value) {
    const result = typeof value === 'object' && value !== null ? rational(value.n, value.d) : parseRank(value);
    const formatted = `${result.n.toString()}/${result.d.toString()}`;
    if (formatted.length > MAX_RANK_CHARS) throw new RankIntegrityError('Generated sibling rank exceeds the bounded record size.');
    return formatted;
}

function compareRank(left, right) {
    const a = parseRank(left);
    const b = parseRank(right);
    const productLeft = a.n * b.d;
    const productRight = b.n * a.d;
    return productLeft < productRight ? -1 : (productLeft > productRight ? 1 : 0);
}

function rankValue(value) { return parseRank(value); }
function rankForIndex(index) {
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) throw new Error('Sibling index must be a non-negative integer.');
    return formatRank(rational(BigInt(index), 1n));
}

function compareSiblings(left, right) {
    const rankDifference = compareRank(left?.rank, right?.rank);
    if (rankDifference) return rankDifference;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function interpolate(lower, upper, position, slots) {
    const a = parseRank(lower);
    const b = parseRank(upper);
    return rational(a.n * b.d * BigInt(slots - position) + b.n * a.d * BigInt(position), a.d * b.d * BigInt(slots));
}

function compactWindow(sorted, insertionIndex) {
    const size = Math.min(MAX_REBALANCE_WRITES, sorted.length);
    const start = Math.max(0, Math.min(Number(insertionIndex) - Math.floor(size / 2), sorted.length - size));
    const end = Math.min(sorted.length, start + size);
    const first = parseRank(sorted[0]?.rank);
    const last = parseRank(sorted[sorted.length - 1]?.rank);
    const lower = start > 0 ? sorted[start - 1].rank : formatRank(rational(first.n - (first.n < 0n ? -first.n : first.n) - 1n, first.d));
    const upper = end < sorted.length ? sorted[end].rank : formatRank(rational(last.n + (last.n < 0n ? -last.n : last.n) + 1n, last.d));
    if (compareRank(lower, upper) >= 0) throw new RankIntegrityError('Sibling ranks are tied across the bounded rebalance window.');
    // n existing records plus one new record need n+2 intervals between the
    // two outer boundaries. Using n+1 produces an equal-rank collision.
    const slots = (end - start) + 2;
    const rebalance = [];
    const insertionOffset = Math.max(0, Math.min(end - start, Number(insertionIndex) - start));
    for (let offset = start; offset < end; offset += 1) {
        const virtualPosition = offset - start < insertionOffset ? offset - start + 1 : offset - start + 2;
        const nextRank = formatRank(interpolate(lower, upper, virtualPosition, slots));
        if (String(sorted[offset].rank) !== nextRank) rebalance.push({ id: sorted[offset].id, rank: nextRank });
    }
    return { rank: formatRank(interpolate(lower, upper, insertionOffset + 1, slots)), rebalance };
}

function computeInsertionRank(items = [], rawIndex = items.length) {
    const sorted = items.slice().sort(compareSiblings);
    if (typeof rawIndex !== 'number' || !Number.isSafeInteger(rawIndex) || rawIndex < 0) throw new Error('Sibling index must be a non-negative integer.');
    const index = Math.min(sorted.length, rawIndex);
    const previous = index > 0 ? parseRank(sorted[index - 1]?.rank) : null;
    const next = index < sorted.length ? parseRank(sorted[index]?.rank) : null;
    if (previous === null && next === null) return { rank: rankForIndex(0), rebalance: [] };
    if (previous === null) return { rank: formatRank(rational(next.n - next.d, next.d)), rebalance: [] };
    if (next === null) return { rank: formatRank(rational(previous.n + previous.d, previous.d)), rebalance: [] };
    const midpoint = rational(previous.n * next.d + next.n * previous.d, 2n * previous.d * next.d);
    if (midpoint.n !== previous.n || midpoint.d !== previous.d) {
        if (midpoint.d.toString().length <= MAX_DENOMINATOR_DIGITS) return { rank: formatRank(midpoint), rebalance: [] };
    }
    return compactWindow(sorted, index);
}

module.exports = {
    MAX_REBALANCE_WRITES,
    MAX_DENOMINATOR_DIGITS,
    MAX_RANK_CHARS,
    RankIntegrityError,
    gcd,
    rational,
    parseRank,
    formatRank,
    compareRank,
    rankValue,
    rankForIndex,
    compareSiblings,
    computeInsertionRank
};
