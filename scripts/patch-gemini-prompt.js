/**
 * Patch script: Improve generateBeat() prompt in gemini.js
 * Adds: (1) CEFR vocabulary constraints, (2) choice narrative guidance
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src', 'services', 'reading-journey', 'gemini.js');
let code = fs.readFileSync(FILE, 'utf8');

// ─── Patch 1: Add CEFR vocabulary constraints after the PG-safe line ───────
const pgLine = `    '- Keep content PG and classroom-safe. No real celebrities, politicians, or brands.',`;
const contLine = `    'Continuity rules:',`;
const vocabBlock = `    '- Keep content PG and classroom-safe. No real celebrities, politicians, or brands.',
    \`Vocabulary constraints for \${safeLevel}:\`,
    safeLevel === 'A2'
      ? '- Use ONLY common, everyday words (top 2000 frequency). Avoid abstract nouns, idioms, and any B1+ vocabulary. Prefer short sentences (8-12 words).'
      : safeLevel === 'B1'
        ? '- Use mostly common words. A few intermediate words are OK only if surrounding context makes the meaning clear. Avoid B2+ vocabulary like "persistence", "resolution", or "affirmed".'
        : safeLevel === 'B2'
          ? '- Use a mix of common and intermediate vocabulary. Some complex words in context are fine. Avoid rare/academic words.'
          : '- Full range of vocabulary is acceptable for advanced learners. Use precise, varied word choices.',
    'Continuity rules:',`;

const patch1Target = pgLine + '\n' + '    ' + contLine.trim();
if (code.includes(patch1Target)) {
  code = code.replace(patch1Target, vocabBlock);
  console.log('✅ Patch 1 applied: CEFR vocabulary constraints');
} else {
  // Try with \r\n
  const patch1TargetCRLF = pgLine + '\r\n' + '    ' + contLine.trim();
  if (code.includes(patch1TargetCRLF)) {
    code = code.replace(patch1TargetCRLF, vocabBlock);
    console.log('✅ Patch 1 applied (CRLF): CEFR vocabulary constraints');
  } else {
    console.error('❌ Patch 1 FAILED: Could not find target');
    console.error('  Looking for:', JSON.stringify(patch1Target.substring(0, 100)));
    // Show nearby content
    const idx = code.indexOf('Keep content PG');
    if (idx >= 0) {
      console.error('  Found "Keep content PG" at index', idx);
      console.error('  Context:', JSON.stringify(code.substring(idx, idx + 200)));
    }
    process.exit(1);
  }
}

// ─── Patch 2: Add choice narrative guidance before "Now generate this beat" ──
const nowGenLine = `    'Now generate this beat.'`;
const choiceGuidance = `    'Choice narrative guide (use the MOST RECENT choice to shape this beat\\'s tone):',
    '- investigate: The character actively searches, examines closely, or discovers something new. Show physical action and sensory detail.',
    '- ask: The character talks to someone, asks questions, or learns new information through dialogue. Include direct speech.',
    '- wait: The character pauses and observes carefully, noticing a subtle clue, overhearing something, or having a realization.',
    '  CRITICAL for "wait": waiting MUST still advance the plot. The character must notice, discover, or realize something',
    '  that changes the situation. Pure inaction or repetition of previous events is NEVER acceptable.',
    'Now generate this beat.'`;

if (code.includes(nowGenLine)) {
  code = code.replace(nowGenLine, choiceGuidance);
  console.log('✅ Patch 2 applied: Choice narrative guidance');
} else {
  console.error('❌ Patch 2 FAILED: Could not find "Now generate this beat."');
  process.exit(1);
}

fs.writeFileSync(FILE, code, 'utf8');
console.log('\n✅ All patches applied to gemini.js');
