# Admin CRM Classroom Feature: Architecture & Design v2

## 1. Goal

Build a classroom layer inside the existing CRM that lets admins manage classes, modules, assignments, and review workflows, while students can view classwork, submit files or voice notes, and resubmit up to 3 times after the initial submission.

This v2 design is intentionally aligned to the current repo:

- Firebase Auth is the identity source.
- Firestore stores classroom read models.
- Firebase Storage stores uploaded files and recordings.
- `/api/**` mutations are server-authoritative.
- The current CRM admin shell in `public/crm-admin.*` remains the admin surface.

---

## 2. Constraints and Assumptions

### Hard constraints

1. `auth.uid` is the only security principal. CRM student IDs are metadata, not access-control keys.
2. The deployed API surface is Firebase Hosting -> Cloud Functions `api`, so classroom mutations must be implemented behind `/api`.
3. The repo already uses short-lived signed URLs for protected downloads. Classroom downloads should reuse that pattern.
4. Students need version history with at most 4 total attempts per assignment:
   - Attempt 1 = initial submission
   - Attempts 2-4 = up to 3 resubmissions

### Assumptions

1. CRM student profiles may exist before a student has a known Firebase `uid`.
2. CRM student profiles are expected to have an email address for classroom activation.
3. The first release does not need a denormalized `feed_items` collection.
4. The first release can use one dedicated student classroom page instead of embedding student classroom UI into the main app shell.

If assumption 2 is false for a meaningful part of the CRM, the invite-claim flow must be revisited.

---

## 3. Recommended Architecture

### 3.1 Service boundary

Use a shared classroom API router factory as the canonical mutation layer.

- Canonical router logic lives under `functions/src/routes/classrooms.js`.
- `functions/src/apiApp.js` mounts it for deployed `/api` traffic.
- `server.js` mounts a thin local adapter from `src/routes/classrooms.js` for local development.

This avoids implementing classroom business logic twice.

### 3.2 Read/write split

- Writes:
  - Create classroom
  - Invite or enroll members
  - Create modules
  - Create and update classwork
  - Start attempts
  - Finalize attempts
  - Return for revision
  - Grade
  - Generate signed download URLs

  All of the above go through `/api`.

- Reads:
  - Classroom lists
  - Classwork streams
  - Module-grouped classwork
  - Submission board snapshots

  These can be read from Firestore by authenticated clients once membership has been resolved.

### 3.3 Why no `feed_items`

Do not add `feed_items` in v2.

`classwork` already contains the fields needed for:

- stream view: `publishedAt desc`
- modules view: `moduleId`, `orderIndex`
- student completion state: joined with `submissionThreads`

Adding a feed projection now would increase write paths and sync burden without evidence that raw `classwork` queries are too slow.

---

## 4. Data Model

## 4.1 Classroom root

### `crmClassrooms/{classId}`

Fields:

- `name`
- `courseId`
- `status` (`draft`, `active`, `archived`)
- `ownerUid`
- `createdAt`
- `updatedAt`
- `archivedAt`

Purpose:

- top-level classroom metadata
- admin list entry
- parent for all classroom subcollections

## 4.2 Enrollment bridge

### `crmClassrooms/{classId}/memberInvites/{inviteId}`

Fields:

- `role` (`student`, `teacher`)
- `crmStudentId` nullable
- `email`
- `status` (`pending`, `claimed`, `revoked`)
- `claimedUid` nullable
- `createdAt`
- `createdByUid`

Purpose:

- lets admins assign existing CRM student profiles before a student `uid` is known
- supports email-based claim on first authenticated load

### `crmClassrooms/{classId}/members/{uid}`

Fields:

- `role` (`owner`, `teacher`, `student`)
- `crmStudentId` nullable
- `status` (`active`, `inactive`)
- `displayName`
- `email`
- `joinedAt`
- `createdAt`
- `createdByUid`

Purpose:

- this is the actual authorization source for Firestore reads and Storage path checks
- document ID is always Firebase `uid`

## 4.3 Course structure

### `crmClassrooms/{classId}/modules/{moduleId}`

Fields:

- `title`
- `description`
- `orderIndex`
- `publishState` (`draft`, `published`)
- `createdAt`
- `updatedAt`

## 4.4 Classwork

### `crmClassrooms/{classId}/classwork/{workId}`

Fields:

- `type` (`assignment`, `announcement`)
- `title`
- `instructions`
- `moduleId` nullable
- `orderIndex`
- `status` (`draft`, `published`, `archived`)
- `publishedAt`
- `dueAt` nullable
- `allowVoiceNote`
- `attemptLimit` = `4`
- `attachmentRefs[]`
- `createdByUid`
- `createdAt`
- `updatedAt`

Attachment ref shape:

- `bucketName`
- `storagePath`
- `contentType`
- `bytes`
- `originalName`
- `kind` (`material`, `submission`, `audio`)
- `createdAt`
- `createdByUid`

## 4.5 Submission snapshot plus immutable history

### `crmClassrooms/{classId}/classwork/{workId}/submissionThreads/{studentUid}`

Fields:

- `studentUid`
- `crmStudentId` nullable
- `status` (`not_started`, `draft`, `submitted`, `returned`, `graded`)
- `attemptCount`
- `currentAttemptId`
- `latestSubmittedAt`
- `returnedAt`
- `gradedAt`
- `grade` nullable
- `feedbackSummary` nullable
- `createdAt`
- `updatedAt`

Purpose:

- powers the admin board
- powers the student To Do / Done view
- stores the latest state without mutating attempt history

### `crmClassrooms/{classId}/classwork/{workId}/submissionThreads/{studentUid}/attempts/{attemptId}`

Fields:

- `attemptNumber` (`1..4`)
- `status` (`draft`, `submitted`, `returned`, `superseded`, `graded`)
- `textResponse` nullable
- `attachments[]`
- `submittedAt` nullable
- `submittedByUid`
- `teacherDecision` nullable
- `teacherComment` nullable
- `createdAt`
- `updatedAt`

Purpose:

- immutable version history
- each resubmission is a new attempt document

### `crmClassrooms/{classId}/classwork/{workId}/submissionThreads/{studentUid}/comments/{commentId}`

Fields:

- `attemptId` nullable
- `senderUid`
- `senderRole`
- `message`
- `createdAt`

Purpose:

- optional two-way discussion linked to the overall thread or a specific attempt

---

## 5. Storage Model

## 5.1 Admin-uploaded class materials

Path:

`crmClassrooms/{classId}/classwork/{workId}/materials/{fileName}`

Rules intent:

- classroom staff or platform admins can write
- classroom members can read only through signed URL routes or explicit rule checks

## 5.2 Student submission files and voice notes

Path:

`crmClassrooms/{classId}/classwork/{workId}/submissionThreads/{studentUid}/attempts/{attemptId}/{fileName}`

Rules intent:

- only `studentUid` can upload into their own attempt folder
- the attempt doc must already exist and belong to that `uid`
- staff can read via signed URL route
- students can only read their own submission assets

## 5.3 Download strategy

Never store public download URLs in Firestore.

Store only storage metadata and generate short-lived signed URLs through `/api` routes, following the pattern already used for CRM speaking audio review.

---

## 6. Core Workflows

## 6.1 Enrollment

1. Admin selects a CRM student profile from the CRM.
2. Admin creates a classroom invite using the student's email and optional `crmStudentId`.
3. Student signs in with Firebase Auth.
4. Student classroom page calls a claim endpoint.
5. The API finds matching pending invites by normalized email and materializes `members/{uid}` docs.
6. From that point onward, Firestore and Storage checks use `uid`.

If no student email exists in CRM, the invite remains unresolved and the student cannot access the classroom yet.

## 6.2 Admin classwork creation

1. Admin creates a classwork draft through `/api`.
2. API returns `classId`, `workId`, and classwork metadata.
3. Browser uploads attachments directly to Storage using the classwork materials path.
4. Admin finalizes attachment metadata with a PATCH call.
5. Admin publishes the item.

## 6.3 Student submission and resubmission

1. Student opens an assignment modal.
2. Student clicks `Start attempt`.
3. API creates:
   - thread doc if missing
   - new attempt doc with `status = draft`
   - `attemptNumber`
   - upload prefix for Storage
4. Browser uploads files and optional voice note.
5. Student submits final payload through `/api`.
6. API validates:
   - membership
   - ownership
   - attempt not already submitted
   - `attemptCount <= 4`
   - attachment paths stay under the returned prefix
7. API marks the attempt submitted and updates the thread snapshot.

## 6.4 Teacher review loop

1. Admin or teacher opens the board view.
2. UI reads `submissionThreads` and groups by `status`.
3. Reviewer opens a thread and sees attempts newest-first.
4. Reviewer can:
   - return latest attempt for revision
   - grade latest attempt
   - comment on thread or attempt
5. Returning keeps the thread open for another attempt until limit 4 is reached.
6. Grading marks the thread complete.

---

## 7. UX Model

## 7.1 Admin views

### Stream

- default classroom content view
- chronological classwork ordered by `publishedAt desc`
- announcements and assignments share one list

### Modules

- grouped by `moduleId`
- ordered by module `orderIndex`, then classwork `orderIndex`

### Review Board

- admin-only
- columns derived from `submissionThreads.status`
- cards show student name, latest submitted time, and attempt count

## 7.2 Student views

### Stream

- same classwork source as admin
- student-specific CTA based on thread status

### Modules

- curriculum-oriented grouping

### To Do / Done

- not a Kanban board
- derived from `classwork` plus `submissionThreads`
- `To Do` includes `not_started`, `draft`, and `returned`
- `Done` includes `submitted` and `graded`

---

## 8. API Shape

Exact route naming can be tuned during implementation, but v2 requires these capabilities:

### Admin routes

- list classrooms
- create classroom
- update classroom metadata
- create or revoke invites
- create or update modules
- create or update classwork
- return attempt
- grade attempt
- create signed read URL for material or submission asset

### Student routes

- claim memberships by authenticated email
- start attempt
- finalize attempt
- add comment
- create signed read URL for owned submission asset

Rule:

- all mutations are API-only
- clients do not write classroom Firestore documents directly

---

## 9. Security Model

## 9.1 Firestore

1. Classroom reads require one of:
   - platform admin in `users/{uid}.isAdmin`
   - active `members/{uid}` doc for that classroom
2. Classroom writes are server-only from the client point of view.
3. Students can never read another student's `submissionThreads` or `attempts`.
4. Admin board reads are allowed for platform admins and classroom staff.

## 9.2 Storage

1. Submission uploads are limited to the authenticated owner path.
2. Submission upload writes require a matching draft attempt doc.
3. Class materials uploads are limited to staff/admin paths.
4. Downloads use signed URLs or explicit rule checks, never public files.

---

## 10. Rejected Designs

1. Top-level `enrollments` as the authorization source
   - rejected because rules cannot safely depend on arbitrary field queries

2. Composite submission doc `{classworkId}_{studentId}` with no history
   - rejected because it cannot model immutable resubmissions cleanly

3. `feed_items`
   - rejected as premature denormalization for v1

4. Storing download URLs in Firestore
   - rejected for security and URL lifetime reasons

---

## 11. Decision Summary

1. Security is based on Firebase `uid`, not CRM student IDs.
2. Enrollment uses invite-claim bridging when `uid` is unknown at admin assignment time.
3. `submissionThreads` provide the review snapshot; `attempts` provide immutable version history.
4. Maximum attempts per assignment is 4 total.
5. `classwork` is the only content source for Stream and Modules views in v2.
6. Protected files are addressed by storage path metadata plus signed URL endpoints.
