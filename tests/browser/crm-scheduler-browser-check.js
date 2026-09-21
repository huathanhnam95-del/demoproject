const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const {
  buildAddSessionPreview,
  buildCanonicalScheduledWindow,
  buildRegenerationPreview,
  buildReplaceSessionPreview,
  buildReplacementPlan,
  buildScheduleSummary,
  normalizeScheduledSession
} = require('../../functions/src/crm/scheduling-service');

function pad(value) {
  return String(value).padStart(2, '0');
}

function toLocalDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfWeek(date = new Date()) {
  const ref = new Date(date);
  const day = ref.getDay() || 7;
  ref.setDate(ref.getDate() - day + 1);
  ref.setHours(0, 0, 0, 0);
  return ref;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function waitForPredicate(predicate, timeoutMs, intervalMs = 50) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/* The scheduler re-renders asynchronously after a place/refresh, so a locator can resolve and
   then be detached before the action runs. Retry rather than fail on that race. */
async function scrollIntoView(page, selector, attempts = 5) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await page.waitForSelector(selector, { state: 'attached', timeout: 5000 });
      await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 5000 });
      return;
    } catch (error) {
      lastError = error;
      if (!/not attached|detached|Element is not attached/i.test(String(error && error.message))) throw error;
      await page.waitForTimeout(150);
    }
  }
  throw lastError;
}

async function dragBetween(page, sourceSelector, targetSelector) {
  const activated = await page.evaluate(({ sourceSelector: sourceQuery, targetSelector: targetQuery }) => {
    const source = document.querySelector(sourceQuery);
    const target = document.querySelector(targetQuery);
    if (!source || !target) {
      throw new Error('Missing drag source or target.');
    }

    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const sourceX = sourceBox.left + (sourceBox.width / 2);
    const sourceY = sourceBox.top + (sourceBox.height / 2);
    const grabOffsetY = sourceY - sourceBox.top;
    const targetX = targetBox.left + (targetBox.width / 2);
    const targetY = targetBox.top + grabOffsetY + Math.min(10, targetBox.height / 2);

    const hit = document.elementFromPoint(sourceX, sourceY);
    const pill = hit?.closest?.('.teacher-scheduler-session-pill[data-session-id]') || null;
    if (!pill) {
      throw new Error(`Drag start hit-test failed for ${sourceQuery}.`);
    }

    const mkEvent = (type, x, y, buttons) => new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons
    });

    source.dispatchEvent(mkEvent('mousedown', sourceX, sourceY, 1));
    // cross the activation threshold (~6px) so the workspace marks the pill as dragging
    document.dispatchEvent(mkEvent('mousemove', sourceX + 8, sourceY + 8, 1));
    document.dispatchEvent(mkEvent('mousemove', targetX, targetY, 1));

    const isActive = source.classList.contains('is-dragging') || target.classList.contains('is-drop-target');
    document.dispatchEvent(mkEvent('mouseup', targetX, targetY, 0));
    return isActive;
  }, { sourceSelector, targetSelector });

  if (!activated) {
    throw new Error(`Drag did not activate for ${sourceSelector}.`);
  }
}

async function dragElementBetween(page, sourceSelector, targetSelector) {
  const activated = await page.evaluate(({ sourceSelector: sourceQuery, targetSelector: targetQuery }) => {
    const source = document.querySelector(sourceQuery);
    const target = document.querySelector(targetQuery);
    if (!source || !target) {
      throw new Error('Missing drag source or target.');
    }

    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const sourceX = sourceBox.left + (sourceBox.width / 2);
    const sourceY = sourceBox.top + (sourceBox.height / 2);
    const targetX = targetBox.left + (targetBox.width / 2);
    const targetY = targetBox.top + (targetBox.height / 2);

    const mkEvent = (type, x, y, buttons) => new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons
    });

    source.dispatchEvent(mkEvent('mousedown', sourceX, sourceY, 1));
    document.dispatchEvent(mkEvent('mousemove', sourceX + 8, sourceY + 8, 1));
    document.dispatchEvent(mkEvent('mousemove', targetX, targetY, 1));
    const isActive = source.classList.contains('is-dragging') || target.classList.contains('is-drop-target');
    document.dispatchEvent(mkEvent('mouseup', targetX, targetY, 0));
    return isActive;
  }, { sourceSelector, targetSelector });

  if (!activated) {
    throw new Error(`Drag did not activate for ${sourceSelector}.`);
  }
}

function buildHarnessState() {
  // Anchor the harness calendar to next week so seeded sessions are always in the future
  // (teacher scheduler locks past sessions from being moved).
  const weekStart = startOfWeek(addDays(new Date(), 7));
  const previewNowIso = new Date(weekStart);
  previewNowIso.setDate(previewNowIso.getDate() - 1);
  previewNowIso.setHours(0, 0, 0, 0);
  const timezone = 'Asia/Bangkok';
  const classOneFirstDate = toLocalDateInput(addDays(weekStart, 1));
  const classOneSecondDate = toLocalDateInput(addDays(weekStart, 3));
  const teacherConflictDate = toLocalDateInput(addDays(weekStart, 0));
  const lockedClassDate = toLocalDateInput(addDays(weekStart, 5));
  const seedClassDate = toLocalDateInput(addDays(weekStart, 2));

  const courses = [
    {
      id: 'course-1',
      name: 'IELTS 1-on-1',
      code: 'IELTS101',
      status: 'active',
      teachers: ['teacher-1'],
      deliveryTemplate: {
        totalInstructionMinutes: 120,
        defaultSessionMinutes: 60,
        timezone,
        durationStepMinutes: 30
      }
    }
  ];

  const classrooms = [
    {
      classroomId: 'class-1',
      id: 'class-1',
      name: 'Mr. Long',
      courseId: 'course-1',
      status: 'active',
      primaryTeacherUid: 'teacher-1',
      scheduleConfig: {
        totalInstructionMinutes: 120,
        sessionMinutes: 60,
        targetSessionCount: 2,
        timezone,
        allowedStartTime: '07:00',
        allowedEndTime: '21:00',
        planningStatus: 'seeded',
        durationStepMinutes: 30,
        scheduleVersion: 1
      },
      scheduleSummary: null
    },
    {
      classroomId: 'class-conflict',
      id: 'class-conflict',
      name: 'Teacher Conflict',
      courseId: 'course-1',
      status: 'active',
      primaryTeacherUid: 'teacher-1',
      scheduleConfig: {
        totalInstructionMinutes: 60,
        sessionMinutes: 60,
        targetSessionCount: 1,
        timezone,
        planningStatus: 'seeded',
        durationStepMinutes: 30,
        scheduleVersion: 1
      },
      scheduleSummary: null
    },
    {
      classroomId: 'class-locked',
      id: 'class-locked',
      name: 'Locked Class',
      courseId: 'course-1',
      status: 'active',
      primaryTeacherUid: 'teacher-2',
      scheduleConfig: {
        totalInstructionMinutes: 60,
        sessionMinutes: 60,
        targetSessionCount: 1,
        timezone,
        planningStatus: 'seeded',
        durationStepMinutes: 30,
        scheduleVersion: 1
      },
      scheduleSummary: null
    },
    {
      classroomId: 'class-seed',
      id: 'class-seed',
      name: 'New Seed Class',
      courseId: 'course-1',
      status: 'active',
      primaryTeacherUid: 'teacher-2',
      scheduleConfig: {
        totalInstructionMinutes: 60,
        sessionMinutes: 60,
        targetSessionCount: 1,
        timezone,
        seedStartDate: seedClassDate,
        seedStartTime: '14:00',
        seedWeekdays: [3],
        planningStatus: 'configured',
        durationStepMinutes: 30,
        scheduleVersion: 1
      },
      scheduleSummary: null
    }
  ];

  const sessions = [
    normalizeScheduledSession({
      sessionId: 'session-1',
      classId: 'class-1',
      courseId: 'course-1',
      teacherUid: 'teacher-1',
      ...buildCanonicalScheduledWindow({
        targetLocalDate: classOneFirstDate,
        targetLocalTime: '09:00',
        timezone,
        durationMinutes: 60
      }),
      unitType: 'contracted',
      contractUnitIndex: 1,
      overflowSequence: null,
      seedBatchId: 'seed-1',
      replacementOfSessionId: null,
      status: 'scheduled',
      attendanceState: 'none',
      lockState: 'unlocked',
      version: 1
    }),
    normalizeScheduledSession({
      sessionId: 'session-2',
      classId: 'class-1',
      courseId: 'course-1',
      teacherUid: 'teacher-1',
      ...buildCanonicalScheduledWindow({
        targetLocalDate: classOneSecondDate,
        targetLocalTime: '09:00',
        timezone,
        durationMinutes: 60
      }),
      unitType: 'contracted',
      contractUnitIndex: 2,
      overflowSequence: null,
      seedBatchId: 'seed-1',
      replacementOfSessionId: null,
      status: 'scheduled',
      attendanceState: 'none',
      lockState: 'unlocked',
      version: 1
    }),
    normalizeScheduledSession({
      sessionId: 'session-conflict-1',
      classId: 'class-conflict',
      courseId: 'course-1',
      teacherUid: 'teacher-1',
      ...buildCanonicalScheduledWindow({
        targetLocalDate: teacherConflictDate,
        targetLocalTime: '11:00',
        timezone,
        durationMinutes: 60
      }),
      unitType: 'contracted',
      contractUnitIndex: 1,
      overflowSequence: null,
      seedBatchId: 'seed-conflict',
      replacementOfSessionId: null,
      status: 'scheduled',
      attendanceState: 'none',
      lockState: 'unlocked',
      version: 1
    }),
    normalizeScheduledSession({
      sessionId: 'session-locked-1',
      classId: 'class-locked',
      courseId: 'course-1',
      teacherUid: 'teacher-2',
      ...buildCanonicalScheduledWindow({
        targetLocalDate: lockedClassDate,
        targetLocalTime: '10:30',
        timezone,
        durationMinutes: 60
      }),
      unitType: 'contracted',
      contractUnitIndex: 1,
      overflowSequence: null,
      seedBatchId: 'seed-locked',
      replacementOfSessionId: null,
      status: 'scheduled',
      attendanceState: 'in_progress',
      lockState: 'hard_locked',
      lockReason: 'attendance_in_progress',
      version: 1
    })
  ];

  let nextSessionNumber = 10;

  function getClassroom(classId) {
    return classrooms.find((row) => String(row.classroomId || row.id || '') === String(classId || '')) || null;
  }

  function activeSessions() {
    return sessions.filter((session) => String(session.status || '') !== 'cancelled');
  }

  function listClassSessions(classId) {
    return sessions
      .filter((session) => String(session.classId || '') === String(classId || ''))
      .map((session) => normalizeScheduledSession(session));
  }

  function hasTeacherConflict(proposedSession, ignoredIds = []) {
    const normalizedProposal = normalizeScheduledSession(proposedSession);
    const teacherUid = String(normalizedProposal.teacherUid || '').trim();
    if (!teacherUid) return false;

    const proposedStart = new Date(normalizedProposal.scheduledStartAtUtc).getTime();
    const proposedEnd = new Date(normalizedProposal.scheduledEndAtUtc).getTime();
    return activeSessions().some((candidate) => {
      if (ignoredIds.includes(String(candidate.sessionId || ''))) return false;
      if (String(candidate.teacherUid || '').trim() !== teacherUid) return false;
      const current = normalizeScheduledSession(candidate);
      const currentStart = new Date(current.scheduledStartAtUtc).getTime();
      const currentEnd = new Date(current.scheduledEndAtUtc).getTime();
      return proposedStart < currentEnd && proposedEnd > currentStart;
    });
  }

  function computeSummary(classroomId) {
    const classroom = getClassroom(classroomId);
    if (!classroom) return null;
    const summary = buildScheduleSummary({
      totalInstructionMinutes: Number(classroom.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      sessionMinutes: Number(classroom.scheduleConfig?.sessionMinutes || 0) || 60,
      targetSessionCount: Number(classroom.scheduleConfig?.targetSessionCount || 0) || null,
      sessions: listClassSessions(classroomId)
    });
    classroom.scheduleSummary = summary;
    return summary;
  }

  function refreshSummaries() {
    classrooms.forEach((classroom) => computeSummary(classroom.classroomId || classroom.id));
  }

  function createSession(classId, payload) {
    const session = normalizeScheduledSession({
      sessionId: `session-${nextSessionNumber++}`,
      ...payload,
      classId
    });
    sessions.push(session);
    computeSummary(classId);
    return session;
  }

  function bumpScheduleVersion(classId) {
    const classroom = getClassroom(classId);
    if (!classroom) return null;
    classroom.scheduleConfig = {
      ...classroom.scheduleConfig,
      scheduleVersion: Number(classroom.scheduleConfig?.scheduleVersion || 0) + 1
    };
    return classroom.scheduleConfig.scheduleVersion;
  }

  function cancelSession(sessionId, replacementSessionId = null) {
    const session = sessions.find((row) => String(row.sessionId || '') === String(sessionId || ''));
    if (!session) {
      throw new Error(`Missing session ${sessionId}`);
    }
    session.status = 'cancelled';
    session.replacementSessionId = replacementSessionId;
    session.version = Number(session.version || 1) + 1;
    computeSummary(session.classId);
    return session;
  }

  function replaceSession(classId, replacedSessionId, payload) {
    const replacedSession = sessions.find((row) => String(row.sessionId || '') === String(replacedSessionId || ''));
    if (!replacedSession) {
      throw new Error(`Missing session ${replacedSessionId}`);
    }
    const replacementPlan = buildReplacementPlan({
      replacementSession: {
        classId,
        courseId: replacedSession.courseId || null,
        teacherUid: payload.teacherUid || replacedSession.teacherUid || null,
        ...buildCanonicalScheduledWindow({
          targetLocalDate: payload.targetLocalDate,
          targetLocalTime: payload.targetLocalTime,
          timezone: payload.timezone || replacedSession.timezone || timezone,
          durationMinutes: payload.durationMinutes || replacedSession.durationMinutes || 60
        })
      },
      replacedSession
    });
    const replacement = createSession(classId, replacementPlan.nextSession);
    cancelSession(replacedSessionId, replacement.sessionId);
    bumpScheduleVersion(classId);
    computeSummary(classId);
    return { replacement };
  }

  function rescheduleSession(sessionId, payload) {
    const session = sessions.find((row) => String(row.sessionId || '') === String(sessionId || ''));
    if (!session) {
      throw new Error(`Missing session ${sessionId}`);
    }
    Object.assign(session, buildCanonicalScheduledWindow({
      targetLocalDate: payload.targetLocalDate,
      targetLocalTime: payload.targetLocalTime,
      timezone: payload.timezone || session.timezone || timezone,
      durationMinutes: payload.durationMinutes || session.durationMinutes || 60
    }), {
      timezone: payload.timezone || session.timezone || timezone,
      durationMinutes: payload.durationMinutes || session.durationMinutes || 60,
      version: Number(session.version || 1) + 1
    });
    bumpScheduleVersion(session.classId);
    computeSummary(session.classId);
    return normalizeScheduledSession(session);
  }

  function seedSchedule(classId, payload) {
    const classroom = getClassroom(classId);
    if (!classroom) {
      throw new Error(`Missing classroom ${classId}`);
    }
    const existingContracted = listClassSessions(classId).filter((session) =>
      String(session.unitType || '') === 'contracted'
      && String(session.status || 'scheduled') !== 'cancelled'
    );
    if (existingContracted.length) {
      return { blocked: true };
    }
    const targetCount = Number(classroom.scheduleConfig?.targetSessionCount || 0) || 1;
    const weekdays = Array.isArray(payload.weekdayNumbers) && payload.weekdayNumbers.length
      ? payload.weekdayNumbers
      : (Array.isArray(classroom.scheduleConfig?.seedWeekdays) ? classroom.scheduleConfig.seedWeekdays : [1]);
    const startDate = String(payload.startDate || classroom.scheduleConfig?.seedStartDate || seedClassDate);
    const startTime = String(payload.startTime || classroom.scheduleConfig?.seedStartTime || '14:00');
    const createdSessions = [];
    let cursor = new Date(`${startDate}T00:00:00`);
    while (createdSessions.length < targetCount) {
      const day = cursor.getDay();
      if (weekdays.map(Number).includes(day)) {
        const localDate = toLocalDateInput(cursor);
        const session = createSession(classId, {
          courseId: classroom.courseId || null,
          teacherUid: payload.teacherUid || classroom.primaryTeacherUid || null,
          ...buildCanonicalScheduledWindow({
            targetLocalDate: localDate,
            targetLocalTime: startTime,
            timezone: classroom.scheduleConfig?.timezone || timezone,
            durationMinutes: classroom.scheduleConfig?.sessionMinutes || 60
          }),
          unitType: 'contracted',
          contractUnitIndex: createdSessions.length + 1,
          seedBatchId: payload.seedBatchId || `${classId}-seed`,
          status: 'scheduled',
          attendanceState: 'none',
          lockState: 'unlocked',
          timezone: classroom.scheduleConfig?.timezone || timezone,
          durationMinutes: classroom.scheduleConfig?.sessionMinutes || 60,
          version: 1
        });
        createdSessions.push(session);
      }
      cursor = addDays(cursor, 1);
    }
    classroom.scheduleConfig = {
      ...classroom.scheduleConfig,
      planningStatus: 'seeded',
      scheduleVersion: Number(classroom.scheduleConfig?.scheduleVersion || 0) + 1
    };
    computeSummary(classId);
    return { blocked: false, createdSessions };
  }

  function regenerateSchedule(classId, preview, payload) {
    const classroom = getClassroom(classId);
    const fromDate = String(preview.regenerateFromDate || payload.regenerateFromDate || '').trim();
    sessions.forEach((session) => {
      if (String(session.classId || '') !== String(classId || '')) return;
      if (String(session.unitType || '') !== 'contracted') return;
      if (String(session.status || '') === 'cancelled') return;
      if (String(session.lockState || 'unlocked') === 'hard_locked') return;
      if (String(session.attendanceState || 'none') === 'in_progress' || String(session.attendanceState || 'none') === 'finalized') return;
      if (String(session.scheduledLocalDate || '') < fromDate) return;
      session.status = 'cancelled';
      session.version = Number(session.version || 1) + 1;
    });
    preview.previewSessions.forEach((session) => createSession(classId, session));
    classroom.scheduleConfig = {
      ...classroom.scheduleConfig,
      sessionMinutes: Number(payload.sessionMinutes || classroom.scheduleConfig.sessionMinutes || 60),
      targetSessionCount: Number(preview.nextTargetSessionCount || classroom.scheduleConfig.targetSessionCount || 0) || null,
      seedWeekdays: Array.isArray(payload.seedWeekdays) ? payload.seedWeekdays : classroom.scheduleConfig.seedWeekdays || [],
      seedStartTime: payload.seedStartTime || classroom.scheduleConfig.seedStartTime || null,
      scheduleVersion: Number(classroom.scheduleConfig?.scheduleVersion || 0) + 1
    };
    computeSummary(classId);
    return classroom;
  }

  refreshSummaries();

  return {
    courses,
    classrooms,
    sessions,
    previewNowIso,
    getClassroom,
    activeSessions,
    listClassSessions,
    hasTeacherConflict,
    computeSummary,
    refreshSummaries,
    createSession,
    bumpScheduleVersion,
    seedSchedule,
    regenerateSchedule,
    replaceSession,
    rescheduleSession
  };
}

function responseJson(res, payload, status = 200) {
  res.status(status).json(payload);
}

function createFirebaseStubScript() {
  return `
    (() => {
      const authUser = {
        uid: 'admin-1',
        email: 'admin@example.com',
        getIdToken: async () => 'test-token'
      };

      const firestore = {
        collection() {
          return {
            doc() {
              return {
                get: async () => ({ exists: false, data: () => null }),
                collection() {
                  return {
                    get: async () => ({ empty: true, docs: [], forEach() {} }),
                    orderBy() {
                      return {
                        get: async () => ({ empty: true, docs: [], forEach() {} })
                      };
                    },
                    add: async () => ({ id: 'doc-1' })
                  };
                }
              };
            },
            orderBy() {
              return {
                limit() {
                  return {
                    get: async () => ({ docs: [], forEach() {}, empty: true })
                  };
                },
                get: async () => ({ docs: [], forEach() {}, empty: true })
              };
            },
            get: async () => ({ docs: [], forEach() {}, empty: true })
          };
        },
        FieldValue: {
          serverTimestamp: () => new Date()
        }
      };

      window.firebase = {
        apps: [],
        initializeApp(config) {
          this.apps.push(config);
          this._config = config;
          return config;
        },
        auth() {
          return {
            currentUser: authUser,
            onAuthStateChanged(callback) {
              setTimeout(() => callback(authUser), 0);
              return () => {};
            }
          };
        },
        firestore() {
          return firestore;
        },
        storage() {
          return {
            ref() {
              return {
                put: async () => ({})
              };
            }
          };
        }
      };
    })();
  `;
}

function startHarnessServer() {
  const state = buildHarnessState();
  const requestLog = [];
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/config', (req, res) => {
    responseJson(res, {
      success: true,
      config: {
        apiKey: 'test-api-key',
        authDomain: 'example.test',
        projectId: 'crm-browser-test'
      }
    });
  });

  app.get('/api/admin/status', (req, res) => {
    responseJson(res, { success: true, isAdmin: true });
  });

  app.get('/api/admin/courses', (req, res) => {
    responseJson(res, { success: true, courses: state.courses });
  });

  app.get('/api/admin/classrooms', (req, res) => {
    state.refreshSummaries();
    responseJson(res, { success: true, classrooms: state.classrooms });
  });

  app.get('/api/admin/teachers', (req, res) => {
    responseJson(res, {
      success: true,
      teachers: [
        { uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher1@example.com' },
        { uid: 'teacher-2', displayName: 'Teacher Two', email: 'teacher2@example.com' }
      ],
      count: 2
    });
  });

  app.get('/api/admin/scheduler/workspace', (req, res) => {
    state.refreshSummaries();
    responseJson(res, {
      success: true,
      classrooms: state.classrooms,
      sessions: state.activeSessions().map((session) => normalizeScheduledSession(session))
    });
  });

  app.post('/api/admin/classrooms/:classId/sessions/seed', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const result = state.seedSchedule(req.params.classId, req.body || {});
    if (result.blocked) {
      return responseJson(res, {
        success: false,
        error: 'SCHEDULE_ALREADY_SEEDED',
        message: 'This class already has scheduled contracted sessions.'
      }, 409);
    }
    responseJson(res, {
      success: true,
      count: result.createdSessions.length,
      scheduleSummary: state.computeSummary(req.params.classId)
    });
  });

  app.get('/api/teacher/scheduler/workspace', (req, res) => {
    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();
    state.refreshSummaries();

    let sessions = state.activeSessions().map((session) => normalizeScheduledSession(session));
    if (from) sessions = sessions.filter((session) => String(session.scheduledLocalDate || '') >= from);
    if (to) sessions = sessions.filter((session) => String(session.scheduledLocalDate || '') <= to);

    responseJson(res, {
      success: true,
      classrooms: state.classrooms,
      sessions,
      from,
      to
    });
  });

  app.post('/api/teacher/classrooms/:classId/sessions/add', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    if (!classroom) {
      return responseJson(res, { success: false, error: 'NOT_FOUND', message: 'Missing classroom.' }, 404);
    }

    const durationMinutes = Number(req.body?.durationMinutes || classroom.scheduleConfig?.sessionMinutes || 60) || 60;
    const teacherUid = classroom.primaryTeacherUid || null;
    const proposal = normalizeScheduledSession({
      sessionId: 'proposal',
      classId: classroom.classroomId || classroom.id,
      courseId: classroom.courseId || null,
      teacherUid,
      ...buildCanonicalScheduledWindow({
        targetLocalDate: req.body?.targetLocalDate,
        targetLocalTime: req.body?.targetLocalTime,
        timezone: req.body?.timezone || classroom.scheduleConfig?.timezone || 'UTC',
        durationMinutes
      }),
      durationMinutes,
      timezone: req.body?.timezone || classroom.scheduleConfig?.timezone || 'UTC',
      status: 'scheduled',
      attendanceState: 'none',
      lockState: 'unlocked',
      version: 1
    });

    if (state.hasTeacherConflict(proposal)) {
      return responseJson(res, { success: false, error: 'TEACHER_CONFLICT', message: 'Teacher conflict.' }, 409);
    }

    const existingOverflow = state.listClassSessions(classroom.classroomId || classroom.id)
      .filter((session) => String(session.unitType || '') === 'overflow' && String(session.status || '') !== 'cancelled');

    const session = state.createSession(req.params.classId, {
      courseId: classroom.courseId || null,
      teacherUid,
      ...buildCanonicalScheduledWindow({
        targetLocalDate: req.body?.targetLocalDate,
        targetLocalTime: req.body?.targetLocalTime,
        timezone: req.body?.timezone || classroom.scheduleConfig?.timezone || 'UTC',
        durationMinutes
      }),
      unitType: 'overflow',
      overflowSequence: existingOverflow.length + 1,
      status: 'scheduled',
      attendanceState: 'none',
      lockState: 'unlocked',
      timezone: req.body?.timezone || classroom.scheduleConfig?.timezone || 'UTC',
      durationMinutes,
      version: 1
    });

    state.bumpScheduleVersion(req.params.classId);
    responseJson(res, { success: true, session });
  });

  app.post('/api/teacher/classrooms/:classId/sessions/add-multi', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    responseJson(res, { success: true, createdSessions: [], skippedOccurrences: [] });
  });

  app.patch('/api/teacher/sessions/:sessionId/reschedule', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const existing = state.sessions.find((session) => String(session.sessionId || '') === String(req.params.sessionId || ''));
    if (!existing) {
      return responseJson(res, { success: false, error: 'NOT_FOUND', message: 'Missing session.' }, 404);
    }

    const proposal = normalizeScheduledSession({
      ...existing,
      ...buildCanonicalScheduledWindow({
        targetLocalDate: req.body?.targetLocalDate,
        targetLocalTime: req.body?.targetLocalTime,
        timezone: req.body?.timezone || existing.timezone || 'UTC',
        durationMinutes: req.body?.durationMinutes || existing.durationMinutes || 60
      }),
      timezone: req.body?.timezone || existing.timezone || 'UTC',
      durationMinutes: req.body?.durationMinutes || existing.durationMinutes || 60
    });

    if (state.hasTeacherConflict(proposal, [req.params.sessionId])) {
      return responseJson(res, { success: false, error: 'TEACHER_CONFLICT', message: 'Teacher conflict.' }, 409);
    }

    const session = state.rescheduleSession(req.params.sessionId, req.body || {});
    responseJson(res, { success: true, session });
  });

  app.get('/api/admin/leads', (req, res) => {
    responseJson(res, { success: true, leads: [] });
  });

  app.get('/api/admin/tasks', (req, res) => {
    responseJson(res, { success: true, tasks: [] });
  });

  app.get('/api/admin/activities', (req, res) => {
    responseJson(res, { success: true, activities: [] });
  });

  app.get('/api/admin/students', (req, res) => {
    responseJson(res, { success: true, students: [] });
  });

  app.get('/api/admin/attendance/summary', (req, res) => {
    responseJson(res, { success: true, students: [] });
  });

  app.get('/api/admin/templates', (req, res) => {
    responseJson(res, { success: true, templates: [] });
  });

  app.get('/api/admin/automations', (req, res) => {
    responseJson(res, { success: true, rules: [], queue: [] });
  });

  app.get('/api/admin/dashboard/summary', (req, res) => {
    responseJson(res, {
      success: true,
      summary: {
        funnelConversionRate: 0,
        sourceRoiCount: 0,
        counselorProductivityCount: 0,
        classFillRate: 0,
        attendanceRiskCount: 0,
        totalRevenueCollected: 0,
        totalOutstandingBalance: 0
      }
    });
  });

  app.get('/api/admin/dashboard/funnel', (req, res) => {
    responseJson(res, { success: true, funnel: {} });
  });

  app.get('/api/admin/dashboard/revenue', (req, res) => {
    responseJson(res, { success: true, revenue: [] });
  });

  app.get('/api/admin/duplicates', (req, res) => {
    responseJson(res, { success: true, duplicates: [] });
  });

  app.get('/api/admin/audit-logs', (req, res) => {
    responseJson(res, { success: true, auditLogs: [] });
  });

  app.post('/api/admin/classrooms/:classId/sessions/add-preview', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    const preview = buildAddSessionPreview({
      classId: req.params.classId,
      courseId: classroom?.courseId || null,
      teacherUid: req.body?.teacherUid || classroom?.primaryTeacherUid || null,
      totalInstructionMinutes: Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      targetSessionCount: Number(classroom?.scheduleSummary?.contractedTargetCount || 0) || 1,
      sessionMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 60,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      durationMinutes: req.body?.durationMinutes,
      addMode: req.body?.addMode,
      recurringCount: req.body?.recurringCount,
      existingSessions: state.listClassSessions(req.params.classId),
      nowIso: state.previewNowIso.toISOString()
    });
    responseJson(res, { success: true, ...preview });
  });

  app.post('/api/admin/classrooms/:classId/sessions/add-batch', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    const preview = buildAddSessionPreview({
      classId: req.params.classId,
      courseId: classroom?.courseId || null,
      teacherUid: req.body?.teacherUid || classroom?.primaryTeacherUid || null,
      totalInstructionMinutes: Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      targetSessionCount: Number(classroom?.scheduleSummary?.contractedTargetCount || 0) || 1,
      sessionMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 60,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      durationMinutes: req.body?.durationMinutes,
      addMode: req.body?.addMode,
      recurringCount: req.body?.recurringCount,
      existingSessions: state.listClassSessions(req.params.classId),
      nowIso: state.previewNowIso.toISOString()
    });
    const createdSessions = [];
    const skippedOccurrences = [...preview.blockedOccurrences];
    for (const occurrence of preview.validOccurrences) {
      if (state.hasTeacherConflict(occurrence)) {
        skippedOccurrences.push({
          targetLocalDate: occurrence.scheduledLocalDate,
          targetLocalTime: occurrence.scheduledLocalTime,
          reasonCode: 'teacher_conflict',
          reasonMessage: 'Teacher conflict.'
        });
        continue;
      }
      createdSessions.push(state.createSession(req.params.classId, occurrence));
    }
    if (createdSessions.length) {
      state.bumpScheduleVersion(req.params.classId);
    }
    responseJson(res, {
      success: true,
      createdSessions,
      skippedOccurrences,
      scheduleSummary: state.computeSummary(req.params.classId)
    });
  });

  app.post('/api/admin/classrooms/:classId/sessions/replace-preview', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    const preview = buildReplaceSessionPreview({
      classId: req.params.classId,
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      durationMinutes: req.body?.durationMinutes || classroom?.scheduleConfig?.sessionMinutes || 60,
      existingSessions: state.listClassSessions(req.params.classId),
      totalInstructionMinutes: Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      sessionMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 60,
      nowIso: state.previewNowIso.toISOString()
    });
    responseJson(res, { success: true, ...preview });
  });

  app.post('/api/admin/classrooms/:classId/sessions/replace', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    const preview = buildReplaceSessionPreview({
      classId: req.params.classId,
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      durationMinutes: req.body?.durationMinutes || classroom?.scheduleConfig?.sessionMinutes || 60,
      existingSessions: state.listClassSessions(req.params.classId),
      totalInstructionMinutes: Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      sessionMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 60,
      nowIso: state.previewNowIso.toISOString()
    });
    const eligible = preview.eligibleSessions.find((session) => String(session.sessionId || '') === String(req.body?.replacedSessionId || ''));
    if (!eligible) {
      return responseJson(res, {
        success: false,
        code: 'SESSION_NOT_ELIGIBLE',
        message: 'Selected session is not eligible for replacement.'
      }, 409);
    }
    const replacementWindow = buildCanonicalScheduledWindow({
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      durationMinutes: req.body?.durationMinutes || classroom?.scheduleConfig?.sessionMinutes || 60
    });
    const replacementPlan = buildReplacementPlan({
      replacementSession: {
        classId: req.params.classId,
        courseId: classroom?.courseId || null,
        teacherUid: req.body?.teacherUid || classroom?.primaryTeacherUid || eligible.teacherUid || null,
        ...replacementWindow
      },
      replacedSession: eligible
    });
    if (state.hasTeacherConflict(replacementPlan.nextSession, [String(eligible.sessionId || '')])) {
      return responseJson(res, {
        success: false,
        code: 'TEACHER_CONFLICT',
        message: 'Teacher conflict.'
      }, 409);
    }
    const result = state.replaceSession(req.params.classId, req.body?.replacedSessionId, req.body || {});
    responseJson(res, { success: true, session: result.replacement });
  });

  app.patch('/api/admin/sessions/:sessionId/reschedule', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const existing = state.sessions.find((session) => String(session.sessionId || '') === String(req.params.sessionId || ''));
    if (!existing) {
      return responseJson(res, { success: false, code: 'SESSION_NOT_FOUND', message: 'Session not found.' }, 404);
    }
    const proposal = normalizeScheduledSession({
      ...existing,
      ...buildCanonicalScheduledWindow({
        targetLocalDate: req.body?.targetLocalDate,
        targetLocalTime: req.body?.targetLocalTime,
        timezone: req.body?.timezone || existing.timezone || 'UTC',
        durationMinutes: req.body?.durationMinutes || existing.durationMinutes || 60
      })
    });
    if (state.hasTeacherConflict(proposal, [String(existing.sessionId || '')])) {
      return responseJson(res, { success: false, code: 'TEACHER_CONFLICT', message: 'Teacher conflict.' }, 409);
    }
    const session = state.rescheduleSession(req.params.sessionId, req.body || {});
    responseJson(res, { success: true, session });
  });

  app.post('/api/admin/classrooms/:classId/schedule/regenerate-preview', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    if (!classroom) {
      return responseJson(res, { success: false, message: 'Classroom not found.' }, 404);
    }
    const currentVersion = Number(classroom.scheduleConfig?.scheduleVersion || 1) || 1;
    if (!Number(req.body?.expectedScheduleVersion || 0)) {
      return responseJson(res, { success: false, message: 'The classroom schedule changed. Refresh and preview again.' }, 409);
    }
    const preview = buildRegenerationPreview({
      classId: req.params.classId,
      courseId: classroom.courseId || null,
      teacherUid: req.body?.teacherUid || classroom.primaryTeacherUid || null,
      totalInstructionMinutes: Number(classroom.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      currentTargetSessionCount: Number(classroom.scheduleConfig?.targetSessionCount || 0) || null,
      timezone: classroom.scheduleConfig?.timezone || 'UTC',
      regenerateFromDate: req.body?.regenerateFromDate,
      sessionMinutes: req.body?.sessionMinutes,
      seedWeekdays: req.body?.seedWeekdays,
      seedStartTime: req.body?.seedStartTime,
      existingSessions: state.listClassSessions(req.params.classId),
      teacherConflictSessions: [],
      unresolvedSessionIds: []
    });
    responseJson(res, { success: true, ...preview, classroomScheduleVersion: currentVersion });
  });

  app.post('/api/admin/classrooms/:classId/schedule/regenerate', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    if (!classroom) {
      return responseJson(res, { success: false, message: 'Classroom not found.' }, 404);
    }
    const currentVersion = Number(classroom.scheduleConfig?.scheduleVersion || 1) || 1;
    if (!Number(req.body?.expectedScheduleVersion || 0)) {
      return responseJson(res, { success: false, message: 'The classroom schedule changed. Refresh and preview again.' }, 409);
    }
    const preview = buildRegenerationPreview({
      classId: req.params.classId,
      courseId: classroom.courseId || null,
      teacherUid: req.body?.teacherUid || classroom.primaryTeacherUid || null,
      totalInstructionMinutes: Number(classroom.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      currentTargetSessionCount: Number(classroom.scheduleConfig?.targetSessionCount || 0) || null,
      timezone: classroom.scheduleConfig?.timezone || 'UTC',
      regenerateFromDate: req.body?.regenerateFromDate,
      sessionMinutes: req.body?.sessionMinutes,
      seedWeekdays: req.body?.seedWeekdays,
      seedStartTime: req.body?.seedStartTime,
      existingSessions: state.listClassSessions(req.params.classId),
      teacherConflictSessions: [],
      unresolvedSessionIds: []
    });
    if (!preview.canCommit) {
      return responseJson(res, { success: false, message: 'Schedule regeneration is blocked.' }, 409);
    }
    const nextClassroom = state.regenerateSchedule(req.params.classId, preview, req.body || {});
    responseJson(res, {
      success: true,
      cancelledSessionIds: state.sessions.filter((session) =>
        String(session.classId || '') === String(req.params.classId || '')
        && String(session.status || '') === 'cancelled'
        && String(session.unitType || '') === 'contracted'
      ).map((session) => session.sessionId),
      createdSessions: preview.previewSessions,
      scheduleConfig: nextClassroom.scheduleConfig,
      scheduleSummary: nextClassroom.scheduleSummary
    });
  });

  app.post('/api/admin/attendance/sessions/open-from-scheduled', (req, res) => {
    responseJson(res, { success: true, sessionId: `${req.body?.scheduledSessionId || 'scheduled'}-attendance` });
  });

  app.use('/api', (req, res) => {
    responseJson(res, { success: true });
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
        requestLog,
        state
      });
    });
  });
}

(async () => {
  const { server, origin, requestLog, state } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 }
  });
  const page = await context.newPage();
  const errors = [];
  const firebaseStub = createFirebaseStubScript();
  const screenshotPath = process.env.SCHEDULER_SCREENSHOT_PATH || path.join('tmp', 'crm-scheduler-browser-check.png');

  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    const errorText = failure && failure.errorText ? failure.errorText : 'requestfailed';
    errors.push(`${errorText}: ${request.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (/409 \(Conflict\)/i.test(text)) {
        return;
      }
      errors.push(text);
    }
  });

  await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: firebaseStub
    });
  });
  await page.route('http://localhost:11434/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 'browser-test' })
    });
  });

  try {
    await page.goto(`${origin}/crm-admin.html#courses/classes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#scheduler-class-list .scheduler-class-card[data-classroom-id="class-1"]');
    await page.waitForSelector('#scheduler-calendar .scheduler-calendar-slot[data-date][data-time]');

    await page.goto(`${origin}/crm-admin.html#courses/teacher-schedule`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#teacher-scheduler-class-list .teacher-scheduler-class-card');
    await page.waitForSelector('#teacher-scheduler-calendar .teacher-scheduler-slot[data-date][data-time]');

    // Match the harness seed calendar (next week) so sessions remain movable (not locked as "past").
    const weekStart = startOfWeek(addDays(new Date(), 7));
    const recurringDate = toLocalDateInput(addDays(weekStart, 1));
    const replaceDate = toLocalDateInput(addDays(weekStart, 4));
    const conflictDate = toLocalDateInput(addDays(weekStart, 0));
    const weekEnd = toLocalDateInput(addDays(weekStart, 6));
    const seedDate = toLocalDateInput(addDays(weekStart, 2));

    await page.goto(`${origin}/crm-admin.html#courses/classes`, { waitUntil: 'domcontentloaded' });
    await page.locator('#scheduler-from-date').fill(conflictDate);
    await page.locator('#scheduler-to-date').fill(weekEnd);
    await page.click('#btn-refresh-scheduler');
    await page.waitForSelector(`#scheduler-calendar .scheduler-calendar-slot[data-date="${conflictDate}"][data-time]`);

    const adminClassCardSelector = '#scheduler-class-list .scheduler-class-card[data-classroom-id="class-1"]';
    const seedClassCardSelector = '#scheduler-class-list .scheduler-class-card[data-classroom-id="class-seed"]';
    const adminAddTargetSelector = `#scheduler-calendar .scheduler-calendar-slot[data-date="${conflictDate}"][data-time="15:00"]`;
    const adminReplaceTargetSelector = `#scheduler-calendar .scheduler-calendar-slot[data-date="${conflictDate}"][data-time="16:00"]`;
    const seedTargetSelector = `#scheduler-calendar .scheduler-calendar-slot[data-date="${seedDate}"][data-time="14:00"]`;

    await page.click(seedClassCardSelector);
    await page.click('#btn-seed-scheduler');
    assert.ok(
      await waitForPredicate(
        () => requestLog.some((entry) => entry.path === '/api/admin/classrooms/class-seed/sessions/seed'),
        30000
      ),
      'Expected admin seed request for selected class.'
    );
    const seedRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-seed/sessions/seed');
    assert.strictEqual(seedRequest.body.startDate, seedDate);
    assert.strictEqual(seedRequest.body.startTime, '14:00');
    assert.deepStrictEqual(seedRequest.body.weekdayNumbers, [3]);
    assert.strictEqual(seedRequest.body.teacherUid, 'teacher-2');
    await page.waitForSelector(`${seedTargetSelector} .scheduler-session-pill`);

    await scrollIntoView(page, adminClassCardSelector);
    await scrollIntoView(page, adminAddTargetSelector);
    await dragElementBetween(page, adminClassCardSelector, adminAddTargetSelector);
    await page.waitForSelector('#scheduler-action-modal[aria-hidden="false"]');
    assert.ok(
      await waitForPredicate(
        () => requestLog.some((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/add-preview'),
        30000
      ),
      'Expected admin add preview request after dragging a class to the scheduler.'
    );
    await page.waitForFunction(() => {
      const btn = document.getElementById('btn-confirm-scheduler-action');
      return !!btn && !btn.disabled && /Confirm Add/i.test(btn.textContent || '');
    });
    await page.click('#btn-confirm-scheduler-action');
    assert.ok(
      await waitForPredicate(
        () => requestLog.some((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/add-batch'),
        30000
      ),
      'Expected admin add batch request after confirming scheduler add.'
    );

    await page.waitForSelector('#scheduler-action-modal[aria-hidden="true"]', { state: 'attached' });
    await page.waitForSelector(adminClassCardSelector);
    await scrollIntoView(page, adminClassCardSelector);
    await scrollIntoView(page, adminReplaceTargetSelector);
    await dragElementBetween(page, adminClassCardSelector, adminReplaceTargetSelector);
    await page.waitForSelector('#scheduler-action-modal[aria-hidden="false"]', { state: 'visible' });
    await page.click('#scheduler-action-replace-button');
    assert.ok(
      await waitForPredicate(
        () => requestLog.some((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/replace-preview'),
        30000
      ),
      'Expected admin replace preview request after switching to replace mode.'
    );
    await page.waitForSelector('#scheduler-action-replace-list .scheduler-action-session-choice[data-session-id="session-2"]');
    await page.click('#scheduler-action-replace-list .scheduler-action-session-choice[data-session-id="session-2"]');
    await page.waitForFunction(() => {
      const btn = document.getElementById('btn-confirm-scheduler-action');
      return !!btn && !btn.disabled && /Confirm Replace/i.test(btn.textContent || '');
    });
    await page.click('#btn-confirm-scheduler-action');
    assert.ok(
      await waitForPredicate(
        () => requestLog.some((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/replace'),
        30000
      ),
      'Expected admin replace request after confirming scheduler replace.'
    );

    const adminAddRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/add-batch');
    assert.ok(adminAddRequest);
    assert.strictEqual(adminAddRequest.body.targetLocalDate, conflictDate);
    assert.strictEqual(adminAddRequest.body.targetLocalTime, '15:00');

    const adminReplaceRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/replace');
    assert.ok(adminReplaceRequest);
    assert.strictEqual(adminReplaceRequest.body.targetLocalDate, conflictDate);
    assert.strictEqual(adminReplaceRequest.body.targetLocalTime, '16:00');

    await page.goto(`${origin}/crm-admin.html#courses/teacher-schedule`, { waitUntil: 'domcontentloaded' });

    // The teacher scheduler defaults to the current week; switch to the seeded range.
    await page.locator('#teacher-scheduler-from-date').fill(conflictDate);
    await page.locator('#teacher-scheduler-to-date').fill(weekEnd);
    // Custom ranges intentionally enter Schedule view. Return to Week before
    // exercising grid placement and drag interactions.
    await page.click('#btn-ts-view-grid');
    await page.click('#btn-teacher-scheduler-refresh');
    await page.waitForSelector(`#teacher-scheduler-calendar .teacher-scheduler-slot[data-date="${conflictDate}"][data-time]`);

    const classCardSelector = '#teacher-scheduler-class-list .teacher-scheduler-class-card[data-classroom-id="class-1"]';
    const sessionPillSelector = '#teacher-scheduler-calendar .teacher-scheduler-session-pill[data-session-id="session-1"]';
    const originalSlotSelector = `#teacher-scheduler-calendar .teacher-scheduler-slot[data-date="${recurringDate}"][data-time="09:00"]`;
    const conflictTargetSelector = `#teacher-scheduler-calendar .teacher-scheduler-slot[data-date="${conflictDate}"][data-time="11:00"]`;
    const placeTargetSelector = `#teacher-scheduler-calendar .teacher-scheduler-slot[data-date="${conflictDate}"][data-time="12:00"]`;
    const rescheduleTargetSelector = `#teacher-scheduler-calendar .teacher-scheduler-slot[data-date="${conflictDate}"][data-time="13:00"]`;

    await page.waitForFunction(({ classCardSelector: cardSelector, sessionPillSelector: pillSelector }) => (
      !!document.querySelector(cardSelector) && !!document.querySelector(pillSelector)
    ), { classCardSelector, sessionPillSelector });
    // Validate actual computed styles through the complete CRM stylesheet stack.
    const expectedPastels = {
      blue: '#D2E3FC', purple: '#E8DEF8', teal: '#CDEBE6', green: '#CEEAD6',
      orange: '#FCE3C1', red: '#FAD2CF', indigo: '#DDE3FA', coral: '#F8D9E5', neutral: '#E8EAED'
    };
    const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    const readColors = () => page.evaluate((selector) => {
      const pill = document.querySelector(selector);
      return ({
      family: pill.dataset.tsColor,
      background: getComputedStyle(pill).backgroundColor,
      title: getComputedStyle(pill.querySelector('.pill-title')).color,
      meta: getComputedStyle(pill.querySelector('.pill-time')).color,
      opacity: getComputedStyle(pill).opacity
      });
    }, sessionPillSelector);
    const pastel = await readColors();
    assert.strictEqual(pastel.background, rgb(expectedPastels[pastel.family]));
    assert.strictEqual(pastel.title, 'rgb(31, 31, 31)');
    assert.strictEqual(pastel.meta, 'rgb(60, 64, 67)');
    assert.strictEqual(pastel.opacity, '1');
    for (const stateClass of ['is-completed', 'is-saving', 'is-selected']) {
      await page.locator(sessionPillSelector).evaluate((pill, name) => pill.classList.add(name), stateClass);
      const colors = await readColors();
      assert.strictEqual(colors.title, pastel.title, `${stateClass} title`);
      assert.strictEqual(colors.meta, pastel.meta, `${stateClass} metadata`);
      assert.strictEqual(colors.opacity, '1', `${stateClass} opacity`);
      await page.locator(sessionPillSelector).evaluate((pill, name) => pill.classList.remove(name), stateClass);
    }
    await page.click('#btn-ts-settings');
    await page.selectOption('#ts-setting-appearance', 'solid');
    await page.click('#btn-ts-save-settings');
    assert.strictEqual((await readColors()).title, 'rgb(255, 255, 255)');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.teacherSchedulerController?.getState().appearance === 'solid');
    await page.click('#btn-ts-settings');
    await page.selectOption('#ts-setting-appearance', 'pastel');
    await page.click('#btn-ts-save-settings');
    await page.locator('#teacher-scheduler-from-date').fill(conflictDate);
    await page.locator('#teacher-scheduler-to-date').fill(weekEnd);
    await page.click('#btn-ts-view-grid');
    await page.click('#btn-teacher-scheduler-refresh');
    await page.waitForSelector(sessionPillSelector);
    assert.strictEqual((await readColors()).background, pastel.background);
    await scrollIntoView(page, sessionPillSelector);
    await page.screenshot({ path: screenshotPath.replace(/\.png$/, '-pastel.png'), fullPage: true });
    console.log('Chrome computed Pastel colors, status foregrounds, Solid persistence and return to Pastel passed.');
    await page.waitForTimeout(100);
    await scrollIntoView(page, classCardSelector);
    await scrollIntoView(page, originalSlotSelector);
    await scrollIntoView(page, conflictTargetSelector);

    // Sanity check: placement mode wiring must be active before drag assertions.
    await page.click(classCardSelector);
    await page.waitForFunction((selector) => {
      const el = document.querySelector(selector);
      return !!el && el.classList.contains('is-armed');
    }, classCardSelector);
    await page.keyboard.press('Escape');

    // Negative case: conflict placement should not call the API
    await page.click(classCardSelector);
    await page.waitForFunction((selector) => {
      const el = document.querySelector(selector);
      return !!el && el.classList.contains('is-armed');
    }, classCardSelector);
    await page.click(conflictTargetSelector);
    await page.waitForTimeout(300);
    assert.ok(
      !requestLog.some((entry) => entry.path === '/api/teacher/classrooms/class-1/sessions/add'),
      'Unexpected teacher add request on conflict placement.'
    );
    const conflictCellText = await page.locator(conflictTargetSelector).textContent();
    assert.doesNotMatch(String(conflictCellText || ''), /Mr\. Long/i);
    const originalCellText = await page.locator(originalSlotSelector).textContent();
    assert.match(String(originalCellText || ''), /Mr\. Long/i);
    await page.keyboard.press('Escape');

    // Place a session via placement mode
    await page.click(classCardSelector);
    await page.waitForFunction((selector) => {
      const el = document.querySelector(selector);
      return !!el && el.classList.contains('is-armed');
    }, classCardSelector);
    await scrollIntoView(page, placeTargetSelector);
    await page.click(placeTargetSelector);
    await page.waitForFunction((selector) => {
      const el = document.querySelector(selector);
      return !!el && /Mr\. Long/i.test(el.textContent || '');
    }, placeTargetSelector);
    await page.keyboard.press('Escape');

    // Negative case: dragging onto a conflicting slot should be blocked client-side (no API call)
    const initialTeacherRescheduleCount = requestLog.filter(
      (entry) => entry.path === '/api/teacher/sessions/session-1/reschedule'
    ).length;
    await scrollIntoView(page, sessionPillSelector);
    await dragBetween(page, sessionPillSelector, conflictTargetSelector);
    await page.waitForTimeout(300);
    assert.strictEqual(
      requestLog.filter((entry) => entry.path === '/api/teacher/sessions/session-1/reschedule').length,
      initialTeacherRescheduleCount,
      'Unexpected teacher reschedule request on conflict drag.'
    );
    await page.waitForSelector(`${originalSlotSelector} .teacher-scheduler-session-pill[data-session-id="session-1"]`);
    assert.strictEqual(
      await page.locator(`${conflictTargetSelector} .teacher-scheduler-session-pill[data-session-id="session-1"]`).count(),
      0,
      'Session pill moved into conflict slot unexpectedly.'
    );

    // Reschedule session-1 to a safe slot (drag + API + refresh)
    await scrollIntoView(page, rescheduleTargetSelector);
    await dragBetween(page, sessionPillSelector, rescheduleTargetSelector);
    assert.ok(
      await waitForPredicate(
        () => requestLog.some((entry) => entry.path === '/api/teacher/sessions/session-1/reschedule'),
        30000
      ),
      'Expected Teacher Schedule reschedule request to be logged.'
    );
    const updatedSession = state.sessions.find((session) => String(session.sessionId || '') === 'session-1') || null;
    assert.ok(updatedSession, 'Missing session-1 after reschedule.');
    assert.strictEqual(String(updatedSession.scheduledLocalDate || ''), conflictDate);
    assert.strictEqual(String(updatedSession.scheduledLocalTime || '').slice(0, 5), '13:00');
    await page.evaluate(() => {
      const btn = document.getElementById('btn-teacher-scheduler-refresh');
      if (btn) btn.click();
    });
    await page.waitForSelector(`${rescheduleTargetSelector} .teacher-scheduler-session-pill[data-session-id="session-1"]`);

    const requestPaths = requestLog.map((entry) => entry.path);
    assert.ok(requestPaths.includes('/api/teacher/classrooms/class-1/sessions/add'));
    assert.ok(requestPaths.includes('/api/teacher/sessions/session-1/reschedule'));

    const teacherAddRequest = requestLog.find((entry) => entry.path === '/api/teacher/classrooms/class-1/sessions/add');
    assert.ok(teacherAddRequest);
    assert.strictEqual(teacherAddRequest.body.targetLocalDate, conflictDate);
    assert.strictEqual(teacherAddRequest.body.targetLocalTime, '12:00');

    const teacherRescheduleRequest = requestLog.find((entry) => entry.path === '/api/teacher/sessions/session-1/reschedule');
    assert.ok(teacherRescheduleRequest);
    assert.strictEqual(teacherRescheduleRequest.body.targetLocalDate, conflictDate);
    assert.strictEqual(teacherRescheduleRequest.body.targetLocalTime, '13:00');

    await page.evaluate(() => {
      window.location.hash = '#courses/class-management';
    });
    await page.waitForSelector('#class-management-grid .crm-classroom-link[data-classroom-id="class-1"]');
    await page.click('#class-management-grid .crm-classroom-link[data-classroom-id="class-1"]');
    await page.waitForSelector('#crm-classroom-modal', { state: 'visible' });
    await page.click('.crm-sidebar-item[data-tab="scheduling"]');
    await page.locator('#classroom-regenerate-from-date').fill(replaceDate);
    await page.locator('#classroom-regenerate-session-minutes').fill('60');
    await page.click('#classroom-regenerate-weekdays-selector .crm-weekday-btn[data-day="fri"]');
    await page.locator('#classroom-regenerate-start-time').fill('12:00');
    await page.click('#btn-preview-classroom-regeneration');
    await page.waitForTimeout(1000);
    const regenerationPreviewRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-1/schedule/regenerate-preview');
    assert.ok(regenerationPreviewRequest, 'Expected regeneration preview request to be sent.');
    assert.ok(Number(regenerationPreviewRequest.body.expectedScheduleVersion || 0) >= 1, `Missing expectedScheduleVersion in regeneration preview request: ${JSON.stringify(regenerationPreviewRequest.body)}`);
    const regenerationPreviewText = await page.locator('#classroom-regeneration-preview').textContent();
    assert.match(String(regenerationPreviewText || ''), /Next Target Count/i);
    await page.click('#btn-apply-classroom-regeneration');
    await page.waitForFunction(() => {
      const preview = document.querySelector('#classroom-regeneration-preview');
      return preview && /Preview regeneration to review preserved sessions/i.test(preview.textContent || '');
    });
    const summaryText = await page.locator('#classroom-schedule-summary').textContent();
    assert.match(String(summaryText || ''), /Assigned/i);

    assert.strictEqual(regenerationPreviewRequest.body.regenerateFromDate, replaceDate);
    assert.strictEqual(regenerationPreviewRequest.body.seedStartTime, '12:00');
    assert.deepStrictEqual(regenerationPreviewRequest.body.seedWeekdays, [5]);
    assert.ok(Number(regenerationPreviewRequest.body.expectedScheduleVersion) >= 1);

    const regenerateRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-1/schedule/regenerate');
    assert.ok(regenerateRequest);
    assert.strictEqual(regenerateRequest.body.regenerateFromDate, replaceDate);
    assert.strictEqual(regenerateRequest.body.seedStartTime, '12:00');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

    if (errors.length) {
      throw new Error(`Browser errors detected:\n${errors.join('\n')}`);
    }

    console.log('CRM scheduler browser check passed.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
