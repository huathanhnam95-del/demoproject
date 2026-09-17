'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { compileRows } = require('./rmcsa-content-core.cjs');
const root = path.resolve(__dirname, '../..');

function scalar(value, location) {
  if (value == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  if ('formula' in value || 'sharedFormula' in value) {
    if (value.result === undefined) throw new Error(`${location}: formula has no cached result.`);
    return scalar(value.result, location);
  }
  if (typeof value.text === 'string' && value.hyperlink) return value.text;
  throw new Error(`${location}: unsupported cell value; inspect the source workbook.`);
}
async function main() {
  const ExcelJS = require('exceljs'); // Existing repository dependency, not a browser dependency.
  const workbook = new ExcelJS.Workbook();
  const input = path.join(root, 'public/database/RMCSA/RMCSA/RMCSA.xlsx');
  await workbook.xlsx.readFile(input);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('RMCSA workbook has no worksheet.');
  const columns = new Map();
  sheet.getRow(1).eachCell((cell, col) => {
    const name = String(scalar(cell.value, cell.address)).trim();
    if (!name) return;
    if (columns.has(name)) throw new Error(`Duplicate header ${name}.`);
    columns.set(name, col);
  });
  for (const required of ['ID', 'TITLE', 'ANSWER']) {
    if (!columns.has(required)) throw new Error(`Missing header ${required}.`);
  }
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = { __rowNumber: rowNumber };
    for (const name of ['ID', 'TITLE', 'ANSWER', 'EXPLANATION']) {
      const col = columns.get(name);
      record[name] = col ? scalar(row.getCell(col).value, `row ${rowNumber}, ${name}`) : '';
    }
    if (['ID', 'TITLE', 'ANSWER', 'EXPLANATION'].every(name => record[name] === '')) return;
    rows.push(record);
  });
  const published = compileRows(rows);
  const directory = path.join(root, 'public/content/rmcsa');
  const bankPath = path.join(directory, published.fileName);
  const manifestPath = path.join(directory, 'manifest.json');
  if (process.argv.includes('--check')) {
    const [bank, manifest] = await Promise.all([fs.readFile(bankPath), fs.readFile(manifestPath, 'utf8')]);
    if (!bank.equals(published.bytes) || manifest !== published.manifestText) {
      throw new Error('Published RMCSA content is stale. Regenerate and review it.');
    }
  } else {
    await fs.mkdir(directory, { recursive: true });
    // Old hash-addressed banks are deliberately retained for already-open clients.
    try {
      await fs.writeFile(bankPath, published.bytes, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await fs.readFile(bankPath)).equals(published.bytes)) throw new Error('Existing hash path contains different bytes.');
    }
    const temp = `${manifestPath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temp, published.manifestText, 'utf8');
      await fs.rename(temp, manifestPath);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  console.log(`RMCSA: ${published.manifest.questionCount} questions; ${published.bytes.length} bytes; ${published.hash}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { scalar };
