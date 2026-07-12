# Pronunciation Audit Campaign Runbook

This runbook guides operators through executing the Pronunciation Audit Campaign to verify a candidate deployment against 3,000 words.

## Prerequisites & Candidate URL

Before running the campaign, you must deploy the pronunciation backend candidate and configure the candidate endpoint.

Set the base URL environment variable (do not run directly against production):
```powershell
$env:PRONUNCIATION_AUDIT_BASE_URL = "https://<candidate-url>"
```

## Commands Reference

Run the campaign steps sequentially:

### 1. Freeze the Manifest
Generates 3,000 deterministic-ally sampled words (from Oxford 5000 and CMU agreement) using seed `20260712`:
```powershell
npm run campaign:pronounce:manifest
```

### 2. Execute Cohorts
Audits each cohort (1,000 words each). Do **not** run cohorts concurrently against the same ledger.

```powershell
# Cohort 1
npm run campaign:pronounce:cohort1

# Cohort 2
npm run campaign:pronounce:cohort2

# Cohort 3
npm run campaign:pronounce:cohort3
```

### 3. Aggregate Reports
Aggregates completed cohorts into cumulative reports and computes overall gate status without re-requesting words:

```powershell
# Cumulative 1,000-word Report
npm run campaign:pronounce:report1000

# Cumulative 2,000-word Report
npm run campaign:pronounce:report2000

# Cumulative 3,000-word Report
npm run campaign:pronounce:report3000
```

## Expected Runtime and API Load
- **Workers count:** 6 threads.
- **Estimated runtime:** ~10-15 minutes per cohort (depending on network latency to the dictionary server and acoustic analysis backend).
- **API Load:** Max 6 requests/sec rate-limit friendly behavior.

## Resume Behavior
If an execution is interrupted, simply re-run the cohort command. The CLI automatically reads `test-results/pronunciation-audit-3000/ledger.jsonl` to check which words already have `complete` or `terminal_failure` records under the current manifest hash, deployment, and algorithm versions, and skips them.

## Manual Review and Defects
1. At each checkpoint, inspect `test-results/pronunciation-audit-3000/review-queue.json`.
2. Every gate failure in the queue should be diagnosed.
3. Once a defect is identified:
   - Convert the failing word/case into a regression fixture inside the tests.
   - Fix the defect in the code.
   - Redeploy the candidate.
   - Restart the cohort audit (the ledger will automatically ignore old logs if the deployment version/Git SHA changes, ensuring you re-audit the cohort under the new code).

## Archiving
Keep all artifacts under `test-results/pronunciation-audit-3000/` and commit them to git with version tags corresponding to the candidate revision.
