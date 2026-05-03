# PTE Speaking Attempts: Mixed Retention, Bookmarking, Sharing, and Expiring Student Access

## Summary
- Any authenticated user can submit speaking attempts for `read_aloud`, `repeat_sentence`, and future speaking modes. Guests cannot submit.
- Active students keep attempts permanently. Logged-in non-students keep attempts for 10 days unless they bookmark them.
- Logged-in non-students can bookmark up to 5 submissions. If they hit the limit, the UI should let them remove one or more bookmarks before adding a new one.
- When a non-student becomes an active student, all existing undeleted attempts should be promoted out of the deletion queue.
- When student access later expires, only new submissions after the expiry point go back into the deletion queue.

## Execution Changelog
- 2026-04-11: Execution runbook (items 2-12, item 1 intentionally skipped) selected as implementation target for this phase.

## CRM and Retention Model
- CRM supports expiring practice access via enrollment windows and a student-level override (implemented in Cloud Functions).
- Practice-access window on enrollment records:
  - `practiceAccessStartAt`
  - `practiceAccessEndAt`
- Student-level override fields:
  - `practiceAccessOverrideMode: inherit | force_active | force_inactive`
  - `practiceAccessOverrideStartAt`
  - `practiceAccessOverrideEndAt`
  - `practiceAccessOverrideNote`
- Treat effective student status as a server-side resolution:
  - `force_inactive` wins first
  - `force_active` grants access inside its window
  - otherwise, any linked active enrollment inside its window grants access
  - otherwise, the user is treated as a non-student
- Update claim sync so `isStudent` can be granted and revoked from the same entitlement resolver. The speaking-attempt subsystem must not rely on the token claim alone.

## Attempt Lifecycle
- Keep the server-owned attempt record and its immutable core after submission.
- Add retention fields to each attempt:
  - `retentionState`
  - `deleteAfterAt`
  - `bookmark`
  - `accessSnapshot`
  - `promotion`

### `accessSnapshot` schema (stored on attempt at submit time)
- `resolvedAt: Date`
- `effectiveStatus: 'student' | 'nonstudent'`
- `source: 'override_force_inactive' | 'override_force_active' | 'enrollment_window' | 'none'`
- `studentId: string | null`
- `enrollmentIds: string[]`
- `effectiveWindowStartAt: Date | null`
- `effectiveWindowEndAt: Date | null`

### `promotion` schema (present when an attempt is promoted to permanent retention)
- `promotedAt: server timestamp`
- `triggeredBy: 'entitlement_change'`
- `previousRetentionState: string | null`

### Retention states
- `student_permanent`
- `promoted_student`
- `nonstudent_ttl`
- `nonstudent_bookmarked`
- Submission rules:
  - Active student at submit time: permanent retention.
  - Logged-in non-student, not bookmarked: delete after 10 days.
  - Logged-in non-student, bookmarked: preserved until unbookmarked.
- Bookmark rules:
  - Add a bookmark toggle for the owner.
  - Count only bookmarked non-student attempts toward the 5-bookmark cap.
  - If a user already has 5 bookmarked non-student attempts, reject the new bookmark action and return the current bookmarked attempts so the UI can prompt the user to remove one or more.
  - If a bookmark is removed and the 10-day window has already passed, give a fixed 24-hour grace period before purge.

## Sharing and Feedback
- Keep permanent secret share links for attempts while the underlying attempt exists.
- Share links should continue to work for both students and non-students during the retention window.
- Teacher feedback stays supported for text and voice, with `private` as the default visibility.
- If an expiring attempt is deleted, delete its share record, feedback documents, feedback audio, and original recording together.

## Cleanup and Promotion
- Use a scheduled cleanup job rather than Firestore TTL alone so deletion can cascade through attempt docs, share docs, feedback docs, and Storage objects.
- When a user becomes an active student, run a promotion job for all of their undeleted attempts so they leave the deletion queue.
- When student access expires, do not rewrite old permanent attempts. Only future submissions should use non-student retention rules.
- Add a periodic reconciliation job (every few hours) to re-evaluate entitlement changes and catch missed promotions or stale claim state.

## Test Plan
- Guests cannot submit.
- Logged-in non-students can submit and default to 10-day retention.
- Bookmarking works for logged-in non-students and stops at 5 bookmarks.
- The bookmark picker flow is triggered when the user tries to exceed the cap.
- Active students submit permanently and retain access after submission.
- Non-student attempts are promoted when the user becomes an active student.
- Student expiry moves future submissions back into the deletion queue.
- Share links and feedback stay available while an attempt exists, then disappear with the deleted attempt.
- CRM override and enrollment-window logic produce the correct effective access state in all combinations.

## Assumptions
- "Saved into database" means an attempt is promoted to permanent retention when the user becomes a student, not restored from a deleted state.
- The 5-bookmark limit applies only to non-student attempts that rely on bookmark protection.
- Old permanent attempts stay permanent even if the student later expires.
- Non-student attempts can still be shared and reviewed while they exist.
