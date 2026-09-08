(function (globalScope) {
    'use strict';
    function createController(deps = {}) {
        let projectId = ''; let actorUid = ''; let epoch = 0; let cursor = ''; let signature = '';
        let lane = Promise.resolve(); let timer = null; let queuedPoll = false; let delay = 1500; let disposed = false;
        let pendingPage = null;
        let pendingSnapshot = null;
        const currentUid = () => String(deps.getCurrentUser?.()?.uid || '');
        const visible = () => !globalScope.document?.hidden;
        const scope = () => ({ projectId, actorUid, epoch });
        const current = s => !disposed && s.epoch === epoch && s.projectId === projectId && s.actorUid === currentUid();
        const path = s => `/api/projects/${encodeURIComponent(s.projectId)}/changes`;
        function enqueue(work) { const result = lane.catch(() => {}).then(work); lane = result.catch(() => {}); return result; }
        function stop() { epoch++; projectId = ''; actorUid = ''; cursor = ''; signature = ''; pendingPage = null; pendingSnapshot = null; clearTimeout(timer); timer = null; }
        function select(id) {
            if (projectId === id && actorUid === currentUid()) return;
            stop(); projectId = id; actorUid = currentUid(); delay = 1500;
        }
        function schedule() { clearTimeout(timer); if (!disposed && projectId && visible()) timer = setTimeout(tick, delay); }
        function denied(error, s) {
            if (!current(s)) return;
            if ([401, 403, 404].includes(Number(error?.status))) { stop(); deps.onDenied?.(s.projectId); }
            else { delay = Math.min(30000, delay * 2); deps.onError?.(error); }
        }
        async function handshake(s) {
            const result = await deps.apiFetchJson(path(s));
            if (!current(s)) return false;
            if (!cursor) { cursor = result.cursor; signature = result.authority.signature; }
            return true;
        }
        function transient(error) {
            return [408, 429, 500, 502, 503, 504].includes(Number(error?.status))
                || (error?.name === 'TypeError' && /fetch|network/i.test(String(error.message || '')));
        }
        async function loadSnapshot(record) {
            const { s, load } = record;
            if (!current(s)) return false;
            let handshaken = false;
            try {
                if (!await handshake(s)) return false;
                handshaken = true;
                if (pendingSnapshot === record) pendingSnapshot = null;
                return await load();
            } catch (error) {
                denied(error, s);
                if ([401, 403, 404].includes(Number(error?.status))) return false;
                if (!handshaken && transient(error) && current(s)) {
                    // Retain only the first scoped load, not an unbounded queue
                    // of duplicate attempts. Poll resumes it on the same lane.
                    pendingSnapshot ||= record;
                    return false;
                }
                throw error;
            }
        }
        // Snapshot loads and poll/apply/ack share one lane. A late initial,
        // branch or discussion response cannot overwrite an acknowledged event.
        function snapshot(id, load) {
            select(String(id)); const s = scope();
            return enqueue(async () => {
                if (!current(s)) return false;
                try { return await loadSnapshot({ s, load }); }
                finally { schedule(); }
            });
        }
        async function poll(s) {
            if (!current(s) || !visible()) return;
            if (pendingSnapshot) {
                const record = pendingSnapshot;
                const loaded = await loadSnapshot(record);
                if (!current(s) || pendingSnapshot) return;
                if (loaded === false) {
                    pendingSnapshot = record;
                    delay = Math.min(30000, delay * 2);
                    return;
                }
            }
            if (!cursor && !await handshake(s)) return;
            const fresh = await deps.apiFetchJson(pendingPage ? path(s) : `${path(s)}?cursor=${encodeURIComponent(cursor)}`);
            const result = pendingPage ? { ...pendingPage.result, authority: fresh.authority } : fresh;
            if (!current(s)) return;
            const pendingAuthorityChanged = pendingPage && fresh.authority.signature !== pendingPage.result.authority.signature;
            let hydration = !pendingAuthorityChanged && pendingPage?.hydration || { tasks: [], messages: [], unavailableTaskIds: [], unavailableMessageIds: [] };
            if (pendingAuthorityChanged) result.discussionRefresh = true;
            if ((!pendingPage || pendingAuthorityChanged) && (result.taskIds.length || result.messageIds.length)) {
                try { hydration = await deps.apiFetchJson(`${path(s)}/hydrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: result.taskIds, messageIds: result.messageIds }) }); }
                catch (error) {
                    if (Number(error?.status) !== 413) throw error;
                    result.refresh = true; result.discussionRefresh = true; result.hydrationFallback = true;
                }
            }
            if (!current(s)) return;
            pendingPage = { result, hydration };
            const applied = await deps.apply({ ...result, hydration, authorityChanged: result.authority.signature !== signature, isCurrent: () => current(s) });
            if (!current(s)) return;
            if (applied === false) { delay = 100; return; }
            // The only advancing acknowledgement: all bounded hydration and
            // exceptional reconciliation above have completed successfully.
            cursor = result.cursor; signature = result.authority.signature; pendingPage = null;
            delay = result.hasMore ? 25 : 1500;
        }
        function tick() {
            if (queuedPoll || !projectId || disposed) return;
            if (actorUid !== currentUid()) { const oldProjectId = projectId; stop(); deps.onDenied?.(oldProjectId); return; }
            const s = scope(); queuedPoll = true;
            enqueue(() => poll(s)).catch(error => denied(error, s)).finally(() => { queuedPoll = false; schedule(); });
        }
        function visibilityChanged() { if (visible()) tick(); else clearTimeout(timer); }
        globalScope.document?.addEventListener('visibilitychange', visibilityChanged);
        return { snapshot, tick, stop, dispose() { stop(); disposed = true; globalScope.document?.removeEventListener('visibilitychange', visibilityChanged); }, getState: () => ({ projectId, actorUid, epoch, cursor, signature, queuedPoll }) };
    }
    globalScope.CrmProjectsRemoteObserver = { createController };
    if (typeof module !== 'undefined') module.exports = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
