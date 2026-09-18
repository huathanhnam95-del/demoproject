import { StorageClient } from './storage-client.mjs';
import { CaptureSession } from './capture.mjs';
import { GuidedSession } from './guided-session.mjs';
import { baseMime, MIME_EXTENSIONS, scriptText, readiness } from './shared/project-schema.mjs';

const $ = id => document.getElementById(id);
const client = new StorageClient(); const capture = new CaptureSession();
const guide = new GuidedSession($('cue-text'), $('cue-directions'), $('cue-counter'));
const state = { project: null, pack: null, group: 'photo', scene: null, language: 'vi', result: null, busy: false, arming: false, armGeneration: 0, scriptDirty: false, reviewDirty: false, reviewTakeId: null, objectUrl: null, permissionPending: false };
let meterContext; let meterTimer; let exportPath = '';
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function dirty() { return state.result && !state.result.saved || state.scriptDirty || state.reviewDirty || capture.recording || capture.finishing || state.arming; }
function guard() {
  if (capture.recording || capture.finishing || state.arming) { status('Finish the current recording or countdown before changing sessions.', true); return false; }
  return !dirty() || window.confirm('There is an unsaved take or text edit. Leave it behind? Saved originals will remain in your project.');
}
function controls() {
  const working = state.busy || state.arming || capture.finishing;
  const pending = state.result && !state.result.saved;
  $('record').disabled = state.busy || (!capture.recording && (working || !capture.stream?.active || Boolean(state.result)));
  $('record').classList.toggle('recording', capture.recording);
  $('record').textContent = capture.recording ? '■ Stop recording' : state.scene?.kind === 'photo' ? '● Capture photo' : '● Record';
  $('save-take').disabled = !pending || working || capture.recording;
  $('retake').disabled = !state.result || working || capture.recording;
  for (const id of ['projects', 'scene', 'language', 'export-project', 'import-media', 'save-script', 'restore-script', 'save-transcript', 'select-take', 'archive-take', 'import-package', 'camera-device', 'mic-device']) $(id).disabled = working || capture.recording;
  if (state.project?.takes.find(t => t.id === state.reviewTakeId)?.archived) $('select-take').disabled = true;
  $('enable-devices').disabled = working || capture.recording || Boolean(pending) || state.permissionPending;
  $('script-draft').disabled = working || capture.recording || state.scene?.kind === 'photo';
  $('device-status').textContent = state.permissionPending ? 'Waiting for permission' : capture.stream?.active ? 'Devices on · live' : 'Devices off';
  $('save-status').textContent = state.busy ? 'Working locally…' : pending ? 'Take not saved' : state.scriptDirty || state.reviewDirty ? 'Text changes not saved' : state.project ? 'Project saved locally' : 'Choose or create a project';
}
async function work(fn) { if (state.busy) return; state.busy = true; controls(); try { return await fn(); } catch (error) { status(error.message, true); } finally { state.busy = false; controls(); } }
function safe(fn) { return event => { Promise.resolve().then(() => fn(event)).catch(error => { status(error.message, true); controls(); }); }; }
function stopMeter() { clearInterval(meterTimer); meterContext?.close().catch(() => {}); meterContext = null; $('input-meter').value = 0; }
async function startMeter() {
  stopMeter(); if (!capture.stream?.getAudioTracks().length) return;
  meterContext = new AudioContext(); await meterContext.resume();
  const source = meterContext.createMediaStreamSource(capture.stream); const analyser = meterContext.createAnalyser(); analyser.fftSize = 512; source.connect(analyser); const data = new Float32Array(analyser.fftSize);
  meterTimer = setInterval(() => { analyser.getFloatTimeDomainData(data); let sum = 0; let peak = 0; for (const v of data) { sum += v * v; peak = Math.max(peak, Math.abs(v)); } $('input-meter').value = Math.min(100, Math.sqrt(sum / data.length) * 400); $('input-meter').title = peak >= .98 ? 'Possible clipping: lower your input volume.' : 'Live input activity; listen to the saved recording to assess quality.'; }, 100);
}
function disable() { state.armGeneration++; state.arming = false; $('countdown').hidden = true; capture.disable(); stopMeter(); state.permissionPending = false; controls(); }
function clearResult() {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; state.result = null;
  $('preview').pause(); $('preview').removeAttribute('src'); $('preview').srcObject = null; $('preview').controls = false; $('preview').muted = true;
  $('audio-preview').pause(); $('audio-preview').removeAttribute('src'); $('audio-preview').hidden = true;
  $('photo-preview').removeAttribute('src'); $('photo-preview').hidden = true;
  $('preview').hidden = false; $('camera-placeholder').hidden = false; $('frame-guide').hidden = true; $('download-draft').hidden = true; $('preview-label').textContent = 'PRIVATE LOCAL WORKSPACE'; $('timer').textContent = '00:00';
}
function showLive() {
  $('preview').removeAttribute('src'); $('preview').srcObject = capture.stream; $('preview').muted = true; $('preview').controls = false; $('preview').classList.toggle('mirrored', state.scene.kind !== 'audio');
  $('camera-placeholder').hidden = state.scene.kind !== 'audio'; $('camera-placeholder').querySelector('strong').textContent = state.scene.kind === 'audio' ? 'Microphone ready' : 'Your camera is off'; $('camera-placeholder').querySelector('span:last-child').textContent = state.scene.kind === 'audio' ? 'Watch the input meter, then read one thought at a time.' : 'Enable devices when you are ready.';
  $('frame-guide').hidden = state.scene.kind === 'audio'; $('preview-label').textContent = state.scene.kind === 'audio' ? 'LIVE MICROPHONE · NOT RECORDING' : 'LIVE PREVIEW · MIRRORED ONLY HERE';
  $('preview').play().catch(() => {});
}
function currentExpected() { return state.scene.kind === 'photo' ? '' : $('script-draft').value; }
async function probe(blob, kind, durationHint = 0) {
  const url = URL.createObjectURL(blob);
  try {
    if (kind === 'photo') { const img = new Image(); img.src = url; await img.decode(); return { durationMs: 0, settings: { image: { width: img.naturalWidth, height: img.naturalHeight } } }; }
    const element = document.createElement(kind === 'video' ? 'video' : 'audio'); element.preload = 'auto'; element.src = url;
    try { await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('The media could not be decoded in time. Try a Chrome-compatible file.')), 12000); element.onloadeddata = () => { clearTimeout(timer); resolve(); }; element.onerror = () => { clearTimeout(timer); reject(new Error('Chrome cannot play this media. Import a compatible recording.')); }; }); return { durationMs: Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : durationHint, settings: kind === 'video' ? { video: { width: element.videoWidth, height: element.videoHeight } } : {} }; }
    finally { element.removeAttribute('src'); element.load(); }
  } finally { URL.revokeObjectURL(url); }
}
async function present(result, originalFilename = '') {
  if (!result.blob.size) throw new Error('The recording is empty. Check your selected device and try again.');
  const metadata = await probe(result.blob, state.scene.kind, result.durationMs);
  clearResult();
  state.result = { ...result, durationMs: metadata.durationMs, settings: { ...metadata.settings, ...result.settings }, originalFilename, sceneId: state.scene.id, language: state.scene.kind === 'photo' ? 'none' : state.language, expectedTranscript: currentExpected(), saved: false };
  const url = state.objectUrl = URL.createObjectURL(result.blob);
  $('preview').srcObject = null; $('preview').classList.remove('mirrored'); $('preview').muted = false; $('preview').controls = true; $('frame-guide').hidden = true; $('camera-placeholder').hidden = true;
  if (state.scene.kind === 'photo') { $('preview').hidden = true; $('photo-preview').src = url; $('photo-preview').hidden = false; }
  else if (state.scene.kind === 'audio') { $('preview').hidden = true; $('audio-preview').src = url; $('audio-preview').hidden = false; }
  else $('preview').src = url;
  $('download-draft').href = url; $('download-draft').download = `${state.scene.id}-${state.result.language}.${MIME_EXTENSIONS[baseMime(result.blob.type)] || 'bin'}`; $('download-draft').hidden = false;
  $('preview-label').textContent = 'ORIGINAL TAKE · NOT SAVED';
  $('capture-details').textContent = `${baseMime(result.blob.type)} · ${(result.blob.size / 1048576).toFixed(2)} MiB · ${metadata.durationMs ? (metadata.durationMs / 1000).toFixed(1) + ' seconds' : 'photo / duration unavailable'} · Original bytes preserved`;
  status('Your take is ready to review. Play it back, then save or retake.'); controls();
}
function groupScenes() { return state.pack.scenes.filter(scene => state.group === 'photo' ? scene.kind === 'photo' : state.group === 'voice' ? scene.kind === 'audio' : state.group === 'core' ? scene.id === 'steady' : scene.group === 'expression'); }
function loadScene(id) {
  disable(); clearResult(); state.scriptDirty = false; state.scene = state.pack.scenes.find(scene => scene.id === id);
  $('scene').value = id; $('language').hidden = state.scene.kind === 'photo'; $('language').value = state.language;
  $('scene-description').textContent = state.scene.description; $('scene-target').textContent = state.scene.kind === 'photo' ? '3-second countdown' : `Target ${state.scene.durationTargetSeconds}s · flexible pacing`;
  const key = `${id}:${state.language}`; const draft = state.project.scriptDrafts[key];
  $('script-draft').value = draft ?? scriptText(state.scene, state.language); $('script-draft').disabled = state.scene.kind === 'photo';
  $('cue-text').lang = state.language; guide.load(state.scene, state.language, draft); $('cue-auto').textContent = 'Auto cues'; controls();
}
function group(value) {
  state.group = value; document.querySelectorAll('[data-group]').forEach(button => button.classList.toggle('active', button.dataset.group === value));
  $('capture-area').hidden = value === 'review'; $('review-area').hidden = value !== 'review';
  if (value !== 'review') { $('scene').replaceChildren(...groupScenes().map(scene => new Option(scene.title, scene.id))); loadScene(groupScenes()[0].id); }
  else { disable(); clearResult(); state.scriptDirty = false; guide.pause(); }
  renderReadiness();
}
async function refreshProjects() {
  const projects = await client.list(); $('projects').replaceChildren(new Option('Choose a project', ''), ...projects.map(p => new Option(p.name, p.id))); $('projects').value = state.project?.id || '';
}
function renderReadiness() {
  $('readiness').replaceChildren(...readiness(state.project, state.pack).map(item => { const li = document.createElement('li'); li.textContent = `${item.done ? '✓' : '○'} ${item.label}${item.done ? ' · complete' : ' · still needed'}`; return li; }));
  $('check-light').checked = Boolean(state.project.checks?.lighting); $('check-sound').checked = Boolean(state.project.checks?.sound);
}
function renderTakes() {
  const takes = state.project.takes.filter(t => !t.archived || $('show-archived').checked).slice().reverse(); $('take-count').textContent = `${takes.length} saved take${takes.length === 1 ? '' : 's'}`;
  $('takes').replaceChildren();
  if (!takes.length) { const p = document.createElement('p'); p.className = 'empty-takes'; p.textContent = 'Your first saved take will appear here. There is no rush.'; $('takes').append(p); }
  for (const take of takes) {
    const row = document.createElement('div'); row.className = 'take-row'; const meta = document.createElement('div'); const title = document.createElement('strong'); title.textContent = take.label;
    const subtitle = document.createElement('p'); subtitle.textContent = `${take.language === 'none' ? 'Photo' : take.language.toUpperCase()} · ${new Date(take.createdAt).toLocaleString()} · ${take.transcriptReviewed ? 'Transcript reviewed' : take.language === 'none' ? 'Original frame' : 'Transcript review optional'}`; meta.append(title, subtitle);
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = take.archived ? 'ARCHIVED' : Object.values(state.project.selected).includes(take.id) ? 'SELECTED' : 'SAVED ORIGINAL';
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Review'; button.dataset.takeId = take.id; button.addEventListener('click', () => { if (state.reviewDirty && !window.confirm('Discard unsaved transcript edits?')) return; openReview(take.id); });
    row.append(meta, badge, button); $('takes').append(row);
  }
}
function openReview(id) {
  const take = state.project.takes.find(t => t.id === id); const asset = state.project.assets.find(a => a.id === take.assetId);
  state.reviewTakeId = id; state.reviewDirty = false; $('take-review').hidden = false; $('take-review-title').textContent = take.label;
  $('archive-take').textContent = take.archived ? 'Unarchive take' : 'Archive take';
  const kind = asset.mime.startsWith('image/') ? 'img' : asset.mime.startsWith('video/') ? 'video' : 'audio';
  const player = document.createElement(kind); player.src = client.mediaUrl(state.project.id, asset.id); if (kind !== 'img') { player.controls = true; player.preload = 'metadata'; } else player.alt = 'Saved original photo';
  $('saved-player').replaceChildren(player); $('take-info').textContent = `${asset.mime} · ${(asset.size / 1048576).toFixed(2)} MiB · SHA-256 ${asset.sha256}`;
  $('expected-transcript').value = take.expectedTranscript; $('actual-transcript').value = take.actualTranscript; $('transcript-reviewed').checked = take.transcriptReviewed;
  for (const node of ['expected-transcript', 'actual-transcript']) $(node).lang = take.language === 'none' ? 'en' : take.language;
  $('derivatives').replaceChildren();
  for (const derivative of state.project.assets.filter(a => a.originalAssetId === asset.id)) { const p = document.createElement('p'); p.textContent = 'Separate DSP-enhanced audio · Original above remains unchanged'; const audio = document.createElement('audio'); audio.controls = true; audio.src = client.mediaUrl(state.project.id, derivative.id); $('derivatives').append(p, audio); }
  controls();
}
function adopt(project) { state.project = project; $('project-title').textContent = project.name; renderTakes(); renderReadiness(); controls(); }
async function openProject(id) {
  if (!id) return; disable(); clearResult(); state.scriptDirty = false; state.reviewDirty = false; state.reviewTakeId = null; $('take-review').hidden = true; $('export-result').hidden = true;
  adopt(await client.get(id)); $('workspace').hidden = false; group(state.group); $('projects').value = id; status('Project opened from your local folder. Devices are off.');
}
async function countdown() { const generation = ++state.armGeneration; state.arming = true; controls(); $('countdown').hidden = false; for (let i = 3; i >= 1; i--) { $('countdown').textContent = i; await new Promise(resolve => setTimeout(resolve, 1000)); if (generation !== state.armGeneration) return false; } $('countdown').hidden = true; state.arming = false; return true; }

$('create-project').addEventListener('submit', safe(async event => { event.preventDefault(); if (!guard()) return; await work(async () => { const p = await client.create($('project-name').value.trim(), $('subject').value.trim()); await refreshProjects(); await openProject(p.id); $('project-name').value = ''; }); }));
$('projects').addEventListener('change', safe(async () => { const id = $('projects').value; if (!guard()) { $('projects').value = state.project?.id || ''; return; } await work(() => openProject(id)); }));
$('reload-project').addEventListener('click', safe(() => { if (state.project && guard()) return work(() => openProject(state.project.id)); }));
document.querySelectorAll('[data-group]').forEach(button => button.addEventListener('click', () => { if (!state.busy && guard()) group(button.dataset.group); }));
$('scene').addEventListener('change', () => { const id = $('scene').value; if (guard()) loadScene(id); else $('scene').value = state.scene.id; });
$('language').addEventListener('change', () => { if (guard()) { state.language = $('language').value; loadScene(state.scene.id); } else $('language').value = state.language; });
$('cue-prev').onclick = () => guide.move(-1); $('cue-next').onclick = () => guide.move(1);
$('cue-auto').onclick = () => { if (guide.running) guide.pause(); else guide.play(); $('cue-auto').textContent = guide.running ? 'Pause cues' : 'Auto cues'; };
$('cue-size').onclick = () => $('cue-text').classList.toggle('large');
$('script-draft').addEventListener('input', () => { state.scriptDirty = true; controls(); });
$('save-script').onclick = safe(() => work(async () => { const drafts = { ...state.project.scriptDrafts, [`${state.scene.id}:${state.language}`]: $('script-draft').value }; adopt(await client.update(state.project, { scriptDrafts: drafts })); state.scriptDirty = false; guide.load(state.scene, state.language, $('script-draft').value); status('Script draft saved. Existing take transcripts remain separate.'); }));
$('restore-script').onclick = safe(() => { if (state.scriptDirty && !window.confirm('Replace this unsaved script draft with the authored cues?')) return; return work(async () => { const drafts = { ...state.project.scriptDrafts }; delete drafts[`${state.scene.id}:${state.language}`]; adopt(await client.update(state.project, { scriptDrafts: drafts })); state.scriptDirty = false; $('script-draft').value = scriptText(state.scene, state.language); guide.load(state.scene, state.language); status('Authored cue sequence restored.'); }); });
async function refreshDevices() { if (!navigator.mediaDevices?.enumerateDevices) return; const devices = await navigator.mediaDevices.enumerateDevices(); for (const [kind, id, label] of [['videoinput', 'camera-device', 'camera'], ['audioinput', 'mic-device', 'microphone']]) { const current = $(id).value; $(id).replaceChildren(new Option(`Default ${label}`, ''), ...devices.filter(d => d.kind === kind).map((d, index) => new Option(d.label || `${label} ${index + 1} · enable access to see names`, d.deviceId))); $(id).value = [...$(id).options].some(o => o.value === current) ? current : ''; } }
$('refresh-devices').onclick = safe(refreshDevices); navigator.mediaDevices?.addEventListener('devicechange', () => refreshDevices().catch(() => {}));
for (const id of ['camera-device', 'mic-device']) $(id).onchange = () => { disable(); status('Device selection changed. Enable devices to preview the new selection.'); };
$('enable-devices').onclick = safe(async () => {
  state.permissionPending = true; controls(); status('Allow the selected devices in Chrome. You can cancel waiting with Disable / cancel.');
  try { const stream = await capture.enable(state.scene.kind, $('camera-device').value, $('mic-device').value); if (!stream) return; showLive(); await startMeter(); await refreshDevices(); const settings = capture.settings(); $('capture-details').textContent = settings.video ? `Actual camera: ${settings.video.width} × ${settings.video.height} · ${settings.video.frameRate?.toFixed(1) || 'unknown'} fps. Capture limit: 3 minutes / 128 MiB.` : 'Microphone ready. Capture limit: 3 minutes / 128 MiB. Keep the original and a separate DSP derivative.'; $('capture-area').scrollIntoView({ block: 'start' }); status('Devices enabled. Nothing is being recorded yet.'); }
  finally { state.permissionPending = false; controls(); }
});
$('disable-devices').onclick = () => { disable(); if (!state.result) { $('preview').srcObject = null; $('camera-placeholder').hidden = false; $('camera-placeholder').querySelector('strong').textContent = 'Devices are off'; $('frame-guide').hidden = true; } status('Devices disabled. Any unsaved preview remains available.'); };
$('record').onclick = safe(async () => { if (capture.recording) { capture.stop(); $('record').disabled = true; return; } if (!await countdown()) return; try { if (state.scene.kind === 'photo') await present(await capture.photo($('preview'))); else { capture.record(state.scene.kind); $('preview-label').textContent = 'RECORDING · LOCAL ONLY'; status('Recording. Read naturally and stop whenever you are ready.'); } } finally { controls(); } });
capture.addEventListener('tick', event => { const seconds = Math.floor(event.detail / 1000); $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; });
capture.addEventListener('complete', event => { guide.pause(); work(() => present(event.detail)); });
capture.addEventListener('limit', event => status(event.detail)); capture.addEventListener('interrupted', event => status(event.detail, true));
$('retake').onclick = () => { if (state.result && !state.result.saved && !window.confirm('Discard this unsaved preview and try again? Saved takes remain untouched.')) return; clearResult(); if (capture.stream?.active) showLive(); controls(); status('Ready for another take.'); };
$('save-take').onclick = safe(() => work(async () => {
  const result = state.result; if (!result || result.saved) return;
  const scene = state.pack.scenes.find(s => s.id === result.sceneId); const number = state.project.takes.filter(t => t.sceneId === result.sceneId && t.language === result.language).length + 1;
  const meta = { sceneId: result.sceneId, language: result.language, expectedTranscript: result.expectedTranscript, durationMs: result.durationMs, settings: result.settings, originalFilename: result.originalFilename, label: `${scene.title} · ${result.language === 'none' ? 'Photo' : result.language.toUpperCase()} · Take ${number}` };
  adopt(await client.saveTake(state.project, meta, result.blob)); result.saved = true; $('preview-label').textContent = 'SAVED ORIGINAL · UNCHANGED'; await refreshProjects(); status('Original saved locally. Transcript review is optional.');
  if (scene.kind === 'audio' && window.AudioDspPipeline) {
    const take = state.project.takes.at(-1);
    try { const processed = await window.AudioDspPipeline.enhance(result.blob, { createUrl: false }); if (processed.stats && processed.wavBlob !== result.blob) { adopt(await client.saveTake(state.project, { ...meta, parentTakeId: take.id, processing: { engine: 'AudioDspPipeline', stats: processed.stats, createdAt: new Date().toISOString() } }, processed.wavBlob)); status('Original saved, with a separate DSP-enhanced WAV. Transcript review is optional.'); } else status('Original saved. Audio enhancement was unavailable; no enhanced derivative was claimed.'); } catch (error) { status(`Original saved. The optional DSP derivative could not be saved: ${error.message}`, true); }
  }
}));
$('import-media').onclick = () => { if (!guard()) return; $('media-file').accept = state.scene.kind === 'photo' ? 'image/png,image/jpeg' : state.scene.kind === 'video' ? 'video/webm,video/mp4' : 'audio/webm,audio/mp4,audio/ogg,audio/mpeg,audio/wav'; $('media-file').click(); };
$('media-file').onchange = safe(async () => { const file = $('media-file').files[0]; if (!file) return; if (file.size > 512 * 1048576) throw new Error('Imported media must be at most 512 MiB.'); const mime = baseMime(file.type); if (!MIME_EXTENSIONS[mime] || !mime.startsWith(state.scene.kind === 'photo' ? 'image/' : `${state.scene.kind}/`)) throw new Error('Choose a supported file matching this capture scene.'); await work(() => present({ blob: file, durationMs: 0, settings: { source: 'import' } }, file.name)); $('media-file').value = ''; });
$('export-project').onclick = safe(() => { if (dirty()) { status('Save or retake the current preview and save text edits before exporting.', true); return; } return work(async () => { const result = await client.export(state.project.id); exportPath = result.directory; $('export-path').textContent = exportPath; $('export-result').hidden = false; group('review'); status(`Portable folder created and verified: ${result.assetCount} media files, revision ${result.revision}.`); }); });
$('copy-export').onclick = safe(async () => { await navigator.clipboard.writeText(exportPath); status('Export folder path copied.'); });
$('import-package').onclick = () => { if (guard()) $('package-files').click(); };
$('package-files').onchange = safe(() => work(async () => { const files = $('package-files').files; if (!files.length) return; const p = await client.import(files, (n, total) => status(`Importing and checking media ${n} of ${total}…`)); await refreshProjects(); await openProject(p.id); $('package-files').value = ''; status('Portable project restored as a separate project. Original files and transcripts passed integrity checks.'); }));
for (const id of ['actual-transcript', 'transcript-reviewed']) $(id).addEventListener('input', () => { state.reviewDirty = true; controls(); });
$('copy-expected').onclick = () => { if ($('actual-transcript').value && !window.confirm('Replace the current actual-transcript text with the expected script?')) return; $('actual-transcript').value = $('expected-transcript').value; $('transcript-reviewed').checked = false; state.reviewDirty = true; controls(); };
$('save-transcript').onclick = safe(() => work(async () => { const take = state.project.takes.find(t => t.id === state.reviewTakeId); if ($('transcript-reviewed').checked && take.language !== 'none' && !$('actual-transcript').value.trim()) throw new Error('Enter the actual spoken words before marking a spoken take reviewed.'); adopt(await client.update(state.project, { take: { id: state.reviewTakeId, actualTranscript: $('actual-transcript').value, transcriptReviewed: $('transcript-reviewed').checked } })); state.reviewDirty = false; status('Actual transcript review saved. Your script draft is unchanged.'); }));
$('close-review').onclick = () => { if (state.reviewDirty && !window.confirm('Discard unsaved transcript edits?')) return; state.reviewDirty = false; $('take-review').hidden = true; $('saved-player').replaceChildren(); controls(); };
$('select-take').onclick = safe(() => work(async () => { const t = state.project.takes.find(take => take.id === state.reviewTakeId); adopt(await client.update(state.project, { selected: { ...state.project.selected, [`${t.sceneId}:${t.language}`]: t.id } })); status('Selected take updated. All original takes remain stored.'); }));
$('show-archived').onchange = renderTakes;
$('archive-take').onclick = safe(() => { const archived = !state.project.takes.find(t => t.id === state.reviewTakeId).archived; if (state.reviewDirty && !window.confirm('Discard unsaved transcript edits before changing archive status?')) return; if (archived && !window.confirm('Archive this take? Its original media remains accessible through Show archived and in exports.')) return; return work(async () => { adopt(await client.update(state.project, { take: { id: state.reviewTakeId, archived } })); state.reviewDirty = false; $('take-review').hidden = true; status(archived ? 'Take archived. Use Show archived to review or restore it.' : 'Take restored. You can review and select it again.'); }); });
$('save-checks').onclick = safe(() => work(async () => { adopt(await client.update(state.project, { checks: { lighting: $('check-light').checked, sound: $('check-sound').checked } })); status('Your manual capture review is saved.'); }));
window.addEventListener('beforeunload', event => { if (dirty() || state.busy) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { disable(); guide.pause(); if (state.objectUrl) URL.revokeObjectURL(state.objectUrl); });
await work(async () => { const session = await client.init(); state.pack = await (await fetch('/shared/capture-pack.v1.json')).json(); $('data-directory').textContent = `Local data: ${session.dataDirectory}`; await refreshProjects(); await refreshDevices(); });
