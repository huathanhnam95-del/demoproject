# Audit Automation (Playwright)

This folder contains reproducible audit runners used to empirically validate onboarding and feature journeys.

## Prerequisites

- Node.js available (`node -v`)
- Dependencies installed (`npm install`)
- Playwright Chromium installed once:
  - `npx playwright install chromium`

## Run: A2 Vietnamese PTE onboarding audit

Starts the local server, runs Playwright scenarios, and writes artifacts under `docs/audits/.../artifacts/`.

```bash
node scripts/audit/run-a2-onboarding-audit.js --base-url http://localhost:8443
```

Options:

- `--no-server` (use if you already started `node server.js`)
- `--headed` (shows the browser UI)
- `--output-root <path>` (override artifacts root)
- `--full-only` (run only the 2 "full flow" scenarios)
- `--allow-ai-calls` (DANGER: may use API keys and incur cost)

## Outputs

- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/*.png`
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/videos/*.webm`
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/logs/*.json`
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/*__audit-run.json`
