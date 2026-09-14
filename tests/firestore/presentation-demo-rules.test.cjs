const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Firestore keeps presentation-demo collections server-only', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  for (const collection of ['crmPresentationPresenterLocks', 'crmPresentationRoomCodes', 'crmPresentationRooms', 'crmPresentationOperations', 'crmPresentationArchives', 'crmPresentationEvents']) {
    assert.match(rules, new RegExp(`match /${collection}/`));
    const section = rules.slice(rules.indexOf(`match /${collection}/`), rules.indexOf(`match /${collection}/`) + 220);
    assert.match(section, /allow read, write: if false/);
  }
});
