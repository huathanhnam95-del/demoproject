const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../../database.rules.json');

test('Realtime Database presentation rooms are server-only', () => {
  assert.equal(rules.rules['.read'], false);
  assert.equal(rules.rules['.write'], false);
  assert.equal(rules.rules.presentationRooms['$roomId']['.read'], false);
  assert.equal(rules.rules.presentationRooms['$roomId']['.write'], false);
});
