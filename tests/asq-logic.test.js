const assert = require('assert');
const { scoreAsqTranscript } = require('../functions/src/asqLogic');

function testSingleWordMatch() {
  const result = scoreAsqTranscript('It is the source of the river.', ['source', 'birthplace', 'origin']);
  assert.equal(result.accuracy, 1);
  assert.equal(result.matchedAlias, 'source');
}

function testPhraseMatch() {
  const result = scoreAsqTranscript('I would travel by plane.', ['plane', 'by plane', 'airplane']);
  assert.equal(result.accuracy, 1);
  assert.equal(result.matchedAlias, 'plane');
}

function testWholeWordOnly() {
  const result = scoreAsqTranscript('The origins are interesting.', ['origin']);
  assert.equal(result.accuracy, 0);
}

function testNoMatch() {
  const result = scoreAsqTranscript('I have no idea.', ['source', 'birthplace', 'origin']);
  assert.equal(result.accuracy, 0);
  assert.deepEqual(result.wordErrors, ['source']);
}

testSingleWordMatch();
testPhraseMatch();
testWholeWordOnly();
testNoMatch();

console.log('asq-logic tests passed');

