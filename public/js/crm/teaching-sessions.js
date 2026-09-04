/* eslint-disable no-empty */
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

    function resolveActiveStudentId() {
        if (currentStudentId) return currentStudentId;
        if (window._currentStudentModalId) return String(window._currentStudentModalId).trim();
        
        // Check student badge in modal: <span id="crm-student-id-badge">ID: a0106</span>
        const badge = document.getElementById('crm-student-id-badge');
        if (badge && badge.textContent) {
            const m = badge.textContent.match(/ID:\s*([^\s]+)/i);
            if (m && m[1] && m[1] !== '—') {
                return m[1].trim();
            }
        }

        // Check window location hash: #students/a0106
        const hashMatch = (window.location.hash || '').match(/#students\/([a-zA-Z0-9_-]+)/i);
        if (hashMatch && hashMatch[1]) {
            return hashMatch[1].trim();
        }

        return null;
    }

    function setStudentId(id) {
        currentStudentId = id ? String(id).trim() : null;
    }

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
            let user = window.firebase?.auth?.().currentUser;
            if (!user && window.__FIREBASE_INTERNAL__?.auth?.currentUser) {
                user = window.__FIREBASE_INTERNAL__.auth.currentUser;
            }
            if (user) {
                let token = null;
                if (typeof user.getIdToken === 'function') {
                    token = await user.getIdToken(true);
                } else {
                    try {
                        const { getIdToken } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
                        token = await getIdToken(user, true);
                    } catch (_) {}
                }
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

    function classifySeverity(str) {
        if (!str) return 'minor';
        const s = String(str).toLowerCase();
        if (s.includes('critical') || s.includes('nghiêm trọng') || s.includes('🔴') || s.includes('high') || s.includes('p1')) return 'critical';
        if (s.includes('warning') || s.includes('trung bình') || s.includes('🟡') || s.includes('medium') || s.includes('p2') || s.includes('p3')) return 'warning';
        return 'minor';
    }

    function classifyOutcome(str) {
        if (!str) return 'practice';
        const s = String(str).toLowerCase();
        if (s.includes('mastered') || s.includes('nắm vững') || s.includes('thành thạo')) return 'mastered';
        if (s.includes('partial') || s.includes('một phần') || s.includes('tiến bộ')) return 'partial';
        return 'practice';
    }

    function stripLeadingEmoji(str) {
        if (!str) return '';
        return String(str).replace(/^[\p{Extended_Pictographic}\uFE0F\s\-:]+/u, '').trim();
    }

    function normalizeReport(session) {
        if (!session) return null;
        let rep = session.report;
        if (typeof rep === 'string') {
            try {
                rep = JSON.parse(rep);
            } catch (_) {
                rep = null;
            }
        }
        if (!rep || typeof rep !== 'object') return null;

        const summary = rep.summary || {};
        let whatTaught = rep.what_taught || rep.whatTaught || [];
        let problems = rep.student_problems_and_solutions || rep.studentProblemsAndSolutions || [];
        const nextBriefing = rep.next_lesson_briefing || rep.nextLessonBriefing || {};

        // Legacy schema shim (from Python CLI logger where problems and solutions were separate arrays)
        if ((!Array.isArray(problems) || problems.length === 0) && Array.isArray(rep.student_problems)) {
            const solutionsMap = {};
            (rep.teacher_solutions || []).forEach((sol) => {
                const pid = sol.targeted_problem_id || sol.problem_id;
                if (pid) solutionsMap[pid] = sol;
            });
            const responseMap = {};
            (rep.student_response || []).forEach((res) => {
                const pid = res.targeted_problem_id || res.problem_id;
                if (pid) responseMap[pid] = res;
            });

            problems = rep.student_problems.map((prob) => {
                const pid = prob.problem_id;
                const sol = solutionsMap[pid] || {};
                const resp = responseMap[pid] || {};
                return {
                    issue_summary: prob.issue_summary || prob.issue || '',
                    student_error_quote: prob.student_error_quote || prob.quote || '',
                    teacher_solution: sol.explanation_or_rule || sol.solution || '',
                    severity: prob.severity || 'Medium',
                    student_outcome: resp.final_verdict_or_score || resp.verdict || 'Needs Practice',
                    outcome_evidence: resp.evidence_quote || ''
                };
            });
        }

        const hasSummary = Boolean(summary.core_topic || summary.quick_recap_60s);
        const hasContent = (Array.isArray(whatTaught) && whatTaught.length > 0) || (Array.isArray(problems) && problems.length > 0);
        if (!hasSummary && !hasContent) return null;

        return {
            summary: {
                core_topic: summary.core_topic || session.title || 'Teaching Session',
                quick_recap_60s: summary.quick_recap_60s || '',
                student_readiness_level: summary.student_readiness_level || 'Good'
            },
            whatTaught: Array.isArray(whatTaught) ? whatTaught : [],
            problems: Array.isArray(problems) ? problems : [],
            nextBriefing: {
                warmup_tasks: Array.isArray(nextBriefing.warmup_tasks) ? nextBriefing.warmup_tasks : [],
                followup_error_focus: Array.isArray(nextBriefing.followup_error_focus) ? nextBriefing.followup_error_focus : [],
                recommended_homework: Array.isArray(nextBriefing.recommended_homework) ? nextBriefing.recommended_homework : []
            }
        };
    }

    function renderBriefing(session) {
        const norm = normalizeReport(session);
        if (!norm) {
            // Graceful fallback to legacy markdown parser
            return `<div class="teaching-session-markdown-content">${convertMarkdownToHtml(session.markdownReport || '')}</div>`;
        }

        const { summary, whatTaught, problems, nextBriefing } = norm;
        const readinessClean = stripLeadingEmoji(summary.student_readiness_level);
        const readinessClass = readinessClean.toLowerCase().includes('good') || readinessClean.toLowerCase().includes('khá') || readinessClean.toLowerCase().includes('tốt')
            ? 'readiness-good'
            : (readinessClean.toLowerCase().includes('weak') || readinessClean.toLowerCase().includes('yếu') ? 'readiness-warning' : '');

        let html = `
            <div class="crm-briefing-header">
                <h1 class="crm-briefing-topic">${escapeHtml(summary.core_topic)}</h1>
                <div class="crm-briefing-meta-row">
                    <div class="crm-briefing-meta-items">
                        ${session.focusSkill ? `<span class="crm-category-chip">${escapeHtml(session.focusSkill)}</span>` : ''}
                        <span>${formatRelativeDate(session.sessionDate || session.createdAt)}</span>
                        ${session.audioDurationSec ? `<span>· ${formatDuration(session.audioDurationSec)}</span>` : ''}
                        ${session.teacherName ? `<span>· ${escapeHtml(session.teacherName)}</span>` : ''}
                    </div>
                    ${readinessClean ? `
                        <div class="crm-briefing-readiness-chip ${readinessClass}">
                            <span>Readiness:</span> <strong>${escapeHtml(readinessClean)}</strong>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // 1. 60-Second Lead Recap
        if (summary.quick_recap_60s) {
            html += `
                <div class="crm-briefing-recap-box">
                    <p>${escapeHtml(summary.quick_recap_60s)}</p>
                </div>
            `;
        }

        // 2. What Was Taught (Đã giảng dạy) - Definition List
        if (whatTaught.length > 0) {
            html += `
                <section class="crm-briefing-section">
                    <div class="crm-briefing-section-heading">
                        <span>Đã giảng dạy</span>
                        <span class="crm-briefing-heading-count">${whatTaught.length} chủ điểm</span>
                    </div>
                    <div class="crm-knowledge-list">
            `;
            whatTaught.forEach((item) => {
                const cat = stripLeadingEmoji(item.category || 'Core');
                const topic = stripLeadingEmoji(item.topic || '');
                const rule = item.key_rule || '';
                const examples = Array.isArray(item.examples) ? item.examples : (item.examples ? [item.examples] : []);

                html += `
                    <div class="crm-knowledge-item">
                        <div class="crm-knowledge-header">
                            ${cat ? `<span class="crm-category-chip">${escapeHtml(cat)}</span>` : ''}
                            <strong class="crm-knowledge-topic">${escapeHtml(topic)}</strong>
                        </div>
                        ${rule ? `<p class="crm-knowledge-rule">${escapeHtml(rule)}</p>` : ''}
                        ${examples.length > 0 ? `
                            <div class="crm-knowledge-examples">
                                ${examples.map(ex => `<span class="crm-example-chip">${escapeHtml(ex)}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                `;
            });
            html += `
                    </div>
                </section>
            `;
        }

        // 3. Problems and Solutions (Lỗi & Cách sửa)
        if (problems.length > 0) {
            const practiceCount = problems.filter(p => classifyOutcome(p.student_outcome) !== 'mastered').length;
            const countLabel = practiceCount > 0 
                ? `${problems.length} lỗi · ${practiceCount} cần củng cố`
                : `${problems.length} lỗi đã xử lý`;

            html += `
                <section class="crm-briefing-section">
                    <div class="crm-briefing-section-heading">
                        <span>Lỗi & cách sửa</span>
                        <span class="crm-briefing-heading-count">${countLabel}</span>
                    </div>
                    <div class="crm-problems-list">
            `;

            problems.forEach((prob) => {
                const sev = classifySeverity(prob.severity);
                const out = classifyOutcome(prob.student_outcome);
                const issue = stripLeadingEmoji(prob.issue_summary || 'Phát hiện lỗi');
                const outcomeLabel = stripLeadingEmoji(prob.student_outcome || (out === 'mastered' ? 'Đã nắm vững' : 'Cần củng cố'));

                html += `
                    <div class="crm-problem-row">
                        <div class="crm-problem-header">
                            <div class="crm-problem-title-wrap">
                                <span class="crm-severity-dot severity-${sev}" title="Mức độ: ${sev}"></span>
                                <strong class="crm-problem-title">${escapeHtml(issue)}</strong>
                            </div>
                            <span class="crm-outcome-chip outcome-${out}">${escapeHtml(outcomeLabel)}</span>
                        </div>
                        ${prob.student_error_quote ? `
                            <blockquote class="crm-problem-quote">"${escapeHtml(prob.student_error_quote)}"</blockquote>
                        ` : ''}
                        ${prob.teacher_solution ? `
                            <p class="crm-problem-solution"><strong>Giải pháp:</strong> ${escapeHtml(prob.teacher_solution)}</p>
                        ` : ''}
                        ${prob.outcome_evidence ? `
                            <p class="crm-problem-evidence">${escapeHtml(prob.outcome_evidence)}</p>
                        ` : ''}
                    </div>
                `;
            });

            html += `
                    </div>
                </section>
            `;
        }

        // 4. Next Lesson Plan (Buổi học tiếp theo)
        const warmups = nextBriefing.warmup_tasks || [];
        const followups = nextBriefing.followup_error_focus || [];
        const homework = nextBriefing.recommended_homework || [];

        if (warmups.length > 0 || followups.length > 0 || homework.length > 0) {
            html += `
                <section class="crm-briefing-section">
                    <div class="crm-briefing-section-heading">
                        <span>Buổi học tiếp theo</span>
                    </div>
            `;

            if (warmups.length > 0) {
                html += `
                    <div class="crm-next-plan-block">
                        <h4 class="crm-next-plan-subtitle">Warmup đầu giờ</h4>
                        <ol style="margin: 0; padding-left: 20px; font-size: 14px; color: var(--crm-text-main);">
                            ${warmups.map(w => `<li style="margin-bottom: 4px;">${escapeHtml(w)}</li>`).join('')}
                        </ol>
                    </div>
                `;
            }

            if (followups.length > 0) {
                html += `
                    <div class="crm-next-plan-block">
                        <h4 class="crm-next-plan-subtitle">Trọng tâm theo dõi</h4>
                        <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: var(--crm-text-main);">
                            ${followups.map(f => `<li style="margin-bottom: 4px;">${escapeHtml(f)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            if (homework.length > 0) {
                html += `
                    <div class="crm-next-plan-block">
                        <h4 class="crm-next-plan-subtitle">Bài tập về nhà</h4>
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            ${homework.map(h => `
                                <div class="crm-checklist-item">
                                    <span class="crm-checklist-box">☐</span>
                                    <span>${escapeHtml(h)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            html += `</section>`;
        }

        return html;
    }

    let isMermaidInitialized = false;
    function ensureMermaidInitialized() {
        if (!window.mermaid || isMermaidInitialized) return;
        try {
            window.mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                securityLevel: 'loose',
                mindmap: { useMaxWidth: true }
            });
            isMermaidInitialized = true;
        } catch (e) {
            console.warn('[Teaching Sessions] Mermaid init warning:', e);
        }
    }

    async function renderMermaid(container, mermaidCode, diagramType) {
        if (!container) return;
        if (!mermaidCode || !mermaidCode.trim()) {
            container.innerHTML = `<div style="text-align:center;color:var(--crm-text-muted);padding:32px;">No ${diagramType || 'diagram'} available for this session.</div>`;
            return;
        }

        if (!window.mermaid) {
            container.innerHTML = `<pre style="background:var(--crm-surface-dim);padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${escapeHtml(mermaidCode)}</pre>`;
            return;
        }

        ensureMermaidInitialized();

        try {
            const uniqueId = `mermaid-${diagramType || 'diag'}-${Date.now()}`;
            const { svg } = await window.mermaid.render(uniqueId, mermaidCode);
            container.innerHTML = `<div class="diagram-transform-wrapper">${svg}</div>`;
            const stageEl = container.closest('.crm-diagram-stage');
            if (stageEl) {
                attachDiagramPanZoom(stageEl);
            }
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

    function attachDiagramPanZoom(stageEl) {
        if (!stageEl) return;
        if (typeof stageEl._panZoomCleanup === 'function') {
            stageEl._panZoomCleanup();
            stageEl._panZoomCleanup = null;
        }

        const container = stageEl.querySelector('.mermaid-diagram-container');
        const svg = container ? container.querySelector('svg') : null;
        if (!container || !svg) return;

        let wrapper = container.querySelector('.diagram-transform-wrapper');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'diagram-transform-wrapper';
            wrapper.appendChild(svg);
            container.appendChild(wrapper);
        }

        let scale = 1.0;
        let translateX = 0;
        let translateY = 0;
        let isDragging = false;
        let startX = 0;
        let startY = 0;

        const zoomResetBtn = stageEl.querySelector('.btn-diagram-zoom-reset');
        const zoomInBtn = stageEl.querySelector('.btn-diagram-zoom-in');
        const zoomOutBtn = stageEl.querySelector('.btn-diagram-zoom-out');
        const downloadBtn = stageEl.querySelector('.btn-diagram-download-svg');

        function updateTransform() {
            wrapper.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            if (zoomResetBtn) {
                zoomResetBtn.textContent = `${Math.round(scale * 100)}%`;
            }
        }

        function fitToView() {
            const stageRect = stageEl.getBoundingClientRect();
            const bbox = (typeof svg.getBBox === 'function') ? svg.getBBox() : { width: svg.clientWidth || 800, height: svg.clientHeight || 500 };
            if (bbox.width > 0 && bbox.height > 0 && stageRect.width > 0 && stageRect.height > 0) {
                const availW = stageRect.width - 60;
                const availH = stageRect.height - 60;
                const scaleW = availW / bbox.width;
                const scaleH = availH / bbox.height;
                scale = Math.min(Math.max(Math.min(scaleW, scaleH), 0.35), 1.5);
            } else {
                scale = 1.0;
            }
            translateX = 0;
            translateY = 0;
            updateTransform();
        }

        const onZoomIn = () => {
            scale = Math.min(scale * 1.25, 4.0);
            updateTransform();
        };

        const onZoomOut = () => {
            scale = Math.max(scale / 1.25, 0.3);
            updateTransform();
        };

        const onReset = () => {
            if (scale === 1.0 && translateX === 0 && translateY === 0) {
                fitToView();
            } else {
                scale = 1.0;
                translateX = 0;
                translateY = 0;
                updateTransform();
            }
        };

        const onDownload = () => {
            downloadDiagramSvg(stageEl);
        };

        const onWheel = (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    scale = Math.min(scale * 1.15, 4.0);
                } else {
                    scale = Math.max(scale / 1.15, 0.3);
                }
                updateTransform();
            }
        };

        const onPointerDown = (e) => {
            if (e.target.closest('.crm-diagram-toolbar')) return;
            isDragging = true;
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
            container.classList.add('is-dragging');
            if (container.setPointerCapture && e.pointerId) {
                try { container.setPointerCapture(e.pointerId); } catch (_) {}
            }
        };

        const onPointerMove = (e) => {
            if (!isDragging) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateTransform();
        };

        const onPointerUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            container.classList.remove('is-dragging');
            if (container.releasePointerCapture && e.pointerId) {
                try { container.releasePointerCapture(e.pointerId); } catch (_) {}
            }
        };

        zoomInBtn?.addEventListener('click', onZoomIn);
        zoomOutBtn?.addEventListener('click', onZoomOut);
        zoomResetBtn?.addEventListener('click', onReset);
        downloadBtn?.addEventListener('click', onDownload);
        container.addEventListener('wheel', onWheel, { passive: false });
        container.addEventListener('pointerdown', onPointerDown);
        container.addEventListener('pointermove', onPointerMove);
        container.addEventListener('pointerup', onPointerUp);
        container.addEventListener('pointercancel', onPointerUp);

        // Initial fit
        fitToView();

        stageEl._panZoomCleanup = () => {
            zoomInBtn?.removeEventListener('click', onZoomIn);
            zoomOutBtn?.removeEventListener('click', onZoomOut);
            zoomResetBtn?.removeEventListener('click', onReset);
            downloadBtn?.removeEventListener('click', onDownload);
            container.removeEventListener('wheel', onWheel);
            container.removeEventListener('pointerdown', onPointerDown);
            container.removeEventListener('pointermove', onPointerMove);
            container.removeEventListener('pointerup', onPointerUp);
            container.removeEventListener('pointercancel', onPointerUp);
        };
    }

    function downloadDiagramSvg(stageEl, filename) {
        if (!stageEl) return;
        const svg = stageEl.querySelector('svg');
        if (!svg) {
            alert('No diagram found to export.');
            return;
        }
        try {
            const serializer = new XMLSerializer();
            let source = serializer.serializeToString(svg);
            if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
                source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            if (!source.match(/^<svg[^>]+"http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
                source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
            }

            const title = (currentSession && currentSession.title) ? currentSession.title.toLowerCase().replace(/[^a-z0-9_-]/gi, '_') : 'teaching_session';
            const pane = stageEl.closest('.teaching-session-view-pane');
            const viewType = pane && pane.id.includes('flowchart') ? 'flowchart' : 'mindmap';
            const name = filename || `${title}_${viewType}.svg`;

            const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[Teaching Sessions] Export diagram SVG error:', err);
            alert('Could not export SVG diagram: ' + err.message);
        }
    }

    async function loadStudentSessions(studentId, isPolling = false) {
        if (studentId) {
            currentStudentId = String(studentId).trim();
        } else if (!currentStudentId) {
            currentStudentId = resolveActiveStudentId();
        }
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
            const sessions = (data && (data.sessions || (data.data && data.data.sessions))) || [];

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

    function toggleFullscreen(forceState) {
        const modalEl = document.getElementById('crm-teaching-session-modal');
        if (!modalEl) return;
        const isFs = typeof forceState === 'boolean'
            ? forceState
            : !modalEl.classList.contains('is-fullscreen');

        modalEl.classList.toggle('is-fullscreen', isFs);
        try {
            localStorage.setItem('crm.teachingSession.fullscreen', isFs ? 'true' : 'false');
        } catch (_) {}

        // Update breadcrumb
        const breadcrumbEl = document.getElementById('teaching-session-breadcrumb');
        if (breadcrumbEl && currentSession) {
            const badge = document.getElementById('crm-student-id-badge');
            const studentBadgeText = badge ? badge.textContent.trim() : (currentStudentId || 'Student');
            breadcrumbEl.textContent = `CRM › Students › ${studentBadgeText.replace(/^ID:\s*/i, '')} › Sessions › ${currentSession.title || 'Session'}`;
        }

        // Refit active diagram if visible
        const activeStage = modalEl.querySelector('.teaching-session-view-pane:not([style*="display: none"]) .crm-diagram-stage');
        if (activeStage) {
            attachDiagramPanZoom(activeStage);
        }
    }

    async function openSessionDetail(sessionId) {
        try {
            const headers = await getAuthHeaders();
            const resp = await fetch(`/api/admin/teaching-sessions/${encodeURIComponent(sessionId)}`, {
                headers
            });
            const json = await resp.json();
            const session = (json && (json.session || (json.data && json.data.session))) || null;
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
            const breadcrumbEl = document.getElementById('teaching-session-breadcrumb');

            if (titleEl) titleEl.textContent = session.title || 'Teaching Session';
            if (statusEl) {
                const rawStatus = session.status || 'analyzed';
                statusEl.textContent = stripLeadingEmoji(rawStatus);
                statusEl.className = `crm-session-status-badge status-${rawStatus.toLowerCase()}`;
            }

            // Breadcrumb
            if (breadcrumbEl) {
                const badge = document.getElementById('crm-student-id-badge');
                const studentBadgeText = badge ? badge.textContent.trim() : (currentStudentId || 'Student');
                breadcrumbEl.textContent = `CRM › Students › ${studentBadgeText.replace(/^ID:\s*/i, '')} › Sessions › ${session.title || 'Session'}`;
            }

            // Raw JSON
            if (rawJsonEl) {
                rawJsonEl.textContent = JSON.stringify(session, null, 2);
            }

            // Audio Player & Tab Visibility
            const audioTab = document.getElementById('tab-teaching-session-audio');
            if (audioPlayer) {
                if (session.audioUrl) {
                    audioPlayer.src = session.audioUrl;
                    if (audioTab) audioTab.style.display = 'inline-block';
                    const audioMeta = document.getElementById('teaching-session-audio-meta');
                    if (audioMeta) {
                        audioMeta.textContent = session.audioDurationSec 
                            ? `Recording duration: ${formatDuration(session.audioDurationSec)}`
                            : 'Full recording playback';
                    }
                } else {
                    audioPlayer.removeAttribute('src');
                    if (audioTab) audioTab.style.display = 'none';
                }
            }

            // Structured Briefing HTML (Default)
            if (reportHtmlEl) {
                reportHtmlEl.innerHTML = renderBriefing(session);
            }

            // Set default view to 'report' (Briefing)
            switchSessionView('report');

            // Open modal
            if (modalEl) {
                modalEl.style.display = 'flex';
                modalEl.setAttribute('aria-hidden', 'false');
            }

            // Check saved fullscreen preference
            try {
                const savedFs = localStorage.getItem('crm.teachingSession.fullscreen');
                if (savedFs === 'true') {
                    toggleFullscreen(true);
                } else {
                    toggleFullscreen(false);
                }
            } catch (_) {}

            // Render Mindmap & Flowchart
            if (mindmapContainer && session.mermaidMindmap) {
                await renderMermaid(mindmapContainer, session.mermaidMindmap, 'mindmap');
            }
            if (flowchartContainer && session.mermaidFlowchart) {
                await renderMermaid(flowchartContainer, session.mermaidFlowchart, 'flowchart');
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

        // If switching to a diagram, fit/refit pan-zoom
        if (viewName === 'mindmap' || viewName === 'flowchart') {
            const activePane = document.getElementById(`teaching-session-view-${viewName}`);
            const stage = activePane ? activePane.querySelector('.crm-diagram-stage') : null;
            if (stage) {
                attachDiagramPanZoom(stage);
            }
        }
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

        const activeStudentId = currentStudentId || resolveActiveStudentId();
        if (!activeStudentId) {
            alert('Please select or save a student first.');
            return;
        }
        currentStudentId = activeStudentId;

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
                throw new Error(createRes.message || createRes.error || 'Failed to create session');
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

        // Fullscreen Mode Toggle Button
        const fsBtn = document.getElementById('btn-teaching-session-fullscreen');
        if (fsBtn) {
            fsBtn.addEventListener('click', () => {
                toggleFullscreen();
            });
        }

        // Two-Stage Escape Key Handling: 1st exits fullscreen, 2nd closes modal
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const modalEl = document.getElementById('crm-teaching-session-modal');
            if (!modalEl || modalEl.style.display === 'none') return;

            if (modalEl.classList.contains('is-fullscreen')) {
                e.stopPropagation();
                toggleFullscreen(false);
            } else {
                closeModal();
            }
        });
    }

    // Auto-init on DOM ready or immediate if ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init,
        setStudentId,
        resolveActiveStudentId,
        loadStudentSessions,
        openSessionDetail,
        deleteSession,
        triggerAnalysis,
        renderMermaid,
        convertMarkdownToHtml,
        normalizeReport,
        renderBriefing,
        toggleFullscreen
    };
})();
