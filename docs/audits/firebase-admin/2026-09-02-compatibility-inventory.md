# Firebase Admin Compatibility Inventory (FBASE-ADMIN-14-01)

- **Date:** 2026-09-02
- **Author:** Antigravity (Advanced Agentic Assistant)
- **Node Engine:** Node 22 (`functions/package.json`, `package.json`)
- **Upgrade Target:** `firebase-admin` 12.7.0 -> 13.6.0 (functions codebase alignment with root)

---

## 1. Inventory of Firebase Admin Surfaces

| Component | Current Usage Pattern | v13 / Node 22 Compatibility Status | Action Required |
|---|---|---|---|
| **App Initialization** (`functions/src/index.js`, `utils/firebase_admin_init.js`) | `const { initializeApp, getApps } = require('firebase-admin/app');` | Fully compatible. Standard modular subpath. | None. |
| **Firestore Database** (`functions/src/`, `src/utils/firebase.js`) | `const { getFirestore } = require('firebase-admin/firestore');` and `admin.firestore()` | Fully compatible. No deprecated legacy query methods used. | None. |
| **Auth & Token Verification** (`functions/src/middleware/`, `src/`) | `const { getAuth } = require('firebase-admin/auth');` | Fully compatible. Emulator mode guard already present in `src/utils/firebase.js`. | None. |
| **Cloud Storage** (`functions/src/utils/firebase_admin_init.js`, `src/utils/firebase.js`) | `const { getStorage } = require('firebase-admin/storage');` | Fully compatible with `@google-cloud/storage`. | None. |
| **FieldValue Timestamps / Transforms** | Standard `FieldValue.serverTimestamp()`, `FieldValue.increment()` | Fully compatible in v13. | None. |

---

## 2. Dependencies & Runtime Alignment

- **Root `package.json`:** `"firebase-admin": "^13.6.0"`, `"express": "^5.2.1"`.
- **Functions `package.json` (Prior):** `"firebase-admin": "^12.7.0"`, `"firebase-functions": "^7.3.2"`.
- **Target `functions/package.json`:** Align `"firebase-admin": "^13.6.0"` to ensure unified type contracts, token parsing rules, and clean Node 22 compatibility.

---

## 3. Pre-Upgrade Regression Risk Assessment

- **Risk 1 (Emulator Token Hangs):** Already mitigated via `isEmulatorMode` check in `src/utils/firebase.js`.
- **Risk 2 (Cloud Run / Functions Interop):** Functions endpoints use standard Express middleware and JSON serialization; no breaking v13 contract changes affect callable or HTTP handlers.
- **Risk 3 (Deployment Scoping):** Deployments must remain isolated and non-mutating (`FUNCTIONS_DISCOVERY_TIMEOUT=60` and scoped predeploy).
