import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const casesUrl = new URL('../browser/bel-demo/cases.json', import.meta.url);
const casesPath = fileURLToPath(casesUrl);

const EXPECTED_FAMILIES = {
  ENV: ['ENV-01', 'ENV-02', 'ENV-03'],
  CON: ['CON-01', 'CON-02', 'CON-03', 'CON-04', 'CON-05'],
  MOD: ['MOD-01', 'MOD-02', 'MOD-03', 'MOD-04'],
  MOV: ['MOV-01', 'MOV-02', 'MOV-03', 'MOV-04', 'MOV-05'],
  REN: ['REN-01', 'REN-02', 'REN-03', 'REN-04', 'REN-05', 'REN-06'],
  F: ['F-01', 'F-02', 'F-03', 'F-04', 'F-05', 'F-06'],
  I: ['I-01', 'I-02', 'I-03', 'I-04'],
  J: ['J-01', 'J-02', 'J-03', 'J-04'],
  FIN: ['FIN-01', 'FIN-02'],
  AUTH: ['AUTH-01', 'AUTH-02', 'AUTH-03'],
  NOTE: ['NOTE-01', 'NOTE-02', 'NOTE-03'],
  REC: ['REC-01', 'REC-02', 'REC-03', 'REC-04'],
  A11Y: ['A11Y-01', 'A11Y-02', 'A11Y-03'],
  PERF: ['PERF-01', 'PERF-02', 'PERF-03']
};

const VALID_VARIANTS = new Set(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);

test('P03.3 / Section 7: cases.json exists and parses with valid structure', () => {
  assert.ok(fs.existsSync(casesPath), `cases.json should exist at ${casesPath}`);
  const data = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  assert.equal(data.version, '1.0.0');
  assert.equal(data.total, 55);
  assert.ok(Array.isArray(data.cases));
  assert.equal(data.cases.length, 55);
});

test('P03.3 / Section 7: complete case coverage across all 14 Section 7 families', () => {
  const data = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const cases = data.cases;
  const caseMap = new Map(cases.map(c => [c.id, c]));

  for (const [family, ids] of Object.entries(EXPECTED_FAMILIES)) {
    for (const id of ids) {
      assert.ok(caseMap.has(id), `Missing case ${id} in family ${family}`);
      const c = caseMap.get(id);
      assert.equal(c.category, family, `Case ${id} category should match ${family}`);
    }
  }
});

test('P03.3 / Section 7: schema validation for all 55 acceptance cases', () => {
  const data = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const idRegex = /^[A-Z0-9]+-\d{2}$/;

  for (const c of data.cases) {
    assert.match(c.id, idRegex, `Invalid id format for ${c.id}`);
    assert.ok(c.title && c.title.trim().length >= 5, `Title too short for ${c.id}`);
    assert.ok(c.description && c.description.trim().length >= 20, `Description too short for ${c.id}`);
    assert.ok(Array.isArray(c.requiredVariants) && c.requiredVariants.length > 0, `requiredVariants empty for ${c.id}`);
    for (const v of c.requiredVariants) {
      assert.ok(VALID_VARIANTS.has(v), `Unknown variant ${v} in ${c.id}`);
    }
    assert.ok(Array.isArray(c.prerequisites), `prerequisites not an array in ${c.id}`);
    assert.ok(Array.isArray(c.stageAvailability) && c.stageAvailability.length > 0, `stageAvailability empty in ${c.id}`);
  }
});
