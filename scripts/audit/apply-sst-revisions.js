/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const WORKBOOK_PATH = path.join(ROOT_DIR, 'public', 'database', 'SST', 'SST', 'SST.xlsx');
const JSON_INPUT_PATH = path.join(ROOT_DIR, 'docs', 'audits', 'sst-mainpoints-analysis.json');

async function main() {
  console.log('====================================================');
  console.log('   SST Expected Main Points Revision Applier');
  console.log('====================================================');
  console.log(`Workbook: ${WORKBOOK_PATH}`);
  console.log(`Audit JSON: ${JSON_INPUT_PATH}`);
  console.log('====================================================\n');

  if (!fs.existsSync(JSON_INPUT_PATH)) {
    console.error(`Error: JSON audit file not found at ${JSON_INPUT_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(WORKBOOK_PATH)) {
    console.error(`Error: Excel file not found at ${WORKBOOK_PATH}`);
    process.exit(1);
  }

  // Load audit data
  const auditData = JSON.parse(fs.readFileSync(JSON_INPUT_PATH, 'utf8'));
  console.log(`Loaded ${auditData.length} audit entries.`);

  // Create map from question ID to evaluation results
  const auditMap = new Map();
  auditData.forEach(item => {
    if (item && item.question && item.question.id) {
      auditMap.set(String(item.question.id).trim(), item.evaluation);
    }
  });

  // Load workbook
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const worksheet = workbook.worksheets[0];

  let revisedCount = 0;
  let skippedCount = 0;
  let invalidPointsCount = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip headers
    const id = String(row.getCell(1).value || '').trim();
    if (!id) return;

    const evaluation = auditMap.get(id);
    if (!evaluation) {
      skippedCount++;
      return;
    }

    if (evaluation.status === 'needs_revision') {
      const newPoints = evaluation.gemmaExtractedPoints;
      if (Array.isArray(newPoints) && newPoints.length >= 3 && newPoints.length <= 5) {
        const oldVal = String(row.getCell(4).value || '').trim();
        const newValJson = JSON.stringify(newPoints);
        
        row.getCell(4).value = newValJson;
        console.log(`[REVISED Q${id}] "${row.getCell(2).value}"`);
        console.log(`  Old: ${oldVal}`);
        console.log(`  New: ${newValJson}\n`);
        revisedCount++;
      } else {
        console.warn(`[WARNING Q${id}] Extracted points count (${newPoints ? newPoints.length : 0}) is not between 3 and 5. Skipping revision.`);
        invalidPointsCount++;
        skippedCount++;
      }
    } else {
      skippedCount++;
    }
  });

  if (revisedCount > 0) {
    await workbook.xlsx.writeFile(WORKBOOK_PATH);
    console.log('====================================================');
    console.log(`Workbook successfully updated and saved to ${WORKBOOK_PATH}`);
    console.log(`Total revised: ${revisedCount}`);
    console.log(`Total skipped/passed: ${skippedCount}`);
    if (invalidPointsCount > 0) {
      console.log(`Total invalid points warnings: ${invalidPointsCount}`);
    }
    console.log('====================================================');
  } else {
    console.log('No revisions needed or applied.');
  }
}

main().catch(err => {
  console.error('Fatal error during revision application:', err);
  process.exit(1);
});
