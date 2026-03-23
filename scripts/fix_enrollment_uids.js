require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const saPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
const sa = require(saPath);
admin.initializeApp({credential: admin.credential.cert(sa)});
const db = admin.firestore();

(async () => {
  // Build studentId -> UID map from linked students
  const studentLinkedMap = new Map();
  const ss = await db.collection('crmStudents').get();
  ss.docs.forEach(d => {
    const x = d.data();
    if ((x.linked_user_ids||[]).length > 0) {
      studentLinkedMap.set(d.id, x.linked_user_ids[0]);
    }
  });
  console.log('Linked students:', studentLinkedMap.size);

  // Fix enrollments
  const es = await db.collection('crmEnrollments').get();
  let fixed = 0;
  for (const doc of es.docs) {
    const data = doc.data();
    if (!data.studentUid && data.studentId) {
      const uid = studentLinkedMap.get(data.studentId);
      if (uid) {
        console.log('FIXING: enrollment=' + doc.id + ' studentId=' + data.studentId + ' -> studentUid=' + uid);
        await db.collection('crmEnrollments').doc(doc.id).update({ studentUid: uid });
        fixed++;
      }
    }
  }
  
  console.log('\nFixed ' + fixed + ' enrollments');

  // Verify: check how many enrollments now have studentUid = V15Tp3sCnqVavCOLoS4SSR5IvYx2
  const TARGET_UID = 'V15Tp3sCnqVavCOLoS4SSR5IvYx2';
  const verify = await db.collection('crmEnrollments').where('studentUid', '==', TARGET_UID).get();
  console.log('Enrollments for UID ' + TARGET_UID + ': ' + verify.size);
  verify.docs.forEach(d => {
    const x = d.data();
    console.log('  classId=' + (x.classId||'?') + ' status=' + (x.status||'?'));
  });

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
