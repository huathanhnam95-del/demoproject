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

        function renderAccountList(accounts, currentUid, bootstrapEmails = ['huathanhnam95@gmail.com']) {
            if (!elements.staffAccountList) return;
            const list = Array.isArray(accounts) ? accounts : [];
            if (!list.length) {
                elements.staffAccountList.innerHTML = '<div class="crm-muted">No user accounts found.</div>';
                return;
            }

            const bootstrapSet = new Set(
                (Array.isArray(bootstrapEmails) ? bootstrapEmails : [bootstrapEmails])
                    .map((e) => String(e || '').trim().toLowerCase())
                    .filter(Boolean)
            );

            elements.staffAccountList.innerHTML = `
                <table class="crm-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Role</th>
                            <th style="width: 140px; text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${list.map((acc) => {
                            const uid = String(acc.uid || '').trim();
                            const email = String(acc.email || '').trim();
                            const displayName = String(acc.displayName || '').trim();
                            const isAdmin = Boolean(acc.isAdmin);
                            const isTeacher = Boolean(acc.isTeacher);
                            const isCurrent = Boolean(currentUid && uid === currentUid);
                            const isBootstrap = bootstrapSet.has(email.toLowerCase());

                            let roleBadge = '<span class="crm-tag" style="background:#f1f3f4; color:#5f6368; font-weight:600; padding:2px 8px; border-radius:12px; font-size:12px;">User</span>';
                            if (isAdmin) {
                                roleBadge = '<span class="crm-tag" style="background:#e6f4ea; color:#137333; font-weight:600; padding:2px 8px; border-radius:12px; font-size:12px;">Admin</span>';
                            } else if (isTeacher) {
                                roleBadge = '<span class="crm-tag" style="background:#e8f0fe; color:#1a73e8; font-weight:600; padding:2px 8px; border-radius:12px; font-size:12px;">Teacher</span>';
                            }

                            let actionBtn = '';
                            if (isAdmin) {
                                if (isBootstrap || isCurrent) {
                                    actionBtn = '<span class="crm-muted" style="font-size:12px;">Protected</span>';
                                } else {
                                    actionBtn = `<button type="button" class="crm-btn-secondary crm-btn-sm btn-account-toggle-admin" data-uid="${escape(uid)}" data-action="demote" data-email="${escape(email || displayName)}" style="color:#d93025; border-color:#fad2cf;">Demote</button>`;
                                }
                            } else {
                                actionBtn = `<button type="button" class="crm-btn-secondary crm-btn-sm btn-account-toggle-admin" data-uid="${escape(uid)}" data-action="promote" data-email="${escape(email || displayName)}">Promote</button>`;
                            }

                            return `
                                <tr>
                                    <td><strong>${escape(displayName || '—')}</strong></td>
                                    <td>${escape(email || '—')}</td>
                                    <td>${roleBadge}</td>
                                    <td style="text-align: right;">${actionBtn}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
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
                    const btn = evt.target.closest('.btn-account-toggle-admin');
                    if (!btn) return;
                    const uid = btn.getAttribute('data-uid');
                    const action = btn.getAttribute('data-action');
                    const email = btn.getAttribute('data-email');
                    if (uid && action) {
                        handleToggleAdmin(uid, action, email).catch(() => { });
                    }
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
            handleToggleAdmin
        };
    }

    return {
        createController
    };
})();

