const express = require('express');
const crypto = require('crypto');

function now() { return new Date(); }

function timestampMillis(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    if (value && Number.isFinite(Number(value._seconds))) return Number(value._seconds) * 1000;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function isVoiceWorkerReady(worker, currentTime = now()) {
    if (!worker) return false;
    const ageMs = currentTime.getTime() - timestampMillis(worker.lastHeartbeatAt);
    return worker.state !== 'stopping'
        && ageMs >= 0
        && ageMs <= 45_000
        && (worker.f5ttsReachable === true || worker.ready === true);
}

function serializeVoiceWorkerStatus(snapshot, currentTime = now()) {
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    const heartbeatMs = timestampMillis(data.lastHeartbeatAt);
    return {
        ...data,
        lastHeartbeatAt: heartbeatMs ? new Date(heartbeatMs).toISOString() : null,
        ready: isVoiceWorkerReady(data, currentTime)
    };
}

function createVoiceCloningAdminRouter({ db, authMiddleware, adminMiddleware, sendSuccess, sendError, getStorageBucket }) {
    const router = express.Router();

    // 1. Worker Status & Queue Count
    router.get('/status', authMiddleware, adminMiddleware, async (_req, res) => {
        try {
            const [workerSnap, controlSnap, pendingSnap, processingSnap] = await Promise.all([
                db.collection('voice_worker_status').doc('current').get(),
                db.collection('voice_cloning_control').doc('current').get(),
                db.collection('voice_cloning_queue').where('status', '==', 'pending').limit(200).get(),
                db.collection('voice_cloning_queue').where('status', '==', 'processing').limit(200).get()
            ]);

            return sendSuccess(res, {
                worker: serializeVoiceWorkerStatus(workerSnap),
                control: controlSnap.exists ? controlSnap.data() : null,
                pendingCount: pendingSnap.size,
                processingCount: processingSnap.size
            });
        } catch (error) {
            return sendError(res, 500, 'VOICE_WORKER_STATUS_ERROR', 'Failed to load voice worker status.', error?.message || error);
        }
    });

    // 2. Manual Trigger Processing of Pending Jobs
    router.post('/trigger', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const uid = req.user?.uid || 'admin';
            const controlRef = db.collection('voice_cloning_control').doc('current');
            await controlRef.set({
                triggerRequestedAt: now(),
                requestedBy: uid,
                state: 'trigger_requested'
            }, { merge: true });

            return sendSuccess(res, {
                message: 'Voice cloning queue processing triggered.',
                triggeredAt: now().toISOString()
            });
        } catch (error) {
            return sendError(res, 500, 'VOICE_TRIGGER_ERROR', 'Failed to trigger voice queue processing.', error?.message || error);
        }
    });

    // 3. List Saved Voice Profiles
    router.get('/profiles', authMiddleware, adminMiddleware, async (_req, res) => {
        try {
            const snapshot = await db.collection('voice_profiles')
                .orderBy('createdAt', 'desc')
                .limit(100)
                .get();

            const profiles = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    createdAt: data.createdAt ? new Date(timestampMillis(data.createdAt)).toISOString() : null
                };
            });

            if (profiles.length === 0) {
                profiles.push({
                    id: 'voice_nam_ra15',
                    name: 'Teacher Nam - Academic Cadence',
                    audioUrl: '/audio/voice-cloning/ra_15_reference.webm',
                    transcript: "The insults and criticisms were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion, turning what began as a niche debate into a nationwide phenomenon.",
                    questionId: 'ra_15',
                    createdAt: new Date().toISOString()
                });
            }

            return sendSuccess(res, { profiles });
        } catch (error) {
            return sendError(res, 500, 'VOICE_PROFILES_ERROR', 'Failed to list voice profiles.', error?.message || error);
        }
    });

    // 4. Save New Voice Profile
    router.post('/profiles', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const { name, audioUrl, transcript, questionId = 'ra_15' } = req.body || {};
            if (!name || typeof name !== 'string' || name.trim().length < 2) {
                return sendError(res, 400, 'INVALID_NAME', 'Voice name must be at least 2 characters.');
            }
            if (!audioUrl || typeof audioUrl !== 'string') {
                return sendError(res, 400, 'INVALID_AUDIO', 'Audio reference URL is required.');
            }

            const uid = req.user?.uid || 'admin';
            const profileId = `voice_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const profileData = {
                id: profileId,
                name: name.trim(),
                audioUrl: audioUrl.trim(),
                transcript: transcript ? transcript.trim() : '',
                questionId,
                createdBy: uid,
                createdAt: now()
            };

            await db.collection('voice_profiles').doc(profileId).set(profileData);

            return sendSuccess(res, {
                message: 'Voice profile created successfully.',
                profile: {
                    ...profileData,
                    createdAt: profileData.createdAt.toISOString()
                }
            });
        } catch (error) {
            return sendError(res, 500, 'VOICE_PROFILE_CREATE_ERROR', 'Failed to save voice profile.', error?.message || error);
        }
    });

    // 4b. Delete Voice Profile
    router.delete('/profiles/:profileId', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const { profileId } = req.params;
            if (!profileId) {
                return sendError(res, 400, 'INVALID_ID', 'profileId is required.');
            }
            await db.collection('voice_profiles').doc(profileId).delete();
            return sendSuccess(res, { message: `Voice profile ${profileId} deleted successfully.` });
        } catch (error) {
            return sendError(res, 500, 'VOICE_PROFILE_DELETE_ERROR', 'Failed to delete voice profile.', error?.message || error);
        }
    });

    // 4c. Upload Reference Audio (base64 or binary)
    router.post('/upload-reference', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const { audioBase64, mimeType = 'audio/webm', fileName = 'reference.webm' } = req.body || {};
            if (!audioBase64 || typeof audioBase64 !== 'string') {
                return sendError(res, 400, 'INVALID_AUDIO', 'audioBase64 string is required.');
            }

            const fileId = `ref_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
            const buffer = Buffer.from(cleanBase64, 'base64');
            const ext = mimeType.includes('wav') ? 'wav' : (mimeType.includes('mp3') ? 'mp3' : 'webm');
            const storagePath = `voice-cloning/reference-audio/${fileId}.${ext}`;
            let uploadedToStorage = false;

            if (typeof getStorageBucket === 'function') {
                try {
                    const bucket = await getStorageBucket();
                    if (bucket) {
                        const file = bucket.file(storagePath);
                        await file.save(buffer, { metadata: { contentType: mimeType } });
                        uploadedToStorage = true;
                    }
                } catch (_storageErr) {
                    // Fallback to Firestore document below
                }
            }

            await db.collection('voice_audio_files').doc(fileId).set({
                fileId,
                mimeType,
                fileName,
                sizeBytes: buffer.length,
                storagePath: uploadedToStorage ? storagePath : null,
                audioBase64: buffer.length <= 1048576 ? cleanBase64 : null,
                createdAt: now()
            });

            return sendSuccess(res, {
                fileId,
                audioUrl: `/api/admin/voice-cloning/audio/${fileId}`,
                sizeBytes: buffer.length
            });
        } catch (error) {
            return sendError(res, 500, 'VOICE_UPLOAD_ERROR', 'Failed to upload reference audio.', error?.message || error);
        }
    });

    // 4d. Audio Stream Endpoint (Public/Cached for browser audio players)
    router.get('/audio/:audioId', async (req, res) => {
        try {
            const { audioId } = req.params;
            if (audioId === 'ra_15' || audioId === 'ra_15_reference' || audioId === 'default_ra_15') {
                return res.redirect(302, '/audio/voice-cloning/ra_15_reference.webm');
            }
            if (audioId === 'ra_18' || audioId === 'ra_18_cloned_test' || audioId === 'default_ra_18') {
                return res.redirect(302, '/audio/voice-cloning/ra_18_cloned_test.mp3');
            }

            // Check voice_audio_files
            const docSnap = await db.collection('voice_audio_files').doc(audioId).get();
            if (docSnap.exists) {
                const data = docSnap.data() || {};
                if (data.storagePath && typeof getStorageBucket === 'function') {
                    try {
                        const bucket = await getStorageBucket();
                        if (bucket) {
                            const [buf] = await bucket.file(data.storagePath).download();
                            res.set('Content-Type', data.mimeType || 'audio/webm');
                            res.set('Cache-Control', 'public, max-age=86400');
                            return res.status(200).send(buf);
                        }
                    } catch (_err) {
                        // try base64 fallback
                    }
                }
                if (data.audioBase64) {
                    const buf = Buffer.from(data.audioBase64, 'base64');
                    res.set('Content-Type', data.mimeType || 'audio/webm');
                    res.set('Cache-Control', 'public, max-age=86400');
                    return res.status(200).send(buf);
                }
            }

            // Check voice_cloning_queue for job output
            const jobSnap = await db.collection('voice_cloning_queue').doc(audioId).get();
            if (jobSnap.exists) {
                const job = jobSnap.data() || {};
                if (job.mp3Base64) {
                    const buf = Buffer.from(job.mp3Base64, 'base64');
                    res.set('Content-Type', 'audio/mpeg');
                    res.set('Cache-Control', 'public, max-age=86400');
                    return res.status(200).send(buf);
                }
                if (job.mp3StoragePath && typeof getStorageBucket === 'function') {
                    try {
                        const bucket = await getStorageBucket();
                        if (bucket) {
                            const [buf] = await bucket.file(job.mp3StoragePath).download();
                            res.set('Content-Type', 'audio/mpeg');
                            res.set('Cache-Control', 'public, max-age=86400');
                            return res.status(200).send(buf);
                        }
                    } catch (_err) {
                        // ignore
                    }
                }
            }

            // Fallback for default test
            return res.redirect(302, '/audio/voice-cloning/ra_18_cloned_test.mp3');
        } catch (_err) {
            return res.status(500).send('Failed to stream audio.');
        }
    });

    // 5. Enqueue Text-to-Speech Job
    router.post('/synthesize', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const { voiceProfileId, text, style = 'formal' } = req.body || {};
            if (!voiceProfileId || typeof voiceProfileId !== 'string') {
                return sendError(res, 400, 'INVALID_VOICE_ID', 'Valid voiceProfileId is required.');
            }
            if (!text || typeof text !== 'string' || text.trim().length < 2) {
                return sendError(res, 400, 'INVALID_TEXT', 'Text must be at least 2 characters.');
            }

            // Verify voice profile exists
            let profileData = null;
            if (voiceProfileId === 'default_cloned_voice' || voiceProfileId === 'voice_nam_ra15') {
                profileData = {
                    name: 'Teacher Nam - Academic Cadence',
                    audioUrl: '/audio/voice-cloning/ra_15_reference.webm',
                    transcript: "The insults and criticisms were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion, turning what began as a niche debate into a nationwide phenomenon."
                };
            } else {
                const profileSnap = await db.collection('voice_profiles').doc(voiceProfileId).get();
                if (!profileSnap.exists) {
                    return sendError(res, 404, 'VOICE_NOT_FOUND', `Voice profile ${voiceProfileId} does not exist.`);
                }
                profileData = profileSnap.data();
            }

            const uid = req.user?.uid || 'admin';
            const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

            const jobData = {
                id: jobId,
                type: 'synthesize',
                voiceProfileId,
                voiceName: profileData.name || 'Cloned Voice',
                referenceAudioUrl: profileData.audioUrl,
                referenceTranscript: profileData.transcript || '',
                text: text.trim(),
                style: (style === 'connected' ? 'connected' : 'formal'),
                status: 'pending',
                mp3Url: null,
                durationSeconds: null,
                wpm: null,
                annotations: [],
                error: null,
                createdAt: now(),
                createdBy: uid,
                startedAt: null,
                completedAt: null
            };

            await db.collection('voice_cloning_queue').doc(jobId).set(jobData);

            return sendSuccess(res, {
                jobId,
                status: 'pending',
                message: 'Voice synthesis job enqueued awaiting local worker.'
            });
        } catch (error) {
            return sendError(res, 500, 'VOICE_SYNTHESIZE_ERROR', 'Failed to enqueue voice synthesis job.', error?.message || error);
        }
    });

    // 5b. Enqueue Dynamic Calibration Test Synthesis Job
    router.post('/synthesize-test', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const { referenceAudioUrl, referenceTranscript, targetText } = req.body || {};
            if (!referenceAudioUrl || typeof referenceAudioUrl !== 'string') {
                return sendError(res, 400, 'INVALID_AUDIO', 'referenceAudioUrl is required for test calibration.');
            }

            const uid = req.user?.uid || 'admin';
            const jobId = `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const promptTarget = targetText || "Certain types of methodology are more suitable for some research projects than others. For example, the use of questionnaires and surveys is more suitable for quantitative research.";
            const promptRef = referenceTranscript || "The insults and criticisms were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion, turning what began as a niche debate into a nationwide phenomenon.";

            const jobData = {
                id: jobId,
                type: 'test_clone',
                voiceProfileId: 'calibration_preview',
                voiceName: 'Calibration Cloned Voice',
                referenceAudioUrl,
                referenceTranscript: promptRef,
                text: promptTarget.trim(),
                style: 'formal',
                status: 'pending',
                mp3Url: null,
                durationSeconds: null,
                wpm: null,
                annotations: [],
                error: null,
                createdAt: now(),
                createdBy: uid,
                startedAt: null,
                completedAt: null
            };

            await db.collection('voice_cloning_queue').doc(jobId).set(jobData);

            return sendSuccess(res, {
                jobId,
                status: 'pending',
                message: 'Calibration test synthesis job enqueued awaiting local worker.'
            });
        } catch (error) {
            return sendError(res, 500, 'VOICE_TEST_SYNTHESIZE_ERROR', 'Failed to enqueue test synthesis job.', error?.message || error);
        }
    });

    // 6. Poll Job Status
    router.get('/jobs/:jobId', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const { jobId } = req.params;
            const jobSnap = await db.collection('voice_cloning_queue').doc(jobId).get();
            if (!jobSnap.exists) {
                return sendError(res, 404, 'JOB_NOT_FOUND', `Synthesis job ${jobId} not found.`);
            }

            const data = jobSnap.data();
            return sendSuccess(res, {
                id: jobSnap.id,
                ...data,
                createdAt: data.createdAt ? new Date(timestampMillis(data.createdAt)).toISOString() : null,
                completedAt: data.completedAt ? new Date(timestampMillis(data.completedAt)).toISOString() : null
            });
        } catch (error) {
            return sendError(res, 500, 'VOICE_JOB_POLL_ERROR', 'Failed to load job status.', error?.message || error);
        }
    });

    return router;
}

module.exports = {
    createVoiceCloningAdminRouter,
    isVoiceWorkerReady,
    serializeVoiceWorkerStatus
};
