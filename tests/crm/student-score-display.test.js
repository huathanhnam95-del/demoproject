const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadHelper() {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'public/js/crm/students.js'),
    'utf8'
  );
  const sandbox = {
    window: {}
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  const helper = sandbox.window.CrmStudents;
  assert(helper, 'CrmStudents helper was not initialized.');
  return helper;
}

function createInput() {
  return {
    value: '',
    placeholder: '',
    dataset: {}
  };
}

const helper = loadHelper();
assert.strictEqual(typeof helper.syncScoreDecorations, 'function', 'CrmStudents should expose score decoration sync.');

const elements = {
  inputStudentName: { value: '' },
  inputStudentLabel: { value: '' },
  inputStudentPhone: { value: '' },
  inputStudentEmail: { value: '' },
  inputStudentZalo: { value: '' },
  inputStudentFacebook: { value: '' },
  inputStudentAcquisitionSource: { value: '' },
  inputScoreOverall: createInput(),
  inputScoreListening: createInput(),
  inputScoreReading: createInput(),
  inputScoreSpeaking: createInput(),
  inputScoreWriting: createInput(),
  inputStudentDueDate: { value: '' },
  inputStudentLevel: { value: '' }
};

helper.applyToForm(elements, {
  learningProfile: {
    overall: null,
    listening: 60,
    reading: 60,
    speaking: 100,
    writing: 7
  }
});

assert.strictEqual(elements.inputScoreOverall.value, '', 'Missing overall score should keep the field empty.');
assert.strictEqual(elements.inputScoreOverall.placeholder, 'N/A', 'Missing overall score should show an explicit N/A placeholder.');
assert.strictEqual(elements.inputScoreOverall.dataset.scoreState, 'empty', 'Missing overall score should mark the pill as empty.');
assert.strictEqual(elements.inputScoreListening.dataset.scoreDigits, '2', 'Two-digit scores should be tagged for compact styling.');
assert.strictEqual(elements.inputScoreSpeaking.dataset.scoreDigits, '3', 'Three-digit scores should be tagged for compact styling.');
assert.strictEqual(elements.inputScoreWriting.dataset.scoreDigits, '1', 'Single-digit scores should keep the default styling.');

console.log('student score display passed');
