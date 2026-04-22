/**
 * Reclassify SGD mode difficulty levels 1..3 using the same
 * multi-factor percentile logic used for Note mode.
 *
 * Usage:
 *   node scripts/update-sgd-difficulty.js
 *   node scripts/update-sgd-difficulty.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const Excel = require('exceljs');
const { classifyEntriesByText } = require('../public/content-difficulty-classifier.js');

const EXCEL_PATH = path.join(__dirname, '..', 'public', 'database', 'SGD', 'SGD', 'SGD.xlsx');
const LEVEL_COLUMN_INDEX = 9;

function getCellText(value) {
    if (!value) return '';
    if (value.richText) return value.richText.map((part) => part.text).join('');
    return String(value).trim();
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');

    console.log(`Reading Excel file: ${EXCEL_PATH}`);
    if (isDryRun) {
        console.log('  (DRY RUN - no files will be written)\n');
    }

    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`Error: Excel file not found: ${EXCEL_PATH}`);
        process.exit(1);
    }

    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);
    const worksheet = workbook.getWorksheet(1);

    const items = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const id = String(row.getCell(1).value || '').trim();
        if (!id) return;

        items.push({
            id,
            row,
            rowNumber,
            title: getCellText(row.getCell(2).value),
            transcript: getCellText(row.getCell(3).value),
            oldLevel: Number.parseInt(row.getCell(LEVEL_COLUMN_INDEX).value, 10) || 0
        });
    });

    const classified = classifyEntriesByText(items, (item) => item.transcript);
    const distribution = { 1: 0, 2: 0, 3: 0 };
    const oldDistribution = { 1: 0, 2: 0, 3: 0 };

    const headerRow = worksheet.getRow(1);
    headerRow.getCell(LEVEL_COLUMN_INDEX).value = 'Difficulty (1-3)';
    headerRow.commit();

    classified.forEach((item, index) => {
        const level = item.level;
        if (level >= 1 && level <= 3) distribution[level] += 1;
        if (items[index].oldLevel >= 1 && items[index].oldLevel <= 3) oldDistribution[items[index].oldLevel] += 1;

        items[index].row.getCell(LEVEL_COLUMN_INDEX).value = level;
        items[index].row.commit();
    });

    console.log('Distribution Comparison:');
    console.log('  Level | Old Count | New Count | Change');
    for (const level of [1, 2, 3]) {
        const oldCount = oldDistribution[level];
        const newCount = distribution[level];
        const delta = newCount - oldCount;
        const sign = delta > 0 ? '+' : '';
        console.log(`    ${level}   |    ${String(oldCount).padStart(3)}    |    ${String(newCount).padStart(3)}    | ${sign}${delta}`);
    }

    if (!isDryRun) {
        await workbook.xlsx.writeFile(EXCEL_PATH);
        console.log('\nUpdated SGD difficulty levels in Excel.');
    } else {
        console.log('\nDry run complete.');
    }
}

main().catch((error) => {
    console.error('Error updating SGD difficulty:', error);
    process.exit(1);
});
