export function bindNotebook({ transport, roomId, elements }) {
  let version = 0;
  async function load() {
    const result = await transport.readNotes(roomId);
    const page = result.pages?.[0];
    version = page?.version || 0;
    if (page) { elements.title.value = page.title; elements.body.value = page.body; }
  }
  async function save() {
    const page = await transport.saveNote(roomId, { pageId: 'main', title: elements.title.value.trim() || 'Observation', body: elements.body.value, expectedVersion: version });
    version = page.version;
    elements.status.textContent = 'Saved';
    return page;
  }
  elements.save.addEventListener('click', () => save().catch(error => { elements.status.textContent = error.message; }));
  return { load, save };
}
