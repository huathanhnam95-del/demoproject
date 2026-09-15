import { bootAuth, signInUrl } from './auth.mjs';
import { PresentationTransport } from './transport.mjs';
import { PresentationViewModel } from './view-model.mjs';
import { bindNotebook } from './notebook.mjs';
import { createPresentationAdapter } from './presentation/adapter.mjs';
import { SCENES } from './core/world/scenes.mjs';
import { createRenderer as createNativeRenderer } from '../../prototypes/bel-working-as-equals-demo/world/renderer.mjs';
import { installInput } from '../../prototypes/bel-working-as-equals-demo/world/input.mjs';
import { loadSource, HEADINGS, GROUPS } from '../../prototypes/bel-working-as-equals-demo/content/source.mjs';
import { nearest, targets, solidsFor } from './core/world/simulation.mjs';
import { distance, move } from './core/world/geometry.mjs';
import { QUESTIONS } from './core/activities/reversal.mjs';

const $ = id => document.getElementById(id);
const els = {
  entry: $('pd-entry'), room: $('pd-room'), game: $('pd-game'), authStatus: $('pd-auth-status'), authMessage: $('pd-auth-message'), presenterTools: $('pd-presenter-tools'), roomHistory: $('pd-room-history'), create: $('pd-create-room'), joinForm: $('pd-join-form'), codeInput: $('pd-room-code'), joinError: $('pd-join-error'), roomCode: $('pd-room-code-display'), roomStatus: $('pd-room-status'), slots: $('pd-slot-list'), copy: $('pd-copy-code'), openGame: $('pd-open-game'), receptionContinue: $('pd-reception-continue'), receptionHint: $('pd-reception-hint'), gameCode: $('pd-game-code'), connection: $('pd-connection-status'), canvas: $('pd-world'), gate: $('pd-gate'), gameSlots: $('pd-game-slots'), deck: $('pd-deck'), deckStatus: $('pd-deck-status'), start: $('pd-start-room'), replace: $('pd-replace-connection'), skip: $('pd-skip-activity'), end: $('pd-end-room'), gameMessage: $('pd-game-message'), title: $('pd-note-title'), body: $('pd-note-body'), saveNote: $('pd-save-note'), noteStatus: $('pd-note-status'), previous: $('pd-slide-previous'), next: $('pd-slide-next'), export: $('pd-export-pdf')
};

let identity = null;
let transport = null;
let model = null;
let notebook = null;
let presentation = null;
let pollTimer = null;
let heartbeatTimer = null;
let room = null;
let previousWorld = null, receivedAt = performance.now();
let nativeRenderer = null;
let source = null, input = null, inputTimer = null, animation = null, readyPending = false, exportInFlight = false, panelInstance = null;
const worldElements = { prompt: 'pd-world-prompt', activity: 'pd-activity-status', panel: 'pd-world-panel', pair: 'pd-pair-request', interact: 'pd-interact', profile: 'pd-profile', release: 'pd-release', drop: 'pd-drop', dismount: 'pd-dismount', activityStart: 'pd-activity-start', activityReset: 'pd-activity-reset', pause: 'pd-pause', closePresentation: 'pd-close-presentation' };
for (const [key, id] of Object.entries(worldElements)) els[key] = $(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function show(element, visible) { element.hidden = !visible; }
function message(text, tone = 'info') { els.gameMessage.textContent = text; els.gameMessage.dataset.tone = tone; }
function errorText(error) { return error?.message || 'The online room request failed.'; }
function archivePending(value = room) { return value?.lifecycle === 'ended' && value.archiveStatus !== 'archived'; }
function syncExportButton(value = room) {
  const pending = archivePending(value);
  els.export.disabled = exportInFlight;
  els.export.textContent = exportInFlight ? (pending ? 'Finalizing saved notes…' : 'Preparing PDF…') : pending ? 'Export when ready' : 'Export my notes';
  els.export.title = pending ? 'Saved notes are still being finalized. Select to wait for the retained PDF.' : '';
}

function renderRoomHistory(rooms = []) {
  if (!els.roomHistory) return;
  els.roomHistory.replaceChildren();
  if (!rooms.length) { els.roomHistory.textContent = 'No active or completed rooms yet.'; return; }
  const heading = document.createElement('p'); heading.className = 'pd-kicker'; heading.textContent = 'Your rooms'; els.roomHistory.append(heading);
  for (const value of rooms) {
    const row = document.createElement('div'); row.className = 'pd-history-row';
    const label = document.createElement('span'); label.textContent = archivePending(value) ? `${value.code} · Finalizing saved notes` : `${value.code} · ${value.lifecycle}`;
    const notes = document.createElement('div'); notes.className = 'pd-history-notes';
    const actions = document.createElement('span'); actions.className = 'pd-history-actions';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'pd-button pd-button-secondary'; open.textContent = value.lifecycle === 'ended' ? 'View archive' : 'Open room';
    open.addEventListener('click', async () => {
      if (value.lifecycle === 'ended') {
        try {
          const archive = await transport.readArchive(value.roomId);
          label.textContent = `${value.code} · archived · ${Object.keys(archive.notebooks || {}).length} notebook(s)`;
          notes.replaceChildren();
          for (const [uid, notebook] of Object.entries(archive.notebooks || {})) {
            const heading = document.createElement('strong'); heading.textContent = `Notes · ${uid}`; notes.append(heading);
            for (const page of notebook?.pages || []) {
              const item = document.createElement('p'); item.textContent = `${page.title}: ${page.body}`; notes.append(item);
            }
          }
          if (!notes.children.length) notes.textContent = 'No saved notes.';
        } catch (error) { label.textContent = errorText(error); }
      } else await loadRoomIntoLobby(value);
    });
    actions.append(open);
    if (value.lifecycle === 'ended') {
      const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'pd-button pd-button-secondary'; exportButton.textContent = archivePending(value) ? 'Export when ready' : 'Export PDF';
      exportButton.addEventListener('click', async () => {
        exportButton.disabled = true;
        if (archivePending(value)) label.textContent = `${value.code} · Finalizing saved notes · PDF will download when ready`;
        try { const blob = await transport.exportPdf(value.roomId); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `bel-presentation-${value.roomId}.pdf`; link.click(); URL.revokeObjectURL(link.href); value.archiveStatus = 'archived'; label.textContent = `${value.code} · archived · export downloaded`; exportButton.textContent = 'Export PDF'; } catch (error) { label.textContent = errorText(error); }
        finally { exportButton.disabled = false; }
      });
      actions.append(exportButton);
    }
    row.append(label, actions, notes); els.roomHistory.append(row);
  }
}

function slotMarkup(slot) {
  const label = slot.uid ? (slot.uid === identity?.uid ? `${slot.displayName} (you)` : slot.displayName) : 'Open participant seat';
  const status = slot.uid ? (slot.connected ? 'Connected' : 'Reserved') : 'Open';
  return `<div class="pd-slot"><div><div class="pd-slot-name">${escapeHtml(label)}</div><div class="pd-slot-meta">${slot.slotId} · ${slot.role}</div></div><span class="pd-slot-badge">${status}</span></div>`;
}

function renderSlots(target, currentRoom) {
  target.innerHTML = Object.values(currentRoom?.slots || {}).map(slotMarkup).join('');
}

function renderRoom(currentRoom) {
  room = currentRoom;
  els.roomCode.textContent = currentRoom.code;
  els.roomStatus.textContent = archivePending(currentRoom) ? 'Room ended · Finalizing saved notes' : currentRoom.lifecycle === 'ended' ? `Room ended · ${currentRoom.endReason || 'completed'}` : `You are ${Object.values(currentRoom.slots).find(slot => slot.uid === identity.uid)?.role || 'a participant'}.`;
  renderSlots(els.slots, currentRoom);
  const joined = ['p1', 'p2', 'p3'].every(slotId => currentRoom.slots[slotId]?.uid);
  const presenter = currentRoom.presenterUid === identity.uid;
  els.receptionContinue.disabled = !currentRoom.allParticipantsJoinedAt || !presenter || currentRoom.lifecycle === 'ended';
  els.receptionHint.textContent = !joined ? 'All three participants must join before Reception can open.' : !currentRoom.allParticipantsJoinedAt ? 'Each participant must open the game once to complete the authenticated bootstrap.' : (presenter ? 'All participant seats are ready. Continue when the group is ready.' : 'The presenter will open the game when everyone is ready.');
}

async function refreshRoom() {
  if (!room || !transport) return;
  try { renderRoom(await transport.room(room.roomId)); } catch (error) { els.roomStatus.textContent = errorText(error); }
}

function gameUrl() {
  const params = new URLSearchParams({ game: '1', room: room.roomId });
  if (identity.local) params.set('localUid', identity.uid);
  return `${window.location.origin}/presentation-demo/index.html?${params}`;
}

function openGame() {
  if (!room) return;
  const tab = window.open(gameUrl(), '_blank', 'noopener,noreferrer');
  if (!tab) els.roomStatus.textContent = 'Popup blocked. Allow popups for this CRM site, then use Open game in new tab again.';
}

function ownPlayer() { return room?.gameplay?.players?.[model?.slot()?.slotId]; }
function worldBase() {
  return { players: Object.fromEntries(Object.values(room.slots).map(slot => [slot.slotId, { id: slot.slotId, name: slot.displayName, connected: slot.connected, ready: slot.activity.ready, appearance: slot.customization }])) };
}
function drawGame() {
  const player = ownPlayer();
  if (!nativeRenderer || !room?.gameplay?.players || !player || !source) return;
  const world = room.gameplay, elapsed = Math.min(120, Math.max(0, performance.now() - receivedAt));
  const visual = { ...world, players: Object.fromEntries(Object.entries(world.players).map(([id, value]) => [id, { ...value }])) };
  for (const [id, current] of Object.entries(world.players)) {
    const before = previousWorld?.players?.[id];
    if (id !== player.id && before?.instance === current.instance && distance(before, current) < 45 && !current.seat && !current.leader && !current.follower) {
      const fraction = Math.min(1, elapsed / 100);
      Object.assign(visual.players[id], move(before, (current.x - before.x) * fraction, (current.y - before.y) * fraction, SCENES[current.scene], solidsFor(world, id), current.ride ? 15 : 10));
    }
  }
  if (input && !world.paused && !world.presentation.active && !player.seat && !player.leader && !player.follower && els.panel.hidden && !document.activeElement?.closest?.('input,textarea,select')) {
    let dx = Number(input.keys.d) - Number(input.keys.a), dy = Number(input.keys.s) - Number(input.keys.w);
    if (player.scene === 'I' && world.reversal.debuffs[player.id] > 0) { dx *= -1; dy *= -1; }
    const magnitude = Math.hypot(dx, dy) || 1, seconds = elapsed / 1000, speed = player.ride ? 165 : 108;
    Object.assign(visual.players[player.id], move(player, dx / magnitude * speed * seconds, dy / magnitude * speed * seconds, SCENES[player.scene], solidsFor(world, player.id), player.ride ? 15 : 10));
  }
  nativeRenderer.draw(visual, worldBase(), player.id, (world.tickAt || Date.now()) + elapsed, source);
}
function sendDeckState(currentRoom = room) {
  if (!currentRoom || !els.deck?.contentWindow) return;
  els.deck.contentWindow.postMessage({ belApp: true, contentVersion: 'bel-working-as-equals-1', roomId: currentRoom.roomId, revision: currentRoom.revision, serverNow: currentRoom.gameplay?.tickAt, deck: currentRoom.deck }, window.location.origin);
}
function renderGame(currentRoom) {
  if (room?.roomId === currentRoom.roomId && currentRoom.revision < room.revision) return;
  if (room?.revision !== currentRoom.revision) { previousWorld = room?.gameplay; receivedAt = performance.now(); }
  room = currentRoom; model?.setRoom(room);
  notebook?.setReadOnly(room.lifecycle === 'ended');
  syncExportButton(currentRoom);
  els.gameCode.textContent = currentRoom.code;
  renderSlots(els.gameSlots, currentRoom);
  const player = ownPlayer(), world = room.gameplay, presenter = model?.isPresenter(), active = world?.presentation?.active;
  els.gate.textContent = archivePending(room) ? 'Room ended · Finalizing saved notes' : room.lifecycle === 'ended' ? 'This room has ended' : player ? SCENES[player.scene].title : 'Connecting to the room';
  els.gate.dataset.deckRoom = currentRoom.deck?.room || 'reception';
  els.gate.dataset.deckSlide = String(currentRoom.deck?.slide || 0);
  if (player) { document.body.dataset.scene = player.scene; document.body.dataset.actor = player.id; document.body.dataset.ready = String(model.slot().activity.ready); }
  show(els.skip, presenter && room.lifecycle === 'playing' && !active && player?.scene !== 'I' && player?.scene !== 'J');
  els.skip.textContent = player?.scene === 'F' ? 'Complete bridge with help' : 'Gather at next entrance';
  show(els.end, presenter && room.lifecycle !== 'ended');
  show(els.start, presenter && room.lifecycle === 'reception' && !!room.allParticipantsJoinedAt);
  show(els.previous, presenter && active); show(els.next, presenter && active);
  show($('pd-reveal'), presenter && active && [2, 4, 5, 6].includes(room.deck.slide));
  show($('pd-display-options'), presenter && active);
  $('pd-show-quotes').checked = room.deck.properties.showQuotes;
  $('pd-show-folio').checked = room.deck.properties.showFolio;
  $('pd-photo-treatment').value = room.deck.properties.photoTreatment;
  show(els.pause, presenter && room.lifecycle !== 'ended'); els.pause.textContent = world?.paused ? 'Resume' : 'Pause';
  show(els.closePresentation, presenter && active);
  show(els.deck.parentElement, active === true);
  els.connection.textContent = transport?.state === 'reconnecting' ? 'Reconnecting…' : model?.connection && (identity.local || transport?.socket?.readyState === WebSocket.OPEN) ? 'Connected · ' + model.connection.seatId : 'Disconnected';
  if (!els.deck.src) els.deck.src = '/presentation-demo/native/deck.html';
  sendDeckState(currentRoom);
  if (!player) return;
  if (panelInstance !== player.instance) { closeWorldPanel(); panelInstance = player.instance; }
  const target = nearest(world, player.id);
  els.prompt.textContent = active ? 'Presentation in progress · your notebook remains available.' : world.paused ? 'World paused by the presenter.' : player.leader ? 'Following ' + room.slots[player.leader].displayName + ' · E to let go' : player.seat ? 'F · Stand' : target ? 'F · ' + (target.type === 'person' ? room.slots[target.id].displayName : target.label) : player.carry ? 'Carry your object to its match · Put down is available.' : 'WASD to walk · approach an object or colleague, then press F.';
  show(els.release, !!player.leader || !!player.follower); show(els.drop, !!player.carry); show(els.dismount, !!player.ride);
  const activity = player.scene === 'F' ? world.bridge : player.scene === 'I' ? world.reversal : null;
  show(els.activity, !!activity || player.scene === 'J');
  if (activity) els.activity.textContent = activity.phase + (activity.remaining ? ' · ' + Math.ceil(activity.remaining / 1000) + ' seconds' : '');
  if (player.scene === 'I' && activity.phase !== 'gathering') {
    const q = QUESTIONS[activity.index];
    els.prompt.textContent = ['opening', 'choice'].includes(activity.phase) ? q[0] + ' ' + q[1] + ' Move into Do or Don’t.' : q[3];
  }
  if (player.scene === 'J') els.activity.textContent = world.cubes.pairs.filter(Boolean).length + ' of 3 objectives completed' + (world.cubes.assistedPairs?.some(Boolean) ? ' · presenter assisted' : '');
  const assist = player.scene === 'J' && !world.cubes.pairs.every(Boolean) && Object.values(room.slots).filter(slot => slot.connected && world.players[slot.slotId].scene === 'J').length < 2;
  show(els.activityStart, presenter && !active && (!!activity && activity.phase === 'gathering' || assist));
  els.activityStart.textContent = assist ? 'Complete remaining objectives with help' : 'Start activity';
  show(els.activityReset, presenter && !active && ['F', 'G'].includes(player.scene) && !world.gStarted);
  if (els.pair.dataset.request !== String(player.request || '')) {
    els.pair.dataset.request = player.request || ''; els.pair.replaceChildren(); show(els.pair, !!player.request);
    if (player.request) {
      const label = document.createElement('span'); label.textContent = room.slots[player.request].displayName + ' would like to hold hands.'; els.pair.append(label);
      for (const action of ['accept', 'decline']) { const button = document.createElement('button'); button.className = 'pd-button pd-button-secondary'; button.textContent = action === 'accept' ? 'Accept' : 'Decline'; button.onclick = () => worldAction(action); els.pair.append(button); }
    }
  }
  if (model.connection && !model.slot().activity.ready && !readyPending && room.lifecycle !== 'ended' && nativeRenderer && source) {
    readyPending = true;
    model.command('setReady', { ready: true, instance: player.instance }).then(result => result.snapshot && renderGame(result.snapshot)).catch(error => message(errorText(error), 'error')).finally(() => { readyPending = false; });
  }
  drawGame();
}

async function connectGame(replaceExisting = false) {
  try {
    els.connection.textContent = 'Connecting…';
    await model.connect({ replaceExisting });
    els.replace.hidden = true;
    await transport.bootstrap(room.roomId);
    renderGame(await transport.room(room.roomId));
    if (!notebook) notebook = bindNotebook({ transport, roomId: room.roomId, identity, elements: { title: els.title, body: els.body, save: els.saveNote, status: els.noteStatus } });
    await notebook.load();
    message('Connected. Explore with WASD; press F near an object or colleague.');
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(() => model.connection && transport.heartbeat(model.connection.connectionId).catch(() => {}), 5000);
  } catch (error) {
    if (error.code === 'CONNECTION_EXISTS') { els.replace.hidden = false; els.connection.textContent = 'Already connected elsewhere'; message('This seat is active on another device. Choose Continue here to replace it.', 'warning'); return; }
    els.connection.textContent = 'Connection failed'; message(errorText(error), 'error');
  }
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    try { const current = await transport.room(room.roomId); renderGame(current); } catch (error) { message(errorText(error), 'error'); }
  }, identity.local ? 250 : 5000);
}

async function openGameView() {
  show(els.entry, false); show(els.room, false); show(els.game, true);
  model = new PresentationViewModel({ transport, identity }); model.setRoom(room); presentation = createPresentationAdapter({ model });
  await connectGame(false); startPolling(); installWorldControls();
}

async function loadRoomIntoLobby(nextRoom) { renderRoom(nextRoom); show(els.entry, false); show(els.room, true); window.history.replaceState(null, '', `/presentation-demo/index.html?room=${encodeURIComponent(nextRoom.roomId)}`); }

async function createRoom() {
  try { await loadRoomIntoLobby(await transport.createRoom()); } catch (error) { els.authMessage.textContent = errorText(error); }
}

async function loadRoomHistory() {
  if (!identity?.isAdmin && identity?.moduleGrants?.projects !== true && identity?.isTeacher !== true) return;
  try { renderRoomHistory(await transport.rooms()); } catch (_) { if (els.roomHistory) els.roomHistory.textContent = 'Room history is unavailable.'; }
}

async function joinRoom(event) {
  event.preventDefault();
  els.joinError.hidden = true;
  try { await loadRoomIntoLobby((await transport.join(els.codeInput.value)).snapshot); } catch (error) { els.joinError.textContent = errorText(error); els.joinError.hidden = false; }
}

async function saveAndDownload() {
  if (exportInFlight) return;
  exportInFlight = true; syncExportButton();
  try { if (room.lifecycle !== 'ended') await notebook?.save(); message(archivePending() ? 'Finalizing saved notes. Your PDF will download when ready…' : 'Preparing PDF from saved notes…'); const blob = await transport.exportPdf(room.roomId); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `bel-presentation-${room.roomId}.pdf`; link.click(); URL.revokeObjectURL(link.href); if (room.lifecycle === 'ended') { room = { ...room, archiveStatus: 'archived' }; model?.setRoom(room); } message('PDF export downloaded.'); } catch (error) { message(errorText(error), 'error'); }
  finally { exportInFlight = false; syncExportButton(); }
}

function closeWorldPanel() { els.panel.hidden = true; input?.clear(); els.canvas.focus(); }
async function worldAction(action, payload = {}) {
  const player = ownPlayer();
  if (!player || !model?.connection) return null;
  try {
    const result = await model.command('world', { action, payload: { instance: player.instance, ...(player.scene === 'F' ? { generation: room.gameplay.bridge.generation } : {}), ...payload } });
    if (result.snapshot) renderGame(result.snapshot);
    if (result.kind === 'toast') message(result.text);
    return result;
  } catch (error) { message(errorText(error), 'error'); return null; }
}
async function presentationAction(action) {
  try { const result = await model.command('presentation', { action }); if (result.snapshot) renderGame(result.snapshot); closeWorldPanel(); }
  catch (error) { message(errorText(error), 'error'); }
}
function showWorldPanel(result) {
  if (!result || ['ok', 'toast'].includes(result.kind)) return;
  if (result.kind === 'notes') {
    if (result.owner !== model.slot().slotId) { message('Notebooks are private. Presenter exports include the group’s saved notes.'); return; }
    els.body.focus(); return;
  }
  const panel = els.panel;
  panel.dataset.kind = result.kind;
  panel.hidden = false; input?.clear();
  const close = '<button class="pd-button pd-button-secondary" type="button" data-close>Close · Esc</button>';
  if (result.kind === 'profile') {
    const slot = model.slot();
    panel.innerHTML = `<h2>Your character</h2><form><label>Name<input name="name" maxlength="80" required value="${escapeHtml(slot.displayName)}"></label><label>Clothing<select name="shirt">${['blue', 'teal', 'cream', 'amber', 'red'].map(v => `<option ${slot.customization.shirt === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Hat<select name="hat">${['none', 'straw', 'cap'].map(v => `<option ${slot.customization.hat === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label><input name="glasses" type="checkbox" ${slot.customization.glasses ? 'checked' : ''}> Glasses</label><div class="pd-actions">${close}<button class="pd-button pd-button-primary">Save character</button></div></form>`;
    panel.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const data = new FormData(event.target);
      try { const value = await model.command('profile', { name: data.get('name'), appearance: { shirt: data.get('shirt'), hat: data.get('hat'), glasses: data.has('glasses') } }); if (value.snapshot) renderGame(value.snapshot); closeWorldPanel(); }
      catch (error) { message(errorText(error), 'error'); }
    };
  } else if (result.kind === 'door') {
    const title = source.routes[result.to]?.title || SCENES[result.to]?.title || result.to;
    panel.innerHTML = `<h2>${escapeHtml(title)}</h2><p>Enter when you are ready. Your notes travel with you.</p><div class="pd-actions">${close}<button class="pd-button pd-button-primary" data-enter>Enter</button></div>`;
    panel.querySelector('[data-enter]').onclick = async () => { if (await worldAction('enter', { target: result.target })) closeWorldPanel(); };
  } else if (result.kind === 'reflection') {
    const route = source.routes[result.route];
    panel.innerHTML = `<h2>${escapeHtml(route.title)}</h2><h3>${HEADINGS[result.index]}</h3><p>${escapeHtml(route.sections[result.index])}</p><p class="pd-muted">Slide ${route.slide} · ${result.route}</p>${close}`;
  } else if (result.kind === 'portrait') {
    const portrait = source.gallery[result.index];
    panel.innerHTML = `<img src="${portrait.image}" alt="${escapeHtml(portrait.name)}"><h2>${escapeHtml(portrait.name)}</h2><p>${escapeHtml(portrait.attribution)}</p><blockquote>${escapeHtml(portrait.quote)}</blockquote>${portrait.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}${close}`;
  } else if (result.kind === 'person') {
    panel.innerHTML = `<h2>${escapeHtml(room.slots[result.owner].displayName)}</h2><div class="pd-actions"><button class="pd-button pd-button-secondary" data-social="hi">Say hi</button><button class="pd-button pd-button-primary" data-social="hold">Hold hands</button>${close}</div>`;
    panel.querySelectorAll('[data-social]').forEach(button => { button.onclick = async () => { await worldAction('social', { target: result.owner, action: button.dataset.social }); closeWorldPanel(); }; });
  } else if (result.kind === 'monitor') {
    if (!model.isPresenter()) { closeWorldPanel(); message('The presenter operates the monitor. You can sit or take notes.'); return; }
    const missing = Object.values(room.slots).filter(slot => slot.connected && (!slot.activity.ready || room.gameplay.players[slot.slotId].scene !== result.room));
    const cubesReady = result.room !== 'J' || room.gameplay.cubes.pairs.every(Boolean);
    panel.innerHTML = `<h2>Studio ${result.room}</h2><p>${missing.length ? 'Waiting for: ' + missing.map(p => escapeHtml(p.displayName)).join(', ') : cubesReady ? 'The connected group is ready.' : 'Complete all three cube matches first.'}</p><p>Slides ${GROUPS[result.room].join('–')} · movement pauses while you present.</p><div class="pd-actions">${close}<button class="pd-button pd-button-primary" data-presentation-start ${missing.length || !cubesReady ? 'disabled' : ''}>Start presentation</button></div>`;
    panel.querySelector('[data-presentation-start]').onclick = () => presentationAction('open');
  } else { closeWorldPanel(); return; }
  panel.querySelector('[data-close]')?.addEventListener('click', closeWorldPanel);
}
async function interactWorld(point) {
  const player = ownPlayer(), world = room?.gameplay;
  if (!player || !world) return;
  const target = point ? targets(world, player.id).filter(t => distance(t, point) < 37 && distance(t, player) <= 48).sort((a, b) => distance(a, point) - distance(b, point))[0] : nearest(world, player.id);
  if (!target && !player.seat) {
    if (player.ride) await worldAction('dismount');
    else if (player.carry) await worldAction('drop');
    else message('Walk closer to an object or colleague.');
    return;
  }
  showWorldPanel(await worldAction('interact', target ? { target: target.id } : {}));
}
function installWorldControls() {
  if (input) return;
  const blocked = () => room?.lifecycle === 'ended' || room?.gameplay?.paused || room?.gameplay?.presentation?.active || !els.panel.hidden || !!document.activeElement?.closest?.('input,textarea,select,[contenteditable="true"]');
  input = installInput(els.canvas, { blocked, interact: interactWorld, escape: closeWorldPanel, release: () => worldAction('release') });
  let last = '', pending = false;
  inputTimer = window.setInterval(async () => {
    if (!model?.connection || pending || room.lifecycle === 'ended') return;
    if (blocked()) input.clear();
    const dx = Number(input.keys.d) - Number(input.keys.a), dy = Number(input.keys.s) - Number(input.keys.w);
    const key = `${dx}:${dy}`;
    if (!dx && !dy && key === last) return;
    pending = true; last = key;
    try { await model.command('move', { dx, dy }); } catch (error) { message(errorText(error), 'error'); }
    finally { pending = false; }
  }, 100);
  els.interact.onclick = () => interactWorld(); els.profile.onclick = () => showWorldPanel({ kind: 'profile' });
  els.release.onclick = () => worldAction('release'); els.drop.onclick = () => worldAction('drop'); els.dismount.onclick = () => worldAction('dismount');
  els.activityStart.onclick = () => worldAction('activity', { action: ownPlayer()?.scene === 'J' ? 'assist' : 'start' });
  els.activityReset.onclick = () => worldAction('activity', { action: 'reset' });
  els.pause.onclick = () => presentationAction(room.gameplay.paused ? 'resume' : 'pause');
  els.closePresentation.onclick = () => presentationAction('close');
  const draw = () => { drawGame(); animation = requestAnimationFrame(draw); }; draw();
  if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) Object.defineProperty(window, 'belOnlineDebug', { configurable: true, value: Object.freeze({ snapshot: () => structuredClone({ room, seatId: model?.slot()?.slotId, target: ownPlayer() ? nearest(room.gameplay, ownPlayer().id) : null }) }) });
  window.addEventListener('pagehide', () => { input?.close(); clearInterval(inputTimer); clearInterval(heartbeatTimer); clearInterval(pollTimer); cancelAnimationFrame(animation); notebook?.flushDraft(); transport?.close(); }, { once: true });
  els.canvas.focus();
}

function bindEvents() {
  els.create.addEventListener('click', createRoom);
  els.joinForm.addEventListener('submit', joinRoom);
  els.copy.addEventListener('click', async () => { if (room) { await navigator.clipboard?.writeText(room.code); els.copy.textContent = 'Copied'; window.setTimeout(() => { els.copy.textContent = 'Copy code'; }, 1200); } });
  els.openGame.addEventListener('click', openGame);
  els.receptionContinue.addEventListener('click', openGame);
  els.start.addEventListener('click', () => model.command('transition', { to: 'playing' }).then(() => transport.room(room.roomId)).then(renderGame).catch(error => message(errorText(error), 'error')));
  els.replace.addEventListener('click', () => connectGame(true));
  els.end.addEventListener('click', async () => { if (!window.confirm('End this room and finalize the retained notes?')) return; try { await notebook?.save(); message('Ending room and finalizing saved notes…'); const ended = await transport.endRoom(room.roomId); renderGame(ended); message(archivePending(ended) ? 'Room ended. Finalizing saved notes; export will wait for the retained PDF.' : 'Room ended by the presenter. Saved notes are ready to export.'); } catch (error) { message(errorText(error), 'error'); } });
  els.skip.addEventListener('click', () => worldAction(ownPlayer()?.scene === 'F' ? 'activity' : 'skip', ownPlayer()?.scene === 'F' ? { action: 'skip' } : {}));
  els.previous.addEventListener('click', () => presentation.previous(room.deck.room || 'A', room.deck.slide).catch(error => message(errorText(error), 'error')));
  els.next.addEventListener('click', () => presentation.next(room.deck.room || 'A', room.deck.slide).catch(error => message(errorText(error), 'error')));
  els.export.addEventListener('click', saveAndDownload);
  $('pd-reveal').addEventListener('click', () => worldAction('slide', { action: 'reveal' }));
  for (const [id, key] of [['pd-show-quotes', 'showQuotes'], ['pd-show-folio', 'showFolio'], ['pd-photo-treatment', 'photoTreatment']]) {
    $(id).addEventListener('change', event => worldAction('slide', { action: 'properties', values: { [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value } }));
  }
  els.deck.addEventListener('load', () => { els.deckStatus.textContent = 'Synchronized with the server-authorized slide state.'; sendDeckState(); });
  window.addEventListener('message', event => {
    if (!room || !els.deck.contentWindow) return;
    if (event.origin !== window.location.origin || event.source !== els.deck.contentWindow || !event.data?.belFrame) return;
      if (event.data.kind === 'ready') { els.deckStatus.textContent = 'Synchronized with the server-authorized slide state.'; sendDeckState(); return; }
      if (event.data.kind === 'error') { els.deckStatus.textContent = `Presentation could not synchronize: ${event.data.message || 'Reload the presentation.'}`; return; }
    if (event.data.kind !== 'action' || !presentation || event.data.roomId !== room.roomId || event.data.contentVersion !== 'bel-working-as-equals-1') return;
    const roomName = room.deck.room || 'A';
    if (['next', 'previous', 'reveal', 'reset-view', 'properties'].includes(event.data.action)) worldAction('slide', { action: event.data.action, ...(event.data.values ? { values: event.data.values } : {}) });
  });

}

async function boot() {
  bindEvents();
  identity = await bootAuth();
  if (!identity) { els.authStatus.textContent = 'Sign-in required'; els.authMessage.innerHTML = `Sign in through the CRM before joining this room. <a href="${signInUrl()}">Go to sign in</a>`; return; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  transport = new PresentationTransport(identity, { failoverOrigins: local ? window.__BEL_PRESENTATION_FAILOVER_ORIGINS || [] : [] });
  transport.onState = state => {
    if (state === 'replaced') {
      if (model) model.connection = null;
      input?.clear(); els.replace.hidden = false;
      els.connection.textContent = 'Connected elsewhere';
      message('This seat is now active on another device. Choose Continue here to return.', 'warning');
      return;
    }
    if (state !== 'connected') input?.clear();
    if (els.connection) els.connection.textContent = state === 'reconnecting' ? 'Reconnecting…' : state === 'connecting' ? 'Connecting…' : state === 'connected' && model?.connection && transport?.connection && transport?.socket?.readyState === WebSocket.OPEN ? `Connected · ${model.connection.seatId}` : 'Disconnected';
  };
  transport.onSnapshot = snapshot => { if (model) renderGame(snapshot); };
  transport.onReconnect = async connection => { if (model) { model.connection = connection; model.setRoom(connection.snapshot); } if (room) renderGame(await transport.room(room.roomId)); message('Room connection restored.'); };
  els.authStatus.textContent = identity.local ? `Local rehearsal · ${identity.uid}` : `Signed in · ${identity.email || identity.uid}`; els.authMessage.textContent = 'Your account identity is checked by the server for every room action.';
  if (!identity.local) window.firebase.auth().onAuthStateChanged(user => {
    if (user?.uid === identity.uid) return;
    transport?.close(); notebook?.close(); input?.clear(); clearInterval(inputTimer); clearInterval(heartbeatTimer); clearInterval(pollTimer);
    room = null; if (model) { model.room = null; model.connection = null; }
    show(els.game, false); show(els.room, false); show(els.entry, true); els.authStatus.textContent = 'Sign-in required';
  });
  [nativeRenderer, source] = await Promise.all([createNativeRenderer(els.canvas), loadSource()]);
  show(els.presenterTools, identity.isAdmin); await loadRoomHistory();
  const params = new URLSearchParams(window.location.search); const roomId = params.get('room');
  if (roomId) { try { room = await transport.room(roomId); if (params.get('game') === '1') await openGameView(); else await loadRoomIntoLobby(room); } catch (error) { els.authMessage.textContent = errorText(error); } }
}

boot().catch(error => { els.authMessage.textContent = errorText(error); });
