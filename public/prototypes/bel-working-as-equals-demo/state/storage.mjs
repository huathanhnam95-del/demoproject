import { validateBundle, isId, isToken, keys } from './session.mjs';
import { assertSeat, check, fail } from './progression.mjs';

function read(storage, key, validate, corruptCode) {
  let raw;
  try { raw = storage.getItem(key); } catch { fail('STORAGE_UNAVAILABLE'); }
  if (raw === null) return null;
  try { return validate(JSON.parse(raw)); } catch { fail(corruptCode, `${corruptCode}: ${key}`); }
}

function write(storage, key, value) {
  // A single localStorage setItem is atomic on failure; no remove-then-write.
  try { storage.setItem(key, JSON.stringify(value)); } catch { fail('PERSISTENCE_FAILED'); }
}

function remove(storage, key) {
  try { storage.removeItem(key); } catch { fail('PERSISTENCE_FAILED'); }
}

export function createHostStore(storage, sessionId) {
  check(isId(sessionId));
  const key = `bel-host:v1:${sessionId}`;
  function validate(bundle) {
    validateBundle(bundle);
    check(bundle.state.id === sessionId, 'WRONG_SESSION');
    return bundle;
  }
  return {
    load: () => read(storage, key, validate, 'CORRUPT_SAVE'),
    save(bundle) { validate(bundle); write(storage, key, bundle); }
  };
}

// Supply tab-local storage (normally sessionStorage) for seat credentials. Keep
// this invitation in the presenter view and assigned tab, never in shared state.
export function createResumeStore(storage, sessionId) {
  check(isId(sessionId));
  const key = `bel-resume:v1:${sessionId}`;
  function validate(invitation) {
    keys(invitation, ['sessionId', 'actorId', 'token']);
    assertSeat(invitation.actorId);
    check(invitation.sessionId === sessionId && isToken(invitation.token));
    return invitation;
  }
  return {
    load: () => read(storage, key, validate, 'CORRUPT_RESUME'),
    save(invitation) { validate(invitation); write(storage, key, invitation); },
    remove: () => remove(storage, key)
  };
}

// Drafts never enter a host snapshot. Retain expectedVersion when editing a saved
// page so reconnect cannot disguise an actual conflict. Renderer treats text as
// text, not HTML; nearby-note presentation is a future world/UI responsibility.
export function createDraftStore(storage, sessionId, actorId) {
  check(isId(sessionId));
  assertSeat(actorId);
  function key(pageId) {
    check(isId(pageId));
    return `bel-draft:v1:${sessionId}:${actorId}:${pageId}`;
  }
  function validate(draft) {
    keys(draft, ['title', 'body', 'expectedVersion'], ['title', 'body']);
    check(typeof draft.title === 'string' && draft.title.length <= 200 && typeof draft.body === 'string' && draft.body.length <= 50000);
    if (Object.hasOwn(draft, 'expectedVersion')) check(Number.isSafeInteger(draft.expectedVersion) && draft.expectedVersion >= 0);
    return draft;
  }
  return {
    load: pageId => read(storage, key(pageId), validate, 'CORRUPT_DRAFT'),
    save(pageId, draft) { validate(draft); write(storage, key(pageId), draft); },
    remove: pageId => remove(storage, key(pageId))
  };
}
