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
            const profileSnap = await db.collection('voice_profiles').doc(voiceProfileId).get();
            if (!profileSnap.exists) {
                return sendError(res, 404, 'VOICE_NOT_FOUND', `Voice profile ${voiceProfileId} does not exist.`);
            }

            const profileData = profileSnap.data();
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
