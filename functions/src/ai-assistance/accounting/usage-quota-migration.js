'use strict';
const { integer, digest, reject } = require('./money-pricing');
const { AI_ASSISTANCE_COLLECTIONS } = require('../collections');
const MIGRATION_VERSION = 'legacy-nano-origin-month-v1';
const monthRef = (db, uid, month) => db.collection(AI_ASSISTANCE_COLLECTIONS.usageMonths).doc(digest(['usage-month', uid, month]));
function validateMonth(value, uid, month) {
    if (!value || value.uid !== uid || value.month !== month || value.migrationVersion !== MIGRATION_VERSION || !Number.isSafeInteger(value.revision) || value.revision < 0) reject('LEDGER_INTEGRITY', 'Usage month identity or revision is invalid.', 409);
    integer(value.usedMicrocredits); integer(value.reservedMicrocredits); return value;
}
async function prepareQuotaMonth(transaction, db, uid, month, money) {
    const ref = monthRef(db, uid, month), snapshot = await transaction.get(ref);
    if (money.usageQuotaMigrationVersion !== undefined && money.usageQuotaMigrationVersion !== MIGRATION_VERSION
        || snapshot.exists !== (money.usageQuotaMigrationVersion === MIGRATION_VERSION)) reject('LEDGER_INTEGRITY', 'Origin-month migration marker and quota month disagree.', 409);
    if (snapshot.exists) return { ref, value: validateMonth(snapshot.data(), uid, month), imported: false };
    // Source aggregate and destination are read under the same transaction. A
    // reservation link partitions this baseline; it is never another debit.
    const value = { uid, month, migrationVersion: MIGRATION_VERSION, sourceRevision: money.revision,
        sourceDigest: digest(money), importedSettledNano: money.settledNano, importedPendingNano: money.pendingNano,
        usedMicrocredits: integer(money.settledNano).toString(), reservedMicrocredits: integer(money.pendingNano).toString(), revision: 0 };
    return { ref, value, imported: true };
}
function reconcileLegacyMonth(prepared, reservation, chargedMicrocredits) {
    const reserved = integer(prepared.value.reservedMicrocredits) - integer(reservation.maximumNano);
    if (reserved < 0n) reject('LEDGER_INTEGRITY', 'Imported reservation exceeds its origin-month baseline.', 409);
    return { ...prepared.value, reservedMicrocredits: reserved.toString(), usedMicrocredits: (integer(prepared.value.usedMicrocredits) + integer(chargedMicrocredits)).toString(), revision: prepared.value.revision + 1 };
}
module.exports = { MIGRATION_VERSION, monthRef, validateMonth, prepareQuotaMonth, reconcileLegacyMonth };
