# Pronunciation backend release runbook

This runbook builds and verifies the versioned pronunciation backend for project
`parselmouth`, region `us-central1`, and Cloud Run service `praat-api`.
Building a candidate does not authorize production traffic or Firebase Hosting
deployment. Promotion requires separate explicit authorization from the user.

## Prerequisites

- Authenticate `gcloud` with access to project `parselmouth`.
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
  --project parselmouth `
  --config backend/cloudbuild.pronunciation.yaml `
  --substitutions "_GIT_SHA=$sha"
```

The build publishes
`us-central1-docker.pkg.dev/parselmouth/cloud-run-source-deploy/praat-api:<sha>`.
The build configuration does not deploy or change traffic.

## Deploy a no-traffic candidate

Only create a candidate revision when deployment authorization covers a
non-production, no-traffic revision:

```powershell
$sha = git rev-parse HEAD
$image = "us-central1-docker.pkg.dev/parselmouth/cloud-run-source-deploy/praat-api:$sha"
gcloud run deploy praat-api `
  --project parselmouth `
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
`pronunciation-reference-v3`, `analysisVersion` must be
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

## CMU lexical fallback policy

Merriam-Webster remains primary. When it has no valid exact pronunciation, the
backend may look up the exact normalized word in the bundled CMU Pronouncing
Dictionary and convert its ARPAbet phonemes deterministically to American IPA.

CMU fallback variants are explicitly labeled with provider
`cmu-pronouncing-dictionary` and transcription `cmu-arpabet-converted`. They
never inherit a Merriam-Webster definition or audio file, and they always set
`playAudio: false` and `showNativeGraphs: false`. They may support lexical
syllable-count and stress practice, but never native contour comparisons or
native stress calibration. Audit reports expose `runtimeFallbackValidated`
separately and exclude these variants from `cmuCorroborated`.

## IAM configuration for private Cloud Run authentication

The `praat-api` service calls the `phoneme-recognizer` service over private
Cloud Run.  The recognizer must reject unauthenticated traffic; `praat-api`
authenticates with a Google-managed identity token derived from its runtime
service account.

### Runtime identity

```
praat-api-runtime@parselmouth.iam.gserviceaccount.com
```

### Setup checklist

Each step below is a **deployment-gated command** — run it only when
authorised.  Never create or download service-account keys.

- [ ] **Create the runtime service account** (skip if it already exists):

  ```powershell
  gcloud iam service-accounts create praat-api-runtime `
    --project parselmouth `
    --display-name "praat-api Cloud Run runtime identity"
  ```

- [ ] **Attach the runtime identity to praat-api**:

  ```powershell
  gcloud run services update praat-api `
    --project parselmouth `
    --region us-central1 `
    --service-account praat-api-runtime@parselmouth.iam.gserviceaccount.com
  ```

- [ ] **Disable unauthenticated access to phoneme-recognizer**:

  ```powershell
  gcloud run services remove-iam-policy-binding phoneme-recognizer `
    --project parselmouth `
    --region us-central1 `
    --member "allUsers" `
    --role "roles/run.invoker"
  ```

- [ ] **Grant invoker role to the runtime identity on phoneme-recognizer**:

  ```powershell
  gcloud run services add-iam-policy-binding phoneme-recognizer `
    --project parselmouth `
    --region us-central1 `
    --member "serviceAccount:praat-api-runtime@parselmouth.iam.gserviceaccount.com" `
    --role "roles/run.invoker"
  ```

> **Note:** These are deployment-gated commands.  Do not automate them in CI
> pipelines.  Do NOT create or download service-account JSON keys.

### Verification

After applying the IAM changes, confirm with:

```powershell
gcloud run services get-iam-policy phoneme-recognizer `
  --project parselmouth `
  --region us-central1 `
  --format json
```

The output should include the runtime service account with
`roles/run.invoker` and should **not** include `allUsers`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PHONEME_SERVICE_URL` | Yes | Full URL of the phoneme-recognizer Cloud Run service (e.g. `https://phoneme-recognizer-abc123-uc.a.run.app`) |
| `PHONEME_SERVICE_AUTH` | No (default `google`) | `"google"` for production (uses IAM identity token). `"disabled"` for local dev only (localhost/127.0.0.1, and `K_SERVICE` must be absent). |
| `K_SERVICE` | Auto | Automatically set by Cloud Run. The phoneme client uses this to prevent `auth=disabled` from running in production. |
| `BUILD_SHA` | Yes | Git commit hash for version tracking. Set via `--set-env-vars` during deploy. |
| `PRONUNCIATION_V3_MODE` | Yes | Controls v3 segmentation pipeline: `off` (disabled), `shadow` (run but don't serve), `active` (serve results). |
| `MW_API_KEY` | Yes | Merriam-Webster API key (mounted from Secret Manager). |

## Rollback

If errors, conflict rate, or contract violations exceed the candidate baseline,
rollback the backend and frontend together:

1. Route `praat-api` traffic back to the previously verified revision.
2. Redeploy the previous compatible Firebase Hosting release.
3. Verify `/health`, v1/v2 endpoints, `car`, a conflict case, and Chrome smoke.
4. Preserve the failed audit JSON and turn every new failure into a regression
   fixture before another candidate build.
