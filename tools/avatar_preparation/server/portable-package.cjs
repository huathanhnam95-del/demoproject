'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { hashFile, uuid } = require('./store.cjs');

class PortablePackage {
  constructor(store) { this.store = store; }
  async export(projectId) {
    const p = await this.store.get(projectId);
    const target = path.join(this.store.root, 'exports', `${projectId}-${uuid()}`);
    await fsp.mkdir(path.join(target, 'media'), { recursive: true });
    for (const a of p.assets) { const { file } = await this.store.asset(projectId, a.id); const destination = path.join(target, a.path); await fsp.copyFile(file, destination, fs.constants.COPYFILE_EXCL); this.store.schema.invariant(await hashFile(destination) === a.sha256, 'Export integrity check failed'); }
    await this.store.atomicJson(path.join(target, 'manifest.json'), p);
    return { directory: target, assetCount: p.assets.length, revision: p.revision };
  }
  async begin(manifest) {
    this.store.schema.validateProject(manifest);
    const id = uuid(); const dir = this.store.draftDir(id); await fsp.mkdir(path.join(dir, 'media'), { recursive: true });
    await this.store.atomicJson(path.join(dir, 'import.json'), manifest); return { id };
  }
  async receive(id, assetId, stream) {
    return this.store.lock(`import:${id}`, async () => {
      const dir = this.store.draftDir(id); const p = await this.store.readJson(path.join(dir, 'import.json'));
      const asset = p.assets.find(a => a.id === assetId); this.store.schema.invariant(asset, 'Unexpected import asset');
      const destination = path.join(dir, asset.path); const temp = destination + '.part'; let size = 0;
      try {
        await pipeline(stream, new Transform({ transform(chunk, encoding, cb) { size += chunk.length; if (size > asset.size) return cb(Object.assign(new Error('Import size mismatch'), { status: 400 })); cb(null, chunk); } }), fs.createWriteStream(temp, { flags: 'wx' }));
        this.store.schema.invariant(size === asset.size && await hashFile(temp) === asset.sha256, 'Import media hash or size mismatch');
        await fsp.rename(temp, destination);
      } catch (error) { await fsp.unlink(temp).catch(() => {}); throw error; }
      return { id: assetId };
    });
  }
  async commit(id) {
    return this.store.lock(`import:${id}`, async () => {
      const dir = this.store.draftDir(id); const p = this.store.schema.validateProject(await this.store.readJson(path.join(dir, 'import.json')));
      for (const a of p.assets) { let valid = false; try { valid = (await fsp.stat(path.join(dir, a.path))).size === a.size && await hashFile(path.join(dir, a.path)) === a.sha256; } catch {} this.store.schema.invariant(valid, 'Import is incomplete or corrupt'); }
      p.importedFromProjectId = p.id; p.id = uuid(); p.revision = 1; p.updatedAt = new Date().toISOString();
      const destination = this.store.projectDir(p.id); await fsp.mkdir(destination);
      await fsp.cp(path.join(dir, 'media'), path.join(destination, 'media'), { recursive: true, errorOnExist: true, force: false });
      await this.store.atomicJson(path.join(destination, 'manifest.json'), p); return p;
    });
  }
}
module.exports = { PortablePackage };
