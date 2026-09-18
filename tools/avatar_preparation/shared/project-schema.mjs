export const SCHEMA_VERSION = 1;
export const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
export const MAX_ASSETS = 300;
export const MIME_EXTENSIONS = Object.freeze({
  'video/webm': 'webm', 'video/mp4': 'mp4', 'audio/webm': 'webm',
  'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'image/png': 'png', 'image/jpeg': 'jpg'
});
export function invariant(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
export function validId(id) { return typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id); }
export function text(value, label, max = 20000) { invariant(typeof value === 'string' && value.length <= max, `Invalid ${label}`); return value; }
export function baseMime(value) { return String(value || '').split(';')[0].trim().toLowerCase(); }
export function validScene(value) { return typeof value === 'string' && /^[a-z][a-z0-9-]{0,49}$/.test(value); }
export function validateProject(p) {
  invariant(p && p.schemaVersion === 1, 'Unsupported project schema');
  invariant(validId(p.id), 'Invalid project ID');
  text(p.name, 'project name', 100); text(p.subject, 'subject', 100);
  invariant(p.name.trim().length > 0, 'A project name is required');
  invariant(Number.isInteger(p.revision) && p.revision >= 1, 'Invalid revision');
  invariant(Array.isArray(p.assets) && p.assets.length <= MAX_ASSETS, 'Too many assets');
  invariant(Array.isArray(p.takes) && p.takes.length <= MAX_ASSETS, 'Too many takes');
  const assets = new Map();
  for (const a of p.assets) {
    invariant(validId(a.id) && !assets.has(a.id), 'Invalid or duplicate asset ID');
    invariant(['original', 'derivative'].includes(a.role), 'Invalid asset role');
    invariant(MIME_EXTENSIONS[a.mime], 'Unsupported media type');
    invariant(Number.isInteger(a.size) && a.size > 0 && a.size <= MAX_MEDIA_BYTES, 'Invalid asset size');
    invariant(/^[a-f0-9]{64}$/.test(a.sha256), 'Invalid media hash');
    invariant(a.path === `media/${a.id}.${MIME_EXTENSIONS[a.mime]}`, 'Invalid media path');
    text(a.originalFilename || '', 'original filename', 250);
    assets.set(a.id, a);
  }
  for (const a of p.assets) if (a.role === 'derivative') {
    invariant(assets.get(a.originalAssetId)?.role === 'original', 'Derivative must reference an original');
    invariant(a.processing && typeof a.processing === 'object', 'Derivative processing provenance is required');
  }
  const takes = new Map();
  for (const t of p.takes) {
    invariant(validId(t.id) && !takes.has(t.id), 'Invalid or duplicate take ID');
    invariant(assets.get(t.assetId)?.role === 'original', 'Take must reference an original');
    invariant(validScene(t.sceneId) && ['vi', 'en', 'none'].includes(t.language), 'Invalid scene or language');
    text(t.expectedTranscript, 'expected transcript'); text(t.actualTranscript, 'actual transcript');
    text(t.label, 'take label', 150);
    invariant(typeof t.transcriptReviewed === 'boolean' && typeof t.archived === 'boolean', 'Invalid take review state');
    invariant(!t.transcriptReviewed || t.language === 'none' || t.actualTranscript.trim().length > 0, 'A reviewed spoken take needs an actual transcript');
    invariant(Number.isFinite(t.durationMs) && t.durationMs >= 0 && t.durationMs <= 86400000, 'Invalid duration');
    takes.set(t.id, t);
  }
  invariant(p.scriptDrafts && typeof p.scriptDrafts === 'object' && !Array.isArray(p.scriptDrafts), 'Invalid script drafts');
  invariant(Object.keys(p.scriptDrafts).length <= 100, 'Too many script drafts');
  for (const [key, value] of Object.entries(p.scriptDrafts)) { invariant(/^[a-z][a-z0-9-]{0,49}:(vi|en)$/.test(key), 'Invalid script key'); text(value, 'script draft'); }
  invariant(p.selected && typeof p.selected === 'object' && !Array.isArray(p.selected), 'Invalid selected takes');
  for (const [key, value] of Object.entries(p.selected)) {
    const take = takes.get(value);
    invariant(take && !take.archived && key === `${take.sceneId}:${take.language}`, 'Invalid selected take');
  }
  invariant(new TextEncoder().encode(JSON.stringify(p, null, 2) + '\n').length <= 8 * 1024 * 1024, 'Project manifest exceeds 8 MiB');
  return p;
}
export function scriptText(scene, language) { return (scene.cues?.[language] || []).map(cue => cue.spokenText).join('\n\n'); }
export function readiness(project, pack) {
  return pack.scenes.filter(scene => scene.core).flatMap(scene => (scene.kind === 'photo' ? ['none'] : ['vi', 'en']).map(language => {
    const take = project.takes.find(t => t.id === project.selected[`${scene.id}:${language}`] && t.sceneId === scene.id && t.language === language && !t.archived);
    const mediaType = scene.kind === 'photo' ? 'image/' : `${scene.kind}/`;
    const asset = take && project.assets.find(a => a.id === take.assetId && a.role === 'original' && a.size > 0 && a.mime.startsWith(mediaType));
    return { label: `${scene.title}${language === 'none' ? '' : ` · ${language.toUpperCase()}`}`, done: Boolean(asset) };
  }));
}
