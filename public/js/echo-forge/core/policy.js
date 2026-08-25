export const CEFR_LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1']);
export const SUPPORT_PRESETS = Object.freeze(['guided', 'standard', 'challenge']);

export const COMBAT_POLICY = Object.freeze({
  locale: 'en-US',
  heroMaxHp: 100,
  enemyMaxHp: 120,
  focus: Object.freeze({ start: 1, max: 3 }),
  resonance: Object.freeze({ start: 0, max: 100, gainFactor: 0.30, minGain: 5, maxGain: 30 }),
  combo: Object.freeze({ start: 0, damageCap: 5 }),
  burst: Object.freeze({ requiredResonance: 100, multiplier: 1.5 }),
});

export const ATTACK_CARDS = Object.freeze({
  precision_strike: Object.freeze({
    id: 'precision_strike',
    label: 'Precision Strike',
    evaluationMode: 'azure_word',
    unitType: 'word',
    baseDamage: 20,
    focusCost: 0,
  }),
  stress_breaker: Object.freeze({
    id: 'stress_breaker',
    label: 'Stress Breaker',
    evaluationMode: 'v3_word',
    unitType: 'word',
    baseDamage: 24,
    focusCost: 1,
  }),
  echo_chain: Object.freeze({
    id: 'echo_chain',
    label: 'Echo Chain',
    evaluationMode: 'azure_phrase',
    unitType: 'phrase',
    baseDamage: 26,
    focusCost: 1,
  }),
});

export function assertCefrLevel(level) {
  if (!CEFR_LEVELS.includes(level)) {
    throw new RangeError(`unsupported CEFR level: ${level}; Echo Forge supports A1-C1 and rejects C2`);
  }
  return level;
}

export function createRunPreferences({ level, locale = 'en-US', supportPreset = 'standard' }) {
  assertCefrLevel(level);
  if (locale !== COMBAT_POLICY.locale) throw new RangeError(`unsupported locale: ${locale}`);
  if (!SUPPORT_PRESETS.includes(supportPreset)) {
    throw new RangeError(`unsupported support preset: ${supportPreset}`);
  }
  return Object.freeze({ level, locale, supportPreset });
}

