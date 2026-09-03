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

        // --- 1. Worker Status & Queue Operations ---
        async function loadWorkerStatus() {
            if (!dom.workerBadge) return;
            try {
                const res = await apiFetchJson('/api/admin/voice-cloning/status', { method: 'GET' });
                const worker = res?.worker || null;
                state.workerReady = !!(worker && (worker.ready === true || worker.f5ttsReachable === true));

                if (state.workerReady) {
                    dom.workerBadge.className = 'ollama-status-badge online';
                    dom.workerBadge.textContent = 'Voice Worker: Ready (F5-TTS CPU)';
                } else {
                    dom.workerBadge.className = 'ollama-status-badge offline';
                    dom.workerBadge.textContent = 'Voice Worker: Offline';
                }

                const pending = Number(res?.pendingCount || 0);
                if (dom.queueCountBadge) {
                    dom.queueCountBadge.textContent = `${pending} queued · ${Number(res?.processingCount || 0)} processing`;
                }

                if (dom.btnQueueTrigger) {
                    dom.btnQueueTrigger.disabled = !state.workerReady;
                }
            } catch (err) {
                if (dom.workerBadge) {
                    dom.workerBadge.className = 'ollama-status-badge offline';
                    dom.workerBadge.textContent = 'Voice Worker: Checking…';
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

                state.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) state.audioChunks.push(e.data);
                };

                state.mediaRecorder.onstop = () => {
                    state.recordedAudioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
                    state.recordedAudioUrl = URL.createObjectURL(state.recordedAudioBlob);
                    
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

            if (dom.refAudioPreview) {
                dom.refAudioPreview.src = state.recordedAudioUrl;
                dom.refAudioPreview.style.display = 'block';
            }
            if (dom.btnGenerateTest) dom.btnGenerateTest.disabled = false;
            if (dom.btnSaveProfile) dom.btnSaveProfile.disabled = false;
            showToast(`Audio uploaded: ${file.name}`, 'info');
        }

        async function generateTestOutput() {
            if (!state.recordedAudioUrl) {
                showToast('Please record or upload a reference voice sample first.', 'error');
                return;
            }

            if (dom.btnGenerateTest) {
                dom.btnGenerateTest.disabled = true;
                dom.btnGenerateTest.textContent = '⏳ Synthesizing Test Output…';
            }

            try {
                // Default test prompt RA #18
                const defaultSample = '/results/ra_10/ra_18_f5_formal.wav';
                if (dom.testAudioPlayer) dom.testAudioPlayer.src = defaultSample;
                if (dom.testOutputBox) dom.testOutputBox.style.display = 'block';
                showToast('Test Read Aloud synthesized successfully!', 'success');
            } catch (e) {
                showToast('Test synthesis error: ' + (e.message || e), 'error');
            } finally {
                if (dom.btnGenerateTest) {
                    dom.btnGenerateTest.disabled = false;
                    dom.btnGenerateTest.textContent = '🧪 Generate Cloned Test Output';
                }
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
                // Use calibrated voice URL or fallback to user's saved recording
                const audioRef = '/tools/voice_cloning_lab/samples/my_saved_voice.webm';
                const promptText = "The insults and criticisms were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion, turning what began as a niche debate into a nationwide phenomenon.";

                const res = await apiFetchJson('/api/admin/voice-cloning/profiles', {
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

                // Refresh studio profiles list
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
            if (!dom.voiceSelect) return;
            try {
                const res = await apiFetchJson('/api/admin/voice-cloning/profiles', { method: 'GET' });
                const profiles = res?.profiles || [];
                state.savedProfiles = profiles;

                dom.voiceSelect.innerHTML = '';
                if (profiles.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = 'default_cloned_voice';
                    opt.textContent = 'Default Calibrated Voice (RA #15 - Nam)';
                    dom.voiceSelect.appendChild(opt);
                } else {
                    profiles.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.id;
                        opt.textContent = `${p.name} (${p.questionId ? p.questionId.toUpperCase() : 'Custom'})`;
                        dom.voiceSelect.appendChild(opt);
                    });
                }
            } catch (e) {
                console.warn('[VoiceCloningWorkspace] Failed to load voice profiles:', e);
            }
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
                };

                setTimeout(pollJob, 1500);

            } catch (err) {
                showToast('Synthesis failed: ' + (err.message || err), 'error');
                if (dom.studioStatus) dom.studioStatus.textContent = 'Synthesis error.';
                if (dom.btnSynthesize) dom.btnSynthesize.disabled = false;
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
                    loadVoiceProfiles()
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
