require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const saPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
const sa = require(saPath);
admin.initializeApp({credential: admin.credential.cert(sa)});
const db = admin.firestore();

(async () => {
  // Check enrollments
  const es = await db.collection('crmEnrollments').get();
  console.log('=== ENROLLMENTS (' + es.size + ') ===');
  const enrollments = [];
  es.docs.forEach(d => {
    const x = d.data();
    const row = {id:d.id, studentId:x.studentId||null, studentUid:x.studentUid||null, classId:x.classId||null, status:x.status||null, name:x.studentName||null};
    enrollments.push(row);
    console.log(JSON.stringify(row));
  });

  // Check linked students
  console.log('\n=== LINKED STUDENTS ===');
  const linkedStudents = [];
  const ss = await db.collection('crmStudents').get();
  ss.docs.forEach(d => {
    const x = d.data();
    if ((x.linked_user_ids||[]).length > 0) {
      const row = {id:d.id, name:x.name, linked:x.linked_user_ids};
      linkedStudents.push(row);
      console.log(JSON.stringify(row));
    }
  });

  // Fix: update enrollments that have a studentId with a linked student but missing studentUid
  console.log('\n=== FIX CHECK ===');
  const studentLinkedMap = new Map();
  ss.docs.forEach(d => {
    const x = d.data();
    if ((x.linked_user_ids||[]).length > 0) {
      studentLinkedMap.set(d.id, x.linked_user_ids[0]);
    }
  });

  let fixed = 0;
  for (const enrollment of enrollments) {
    if (!enrollment.studentUid && enrollment.studentId) {
      const uid = studentLinkedMap.get(enrollment.studentId);
      if (uid) {
        console.log('WILL FIX: enrollment=' + enrollment.id + ' studentId=' + enrollment.studentId + ' -> studentUid=' + uid);
        fixed++;
      }
    }
  }
  console.log('Enrollments needing fix: ' + fixed);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
