'use strict';

const { PROJECT_COLLECTIONS } = require('../access-service');

const PROJECT_OPERATION_COLLECTION = 'crmProjectOperations';
const PROJECT_CURSOR_COLLECTION = 'crmProjectCursors';
const PROJECT_EVENT_COLLECTION = 'crmProjectEvents';
const PROJECT_SUBCOLLECTIONS = Object.freeze({
    sections: 'sections',
    columns: 'columns',
    tasks: 'tasks'
});

function projectRef(db, projectId) { return db.collection(PROJECT_COLLECTIONS.projects).doc(projectId); }
function projectCollection(db, projectId, collectionName) {
    return projectRef(db, projectId).collection(collectionName);
}
function operationRef(db, operationId) { return db.collection(PROJECT_OPERATION_COLLECTION).doc(operationId); }
function cursorRef(db, cursorId) { return db.collection(PROJECT_CURSOR_COLLECTION).doc(cursorId); }
function eventRef(db, eventId) { return db.collection(PROJECT_EVENT_COLLECTION).doc(eventId); }

function readData(snapshot) { return snapshot?.exists ? (snapshot.data() || {}) : null; }
function serializeUpdateTime(value) {
    if (!value) return null;
    const seconds = value.seconds ?? value._seconds;
    const nanoseconds = value.nanoseconds ?? value._nanoseconds;
    if (((typeof seconds === 'number' && Number.isSafeInteger(seconds)) || typeof seconds === 'bigint')
        && typeof nanoseconds === 'number' && Number.isSafeInteger(nanoseconds)) {
        return { seconds: String(seconds), nanoseconds };
    }
    return value.toISOString?.() || value.toDate?.()?.toISOString?.() || null;
}
function snapshotRows(snapshot) {
    return (snapshot?.docs || []).filter((doc) => doc?.exists !== false).map((doc) => ({
        id: doc.id,
        data: doc.data() || {},
        ref: doc.ref,
        updateTime: serializeUpdateTime(doc.updateTime)
    }));
}

module.exports = {
    PROJECT_OPERATION_COLLECTION,
    PROJECT_CURSOR_COLLECTION,
    PROJECT_EVENT_COLLECTION,
    PROJECT_SUBCOLLECTIONS,
    projectRef,
    projectCollection,
    operationRef,
    cursorRef,
    eventRef,
    readData,
    serializeUpdateTime,
    snapshotRows
};
