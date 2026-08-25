function normalizeSeed(seed) {
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer');
  const normalized = seed >>> 0;
  return normalized === 0 ? 0x6d2b79f5 : normalized;
}

export function createSeededRng(seed) {
  let state = normalizeSeed(seed);
  return Object.freeze({
    nextUint32() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state;
    },
    nextFloat() {
      return this.nextUint32() / 0x100000000;
    },
    getState() {
      return state >>> 0;
    },
  });
}

