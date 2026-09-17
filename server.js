require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function probeLocalFirebaseEmulatorsSync(customPorts) {
  let probePorts;
  if (Array.isArray(customPorts)) {
    probePorts = customPorts
      .map((p) => parseInt(String(p).trim(), 10))
      .filter((p) => Number.isInteger(p) && p > 0);
  } else if (typeof customPorts === 'string' || typeof customPorts === 'number') {
    probePorts = String(customPorts)
      .split(',')
      .map((p) => parseInt(p.trim(), 10))
      .filter((p) => Number.isInteger(p) && p > 0);
  } else {
    probePorts = (process.env.BEL_EMULATOR_PROBE_PORTS || '8080,9099')
      .split(',')
      .map((p) => parseInt(p.trim(), 10))
      .filter((p) => Number.isInteger(p) && p > 0);
  }

  if (!probePorts || probePorts.length === 0) {
    return false;
  }

  const probeScript = `
    const net = require('net');
    const ports = ${JSON.stringify(probePorts)};
    const hosts = ['127.0.0.1', '::1'];
    const targets = [];
    for (const port of ports) {
      for (const host of hosts) {
        targets.push({ port, host });
      }
    }
    if (targets.length === 0) {
      process.exit(1);
    }
    let remaining = targets.length;
    let finished = false;

    for (const { port, host } of targets) {
      const socket = net.createConnection({ host, port }, () => {
        if (!finished) {
          finished = true;
          socket.destroy();
          process.exit(0);
        }
      });
      socket.on('error', () => {
        socket.destroy();
        remaining--;
        if (remaining <= 0 && !finished) {
          finished = true;
          process.exit(1);
        }
      });
      socket.setTimeout(400, () => {
        socket.destroy();
        remaining--;
        if (remaining <= 0 && !finished) {
          finished = true;
          process.exit(1);
        }
      });
    }
  `;

  try {
    const result = spawnSync(process.execPath, ['--input-type=commonjs'], {
      input: probeScript,
      timeout: 1000,
      windowsHide: true
    });
    return result.status === 0;
  } catch (_e) {
    return false;
  }
}

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

  if (probeLocalFirebaseEmulatorsSync()) {
    if (!String(process.env.FIRESTORE_EMULATOR_HOST || '').trim()) {
      process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    }
    if (!String(process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim()) {
      process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    }
    if (!String(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '').trim()) {
      process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';
    }
    if (!String(process.env.STORAGE_EMULATOR_HOST || '').trim()) {
      process.env.STORAGE_EMULATOR_HOST = 'http://localhost:9199';
    }
    // eslint-disable-next-line no-console
    console.log('[INFO] Detected active Firebase emulators on localhost. Auto-bound emulator environment variables.');
    return;
  }

  // Fail closed to prevent local dev from ever touching production Firebase by accident.
  // Use `ALLOW_PROD_FIREBASE=1` only when you explicitly intend to point at production.
  console.error('');
  console.error('[FATAL] Refusing to start without Firebase emulator env vars.');
  console.error('This is a safety guard to prevent localhost from touching production Firebase.');
  console.error('');
  console.error('Missing:');
  missing.forEach((key) => console.error(`  - ${key}`));
  console.error('');
  console.error('If Firebase emulators are already running or you wish to start just the dev server:');
  console.error('  - npm run dev:server');
  console.error('');
  console.error('To launch the full emulator suite and dev server:');
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

async function maybeAutoSeedEmulatorAdmin() {
  const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const allowProd = String(process.env.ALLOW_PROD_FIREBASE || '').trim() === '1';
  if (isProd || allowProd) return;

  if (String(process.env.DISABLE_AUTO_SEED_ADMIN || '').trim() === '1') return;

  const hasAuthEmu = !!String(process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim();
  const hasFsEmu = !!String(process.env.FIRESTORE_EMULATOR_HOST || '').trim();
  if (!hasAuthEmu || !hasFsEmu) return;

  const repoRoot = __dirname;
  const credPath = path.join(repoRoot, '.local', 'browser-test-credentials.md');
  const hasCredsFile = fs.existsSync(credPath);
  const hasCredsEnv = !!String(process.env.EMULATOR_ADMIN_PASSWORD || '').trim();
  if (!hasCredsFile && !hasCredsEnv) return;

  await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'seed-emulator-admin.js')],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          // Keep server startup snappy if emulators aren't up yet.
          BEL_EMULATOR_WAIT_MS: String(process.env.BEL_EMULATOR_WAIT_MS || 15000)
        }
      }
    );

    child.on('exit', (code) => {
      if (code && code !== 0) {
        console.warn(`[WARN] Admin emulator seed failed (exit ${code}). Continuing startup.`);
      }
      resolve();
    });

    child.on('error', (err) => {
      console.warn('[WARN] Admin emulator seed error:', err?.message || err);
      resolve();
    });
  });
}

if (require.main === module) {
  assertLocalFirebaseIsolationEnv();

  (async () => {
    await maybeAutoSeedEmulatorAdmin();

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
  })().catch((err) => {
    console.error('[FATAL] Failed to start server:', err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  createApp,
  startServer,
  attachGracefulShutdown,
  assertLocalFirebaseIsolationEnv,
  probeLocalFirebaseEmulatorsSync
};
