#!/usr/bin/env node
'use strict';

// Dry run by default. --apply changes the explicit Firebase project and relies on
// the deployed outbox reconciler to dispatch resumable jobs.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { WalletService } = require('../../functions/src/ai-credits/wallet-service');
const { SettlementService } = require('../../functions/src/ai-credits/settlement-service');

const args = process.argv.slice(2);
const project = args[args.indexOf('--project') + 1];
const apply = args.includes('--apply');
if (!project || project.startsWith('--') || !/^[a-z0-9-]+$/.test(project)) {
  console.error('Usage: node scripts/speech/recover-awaiting-jobs.cjs --project PROJECT_ID [--apply]');
  process.exit(2);
}

initializeApp({ projectId: project, credential: applicationDefault() });
const db = getFirestore();
const settlement = new SettlementService({ db, walletService: new WalletService({ db }) });

async function main() {
  const snapshot = await db.collection('aiScoringJobs')
    .where('status', '==', 'awaiting_reference_confirmation').get();
  const summary = { examined: 0, resume: 0, release: 0, errors: 0 };
  for (const doc of snapshot.docs) {
    summary.examined++;
    try {
      const reservation = await db.collection('aiCreditReservations').doc(doc.id).get();
      const job = doc.data();
      const transcript = job.transcription;
      const audio = job.audioId ? await db.collection('aiScoringAudio').doc(job.audioId).get() : null;
      const archive = job.attemptId ? await db.collection('speakingAttempts').doc(job.attemptId).get() : null;
      const canResume = reservation.exists && reservation.data().status === 'reserved' &&
        Date.parse(job.deadlineAt) > Date.now() &&
        job.audioId && job.audioManifest?.canonicalFileHash && job.attemptId &&
        audio?.exists && audio.data().manifest?.canonicalFileHash === job.audioManifest.canonicalFileHash &&
        archive?.exists && archive.data().v3AudioId === job.audioId &&
        archive.data().v3AssessmentId === doc.id &&
        typeof transcript?.rawTranscript === 'string' && transcript.rawTranscript.trim() &&
        Array.isArray(transcript.tokens) && transcript.tokens.length > 0;
      const action = canResume ? 'resume' : 'release';
      summary[action]++;
      console.log(`${doc.id}: ${action}${apply ? ' (applying)' : ' (dry run)'}`);
      if (!apply) continue;
      await db.runTransaction(async tx => {
        const current = await tx.get(doc.ref);
        const reservationRef = db.collection('aiCreditReservations').doc(doc.id);
        const reserved = await tx.get(reservationRef);
        if (!current.exists || current.data().status !== 'awaiting_reference_confirmation') return;
        if (!reserved.exists || reserved.data().status !== 'reserved')
          throw new Error('RESERVATION_NOT_RECOVERABLE');
        const data = current.data();
        const frozen = data.transcription;
        const audio = data.audioId ? await tx.get(db.collection('aiScoringAudio').doc(data.audioId)) : null;
        const archive = data.attemptId ? await tx.get(db.collection('speakingAttempts').doc(data.attemptId)) : null;
        const valid = Date.parse(data.deadlineAt) > Date.now() && data.audioId &&
          data.audioManifest?.canonicalFileHash && data.attemptId &&
          typeof frozen?.rawTranscript === 'string' && frozen.rawTranscript.trim() &&
          Array.isArray(frozen.tokens) && frozen.tokens.length > 0 &&
          audio?.exists && audio.data().manifest?.canonicalFileHash === data.audioManifest.canonicalFileHash &&
          archive?.exists && archive.data().v3AudioId === data.audioId &&
          archive.data().v3AssessmentId === doc.id;
        if (valid) {
          tx.update(doc.ref, { engineVersion: 'bel.speech.v3', status: 'queued',
            stage: 'retry_pending', frozenTranscription: frozen, leaseOwner: null,
            leaseExpiresAt: null, leaseVersion: Number(data.leaseVersion || 0) + 1,
            updatedAt: new Date().toISOString() });
          tx.set(db.collection('aiScoringOutbox').doc(doc.id), { assessmentId: doc.id,
            status: 'pending', createdAt: new Date().toISOString() });
        } else {
          await settlement.releaseCreditsInTx(tx, { assessmentId: doc.id,
            reason: 'LEGACY_REFERENCE_RECOVERY_UNAVAILABLE' });
          tx.update(doc.ref, { status: 'reference_unresolved', stage: 'reference_unresolved',
            leaseOwner: null, leaseExpiresAt: null,
            leaseVersion: Number(data.leaseVersion || 0) + 1,
            updatedAt: new Date().toISOString() });
          tx.delete(db.collection('aiScoringOutbox').doc(doc.id));
        }
      });
    } catch (error) {
      summary.errors++;
      console.error(`${doc.id}: ${error.message || error}`);
    }
  }
  console.log(JSON.stringify({ project, applied: apply, ...summary }));
  if (summary.errors) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
