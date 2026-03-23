window.CrmStudentWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            modalState,
            dataCache,
            showToast,
            apiFetchJson,
            fetchStudentProfile,
            openStudentModal,
            resetStudentModal,
            refreshStudentFinance,
            refreshStudentLists,
            refreshDashboard,
            refreshEntranceTestsList,
            switchStudentTab,
            getStudentPayload,
            hasAnyInfoField,
            fetchTasks,
            fetchActivities,
            applyReminderBadge,
            getReminderSummary,
            renderTaskList,
            renderActivityList,
            escapeHtml
        } = deps;

        function toDate(value) {
            if (!value) return null;
            if (typeof value === 'string' || typeof value === 'number') {
                const date = new Date(value);
                return Number.isFinite(date.getTime()) ? date : null;
            }
            if (typeof value.toMillis === 'function') return new Date(value.toMillis());
            if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
            if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
            return null;
        }

        async function refreshStudentTimeline() {
            if (!modalState.studentId) {
                if (elements.studentTaskMeta) {
                    elements.studentTaskMeta.textContent = 'Save the profile to schedule follow-ups.';
                }
                applyReminderBadge(elements.studentTaskBadge, null);
                return;
            }

            const [tasks, activities] = await Promise.all([
                fetchTasks({ studentId: modalState.studentId, limit: 50 }),
                fetchActivities({ studentId: modalState.studentId, limit: 50 })
            ]);

            const summary = getReminderSummary({ studentId: modalState.studentId });
            if (elements.studentTaskMeta) {
                const nextActionDate = toDate(summary?.nextActionAt);
                elements.studentTaskMeta.textContent = nextActionDate
                    ? `Due ${nextActionDate.toLocaleString()}`
                    : 'No scheduled follow-up yet.';
            }
            applyReminderBadge(elements.studentTaskBadge, summary);
            renderTaskList(elements.studentTaskList, tasks, {
                emptyMessage: 'No tasks yet.',
                scope: 'student'
            });
            renderActivityList(elements.studentActivityList, activities, 'No activity yet.');
        }

        async function refreshStudentIdentity() {
            if (!modalState.studentId || typeof firebase === 'undefined') return;
            try {
                const snap = await firebase.firestore().collection('crmStudents').doc(modalState.studentId).get();
                if (!snap.exists) return;
                const data = snap.data();

                if (elements.inputClassCodeDisplay) {
                    elements.inputClassCodeDisplay.value = data.class_code || '';
                }

                if (elements.linkedUidsUl) {
                    const uids = data.linked_user_ids || [];
                    if (uids.length === 0) {
                        elements.linkedUidsUl.innerHTML = '<li class="text-muted">No accounts linked yet.</li>';
                    } else {
                        elements.linkedUidsUl.innerHTML = uids.map((uid) => `
                          <li>
                            <span>${escapeHtml(uid)}</span>
                            <span class="crm-test-status submitted">Linked</span>
                          </li>
                        `).join('');
                    }
                }
            } catch (error) {
                console.error('[CRM Admin] Failed to refresh identity:', error);
            }
        }

        async function saveStudentProfile() {
            const payload = getStudentPayload();
            if (!hasAnyInfoField(payload)) {
                throw new Error('Please fill at least 1 field in Info tab before saving.');
            }

            if (elements.btnSaveStudent) {
                elements.btnSaveStudent.disabled = true;
                elements.btnSaveStudent.textContent = 'Saving...';
            }
            try {
                const path = modalState.studentId
                    ? `/api/admin/students/${encodeURIComponent(modalState.studentId)}`
                    : '/api/admin/students';
                const method = modalState.studentId ? 'PATCH' : 'POST';
                const json = await apiFetchJson(path, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const studentId = String(json.studentId || json.student?.studentId || modalState.studentId || '').trim();
                if (!studentId) throw new Error('Student ID missing from server response.');

                modalState.studentId = studentId;
                modalState.studentProfile = json.student || {
                    ...payload,
                    studentId
                };

                if (elements.studentIdBadge) {
                    elements.studentIdBadge.textContent = `ID: ${studentId}`;
                    elements.studentIdBadge.style.display = 'inline-flex';
                }

                if (elements.btnAddEntranceTest) elements.btnAddEntranceTest.disabled = false;

                if (elements.btnSaveStudent) {
                    elements.btnSaveStudent.disabled = false;
                    elements.btnSaveStudent.textContent = 'Save Student';
                }

                await refreshStudentLists();
                await refreshStudentTimeline();
                await refreshEntranceTestsList();
                await refreshStudentFinance().catch((error) => {
                    console.error('[CRM Admin] Failed to refresh student finance after save:', error);
                });
                await refreshDashboard();
                showToast(method === 'PATCH' ? 'Student profile updated.' : 'Student profile saved.', 'success');
            } catch (error) {
                if (elements.btnSaveStudent) {
                    elements.btnSaveStudent.disabled = false;
                    elements.btnSaveStudent.textContent = 'Save Student';
                }
                if (elements.btnAddEntranceTest) {
                    elements.btnAddEntranceTest.disabled = false;
                }
                throw error;
            }
        }

        async function createEntranceTest() {
            if (!modalState.studentId) {
                await saveStudentProfile();
            }

            if (!modalState.studentId) {
                throw new Error('Please fill at least 1 field before creating a test link.');
            }

            if (elements.btnAddEntranceTest) {
                elements.btnAddEntranceTest.disabled = true;
                elements.btnAddEntranceTest.textContent = 'Creating...';
            }
            try {
                const json = await apiFetchJson(`/api/admin/students/${encodeURIComponent(modalState.studentId)}/entrance-tests`, {
                    method: 'POST'
                });

                const testLink = String(json.testLink || '').trim();
                const testId = String(json.testId || '').trim();
                if (!testLink || !testId) throw new Error('Test link missing from server response.');

                modalState.createdTestLinks.set(testId, testLink);

                if (elements.entranceTestLinkInput) elements.entranceTestLinkInput.value = testLink;
                if (elements.btnCopyEntranceTestLink) elements.btnCopyEntranceTestLink.disabled = false;
                if (elements.btnOpenEntranceTestLink) elements.btnOpenEntranceTestLink.disabled = false;
                if (elements.entranceTestLinkNote) {
                    elements.entranceTestLinkNote.textContent = 'Latest single-use learner link is ready to send. It will stop working after submission.';
                }

                await refreshEntranceTestsList();
                showToast('Entrance test link created.', 'success');
            } finally {
                if (elements.btnAddEntranceTest) {
                    elements.btnAddEntranceTest.disabled = false;
                    elements.btnAddEntranceTest.textContent = 'Add new test';
                }
            }
        }

        async function openStudentProfile(studentId, cachedStudent = null) {
            const id = String(studentId || '').trim();
            if (!id) throw new Error('Missing student ID.');

            openStudentModal();
            resetStudentModal();

            modalState.studentId = id;
            modalState.studentProfile = cachedStudent || null;
            modalState.createdTestLinks = new Map();

            if (elements.studentIdBadge) {
                elements.studentIdBadge.textContent = `ID: ${id}`;
                elements.studentIdBadge.style.display = 'inline-flex';
            }

            if (elements.btnSaveStudent) {
                elements.btnSaveStudent.disabled = false;
                elements.btnSaveStudent.textContent = 'Save Student';
            }

            if (elements.btnAddEntranceTest) {
                elements.btnAddEntranceTest.disabled = false;
                elements.btnAddEntranceTest.textContent = 'Add new test';
            }

            const student = cachedStudent || null;

            if (!student) {
                showToast('Student details are not available yet. Please refresh and try again.', 'error');
            } else {
                if (window.CrmStudents && typeof window.CrmStudents.applyToForm === 'function') {
                    window.CrmStudents.applyToForm(elements, student);
                }
                if (window.CrmStudent360 && typeof window.CrmStudent360.applyToForm === 'function') {
                    window.CrmStudent360.applyToForm(elements, student);
                }
            }

            fetchStudentProfile(id).then((fresh) => {
                if (!fresh) return;
                modalState.studentProfile = fresh;
                if (window.CrmStudents && typeof window.CrmStudents.applyToForm === 'function') {
                    window.CrmStudents.applyToForm(elements, fresh);
                }
                if (window.CrmStudent360 && typeof window.CrmStudent360.applyToForm === 'function') {
                    window.CrmStudent360.applyToForm(elements, fresh);
                }
            }).catch((error) => {
                console.error('[CRM Admin] Failed to refresh student profile after open:', error);
            });

            await refreshEntranceTestsList();
            await refreshStudentIdentity();
            await refreshStudentTimeline();
            await refreshStudentFinance();
            if (typeof switchStudentTab === 'function') {
                switchStudentTab('info');
            }
        }

        return {
            refreshStudentTimeline,
            refreshStudentIdentity,
            saveStudentProfile,
            createEntranceTest,
            openStudentProfile
        };
    }

    return {
        createController
    };
})();
