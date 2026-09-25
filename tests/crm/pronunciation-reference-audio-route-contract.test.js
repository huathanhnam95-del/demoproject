/* eslint-disable no-console */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const apiApp = require(path.join(process.cwd(), 'functions/src/apiApp'));
const createReferenceRouter = require(path.join(process.cwd(), 'functions/src/routes/pronunciation-reference-audio'));

async function serve(app, run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

(async () => {
  // The API app must mount the public router it creates; the fixture below checks its behavior.
  const source = fs.readFileSync(process.env.API_APP_SOURCE_PATH || path.join(process.cwd(), 'functions/src/apiApp.js'), 'utf8');
  assert.match(source, /app\.use\('\/api', pronunciationReferenceAudioRouter\)/);
  assert.doesNotMatch(source, /app\.use\('\/api', authMiddleware, pronunciationReferenceAudioRouter\)/);

  // An actual unauthenticated API request reaches the mounted router and its key guard.
  await serve(apiApp, async base => {
    const response = await fetch(`${base}/api/pronunciation-reference-audio/invalid/audio`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'VALIDATION_ERROR');
  });

  // The router must never read or stream generated audio before verification passes.
  const key = 'a'.repeat(40);
  let record = null;
  let reads = 0;
  let downloads = 0;
  const db = { collection: () => ({ doc: () => ({ get: async () => {
    reads += 1;
    return { exists: !!record, data: () => record };
  } }) }) };
  const getStorageBucket = async () => ({ file: () => ({ download: async () => {
    downloads += 1;
    return [Buffer.from('ID3verified')];
  } }) });
  const app = express();
  app.use('/api', createReferenceRouter({
    db, getStorageBucket,
    sendSuccess: (res, data) => res.json({ success: true, data }),
    sendError: (res, status, code, message) => res.status(status).json({ error: code, message })
  }));
  await serve(app, async base => {
    const invalid = await fetch(`${base}/api/pronunciation-reference-audio/invalid/audio`);
    assert.equal(invalid.status, 400);
    assert.equal(reads, 0);

    const missing = await fetch(`${base}/api/pronunciation-reference-audio/${key}/audio`);
    assert.equal(missing.status, 404);
    record = { verificationStatus: 'waiting', generatedAudio: { storagePath: 'asset.mp3' } };
    const unverified = await fetch(`${base}/api/pronunciation-reference-audio/${key}/audio`);
    assert.equal(unverified.status, 404);
    assert.equal(downloads, 0);

    record.verificationStatus = 'passed';
    const verified = await fetch(`${base}/api/pronunciation-reference-audio/${key}/audio`);
    assert.equal(verified.status, 200);
    assert.equal(verified.headers.get('content-type'), 'audio/mpeg');
    assert.equal(Buffer.from(await verified.arrayBuffer()).toString(), 'ID3verified');
    assert.equal(downloads, 1);
  });
  console.log('pronunciation reference audio route contract passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
