require('dotenv').config();
const { db } = require('./src/utils/firebase');
async function run() {
    const firestore = db;
    const collections = await firestore.listCollections();
    for (const col of collections) {
        console.log('Collection:', col.id);
        const snap = await col.limit(1).get();
        if (!snap.empty) {
            console.log('  -> sample keys:', Object.keys(snap.docs[0].data()));
        }
    }
}
run();
