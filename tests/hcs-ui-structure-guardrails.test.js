const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'public', 'hcs-mode.css'), 'utf8');

const deprecatedNestedCardClasses = [
  'hcs-audio-card',
  'hcs-audio-player-card',
  'hcs-question-card',
  'hcs-explanation-card',
];

for (const className of deprecatedNestedCardClasses) {
  assert(
    !indexHtml.includes(className),
    `HCS markup should use section/player class names instead of nested card class "${className}"`
  );
  assert(
    !css.includes(`.${className}`),
    `HCS CSS should not keep nested card selector ".${className}"`
  );
}

assert(
  !/#mode-hcs[\s\S]*backdrop-filter:\s*blur/i.test(css),
  'HCS mode CSS should not use backdrop-filter blur for nested/framed layout surfaces'
);
