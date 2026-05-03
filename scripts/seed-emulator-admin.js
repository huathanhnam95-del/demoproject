#!/usr/bin/env node
/**
 * seed-emulator-admin.js
 * 
 * Seeds the local Firebase Auth + Firestore emulators with the admin account
 * so that localhost:8443 logins work identically to production.
 *
 * Usage:  node scripts/seed-emulator-admin.js
#!/usr/bin/env node
/**
 * seed-emulator-admin.js
 * 
 * Seeds the local Firebase Auth + Firestore emulators with the admin account
 * so that localhost:8443 logins work identically to production.
 *
 * Usage:  node scripts/seed-emulator-admin.js
 *
 * Prerequisites:
 *   - Firebase emulators running (Auth on 9099, Firestore on 8080)
 *   - start-emulators.bat  OR  backend\local_server\start_all_servers.bat
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FS_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'listening-tasks-3ae34';
const API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';

// Admin credentials — mirrors production
const ADMIN_EMAIL = String(process.env.EMULATOR_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD = String(process.env.EMULATOR_ADMIN_PASSWORD || '').trim();
const ADMIN_DISPLAY = String(process.env.EMULATOR_ADMIN_DISPLAY || 'Admin').trim();

async function main() {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.error('Missing emulator admin credentials.');
        console.error('Set EMULATOR_ADMIN_EMAIL and EMULATOR_ADMIN_PASSWORD in your environment, then rerun.');
        process.exit(1);
    }

    console.log('');
    console.log('=== Seeding Emulator Admin Account ===');
    console.log('');

    // ─── Step 1: Create the user in Auth Emulator via sign-up ─────────
    let uid, idToken;
    try {
        const signUpRes = await fetch(
            `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: ADMIN_EMAIL,
                    password: ADMIN_PASSWORD,
                    displayName: ADMIN_DISPLAY,
                    returnSecureToken: true
                })
            }
        );

        const signUpData = await signUpRes.json();

        if (signUpRes.ok) {
            uid = signUpData.localId;
            idToken = signUpData.idToken;
            console.log(`✓ Auth user CREATED  uid=${uid}`);
        } else if (signUpData?.error?.message === 'EMAIL_EXISTS') {
            const signInRes = await fetch(
                `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: ADMIN_EMAIL,
                        password: ADMIN_PASSWORD,
                        returnSecureToken: true
                    })
                }
            );
            const signInData = await signInRes.json();
            if (!signInRes.ok) throw new Error(`Sign-in failed: ${JSON.stringify(signInData)}`);
            uid = signInData.localId;
            idToken = signInData.idToken;
            console.log(`✓ Auth user ALREADY EXISTS  uid=${uid}`);
        } else {
            throw new Error(`Sign-up failed: ${JSON.stringify(signUpData)}`);
        }
    } catch (err) {
        console.error('✗ Auth step failed:', err.message);
        process.exit(1);
    }

    // ─── Step 2: Mark email as verified ───────────────────────────────
    //     Use accounts:update (setAccountInfo) which emulator accepts via POST
    try {
        const verifyRes = await fetch(
            `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idToken: idToken,
                    emailVerified: true
                })
            }
        );
        if (!verifyRes.ok) {
            const errData = await verifyRes.text();
            throw new Error(`${verifyRes.status}: ${errData}`);
        }
        console.log('✓ Email marked as VERIFIED');
    } catch (err) {
        console.error('✗ Email verification failed:', err.message);
        console.log('  (You may need to verify manually in the Emulator UI at http://localhost:4000)');
    }

    // ─── Step 3: Write /users/{uid} doc with isAdmin: true ────────────
    const userDocUrl =
        `${FS_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;

    // Include ALL fields the client expects during profile creation/read.
    // Without these, the client's setDoc becomes an "update" that violates
    // the Firestore rules allowlist, causing PERMISSION_DENIED cascade.
    const CORE_MODES = ['type', 'speak', 'extended', 'watch', 'notes', 'pronounce'];
    const firestoreDoc = {
        fields: {
            email: { stringValue: ADMIN_EMAIL },
            displayName: { stringValue: ADMIN_DISPLAY },
            isAdmin: { booleanValue: true },
            createdAt: { timestampValue: new Date().toISOString() },
            lastLoginAt: { timestampValue: new Date().toISOString() },
            totalActiveSeconds: { integerValue: '0' },
            totalPoints: { integerValue: '0' },
            unlockedModes: {
                arrayValue: {
                    values: CORE_MODES.map(m => ({ stringValue: m }))
                }
            }
        }
    };

    try {
        const fsRes = await fetch(userDocUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer owner'
            },
            body: JSON.stringify(firestoreDoc)
        });

        if (!fsRes.ok) {
            const errBody = await fsRes.text();
            throw new Error(`Firestore PATCH ${fsRes.status}: ${errBody}`);
        }
        console.log(`✓ Firestore /users/${uid}  →  isAdmin: true`);
    } catch (err) {
        console.error('✗ Firestore step failed:', err.message);
        process.exit(1);
    }

    console.log('');
    console.log('══════════════════════════════════════');
    console.log('  Admin account ready on emulator!');
    console.log(`  Email:    ${ADMIN_EMAIL}`);
    console.log('  Password: (from EMULATOR_ADMIN_PASSWORD)');
    console.log(`  UID:      ${uid}`);
    console.log('  isAdmin:  true');
    console.log('══════════════════════════════════════');
    console.log('');
    console.log('You can now log in at https://localhost:8443');
}

main();
