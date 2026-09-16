#!/usr/bin/env node
/**
 * Audit acceptance cases catalogue (Section 7) for BEL 3D upgrade.
 * Validates cases.json schema, case coverage, variant definitions, and reports summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const casesPath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../../tests/browser/bel-demo/cases.json');

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

function auditAcceptanceCatalogue() {
  console.log('================================================================');
  console.log('         BEL ACCEPTANCE CASES AUDIT (SECTION 7 VALIDATOR)       ');
  console.log('================================================================\n');

  const errors = [];
  const warnings = [];

  if (!fs.existsSync(casesPath)) {
    console.error(`FATAL: cases.json not found at ${casesPath}`);
    process.exit(1);
  }

  let catalog;
  try {
    const raw = fs.readFileSync(casesPath, 'utf8');
    catalog = JSON.parse(raw);
  } catch (err) {
    console.error(`FATAL: Failed to parse cases.json: ${err.message}`);
    process.exit(1);
  }

  if (!catalog || typeof catalog !== 'object') {
    errors.push('Top-level catalogue must be a JSON object.');
  }

  const cases = Array.isArray(catalog.cases) ? catalog.cases : [];
  if (!cases.length) {
    errors.push('catalogue contains no cases array or cases array is empty.');
  }

  // Check declared variants
  const declaredVariants = catalog.variants || {};
  for (const v of VALID_VARIANTS) {
    if (!declaredVariants[v]) {
      warnings.push(`Variant ${v} is missing descriptive label in top-level variants map.`);
    }
  }

  // Check all expected case IDs
  const allExpectedIds = Object.values(EXPECTED_FAMILIES).flat();
  const caseMap = new Map();
  const idRegex = /^[A-Z0-9]+-\d{2}$/;

  for (const c of cases) {
    if (!c.id) {
      errors.push('Case entry found without an id property.');
      continue;
    }
    if (caseMap.has(c.id)) {
      errors.push(`Duplicate case id: ${c.id}`);
    }
    caseMap.set(c.id, c);

    if (!idRegex.test(c.id)) {
      errors.push(`Invalid case id format: "${c.id}". Expected pattern ^[A-Z0-9]+-\\d{2}$`);
    }

    if (!c.category || typeof c.category !== 'string') {
      errors.push(`Case ${c.id} is missing category property.`);
    } else {
      const expectedPrefix = c.id.split('-')[0];
      if (c.category !== expectedPrefix) {
        errors.push(`Case ${c.id} category "${c.category}" does not match id prefix "${expectedPrefix}".`);
      }
    }

    if (!c.title || typeof c.title !== 'string' || c.title.trim().length < 5) {
      errors.push(`Case ${c.id} title is missing or too short.`);
    }

    if (!c.description || typeof c.description !== 'string' || c.description.trim().length < 20) {
      errors.push(`Case ${c.id} description is missing or too short.`);
    }

    if (!Array.isArray(c.requiredVariants) || c.requiredVariants.length === 0) {
      errors.push(`Case ${c.id} requiredVariants must be a non-empty array.`);
    } else {
      for (const v of c.requiredVariants) {
        if (!VALID_VARIANTS.has(v)) {
          errors.push(`Case ${c.id} references unrecognized variant "${v}". Valid variants: ${Array.from(VALID_VARIANTS).join(', ')}`);
        }
      }
    }

    if (!Array.isArray(c.prerequisites)) {
      errors.push(`Case ${c.id} prerequisites must be an array.`);
    }

    if (!Array.isArray(c.stageAvailability) || c.stageAvailability.length === 0) {
      errors.push(`Case ${c.id} stageAvailability must be a non-empty array.`);
    }
  }

  // Verify full coverage of required Section 7 cases
  const missingCases = [];
  for (const expectedId of allExpectedIds) {
    if (!caseMap.has(expectedId)) {
      missingCases.push(expectedId);
    }
  }
  if (missingCases.length > 0) {
    errors.push(`Missing ${missingCases.length} required Section 7 cases: ${missingCases.join(', ')}`);
  }

  // Count variant usage
  const variantUsage = {};
  for (const v of VALID_VARIANTS) {
    variantUsage[v] = 0;
  }
  for (const c of cases) {
    for (const v of (c.requiredVariants || [])) {
      if (variantUsage[v] !== undefined) {
        variantUsage[v]++;
      }
    }
  }

  // Print summary breakdown
  console.log(`Total Cases Catalogued: ${cases.length} / ${allExpectedIds.length} expected`);
  console.log('\n--- Category Coverage ---');
  for (const [family, ids] of Object.entries(EXPECTED_FAMILIES)) {
    const present = ids.filter(id => caseMap.has(id)).length;
    const status = present === ids.length ? '✔ PASS' : '✖ FAIL';
    console.log(`  [${status}] ${family.padEnd(6)}: ${present}/${ids.length} cases covered (${ids.join(', ')})`);
  }

  console.log('\n--- Variant Distribution ---');
  for (const [v, count] of Object.entries(variantUsage)) {
    console.log(`  ${v}: referenced by ${count} cases (${declaredVariants[v] || 'No description'})`);
  }

  if (warnings.length > 0) {
    console.log('\n--- Warnings ---');
    warnings.forEach(w => console.log(`  ⚠ ${w}`));
  }

  if (errors.length > 0) {
    console.log('\n--- ERRORS FOUND ---');
    errors.forEach(e => console.log(`  ✖ ${e}`));
    console.log('\nAudit FAILED with errors.');
    process.exit(1);
  }

  console.log('\n================================================================');
  console.log('    AUDIT PASSED: cases.json satisfies all Section 7 rules!     ');
  console.log('================================================================\n');
  process.exit(0);
}

auditAcceptanceCatalogue();
