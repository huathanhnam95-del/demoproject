/**
 * Reading Journey Story Quality Rubric
 *
 * Defines the 8-criterion, 1-10 scale rating system with CEFR-specific weights.
 * Pure logic — zero external dependencies.
 */

// ── Criteria ────────────────────────────────────────────────────────────────────

const CRITERIA = Object.freeze([
  'plot',
  'character',
  'vocabulary',
  'grammar',
  'pacing',
  'emotion',
  'setting',
  'coherence'
]);

const CRITERIA_LABELS = Object.freeze({
  plot: 'Plot',
  character: 'Character Development',
  vocabulary: 'Vocabulary Control',
  grammar: 'Grammar Progression',
  pacing: 'Pacing & Structure',
  emotion: 'Emotional Resonance',
  setting: 'Setting & Style',
  coherence: 'Overall Coherence'
});

// ── Weights by CEFR Level (sum to 100 for each level) ──────────────────────────

const WEIGHTS = Object.freeze({
  A2: Object.freeze({ vocabulary: 20, grammar: 20, plot: 12, character: 10, emotion: 8, pacing: 10, setting: 8, coherence: 12 }),
  B1: Object.freeze({ vocabulary: 17, grammar: 17, plot: 14, character: 12, emotion: 10, pacing: 10, setting: 8, coherence: 12 }),
  B2: Object.freeze({ vocabulary: 13, grammar: 13, plot: 16, character: 14, emotion: 12, pacing: 10, setting: 10, coherence: 12 }),
  C1: Object.freeze({ vocabulary: 10, grammar: 10, plot: 18, character: 15, emotion: 15, pacing: 10, setting: 12, coherence: 10 })
});

// ── Thresholds ──────────────────────────────────────────────────────────────────

/** Weighted average must be ≥ this to pass. */
const PASS_THRESHOLD = 6.0;

/** Critical criteria must each score ≥ this to pass. */
const CRITICAL_MIN = 5;

/** Criteria that trigger auto-fail when below CRITICAL_MIN. */
const CRITICAL_CRITERIA = Object.freeze(['vocabulary', 'grammar', 'plot', 'coherence']);

// ── Scoring ─────────────────────────────────────────────────────────────────────

/**
 * Compute the weighted average score and pass/fail status.
 *
 * @param {Object} scores  — e.g. { plot: 8, character: 7, vocabulary: 9, … }
 * @param {string} level   — 'A2' | 'B1' | 'B2' | 'C1'
 * @param {Object} [flags] — { tooHard, tooEasy, unsafe }
 * @returns {{
 *   weightedAverage: number,
 *   passed: boolean,
 *   criticalFailures: string[],
 *   flagFailures: string[],
 *   perCriterion: Array<{ criterion: string, score: number, weight: number, weighted: number }>
 * }}
 */
function computeWeightedScore(scores, level, flags) {
  const safeLevel = String(level || 'B1').toUpperCase();
  const weights = WEIGHTS[safeLevel] || WEIGHTS.B1;
  const safeFlags = flags && typeof flags === 'object' ? flags : {};

  let weightedSum = 0;
  let totalWeight = 0;
  const perCriterion = [];
  const criticalFailures = [];
  const flagFailures = [];

  for (const criterion of CRITERIA) {
    const score = Number(scores?.[criterion]) || 0;
    const weight = Number(weights[criterion]) || 0;
    const clamped = Math.max(0, Math.min(10, score));
    const weighted = (clamped * weight) / 100;

    weightedSum += weighted;
    totalWeight += weight;

    perCriterion.push({ criterion, score: clamped, weight, weighted: Number(weighted.toFixed(3)) });

    if (CRITICAL_CRITERIA.includes(criterion) && clamped < CRITICAL_MIN) {
      criticalFailures.push(criterion);
    }
  }

  // weightedSum is already on a 0–10 scale (score * weight / 100).
  // Normalise defensively in case weights don't sum to exactly 100.
  const weightedAverage = totalWeight > 0
    ? Number((weightedSum * (100 / totalWeight)).toFixed(2))
    : 0;

  // Flag failures
  if (safeFlags.tooHard) flagFailures.push('tooHard');
  if (safeFlags.tooEasy) flagFailures.push('tooEasy');
  if (safeFlags.unsafe) flagFailures.push('unsafe');

  const passed = weightedAverage >= PASS_THRESHOLD
    && criticalFailures.length === 0
    && flagFailures.length === 0;

  return { weightedAverage, passed, criticalFailures, flagFailures, perCriterion };
}

// ── Level-Specific Assessment Prompt ────────────────────────────────────────────

/**
 * Build a Gemini-ready prompt that evaluates a story using the 8-criterion rubric,
 * calibrated for the given CEFR level.
 */
function getAssessmentPrompt(level) {
  const safeLevel = String(level || 'B1').toUpperCase();
  const weights = WEIGHTS[safeLevel] || WEIGHTS.B1;

  const levelGuidance = {
    A2: [
      '- Vocabulary: Expect high-frequency daily-life words. Penalise rare/academic vocabulary.',
      '- Grammar: Expect simple present/past, basic sentence patterns. Penalise complex subordination.',
      '- Setting: Figurative language should be minimal or absent. Penalise heavy metaphor/idiom use.',
      '- Character: Dialogue should use short, clear sentences. Relatable everyday contexts.',
      '- Vocabulary recycling: Key words should reappear 2-3 times across the story.'
    ],
    B1: [
      '- Vocabulary: Allow topic-specific words with context clues. Some idioms OK if glossable.',
      '- Grammar: Compound sentences, basic conditionals, and past continuous are fine.',
      '- Setting: Simple similes acceptable. Avoid dense figurative language.',
      '- Character: Can show internal thoughts briefly. Dialogue should feel natural.',
      '- Vocabulary recycling: Important terms should reappear across beats.'
    ],
    B2: [
      '- Vocabulary: Richer word choice, collocations, phrasal verbs. Context should support new terms.',
      '- Grammar: Complex sentences, passive voice, reported speech expected.',
      '- Setting: Figurative language is welcome. Cultural references should be globally accessible.',
      '- Character: Deeper motivations, emotional nuance. Can handle ambiguity.',
      '- Vocabulary recycling: Advanced terms should be reinforced through context.'
    ],
    C1: [
      '- Vocabulary: Expect sophisticated, nuanced vocabulary including less common items.',
      '- Grammar: Advanced conditionals, inversions, embedded clauses, subjunctive OK.',
      '- Setting: Reward rich figurative language, irony, and layered symbolism.',
      '- Character: Complex, multi-dimensional characters with subtle emotional arcs.',
      '- Cultural sensitivity: Reward globally inclusive perspectives; penalise stereotypes.'
    ]
  };

  const guidance = (levelGuidance[safeLevel] || levelGuidance.B1).join('\n');

  const weightLines = CRITERIA
    .map((c) => `${CRITERIA_LABELS[c]}: weight ${weights[c]}%`)
    .join(', ');

  return [
    'Return raw JSON only.',
    'You are evaluating an English learner reading story for quality and engagement.',
    `Target CEFR level: ${safeLevel}.`,
    '',
    'Score EACH of the following 8 criteria from 1 to 10 (10 = excellent):',
    '',
    '1. plot — Arc clarity, hooks, tension, satisfying resolution',
    '2. character — Relatable protagonists, believable traits, dialogue quality',
    '3. vocabulary — Level-appropriate words, ≥90% familiar, sensory detail, recycling of key terms',
    '4. grammar — Controlled complexity matching CEFR level, accuracy (no errors)',
    '5. pacing — Momentum, smooth transitions, appropriate scene length',
    '6. emotion — Universal themes, humor/suspense/empathy, memorability',
    '7. setting — Vivid description, consistent POV, figurative language calibrated to level, cultural sensitivity',
    '8. coherence — Story hangs together, no contradictions, cause-and-effect, re-readable',
    '',
    `Level-specific scoring guidance for ${safeLevel}:`,
    guidance,
    '',
    `Weights for context (${safeLevel}): ${weightLines}`,
    '',
    'Also estimate cefrFit (A2|B1|B2|C1) — the actual level the story reads at.',
    '',
    'Flags (boolean):',
    '- tooHard: true if vocabulary/grammar is significantly above target',
    '- tooEasy: true if far below target',
    '- unsafe: true if content is not classroom-safe or culturally insensitive',
    '',
    'Provide brief actionable "notes" (2-4 sentences) explaining the strongest and weakest aspects.',
    '',
    'JSON schema:',
    '{',
    '  "plot": 1,',
    '  "character": 1,',
    '  "vocabulary": 1,',
    '  "grammar": 1,',
    '  "pacing": 1,',
    '  "emotion": 1,',
    '  "setting": 1,',
    '  "coherence": 1,',
    '  "cefrFit": "B1",',
    '  "notes": "string",',
    '  "flags": { "tooHard": false, "tooEasy": false, "unsafe": false }',
    '}'
  ].join('\n');
}

module.exports = {
  CRITERIA,
  CRITERIA_LABELS,
  WEIGHTS,
  PASS_THRESHOLD,
  CRITICAL_MIN,
  CRITICAL_CRITERIA,
  computeWeightedScore,
  getAssessmentPrompt
};
