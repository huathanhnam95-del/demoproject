/**
 * Shared entrance test definition — single source of truth.
 *
 * Cloud Functions deploy from `functions/`, so keep the canonical module there.
 * The local dev server (src/) re-exports it from this wrapper.
 */
module.exports = require('../../functions/src/entrance-test/test36plus');

