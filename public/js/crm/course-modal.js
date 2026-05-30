window.CrmCourseModal = (function () {
    function createController(deps = {}) {
        const {
            elements,
            modalState,
            showToast,
            apiFetchJson,
            refreshCourseCatalog,
            getCoursePayload,
            openCourseModal,
            setCourseTeachers
        } = deps;

        function switchCourseTab(tabId) {
            elements.courseSidebarItems.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });

            elements.courseTabContents.forEach((content) => {
                const isMatch = content.id === `course-${tabId}`;
                content.style.display = isMatch ? 'block' : 'none';
                content.classList.toggle('active', isMatch);
            });
        }

        function resetCourseModal() {
            modalState.courseId = null;
            switchCourseTab('info');

            const infoInputs = [
                elements.inputCourseName,
                elements.inputCourseCode,
                elements.inputCourseLabel,
                elements.inputCourseLevel,
                elements.inputCourseCategory,
                elements.inputCourseAgentCommissionPercent,
                elements.inputCourseDescription,
                elements.inputCourseTotalHours,
                elements.inputCourseDefaultSessionMinutes,
                elements.inputCourseDurationStep,
                elements.inputCourseTimezone
            ];
            infoInputs.forEach((el) => {
                if (el) el.value = '';
            });

            if (elements.inputCourseStatus) {
                elements.inputCourseStatus.value = elements.inputCourseStatus.options[0]?.value || 'active';
            }

            if (elements.courseTeacherEmailInput) {
                elements.courseTeacherEmailInput.value = '';
            }
            setCourseTeachers([]);

            if (elements.btnSaveCourse) {
                elements.btnSaveCourse.disabled = false;
                elements.btnSaveCourse.textContent = 'Save Course';
            }
        }

        async function saveCourse() {
            const payload = typeof getCoursePayload === 'function' ? getCoursePayload() : {};
            if (!payload.name) {
                throw new Error('Please enter a Course Name before saving.');
            }

            if (elements.btnSaveCourse) {
                elements.btnSaveCourse.disabled = true;
                elements.btnSaveCourse.textContent = 'Saving...';
            }

            try {
                const path = modalState.courseId
                    ? `/api/admin/courses/${encodeURIComponent(modalState.courseId)}`
                    : '/api/admin/courses';
                const method = modalState.courseId ? 'PATCH' : 'POST';
                const json = await apiFetchJson(path, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const courseId = String(json.courseId || json.course?.courseId || modalState.courseId || '').trim();
                if (!courseId) throw new Error('Course ID missing from server response.');

                modalState.courseId = courseId;
                await refreshCourseCatalog({ forceRefresh: true });

                showToast(method === 'PATCH' ? 'Course updated.' : 'Course saved.', 'success');
                resetCourseModal();
            } catch (error) {
                if (elements.btnSaveCourse) {
                    elements.btnSaveCourse.disabled = false;
                    elements.btnSaveCourse.textContent = 'Save Course';
                }
                throw error;
            }
        }

        function setupCourseModal() {
            if (!elements.courseModal || elements.btnNewCourseTriggers.length === 0) return;

            const openFreshCourseModal = () => {
                resetCourseModal();
                openCourseModal();
            };

            const closeCourseModal = () => {
                elements.courseModal.style.display = 'none';
                elements.courseModal.setAttribute('aria-hidden', 'true');
            };

            elements.btnNewCourseTriggers.forEach((btn) => {
                btn.addEventListener('click', openFreshCourseModal);
            });

            if (elements.btnCloseCourseModal) {
                elements.btnCloseCourseModal.addEventListener('click', closeCourseModal);
            }
            if (elements.btnCancelCourse) {
                elements.btnCancelCourse.addEventListener('click', closeCourseModal);
            }

            if (elements.btnSaveCourse) {
                elements.btnSaveCourse.addEventListener('click', () => {
                    saveCourse()
                        .then(() => {
                            closeCourseModal();
                        })
                        .catch((e) => {
                            console.error('[CRM Admin] Save course failed:', e);
                            showToast(e?.message || 'Failed to save course.', 'error');
                        });
                });
            }

            elements.courseSidebarItems.forEach((btn) => {
                btn.addEventListener('click', () => {
                    switchCourseTab(btn.dataset.tab);
                });
            });

            if (elements.btnAddCourseTeacher && elements.courseTeacherEmailInput && elements.courseTeachersList) {
                const handleAddTeacher = () => {
                    const rawEmail = elements.courseTeacherEmailInput.value.trim();
                    if (!rawEmail) return;

                    const email = rawEmail.toLowerCase();
                    const existing = Array.from(
                        elements.courseTeachersList.querySelectorAll('li[data-email]')
                    ).some((li) => li.dataset.email === email);
                    if (existing) {
                        elements.courseTeacherEmailInput.value = '';
                        return;
                    }

                    const nextEmails = Array.from(
                        elements.courseTeachersList.querySelectorAll('li[data-email]')
                    ).map((li) => String(li.dataset.email || '').trim()).filter(Boolean);
                    nextEmails.push(email);
                    setCourseTeachers(nextEmails);
                    elements.courseTeacherEmailInput.value = '';
                };

                elements.btnAddCourseTeacher.addEventListener('click', handleAddTeacher);
                elements.courseTeacherEmailInput.addEventListener('keydown', (evt) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        handleAddTeacher();
                    }
                });
            }
        }

        return {
            setupCourseModal,
            resetCourseModal,
            saveCourse,
            switchCourseTab
        };
    }

    return {
        createController
    };
})();
