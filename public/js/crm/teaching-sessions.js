/**
 * CRM Teaching Sessions & Pre-Class Briefings Controller
 * Handles drag-and-drop audio upload, session history, auto AI analysis polling, and live Mermaid.js mindmap/flowchart rendering.
 */
window.CrmTeachingSessions = (function () {
    let currentStudentId = null;
    let currentSession = null;
    let isInitialized = false;
    let selectedAudioFile = null;
    let pollTimer = null;

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function formatRelativeDate(dateStr) {
        if (!dateStr) return 'N/A';
        try {
            const date = new Date(dateStr);
            if (Number.isNaN(date.getTime())) return dateStr;
            return date.toLocaleDateString('vi-VN', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (_) {
            return dateStr;
        }
    }

    function formatDuration(seconds) {
        if (!seconds || Number.isNaN(Number(seconds))) return '';
        const s = Math.round(Number(seconds));
        const m = Math.floor(s / 60);
        const sec = s % 60;
        const h = Math.floor(m / 60);
        const min = m % 60;
        if (h > 0) return `${h}h ${min}m`;
        return `${min}m ${sec}s`;
    }

    async function getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        try {
            const user = window.firebase?.auth?.().currentUser || window.__FIREBASE_INTERNAL__?.auth?.currentUser;
            if (user && typeof user.getIdToken === 'function') {
                const token = await user.getIdToken();
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }
        } catch (err) {
            console.warn('[Teaching Sessions] Could not retrieve auth token:', err);
        }
        return headers;
    }

    function updateDropzoneDisplay(file) {
        selectedAudioFile = file || null;
        const promptEl = document.getElementById('teaching-session-dropzone-prompt');
        const selectedEl = document.getElementById('teaching-session-dropzone-selected');
        const filenameEl = document.getElementById('teaching-session-selected-filename');
        const filesizeEl = document.getElementById('teaching-session-selected-filesize');
        const dropzone = document.getElementById('teaching-session-dropzone');

        if (file) {
            if (promptEl) promptEl.style.display = 'none';
            if (selectedEl) selectedEl.style.display = 'flex';
            if (filenameEl) filenameEl.textContent = file.name;
            if (filesizeEl) {
                const mb = (file.size / (1024 * 1024)).toFixed(1);
                filesizeEl.textContent = `(${mb} MB)`;
            }
            if (dropzone) {
                dropzone.style.borderColor = '#10b981';
                dropzone.style.background = '#f0fdf4';
            }
        } else {
            if (promptEl) promptEl.style.display = 'block';
            if (selectedEl) selectedEl.style.display = 'none';
            const fileInput = document.getElementById('teaching-session-audio-file');
            if (fileInput) fileInput.value = '';
            if (dropzone) {
                dropzone.style.borderColor = '#cbd5e1';
                dropzone.style.background = '#f8fafc';
            }
        }
    }

    function convertMarkdownToHtml(markdown) {
        if (!markdown) return '<p class="text-muted">No report text generated yet.</p>';
        let html = escapeHtml(markdown);

        // Headers
        html = html.replace(/^### (.*$)/gim, '<h4 style="color:#0f172a;margin-top:16px;margin-bottom:8px;font-size:16px;">$1</h4>');
        html = html.replace(/^## (.*$)/gim, '<h3 style="color:#1e293b;margin-top:20px;margin-bottom:10px;font-size:18px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">$1</h3>');
        html = html.replace(/^# (.*$)/gim, '<h2 style="color:#0f172a;margin-top:24px;margin-bottom:12px;font-size:20px;">$1</h2>');

        // Blockquotes / Callouts
        html = html.replace(/^&gt; \[!TIP\]\s*\n&gt; (.*$)/gim, '<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:10px 14px;border-radius:4px;margin:12px 0;color:#1e40af;">💡 <strong>Key Takeaway:</strong> $1</div>');
        html = html.replace(/^&gt; (.*$)/gim, '<blockquote style="border-left:3px solid #cbd5e1;padding-left:10px;color:#64748b;margin:8px 0;">$1</blockquote>');

        // Bold & Code
        html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
        html = html.replace(/`([^`]+)`/gim, '<code style="background:#f1f5f9;color:#0f172a;padding:2px 6px;border-radius:4px;font-size:12px;">$1</code>');

        // Task List Checkboxes
        html = html.replace(/^- \[ \] (.*$)/gim, '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;"><input type="checkbox" disabled> <span>$1</span></div>');

        // Unordered lists
        html = html.replace(/^- (.*$)/gim, '<li style="margin-left:20px;margin-bottom:4px;">$1</li>');

        // Tables
        const lines = html.split('\n');
        let inTable = false;
        let tableHtml = '';
        const processedLines = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.endsWith('|')) {
                const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                if (!inTable) {
                    inTable = true;
                    tableHtml = '<div style="overflow-x:auto;margin:12px 0;"><table class="crm-table" style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#f8fafc;">';
                    cells.forEach(c => { tableHtml += `<th style="border:1px solid #e2e8f0;padding:8px 10px;text-align:left;">${c}</th>`; });
                    tableHtml += '</tr></thead><tbody>';
                } else if (line.includes(':---') || line.includes('---')) {
                    // Header separator row, skip
                    continue;
                } else {
                    tableHtml += '<tr>';
                    cells.forEach(c => { tableHtml += `<td style="border:1px solid #e2e8f0;padding:8px 10px;">${c}</td>`; });
                    tableHtml += '</tr>';
                }
            } else {
                if (inTable) {
                    tableHtml += '</tbody></table></div>';
                    processedLines.push(tableHtml);
                    inTable = false;
                    tableHtml = '';
                }
                processedLines.push(line);
            }
        }
        if (inTable) {
            tableHtml += '</tbody></table></div>';
            processedLines.push(tableHtml);
        }

        return processedLines.join('<br>').replace(/<br><div/g, '<div').replace(/<\/div><br>/g, '</div>').replace(/<br><h/g, '<h').replace(/<br><blockquote/g, '<blockquote');
    }

    async function renderMermaid(container, mermaidCode, diagramType) {
        if (!container) return;
        if (!mermaidCode || !mermaidCode.trim()) {
            container.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:32px;">No ${diagramType || 'diagram'} available for this session.</div>`;
            return;
        }

        if (!window.mermaid) {
            container.innerHTML = `<pre style="background:#f8fafc;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${escapeHtml(mermaidCode)}</pre>`;
            return;
        }

        try {
            window.mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                securityLevel: 'loose',
                mindmap: { useMaxWidth: true }
            });

            const uniqueId = `mermaid-${diagramType || 'diag'}-${Date.now()}`;
            const { svg } = await window.mermaid.render(uniqueId, mermaidCode);
            container.innerHTML = svg;
        } catch (err) {
            console.error('[Teaching Sessions] Mermaid render error:', err);
            container.innerHTML = `
                <div style="background:#fffbeb;border:1px solid #fef3c7;border-radius:6px;padding:12px;color:#92400e;font-size:13px;width:100%;">
                    <div>⚠️ Visual render issue: ${escapeHtml(err?.message || 'Syntax error')}</div>
                    <pre style="background:#ffffff;border:1px solid #fde68a;padding:8px;border-radius:4px;font-size:11px;margin-top:8px;overflow:auto;">${escapeHtml(mermaidCode)}</pre>
                </div>
            `;
        }
    }

    async function loadStudentSessions(studentId, isPolling = false) {
        if (studentId) currentStudentId = studentId;
        const sid = currentStudentId;
        if (!sid) return;

        const listEl = document.getElementById('teaching-sessions-list');
        const emptyEl = document.getElementById('teaching-sessions-empty');
        const loadingEl = document.getElementById('teaching-sessions-loading');

        if (!listEl) return;

        if (!isPolling && loadingEl) loadingEl.style.display = 'block';
        if (!isPolling && emptyEl) emptyEl.style.display = 'none';

        try {
            const headers = await getAuthHeaders();
            const resp = await fetch(`/api/admin/teaching-sessions?studentId=${encodeURIComponent(sid)}`, {
                headers
            });
            const data = await resp.json();
            const sessions = (data && data.data && data.data.sessions) || [];

            if (loadingEl) loadingEl.style.display = 'none';

            if (!sessions.length) {
                if (emptyEl) emptyEl.style.display = 'block';
                listEl.innerHTML = '';
                stopPolling();
                return;
            }

            if (emptyEl) emptyEl.style.display = 'none';

            let hasProcessing = false;

            listEl.innerHTML = sessions.map((s) => {
                const isProcessing = s.status === 'processing' || s.status === 'uploaded';
                if (isProcessing) hasProcessing = true;

                let statusBadge = '';
                if (s.status === 'analyzed') {
                    statusBadge = `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">✅ Analyzed</span>`;
                } else if (s.status === 'error') {
                    statusBadge = `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">⚠️ Analysis Failed</span>`;
                } else {
                    statusBadge = `<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;animation:spin 1.5s linear infinite;">🔄</span> Analyzing with Gemini AI...</span>`;
                }

                const durationBadge = s.audioDurationSec ? `<span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500;">⏱️ ${formatDuration(s.audioDurationSec)}</span>` : '';
                const skillBadge = s.focusSkill ? `<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500;">🎯 ${escapeHtml(s.focusSkill)}</span>` : '';

                return `
                    <div class="teaching-session-card" data-session-id="${escapeHtml(s.id)}" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;transition:box-shadow 0.2s;">
                        <div style="display:flex;flex-direction:column;gap:4px;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <strong style="font-size:15px;color:#0f172a;">${escapeHtml(s.title || 'Teaching Session')}</strong>
                                ${statusBadge}
                                ${skillBadge}
                                ${durationBadge}
                            </div>
                            <div style="font-size:12px;color:#64748b;">
                                <span>📅 ${formatRelativeDate(s.sessionDate || s.createdAt)}</span>
                                ${s.teacherName ? `<span style="margin-left:12px;">👨‍🏫 ${escapeHtml(s.teacherName)}</span>` : ''}
                            </div>
                            ${s.notes ? `<div style="font-size:12px;color:#475569;margin-top:2px;">${escapeHtml(s.notes)}</div>` : ''}
                            ${s.errorMessage ? `<div style="font-size:11px;color:#dc2626;margin-top:2px;">Error: ${escapeHtml(s.errorMessage)}</div>` : ''}
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            ${s.status === 'analyzed' ? `
                                <button class="crm-btn-primary btn-view-teaching-session" data-session-id="${escapeHtml(s.id)}" type="button" style="padding:6px 12px;font-size:13px;display:flex;align-items:center;gap:4px;">
                                    <span>🧠 View Report & Mindmap</span>
                                </button>
                            ` : (s.status === 'error' || s.status === 'uploaded' ? `
                                <button class="crm-btn-secondary btn-retry-teaching-session" data-session-id="${escapeHtml(s.id)}" type="button" style="padding:6px 12px;font-size:13px;">
                                    <span>🔄 Retry Analysis</span>
                                </button>
                            ` : `
                                <button class="crm-btn-secondary" disabled type="button" style="padding:6px 12px;font-size:13px;opacity:0.7;cursor:wait;">
                                    <span>Processing...</span>
                                </button>
                            `)}
                            <button class="crm-icon-btn btn-delete-teaching-session" data-session-id="${escapeHtml(s.id)}" title="Delete Session" type="button" style="color:#94a3b8;">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            // Attach view listeners
            listEl.querySelectorAll('.btn-view-teaching-session').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const sid = btn.dataset.sessionId;
                    if (sid) openSessionDetail(sid);
                });
            });

            // Attach retry listeners
            listEl.querySelectorAll('.btn-retry-teaching-session').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const sid = btn.dataset.sessionId;
                    if (!sid) return;
                    btn.disabled = true;
                    btn.textContent = 'Starting...';
                    await triggerAnalysis(sid);
                });
            });

            // Attach delete listeners
            listEl.querySelectorAll('.btn-delete-teaching-session').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const sid = btn.dataset.sessionId;
                    if (!sid) return;
                    if (!confirm('Are you sure you want to delete this teaching session and its report?')) return;
                    await deleteSession(sid);
                });
            });

            // If any session is still processing, keep polling every 4s
            if (hasProcessing) {
                startPolling();
            } else {
                stopPolling();
            }

        } catch (err) {
            console.error('[Teaching Sessions] Error loading sessions:', err);
            if (loadingEl) loadingEl.style.display = 'none';
            listEl.innerHTML = `<div style="color:#dc2626;padding:16px;">Failed to load teaching sessions: ${escapeHtml(err.message)}</div>`;
            stopPolling();
        }
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(() => {
            if (currentStudentId) {
                loadStudentSessions(currentStudentId, true);
            } else {
                stopPolling();
            }
        }, 4000);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function triggerAnalysis(sessionId) {
        try {
            const headers = await getAuthHeaders();
            const resp = await fetch(`/api/admin/teaching-sessions/${encodeURIComponent(sessionId)}/analyze`, {
                method: 'POST',
                headers
            });
            const res = await resp.json();
            if (res.success) {
                if (currentStudentId) loadStudentSessions(currentStudentId);
            } else {
                throw new Error(res.error || 'Failed to trigger analysis');
            }
        } catch (err) {
            alert(`Analysis trigger failed: ${err.message}`);
        }
    }

    async function openSessionDetail(sessionId) {
        try {
            const headers = await getAuthHeaders();
            const resp = await fetch(`/api/admin/teaching-sessions/${encodeURIComponent(sessionId)}`, {
                headers
            });
            const json = await resp.json();
            const session = (json && json.data && json.data.session) || null;
            if (!session) throw new Error('Session data not found');

            currentSession = session;

            // Populate header info
            const modalEl = document.getElementById('crm-teaching-session-modal');
            const titleEl = document.getElementById('teaching-session-modal-title');
            const statusEl = document.getElementById('teaching-session-status-badge');
            const reportHtmlEl = document.getElementById('teaching-session-report-html');
            const rawJsonEl = document.getElementById('teaching-session-json-raw');
            const mindmapContainer = document.getElementById('teaching-session-mindmap-container');
            const flowchartContainer = document.getElementById('teaching-session-flowchart-container');
            const audioPlayer = document.getElementById('teaching-session-audio-player');

            if (titleEl) titleEl.textContent = session.title || 'Teaching Session Report';
            if (statusEl) {
                statusEl.textContent = session.status || 'analyzed';
                statusEl.className = `crm-badge ${session.status === 'analyzed' ? 'crm-badge-success' : 'crm-badge-warning'}`;
            }

            // Raw JSON
            if (rawJsonEl) {
                rawJsonEl.textContent = JSON.stringify(session, null, 2);
            }

            // Audio Player
            if (audioPlayer) {
                if (session.audioUrl) {
                    audioPlayer.src = session.audioUrl;
                    audioPlayer.style.display = 'block';
                } else {
                    audioPlayer.removeAttribute('src');
                    audioPlayer.style.display = 'none';
                }
            }

            // Markdown Report HTML
            if (reportHtmlEl) {
                reportHtmlEl.innerHTML = convertMarkdownToHtml(session.markdownReport || (session.report ? JSON.stringify(session.report, null, 2) : ''));
            }

            // Render Mindmap & Flowchart
            switchSessionView('mindmap');
            if (mindmapContainer) {
                renderMermaid(mindmapContainer, session.mermaidMindmap, 'mindmap');
            }
            if (flowchartContainer) {
                renderMermaid(flowchartContainer, session.mermaidFlowchart, 'flowchart');
            }

            // Open modal
            if (modalEl) {
                modalEl.style.display = 'flex';
                modalEl.setAttribute('aria-hidden', 'false');
            }

        } catch (err) {
            console.error('[Teaching Sessions] Error viewing session:', err);
            alert(`Failed to load session details: ${err.message}`);
        }
    }

    function switchSessionView(viewName) {
        document.querySelectorAll('.crm-session-viewer-nav .crm-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });
        document.querySelectorAll('.teaching-session-view-pane').forEach((pane) => {
            pane.style.display = pane.id === `teaching-session-view-${viewName}` ? 'block' : 'none';
        });
    }

    async function deleteSession(sessionId) {
        try {
            const headers = await getAuthHeaders();
            const resp = await fetch(`/api/admin/teaching-sessions/${encodeURIComponent(sessionId)}`, {
                method: 'DELETE',
                headers
            });
            const res = await resp.json();
            if (res.success) {
                if (currentStudentId) loadStudentSessions(currentStudentId);
            } else {
                throw new Error(res.error || 'Failed to delete session');
            }
        } catch (err) {
            console.error('[Teaching Sessions] Delete error:', err);
            alert(`Could not delete session: ${err.message}`);
        }
    }

    async function handleUploadAndAnalyze() {
        const titleInput = document.getElementById('teaching-session-title');
        const skillInput = document.getElementById('teaching-session-skill');
        const dateInput = document.getElementById('teaching-session-date');
        const notesInput = document.getElementById('teaching-session-notes');

        const title = (titleInput && titleInput.value.trim()) || '1-on-1 Teaching Session';
        const focusSkill = (skillInput && skillInput.value) || 'Writing';
        const sessionDate = (dateInput && dateInput.value) || new Date().toISOString();
        const notes = (notesInput && notesInput.value.trim()) || '';
        const file = selectedAudioFile;

        if (!currentStudentId) {
            alert('Please select or save a student first.');
            return;
        }

        if (!file) {
            alert('Please choose or drag & drop an audio recording file (.m4a, .mp3, .wav).');
            return;
        }

        const progressBox = document.getElementById('teaching-session-progress-box');
        const progressBar = document.getElementById('teaching-session-progress-bar');
        const progressLabel = document.getElementById('teaching-session-progress-label');
        const progressPct = document.getElementById('teaching-session-progress-pct');
        const submitBtn = document.getElementById('btn-submit-teaching-upload');

        if (progressBox) progressBox.style.display = 'block';
        if (submitBtn) submitBtn.disabled = true;

        try {
            let audioUrl = null;
            let audioDurationSec = null;

            // 1. If Firebase Storage is available and a file is selected, upload it
            if (file && window.firebase && window.firebase.storage) {
                if (progressLabel) progressLabel.textContent = `Uploading ${file.name} to Cloud Storage...`;
                if (progressBar) progressBar.style.width = '25%';
                if (progressPct) progressPct.textContent = '25%';

                const timestamp = Date.now();
                const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const storageRef = window.firebase.storage().ref(`teachingSessions/${currentStudentId}/${timestamp}_${cleanFileName}`);
                
                // Track upload progress
                const uploadTask = storageRef.put(file);
                await new Promise((resolve, reject) => {
                    uploadTask.on(
                        window.firebase.storage.TaskEvent.STATE_CHANGED,
                        (snapshot) => {
                            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 60) + 25;
                            if (progressBar) progressBar.style.width = `${pct}%`;
                            if (progressPct) progressPct.textContent = `${pct}%`;
                        },
                        (error) => reject(error),
                        async () => {
                            audioUrl = await uploadTask.snapshot.ref.getDownloadURL();
                            resolve();
                        }
                    );
                });
            }

            if (progressLabel) progressLabel.textContent = 'Saving session and launching AI analysis...';
            if (progressBar) progressBar.style.width = '90%';
            if (progressPct) progressPct.textContent = '90%';

            // 2. Create session in Firestore (which triggers background AI analysis)
            const createPayload = {
                studentId: currentStudentId,
                title,
                focusSkill,
                sessionDate,
                notes,
                audioUrl,
                audioDurationSec,
                status: 'processing'
            };

            const headers = await getAuthHeaders();
            const resp = await fetch('/api/admin/teaching-sessions', {
                method: 'POST',
                headers,
                body: JSON.stringify(createPayload)
            });
            const createRes = await resp.json();

            if (!createRes.success) {
                throw new Error(createRes.error || 'Failed to create session');
            }

            if (progressLabel) progressLabel.textContent = 'Upload complete! AI analysis in progress...';
            if (progressBar) progressBar.style.width = '100%';
            if (progressPct) progressPct.textContent = '100%';

            // Reset form
            if (titleInput) titleInput.value = '';
            if (notesInput) notesInput.value = '';
            updateDropzoneDisplay(null);

            const drawer = document.getElementById('teaching-session-upload-drawer');
            if (drawer) drawer.style.display = 'none';

            // Reload list and begin polling
            loadStudentSessions(currentStudentId);
            startPolling();

        } catch (err) {
            console.error('[Teaching Sessions] Upload error:', err);
            alert(`Upload failed: ${err.message}`);
        } finally {
            if (progressBox) progressBox.style.display = 'none';
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    function init() {
        if (isInitialized) return;
        isInitialized = true;

        // Toggle Upload Drawer
        const toggleBtn = document.getElementById('btn-toggle-teaching-upload');
        const drawer = document.getElementById('teaching-session-upload-drawer');
        const cancelBtn = document.getElementById('btn-cancel-teaching-upload');
        const submitBtn = document.getElementById('btn-submit-teaching-upload');

        if (toggleBtn && drawer) {
            toggleBtn.addEventListener('click', () => {
                const isOpen = drawer.style.display === 'block';
                drawer.style.display = isOpen ? 'none' : 'block';
            });
        }
        if (cancelBtn && drawer) {
            cancelBtn.addEventListener('click', () => {
                drawer.style.display = 'none';
                updateDropzoneDisplay(null);
            });
        }
        if (submitBtn) {
            submitBtn.addEventListener('click', handleUploadAndAnalyze);
        }

        // Dropzone & File Input Listeners
        const dropzone = document.getElementById('teaching-session-dropzone');
        const fileInput = document.getElementById('teaching-session-audio-file');
        const clearBtn = document.getElementById('btn-clear-selected-audio');

        if (dropzone && fileInput) {
            // Click to choose
            dropzone.addEventListener('click', (e) => {
                if (e.target === clearBtn || (clearBtn && clearBtn.contains(e.target))) return;
                fileInput.click();
            });

            // File selection change
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) updateDropzoneDisplay(file);
            });

            // Drag and drop events
            ['dragenter', 'dragover'].forEach((eventName) => {
                dropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.style.borderColor = '#3b82f6';
                    dropzone.style.background = '#eff6ff';
                });
            });

            ['dragleave', 'dragend'].forEach((eventName) => {
                dropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!selectedAudioFile) {
                        dropzone.style.borderColor = '#cbd5e1';
                        dropzone.style.background = '#f8fafc';
                    } else {
                        dropzone.style.borderColor = '#10b981';
                        dropzone.style.background = '#f0fdf4';
                    }
                });
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const files = e.dataTransfer && e.dataTransfer.files;
                if (files && files.length > 0) {
                    const file = files[0];
                    updateDropzoneDisplay(file);
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                updateDropzoneDisplay(null);
            });
        }

        // Detail Modal View Tabs
        document.querySelectorAll('.crm-session-viewer-nav .crm-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const viewName = btn.dataset.view;
                if (viewName) switchSessionView(viewName);
            });
        });

        // Detail Modal Close Buttons
        const closeBtn1 = document.getElementById('btn-close-teaching-session-modal');
        const closeBtn2 = document.getElementById('btn-close-teaching-session-bottom');
        const modalEl = document.getElementById('crm-teaching-session-modal');

        const closeModal = () => {
            if (modalEl) {
                modalEl.style.display = 'none';
                modalEl.setAttribute('aria-hidden', 'true');
            }
            const audioPlayer = document.getElementById('teaching-session-audio-player');
            if (audioPlayer) audioPlayer.pause();
        };

        if (closeBtn1) closeBtn1.addEventListener('click', closeModal);
        if (closeBtn2) closeBtn2.addEventListener('click', closeModal);

        // Copy Report Markdown Button
        const copyBtn = document.getElementById('btn-copy-teaching-report');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                if (currentSession && currentSession.markdownReport) {
                    try {
                        await navigator.clipboard.writeText(currentSession.markdownReport);
                        copyBtn.textContent = '✅ Copied!';
                        setTimeout(() => { copyBtn.textContent = 'Copy Report Markdown'; }, 2000);
                    } catch (e) {
                        alert('Could not copy to clipboard');
                    }
                }
            });
        }
    }

    // Auto-init on DOM ready or immediate if ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init,
        loadStudentSessions,
        openSessionDetail,
        deleteSession,
        triggerAnalysis,
        renderMermaid,
        convertMarkdownToHtml
    };
})();
