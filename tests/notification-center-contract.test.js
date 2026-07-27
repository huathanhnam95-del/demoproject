const assert = require('node:assert/strict');
const fs = require('node:fs');

const header = fs.readFileSync('public/js/site-header.js', 'utf8');
const center = fs.readFileSync('public/js/notification-center.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

assert.match(header, /notification-center-toggle/);
assert.match(header, /notification-center-panel/);
assert.match(center, /user_notifications/);
assert.match(center, /isRead/);
assert.match(header, /Mark all read/);
assert.match(rules, /match \/user_notifications\/{notificationId}/);
assert.match(center, /replaceChildren/);
assert.match(center, /pagehide/);
console.log('notification center contract passed');
