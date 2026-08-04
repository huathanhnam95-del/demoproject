<#
.SYNOPSIS
  Reproducible deploy for the V3 pronunciation services (praat-api + phoneme-recognizer).

.DESCRIPTION
  Codifies the Cloud Run and Cloud Scheduler configuration that was previously
  applied by ad-hoc gcloud commands, so production can be recreated and audited
  from the repository. Implements the promotion flow from
  docs/plans/2026-08-03-v3-production-issues-and-keepalive-plan.md §5:

      build -> deploy candidate at ZERO traffic -> smoke test -> promote explicitly

  Never uses --to-latest. That flag sets latestRevision:true, which makes every
  future deploy take production traffic the moment it is created, with no smoke
  test. Traffic is always pinned to an explicitly verified revision.

.PARAMETER Sha
  Commit to build and deploy. Must be committed - a dirty tree produces an
  image that cannot be traced back to source.

.PARAMETER Stage
  build | candidate | promote | config | rollback

.EXAMPLE
  pwsh -File scripts/deploy-pronunciation-services.ps1 -Sha 18b65ed4 -Stage build
  pwsh -File scripts/deploy-pronunciation-services.ps1 -Sha 18b65ed4 -Stage candidate
  pwsh -File scripts/deploy-pronunciation-services.ps1 -Sha 18b65ed4 -Stage promote -Revision praat-api-00057-fiv -Service praat-api

.NOTES
  PowerShell mangles comma-separated gcloud flag values: an unquoted
  a=1,b=2 is parsed as an ARRAY and rejoined with spaces, silently corrupting
  --update-env-vars and --startup-probe. Every compound flag below is quoted as
  a single string. This bit three times during the original rollout.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Sha,
    [Parameter(Mandatory)][ValidateSet('build','candidate','promote','config','rollback')][string]$Stage,
    [string]$Project = 'parselmouth',
    [string]$Region  = 'us-central1',
    [string]$Service,
    [string]$Revision,
    [string]$Digest
)

$ErrorActionPreference = 'Stop'
$RECOGNIZER_BASE_URL = 'https://phoneme-recognizer-oq3kyypf4q-uc.a.run.app'
$INVOKER_SA          = '1071929245506-compute@developer.gserviceaccount.com'

switch ($Stage) {

  'build' {
    gcloud builds submit --config=backend/cloudbuild.phoneme.yaml --substitutions=_GIT_SHA=$Sha --project=$Project .
    gcloud builds submit --config=backend/cloudbuild.pronunciation.yaml --substitutions=_GIT_SHA=$Sha --project=$Project .
    Write-Host "`nRecord the immutable digests (a tag is mutable and is NOT sufficient):" -ForegroundColor Yellow
    Write-Host '  $h=@{Authorization="Bearer $(gcloud auth print-access-token)";Accept="application/vnd.docker.distribution.manifest.v2+json"}'
    Write-Host "  (Invoke-WebRequest -Uri 'https://us-docker.pkg.dev/v2/$Project/gcr.io/phoneme-recognizer/manifests/$Sha' -Headers `$h -UseBasicParsing).Headers['Docker-Content-Digest']"
  }

  'candidate' {
    if (-not $Digest -or -not $Service) { throw 'candidate stage requires -Service and -Digest' }
    $image = if ($Service -eq 'phoneme-recognizer') {
        "gcr.io/$Project/phoneme-recognizer@$Digest"
    } else {
        "us-central1-docker.pkg.dev/$Project/cloud-run-source-deploy/praat-api@$Digest"
    }
    # BUILD_SHA/GIT_SHA are service-level env vars that OVERRIDE the image's own
    # ENV, so a stale value here makes /health misreport the running source.
    $envFlag = "--update-env-vars=GIT_SHA=$Sha,BUILD_SHA=$Sha"
    $args = @(
      'run','deploy',$Service,"--image=$image","--region=$Region","--project=$Project",
      '--no-traffic',"--tag=cand$Sha",$envFlag
    )
    if ($Service -eq 'phoneme-recognizer') { $args += '--no-allow-unauthenticated' }
    gcloud @args
    Write-Host "`nSmoke-test the candidate BEFORE promoting:" -ForegroundColor Yellow
    Write-Host "  curl https://cand$Sha---$Service-oq3kyypf4q-uc.a.run.app/health"
    Write-Host "  Expect: pronunciationV3Mode=shadow, recognizerConfigured=true, deploymentVersion=$Sha"
  }

  'promote' {
    if (-not $Revision -or -not $Service) { throw 'promote stage requires -Service and -Revision' }
    gcloud run services update-traffic $Service --region=$Region --project=$Project --to-revisions="$Revision=100"
  }

  'rollback' {
    if (-not $Revision -or -not $Service) { throw 'rollback stage requires -Service and -Revision' }
    Write-Host "Rolling $Service back to $Revision" -ForegroundColor Yellow
    gcloud run services update-traffic $Service --region=$Region --project=$Project --to-revisions="$Revision=100"
  }

  'config' {
    # ---- phoneme-recognizer -------------------------------------------------
    # /readyz startup probe, NOT tcpSocket: gunicorn binds the port in under a
    # second, so a TCP probe marks the instance ready before the model has
    # loaded and puts the whole ~50s load inside a learner's request.
    gcloud run services update phoneme-recognizer --region=$Region --project=$Project `
      "--startup-probe=httpGet.path=/readyz,initialDelaySeconds=10,periodSeconds=5,failureThreshold=24,timeoutSeconds=5" `
      --timeout=120 --cpu=2 --memory=4Gi --max-instances=2 --no-allow-unauthenticated

    # ---- praat-api ----------------------------------------------------------
    # timeout must clear _V3_HARD_TIMEOUT_SECONDS (80s); at 60s the worker was
    # killed mid-wait and the browser saw 504 on every cold start.
    gcloud run services update praat-api --region=$Region --project=$Project `
      --timeout=120 --cpu=1 --memory=2Gi --max-instances=3

    # ---- IAM ----------------------------------------------------------------
    gcloud run services add-iam-policy-binding phoneme-recognizer --region=$Region --project=$Project `
      --member="serviceAccount:$INVOKER_SA" --role='roles/run.invoker'

    # ---- keep-alive ---------------------------------------------------------
    # Every 10 min (not 15: Cloud Run reclaims idle instances around the 15 min
    # mark). OIDC audience is the BASE service URL - a tag URL is not a valid
    # audience and yields 401.
    $exists = gcloud scheduler jobs describe phoneme-recognizer-keepalive --location=$Region --project=$Project 2>$null
    $verb = if ($exists) { 'update' } else { 'create' }
    gcloud scheduler jobs $verb http phoneme-recognizer-keepalive --location=$Region --project=$Project `
      --schedule="*/10 6-23 * * *" --time-zone="Asia/Ho_Chi_Minh" `
      --uri="$RECOGNIZER_BASE_URL/readyz" --http-method=GET `
      --oidc-service-account-email=$INVOKER_SA --oidc-token-audience="$RECOGNIZER_BASE_URL" `
      --attempt-deadline=120s

    # NOTE: no --min-instances anywhere by design. Adding it would pin an
    # always-billed instance (~$37/mo at 2vCPU/4GiB) to remove a cold start the
    # keep-alive already covers during active hours.
    Write-Host "`nConfig applied. Verify no minScale annotation:" -ForegroundColor Yellow
    Write-Host "  gcloud run services describe phoneme-recognizer --region=$Region --project=$Project --format='value(spec.template.metadata.annotations)'"
  }
}
