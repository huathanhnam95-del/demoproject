export class StorageClient {
  async init() { this.session = await this.request('/api/session'); return this.session; }
  async request(url, method = 'GET', value, binary = false) {
    const options = { method, headers: {} };
    if (method !== 'GET') options.headers['X-Studio-Token'] = this.session.token;
    if (value !== undefined) { options.headers['Content-Type'] = binary ? (value.type || 'application/octet-stream') : 'application/json'; options.body = binary ? value : JSON.stringify(value); }
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Local operation failed'), { status: response.status });
    return result;
  }
  list() { return this.request('/api/projects'); }
  get(id) { return this.request(`/api/projects/${id}`); }
  create(name, subject) { return this.request('/api/projects', 'POST', { name, subject }); }
  update(project, changes) { return this.request(`/api/projects/${project.id}`, 'PATCH', { ...changes, revision: project.revision }); }
  async saveTake(project, meta, blob) {
    const draft = await this.request(`/api/projects/${project.id}/drafts`, 'POST', meta);
    await this.request(`/api/drafts/${draft.id}/media`, 'PUT', blob, true);
    return this.request(`/api/drafts/${draft.id}/commit`, 'POST', { revision: project.revision });
  }
  mediaUrl(projectId, assetId) { return `/api/projects/${projectId}/media/${assetId}`; }
  export(projectId) { return this.request(`/api/projects/${projectId}/exports`, 'POST', {}); }
  async import(files, onProgress = () => {}) {
    if (files.length > 301) throw new Error('A package can contain at most 300 media files and its manifest.');
    const list = [...files];
    const manifestFile = list.find(file => file.webkitRelativePath.split('/').length === 2 && file.name === 'manifest.json');
    if (!manifestFile || manifestFile.size > 8 * 1024 * 1024) throw new Error('Choose the exported project folder containing manifest.json (up to 8 MiB).');
    const manifest = JSON.parse(await manifestFile.text());
    const { validateProject } = await import('/shared/project-schema.mjs'); validateProject(manifest);
    const prefix = manifestFile.webkitRelativePath.split('/')[0] + '/';
    const byPath = new Map(list.map(file => [file.webkitRelativePath.slice(prefix.length), file]));
    for (const asset of manifest.assets) { const file = byPath.get(asset.path); if (!file || file.size !== asset.size) throw new Error(`Missing or wrong-size media: ${asset.path}`); }
    const { id } = await this.request('/api/imports', 'POST', manifest);
    for (const [index, asset] of manifest.assets.entries()) { onProgress(index + 1, manifest.assets.length); await this.request(`/api/imports/${id}/media/${asset.id}`, 'PUT', byPath.get(asset.path), true); }
    return this.request(`/api/imports/${id}/commit`, 'POST', {});
  }
}
