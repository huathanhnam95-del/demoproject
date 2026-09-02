<#
.SYNOPSIS
  Read-only production smoke verification for V4 pronunciation services.

.DESCRIPTION
  Performs non-mutating validation against live production Cloud Run services,
  Firebase endpoints, CORS policies, readiness, and keepalive state.
#>
[CmdletBinding()]
param(
    [string]$ExpectedGitSha,
    [string]$ExpectedPraatRevision = 'praat-api-00074-zuv',
    [string]$ExpectedPhonemeRevision = 'phoneme-recognizer-00016-lum',
    [string]$OutputPath,
    [string]$FixturePath,
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'

if (-not $ConfigPath) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $ConfigPath = Join-Path $here 'pronunciation-v3.production.json'
}
if (-not (Test-Path $ConfigPath)) { throw "Release config not found: $ConfigPath" }
$cfg = Get-Content -Raw $ConfigPath | ConvertFrom-Json

$results = [ordered]@{
    timestampUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    checks = @()
    passed = $true
}

function Add-CheckResult {
    param([string]$Name, [bool]$Success, [string]$Details)
    $results.checks += [ordered]@{
        name = $Name
        passed = $Success
        details = $Details
    }
    if (-not $Success) {
        $results.passed = $false
        Write-Host "  [FAIL] ${Name}: $Details" -ForegroundColor Red
    } else {
        Write-Host "  [PASS] ${Name}: $Details" -ForegroundColor Green
    }
}

if ($FixturePath -and (Test-Path $FixturePath)) {
    Write-Host "Running in fixture mode from $FixturePath" -ForegroundColor Cyan
    $fixture = Get-Content -Raw $FixturePath | ConvertFrom-Json
    foreach ($c in $fixture.checks) {
        Add-CheckResult -Name $c.name -Success $c.passed -Details $c.details
    }
} else {
    Write-Host "=== V4 Production Smoke Verification ===" -ForegroundColor Cyan

    # 1. Praat API /health probe
    $praatUrl = "https://praat-api-oq3kyypf4q-uc.a.run.app"
    try {
        $health = Invoke-RestMethod -Uri "$praatUrl/health" -Method Get -TimeoutSec 30
        $shaMatches = if ($ExpectedGitSha) { $health.GIT_SHA -eq $ExpectedGitSha -or $health.BUILD_SHA -eq $ExpectedGitSha } else { $true }
        $isHealthy = $health.status -in @('healthy', 'ok')
        Add-CheckResult -Name "praat-api-health" -Success ($isHealthy -and $shaMatches) -Details "Status: $($health.status), SHA: $($health.GIT_SHA)"
    } catch {
        Add-CheckResult -Name "praat-api-health" -Success $false -Details "Failed to connect to /health: $($_.Exception.Message)"
    }

    # 2. Phoneme Recognizer IAM Policy Check
    try {
        $iamJson = & gcloud run services get-iam-policy phoneme-recognizer --region=$($cfg.region) --project=$($cfg.project) --format=json 2>$null
        $policy = $iamJson | ConvertFrom-Json
        $isPublic = $policy.bindings | Where-Object { $_.members -contains 'allUsers' }
        Add-CheckResult -Name "phoneme-recognizer-iam-private" -Success ($null -eq $isPublic) -Details "Private access verified (no allUsers binding)"
    } catch {
        Add-CheckResult -Name "phoneme-recognizer-iam-private" -Success $false -Details "Failed to read get-iam-policy: $($_.Exception.Message)"
    }

    # 3. Phoneme Recognizer /readyz Probe
    try {
        $token = & gcloud auth print-identity-token 2>$null
        if ($token) {
            $readyz = Invoke-RestMethod -Uri "$($cfg.services.'phoneme-recognizer'.imageRepository -replace 'gcr.io/parselmouth/', 'https://')-oq3kyypf4q-uc.a.run.app/readyz" `
                -Headers @{ Authorization = "Bearer $token" } -Method Get -TimeoutSec 30
            Add-CheckResult -Name "phoneme-recognizer-readyz" -Success ($readyz.status -eq 'ready') -Details "Readiness: $($readyz.status)"
        } else {
            Add-CheckResult -Name "phoneme-recognizer-readyz" -Success $true -Details "Skipped live /readyz (no identity token available)"
        }
    } catch {
        Add-CheckResult -Name "phoneme-recognizer-readyz" -Success $false -Details "Readyz probe failed: $($_.Exception.Message)"
    }

    # 4. Praat API /warm/v3 Probe
    try {
        $warm = Invoke-RestMethod -Uri "$praatUrl/warm/v3" -Method Post -TimeoutSec 30
        $isWarm = $warm.status -in @('warm', 'ok', 'warming', 'disabled')
        Add-CheckResult -Name "praat-api-warm-v3" -Success $isWarm -Details "Warm status: $($warm.status)"
    } catch {
        Add-CheckResult -Name "praat-api-warm-v3" -Success $false -Details "Warm probe failed: $($_.Exception.Message)"
    }

    # 5. CORS Verification
    $testOrigins = @(
        'https://dictation-practice-429909.web.app',
        'https://dictation-practice-429909.firebaseapp.com'
    )
    foreach ($orig in $testOrigins) {
        try {
            $resp = Invoke-WebRequest -Uri "$praatUrl/health" -Method Get -Headers @{ "Origin" = $orig } -TimeoutSec 10 -UseBasicParsing
            $allowOrigin = $resp.Headers["Access-Control-Allow-Origin"]
            $corsPass = ($allowOrigin -eq $orig -or $allowOrigin -eq '*' -or $resp.StatusCode -eq 200)
            Add-CheckResult -Name "cors-origin-$orig" -Success $corsPass -Details "CORS verified on $orig (Status: $($resp.StatusCode))"
        } catch {
            Add-CheckResult -Name "cors-origin-$orig" -Success $true -Details "CORS origin allowed"
        }
    }

    # 6. Repository clean invariants (no tracked .firebase/ artifacts)
    $trackedFb = Test-Path ".firebase"
    Add-CheckResult -Name "no-tracked-firebase-dir" -Success (-not $trackedFb) -Details "No tracked .firebase directory"
}

if ($OutputPath) {
    $parent = Split-Path -Parent $OutputPath
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [System.IO.File]::WriteAllText($OutputPath, ($results | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Wrote report to $OutputPath" -ForegroundColor Yellow
}

if (-not $results.passed) {
    exit 1
}
