/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const jsonPath = path.join(__dirname, '..', 'public', 'database', 'Summarize Written Text', 'SWT', 'swt-questions.json');
const raw = fs.readFileSync(jsonPath, 'utf8');
const questions = JSON.parse(raw);

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function isSingleSentence(text) {
  const t = (text || '').trim();
  if (!t.endsWith('.')) return { ok: false, reason: 'Does not end with period' };
  const inner = t.slice(0, -1);
  if (inner.includes('?') || inner.includes('!')) {
    return { ok: false, reason: 'Contains ? or !' };
  }
  // Mask decimals and known abbreviations
  let masked = inner.replace(/\d+\.\d+/g, 'NUM');
  masked = masked.replace(/\b(?:[A-Za-z]\.){1,}/g, 'ABBR');
  masked = masked.replace(/\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|approx|dept|vol|no)\./gi, 'ABBR');
  if (/\.\s+/.test(masked) || /\.(?!\w)/.test(masked)) {
    return { ok: false, reason: 'Contains sentence-breaking period' };
  }
  return { ok: true };
}

const annotatedQuestions = questions.filter(q => q.answerAnalysis);
console.log(`Running SWT Integrity Tests on ${annotatedQuestions.length} annotated questions (IDs: ${annotatedQuestions.map(q => q.id).join(', ')})...`);
assert.ok(annotatedQuestions.length >= 10, 'Must have at least 10 annotated questions');

annotatedQuestions.forEach((q) => {
  const qid = q.id;
  const aa = q.answerAnalysis;
  assert.ok(aa, `Q#${qid} must have answerAnalysis`);
  const ss = aa.sampleSummary;
  assert.ok(ss, `Q#${qid} must have sampleSummary`);

  // Assert Version C is strictly absent
  assert.strictEqual('versionC' in ss, false, `Q#${qid} must NOT contain versionC`);
  assert.ok('versionA' in ss, `Q#${qid} must contain versionA`);
  assert.ok('versionB' in ss, `Q#${qid} must contain versionB`);

  // Version A checks
  const va = ss.versionA;
  const wcA = countWords(va.text);
  assert.ok(wcA >= 50 && wcA <= 70, `Q#${qid} Version A word count (${wcA}) must be between 50 and 70 words`);
  const sentA = isSingleSentence(va.text);
  assert.strictEqual(sentA.ok, true, `Q#${qid} Version A must be strictly 1 single sentence: ${sentA.reason}`);
  const BANNED_STARTINGS = new Set(['and', 'but', 'or', 'so', 'nor']);
  const BANNED_ENDINGS = new Set([
    'are', 'is', 'was', 'were', 'be', 'been', 'being',
    'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
    'which', 'that', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
    'to', 'and', 'or', 'but', 'nor', 'so', 'for', 'yet', 'while', 'as', 'although', 'though',
    'of', 'in', 'with', 'by', 'at', 'from', 'on', 'into', 'onto', 'upon', 'about', 'above'
  ]);

  function validateHighlights(versionKey, vObj) {
    const hls = vObj.pointHighlights;
    assert.ok(Array.isArray(hls) && hls.length > 0, `Q#${qid} ${versionKey} must have pointHighlights`);
    hls.forEach((h, hIdx) => {
      assert.ok(h.phrase && vObj.text.includes(h.phrase), `Q#${qid} ${versionKey} highlight #${hIdx} ("${h.phrase}") must exist verbatim in summary text`);
      const words = h.phrase.trim().split(/\s+/);
      assert.ok(words.length >= 4, `Q#${qid} ${versionKey} highlight #${hIdx} ("${h.phrase}") must have at least 4 words`);
      const firstW = words[0].replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
      const lastW = words[words.length - 1].replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
      assert.ok(!BANNED_STARTINGS.has(firstW), `Q#${qid} ${versionKey} highlight #${hIdx} ("${h.phrase}") starts with banned conjunction '${firstW}'`);
      assert.ok(!BANNED_ENDINGS.has(lastW), `Q#${qid} ${versionKey} highlight #${hIdx} ("${h.phrase}") ends with banned word '${lastW}'`);

      const noPairedSq = h.phrase.replace(/'[^']+'/g, '');
      const noApostrophes = noPairedSq.replace(/\b[a-zA-Z]+'[a-zA-Z]+\b/g, '');
      const noPossessives = noApostrophes.replace(/\b[a-zA-Z]+s'(?=\s|$|[.,;:!?])/g, '');
      assert.strictEqual((noPossessives.match(/'/g) || []).length, 0, `Q#${qid} ${versionKey} highlight #${hIdx} ("${h.phrase}") has unclosed single quote`);
      const doubleQuotes = (h.phrase.match(/"/g) || []).length;
      assert.ok(doubleQuotes % 2 === 0, `Q#${qid} ${versionKey} highlight #${hIdx} ("${h.phrase}") has unclosed double quote`);
    });

    for (let i = 0; i < hls.length; i++) {
      for (let j = 0; j < hls.length; j++) {
        if (i !== j) {
          const pi = hls[i].phrase.trim().toLowerCase();
          const pj = hls[j].phrase.trim().toLowerCase();
          assert.ok(pi !== pj, `Q#${qid} ${versionKey} duplicate highlight between ${hls[i].pointId} and ${hls[j].pointId}`);
          assert.ok(!pj.includes(pi), `Q#${qid} ${versionKey} highlight ${hls[i].pointId} ("${hls[i].phrase}") is nested inside ${hls[j].pointId} ("${hls[j].phrase}")`);
        }
      }
    }

    const spans = [];
    hls.forEach((h) => {
      let pos = 0;
      while (true) {
        const idx = vObj.text.indexOf(h.phrase, pos);
        if (idx === -1) break;
        spans.push({ start: idx, end: idx + h.phrase.length, pointId: h.pointId, phrase: h.phrase });
        pos = idx + 1;
      }
    });
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        if (spans[i].pointId !== spans[j].pointId) {
          const overlap = Math.max(spans[i].start, spans[j].start) < Math.min(spans[i].end, spans[j].end);
          assert.ok(!overlap, `Q#${qid} ${versionKey} character span overlap between ${spans[i].pointId} and ${spans[j].pointId}`);
        }
      }
    }
  }

  validateHighlights('Version A', va);

  // Version B checks
  const vb = ss.versionB;
  const wcB = countWords(vb.text);
  assert.ok(wcB >= 50 && wcB <= 70, `Q#${qid} Version B word count (${wcB}) must be between 50 and 70 words`);
  const sentB = isSingleSentence(vb.text);
  assert.strictEqual(sentB.ok, true, `Q#${qid} Version B must be strictly 1 single sentence: ${sentB.reason}`);
  validateHighlights('Version B', vb);

  // Paraphrasing guide checks
  const pg = vb.paraphrasingGuide;
  assert.ok(Array.isArray(pg) && pg.length >= 4, `Q#${qid} Version B must have paraphrasingGuide with at least 4 items`);
  pg.forEach((item, gIdx) => {
    assert.ok(item.original && item.original.trim().length > 0, `Q#${qid} Version B guide item #${gIdx} missing original`);
    assert.ok(item.paraphrased && item.paraphrased.trim().length > 0, `Q#${qid} Version B guide item #${gIdx} missing paraphrased`);
    assert.ok(item.technique && item.technique.trim().length > 0, `Q#${qid} Version B guide item #${gIdx} missing technique`);
    assert.ok(item.note && item.note.trim().length > 0, `Q#${qid} Version B guide item #${gIdx} missing note`);
  });

  // Evidence quote checks
  const source = q.sourceText;
  (aa.corePoints || []).forEach((cp) => {
    (cp.evidence || []).forEach((ev) => {
      const actualSubstring = source.slice(ev.start, ev.end);
      assert.strictEqual(actualSubstring, ev.quote, `Q#${qid} CorePoint ${cp.id} evidence quote mismatch at [${ev.start}:${ev.end}]`);
    });
  });
  (aa.ignorePoints || []).forEach((ip) => {
    (ip.evidence || []).forEach((ev) => {
      const actualSubstring = source.slice(ev.start, ev.end);
      assert.strictEqual(actualSubstring, ev.quote, `Q#${qid} IgnorePoint ${ip.id} evidence quote mismatch at [${ev.start}:${ev.end}]`);
    });
  });
});

console.log(`All ${annotatedQuestions.length} SWT Questions passed integrity validation (100% 2-version compliant, 50–70 words, 1 sentence, exact substring highlights)!`);
