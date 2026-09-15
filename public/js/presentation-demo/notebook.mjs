function draftKey(roomId, uid, pageId) { return `bel.presentation.draft:${uid}:${roomId}:${pageId}`; }
function pageCatalogKey(roomId, uid) { return `bel.presentation.pages:${uid}:${roomId}`; }
function pageSelectionKey(roomId, uid) { return `bel.presentation.activePage:${uid}:${roomId}`; }

export function bindNotebook({ transport, roomId, identity, elements }) {
  let version = 0;
  let pageId = 'main';
  let pages = [];
  let hasSelection = false;
  let editGeneration = 0;
  let saving = null;
  let autosaveTimer = 0, readOnly = false, conflicted = false;
  const pendingOperations = new Map();
  const pageSelect = document.createElement('select');
  pageSelect.id = 'pd-note-page';
  pageSelect.setAttribute('aria-label', 'Note page');
  const newPage = document.createElement('button');
  newPage.type = 'button';
  newPage.className = 'pd-button pd-button-secondary';
  newPage.textContent = 'New page';
  elements.title.before(pageSelect);
  elements.title.before(newPage);

  function renderPageList() {
    pageSelect.replaceChildren(...pages.map(page => { const option = document.createElement('option'); option.value = page.id; option.textContent = page.title || page.id; return option; }));
    if (!pages.some(page => page.id === pageId)) { const option = document.createElement('option'); option.value = pageId; option.textContent = 'New observation'; pageSelect.append(option); }
    pageSelect.value = pageId;
  }
  function readPageCatalog() {
    try {
      const value = JSON.parse(localStorage.getItem(pageCatalogKey(roomId, identity.uid)) || '[]');
      return Array.isArray(value) ? value.filter(page => page && /^[A-Za-z0-9:_-]{1,128}$/.test(page.id)) : [];
    } catch (_) { return []; }
  }
  function persistPageCatalog() {
    try { localStorage.setItem(pageCatalogKey(roomId, identity.uid), JSON.stringify(pages.map(({ id, title, version }) => ({ id, title, version })))); } catch (_) { /* storage is best effort */ }
  }
  function readPageSelection() {
    try { return localStorage.getItem(pageSelectionKey(roomId, identity.uid)) || ''; } catch (_) { return ''; }
  }
  function persistPageSelection() {
    try { localStorage.setItem(pageSelectionKey(roomId, identity.uid), pageId); } catch (_) { /* storage is best effort */ }
  }
  function restoreDraft() {
    try {
      const raw = localStorage.getItem(draftKey(roomId, identity.uid, pageId));
      if (!raw) return false;
      const draft = JSON.parse(raw);
      if (typeof draft.title === 'string') elements.title.value = draft.title;
      if (typeof draft.body === 'string') elements.body.value = draft.body;
      elements.status.textContent = 'Draft restored';
      return true;
    } catch (_) { return false; }
  }
  function persistDraft(forPageId = pageId, values = { title: elements.title.value, body: elements.body.value }) {
    try { localStorage.setItem(draftKey(roomId, identity.uid, forPageId), JSON.stringify({ title: values.title, body: values.body, savedAt: Date.now() })); } catch (_) { /* storage is best effort */ }
  }
  function flushDraft(forPageId = pageId) {
    window.clearTimeout(draftTimer);
    if (forPageId === pageId) persistDraft(forPageId);
  }
  function selectPage(nextId, { restoreLocalDraft = true } = {}) {
    window.clearTimeout(autosaveTimer); conflicted = false;
    if (hasSelection) flushDraft(pageId);
    editGeneration += 1;
    pageId = nextId || 'main';
    persistPageSelection();
    const page = pages.find(value => value.id === pageId);
    version = page?.version || 0;
    elements.title.value = page?.title || '';
    elements.body.value = page?.body || '';
    if (restoreLocalDraft) restoreDraft();
    renderPageList();
    hasSelection = true;
  }
  async function load() {
    const result = await transport.readNotes(roomId);
    const serverPages = result.pages || [];
    const localCatalog = readPageCatalog();
    pages = [...serverPages].sort((a, b) => a.id.localeCompare(b.id));
    persistPageCatalog();
    const selectedPageId = readPageSelection();
    pageId = pages.some(page => page.id === selectedPageId) ? selectedPageId : (pages[0]?.id || 'main');
    const serverPage = pages.find(page => page.id === pageId);
    const localPage = localCatalog.find(page => page.id === pageId);
    const restoreLocalDraft = Boolean(serverPage) && (!localPage || Number(serverPage.version) >= Number(localPage.version));
    selectPage(pageId, { restoreLocalDraft });
  }
  async function save() {
    window.clearTimeout(autosaveTimer);
    if (readOnly) return;
    if (saving) { await saving; return save(); }
    const savedPageId = pageId;
    const savedVersion = version;
    const savedValues = { title: elements.title.value.trim() || 'Observation', body: elements.body.value };
    const saveGeneration = editGeneration;
    const current = pages.find(page => page.id === savedPageId);
    if (current?.version && current.title === savedValues.title && current.body === savedValues.body) { elements.status.textContent = 'Saved'; return current; }
    const fingerprint = JSON.stringify({ savedPageId, savedVersion, savedValues });
    const operationId = pendingOperations.get(fingerprint) || crypto.randomUUID();
    pendingOperations.set(fingerprint, operationId);
    elements.status.textContent = 'Saving…';
    const pending = transport.saveNote(roomId, { operationId, pageId: savedPageId, ...savedValues, expectedVersion: savedVersion });
    saving = pending;
    let page;
    try { page = await pending; }
    catch (error) {
      if (pageId === savedPageId) flushDraft();
      if (error.code === 'NOTE_CONFLICT') {
        conflicted = true;
        const latest = await transport.readNotes(roomId);
        const saved = latest.pages?.find(value => value.id === savedPageId);
        let conflict = document.getElementById?.('pd-note-conflict');
        if (!conflict) { conflict = document.createElement('pre'); conflict.id = 'pd-note-conflict'; elements.status.before(conflict); }
        conflict.textContent = 'Current saved page (version ' + (saved?.version || 0) + ')\n' + (saved?.title || '') + '\n' + (saved?.body || '') + '\nYour draft is kept above. Reconcile it, then press Save.';
        if (pageId === savedPageId) version = saved?.version || 0;
      }
      elements.status.textContent = error.code === 'NOTE_CONFLICT' ? 'Conflict · your draft is kept' : 'Offline draft · not saved to the server';
      throw error;
    } finally { saving = null; }
    pendingOperations.delete(fingerprint);
    conflicted = false;
    const conflict = document.getElementById?.('pd-note-conflict'); if (conflict) conflict.remove();
    pages = [...pages.filter(value => value.id !== page.id), page].sort((a, b) => a.id.localeCompare(b.id));
    persistPageCatalog();
    const stillCurrent = pageId === savedPageId && editGeneration === saveGeneration;
    if (stillCurrent) localStorage.removeItem(draftKey(roomId, identity.uid, savedPageId));
    if (pageId === savedPageId) {
      version = page.version;
      if (stillCurrent) { elements.title.value = page.title; elements.body.value = page.body; }
    }
    renderPageList();
    elements.status.textContent = stillCurrent ? 'Saved' : 'Saved older draft · newer edits kept';
    return page;
  }
  let draftTimer = 0;
  const scheduleDraft = () => {
    editGeneration += 1; const forPageId = pageId; const values = { title: elements.title.value, body: elements.body.value };
    window.clearTimeout(draftTimer); draftTimer = window.setTimeout(() => persistDraft(forPageId, values), 200);
    window.clearTimeout(autosaveTimer);
    if (!readOnly && !conflicted) { elements.status.textContent = 'Draft · waiting to save'; autosaveTimer = window.setTimeout(() => save().catch(() => {}), 1000); }
  };
  pageSelect.addEventListener('change', () => selectPage(pageSelect.value));
  newPage.addEventListener('click', () => { const nextId = `page-${crypto.randomUUID()}`; pages.push({ id: nextId, title: '', body: '', version: 0 }); persistPageCatalog(); selectPage(nextId); });
  elements.title.addEventListener('input', scheduleDraft);
  elements.body.addEventListener('input', scheduleDraft);
  elements.save.addEventListener('click', () => save().catch(error => { elements.status.textContent = error.message; }));
  function setReadOnly(value) {
    readOnly = value;
    for (const element of [elements.title, elements.body, elements.save, newPage]) element.disabled = value;
    if (value) { window.clearTimeout(autosaveTimer); flushDraft(); elements.status.textContent = 'Room ended · saved notebook is read-only'; }
  }
  function close() { flushDraft(); window.clearTimeout(autosaveTimer); setReadOnly(true); pendingOperations.clear(); pages = []; elements.title.value = ''; elements.body.value = ''; }
  return { load, save, persistDraft, flushDraft, selectPage, setReadOnly, close };
}
