# Admin & CRM Spec

**Status**: Implemented and expanded
**Owner**: Admin

## 1. Overview
>
> Admin/CRM tools support the "teaching product" side: entrance tests, student profiles, and content curation/admin for specialized modes (e.g., Watch Mode).

The CRM surface now covers the standardized operational workflow around leads, students, classrooms, attendance, finance, communications, reporting, and governance.

## 2. Goals (The "Why")

- Allow managing learners at scale (profiles, tracking, exports).
- Support content workflows (especially for Watch Mode).
- Standardize the full lead-to-enrollment-to-retention lifecycle in one admin shell.
- Provide operational reporting, automation, and auditability for counselors, teachers, and finance admins.

## 3. Requirements (The "What")

### Functional

- Entrance test flow:
  - generate links
  - collect results
  - view results in admin UI (with word-level color-coded visual diffs)
  - produce visually polished highly-readable PDF exports
- CRM dashboard:
  - student profiles and progress signals (accessible via persistent crmId deep-links)
  - teacher/admin actions (assignments, lifecycle)
  - funnel, revenue, duplicate, and audit reporting
- Lead pipeline:
  - create leads
  - stage progression
  - lead conversion into student records
- Class Scheduling:
  - Google Calendar-style suggestive UX for scheduling class sessions
  - fast click-to-create workflows with full administrative control
- Activity management:
  - activity timeline
  - follow-up tasks and reminder states
- Enrollment & attendance:
  - classroom enrollment records
  - attendance session creation
  - bulk attendance capture
  - at-risk flags from attendance and score signals
- Finance:
  - invoices
  - payments
  - commission records
- Communications:
  - templates
  - automation rules
  - queued communication entries
- Governance:
  - duplicate detection
  - merge job queue
  - audit log retrieval
- Bulk data controls:
  - dry-run export/import scripts for CRM collections
- Watch admin tooling:
  - manage watch content and question sets

### Non-Functional

- Access control: admin UIs should not be accessible to normal users.
- Auditability: actions should be logged when they mutate data.
- Standardized collections should remain segregated under `crm*` namespaces.
- Verification should include route-contract tests, service tests, smoke scripts, and linting.

## 4. Data & Contracts (The "Contract")

- Admin pages:
  - `public/crm-admin.html`, `public/crm-admin.js`
  - `public/js/crm/*.js`
  - `public/entrance-test.html`, `public/entrance-test.js`
  - `public/crm-entrance-test-result.html`, `public/crm-entrance-test-result.js`
  - `public/watch-admin.html`, `public/watch-admin.js`
- Server routes:
  - `src/routes/admin.js`
  - `src/routes/entrance-tests.js`
  - `functions/src/routes/admin/*.js`
- Services:
  - `functions/src/crm/*.js`
- Scripts:
  - `scripts/crm/*.js`

## 5. Verification

- Manual:
  - Load admin pages as a non-admin user -> verify access is blocked.
  - Create an entrance test -> submit results -> verify CRM result view renders.
- Automated:
  - `npm run verify:crm`
