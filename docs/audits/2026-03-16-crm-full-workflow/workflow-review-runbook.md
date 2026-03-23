# CRM Full Workflow Review Runbook

## Goal

Execute one controlled end-to-end review of the CRM workflow from Facebook enquiry through homework return, while separating:

- system-supported behavior
- system-visible but externally operated behavior
- fully manual behavior

## Pre-Run Setup

1. Run the automated baseline:

```bash
node scripts/crm/run-workflow-review-baseline.js
```

2. Prepare safe review data:

- 2 Facebook-origin leads
- 1 admin user
- 1 teacher user
- 2 student users
- 1 course
- 1 classroom
- 1 classroom schedule with at least 2 slots
- 1 placeholder meeting link if the team uses one operationally
- 2 assignments/classwork items

3. Keep evidence open while testing:

- browser console
- browser network tab
- Firestore record viewer or equivalent admin inspection path

## Evidence Standard Per Stage

For every stage, capture:

- 1 screenshot
- 1 primary network request/response
- 1 persisted-record check
- 1 note for operational owner
- 1 classification:
  - `system-supported`
  - `system-visible-but-external`
  - `manual`

## Stage Checklist

### 1. Facebook / Messenger Intake

- Create a lead with `source = facebook`.
- Use only realistic first-contact fields.
- Confirm lead appears in enquiry board and table.
- Confirm source and contact fields survive refresh.
- Check whether any Messenger context exists beyond source/contact fields.

Expected classification:

- lead record creation: `system-supported`
- conversation context/history: likely `manual`

### 2. Lead Qualification

- Move lead through `new -> contacted -> test_scheduled -> test_completed -> counseling`.
- Add one task and one activity.
- Confirm task/activity persistence and ownership.
- Record any step handled outside CRM.

### 3. Entrance Test

- Create an entrance test link.
- Submit it through the public flow.
- Confirm result appears in admin result view.
- Check whether the result materially feeds student/counseling decision making.

### 4. Lead Conversion

- Convert the lead.
- Confirm:
  - lead becomes `converted`
  - student is created
  - `acquisitionSource` remains `facebook`
  - contact and notes carry over
- Check whether student lifecycle is advanced too early by default.

### 5. Student Profile and Identity

- Populate Info, Learning Profile, Student 360, and Identity tabs.
- Generate class code.
- Test handshake lookup and force-link flow.
- Confirm persistence after reopen and refresh.

### 6. Course, Classroom, and Assignment to Class

- Create or select course.
- Create or select classroom.
- Enroll student.
- Confirm classroom membership and duplicate-enrollment protection.
- Check whether teacher visibility is immediate after assignment.

### 7. Schedule and Live-Class Readiness

- Configure classroom schedule with slots, teacher, dates, and timezone.
- Confirm schedule appears correctly in calendar/class management views.
- Inspect `Zoom Links`, `Schedule Calendar`, and `Class Management`.
- Answer:
  - where meeting link is stored
  - how teacher knows what to host
  - how class completion is recorded
  - what happens on schedule changes

Expected current-state note:

- schedule/calendar: `system-supported`
- live hosting: likely `system-visible-but-external` or `manual`

### 8. Class Delivery and Attendance

- Create an attendance session.
- Record `present`, `late`, and `absent`.
- Confirm summary, roster refresh, and at-risk indicators.
- Decide whether attendance is functioning as the actual class-completion proxy.

### 9. Homework / Classwork Assignment

- Create one announcement and one assignment.
- Attach materials if used.
- Confirm due date, module placement, and student visibility.
- Determine whether your business meaning of “homework” matches current `classwork` behavior.

### 10. Student Submission

- Submit as student using expected formats:
  - text
  - file
  - voice note if used
- Confirm submission appears in review board and student history.
- Check for direct `crmSubmissions` writes and any role/access inconsistencies.

### 11. Assessment

- Open review board as admin/teacher.
- Grade the submission.
- Confirm persistence of grade and visible status changes.
- Check whether feedback can actually be entered from the current UI.

### 12. Homework Return and Revision

- Attempt to return homework with feedback.
- Attempt to expose returned state to student.
- Attempt one resubmission flow.
- If the UI cannot do this, mark the stage as unsupported or operationally external.

## Required Negative Checks

- invalid lead creation
- duplicate lead/contact
- convert already converted lead
- duplicate enrollment
- invalid schedule slot/time
- attendance for non-member
- invisible assignment after create
- submission upload failure
- review without proper enrollment or student context
- missing returned-homework visibility

## Exit Rule

The run is complete only when each stage is marked as one of:

- passed as implemented
- failed with evidence
- unsupported/manual with evidence
