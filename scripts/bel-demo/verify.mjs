import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const suiteNames = [
  'session',
  'world',
  'presentation',
  'activities',
  'art-contract',
  'content-lock',
  'behavior-lock',
  'state-parity',
  'disclosure',
  'coordinates3d',
  'view-adapter',
  'acceptance-cases'
];

const files = suiteNames.map(name => fileURLToPath(new URL(`../../tests/bel-demo/${name}.test.mjs`, import.meta.url)));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

