/* eslint-disable no-console */
window.CrmVoiceCloningWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements = {},
            showToast = (msg, type) => console.log(`[Toast ${type}] ${msg}`),
            apiFetchJson = (url, opts) => fetch(url, opts).then(r => r.json())
        } = deps;

        const state = {
            active: false,
            pollTimer: null,
            workerReady: false,
            currentStyle: 'formal',
            mediaRecorder: null,
            audioChunks: [],
            recordingTimer: null,
            recordingSeconds: 0,
            recordedAudioBlob: null,
            recordedAudioUrl: null,
            uploadedReferenceAudioUrl: null,
            uploadedReferenceAudioBlob: null,
            restoredTestRefUrl: null,
            testAudioUrl: null,
            savedProfiles: []
        };

        // Cache DOM elements
        const dom = {
            workerBadge: document.getElementById('vc-worker-status-badge'),
            btnWorkerRefresh: document.getElementById('btn-vc-worker-refresh'),
            btnQueueTrigger: document.getElementById('btn-vc-queue-trigger'),
            queueCountBadge: document.getElementById('vc-queue-count-badge'),
            workerAdminStatus: document.getElementById('vc-worker-admin-status'),
            
            // Calibration
            btnRecordToggle: document.getElementById('btn-vc-record-toggle'),
            recordIcon: document.getElementById('vc-record-icon'),
            recordLabel: document.getElementById('vc-record-label'),
            audioFileInput: document.getElementById('vc-audio-file-input'),
            recordTimer: document.getElementById('vc-record-timer'),
            refAudioPreview: document.getElementById('vc-ref-audio-preview'),
            btnGenerateTest: document.getElementById('btn-vc-generate-test'),
            testOutputBox: document.getElementById('vc-test-output-box'),
            testAudioPlayer: document.getElementById('vc-test-audio-player'),
            profileNameInput: document.getElementById('vc-profile-name-input'),
            btnSaveProfile: document.getElementById('btn-vc-save-profile'),
            saveProfileStatus: document.getElementById('vc-save-profile-status'),
            savedCount: document.getElementById('vc-saved-count'),
            savedProfilesList: document.getElementById('vc-saved-profiles-list'),
            btnRefreshProfiles: document.getElementById('btn-vc-refresh-profiles'),

            // Studio
            voiceSelect: document.getElementById('vc-studio-voice-select'),
            btnStyleFormal: document.getElementById('btn-vc-style-formal'),
            btnStyleConnected: document.getElementById('btn-vc-style-connected'),
            textInput: document.getElementById('vc-studio-text-input'),
            btnSynthesize: document.getElementById('btn-vc-studio-synthesize'),
            studioStatus: document.getElementById('vc-studio-status'),
            studioOutputBox: document.getElementById('vc-studio-output-box'),
            studioOutputAudio: document.getElementById('vc-studio-output-audio'),
            studioOutputWpm: document.getElementById('vc-studio-output-wpm'),
            btnDownloadMp3: document.getElementById('btn-vc-download-mp3'),
            annotationsContainer: document.getElementById('vc-studio-annotations-container')
        };

        function blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        // --- 1. Worker Status & Queue Operations ---
        async function loadWorkerStatus() {
            if (!dom.workerBadge) return;
            try {
                const res = await apiFetchJson('/api/admin/voice-cloning/status', { method: 'GET' });
                const worker = res?.worker || null;
                state.workerReady = !!(worker && (worker.ready === true || worker.f5ttsReachable === true));

                if (state.workerReady) {
                    dom.workerBadge.className = 'vc-worker-badge online';
                    dom.workerBadge.textContent = 'Voice Worker: Ready (F5-TTS CPU)';
                } else {
                    dom.workerBadge.className = 'vc-worker-badge offline';
                    dom.workerBadge.textContent = 'Voice Worker: Offline';
                }

                const pending = Number(res?.pendingCount || 0);
                if (dom.queueCountBadge) {
                    dom.queueCountBadge.textContent = `${pending} queued · ${Number(res?.processingCount || 0)} processing`;
                }

                if (dom.btnQueueTrigger) {
                    dom.btnQueueTrigger.disabled = !state.workerReady;
                }
            } catch (_err) {
                state.workerReady = false;
                if (dom.btnQueueTrigger) dom.btnQueueTrigger.disabled = true;
                if (dom.workerBadge) {
                    dom.workerBadge.className = 'vc-worker-badge offline';
                    dom.workerBadge.textContent = 'Voice Worker: Status unavailable';
                }
            }
        }

        async function triggerQueueProcessing() {
            if (!state.workerReady) {
                showToast('Local voice worker is offline.', 'error');
                return;
            }
            try {
                if (dom.btnQueueTrigger) dom.btnQueueTrigger.disabled = true;
                if (dom.workerAdminStatus) dom.workerAdminStatus.textContent = 'Triggering local worker…';

                await apiFetchJson('/api/admin/voice-cloning/trigger', { method: 'POST' });
                showToast('Voice cloning queue processing triggered.', 'success');
                if (dom.workerAdminStatus) dom.workerAdminStatus.textContent = 'Worker notified.';
                setTimeout(loadWorkerStatus, 1500);
            } catch (e) {
                showToast('Failed to trigger queue: ' + (e.message || e), 'error');
                if (dom.workerAdminStatus) dom.workerAdminStatus.textContent = 'Trigger failed.';
            } finally {
                if (dom.btnQueueTrigger) dom.btnQueueTrigger.disabled = false;
            }
        }

        // --- 2. Voice Calibration & Recording ---
        async function toggleRecording() {
            if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
                // Stop Recording
                state.mediaRecorder.stop();
                clearInterval(state.recordingTimer);
                if (dom.recordIcon) dom.recordIcon.textContent = '🔴';
                if (dom.recordLabel) dom.recordLabel.textContent = 'Re-record';
                return;
            }

            // Start Recording
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                state.audioChunks = [];
                state.mediaRecorder = new MediaRecorder(stream);

                state.mediaRecorder.ondataavailable = e => {
                    if (e.data.size > 0) state.audioChunks.push(e.data);
                };

                state.mediaRecorder.onstop = () => {
                    state.recordedAudioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
                    state.recordedAudioUrl = URL.createObjectURL(state.recordedAudioBlob);
                    state.uploadedReferenceAudioUrl = null;
                    state.uploadedReferenceAudioBlob = null;
                    
                    if (dom.refAudioPreview) {
                        dom.refAudioPreview.src = state.recordedAudioUrl;
                        dom.refAudioPreview.style.display = 'block';
                    }
                    if (dom.btnGenerateTest) dom.btnGenerateTest.disabled = false;
                    if (dom.btnSaveProfile) dom.btnSaveProfile.disabled = false;
                    
                    // Stop tracks
                    stream.getTracks().forEach(t => t.stop());
                };

                state.mediaRecorder.start();
                state.recordingSeconds = 0;
                if (dom.recordTimer) dom.recordTimer.textContent = '00:00';
                if (dom.recordIcon) dom.recordIcon.textContent = '⏹️';
                if (dom.recordLabel) dom.recordLabel.textContent = 'Stop Recording';

                state.recordingTimer = setInterval(() => {
                    state.recordingSeconds++;
                    const m = String(Math.floor(state.recordingSeconds / 60)).padStart(2, '0');
                    const s = String(state.recordingSeconds % 60).padStart(2, '0');
                    if (dom.recordTimer) dom.recordTimer.textContent = `${m}:${s}`;
                }, 1000);
            } catch (err) {
                showToast('Microphone access denied or unavailable: ' + err.message, 'error');
            }
        }

        function handleFileUpload(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            state.recordedAudioBlob = file;
            state.recordedAudioUrl = URL.createObjectURL(file);
            state.uploadedReferenceAudioUrl = null;
            state.uploadedReferenceAudioBlob = null;

            if (dom.refAudioPreview) {
                dom.refAudioPreview.src = state.recordedAudioUrl;
                dom.refAudioPreview.style.display = 'block';
            }
            if (dom.btnGenerateTest) dom.btnGenerateTest.disabled = false;
            if (dom.btnSaveProfile) dom.btnSaveProfile.disabled = false;
            showToast(`Audio uploaded: ${file.name}`, 'info');
        }

        async function generateTestOutput() {
            if (!state.recordedAudioUrl && !state.recordedAudioBlob) {
                showToast('Please record or upload a reference voice sample first.', 'error');
                return;
            }

            if (dom.btnGenerateTest) {
                dom.btnGenerateTest.disabled = true;
                dom.btnGenerateTest.textContent = '⏳ Preparing Voice Sample…';
            }
            if (dom.testOutputBox) {
                dom.testOutputBox.style.display = 'none';
            }

            try {
                // 1. If user recorded fresh audio and not uploaded yet, upload to cloud
                const needsUpload = state.recordedAudioBlob && (
                    !state.uploadedReferenceAudioUrl || 
                    state.uploadedReferenceAudioBlob !== state.recordedAudioBlob
                );

                if (needsUpload) {
                    if (dom.btnGenerateTest) {
                        dom.btnGenerateTest.textContent = '⏳ Uploading Fresh Voice Sample…';
                    }
                    try {
                        const base64Data = await blobToBase64(state.recordedAudioBlob);
                        const uploadRes = await apiFetchJson('/api/admin/voice-cloning/upload-reference', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                audioBase64: base64Data,
                                mimeType: state.recordedAudioBlob.type || 'audio/webm',
                                fileName: `calib_${Date.now()}.webm`
                            })
                        });
                        if (uploadRes?.audioUrl) {
                            state.uploadedReferenceAudioUrl = uploadRes.audioUrl;
                            state.uploadedReferenceAudioBlob = state.recordedAudioBlob;
                        }
                    } catch (uploadErr) {
                        console.warn('[VoiceCloning] Audio upload fallback:', uploadErr);
                    }
                }

                const referenceAudioUrl = state.uploadedReferenceAudioUrl || state.restoredTestRefUrl || '/audio/voice-cloning/ra_15_reference.webm';

                // 2. Enqueue dynamic test synthesis job for RA #18
                if (dom.btnGenerateTest) {
                    dom.btnGenerateTest.textContent = '⏳ Synthesizing Cloned Voice with F5-TTS…';
                }

                const testRes = await apiFetchJson('/api/admin/voice-cloning/synthesize-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        referenceAudioUrl,
                        referenceTranscript: "The insults and criticisms were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion, turning what began as a niche debate into a nationwide phenomenon.",
                        targetText: "Certain types of methodology are more suitable for some research projects than others. For example, the use of questionnaires and surveys is more suitable for quantitative research."
                    })
                });

                const jobId = testRes?.jobId;
                if (!jobId) {
                    throw new Error('No jobId returned from test synthesis endpoint.');
                }

                // Trigger local queue worker if online
                apiFetchJson('/api/admin/voice-cloning/trigger', { method: 'POST' }).catch(() => {});

                // 3. Poll for completion
                let pollAttempts = 0;
                const pollTestJob = async () => {
                    pollAttempts++;
                    try {
                        const job = await apiFetchJson(`/api/admin/voice-cloning/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
                        if (job?.status === 'completed') {
                            const clonedAudioSrc = job.mp3Url || `/api/admin/voice-cloning/audio/${jobId}`;
                            if (dom.testAudioPlayer) {
                                dom.testAudioPlayer.src = clonedAudioSrc;
                                dom.testAudioPlayer.load();
                                dom.testAudioPlayer.play().catch(() => {});
                            }
                            if (dom.testOutputBox) {
                                dom.testOutputBox.style.display = 'block';
                            }
                            const metricsBadge = document.getElementById('vc-test-metrics-badge');
                            if (metricsBadge) {
                                metricsBadge.textContent = `Ready (${job.durationSeconds || '0'}s • Cloned)`;
                            }
                            if (dom.btnSaveProfile) dom.btnSaveProfile.disabled = false;
                            showToast('Voice cloned successfully! Click play to listen.', 'success');
                            if (dom.btnGenerateTest) {
                                dom.btnGenerateTest.disabled = false;
                                dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                            }
                            return;
                        }

                        if (job?.status === 'failed') {
                            throw new Error(job.error || 'Worker failed to synthesize voice.');
                        }

                        if (pollAttempts < 180) {
                            if (dom.btnGenerateTest) {
                                dom.btnGenerateTest.textContent = `⏳ Neural cloning (${pollAttempts * 2}s)…`;
                            }
                            setTimeout(pollTestJob, 2000);
                        } else {
                            // Timeout notice: notify user honestly without quietly falling back to default sample
                            showToast('Neural cloning is taking longer than expected. Please make sure the local voice worker daemon is running on this computer.', 'warning');
                            if (dom.btnGenerateTest) {
                                dom.btnGenerateTest.disabled = false;
                                dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                            }
                        }
                    } catch (pollErr) {
                        showToast('Error checking clone status: ' + (pollErr.message || pollErr), 'error');
                        if (dom.btnGenerateTest) {
                            dom.btnGenerateTest.disabled = false;
                            dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                        }
                    }
                };

                setTimeout(pollTestJob, 1500);

            } catch (e) {
                showToast('Test synthesis error: ' + (e.message || e), 'error');
                if (dom.btnGenerateTest) {
                    dom.btnGenerateTest.disabled = false;
                    dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                }
            }
        }

        function resumePollingTestJob(jobId) {
            if (!jobId || !dom.btnGenerateTest) return;
            dom.btnGenerateTest.disabled = true;
            dom.btnGenerateTest.textContent = '⏳ Neural cloning in progress…';
            let resumeAttempts = 0;
            const poll = async () => {
                resumeAttempts++;
                try {
                    const job = await apiFetchJson(`/api/admin/voice-cloning/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
                    if (job?.status === 'completed') {
                        const clonedAudioSrc = job.mp3Url || `/api/admin/voice-cloning/audio/${jobId}`;
                        if (dom.testAudioPlayer) {
                            dom.testAudioPlayer.src = clonedAudioSrc;
                            dom.testAudioPlayer.load();
                        }
                        if (dom.testOutputBox) {
                            dom.testOutputBox.style.display = 'block';
                        }
                        const metricsBadge = document.getElementById('vc-test-metrics-badge');
                        if (metricsBadge) {
                            metricsBadge.textContent = `Ready (${job.durationSeconds || '0'}s • Cloned)`;
                        }
                        if (dom.btnSaveProfile) dom.btnSaveProfile.disabled = false;
                        dom.btnGenerateTest.disabled = false;
                        dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                        return;
                    }
                    if (job?.status === 'failed') {
                        dom.btnGenerateTest.disabled = false;
                        dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                        return;
                    }
                    if (resumeAttempts < 180) {
                        dom.btnGenerateTest.textContent = `⏳ Neural cloning (${resumeAttempts * 2}s)…`;
                        setTimeout(poll, 2000);
                    } else {
                        dom.btnGenerateTest.disabled = false;
                        dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                    }
                } catch (_) {
                    dom.btnGenerateTest.disabled = false;
                    dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                }
            };
            setTimeout(poll, 1500);
        }

        async function checkAndRestoreLatestTestJob() {
            try {
                const res = await apiFetchJson('/api/admin/voice-cloning/latest-test', { method: 'GET' });
                const job = res?.job;
                if (!job) return;

                if (job.status === 'completed' && (job.mp3Url || job.id)) {
                    const clonedAudioSrc = job.mp3Url || `/api/admin/voice-cloning/audio/${job.id}`;
                    if (dom.testAudioPlayer && !dom.testAudioPlayer.src) {
                        dom.testAudioPlayer.src = clonedAudioSrc;
                        dom.testAudioPlayer.load();
                    }
                    if (dom.testOutputBox) {
                        dom.testOutputBox.style.display = 'block';
                    }
                    const metricsBadge = document.getElementById('vc-test-metrics-badge');
                    if (metricsBadge) {
                        metricsBadge.textContent = `Ready (${job.durationSeconds || '0'}s • Cloned)`;
                    }
                    if (dom.btnSaveProfile) dom.btnSaveProfile.disabled = false;
                    // Track the reference audio URL of this past test for fallback saving without blocking new recordings
                    if (job.referenceAudioUrl) {
                        state.restoredTestRefUrl = job.referenceAudioUrl;
                    }
                } else if (job.status === 'pending' || job.status === 'processing') {
                    resumePollingTestJob(job.id);
                }
            } catch (err) {
                console.warn('[VoiceCloning] Auto-recovery notice:', err);
            }
        }

        async function saveVoiceProfile() {
            const name = dom.profileNameInput ? dom.profileNameInput.value.trim() : '';
            if (!name || name.length < 2) {
                showToast('Please enter a descriptive name for this voice profile.', 'error');
                if (dom.profileNameInput) dom.profileNameInput.focus();
                return;
            }

            if (dom.btnSaveProfile) dom.btnSaveProfile.disabled = true;
            if (dom.saveProfileStatus) dom.saveProfileStatus.textContent = 'Saving to cloud…';

            try {
                // If user recorded fresh audio and hasn't uploaded yet, upload to cloud storage
                const needsUpload = state.recordedAudioBlob && (
                    !state.uploadedReferenceAudioUrl || 
                    state.uploadedReferenceAudioBlob !== state.recordedAudioBlob
                );

                if (needsUpload) {
                    try {
                        const base64Data = await blobToBase64(state.recordedAudioBlob);
                        const uploadRes = await apiFetchJson('/api/admin/voice-cloning/upload-reference', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                audioBase64: base64Data,
                                mimeType: state.recordedAudioBlob.type || 'audio/webm',
                                fileName: `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.webm`
                            })
                        });
                        if (uploadRes?.audioUrl) {
                            state.uploadedReferenceAudioUrl = uploadRes.audioUrl;
                            state.uploadedReferenceAudioBlob = state.recordedAudioBlob;
                        }
                    } catch (uploadErr) {
                        console.warn('[VoiceCloning] Audio upload fallback:', uploadErr);
                    }
                }

                const audioRef = state.uploadedReferenceAudioUrl || state.restoredTestRefUrl || '/audio/voice-cloning/ra_15_reference.webm';
                const promptText = "The insults and criticisms were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion, turning what began as a niche debate into a nationwide phenomenon.";

                await apiFetchJson('/api/admin/voice-cloning/profiles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        audioUrl: audioRef,
                        transcript: promptText,
                        questionId: 'ra_15'
                    })
                });

                showToast(`Voice profile "${name}" saved to cloud!`, 'success');
                if (dom.saveProfileStatus) dom.saveProfileStatus.textContent = 'Saved successfully!';
                if (dom.profileNameInput) dom.profileNameInput.value = '';

                // Refresh studio profiles list and saved profiles gallery
                await loadVoiceProfiles();
            } catch (err) {
                showToast('Failed to save profile: ' + (err.message || err), 'error');
                if (dom.saveProfileStatus) dom.saveProfileStatus.textContent = 'Save failed.';
            } finally {
                if (dom.btnSaveProfile) dom.btnSaveProfile.disabled = false;
            }
        }

        // --- 3. Multi-Voice Studio & MP3 Synthesis ---
        async function loadVoiceProfiles() {
            try {
                const res = await apiFetchJson('/api/admin/voice-cloning/profiles', { method: 'GET' });
                const profiles = res?.profiles || [];
                state.savedProfiles = profiles;

                // 1. Populate dropdown in Studio
                if (dom.voiceSelect) {
                    dom.voiceSelect.innerHTML = '';
                    if (profiles.length === 0) {
                        const opt = document.createElement('option');
                        opt.value = 'default_cloned_voice';
                        opt.textContent = 'Teacher Nam - Academic Cadence (RA #15)';
                        dom.voiceSelect.appendChild(opt);
                    } else {
                        profiles.forEach(p => {
                            const opt = document.createElement('option');
                            opt.value = p.id;
                            opt.textContent = `${p.name} (${p.questionId ? p.questionId.toUpperCase() : 'RA #15'})`;
                            dom.voiceSelect.appendChild(opt);
                        });
                    }
                }

                // 2. Render Saved Voice Profiles Gallery
                renderSavedProfilesGallery(profiles);
            } catch (e) {
                console.warn('[VoiceCloningWorkspace] Failed to load voice profiles:', e);
            }
        }

        function renderSavedProfilesGallery(profiles) {
            if (dom.savedCount) {
                dom.savedCount.textContent = profiles.length;
            }
            if (!dom.savedProfilesList) return;

            dom.savedProfilesList.innerHTML = '';
            if (!profiles || profiles.length === 0) {
                dom.savedProfilesList.innerHTML = `
                    <div class="vc-empty-gallery" style="grid-column: 1 / -1;">
                        No saved voice profiles yet. Calibrate above to save your first profile.
                    </div>
                `;
                return;
            }

            profiles.forEach(p => {
                const card = document.createElement('div');
                card.className = 'vc-profile-card';
                card.dataset.profileId = p.id;

                const createdDate = p.createdAt ? new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Saved';
                const audioSrc = p.audioUrl || '/audio/voice-cloning/ra_15_reference.webm';

                card.innerHTML = `
                    <div class="vc-profile-header">
                        <div>
                            <div class="vc-profile-title">${escapeHtml(p.name)}</div>
                            <div class="vc-profile-meta">${createdDate}</div>
                        </div>
                        <span class="vc-profile-badge">${p.questionId ? p.questionId.toUpperCase() : 'RA #15'}</span>
                    </div>
                    <audio controls src="${audioSrc}" preload="none"></audio>
                    <div class="vc-profile-actions">
                        <button class="crm-btn crm-btn-secondary crm-btn-sm btn-vc-use-profile" type="button" data-profile-id="${p.id}" style="padding: 4px 10px; font-size: 0.8rem;">
                            🎙️ Use in Studio
                        </button>
                        <button class="crm-btn crm-btn-text crm-btn-sm btn-vc-delete-profile" type="button" data-profile-id="${p.id}" style="color: #ef4444; padding: 4px 8px; font-size: 0.8rem; margin-left: auto;">
                            🗑️ Delete
                        </button>
                    </div>
                `;

                // Handle Use in Studio
                card.querySelector('.btn-vc-use-profile')?.addEventListener('click', () => {
                    if (dom.voiceSelect) {
                        dom.voiceSelect.value = p.id;
                    }
                    dom.textInput?.focus();
                    showToast(`Selected "${p.name}" for synthesis.`, 'info');
                });

                // Handle Delete
                card.querySelector('.btn-vc-delete-profile')?.addEventListener('click', async () => {
                    if (!confirm(`Delete voice profile "${p.name}"?`)) return;
                    try {
                        await apiFetchJson(`/api/admin/voice-cloning/profiles/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
                        showToast(`Voice profile "${p.name}" deleted.`, 'info');
                        await loadVoiceProfiles();
                    } catch (delErr) {
                        showToast('Failed to delete profile: ' + (delErr.message || delErr), 'error');
                    }
                });

                dom.savedProfilesList.appendChild(card);
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        }

        function setSpeechStyle(style) {
            state.currentStyle = style;
            if (dom.btnStyleFormal && dom.btnStyleConnected) {
                if (style === 'formal') {
                    dom.btnStyleFormal.classList.add('is-active');
                    dom.btnStyleConnected.classList.remove('is-active');
                } else {
                    dom.btnStyleConnected.classList.add('is-active');
                    dom.btnStyleFormal.classList.remove('is-active');
                }
            }
        }

        async function synthesizeCustomText() {
            const text = dom.textInput ? dom.textInput.value.trim() : '';
            if (!text || text.length < 3) {
                showToast('Please enter English text to synthesize.', 'error');
                if (dom.textInput) dom.textInput.focus();
                return;
            }

            const voiceId = dom.voiceSelect ? dom.voiceSelect.value : '';
            if (dom.btnSynthesize) dom.btnSynthesize.disabled = true;
            if (dom.studioStatus) dom.studioStatus.textContent = 'Enqueuing synthesis job…';

            const showSynthesisError = (err) => {
                showToast('Synthesis failed: ' + (err.message || err), 'error');
                if (dom.studioStatus) dom.studioStatus.textContent = 'Synthesis error.';
                if (dom.btnSynthesize) dom.btnSynthesize.disabled = false;
            };

            try {
                // 1. Submit job to queue
                const enq = await apiFetchJson('/api/admin/voice-cloning/synthesize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        voiceProfileId: voiceId || 'default_cloned_voice',
                        text,
                        style: state.currentStyle
                    })
                });

                const jobId = enq?.jobId;
                if (!jobId) throw new Error('No jobId returned from server.');

                if (dom.studioStatus) dom.studioStatus.textContent = `Job enqueued (${jobId.slice(0, 12)}…). Awaiting local worker…`;

                // 2. Poll job status
                let attempts = 0;
                const pollJob = async () => {
                    try {
                        attempts++;
                        const job = await apiFetchJson(`/api/admin/voice-cloning/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });

                        if (job.status === 'completed') {
                            renderSynthesizedOutput(job);
                            if (dom.btnSynthesize) dom.btnSynthesize.disabled = false;
                            if (dom.studioStatus) dom.studioStatus.textContent = 'Synthesis complete!';
                            showToast('Audio synthesized and ready for download!', 'success');
                            return;
                        }

                        if (job.status === 'failed') {
                            throw new Error(job.error || 'Worker synthesis failed.');
                        }

                        if (attempts < 60) {
                            setTimeout(pollJob, 2000);
                        } else {
                            throw new Error('Synthesis timed out waiting for worker.');
                        }
                    } catch (err) {
                        // Timer callbacks run after the enclosing request handler returns.
                        showSynthesisError(err);
                    }
                };

                setTimeout(pollJob, 1500);

            } catch (err) {
                showSynthesisError(err);
            }
        }

        function renderSynthesizedOutput(job) {
            if (!dom.studioOutputBox) return;
            dom.studioOutputBox.style.display = 'block';

            const mp3Url = job.mp3Url || '';
            if (dom.studioOutputAudio) {
                dom.studioOutputAudio.src = mp3Url;
            }

            if (dom.btnDownloadMp3) {
                dom.btnDownloadMp3.href = mp3Url;
                const safeName = (job.voiceName || 'cloned_voice').replace(/[^a-z0-9]/gi, '_').toLowerCase();
                dom.btnDownloadMp3.download = `${safeName}_${job.style || 'formal'}.mp3`;
            }

            if (dom.studioOutputWpm) {
                dom.studioOutputWpm.textContent = `${job.wpm || 145} WPM • ${job.durationSeconds || 0}s (${(job.style || 'formal').toUpperCase()})`;
            }

            // Render annotations if connected speech
            if (dom.annotationsContainer) {
                const annots = job.annotations || [];
                if (annots.length > 0) {
                    dom.annotationsContainer.style.display = 'block';
                    dom.annotationsContainer.innerHTML = `
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px;">Applied Connected Speech Features:</div>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${annots.map(a => `<span class="crm-badge" style="background: rgba(14,165,233,0.15); color: #38bdf8; font-size: 0.72rem;">${a.original} → ${a.spoken}</span>`).join('')}
                        </div>
                    `;
                } else {
                    dom.annotationsContainer.style.display = 'none';
                }
            }
        }

        // --- 4. Event Binding & Lifecycle ---
        function bindEvents() {
            dom.btnWorkerRefresh?.addEventListener('click', loadWorkerStatus);
            dom.btnQueueTrigger?.addEventListener('click', triggerQueueProcessing);

            dom.btnRecordToggle?.addEventListener('click', toggleRecording);
            dom.audioFileInput?.addEventListener('change', handleFileUpload);
            dom.btnGenerateTest?.addEventListener('click', generateTestOutput);
            dom.btnSaveProfile?.addEventListener('click', saveVoiceProfile);
            dom.btnRefreshProfiles?.addEventListener('click', loadVoiceProfiles);

            dom.btnStyleFormal?.addEventListener('click', () => setSpeechStyle('formal'));
            dom.btnStyleConnected?.addEventListener('click', () => setSpeechStyle('connected'));
            dom.btnSynthesize?.addEventListener('click', synthesizeCustomText);
        }

        function unbindEvents() {
            dom.btnWorkerRefresh?.removeEventListener('click', loadWorkerStatus);
            dom.btnQueueTrigger?.removeEventListener('click', triggerQueueProcessing);

            dom.btnRecordToggle?.removeEventListener('click', toggleRecording);
            dom.audioFileInput?.removeEventListener('change', handleFileUpload);
            dom.btnGenerateTest?.removeEventListener('click', generateTestOutput);
            dom.btnSaveProfile?.removeEventListener('click', saveVoiceProfile);
            dom.btnRefreshProfiles?.removeEventListener('click', loadVoiceProfiles);

            dom.btnStyleFormal?.removeEventListener('click', () => setSpeechStyle('formal'));
            dom.btnStyleConnected?.removeEventListener('click', () => setSpeechStyle('connected'));
            dom.btnSynthesize?.removeEventListener('click', synthesizeCustomText);
        }

        async function activate() {
            if (!state.active) {
                state.active = true;
                bindEvents();
                await Promise.all([
                    loadWorkerStatus(),
                    loadVoiceProfiles(),
                    checkAndRestoreLatestTestJob()
                ]);
                clearInterval(state.pollTimer);
                state.pollTimer = setInterval(loadWorkerStatus, 10000);
            }
        }

        function dispose() {
            state.active = false;
            clearInterval(state.pollTimer);
            clearInterval(state.recordingTimer);
            unbindEvents();
            if (state.recordedAudioUrl) URL.revokeObjectURL(state.recordedAudioUrl);
        }

        return {
            activate,
            dispose,
            loadWorkerStatus,
            loadVoiceProfiles
        };
    }

    return { createController };
})();
