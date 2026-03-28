const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { admin, db } = require('../../src/utils/firebase');

const RUNS_DIR = path.join(process.cwd(), 'tmp', 'srs-browser-audit', 'runs');
const CORE_UNLOCKED_MODES = ['type', 'speak', 'extended', 'watch', 'notes', 'pronounce'];

const BASELINE_REVIEW_STATS = Object.freeze({
    totalReviews: 0,
    reviewsToday: 0,
    dailyReviews: 0,
    streak: 0,
    longestStreak: 0,
    lastReviewSession: null,
    lastReviewDate: null,
    xp: 0,
    masteredCount: 0,
    sessionsCompleted: 0,
    totalCorrect: 0
});

const DEFAULT_PASSWORD_LENGTH = 24;

function ensureFirestoreReady() {
    if (!db) {
        throw new Error('Firestore is not initialized. Ensure serviceAccountKey.json is available.');
    }
    if (!admin?.auth) {
        throw new Error('Firebase Admin Auth is not initialized.');
    }
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sanitizeRunId(runId) {
    return String(runId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getManifestPath(runId) {
    return path.join(RUNS_DIR, `${sanitizeRunId(runId)}.json`);
}

function randomAsciiPassword(length = DEFAULT_PASSWORD_LENGTH) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

function buildBaselineUserProfile(email, createdAt = new Date().toISOString(), overrides = {}) {
    const profile = {
        email,
        createdAt,
        lastLoginAt: createdAt,
        totalActiveSeconds: 0,
        totalPoints: 0,
        coins: 100,
        unlockedModes: [...CORE_UNLOCKED_MODES],
        isAdmin: false,
        ...overrides
    };

    return profile;
}

function buildBaselineSummary(createdAt = new Date().toISOString(), overrides = {}) {
    const summary = {
        reviewStats: { ...BASELINE_REVIEW_STATS },
        masteredWords: [],
        updatedAt: createdAt,
        createdAt
    };

    if (overrides.srsSettings && typeof overrides.srsSettings === 'object') {
        summary.srsSettings = { ...overrides.srsSettings };
    }

    return summary;
}

function resolveScenarioKey(scenarioName) {
    const aliases = {
        onboarding_local_persistence: 'onboarding_bootstrap',
        settings_firestore_persistence: 'settings_persistence',
        sm2_good_due_parity: 'sm2_good_due',
        fsrs_good_due_parity: 'fsrs_good_due',
        subday_relearning_labels: 'subday_relearning',
        legacy_summary_compatibility: 'settings_persistence',
        legacy_pending_payload_compatibility: 'pending_recovery',
        rapid_save_reload_race: 'settings_persistence'
    };
    return aliases[scenarioName] || scenarioName;
}

function cardIdForLemma(lemma) {
    return String(lemma || '').replace(/\//g, '_');
}

function makeReviewCard({
    lemma,
    algorithm,
    state = 'reviewing',
    interval = 1,
    nextReviewDate,
    lastReviewDate,
    repetitions = 0,
    stepIndex = 0,
    easeFactor = 2.5,
    fsrs = null,
    originalWord,
    entryType = 'word'
}) {
    const card = {
        lemma,
        originalWord: originalWord || lemma,
        entryType,
        algorithm,
        state,
        interval,
        nextReviewDate,
        lastReviewDate,
        repetitions,
        stepIndex,
        easeFactor
    };

    if (fsrs) {
        card.fsrs = { ...fsrs };
    } else if (algorithm === 'FSRS') {
        card.fsrs = {
            difficulty: 5,
            stability: Math.max(0.1, interval || 0.1),
            retrievability: 1,
            lastReview: lastReviewDate || new Date().toISOString(),
            lapses: 0,
            reps: repetitions
        };
    }

    return card;
}

async function deleteDocumentTree(docRef) {
    const subcollections = await docRef.listCollections();
    for (const collectionRef of subcollections) {
        const snapshot = await collectionRef.get();
        for (const childDoc of snapshot.docs) {
            await deleteDocumentTree(childDoc.ref);
        }
    }

    try {
        await docRef.delete();
    } catch (err) {
        if (String(err?.code || '') !== '5' && !/not.?found/i.test(String(err?.message || ''))) {
            throw err;
        }
    }
}

async function readDocumentData(docRef) {
    const snapshot = await docRef.get();
    return snapshot.exists ? snapshot.data() : null;
}

async function createAuditUser(runId, options = {}) {
    ensureFirestoreReady();

    const safeRunId = sanitizeRunId(runId || new Date().toISOString());
    const email = String(options.email || `srs.audit+${safeRunId}@bel.local`).trim();
    const password = String(options.password || randomAsciiPassword()).trim();
    const createdAt = new Date().toISOString();

    const existing = await admin.auth().getUserByEmail(email).catch((err) => {
        if (err?.code === 'auth/user-not-found') return null;
        throw err;
    });
    if (existing?.uid) {
        await destroyAuditUser(existing.uid).catch(() => {});
    }

    const userRecord = await admin.auth().createUser({
        email,
        password,
        emailVerified: true,
        disabled: false
    });

    const profile = buildBaselineUserProfile(email, createdAt, options.profileOverrides || {});
    const summaryOverrides = { ...(options.summaryOverrides || {}) };
    if (options.algorithm) {
        summaryOverrides.srsSettings = { ...(summaryOverrides.srsSettings || {}), algorithm: options.algorithm };
    }
    await db.doc(`users/${userRecord.uid}`).set(profile, { merge: false });
    await db.doc(`users/${userRecord.uid}/vocabularyBook/data`).set(buildBaselineSummary(createdAt, summaryOverrides), { merge: false });

    return {
        runId: safeRunId,
        uid: userRecord.uid,
        email,
        password,
        createdAt,
        manifestPath: getManifestPath(safeRunId)
    };
}

async function resetAuditUserState(uid, options = {}) {
    ensureFirestoreReady();
    if (!uid) throw new Error('resetAuditUserState requires a uid');

    const createdAt = new Date().toISOString();
    const email = String(options.email || '').trim();
    const profileOverrides = { ...(options.profileOverrides || {}) };
    const summaryOverrides = { ...(options.summaryOverrides || {}) };

    if (options.algorithm) {
        summaryOverrides.srsSettings = { ...(summaryOverrides.srsSettings || {}), algorithm: options.algorithm };
    }

    const profile = buildBaselineUserProfile(email || `${uid}@bel.local`, createdAt, profileOverrides);
    const userRef = db.doc(`users/${uid}`);

    await deleteDocumentTree(userRef);
    await userRef.set(profile, { merge: false });
    await db.doc(`users/${uid}/vocabularyBook/data`).set(buildBaselineSummary(createdAt, summaryOverrides), { merge: false });

    return {
        uid,
        profile,
        summary: buildBaselineSummary(createdAt)
    };
}

async function seedScenario(uid, scenarioName, now = new Date(), options = {}) {
    ensureFirestoreReady();
    if (!uid) throw new Error('seedScenario requires a uid');

    const scenarioKey = resolveScenarioKey(scenarioName);
    const prefix = String(options.prefix || `qa_srs_${scenarioKey}`).trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    const isoNow = new Date(now).toISOString();
    const oneHourAgo = new Date(new Date(now).getTime() - 60 * 60 * 1000).toISOString();
    const oneDayLater = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const oneMinuteAgo = new Date(new Date(now).getTime() - 60 * 1000).toISOString();
    const oneMinuteLater = new Date(new Date(now).getTime() + 60 * 1000).toISOString();
    const masteredLemma = `${prefix}_mastered`;
    const dueLemma = `${prefix}_due`;
    const futureLemma = `${prefix}_future`;

    const scenarioCards = {
        onboarding_bootstrap: [
            makeReviewCard({
                lemma: futureLemma,
                algorithm: 'FSRS',
                nextReviewDate: oneDayLater,
                lastReviewDate: isoNow,
                repetitions: 1,
                fsrs: {
                    difficulty: 5,
                    stability: 2,
                    retrievability: 1,
                    lastReview: isoNow,
                    lapses: 0,
                    reps: 1
                }
            })
        ],
        settings_persistence: [
            makeReviewCard({
                lemma: futureLemma,
                algorithm: 'SM2',
                nextReviewDate: oneDayLater,
                lastReviewDate: isoNow,
                repetitions: 1,
                easeFactor: 2.5
            })
        ],
        sm2_good_due: [
            makeReviewCard({
                lemma: dueLemma,
                algorithm: 'SM2',
                nextReviewDate: oneMinuteAgo,
                lastReviewDate: oneDayAgo(now),
                repetitions: 3,
                easeFactor: 2.3
            })
        ],
        fsrs_good_due: [
            makeReviewCard({
                lemma: dueLemma,
                algorithm: 'FSRS',
                nextReviewDate: oneMinuteAgo,
                lastReviewDate: oneDayAgo(now),
                repetitions: 3,
                fsrs: {
                    difficulty: 5.2,
                    stability: 3.4,
                    retrievability: 0.91,
                    lastReview: oneDayAgo(now),
                    lapses: 0,
                    reps: 3
                }
            })
        ],
        mastered_hidden: [
            makeReviewCard({
                lemma: masteredLemma,
                algorithm: 'SM2',
                state: 'mastered',
                interval: 21,
                nextReviewDate: oneDayLater,
                lastReviewDate: oneDayAgo(now),
                repetitions: 12,
                easeFactor: 2.5
            }),
            makeReviewCard({
                lemma: futureLemma,
                algorithm: 'SM2',
                nextReviewDate: oneDayLater,
                lastReviewDate: isoNow,
                repetitions: 2,
                easeFactor: 2.4
            })
        ],
        switch_sm2_to_fsrs: [
            makeReviewCard({
                lemma: dueLemma,
                algorithm: 'SM2',
                nextReviewDate: oneMinuteAgo,
                lastReviewDate: oneDayAgo(now),
                repetitions: 4,
                easeFactor: 2.1
            })
        ],
        switch_fsrs_to_sm2: [
            makeReviewCard({
                lemma: dueLemma,
                algorithm: 'FSRS',
                nextReviewDate: oneMinuteAgo,
                lastReviewDate: oneDayAgo(now),
                repetitions: 4,
                fsrs: {
                    difficulty: 5.4,
                    stability: 6.2,
                    retrievability: 0.9,
                    lastReview: oneDayAgo(now),
                    lapses: 1,
                    reps: 4
                }
            })
        ],
        subday_relearning: [
            makeReviewCard({
                lemma: dueLemma,
                algorithm: 'SM2',
                state: 'relearning',
                interval: 0,
                stepIndex: 0,
                nextReviewDate: oneMinuteAgo,
                lastReviewDate: oneDayAgo(now),
                repetitions: 7,
                easeFactor: 2.2
            })
        ],
        early_review_only: [
            makeReviewCard({
                lemma: `${prefix}_future_1`,
                algorithm: 'SM2',
                nextReviewDate: oneDayLater,
                lastReviewDate: isoNow,
                repetitions: 1,
                easeFactor: 2.5
            }),
            makeReviewCard({
                lemma: `${prefix}_future_2`,
                algorithm: 'SM2',
                nextReviewDate: new Date(new Date(now).getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
                lastReviewDate: isoNow,
                repetitions: 1,
                easeFactor: 2.5
            }),
            makeReviewCard({
                lemma: `${prefix}_future_3`,
                algorithm: 'SM2',
                nextReviewDate: new Date(new Date(now).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                lastReviewDate: isoNow,
                repetitions: 1,
                easeFactor: 2.5
            }),
            makeReviewCard({
                lemma: `${prefix}_future_4`,
                algorithm: 'SM2',
                nextReviewDate: new Date(new Date(now).getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(),
                lastReviewDate: isoNow,
                repetitions: 1,
                easeFactor: 2.5
            }),
            makeReviewCard({
                lemma: `${prefix}_future_5`,
                algorithm: 'SM2',
                nextReviewDate: new Date(new Date(now).getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
                lastReviewDate: isoNow,
                repetitions: 1,
                easeFactor: 2.5
            })
        ],
        pending_recovery: [
            makeReviewCard({
                lemma: dueLemma,
                algorithm: 'SM2',
                nextReviewDate: oneMinuteAgo,
                lastReviewDate: oneDayAgo(now),
                repetitions: 2,
                easeFactor: 2.3
            })
        ]
    };

    const selectedCards = scenarioCards[scenarioKey];
    if (!selectedCards) {
        throw new Error(`Unknown SRS audit scenario: ${scenarioName}`);
    }

    const batch = db.batch();
    for (const card of selectedCards) {
        const safeId = cardIdForLemma(card.lemma);
        batch.set(db.doc(`users/${uid}/srs_cards/${safeId}`), {
            ...card,
            updatedAt: isoNow
        }, { merge: false });
    }

    const masteredWords = scenarioKey === 'mastered_hidden'
        ? selectedCards
            .filter((card) => card.state === 'mastered')
            .map((card) => ({ lemma: card.lemma, masteredAt: isoNow }))
        : [];

    batch.set(db.doc(`users/${uid}/vocabularyBook/data`), {
        ...buildBaselineSummary(isoNow),
        masteredWords,
        updatedAt: isoNow
    }, { merge: true });

    await batch.commit();
    return selectedCards;
}

function oneDayAgo(now) {
    return new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
}

async function readCard(uid, lemma) {
    ensureFirestoreReady();
    if (!uid || !lemma) return null;
    return readDocumentData(db.doc(`users/${uid}/srs_cards/${cardIdForLemma(lemma)}`));
}

async function readSummary(uid) {
    ensureFirestoreReady();
    if (!uid) return null;
    return readDocumentData(db.doc(`users/${uid}/vocabularyBook/data`));
}

async function writeSummary(uid, summary, options = {}) {
    ensureFirestoreReady();
    if (!uid) throw new Error('writeSummary requires a uid');
    const merge = options.merge !== false;
    await db.doc(`users/${uid}/vocabularyBook/data`).set(summary, { merge });
    return readSummary(uid);
}

async function readUserProfile(uid) {
    ensureFirestoreReady();
    if (!uid) return null;
    return readDocumentData(db.doc(`users/${uid}`));
}

async function waitForPredicate(readFn, predicate, timeoutMs = 20_000, intervalMs = 500) {
    const startedAt = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const value = await readFn();
        if (predicate(value)) return value;
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Timed out waiting for Firestore condition');
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

async function waitForUserAlgorithm(uid, algorithm, timeoutMs = 20_000) {
    return waitForPredicate(
        () => readSummary(uid),
        (summary) => {
            const value = String(summary?.srsSettings?.algorithm || '').trim();
            return value === algorithm;
        },
        timeoutMs
    );
}

async function waitForCard(uid, lemma, predicate, timeoutMs = 20_000) {
    return waitForPredicate(
        () => readCard(uid, lemma),
        (card) => predicate(card),
        timeoutMs
    );
}

async function waitForSummary(uid, predicate, timeoutMs = 20_000) {
    return waitForPredicate(
        () => readSummary(uid),
        (summary) => predicate(summary),
        timeoutMs
    );
}

async function destroyAuditUser(uid) {
    ensureFirestoreReady();
    if (!uid) return { uid: null, deleted: false };

    const userRef = db.doc(`users/${uid}`);
    const auth = admin.auth();

    const fireDelete = deleteDocumentTree(userRef).catch((err) => {
        if (err?.code === '5' || /not.?found/i.test(String(err?.message || ''))) {
            return false;
        }
        throw err;
    });

    const authDelete = auth.deleteUser(uid).catch((err) => {
        if (err?.code === 'auth/user-not-found') return false;
        throw err;
    });

    const [fireResult, authResult] = await Promise.allSettled([fireDelete, authDelete]);
    if (fireResult.status === 'rejected') throw fireResult.reason;
    if (authResult.status === 'rejected') throw authResult.reason;

    return { uid, deleted: true };
}

function getRunsDir() {
    ensureDir(RUNS_DIR);
    return RUNS_DIR;
}

function listOpenManifests() {
    const runsDir = getRunsDir();
    if (!fs.existsSync(runsDir)) return [];

    return fs.readdirSync(runsDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
            const filePath = path.join(runsDir, file);
            try {
                const manifest = readJson(filePath);
                return { filePath, manifest };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .filter(({ manifest }) => manifest && manifest.cleanupCompleted === false);
}

module.exports = {
    BASELINE_REVIEW_STATS,
    CORE_UNLOCKED_MODES,
    buildBaselineSummary,
    buildBaselineUserProfile,
    createAuditUser,
    destroyAuditUser,
    getManifestPath,
    getRunsDir,
    listOpenManifests,
    randomAsciiPassword,
    readCard,
    readJson,
    readSummary,
    readUserProfile,
    resetAuditUserState,
    sanitizeRunId,
    seedScenario,
    waitForCard,
    waitForSummary,
    waitForUserAlgorithm,
    writeJson,
    writeSummary
};
