#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function getWorkspacePaths() {
  const workspaceRoot = __dirname;
  const workspaceModules = path.join(workspaceRoot, 'node_modules');
  return { workspaceRoot, workspaceModules };
}

function runGenerator(targetScript, scriptArgs = [], options = {}) {
  const { workspaceModules } = getWorkspacePaths();
  const cwd = options.cwd || process.cwd();

  const existingNodePath = (options.env && options.env.NODE_PATH) || process.env.NODE_PATH || '';
  const nodePath = existingNodePath
    ? `${workspaceModules}${path.delimiter}${existingNodePath}`
    : workspaceModules;

  const env = {
    ...(options.env || process.env),
    NODE_PATH: nodePath
  };

  const nodeBinary = options.node || process.execPath;
  const args = targetScript === '-e'
    ? ['-e', ...scriptArgs]
    : [
        path.isAbsolute(targetScript) ? targetScript : path.resolve(cwd, targetScript),
        ...scriptArgs
      ];

  const result = spawnSync(nodeBinary, args, {
    cwd,
    stdio: options.stdio || 'inherit',
    env
  });

  if (result.error) {
    throw result.error;
  }
  return result;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: node run-generator.cjs <targetScript> [args...]');
    process.exit(1);
  }

  const [targetScript, ...scriptArgs] = argv;
  const result = runGenerator(targetScript, scriptArgs);
  process.exit(result.status ?? 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  getWorkspacePaths,
  runGenerator
};