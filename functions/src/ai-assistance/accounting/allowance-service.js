'use strict';
const { centsToNano, reject } = require('./money-pricing');

// Preserve the established admin configuration and precedence. Names are
// historical: these records configure the single shared staff allowance.
function createAllowanceResolver({ db }) {
    if (!db?.collection) throw TypeError('Allowance configuration requires a database.');
    return async (transaction, uid) => {
        const [own, defaults] = await Promise.all([
            transaction.get(db.collection('crmProjectAllowanceConfigs').doc(uid)),
            transaction.get(db.collection('crmProjectAllowanceDefaults').doc('default'))
        ]);
        const configured = snapshot => {
            if (!snapshot?.exists) return null;
            const value = snapshot.data();
            if (value?.currency !== 'USD') reject('INVALID_ALLOWANCE', 'Allowance currency configuration is invalid.', 409);
            return centsToNano(value.monthlyAllowanceCents);
        };
        // Validate both configured records, including a malformed default behind
        // an override, matching the existing resolver's fail-closed behavior.
        const override = configured(own), fallback = configured(defaults);
        const allowanceNano = override ?? fallback ?? centsToNano(500);
        return { allowanceNano, allowanceMicrocredits: allowanceNano };
    };
}
module.exports = { createAllowanceResolver };
