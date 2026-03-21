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
        statusBadge: document.getElementById('submission-status-badge')
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

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    // Wait for firebase init
    function waitForAuthUser({ timeoutMs = 5000 } = {}) {
        return new Promise((resolve) => {
            if (typeof firebase === 'undefined') return resolve(null);
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                resolve(null);
            }, timeoutMs);

            const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                unsubscribe();
                resolve(user || null);
            });
        });
    }

    async function initFirebaseFromServer() {
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
    }

    async function init() {
        await initFirebaseFromServer();
        currentUser = await waitForAuthUser();
        if (!currentUser) {
            window.location.href = 'index.html';
            return;
        }

        if (elements.userAvatar) {
            const email = currentUser.email || 'User';
            elements.userAvatar.textContent = email.charAt(0).toUpperCase();
            elements.userAvatar.title = email;
        }

        setupUI();
        loadClassrooms();
    }

    function setupUI() {
        // Tabs
        elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                elements.tabs.forEach(t => t.classList.remove('active'));
                elements.panels.forEach(p => p.style.display = 'none');
                tab.classList.add('active');
                const viewId = `view-${tab.dataset.tab}`;
                const viewEl = document.getElementById(viewId);
                if (viewEl) viewEl.style.display = 'block';
            });
        });

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
            <audio controls src="${audioUrl}" style="width: 100%; outline: none;"></audio>
          </div>
        `;
                elements.mediaPreview.style.display = 'block';
                elements.btnSubmit.disabled = false;
                elements.validationNote.style.display = 'none';

                // Let it be submitted
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
            const classrooms = await window.ClassroomAPI.fetchClassrooms();
            elements.classSwitcher.innerHTML = classrooms.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            if (classrooms.length > 0) {
                activeClassId = classrooms[0].id;
                loadClassData();
            }
        } catch (e) {
            console.error(e);
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
            <div class="todo-card-meta">Assigned â€¢ ${escapeHtml(w.type)}</div>
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
