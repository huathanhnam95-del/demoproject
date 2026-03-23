const express = require('express');
const requireAuth = require('../middleware/require-auth');
const { db } = require('../utils/firebase');
const { sendError, sendSuccess } = require('../utils/response-helper');
const { CRM_ENROLLMENTS, CRM_CLASSROOMS, CRM_STUDENTS } = require('../../functions/src/crm/collections');

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

const router = express.Router();

router.get('/classrooms', requireAuth, async (req, res) => {
    try {
        if (!db || typeof db.collection !== 'function') {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

    const uid = String(req.user?.uid || '').trim();
    if (!uid) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Missing user context.');
    }

    const [uidEnrollmentsSnap, linkedStudentsSnap] = await Promise.all([
      db.collection(CRM_ENROLLMENTS).where('studentUid', '==', uid).get(),
      db.collection(CRM_STUDENTS).where('linked_user_ids', 'array-contains', uid).get()
    ]);

    const linkedStudentIds = linkedStudentsSnap.docs.map((doc) => String(doc.id || '').trim()).filter(Boolean);
    const studentIdEnrollmentsSnap = linkedStudentIds.length > 0
      ? await db.collection(CRM_ENROLLMENTS).where('studentId', 'in', linkedStudentIds.slice(0, 10)).get()
      : { docs: [] };

    const enrollmentById = new Map();
    for (const snap of [uidEnrollmentsSnap, studentIdEnrollmentsSnap]) {
      for (const doc of snap.docs || []) {
        if (!enrollmentById.has(doc.id)) {
          enrollmentById.set(doc.id, doc.data() || {});
        }
      }
    }

    const enrollments = Array.from(enrollmentById.values())
      .filter((row) => String(row.status || 'active') === 'active');

    const classIds = uniqueStrings(enrollments.map((row) => row.classId));
    if (classIds.length === 0) {
      return sendSuccess(res, { classrooms: [], count: 0 });
    }

    const classroomSnaps = await Promise.all(
      classIds.map((classId) => db.collection(CRM_CLASSROOMS).doc(classId).get())
    );

    const classrooms = classroomSnaps
      .filter((snap) => snap.exists)
      .map((snap) => {
        const data = snap.data() || {};
        return {
          id: snap.id,
          classroomId: snap.id, // compat with older admin-shaped records
          name: data.name || '',
          courseId: data.courseId || null,
          status: data.status || 'draft',
          schedule: data.schedule || null
        };
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    return sendSuccess(res, { classrooms, count: classrooms.length });
  } catch (error) {
    return sendError(res, 500, 'LIST_CLASSROOMS_ERROR', 'Failed to list classrooms.', error?.message || error);
  }
});

module.exports = router;
