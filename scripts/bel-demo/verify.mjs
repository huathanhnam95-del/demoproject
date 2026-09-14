import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = ['session', 'world', 'presentation','activities'].map(name => fileURLToPath(new URL(`../../tests/bel-demo/${name}.test.mjs`, import.meta.url)));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
