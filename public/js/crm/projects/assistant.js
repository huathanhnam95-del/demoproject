(function (globalScope) {
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    function createController({ root, apiFetchJson, getCurrentUser, getContext, onApplied = () => {}, onUsageChanged = () => {}, onAutomationDraft = () => {}, transportFactory } = {}) {
        let actor = '', hints = {}, contextKey = '', generation = 0, voiceGeneration = 0, disposed = false, initialized = false, busy = false;
        let instruction = '', answer = '', notices = [], status = '', config = null, draft = null, preview = null, actionId = '', transport = null, prepared = null, abort = null, stream = null, voiceActive = false, voiceFinishing = false;
        let creationMode = false, creationSourceProject = '', responseAudioMuted = false;
        const effectiveContext = () => creationMode && (getContext()?.projectId || '') === creationSourceProject ? { mode: 'create_project' } : (getContext() || {});
        const hasContext = () => !!hints.projectId || hints.mode === 'create_project';
        const transcripts = new Set(), proofs = new Set();
        const uid = () => getCurrentUser()?.uid || '';
        function refreshUsage(owner) { if (!disposed && owner && owner === actor && owner === uid()) { try { Promise.resolve(onUsageChanged()).catch(() => {}); } catch (_) { /* Usage refresh must not interrupt assistance. */ } } }
        const draftId = () => draft?.draftId || draft?.id || null;
        const storageKey = () => `crm-projects-assistant:${actor}:${hints.projectId || hints.mode || ''}`;
        function remember() { try { if (draftId()) globalScope.sessionStorage?.setItem(storageKey(), draftId()); } catch (_) { /* Optional recovery reference. */ } }
        function current(epoch) { return !disposed && generation === epoch && actor === uid() && stable(effectiveContext()) === contextKey; }
        const requestId = () => globalScope.crypto.randomUUID();
        function contextHints() { return { ...clone(hints), ...(draftId() && preview ? { draftId: draftId(), previewId: preview.previewId } : {}) }; }
        function describe(action) {
            if (action.kind === 'create_project') return `Create project: ${action.project.name}${action.project.description ? ' — ' + action.project.description : ''}`;
            if (action.kind === 'create_task') return `Create task: ${action.task.title} in ${action.parentTaskId ? 'parent ' + action.parentTaskId : 'section ' + action.sectionId}. ${Object.entries(action.task).filter(([key]) => key !== 'title').map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1')}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('; ')}`;
            if (action.kind === 'move_task') return `Move ${action.taskTitle || action.taskId || 'task'} under ${action.parentTaskTitle || action.parentTaskId || 'the project'}`;
            const fields = Object.entries(action.patch || {}).map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1')}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('; ');
            return `${action.kind === 'update_project' ? 'Project' : action.taskTitle || action.taskId || 'Task'}${fields ? ` — ${fields}` : ''}`;
        }
        function impactText(impact) {
            if (!impact) return '';
            if (typeof impact === 'string') return impact;
            if (impact.command === 'createTask' && impact.task) return describe({ kind: 'create_task', task: Object.fromEntries(['title', 'status', 'ownerUid', 'assigneeUids', 'startDate', 'dueDate', 'values'].filter(key => impact.task[key] !== undefined).map(key => [key, impact.task[key]])), sectionId: impact.task.sectionId, parentTaskId: impact.task.parentTaskId });
            if (impact.command === 'createProject' && impact.project) return `Create ${impact.project.name}. ${impact.project.description || ''} You will be the project Owner.`;
            if (impact.command === 'updateProject' && impact.project) return `Project: ${impact.project.name}. ${impact.project.description || ''}`;
            if (impact.kind === 'moveBatch') return `Move ${(impact.moves || []).map(row => row.taskId).join(', ')} under ${impact.destination?.parentTaskId || 'the destination'}, position ${(impact.destination?.index ?? 0) + 1}. Descendant tasks stay with their moved parent.`;
            return (impact.schedule || []).map(row => `${row.taskId}: ${row.startDate || 'No start date'} to ${row.dueDate || 'No due date'}; ${row.workingDayCount ?? 'unknown'} working days. ${(row.nonWorkingDays || []).length} non-working days. ${(row.warnings || []).map(warning => String(warning.code || 'Schedule warning').replace(/_/g, ' ').toLowerCase()).join('; ')}`).join('\n');
        }
        function invalidatePreview() { generation++; preview = null; busy = false; void stopVoice(); status = 'Project data changed. Create a fresh preview before confirming.'; render(); }
        function render() {
            if (disposed) return;
            const expanded = root.querySelector?.('details')?.open ?? false;
            const actions = draft?.actions || [];
            root.innerHTML = `<details ${expanded ? 'open' : ''}><summary>Project assistance</summary><button type="button" data-assistant-action="creation" ${busy || !actor ? 'disabled' : ''}>${creationMode ? 'Use current project' : 'Create a new project'}</button><p>${escape((hints.selectedTaskIds || []).length)} selected tasks · ${escape(hints.view || 'board')} view</p><p>${config?.nativePaidAvailable ? 'Voice assistance is available. Usage is monitored against your monthly target; some costs may remain provisional.' : config?.engineeringOnly ? 'Engineering voice test. Native paid assistance is unavailable.' : 'Native paid assistance is unavailable.'}</p><label>Instructions<textarea data-assistant-instruction maxlength="8000">${escape(instruction)}</textarea></label><div>${[['plan', 'Plan'], ['draft', 'Draft changes'], ['automation', 'Propose automation']].map(([key, label]) => `<button type="button" data-assistant-action="${key}" ${busy || !actor || !hasContext() ? 'disabled' : ''}>${label}</button>`).join('')}</div><p role="status" aria-live="polite">${escape(status)}</p><p data-assistant-answer>${escape(answer)}</p><ul>${notices.map(note => `<li>${escape(note)}</li>`).join('')}</ul>${draft ? `<h4>Current draft · revision ${escape(draft.revision)}</h4><ol>${actions.map(action => `<li>${escape(describe(action))}</li>`).join('')}</ol>${draft.status === 'committed' ? '<p>This draft has been committed.</p>' : `<label>Action to correct<select data-assistant-correction>${actions.map(action => `<option value="${escape(action.actionId)}" ${action.actionId === actionId ? 'selected' : ''}>${escape(describe(action))}</option>`).join('')}</select></label><button type="button" data-assistant-action="correct" ${busy ? 'disabled' : ''}>Request correction</button><button type="button" data-assistant-action="preview" ${busy ? 'disabled' : ''}>Preview changes</button><button type="button" data-assistant-action="decline" ${busy ? 'disabled' : ''}>Decline draft</button>`}` : ''}<button type="button" data-assistant-action="restore" ${busy ? 'disabled' : ''}>Restore saved draft</button>${preview ? `<h4>Visible preview</h4><ol>${(preview.actions || actions).map(action => `<li>${escape(describe(action))}</li>`).join('')}</ol><p>${escape(impactText(preview.impact))}</p><p>Review these changes. Confirm this preview by speaking when voice is connected.</p>` : ''}<button type="button" data-assistant-action="start" ${voiceActive || !config?.voiceAvailable || !actor ? 'disabled' : ''}>Start voice</button><button type="button" data-assistant-action="finish" ${!voiceActive || voiceFinishing ? 'disabled' : ''}>Finish speaking</button><button type="button" data-assistant-action="stop">Stop voice</button><button type="button" data-assistant-action="interrupt" ${!voiceActive || responseAudioMuted ? 'disabled' : ''}>Mute response</button></details>`;
        }
        async function stopVoice() {
            const owner = actor;
            voiceGeneration++; abort?.abort(); abort = null; voiceActive = false; voiceFinishing = false; responseAudioMuted = false;
            stream?.getTracks().forEach(track => track.stop()); stream = null;
            const old = transport; transport = null; prepared = null;
            try { await old?.close(); } finally { if (old) refreshUsage(owner); render(); }
        }
        function syncIdentity() {
            const next = uid(); if (next === actor) return;
            generation++; creationMode = false; actor = next; draft = null; preview = null; answer = ''; notices = []; instruction = ''; actionId = ''; busy = false; proofs.clear(); transcripts.clear();
            void stopVoice(); status = next ? 'Restore a saved draft or enter instructions.' : 'Sign in to use project assistance.'; config = null; if (initialized) void loadConfig(); render();
        }
        function setContext(value = getContext() || {}) {
            if (creationMode && (value.projectId || '') !== creationSourceProject) creationMode = false;
            if (creationMode) value = { mode: 'create_project' };
            syncIdentity(); const key = stable(value); if (key === contextKey) return;
            const changedProject = hints.projectId !== value.projectId || hints.mode !== value.mode;
            generation++; hints = clone(value); contextKey = key; preview = null; busy = false; answer = '';
            if (changedProject) { draft = null; actionId = ''; void stopVoice(); }
            else if (transport) { void stopVoice(); }
            status = 'Context updated. Create a fresh preview before confirming changes.'; render();
        }
        async function perform(work, retireVoice = true) {
            syncIdentity(); setContext(); if (!actor || !hasContext() || busy || disposed) return;
            const epoch = generation, owner = actor; busy = true; render();
            try { if (retireVoice) await stopVoice(); if (current(epoch)) await work(epoch); } catch (_) { if (current(epoch)) { status = 'Assistance is unavailable. Your instructions and saved draft are still available.'; } }
            finally { refreshUsage(owner); if (current(epoch)) { busy = false; render(); } }
        }
        const post = (path, body) => apiFetchJson(`/api/projects/ai/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        function acceptDraft(value) { draft = clone(value); preview = null; actionId = draft.actions?.[0]?.actionId || ''; remember(); void stopVoice(); }
        async function propose(purpose) {
            return perform(async epoch => {
                if (!instruction.trim()) { status = 'Enter instructions first.'; return; }
                if (purpose === 'task_correction' && (!draftId() || !actionId || draft.status === 'committed')) return;
                const result = await post('proposals', { requestId: requestId(), contextHints: clone(hints), instruction, purpose, ...(purpose === 'task_correction' ? { draftId: draftId(), actionId, expectedRevision: draft.revision } : {}) });
                if (!current(epoch)) return;
                notices = Array.isArray(result.notices) ? result.notices.filter(note => typeof note === 'string') : [];
                if (result.kind === 'planning') answer = result.text || '';
                else if (result.kind === 'clarification') answer = result.question || '';
                else if (result.kind === 'task_draft' || result.kind === 'correction') acceptDraft(result.draft);
                else if (result.kind === 'automation_draft') {
                    const accepted = await onAutomationDraft(clone(result.definition));
                    if (!current(epoch)) return;
                    if (accepted === false) { status = 'Save the current automation draft before opening this proposal.'; return; }
                }
                status = result.kind === 'clarification' ? 'More detail is needed.' : 'Proposal ready for review.';
            });
        }
        async function restoreDraft() {
            return perform(async epoch => {
                let saved = draftId(); try { saved ||= globalScope.sessionStorage?.getItem(storageKey()); } catch (_) { /* Optional storage. */ }
                if (!saved) { status = 'No saved draft for this account and project.'; return; }
                const result = await apiFetchJson(`/api/projects/ai/drafts/${encodeURIComponent(saved)}`);
                if (!current(epoch)) return; acceptDraft(result.draft || result); status = draft.status === 'committed' ? 'This draft has been committed.' : 'Saved draft restored. Preview it again before confirming.';
            });
        }
        async function previewDraft() {
            return perform(async epoch => {
                if (!draftId() || draft.status === 'committed') return; const id = draftId();
                const result = await post(`drafts/${encodeURIComponent(id)}/preview`, { expectedRevision: draft.revision, requestId: requestId() });
                if (!current(epoch) || draftId() !== id) return;
                await stopVoice(); if (!current(epoch)) return;
                preview = clone(result.preview || result); status = 'Review the visible preview, then start voice to confirm.';
            });
        }
        async function decline() { return perform(async epoch => { if (!draftId() || draft.status === 'committed') return; const result = await post(`drafts/${encodeURIComponent(draftId())}/decline`, { expectedRevision: draft.revision, requestId: requestId() }); if (!current(epoch)) return; acceptDraft(result.draft || result); status = 'Draft declined. It remains available for recovery.'; }); }
        async function startVoice() {
            syncIdentity(); setContext(); if (!config?.voiceAvailable || !actor || !hasContext() || disposed || busy) return;
            await stopVoice(); const epoch = generation, voiceEpoch = ++voiceGeneration, owner = actor;
            abort = new globalScope.AbortController();
            try {
                const factory = transportFactory || globalScope.CrmAiVoiceTransport?.createTransport;
                transport = factory({ getUid: uid, getIdToken: () => getCurrentUser().getIdToken(), getContext: contextHints, baseUrl: config.relayUrl, workletUrl: '/js/crm/ai-assistance/voice-audio-worklet.js' });
                const local = transport; prepared = await local.prepare({ actorUid: owner, feature: 'projects', signal: abort.signal });
                if (!current(epoch) || voiceEpoch !== voiceGeneration) { await local.close(); return; }
                const media = await globalScope.navigator.mediaDevices.getUserMedia({ audio: true });
                if (!current(epoch) || voiceEpoch !== voiceGeneration) { media.getTracks().forEach(track => track.stop()); await local.close(); return; }
                stream = media; voiceActive = true;
                await prepared.connect({ stream: media, onEvent: event => {
                    if (!current(epoch) || voiceEpoch !== voiceGeneration || owner !== uid()) return;
                    if ((event.type === 'transcript' || event.type === 'user_transcription') && event.final === true && typeof event.text === 'string' && typeof event.utteranceId === 'string') {
                        if (!preview && !transcripts.has(event.utteranceId)) {
                            transcripts.add(event.utteranceId); instruction = `${instruction}${instruction ? '\n' : ''}${event.text}`.slice(0, 8000); render();
                            void (async () => { await propose('task_draft'); if (current(epoch) && draft?.status === 'active' && !preview && !busy) await previewDraft(); })();
                        }
                    } else if (event.type === 'confirmation_ready' && preview && draftId() && typeof event.attestationId === 'string' && !proofs.has(event.attestationId)) {
                        const visible = preview.previewId, id = draftId(), applyOwner = actor, applyProject = hints.projectId;
                        void perform(async () => {
                            if (preview?.previewId !== visible || draftId() !== id) return;
                            proofs.add(event.attestationId);
                            let result;
                            try { result = await post(`drafts/${encodeURIComponent(id)}/apply`, { previewId: visible, attestationId: event.attestationId }); }
                            catch (error) { if (voiceGeneration === voiceEpoch) await stopVoice(); throw error; }
                            // A committed draft changes server context before its
                            // HTTP response may arrive. Preserve same-scope
                            // completion while still fencing account/navigation.
                            if (disposed || uid() !== applyOwner || actor !== applyOwner || hints.projectId !== applyProject || effectiveContext().projectId !== applyProject) return;
                            if (draftId() !== id) return;
                            const committedDraft = draft;
                            preview = null; draft.status = 'committed'; status = 'Confirmed changes applied.';
                            if (voiceGeneration === voiceEpoch) await stopVoice();
                            await onApplied(result);
                            if (disposed || uid() !== applyOwner || actor !== applyOwner || hints.projectId !== applyProject || getContext()?.projectId !== applyProject || draft !== committedDraft || draftId() !== id) return;
                            preview = null; draft.status = 'committed'; status = 'Confirmed changes applied.'; busy = false; render();
                        }, false);
                    } else if (event.type === 'interrupted' && event.scope === 'response_audio') { responseAudioMuted = true; status = 'Response audio muted. Processing continues.'; render();
                    } else if (event.type === 'context') { invalidatePreview();
                    } else if (event.type === 'disconnected') { status = 'Voice disconnected. Your saved draft is retained.'; void stopVoice(); }
                } });
                if (current(epoch) && voiceEpoch === voiceGeneration) { status = 'Voice connected.'; render(); }
            } catch (_) { if (current(epoch) && voiceEpoch === voiceGeneration) { status = 'Voice is unavailable. Your instructions and saved draft are retained.'; await stopVoice(); } }
        }
        async function finishSpeaking() {
            if (!voiceActive || voiceFinishing || !transport?.endInput) return;
            const epoch = voiceGeneration; voiceFinishing = true; status = responseAudioMuted ? 'Response audio muted. Processing continues.' : 'Finishing capture and waiting for the reply.'; render();
            try { await transport.endInput(); }
            catch (_) { if (epoch === voiceGeneration) { status = 'Voice input could not finish. Start voice again to retry.'; await stopVoice(); } }
        }
        async function muteResponse() {
            if (!voiceActive || responseAudioMuted || !transport?.interrupt) return;
            const epoch = voiceGeneration; responseAudioMuted = true; status = 'Response audio muted. Processing continues.'; render();
            try { await transport.interrupt(); }
            catch (_) { if (epoch === voiceGeneration) { status = 'Voice connection closed. Your saved draft is retained.'; await stopVoice(); } }
        }
        const actions = { creation: () => { creationMode = !creationMode; creationSourceProject = getContext()?.projectId || ''; setContext(); }, plan: () => propose('planning'), draft: () => propose('task_draft'), automation: () => propose('automation_draft'), correct: () => propose('task_correction'), restore: restoreDraft, preview: previewDraft, decline, start: startVoice, finish: finishSpeaking, stop: stopVoice, interrupt: muteResponse };
        function click(event) { const action = event.target.closest?.('[data-assistant-action]')?.dataset.assistantAction; if (actions[action]) void actions[action](); }
        function input(event) { if (event.target.matches?.('[data-assistant-instruction]')) instruction = event.target.value.slice(0, 8000); if (event.target.matches?.('[data-assistant-correction]')) actionId = event.target.value; }
        async function loadConfig() {
            const owner = actor;
            try { const result = await apiFetchJson('/api/projects/ai/config'); if (disposed || owner !== actor || owner !== uid()) return; config = result; status = result.voiceAvailable ? 'Voice can be started when you are ready.' : 'Voice assistance is unavailable. Manual instructions and saved drafts remain available.'; }
            catch (_) { if (!disposed && owner === actor) status = 'Voice configuration is unavailable. Manual instructions and saved drafts remain available.'; } render();
        }
        async function init() {
            if (initialized || disposed) return; root.addEventListener('click', click); root.addEventListener('input', input); root.addEventListener('change', input); syncIdentity(); setContext(); initialized = true; render(); await loadConfig();
        }
        function dispose() { disposed = true; generation++; void stopVoice(); root.removeEventListener('click', click); root.removeEventListener('input', input); root.removeEventListener('change', input); root.innerHTML = ''; }
        return { init, setContext, invalidatePreview, syncIdentity, dispose, restoreDraft, getState: () => clone({ actorUid: actor, context: hints, draft, preview, instruction, status, answer, voiceActive, responseAudioMuted, busy }) };
    }
    globalScope.CrmProjectsAssistant = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
