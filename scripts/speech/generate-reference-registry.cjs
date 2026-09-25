'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const sources = [
  ['read_aloud', 'public/database/RA/RA.xlsx', 'ANSWER FOR COMPARE OR TRANSCRIPT'],
  ['repeat_sentence', 'public/database/speak/RS.xlsx', 'ANSWER']
];
const python = [
  'import json, openpyxl, sys',
  'book=openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)',
  'rows=book.worksheets[0].values',
  'headers=[str(x or "").strip() for x in next(rows)]',
  'idcol=headers.index("ID"); textcol=headers.index(sys.argv[2])',
  'print(json.dumps({str(row[idcol]).strip(): str(row[textcol]).strip() for row in rows if row[idcol] is not None and row[textcol] and str(row[textcol]).strip()}, ensure_ascii=True))'
].join('\n');
const entries = {};
const sourceHashes = {};
for (const [mode, relativePath, textColumn] of sources) {
  const absolutePath = path.join(root, relativePath);
  sourceHashes[mode] = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
  entries[mode] = JSON.parse(execFileSync('python', ['-c', python, absolutePath, textColumn], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}
const registry = { schemaVersion: 'bel.speech.reference.v3', sourceHashes, entries };
const destination = path.join(root, 'functions/src/data/speech-reference-registry.v3.json');
const serialized = `${JSON.stringify(registry, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== serialized) {
    throw new Error('SPEECH_REFERENCE_REGISTRY_STALE');
  }
} else {
  fs.writeFileSync(destination, serialized);
}
console.log(`${Object.keys(entries.read_aloud).length} Read Aloud and ${Object.keys(entries.repeat_sentence).length} Repeat Sentence references ${process.argv.includes('--check') ? 'verified' : 'generated'}`);
