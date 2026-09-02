const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const segmenterPath = 'c:/Cursor AI/public/js/crm/books-word-segmenter.js';
const segmenterCode = fs.readFileSync(segmenterPath, 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(segmenterCode, context);
const segmenter = context.window.CrmWordSegmenter;

assert(segmenter, 'CrmWordSegmenter must be defined on window');

const cases = [
    { input: 'The Adult Learner: A Neglected Spec ias', expected: 'The Adult Learner: A Neglected Species' },
    { input: 'The Adult Learner: A Neglected Specias', expected: 'The Adult Learner: A Neglected Species' },
    { input: 'What Isa Theory?', expected: 'What Is a Theory?' },
    { input: '12 Pro pounders and Interpreters', expected: '12 Propounders and Interpreters' },
    { input: '12 Propounders and Interpreters', expected: '12 Propounders and Interpreters' },
    { input: 'The Concept of Me chan is tic and Organ is mic Models of Development', expected: 'The Concept of Mechanistic and Organismic Models of Development' },
    { input: 'Theories Based ona Me chan is tic Model', expected: 'Theories Based on a Mechanistic Model' },
    { input: 'Theories Based on an Organ is mic Model', expected: 'Theories Based on an Organismic Model' },
    { input: 'all kinds training directors, O. U. consultants, community developers to help them understand', expected: 'all kinds — training directors, O. U. consultants, community developers — to help them understand' },
    { input: 'in amore permanent form', expected: 'in a more permanent form' },
    { input: 'in es timable value. HR Dis based in learning theories', expected: 'inestimable value. HRD is based in learning theories' },
    { input: 'proceed from his discussion in toa search into any of the theories', expected: 'proceed from his discussion into a search into any of the theories' }
];

for (const { input, expected } of cases) {
    const actual = segmenter.repairText(input);
    assert.strictEqual(actual, expected, `Failed for input: "${input}". Got: "${actual}", Expected: "${expected}"`);
}

console.log('All 12 word segmenter and punctuation repair tests passed successfully!');
