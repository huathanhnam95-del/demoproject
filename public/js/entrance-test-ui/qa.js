function blankParts(question) {
  return (question.parts || []).filter((part) => part.type === 'blank');
}

export function createQATools({ questions = [], getDraft = () => ({ answers: {}, recordingRefs: {} }), dispatch = () => {}, createFixtureRecording = async () => null, reset = async () => {} } = {}) {
  let notice = '';

  function setNotice(value) { notice = String(value || ''); }

  async function fillAll() {
    for (const question of questions) {
      if (question.type === 'speaking') {
        await createFixtureRecording(question);
        continue;
      }
      for (const part of blankParts(question)) dispatch({ type: 'set-answer', questionId: question.questionId, blankId: part.blankId, value: part.options?.[0] || 'Demo QA' });
    }
    setNotice('Demo QA fixture recording');
  }

  async function complete() { return fillAll(); }

  async function makePartial() {
    let changed = false;
    for (const question of questions) {
      const part = blankParts(question)[0];
      if (part) { dispatch({ type: 'set-answer', questionId: question.questionId, blankId: part.blankId, value: part.options?.[0] || 'Demo QA' }); changed = true; break; }
    }
    if (!changed) {
      const speaking = questions.find((question) => question.type === 'speaking');
      if (speaking) await createFixtureRecording(speaking);
    }
    setNotice('Demo QA partial state');
  }

  function clearCurrent(questionId) {
    const question = questions.find((item) => item.questionId === questionId);
    if (!question) return;
    for (const part of blankParts(question)) dispatch({ type: 'clear-answer', questionId, blankId: part.blankId });
    if (question.type === 'speaking') dispatch({ type: 'set-recording-ref', questionId, recordingRef: null });
    setNotice('Demo QA cleared current group');
  }

  function jumpMissing() {
    const draft = getDraft() || {};
    for (const question of questions) {
      if (question.type === 'speaking' && !draft.recordingRefs?.[question.questionId]) return { questionId: question.questionId, blankId: null };
      const values = draft.answers?.[question.questionId] || {};
      const part = blankParts(question).find((item) => !String(values[item.blankId] ?? '').trim());
      if (part) return { questionId: question.questionId, blankId: part.blankId };
    }
    return null;
  }

  return Object.freeze({
    fillAll,
    complete,
    makePartial,
    clearCurrent,
    jumpMissing,
    toggleFlag: async (questionId) => dispatch({ type: 'toggle-flag', questionId }),
    reset,
    lastNotice: () => notice
  });
}
