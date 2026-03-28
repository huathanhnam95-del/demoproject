import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('difficulty_filter remains wired through the frontend skill tree contract', () => {
  const levelSystem = read('public/js/modules/level-system.js');
  const catalog = read('public/js/skill-catalog.js');

  assert.match(levelSystem, /difficulty_filter/);
  assert.match(levelSystem, /difficultyFilter/);
  assert.match(catalog, /difficulty_filter/);
  assert.match(catalog, /title:\s*'Difficulty Filter'/);
});
