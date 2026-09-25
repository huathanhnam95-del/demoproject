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
   * Promote proves the immutable Cloud Build archive equals the exact clean
     committed upload source, then checks the image digest and runtime shape. Rollback
     rejects a historical revision whose runtime shape differs from the live
     declaration, including recognizer concurrency and HTTP readiness probe.

.EXAMPLE
  pwsh -File scripts/release/pronunciation-v3.ps1 -Action Describe
  pwsh -File scripts/release/pronunciation-v3.ps1 -Action DeployCandidate -Service praat-api -Sha <full-commit-sha> -Digest sha256:... -BuildId <cloud-build-id> -SourceRoot <clean-release-worktree> -WhatIf
  pwsh -File scripts/release/pronunciation-v3.ps1 -Action Promote -Service praat-api -Revision <candidate-revision> -Sha <full-commit-sha> -Digest sha256:... -BuildId <cloud-build-id> -SourceRoot <clean-release-worktree>
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
    [string]$BuildId,
    [string]$SourceRoot,
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
    $public = $policy.bindings | Where-Object { $_.role -eq 'roles/run.invoker' -and $_.members -contains 'allUsers' }
    if ($public) { return 'public' }
    return 'private'
}

function Assert-AccessUnchanged {
    param([string]$Name)
    $declared = $cfg.services.$Name.access
    $json = & gcloud run services get-iam-policy $Name --region=$($cfg.region) --project=$($cfg.project) --format=json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Could not read IAM policy for $Name; refusing to proceed." }
    $policy = $json | ConvertFrom-Json
    $members = @($policy.bindings | Where-Object { $_.role -eq 'roles/run.invoker' } | ForEach-Object { $_.members })
    if ($declared -eq 'public') {
        if ($members -notcontains 'allUsers') { throw "ACCESS DRIFT on ${Name}: public invoker is absent" }
    } elseif ($members.Count -ne 1 -or $members[0] -ne "serviceAccount:$($cfg.invokerServiceAccount)") {
        throw "ACCESS DRIFT on ${Name}: private invoker membership differs from the declared compute account"
    }
    Write-Host "  access: $Name is $declared (as declared)" -ForegroundColor Green
}

function Assert-CleanSourceRoot {
    param([string]$Root, [string]$ExpectedSha)
    if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw 'DeployCandidate requires -SourceRoot naming the clean source worktree'
    }
    $head = & git -C $Root rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedSha) {
        throw "Source worktree HEAD does not match $ExpectedSha"
    }
    $dirty = & git -C $Root status --porcelain=v1 --untracked-files=all 2>$null
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Source worktree is not clean' }
    # The upload inventory is meaningful only from the exact source root.
    Push-Location -LiteralPath $Root
    try {
        $uploadFiles = & gcloud meta list-files-for-upload 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $uploadFiles) { throw 'Could not enumerate Cloud Build upload files' }
        foreach ($file in $uploadFiles) {
            $path = ([string]$file).Replace('\', '/')
            & git ls-files --error-unmatch -- $path 1>$null 2>$null
            if ($LASTEXITCODE -ne 0) { throw "Cloud Build upload includes an untracked or ignored file: $path" }
        }
    } finally {
        Pop-Location
    }
}

function Assert-BuildImage {
    param([string]$Name, [string]$SourceSha, [string]$ImageDigest, [string]$Id, [string]$Root)
    if (-not $Root) { throw 'Source verification requires -SourceRoot' }
    $helper = Join-Path $PSScriptRoot 'verify-pronunciation-source.py'
    if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
        throw "Source verification helper is missing: $helper"
    }
    & python $helper --project $cfg.project --build-id $Id --source-root $Root `
        --sha $SourceSha --image-repository $cfg.services.$Name.imageRepository --digest $ImageDigest
    if ($LASTEXITCODE -ne 0) {
        throw "Cloud Build $Id source archive did not match the exact committed upload source and image"
    }
}

function Assert-RevisionCompatible {
    param([string]$Name, [string]$RevisionName, [string]$ImageDigest, [string]$ExpectedV3Mode)
    if ($RevisionName -notmatch "^$([regex]::Escape($Name))-[0-9]{5}-[a-z0-9]+$") {
        throw "Revision $RevisionName does not belong to $Name"
    }
    $json = & gcloud run revisions describe $RevisionName --region=$($cfg.region) --project=$($cfg.project) --format=json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Could not read revision $RevisionName" }
    $revision = $json | ConvertFrom-Json
    $service = $cfg.services.$Name
    $container = $revision.spec.containers[0]
    $ready = @($revision.status.conditions | Where-Object { $_.type -eq 'Ready' -and [string]$_.status -eq 'True' })
    $expectedImage = "$($service.imageRepository)@"
    if ($ready.Count -ne 1 -or -not ([string]$revision.status.imageDigest).StartsWith($expectedImage)) {
        throw "Revision $RevisionName is not ready with an immutable declared image"
    }
    if ($ImageDigest -and $revision.status.imageDigest -ne "$expectedImage$ImageDigest") {
        throw "Revision $RevisionName image digest does not match the reviewed build"
    }
    if ([string]$container.resources.limits.cpu -ne [string]$service.cpu -or
        [string]$container.resources.limits.memory -ne [string]$service.memory -or
        [int]$revision.spec.timeoutSeconds -ne [int]$service.timeoutSeconds -or
        [int]$revision.spec.containerConcurrency -ne [int]$service.containerConcurrency -or
        [int]$revision.metadata.annotations.'autoscaling.knative.dev/maxScale' -ne [int]$service.maxScale -or
        $null -ne $revision.metadata.annotations.'autoscaling.knative.dev/minScale' -or
        [string]$revision.spec.serviceAccountName -ne [string]$cfg.invokerServiceAccount) {
        throw "Revision $RevisionName differs from the declared runtime shape"
    }
    if ($Name -eq 'phoneme-recognizer') {
        $want = $service.startupProbe
        $have = $container.startupProbe
        if ($have.httpGet.path -ne $want.httpGet.path -or
            [int]$have.initialDelaySeconds -ne [int]$want.initialDelaySeconds -or
            [int]$have.periodSeconds -ne [int]$want.periodSeconds -or
            [int]$have.failureThreshold -ne [int]$want.failureThreshold -or
            [int]$have.timeoutSeconds -ne [int]$want.timeoutSeconds) {
            throw "Revision $RevisionName lacks the declared HTTP readiness probe"
        }
    } else {
        $expectedMode = if ($ExpectedV3Mode) { $ExpectedV3Mode } else { [string]$service.env.PRONUNCIATION_V3_MODE }
        $expectedEnv = [ordered]@{
            PRONUNCIATION_V3_MODE = $expectedMode
            PHONEME_SERVICE_URL = $service.env.PHONEME_SERVICE_URL
            PHONEME_SERVICE_AUTH = $service.env.PHONEME_SERVICE_AUTH
        }
        foreach ($key in $expectedEnv.Keys) {
            $actual = @($container.env | Where-Object { $_.name -eq $key })
            if ($actual.Count -ne 1 -or [string]$actual[0].value -ne [string]$expectedEnv[$key]) {
                throw "Revision $RevisionName has unexpected nonsecret $key configuration"
            }
        }
    }
    Write-Host "  revision: $RevisionName is ready with declared runtime shape" -ForegroundColor Green
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
    if (-not $Service -or -not $Sha -or -not $Digest -or -not $BuildId -or -not $SourceRoot) {
        throw 'DeployCandidate requires -Service, full -Sha, -Digest, -BuildId and -SourceRoot'
    }
    if ($Sha -notmatch '^[0-9a-f]{40}$') { throw 'DeployCandidate -Sha must be a full lowercase Git commit SHA' }
    if ($Digest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'DeployCandidate -Digest must be an immutable lowercase sha256 digest' }
    if ($Service -eq 'phoneme-recognizer' -and $PronunciationV3Mode) {
        throw '-PronunciationV3Mode applies only to praat-api'
    }
    $svc = $cfg.services.$Service
    $candidateTag = Get-SafeCandidateTag -ServiceName $Service -SourceSha $Sha

    # A clean exact commit, tracked upload set, successful build record and IAM
    # must all be checked before creating even a zero-traffic revision.
    Assert-CleanSourceRoot -Root $SourceRoot -ExpectedSha $Sha
    Assert-BuildImage -Name $Service -SourceSha $Sha -ImageDigest $Digest -Id $BuildId -Root $SourceRoot
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
        "--concurrency=$($svc.containerConcurrency)",
        "--max-instances=$($svc.maxScale)"
    )
    # Remove old service-level source labels so image-baked provenance is
    # visible. Cloud Run applies this before --update-env-vars when both exist.
    $deployArgs += '--remove-env-vars=GIT_SHA,BUILD_SHA'
    if ($Service -eq 'praat-api') {
        $effectiveV3Mode = if ($PronunciationV3Mode) { $PronunciationV3Mode } else { [string]$svc.env.PRONUNCIATION_V3_MODE }
        if ($effectiveV3Mode -notin @('shadow', 'active')) { throw "Unsupported declared V3 mode: $effectiveV3Mode" }
        $recognizerUrl = [string]$svc.env.PHONEME_SERVICE_URL
        $recognizerAuth = [string]$svc.env.PHONEME_SERVICE_AUTH
        if ($recognizerUrl -notmatch '^https://[^,\s]+$' -or $recognizerAuth -ne 'google') {
            throw 'praat-api recognizer wiring is invalid'
        }
        $envFlag = "--update-env-vars=PRONUNCIATION_V3_MODE=$effectiveV3Mode,PHONEME_SERVICE_URL=$recognizerUrl,PHONEME_SERVICE_AUTH=$recognizerAuth"
        $deployArgs += $envFlag
    } else {
        $probe = $svc.startupProbe
        $probeFlag = "--startup-probe=httpGet.path=$($probe.httpGet.path),initialDelaySeconds=$($probe.initialDelaySeconds),periodSeconds=$($probe.periodSeconds),failureThreshold=$($probe.failureThreshold),timeoutSeconds=$($probe.timeoutSeconds)"
        $deployArgs += $probeFlag
    }
    # Deliberately NO --no-allow-unauthenticated and NO IAM flags for either
    # service: gcloud run deploy preserves the existing binding, and passing the
    # flag to praat-api would take the public API offline.
    Invoke-Gcloud -Arguments $deployArgs | Out-Null
    Write-Host "Candidate deployed at 0% traffic. No production traffic changed. Smoke-test before promoting:" -ForegroundColor Yellow
    Write-Host "  https://$candidateTag---$Service-oq3kyypf4q-uc.a.run.app/health"
  }

  'Promote' {
    if (-not $Service -or -not $Revision -or -not $Sha -or -not $Digest -or -not $BuildId -or -not $SourceRoot) {
        throw 'Promote requires -Service, -Revision, full -Sha, -Digest, -BuildId and -SourceRoot'
    }
    if ($Sha -notmatch '^[0-9a-f]{40}$' -or $Digest -notmatch '^sha256:[0-9a-f]{64}$') {
        throw 'Promote requires a full lowercase Git SHA and immutable image digest'
    }
    Assert-BuildImage -Name $Service -SourceSha $Sha -ImageDigest $Digest -Id $BuildId -Root $SourceRoot
    Assert-AccessUnchanged -Name $Service
    Assert-RevisionCompatible -Name $Service -RevisionName $Revision -ImageDigest $Digest -ExpectedV3Mode $PronunciationV3Mode
    Invoke-Gcloud -Arguments @(
        'run','services','update-traffic',$Service,
        "--region=$($cfg.region)","--project=$($cfg.project)",
        "--to-revisions=$Revision=100"
    ) | Out-Null
  }

  'Rollback' {
    if (-not $Service) { throw 'Rollback requires -Service' }
    $target = if ($Revision) { $Revision } else { $cfg.services.$Service.rollbackRevision }
    Assert-AccessUnchanged -Name $Service
    Assert-RevisionCompatible -Name $Service -RevisionName $target
    Write-Host "Rolling $Service back to $target" -ForegroundColor Yellow
    Invoke-Gcloud -Arguments @(
        'run','services','update-traffic',$Service,
        "--region=$($cfg.region)","--project=$($cfg.project)",
        "--to-revisions=$target=100"
    ) | Out-Null
  }
}
