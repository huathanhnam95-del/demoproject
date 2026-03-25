window.CrmClassroomModal = (function () {
    function createController(deps = {}) {
        const {
            elements,
            modalState,
            showToast,
            openClassroomModal,
            saveClassroomSettings,
            previewClassroomRegeneration,
            applyClassroomRegeneration,
            loadClassroomModules,
            loadClassroomClasswork,
            loadClassroomStream,
            loadClassroomAttendance,
            loadReviewBoard,
            loadLiveSessions,
            renderClassroomSchedulePrompt,
            renderAttendanceWorkflowGuidance,
            renderClassworkWorkflowGuidance,
            enrollStudentIntoClassroom,
            createAttendanceSessionForClassroom,
            saveAttendanceRecordsForClassroom,
            resetLiveSessionForm,
            renderLiveDeliverySummary,
            saveLiveSession,
            startSelectedLiveSession,
            endSelectedLiveSession,
            getSelectedLiveSession,
            copyToClipboard,
            refreshAttendanceClassroomFitNote,
            populateClassroomCourseOptions
        } = deps;

        function switchClassroomTab(tabId) {
            elements.classroomSidebarItems.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
            elements.classroomTabContents.forEach((content) => {
                const isMatch = content.id === `classroom-${tabId}`;
                content.style.display = isMatch ? (tabId === 'review-board' ? 'flex' : 'block') : 'none';
                content.classList.toggle('active', isMatch);
            });

            if (tabId === 'review-board' && modalState.classroomId) {
                loadReviewBoard(modalState.classroomId);
            }
            if (tabId === 'stream' && modalState.classroomId) {
                loadClassroomStream(modalState.classroomId);
            }
            if (tabId === 'live' && modalState.classroomId) {
                loadLiveSessions(modalState.classroomId).catch((error) => {
                    console.error('[CRM Admin] Failed to load live sessions:', error);
                });
            }
            if (tabId === 'attendance' && modalState.classroomId) {
                loadClassroomAttendance(modalState.classroomId);
            }
            if (tabId === 'attendance' || tabId === 'settings') {
                renderClassroomSchedulePrompt();
            }
            if (tabId === 'attendance') {
                renderAttendanceWorkflowGuidance();
            }
            if (tabId === 'classwork') {
                renderClassworkWorkflowGuidance();
            }
        }

        function resetClassroomModal() {
            modalState.classroomId = null;
            modalState.classroomScheduleVersion = null;
            modalState.classroomRecord = null;
            modalState.regenerationPreview = null;
            modalState.liveSessions = [];
            modalState.liveSessionId = null;
            switchClassroomTab('settings');
            if (elements.inputClassroomName) elements.inputClassroomName.value = '';
            if (elements.inputClassroomCourseId) {
                elements.inputClassroomCourseId.value = '';
                populateClassroomCourseOptions().catch((e) => {
                    console.error('[CRM Admin] Failed to populate classroom course options:', e);
                });
            }
            if (elements.inputClassroomStatus) elements.inputClassroomStatus.value = 'draft';
            if (elements.inputClassroomTotalHours) elements.inputClassroomTotalHours.value = '';
            if (elements.inputClassroomPrimaryTeacher) elements.inputClassroomPrimaryTeacher.value = '';
            if (elements.inputClassroomSessionMinutes) elements.inputClassroomSessionMinutes.value = '';
            if (elements.inputClassroomScheduleTimezone) elements.inputClassroomScheduleTimezone.value = '';
            if (elements.inputClassroomSeedStartDate) elements.inputClassroomSeedStartDate.value = '';
            if (elements.inputClassroomSeedStartTime) elements.inputClassroomSeedStartTime.value = '';
            if (elements.inputClassroomSeedWeekdays) elements.inputClassroomSeedWeekdays.value = '';
            if (elements.inputClassroomAllowedStartTime) elements.inputClassroomAllowedStartTime.value = '';
            if (elements.inputClassroomAllowedEndTime) elements.inputClassroomAllowedEndTime.value = '';
            if (elements.inputClassroomDurationStep) elements.inputClassroomDurationStep.value = '';
            if (elements.inputClassroomMeetingDays) elements.inputClassroomMeetingDays.value = '';
            if (elements.inputClassroomMeetingHours) elements.inputClassroomMeetingHours.value = '';
            if (elements.inputClassroomRegenerateFromDate) elements.inputClassroomRegenerateFromDate.value = '';
            if (elements.inputClassroomRegenerateSessionMinutes) elements.inputClassroomRegenerateSessionMinutes.value = '';
            if (elements.inputClassroomRegenerateWeekdays) elements.inputClassroomRegenerateWeekdays.value = '';
            if (elements.inputClassroomRegenerateStartTime) elements.inputClassroomRegenerateStartTime.value = '';
            if (elements.btnApplyClassroomRegeneration) elements.btnApplyClassroomRegeneration.disabled = true;
            if (elements.classroomStatusBadge) {
                elements.classroomStatusBadge.textContent = 'Draft';
                elements.classroomStatusBadge.style.display = 'inline-flex';
            }
            if (elements.classroomTitle) elements.classroomTitle.textContent = 'New Classroom';
            if (elements.modulesListContainer) elements.modulesListContainer.innerHTML = '<p class="text-muted">No modules yet.</p>';
            if (elements.classworkListContainer) elements.classworkListContainer.innerHTML = '<p class="text-muted">No classwork yet.</p>';
            if (elements.classworkComposer) elements.classworkComposer.style.display = 'none';
            if (elements.liveDeliverySummary) elements.liveDeliverySummary.innerHTML = '<div class="crm-muted">Create a live session before class starts.</div>';
            if (elements.liveSessionList) elements.liveSessionList.innerHTML = '<div class="crm-muted">No live sessions yet.</div>';
            resetLiveSessionForm();
            if (elements.inputAttendanceStudentSelect) elements.inputAttendanceStudentSelect.innerHTML = '<option value="">Select a student...</option>';
            if (elements.attendanceLiveSessionNote) elements.attendanceLiveSessionNote.textContent = 'Create a live session before class starts.';
            if (elements.attendanceClassroomFitNote) {
                elements.attendanceClassroomFitNote.textContent = 'Select a student to see schedule fit guidance.';
                elements.attendanceClassroomFitNote.style.color = '';
            }
            if (elements.attendanceEnrollmentMeta) elements.attendanceEnrollmentMeta.textContent = 'No enrollments yet.';
            if (elements.inputAttendanceSessionDate) elements.inputAttendanceSessionDate.value = '';
            if (elements.inputAttendanceSessionTitle) elements.inputAttendanceSessionTitle.value = '';
            if (elements.inputAttendanceSessionSelect) elements.inputAttendanceSessionSelect.innerHTML = '<option value="">Select a session...</option>';
            if (elements.attendanceRosterContainer) elements.attendanceRosterContainer.innerHTML = '<div class="crm-muted">No attendance roster yet.</div>';
            if (elements.classworkLiveSessionNote) elements.classworkLiveSessionNote.textContent = 'Create or complete a live session before assigning follow-up work.';
            if (elements.classroomScheduleSummary) {
                elements.classroomScheduleSummary.innerHTML = `
          <div class="crm-summary-card">
            <div class="crm-summary-card-label">Assigned</div>
            <div class="crm-summary-card-value">0/0</div>
          </div>
        `;
            }
            if (elements.classroomRegenerationPreview) {
                elements.classroomRegenerationPreview.innerHTML = 'Preview regeneration to review preserved sessions, blocked reasons, and the next contracted target count.';
            }
            renderClassroomSchedulePrompt();
            renderAttendanceWorkflowGuidance();
            renderClassworkWorkflowGuidance();
        }

        function setupClassroomModal() {
            if (!elements.classroomModal || elements.btnNewClassroomTriggers.length === 0) return;

            const openFreshClassroomModal = () => {
                resetClassroomModal();
                openClassroomModal();
            };

            const closeClassroomModal = () => {
                elements.classroomModal.style.display = 'none';
                elements.classroomModal.setAttribute('aria-hidden', 'true');
            };

            elements.btnNewClassroomTriggers.forEach((btn) => btn.addEventListener('click', openFreshClassroomModal));
            if (elements.btnCloseClassroomModal) elements.btnCloseClassroomModal.addEventListener('click', closeClassroomModal);
            if (elements.btnCancelClassroom) elements.btnCancelClassroom.addEventListener('click', closeClassroomModal);

            if (elements.btnSaveClassroomSettings) {
                elements.btnSaveClassroomSettings.addEventListener('click', () => {
                    saveClassroomSettings().then(() => {
                        showToast('Settings saved successfully.', 'success');
                    }).catch((e) => {
                        console.error('[CRM Admin] Save classroom failed:', e);
                        showToast(e?.message || 'Failed to save classroom.', 'error');
                    });
                });
            }

            if (elements.btnSaveClassroomScheduling) {
                elements.btnSaveClassroomScheduling.addEventListener('click', () => {
                    saveClassroomSettings().then(() => {
                        showToast('Scheduling setup saved.', 'success');
                    }).catch((e) => {
                        console.error('[CRM Admin] Save classroom scheduling failed:', e);
                        showToast(e?.message || 'Failed to save classroom scheduling.', 'error');
                    });
                });
            }

            if (elements.btnPreviewClassroomRegeneration) {
                elements.btnPreviewClassroomRegeneration.addEventListener('click', () => {
                    previewClassroomRegeneration().then(() => {
                        showToast('Regeneration preview ready.', 'success');
                    }).catch((e) => {
                        console.error('[CRM Admin] Preview classroom regeneration failed:', e);
                        showToast(e?.message || 'Failed to preview regeneration.', 'error');
                    });
                });
            }

            if (elements.btnApplyClassroomRegeneration) {
                elements.btnApplyClassroomRegeneration.addEventListener('click', () => {
                    applyClassroomRegeneration().then(() => {
                        showToast('Future schedule regenerated.', 'success');
                    }).catch((e) => {
                        console.error('[CRM Admin] Apply classroom regeneration failed:', e);
                        showToast(e?.message || 'Failed to regenerate future schedule.', 'error');
                    });
                });
            }

            elements.classroomSidebarItems.forEach((btn) => {
                btn.addEventListener('click', () => {
                    switchClassroomTab(btn.dataset.tab);
                });
            });

            if (elements.btnAddModule) {
                elements.btnAddModule.addEventListener('click', async () => {
                    if (!modalState.classroomId) return showToast('Please save classroom settings first.', 'error');
                    const title = prompt('Enter module title:');
                    if (!title) return;
                    try {
                        await window.ClassroomAPI.createModule(modalState.classroomId, { title, orderIndex: Date.now() });
                        showToast('Module created.', 'success');
                        loadClassroomModules(modalState.classroomId);
                    } catch (e) {
                        showToast(e.message, 'error');
                    }
                });
            }

            if (elements.btnPostAnnouncement) {
                elements.btnPostAnnouncement.addEventListener('click', async () => {
                    if (!modalState.classroomId) return showToast('Please save classroom settings first.', 'error');
                    const text = elements.inputStreamPost.value.trim();
                    if (!text) return;
                    try {
                        elements.btnPostAnnouncement.disabled = true;
                        await firebase.firestore().collection('crmClassrooms').doc(modalState.classroomId).collection('posts').add({
                            content: text,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            author: firebase.auth().currentUser.email || 'Admin'
                        });
                        elements.inputStreamPost.value = '';
                        showToast('Announcement posted.', 'success');
                        loadClassroomStream(modalState.classroomId);
                    } catch (e) {
                        showToast(e.message, 'error');
                    } finally {
                        elements.btnPostAnnouncement.disabled = false;
                    }
                });
            }

            if (elements.btnAddClasswork) {
                elements.btnAddClasswork.addEventListener('click', () => {
                    if (!modalState.classroomId) return showToast('Please save classroom settings first.', 'error');
                    elements.classworkComposer.style.display = 'block';
                });
            }

            if (elements.btnCancelClasswork) {
                elements.btnCancelClasswork.addEventListener('click', () => {
                    elements.classworkComposer.style.display = 'none';
                });
            }

            if (elements.btnSaveClassworkDraft) {
                elements.btnSaveClassworkDraft.addEventListener('click', async () => {
                    if (!modalState.classroomId) return;
                    const payload = {
                        title: elements.inputClassworkTitle.value.trim(),
                        type: elements.inputClassworkType.value,
                        moduleId: elements.inputClassworkModule.value,
                        allowVoiceNote: elements.inputClassworkVoice.checked,
                        attemptLimit: 4
                    };
                    if (!payload.title) return showToast('Title is required', 'error');
                    try {
                        await window.ClassroomAPI.createClasswork(modalState.classroomId, payload);
                        showToast('Classwork created.', 'success');
                        elements.classworkComposer.style.display = 'none';
                        elements.inputClassworkTitle.value = '';
                        loadClassroomClasswork(modalState.classroomId);
                    } catch (e) {
                        showToast(e.message, 'error');
                    }
                });
            }

            if (elements.btnEnrollStudent) {
                elements.btnEnrollStudent.addEventListener('click', () => {
                    enrollStudentIntoClassroom().catch((e) => {
                        console.error('[CRM Admin] Enroll student failed:', e);
                        showToast(e?.message || 'Failed to enroll student.', 'error');
                    });
                });
            }

            if (elements.btnCreateAttendanceSession) {
                elements.btnCreateAttendanceSession.addEventListener('click', () => {
                    createAttendanceSessionForClassroom().catch((e) => {
                        console.error('[CRM Admin] Create attendance session failed:', e);
                        showToast(e?.message || 'Failed to create attendance session.', 'error');
                    });
                });
            }

            if (elements.btnSaveAttendanceRecords) {
                elements.btnSaveAttendanceRecords.addEventListener('click', () => {
                    saveAttendanceRecordsForClassroom().catch((e) => {
                        console.error('[CRM Admin] Save attendance failed:', e);
                        showToast(e?.message || 'Failed to save attendance records.', 'error');
                    });
                });
            }

            if (elements.btnCreateLiveSession) {
                elements.btnCreateLiveSession.addEventListener('click', () => {
                    resetLiveSessionForm();
                    renderLiveDeliverySummary(modalState.liveSessions);
                });
            }

            if (elements.btnSaveLiveSession) {
                elements.btnSaveLiveSession.addEventListener('click', () => {
                    saveLiveSession().catch((e) => {
                        console.error('[CRM Admin] Save live session failed:', e);
                        showToast(e?.message || 'Failed to save live session.', 'error');
                    });
                });
            }

            if (elements.btnStartLiveSession) {
                elements.btnStartLiveSession.addEventListener('click', () => {
                    startSelectedLiveSession().catch((e) => {
                        console.error('[CRM Admin] Start live session failed:', e);
                        showToast(e?.message || 'Failed to start live session.', 'error');
                    });
                });
            }

            if (elements.btnEndLiveSession) {
                elements.btnEndLiveSession.addEventListener('click', () => {
                    endSelectedLiveSession().catch((e) => {
                        console.error('[CRM Admin] End live session failed:', e);
                        showToast(e?.message || 'Failed to end live session.', 'error');
                    });
                });
            }

            if (elements.btnCopyLiveJoinLink) {
                elements.btnCopyLiveJoinLink.addEventListener('click', async () => {
                    const session = getSelectedLiveSession();
                    const meetingUrl = String(session?.meetingUrl || '').trim();
                    if (!meetingUrl) return showToast('No join link available.', 'error');
                    await copyToClipboard(meetingUrl);
                    showToast('Join link copied.', 'success');
                });
            }

            if (elements.btnCopyLiveHostLink) {
                elements.btnCopyLiveHostLink.addEventListener('click', async () => {
                    const session = getSelectedLiveSession();
                    const hostUrl = String(session?.hostUrl || '').trim();
                    if (!hostUrl) return showToast('No host link available.', 'error');
                    await copyToClipboard(hostUrl);
                    showToast('Host link copied.', 'success');
                });
            }

            if (elements.inputAttendanceStudentSelect) {
                elements.inputAttendanceStudentSelect.addEventListener('change', () => {
                    refreshAttendanceClassroomFitNote().catch((error) => {
                        console.error('[CRM Admin] Failed to refresh classroom fit note:', error);
                    });
                });
            }

            if (elements.attendanceSchedulePrompt) {
                elements.attendanceSchedulePrompt.addEventListener('click', (evt) => {
                    const btn = evt.target instanceof HTMLElement ? evt.target.closest('[data-action="edit-classroom-schedule"]') : null;
                    if (!btn) return;
                    switchClassroomTab('settings');
                    setTimeout(() => {
                        if (elements.inputClassroomMeetingDays) {
                            elements.inputClassroomMeetingDays.focus();
                        } else if (elements.inputClassroomMeetingHours) {
                            elements.inputClassroomMeetingHours.focus();
                        }
                    }, 0);
                });
            }
        }

        return {
            setupClassroomModal,
            resetClassroomModal,
            switchClassroomTab
        };
    }

    return {
        createController
    };
})();
