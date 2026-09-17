'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { Store, hashFile } = require('../../tools/avatar_preparation/server/store.cjs');
const { PortablePackage } = require('../../tools/avatar_preparation/server/portable-package.cjs');
const evidence = process.env.AVATAR_EVIDENCE_DIR || path.join(os.homedir(), '.codex', 'avatar-preparation-task', 'verification');
async function fixture(options) { await fs.mkdir(evidence, { recursive: true }); const root = await fs.mkdtemp(path.join(evidence, 'store-')); const schema = await import(pathToFileURL(path.resolve(__dirname, '../../tools/avatar_preparation/shared/project-schema.mjs'))); return new Store(root, schema, options).init(); }
async function save(store, project) { const d = await store.createDraft(project.id, { sceneId: 'neutral-voice', language: 'vi', label: 'Bản ghi thứ nhất', expectedTranscript: 'Tôi nói tiếng Việt.\nGiữ nguyên dấu.', durationMs: 1300 }); await store.receive(d.id, Readable.from(Buffer.from('unchanged original media bytes')), 'audio/webm'); return { project: await store.commit(d.id, project.revision), draftId: d.id }; }
test('Saved originals, transcripts and script drafts survive a new Store instance independently', async () => {
  const store = await fixture(); let p = await store.create('Dự án của tôi'); p = (await save(store, p)).project; const original = p.assets[0];
  p = await store.update(p.id, { revision: p.revision, scriptDrafts: { 'neutral-voice:vi': 'Một bản nháp mới.\n\nKhông sửa lời đã nói.' }, take: { id: p.takes[0].id, actualTranscript: 'Tôi nói tiếng Việt.\nGiữ nguyên dấu.', transcriptReviewed: true } });
  const restored = await new Store(store.root, store.schema).init(); const loaded = await restored.get(p.id);
  assert.deepEqual(loaded, p); assert.equal(loaded.takes[0].expectedTranscript, 'Tôi nói tiếng Việt.\nGiữ nguyên dấu.'); assert.equal(await hashFile((await store.asset(p.id, original.id)).file), original.sha256);
});
test('Revision conflicts and failed manifests preserve the previous saved project; commits are retry safe', async () => {
  const store = await fixture(); const first = await store.create('Project'); const saved = await save(store, first); const p = saved.project;
  assert.deepEqual(await store.commit(saved.draftId, first.revision), p);
  await assert.rejects(store.update(p.id, { revision: 1, name: 'Stale overwrite' }), error => error.status === 409);
  store.beforeManifestWrite = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  await assert.rejects(store.update(p.id, { revision: p.revision, name: 'Should never appear' }), /disk full/); assert.deepEqual(await store.get(p.id), p);
});
test('Incomplete uploads and an empty recording cannot become saved takes', async () => {
  const store = await fixture(); const p = await store.create('Project'); const d = await store.createDraft(p.id, { sceneId: 'steady', language: 'en' });
  await assert.rejects(store.commit(d.id, p.revision), /missing/); await assert.rejects(store.receive(d.id, Readable.from(Buffer.alloc(0)), 'video/webm'), /empty/); assert.deepEqual(await store.get(p.id), p);
});
test('Export and import restore all original hashes and Unicode into an empty data directory', async () => {
  const store = await fixture(); let p = (await save(store, await store.create('Người hướng dẫn'))).project;
  p = await store.update(p.id, { revision: p.revision, take: { id: p.takes[0].id, actualTranscript: 'Tôi nói tiếng Việt.\nGiữ nguyên dấu.', transcriptReviewed: true } });
  const exported = await new PortablePackage(store).export(p.id); const manifest = JSON.parse(await fs.readFile(path.join(exported.directory, 'manifest.json'), 'utf8'));
  const fresh = await fixture(); const importer = new PortablePackage(fresh); const { id } = await importer.begin(manifest); await assert.rejects(importer.commit(id), /incomplete/);
  for (const asset of manifest.assets) await importer.receive(id, asset.id, Readable.from(await fs.readFile(path.join(exported.directory, asset.path))));
  const restored = await importer.commit(id); assert.notEqual(restored.id, p.id); assert.equal(restored.importedFromProjectId, p.id); assert.deepEqual(restored.assets, p.assets); assert.deepEqual(restored.takes, p.takes);
  for (const asset of restored.assets) assert.equal(await hashFile((await fresh.asset(restored.id, asset.id)).file), asset.sha256);
});
test('Corrupt portable media is rejected before activation; outside-path assets are rejected', async () => {
  const store = await fixture(); const p = (await save(store, await store.create('Project'))).project; const importer = new PortablePackage(store); const { id } = await importer.begin(p);
  await assert.rejects(importer.receive(id, p.assets[0].id, Readable.from(Buffer.alloc(p.assets[0].size))), /hash/);
  await assert.rejects(importer.commit(id), /incomplete/); assert.equal((await store.list()).length, 1);
  const evil = structuredClone(p); evil.assets[0].path = '../../outside'; await assert.rejects(importer.begin(evil), /path/);
});
test('Processed derivatives need an original and actual processing stats; original media is immutable', async () => {
  const store = await fixture(); const p = (await save(store, await store.create('Project'))).project;
  const d = await store.createDraft(p.id, { sceneId: 'neutral-voice', language: 'vi', parentTakeId: p.takes[0].id, processing: { engine: 'AudioDspPipeline', stats: { sampleRate: 16000 } } });
  await store.receive(d.id, Readable.from(Buffer.from('processed WAV bytes')), 'audio/wav'); const updated = await store.commit(d.id, p.revision);
  assert.equal(updated.takes.length, 1); assert.deepEqual(updated.assets[0], p.assets[0]); assert.equal(updated.assets[1].originalAssetId, p.assets[0].id);
});
