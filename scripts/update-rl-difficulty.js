/**
 * Reclassify Note mode (Take Notes / RL) difficulty levels 1..3
 *
 * ═══════════════════════════════════════════════════════════════
 *  ALGORITHM DOCUMENTATION (for future maintainers)
 * ═══════════════════════════════════════════════════════════════
 *
 * Multi-factor scoring approach for note-taking difficulty.
 * Each factor produces a sub-score (0 = easy, 1 = medium, 2 = hard).
 * Factors are combined with a weighted sum into a composite score.
 *
 * ┌──────────────────────────┬────────┬───────────────────────────────┐
 * │ Factor                   │ Weight │ What it measures               │
 * ├──────────────────────────┼────────┼───────────────────────────────┤
 * │ 1. Passage Length        │  ×3    │ Word count (≤150=0, ≤230=1,  │
 * │    (word count)          │        │   >230=2)                     │
 * │ 2. Vocabulary Complexity │  ×2    │ Avg word length + long-word   │
 * │    (avgLen+longWordDens) │        │   density + academic suffix%  │
 * │ 3. Sentence Complexity   │  ×1.5  │ Words/sentence + syllables/   │
 * │    (wps + syl/word)      │        │   word                        │
 * │ 4. Information Density   │  ×1.5  │ Content-word ratio + unique   │
 * │    (content/unique ratio)│        │   content-word ratio           │
 * └──────────────────────────┴────────┴───────────────────────────────┘
 *
 *  Composite = (length×3) + (vocab×2) + (sentence×1.5) + (info×1.5)
 *  Max composite = 6 + 4 + 3 + 3 = 16
 *
 * THRESHOLD METHOD: Percentile-based (two-phase)
 *   Phase 1: Compute composite scores for ALL items
 *   Phase 2: Use p33/p66 percentiles as thresholds
 *     - score ≤ p33 → Level 1 (Easy)
 *     - score ≤ p66 → Level 2 (Medium)
 *     - score >  p66 → Level 3 (Hard)
 *
 * This ensures a naturally balanced distribution (~33/33/33 split)
 * that adapts automatically if the data changes.
 *
 * EXPECTED OUTPUT (540 items as of 2026-03-14):
 *   L1=237 (44%), L2=175 (32%), L3=128 (24%)
 *   (Not exactly 33/33/33 due to tied composite scores at boundaries)
 *
 * Usage:
 *   node scripts/update-rl-difficulty.js             # writes to Excel
 *   node scripts/update-rl-difficulty.js --dry-run    # preview only
 */

const fs = require('fs');
const path = require('path');
const Excel = require('exceljs');

const EXCEL_PATH = path.join(__dirname, '..', 'public', 'database', 'Take Notes', 'RL', 'RL.xlsx');

// ── Stop Words ──────────────────────────────────────────────────
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare',
    'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
    'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
    'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs', 'what',
    'which', 'who', 'whom', 'whose', 'where', 'when', 'how', 'why',
    'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
    'just', 'about', 'also', 'more', 'much', 'some', 'any', 'all',
    'both', 'each', 'few', 'other', 'such', 'only', 'own', 'same',
    'as', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'out', 'off', 'over', 'under', 'again',
    'further', 'once', 'here', 'there', 'up', 'down', 'well', 'ok',
    'okay', 'um', 'uh', 'like', 'know', 'think', 'say', 'said',
    'get', 'got', 'go', 'going', 'went', 'come', 'came', 'make',
    'made', 'take', 'took', 'see', 'saw', 'look', 'thing', 'things',
    'really', 'actually', 'basically', 'right', 'now', 'even', 'still'
]);

// ── Academic suffixes ───────────────────────────────────────────
const ACADEMIC_SUFFIXES = [
    'tion', 'sion', 'ment', 'ness', 'ity', 'ism', 'ance', 'ence',
    'ship', 'ology', 'ical', 'ious', 'eous', 'ible', 'able',
    'ization', 'isation', 'ative', 'itive'
];

// ── Helper Functions ────────────────────────────────────────────

function getTranscriptText(cell) {
    if (!cell) return '';
    if (cell.richText) return cell.richText.map(t => t.text).join('');
    return String(cell).trim();
}

function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 0);
}

function countSentences(text) {
    const matches = text.match(/[.!?]+/g);
    return Math.max(1, matches ? matches.length : 1);
}

function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 2) return 1;
    word = word.replace(/e$/, '');
    const vowelGroups = word.match(/[aeiouy]+/g);
    return Math.max(1, vowelGroups ? vowelGroups.length : 1);
}

function isAcademic(word) {
    const lower = word.toLowerCase();
    return ACADEMIC_SUFFIXES.some(suffix => lower.endsWith(suffix) && lower.length > suffix.length + 2);
}

// ── Compute raw metrics for an item ─────────────────────────────

function computeMetrics(text) {
    const words = tokenize(text);
    const wordCount = words.length;
    if (wordCount < 5) {
        return { wordCount, avgWordLen: 0, longWordPct: 0, academicPct: 0, avgWPS: 0, avgSylPerWord: 0, contentRatio: 0, uniqueContentRatio: 0 };
    }

    const sentences = countSentences(text);
    const avgWordLen = words.reduce((s, w) => s + w.length, 0) / wordCount;
    const longWordPct = words.filter(w => w.length >= 7).length / wordCount;
    const academicPct = words.filter(w => isAcademic(w)).length / wordCount;
    const avgWPS = wordCount / sentences;
    const avgSylPerWord = words.reduce((s, w) => s + countSyllables(w), 0) / wordCount;

    const contentWords = words.filter(w => !STOP_WORDS.has(w) && w.length > 2);
    const contentRatio = contentWords.length / wordCount;
    const uniqueContent = new Set(contentWords);
    const uniqueContentRatio = uniqueContent.size / Math.max(1, contentWords.length);

    return { wordCount, avgWordLen, longWordPct, academicPct, avgWPS, avgSylPerWord, contentRatio, uniqueContentRatio };
}

// ── Compute composite difficulty score ──────────────────────────

function computeComposite(metrics) {
    const { wordCount, avgWordLen, longWordPct, academicPct, avgWPS, avgSylPerWord, contentRatio, uniqueContentRatio } = metrics;

    // Factor 1: Length (0-2)
    let lengthScore;
    if (wordCount <= 150) lengthScore = 0;
    else if (wordCount <= 230) lengthScore = 1;
    else lengthScore = 2;

    // Factor 2: Vocabulary Complexity (0-2)
    const vocabRaw = (avgWordLen - 3.5) * 1.5 + longWordPct * 8 + academicPct * 12;
    let vocabScore;
    if (vocabRaw < 2.0) vocabScore = 0;
    else if (vocabRaw < 3.5) vocabScore = 1;
    else vocabScore = 2;

    // Factor 3: Sentence Complexity (0-2)
    const sentRaw = avgWPS * 0.12 + avgSylPerWord * 1.5;
    let sentScore;
    if (sentRaw < 3.5) sentScore = 0;
    else if (sentRaw < 4.5) sentScore = 1;
    else sentScore = 2;

    // Factor 4: Information Density (0-2)
    const infoRaw = contentRatio * 4 + uniqueContentRatio * 3;
    let infoScore;
    if (infoRaw < 4.0) infoScore = 0;
    else if (infoRaw < 5.0) infoScore = 1;
    else infoScore = 2;

    // Weighted composite: length matters most for note-taking
    const composite = (lengthScore * 3) + (vocabScore * 2) + (sentScore * 1.5) + (infoScore * 1.5);
    return { composite, lengthScore, vocabScore, sentScore, infoScore };
}

// ── Main ────────────────────────────────────────────────────────

async function updateExcelDatabase() {
    const isDryRun = process.argv.includes('--dry-run');

    console.log(`Reading Excel file: ${EXCEL_PATH}`);
    if (isDryRun) console.log('  (DRY RUN — no files will be written)\n');

    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`Error: Excel file not found: ${EXCEL_PATH}`);
        process.exit(1);
    }

    try {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.readFile(EXCEL_PATH);
        const worksheet = workbook.getWorksheet(1);

        // Phase 1: Compute all composite scores to find percentile thresholds
        const allScores = [];
        const itemData = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;

            const transcriptCell = row.getCell(3);
            const text = getTranscriptText(transcriptCell.value);
            const oldLevel = parseInt(row.getCell(4).value, 10) || 0;

            if (text.length > 0) {
                const metrics = computeMetrics(text);
                const scores = computeComposite(metrics);
                allScores.push(scores.composite);
                itemData.push({ row, rowNumber, text, metrics, scores, oldLevel });
            }
        });

        // Sort scores to find percentile-based thresholds for ~33/33/33 split
        const sorted = [...allScores].sort((a, b) => a - b);
        const p33 = sorted[Math.floor(sorted.length * 0.33)];
        const p66 = sorted[Math.floor(sorted.length * 0.66)];

        console.log(`Composite score stats:`);
        console.log(`  min=${sorted[0].toFixed(2)}, p33=${p33.toFixed(2)}, p66=${p66.toFixed(2)}, max=${sorted[sorted.length - 1].toFixed(2)}`);

        // Phase 2: Assign levels using percentile thresholds
        const distribution = { 1: 0, 2: 0, 3: 0 };
        const oldDistribution = { 1: 0, 2: 0, 3: 0 };
        const samples = { 1: [], 2: [], 3: [] };
        let updatedCount = 0;

        // Ensure header
        const headerRow = worksheet.getRow(1);
        headerRow.getCell(4).value = "Difficulty (1-3)";
        headerRow.commit();

        for (const item of itemData) {
            const { row, metrics, scores, oldLevel, text } = item;

            if (oldLevel >= 1 && oldLevel <= 3) oldDistribution[oldLevel]++;

            let level;
            if (scores.composite <= p33) level = 1;
            else if (scores.composite <= p66) level = 2;
            else level = 3;

            row.getCell(4).value = level;
            row.commit();

            distribution[level]++;
            updatedCount++;

            if (samples[level].length < 3) {
                samples[level].push({
                    id: row.getCell(1).value,
                    wordCount: metrics.wordCount,
                    composite: scores.composite.toFixed(1),
                    sub: `L${scores.lengthScore}V${scores.vocabScore}S${scores.sentScore}I${scores.infoScore}`,
                    preview: text.substring(0, 70)
                });
            }
        }

        // Print comparison
        console.log('\nDistribution Comparison:');
        console.log('  Level | Old Count | New Count | Change');
        console.log('  ------|-----------|-----------|-------');
        for (const level of [1, 2, 3]) {
            const old = oldDistribution[level];
            const nw = distribution[level];
            const delta = nw - old;
            const sign = delta > 0 ? '+' : '';
            console.log(`    ${level}   |    ${String(old).padStart(3)}    |    ${String(nw).padStart(3)}    | ${sign}${delta}`);
        }
        console.log(`\n  Total processed: ${updatedCount}`);

        // Print samples
        for (const level of [1, 2, 3]) {
            console.log(`\n  Sample Level ${level}:`);
            for (const s of samples[level]) {
                console.log(`    id=${s.id} words=${s.wordCount} score=${s.composite} [${s.sub}]`);
                console.log(`      "${s.preview}..."`);
            }
        }

        if (!isDryRun) {
            // Backup existing file
            const backupFile = EXCEL_PATH + '.backup.' + Date.now();
            fs.copyFileSync(EXCEL_PATH, backupFile);
            console.log(`\nBackup created: ${backupFile}`);

            await workbook.xlsx.writeFile(EXCEL_PATH);
            console.log(`\n✅ Successfully updated ${EXCEL_PATH}`);
        } else {
            console.log('\n(Dry run complete — no files written)');
        }

    } catch (error) {
        console.error('Error processing Excel file:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

updateExcelDatabase();
