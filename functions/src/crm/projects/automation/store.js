'use strict';
const crypto = require('crypto');
const { DomainError, id, canonicalize } = require('../domain/validation');
const COLLECTIONS = Object.freeze({ dueIndex: 'crmProjectDueIndex', dueRebuilds: 'crmProjectDueRebuilds', rules: 'crmProjectAutomationRules', versions: 'crmProjectAutomationVersions', registries: 'crmProjectAutomationRegistries', previews: 'crmProjectAutomationPreviews', runs: 'crmProjectAutomationRuns', journals: 'crmProjectAutomationJournals', occurrences: 'crmProjectDueOccurrences', notifications: 'crmProjectNotifications', preferences: 'crmProjectNotificationPreferences', deliveries: 'crmProjectNotificationDeliveries', workers: 'crmProjectAutomationWorkers' });
function hash(...parts) { return crypto.createHash('sha256').update(JSON.stringify(canonicalize(parts))).digest('hex'); }
function ref(db, kind, key) { return db.collection(COLLECTIONS[kind]).doc(id(key)); }
function data(snapshot) { return snapshot?.exists ? snapshot.data() : null; }
function iso(now) { return new Date(typeof now === 'function' ? now() : now || Date.now()).toISOString(); }
function fail(code, message, status = 400) { throw new DomainError(status, code, message); }
function strict(value, fields) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) fail('INVALID_AUTOMATION_INPUT', 'Unsupported fields or invalid object.'); return value; }
function pageSize(value, max = 50) { const n = value === undefined ? 25 : Number(value); if (!Number.isInteger(n) || n < 1 || n > max) fail('INVALID_PAGE_SIZE', 'Invalid page size.'); return n; }
function cursor(value, scope) { if (!value) return null; try { const result = JSON.parse(Buffer.from(value, 'base64url').toString()); if (result.scope !== hash(scope) || typeof result.id !== 'string') throw new Error(); return id(result.id); } catch (_) { fail('INVALID_CURSOR', 'Cursor belongs to another feed or is invalid.'); } }
function encodeCursor(lastId, scope) { return Buffer.from(JSON.stringify({ id: lastId, scope: hash(scope) })).toString('base64url'); }
module.exports = { COLLECTIONS, hash, ref, data, iso, fail, strict, pageSize, cursor, encodeCursor };
