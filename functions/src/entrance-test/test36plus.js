/**
 * Shared entrance test definition — single source of truth.
 * 
 * Both the local dev server (src/) and Cloud Functions (functions/src/)
 * should import from this file. Cloud Functions re-exports via:
 *   functions/src/entrance-test/test36plus.js
 */
module.exports = require('../../../src/entrance-test/test36plus');
