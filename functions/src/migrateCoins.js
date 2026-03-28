const { onRequest } = require('firebase-functions/v2/https');

const migrateUserCoins = onRequest(
    { cors: true },
    async (req, res) => {
        res.json({
            success: false,
            error: 'retired_migration',
            message: 'Legacy migration is retired because the old purchase model is no longer live.'
        });
    }
);

module.exports = { migrateUserCoins };
