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
            formatDateTime
        } = deps;

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

            const rows = list.map((student) => {
                const studentId = String(student.studentId || '').trim();
                const displayName = studentDisplayName(student);
                const label = String(student.label || '').trim() || '-';
                const contact = studentContact(student);
                return `
        <tr>
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
          <td><code>${escapeHtml(studentId)}</code></td>
        </tr>
      `;
            }).join('');

            container.innerHTML = `
      <div class="crm-table-container">
        <table class="crm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Label</th>
              <th>Contact</th>
              <th>Created</th>
              <th>Student ID</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
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

            const buckets = window.CrmStudents && typeof window.CrmStudents.splitStudents === 'function'
                ? window.CrmStudents.splitStudents(students)
                : { potential: students, studentData: [] };

            dataCache.students = students;

            renderStudentsTable(elements.potentialStudentsContainer, buckets.potential, 'No potential students yet.');
            renderStudentsTable(elements.studentDataContainer, buckets.studentData, 'No students in database yet.');
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
