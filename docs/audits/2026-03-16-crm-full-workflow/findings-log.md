# CRM Full Workflow Findings Log

## Seeded Findings From Repo-Truth Review

### 1. Resolved: Automated CRM baseline contract failure

- Stage: `cross-cutting`
- Evidence:
  - `node scripts/crm/run-workflow-review-baseline.js`
  - current result: 25 checks passed, 0 failed
- Expected:
  - classroom-linked course reads should already be standardized on `crmCourses`
- Actual:
  - the original `crmCourses` collection contract issue has been fixed and the automated baseline is now clean
- Root cause type:
  - `resolved product bug`
- Recommended next action:
  - keep `node scripts/crm/run-workflow-review-baseline.js` in the review loop so future collection regressions are caught immediately

### 2. High: Live class hosting is not implemented in-product

- Stage: `schedule and class hosting`
- Evidence:
  - no live meeting route or model found
  - no join/start class flow found
  - nav exposes `Zoom Links` but the flow is not implemented end to end
- Expected:
  - teacher should be able to identify and host a live class from the system if this is part of the workflow
- Actual:
  - schedule and attendance exist, but live-class hosting is external/manual
- Root cause type:
  - `missing feature`
- Recommended next action:
  - decide whether the product should own meeting links and class start/join flows, or document this as an intentional external dependency

### 3. High: Homework return and revision loop is not implemented end to end

- Stage: `homework return`
- Evidence:
  - student submission persists to `crmSubmissions`
  - admin review board supports grading
  - no shipped UI flow for `returned -> revised -> resubmitted`
- Expected:
  - teacher/admin should be able to return homework with feedback and student should be able to revise and resubmit
- Actual:
  - implemented flow is effectively `turned-in -> graded`
- Root cause type:
  - `partial implementation`
- Recommended next action:
  - either build the return/revision state machine or explicitly treat homework return as off-platform/manual

### 4. Medium: Feedback persistence exists server-side but is not wired in the admin UI flow

- Stage: `homework assessment`
- Evidence:
  - grading route can persist `feedback`
  - admin UI only sends grade in the shipped review action
- Expected:
  - teacher/admin feedback should be captured in the UI path used for grading
- Actual:
  - feedback-capable backend exists, but current UI flow does not expose it properly
- Root cause type:
  - `partial implementation`
- Recommended next action:
  - wire feedback input into the review UI or remove the misleading implied capability

### 5. Medium: Student classroom flow is transitional/inconsistent

- Stage: `student classroom access and submission`
- Evidence:
  - student classroom page expects `id` while API maps `classroomId`
  - student flow depends on admin-oriented classroom access patterns
  - direct browser write to `crmSubmissions` is explicitly marked transitional in code comments
- Expected:
  - student classroom access and submission should use a dedicated, role-correct flow
- Actual:
  - access and submission logic are partially transitional
- Root cause type:
  - `partial implementation`
- Recommended next action:
  - normalize student classroom identity/loading and move submission to a dedicated server-authoritative endpoint

### 6. Medium: Facebook/Messenger intake context is not preserved as business context

- Stage: `initial enquiry`
- Evidence:
  - lead model stores source and contact fields
  - no modeled Messenger conversation history or structured intake context was found
- Expected:
  - if Facebook is a primary acquisition channel, the workflow should preserve enough context for clean handoff
- Actual:
  - the system captures source attribution but not the conversation itself
- Root cause type:
  - `manual process dependency`
- Recommended next action:
  - document the off-platform handoff or add structured intake notes/attachments for Messenger context

## Blank Finding Template

Copy this block for each new finding discovered during browser execution:

```md
### Title

- Stage:
- Severity:
- Actor affected:
- Evidence:
- Expected:
- Actual:
- Root cause type:
  - product bug
  - missing feature
  - partial implementation
  - manual process dependency
  - documentation/SOP gap
- Recommended next action:
```
