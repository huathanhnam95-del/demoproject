'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hashFile = async file => { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };

class Store {
  constructor(root, schema, options = {}) { this.root = path.resolve(root); this.schema = schema; this.locks = new Map(); this.beforeManifestWrite = options.beforeManifestWrite || (() => {}); }
  async init() { await fsp.mkdir(this.root, { recursive: true }); this.root = await fsp.realpath(this.root); for (const dir of ['projects', 'drafts', 'exports']) await fsp.mkdir(path.join(this.root, dir), { recursive: true }); return this; }
  id(id) { this.schema.invariant(this.schema.validId(id), 'Invalid ID'); return id; }
  projectDir(id) { return path.join(this.root, 'projects', this.id(id)); }
  draftDir(id) { return path.join(this.root, 'drafts', this.id(id)); }
  async lock(id, fn) { const previous = this.locks.get(id) || Promise.resolve(); const next = previous.catch(() => {}).then(fn); this.locks.set(id, next); try { return await next; } finally { if (this.locks.get(id) === next) this.locks.delete(id); } }
  async readJson(file) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Record not found'), { status: 404 }); throw error; } }
  async atomicJson(file, value) {
    await this.beforeManifestWrite(file, value);
    const temp = `${file}.${uuid()}.tmp`;
    const handle = await fsp.open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fsp.rename(temp, file);
  }
  async get(id) { return this.schema.validateProject(await this.readJson(path.join(this.projectDir(id), 'manifest.json'))); }
  async list() {
    const projects = [];
    for (const entry of await fsp.readdir(path.join(this.root, 'projects'), { withFileTypes: true })) {
      if (!entry.isDirectory() || !this.schema.validId(entry.name)) continue;
      try { const p = await this.get(entry.name); projects.push({ id: p.id, name: p.name, subject: p.subject, updatedAt: p.updatedAt, takeCount: p.takes.filter(t => !t.archived).length }); } catch (error) { if (error.status !== 404) projects.push({ id: entry.name, name: 'Project needs recovery', error: error.message }); }
    }
    return projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  async create(name, subject = '') {
    const p = { schemaVersion: 1, id: uuid(), name, subject, revision: 1, createdAt: now(), updatedAt: now(), capturePackVersion: 1, assets: [], takes: [], scriptDrafts: {}, selected: {}, checks: {} };
    this.schema.validateProject(p); await fsp.mkdir(path.join(this.projectDir(p.id), 'media'), { recursive: true }); await this.atomicJson(path.join(this.projectDir(p.id), 'manifest.json'), p); return p;
  }
  checkRevision(p, revision) { this.schema.invariant(p.revision === revision, 'This project changed in another window. Reload before saving.', 409); }
  async update(id, changes) {
    return this.lock(id, async () => {
      const p = await this.get(id); this.checkRevision(p, changes.revision);
      for (const key of ['name', 'subject', 'scriptDrafts', 'selected', 'checks']) if (changes[key] !== undefined) p[key] = changes[key];
      if (changes.take) {
        const take = p.takes.find(t => t.id === changes.take.id); this.schema.invariant(take, 'Take not found', 404);
        for (const key of ['actualTranscript', 'transcriptReviewed', 'label', 'archived']) if (changes.take[key] !== undefined) take[key] = changes.take[key];
        if (take.archived) for (const [key, value] of Object.entries(p.selected)) if (value === take.id) delete p.selected[key];
      }
      p.revision++; p.updatedAt = now(); this.schema.validateProject(p); await this.atomicJson(path.join(this.projectDir(id), 'manifest.json'), p); return p;
    });
  }
  async createDraft(projectId, meta) {
    await this.get(projectId);
    const { invariant, validScene, text } = this.schema;
    invariant(validScene(meta.sceneId) && ['vi', 'en', 'none'].includes(meta.language), 'Choose a valid scene and language');
    text(meta.expectedTranscript || '', 'expected transcript'); text(meta.label || '', 'take label', 150);
    const draft = { id: uuid(), projectId, meta, createdAt: now() };
    await fsp.mkdir(this.draftDir(draft.id)); await this.atomicJson(path.join(this.draftDir(draft.id), 'draft.json'), draft); return draft;
  }
  async draft(id) { return this.readJson(path.join(this.draftDir(id), 'draft.json')); }
  async receive(id, stream, contentType) {
    return this.lock(`draft:${id}`, async () => {
      const d = await this.draft(id); this.schema.invariant(!d.media, 'This draft already has media', 409);
      const mime = this.schema.baseMime(contentType); this.schema.invariant(this.schema.MIME_EXTENSIONS[mime], 'Unsupported media type');
      const part = path.join(this.draftDir(id), 'upload.part'); const assetId = uuid(); let size = 0;
      const hash = crypto.createHash('sha256');
      const meter = new Transform({ transform: (chunk, encoding, cb) => { size += chunk.length; if (size > this.schema.MAX_MEDIA_BYTES) return cb(Object.assign(new Error('File exceeds 512 MiB'), { status: 413 })); hash.update(chunk); cb(null, chunk); } });
      try { await pipeline(stream, meter, fs.createWriteStream(part, { flags: 'wx' })); this.schema.invariant(size > 0, 'Recording is empty'); const handle = await fsp.open(part, 'r+'); try { await handle.sync(); } finally { await handle.close(); } }
      catch (error) { await fsp.unlink(part).catch(() => {}); throw error; }
      d.media = { id: assetId, mime, size, sha256: hash.digest('hex'), path: `media/${assetId}.${this.schema.MIME_EXTENSIONS[mime]}` };
      await this.atomicJson(path.join(this.draftDir(id), 'draft.json'), d); return d.media;
    });
  }
  async commit(id, revision) {
    const d = await this.draft(id);
    return this.lock(d.projectId, async () => {
      const p = await this.get(d.projectId); this.schema.invariant(d.media, 'Draft media is missing');
      if (p.assets.some(a => a.id === d.media.id)) return p;
      this.checkRevision(p, revision);
      this.schema.invariant(p.assets.length < this.schema.MAX_ASSETS, 'Project asset limit reached');
      const m = d.meta; const parent = m.parentTakeId && p.takes.find(t => t.id === m.parentTakeId);
      if (m.parentTakeId) this.schema.invariant(parent && m.processing?.stats && m.processing?.engine === 'AudioDspPipeline', 'Invalid processed-audio provenance');
      const asset = { ...d.media, role: parent ? 'derivative' : 'original', originalFilename: m.originalFilename || '', createdAt: now(), ...(parent ? { originalAssetId: parent.assetId, processing: m.processing } : {}) };
      p.assets.push(asset);
      if (!parent) {
        const take = { id: uuid(), assetId: asset.id, sceneId: m.sceneId, language: m.language, label: m.label || 'Untitled take', expectedTranscript: m.expectedTranscript || '', actualTranscript: '', transcriptReviewed: false, archived: false, durationMs: Number(m.durationMs) || 0, settings: m.settings || {}, createdAt: now() };
        p.takes.push(take); p.selected[`${take.sceneId}:${take.language}`] = take.id;
      }
      p.updatedAt = now(); p.revision++; this.schema.validateProject(p);
      const destination = path.join(this.projectDir(p.id), asset.path);
      await fsp.copyFile(path.join(this.draftDir(id), 'upload.part'), destination, fs.constants.COPYFILE_EXCL);
      try { await this.atomicJson(path.join(this.projectDir(p.id), 'manifest.json'), p); } catch (error) { await fsp.unlink(destination).catch(() => {}); throw error; }
      await this.atomicJson(path.join(this.draftDir(id), 'committed.json'), { projectId: p.id, assetId: asset.id, at: now() }).catch(() => {});
      await fsp.unlink(path.join(this.draftDir(id), 'upload.part')).catch(() => {});
      return p;
    });
  }
  async discard(id) { const dir = this.draftDir(id); await this.draft(id); const resolved = await fsp.realpath(dir); this.schema.invariant(resolved.startsWith(this.root + path.sep), 'Unsafe draft path'); await fsp.rm(resolved, { recursive: true }); }
  async asset(projectId, assetId) {
    const p = await this.get(projectId); const asset = p.assets.find(a => a.id === assetId); this.schema.invariant(asset, 'Media not found', 404);
    const root = await fsp.realpath(this.projectDir(projectId)); const file = await fsp.realpath(path.join(root, asset.path)); this.schema.invariant(file.startsWith(root + path.sep), 'Unsafe media path'); return { asset, file };
  }
}
module.exports = { Store, hashFile, uuid };
