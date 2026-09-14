import { bootAuth, signInUrl } from './auth.mjs';
import { PresentationTransport } from './transport.mjs';
import { PresentationViewModel } from './view-model.mjs';
import { bindNotebook } from './notebook.mjs';
import { createPresentationAdapter } from './presentation/adapter.mjs';
import { SCENES, SHAPES } from './core/world/scenes.mjs';
import { createRenderer as createNativeRenderer } from '../../prototypes/bel-working-as-equals-demo/world/renderer.mjs';

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
let artImage = null;
let nativeRenderer = null;

function show(element, visible) { element.hidden = !visible; }
function message(text, tone = 'info') { els.gameMessage.textContent = text; els.gameMessage.dataset.tone = tone; }
function errorText(error) { return error?.message || 'The online room request failed.'; }

function renderRoomHistory(rooms = []) {
  if (!els.roomHistory) return;
  els.roomHistory.replaceChildren();
  if (!rooms.length) { els.roomHistory.textContent = 'No active or completed rooms yet.'; return; }
  const heading = document.createElement('p'); heading.className = 'pd-kicker'; heading.textContent = 'Your rooms'; els.roomHistory.append(heading);
  for (const value of rooms) {
    const row = document.createElement('div'); row.className = 'pd-history-row';
    const label = document.createElement('span'); label.textContent = `${value.code} · ${value.lifecycle}`;
    const actions = document.createElement('span'); actions.className = 'pd-history-actions';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'pd-button pd-button-secondary'; open.textContent = value.lifecycle === 'ended' ? 'View archive' : 'Open room';
    open.addEventListener('click', async () => {
      if (value.lifecycle === 'ended') {
        try { const archive = await transport.readArchive(value.roomId); label.textContent = `${value.code} · archived · ${Object.keys(archive.notebooks || {}).length} notebook(s)`; } catch (error) { label.textContent = errorText(error); }
      } else await loadRoomIntoLobby(value);
    });
    actions.append(open);
    if (value.lifecycle === 'ended') {
      const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'pd-button pd-button-secondary'; exportButton.textContent = 'Export PDF';
      exportButton.addEventListener('click', async () => {
        try { const blob = await transport.exportPdf(value.roomId); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `bel-presentation-${value.roomId}.pdf`; link.click(); URL.revokeObjectURL(link.href); label.textContent = `${value.code} · archived · export downloaded`; } catch (error) { label.textContent = errorText(error); }
      });
      actions.append(exportButton);
    }
    row.append(label, actions); els.roomHistory.append(row);
  }
}

function slotMarkup(slot) {
  const label = slot.uid ? (slot.uid === identity?.uid ? `${slot.displayName} (you)` : slot.displayName) : 'Open participant seat';
  const status = slot.uid ? (slot.connected ? 'Connected' : 'Reserved') : 'Open';
  return `<div class="pd-slot"><div><div class="pd-slot-name">${label}</div><div class="pd-slot-meta">${slot.slotId} · ${slot.role}</div></div><span class="pd-slot-badge">${status}</span></div>`;
}

function renderSlots(target, currentRoom) {
  target.innerHTML = Object.values(currentRoom?.slots || {}).map(slotMarkup).join('');
}

function renderRoom(currentRoom) {
  room = currentRoom;
  els.roomCode.textContent = currentRoom.code;
  els.roomStatus.textContent = currentRoom.lifecycle === 'ended' ? `Room ended · ${currentRoom.endReason || 'completed'}` : `You are ${Object.values(currentRoom.slots).find(slot => slot.uid === identity.uid)?.role || 'a participant'}.`;
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

function drawGame() {
  if (nativeRenderer && room) {
    const players = Object.fromEntries(Object.values(room.slots || {}).filter(slot => slot.uid).map(slot => [slot.slotId, {
      id: slot.slotId, x: slot.position.x, y: slot.position.y, scene: slot.scene, instance: slot.instanceId,
      pose: 'idle', facing: 'right', distance: 0, waveUntil: 0, resetUntil: 0, transitionUntil: 0,
      ride: null, leader: slot.relationship?.leader, follower: slot.relationship?.follower,
      carry: slot.relationship?.carry, seat: null
    }]));
    const base = { players: Object.fromEntries(Object.values(room.slots || {}).filter(slot => slot.uid).map(slot => [slot.slotId, {
      id: slot.slotId, name: slot.displayName, connected: slot.connected, ready: slot.activity?.ready === true,
      appearance: slot.customization || { hat: 'none', glasses: false, shirt: 'teal' }
    }])) };
    const active = players[Object.values(room.slots || {}).find(slot => slot.uid === identity?.uid)?.slotId || 'p0'] || players.p0;
    const gameplay = room.gameplay || {};
    const routes = gameplay.routes || Object.fromEntries(['B1', 'B2', 'B3'].map(sceneId => [sceneId, SHAPES.map((shapeName, index) => ({ id: `shape-${index}`, shape: shapeName, index, ...SCENES[sceneId].shapeSpawns[index], owner: null, placed: false }))]));
    const bridge = gameplay.bridge || { planks: [] };
    const reversal = gameplay.reversal || { phase: 'gathering', index: 0, remaining: 0, results: [], debuffs: {} };
    const cubes = gameplay.cubes || { pairs: [false, false, false], matchedAt: [], cubes: [] };
    nativeRenderer.draw({ players, routes, unlocked: gameplay.unlocked || {}, bridge, reversal, cubes }, base, active.id, Date.now(), { objectives: gameplay.objectives || [] });
    return;
  }
  const context = els.canvas.getContext('2d');
  if (!context || !room) return;
  context.clearRect(0, 0, els.canvas.width, els.canvas.height);
  context.fillStyle = '#dcebe5'; context.fillRect(0, 0, els.canvas.width, els.canvas.height);
  if (artImage?.complete && artImage.naturalWidth) context.drawImage(artImage, 0, 0, els.canvas.width, els.canvas.height);
  context.fillStyle = 'rgba(255,255,255,.28)'; context.fillRect(0, 0, els.canvas.width, els.canvas.height);
  for (const slot of Object.values(room.slots || {})) {
    if (!slot.uid) continue;
    const point = slot.position || { x: 100, y: 220 };
    context.beginPath(); context.arc(Math.max(12, Math.min(988, point.x)), Math.max(12, Math.min(468, point.y)), 13, 0, Math.PI * 2);
    context.fillStyle = slot.uid === identity.uid ? '#157a3b' : slot.role === 'presenter' ? '#a05a25' : '#2d6f9f'; context.fill();
    context.fillStyle = '#18302d'; context.font = '12px sans-serif'; context.textAlign = 'center'; context.fillText(slot.slotId, point.x, point.y - 19);
  }
  context.textAlign = 'left';
}

function sendDeckState(currentRoom = room) {
  if (!currentRoom || !els.deck?.contentWindow) return;
  els.deck.contentWindow.postMessage({ belApp: true, deck: currentRoom.deck }, window.location.origin);
}

function renderGame(currentRoom) {
  room = currentRoom;
  els.gameCode.textContent = currentRoom.code;
  renderSlots(els.gameSlots, currentRoom);
  const joined = ['p1', 'p2', 'p3'].every(slotId => currentRoom.slots[slotId]?.uid);
  els.gate.textContent = currentRoom.lifecycle === 'reception' ? (joined ? 'Reception ready · presenter can continue' : 'Waiting for all three participants to join') : currentRoom.lifecycle === 'ended' ? 'This room has ended' : `Scene: ${currentRoom.deck?.room || 'reception'} · Revision ${currentRoom.revision}`;
  show(els.skip, model?.isPresenter() && currentRoom.lifecycle === 'playing');
  show(els.end, model?.isPresenter() && currentRoom.lifecycle !== 'ended');
  show(els.start, model?.isPresenter() && currentRoom.lifecycle === 'reception' && !!currentRoom.allParticipantsJoinedAt);
  show(els.previous, model?.isPresenter()); show(els.next, model?.isPresenter());
  els.connection.textContent = transport?.state === 'reconnecting' ? 'Reconnecting…' : model?.connection ? `Connected · ${model.connection.seatId}` : 'Disconnected';
  els.receptionContinue.disabled = !joined;
  drawGame();
  if (!els.deck.src) els.deck.src = '/presentation-demo/native/deck.html';
  sendDeckState(currentRoom);
  if (!artImage || artImage.dataset.scene !== (currentRoom.deck?.room || 'reception')) {
    const scene = currentRoom.deck?.room || 'reception';
    artImage = new Image(); artImage.dataset.scene = scene; artImage.src = `/prototypes/bel-working-as-equals-demo/art/${scene}.png`; artImage.onload = drawGame;
  }
}

async function connectGame(replaceExisting = false) {
  try {
    els.connection.textContent = 'Connecting…';
    await model.connect({ replaceExisting });
    els.replace.hidden = true;
    await transport.bootstrap(room.roomId);
    renderGame(await transport.room(room.roomId));
    notebook = bindNotebook({ transport, roomId: room.roomId, identity, elements: { title: els.title, body: els.body, save: els.saveNote, status: els.noteStatus } });
    await notebook.load();
    message('Online transport connected. Movement and presentation commands are server-authorized.');
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
  }, 900);
}

async function openGameView() {
  show(els.entry, false); show(els.room, false); show(els.game, true);
  model = new PresentationViewModel({ transport, identity }); model.setRoom(room); presentation = createPresentationAdapter({ model });
  await connectGame(false); startPolling();
}

async function loadRoomIntoLobby(nextRoom) { renderRoom(nextRoom); show(els.entry, false); show(els.room, true); window.history.replaceState(null, '', `/presentation-demo/index.html?room=${encodeURIComponent(nextRoom.roomId)}`); }

async function createRoom() {
  try { await loadRoomIntoLobby(await transport.createRoom()); } catch (error) { els.authMessage.textContent = errorText(error); }
}

async function loadRoomHistory() {
  if (!identity?.isAdmin && identity?.moduleGrants?.projects !== true) return;
  try { renderRoomHistory(await transport.rooms()); } catch (_) { if (els.roomHistory) els.roomHistory.textContent = 'Room history is unavailable.'; }
}

async function joinRoom(event) {
  event.preventDefault();
  els.joinError.hidden = true;
  try { await loadRoomIntoLobby((await transport.join(els.codeInput.value)).snapshot); } catch (error) { els.joinError.textContent = errorText(error); els.joinError.hidden = false; }
}

async function saveAndDownload() {
  try { const blob = await transport.exportPdf(room.roomId); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `bel-presentation-${room.roomId}.pdf`; link.click(); URL.revokeObjectURL(link.href); message('PDF export downloaded. It contains only the notes you are authorized to export.'); } catch (error) { message(errorText(error), 'error'); }
}

function bindEvents() {
  els.create.addEventListener('click', createRoom);
  els.joinForm.addEventListener('submit', joinRoom);
  els.copy.addEventListener('click', async () => { if (room) { await navigator.clipboard?.writeText(room.code); els.copy.textContent = 'Copied'; window.setTimeout(() => { els.copy.textContent = 'Copy code'; }, 1200); } });
  els.openGame.addEventListener('click', openGame);
  els.receptionContinue.addEventListener('click', openGame);
  els.start.addEventListener('click', () => model.command('transition', { to: 'playing' }).then(() => transport.room(room.roomId)).then(renderGame).catch(error => message(errorText(error), 'error')));
  els.replace.addEventListener('click', () => connectGame(true));
  els.end.addEventListener('click', async () => { if (!window.confirm('End this room and finalize the retained notes?')) return; try { await transport.endRoom(room.roomId); renderGame(await transport.room(room.roomId)); message('Room ended by the presenter.'); } catch (error) { message(errorText(error), 'error'); } });
  els.skip.addEventListener('click', () => model.command('activity', { action: 'skip' }).catch(error => message(errorText(error), 'error')));
  els.previous.addEventListener('click', () => presentation.previous(room.deck.room || 'A', room.deck.slide).catch(error => message(errorText(error), 'error')));
  els.next.addEventListener('click', () => presentation.next(room.deck.room || 'A', room.deck.slide).catch(error => message(errorText(error), 'error')));
  els.export.addEventListener('click', saveAndDownload);
  els.deck.addEventListener('load', () => { els.deckStatus.textContent = 'Synchronized with the server-authorized slide state.'; sendDeckState(); });
  window.addEventListener('message', event => {
    if (!room || !els.deck.contentWindow) return;
    if (event.origin !== window.location.origin || event.source !== els.deck.contentWindow || !event.data?.belFrame) return;
    if (event.data.kind === 'ready') { els.deckStatus.textContent = 'Synchronized with the server-authorized slide state.'; sendDeckState(); return; }
    if (event.data.kind !== 'action' || !presentation) return;
    const roomName = room.deck.room || 'A';
    if (event.data.action === 'next') presentation.next(roomName, room.deck.slide).catch(error => message(errorText(error), 'error'));
    if (event.data.action === 'previous') presentation.previous(roomName, room.deck.slide).catch(error => message(errorText(error), 'error'));
  });
  const keys = new Set();
  window.addEventListener('keydown', event => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (editing) return;
    if (['w', 'a', 's', 'd'].includes(event.key.toLowerCase())) { keys.add(event.key.toLowerCase()); event.preventDefault(); }
    if (event.key.toLowerCase() === 'f' && model?.connection) model.command('setReady', { ready: true }).catch(() => {});
  });
  window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  window.setInterval(() => { if (!model?.connection || !keys.size) return; const dx = Number(keys.has('d')) - Number(keys.has('a')); const dy = Number(keys.has('s')) - Number(keys.has('w')); if (dx || dy) model.command('move', { dx, dy }).catch(() => {}); }, 100);
}

async function boot() {
  bindEvents();
  identity = await bootAuth();
  if (!identity) { els.authStatus.textContent = 'Sign-in required'; els.authMessage.innerHTML = `Sign in through the CRM before joining this room. <a href="${signInUrl()}">Go to sign in</a>`; return; }
  transport = new PresentationTransport(identity, { failoverOrigins: window.__BEL_PRESENTATION_FAILOVER_ORIGINS || [] });
  transport.onState = state => { if (els.connection) els.connection.textContent = state === 'reconnecting' ? 'Reconnecting…' : state === 'connecting' ? 'Connecting…' : state === 'connected' && model?.connection ? `Connected · ${model.connection.seatId}` : 'Disconnected'; };
  transport.onReconnect = async connection => { if (model) { model.connection = connection; model.sequence = 0; } if (room) renderGame(await transport.room(room.roomId)); message('Room connection restored.'); };
  els.authStatus.textContent = identity.local ? `Local rehearsal · ${identity.uid}` : `Signed in · ${identity.email || identity.uid}`; els.authMessage.textContent = 'Your account identity is checked by the server for every room action.';
  try { nativeRenderer = await createNativeRenderer(els.canvas); } catch (error) { console.warn('[Presentation Demo] Native renderer unavailable:', error); }
  show(els.presenterTools, identity.isAdmin); await loadRoomHistory();
  const params = new URLSearchParams(window.location.search); const roomId = params.get('room');
  if (roomId) { try { room = await transport.room(roomId); if (params.get('game') === '1') await openGameView(); else await loadRoomIntoLobby(room); } catch (error) { els.authMessage.textContent = errorText(error); } }
}

boot().catch(error => { els.authMessage.textContent = errorText(error); });
