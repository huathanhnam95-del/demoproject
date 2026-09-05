/**
 * CrmStudentCourses - Student Course Enrolments & Scheduling UI
 *
 * Manages the "Courses" tab inside the student modal (#student-courses):
 * - Screen A: Enrolments list with progress bars, next session info, and attendance launcher
 * - Screen B: Full-tab takeover Add Course form with course type filter, auto-calculating
 *             duration dates, teacher assignment, and Google Calendar-style availability matrix
 * - Screen C: Lessons & Attendance View with inline row expansion and push-forward cascade preview
 */
(function (global) {
    'use strict';

    let currentStudentId = null;
    let currentStudent = null;
    let cachedEnrollments = [];
    let activeAvailabilityInstance = null;
    let currentScreenId = 0;
    let activeRefreshStudentId = null;
    let refreshSequence = 0;

    function escapeHtml(str) {
        return (str == null ? '' : String(str)).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }


    function addDaysToDateString(dateStr, days) {
        if (!dateStr || !Number.isFinite(days)) return dateStr;
        const clean = String(dateStr).split('T')[0];
        const [y, m, d] = clean.split('-').map(Number);
        if (!y || !m || !d) return dateStr;
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (!Number.isFinite(dt.getTime())) return dateStr;
        dt.setUTCDate(dt.getUTCDate() + days);
        return dt.toISOString().split('T')[0];
    }

    function formatLocalDateYMD(d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function getUpcomingMondayDateString() {
        const today = new Date();
        const day = today.getDay();
        const diff = (day === 0 ? 1 : (8 - day)); // Days until next Monday
        today.setDate(today.getDate() + (day === 1 ? 0 : diff));
        return formatLocalDateYMD(today);
    }

    function formatHours(minutes) {
        const h = Math.max(0, Number(minutes) || 0) / 60;
        return Number.isInteger(h) ? String(h) : h.toFixed(1);
    }

    function formatFriendlyDate(dateStr, timeStr) {
        if (!dateStr) return 'Not scheduled';
        const clean = String(dateStr).split('T')[0];
        const [y, m, d] = clean.split('-').map(Number);
        if (!y || !m || !d) return String(dateStr);
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (!Number.isFinite(dt.getTime())) return String(dateStr);
        const dateFormatted = dt.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC'
        });
        return timeStr ? `${dateFormatted} at ${timeStr}` : dateFormatted;
    }

    // ==========================================
    // Shared Helpers
    // ==========================================

    async function getAuthHeaders(hasBody = false) {
        let user = null;
        try {
            if (global.firebase && typeof global.firebase.auth === 'function') {
                user = global.firebase.auth().currentUser;
            }
            if (!user && global.auth?.currentUser) {
                user = global.auth.currentUser;
            }
            if (!user && global.__FIREBASE_INTERNAL__?.auth?.currentUser) {
                user = global.__FIREBASE_INTERNAL__.auth.currentUser;
            }
        } catch (err) {
            void err;
        }

        let token = '';
        if (user && typeof user.getIdToken === 'function') {
            token = await user.getIdToken().catch(() => '');
        }
        const headers = { Accept: 'application/json' };
        if (hasBody) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    /** Check if a test mock override exists on the global CrmStudentCourses for the given method. */
    function getMockOverride(methodName, localRef) {
        const ext = global.CrmStudentCourses;
        if (ext && typeof ext[methodName] === 'function' && ext[methodName] !== localRef) {
            return ext[methodName];
        }
        return null;
    }

    /** Compute progress metrics from enrollment summary and course delivery template. */
    function computeCourseProgress(summary, deliveryTemplate) {
        const sum = summary || {};
        const totalMins = sum.contractedMinutesTotal || (deliveryTemplate?.totalInstructionMinutes) || 0;
        const deliveredMins = sum.contractedMinutesDelivered || 0;
        const remainingMins = Math.max(totalMins - deliveredMins, 0);
        const pct = totalMins > 0 ? Math.min(Math.round((deliveredMins / totalMins) * 100), 100) : 0;
        return {
            totalMins, deliveredMins, remainingMins, pct,
            totalHours: formatHours(totalMins),
            deliveredHours: formatHours(deliveredMins),
            remainingHours: formatHours(remainingMins)
        };
    }

    /** Generate progress bar HTML (shared between Screen A and Screen C). */
    function renderProgressBarHtml(progress) {
        return `
            <div class="crm-funnel-track" role="progressbar"
                 aria-valuenow="${progress.deliveredMins}" aria-valuemin="0"
                 aria-valuemax="${progress.totalMins}"
                 aria-label="Course progress: ${progress.deliveredHours} of ${progress.totalHours} hours"
                 style="height: 8px; border-radius: 4px; background: var(--crm-border); overflow: hidden;">
                <div class="crm-funnel-bar" style="width: ${progress.pct}%; height: 100%; background: var(--crm-primary); border-radius: 4px; transition: width 0.3s ease;"></div>
            </div>
        `;
    }

    /** Teardown the active availability matrix instance if it exists. */
    function destroyAvailabilityMatrix() {
        if (activeAvailabilityInstance) {
            activeAvailabilityInstance.destroy();
            activeAvailabilityInstance = null;
        }
    }

    // ==========================================
    // API Client Functions
    // ==========================================

    async function fetchStudentEnrollments(studentId) {
        const mock = getMockOverride('fetchStudentEnrollments', fetchStudentEnrollments);
        if (mock) return mock(studentId);

        const headers = await getAuthHeaders();
        const res = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/enrollments`, {
            method: 'GET',
            headers
        });
        if (!res.ok) {
            throw new Error(`Failed to load enrollments (HTTP ${res.status})`);
        }
        const data = await res.json();
        return data.enrollments || [];
    }

    async function submitEnrollment(payload) {
        const mock = getMockOverride('submitEnrollment', submitEnrollment);
        if (mock) return mock(payload);

        const headers = await getAuthHeaders(true);
        const res = await fetch('/api/admin/enrollments', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || data.error || `Failed to create enrollment (HTTP ${res.status})`);
        }
        return data;
    }

    async function submitAttendance(sessionId, status, notes = '') {
        const mock = getMockOverride('submitAttendance', submitAttendance);
        if (mock) return mock(sessionId, status, notes);

        const headers = await getAuthHeaders(true);
        const res = await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/attendance`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ status, notes })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'Failed to update attendance');
        return data;
    }

    async function submitPushForward(sessionId, options = {}) {
        const mock = getMockOverride('submitPushForward', submitPushForward);
        if (mock) return mock(sessionId, options);

        const headers = await getAuthHeaders(true);
        const res = await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/push-forward`, {
            method: 'POST',
            headers,
            body: JSON.stringify(options)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'Failed to push forward session');
        return data;
    }


    // ==========================================
    // SCREEN A: Enrolments Overview List
    // ==========================================
    function renderScreenA(containerEl, enrollments) {
        currentScreenId += 1;
        destroyAvailabilityMatrix();

        containerEl.innerHTML = `
            <div class="crm-student-courses-container">
                <div class="crm-student-courses-header">
                    <div>
                        <h3>Enrolled Courses</h3>
                        <p class="crm-muted" style="margin: 2px 0 0 0; font-size: 13px;">Manage course enrolments, weekly schedules, and attendance records.</p>
                    </div>
                    <button type="button" class="crm-btn-primary" id="btn-show-add-course" style="font-size: 13px; padding: 6px 14px;">
                        + Enrol in a Course
                    </button>
                </div>
                <div id="student-courses-content-list" class="crm-student-courses-list"></div>
            </div>
        `;

        const listEl = containerEl.querySelector('#student-courses-content-list');
        const btnAdd = containerEl.querySelector('#btn-show-add-course');
        btnAdd.onclick = () => renderScreenB(containerEl);

        if (!enrollments || enrollments.length === 0) {
            listEl.innerHTML = `
                <div class="crm-empty-state" style="padding: 32px 16px; text-align: center; border: 1px dashed var(--crm-border); border-radius: var(--crm-radius);">
                    <p class="crm-muted" style="margin-bottom: 12px; font-size: 14px;">No courses enrolled yet for this student.</p>
                    <button type="button" class="crm-btn-secondary" id="btn-empty-add-course" style="font-size: 13px;">
                        + Enrol in a Course
                    </button>
                </div>
            `;
            listEl.querySelector('#btn-empty-add-course').onclick = () => renderScreenB(containerEl);
            return;
        }

        listEl.innerHTML = enrollments.map((enr) => {
            const course = enr.course || {};
            const summary = enr.scheduleSummary || {};
            const sessions = Array.isArray(enr.sessions) ? enr.sessions : [];

            const courseName = course.name || enr.courseId || 'Course';
            const courseCode = course.code || '';
            const courseType = (course.courseType || '1on1').toUpperCase();
            const status = enr.status || 'active';

            const progress = computeCourseProgress(summary, course.deliveryTemplate);

            // Find next upcoming scheduled session
            const todayLocalDate = formatLocalDateYMD(new Date());
            const scheduledSessions = sessions.filter((s) => s.status === 'scheduled');
            const upcomingScheduled = scheduledSessions
                .filter((s) => s.scheduledLocalDate && s.scheduledLocalDate >= todayLocalDate)
                .sort((a, b) => {
                    const da = String(a.scheduledLocalDate).localeCompare(String(b.scheduledLocalDate));
                    if (da !== 0) return da;
                    return String(a.scheduledLocalTime || '').localeCompare(String(b.scheduledLocalTime || ''));
                });
            const nextSession = upcomingScheduled[0] || null;
            let nextLessonStr = 'No sessions scheduled';
            if (nextSession) {
                nextLessonStr = formatFriendlyDate(nextSession.scheduledLocalDate, nextSession.scheduledLocalTime);
            } else if (scheduledSessions.length > 0) {
                const overdueSession = scheduledSessions
                    .filter((s) => s.scheduledLocalDate)
                    .sort((a, b) => String(a.scheduledLocalDate).localeCompare(String(b.scheduledLocalDate)))[0];
                nextLessonStr = overdueSession
                    ? `Overdue: ${formatFriendlyDate(overdueSession.scheduledLocalDate, overdueSession.scheduledLocalTime)}`
                    : 'Scheduled sessions pending';
            } else if (sessions.length > 0) {
                nextLessonStr = 'All scheduled sessions completed';
            }

            return `
                <div class="crm-student-course-card" data-enrollment-id="${escapeHtml(enr.id || enr.enrollmentId)}">
                    <div class="crm-student-course-title-row">
                        <div class="crm-student-course-title-group">
                            <h4 class="crm-student-course-name">${escapeHtml(courseName)}</h4>
                            ${courseCode ? `<span class="crm-student-course-code">${escapeHtml(courseCode)}</span>` : ''}
                            <span class="crm-student-course-type-chip">${escapeHtml(courseType)}</span>
                        </div>
                        <span class="crm-student-course-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
                    </div>

                    <div class="crm-student-course-progress-block">
                        <div class="crm-student-course-progress-meta">
                            <span><strong>${progress.deliveredHours} / ${progress.totalHours} hrs</strong> delivered (${progress.pct}%)</span>
                            <span><strong>${progress.remainingHours} hrs</strong> remaining</span>
                        </div>
                        ${renderProgressBarHtml(progress)}
                    </div>

                    <div class="crm-student-course-details-row">
                        <div class="crm-student-course-detail-item">
                            <span>📅 Next: <strong>${escapeHtml(nextLessonStr)}</strong></span>
                        </div>
                        ${enr.classroom?.primaryTeacherUid ? `
                            <div class="crm-student-course-detail-item">
                                <span>👤 Teacher: <strong>${escapeHtml(enr.classroom.primaryTeacherUid)}</strong></span>
                            </div>
                        ` : ''}
                    </div>

                    <div class="crm-student-course-actions-row">
                        <button type="button" class="crm-btn-secondary btn-view-attendance" style="font-size: 12px; padding: 4px 12px;" data-enrollment-id="${escapeHtml(enr.id || enr.enrollmentId)}" aria-label="View Lessons & Attendance for ${escapeHtml(courseName)}">
                            View Lessons & Attendance →
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Wire attendance buttons (Screen C trigger)
        listEl.querySelectorAll('.btn-view-attendance').forEach((btn) => {
            btn.onclick = () => {
                const enrollmentId = btn.dataset.enrollmentId;
                const enr = enrollments.find((e) => (e.id || e.enrollmentId) === enrollmentId);
                if (enr) {
                    renderScreenC(containerEl, enr);
                }
            };
        });
    }

    // ==========================================
    // SCREEN B: Add Course Takeover View
    // ==========================================
    async function renderScreenB(containerEl) {
        const screenId = ++currentScreenId;
        destroyAvailabilityMatrix();

        containerEl.innerHTML = `
            <div class="crm-course-enroll-takeover">
                <div class="crm-course-enroll-header">
                    <button type="button" class="crm-back-btn" id="btn-back-to-courses">
                        ← Back to Courses
                    </button>
                    <h3 style="margin: 0; font-size: 16px; font-weight: 700;">Enrol in Course</h3>
                </div>

                <div id="enroll-error-box" class="crm-enroll-error-box" role="alert" style="display: none;"></div>

                <div class="crm-enroll-form-grid">
                    <div class="crm-form-group">
                        <label for="enroll-course-type-filter">Course Type</label>
                        <select id="enroll-course-type-filter" class="crm-input">
                            <option value="1on1">1-on-1 (Individual)</option>
                            <option value="pronun">Pronun (Pronunciation Coaching)</option>
                            <option value="all">All Course Types</option>
                        </select>
                    </div>

                    <div class="crm-form-group">
                        <label for="enroll-course-select">Select Course *</label>
                        <select id="enroll-course-select" class="crm-input">
                            <option value="">Loading courses…</option>
                        </select>
                    </div>

                    <div class="crm-form-group">
                        <label for="enroll-start-date">Start Date *</label>
                        <input type="date" id="enroll-start-date" class="crm-input" value="${getUpcomingMondayDateString()}">
                    </div>

                    <div class="crm-form-group">
                        <label for="enroll-end-date" style="display: flex; align-items: center; justify-content: space-between;">
                            <span>End Date</span>
                            <span id="enroll-end-date-helper" class="crm-muted" style="font-size: 11px; font-weight: normal;">(auto-calculated)</span>
                        </label>
                        <input type="date" id="enroll-end-date" class="crm-input">
                    </div>

                    <div class="crm-form-group crm-enroll-form-full">
                        <label for="enroll-teacher-select">Assigned Teacher (Optional)</label>
                        <select id="enroll-teacher-select" class="crm-input">
                            <option value="">-- Select Teacher --</option>
                        </select>
                    </div>

                    <div class="crm-form-group crm-enroll-form-full">
                        <label style="margin-bottom: 6px; display: block; font-weight: 600;">
                            Weekly Recurring Availability *
                        </label>
                        <p class="crm-muted" style="margin: 0 0 10px 0; font-size: 12px;">
                            Select which days and times the student will have lessons each week.
                        </p>
                        <div id="enroll-availability-matrix-container"></div>
                    </div>

                    <div class="crm-form-group crm-enroll-form-full">
                        <div id="enroll-comparison-bar" class="crm-enroll-comparison-bar" role="status" aria-live="polite">
                            <span>Contract: <strong>—</strong></span>
                            <span>Weekly scheduled: <strong>0 lessons · 0 hrs</strong></span>
                        </div>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                    <button type="button" class="crm-btn-secondary" id="btn-cancel-enroll">
                        Cancel
                    </button>
                    <button type="button" class="crm-btn-primary" id="btn-submit-enroll">
                        Enrol Student & Seed Schedule
                    </button>
                </div>
            </div>
        `;

        const btnBack = containerEl.querySelector('#btn-back-to-courses');
        const btnCancel = containerEl.querySelector('#btn-cancel-enroll');
        const btnSubmit = containerEl.querySelector('#btn-submit-enroll');
        const typeSelect = containerEl.querySelector('#enroll-course-type-filter');
        const courseSelect = containerEl.querySelector('#enroll-course-select');
        const startDateInput = containerEl.querySelector('#enroll-start-date');
        const endDateInput = containerEl.querySelector('#enroll-end-date');
        const teacherSelect = containerEl.querySelector('#enroll-teacher-select');
        const comparisonBar = containerEl.querySelector('#enroll-comparison-bar');
        const errorBox = containerEl.querySelector('#enroll-error-box');
        const matrixContainer = containerEl.querySelector('#enroll-availability-matrix-container');

        const goBack = () => renderScreenA(containerEl, cachedEnrollments);
        btnBack.onclick = goBack;
        btnCancel.onclick = goBack;

        // Load courses
        let allCourses = [];
        try {
            if (global.CrmCourses && typeof global.CrmCourses.fetchCourses === 'function') {
                allCourses = await global.CrmCourses.fetchCourses();
            } else {
                const headers = await getAuthHeaders();
                const res = await fetch('/api/admin/courses', { headers });
                if (!res.ok) throw new Error(`Failed to load courses (HTTP ${res.status})`);
                const data = await res.json();
                allCourses = data.courses || [];
            }
        } catch (e) {
            console.error('[StudentCourses] Error loading courses:', e);
            if (errorBox) {
                errorBox.textContent = `Error loading courses: ${e.message || 'Network error'}`;
                errorBox.style.display = 'block';
            }
        }

        if (currentScreenId !== screenId || !containerEl.isConnected) {
            return;
        }

        // Load teachers
        try {
            if (global.ClassroomAPI && typeof global.ClassroomAPI.fetchTeachers === 'function') {
                const teachers = await global.ClassroomAPI.fetchTeachers();
                if (currentScreenId === screenId && teacherSelect.isConnected) {
                    teacherSelect.innerHTML = `<option value="">-- Select Teacher --</option>` + teachers.map((t) => {
                        const name = t.displayName || t.name || t.email || t.uid;
                        return `<option value="${escapeHtml(t.uid)}">${escapeHtml(name)}</option>`;
                    }).join('');
                }
            }
        } catch (e) {
            console.warn('[StudentCourses] Error loading teachers:', e);
        }

        if (currentScreenId !== screenId || !containerEl.isConnected) {
            return;
        }

        function filterAndPopulateCourses() {
            const selectedType = typeSelect.value;
            const filtered = allCourses.filter((c) => {
                if (selectedType === 'all') return true;
                return (c.courseType || '1on1').toLowerCase() === selectedType.toLowerCase();
            });

            courseSelect.innerHTML = `<option value="">-- Select a Course --</option>` + filtered.map((c) => {
                const totalH = c.deliveryTemplate?.totalInstructionMinutes ? `${(c.deliveryTemplate.totalInstructionMinutes / 60)}h` : '';
                const durD = c.durationDays ? `${c.durationDays} days` : '';
                const meta = [c.code, totalH, durD].filter(Boolean).join(' · ');
                return `<option value="${escapeHtml(c.courseId || c.id)}">${escapeHtml(c.name)}${meta ? ` (${escapeHtml(meta)})` : ''}</option>`;
            }).join('');
        }

        typeSelect.onchange = () => {
            filterAndPopulateCourses();
            updateDatesAndMatrix();
        };

        filterAndPopulateCourses();

        // Initialize availability matrix
        if (global.CrmScheduleAvailability && typeof global.CrmScheduleAvailability.create === 'function') {
            activeAvailabilityInstance = global.CrmScheduleAvailability.create(matrixContainer, {
                defaultLessonMinutes: 120,
                timezone: 'Asia/Ho_Chi_Minh',
                onChange: () => updateComparisonBar()
            });
        }

        function getSelectedCourse() {
            const id = courseSelect.value;
            return allCourses.find((c) => (c.courseId || c.id) === id) || null;
        }

        function updateDatesAndMatrix() {
            const course = getSelectedCourse();
            if (!course) {
                endDateInput.value = '';
                if (endDateHelper) {
                    endDateHelper.className = 'crm-muted';
                    endDateHelper.innerHTML = '(auto-calculated)';
                }
                comparisonBar.innerHTML = `<span>Select a course to view contract requirements</span>`;
                return;
            }

            const durationDays = Number(course.durationDays) || 30;
            const startVal = startDateInput.value;
            if (startVal) {
                // Auto calculate end date
                endDateInput.value = addDaysToDateString(startVal, durationDays);
            }

            // Update default lesson minutes
            const defaultMins = course.deliveryTemplate?.defaultSessionMinutes || 120;
            if (activeAvailabilityInstance && typeof activeAvailabilityInstance.setDefaultLessonMinutes === 'function') {
                activeAvailabilityInstance.setDefaultLessonMinutes(defaultMins);
            }

            updateComparisonBar();
        }

        function updateComparisonBar() {
            const course = getSelectedCourse();
            if (!activeAvailabilityInstance) return;

            const state = activeAvailabilityInstance.getState();
            const weeklyMinutes = state.summary?.totalMinutes || 0;
            const weeklyHoursStr = state.summary ? formatHours(weeklyMinutes) : '0';
            const lessonCount = state.summary?.totalLessons || 0;
            const lessonWord = lessonCount === 1 ? 'lesson' : 'lessons';

            if (!course) {
                comparisonBar.innerHTML = `
                    <span>Select a course to calculate schedule alignment</span>
                    <span>Weekly scheduled: <strong>${lessonCount} ${lessonWord} · ${weeklyHoursStr} hrs</strong></span>
                `;
                return;
            }

            const totalMins = course.deliveryTemplate?.totalInstructionMinutes || 1440;
            const totalHoursStr = formatHours(totalMins);

            if (weeklyMinutes <= 0) {
                comparisonBar.innerHTML = `
                    <span>Contract: <strong>${totalHoursStr} hrs</strong></span>
                    <span class="status-warning">⚠️ No lessons scheduled yet</span>
                `;
                return;
            }

            // Calculate estimated weeks and alignment
            const estimatedWeeks = Math.ceil(totalMins / weeklyMinutes);
            const remainderMins = totalMins % weeklyMinutes;

            let alignmentHtml = '';
            if (remainderMins === 0) {
                alignmentHtml = `<span class="status-ok">✓ ${weeklyHoursStr} hrs/wk (${estimatedWeeks} weeks exact match)</span>`;
            } else {
                alignmentHtml = `<span>${weeklyHoursStr} hrs/wk (~${estimatedWeeks} weeks)</span>`;
            }

            comparisonBar.innerHTML = `
                <span>Contract: <strong>${totalHoursStr} hrs</strong></span>
                <span>Scheduled: <strong>${lessonCount} ${lessonWord}</strong> · ${alignmentHtml}</span>
            `;
        }

        const endDateHelper = containerEl.querySelector('#enroll-end-date-helper');

        function setAutoEndDate() {
            const course = getSelectedCourse();
            const dur = Number(course?.durationDays) || 30;
            if (startDateInput.value) {
                endDateInput.value = addDaysToDateString(startDateInput.value, dur);
            }
            if (endDateHelper) {
                endDateHelper.className = 'crm-muted';
                endDateHelper.innerHTML = '(auto-calculated)';
            }
        }

        function markEndDateManuallySet() {
            if (endDateHelper) {
                endDateHelper.className = 'crm-manual-override-badge';
                endDateHelper.innerHTML = `ⓘ Manually set <button type="button" id="btn-undo-end-date" class="crm-undo-link">Undo</button>`;
                const btnUndo = endDateHelper.querySelector('#btn-undo-end-date');
                if (btnUndo) {
                    btnUndo.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setAutoEndDate();
                    };
                }
            }
        }

        endDateInput.addEventListener('input', markEndDateManuallySet);
        endDateInput.addEventListener('change', markEndDateManuallySet);

        courseSelect.onchange = () => {
            updateDatesAndMatrix();
            setAutoEndDate();
        };

        // Changing start date updates end date instantly (User requirement!)
        startDateInput.addEventListener('input', setAutoEndDate);
        startDateInput.addEventListener('change', setAutoEndDate);

        // Form Submission
        btnSubmit.onclick = async () => {
            errorBox.style.display = 'none';
            errorBox.textContent = '';

            const course = getSelectedCourse();
            if (!course) {
                errorBox.textContent = 'Please select a course to enrol.';
                errorBox.style.display = 'block';
                return;
            }

            const startDate = startDateInput.value;
            if (!startDate) {
                errorBox.textContent = 'Please choose a course start date.';
                errorBox.style.display = 'block';
                return;
            }

            const endDate = endDateInput.value;
            if (endDate && endDate < startDate) {
                errorBox.textContent = 'End date cannot be earlier than start date.';
                errorBox.style.display = 'block';
                return;
            }

            const slots = activeAvailabilityInstance ? activeAvailabilityInstance.getSlots() : [];
            if (!slots || slots.length === 0) {
                errorBox.textContent = 'Please add at least one weekly lesson slot to the availability schedule.';
                errorBox.style.display = 'block';
                return;
            }

            const validation = activeAvailabilityInstance.validate();
            if (!validation.valid) {
                const firstErrMsg = validation.errors && validation.errors[0]
                    ? (validation.errors[0].message || validation.errors[0])
                    : 'Please fix errors in the availability schedule before submitting.';
                errorBox.textContent = firstErrMsg;
                errorBox.style.display = 'block';
                return;
            }

            const studentIdAtStart = currentStudentId;
            const screenIdAtStart = screenId;

            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Enrolling & Seeding Schedule…';
            if (btnBack) btnBack.disabled = true;
            if (btnCancel) btnCancel.disabled = true;

            try {
                const payload = {
                    studentId: studentIdAtStart,
                    studentName: currentStudent?.name || null,
                    studentEmail: currentStudent?.email || null,
                    courseId: course.courseId || course.id,
                    startDate,
                    endDate: endDateInput.value || null,
                    teacherUid: teacherSelect.value || null,
                    slots,
                    timezone: 'Asia/Ho_Chi_Minh'
                };

                await submitEnrollment(payload);

                if (currentScreenId !== screenIdAtStart || currentStudentId !== studentIdAtStart || !containerEl.isConnected) {
                    return;
                }

                if (typeof global.showToast === 'function') {
                    global.showToast('Student enrolled and schedule seeded successfully!', 'success');
                } else {
                    alert('Student enrolled and schedule seeded successfully!');
                }

                // Refresh enrollments and return to Screen A
                const freshEnrollments = await fetchStudentEnrollments(studentIdAtStart);
                if (currentScreenId !== screenIdAtStart || currentStudentId !== studentIdAtStart || !containerEl.isConnected) {
                    return;
                }
                cachedEnrollments = freshEnrollments;
                renderScreenA(containerEl, cachedEnrollments);
            } catch (err) {
                if (currentScreenId !== screenIdAtStart || currentStudentId !== studentIdAtStart || !containerEl.isConnected) {
                    return;
                }
                console.error('[StudentCourses] Submit error:', err);
                errorBox.textContent = err.message || 'Failed to enrol student.';
                errorBox.style.display = 'block';
            } finally {
                if (btnSubmit.isConnected) {
                    btnSubmit.disabled = false;
                    btnSubmit.textContent = 'Enrol Student & Seed Schedule';
                }
                if (btnBack && btnBack.isConnected) btnBack.disabled = false;
                if (btnCancel && btnCancel.isConnected) btnCancel.disabled = false;
            }
        };
    }

    // ==========================================
    // SCREEN C: Lessons & Attendance View with Inline Expansion
    // ==========================================
    function renderScreenC(containerEl, enrollment) {
        const screenId = ++currentScreenId;
        const studentIdAtStart = currentStudentId;
        destroyAvailabilityMatrix();

        const course = enrollment.course || {};
        const courseName = course.name || 'Course';
        const courseCode = course.code || '';
        const summary = enrollment.scheduleSummary || {};
        const sessions = Array.isArray(enrollment.sessions) ? [...enrollment.sessions] : [];

        // Sort sessions chronologically
        sessions.sort((a, b) => {
            const da = String(a.scheduledLocalDate || '').localeCompare(String(b.scheduledLocalDate || ''));
            if (da !== 0) return da;
            return String(a.scheduledLocalTime || '').localeCompare(String(b.scheduledLocalTime || ''));
        });

        const progress = computeCourseProgress(summary, course.deliveryTemplate);

        const attendedCount = sessions.filter((s) => s.sessionOutcome === 'completed').length;
        const penalizedCount = sessions.filter((s) => s.sessionOutcome === 'absent_counted').length;
        const rescheduledCount = sessions.filter((s) => s.attendanceState === 'finalized' && (s.attendanceStatus === 'rescheduled' || s.isPushedForward || (s.contractCountState === 'does_not_count' && s.sessionOutcome !== 'absent_makeup'))).length;
        const absentCount = sessions.filter((s) => s.attendanceState === 'finalized' && (s.sessionOutcome === 'absent_makeup' || s.attendanceStatus === 'absent') && s.attendanceStatus !== 'rescheduled' && !s.isPushedForward).length;

        containerEl.innerHTML = `
            <div class="crm-attendance-container">
                <div aria-live="polite" id="attendance-announce" class="crm-sr-only"></div>
                <div class="crm-attendance-header">
                    <div class="crm-attendance-title-row">
                        <button type="button" class="crm-back-btn" id="btn-back-to-screen-a">
                            ← Back to Enrolled Courses
                        </button>
                        <span class="crm-student-course-code">${escapeHtml(courseCode)}</span>
                    </div>
                    <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--crm-text-main);">
                        ${escapeHtml(courseName)} — Lessons & Attendance
                    </h3>
                </div>

                <div class="crm-attendance-summary-card">
                    <div class="crm-attendance-summary-stats">
                        <span>Contracted: <strong>${progress.totalHours} hrs</strong></span>
                        <span>Delivered: <strong>${progress.deliveredHours} hrs</strong> (${progress.pct}%)</span>
                        <span>Remaining: <strong>${progress.remainingHours} hrs</strong></span>
                    </div>
                    <div class="crm-attendance-summary-stats crm-attendance-summary-sessions">
                        <span>${attendedCount} attended</span>
                        <span>${penalizedCount} penalized</span>
                        <span>${rescheduledCount} rescheduled</span>
                        ${absentCount > 0 ? `<span>${absentCount} excused</span>` : ''}
                    </div>
                    ${renderProgressBarHtml(progress)}
                </div>

                <div style="overflow-x: auto;">
                    <table class="crm-session-table" aria-label="Scheduled sessions and attendance">
                        <thead>
                            <tr>
                                <th style="width: 44px; text-align: center;" aria-label="Session number">#</th>
                                <th>Date & Time</th>
                                <th style="width: 90px;">Duration</th>
                                <th style="width: 140px;">Status</th>
                                <th style="width: 150px; text-align: right;">Action</th>
                            </tr>
                        </thead>
                        <tbody id="session-table-body"></tbody>
                    </table>
                </div>
            </div>
        `;

        containerEl.querySelector('#btn-back-to-screen-a').onclick = () => renderScreenA(containerEl, cachedEnrollments);

        const tbody = containerEl.querySelector('#session-table-body');
        if (sessions.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: var(--crm-text-muted); padding: 24px;">
                        No scheduled sessions found for this course enrolment.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = sessions.map((s, idx) => {
            const sId = s.sessionId || s.id || ('sess-' + idx);
            s.sessionId = sId;
            const unitIndex = s.contractUnitIndex || (idx + 1);
            const dateFormatted = formatFriendlyDate(s.scheduledLocalDate, s.scheduledLocalTime);
            const durChip = global.CrmScheduleAvailability?.formatDurationChip
                ? global.CrmScheduleAvailability.formatDurationChip(s.durationMinutes)
                : `${s.durationMinutes || 120}m`;

            let badgeHtml = '';
            if (s.sessionOutcome === 'completed') {
                badgeHtml = `<span class="crm-session-status-badge status-attended">✓ Attended</span>`;
            } else if (s.sessionOutcome === 'absent_counted') {
                badgeHtml = `<span class="crm-session-status-badge status-penalized">! Penalized</span>`;
            } else if (s.attendanceStatus === 'rescheduled' || (s.isPushedForward && s.attendanceState === 'finalized')) {
                badgeHtml = `<span class="crm-session-status-badge status-rescheduled">↻ Rescheduled</span>`;
            } else if (s.sessionOutcome === 'absent_makeup' || s.attendanceStatus === 'absent') {
                badgeHtml = `<span class="crm-session-status-badge status-absent">○ Absent</span>`;
            } else if (s.contractCountState === 'does_not_count' && s.attendanceState === 'finalized') {
                badgeHtml = `<span class="crm-session-status-badge status-rescheduled">↻ Rescheduled</span>`;
            } else {
                badgeHtml = `<span class="crm-session-status-badge status-scheduled">⏳ Scheduled</span>`;
            }

            const isDone = s.attendanceState === 'finalized';

            return `
                <tr class="crm-session-row" data-session-id="${escapeHtml(sId)}">
                    <td style="text-align: center; font-weight: 600; color: var(--crm-text-muted);">${escapeHtml(unitIndex)}</td>
                    <td><strong>${escapeHtml(dateFormatted)}</strong></td>
                    <td><span class="crm-student-course-code">${escapeHtml(durChip)}</span></td>
                    <td>${badgeHtml}</td>
                    <td style="text-align: right;">
                        <button type="button" class="crm-btn-secondary btn-expand-attendance" style="font-size: 11px; padding: 3px 8px;" data-session-id="${escapeHtml(sId)}" aria-expanded="false" aria-controls="inline-panel-${escapeHtml(sId)}">
                            ${isDone ? 'Edit ▾' : 'Mark Attendance ▾'}
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Wire expand buttons
        tbody.querySelectorAll('.btn-expand-attendance').forEach((btn) => {
            btn.onclick = () => {
                const sId = btn.dataset.sessionId;
                const tr = btn.closest('.crm-session-row');
                const sessionObj = sessions.find((s) => (s.sessionId || s.id) === sId);
                if (!tr || !sessionObj) return;

                // If already open, close it
                const nextTr = tr.nextElementSibling;
                if (nextTr && nextTr.classList.contains('crm-session-inline-tr')) {
                    btn.setAttribute('aria-expanded', 'false');
                    nextTr.remove();
                    tr.classList.remove('is-expanded');
                    return;
                }

                // Close any other open inline rows
                tbody.querySelectorAll('.btn-expand-attendance[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
                tbody.querySelectorAll('.crm-session-inline-tr').forEach((r) => r.remove());
                tbody.querySelectorAll('.crm-session-row.is-expanded').forEach((r) => r.classList.remove('is-expanded'));

                // Expand inline row
                btn.setAttribute('aria-expanded', 'true');
                tr.classList.add('is-expanded');
                const inlineTr = document.createElement('tr');
                inlineTr.className = 'crm-session-inline-tr';
                inlineTr.innerHTML = `
                    <td colspan="5">
                        <div id="inline-panel-${escapeHtml(sId)}" class="crm-session-inline-panel">
                            <h4 class="crm-session-inline-title">
                                Attendance & Action for Session #${escapeHtml(sessionObj.contractUnitIndex || '')} — ${escapeHtml(formatFriendlyDate(sessionObj.scheduledLocalDate, sessionObj.scheduledLocalTime))}
                            </h4>

                            <div class="crm-inline-radio-group" role="radiogroup" aria-label="Attendance options">
                                <label class="crm-inline-radio-label">
                                    <input type="radio" name="inline-att-${escapeHtml(sId)}" value="attended" checked>
                                    <span><strong>✓ Attended</strong> <span class="crm-radio-desc">— student attended lesson (hours deducted)</span></span>
                                </label>
                                <label class="crm-inline-radio-label">
                                    <input type="radio" name="inline-att-${escapeHtml(sId)}" value="penalized">
                                    <span><strong>! Penalized</strong> <span class="crm-radio-desc">— unexcused absence, hours deducted, no makeup</span></span>
                                </label>
                                <label class="crm-inline-radio-label">
                                    <input type="radio" name="inline-att-${escapeHtml(sId)}" value="absent">
                                    <span><strong>○ Absent</strong> <span class="crm-radio-desc">— excused absence, hours not deducted, makeup owed</span></span>
                                </label>
                                <label class="crm-inline-radio-label">
                                    <input type="radio" name="inline-att-${escapeHtml(sId)}" value="push-forward">
                                    <span><strong>↻ Reschedule & Push Forward</strong> <span class="crm-radio-desc">— shift all later sessions forward by one slot</span></span>
                                </label>
                                ${sessionObj.attendanceState === 'finalized' ? `
                                <label class="crm-inline-radio-label">
                                    <input type="radio" name="inline-att-${escapeHtml(sId)}" value="reset">
                                    <span><strong>⏳ Reset to Scheduled</strong> <span class="crm-radio-desc">— clear attendance and revert to upcoming</span></span>
                                </label>
                                ` : ''}
                            </div>

                            <div id="inline-cascade-preview-${escapeHtml(sId)}" class="crm-cascade-preview-box" style="display: none;">
                                <div class="crm-cascade-preview-shift">Calculating shift cascade…</div>
                                <div class="crm-cascade-preview-date"></div>
                            </div>

                            <div class="crm-inline-actions">
                                <button type="button" class="crm-btn-secondary btn-inline-cancel">Cancel</button>
                                <button type="button" class="crm-btn-primary btn-inline-confirm">Confirm</button>
                            </div>
                        </div>
                    </td>
                `;

                tr.after(inlineTr);

                const radios = inlineTr.querySelectorAll(`input[name="inline-att-${sId}"]`);
                const previewBox = inlineTr.querySelector(`#inline-cascade-preview-${sId}`);
                const previewShift = previewBox.querySelector('.crm-cascade-preview-shift');
                const previewDate = previewBox.querySelector('.crm-cascade-preview-date');
                const btnCancel = inlineTr.querySelector('.btn-inline-cancel');
                const btnConfirm = inlineTr.querySelector('.btn-inline-confirm');

                // Accessibility: focus first radio
                const firstRadio = inlineTr.querySelector(`input[name="inline-att-${sId}"]`);
                if (firstRadio) firstRadio.focus();

                btnCancel.onclick = () => {
                    inlineTr.remove();
                    tr.classList.remove('is-expanded');
                    btn.setAttribute('aria-expanded', 'false');
                    btn.focus();
                };

                // Radio changes with stale-request tracking
                let previewRequestId = 0;
                radios.forEach((r) => {
                    r.onchange = async () => {
                        if (r.value === 'push-forward') {
                            const reqId = ++previewRequestId;
                            previewBox.style.display = 'flex';
                            previewShift.textContent = 'Calculating shift cascade…';
                            previewDate.textContent = '';
                            try {
                                const previewData = await submitPushForward(sId, { previewOnly: true });
                                if (reqId !== previewRequestId || !previewBox.isConnected) return;
                                const currentRadio = inlineTr.querySelector(`input[name="inline-att-${sId}"]:checked`);
                                if (!currentRadio || currentRadio.value !== 'push-forward') return;

                                if (previewData.previewSummary) {
                                    previewShift.textContent = `Shift: ${previewData.previewSummary}`;
                                    previewDate.textContent = `Course now ends ${previewData.newEndDateFormatted || previewData.newEndDate} (was ${previewData.prevEndDateFormatted || previewData.prevEndDate})`;
                                } else {
                                    previewShift.textContent = 'Shift preview ready.';
                                }
                            } catch (e) {
                                if (reqId !== previewRequestId || !previewBox.isConnected) return;
                                previewShift.textContent = `Error previewing shift: ${e.message}`;
                            }
                        } else {
                            previewRequestId += 1;
                            previewBox.style.display = 'none';
                        }
                    };
                });

                // Confirm action
                btnConfirm.onclick = async () => {
                    if (btnConfirm.disabled) return;
                    const checkedRadio = inlineTr.querySelector(`input[name="inline-att-${sId}"]:checked`);
                    const choice = checkedRadio ? checkedRadio.value : 'attended';

                    const btnBackToScreenA = containerEl.querySelector('#btn-back-to-screen-a');
                    if (btnBackToScreenA) btnBackToScreenA.disabled = true;

                    btnConfirm.disabled = true;
                    btnConfirm.textContent = 'Saving…';
                    btnCancel.disabled = true;
                    radios.forEach((r) => { r.disabled = true; });
                    tbody.querySelectorAll('.btn-expand-attendance').forEach((b) => { b.disabled = true; });

                    try {
                        if (choice === 'push-forward') {
                            await submitPushForward(sId);
                            if (typeof global.showToast === 'function') {
                                global.showToast('Session pushed forward and schedule cascade applied!', 'success');
                            }
                        } else {
                            await submitAttendance(sId, choice);
                            if (typeof global.showToast === 'function') {
                                global.showToast(`Attendance marked as ${choice}!`, 'success');
                            }
                        }

                        if (currentScreenId !== screenId || currentStudentId !== studentIdAtStart || !containerEl.isConnected) {
                            return;
                        }

                        const unitLabel = sessionObj.contractUnitIndex ? `Session ${sessionObj.contractUnitIndex}` : 'Session';
                        const announceMsg = choice === 'push-forward'
                            ? `${unitLabel} pushed forward and future lessons shifted.`
                            : (choice === 'reset'
                                ? `${unitLabel} reset to scheduled.`
                                : `${unitLabel} marked as ${choice}.`);

                        // Refetch enrollments and re-render Screen C
                        const freshEnrollments = await fetchStudentEnrollments(studentIdAtStart);
                        if (currentScreenId !== screenId || currentStudentId !== studentIdAtStart || !containerEl.isConnected) {
                            return;
                        }
                        cachedEnrollments = freshEnrollments;
                        const updatedEnr = cachedEnrollments.find((e) => (e.id || e.enrollmentId) === (enrollment.id || enrollment.enrollmentId));
                        if (updatedEnr) {
                            renderScreenC(containerEl, updatedEnr);
                            const announceEl = containerEl.querySelector('#attendance-announce');
                            if (announceEl) {
                                announceEl.textContent = announceMsg;
                            }
                        } else {
                            renderScreenA(containerEl, cachedEnrollments);
                        }
                    } catch (err) {
                        if (btnBackToScreenA && btnBackToScreenA.isConnected) btnBackToScreenA.disabled = false;
                        if (currentScreenId !== screenId || currentStudentId !== studentIdAtStart || !containerEl.isConnected) {
                            return;
                        }
                        const errMsg = err.message || 'Failed to save attendance.';
                        if (typeof global.showToast === 'function') {
                            global.showToast(errMsg, 'error');
                        } else {
                            alert(errMsg);
                        }
                        btnConfirm.disabled = false;
                        btnConfirm.textContent = 'Confirm';
                        btnCancel.disabled = false;
                        radios.forEach((r) => { r.disabled = false; });
                        tbody.querySelectorAll('.btn-expand-attendance').forEach((b) => { b.disabled = false; });
                    }
                };
            };
        });
    }

    // ==========================================
    // Public Controller API
    // ==========================================
    async function refresh(studentId, studentProfile) {
        const seq = ++refreshSequence;
        currentStudentId = studentId;
        activeRefreshStudentId = studentId;
        currentStudent = studentProfile || currentStudent;
        const containerEl = document.getElementById('student-courses');
        if (!containerEl) return;

        containerEl.innerHTML = `
            <div class="crm-student-courses-container">
                <p class="crm-muted" style="padding: 16px 0;">Loading enrolled courses…</p>
            </div>
        `;

        try {
            const enrollments = await fetchStudentEnrollments(studentId);
            if (seq !== refreshSequence || activeRefreshStudentId !== studentId) {
                return;
            }
            cachedEnrollments = enrollments;
            renderScreenA(containerEl, cachedEnrollments);
        } catch (err) {
            if (seq !== refreshSequence || activeRefreshStudentId !== studentId) {
                return;
            }
            console.error('[StudentCourses] Failed to fetch enrollments:', err);
            containerEl.innerHTML = `
                <div class="crm-student-courses-container">
                    <p style="color: var(--crm-danger-text); padding: 16px 0;">
                        Failed to load enrolled courses: ${escapeHtml(err.message)}
                    </p>
                </div>
            `;
        }
    }

    function destroy() {
        refreshSequence += 1;
        activeRefreshStudentId = null;
        destroyAvailabilityMatrix();
        currentStudentId = null;
        currentStudent = null;
        cachedEnrollments = [];
    }

    global.CrmStudentCourses = {
        refresh,
        destroy,
        destroyAvailabilityMatrix,
        renderScreenA,
        renderScreenB,
        renderScreenC,
        fetchStudentEnrollments,
        submitEnrollment,
        submitAttendance,
        submitPushForward
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = global.CrmStudentCourses;
    }
})(typeof window !== 'undefined' ? window : globalThis);
