window.CrmStaffWorkspace = (function () {
    'use strict';

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
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

        async function refresh() {
            if (!apiFetchJson) return;
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
        }

        return {
            init,
            refresh
        };
    }

    return {
        createController
    };
})();

