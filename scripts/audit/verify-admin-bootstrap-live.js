#!/usr/bin/env node
/**
 * Live smoke check for the admin bootstrap security fix.
 *
 * Uses the Admin SDK (service account) to mint ID tokens and hit the
 * production /api/admin/status endpoint, proving:
 *
 *   1. The owner UID (already bootstrapped, email_verified) → isAdmin: true
 *   2. A throwaway UID with email_verified=false → rejected (403)
 *
 * Never prints tokens or key material.
 *
 * Usage:  node scripts/audit/verify-admin-bootstrap-live.js
 */
/* eslint-disable no-console */
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const FIREBASE_API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';
const BASE = process.env.PRONOUNCE_VERIFY_BASE || 'https://betterenglishlearning.com';

try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ connect: { timeout: 45000 } }));
} catch { /* undici not available */ }

const serviceAccountPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
  });
}

async function exchangeCustomTokenForIdToken(customToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.idToken;
}

async function callAdminStatus(idToken) {
  const res = await fetch(`${BASE}/api/admin/status`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
      'User-Agent': 'verify-admin-bootstrap-live/1.0',
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

(async () => {
  console.log('--- Admin bootstrap live smoke check ---');
  console.log(`Target: ${BASE}`);

  // ── Positive case: owner UID ──────────────────────────────────────
  console.log('\n[1] Positive: owner UID with verified email...');
  const ownerEmail = 'huathanhnam95@gmail.com';
  const ownerRecord = await admin.auth().getUserByEmail(ownerEmail);
  assert.ok(ownerRecord.uid, 'owner UID should exist');
  assert.ok(ownerRecord.emailVerified, 'owner email should be verified');
  console.log(`    uid: ${ownerRecord.uid.slice(0, 8)}…  emailVerified: ${ownerRecord.emailVerified}`);

  const ownerCustomToken = await admin.auth().createCustomToken(ownerRecord.uid);
  const ownerIdToken = await exchangeCustomTokenForIdToken(ownerCustomToken);
  console.log('    ID token minted (not printed)');

  const positiveResult = await callAdminStatus(ownerIdToken);
  console.log(`    /api/admin/status → ${positiveResult.status}`);
  assert.strictEqual(positiveResult.status, 200,
    `owner should get 200, got ${positiveResult.status}`);
  assert.strictEqual(positiveResult.body?.isAdmin, true,
    'owner should have isAdmin: true');
  console.log('    PASS: owner is admin');

  // ── Negative case: throwaway UID, email_verified=false ────────────
  console.log('\n[2] Negative: throwaway UID, unverified email...');
  const throwawayUid = `smoke-test-${crypto.randomBytes(4).toString('hex')}`;
  let throwawayCreated = false;
  try {
    await admin.auth().createUser({
      uid: throwawayUid,
      email: `${throwawayUid}@test-smoke.invalid`,
      emailVerified: false,
    });
    throwawayCreated = true;
    console.log(`    created throwaway user ${throwawayUid}`);

    const throwawayCustomToken = await admin.auth().createCustomToken(throwawayUid);
    const throwawayIdToken = await exchangeCustomTokenForIdToken(throwawayCustomToken);
    console.log('    ID token minted (not printed)');

    const negativeResult = await callAdminStatus(throwawayIdToken);
    console.log(`    /api/admin/status → ${negativeResult.status}`);
    assert.strictEqual(negativeResult.status, 403,
      `throwaway should get 403, got ${negativeResult.status}`);
    console.log('    PASS: non-admin rejected');
  } finally {
    if (throwawayCreated) {
      await admin.auth().deleteUser(throwawayUid);
      console.log(`    cleaned up throwaway user ${throwawayUid}`);
    }
  }

  console.log('\n--- Admin bootstrap live smoke check PASSED ---');
})().catch((err) => {
  console.error('\n--- Admin bootstrap live smoke check FAILED ---');
  console.error(err.message || err);
  process.exit(1);
});
