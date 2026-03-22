window.CrmClassroomWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            modalState,
            dataCache,
            showToast,
            escapeHtml,
            formatDateTime,
            openClassroomModal,
            resetClassroomModal,
            populateAttendanceStudentOptions: externalPopulateAttendanceStudentOptions,
            refreshAttendanceRiskSnapshot,
            loadLiveSessions,
            getSelectedLiveSession,
            collectLiveSessionPayload,
            resetLiveSessionForm,
            renderLiveDeliverySummary,
            renderAttendanceWorkflowGuidance,
            renderClassworkWorkflowGuidance,
            renderClassroomSchedulePrompt,
            loadClassroomAttendance: externalLoadClassroomAttendance,
            refreshAttendanceClassroomFitNote: externalRefreshAttendanceClassroomFitNote
        } = deps;

        function getClassroomId(classroom) {
            return String(classroom?.classroomId || classroom?.id || '').trim();
        }

        function renderAttendanceRoster(summaryRows) {
            if (!elements.attendanceRosterContainer) return;
            const rows = Array.isArray(summaryRows) ? summaryRows : [];
            const selectedSessionId = String(elements.inputAttendanceSessionSelect?.value || '').trim();

            if (!rows.length) {
                elements.attendanceRosterContainer.innerHTML = '<div class="crm-muted">No enrollments yet.</div>';
                return;
            }

            elements.attendanceRosterContainer.innerHTML = `
              <div class="crm-table-container">
                <table class="crm-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Attendance</th>
                      <th>Risk</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Intervention</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map((row) => `
                      <tr class="attendance-row" data-student-id="${escapeHtml(row.studentId || '')}" data-student-uid="${escapeHtml(row.studentUid || '')}">
                        <td class="td-bold">${escapeHtml(row.studentName || 'Student')}</td>
                        <td>${escapeHtml(`${Math.round(Number(row.attendanceRate || 0) * 100)}% (${row.presentCount || 0}/${row.totalSessions || 0})`)}</td>
                        <td>${window.CrmAttendance && typeof window.CrmAttendance.formatRiskLabel === 'function' ? escapeHtml(window.CrmAttendance.formatRiskLabel(row)) : 'Stable'}</td>
                        <td>
                          <select class="crm-input crm-inline-select crm-attendance-select attendance-status" ${selectedSessionId ? '' : 'disabled'}>
                            <option value="present">Present</option>
                            <option value="late">Late</option>
                            <option value="absent">Absent</option>
                          </select>
                        </td>
                        <td><input type="text" class="crm-input attendance-reason" placeholder="Reason" ${selectedSessionId ? '' : 'disabled'}></td>
                        <td style="text-align:center;"><input type="checkbox" class="attendance-intervention" ${selectedSessionId ? '' : 'disabled'}></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;
        }

        async function populateAttendanceStudentOptions() {
            if (!elements.inputAttendanceStudentSelect) return;
            if (typeof externalPopulateAttendanceStudentOptions === 'function' && externalPopulateAttendanceStudentOptions !== populateAttendanceStudentOptions) {
                return externalPopulateAttendanceStudentOptions();
            }

            const currentValue = String(elements.inputAttendanceStudentSelect.value || '').trim();
            const students = Array.isArray(dataCache.students) ? dataCache.students : [];
            const options = students.map((student) => {
                const studentId = String(student?.studentId || student?.id || '').trim();
                const label = String(student?.name || student?.email || student?.phone || studentId || 'Unnamed student').trim();
                if (!studentId) return '';
                return `<option value="${escapeHtml(studentId)}">${escapeHtml(label)}</option>`;
            }).filter(Boolean);

            elements.inputAttendanceStudentSelect.innerHTML = '<option value="">Select a student...</option>' + options.join('');

            if (currentValue && students.some((student) => String(student?.studentId || student?.id || '').trim() === currentValue)) {
                elements.inputAttendanceStudentSelect.value = currentValue;
            }
        }

        async function refreshAttendanceClassroomFitNote() {
            if (!elements.attendanceClassroomFitNote) return;
            const studentId = String(elements.inputAttendanceStudentSelect?.value || '').trim();
            if (!studentId) {
                elements.attendanceClassroomFitNote.textContent = 'Select a student to see schedule fit guidance.';
                elements.attendanceClassroomFitNote.style.color = '';
                if (typeof externalRefreshAttendanceClassroomFitNote === 'function') {
                    await externalRefreshAttendanceClassroomFitNote();
                }
                return;
            }

            if (!window.ClassroomAPI || typeof window.ClassroomAPI.fetchClassroomMatches !== 'function') {
                elements.attendanceClassroomFitNote.textContent = 'Schedule fit guidance is unavailable.';
                elements.attendanceClassroomFitNote.style.color = '';
                if (typeof externalRefreshAttendanceClassroomFitNote === 'function') {
                    await externalRefreshAttendanceClassroomFitNote();
                }
                return;
            }

            const classroomCourseId = String(elements.inputClassroomCourseId?.value || '').trim();
            const json = await window.ClassroomAPI.fetchClassroomMatches(
                studentId,
                classroomCourseId ? { courseId: classroomCourseId } : {}
            ).catch((error) => {
                console.error('[CRM Admin] Failed to load attendance fit guidance:', error);
                return { matches: [], recommendedClassroom: null };
            });
            const matches = Array.isArray(json.matches) ? json.matches : [];
            const current = matches.find((match) => String(match.classroomId || '') === String(modalState.classroomId || '')) || null;
            const top = matches[0] || null;

            if (!matches.length) {
                elements.attendanceClassroomFitNote.textContent = 'No active classrooms are available to compare.';
                elements.attendanceClassroomFitNote.style.color = '';
                if (typeof externalRefreshAttendanceClassroomFitNote === 'function') {
                    await externalRefreshAttendanceClassroomFitNote();
                }
                return;
            }

            if (!current) {
                elements.attendanceClassroomFitNote.textContent = `Top recommendation is ${top?.name || 'another classroom'} (${Number(top?.fitScore || 0)}% fit).`;
                elements.attendanceClassroomFitNote.style.color = '#b45309';
                if (typeof externalRefreshAttendanceClassroomFitNote === 'function') {
                    await externalRefreshAttendanceClassroomFitNote();
                }
                return;
            }

            if (current.recommended) {
                elements.attendanceClassroomFitNote.textContent = `This classroom is the top recommendation for ${top?.name || 'this student'} (${Number(current.fitScore || 0)}% fit).`;
                elements.attendanceClassroomFitNote.style.color = '#15803d';
                if (typeof externalRefreshAttendanceClassroomFitNote === 'function') {
                    await externalRefreshAttendanceClassroomFitNote();
                }
                return;
            }

            elements.attendanceClassroomFitNote.textContent = `This classroom fits at ${Number(current.fitScore || 0)}% versus ${Number(top?.fitScore || 0)}% for the top recommendation (${top?.name || 'another classroom'}).`;
            elements.attendanceClassroomFitNote.style.color = '#b45309';
            if (typeof externalRefreshAttendanceClassroomFitNote === 'function') {
                await externalRefreshAttendanceClassroomFitNote();
            }
        }

        async function loadClassroomAttendance(classId) {
            if (!window.ClassroomAPI || typeof window.ClassroomAPI.fetchAttendanceSummary !== 'function') return;

            if (typeof externalLoadClassroomAttendance === 'function' && externalLoadClassroomAttendance !== loadClassroomAttendance) {
                return externalLoadClassroomAttendance(classId);
            }

            await populateAttendanceStudentOptions();
            if (typeof renderAttendanceWorkflowGuidance === 'function') {
                renderAttendanceWorkflowGuidance();
            }
            const summary = await window.ClassroomAPI.fetchAttendanceSummary({ classId });
            const sessions = Array.isArray(summary?.sessions) ? summary.sessions : [];
            const students = Array.isArray(summary?.students) ? summary.students : [];

            if (elements.inputAttendanceSessionSelect) {
                const currentValue = String(elements.inputAttendanceSessionSelect.value || '').trim();
                elements.inputAttendanceSessionSelect.innerHTML = '<option value="">Select a session...</option>' + sessions.map((session) => `
                    <option value="${escapeHtml(session.sessionId || '')}">${escapeHtml(session.title || session.sessionDate || 'Session')}</option>
                `).join('');
                if (currentValue) {
                    elements.inputAttendanceSessionSelect.value = currentValue;
                }
            }

            if (elements.attendanceEnrollmentMeta) {
                elements.attendanceEnrollmentMeta.textContent = students.length
                    ? `${students.length} active enrollment${students.length === 1 ? '' : 's'} in this classroom.`
                    : 'No enrollments yet.';
            }

            dataCache.attendanceRiskByStudentId = new Map(
                [
                    ...Array.from(dataCache.attendanceRiskByStudentId.entries()),
                    ...students.map((row) => [String(row.studentId || '').trim(), row])
                ]
            );

            renderAttendanceRoster(students);
            await refreshAttendanceClassroomFitNote();
        }

        async function enrollStudentIntoClassroom() {
            if (!modalState.classroomId) throw new Error('Save classroom settings first.');
            const studentId = String(elements.inputAttendanceStudentSelect?.value || '').trim();
            if (!studentId) throw new Error('Select a student first.');
            const student = dataCache.students.find((item) => String(item.studentId || '') === studentId);
            if (!student) throw new Error('Selected student is not available.');

            const payload = window.CrmEnrollments && typeof window.CrmEnrollments.buildEnrollmentPayload === 'function'
                ? window.CrmEnrollments.buildEnrollmentPayload(elements, student)
                : {
                    studentId,
                    studentUid: student.linked_user_ids?.[0] || null,
                    studentName: student.name || null,
                    studentEmail: student.email || null
                };

            await window.ClassroomAPI.createEnrollment({
                ...payload,
                classId: modalState.classroomId,
                courseId: String(elements.inputClassroomCourseId?.value || '').trim() || null
            });

            await Promise.all([
                loadClassroomAttendance(modalState.classroomId),
                refreshAttendanceRiskSnapshot()
            ]);
            showToast('Student enrolled.', 'success');
        }

        async function createAttendanceSessionForClassroom() {
            if (!modalState.classroomId) throw new Error('Save classroom settings first.');
            if (!window.CrmAttendance || typeof window.CrmAttendance.buildSessionPayload !== 'function') {
                throw new Error('Attendance helpers are not available.');
            }

            const payload = window.CrmAttendance.buildSessionPayload({
                inputAttendanceSessionDate: elements.inputAttendanceSessionDate,
                inputAttendanceSessionTitle: elements.inputAttendanceSessionTitle
            });

            const json = await window.ClassroomAPI.createAttendanceSession({
                classId: modalState.classroomId,
                ...payload
            });

            const sessionId = String(json.sessionId || json.session?.sessionId || '').trim();
            await loadClassroomAttendance(modalState.classroomId);
            if (sessionId && elements.inputAttendanceSessionSelect) {
                elements.inputAttendanceSessionSelect.value = sessionId;
            }
            showToast('Attendance session created.', 'success');
        }

        async function saveAttendanceRecordsForClassroom() {
            if (!modalState.classroomId) throw new Error('Save classroom settings first.');
            const sessionId = String(elements.inputAttendanceSessionSelect?.value || '').trim();
            if (!sessionId) throw new Error('Select an attendance session first.');
            if (!window.CrmAttendance || typeof window.CrmAttendance.buildBulkRecordPayload !== 'function') {
                throw new Error('Attendance helpers are not available.');
            }

            const rows = Array.from(document.querySelectorAll('#attendance-roster-container .attendance-row'));
            const records = window.CrmAttendance.buildBulkRecordPayload(rows).map((record) => ({
                sessionId,
                ...record
            }));

            await window.ClassroomAPI.saveAttendanceRecords({
                classId: modalState.classroomId,
                records
            });

            await Promise.all([
                loadClassroomAttendance(modalState.classroomId),
                refreshAttendanceRiskSnapshot()
            ]);
            showToast('Attendance saved.', 'success');
        }

        async function saveLiveSession() {
            if (!modalState.classroomId) throw new Error('Save classroom settings first.');
            if (!window.ClassroomAPI || typeof window.ClassroomAPI.createLiveSession !== 'function') {
                throw new Error('Live session helpers are not available.');
            }

            const payload = typeof collectLiveSessionPayload === 'function' ? collectLiveSessionPayload() : {};
            if (!payload.title) throw new Error('Live session title is required.');

            const selectedSessionId = String(getSelectedLiveSession?.()?.sessionId || '').trim();
            const hasExistingSelection = selectedSessionId && selectedSessionId !== '__new__';
            if (hasExistingSelection) {
                await window.ClassroomAPI.updateLiveSession(modalState.classroomId, selectedSessionId, payload);
            } else {
                const json = await window.ClassroomAPI.createLiveSession(modalState.classroomId, payload);
                modalState.liveSessionId = String(json.sessionId || json.session?.sessionId || '').trim() || null;
            }

            await loadLiveSessions(modalState.classroomId, { sessionId: modalState.liveSessionId });
            await refreshZoomLinksOverview().catch(() => {});
            showToast(hasExistingSelection ? 'Live session updated.' : 'Live session created.', 'success');
        }

        async function startSelectedLiveSession() {
            if (!modalState.classroomId) throw new Error('Save classroom settings first.');
            const session = typeof getSelectedLiveSession === 'function' ? getSelectedLiveSession() : null;
            if (!session?.sessionId) throw new Error('Select a scheduled session first.');
            await window.ClassroomAPI.startLiveSession(modalState.classroomId, session.sessionId);
            await loadLiveSessions(modalState.classroomId, { sessionId: session.sessionId });
            await refreshZoomLinksOverview().catch(() => {});
            showToast('Live session started.', 'success');
        }

        async function endSelectedLiveSession() {
            if (!modalState.classroomId) throw new Error('Save classroom settings first.');
            const session = typeof getSelectedLiveSession === 'function' ? getSelectedLiveSession() : null;
            if (!session?.sessionId) throw new Error('Select a live session first.');
            await window.ClassroomAPI.endLiveSession(modalState.classroomId, session.sessionId);
            await loadLiveSessions(modalState.classroomId, { sessionId: session.sessionId });
            await refreshZoomLinksOverview().catch(() => {});
            showToast('Live session ended.', 'success');
        }

        async function loadClassroomStream(classId) {
            if (!elements.streamPostsContainer || typeof firebase === 'undefined') return;
            try {
                const snap = await firebase.firestore()
                    .collection('crmClassrooms')
                    .doc(classId)
                    .collection('posts')
                    .orderBy('createdAt', 'desc')
                    .get();

                if (snap.empty) {
                    elements.streamPostsContainer.innerHTML = '<p class="text-muted">No announcements yet.</p>';
                    return;
                }

                elements.streamPostsContainer.innerHTML = snap.docs.map((doc) => {
                    const data = doc.data();
                    return `
                      <div class="stream-card" style="padding: 16px; margin-bottom: 12px; background: white; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <div style="font-size: 0.85rem; color: #718096; margin-bottom: 8px;">
                          <strong>${escapeHtml(data.author || 'Admin')}</strong> - ${escapeHtml(formatDateTime(data.createdAt))}
                        </div>
                        <div>${escapeHtml(data.content)}</div>
                      </div>
                    `;
                }).join('');
            } catch (error) {
                console.error('[CRM Admin] Failed to load classroom stream:', error);
            }
        }

        function renderKanbanColumn(container, list, allowGrading) {
            if (!container) return;
            if (!list.length) {
                container.innerHTML = '<p class="crm-muted" style="padding:10px;">None found.</p>';
                return;
            }

            container.innerHTML = list.map((submission) => `
              <div class="crm-kanban-card" data-sub-id="${escapeHtml(submission.id || '')}">
                <div class="card-user">
                  <strong>${escapeHtml(submission.studentName || submission.studentEmail || 'Student')}</strong>
                  <span class="text-muted" style="font-size:0.75rem;">UID: ${escapeHtml(submission.studentUid || '')}</span>
                </div>
                <div class="card-work">Work ID: ${escapeHtml(submission.workId || '')}</div>
                ${submission.audio ? `<button class="btn-play-audio" data-path="${escapeHtml(submission.audio.storagePath || '')}">Play Audio</button>` : ''}
                ${allowGrading === 'turned-in' ? `
                  <div class="grading-actions" style="margin-top:10px;">
                    <input type="text" placeholder="Grade/Score" class="crm-input-small grade-val" style="margin-bottom:5px;">
                    <textarea placeholder="Feedback for student" class="crm-input-small revision-feedback" style="margin-bottom:5px; min-height:72px;"></textarea>
                    <button class="crm-btn-primary small btn-grade-submit" style="margin-bottom:5px;">Submit Grade</button>
                    <button class="crm-btn-secondary small btn-return-revision">Return for Revision</button>
                  </div>
                ` : allowGrading === 'needs-revision' ? `
                  <div class="graded-status" style="margin-top:10px;">
                    <strong>Waiting for student resubmission</strong>
                    ${submission.feedback ? `<div style="margin-top:6px; color:var(--crm-text-muted);">${escapeHtml(submission.feedback)}</div>` : ''}
                  </div>
                ` : allowGrading === false ? `
                  <div class="graded-status" style="margin-top:10px;"><strong>Missing</strong></div>
                ` : `
                  <div class="graded-status">
                    Grade: <strong>${escapeHtml(submission.grade || 'N/A')}</strong>
                    ${submission.feedback ? `<div style="margin-top:6px; color:var(--crm-text-muted);">${escapeHtml(submission.feedback)}</div>` : ''}
                  </div>
                `}
              </div>
            `).join('');

            container.querySelectorAll('.btn-grade-submit').forEach((button) => {
                button.addEventListener('click', async () => {
                    const card = button.closest('.crm-kanban-card');
                    const sid = String(card?.dataset?.subId || '').trim();
                    const grade = String(card?.querySelector('.grade-val')?.value || '').trim();
                    if (!grade) return showToast('Enter a grade first.', 'error');

                    try {
                        button.disabled = true;
                        await window.ClassroomAPI.gradeSubmission(sid, { grade });
                        showToast('Graded.', 'success');
                        loadReviewBoard(modalState.classroomId);
                    } catch (error) {
                        showToast(error?.message || 'Failed to grade submission.', 'error');
                        button.disabled = false;
                    }
                });
            });

            container.querySelectorAll('.btn-return-revision').forEach((button) => {
                button.addEventListener('click', async () => {
                    const card = button.closest('.crm-kanban-card');
                    const sid = String(card?.dataset?.subId || '').trim();
                    const feedback = String(card?.querySelector('.revision-feedback')?.value || '').trim();
                    if (!feedback) return showToast('Add feedback before returning for revision.', 'error');

                    try {
                        button.disabled = true;
                        await window.ClassroomAPI.returnSubmissionForRevision(sid, { feedback });
                        showToast('Returned for revision.', 'success');
                        loadReviewBoard(modalState.classroomId);
                    } catch (error) {
                        showToast(error?.message || 'Failed to return for revision.', 'error');
                        button.disabled = false;
                    }
                });
            });

            container.querySelectorAll('.btn-play-audio').forEach((button) => {
                button.addEventListener('click', async () => {
                    const path = String(button.dataset.path || '').trim();
                    if (!path || typeof firebase === 'undefined') return;
                    try {
                        button.disabled = true;
                        const originalText = button.textContent;
                        button.textContent = 'Loading...';
                        const url = await firebase.storage().ref(path).getDownloadURL();
                        const audio = new Audio(url);
                        audio.play();
                        button.textContent = 'Playing...';
                        audio.onended = () => {
                            button.disabled = false;
                            button.textContent = originalText;
                        };
                    } catch (error) {
                        console.error('[CRM Admin] Audio playback failed:', error);
                        showToast('Failed to load audio.', 'error');
                        button.disabled = false;
                        button.textContent = 'Play Audio';
                    }
                });
            });
        }

        async function loadReviewBoard(classId) {
            if (!elements.kanbanMissingList || !elements.kanbanTurnedInList || !elements.kanbanGradedList) return;

            elements.kanbanTurnedInList.innerHTML = '<div class="crm-loading-spinner small"></div>';
            elements.kanbanMissingList.innerHTML = '<div class="crm-loading-spinner small"></div>';

            try {
                const board = await window.ClassroomAPI.fetchReviewBoard(classId);
                const submissions = Array.isArray(board?.submissions) ? board.submissions : [];
                renderKanbanColumn(elements.kanbanTurnedInList, submissions.filter((item) => item.status === 'turned-in'), 'turned-in');
                renderKanbanColumn(elements.kanbanNeedsRevisionList, submissions.filter((item) => item.status === 'needs-revision'), 'needs-revision');
                renderKanbanColumn(elements.kanbanGradedList, submissions.filter((item) => item.status === 'graded'), 'graded');
                renderKanbanColumn(elements.kanbanMissingList, Array.isArray(board?.missing) ? board.missing : [], false);
            } catch (error) {
                console.error('[CRM Admin] Kanban load failed:', error);
                showToast('Failed to load review board.', 'error');
            }
        }

        async function fetchCoursesFromCatalog() {
            if (window.CrmCourses && typeof window.CrmCourses.fetchCourses === 'function') {
                return window.CrmCourses.fetchCourses();
            }
            if (window.ClassroomAPI && typeof window.ClassroomAPI.fetchCourses === 'function') {
                return window.ClassroomAPI.fetchCourses();
            }
            throw new Error('Course catalog helpers are not available.');
        }

        async function populateClassroomCourseOptions(options = {}) {
            if (!elements.inputClassroomCourseId) return [];

            const selectedValue = String(options.selectedValue || elements.inputClassroomCourseId.value || '').trim();
            if (window.CrmCourses && typeof window.CrmCourses.populateCourseSelect === 'function') {
                return window.CrmCourses.populateCourseSelect(elements.inputClassroomCourseId, {
                    placeholder: 'Select a Course...',
                    selectedValue
                });
            }

            const courses = await fetchCoursesFromCatalog();
            elements.inputClassroomCourseId.innerHTML = '<option value="">Select a Course...</option>' + courses.map((course) => {
                const label = course.code ? `${course.name} (${course.code})` : course.name;
                return `<option value="${escapeHtml(course.id)}">${escapeHtml(label)}</option>`;
            }).join('');
            if (selectedValue) {
                elements.inputClassroomCourseId.value = selectedValue;
            }
            return courses;
        }

        async function loadClassroomModules(classId) {
            if (!elements.modulesListContainer) return;
            try {
                const modules = await window.ClassroomAPI.loadModules(classId);
                elements.modulesListContainer.innerHTML = modules.length ? modules.map((module) => `
                  <div class="module-list-item">
                    <strong>${escapeHtml(module.title)}</strong>
                  </div>
                `).join('') : '<p class="text-muted">No modules yet.</p>';

                if (elements.inputClassworkModule) {
                    elements.inputClassworkModule.innerHTML = '<option value="">No Module</option>' +
                        modules.map((module) => `<option value="${escapeHtml(module.id)}">${escapeHtml(module.title)}</option>`).join('');
                }
            } catch (error) {
                console.error('[CRM Admin] Failed to load classroom modules:', error);
                elements.modulesListContainer.innerHTML = '<p class="text-muted">Failed to load modules.</p>';
            }
        }

        async function loadClassroomClasswork(classId) {
            if (!elements.classworkListContainer) return;
            renderClassworkWorkflowGuidance();
            try {
                const works = await window.ClassroomAPI.loadClasswork(classId);
                elements.classworkListContainer.innerHTML = works.length ? works.map((work) => `
                  <div class="classwork-card">
                    <div>
                      <strong>${escapeHtml(work.title)}</strong>
                      <div class="text-muted" style="font-size: 0.85rem; margin-top: 4px;">Type: ${escapeHtml(work.type)}</div>
                    </div>
                  </div>
                `).join('') : '<p class="text-muted">No classwork yet.</p>';
            } catch (error) {
                console.error('[CRM Admin] Failed to load classroom classwork:', error);
                elements.classworkListContainer.innerHTML = '<p class="text-muted">Failed to load classwork.</p>';
            }
        }

        async function refreshCourseCatalog() {
            const container = elements.courseCatalogContainer;
            if (!container) return;

            try {
                const courses = await fetchCoursesFromCatalog();
                await populateClassroomCourseOptions({ selectedValue: elements.inputClassroomCourseId?.value || '' });

                if (!courses.length) {
                    container.innerHTML = '<div class="crm-muted">No courses found.</div>';
                    return;
                }

                container.innerHTML = courses.map((course) => `
                  <section class="crm-workspace-card">
                    <div class="crm-section-header">
                      <div>
                        <h3>${escapeHtml(course.name || 'Course')}</h3>
                        <p class="crm-muted">${escapeHtml(course.code || 'No code')}</p>
                      </div>
                    </div>
                  </section>
                `).join('');
            } catch (error) {
                console.error('[CRM Admin] Failed to refresh course catalog:', error);
                container.innerHTML = '<div class="crm-muted">Failed to load courses.</div>';
            }
        }

        async function saveClassroomSettings() {
            const payload = window.CrmClassrooms && typeof window.CrmClassrooms.buildPayload === 'function'
                ? window.CrmClassrooms.buildPayload(elements)
                : {
                    name: elements.inputClassroomName.value.trim(),
                    courseId: elements.inputClassroomCourseId.value,
                    status: elements.inputClassroomStatus.value
                };
            if (!payload.name) throw new Error('Classroom name is required.');

            const res = modalState.classroomId
                ? await window.ClassroomAPI.updateClassroom(modalState.classroomId, payload)
                : await window.ClassroomAPI.createClassroom(payload);
            modalState.classroomId = String(res.classroomId || res.classroom?.classroomId || modalState.classroomId || '').trim();
            if (elements.classroomStatusBadge) elements.classroomStatusBadge.textContent = payload.status;
            if (elements.classroomTitle) elements.classroomTitle.textContent = payload.name;
            await refreshClassroomList();
            await refreshZoomLinksOverview().catch(() => {});
            renderClassroomSchedulePrompt();
        }

        async function openExistingClassroom(classroom) {
            if (!classroom) return;
            const classroomId = getClassroomId(classroom);
            if (!classroomId) return;

            resetClassroomModal();
            await populateClassroomCourseOptions({ selectedValue: classroom.courseId || '' });
            if (window.CrmClassrooms && typeof window.CrmClassrooms.applyToForm === 'function') {
                window.CrmClassrooms.applyToForm(elements, classroom);
            }
            modalState.classroomId = classroomId;
            if (elements.classroomStatusBadge) {
                elements.classroomStatusBadge.textContent = classroom.status || 'draft';
                elements.classroomStatusBadge.style.display = 'inline-flex';
            }
            if (elements.classroomTitle) {
                elements.classroomTitle.textContent = classroom.name || 'Classroom';
            }
            openClassroomModal();
            await Promise.all([
                loadClassroomModules(classroomId),
                loadClassroomClasswork(classroomId),
                loadClassroomStream(classroomId),
                loadLiveSessions(classroomId)
            ]);
        }

        async function refreshClassroomList() {
            if (!elements.classManagementGrid) return;
            try {
                const [classrooms, courses] = await Promise.all([
                    window.ClassroomAPI.fetchClassrooms(),
                    fetchCoursesFromCatalog().catch(() => [])
                ]);
                const courseIndex = new Map(courses.map((course) => [String(course.id || ''), course]));
                if (!classrooms.length) {
                    elements.classManagementGrid.innerHTML = '<div class="crm-muted">No classrooms found.</div>';
                    return;
                }
                elements.classManagementGrid.innerHTML = `
                  <div class="crm-table-container">
                    <table class="crm-table">
                      <thead>
                        <tr><th>Name</th><th>Course</th><th>Status</th><th>Modules</th></tr>
                      </thead>
                      <tbody>
                        ${classrooms.map((classroom) => `
                          <tr>
                            <td class="td-bold">
                              <button type="button" class="crm-student-link crm-classroom-link" data-classroom-id="${escapeHtml(getClassroomId(classroom))}">
                                ${escapeHtml(classroom.name || 'Classroom')}
                              </button>
                            </td>
                            <td>${escapeHtml(courseIndex.get(String(classroom.courseId || ''))?.name || classroom.courseId || 'None')}</td>
                            <td>${escapeHtml(classroom.status || 'draft')}</td>
                            <td>n/a</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                `;

                const classroomIndex = new Map(classrooms.map((classroom) => [getClassroomId(classroom), classroom]));
                Array.from(elements.classManagementGrid.querySelectorAll('button.crm-classroom-link[data-classroom-id]')).forEach((button) => {
                    button.addEventListener('click', async () => {
                        const classroomId = String(button.dataset.classroomId || '').trim();
                        const classroom = classroomIndex.get(classroomId);
                        if (!classroom) return;
                        await openExistingClassroom(classroom);
                    });
                });
            } catch (error) {
                elements.classManagementGrid.innerHTML = '<div class="crm-muted">Failed to load classrooms.</div>';
            }
        }

        async function refreshZoomLinksOverview() {
            if (!elements.zoomLinksGrid || !window.ClassroomAPI || typeof window.ClassroomAPI.fetchClassrooms !== 'function') {
                return;
            }

            const classrooms = await window.ClassroomAPI.fetchClassrooms();
            const activeClassrooms = classrooms.filter((row) => String(row?.status || '').trim().toLowerCase() !== 'archived');

            if (!activeClassrooms.length) {
                elements.zoomLinksGrid.innerHTML = '<section class="crm-workspace-card"><div class="crm-muted">No classrooms available for live delivery yet.</div></section>';
                return;
            }

            const rows = await Promise.all(activeClassrooms.map(async (classroom) => {
                const classroomId = getClassroomId(classroom);
                const sessions = classroomId
                    ? await window.ClassroomAPI.fetchLiveSessions(classroomId).catch(() => [])
                    : [];
                return {
                    classroom,
                    session: typeof getPrimaryLiveSession === 'function' ? getPrimaryLiveSession(sessions) : sessions[0] || null
                };
            }));

            elements.zoomLinksGrid.innerHTML = rows.map(({ classroom, session }) => {
                const label = session
                    ? `${session.status || 'draft'} - ${session.scheduledStartAt ? formatDateTime(session.scheduledStartAt) : 'No start time'}`
                    : 'No live session yet';
                return `
                  <section class="crm-workspace-card">
                    <div class="crm-section-header">
                      <div>
                        <h3>${escapeHtml(classroom.name || 'Classroom')}</h3>
                        <p class="crm-muted">${escapeHtml(label)}</p>
                      </div>
                    </div>
                    <div class="crm-stack-list">
                      <div class="crm-muted">${escapeHtml(session?.title || 'Create a live session before class starts.')}</div>
                      <div class="crm-timeline-meta">${escapeHtml(session?.meetingUrl || 'No join link saved yet.')}</div>
                    </div>
                    <div class="crm-inline-fields" style="justify-content: flex-end; margin-top: 12px;">
                      <button type="button" class="crm-btn-primary btn-open-live-classroom" data-classroom-id="${escapeHtml(getClassroomId(classroom))}">Open Classroom</button>
                    </div>
                  </section>
                `;
            }).join('');

            const classroomIndex = new Map(activeClassrooms.map((row) => [getClassroomId(row), row]));
            Array.from(elements.zoomLinksGrid.querySelectorAll('.btn-open-live-classroom[data-classroom-id]')).forEach((button) => {
                button.addEventListener('click', () => {
                    const classroomId = String(button.dataset.classroomId || '').trim();
                    const classroom = classroomIndex.get(classroomId);
                    openExistingClassroom(classroom).catch((error) => {
                        console.error('[CRM Admin] Failed to open classroom from live delivery overview:', error);
                        showToast(error?.message || 'Failed to open classroom.', 'error');
                    });
                });
            });
        }

        return {
            loadClassroomStream,
            loadReviewBoard,
            populateAttendanceStudentOptions,
            renderAttendanceRoster,
            refreshAttendanceClassroomFitNote,
            loadClassroomAttendance,
            enrollStudentIntoClassroom,
            createAttendanceSessionForClassroom,
            saveAttendanceRecordsForClassroom,
            saveLiveSession,
            startSelectedLiveSession,
            endSelectedLiveSession,
            saveClassroomSettings,
            refreshClassroomList,
            loadClassroomModules,
            loadClassroomClasswork,
            openExistingClassroom,
            refreshZoomLinksOverview,
            fetchCoursesFromCatalog,
            populateClassroomCourseOptions,
            refreshCourseCatalog
        };
    }

    return {
        createController
    };
})();
