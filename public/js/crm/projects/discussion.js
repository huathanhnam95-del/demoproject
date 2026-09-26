(function (globalScope) {
  'use strict';

  function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function createController(deps = {}) {
    const elements = deps.elements || {};
    const apiFetchJson = typeof deps.apiFetchJson === 'function' ? deps.apiFetchJson : null;
    const escape = deps.escapeHtml || esc;
    const showToast = typeof deps.showToast === 'function' ? deps.showToast : () => {};
    const getCurrentUser = typeof deps.getCurrentUser === 'function' ? deps.getCurrentUser : () => null;
    let selection = null;
    let scopeTuple = '';
    let authorityKey = '';
    let requestEpoch = 0;
    let loadSequence = 0;
    let historySequence = 0;
    let messages = [];
    let cursor = '';
    let hasMore = false;
    let pending = false;
    let replyParentId = '';
    let historyMessageId = '';
    let messageHistory = [];
    let historyCursor = '';
    let historyHasMore = false;
    let activeMutationToken = 0;
    let caretInteractionSequence = 0;
    let remoteObserver = null;
    let remoteRepair = null;
    let selectionActive = true, selectionLoaded = false;
    const mentionsByScope = new Map();
    const draftByScope = new Map();
    const caretByScope = new Map();
    const replyByScope = new Map();
    const composerGenerationByScope = new Map();
    const operationByScope = new Map();
    const editDrafts = new Map();
    let loadError = false, loading = false, locateSequence = 0, locating = null;

    function readableTime(value) {
      const date = new Date(value);
      return value && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
    }

    function personName(uid) {
      const state = deps.getBoardState?.();
      const people = String(state?.project?.id || '') === String(selection?.projectId || '') ? state?.members : null;
      const person = [...(people || []), ...(memberDirectoryCache.get(`${selection?.actorUid || ''}:${selection?.projectId}`) || [])].find(item => String(item.uid || item.id) === String(uid));
      return person?.displayName || person?.name || person?.email || uid || 'Member';
    }

    function preserveFocus(target) {
      const active = document.activeElement;
      if (!active || !target?.contains?.(active)) return () => {};
      const id = active.id, dataset = { ...active.dataset }, tag = active.tagName;
      const scrollTop = target.scrollTop;
      return () => {
        const next = Array.from(target.querySelectorAll('button,input,select,textarea,article')).find(node => id ? node.id === id : node.tagName === tag && Object.keys(dataset).length && Object.entries(dataset).every(([key, value]) => node.dataset?.[key] === value));
        if (next?.tagName === 'ARTICLE') next.tabIndex = -1;
        next?.focus?.({ preventScroll: true });
        if (!next) { target.tabIndex = -1; target.focus?.({ preventScroll: true }); }
        if (scrollTop !== undefined) target.scrollTop = scrollTop;
      };
    }

    function currentScope() {
      return selection && selection.actorUid === getCurrentUser()?.uid ? { tuple: scopeTuple, epoch: requestEpoch, actorUid: selection.actorUid } : null;
    }

    function isCurrent(scope) {
      return isCurrentTuple(scope) && scope.epoch === requestEpoch;
    }

    function isCurrentTuple(scope) {
      return Boolean(scope && selection && scope.tuple === scopeTuple && scope.actorUid === selection.actorUid && scope.actorUid === getCurrentUser()?.uid);
    }

    function composerEdited() {
      if (currentScope()) composerGenerationByScope.set(scopeTuple, (composerGenerationByScope.get(scopeTuple) || 0) + 1);
    }

    function restoreComposerCaret() {
      const input = elements.projectsBoardDiscussionInput;
      const scope = currentScope();
      if (!input || !scope) return;
      const rawDraft = input.value;
      const generation = composerGenerationByScope.get(scope.tuple) || 0;
      const interactionSequence = caretInteractionSequence;
      const range = caretByScope.get(scope.tuple) || [rawDraft.length, rawDraft.length];
      const restore = () => { try { input.setSelectionRange(...range); } catch (_) { /* caret is optional */ } };
      restore();
      // Chrome's native select popup can reset an unfocused textarea's range
      // after its click handler and microtasks. Restore once after that reset,
      // without taking focus or overriding a newer composer interaction.
      globalScope.requestAnimationFrame?.(() => {
        if (!isCurrent(scope) || input.value !== rawDraft || document.activeElement === input
          || interactionSequence !== caretInteractionSequence
          || generation !== (composerGenerationByScope.get(scope.tuple) || 0)) return;
        restore();
      });
    }

    function canWrite() {
      return selection && selection.actorUid === getCurrentUser()?.uid && ['Owner', 'Editor'].includes(selection.role) && selection.lifecycle === 'active';
    }

    function taskPath() {
      if (!selection) return '';
      return `/api/projects/${encodeURIComponent(selection.projectId)}/tasks/${encodeURIComponent(selection.taskId)}/discussion`;
    }

    function taskPathFor(value) {
      if (!value?.projectId || !value?.taskId) return '';
      return `/api/projects/${encodeURIComponent(value.projectId)}/tasks/${encodeURIComponent(value.taskId)}/discussion`;
    }

    function newOperationId(prefix) {
      return `crm-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function setStatus(value, error = false) {
      if (!elements.projectsBoardDiscussionStatus) return;
      elements.projectsBoardDiscussionStatus.textContent = value || '';
      elements.projectsBoardDiscussionStatus.classList.toggle('crm-projects-board-error-text', error);
      updateDisabled();
    }

    function updateDisabled() {
      const disabled = pending || !canWrite();
      const unresolved = operationByScope.has(`${scopeTuple}:retry`);
      if (elements.projectsBoardDiscussionInput) elements.projectsBoardDiscussionInput.disabled = disabled || unresolved;
      if (elements.projectsBoardDiscussionFile) elements.projectsBoardDiscussionFile.disabled = disabled || unresolved;
      if (elements.projectsBoardDiscussionMention) elements.projectsBoardDiscussionMention.disabled = disabled || unresolved;
      elements.projectsBoardDiscussionList?.querySelectorAll('[data-discussion-reply],[data-discussion-cancel-reply],[data-discussion-edit],[data-discussion-moderate],[data-discussion-edit-discard]').forEach((button) => { button.disabled = disabled || unresolved; });
      const send = document.getElementById('btn-projects-board-discussion-send');
      if (send) send.disabled = disabled || operationByScope.has(`${scopeTuple}:retry`);
      const more = document.getElementById('btn-projects-board-discussion-more');
      if (more) more.disabled = pending || loading || !!locating;
      if (elements.projectsBoardDiscussionRetry) {
        const retry = operationByScope.get(`${scopeTuple}:retry`);
        elements.projectsBoardDiscussionRetry.hidden = !retry;
        elements.projectsBoardDiscussionRetry.disabled = disabled || !retry || !!retry.attachmentConflict || (retry.kind === 'moderate' && selection?.role !== 'Owner');
      }
      attachmentConflictControls();
    }

    function attachmentConflictControls() {
      const request = operationByScope.get(`${scopeTuple}:retry`);
      for (const name of ['replace', 'abandon']) {
        const button = document.getElementById(`btn-projects-board-discussion-${name}-upload`);
        if (button) { button.hidden = !request?.attachmentConflict; button.disabled = pending || !canWrite(); }
      }
    }

    async function resolveAttachmentConflict(retryUpload) {
      const scope = currentScope();
      const request = operationByScope.get(`${scopeTuple}:retry`);
      if (!scope || !request?.attachmentConflict || pending || !canWrite()) return;
      if (!retryUpload) {
        finishMessage(request, scope);
        await load();
        if (isCurrent(scope)) setStatus('Message kept. The failed attachment was abandoned.');
        return;
      }
      pending = true; updateDisabled();
      try {
        const result = await apiFetchJson(`${request.basePath}/messages/${encodeURIComponent(request.messageId)}/history?pageSize=1`);
        if (!isCurrent(scope)) return;
        const message = result?.message;
        if (!message || message.redacted || message.authorUid !== getCurrentUser()?.uid || (message.moderationState && message.moderationState !== 'visible')) throw new Error('The message cannot receive an attachment. Keep the message without this attachment.');
        if (!window.confirm(`Attach ${request.file.name} to the current message?\n\n${message.body || ''}`)) return;
        request.attachmentExpectedRevision = message.revision;
        request.attachmentOperationId = newOperationId('attachment-reviewed');
        request.attachmentConflict = false;
      } catch (error) { if (isCurrent(scope)) setStatus(error.message || 'The current message could not be reviewed.', true); }
      finally { if (isCurrent(scope)) { pending = false; updateDisabled(); } }
      if (isCurrent(scope) && !request.attachmentConflict) await retryMutation();
    }

    function attachmentButtons(message) {
      if (!Array.isArray(message.attachmentIds) || !message.attachmentIds.length || message.redacted) return '';
      return `<div class="crm-projects-discussion-attachments">${message.attachmentIds.map((attachmentId) => `<button type="button" class="crm-btn-secondary crm-btn-sm" data-discussion-attachment="${escape(attachmentId)}" data-message-id="${escape(message.id)}">Download attachment</button>`).join('')}</div>`;
    }

    function renderHistory() {
      const target = elements.projectsBoardDiscussionHistory;
      if (!target) return;
      const restoreFocus = preserveFocus(target);
      if (!historyMessageId) {
        target.hidden = true;
        target.innerHTML = '';
        return;
      }
      target.hidden = false;
      const rows = messageHistory.map((entry) => {
        const body = entry.redacted
          ? '<span class="crm-muted">Unavailable to this member.</span>'
          : entry.body == null ? '' : `<p>${escape(entry.body).replace(/\r?\n/g, '<br>')}</p>`;
        return `<article class="crm-projects-discussion-history-row"><header><strong>${escape(entry.action || entry.kind || 'change')}</strong><span>${escape(personName(entry.actorUid))}</span><time datetime="${escape(entry.createdAt || '')}">${escape(readableTime(entry.createdAt))}</time></header>${entry.reason ? `<p class="crm-muted">Reason: ${escape(entry.reason)}</p>` : ''}${body}</article>`;
      }).join('');
      target.innerHTML = `<div class="crm-projects-board-discussion-history-head"><strong>Message history</strong><button type="button" class="crm-btn-secondary crm-btn-sm" data-discussion-history-close>Close</button></div>${rows || '<p class="crm-muted">No history is available.</p>'}${historyHasMore ? '<button type="button" class="crm-btn-secondary crm-btn-sm" data-discussion-history-more>Load more history</button>' : ''}`;
      restoreFocus();
    }

    function render() {
      const target = elements.projectsBoardDiscussionList;
      if (!target) return;
      const restoreFocus = preserveFocus(target);
      if (!selection) {
        target.innerHTML = '<p class="crm-muted">Select a task to view its conversation.</p>';
        renderHistory();
        updateDisabled();
        return;
      }
      if (!messages.length) {
        target.innerHTML = '<p class="crm-muted">No updates yet.</p>';
      } else {
        const byParent = new Map();
        messages.forEach((message) => {
          const key = message.parentMessageId || '';
          const list = byParent.get(key) || [];
          list.push(message);
          byParent.set(key, list);
        });
        const currentUid = getCurrentUser()?.uid || '';
        const renderMessage = (message, depth = 0) => {
          const repairing = remoteRepair?.ids.includes(message.id);
          const hidden = message.moderationState && message.moderationState !== 'visible';
          const body = repairing ? '<span class="crm-muted">Refreshing this update…</span>' : message.redacted ? '<span class="crm-muted">This message is unavailable.</span>' : escape(message.body || '').replace(/\r?\n/g, '<br>');
          const own = currentUid && currentUid === message.authorUid;
          const replies = (byParent.get(message.id) || []).map((reply) => renderMessage(reply, depth + 1)).join('');
          const controls = `<button type="button" class="crm-btn-secondary crm-btn-sm" data-discussion-history="${escape(message.id)}">History</button>${canWrite() ? `<button type="button" class="crm-btn-secondary crm-btn-sm" data-discussion-reply="${escape(message.id)}">Reply</button>${own && !hidden ? `<button type="button" class="crm-btn-secondary crm-btn-sm" data-discussion-edit="${escape(message.id)}">Edit</button>` : ''}${selection.role === 'Owner' ? `<button type="button" class="crm-btn-secondary crm-btn-sm" data-discussion-moderate="${escape(message.id)}" data-moderation-action="${hidden ? 'restore' : 'hide'}">${hidden ? 'Restore' : 'Hide'}</button>` : ''}` : ''}`;
          const mentionLine = !repairing && Array.isArray(message.mentions) && message.mentions.length ? `<p class="crm-muted">Mentioned: ${message.mentions.map((uid) => `@${escape(personName(uid))}`).join(', ')}</p>` : '';
          return `<article class="crm-projects-discussion-message${hidden ? ' is-moderated' : ''}" data-message-id="${escape(message.id)}" style="margin-left:${Math.min(depth, 3) * 16}px"><header><strong>${escape(personName(message.authorUid))}</strong><time datetime="${escape(message.createdAt || '')}">${escape(readableTime(message.createdAt))}</time>${hidden ? '<span class="crm-muted">Moderated</span>' : ''}</header><p>${body}</p>${mentionLine}${repairing ? '' : attachmentButtons(message)}<div class="crm-inline-fields">${repairing ? '' : controls}</div>${replies}</article>`;
        };
        const visibleIds = new Set(messages.map((message) => message.id));
        target.innerHTML = messages.filter((message) => !message.parentMessageId || !visibleIds.has(message.parentMessageId)).map((message) => renderMessage(message)).join('');
      }
      if (replyParentId) target.insertAdjacentHTML('afterbegin', `<div role="status" class="crm-inline-fields">Replying to the selected update <button type="button" class="crm-btn-secondary crm-btn-sm" data-discussion-cancel-reply>Cancel reply</button></div>`);
      if (hasMore && !document.getElementById('btn-projects-board-discussion-more')) target.insertAdjacentHTML('beforeend', '<button id="btn-projects-board-discussion-more" type="button" class="crm-btn-secondary crm-btn-sm">Load older updates</button>');
      if (loadError) target.insertAdjacentHTML('afterbegin', '<p>Conversation could not be refreshed. <button type="button" class="crm-btn-secondary" data-discussion-load-retry>Retry loading updates</button></p>');
      if (locating) target.insertAdjacentHTML('afterbegin', `<p role="status">Looking for the linked update · page ${locating.page}. <button type="button" class="crm-btn-secondary" data-discussion-locate-cancel>Cancel search</button></p>`);
      for (const draft of editDrafts.values()) {
        if (draft.scope !== scopeTuple || !canWrite()) continue;
        target.insertAdjacentHTML('afterbegin', `<section aria-label="Retained update edit"><strong>Your unsaved edit</strong><p>${escape(draft.body).replace(/\r?\n/g, '<br>')}</p><button type="button" class="crm-btn-secondary" data-discussion-edit="${escape(draft.messageId)}">Review retained edit</button> <button type="button" class="crm-btn-secondary" data-discussion-edit-discard="${escape(draft.messageId)}">Discard edit</button></section>`);
      }
      renderHistory();
      updateDisabled();
      restoreFocus();
    }

    function renderMentionOptions(people = []) {
      const control = elements.projectsBoardDiscussionMention;
      if (!control) return;
      const selected = new Set(mentionsByScope.get(scopeTuple) || []);
      const normalized = people.map((person) => ({
        uid: String(person.uid || person.id || '').trim(),
        label: String(person.displayName || person.name || person.email || person.uid || person.id || '').trim()
      })).filter((person) => person.uid);
      control.innerHTML = normalized.length
        ? normalized.map((person) => `<option value="${escape(person.uid)}"${selected.has(person.uid) ? ' selected' : ''}>${escape(person.label || person.uid)}</option>`).join('')
        : '<option value="" disabled>No eligible project members</option>';
    }

    const memberDirectoryCache = new Map();
    async function loadMentionOptions(scope) {
      if (!apiFetchJson || !selection || !isCurrent(scope)) return;
      const boardState = typeof deps.getBoardState === 'function' ? deps.getBoardState() : null;
      if (boardState && String(boardState.project?.id || '') === String(selection.projectId) && Array.isArray(boardState.members) && boardState.members.length > 0) {
        renderMentionOptions(boardState.members);
        return;
      }
      const cacheKey = `${selection.actorUid || ''}:${selection.projectId}`;
      if (memberDirectoryCache.has(cacheKey)) {
        renderMentionOptions(memberDirectoryCache.get(cacheKey));
        return;
      }
      try {
        const result = await apiFetchJson(`/api/projects/${encodeURIComponent(selection.projectId)}/member-directory`);
        if (!isCurrent(scope)) return;
        const list = Array.isArray(result?.people) ? result.people : Array.isArray(result?.members) ? result.members : [];
        memberDirectoryCache.set(cacheKey, list);
        renderMentionOptions(list);
        render();
      } catch (_) {
        if (isCurrent(scope)) renderMentionOptions([]);
      }
    }

    async function load({ append = false, fenced = false, current = null } = {}) {
      if (!apiFetchJson || !selection || (current && !current()) || (append && loading)) return false;
      if (remoteObserver && !fenced) {
        const requestedScope = currentScope();
        return remoteObserver.snapshot(selection.projectId, () => isCurrent(requestedScope) ? load({ append, fenced: true, current }) : false).catch(() => false);
      }
      const scope = currentScope();
      const sequence = ++loadSequence;
      loading = true; loadError = false;
      const requestCursor = append ? cursor : '';
      const query = new URLSearchParams({ pageSize: '50', order: 'desc' });
      if (requestCursor) query.set('cursor', requestCursor);
      setStatus(append ? 'Loading older updates…' : 'Loading conversation…');
      try {
        const result = await apiFetchJson(`${taskPath()}?${query.toString()}`);
        if (!isCurrent(scope) || sequence !== loadSequence || (current && !current())) return false;
        const incoming = Array.isArray(result?.messages) ? result.messages : [];
        const alreadyLoaded = messages.length > 0;
        mergeMessages(incoming);
        selectionLoaded = true;
        if (append || !alreadyLoaded) { cursor = result?.nextCursor || ''; hasMore = Boolean(result?.hasMore && cursor); }
        render();
        setStatus(`${messages.length} update${messages.length === 1 ? '' : 's'}`);
        return true;
      } catch (error) {
        if (!isCurrent(scope) || sequence !== loadSequence || (current && !current())) return false;
        loadError = true; selectionLoaded = false;
        render();
        setStatus(error?.message || 'Conversation could not be loaded.', true);
        return false;
      } finally { if (isCurrent(scope) && sequence === loadSequence) { loading = false; updateDisabled(); } }
    }

    async function focusMessage(messageId, options = {}) {
      if (!selection || !messageId) return false;
      const scope = currentScope();
      const search = ++locateSequence;
      const valid = () => isCurrent(scope) && search === locateSequence && (!options.isCurrent || options.isCurrent());
      if (!valid()) return false;
      locating = { page: 1 }; render();
      try {
        if (!await load({ current: valid })) return false;
        for (let page = 0; page < 10 && valid(); page++) {
          if (messages.some((message) => String(message.id) === String(messageId))) {
            const article = Array.from(elements.projectsBoardDiscussionList?.querySelectorAll('article[data-message-id]') || []).find((node) => node.dataset.messageId === String(messageId));
            if (article) { article.tabIndex = -1; article.focus({ preventScroll: true }); article.scrollIntoView({ block: 'center' }); return true; }
            return false;
          }
          if (!hasMore || !cursor || page === 9) break;
          const previousCursor = cursor;
          locating.page = page + 2; render();
          if (!await load({ append: true, current: valid })) break;
          if (!valid()) return false;
          if (cursor === previousCursor) break;
        }
        if (valid()) setStatus('The linked update could not be located within this search. Load older updates or retry.', true);
        return false;
      } finally { if (search === locateSequence) { locating = null; render(); } }
    }

    async function uploadFile(scope, messageId, file, request) {
      const user = getCurrentUser();
      if (!user || !file || !isCurrent(scope)) return false;
      const uploadPath = `${taskPathFor({ projectId: selection.projectId, taskId: selection.taskId })}/messages/${encodeURIComponent(messageId)}/attachments`;
      const token = await user.getIdToken();
      if (!isCurrent(scope)) return false;
      const form = new FormData();
      form.append('file', file, file.name);
      request.attachmentOperationId = request.attachmentOperationId || newOperationId('attachment');
      form.append('operationId', request.attachmentOperationId);
      if (Number.isSafeInteger(request.attachmentExpectedRevision)) form.append('expectedMessageRevision', String(request.attachmentExpectedRevision));
      const response = await fetch(uploadPath, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) { const error = new Error(payload?.message || `Attachment upload failed (${response.status})`); error.status = response.status; throw error; }
      return true;
    }

    async function submitMessage(request, scope) {
      if (!request.messageId) {
        const result = await apiFetchJson(`${request.basePath}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: request.body, parentMessageId: request.parentMessageId || null, mentions: request.mentions, operationId: request.operationId }) });
        // Retain committed identity even when navigation made the UI stale.
        request.messageId = result?.message?.id;
        request.attachmentExpectedRevision = result?.message?.revision;
        request.createdMessage = result?.message || null;
      }
      if (!request.messageId) throw new Error('Message completion could not be confirmed.');
      // Message creation settles a text-only request even after navigation.
      // An attachment remains unresolved until its own upload is confirmed.
      return request.file ? uploadFile(scope, request.messageId, request.file, request) : true;
    }

    function finishMessage(request, scope) {
      const ownsComposer = operationByScope.get(`${scope.tuple}:message`) === request
        && (!operationByScope.has(`${scope.tuple}:retry`) || operationByScope.get(`${scope.tuple}:retry`) === request);
      if (operationByScope.get(`${scope.tuple}:message`) === request) operationByScope.delete(`${scope.tuple}:message`);
      if (operationByScope.get(`${scope.tuple}:retry`) === request) operationByScope.delete(`${scope.tuple}:retry`);
      const unchanged = ownsComposer && request.composerGeneration === (composerGenerationByScope.get(scope.tuple) || 0)
        && draftByScope.get(scope.tuple) === request.rawDraft;
      const visible = isCurrentTuple(scope);
      if (unchanged && (!visible || !elements.projectsBoardDiscussionInput || elements.projectsBoardDiscussionInput.value === request.rawDraft)) {
        draftByScope.delete(scope.tuple); mentionsByScope.delete(scope.tuple); caretByScope.delete(scope.tuple); replyByScope.delete(scope.tuple);
        if (visible) {
          if (elements.projectsBoardDiscussionInput) elements.projectsBoardDiscussionInput.value = '';
          if (elements.projectsBoardDiscussionFile) elements.projectsBoardDiscussionFile.value = '';
          if (elements.projectsBoardDiscussionMention) Array.from(elements.projectsBoardDiscussionMention.options).forEach((option) => { option.selected = false; });
          replyParentId = '';
        }
      }
      if (visible) updateDisabled();
    }

    async function handleMutationError(error, request, scope) {
      if (!isCurrent(scope)) return;
      if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
        if (request.kind !== 'message') {
          // A known conflict needs a deliberate new edit/moderation against the
          // refreshed record. Never resubmit the user's old body silently.
          operationByScope.delete(`${scope.tuple}:${request.kind}:${request.messageId}`);
          operationByScope.delete(`${scope.tuple}:retry`);
          await load();
          if (!isCurrent(scope)) return;
          setStatus(`${error.message || 'This update changed.'} ${request.kind === 'edit' ? 'Your edit is retained. Review it against the current message before applying again.' : 'Review the current message and choose moderation again.'}`, true);
          return;
        }
        // Attachment conflicts must keep the successfully created message ID
        // and the exact reservation identity; they cannot restart message creation.
        if (!request.messageId) {
          operationByScope.delete(`${scope.tuple}:message`);
          operationByScope.delete(`${scope.tuple}:retry`);
          await load();
          if (!isCurrent(scope)) return;
          setStatus(`${error.message || 'Message conflict.'} Review the conversation, then post again.`, true);
          return;
        }
        request.attachmentConflict = true;
        await load();
        if (!isCurrent(scope)) return;
        setStatus(`${error.message || 'Attachment conflict.'} The message is already saved. Review a fresh attachment attempt or keep the message without it.`, true);
        return;
      }
      setStatus(`${error.message || 'Update could not be saved.'} Retry to resume the same request.`, true);
      render();
    }

    async function sendMessage(event) {
      event?.preventDefault?.();
      if (!selection || !apiFetchJson || pending || !canWrite() || operationByScope.has(`${scopeTuple}:retry`)) return;
      const scope = currentScope();
      const input = elements.projectsBoardDiscussionInput;
      const body = String(input?.value || '').trim();
      if (!body) return;
      const operationKey = `${scope.tuple}:message`;
      draftByScope.set(scope.tuple, String(input?.value || ''));
      const request = operationByScope.get(operationKey) || {
        kind: 'message', basePath: taskPathFor(selection), body, parentMessageId: replyParentId || null,
        rawDraft: String(input?.value || ''), composerGeneration: composerGenerationByScope.get(scope.tuple) || 0,
        mentions: Array.from(elements.projectsBoardDiscussionMention?.selectedOptions || []).map((option) => option.value).filter(Boolean),
        operationId: newOperationId('discussion'), file: elements.projectsBoardDiscussionFile?.files?.[0] || null,
        messageId: null, attachmentOperationId: null
      };
      operationByScope.set(operationKey, request);
      operationByScope.set(`${scope.tuple}:retry`, request);
      pending = true;
      const mutationToken = ++activeMutationToken;
      updateDisabled();
      setStatus('Posting…');
      try {
        if (!await submitMessage(request, scope)) return;
        finishMessage(request, scope);
        if (isCurrentTuple(scope)) {
          if (request.createdMessage && !request.file) {
            mergeMessages([request.createdMessage]);
            render();
            setStatus(`${messages.length} update${messages.length === 1 ? '' : 's'}`);
          } else {
            await load();
          }
        }
      } catch (error) {
        if (isCurrent(scope)) {
          await handleMutationError(error, request, scope);
        }
      } finally {
        if (isCurrent(scope) && mutationToken === activeMutationToken) { pending = false; updateDisabled(); }
      }
    }

    async function edit(messageId) {
      const scope = currentScope();
      let message = messages.find((entry) => entry.id === messageId);
      if (!scope || !message || pending || !canWrite() || operationByScope.has(`${scopeTuple}:retry`) || message.authorUid !== getCurrentUser()?.uid) return;
      const key = `${scope.tuple}:edit:${messageId}`;
      const retained = editDrafts.get(key);
      if (retained) {
        pending = true; updateDisabled();
        try {
          const result = await apiFetchJson(`${taskPathFor(selection)}/messages/${encodeURIComponent(messageId)}/history?pageSize=1`);
          if (!isCurrent(scope)) return;
          message = result?.message;
          if (!message || message.redacted || message.authorUid !== getCurrentUser()?.uid || (message.moderationState && message.moderationState !== 'visible')) { setStatus('This update is unavailable for editing. Your attempted text is retained.', true); return; }
          mergeMessages([message]); render();
        } catch (error) { if (isCurrent(scope)) setStatus(error?.message || 'The current update could not be loaded. Your edit is retained.', true); return; }
        finally { if (isCurrent(scope)) { pending = false; updateDisabled(); } }
      }
      if (!isCurrent(scope) || !canWrite()) return;
      const body = window.prompt(retained ? `Review your retained edit before applying it. The current saved update is:\n\n${message.body || ''}\n\nPress OK to apply your text, or Cancel to keep it for later.` : 'Edit update:', retained?.body ?? message.body ?? '');
      if (body === null || !body.trim()) return;
      const request = operationByScope.get(key) || { kind: 'edit', messageId, body: body.trim(), expectedRevision: Number(message.revision || 0), operationId: newOperationId('discussion-edit') };
      const draft = { scope: scope.tuple, messageId, body };
      editDrafts.set(key, draft);
      operationByScope.set(key, request);
      operationByScope.set(`${scope.tuple}:retry`, request);
      pending = true;
      const mutationToken = ++activeMutationToken;
      updateDisabled();
      try {
        await apiFetchJson(`${taskPathFor(selection)}/messages/${encodeURIComponent(request.messageId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: request.body, expectedRevision: request.expectedRevision, operationId: request.operationId }) });
        if (operationByScope.get(key) === request) operationByScope.delete(key);
        if (operationByScope.get(`${scope.tuple}:retry`) === request) operationByScope.delete(`${scope.tuple}:retry`);
        if (editDrafts.get(key) === draft) editDrafts.delete(key);
        if (isCurrentTuple(scope)) await load();
      } catch (error) {
        await handleMutationError(error, request, scope);
      } finally { if (isCurrent(scope) && mutationToken === activeMutationToken) { pending = false; updateDisabled(); } }
    }

    async function moderate(messageId, action) {
      const scope = currentScope();
      const message = messages.find((entry) => entry.id === messageId);
      if (!scope || !message || selection.role !== 'Owner' || pending || !canWrite() || operationByScope.has(`${scopeTuple}:retry`)) return;
      const reason = window.prompt(action === 'restore' ? 'Reason for restoring this update:' : 'Reason for hiding this update:');
      if (!reason || !reason.trim()) return;
      const key = `${scope.tuple}:moderate:${messageId}`;
      const request = operationByScope.get(key) || { kind: 'moderate', messageId, action, reason: reason.trim(), expectedRevision: Number(message.revision || 0), operationId: newOperationId('moderate') };
      operationByScope.set(key, request);
      operationByScope.set(`${scope.tuple}:retry`, request);
      pending = true;
      const mutationToken = ++activeMutationToken;
      updateDisabled();
      try {
        await apiFetchJson(`${taskPathFor(selection)}/messages/${encodeURIComponent(request.messageId)}/moderate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: request.action, reason: request.reason, expectedRevision: request.expectedRevision, operationId: request.operationId }) });
        if (isCurrent(scope)) { operationByScope.delete(key); operationByScope.delete(`${scope.tuple}:retry`); await load(); }
      } catch (error) {
        await handleMutationError(error, request, scope);
      } finally { if (isCurrent(scope) && mutationToken === activeMutationToken) { pending = false; updateDisabled(); } }
    }

    async function retryMutation() {
      const scope = currentScope();
      const request = operationByScope.get(`${scopeTuple}:retry`);
      if (!scope || !request || pending || !canWrite() || (request.kind === 'moderate' && selection.role !== 'Owner')) return;
      pending = true;
      const mutationToken = ++activeMutationToken;
      updateDisabled();
      try {
        if (request.kind === 'message') {
          if (!await submitMessage(request, scope)) return;
          finishMessage(request, scope);
          if (isCurrentTuple(scope)) await load();
          return;
        }
        else if (request.kind === 'edit') await apiFetchJson(`${taskPathFor(selection)}/messages/${encodeURIComponent(request.messageId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: request.body, expectedRevision: request.expectedRevision, operationId: request.operationId }) });
        else if (request.kind === 'moderate') await apiFetchJson(`${taskPathFor(selection)}/messages/${encodeURIComponent(request.messageId)}/moderate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: request.action, reason: request.reason, expectedRevision: request.expectedRevision, operationId: request.operationId }) });
        if (!isCurrent(scope)) return;
        operationByScope.delete(`${scopeTuple}:retry`);
        if (request.kind === 'edit') { operationByScope.delete(`${scopeTuple}:edit:${request.messageId}`); editDrafts.delete(`${scopeTuple}:edit:${request.messageId}`); }
        if (request.kind === 'moderate') operationByScope.delete(`${scopeTuple}:moderate:${request.messageId}`);
        await load();
        if (isCurrent(scope)) setStatus('Update saved.');
      } catch (error) { await handleMutationError(error, request, scope); }
      finally { if (isCurrent(scope) && mutationToken === activeMutationToken) { pending = false; updateDisabled(); } }
    }

    async function loadHistory(messageId, { append = false } = {}) {
      if (!apiFetchJson || !selection || !messageId) return;
      const scope = currentScope();
      const sequence = ++historySequence;
      const query = new URLSearchParams({ pageSize: '50' });
      if (append && historyCursor) query.set('cursor', historyCursor);
      try {
        const result = await apiFetchJson(`${taskPathFor(selection)}/messages/${encodeURIComponent(messageId)}/history?${query.toString()}`);
        if (!isCurrent(scope) || sequence !== historySequence) return;
        const incoming = Array.isArray(result?.history) ? result.history : [];
        historyMessageId = messageId;
        messageHistory = append ? messageHistory.concat(incoming.filter((row) => !messageHistory.some((existing) => existing.id === row.id))) : incoming;
        historyCursor = result?.nextCursor || '';
        historyHasMore = Boolean(result?.hasMore && historyCursor);
        renderHistory();
      } catch (error) { if (isCurrent(scope)) showToast(error?.message || 'Message history could not be loaded.', 'error'); }
    }

    async function download(messageId, attachmentId) {
      const scope = currentScope();
      const user = getCurrentUser();
      if (!scope || !user) return;
      const downloadPath = `${taskPathFor(selection)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/download`;
      try {
        const token = await user.getIdToken();
        if (!isCurrent(scope)) return;
        const response = await fetch(downloadPath, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const blob = await response.blob();
        if (!isCurrent(scope)) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const disposition = response.headers?.get?.('Content-Disposition') || '';
        const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        const ordinary = disposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
        let filename = ordinary?.[1] || ordinary?.[2] || 'attachment';
        if (encoded) { try { filename = decodeURIComponent(encoded[1]); } catch (_) { /* Keep the plain filename. */ } }
        link.download = filename.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/^\.+|[. ]+$/g, '').trim().slice(0, 180) || 'attachment';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { if (isCurrent(scope)) showToast(error?.message || 'Download failed.', 'error'); }
    }

    function setSelection(next) {
      if (scopeTuple && elements.projectsBoardDiscussionInput) {
        const input = elements.projectsBoardDiscussionInput;
        draftByScope.set(scopeTuple, input.value);
        caretByScope.set(scopeTuple, [input.selectionStart, input.selectionEnd]);
      }
      const actorUid = String(getCurrentUser()?.uid || '');
      if (!next?.projectId || !next?.taskId || !actorUid) {
        requestEpoch += 1;
        loadSequence += 1;
        historySequence += 1;
        pending = false;
        activeMutationToken += 1;
        selection = null; selectionLoaded = false; selectionActive = false; remoteRepair = null;
        loading = false; loadError = false; locating = null; locateSequence++;
        scopeTuple = '';
        authorityKey = '';
        memberDirectoryCache.clear();
        messages = [];
        cursor = '';
        hasMore = false;
        replyParentId = '';
        historyMessageId = '';
        messageHistory = [];
        historyCursor = '';
        historyHasMore = false;
        if (elements.projectsBoardDiscussion) elements.projectsBoardDiscussion.hidden = true;
        if (elements.projectsBoardDiscussionInput) elements.projectsBoardDiscussionInput.value = '';
        if (elements.projectsBoardDiscussionFile) elements.projectsBoardDiscussionFile.value = '';
        setStatus('');
        render();
        return;
      }
      selectionActive = next.deferLoad !== true;
      const normalized = { actorUid, projectId: String(next.projectId), taskId: String(next.taskId), taskRevision: Number(next.taskRevision || 0), role: String(next.role || ''), lifecycle: String(next.lifecycle || 'active') };
      const nextTuple = JSON.stringify([normalized.actorUid, normalized.projectId, normalized.taskId]);
      const nextAuthority = `${normalized.role}|${normalized.lifecycle}`;
      const tupleChanged = nextTuple !== scopeTuple;
      const authorityChanged = nextAuthority !== authorityKey;
      if (tupleChanged || authorityChanged) {
        loading = false; loadError = false; locating = null; locateSequence++;
        remoteRepair = null;
        selectionLoaded = false;
        requestEpoch += 1;
        loadSequence += 1;
        historySequence += 1;
        pending = false;
        activeMutationToken += 1;
      }
      selection = normalized;
      scopeTuple = nextTuple;
      authorityKey = nextAuthority;
      if (elements.projectsBoardDiscussion) elements.projectsBoardDiscussion.hidden = false;
      if (tupleChanged) {
        messages = [];
        cursor = '';
        hasMore = false;
        replyParentId = replyByScope.get(scopeTuple) || '';
        historyMessageId = '';
        messageHistory = [];
        historyCursor = '';
        historyHasMore = false;
        if (elements.projectsBoardDiscussionFile) elements.projectsBoardDiscussionFile.value = '';
        setStatus('');
      }
      if (tupleChanged && elements.projectsBoardDiscussionInput) {
        elements.projectsBoardDiscussionInput.value = draftByScope.get(scopeTuple) || '';
        restoreComposerCaret();
      }
      if (authorityChanged && !tupleChanged) {
        // Immediately remove privileged content before the fresh authorized
        // hydration, including history already open under the former role.
        messages = messages.map(message => ({ ...message, body: null, mentions: [], attachmentIds: [], redacted: true }));
        messageHistory = []; historyMessageId = '';
      }
      render();
      if (selectionActive && !selectionLoaded && !loading) {
        const scope = currentScope();
        load();
        loadMentionOptions(scope);
      }
    }

    function onClick(event) {
      if (event.target.closest('[data-discussion-load-retry]')) { load(); return; }
      if (event.target.closest('[data-discussion-locate-cancel]')) { locateSequence++; locating = null; render(); setStatus('Linked update search cancelled. Loaded updates remain available.'); return; }
      const discardEdit = event.target.closest('[data-discussion-edit-discard]');
      if (discardEdit && !pending && canWrite() && !operationByScope.has(`${scopeTuple}:retry`)) { editDrafts.delete(`${scopeTuple}:edit:${discardEdit.dataset.discussionEditDiscard}`); render(); return; }
      const cancelReply = event.target.closest('[data-discussion-cancel-reply]');
      if (cancelReply && !cancelReply.disabled && canWrite() && !pending && !operationByScope.has(`${scopeTuple}:retry`)) {
        if (replyParentId) composerEdited();
        replyParentId = ''; replyByScope.delete(scopeTuple); render(); elements.projectsBoardDiscussionInput?.focus(); return;
      }
      const reply = event.target.closest('[data-discussion-reply]');
      if (reply && !reply.disabled && canWrite() && !pending && !operationByScope.has(`${scopeTuple}:retry`)) { const nextReply = reply.dataset.discussionReply || ''; if (nextReply !== replyParentId) composerEdited(); replyParentId = nextReply; replyByScope.set(scopeTuple, replyParentId); render(); elements.projectsBoardDiscussionInput?.focus(); return; }
      const editButton = event.target.closest('[data-discussion-edit]');
      if (editButton) { edit(editButton.dataset.discussionEdit); return; }
      const moderateButton = event.target.closest('[data-discussion-moderate]');
      if (moderateButton) { moderate(moderateButton.dataset.discussionModerate, moderateButton.dataset.moderationAction || 'hide'); return; }
      const attachment = event.target.closest('[data-discussion-attachment]');
      if (attachment) { download(attachment.dataset.messageId, attachment.dataset.discussionAttachment); return; }
      const historyButton = event.target.closest('[data-discussion-history]');
      if (historyButton) { loadHistory(historyButton.dataset.discussionHistory); return; }
      if (event.target.closest('[data-discussion-history-more]')) { loadHistory(historyMessageId, { append: true }); return; }
      if (event.target.closest('[data-discussion-history-close]')) { historySequence += 1; historyMessageId = ''; messageHistory = []; renderHistory(); return; }
      if (event.target.closest('#btn-projects-board-discussion-more')) load({ append: true });
    }

    let initialized = false;
    function init() {
      if (initialized) return; initialized = true;
      elements.projectsBoardDiscussionForm?.addEventListener('submit', sendMessage);
      ['focus', 'pointerdown', 'keydown'].forEach((name) => {
        elements.projectsBoardDiscussionInput?.addEventListener(name, () => { caretInteractionSequence += 1; });
      });
      elements.projectsBoardDiscussionInput?.addEventListener('input', () => {
        if (!currentScope()) return;
        const value = elements.projectsBoardDiscussionInput.value;
        if (value !== (draftByScope.get(scopeTuple) || '')) composerEdited();
        draftByScope.set(scopeTuple, value);
      });
      elements.projectsBoardDiscussionMention?.addEventListener('change', () => {
        if (!currentScope()) return;
        const values = Array.from(elements.projectsBoardDiscussionMention.selectedOptions).map((option) => option.value).filter(Boolean);
        if (JSON.stringify(values) !== JSON.stringify(mentionsByScope.get(scopeTuple) || [])) composerEdited();
        mentionsByScope.set(scopeTuple, values);
      });
      elements.projectsBoardDiscussionFile?.addEventListener('change', composerEdited);
      elements.projectsBoardDiscussionList?.addEventListener('click', onClick);
      elements.projectsBoardDiscussionHistory?.addEventListener('click', onClick);
      elements.projectsBoardDiscussionRetry?.addEventListener('click', retryMutation);
      document.getElementById('btn-projects-board-discussion-replace-upload')?.addEventListener('click', () => resolveAttachmentConflict(true));
      document.getElementById('btn-projects-board-discussion-abandon-upload')?.addEventListener('click', () => resolveAttachmentConflict(false));
      if (elements.projectsBoardDiscussion) elements.projectsBoardDiscussion.hidden = true;
      if (elements.projectsBoardDiscussionRetry) elements.projectsBoardDiscussionRetry.hidden = true;
      updateDisabled();
    }

    function mergeMessages(incoming, unavailable = []) {
      const removed = new Set(unavailable); const map = new Map(messages.filter(message => !removed.has(message.id)).map(message => [message.id, message]));
      for (const message of incoming) {
        if (message.taskId && message.taskId !== selection?.taskId) continue;
        const old = map.get(message.id);
        if (!old || Number(message.revision || 0) >= Number(old.revision || 0)) map.set(message.id, message);
      }
      messages = [...map.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    }
    async function applyRemote(change) {
      if (!selection || !change.isCurrent()) return true;
      const scope = currentScope();
      if (!scope) return false;
      const list = elements.projectsBoardDiscussionList;
      const scrollTop = list?.scrollTop;
      const incoming = change.hydration?.messages || [];
      const unavailable = change.hydration?.unavailableMessageIds || [];
      const relevant = incoming.some(message => message.taskId === selection.taskId)
        || unavailable.some(id => messages.some(message => message.id === id));
      if (!relevant && !change.discussionRefresh && !change.authorityChanged) return true;
      // Hidden loaded history still owns invalidations. Apply supplied scoped
      // records/tombstones and finish bounded repairs before acknowledging them.
      // A never-opened Overview has no loaded history to repair; activation will
      // take its first authorized snapshot without eagerly reading history here.
      if (!selectionActive && !selectionLoaded && !messages.length) return true;
      mergeMessages(incoming, unavailable);
      if (change.discussionRefresh || change.authorityChanged) {
        const repairKey = `${scopeTuple}:${scope.epoch}:${change.cursor}`;
        if (remoteRepair?.key !== repairKey) remoteRepair = { key: repairKey, ids: [...new Set([...messages.map(message => message.id), ...(change.messageIds || [])])], offset: 0, fallback: change.hydrationFallback === true, pageCursor: '', seen: new Set() };
        const repair = remoteRepair;
        // Keep loaded history and its position, but never display unvalidated
        // old bodies/attachments if the user opens Updates during a failed or
        // held repair. The same observer page retains the retry obligation.
        render(); if (list && scrollTop !== undefined) list.scrollTop = scrollTop;
        // At most four requests per turn. The observer retains this exact page
        // and rereads authority/heads before resuming, without acknowledging it.
        for (let work = 0; work < 4; work++) {
          if (repair.fallback) {
            const params = new URLSearchParams({ pageSize: '50', order: 'desc' }); if (repair.pageCursor) params.set('cursor', repair.pageCursor);
            const result = await apiFetchJson(`${taskPath()}?${params}`);
            if (!isCurrent(scope) || !change.isCurrent()) return false;
            const incoming = result.messages || []; mergeMessages(incoming); incoming.forEach(message => repair.seen.add(message.id));
            repair.pageCursor = result.nextCursor || '';
            if (!repair.pageCursor || repair.ids.every(id => repair.seen.has(id))) {
              mergeMessages([], repair.ids.filter(id => !repair.seen.has(id))); repair.offset = repair.ids.length; break;
            }
          } else {
            if (repair.offset >= repair.ids.length) break;
            try {
              const result = await apiFetchJson(`/api/projects/${encodeURIComponent(selection.projectId)}/changes/hydrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageIds: repair.ids.slice(repair.offset, repair.offset + 32) }) });
              if (!isCurrent(scope) || !change.isCurrent()) return false;
              mergeMessages(result.messages || [], result.unavailableMessageIds || []); repair.offset += 32;
            } catch (error) { if (Number(error?.status) !== 413) throw error; repair.fallback = true; }
          }
        }
        render(); if (list && scrollTop !== undefined) list.scrollTop = scrollTop;
        if (repair.offset < repair.ids.length || (repair.fallback && repair.pageCursor && !repair.ids.every(id => repair.seen.has(id)))) return false;
        remoteRepair = null;
      }
      if (!isCurrent(scope) || !change.isCurrent()) return false;
      render(); if (list && scrollTop !== undefined) list.scrollTop = scrollTop;
      return true;
    }
    return { init, setSelection, refresh: load, focusMessage, applyRemote, attachRemoteObserver(observer) { remoteObserver = observer; }, getState: () => ({ selection, messages: messages.slice(), pending }) };
  }

  const api = { createController, setSelection: () => {} };
  globalScope.CrmProjectsDiscussion = api;
  const originalCreate = api.createController;
  api.createController = function createAndBind(deps) {
    const controller = originalCreate(deps);
    api.setSelection = controller.setSelection;
    return controller;
  };
})(typeof window !== 'undefined' ? window : globalThis);
