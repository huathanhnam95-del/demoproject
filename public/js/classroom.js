/**
 * classroom.js
 * Handles the Student view logic, including fetching data via ClassroomAPI 
 * and controlling the MediaRecorder UI for voice submissions.
 */

(async function () {
    'use strict';

    const elements = {
        tabs: document.querySelectorAll('.nav-tab'),
        panels: document.querySelectorAll('.view-panel'),
        classSwitcher: document.getElementById('class-switcher'),
        userAvatar: document.getElementById('user-avatar-btn'),

        // Todo
        todoContainer: document.getElementById('todo-list-container'),
        todoFilters: document.querySelectorAll('.filter-btn'),

        // Modules
        modulesContainer: document.getElementById('modules-container'),

        // Stream
        streamContainer: document.getElementById('stream-feed-container'),

        // Assignment Modal
        modal: document.getElementById('assignment-modal'),
        btnClose: document.getElementById('btn-close-assignment'),
        modalTitle: document.getElementById('assignment-title'),
        btnRecord: document.getElementById('btn-record-voice'),
        btnStop: document.getElementById('btn-stop-record'),
        indicator: document.getElementById('recording-indicator'),
        btnSubmit: document.getElementById('btn-submit-work'),
        audioWidget: document.getElementById('audio-recorder-widget'),
        mediaPreview: document.getElementById('media-preview-container'),
        validationNote: document.getElementById('validation-note'),
        timerText: document.getElementById('recording-timer'),
        statusBadge: document.getElementById('submission-status-badge'),

        // Teacher Schedule
        btnTeacherScheduleLink: document.getElementById('btn-teacher-schedule-link'),
        tabSchedule: document.getElementById('tab-schedule'),
        viewSchedule: document.getElementById('view-schedule'),
        scheduleContainer: document.getElementById('schedule-list-container'),
        btnScheduleRefresh: document.getElementById('btn-schedule-refresh'),
        btnScheduleFullWorkspace: document.getElementById('btn-schedule-full-workspace')
    };

    let currentUser = null;
    let activeClassId = null;

    // Media Recorder State
    let mediaRecorder = null;
    let audioChunks = [];
    let currentAudioBlob = null;
    let timerInterval = null;
    let startTime = 0;
    let activeWorkId = null;
    let currentSubmission = null;
    const authSessionGuard = window.AuthSessionGuard || null;

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    // Wait for firebase init
    function waitForAuthUser({ timeoutMs = 12000, nullGraceMs = 1500 } = {}) {
        if (typeof firebase === 'undefined') return Promise.resolve(null);
        if (authSessionGuard && typeof authSessionGuard.waitForCompatAuthUser === 'function') {
            return authSessionGuard.waitForCompatAuthUser(firebase, {
                timeoutMs,
                nullGraceMs
            });
        }
        return Promise.resolve(firebase.auth().currentUser || null);
    }

    async function initFirebaseFromServer() {
        if (authSessionGuard && typeof authSessionGuard.ensureCompatFirebaseFromConfig === 'function') {
            await authSessionGuard.ensureCompatFirebaseFromConfig(firebase);
            return;
        }

        if (typeof firebase === 'undefined') return;
        const res = await fetch('/api/config', { cache: 'no-store' });
        const result = await res.json().catch(() => null);

        if (!res.ok || !result?.success || !result?.config?.apiKey) {
            console.warn('Could not fetch /api/config. Ensure the server is running.');
            return;
        }

        if (!firebase.apps.length) {
            firebase.initializeApp(result.config);
        }
        if (authSessionGuard && typeof authSessionGuard.ensureCompatLocalPersistence === 'function') {
            await authSessionGuard.ensureCompatLocalPersistence(firebase);
        }
    }

    async function checkTeacherOrAdmin(user) {
        if (!user) return { isTeacher: false, isAdmin: false };
        try {
            const tokenResult = await user.getIdTokenResult?.();
            const claims = tokenResult?.claims || {};
            if (claims.admin === true || claims.isAdmin === true || claims.role === 'admin' || claims.crmRole === 'admin') {
                return { isTeacher: true, isAdmin: true };
            }
            if (claims.isTeacher === true || claims.teacher === true || claims.crmRole === 'teacher' || claims.role === 'teacher') {
                return { isTeacher: true, isAdmin: false };
            }
        } catch (_) {}

        try {
            if (typeof firebase !== 'undefined' && firebase.firestore) {
                const db = firebase.firestore();
                const snap = await db.collection('users').doc(user.uid).get();
                if (snap.exists) {
                    const data = snap.data() || {};
                    const crmRole = String(data.crmRole || '').trim().toLowerCase();
                    const role = String(data.role || '').trim().toLowerCase();
                    if (data.isAdmin === true || role === 'admin' || crmRole === 'admin') {
                        return { isTeacher: true, isAdmin: true };
                    }
                    if (data.isTeacher === true || role === 'teacher' || crmRole === 'teacher') {
                        return { isTeacher: true, isAdmin: false };
                    }
                }
            }
        } catch (_) {}

        try {
            if (window.ClassroomAPI && typeof window.ClassroomAPI.checkTeacherStatus === 'function') {
                const status = await window.ClassroomAPI.checkTeacherStatus();
                if (status.isAdmin) return { isTeacher: true, isAdmin: true };
                if (status.isTeacher) return { isTeacher: true, isAdmin: false };
            } else if (user.getIdToken) {
                const idToken = await user.getIdToken();
                const res = await fetch('/api/teacher/status', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${idToken}` },
                    cache: 'no-store'
                });
                const json = await res.json().catch(() => null);
                if (res.ok && json?.data?.isTeacher) {
                    return { isTeacher: true, isAdmin: Boolean(json?.data?.isAdmin) };
                }
            }
        } catch (_) {}

        try {
            if (user.getIdToken) {
                const idToken = await user.getIdToken();
                const res = await fetch('/api/admin/status', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${idToken}` },
                    cache: 'no-store'
                });
                const result = await res.json().catch(() => null);
                if (res.ok && result?.success && result?.isAdmin) {
                    return { isTeacher: true, isAdmin: true };
                }
            }
        } catch (_) {}

        return { isTeacher: false, isAdmin: false };
    }

    async function init() {
        await initFirebaseFromServer();
        currentUser = await waitForAuthUser();
        if (!currentUser) {
            window.location.replace('index.html');
            return;
        }

        if (elements.userAvatar) {
            const email = currentUser.email || 'User';
            elements.userAvatar.textContent = email.charAt(0).toUpperCase();
            elements.userAvatar.title = email;
        }

        setupUI();
        loadClassrooms();

        checkTeacherOrAdmin(currentUser).then(({ isTeacher, isAdmin }) => {
            if (isTeacher || isAdmin) {
                const btnHeader = document.getElementById('btn-teacher-schedule-link');
                const tabSched = document.getElementById('tab-schedule');
                const btnFull = document.getElementById('btn-schedule-full-workspace');
                if (btnHeader) btnHeader.style.display = 'inline-flex';
                if (tabSched) tabSched.style.display = 'inline-flex';
                if (btnFull) btnFull.style.display = 'inline-flex';

                if (window.location.hash === '#schedule') {
                    tabSched?.click();
                }
            }
        }).catch((err) => {
            console.warn('[Classroom] Teacher check failed:', err);
        });
    }

    function setupUI() {
        // Re-query tabs and panels in case new tabs/views were rendered
        elements.tabs = document.querySelectorAll('.nav-tab');
        elements.panels = document.querySelectorAll('.view-panel');

        // Tabs
        elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                elements.tabs.forEach(t => t.classList.remove('active'));
                elements.panels.forEach(p => p.style.display = 'none');
                tab.classList.add('active');
                const viewId = `view-${tab.dataset.tab}`;
                const viewEl = document.getElementById(viewId);
                if (viewEl) viewEl.style.display = 'block';
                if (tab.dataset.tab === 'schedule') {
                    loadScheduleData();
                }
            });
        });

        const btnRefreshSchedule = document.getElementById('btn-schedule-refresh');
        if (btnRefreshSchedule) {
            btnRefreshSchedule.addEventListener('click', () => {
                loadScheduleData();
            });
        }

        // Todo Filters
        elements.todoFilters.forEach(btn => {
            btn.addEventListener('click', () => {
                elements.todoFilters.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                // Currently just visual stub. In future, filter the todoList data array.
            });
        });

        // Class Switcher
        if (elements.classSwitcher) {
            elements.classSwitcher.addEventListener('change', (e) => {
                activeClassId = e.target.value;
                loadClassData();
            });
        }

        // Modal Events
        if (elements.btnClose) {
            elements.btnClose.addEventListener('click', closeAssignmentModal);
        }

        // Click outside to close
        if (elements.modal) {
            elements.modal.addEventListener('click', (e) => {
                if (e.target === elements.modal) closeAssignmentModal();
            });
        }

        // Recording Logic
        if (elements.btnRecord) {
            elements.btnRecord.addEventListener('click', startRecording);
        }

        if (elements.btnStop) {
            elements.btnStop.addEventListener('click', stopRecording);
        }

        // Submit Work
        if (elements.btnSubmit) {
            elements.btnSubmit.addEventListener('click', submitWork);
        }
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                currentAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(currentAudioBlob);
                elements.mediaPreview.innerHTML = `
          <div style="background: #f1f5f9; padding: 12px; border-radius: 8px;">
            <div style="font-weight:600; font-size: 0.85rem; margin-bottom: 8px;">Your Recording</div>
            <audio id="classroom-recording-audio" controls src="${audioUrl}" style="width: 100%; outline: none;"></audio>
          </div>
        `;
                elements.mediaPreview.style.display = 'block';
                elements.btnSubmit.disabled = false;
                elements.validationNote.style.display = 'none';

                if (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function') {
                    window.AudioDspPipeline.enhance(currentAudioBlob).then(result => {
                        if (result && result.wavBlob && result.audioUrl) {
                            currentAudioBlob = result.wavBlob;
                            const aud = document.getElementById('classroom-recording-audio');
                            if (aud) aud.src = result.audioUrl;
                        }
                    }).catch(err => {
                        console.warn('[Classroom] AudioDspPipeline enhancement failed, keeping raw audio:', err);
                    });
                }
            };

            mediaRecorder.start();

            // Update UI
            elements.btnRecord.style.display = 'none';
            elements.indicator.style.display = 'flex';
            elements.btnStop.style.display = 'inline-block';

            // Timer
            startTime = Math.floor(Date.now() / 1000);
            elements.timerText.textContent = "00:00";
            clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                const diff = Math.floor(Date.now() / 1000) - startTime;
                elements.timerText.textContent = formatTime(diff);
            }, 1000);

        } catch (err) {
            console.error(err);
            alert("Microphone access denied or unavailable.");
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
        clearInterval(timerInterval);

        // Update UI
        elements.btnRecord.style.display = 'inline-flex';
        elements.indicator.style.display = 'none';
        elements.btnStop.style.display = 'none';
        elements.btnRecord.innerHTML = '<span class="icon">🎤</span> Re-Record';
    }

    async function submitWork() {
        if (!activeWorkId || !activeClassId) return;

        const isResubmission = currentSubmission?.status === 'needs-revision';
        elements.btnSubmit.disabled = true;
        elements.btnSubmit.textContent = isResubmission ? 'Resubmitting...' : 'Submitting...';

        try {
            const result = await window.ClassroomAPI.submitAssignment(
                activeClassId,
                activeWorkId,
                currentAudioBlob
            );

            if (result.success) {
                elements.btnSubmit.textContent = isResubmission ? 'Resubmitted' : 'Submitted';
                elements.btnSubmit.style.background = "var(--accent-done)";
                elements.statusBadge.className = 'status-badge done';
                elements.statusBadge.textContent = isResubmission ? 'Resubmitted' : 'Turned In';
                elements.btnRecord.style.display = 'none';

                setTimeout(() => {
                    closeAssignmentModal();
                    loadTodos(activeClassId); // Reload to reflect changes
                }, 1500);
            }
        } catch (e) {
            console.error('[Classroom] Submission error:', e);
            alert("Error submitting work: " + e.message);
            elements.btnSubmit.disabled = false;
            elements.btnSubmit.textContent = isResubmission ? 'Resubmit Work' : 'Mark as Done';
        }
    }

    async function loadClassrooms() {
        if (!window.ClassroomAPI) return;
        try {
            let classrooms = [];

            // 1. For students, resolve enrolled classrooms via dedicated endpoint
            if (typeof window.ClassroomAPI.fetchStudentClassrooms === 'function') {
                try {
                    const studentClasses = await window.ClassroomAPI.fetchStudentClassrooms();
                    if (Array.isArray(studentClasses) && studentClasses.length) {
                        classrooms = studentClasses;
                    }
                } catch (_) {}
            }

            // 2. If not student or no student classrooms, try admin classrooms
            if (!classrooms.length) {
                try {
                    classrooms = await window.ClassroomAPI.fetchClassrooms();
                } catch (_) {}
            }

            // 3. If still empty, fetch classrooms assigned to the teacher via scheduler workspace
            if (!classrooms.length) {
                try {
                    const workspace = await window.ClassroomAPI.fetchTeacherSchedulerWorkspace();
                    if (Array.isArray(workspace?.classrooms) && workspace.classrooms.length) {
                        classrooms = workspace.classrooms;
                    }
                } catch (_) {}
            }

            // 4. Direct Firestore fallback if user is authenticated
            if (!classrooms.length && typeof firebase !== 'undefined' && firebase.firestore && currentUser) {
                try {
                    const db = firebase.firestore();
                    const enrollSnap = await db.collection('crmEnrollments')
                        .where('studentUid', '==', currentUser.uid)
                        .get();
                    const classIds = [];
                    enrollSnap.forEach((doc) => {
                        const d = doc.data() || {};
                        if (d.classId && !classIds.includes(d.classId)) classIds.push(d.classId);
                    });
                    if (classIds.length > 0) {
                        const classDocs = await Promise.all(
                            classIds.map((id) => db.collection('crmClassrooms').doc(id).get().catch(() => null))
                        );
                        classrooms = classDocs
                            .filter((s) => s && s.exists)
                            .map((s) => ({ id: s.id, classroomId: s.id, ...s.data() }));
                    }
                } catch (_) {}
            }

            if (elements.classSwitcher && classrooms.length > 0) {
                elements.classSwitcher.innerHTML = classrooms.map((c) => {
                    const classId = c.id || c.classroomId;
                    return `<option value="${escapeHtml(classId)}">${escapeHtml(c.name || classId)}</option>`;
                }).join('');
                activeClassId = classrooms[0].id || classrooms[0].classroomId;
                loadClassData();
            } else if (elements.classSwitcher) {
                elements.classSwitcher.innerHTML = '<option value="">No classrooms found</option>';
            }
        } catch (e) {
            console.error('[Classroom] Failed to load classrooms:', e);
        }
    }

    function loadClassData() {
        if (!activeClassId) return;
        loadStream(activeClassId);
        loadModules(activeClassId);
        loadTodos(activeClassId);
    }

    async function loadStream(classId) {
        if (!elements.streamContainer) return;
        try {
            const db = firebase.firestore();
            const snap = await db.collection('crmClassrooms').doc(classId).collection('posts').orderBy('createdAt', 'desc').get();
            if (snap.empty) {
                elements.streamContainer.innerHTML = '<p class="empty-state" style="border:none;">No announcements yet.</p>';
                return;
            }
            elements.streamContainer.innerHTML = snap.docs.map(doc => {
                const data = doc.data();
                return `
                    <div class="stream-card" style="padding: 16px; margin-bottom: 12px; background: white; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <div style="font-size: 0.85rem; color: #718096; margin-bottom: 8px;">
                            <strong>${escapeHtml(data.author || 'Admin')}</strong> • ${data.createdAt ? new Date(data.createdAt.toMillis()).toLocaleString() : 'Just now'}
                        </div>
                        <div>${escapeHtml(data.content)}</div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            console.error('Failed to load stream:', e);
            elements.streamContainer.innerHTML = '<p class="empty-state" style="border:none;">Failed to load announcements.</p>';
        }
    }

    async function loadModules(classId) {
        if (!window.ClassroomAPI) return;
        try {
            const modules = await window.ClassroomAPI.loadModules(classId);
            if (modules.length === 0) {
                elements.modulesContainer.innerHTML = '<p class="empty-state">No modules assigned yet.</p>';
                return;
            }
            elements.modulesContainer.innerHTML = modules.map(m => `
        <div class="stream-card" style="padding: 16px;">
          <h3 style="margin:0 0 4px 0;">${escapeHtml(m.title)}</h3>
          <div style="font-size:0.85rem; color:var(--crm-text-muted);">View materials and assignments</div>
        </div>
      `).join('');
        } catch (e) {
            console.error('Failed to load modules:', e);
        }
    }

    async function loadTodos(classId) {
        if (!window.ClassroomAPI) return;
        try {
            const [works, mySubmissions] = await Promise.all([
                window.ClassroomAPI.loadClasswork(classId),
                window.ClassroomAPI.fetchMySubmissions(classId)
            ]);

            if (works.length === 0) {
                elements.todoContainer.innerHTML = '<p class="empty-state">No tasks pending.</p>';
                return;
            }

            // Render as a list of interactive cards
            elements.todoContainer.innerHTML = works.map(w => {
                const sub = mySubmissions.find(s => s.workId === w.id);
                if (sub && sub.status === 'graded') {
                    return `
        <div class="todo-card graded" data-work-id="${escapeHtml(w.id)}">
          <div>
            <h3>${escapeHtml(w.title)}</h3>
            <div class="todo-card-meta">Assigned • ${escapeHtml(w.type)}</div>
            <div style="margin-top: 8px; padding: 8px; background: #e0f2fe; border-radius: 4px; color: #0284c7;">
              <strong>Grade: ${escapeHtml(sub.grade || 'N/A')}</strong>
            </div>
          </div>
        </div>
      `;
                } else if (sub && sub.status === 'needs-revision') {
                    return `
        <div class="todo-card needs-revision" data-work-id="${escapeHtml(w.id)}">
          <div>
            <h3>${escapeHtml(w.title)}</h3>
            <div class="todo-card-meta">Assigned • ${escapeHtml(w.type)}</div>
            <div style="margin-top: 8px; font-weight: 600; color: #b91c1c;">Needs Revision</div>
            ${sub.feedback ? `
              <div style="margin-top: 8px; font-size: 0.9rem; color: var(--crm-text-muted);">
                ${escapeHtml(sub.feedback)}
              </div>
            ` : ''}
          </div>
          <button class="filter-btn" style="border:1px solid var(--crm-border); color:#b91c1c;">Resubmit</button>
        </div>
      `;
                } else if (sub) {
                    return `
        <div class="todo-card turned-in" data-work-id="${escapeHtml(w.id)}">
          <div>
            <h3>${escapeHtml(w.title)}</h3>
            <div class="todo-card-meta">Assigned • ${escapeHtml(w.type)}</div>
            <div style="margin-top: 8px; font-weight: 500; color: var(--accent-done);">${sub.revisionCount > 1 ? '✓ Resubmitted' : '✓ Turned In'}</div>
          </div>
        </div>
      `;
                }
                
                return `
        <div class="todo-card" data-work-id="${escapeHtml(w.id)}">
          <div>
            <h3>${escapeHtml(w.title)}</h3>
            <div class="todo-card-meta">Assigned • ${escapeHtml(w.type)}</div>
          </div>
          <button class="filter-btn" style="border:1px solid var(--crm-border);">Open</button>
        </div>
      `;
            }).join('');

            // Attach click events
            document.querySelectorAll('.todo-card').forEach(card => {
                card.addEventListener('click', () => {
                    const wId = card.dataset.workId;
                    const work = works.find(x => x.id === wId);
                    if (work && !card.classList.contains('graded') && !card.classList.contains('turned-in')) {
                        openAssignment(work, mySubmissions.find(s => s.workId === wId) || null);
                    }
                });
            });
        } catch (e) {
            console.error('Failed to load classwork:', e);
        }
    }

    function openAssignment(work, submission = null) {
        activeWorkId = work.id;
        currentSubmission = submission;
        elements.modalTitle.textContent = work.title;
        elements.mediaPreview.style.display = 'none';
        elements.mediaPreview.innerHTML = '';
        elements.btnSubmit.disabled = true;
        elements.btnSubmit.textContent = submission?.status === 'needs-revision' ? "Resubmit Work" : "Mark as Done";
        elements.btnSubmit.style.background = "";
        if (submission?.status === 'needs-revision' && submission.feedback) {
            elements.validationNote.innerHTML = `
        <div style="padding:10px; border-radius:8px; background:#fff1f2; color:#9f1239; border:1px solid #fecdd3;">
          <strong>Teacher feedback:</strong> ${escapeHtml(submission.feedback)}
        </div>
      `;
            elements.validationNote.style.display = 'block';
        } else {
            elements.validationNote.textContent = '';
            elements.validationNote.style.display = work.allowVoiceNote ? 'block' : 'none';
        }

        elements.statusBadge.className = submission?.status === 'needs-revision'
            ? 'status-badge needs-revision'
            : (submission ? 'status-badge done' : 'status-badge assigned');
        elements.statusBadge.textContent = submission?.status === 'needs-revision'
            ? 'Needs Revision'
            : (submission ? 'Turned In' : 'Assigned');

        currentAudioBlob = null;

        if (work.allowVoiceNote) {
            elements.audioWidget.style.display = 'block';
            elements.btnRecord.style.display = 'inline-flex';
            elements.btnRecord.innerHTML = submission?.status === 'needs-revision'
                ? '<span class="icon">🎤</span> Re-Record'
                : '<span class="icon">🎤</span> Tap to Record';
        } else {
            elements.audioWidget.style.display = 'none';
            elements.btnSubmit.disabled = false; // can submit immediately if no constraints
        }

        elements.modal.style.display = 'flex';
    }

    function closeAssignmentModal() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
        clearInterval(timerInterval);
        elements.indicator.style.display = 'none';
        elements.btnStop.style.display = 'none';
        elements.modal.style.display = 'none';
        activeWorkId = null;
        currentSubmission = null;
    }

    async function loadScheduleData() {
        const container = document.getElementById('schedule-list-container');
        if (!container) return;
        container.innerHTML = '<p class="empty-state">Loading schedule...</p>';

        if (!window.ClassroomAPI?.fetchTeacherSchedulerWorkspace) {
            container.innerHTML = '<p class="empty-state">Schedule API unavailable.</p>';
            return;
        }

        try {
            const now = new Date();
            const weekday = now.getDay() || 7;
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - weekday + 1);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 13); // show 2 weeks of sessions

            const pad = (n) => String(n).padStart(2, '0');
            const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

            const payload = await window.ClassroomAPI.fetchTeacherSchedulerWorkspace({
                from: fmtDate(weekStart),
                to: fmtDate(weekEnd)
            });

            const classrooms = Array.isArray(payload?.classrooms) ? payload.classrooms : [];
            const classMap = new Map();
            classrooms.forEach((c) => {
                const id = c.id || c.classroomId;
                if (id) classMap.set(id, c);
            });

            const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
            if (!sessions.length) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p style="margin-bottom:8px;">No scheduled sessions in the next two weeks.</p>
                        <a href="crm-admin.html#courses/teacher-schedule" class="schedule-action-btn primary" style="display:inline-flex; margin-top:8px;">Open Full Scheduler &rarr;</a>
                    </div>
                `;
                return;
            }

            sessions.sort((a, b) => {
                const dateA = String(a.scheduledLocalDate || '');
                const dateB = String(b.scheduledLocalDate || '');
                if (dateA !== dateB) return dateA.localeCompare(dateB);
                const timeA = String(a.scheduledLocalTime || '');
                const timeB = String(b.scheduledLocalTime || '');
                return timeA.localeCompare(timeB);
            });

            const formatRange = (start, duration) => {
                if (!start) return '';
                const [h, m] = start.split(':').map(Number);
                if (isNaN(h) || isNaN(m)) return start;
                const totalMins = (h * 60) + m + (Number(duration) || 60);
                const endH = Math.floor(totalMins / 60) % 24;
                const endM = totalMins % 60;
                return `${pad(h)}:${pad(m)} – ${pad(endH)}:${pad(endM)}`;
            };

            const formatDayLabel = (dateStr) => {
                if (!dateStr) return '';
                const parts = dateStr.split('-');
                if (parts.length !== 3) return dateStr;
                const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
            };

            const html = sessions.map((s) => {
                const cls = classMap.get(s.classId);
                const className = cls?.name || s.className || s.classId || 'Class';
                const timeRange = formatRange(s.scheduledLocalTime, s.durationMinutes);
                const dayLabel = formatDayLabel(s.scheduledLocalDate);
                const unitLabel = s.unitType === 'overflow'
                    ? `Overflow ${s.overflowSequence || ''}`.trim()
                    : (s.contractUnitIndex ? `Unit ${s.contractUnitIndex}` : '');
                const status = String(s.status || 'scheduled').toLowerCase();
                const badgeClass = status === 'cancelled' ? 'cancelled' : (s.sessionOutcome && s.sessionOutcome !== 'none' ? 'completed' : 'scheduled');
                const badgeText = status === 'cancelled' ? 'Cancelled' : (s.sessionOutcome && s.sessionOutcome !== 'none' ? s.sessionOutcome : 'Scheduled');

                return `
                    <div class="schedule-card">
                        <div class="schedule-card-info">
                            <div class="schedule-card-header">
                                <span class="schedule-card-title">${escapeHtml(className)}</span>
                                <span class="schedule-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
                                ${unitLabel ? `<span class="schedule-badge" style="background:#f1f5f9;color:#475569;">${escapeHtml(unitLabel)}</span>` : ''}
                            </div>
                            <div class="schedule-card-meta">
                                <span class="schedule-card-time">🗓️ ${escapeHtml(dayLabel)} • ⏰ ${escapeHtml(timeRange)}</span>
                                <span>${Number(s.durationMinutes || 60)} mins</span>
                                ${s.primaryTeacherName ? `<span>👤 ${escapeHtml(s.primaryTeacherName)}</span>` : ''}
                            </div>
                        </div>
                        <div>
                            <a href="crm-admin.html#courses/teacher-schedule" class="schedule-action-btn" title="View details in scheduler">View in CRM &rarr;</a>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = html;
        } catch (err) {
            console.error('[Classroom] Failed to load schedule data:', err);
            container.innerHTML = `<p class="empty-state" style="color:var(--accent-missing);">Failed to load schedule: ${escapeHtml(err.message || 'Unknown error')}</p>`;
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str || '');
        return div.innerHTML;
    }

    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
