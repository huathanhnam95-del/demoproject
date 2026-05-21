function parseDragDropAnswerCell(text) {
  if (!text) {
    return { correctAnswers: [], distractors: [], segments: [] };
  }

  const parts = text.split('---');
  const passagePart = parts[0] || '';
  const distractorPart = parts[1] || '';

  const correctAnswers = [];
  const regex = /__([^_]+)__/g;
  let match;
  while ((match = regex.exec(passagePart)) !== null) {
    correctAnswers.push(match[1].trim());
  }

  const segments = [];
  const splitParts = passagePart.split(/__[^_]+__/);
  
  // Reset regex index and get matches again to iterate in sync
  regex.lastIndex = 0;
  const matches = [];
  while ((match = regex.exec(passagePart)) !== null) {
    matches.push(match[1].trim());
  }

  for (let i = 0; i < splitParts.length; i++) {
    if (splitParts[i].length > 0) {
      segments.push({ type: 'text', text: splitParts[i] });
    }
    if (i < matches.length) {
      segments.push({
        type: 'blank',
        index: i,
        answer: matches[i]
      });
    }
  }

  const distractors = distractorPart
    .split('/')
    .map(d => d.trim())
    .filter(d => d.length > 0);

  return {
    correctAnswers,
    distractors,
    segments
  };
}

function buildQuestionRecord({ id, title, sourceRow, answerCell, compareText }) {
  const parsed = parseDragDropAnswerCell(answerCell);
  
  const blanks = [];
  const segments = parsed.segments.map(seg => {
    if (seg.type === 'blank') {
      const blankId = `q${id}-b${seg.index + 1}`;
      blanks.push({
        blankId,
        index: seg.index,
        answer: seg.answer,
        explanation: null
      });
      return {
        type: 'blank',
        blankId,
        index: seg.index,
        answer: seg.answer
      };
    }
    return seg;
  });

  const options = [];
  let optionIndex = 1;
  blanks.forEach(blank => {
    options.push({
      optionId: `q${id}-o${optionIndex++}`,
      text: blank.answer,
      kind: 'correct',
      blankId: blank.blankId
    });
  });

  const existingTexts = new Set(options.map(o => o.text.trim().toLowerCase()));
  parsed.distractors.forEach(dist => {
    const trimmed = dist.trim();
    if (!trimmed) return;
    if (existingTexts.has(trimmed.toLowerCase())) return;
    existingTexts.add(trimmed.toLowerCase());
    options.push({
      optionId: `q${id}-o${optionIndex++}`,
      text: trimmed,
      kind: 'distractor'
    });
  });

  const plainText = segments
    .map(s => s.type === 'text' ? s.text : s.answer)
    .join('');

  const warnings = [];
  if (blanks.length === 0) {
    warnings.push('No blanks found');
  }
  if (!answerCell || !answerCell.includes('---')) {
    warnings.push('No separator --- found');
  } else if (parsed.distractors.length === 0) {
    warnings.push('No distractors found');
  }

  const isUsable = blanks.length >= 1;

  return {
    id,
    mode: 'dd',
    title: title || `Question #${id}`,
    sourceRow,
    plainText,
    segments,
    blanks,
    options,
    validation: {
      isUsable,
      warnings
    }
  };
}

module.exports = {
  parseDragDropAnswerCell,
  buildQuestionRecord
};
