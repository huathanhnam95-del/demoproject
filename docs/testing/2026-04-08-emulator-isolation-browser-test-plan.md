# Browser Testing Plan (Chrome): End-to-End Emulator Isolation

Goal: prove `https://localhost:8443` never touches production Firebase (Auth/Firestore/Functions/Storage) and all local writes stay inside the emulators.

## Prerequisites
- Start local dev (emulators + app server):
  - Preferred: `npm run dev`
  - Alternative: `start-emulators.bat` (or `backend/local_server/start_all_servers.bat`)
- Emulator UI: `http://localhost:4000`
- Login credentials: `C:\Cursor AI\.local\browser-test-credentials.md` (admin account)

## Automated Pass (webapp-testing / Playwright First)
- Run: `node tests/browser/emulator-isolation-browser-check.js`
- Assertions:
  - Console contains:
    - `🔧 [Modular SDK] Firebase Emulators active — local data only.`
    - `🔧 [AuthGuard] Compat emulators connected.`
  - No network requests to:
    - `firestore.googleapis.com`
    - `identitytoolkit.googleapis.com`
    - `securetoken.googleapis.com`
    - `firebasestorage.googleapis.com`
    - `*.cloudfunctions.net`
  - Emulator ports observed in traffic: `9099` (Auth) and `8080` (Firestore)

## Manual Smoke (Chrome)
1. App shell
   - Open: `https://localhost:8443/`
   - Confirm console shows the modular emulator banner.
2. Classroom (Compat)
   - Open: `https://localhost:8443/classroom.html`
   - Confirm console shows `🔧 [AuthGuard] Compat emulators connected.`
3. CRM Admin
   - Open: `https://localhost:8443/crm-admin.html`
   - Confirm no CSP violations blocking emulator requests.
   - Create or update any test entity and confirm it appears in Emulator UI Firestore.
4. Watch Admin
   - Open: `https://localhost:8443/watch-admin.html`
   - Confirm console shows `🔧 [AuthGuard] Compat emulators connected.`
   - Confirm reads/writes affect only Emulator UI Firestore (no production).

## Second Pass (Optional): Antigravity Browser Agent
If the Playwright pass is green but you want interactive confirmation or artifacts, run the same steps with the Antigravity `browser-agent` workflow (Chrome only).
