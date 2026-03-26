/* eslint-disable no-console */
const {
  reportConnectedSpeechCoverage
} = require('./connected-speech-index-core');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--index') {
      args.publicIndexPath = argv[index + 1];
      index += 1;
    } else if (arg === '--coverage-dir') {
      args.coverageDir = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await reportConnectedSpeechCoverage(args);
  console.log(`Connected speech coverage written to ${result.coverageDir}.`);
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
  reportConnectedSpeechCoverage
};
