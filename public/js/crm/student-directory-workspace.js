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
        let currentSearchQuery = '';
        let currentTeacherFilter = 'all';
        const studentTeacherMap = new Map();
        let isToolbarBound = false;

        function foldVietnamese(str) {
            return String(str || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/đ/g, 'd')
                .replace(/Đ/g, 'D')
                .toLowerCase()
                .trim();
        }

        function resolveStudentTeacher(student) {
            const directUid = String(student?.assignedTeacherUid || '').trim();
            const directName = String(student?.assignedTeacherName || '').trim();
            if (directUid || directName) {
                let name = directName;
                if (!name) {
                    if (directUid === 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83') name = 'Shawn';
                    else if (directUid === 'JP0UmCufWpdDkKkZazh7Ajo4PfX2') name = 'Hứa Thanh Nam';
                    else name = 'Teacher';
                }
                return { uid: directUid, name };
            }

            const studentId = String(student?.studentId || '').trim();
            if (studentId && studentTeacherMap.has(studentId)) {
                return studentTeacherMap.get(studentId);
            }

            return { uid: null, name: null };
        }

        function isTeacherMatch(teacherInfo, filter) {
            if (!filter || filter === 'all') return true;
            const uid = String(teacherInfo?.uid || '').trim();
            const name = String(teacherInfo?.name || '').trim().toLowerCase();

            if (filter === 'unassigned') {
                return !uid && !name;
            }

            if (filter === 'Shawn') {
                return uid === 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83' || name.includes('shawn');
            }

            if (filter === 'Hứa Thanh Nam') {
                return uid === 'JP0UmCufWpdDkKkZazh7Ajo4PfX2' || name.includes('nam');
            }

            return uid === filter || name === filter.toLowerCase();
        }

        function applyFilters(students) {
            const rawList = Array.isArray(students) ? students : [];
            const foldedQuery = foldVietnamese(currentSearchQuery);

            return rawList.filter((student) => {
                if (foldedQuery) {
                    const rawName = String(student?.name || '');
                    const foldedName = foldVietnamese(rawName);
                    const rawContact = String(student?.email || '') + ' ' + String(student?.phone || '');
                    const rawCrmId = String(student?.crmId || '');
                    if (!foldedName.includes(foldedQuery) && !rawContact.toLowerCase().includes(foldedQuery) && !rawCrmId.toLowerCase().includes(foldedQuery)) {
                        return false;
                    }
                }

                if (currentTeacherFilter !== 'all') {
                    const teacherInfo = resolveStudentTeacher(student);
                    if (!isTeacherMatch(teacherInfo, currentTeacherFilter)) {
                        return false;
                    }
                }

                return true;
            });
        }

        function updateFilterCounts(students) {
            const allList = Array.isArray(students) ? students : [];
            let unassignedCount = 0;
            let shawnCount = 0;
            let namCount = 0;

            allList.forEach((s) => {
                const t = resolveStudentTeacher(s);
                if (!t.uid && !t.name) {
                    unassignedCount += 1;
                } else if (isTeacherMatch(t, 'Shawn')) {
                    shawnCount += 1;
                } else if (isTeacherMatch(t, 'Hứa Thanh Nam')) {
                    namCount += 1;
                }
            });

            const counts = {
                all: allList.length,
                unassigned: unassignedCount,
                Shawn: shawnCount,
                'Hứa Thanh Nam': namCount
            };

            document.querySelectorAll('.crm-filter-pill-count[data-count]').forEach((el) => {
                const key = el.dataset.count;
                if (counts[key] !== undefined) {
                    el.textContent = counts[key];
                }
            });
        }

        function updateResultsMeta(filteredCount, totalCount) {
            const metaEl = document.getElementById('crm-student-results-count');
            if (!metaEl) return;
            if (currentSearchQuery || currentTeacherFilter !== 'all') {
                metaEl.textContent = `Showing ${filteredCount} of ${totalCount} students`;
            } else {
                metaEl.textContent = `${totalCount} students`;
            }
        }

        function bindToolbarEvents() {
            if (isToolbarBound) return;
            const searchInput = document.getElementById('crm-student-search-input');
            const clearBtn = document.getElementById('crm-student-search-clear');
            const filterContainer = document.getElementById('crm-student-teacher-filters');

            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    currentSearchQuery = e.target.value.trim();
                    if (clearBtn) {
                        clearBtn.style.display = currentSearchQuery ? 'inline-flex' : 'none';
                    }
                    renderFilteredView();
                });
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    if (searchInput) {
                        searchInput.value = '';
                        searchInput.focus();
                    }
                    currentSearchQuery = '';
                    clearBtn.style.display = 'none';
                    renderFilteredView();
                });
            }

            if (filterContainer) {
                filterContainer.addEventListener('click', (e) => {
                    const pill = e.target.closest('button.crm-filter-pill[data-teacher-filter]');
                    if (!pill) return;
                    const filterValue = pill.dataset.teacherFilter;
                    if (currentTeacherFilter === filterValue) return;

                    filterContainer.querySelectorAll('.crm-filter-pill').forEach((p) => p.classList.remove('active'));
                    pill.classList.add('active');
                    currentTeacherFilter = filterValue;
                    renderFilteredView();
                });
            }

            isToolbarBound = true;
        }

        async function loadStudentEnrollmentTeachers() {
            try {
                if (window.firebase?.firestore) {
                    const [enrollmentsSnap, classroomsSnap] = await Promise.all([
                        window.firebase.firestore().collection('crmEnrollments').get().catch(() => null),
                        window.firebase.firestore().collection('crmClassrooms').get().catch(() => null)
                    ]);
                    if (!enrollmentsSnap || !classroomsSnap) return;

                    const classroomTeacherMap = new Map();
                    classroomsSnap.forEach((doc) => {
                        const data = doc.data() || {};
                        const teacherUid = String(data.primaryTeacherUid || '').trim();
                        const teacherName = String(data.primaryTeacherName || '').trim();
                        if (teacherUid) {
                            let displayName = teacherName;
                            if (!displayName) {
                                if (teacherUid === 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83') displayName = 'Shawn';
                                else if (teacherUid === 'JP0UmCufWpdDkKkZazh7Ajo4PfX2') displayName = 'Hứa Thanh Nam';
                            }
                            classroomTeacherMap.set(doc.id, {
                                uid: teacherUid,
                                name: displayName || 'Teacher'
                            });
                        }
                    });

                    enrollmentsSnap.forEach((doc) => {
                        const data = doc.data() || {};
                        const studentId = String(data.studentId || '').trim();
                        const classId = String(data.classId || '').trim();
                        if (studentId && classId && classroomTeacherMap.has(classId)) {
                            studentTeacherMap.set(studentId, classroomTeacherMap.get(classId));
                        }
                    });

                    renderFilteredView();
                }
            } catch (err) {
                console.warn('[CRM Student Directory] Could not load enrollment teacher mappings:', err);
            }
        }

        function renderFilteredView() {
            bindToolbarEvents();
            const allStudents = Array.isArray(dataCache.students) ? dataCache.students : [];
            updateFilterCounts(allStudents);
            const filtered = applyFilters(allStudents);
            updateResultsMeta(filtered.length, allStudents.length);

            const targetContainer = elements.studentsContainer
                || elements.studentDataContainer
                || elements.potentialStudentsContainer;

            if (targetContainer) {
                const emptyMsg = (currentSearchQuery || currentTeacherFilter !== 'all')
                    ? 'No students match your search and filter criteria.'
                    : 'No students in database yet.';
                renderStudentsTable(targetContainer, filtered, emptyMsg);
            }
        }

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
                const isFiltered = Boolean(currentSearchQuery || currentTeacherFilter !== 'all');
                container.innerHTML = `
                    <div class="crm-muted" style="text-align: center; padding: 24px;">
                        <div>${escapeHtml(emptyMessage || 'No students yet.')}</div>
                        ${isFiltered ? `
                            <div style="margin-top: 10px;">
                                <button type="button" class="crm-btn-secondary" data-action="reset-student-filters" style="font-size: 13px; padding: 4px 14px;">Reset Filters</button>
                            </div>
                        ` : ''}
                    </div>
                `;
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
                const teacherInfo = resolveStudentTeacher(student);
                const teacherName = teacherInfo.name;
                const isShawn = isTeacherMatch(teacherInfo, 'Shawn');
                const isNam = isTeacherMatch(teacherInfo, 'Hứa Thanh Nam');
                const badgeClass = isShawn ? 'teacher-shawn' : (isNam ? 'teacher-nam' : 'teacher-other');

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
          <td>
            ${teacherName ? `
              <span class="crm-teacher-badge ${badgeClass}">${escapeHtml(teacherName)}</span>
            ` : `
              <span class="crm-teacher-unassigned">—</span>
            `}
          </td>
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
              <th>Assigned Teacher</th>
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
                container.addEventListener('click', (event) => {
                    const resetBtn = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('button[data-action="reset-student-filters"]')
                        : null;
                    if (!resetBtn || !container.contains(resetBtn)) return;
                    currentSearchQuery = '';
                    currentTeacherFilter = 'all';
                    const searchInput = document.getElementById('crm-student-search-input');
                    if (searchInput) searchInput.value = '';
                    const clearBtn = document.getElementById('crm-student-search-clear');
                    if (clearBtn) clearBtn.style.display = 'none';
                    const filterContainer = document.getElementById('crm-student-teacher-filters');
                    if (filterContainer) {
                        filterContainer.querySelectorAll('.crm-filter-pill').forEach((p) => {
                            p.classList.toggle('active', p.dataset.teacherFilter === 'all');
                        });
                    }
                    renderFilteredView();
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

            // Load enrollment-based teacher mappings in background
            loadStudentEnrollmentTeachers().catch(() => {});

            renderFilteredView();

            const targetContainer = elements.studentsContainer
                || elements.studentDataContainer
                || elements.potentialStudentsContainer;

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
            refreshStudentLists,
            renderFilteredView,
            applyFilters,
            resolveStudentTeacher
        };
    }

    return {
        createController
    };
})();
