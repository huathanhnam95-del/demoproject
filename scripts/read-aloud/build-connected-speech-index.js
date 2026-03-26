/* eslint-disable no-console */
const {
  buildConnectedSpeechIndex
} = require('./connected-speech-index-core');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workbook') {
      args.workbookPath = argv[index + 1];
      index += 1;
    } else if (arg === '--audio-manifest') {
      args.audioManifestPath = argv[index + 1];
      index += 1;
    } else if (arg === '--public-index') {
      args.publicIndexPath = argv[index + 1];
      index += 1;
    } else if (arg === '--functions-index') {
      args.functionsIndexPath = argv[index + 1];
      index += 1;
    } else if (arg === '--coverage-dir') {
      args.coverageDir = argv[index + 1];
      index += 1;
    } else if (arg === '--concurrency') {
      args.concurrency = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--index-version') {
      args.indexVersion = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await buildConnectedSpeechIndex(args);
  console.log(`Connected speech index written to ${result.publicIndexPath} and ${result.functionsIndexPath}.`);
  console.log(`Coverage written to ${result.coverageDir}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  buildConnectedSpeechIndex
};
