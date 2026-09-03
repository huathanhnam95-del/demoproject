window.CrmStudentDirectoryWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            dataCache,
            apiFetchJson,
            populateAttendanceStudentOptions,
            openStudentProfile,
            showToast,
            getReminderSummary,
            renderReminderBadgeMarkup,
            renderRiskBadgeMarkup,
            escapeHtml,
            formatDateTime,
            refreshDashboard
        } = deps;
        const selectedStudentIds = new Set();

        function studentDisplayName(student) {
            const name = String(student?.name || '').trim();
            if (name) return name;
            const email = String(student?.email || '').trim();
            if (email) return email;
            const phone = String(student?.phone || '').trim();
            if (phone) return phone;
            return 'Unnamed student';
        }

        function studentContact(student) {
            const email = String(student?.email || '').trim();
            const phone = String(student?.phone || '').trim();
            if (email && phone) return `${email} | ${phone}`;
            if (email) return email;
            if (phone) return phone;
            const zalo = String(student?.zalo || '').trim();
            if (zalo) return `Zalo: ${zalo}`;
            return '-';
        }

        function updateSelection(studentId, selected) {
            const id = String(studentId || '').trim();
            if (!id) return;
            if (selected) selectedStudentIds.add(id);
            else selectedStudentIds.delete(id);
        }

        function clearSelection() {
            selectedStudentIds.clear();
        }

        function pruneSelection(validIds) {
            const keep = new Set(Array.isArray(validIds) ? validIds.map((id) => String(id || '').trim()).filter(Boolean) : []);
            Array.from(selectedStudentIds).forEach((id) => {
                if (!keep.has(id)) {
                    selectedStudentIds.delete(id);
                }
            });
        }

        function selectedCount() {
            return selectedStudentIds.size;
        }

        async function showBulkDeleteWarningDialog({
            title,
            note,
            totalCount,
            deletableCount,
            blocked,
            entityLabel,
            summaryCards,
            detailTitle,
            detailNote,
            detailItems,
            confirmLabel,
            requiresText,
            badgeText
        }) {
            const dialog = window.CrmAdminDialogs && typeof window.CrmAdminDialogs.showBulkDeleteWarning === 'function'
                ? window.CrmAdminDialogs.showBulkDeleteWarning
                : null;
            if (!dialog) {
                showToast('Archive warning dialog is unavailable.', 'error');
                return false;
            }
            return dialog({
                title,
                note,
                totalCount,
                deletableCount,
                blocked,
                entityLabel,
                summaryCards,
                detailTitle,
                detailNote,
                detailItems,
                confirmLabel,
                requiresText,
                badgeText
            });
        }

        async function bulkDeleteStudents() {
            const ids = Array.from(selectedStudentIds);
            if (!ids.length) return;

            let preview;
            try {
                preview = await apiFetchJson('/api/admin/students/bulk-delete/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
            } catch (error) {
                if (Number(error?.status) === 404) {
                    throw new Error('Recycle-bin archive is not available in the currently running backend. Restart or redeploy the server, then try again.');
                }
                throw error;
            }

            const archiveable = Array.isArray(preview.archiveableIds) ? preview.archiveableIds : [];
            const notFoundIds = Array.isArray(preview.notFoundIds) ? preview.notFoundIds : [];
            const impactSummary = Array.isArray(preview.impactSummary) ? preview.impactSummary : [];
            const expiresAt = String(preview.expiresAt || '').trim();
            const previewItems = impactSummary.map((item) => ({
                title: String(item?.title || item?.id || 'Student').trim() || 'Student',
                subtitle: [String(item?.rootEntityType || 'student').trim(), String(item?.subtitle || item?.sourcePanel || '').trim()].filter(Boolean).join(' · '),
                detailText: expiresAt ? `Expires ${formatDateTime(expiresAt)}` : 'Retained for 30 days',
                details: Array.isArray(item?.details) ? item.details : []
            })).concat(notFoundIds.map((id) => ({
                kind: 'missing',
                title: id,
                subtitle: 'Not found',
                detailText: 'Skipped during archive.'
            })));
            const proceed = await showBulkDeleteWarningDialog({
                title: `Move ${ids.length} student${ids.length === 1 ? '' : 's'} to Recycle Bin?`,
                note: `${archiveable.length} student${archiveable.length === 1 ? '' : 's'} will move to Recycle Bin and stay there for 30 days.`,
                totalCount: ids.length,
                deletableCount: archiveable.length,
                summaryCards: [
                    { label: 'Selected', value: String(ids.length) },
                    { label: 'Will archive', value: String(archiveable.length) },
                    { label: 'Not found', value: String(notFoundIds.length) }
                ],
                detailTitle: 'Archive preview',
                detailNote: expiresAt ? `Archived records are retained until ${formatDateTime(expiresAt)}.` : 'Archived records are retained for 30 days.',
                detailItems: previewItems,
                entityLabel: 'student',
                confirmLabel: 'Move to Recycle Bin',
                requiresText: 'archive',
                badgeText: 'Warning'
            });
            if (!proceed) {
                return;
            }

            const result = await apiFetchJson('/api/admin/students/bulk-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });

            clearSelection();
            await refreshStudentLists();
            if (typeof refreshDashboard === 'function') {
                await refreshDashboard().catch(() => {});
            }
            const archivedCount = Array.isArray(result.archivedIds) ? result.archivedIds.length : 0;
            const notFoundCount = Array.isArray(result.notFoundIds) ? result.notFoundIds.length : 0;
            if (archivedCount > 0) {
                showToast(notFoundCount > 0
                    ? `Moved ${archivedCount} student(s) to Recycle Bin. ${notFoundCount} were not found.`
                    : `Moved ${archivedCount} student(s) to Recycle Bin.`, 'success');
                return;
            }
            showToast('No student records were moved to Recycle Bin.', 'error');
        }

        function renderStudentsTable(container, students, emptyMessage) {
            if (!container) return;

            if (!container.__crmStudentLinkHandlerBound) {
                container.addEventListener('click', (event) => {
                    const button = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('button.crm-student-link[data-student-id]')
                        : null;
                    if (!button || !container.contains(button)) return;

                    const id = String(button.dataset.studentId || '').trim();
                    const cached = Array.isArray(dataCache.students)
                        ? dataCache.students.find((student) => String(student.studentId || '').trim() === id) || null
                        : null;
                    openStudentProfile(id, cached).catch((error) => {
                        console.error('[CRM Admin] Open student profile failed:', error);
                        showToast(error?.message || 'Failed to open student profile.', 'error');
                    });
                });
                container.__crmStudentLinkHandlerBound = true;
            }

            const list = Array.isArray(students) ? students : [];
            if (list.length === 0) {
                container.classList.add('crm-placeholder-card');
                container.classList.remove('crm-table-host');
                container.innerHTML = `<div class="crm-muted">${escapeHtml(emptyMessage || 'No students yet.')}</div>`;
                return;
            }

            container.classList.remove('crm-placeholder-card');
            container.classList.add('crm-table-host');

            const checkedCount = selectedCount();
            const allChecked = checkedCount > 0 && list.every((student) => selectedStudentIds.has(String(student.studentId || '').trim()));
            const toolbar = `
                <div class="crm-inline-fields" style="justify-content: space-between; margin-bottom: 12px;">
                    <div class="crm-muted">${checkedCount ? `${checkedCount} selected` : 'Select rows to move to Recycle Bin.'}</div>
                    <button type="button" class="crm-btn-secondary" data-action="bulk-delete" ${checkedCount ? '' : 'disabled'}>Archive Selected</button>
                </div>
            `;

            const rows = list.map((student) => {
                const studentId = String(student.studentId || '').trim();
                const displayName = studentDisplayName(student);
                const label = String(student.label || '').trim() || '-';
                const contact = studentContact(student);
                const crmId = String(student.crmId || '').trim();
                const checked = selectedStudentIds.has(studentId);
                return `
        <tr>
          <td style="width: 56px; text-align: center; padding-left: 14px; padding-right: 14px;">
            <input type="checkbox" data-student-select="${escapeHtml(studentId)}" ${checked ? 'checked' : ''}>
          </td>
          <td class="td-bold">
            <div class="crm-name-cell">
              <button type="button" class="crm-student-link" data-student-id="${escapeHtml(studentId)}">${escapeHtml(displayName)}</button>
              ${renderReminderBadgeMarkup(getReminderSummary({ studentId }))}
              ${renderRiskBadgeMarkup(studentId)}
            </div>
          </td>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(contact)}</td>
          <td>${escapeHtml(formatDateTime(student.createdAt))}</td>
          <td><code>${escapeHtml(crmId || '—')}</code></td>
        </tr>
      `;
            }).join('');

            container.innerHTML = `
      <div class="crm-table-container">
          <table class="crm-table">
          <thead>
            <tr>
              <th style="width:56px; text-align:center; padding-left:14px; padding-right:14px;">
                <input type="checkbox" data-student-select-all ${allChecked ? 'checked' : ''}>
              </th>
              <th>Name</th>
              <th>Label</th>
              <th>Contact</th>
              <th>Created</th>
              <th>CRM ID</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;

            container.innerHTML = toolbar + container.innerHTML;
            if (!container.__crmStudentBulkDeleteBound) {
                container.addEventListener('change', (event) => {
                    const checkbox = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('input[type="checkbox"][data-student-select]')
                        : null;
                    if (!checkbox || !container.contains(checkbox)) return;
                    updateSelection(checkbox.dataset.studentSelect, checkbox.checked);
                    renderStudentsTable(container, students, emptyMessage);
                });
                container.addEventListener('click', (event) => {
                    const selectAll = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('input[type="checkbox"][data-student-select-all]')
                        : null;
                    if (!selectAll || !container.contains(selectAll)) return;
                    if (selectAll.checked) {
                        list.forEach((student) => {
                            const id = String(student.studentId || '').trim();
                            if (id) selectedStudentIds.add(id);
                        });
                    } else {
                        clearSelection();
                    }
                    renderStudentsTable(container, students, emptyMessage);
                });
                container.addEventListener('click', (event) => {
                    const button = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('button[data-action="bulk-delete"]')
                        : null;
                    if (!button || !container.contains(button)) return;
                    bulkDeleteStudents().catch((error) => {
                        console.error('[CRM Admin] Bulk archive students failed:', error);
                        showToast(error?.message || 'Failed to archive students.', 'error');
                    });
                });
                container.__crmStudentBulkDeleteBound = true;
            }
        }

        async function fetchStudentsFromFirestore(limit) {
            if (!window.firebase?.firestore) {
                throw new Error('Firestore is unavailable.');
            }
            const snap = await window.firebase.firestore()
                .collection('crmStudents')
                .orderBy('created_at', 'desc')
                .limit(Number(limit) || 200)
                .get();
            const rows = [];
            snap.forEach((doc) => {
                rows.push({ studentId: doc.id, ...doc.data() });
            });
            return rows;
        }

        async function refreshStudentLists() {
            let students = [];
            try {
                const json = await apiFetchJson('/api/admin/students?limit=200', { method: 'GET' });
                students = Array.isArray(json.students) ? json.students : [];
            } catch (error) {
                if (Number(error?.status) === 404) {
                    students = await fetchStudentsFromFirestore(200);
                } else {
                    throw error;
                }
            }

            dataCache.students = students;
            pruneSelection(students.map((student) => student.studentId));

            const targetContainer = elements.studentsContainer
                || elements.studentDataContainer
                || elements.potentialStudentsContainer;

            if (targetContainer) {
                renderStudentsTable(targetContainer, students, 'No students in database yet.');
            }

            if (elements.potentialStudentsContainer && elements.potentialStudentsContainer !== targetContainer) {
                const buckets = window.CrmStudents && typeof window.CrmStudents.splitStudents === 'function'
                    ? window.CrmStudents.splitStudents(students)
                    : { potential: students, studentData: [] };
                renderStudentsTable(elements.potentialStudentsContainer, buckets.potential, 'No potential students yet.');
                renderStudentsTable(elements.studentDataContainer, buckets.studentData, 'No students in database yet.');
            }

            await populateAttendanceStudentOptions();
        }

        return {
            fetchStudentsFromFirestore,
            renderStudentsTable,
            refreshStudentLists
        };
    }

    return {
        createController
    };
})();
