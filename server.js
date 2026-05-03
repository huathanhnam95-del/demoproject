require('dotenv').config();

function assertLocalFirebaseIsolationEnv() {
  const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const allowProd = String(process.env.ALLOW_PROD_FIREBASE || '').trim() === '1';
  if (isProd || allowProd) return;

  // Only enforce the emulator guard when Firebase Admin is likely to be usable.
  // In many CI/test runs we intentionally do not have a service account key present.
  try {
    const { resolveServiceAccountPath } = require('./src/utils/service-account-path');
    const serviceAccountPath = resolveServiceAccountPath(process.cwd());
    if (!serviceAccountPath) return;
  } catch (_e) {
    // If we can't resolve the helper, be conservative and keep the guard enabled.
  }

  const required = [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
    'STORAGE_EMULATOR_HOST'
  ];

  const missing = required.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length === 0) return;

  // Fail closed to prevent local dev from ever touching production Firebase by accident.
  // Use `ALLOW_PROD_FIREBASE=1` only when you explicitly intend to point at production.
  console.error('');
  console.error('[FATAL] Refusing to start without Firebase emulator env vars.');
  console.error('This is a safety guard to prevent localhost from touching production Firebase.');
  console.error('');
  console.error('Missing:');
  missing.forEach((key) => console.error(`  - ${key}`));
  console.error('');
  console.error('Start with:');
  console.error('  - npm run dev');
  console.error('  - start-emulators.bat');
  console.error('  - backend\\local_server\\start_all_servers.bat');
  console.error('');
  console.error('Or override explicitly:');
  console.error('  - set ALLOW_PROD_FIREBASE=1 && node server.js');
  console.error('');
  process.exit(1);
}

const { createApp, startServer, attachGracefulShutdown } = require('./src/server/app');

if (require.main === module) {
  assertLocalFirebaseIsolationEnv();

  const aiWorker = require('./src/workers/ai-worker');
  const server = startServer({
    app: createApp({ projectRoot: __dirname }),
    projectRoot: __dirname,
    port: process.env.PORT || 8443
  });

  aiWorker.start();
  attachGracefulShutdown(server, {
    beforeClose: () => aiWorker.stop()
  });
}

module.exports = { createApp, startServer, attachGracefulShutdown };
