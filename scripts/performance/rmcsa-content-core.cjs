'use strict';
const { createHash } = require('node:crypto');

// Preserve the existing RMCSA delimiter and checkbox grammar. Do not "repair"
// authoring data silently; fail publication with a row-specific error instead.
function parseRmcsaAnswer(value) {
  const normalized = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  let parts = normalized.split(/\n\s*-{3,}\s*\n/).map(x => x.trim()).filter(Boolean);
  if (parts.length < 3) parts = normalized.split(/-{3,}/).map(x => x.trim()).filter(Boolean);
  const passage = parts.length >= 1 ? parts[0] : normalized;
  const question = parts.length >= 2 ? parts[1] : '';
  const choicesRaw = parts.length >= 3 ? parts.slice(2).join('\n') : '';
  const choices = [];
  for (const line of choicesRaw.split('\n')) {
    const match = line.trim().match(/^\[([xX\s]*)\]\s*(.*)$/);
    if (match) choices.push({ text: match[2].trim(), isCorrect: match[1].toLowerCase().includes('x') });
  }
  return { passage, question, choices };
}

function compileRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('RMCSA bank has no data rows.');
  const ids = new Set();
  const questions = rows.map((row, index) => {
    const where = `RMCSA row ${row.__rowNumber || index + 2}`;
    const id = Number(row.ID);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${where}: invalid ID.`);
    if (ids.has(id)) throw new Error(`${where}: duplicate ID ${id}.`);
    ids.add(id);
    const title = String(row.TITLE || '').trim();
    const explanation = String(row.EXPLANATION || '').trim();
    const parsed = parseRmcsaAnswer(row.ANSWER);
    if (!title || !parsed.passage || !parsed.question) throw new Error(`${where}: missing title, passage or question.`);
    if (parsed.choices.length < 2 || parsed.choices.some(c => !c.text)) throw new Error(`${where}: invalid choices.`);
    if (parsed.choices.filter(c => c.isCorrect).length !== 1) throw new Error(`${where}: exactly one correct answer is required.`);
    return { id, title, ...parsed, explanation };
  }).sort((a, b) => a.id - b.id);
  const bank = { schemaVersion: 1, mode: 'rmcsa', questions };
  const text = JSON.stringify(bank) + '\n';
  const bytes = Buffer.from(text, 'utf8');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const fileName = `rmcsa.${hash}.json`;
  const manifest = { schemaVersion: 1, mode: 'rmcsa', version: hash, sha256: hash,
    questionCount: questions.length, bytes: bytes.length, url: `/content/rmcsa/${fileName}` };
  return { bank, bytes, hash, fileName, manifest, manifestText: JSON.stringify(manifest, null, 2) + '\n' };
}
module.exports = { parseRmcsaAnswer, compileRows };
