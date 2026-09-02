<#
.SYNOPSIS
  Release entrypoint for the V3 pronunciation services.

.DESCRIPTION
  Single mutating path for praat-api and phoneme-recognizer, driven by
  pronunciation-v3.production.json. Implements:

      Describe        - report live state vs declared state
      DeployCandidate - deploy an image at ZERO traffic behind a tag
      Promote         - move 100% traffic to one explicit revision
      Rollback        - move 100% traffic to the declared rollback revision

  Guarantees:
   * --to-latest is rejected before gcloud is invoked. It sets
     latestRevision:true, so every future deploy would take production traffic
     the moment it is created, with no smoke test.
   * IAM is never mutated. DeployCandidate SNAPSHOTS and VERIFIES access
     instead: praat-api public, phoneme-recognizer private. Cloud Run IAM is
     service-wide, not per-revision, so an IAM change during a candidate deploy
     would alter production immediately. Repair is a separate explicit act.
   * --no-allow-unauthenticated is never passed to praat-api.
   * Every compound gcloud flag is quoted as one string, because PowerShell
     parses an unquoted a=1,b=2 as an array and rejoins it with spaces. That
     silently corrupted --startup-probe and --update-env-vars three times
     during the 2026-08-03 rollout.

.EXAMPLE
  pwsh -File scripts/release/pronunciation-v3.ps1 -Action Describe
  pwsh -File scripts/release/pronunciation-v3.ps1 -Action DeployCandidate -Service praat-api -Sha 18b65ed4 -Digest sha256:... -WhatIf
  pwsh -File scripts/release/pronunciation-v3.ps1 -Action DeployCandidate -Service praat-api -Sha 18b65ed4 -Digest sha256:... -PronunciationV3Mode active
  pwsh -File scripts/release/pronunciation-v3.ps1 -Action Promote -Service praat-api -Revision praat-api-00057-fiv
  pwsh -File scripts/release/pronunciation-v3.ps1 -Action Rollback -Service praat-api

  Selecting active creates a zero-traffic candidate only. It never promotes
  that revision; smoke-test /health and /analyze/v3 before an explicit Promote.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][ValidateSet('Describe','DeployCandidate','Promote','Rollback')][string]$Action,
    [ValidateSet('praat-api','phoneme-recognizer')][string]$Service,
    [string]$Sha,
    [string]$Digest,
    [string]$Revision,
    [ValidateSet('shadow','active')][string]$PronunciationV3Mode,
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not reliably populated while param defaults are evaluated
# under -File invocation, so resolve the config path in the body.
if (-not $ConfigPath) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $ConfigPath = Join-Path $here 'pronunciation-v3.production.json'
}
if (-not (Test-Path $ConfigPath)) { throw "Release config not found: $ConfigPath" }
$cfg = Get-Content -Raw $ConfigPath | ConvertFrom-Json

function Assert-NoLatest {
    param([string[]]$Arguments)
    foreach ($a in $Arguments) {
        foreach ($bad in $cfg.forbiddenTrafficTokens) {
            if ($a -like "*$bad*") {
                throw "Refusing to run: argument '$a' contains forbidden traffic token '$bad'. Traffic must name an explicit revision."
            }
        }
    }
}

function Get-SafeCandidateTag {
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$SourceSha
    )

    # Cloud Run's tagged hostname combines the tag and service name. Keep the
    # candidate identity readable while bounding that combined name to the
    # reviewed 46-character limit.
    $combinedNameLimit = 46
    $tagServiceSeparatorLength = 3 # '---'
    $tagPrefix = 'cand'
    $maxTagLength = $combinedNameLimit - $ServiceName.Length - $tagServiceSeparatorLength
    $shaLength = [Math]::Min(12, $SourceSha.Length)
    $shaLength = [Math]::Min($shaLength, $maxTagLength - $tagPrefix.Length)
    if ($shaLength -lt 1) {
        throw "Service name '$ServiceName' leaves no room for a valid candidate tag"
    }
    return "$tagPrefix$($SourceSha.Substring(0, $shaLength))"
}

function Invoke-Gcloud {
    param([string[]]$Arguments, [switch]$AllowFailure)
    Assert-NoLatest -Arguments $Arguments
    if ($PSCmdlet.ShouldProcess("gcloud $($Arguments -join ' ')", 'execute')) {
        $out = & gcloud @Arguments 2>&1
        if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
            throw "gcloud failed (exit $LASTEXITCODE): $($out | Select-Object -Last 5)"
        }
        return $out
    }
    Write-Host "  [WhatIf] gcloud $($Arguments -join ' ')" -ForegroundColor DarkGray
    return $null
}

function Get-AccessMechanism {
    param([string]$Name)
    $json = & gcloud run services get-iam-policy $Name --region=$($cfg.region) --project=$($cfg.project) --format=json 2>$null
    if ($LASTEXITCODE -ne 0) { return 'unknown' }
    $policy = $json | ConvertFrom-Json
    $public = $policy.bindings | Where-Object { $_.members -contains 'allUsers' }
    if ($public) { return 'public' }
    return 'private'
}

function Assert-AccessUnchanged {
    param([string]$Name)
    $declared = $cfg.services.$Name.access
    $actual = Get-AccessMechanism -Name $Name
    if ($actual -eq 'unknown') { throw "Could not read IAM policy for $Name; refusing to proceed." }
    if ($actual -ne $declared) {
        throw "ACCESS DRIFT on ${Name}: declared '$declared', live '$actual'. Fix this deliberately before releasing - IAM is service-wide, not per-revision."
    }
    Write-Host "  access: $Name is $actual (as declared)" -ForegroundColor Green
}

switch ($Action) {

  'Describe' {
    Write-Host "=== Declared vs live ===" -ForegroundColor Cyan
    foreach ($name in $cfg.services.PSObject.Properties.Name) {
        $d = $cfg.services.$name
        Write-Host "`n$name" -ForegroundColor Yellow
        Write-Host ("  declared: access={0} cpu={1} mem={2} timeout={3}s maxScale={4} minScale={5}" -f `
            $d.access, $d.cpu, $d.memory, $d.timeoutSeconds, $d.maxScale, $(if ($null -eq $d.minScale) { 'none' } else { $d.minScale }))
        $live = & gcloud run services describe $name --region=$($cfg.region) --project=$($cfg.project) `
            --format="value(spec.template.spec.timeoutSeconds,status.latestReadyRevisionName)" 2>$null
        Write-Host "  live    : timeout/latestReady = $live"
        Write-Host "  access  : $(Get-AccessMechanism -Name $name)"
        Write-Host "  rollback: $($d.rollbackRevision)"
    }
    Write-Host "`nScheduler: $($cfg.scheduler.schedule) $($cfg.scheduler.timeZone) -> $($cfg.scheduler.uri)"
  }

  'DeployCandidate' {
    if (-not $Service -or -not $Sha -or -not $Digest) { throw 'DeployCandidate requires -Service, -Sha and -Digest' }
    if ($Sha -notmatch '^[0-9a-f]{7,40}$') { throw 'DeployCandidate -Sha must be 7-40 lowercase hexadecimal characters' }
    if ($Digest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'DeployCandidate -Digest must be an immutable lowercase sha256 digest' }
    if ($Service -eq 'phoneme-recognizer' -and $PronunciationV3Mode) {
        throw '-PronunciationV3Mode applies only to praat-api'
    }
    $svc = $cfg.services.$Service
    $candidateTag = Get-SafeCandidateTag -ServiceName $Service -SourceSha $Sha

    # Snapshot and verify access BEFORE any mutation. Never repair it here.
    Write-Host "Verifying access mechanism is unchanged..." -ForegroundColor Cyan
    Assert-AccessUnchanged -Name $Service

    $image = "$($svc.imageRepository)@$Digest"
    $deployArgs = @(
        'run','deploy',$Service,
        "--image=$image",
        "--region=$($cfg.region)",
        "--project=$($cfg.project)",
        '--no-traffic',
        "--tag=$candidateTag",
        "--timeout=$($svc.timeoutSeconds)",
        "--cpu=$($svc.cpu)",
        "--memory=$($svc.memory)",
        "--max-instances=$($svc.maxScale)"
    )
    if ($Service -eq 'praat-api') {
        $effectiveV3Mode = if ($PronunciationV3Mode) { $PronunciationV3Mode } else { [string]$svc.env.PRONUNCIATION_V3_MODE }
        if ($effectiveV3Mode -notin @('shadow', 'active')) { throw "Unsupported declared V3 mode: $effectiveV3Mode" }
        $recognizerUrl = [string]$svc.env.PHONEME_SERVICE_URL
        $recognizerAuth = [string]$svc.env.PHONEME_SERVICE_AUTH
        if ($recognizerUrl -notmatch '^https://[^,\s]+$' -or $recognizerAuth -ne 'google') {
            throw 'praat-api recognizer wiring is invalid'
        }
        $envFlag = "--update-env-vars=PRONUNCIATION_V3_MODE=$effectiveV3Mode,PHONEME_SERVICE_URL=$recognizerUrl,PHONEME_SERVICE_AUTH=$recognizerAuth,GIT_SHA=$Sha,BUILD_SHA=$Sha"
        $deployArgs += $envFlag
    }
    # Deliberately NO --no-allow-unauthenticated and NO IAM flags for either
    # service: gcloud run deploy preserves the existing binding, and passing the
    # flag to praat-api would take the public API offline.
    Invoke-Gcloud -Arguments $deployArgs | Out-Null
    Write-Host "Candidate deployed at 0% traffic. No production traffic changed. Smoke-test before promoting:" -ForegroundColor Yellow
    Write-Host "  https://$candidateTag---$Service-oq3kyypf4q-uc.a.run.app/health"
  }

  'Promote' {
    if (-not $Service -or -not $Revision) { throw 'Promote requires -Service and -Revision' }
    Invoke-Gcloud -Arguments @(
        'run','services','update-traffic',$Service,
        "--region=$($cfg.region)","--project=$($cfg.project)",
        "--to-revisions=$Revision=100"
    ) | Out-Null
  }

  'Rollback' {
    if (-not $Service) { throw 'Rollback requires -Service' }
    $target = if ($Revision) { $Revision } else { $cfg.services.$Service.rollbackRevision }
    Write-Host "Rolling $Service back to $target" -ForegroundColor Yellow
    Invoke-Gcloud -Arguments @(
        'run','services','update-traffic',$Service,
        "--region=$($cfg.region)","--project=$($cfg.project)",
        "--to-revisions=$target=100"
    ) | Out-Null
  }
}
