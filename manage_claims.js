const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

/**
 * manage_claims.js
 * 
 * Usage: node manage_claims.js <UID> <ROLE> [true|false]
 * Example: node manage_claims.js ABC123uid admin true
 * Example: node manage_claims.js ABC123uid student true
 */

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
    console.error('Error: serviceAccountKey.json not found in current directory.');
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const uid = process.argv[2];
const role = process.argv[3]; // 'admin' or 'student'
const value = process.argv[4] === 'false' ? false : true;

if (!uid || !role) {
    console.log('Usage: node manage_claims.js <UID> <ROLE> [true|false]');
    console.log('Roles: admin, student');
    process.exit(1);
}

async function setClaims() {
    try {
        console.log(`Setting ${role}=${value} for user: ${uid}...`);

        const user = await admin.auth().getUser(uid);
        const currentClaims = user.customClaims || {};

        const newClaims = { ...currentClaims };
        if (role === 'admin') {
            newClaims.isAdmin = value;
        } else if (role === 'student') {
            newClaims.isStudent = value;
        } else {
            throw new Error('Invalid role. Use "admin" or "student".');
        }

        await admin.auth().setCustomUserClaims(uid, newClaims);
        console.log('Successfully set custom claims:', newClaims);

        // Also update Firestore if role is admin (for consistency with sync rules)
        if (role === 'admin') {
            const db = admin.firestore();
            await db.collection('users').doc(uid).set({ isAdmin: value }, { merge: true });
            console.log('Successfully updated Firestore user document.');
        }

        console.log('\nIMPORTANT: The user must re-sign in (or refresh their token) for changes to take effect.');
        process.exit(0);
    } catch (error) {
        console.error('Error setting claims:', error);
        process.exit(1);
    }
}

setClaims();
