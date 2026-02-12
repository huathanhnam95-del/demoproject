const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

let db = null;
let bucket = null;
let bucketVerified = false;
let projectId = '';
let initialBucketName = '';
let bucketResolvePromise = null;

function uniqueStrings(items) {
    const out = [];
    const seen = new Set();
    for (const item of items || []) {
        const value = String(item || '').trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}

function getBucketCandidates() {
    const envBucketRaw = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim();
    const envBucketNormalized = envBucketRaw.endsWith('.firebasestorage.app')
        ? envBucketRaw.replace(/\.firebasestorage\.app$/i, '.appspot.com')
        : envBucketRaw;
    const projectBucketAppspot = projectId ? `${projectId}.appspot.com` : '';
    const projectBucketFirebaseStorage = projectId ? `${projectId}.firebasestorage.app` : '';
    const initial = initialBucketName || '';

    return uniqueStrings([
        envBucketRaw,
        envBucketNormalized,
        projectBucketAppspot,
        projectBucketFirebaseStorage,
        initial
    ]);
}

function chooseFallbackBucketByName(names) {
    const list = Array.from(names || []);
    if (list.length === 0) return null;

    // Prefer non-system buckets first; keep system buckets as a final fallback.
    const nonSystem = list.filter((name) => !/^gcf-v2-(sources|uploads)-/i.test(name));
    if (nonSystem.length > 0) return nonSystem[0];
    return list[0];
}

async function getStorageBucket() {
    if (!admin.apps.length) return null;

    if (bucket && bucketVerified && typeof bucket.name === 'string' && bucket.name.length > 0) {
        return bucket;
    }

    if (bucket && typeof bucket.name === 'string' && bucket.name.length > 0) {
        try {
            const [exists] = await bucket.exists();
            if (exists) {
                bucketVerified = true;
                return bucket;
            }
            bucket = null;
            bucketVerified = false;
        } catch (e) {
            console.warn(`[WARN] Firebase bucket check failed for current bucket ${bucket.name}:`, e?.message || e);
            bucket = null;
            bucketVerified = false;
        }
    }

    if (bucketResolvePromise) {
        return bucketResolvePromise;
    }

    bucketResolvePromise = (async () => {
        const candidates = getBucketCandidates();

        for (const name of candidates) {
            try {
                const candidate = admin.storage().bucket(name);
                const [exists] = await candidate.exists();
                if (exists) {
                    if (!bucket || bucket.name !== name) {
                        console.warn(`[SECURE] Firebase Storage bucket resolved: ${name}`);
                    }
                    bucket = candidate;
                    bucketVerified = true;
                    return bucket;
                }
            } catch (e) {
                console.warn(`[WARN] Firebase bucket check failed for ${name}:`, e?.message || e);
            }
        }

        try {
            const storage = new Storage({
                keyFilename: path.join(process.cwd(), 'serviceAccountKey.json'),
                projectId: projectId || undefined
            });
            const [buckets] = await storage.getBuckets();
            const names = buckets.map((b) => b?.name).filter(Boolean);
            const fallbackName = chooseFallbackBucketByName(names);
            if (fallbackName) {
                bucket = admin.storage().bucket(fallbackName);
                console.warn(`[WARN] Falling back to available GCS bucket: ${fallbackName}`);
                bucketVerified = true;
                return bucket;
            }
        } catch (e) {
            console.warn('[WARN] Failed to list fallback GCS buckets:', e?.message || e);
        }

        bucket = null;
        bucketVerified = false;
        return null;
    })()
        .catch((e) => {
            console.warn('[WARN] Firebase bucket resolution failed:', e?.message || e);
            bucket = null;
            bucketVerified = false;
            return null;
        })
        .finally(() => {
            bucketResolvePromise = null;
        });

    return bucketResolvePromise;
}

try {
    const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        projectId = String(serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID || '').trim();
        const storageBucketEnv = process.env.FIREBASE_STORAGE_BUCKET || '';
        const storageBucketNormalized = storageBucketEnv.endsWith('.firebasestorage.app')
            ? storageBucketEnv.replace(/\.firebasestorage\.app$/i, '.appspot.com')
            : storageBucketEnv;
        const defaultBucket = projectId ? `${projectId}.appspot.com` : undefined;
        const storageBucket = storageBucketNormalized || defaultBucket;
        initialBucketName = String(storageBucket || '').trim();

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: storageBucket || undefined
        });
        db = admin.firestore();
        try {
            bucket = admin.storage().bucket(storageBucket || undefined);
            bucketVerified = false;
        } catch (e) {
            console.warn('[WARN] Firebase Storage bucket init failed:', e?.message || e);
            bucket = null;
            bucketVerified = false;
        }
        console.warn('[SECURE] Firebase Admin initialized.');
    } else {
        console.warn('[WARN] serviceAccountKey.json not found.');
    }
} catch (e) {
    console.warn('[WARN] Firebase Admin initialization failed:', e.message);
}

module.exports = { admin, db, bucket, getStorageBucket };
