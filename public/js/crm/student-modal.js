window.CrmStudentModal = (function () {
    function createController(deps = {}) {
        const {
            elements,
            modalState,
            showToast,
            openFreshStudentModal,
            closeStudentProfile,
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
        const entranceTestUi = window.CrmEntranceTests || null;

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
            if (tabId === 'courses') {
                if (window.CrmStudentCourses) {
                    if (modalState.studentId) {
                        window.CrmStudentCourses.refresh(modalState.studentId, modalState.studentProfile).catch((error) => {
                            console.error('[CRM Admin] Failed to refresh student courses:', error);
                        });
                    } else {
                        // New student — show empty state with Add Course CTA
                        const container = document.getElementById('student-courses');
                        if (container && typeof window.CrmStudentCourses.renderScreenA === 'function') {
                            window.CrmStudentCourses.renderScreenA(container, []);
                        }
                    }
                }
                return;
            }
            if (tabId === 'info') {
                renderStudentSchedulePrompt();
            }
        }

        function resetStudentModal() {
            modalState.studentSessionKey = Number(modalState.studentSessionKey || 0) + 1;
            modalState.studentId = null;
            modalState.studentProfile = null;
            modalState.isLeadMode = false;
            modalState.leadId = null;
            modalState.createdTestLinks = new Map();
            modalState.leadCreatedTestLinks = new Map();
            modalState.classroomMatches = [];

            switchStudentTab('info');

            const inputs = [
                elements.inputStudentName,
                elements.inputStudentLabel,
                elements.inputStudentPhone,
                elements.inputStudentEmail,
                elements.inputStudentZalo,
                elements.inputStudentFacebook,
                elements.inputStudentFacebookProfileUrl,
                elements.inputStudentFacebookPersonalOwner,
                elements.inputStudentAcquisitionSource,
                elements.inputStudentAgentSource,
                elements.inputScoreOverall,
                elements.inputScoreListening,
                elements.inputScoreReading,
                elements.inputScoreSpeaking,
                elements.inputScoreWriting,
                elements.inputStudentDueDate,
                elements.inputStudentLevel,
                elements.inputVisaType,
                elements.inputTargetLevel,
                elements.inputTargetExam,
                elements.inputTargetScore,
                elements.inputPreferredSchedule,
                elements.inputPreferredLearningDays,
                elements.inputPreferredLearningHours,
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
            if (window.CrmStudents && typeof window.CrmStudents.syncScoreDecorations === 'function') {
                window.CrmStudents.syncScoreDecorations(elements);
            }

            if (elements.studentIdBadge) {
                elements.studentIdBadge.style.display = 'none';
                elements.studentIdBadge.textContent = 'ID: —';
            }

            if (elements.leadEntranceTestSection) elements.leadEntranceTestSection.style.display = 'none';
            if (elements.btnAddLeadEntranceTest) {
                elements.btnAddLeadEntranceTest.disabled = true;
                elements.btnAddLeadEntranceTest.textContent = 'Add new test';
            }
            if (elements.leadEntranceTestLinkInput) elements.leadEntranceTestLinkInput.value = '';
            if (elements.btnCopyLeadEntranceTestLink) elements.btnCopyLeadEntranceTestLink.disabled = true;
            if (elements.btnOpenLeadEntranceTestLink) elements.btnOpenLeadEntranceTestLink.disabled = true;
            if (elements.leadEntranceTestLinkNote) {
                elements.leadEntranceTestLinkNote.textContent = 'Save the lead first to create a single-use learner link.';
            }
            if (elements.leadEntranceTestsList) {
                elements.leadEntranceTestsList.innerHTML = '<div class="crm-muted">No tests yet.</div>';
            }

            if (elements.btnAddEntranceTest) elements.btnAddEntranceTest.disabled = false;
            if (entranceTestUi && typeof entranceTestUi.applyControls === 'function') {
                entranceTestUi.applyControls(elements, null, { hasAnyTests: false });
            } else {
                if (elements.entranceTestLinkInput) elements.entranceTestLinkInput.value = '';
                if (elements.btnCopyEntranceTestLink) elements.btnCopyEntranceTestLink.disabled = true;
                if (elements.btnOpenEntranceTestLink) elements.btnOpenEntranceTestLink.disabled = true;
                if (elements.entranceTestLinkNote) {
                    elements.entranceTestLinkNote.textContent = 'Create a test to generate a single-use learner link you can send.';
                }
            }
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
            renderStudentSchedulePrompt();
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
                    if (typeof openFreshStudentModal === 'function') {
                        openFreshStudentModal();
                        return;
                    }
                    elements.studentModal.style.display = 'flex';
                    elements.studentModal.setAttribute('aria-hidden', 'false');
                    resetStudentModal();
                });
            });

            const closeStudentModal = () => {
                if (typeof closeStudentProfile === 'function') {
                    closeStudentProfile();
                    return;
                }
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

            if (elements.btnOpenEntranceTestLink) {
                elements.btnOpenEntranceTestLink.addEventListener('click', () => {
                    const link = String(elements.entranceTestLinkInput?.value || '').trim();
                    if (!link) return;
                    window.open(link, '_blank', 'noopener');
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

            // ── Visa Type / Target Level Automation ──
            const VISA_SCORE_MAP = {
                '462':      { target: 'Functional', scores: { overall: 24, listening: 'N/A', reading: 'N/A', speaking: 'N/A', writing: 'N/A' } },
                '482':      { target: 'Vocational', scores: { overall: 'N/A', listening: 33, reading: 36, speaking: 24, writing: 29 } },
                '186':      { target: 'Competent',  scores: { overall: 'N/A', listening: 47, reading: 48, speaking: 54, writing: 51 } },
                '491':      { target: 'Competent',  scores: { overall: 'N/A', listening: 47, reading: 48, speaking: 54, writing: 51 } },
                '10points': { target: 'Proficient', scores: { overall: 'N/A', listening: 65, reading: 65, speaking: 65, writing: 65 } },
                '20points': { target: 'Superior',   scores: { overall: 'N/A', listening: 69, reading: 70, speaking: 88, writing: 85 } },
                '485':      { target: '485',        scores: { overall: 55, listening: 40, reading: 42, speaking: 39, writing: 41 } }
            };

            const TARGET_LEVEL_SCORES = {
                'Functional': { overall: 24, listening: 'N/A', reading: 'N/A', speaking: 'N/A', writing: 'N/A' },
                'Vocational':  { overall: 'N/A', listening: 33, reading: 36, speaking: 24, writing: 29 },
                'Competent':   { overall: 'N/A', listening: 47, reading: 48, speaking: 54, writing: 51 },
                'Proficient':  { overall: 'N/A', listening: 65, reading: 65, speaking: 65, writing: 65 },
                'Superior':    { overall: 'N/A', listening: 69, reading: 70, speaking: 88, writing: 85 },
                '485':         { overall: 55, listening: 40, reading: 42, speaking: 39, writing: 41 }
            };

            function applyScoresToForm(scores) {
                if (!scores) return;
                if (elements.inputScoreOverall) elements.inputScoreOverall.value = scores.overall;
                if (elements.inputScoreListening) elements.inputScoreListening.value = scores.listening;
                if (elements.inputScoreReading) elements.inputScoreReading.value = scores.reading;
                if (elements.inputScoreSpeaking) elements.inputScoreSpeaking.value = scores.speaking;
                if (elements.inputScoreWriting) elements.inputScoreWriting.value = scores.writing;
                if (window.CrmStudents && typeof window.CrmStudents.syncScoreDecorations === 'function') {
                    window.CrmStudents.syncScoreDecorations(elements);
                }
            }

            if (elements.inputVisaType && elements.inputTargetLevel) {
                elements.inputVisaType.addEventListener('change', () => {
                    const type = elements.inputVisaType.value;
                    if (!type) return;

                    const mapping = VISA_SCORE_MAP[type];
                    if (mapping) {
                        elements.inputTargetLevel.value = mapping.target;
                        applyScoresToForm(mapping.scores);
                    } else {
                        elements.inputTargetLevel.value = '';
                    }
                });

                elements.inputTargetLevel.addEventListener('change', () => {
                    const level = elements.inputTargetLevel.value;
                    if (!level) return;

                    const scores = TARGET_LEVEL_SCORES[level];
                    applyScoresToForm(scores);
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
