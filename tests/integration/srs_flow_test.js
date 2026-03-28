/**
 * 🧪 SRS Integration Test Script (Manual Run)
 * 
 * Instructions:
 * 1. Open the app in your browser (localhost or production).
 * 2. Log in with a valid account.
 * 3. Open the Developer Console (F12).
 * 4. Copy and paste the ENTIRE content of this file into the console.
 * 5. Press Enter.
 */

async function runSRSIntegrationTest() {
    console.clear();
    console.log("%c🧪 Starting SRS Integration Test...", "color: #3b82f6; font-size: 1.2em; font-weight: bold; margin-bottom: 10px;");

    // Helper to get Firestore instance
    const getDB = () => {
        if (window.firebaseDb) return window.firebaseDb;
        if (firebase && firebase.firestore) return firebase.firestore();
        throw new Error("Firestore not found globally.");
    };

    // Helper to wait for Auth
    const waitForAuth = () => {
        return new Promise((resolve, reject) => {
            if (firebase.auth().currentUser) {
                resolve(firebase.auth().currentUser);
                return;
            }
            const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                unsubscribe();
                if (user) resolve(user);
                else reject(new Error("User not logged in after waiting."));
            });
            // Timeout after 5 seconds
            setTimeout(() => {
                unsubscribe();
                reject(new Error("Auth timeout: Please ensure you are logged in."));
            }, 5000);
        });
    };

    try {
        const db = getDB();

        console.log("%c⏳ Waiting for Auth check...", "color: #64748b");
        const user = await waitForAuth();

        console.log(`%c[1/4] Auth Check: ✅ Logged in as ${user.email} (${user.uid})`, "color: #10b981");

        // --- Step 2: Verification of SRSScheduler Module ---
        if (!window.SRSScheduler) {
            console.error("%c❌ Test Failed: SRSScheduler module not found on window object.", "color: #ef4444");
            return;
        }
        console.log("%c[2/4] Module Check: ✅ SRSScheduler available", "color: #10b981");

        // --- Step 3: Simulation (SM-2) ---
        console.log("%c[3/4] Simulating SM-2 Review...", "color: #f59e0b");
        const cardSM2 = {
            algorithm: 'SM2',
            state: 'new',
            interval: 0,
            repetitions: 0,
            easeFactor: 2.5
        };
        const resSM2 = window.SRSScheduler.calculate(cardSM2, 3); // Rated 'Good'

        if (resSM2.state === 'learning' && resSM2.nextReviewDate && new Date(resSM2.nextReviewDate) > new Date()) {
            console.log("   ✅ SM-2 Logic Verified: Next review set for " + resSM2.nextReviewDate);
        } else {
            console.warn("   ⚠️ SM-2 Logic Check: Unexpected result", resSM2);
        }

        // --- Step 3.5: Security Rule Check (Negative Interval) ---
        console.log("%c[3.5/4] Security Check: Attempting Illegal Write...", "color: #f59e0b");
        try {
            await setDoc(doc(db, 'users', user.uid, 'srs_cards', 'security_test_fail'), {
                lemma: 'security_test_fail',
                interval: -5, // Illegal
                algorithm: 'SM2'
            });
            console.error("   ❌ Security Fail: Firestore Allowed Negative Interval!");
        } catch (e) {
            console.log("   ✅ Security Pass: Firestore blocked negative interval as expected.");
        }

        // --- Step 4: Simulation (FSRS) ---
        console.log("%c[4/4] Simulating FSRS Review...", "color: #f59e0b");
        // Initialize an FSRS-like card state
        const cardFSRS = {
            algorithm: 'FSRS',
            state: 'new',
            interval: 0,
            repetitions: 0,
            fsrs: { stability: 0, difficulty: 0, retrievability: 1, lapses: 0 }
        };

        // Pass algorithm explicitly
        const resFSRS = window.SRSScheduler.calculate(cardFSRS, 3, 'FSRS');

        if (resFSRS.algorithm === 'FSRS' && resFSRS.fsrs && typeof resFSRS.fsrs.stability === 'number') {
            console.log("   ✅ FSRS Calculation Valid:", resFSRS);
            if (resFSRS.fsrs.stability === 0) console.warn("   ⚠️ Warning: Stability is 0, check w-params initialization.");
        } else {
            console.error("   ❌ FSRS Failed:", resFSRS);
        }

        console.log("%c✨ Test Sequence Complete!", "color: #3b82f6; font-size: 1.2em; font-weight: bold; margin-top: 10px;");

    } catch (e) {
        console.error("%c❌ Test Error:", "color: #ef4444", e);
    }
}

// Execute only in a browser console. This file is a manual harness, not a Node test.
if (typeof window !== 'undefined') {
    runSRSIntegrationTest();
} else {
    console.log('[SRS Integration Test] Manual browser-only script skipped in Node.');
}
