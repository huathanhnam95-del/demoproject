/* eslint-disable no-console */
const {
  buildConnectedSpeechIndex
} = require('./connected-speech-index-core');

function parseArgs(argv) {
  const args = {};
  const requireValue = (flag, index) => {
    if (index + 1 >= argv.length || !argv[index + 1]) {
      throw new Error(`${flag} requires a value.`);
    }
    return argv[index + 1];
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workbook') {
      args.workbookPath = requireValue(arg, index);
      index += 1;
    } else if (arg === '--audio-manifest') {
      args.audioManifestPath = requireValue(arg, index);
      index += 1;
    } else if (arg === '--public-index') {
      args.publicIndexPath = requireValue(arg, index);
      index += 1;
    } else if (arg === '--functions-index') {
      args.functionsIndexPath = requireValue(arg, index);
      index += 1;
    } else if (arg === '--featured-prompts') {
      args.featuredPromptsPath = requireValue(arg, index);
      index += 1;
    } else if (arg === '--coverage-dir') {
      args.coverageDir = requireValue(arg, index);
      index += 1;
    } else if (arg === '--concurrency') {
      args.concurrency = Number(requireValue(arg, index));
      index += 1;
    } else if (arg === '--index-version') {
      args.indexVersion = requireValue(arg, index);
      index += 1;
    } else if (arg === '--timestamp') {
      args.generatedAt = requireValue(arg, index);
      index += 1;
    } else if (arg === '--cache-dir') {
      args.cacheDir = requireValue(arg, index);
      index += 1;
    } else if (arg === '--no-cache') {
      args.noCache = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
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
