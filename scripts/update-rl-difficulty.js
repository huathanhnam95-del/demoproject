const fs = require('fs');
const path = require('path');
const Excel = require('exceljs');

const EXCEL_PATH = path.join(__dirname, '..', 'public', 'database', 'Take Notes', 'RL', 'RL.xlsx');

function calculateDifficulty(transcript) {
    if (!transcript) return 1;

    // Clean string for word counting
    const cleanTranscript = typeof transcript === 'string' ? transcript.trim() : String(transcript).trim();
    if (!cleanTranscript) return 1;

    const sentencesMatch = cleanTranscript.match(/[^.!?]+[.!?]+/g);
    const sentences = Math.max(1, sentencesMatch ? sentencesMatch.length : 1);

    const words = cleanTranscript.split(/\s+/).filter(w => w.replace(/[^a-zA-Z0-9]/g, '').length > 0);
    const wordCount = Math.max(1, words.length);

    // Estimate syllables by counting vowel groups
    const vowelsMatch = cleanTranscript.match(/[aeiouy]+/gi);
    const syllables = vowelsMatch ? vowelsMatch.length : wordCount;

    const wordsPerSentence = wordCount / sentences;
    const syllablesPerWord = syllables / wordCount;
    const gradeLevel = (0.39 * wordsPerSentence) + (11.8 * syllablesPerWord) - 15.59;

    if (gradeLevel < 6.0) return 1;
    if (gradeLevel <= 10.0) return 2;
    return 3;
}

async function updateExcelDatabase() {
    console.log(`Reading Excel file: ${EXCEL_PATH}`);

    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`Error: Excel file not found: ${EXCEL_PATH}`);
        process.exit(1);
    }

    try {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.readFile(EXCEL_PATH);
        const worksheet = workbook.getWorksheet(1); // First sheet

        let updatedCount = 0;
        let distribution = { 1: 0, 2: 0, 3: 0 };

        // Ensure header has Difficulty (assuming row 1 is header)
        const headerRow = worksheet.getRow(1);
        headerRow.getCell(4).value = "Difficulty (1-3)"; // Column D (index 4 in 1-based exceljs)
        headerRow.commit();

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            // Transcript is in Column C (3 in 1-based exceljs)
            const transcriptCell = row.getCell(3);
            const transcript = transcriptCell.value;

            if (transcript) {
                const text = transcript.richText ? transcript.richText.map(t => t.text).join('') : transcript;
                const difficulty = calculateDifficulty(text);

                // Write difficulty to Column D (4 in 1-based exceljs)
                row.getCell(4).value = difficulty;
                row.commit();

                distribution[difficulty]++;
                updatedCount++;
            }
        });

        // Backup existing file
        const backupFile = EXCEL_PATH + '.backup.' + Date.now();
        fs.copyFileSync(EXCEL_PATH, backupFile);
        console.log(`Backup created: ${backupFile}`);

        // Write updated Excel
        await workbook.xlsx.writeFile(EXCEL_PATH);

        console.log(`\n✅ Successfully updated ${EXCEL_PATH}`);
        console.log(`   Items processed: ${updatedCount}`);
        console.log(`   Distribution: Easy (1): ${distribution[1]}, Medium (2): ${distribution[2]}, Hard (3): ${distribution[3]}`);

    } catch (error) {
        console.error('Error processing Excel file:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

updateExcelDatabase();
