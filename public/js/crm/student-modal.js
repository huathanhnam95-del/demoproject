window.CrmStudentModal = (function () {
    function createController(deps = {}) {
        const {
            elements,
            modalState,
            showToast,
            refreshStudentFinance,
            saveStudentProfile,
            createRecommendedEnrollment,
            renderStudentClassroomMatches,
            createEntranceTest,
            copyToClipboard,
            apiFetchJson,
            refreshStudentIdentity,
            applyReminderBadge,
            resetStudentTaskComposer,
            resetStudentActivityComposer,
            resetStudentFinanceComposer,
            renderStudentSchedulePrompt
        } = deps;

        function switchStudentTab(tabId) {
            elements.studentSidebarItems.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });

            elements.studentTabContents.forEach((content) => {
                const isMatch = content.id === `student-${tabId}`;
                content.style.display = isMatch ? 'block' : 'none';
                content.classList.toggle('active', isMatch);
            });

            if (tabId === 'finance' && modalState.studentId) {
                refreshStudentFinance().catch((error) => {
                    console.error('[CRM Admin] Failed to refresh student finance:', error);
                });
                return;
            }
            if (tabId === 'info') {
                renderStudentSchedulePrompt();
            }
        }

        function resetStudentModal() {
            modalState.studentId = null;
            modalState.studentProfile = null;
            modalState.createdTestLinks = new Map();
            modalState.classroomMatches = [];

            switchStudentTab('info');

            const inputs = [
                elements.inputStudentName,
                elements.inputStudentLabel,
                elements.inputStudentPhone,
                elements.inputStudentEmail,
                elements.inputStudentZalo,
                elements.inputStudentFacebook,
                elements.inputScoreOverall,
                elements.inputScoreListening,
                elements.inputScoreReading,
                elements.inputScoreSpeaking,
                elements.inputScoreWriting,
                elements.inputStudentDueDate,
                elements.inputStudentLevel,
                elements.inputTargetExam,
                elements.inputTargetScore,
                elements.inputPreferredSchedule,
                elements.inputScoreHistory,
                elements.inputGuardianContacts,
                elements.inputCompanyContacts,
                elements.inputDocumentRefs,
                elements.inputCounselingNotes,
                elements.inputClassCodeDisplay,
                elements.inputHandshakeEmail
            ];
            inputs.forEach((el) => {
                if (el) el.value = '';
            });

            if (elements.studentIdBadge) {
                elements.studentIdBadge.style.display = 'none';
                elements.studentIdBadge.textContent = 'ID: —';
            }

            if (elements.btnAddEntranceTest) elements.btnAddEntranceTest.disabled = false;
            if (elements.entranceTestLinkInput) elements.entranceTestLinkInput.value = '';
            if (elements.btnCopyEntranceTestLink) elements.btnCopyEntranceTestLink.disabled = true;
            if (elements.entranceTestsList) elements.entranceTestsList.innerHTML = '<div class="crm-muted">No tests yet.</div>';

            if (elements.handshakePreview) elements.handshakePreview.style.display = 'none';
            if (elements.linkedUidsUl) elements.linkedUidsUl.innerHTML = '<li class="text-muted">No accounts linked yet.</li>';
            if (elements.studentTaskList) elements.studentTaskList.innerHTML = '<div class="crm-muted">No tasks yet.</div>';
            if (elements.studentActivityList) elements.studentActivityList.innerHTML = '<div class="crm-muted">No activity yet.</div>';
            if (elements.studentTaskMeta) elements.studentTaskMeta.textContent = 'Save the profile to schedule follow-ups.';
            applyReminderBadge(elements.studentTaskBadge, null);
            resetStudentTaskComposer();
            resetStudentActivityComposer();
            resetStudentFinanceComposer();
            if (elements.studentClassroomMatchSummary) elements.studentClassroomMatchSummary.innerHTML = '<div class="crm-muted">Loading classroom recommendations...</div>';
            if (elements.inputStudentClassroomMatchSelect) {
                elements.inputStudentClassroomMatchSelect.innerHTML = '<option value="">No classroom selected</option>';
                elements.inputStudentClassroomMatchSelect.value = '';
            }
            if (elements.studentClassroomMatchMeta) {
                elements.studentClassroomMatchMeta.textContent = 'Select the suggested classroom or choose another match.';
            }
            if (elements.studentClassroomMatchWarning) {
                elements.studentClassroomMatchWarning.textContent = '';
                elements.studentClassroomMatchWarning.style.color = '';
            }
            if (elements.btnCreateRecommendedEnrollment) {
                elements.btnCreateRecommendedEnrollment.disabled = true;
            }

            if (elements.btnSaveStudent) {
                elements.btnSaveStudent.disabled = false;
                elements.btnSaveStudent.textContent = 'Save Student';
            }
        }

        function setupStudentModal() {
            if (elements.btnNewStudentTriggers.length === 0) return;

            elements.btnNewStudentTriggers.forEach((btn) => {
                btn.addEventListener('click', () => {
                    elements.studentModal.style.display = 'flex';
                    elements.studentModal.setAttribute('aria-hidden', 'false');
                    resetStudentModal();
                });
            });

            const closeStudentModal = () => {
                elements.studentModal.style.display = 'none';
                elements.studentModal.setAttribute('aria-hidden', 'true');
                switchStudentTab('info');
            };

            if (elements.btnCloseStudentModal) elements.btnCloseStudentModal.addEventListener('click', closeStudentModal);
            if (elements.btnCancelStudent) elements.btnCancelStudent.addEventListener('click', closeStudentModal);

            elements.studentSidebarItems.forEach((btn) => {
                btn.addEventListener('click', () => {
                    switchStudentTab(btn.dataset.tab);
                });
            });

            if (elements.btnSaveStudent) {
                elements.btnSaveStudent.addEventListener('click', () => {
                    saveStudentProfile().catch((e) => {
                        console.error('[CRM Admin] Save student failed:', e);
                        showToast(e?.message || 'Failed to save student.', 'error');
                    });
                });
            }

            if (elements.btnCreateRecommendedEnrollment) {
                elements.btnCreateRecommendedEnrollment.addEventListener('click', () => {
                    createRecommendedEnrollment().catch((e) => {
                        console.error('[CRM Admin] Create recommended enrollment failed:', e);
                        showToast(e?.message || 'Failed to create enrollment from recommendation.', 'error');
                    });
                });
            }

            if (elements.studentSchedulePrompt) {
                elements.studentSchedulePrompt.addEventListener('click', (evt) => {
                    const btn = evt.target instanceof HTMLElement ? evt.target.closest('[data-action="edit-student-schedule"]') : null;
                    if (!btn) return;
                    switchStudentTab('info');
                    setTimeout(() => {
                        if (elements.inputPreferredLearningDays) {
                            elements.inputPreferredLearningDays.focus();
                        } else if (elements.inputPreferredLearningHours) {
                            elements.inputPreferredLearningHours.focus();
                        }
                    }, 0);
                });
            }

            if (elements.inputStudentClassroomMatchSelect) {
                elements.inputStudentClassroomMatchSelect.addEventListener('change', () => {
                    renderStudentClassroomMatches({
                        matches: Array.isArray(modalState.classroomMatches) ? modalState.classroomMatches : [],
                        classroomCount: Array.isArray(modalState.classroomMatches) ? modalState.classroomMatches.length : 0,
                        recommendedClassroom: Array.isArray(modalState.classroomMatches) ? modalState.classroomMatches[0] || null : null
                    });
                });
            }

            if (elements.btnAddEntranceTest) {
                elements.btnAddEntranceTest.addEventListener('click', () => {
                    createEntranceTest().catch((e) => {
                        console.error('[CRM Admin] Create entrance test failed:', e);
                        showToast(e?.message || 'Failed to create entrance test.', 'error');
                    });
                });
            }

            if (elements.btnCopyEntranceTestLink) {
                elements.btnCopyEntranceTestLink.addEventListener('click', async () => {
                    try {
                        const link = String(elements.entranceTestLinkInput?.value || '').trim();
                        if (!link) return;
                        await copyToClipboard(link);
                        showToast('Link copied.', 'success');
                    } catch (e) {
                        showToast(e?.message || 'Failed to copy link.', 'error');
                    }
                });
            }

            if (elements.btnGenerateClassCode) {
                elements.btnGenerateClassCode.addEventListener('click', async () => {
                    if (!modalState.studentId) {
                        await saveStudentProfile();
                    }
                    if (!modalState.studentId) return;

                    try {
                        const json = await apiFetchJson(`/api/admin/students/${encodeURIComponent(modalState.studentId)}/class-code`, {
                            method: 'POST'
                        });
                        if (elements.inputClassCodeDisplay) elements.inputClassCodeDisplay.value = json.classCode;
                        showToast('New class code generated.', 'success');
                    } catch (e) {
                        showToast(e.message, 'error');
                    }
                });
            }

            if (elements.btnLookupHandshake) {
                elements.btnLookupHandshake.addEventListener('click', async () => {
                    const email = elements.inputHandshakeEmail.value.trim();
                    if (!email) return;

                    try {
                        elements.btnLookupHandshake.disabled = true;
                        const json = await apiFetchJson(`/api/admin/users/lookup?email=${encodeURIComponent(email)}`, {
                            method: 'GET'
                        });

                        const user = json.user;
                        if (elements.handshakeName) elements.handshakeName.textContent = user.displayName;
                        if (elements.handshakeUid) elements.handshakeUid.textContent = `UID: ${user.uid}`;
                        if (elements.handshakeAvatar) elements.handshakeAvatar.src = user.photoURL || 'assets/default-avatar.png';

                        elements.btnConfirmHandshake.dataset.targetUid = user.uid;
                        elements.handshakePreview.style.display = 'block';
                    } catch (e) {
                        showToast(e.message, 'error');
                    } finally {
                        elements.btnLookupHandshake.disabled = false;
                    }
                });
            }

            if (elements.btnConfirmHandshake) {
                elements.btnConfirmHandshake.addEventListener('click', async () => {
                    const targetUid = elements.btnConfirmHandshake.dataset.targetUid;
                    if (!targetUid || !modalState.studentId) return;

                    try {
                        elements.btnConfirmHandshake.disabled = true;
                        await apiFetchJson(`/api/admin/students/${encodeURIComponent(modalState.studentId)}/force-link`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ targetUid })
                        });

                        showToast('User linked successfully.', 'success');
                        elements.handshakePreview.style.display = 'none';
                        elements.inputHandshakeEmail.value = '';
                        await refreshStudentIdentity();
                    } catch (e) {
                        showToast(e.message, 'error');
                    } finally {
                        elements.btnConfirmHandshake.disabled = false;
                    }
                });
            }
        }

        return {
            setupStudentModal,
            resetStudentModal,
            switchStudentTab
        };
    }

    return {
        createController
    };
})();
