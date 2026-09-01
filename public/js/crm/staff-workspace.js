window.CrmStaffWorkspace = (function () {
    'use strict';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function generatePassword(length = 14) {
        const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const lower = 'abcdefghijkmnopqrstuvwxyz';
        const digits = '23456789';
        const symbols = '!@#$%^&*_-+=';
        const alphabet = upper + lower + digits + symbols;

        const required = [
            upper[Math.floor(Math.random() * upper.length)],
            lower[Math.floor(Math.random() * lower.length)],
            digits[Math.floor(Math.random() * digits.length)],
            symbols[Math.floor(Math.random() * symbols.length)]
        ];

        const remaining = Math.max(Number(length || 0) - required.length, 6);
        const chars = [];
        for (let i = 0; i < remaining; i += 1) {
            chars.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
        }

        const combined = [...required, ...chars];
        for (let i = combined.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = combined[i];
            combined[i] = combined[j];
            combined[j] = tmp;
        }
        return combined.join('');
    }

    async function copyToClipboard(text) {
        const value = String(text ?? '');
        if (!value) return false;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(value);
            return true;
        }

        const input = document.createElement('input');
        input.value = value;
        input.setAttribute('readonly', 'true');
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        const ok = document.execCommand('copy');
        input.remove();
        return ok;
    }

    function createController(deps = {}) {
        const elements = deps.elements || {};
        const showToast = typeof deps.showToast === 'function' ? deps.showToast : null;
        const apiFetchJson = typeof deps.apiFetchJson === 'function' ? deps.apiFetchJson : null;
        const escape = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : escapeHtml;
        const getCurrentUser = typeof deps.getCurrentUser === 'function'
            ? deps.getCurrentUser
            : () => (window.firebase?.auth?.().currentUser || null);

        let bound = false;

        let accountCache = [];
        let accountCurrentUid = '';
        let accountBootstrapSet = new Set(['huathanhnam95@gmail.com']);
        const accountSelection = new Set();
        const accountFilters = { search: '', status: 'active' };

        function setError(message) {
            if (!elements.staffCreateTeacherError) return;
            const text = String(message || '').trim();
            elements.staffCreateTeacherError.textContent = text;
            elements.staffCreateTeacherError.style.display = text ? 'block' : 'none';
        }

        function setBusy(isBusy) {
            if (!elements.btnStaffCreateTeacher) return;
            elements.btnStaffCreateTeacher.disabled = !!isBusy;
            elements.btnStaffCreateTeacher.textContent = isBusy ? 'Creating...' : 'Create teacher';
        }

        function renderTeacherList(list) {
            if (!elements.staffTeacherList) return;
            const teachers = Array.isArray(list) ? list : [];
            if (!teachers.length) {
                elements.staffTeacherList.innerHTML = '<div class="crm-muted">No teacher accounts found.</div>';
                return;
            }

            elements.staffTeacherList.innerHTML = `
                <table class="crm-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th style="width: 260px;">UID</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${teachers.map((t) => `
                            <tr>
                                <td>${escape(t.displayName || '')}</td>
                                <td>${escape(t.email || '')}</td>
                                <td style="font-family: monospace; font-size: 12px;">${escape(t.uid || '')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        function normalizeAccount(acc) {
            const uid = String(acc?.uid || '').trim();
            const email = String(acc?.email || '').trim();
            return {
                uid,
                email,
                displayName: String(acc?.displayName || '').trim(),
                isAdmin: Boolean(acc?.isAdmin),
                isTeacher: Boolean(acc?.isTeacher),
                archived: Boolean(acc?.archived),
                isProtected: accountBootstrapSet.has(email.toLowerCase())
                    || Boolean(accountCurrentUid && uid === accountCurrentUid)
            };
        }

        function getVisibleAccounts() {
            const search = accountFilters.search.trim().toLowerCase();
            return accountCache.filter((acc) => {
                if (accountFilters.status === 'active' && acc.archived) return false;
                if (accountFilters.status === 'archived' && !acc.archived) return false;
                if (!search) return true;
                return `${acc.displayName} ${acc.email} ${acc.uid}`.toLowerCase().includes(search);
            });
        }

        function getSelectableAccounts() {
            return getVisibleAccounts().filter((acc) => !acc.isProtected);
        }

        function pruneSelection() {
            const selectable = new Set(getSelectableAccounts().map((acc) => acc.uid));
            for (const uid of Array.from(accountSelection)) {
                if (!selectable.has(uid)) accountSelection.delete(uid);
            }
        }

        function buildRoleBadge(acc) {
            if (acc.isAdmin) {
                return '<span class="crm-tag crm-account-badge crm-account-badge-admin">Admin</span>';
            }
            if (acc.isTeacher) {
                return '<span class="crm-tag crm-account-badge crm-account-badge-teacher">Teacher</span>';
            }
            return '<span class="crm-tag crm-account-badge crm-account-badge-user">User</span>';
        }

        function buildRowActions(acc) {
            if (acc.isProtected) {
                return '<span class="crm-muted crm-account-protected">Protected</span>';
            }

            const uid = escape(acc.uid);
            const label = escape(acc.email || acc.displayName);
            const buttons = [];

            if (acc.isAdmin) {
                buttons.push(`<button type="button" class="crm-btn-secondary crm-btn-sm btn-account-toggle-admin crm-btn-danger-text" data-uid="${uid}" data-action="demote" data-email="${label}">Revoke admin</button>`);
            } else {
                buttons.push(`<button type="button" class="crm-btn-secondary crm-btn-sm btn-account-toggle-admin" data-uid="${uid}" data-action="promote" data-email="${label}">Grant admin</button>`);
            }

            if (acc.archived) {
                buttons.push(`<button type="button" class="crm-btn-secondary crm-btn-sm btn-account-archive" data-uid="${uid}" data-action="restore" data-email="${label}">Restore</button>`);
            } else {
                buttons.push(`<button type="button" class="crm-btn-secondary crm-btn-sm btn-account-archive" data-uid="${uid}" data-action="archive" data-email="${label}">Archive</button>`);
            }

            if (acc.isAdmin) {
                // Deleting an admin is blocked server-side; mirror that here so the
                // reason is visible before the click rather than after a 403.
                buttons.push('<button type="button" class="crm-btn-secondary crm-btn-sm" disabled title="Revoke admin access before deleting this account.">Delete</button>');
            } else {
                buttons.push(`<button type="button" class="crm-btn-secondary crm-btn-sm btn-account-delete crm-btn-danger-text" data-uid="${uid}" data-email="${label}">Delete</button>`);
            }

            return `<div class="crm-account-row-actions">${buttons.join('')}</div>`;
        }

        function renderAccountToolbar() {
            const statusOptions = [
                ['active', 'Active'],
                ['archived', 'Archived'],
                ['all', 'All']
            ].map(([value, text]) => `<option value="${value}"${accountFilters.status === value ? ' selected' : ''}>${text}</option>`).join('');

            return `
                <div class="crm-account-toolbar">
                    <div class="crm-account-toolbar-filters">
                        <input id="staff-account-search" type="search" class="crm-input crm-account-search"
                            placeholder="Search name, email or UID..." autocomplete="off"
                            value="${escape(accountFilters.search)}">
                        <select id="staff-account-status-filter" class="crm-input crm-account-status-filter" aria-label="Account status filter">
                            ${statusOptions}
                        </select>
                    </div>
                    <div class="crm-account-toolbar-actions">
                        <span id="staff-account-selection-count" class="crm-muted crm-account-selection-count"></span>
                        <button type="button" id="btn-account-bulk-archive" class="crm-btn-secondary crm-btn-sm" data-bulk-action="archive">Archive</button>
                        <button type="button" id="btn-account-bulk-restore" class="crm-btn-secondary crm-btn-sm" data-bulk-action="restore">Restore</button>
                        <button type="button" id="btn-account-bulk-delete" class="crm-btn-secondary crm-btn-sm crm-btn-danger-text" data-bulk-action="delete">Delete</button>
                    </div>
                </div>
            `;
        }

        function renderAccountTable() {
            const visible = getVisibleAccounts();
            if (!visible.length) {
                return `<div class="crm-muted crm-account-empty">${accountCache.length
                    ? 'No accounts match the current filter.'
                    : 'No user accounts found.'}</div>`;
            }

            const selectable = getSelectableAccounts();
            const allSelected = selectable.length > 0
                && selectable.every((acc) => accountSelection.has(acc.uid));

            return `
                <table class="crm-table crm-account-table">
                    <thead>
                        <tr>
                            <th class="crm-account-check-cell">
                                <input type="checkbox" id="staff-account-select-all" aria-label="Select all accounts"
                                    ${allSelected ? 'checked' : ''} ${selectable.length ? '' : 'disabled'}>
                            </th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th class="crm-account-actions-cell">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${visible.map((acc) => `
                            <tr${acc.archived ? ' class="crm-account-row-archived"' : ''}>
                                <td class="crm-account-check-cell">
                                    ${acc.isProtected
                                        ? ''
                                        : `<input type="checkbox" class="account-select-checkbox" data-uid="${escape(acc.uid)}"
                                            aria-label="Select ${escape(acc.email || acc.displayName || acc.uid)}"
                                            ${accountSelection.has(acc.uid) ? 'checked' : ''}>`}
                                </td>
                                <td><strong>${escape(acc.displayName || '—')}</strong></td>
                                <td>${escape(acc.email || '—')}</td>
                                <td>${buildRoleBadge(acc)}</td>
                                <td>${acc.archived
                                    ? '<span class="crm-tag crm-account-badge crm-account-badge-archived">Archived</span>'
                                    : '<span class="crm-muted crm-account-status-active">Active</span>'}</td>
                                <td class="crm-account-actions-cell">${buildRowActions(acc)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        function syncBulkActionState() {
            if (!elements.staffAccountList) return;
            const count = accountSelection.size;
            const countEl = elements.staffAccountList.querySelector('#staff-account-selection-count');
            if (countEl) {
                countEl.textContent = count ? `${count} selected` : 'None selected';
            }
            elements.staffAccountList.querySelectorAll('[data-bulk-action]').forEach((btn) => {
                btn.disabled = count === 0;
            });
        }

        function paintAccounts() {
            if (!elements.staffAccountList) return;
            pruneSelection();

            const tableHtml = renderAccountTable();
            const existingTable = elements.staffAccountList.querySelector('.crm-account-table-wrap');

            // Re-rendering only the table keeps focus and caret position inside the
            // search box while the admin is typing.
            if (existingTable) {
                existingTable.innerHTML = tableHtml;
            } else {
                elements.staffAccountList.innerHTML = `
                    ${renderAccountToolbar()}
                    <div class="crm-account-table-wrap">${tableHtml}</div>
                `;
            }

            syncBulkActionState();
        }

        function renderAccountList(accounts, currentUid, bootstrapEmails = ['huathanhnam95@gmail.com']) {
            if (!elements.staffAccountList) return;

            accountCurrentUid = String(currentUid || '').trim();
            accountBootstrapSet = new Set(
                (Array.isArray(bootstrapEmails) ? bootstrapEmails : [bootstrapEmails])
                    .map((e) => String(e || '').trim().toLowerCase())
                    .filter(Boolean)
            );
            accountCache = (Array.isArray(accounts) ? accounts : [])
                .map(normalizeAccount)
                .filter((acc) => acc.uid);

            paintAccounts();
        }

        async function refreshTeachers() {
            if (!apiFetchJson) return false;
            try {
                const payload = await apiFetchJson('/api/admin/teachers', { method: 'GET' });
                const teachers = Array.isArray(payload?.teachers) ? payload.teachers : [];
                renderTeacherList(teachers);
                return true;
            } catch (error) {
                renderTeacherList([]);
                showToast?.(error?.message || 'Failed to load teachers.', 'error');
                return false;
            }
        }

        async function refreshAccounts() {
            if (!apiFetchJson) return false;
            try {
                const payload = await apiFetchJson('/api/admin/accounts', { method: 'GET' });
                const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
                const currentUser = getCurrentUser?.();
                const currentUid = String(currentUser?.uid || '').trim();
                renderAccountList(accounts, currentUid);
                return true;
            } catch (error) {
                renderAccountList([]);
                showToast?.(error?.message || 'Failed to load accounts.', 'error');
                return false;
            }
        }

        async function refresh() {
            const [teachersOk, accountsOk] = await Promise.all([
                refreshTeachers(),
                refreshAccounts()
            ]);
            return teachersOk && accountsOk;
        }

        const activeToggles = new Set();

        async function handleToggleAdmin(uid, action, targetEmail) {
            if (!apiFetchJson || !uid) return;
            if (activeToggles.has(uid)) return;

            const isPromote = action === 'promote';
            const label = targetEmail || uid;
            const confirmMsg = isPromote
                ? `Are you sure you want to promote "${label}" to Admin?`
                : `Are you sure you want to demote "${label}" from Admin?`;

            if (!window.confirm(confirmMsg)) {
                return;
            }

            activeToggles.add(uid);
            try {
                const res = await apiFetchJson(`/api/admin/accounts/${encodeURIComponent(uid)}/role`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isAdmin: isPromote })
                });

                showToast?.(res?.message || (isPromote ? 'Account promoted to Admin.' : 'Account demoted from Admin.'), 'success');
                await refreshAccounts();
            } catch (error) {
                showToast?.(error?.message || (isPromote ? 'Failed to promote account.' : 'Failed to demote account.'), 'error');
            } finally {
                activeToggles.delete(uid);
            }
        }

        async function handleArchiveAccount(uid, action, targetEmail) {
            if (!apiFetchJson || !uid) return;
            if (activeToggles.has(uid)) return;

            const archived = action === 'archive';
            const label = targetEmail || uid;
            const confirmMsg = archived
                ? `Archive "${label}"? They will be signed out and blocked from logging in until restored.`
                : `Restore "${label}"? They will be able to log in again.`;

            if (!window.confirm(confirmMsg)) return;

            activeToggles.add(uid);
            try {
                const res = await apiFetchJson(`/api/admin/accounts/${encodeURIComponent(uid)}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ archived })
                });
                showToast?.(res?.message || (archived ? 'Account archived.' : 'Account restored.'), 'success');
                await refreshAccounts();
            } catch (error) {
                showToast?.(error?.message || (archived ? 'Failed to archive account.' : 'Failed to restore account.'), 'error');
            } finally {
                activeToggles.delete(uid);
            }
        }

        async function handleDeleteAccount(uid, targetEmail) {
            if (!apiFetchJson || !uid) return;
            if (activeToggles.has(uid)) return;

            const label = targetEmail || uid;
            if (!window.confirm(`Permanently delete "${label}"?\n\nThis removes the login and the user profile. It cannot be undone — use Archive instead if you may need the account later.`)) {
                return;
            }

            activeToggles.add(uid);
            try {
                const res = await apiFetchJson(`/api/admin/accounts/${encodeURIComponent(uid)}`, { method: 'DELETE' });
                showToast?.(res?.message || 'Account deleted permanently.', 'success');
                accountSelection.delete(uid);
                await refreshAccounts();
            } catch (error) {
                showToast?.(error?.message || 'Failed to delete account.', 'error');
            } finally {
                activeToggles.delete(uid);
            }
        }

        async function handleBulkAccountAction(action) {
            if (!apiFetchJson) return;
            const uids = Array.from(accountSelection);
            if (!uids.length) return;

            const prompts = {
                archive: `Archive ${uids.length} account(s)? They will be blocked from logging in until restored.`,
                restore: `Restore ${uids.length} account(s)? They will be able to log in again.`,
                delete: `Permanently delete ${uids.length} account(s)?\n\nThis removes their logins and profiles. It cannot be undone — use Archive instead if you may need them later.`
            };

            if (!window.confirm(prompts[action] || `Apply "${action}" to ${uids.length} account(s)?`)) {
                return;
            }

            try {
                const res = await apiFetchJson('/api/admin/accounts/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, uids })
                });

                accountSelection.clear();
                showToast?.(res?.message || 'Accounts updated.', res?.skippedCount ? 'warning' : 'success');
                await refreshAccounts();
            } catch (error) {
                showToast?.(error?.message || 'Failed to update accounts.', 'error');
            }
        }

        async function handleCreateTeacher() {
            if (!apiFetchJson) return;
            setError('');

            const email = String(elements.staffTeacherEmail?.value || '').trim();
            const displayName = String(elements.staffTeacherDisplayName?.value || '').trim();
            const password = String(elements.staffTeacherPassword?.value || '').trim();

            if (!email) {
                setError('Email is required.');
                elements.staffTeacherEmail?.focus?.();
                return;
            }
            if (!password) {
                setError('Password is required.');
                elements.staffTeacherPassword?.focus?.();
                return;
            }

            setBusy(true);
            try {
                await apiFetchJson('/api/admin/teachers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        password,
                        displayName: displayName || null
                    })
                });

                showToast?.('Teacher account created.', 'success');
                if (elements.staffTeacherPassword) elements.staffTeacherPassword.value = '';
                await refresh();
            } catch (error) {
                setError(error?.message || 'Failed to create teacher.');
            } finally {
                setBusy(false);
            }
        }

        function init() {
            if (bound) return;
            bound = true;

            if (elements.btnStaffRefresh) {
                elements.btnStaffRefresh.addEventListener('click', () => {
                    refresh().catch(() => { });
                });
            }

            if (elements.btnStaffGeneratePassword && elements.staffTeacherPassword) {
                elements.btnStaffGeneratePassword.addEventListener('click', () => {
                    elements.staffTeacherPassword.value = generatePassword();
                    setError('');
                });
            }

            if (elements.btnStaffTogglePassword && elements.staffTeacherPassword) {
                elements.btnStaffTogglePassword.addEventListener('click', () => {
                    const input = elements.staffTeacherPassword;
                    const next = input.type === 'password' ? 'text' : 'password';
                    input.type = next;
                    elements.btnStaffTogglePassword.textContent = next === 'text' ? 'Hide' : 'Show';
                });
            }

            if (elements.btnStaffCopyPassword && elements.staffTeacherPassword) {
                elements.btnStaffCopyPassword.addEventListener('click', () => {
                    copyToClipboard(elements.staffTeacherPassword.value)
                        .then((ok) => {
                            if (ok) showToast?.('Password copied.', 'success');
                        })
                        .catch(() => showToast?.('Copy unavailable.', 'error'));
                });
            }

            if (elements.btnStaffCreateTeacher) {
                elements.btnStaffCreateTeacher.addEventListener('click', () => {
                    handleCreateTeacher().catch(() => { });
                });
            }

            if (elements.staffTeacherPassword) {
                elements.staffTeacherPassword.addEventListener('keydown', (evt) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        handleCreateTeacher().catch(() => { });
                    }
                });
            }

            if (elements.staffAccountList) {
                elements.staffAccountList.addEventListener('click', (evt) => {
                    const bulkBtn = evt.target.closest('[data-bulk-action]');
                    if (bulkBtn && !bulkBtn.disabled) {
                        handleBulkAccountAction(bulkBtn.getAttribute('data-bulk-action')).catch(() => { });
                        return;
                    }

                    const adminBtn = evt.target.closest('.btn-account-toggle-admin');
                    if (adminBtn) {
                        const uid = adminBtn.getAttribute('data-uid');
                        const action = adminBtn.getAttribute('data-action');
                        if (uid && action) {
                            handleToggleAdmin(uid, action, adminBtn.getAttribute('data-email')).catch(() => { });
                        }
                        return;
                    }

                    const archiveBtn = evt.target.closest('.btn-account-archive');
                    if (archiveBtn) {
                        const uid = archiveBtn.getAttribute('data-uid');
                        const action = archiveBtn.getAttribute('data-action');
                        if (uid && action) {
                            handleArchiveAccount(uid, action, archiveBtn.getAttribute('data-email')).catch(() => { });
                        }
                        return;
                    }

                    const deleteBtn = evt.target.closest('.btn-account-delete');
                    if (deleteBtn) {
                        const uid = deleteBtn.getAttribute('data-uid');
                        if (uid) {
                            handleDeleteAccount(uid, deleteBtn.getAttribute('data-email')).catch(() => { });
                        }
                    }
                });

                elements.staffAccountList.addEventListener('change', (evt) => {
                    const target = evt.target;

                    if (target.id === 'staff-account-select-all') {
                        const selectable = getSelectableAccounts();
                        if (target.checked) {
                            selectable.forEach((acc) => accountSelection.add(acc.uid));
                        } else {
                            selectable.forEach((acc) => accountSelection.delete(acc.uid));
                        }
                        paintAccounts();
                        return;
                    }

                    if (target.classList?.contains('account-select-checkbox')) {
                        const uid = target.getAttribute('data-uid');
                        if (!uid) return;
                        if (target.checked) {
                            accountSelection.add(uid);
                        } else {
                            accountSelection.delete(uid);
                        }
                        // Repaint so the header "select all" box tracks the row state.
                        paintAccounts();
                        return;
                    }

                    if (target.id === 'staff-account-status-filter') {
                        accountFilters.status = String(target.value || 'active');
                        paintAccounts();
                    }
                });

                elements.staffAccountList.addEventListener('input', (evt) => {
                    if (evt.target.id !== 'staff-account-search') return;
                    accountFilters.search = String(evt.target.value || '');
                    paintAccounts();
                });
            }

            refresh().catch(() => { });
        }

        return {
            init,
            refresh,
            refreshTeachers,
            refreshAccounts,
            renderTeacherList,
            renderAccountList,
            handleToggleAdmin,
            handleArchiveAccount,
            handleDeleteAccount,
            handleBulkAccountAction
        };
    }

    return {
        createController
    };
})();

