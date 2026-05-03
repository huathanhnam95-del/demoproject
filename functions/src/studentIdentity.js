const { db, getAuth } = require('./utils/firebase_admin_init');
const { FieldValue } = require('firebase-admin/firestore');
const { enqueuePracticeAccessJob } = require('./crm/practice-access-service');

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

    // Sync practice access/claims based on CRM entitlement rules.
    await enqueuePracticeAccessJob(db, 'reconcileUid', uid, { runAfterAt: new Date() });

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

    await enqueuePracticeAccessJob(db, 'reconcileUid', targetUid, { runAfterAt: new Date() });

    return { success: true };
};

/**
 * Automatically enrolls a matching Firebase Auth user by email.
 * Grants the isStudent claim and links the UID to the crmStudent record.
 * @param {string} email 
 * @param {string} studentId
 */
const autoEnrollByEmail = async (email, studentId) => {
    if (!email || !studentId) return { success: false, reason: 'Missing email or studentId' };

    try {
        const user = await getAuth().getUserByEmail(email);
        if (user && user.uid) {
            await forceLinkProfile(studentId, user.uid);
            return { success: true, uid: user.uid };
        }
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            return { success: false, reason: 'User not found in Auth system yet.' };
        }
        console.error('[autoEnrollByEmail] Error:', e);
        return { success: false, reason: e.message };
    }
    return { success: false, reason: 'Unknown error' };
};

/**
 * Cloud Function Trigger: Runs when a new Firebase Auth user is created.
 * Automatically checks if their email matches a crmStudent and enrolls them.
 */
const functions = require('firebase-functions');

const onUserSignUp = functions.auth.user().onCreate(async (user) => {
    if (!user || !user.email) return;

    try {
        const email = user.email.toLowerCase().trim();

        // Find if this email exists in crmStudents
        const snap = await db.collection('crmStudents')
            .where('email', '==', email)
            .limit(1)
            .get();

        if (!snap.empty) {
            const studentId = snap.docs[0].id;
            console.log(`[onUserSignUp] Found matching CRM Student (${studentId}) for new UID: ${user.uid}`);

            // Note: We use the admin SDK methods directly here instead of autoEnrollByEmail 
            // because we already have the UID from the event.
            await forceLinkProfile(studentId, user.uid);
            console.log(`[onUserSignUp] Successfully auto-enrolled ${email}`);
        }
    } catch (e) {
        console.error('[onUserSignUp] Failed to auto-enroll new user:', e);
    }
});

module.exports = {
    generateClassCode,
    claimProfile,
    lookupUserByEmail,
    forceLinkProfile,
    mergeCustomClaims,
    autoEnrollByEmail,
    onUserSignUp
};
