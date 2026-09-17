/* eslint-disable no-console */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function fetchJson(url) {
  const isHttps = url.startsWith('https:');
  const client = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { rejectUnauthorized: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (_e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('node server.js boots cleanly in an environment with no emulator env vars', async () => {
  // Build a completely clean environment without emulator variables
  const cleanEnv = { ...process.env };
  delete cleanEnv.FIRESTORE_EMULATOR_HOST;
  delete cleanEnv.FIREBASE_AUTH_EMULATOR_HOST;
  delete cleanEnv.FIREBASE_STORAGE_EMULATOR_HOST;
  delete cleanEnv.STORAGE_EMULATOR_HOST;
  delete cleanEnv.ALLOW_PROD_FIREBASE;
  delete cleanEnv.NODE_ENV;
  cleanEnv.PORT = '8444';
  cleanEnv.DISABLE_AUTO_SEED_ADMIN = '1';

  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  try {
    // Wait for server to start listening (up to 10s)
    const started = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start in 10s.\nStdout: ${stdout}\nStderr: ${stderr}`));
      }, 10000);

      const interval = setInterval(async () => {
        try {
          const res = await fetchJson('http://localhost:8444/api/health');
          if (res.status === 200) {
            clearTimeout(timeout);
            clearInterval(interval);
            resolve(res);
          }
        } catch (_e) {
          // Keep waiting
        }
      }, 300);
    });

    assert.equal(started.status, 200);
    assert.equal(started.data.status, 'ok');
    assert.match(
      stdout,
      /\[INFO\] Detected active Firebase emulators on localhost\. Auto-bound emulator environment variables\./,
      'Stdout must include auto-bound message'
    );
  } finally {
    child.kill('SIGTERM');
  }
});

test('npm run dev:server runner boots cleanly', async () => {
  const cleanEnv = { ...process.env };
  delete cleanEnv.FIRESTORE_EMULATOR_HOST;
  delete cleanEnv.FIREBASE_AUTH_EMULATOR_HOST;
  delete cleanEnv.FIREBASE_STORAGE_EMULATOR_HOST;
  delete cleanEnv.STORAGE_EMULATOR_HOST;
  delete cleanEnv.ALLOW_PROD_FIREBASE;
  delete cleanEnv.NODE_ENV;
  cleanEnv.PORT = '8445';
  cleanEnv.DISABLE_AUTO_SEED_ADMIN = '1';

  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'start-dev-server.cjs')], {
    cwd: ROOT,
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  try {
    const started = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start in 10s.\nStdout: ${stdout}\nStderr: ${stderr}`));
      }, 10000);

      const interval = setInterval(async () => {
        try {
          const res = await fetchJson('http://localhost:8445/api/health');
          if (res.status === 200) {
            clearTimeout(timeout);
            clearInterval(interval);
            resolve(res);
          }
        } catch (_e) {
          // Keep waiting
        }
      }, 300);
    });

    assert.equal(started.status, 200);
    assert.equal(started.data.status, 'ok');
    assert.match(
      stdout,
      /\[INFO\] Starting dev server with emulator environment variables:/,
      'Stdout must include start-dev-server header'
    );
  } finally {
    child.kill('SIGTERM');
  }
});
