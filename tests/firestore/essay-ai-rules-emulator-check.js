const assert = require('node:assert/strict');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'listening-tasks-3ae34';

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: require('node:fs').readFileSync('firestore.rules', 'utf8') }
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'admin-rules-user'), { isAdmin: true });
      await setDoc(doc(db, 'essay_ai_queue', 'queue-rules-001'), {
        uid: 'owner-rules-user', attemptId: 'attempt-rules-001', status: 'pending', isRead: false
      });
      await setDoc(doc(db, 'user_notifications', 'notification-rules-001'), {
        uid: 'owner-rules-user', queueId: 'queue-rules-001', isRead: false
      });
      await setDoc(doc(db, 'crm_system_alerts', 'alert-rules-001'), {
        status: 'unresolved', severity: 'error', message: 'safe alert'
      });
      await setDoc(doc(db, 'essay_ai_backfill_jobs', 'job-rules-001'), { status: 'pending' });
      await setDoc(doc(db, 'essay_ai_backfill_control', 'current'), { activePreviewJobId: null });
      await setDoc(doc(db, 'essay_ai_worker_status', 'current'), { state: 'idle' });
    });

    const owner = testEnv.authenticatedContext('owner-rules-user').firestore();
    const other = testEnv.authenticatedContext('other-rules-user').firestore();
    const admin = testEnv.authenticatedContext('admin-rules-user').firestore();

    assert.equal((await assertSucceeds(getDoc(doc(owner, 'essay_ai_queue', 'queue-rules-001')))).data().uid, 'owner-rules-user');
    await assertFails(getDoc(doc(other, 'essay_ai_queue', 'queue-rules-001')));
    await assertFails(setDoc(doc(owner, 'essay_ai_queue', 'queue-rules-002'), { uid: 'owner-rules-user' }));
    await assertSucceeds(updateDoc(doc(owner, 'essay_ai_queue', 'queue-rules-001'), { isRead: true }));
    await assertFails(updateDoc(doc(owner, 'essay_ai_queue', 'queue-rules-001'), { isRead: 'yes' }));
    await assertFails(updateDoc(doc(owner, 'essay_ai_queue', 'queue-rules-001'), { status: 'completed' }));

    await assertSucceeds(getDoc(doc(owner, 'user_notifications', 'notification-rules-001')));
    await assertSucceeds(updateDoc(doc(owner, 'user_notifications', 'notification-rules-001'), { isRead: true }));
    await assertFails(updateDoc(doc(owner, 'user_notifications', 'notification-rules-001'), { isRead: 1 }));
    await assertFails(updateDoc(doc(owner, 'user_notifications', 'notification-rules-001'), { message: 'forged' }));
    await assertFails(getDoc(doc(other, 'user_notifications', 'notification-rules-001')));

    await assertSucceeds(getDoc(doc(admin, 'crm_system_alerts', 'alert-rules-001')));
    await assertSucceeds(updateDoc(doc(admin, 'crm_system_alerts', 'alert-rules-001'), { status: 'resolved' }));
    await assertFails(updateDoc(doc(admin, 'crm_system_alerts', 'alert-rules-001'), { message: 'forged' }));
    await assertFails(getDoc(doc(owner, 'crm_system_alerts', 'alert-rules-001')));

    await assertFails(getDoc(doc(admin, 'essay_ai_backfill_jobs', 'job-rules-001')));
    await assertFails(getDoc(doc(admin, 'essay_ai_backfill_control', 'current')));
    await assertFails(getDoc(doc(admin, 'essay_ai_worker_status', 'current')));
    console.log('essay-ai Firestore rules emulator check passed');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
