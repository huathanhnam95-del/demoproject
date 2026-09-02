const {
    CRM_LEADS,
    CRM_STUDENTS,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CRM_TASKS,
    CRM_ACTIVITIES,
    CRM_ENROLLMENTS,
    CRM_ATTENDANCE_SESSIONS,
    CRM_ATTENDANCE_RECORDS,
    CRM_SCHEDULED_SESSIONS,
    CRM_INVOICES,
    CRM_PAYMENTS,
    CRM_COMMISSIONS,
    CRM_SUBMISSIONS,
    CRM_RECYCLE_BIN,
    ENTRANCE_TESTS,
    CLASSROOM_MODULES,
    CLASSROOM_CLASSWORK,
    CLASSROOM_MEMBERS,
    CLASSROOM_LIVE_SESSIONS
} = require('./collections');
const { mapLeadRecord } = require('./lead-service');
const { mapStudentRecord } = require('./student-service');
const { mapCourseRecord, mapClassroomRecord } = require('./course-service');

const ARCHIVE_RETENTION_DAYS = 30;
const PRE_ENROLLMENT_STAGES = new Set([
    'potential',
    'test_scheduled',
    'test_completed',
    'counseling',
    'trial'
]);

const ENROLLED_STAGES = new Set([
    'enrolled',
    'paused',
    'completed',
    'alumni'
]);

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function uniqueIds(values) {
    const seen = new Set();
    const ids = [];
    for (const value of Array.isArray(values) ? values : []) {
        const id = cleanOptionalString(value);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function toDate(value, fallback = new Date()) {
    if (value instanceof Date) return new Date(value.getTime());
    if (value && typeof value.toDate === 'function') {
        const converted = value.toDate();
        if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
            return new Date(converted.getTime());
        }
    }
    if (value && typeof value === 'object') {
        const seconds = Number(value.seconds);
        const nanoseconds = Number(value.nanoseconds);
        if (Number.isFinite(seconds)) {
            const millis = (seconds * 1000) + (Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1e6) : 0);
            const parsed = new Date(millis);
            if (!Number.isNaN(parsed.getTime())) return parsed;
        }
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(fallback.getTime());
}

function addDays(baseDate, days) {
    const date = toDate(baseDate);
    date.setDate(date.getDate() + Number(days || 0));
    return date;
}

async function mapWithConcurrency(values, concurrency, worker) {
    const items = Array.isArray(values) ? values : [];
    const limit = Math.max(1, Number(concurrency) || 1);
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
    await Promise.all(workers);
    return results;
}

function joinParts(parts, separator = ' · ') {
    return (Array.isArray(parts) ? parts : [])
        .map((part) => cleanOptionalString(part))
        .filter(Boolean)
        .join(separator) || null;
}

function normalizeEntityType(kind) {
    const value = String(kind || '').trim().toLowerCase();
    if (value === 'lead' || value === 'leads' || value === 'enquiry' || value === 'enquiries') return 'lead';
    if (value === 'student' || value === 'students') return 'student';
    if (value === 'course' || value === 'courses') return 'course';
    if (value === 'classroom' || value === 'classrooms') return 'classroom';
    throw new Error(`Unsupported recycle-bin entity: ${kind}`);
}

function getRootCollection(entityType) {
    if (entityType === 'lead') return CRM_LEADS;
    if (entityType === 'student') return CRM_STUDENTS;
    if (entityType === 'course') return CRM_COURSES;
    if (entityType === 'classroom') return CRM_CLASSROOMS;
    throw new Error(`Unsupported recycle-bin entity: ${entityType}`);
}

function getSourcePanelLabel(sourcePanel, entityType) {
    const value = String(sourcePanel || '').trim().toLowerCase();
    const labels = {
        enquiry: 'Enquiry',
        leads: 'Enquiry',
        'students/potential': 'Potential Students',
        'students/data': 'Student Data',
        students: 'Students',
        'courses/courses': 'Courses Catalog',
        'courses/classes': 'Class Scheduling',
        'courses/class-management': 'Class Management',
        courses: 'Courses',
        classrooms: 'Classrooms'
    };
    return labels[value] || labels[entityType] || 'CRM';
}

function getCollectionLabel(collectionName) {
    const labels = {
        [CRM_LEADS]: 'Enquiries',
        [CRM_STUDENTS]: 'Students',
        [CRM_COURSES]: 'Courses',
        [CRM_CLASSROOMS]: 'Classrooms',
        [CRM_TASKS]: 'Tasks',
        [CRM_ACTIVITIES]: 'Activities',
        [CRM_ENROLLMENTS]: 'Enrollments',
        [CRM_ATTENDANCE_SESSIONS]: 'Attendance sessions',
        [CRM_ATTENDANCE_RECORDS]: 'Attendance records',
        [CRM_SCHEDULED_SESSIONS]: 'Scheduled sessions',
        [CRM_INVOICES]: 'Invoices',
        [CRM_PAYMENTS]: 'Payments',
        [CRM_COMMISSIONS]: 'Commissions',
        [CRM_SUBMISSIONS]: 'Submissions',
        [CLASSROOM_MODULES]: 'Modules',
        [CLASSROOM_CLASSWORK]: 'Classwork',
        [CLASSROOM_MEMBERS]: 'Members',
        [CLASSROOM_LIVE_SESSIONS]: 'Live sessions',
        [ENTRANCE_TESTS]: 'Entrance tests',
        [CRM_RECYCLE_BIN]: 'Recycle entries'
    };
    return labels[String(collectionName || '').trim()] || String(collectionName || 'Records');
}

function getEntityTitle(entityType, data, rootId) {
    const source = data && typeof data === 'object' ? data : {};
    if (entityType === 'lead') {
        return mapLeadRecord({ id: rootId, ...source }, rootId).name
            || mapLeadRecord({ id: rootId, ...source }, rootId).realName
            || mapLeadRecord({ id: rootId, ...source }, rootId).email
            || mapLeadRecord({ id: rootId, ...source }, rootId).phone
            || rootId;
    }
    if (entityType === 'student') {
        return mapStudentRecord({ id: rootId, ...source }, rootId).name
            || mapStudentRecord({ id: rootId, ...source }, rootId).email
            || mapStudentRecord({ id: rootId, ...source }, rootId).phone
            || rootId;
    }
    if (entityType === 'course') {
        return mapCourseRecord({ id: rootId, ...source }, rootId).name
            || mapCourseRecord({ id: rootId, ...source }, rootId).code
            || rootId;
    }
    if (entityType === 'classroom') {
        return mapClassroomRecord({ id: rootId, ...source }, rootId).name
            || rootId;
    }
    return rootId;
}

function getEntitySubtitle(entityType, data, sourcePanel) {
    const source = data && typeof data === 'object' ? data : {};
    const sourceLabel = getSourcePanelLabel(sourcePanel, entityType);
    if (entityType === 'lead') {
        return joinParts([sourceLabel, source.stage ? `Stage: ${source.stage}` : null, source.studentId ? 'Converted' : null]);
    }
    if (entityType === 'student') {
        return joinParts([sourceLabel, source.lifecycleStage ? `Lifecycle: ${source.lifecycleStage}` : null, source.leadId ? `Lead: ${source.leadId}` : null]);
    }
    if (entityType === 'course') {
        return joinParts([sourceLabel, source.status ? `Status: ${source.status}` : null, source.code ? `Code: ${source.code}` : null]);
    }
    if (entityType === 'classroom') {
        return joinParts([sourceLabel, source.status ? `Status: ${source.status}` : null, source.courseId ? `Course: ${source.courseId}` : null]);
    }
    return sourceLabel;
}

function inferStudentSourcePanel(data) {
    const stage = String(data?.lifecycleStage || 'potential').trim().toLowerCase() || 'potential';
    if (ENROLLED_STAGES.has(stage)) return 'students/data';
    if (PRE_ENROLLMENT_STAGES.has(stage)) return 'students/potential';
    return 'students/potential';
}

function createEmptyBundle(entityType, rootId, sourcePanel) {
    return {
        rootEntityType: entityType,
        rootId,
        sourcePanel: sourcePanel || null,
        displayTitle: rootId,
        displaySubtitle: getSourcePanelLabel(sourcePanel, entityType),
        bundleDocs: [],
        seenPaths: new Set()
    };
}

function addSnapshot(bundle, snapshot, collectionName) {
    if (!snapshot || !snapshot.exists) return false;
    const path = String(snapshot.ref?.path || '').trim();
    if (!path || bundle.seenPaths.has(path)) return false;

    bundle.seenPaths.add(path);
    bundle.bundleDocs.push({
        path,
        collectionName,
        docId: snapshot.id || path.split('/').pop() || null,
        data: clone(snapshot.data ? snapshot.data() : {}),
        order: bundle.bundleDocs.length
    });
    return true;
}

async function collectTopLevelDocsByField(db, collectionName, fieldName, value, bundle) {
    const snap = await db.collection(collectionName).where(fieldName, '==', value).get();
    snap.docs.forEach((doc) => {
        addSnapshot(bundle, doc, collectionName);
    });
}

async function collectNestedDocs(db, parentPath, subcollectionName, bundle) {
    const snap = await db.doc(parentPath).collection(subcollectionName).get();
    snap.docs.forEach((doc) => {
        addSnapshot(bundle, doc, subcollectionName);
    });
}

function summarizeBundle(bundle) {
    const summaryMap = new Map();
    for (const item of bundle.bundleDocs) {
        const label = getCollectionLabel(item.collectionName);
        summaryMap.set(label, (summaryMap.get(label) || 0) + 1);
    }
    return Array.from(summaryMap.entries()).map(([label, count]) => ({ label, count }));
}

function buildImpactSummaryItem(bundle, expiresAt) {
    return {
        id: bundle.rootId,
        rootEntityType: bundle.rootEntityType,
        title: bundle.displayTitle,
        subtitle: bundle.displaySubtitle,
        sourcePanel: bundle.sourcePanel || null,
        expiresAt,
        recordCount: bundle.bundleDocs.length,
        details: summarizeBundle(bundle)
    };
}

async function collectStudentBundle(db, studentId, options = {}) {
    const rootId = cleanOptionalString(studentId);
    if (!rootId) return null;

    const rootPath = `${CRM_STUDENTS}/${rootId}`;
    const rootSnap = await db.doc(rootPath).get();
    if (!rootSnap.exists) return null;

    const rootData = rootSnap.data() || {};
    const sourcePanel = options.sourcePanel || inferStudentSourcePanel(rootData);
    const bundle = createEmptyBundle('student', rootId, sourcePanel);
    addSnapshot(bundle, rootSnap, CRM_STUDENTS);
    bundle.displayTitle = getEntityTitle('student', rootData, rootId);
    bundle.displaySubtitle = getEntitySubtitle('student', rootData, bundle.sourcePanel);

    await Promise.all([
        collectTopLevelDocsByField(db, ENTRANCE_TESTS, 'studentId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_ENROLLMENTS, 'studentId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_ATTENDANCE_SESSIONS, 'studentId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_ATTENDANCE_RECORDS, 'studentId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_INVOICES, 'studentId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_PAYMENTS, 'studentId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_COMMISSIONS, 'studentId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_TASKS, 'studentId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_ACTIVITIES, 'studentId', rootId, bundle)
    ]);

    return bundle;
}

async function collectLeadBundle(db, leadId, options = {}, visited = new Set()) {
    const rootId = cleanOptionalString(leadId);
    if (!rootId) return null;

    const rootPath = `${CRM_LEADS}/${rootId}`;
    const rootSnap = await db.doc(rootPath).get();
    if (!rootSnap.exists) return null;

    const bundle = createEmptyBundle('lead', rootId, options.sourcePanel || 'enquiry');
    addSnapshot(bundle, rootSnap, CRM_LEADS);
    bundle.displayTitle = getEntityTitle('lead', rootSnap.data() || {}, rootId);
    bundle.displaySubtitle = getEntitySubtitle('lead', rootSnap.data() || {}, bundle.sourcePanel);

    await Promise.all([
        collectTopLevelDocsByField(db, ENTRANCE_TESTS, 'leadId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_TASKS, 'leadId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_ACTIVITIES, 'leadId', rootId, bundle)
    ]);

    const leadData = rootSnap.data() || {};
    const linkedStudentId = cleanOptionalString(leadData.studentId);
    if (linkedStudentId && !visited.has(`student:${linkedStudentId}`)) {
        visited.add(`student:${linkedStudentId}`);
        const child = await collectStudentBundle(db, linkedStudentId, { sourcePanel: options.sourcePanel || 'enquiry' });
        if (child) {
            child.bundleDocs.forEach((doc) => {
                if (!bundle.seenPaths.has(doc.path)) {
                    bundle.seenPaths.add(doc.path);
                    bundle.bundleDocs.push({ ...doc, order: bundle.bundleDocs.length });
                }
            });
        }
    }

    return bundle;
}

async function collectCourseBundle(db, courseId, options = {}, visited = new Set()) {
    const rootId = cleanOptionalString(courseId);
    if (!rootId) return null;

    const rootPath = `${CRM_COURSES}/${rootId}`;
    const rootSnap = await db.doc(rootPath).get();
    if (!rootSnap.exists) return null;

    const bundle = createEmptyBundle('course', rootId, options.sourcePanel || 'courses/courses');
    addSnapshot(bundle, rootSnap, CRM_COURSES);
    bundle.displayTitle = getEntityTitle('course', rootSnap.data() || {}, rootId);
    bundle.displaySubtitle = getEntitySubtitle('course', rootSnap.data() || {}, bundle.sourcePanel);

    await Promise.all([
        collectTopLevelDocsByField(db, CRM_INVOICES, 'courseId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_PAYMENTS, 'courseId', rootId, bundle)
    ]);

    const classroomSnap = await db.collection(CRM_CLASSROOMS).where('courseId', '==', rootId).get();
    for (const classroomDoc of classroomSnap.docs) {
        const classroomId = cleanOptionalString(classroomDoc.id);
        if (!classroomId || visited.has(`classroom:${classroomId}`)) continue;
        visited.add(`classroom:${classroomId}`);
        const child = await collectClassroomBundle(db, classroomId, { sourcePanel: options.sourcePanel || 'courses/courses' });
        if (child) {
            child.bundleDocs.forEach((doc) => {
                if (!bundle.seenPaths.has(doc.path)) {
                    bundle.seenPaths.add(doc.path);
                    bundle.bundleDocs.push({ ...doc, order: bundle.bundleDocs.length });
                }
            });
        }
    }

    return bundle;
}

async function collectClassroomBundle(db, classId, options = {}) {
    const rootId = cleanOptionalString(classId);
    if (!rootId) return null;

    const rootPath = `${CRM_CLASSROOMS}/${rootId}`;
    const rootSnap = await db.doc(rootPath).get();
    if (!rootSnap.exists) return null;

    const bundle = createEmptyBundle('classroom', rootId, options.sourcePanel || 'courses/class-management');
    addSnapshot(bundle, rootSnap, CRM_CLASSROOMS);
    bundle.displayTitle = getEntityTitle('classroom', rootSnap.data() || {}, rootId);
    bundle.displaySubtitle = getEntitySubtitle('classroom', rootSnap.data() || {}, bundle.sourcePanel);

    await Promise.all([
        collectTopLevelDocsByField(db, CRM_ENROLLMENTS, 'classId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_ATTENDANCE_SESSIONS, 'classId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_ATTENDANCE_RECORDS, 'classId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_SCHEDULED_SESSIONS, 'classId', rootId, bundle),
        collectTopLevelDocsByField(db, CLASSROOM_LIVE_SESSIONS, 'classId', rootId, bundle),
        collectTopLevelDocsByField(db, CRM_SUBMISSIONS, 'classId', rootId, bundle),
        collectNestedDocs(db, rootPath, CLASSROOM_MODULES, bundle),
        collectNestedDocs(db, rootPath, CLASSROOM_CLASSWORK, bundle),
        collectNestedDocs(db, rootPath, CLASSROOM_MEMBERS, bundle)
    ]);

    return bundle;
}

async function collectArchiveBundle(db, entityType, rootId, options = {}, visited = new Set()) {
    const type = normalizeEntityType(entityType);
    if (type === 'lead') return collectLeadBundle(db, rootId, options, visited);
    if (type === 'student') return collectStudentBundle(db, rootId, options, visited);
    if (type === 'course') return collectCourseBundle(db, rootId, options, visited);
    if (type === 'classroom') return collectClassroomBundle(db, rootId, options, visited);
    throw new Error(`Unsupported recycle-bin entity: ${entityType}`);
}

async function previewArchiveRecords(db, kind, requestedIds, options = {}) {
    const entityType = normalizeEntityType(kind);
    const ids = uniqueIds(requestedIds);
    const preview = {
        requestedIds: ids,
        archiveableIds: [],
        notFoundIds: [],
        impactSummary: [],
        expiresAt: addDays(options.now || new Date(), ARCHIVE_RETENTION_DAYS).toISOString()
    };

    const results = await mapWithConcurrency(
        ids,
        options.previewConcurrency || 6,
        async (id) => ({
            id,
            bundle: await collectArchiveBundle(db, entityType, id, options, new Set())
        })
    );

    results.forEach((result) => {
        if (!result?.bundle) {
            preview.notFoundIds.push(result?.id || null);
            return;
        }
        preview.archiveableIds.push(result.id);
        preview.impactSummary.push(buildImpactSummaryItem(result.bundle, preview.expiresAt));
    });

    return preview;
}

async function writeRecycleBundle(db, bundle, context = {}) {
    const recycleRef = db.collection(CRM_RECYCLE_BIN).doc();
    const expiresAt = addDays(context.now || new Date(), ARCHIVE_RETENTION_DAYS);
    const rootData = {
        recycleId: recycleRef.id,
        rootEntityType: bundle.rootEntityType,
        rootId: bundle.rootId,
        sourcePanel: bundle.sourcePanel || null,
        deletedAt: context.now || new Date(),
        expiresAt,
        deletedByUid: context.user?.uid || null,
        deletedByEmail: context.user?.email || null,
        displayTitle: bundle.displayTitle,
        displaySubtitle: bundle.displaySubtitle,
        impactSummary: summarizeBundle(bundle),
        bundleVersion: 1,
        bundleDocCount: bundle.bundleDocs.length,
        bundlePaths: bundle.bundleDocs.map((item) => item.path)
    };

    await recycleRef.set(rootData);
    await Promise.all(bundle.bundleDocs.map((snapshot, index) =>
        recycleRef.collection('bundleDocs').doc(String(index).padStart(4, '0')).set({
            path: snapshot.path,
            collectionName: snapshot.collectionName,
            docId: snapshot.docId,
            data: clone(snapshot.data),
            order: snapshot.order,
            rootEntityType: bundle.rootEntityType,
            rootId: bundle.rootId
        })
    ));

    for (const snapshot of bundle.bundleDocs) {
        const ref = db.doc(snapshot.path);
        const liveSnap = await ref.get();
        if (liveSnap.exists) {
            await ref.delete();
        }
    }

    return rootData;
}

async function archiveRecords(db, kind, requestedIds, options = {}) {
    const entityType = normalizeEntityType(kind);
    const preview = await previewArchiveRecords(db, entityType, requestedIds, options);
    const archivedIds = [];
    const recycleIds = [];
    const rootBundles = [];

    for (const id of preview.archiveableIds) {
        const bundle = await collectArchiveBundle(db, entityType, id, options, new Set());
        if (!bundle) continue;
        rootBundles.push(bundle);
    }

    for (const bundle of rootBundles) {
        const recycleData = await writeRecycleBundle(db, bundle, options);
        archivedIds.push(bundle.rootId);
        recycleIds.push(recycleData.recycleId);
    }

    return {
        requestedIds: preview.requestedIds,
        archiveableIds: preview.archiveableIds,
        archivedIds,
        recycleIds,
        notFoundIds: preview.notFoundIds,
        impactSummary: rootBundles.map((bundle) => buildImpactSummaryItem(bundle, preview.expiresAt)),
        expiresAt: preview.expiresAt
    };
}

async function loadRecycleEntry(db, recycleId) {
    const rootId = cleanOptionalString(recycleId);
    if (!rootId) return null;

    const rootRef = db.collection(CRM_RECYCLE_BIN).doc(rootId);
    const rootSnap = await rootRef.get();
    if (!rootSnap.exists) return null;

    const bundleSnap = await rootRef.collection('bundleDocs').get();
    const bundleDocs = bundleSnap.docs
        .map((doc) => {
            const data = doc.data() || {};
            return {
                docId: doc.id,
                path: cleanOptionalString(data.path),
                collectionName: cleanOptionalString(data.collectionName),
                data: clone(data.data || {}),
                order: Number(data.order || 0)
            };
        })
        .filter((item) => item.path);

    const rootData = rootSnap.data() || {};
    return {
        recycleId: rootId,
        rootRef,
        rootData,
        bundleDocs
    };
}

async function removeRecycleEntry(entry) {
    for (const doc of entry.bundleDocs || []) {
        await entry.rootRef.collection('bundleDocs').doc(doc.docId).delete();
    }
    await entry.rootRef.delete();
}

function sortDocsForRestore(bundleDocs) {
    return Array.isArray(bundleDocs)
        ? [...bundleDocs].sort((left, right) => {
            const leftDepth = String(left.path || '').split('/').length;
            const rightDepth = String(right.path || '').split('/').length;
            if (leftDepth !== rightDepth) return leftDepth - rightDepth;
            return Number(left.order || 0) - Number(right.order || 0);
        })
        : [];
}

async function restoreRecycleEntries(db, requestedIds, options = {}) {
    const ids = uniqueIds(requestedIds);
    const restoredIds = [];
    const notFoundIds = [];
    const failed = [];

    for (const recycleId of ids) {
        const entry = await loadRecycleEntry(db, recycleId);
        if (!entry || !entry.bundleDocs.length) {
            notFoundIds.push(recycleId);
            continue;
        }

        const conflict = [];
        for (const snapshot of entry.bundleDocs) {
            const liveSnap = await db.doc(snapshot.path).get();
            if (liveSnap.exists) {
                conflict.push(snapshot.path);
                break;
            }
        }

        if (conflict.length > 0) {
            failed.push({
                id: recycleId,
                reason: `Live record already exists at ${conflict[0]}.`
            });
            continue;
        }

        const sorted = sortDocsForRestore(entry.bundleDocs);
        for (const snapshot of sorted) {
            await db.doc(snapshot.path).set(clone(snapshot.data), { merge: false });
        }
        await removeRecycleEntry(entry);
        restoredIds.push(recycleId);
    }

    return {
        requestedIds: ids,
        restoredIds,
        notFoundIds,
        failed
    };
}

async function purgeRecycleEntries(db, requestedIds, options = {}) {
    const ids = uniqueIds(requestedIds);
    const purgedIds = [];
    const notFoundIds = [];

    for (const recycleId of ids) {
        const entry = await loadRecycleEntry(db, recycleId);
        if (!entry) {
            notFoundIds.push(recycleId);
            continue;
        }
        await removeRecycleEntry(entry);
        purgedIds.push(recycleId);
    }

    return {
        requestedIds: ids,
        purgedIds,
        notFoundIds
    };
}

async function listRecycleBinEntries(db, options = {}) {
    const page = Math.max(1, Math.floor(Number(options.page || 1) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit || 50) || 50)));
    const entityTypeFilter = Array.isArray(options.entityTypes)
        ? options.entityTypes.map((item) => normalizeEntityType(item))
        : options.entityType
            ? [normalizeEntityType(options.entityType)]
            : [];
    const sourcePanelFilter = cleanOptionalString(options.sourcePanel);
    const now = options.now ? toDate(options.now) : new Date();
    const expiredOnly = options.expiredOnly === true;

    const snap = await db.collection(CRM_RECYCLE_BIN).get();
    let items = snap.docs.map((doc) => {
        const data = doc.data() || {};
        const deletedAt = toDate(data.deletedAt || now, now);
        const expiresAt = toDate(data.expiresAt || addDays(deletedAt, ARCHIVE_RETENTION_DAYS), deletedAt);
        return {
            recycleId: doc.id,
            rootEntityType: cleanOptionalString(data.rootEntityType),
            rootId: cleanOptionalString(data.rootId),
            sourcePanel: cleanOptionalString(data.sourcePanel),
            deletedAt: deletedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            deletedByUid: cleanOptionalString(data.deletedByUid),
            deletedByEmail: cleanOptionalString(data.deletedByEmail),
            displayTitle: cleanOptionalString(data.displayTitle) || doc.id,
            displaySubtitle: cleanOptionalString(data.displaySubtitle),
            impactSummary: Array.isArray(data.impactSummary) ? clone(data.impactSummary) : [],
            bundleVersion: Number(data.bundleVersion || 1),
            bundleDocCount: Number(data.bundleDocCount || 0),
            bundlePaths: Array.isArray(data.bundlePaths) ? clone(data.bundlePaths) : [],
            isExpired: expiresAt.getTime() <= now.getTime()
        };
    });

    if (entityTypeFilter.length > 0) {
        items = items.filter((item) => entityTypeFilter.includes(normalizeEntityType(item.rootEntityType)));
    }
    if (sourcePanelFilter) {
        items = items.filter((item) => String(item.sourcePanel || '').trim().toLowerCase() === sourcePanelFilter.toLowerCase());
    }
    if (expiredOnly) {
        items = items.filter((item) => item.isExpired);
    }

    items.sort((left, right) => String(right.deletedAt || '').localeCompare(String(left.deletedAt || '')));

    const total = items.length;
    const maxPage = total > 0 ? Math.ceil(total / limit) : 1;
    const safePage = Math.min(page, maxPage);
    const start = (safePage - 1) * limit;
    const pageItems = items.slice(start, start + limit);

    return {
        items: pageItems,
        page: safePage,
        limit,
        total,
        hasMore: start + limit < total
    };
}

async function purgeExpiredRecycleEntries(db, options = {}) {
    const now = options.now ? toDate(options.now) : new Date();
    const ids = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const listing = await listRecycleBinEntries(db, {
            ...options,
            now,
            expiredOnly: true,
            page,
            limit: 100
        });
        ids.push(...listing.items.map((item) => item.recycleId));
        hasMore = listing.hasMore;
        if (hasMore) {
            page += 1;
        }
    }

    if (!ids.length) {
        return {
            requestedIds: [],
            purgedIds: [],
            notFoundIds: []
        };
    }
    return purgeRecycleEntries(db, ids, options);
}

module.exports = {
    previewArchiveRecords,
    archiveRecords,
    listRecycleBinEntries,
    restoreRecycleEntries,
    purgeRecycleEntries,
    purgeExpiredRecycleEntries,
    previewBulkDelete: previewArchiveRecords,
    executeBulkDelete: archiveRecords
};
