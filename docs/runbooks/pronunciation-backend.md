# Pronunciation backend release runbook

This runbook builds and verifies the versioned pronunciation backend for project
`listening-tasks-3ae34`, region `us-central1`, and Cloud Run service `praat-api`.
Building a candidate does not authorize production traffic or Firebase Hosting
deployment. Promotion requires separate explicit authorization from the user.

## Prerequisites

- Authenticate `gcloud` with access to project `listening-tasks-3ae34`.
- Ensure the Artifact Registry repository `cloud-run-source-deploy` exists in
  `us-central1`.
- Store `MW_API_KEY` in Secret Manager and expose it to the Cloud Run service;
  never put its value in this repository or command history.
- Work from a clean candidate commit and record its full Git SHA.

## Build an immutable candidate image

From the repository root:

```powershell
$sha = git rev-parse HEAD
gcloud builds submit . `
  --project listening-tasks-3ae34 `
  --config backend/cloudbuild.pronunciation.yaml `
  --substitutions "_GIT_SHA=$sha"
```

The build publishes
`us-central1-docker.pkg.dev/listening-tasks-3ae34/cloud-run-source-deploy/praat-api:<sha>`.
The build configuration does not deploy or change traffic.

## Deploy a no-traffic candidate

Only create a candidate revision when deployment authorization covers a
non-production, no-traffic revision:

```powershell
$sha = git rev-parse HEAD
$image = "us-central1-docker.pkg.dev/listening-tasks-3ae34/cloud-run-source-deploy/praat-api:$sha"
gcloud run deploy praat-api `
  --project listening-tasks-3ae34 `
  --region us-central1 `
  --image $image `
  --set-secrets "MW_API_KEY=MW_API_KEY:latest" `
  --tag pronunciation-candidate `
  --no-traffic
```

Record the tagged candidate URL. Confirm its health contract before testing:

```powershell
Invoke-RestMethod "$candidateUrl/health" | ConvertTo-Json -Depth 5
```

`schemaVersion` must be `9`, `algorithmVersion` must be
`pronunciation-reference-v1`, `analysisVersion` must be
`pronunciation-analysis-v2`, and `deploymentVersion` must equal the candidate
Git SHA.

## Candidate verification gates

Run the deterministic audits against the tagged candidate URL:

```powershell
python scripts/audit/pronunciation-reference-audit.py --base-url $candidateUrl --sample-size 100 --seed 20260711 --output test-results/pronunciation-audit-100.json
python scripts/audit/pronunciation-reference-audit.py --base-url $candidateUrl --sample-size 1000 --seed 20260711 --output test-results/pronunciation-audit-1000.json
$env:PRONUNCIATION_BACKEND_URL = $candidateUrl
npm run verify:pronounce
python -m unittest backend.test_pronunciation_reference backend.test_pronunciation_api_v2 backend.test_pronunciation_alignment_v2 -v
```

Do not promote a candidate with HTTP 500s, incorrect scoreable references,
contract violations, native graph/count mismatches, coverage below the audit
gate, or a deployment-version mismatch.

## Promotion order

Production promotion requires explicit authorization. After authorization:

1. Route backend traffic to the candidate revision.
2. Verify both legacy and v2 endpoints plus `/health`.
3. Deploy the compatible frontend.
4. Run the production Chrome smoke and a focused audit.

Never deploy the frontend first because it requires schema version 9.

## Rollback

If errors, conflict rate, or contract violations exceed the candidate baseline,
rollback the backend and frontend together:

1. Route `praat-api` traffic back to the previously verified revision.
2. Redeploy the previous compatible Firebase Hosting release.
3. Verify `/health`, v1/v2 endpoints, `car`, a conflict case, and Chrome smoke.
4. Preserve the failed audit JSON and turn every new failure into a regression
   fixture before another candidate build.
