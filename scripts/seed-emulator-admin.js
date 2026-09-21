#!/usr/bin/env node
/**
 * seed-emulator-admin.js
 *
 * Seeds the local Firebase Auth + Firestore emulators with the admin account
 * so that `https://localhost:8443` logins work reliably.
 *
 * Prereqs:
 *  - Auth emulator running on 9099
 *  - Firestore emulator running on 8080
 *
 * Notes:
 *  - We do NOT inline secrets. By default, the script reads admin credentials
 *    from `.local/browser-test-credentials.md` (gitignored) or env vars.
 *  - The server auth middleware requires `email_verified=true`, so we perform
 *    the email verification flow via emulator OOB codes.
 */

const fs = require('fs');
const path = require('path');

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FS_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'listening-tasks-3ae34';
const API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';

const ADMIN_EMAIL = String(process.env.EMULATOR_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '').trim();
const ADMIN_DISPLAY = String(process.env.EMULATOR_ADMIN_DISPLAY || 'Admin').trim();

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return '***';
  return `${value.slice(0, 2)}***${value.slice(at)}`;
}

function normalizeSecret(value) {
  let v = String(value || '').trim();
  // Strip common markdown wrappers: `pass`, **pass**, "pass"
  v = v.replace(/^`(.+)`$/, '$1');
  v = v.replace(/^\*\*(.+)\*\*$/, '$1');
  v = v.replace(/^\"(.+)\"$/, '$1');
  v = v.replace(/^\'(.+)\'$/, '$1');
  return v.trim();
}

function readAdminPasswordFromLocalCredentials(repoRoot) {
  const candidate = path.join(repoRoot, '.local', 'browser-test-credentials.md');
  if (!fs.existsSync(candidate)) {
    return { email: '', password: '', source: null };
  }

  const text = fs.readFileSync(candidate, 'utf8');

  const emailLine = text
    .split(/\r?\n/g)
    .map(line => line.trim())
    .find(line => /^[-*]?\s*email\s*:/i.test(line));

  let email = '';
  if (emailLine) {
    email = normalizeSecret(emailLine.replace(/^[-*]?\s*email\s*:\s*/i, ''));
  } else {
    const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    email = m ? String(m[0]).trim() : '';
  }

  // Prefer explicit "Password:" line if present.
  const passwordLine = text
    .split(/\r?\n/g)
    .map(line => line.trim())
    .find(line => /^[-*]?\s*password\s*:/i.test(line));

  if (!passwordLine) {
    return { email, password: '', source: candidate };
  }

  const raw = passwordLine.replace(/^[-*]?\s*password\s*:\s*/i, '');
  return { email, password: normalizeSecret(raw), source: candidate };
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_e) {
    data = null;
  }

  return { res, data };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForEmulator({ url, label, timeoutMs = 30000 }) {
  const start = Date.now();
  // Simple 1s poll loop; good enough for local startup.
  while ((Date.now() - start) < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      // Any HTTP response means the emulator is reachable (status may be 404/401).
      if (res && typeof res.status === 'number') return true;
    } catch (_e) {
      // ignore
    }
    await sleep(1000);
  }
  throw new Error(`${label} emulator not reachable at ${url}`);
}

async function getJson(url) {
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json().catch(() => null);
  return { res, data };
}

async function ensureAuthUser({ email, password, displayName }) {
  // Try sign-up; if already exists, sign-in.
  const signUpUrl = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
  const signInUrl = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;

  const signUp = await postJson(signUpUrl, {
    email,
    password,
    displayName,
    returnSecureToken: true
  });

  if (signUp.res.ok && signUp.data?.localId && signUp.data?.idToken) {
    return { uid: signUp.data.localId, idToken: signUp.data.idToken, created: true };
  }

  const message = signUp.data?.error?.message || null;
  if (message && message !== 'EMAIL_EXISTS') {
    throw new Error(`Auth sign-up failed (${message}).`);
  }

  const signIn = await postJson(signInUrl, { email, password, returnSecureToken: true });
  if (!signIn.res.ok) {
    const msg = signIn.data?.error?.message || 'UNKNOWN';
    throw new Error(`Auth sign-in failed (${msg}). Check the password in .local/browser-test-credentials.md.`);
  }

  return { uid: signIn.data.localId, idToken: signIn.data.idToken, created: false };
}

async function lookupEmailVerified(idToken) {
  const url = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`;
  const result = await postJson(url, { idToken });
  if (!result.res.ok) return null;
  const user = Array.isArray(result.data?.users) ? result.data.users[0] : null;
  return user ? Boolean(user.emailVerified) : null;
}

async function verifyEmailIfNeeded({ email, idToken }) {
  const verified = await lookupEmailVerified(idToken);
  if (verified === true) return { verified: true, performed: false };

  // 1) Request verification email (emulator stores an OOB code).
  const sendOobUrl = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`;
  const send = await postJson(sendOobUrl, { requestType: 'VERIFY_EMAIL', idToken });
  if (!send.res.ok) {
    const msg = send.data?.error?.message || 'UNKNOWN';
    throw new Error(`Failed to request verification code (${msg}).`);
  }

  // 2) Fetch the OOB code from the emulator and apply it.
  const oobUrl = `${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/oobCodes`;
  const oobs = await getJson(oobUrl);
  if (!oobs.res.ok || !Array.isArray(oobs.data?.oobCodes)) {
    throw new Error('Failed to read emulator OOB codes.');
  }

  const match = oobs.data.oobCodes.find((c) => {
    return String(c?.email || '').trim().toLowerCase() === String(email || '').trim().toLowerCase()
      && String(c?.requestType || '').trim().toUpperCase() === 'VERIFY_EMAIL'
      && typeof c?.oobCode === 'string'
      && c.oobCode.length > 0;
  });

  if (!match) {
    throw new Error('Verification code not found in emulator OOB codes list.');
  }

  const confirmUrl = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`;
  const confirm = await postJson(confirmUrl, { oobCode: match.oobCode });
  if (!confirm.res.ok) {
    const msg = confirm.data?.error?.message || 'UNKNOWN';
    throw new Error(`Failed to apply verification code (${msg}).`);
  }

  return { verified: true, performed: true };
}

async function signIn(email, password) {
  const signInUrl = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
  const res = await postJson(signInUrl, { email, password, returnSecureToken: true });
  if (!res.res.ok) {
    const msg = res.data?.error?.message || 'UNKNOWN';
    throw new Error(`Auth sign-in failed (${msg}).`);
  }
  return { uid: res.data.localId, idToken: res.data.idToken };
}

async function seedFirestoreAdminProfile({ uid, email, displayName }) {
  const userDocUrl = `${FS_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const CORE_MODES = ['type', 'speak', 'extended', 'watch', 'notes', 'pronounce'];

  const firestoreDoc = {
    fields: {
      email: { stringValue: email },
      displayName: { stringValue: displayName },
      isAdmin: { booleanValue: true },
      englishLevel: { stringValue: 'advanced' },
      createdAt: { timestampValue: new Date().toISOString() },
      lastLoginAt: { timestampValue: new Date().toISOString() },
      totalActiveSeconds: { integerValue: '0' },
      totalPoints: { integerValue: '0' },
      unlockedModes: {
        arrayValue: { values: CORE_MODES.map(m => ({ stringValue: m })) }
      }
    }
  };

  const fsRes = await fetch(userDocUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      // Emulator-only bypass for admin scripts.
      'Authorization': 'Bearer owner'
    },
    body: JSON.stringify(firestoreDoc)
  });

  if (!fsRes.ok) {
    const errBody = await fsRes.text();
    throw new Error(`Firestore PATCH ${fsRes.status}: ${errBody}`);
  }
}

async function seedProjectsWorkforceAccess({ uid }) {
  const workforceDocUrl = `${FS_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/crmWorkforceAccounts/${uid}`;
  const firestoreDoc = {
    fields: {
      uid: { stringValue: uid },
      status: { stringValue: 'active' },
      organizationRole: { stringValue: 'administrator' },
      isOrganizationAdmin: { booleanValue: true },
      moduleGrants: {
        mapValue: {
          fields: {
            projects: { booleanValue: true }
          }
        }
      },
      authSync: {
        mapValue: {
          fields: {
            state: { stringValue: 'succeeded' },
            reconciled: { booleanValue: true }
          }
        }
      },
      revision: { integerValue: '1' }
    }
  };

  const fsRes = await fetch(workforceDocUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer owner'
    },
    body: JSON.stringify(firestoreDoc)
  });

  if (!fsRes.ok) {
    const errBody = await fsRes.text();
    throw new Error(`Projects workforce PATCH ${fsRes.status}: ${errBody}`);
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');

  const localCreds = readAdminPasswordFromLocalCredentials(repoRoot);
  const resolvedEmail = ADMIN_EMAIL || String(localCreds.email || '').trim();
  const ADMIN_PASSWORD = normalizeSecret(process.env.EMULATOR_ADMIN_PASSWORD || localCreds.password || '');

  if (!resolvedEmail) {
    console.error('Missing admin email.');
    console.error('Set ADMIN_EMAIL (or EMULATOR_ADMIN_EMAIL) in .env, or add Email: to .local/browser-test-credentials.md.');
    process.exit(1);
  }

  if (!ADMIN_PASSWORD) {
    console.error('Missing admin password.');
    console.error('Add it to .local/browser-test-credentials.md (preferred) or set EMULATOR_ADMIN_PASSWORD.');
    process.exit(1);
  }

  console.log('');
  console.log('=== Seeding Emulator Admin Account ===');
  console.log(`Email: ${maskEmail(resolvedEmail)}`);
  console.log('');

  const waitMs = Math.max(1000, Number(process.env.BEL_EMULATOR_WAIT_MS || 45000));

  await waitForEmulator({
    label: 'Auth',
    url: `${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/config`,
    timeoutMs: waitMs
  });

  await waitForEmulator({
    label: 'Firestore',
    url: `${FS_EMULATOR}/`,
    timeoutMs: waitMs
  });

  // Step 1: Ensure user exists.
  const authUser = await ensureAuthUser({
    email: resolvedEmail,
    password: ADMIN_PASSWORD,
    displayName: ADMIN_DISPLAY
  });
  console.log(authUser.created ? `OK: Auth user created (uid=${authUser.uid})` : `OK: Auth user exists (uid=${authUser.uid})`);

  // Step 2: Ensure email is verified (required by server auth middleware).
  const verify = await verifyEmailIfNeeded({ email: resolvedEmail, idToken: authUser.idToken });
  console.log(verify.performed ? 'OK: Email verified (emulator OOB code applied)' : 'OK: Email already verified');

  // Refresh idToken so email_verified claim is present.
  const fresh = await signIn(resolvedEmail, ADMIN_PASSWORD);

  const verified = await lookupEmailVerified(fresh.idToken);
  if (verified !== true) {
    throw new Error('Email verification did not stick. Inspect Auth emulator UI (http://localhost:4000).');
  }

  // Step 3: Seed Firestore admin profile so admin UIs can write via rules.
  await seedFirestoreAdminProfile({
    uid: fresh.uid,
    email: resolvedEmail,
    displayName: ADMIN_DISPLAY
  });
  console.log('OK: Firestore user profile seeded (isAdmin: true)');

  // Projects intentionally requires a separate server-owned workforce grant.
  // Seed it alongside the local admin profile so the visible localhost module
  // can read and create projects after an emulator restart.
  await seedProjectsWorkforceAccess({ uid: fresh.uid });
  console.log('OK: Projects workforce access seeded');

  console.log('');
  console.log('Admin account ready on emulator.');
  console.log('You can now log in at https://localhost:8443');
}

main().catch((err) => {
  console.error('ERROR: Seed failed:', err?.message || err);
  process.exit(1);
});
