export const LEVEL_DESCRIPTORS = Object.freeze({
  A1: 'Everyday words and short exchanges.',
  A2: 'Routines, requests, and familiar situations.',
  B1: 'Study, work, and everyday explanations.',
  B2: 'Abstract ideas and professional communication.',
  C1: 'Nuanced academic and professional language.',
});

export const SUPPORT_DESCRIPTORS = Object.freeze({
  guided: 'Before you attempt: IPA, meaning, and an example. Afterward: corrective feedback.',
  standard: 'Before you attempt: meaning. Afterward: corrective feedback and engine evidence.',
  challenge: 'Before you attempt: no support. After your attempt: corrective feedback and engine evidence.',
});

const EVENT_LABELS = Object.freeze({
  'sandbox.setup.completed': 'Arena ready', 'combat.started': 'Combat begins', 'player.action.selected': 'Action selected',
  'recording.started': 'Recording started', 'recording.stopped': 'Recording stopped', 'analysis.pending': 'Checking pronunciation',
  'analysis.resolved': 'Analysis complete', 'analysis.noop': 'Analysis unavailable; no judgment recorded', 'player.attack.resolved': 'Attack resolved',
  'enemy.intent.presented': 'Enemy intent shown', 'player.block.resolved': 'Block resolved', 'player.parry.started': 'Parry window started',
  'player.parry.resolved': 'Parry resolved', 'combat.damage.applied': 'Damage applied', 'combat.focus.changed': 'Focus updated',
  'combat.resonance.ready': 'Resonance ready', 'combat.resonance.consumed': 'Resonance used', 'combat.victory': 'Victory',
  'combat.defeat': 'Defeat', 'combat.abandoned': 'Run abandoned', 'telemetry.exported': 'Timing export ready',
});

export function humanizeEvent(type) { return EVENT_LABELS[type] || 'Training update'; }

export function describeLevel(level) { return LEVEL_DESCRIPTORS[level] || 'Choose an A1-C1 level.'; }
export function describeSupport(preset) { return SUPPORT_DESCRIPTORS[preset] || SUPPORT_DESCRIPTORS.standard; }

export function describeActionCard(card, { focus = 0, terminal = false } = {}) {
  const engine = card.evaluationMode === 'v3_word' ? 'V3 word evidence' : card.evaluationMode === 'azure_phrase' ? 'Azure phrase evidence' : 'Azure word evidence';
  const cost = card.focusCost ? `${card.focusCost} Focus` : 'No Focus cost';
  const risk = card.focusCost ? 'spends Focus even when the attempt is incorrect' : 'low resource risk';
  const disabledReason = terminal ? 'The run has ended.' : focus < card.focusCost ? `Need ${card.focusCost} Focus; ${focus} available.` : '';
  return Object.freeze({
    label: card.label,
    description: `${engine} · base damage ${card.baseDamage} · ${cost}; ${risk}.`,
    disabled: Boolean(disabledReason),
    disabledReason,
    ariaDescription: `${card.label}: ${engine}, base damage ${card.baseDamage}, ${cost}. ${disabledReason}`.trim(),
  });
}

function evidenceText(analysis, challenge, card) {
  const dimensions = analysis?.dimensions || {};
  if (analysis?.evaluationMode === 'azure_phrase' || challenge?.evaluationMode === 'azure_phrase') {
    return `Azure phrase accuracy: ${dimensions.accuracy ?? 'not available'}; fluency: ${dimensions.fluency ?? 'not available'}; completeness: ${dimensions.completeness ?? 'not available'}.`;
  }
  if (analysis?.evaluationMode === 'v3_word' || challenge?.evaluationMode === 'v3_word' || card?.evaluationMode === 'v3_word') {
    return `V3 count evidence: ${dimensions.countStatus ?? 'not available'}; stress evidence: ${dimensions.stressStatus ?? 'not available'}.`;
  }
  return `Azure word accuracy: ${dimensions.accuracy ?? analysis?.score ?? 'not available'}.`;
}

export function formatAnalysisFeedback({ analysis, challenge, card, damage = 0, supportPreset = 'standard' } = {}) {
  const technicalNoop = !analysis || !['scored', 'incorrect'].includes(analysis.status) || analysis.score === null || analysis.score === undefined;
  const scoreLine = technicalNoop ? 'This attempt could not be rated.' : `Score: ${analysis.score}/100.`;
  const focus = challenge?.pronunciation?.focus;
  const focusLine = focus ? `Pronunciation focus: ${focus}.` : '';
  const consequence = technicalNoop ? 'No damage or resource change was applied; try again when analysis is available.' : `${damage} damage dealt.`;
  const result = analysis?.status === 'scored' ? 'Your attempt met the action threshold.' : analysis?.status === 'incorrect' ? 'Use this evidence to adjust the target on your next attempt.' : 'Technical analysis did not produce a learner judgment.';
  const supportLine = supportPreset === 'guided' && challenge?.pronunciation?.ipa ? `IPA reminder: ${challenge.pronunciation.ipa}.` : '';
  return Object.freeze({ technicalNoop, tone: technicalNoop ? 'neutral' : analysis.status === 'scored' ? 'success' : 'warning', text: [scoreLine, evidenceText(analysis, challenge, card), focusLine, result, consequence, supportLine].filter(Boolean).join(' ') });
}

export function summarizeRun({ outcome = 'abandoned', rounds = 0, attempts = [] } = {}) {
  const scored = attempts.filter((attempt) => Number.isFinite(attempt.score));
  const scores = scored.map((attempt) => attempt.score);
  const focuses = [...new Set(attempts.map((attempt) => attempt.focus || attempt.challenge?.pronunciation?.focus).filter(Boolean))];
  return Object.freeze({
    outcome, rounds, scoredAttempts: scored.length,
    averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    bestScore: scores.length ? Math.max(...scores) : null,
    successfulActions: attempts.filter((attempt) => attempt.success === true).length,
    pronunciationFocusReview: focuses,
  });
}
