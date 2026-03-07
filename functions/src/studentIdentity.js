const { db, getAuth } = require('./utils/firebase_admin_init');
const { FieldValue } = require('firebase-admin/firestore');

/**
 * Generates a unique 6-character alphanumeric class code.
 * @returns {Promise<string>}
 */
const generateClassCode = async () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous characters
    let code = '';
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 10) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        // Check for collision
        const snap = await db.collection('crmStudents')
            .where('class_code', '==', code)
            .limit(1)
            .get();

        exists = !snap.empty;
        attempts++;
    }

    if (exists) throw new Error("Failed to generate a unique class code.");
    return code;
};

/**
 * Updates user's custom claims by merging new claims with existing ones.
 * @param {string} uid 
 * @param {object} newClaims 
 */
const mergeCustomClaims = async (uid, newClaims) => {
    const auth = getAuth();
    const user = await auth.getUser(uid);
    const existingClaims = user.customClaims || {};
    await auth.setCustomUserClaims(uid, { ...existingClaims, ...newClaims });
};

/**
 * Claims a profile using a class code.
 * @param {string} uid 
 * @param {string} classCode 
 */
const claimProfile = async (uid, classCode) => {
    if (!uid || !classCode) throw new Error('Missing UID or Class Code');

    const normalizedCode = classCode.toUpperCase().trim();

    // 1. Find the student with the matching class_code
    const snap = await db.collection('crmStudents')
        .where('class_code', '==', normalizedCode)
        .limit(1)
        .get();

    if (snap.empty) {
        throw new Error('Invalid or expired Class Code.');
    }

    const studentDoc = snap.docs[0];
    const studentData = studentDoc.data();

    // 3. Update the document atomicity: append UID, clear code
    await studentDoc.ref.update({
        linked_user_ids: FieldValue.arrayUnion(uid),
        class_code: null, // Clear the code after use
        updatedAt: new Date().toISOString()
    });

    // 4. Update Custom Claims (Merging)
    await mergeCustomClaims(uid, { isStudent: true });

    return { success: true, studentId: studentDoc.id };
};

/**
 * Looks up a user by email for the "Safety Handshake".
 * @param {string} email 
 */
const lookupUserByEmail = async (email) => {
    try {
        const userRecord = await getAuth().getUserByEmail(email);
        return {
            uid: userRecord.uid,
            email: userRecord.email,
            displayName: userRecord.displayName || 'No Name',
            photoURL: userRecord.photoURL || null
        };
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            throw new Error('User not found in Authentication system.');
        }
        throw e;
    }
};

/**
 * Forcibly links a user to a student profile.
 * @param {string} studentId 
 * @param {string} targetUid 
 */
const forceLinkProfile = async (studentId, targetUid) => {
    const studentRef = db.collection('crmStudents').doc(studentId);
    const snap = await studentRef.get();

    if (!snap.exists) {
        throw new Error('Student record not found.');
    }

    // 3. Prevent multiple student profiles for the same user (unless explicit multi-link is desired)
    // For now, let's allow it as a student might be in multiple cohorts, 
    // but typically we'd check if they are already in THIS one.

    // 4. Update the document atomicity
    await studentRef.update({
        linked_user_ids: FieldValue.arrayUnion(targetUid),
        updatedAt: new Date().toISOString()
    });

    // Update Custom Claims (Merging)
    await mergeCustomClaims(targetUid, { isStudent: true });

    return { success: true };
};

module.exports = {
    generateClassCode,
    claimProfile,
    lookupUserByEmail,
    forceLinkProfile,
    mergeCustomClaims
};
