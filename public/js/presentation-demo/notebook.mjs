function draftKey(roomId, uid, pageId) { return `bel.presentation.draft:${uid}:${roomId}:${pageId}`; }

export function bindNotebook({ transport, roomId, identity, elements }) {
  let version = 0;
  let pageId = 'main';
  let pages = [];
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
  function persistDraft() {
    try { localStorage.setItem(draftKey(roomId, identity.uid, pageId), JSON.stringify({ title: elements.title.value, body: elements.body.value, savedAt: Date.now() })); } catch (_) { /* storage is best effort */ }
  }
  function selectPage(nextId) {
    pageId = nextId || 'main';
    const page = pages.find(value => value.id === pageId);
    version = page?.version || 0;
    elements.title.value = page?.title || '';
    elements.body.value = page?.body || '';
    restoreDraft();
    renderPageList();
  }
  async function load() {
    const result = await transport.readNotes(roomId);
    pages = result.pages || [];
    pageId = pages[0]?.id || 'main';
    selectPage(pageId);
  }
  async function save() {
    const page = await transport.saveNote(roomId, { pageId, title: elements.title.value.trim() || 'Observation', body: elements.body.value, expectedVersion: version });
    version = page.version;
    pages = [...pages.filter(value => value.id !== page.id), page].sort((a, b) => a.id.localeCompare(b.id));
    localStorage.removeItem(draftKey(roomId, identity.uid, pageId));
    renderPageList();
    elements.status.textContent = 'Saved';
    return page;
  }
  let draftTimer = 0;
  const scheduleDraft = () => { window.clearTimeout(draftTimer); draftTimer = window.setTimeout(persistDraft, 200); };
  pageSelect.addEventListener('change', () => selectPage(pageSelect.value));
  newPage.addEventListener('click', () => { pageId = `page-${Date.now()}`; pages.push({ id: pageId, title: '', body: '', version: 0 }); selectPage(pageId); });
  elements.title.addEventListener('input', scheduleDraft);
  elements.body.addEventListener('input', scheduleDraft);
  elements.save.addEventListener('click', () => save().catch(error => { elements.status.textContent = error.message; }));
  return { load, save, persistDraft };
}
