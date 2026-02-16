# Admin & CRM Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Admin/CRM tools support the "teaching product" side: entrance tests, student profiles, and content curation/admin for specialized modes (e.g., Watch Mode).

## 2. Goals (The "Why")

- Allow managing learners at scale (profiles, tracking, exports).
- Support content workflows (especially for Watch Mode).

## 3. Requirements (The "What")

### Functional

- Entrance test flow:
  - generate links
  - collect results
  - view results in admin UI
- CRM dashboard:
  - student profiles and progress signals
  - teacher/admin actions (assignments, lifecycle)
- Watch admin tooling:
  - manage watch content and question sets

### Non-Functional

- Access control: admin UIs should not be accessible to normal users.
- Auditability: actions should be logged when they mutate data.

## 4. Data & Contracts (The "Contract")

- Admin pages:
  - `public/crm-admin.html`, `public/crm-admin.js`
  - `public/entrance-test.html`, `public/entrance-test.js`
  - `public/crm-entrance-test-result.html`, `public/crm-entrance-test-result.js`
  - `public/watch-admin.html`, `public/watch-admin.js`
- Server routes:
  - `src/routes/admin.js`
  - `src/routes/entrance-tests.js`

## 5. Verification

- Manual:
  - Load admin pages as a non-admin user -> verify access is blocked.
  - Create an entrance test -> submit results -> verify CRM result view renders.
