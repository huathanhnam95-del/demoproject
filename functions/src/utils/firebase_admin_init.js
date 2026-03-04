const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

module.exports = {
    db: getFirestore(),
    getAuth
};
