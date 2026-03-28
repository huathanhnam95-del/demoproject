/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const {
  buildRfibDatasetFromWorkbook
} = require('./rfib-content-core');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_WORKBOOK_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'RFIB', 'RFIB Final ver.xlsx');
const DEFAULT_AUDIO_DIR = path.join(PROJECT_ROOT, 'public', 'database', 'RFIB', 'audio');
const DEFAULT_OUTPUT_INDEX_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'rfib', 'index.json');
const DEFAULT_OUTPUT_REVIEW_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'rfib', 'review-metadata.json');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function printValidationSummary(validation) {
  const structuralErrors = Array.isArray(validation?.structuralErrors) ? validation.structuralErrors : [];
  const contentWarnings = Array.isArray(validation?.contentWarnings) ? validation.contentWarnings : [];

  console.log('RFIB validation summary:');
  console.log(`  Structural errors: ${structuralErrors.length}`);
  console.log(`  Content warnings:  ${contentWarnings.length}`);

  if (structuralErrors.length > 0) {
    console.log('  Structural details:');
    structuralErrors.forEach((issue) => {
      console.log(`    - ${issue.id} ${issue.title}: ${issue.message}`);
    });
  }

  if (contentWarnings.length > 0) {
    const preview = contentWarnings.slice(0, 10);
    console.log('  Warning details (first 10):');
    preview.forEach((issue) => {
      console.log(`    - ${issue.id} ${issue.title}: ${issue.message}`);
    });
    if (contentWarnings.length > preview.length) {
      console.log(`    ... ${contentWarnings.length - preview.length} more warnings`);
    }
  }
}

function parseArgs(argv) {
  const args = {
    workbookPath: DEFAULT_WORKBOOK_PATH,
    audioDir: DEFAULT_AUDIO_DIR,
    outputIndexPath: DEFAULT_OUTPUT_INDEX_PATH,
    outputReviewPath: DEFAULT_OUTPUT_REVIEW_PATH
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workbook') {
      args.workbookPath = argv[index + 1];
      index += 1;
    } else if (arg === '--audio-dir') {
      args.audioDir = argv[index + 1];
      index += 1;
    } else if (arg === '--output-index') {
      args.outputIndexPath = argv[index + 1];
      index += 1;
    } else if (arg === '--output-review') {
      args.outputReviewPath = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await buildRfibDatasetFromWorkbook(args.workbookPath, args.audioDir);
  printValidationSummary(result.validation);

  if (result.validation?.hasStructuralErrors) {
    console.error('RFIB dataset build blocked because structural validation failed.');
    process.exit(1);
  }

  const clientItems = result.items.map(({ paragraphs, ...item }) => item);

  writeJson(args.outputIndexPath, {
    version: 1,
    totalItems: clientItems.length,
    items: clientItems
  });
  writeJson(args.outputReviewPath, {
    version: 1,
    totalItems: result.items.length,
    items: result.reviewMetadata
  });

  console.log(`RFIB dataset written to ${args.outputIndexPath}`);
  console.log(`RFIB review metadata written to ${args.outputReviewPath}`);
  console.log(`RFIB items: ${result.stats.totalItems}, audio manifests: ${result.stats.audioQuestions}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main
};
