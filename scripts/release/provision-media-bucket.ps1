<#
.SYNOPSIS
    Idempotent Google Cloud Storage provisioning script for BEL Practice Media.

.DESCRIPTION
    Provisions and validates the dedicated GCS bucket for immutable practice media,
    configures CORS, uniform bucket-level access, public read permissions, and establishes
    the dedicated least-privilege service account with operator token-creator impersonation.

    By default, runs in READ-ONLY preflight mode.
    Requires -Apply switch to execute any cloud modifications.

.PARAMETER ExpectedOperator
    The expected active gcloud operator email (default: huathanhnam95@gmail.com).

.PARAMETER TargetProject
    The Google Cloud project ID (default: listening-tasks-3ae34).

.PARAMETER TargetBucket
    The target bucket name (default: listening-tasks-3ae34-practice-media).

.PARAMETER Location
    The bucket location (default: asia-southeast1).

.PARAMETER ServiceAccountName
    The service account name (default: bel-media-publisher).

.PARAMETER Apply
    Switch to apply proposed infrastructure changes. If omitted, performs a read-only preflight.
#>

[CmdletBinding()]
param (
    [string]$ExpectedOperator = 'huathanhnam95@gmail.com',
    [string]$TargetProject = 'listening-tasks-3ae34',
    [string]$TargetBucket = 'listening-tasks-3ae34-practice-media',
    [string]$Location = 'asia-southeast1',
    [string]$ServiceAccountName = 'bel-media-publisher',
    [switch]$Apply = $false
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-GCloud {
    param([string[]]$Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $escapedArgs = $Arguments | ForEach-Object {
        if ($_ -match '\s' -and -not ($_ -match '^".*"$')) {
            "`"$_`""
        } else {
            $_
        }
    }
    $psi.Arguments = "/c gcloud " + ($escapedArgs -join " ")
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    return [PSCustomObject]@{
        ExitCode = $proc.ExitCode
        Stdout = $stdout.Trim()
        Stderr = $stderr.Trim()
    }
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " BEL Media Storage Provisioning Preflight" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Mode: $(if ($Apply) { '[APPLY] - Cloud mutations ENABLED' } else { '[PREFLIGHT] - Read-only inspection (dry-run)' })" -ForegroundColor $(if ($Apply) { 'Yellow' } else { 'Green' })
Write-Host "Expected Operator: $ExpectedOperator"
Write-Host "Target Project:    $TargetProject"
Write-Host "Target Bucket:     gs://$TargetBucket"
Write-Host "Target Region:     $Location (Singapore)"
Write-Host "Service Account:   $ServiceAccountName@$TargetProject.iam.gserviceaccount.com"
Write-Host "----------------------------------------------------------------"

# 1. Check gcloud CLI presence
$gcloudCmd = Get-Command 'gcloud' -ErrorAction SilentlyContinue
if (-not $gcloudCmd) {
    Write-Error "gcloud CLI is not installed or not available in PATH. Please install Google Cloud SDK."
}

# 2. Check active gcloud account
Write-Host "[1/6] Checking active operator account..." -NoNewline
$accRes = Invoke-GCloud @('config', 'get-value', 'account')
$activeAccount = $accRes.Stdout
if ($activeAccount -ne $ExpectedOperator) {
    Write-Host " [MISMATCH]" -ForegroundColor Red
    Write-Error "Active gcloud account is '$activeAccount', but expected '$ExpectedOperator'. Run 'gcloud config set account $ExpectedOperator' first."
}
Write-Host " [OK] ($activeAccount)" -ForegroundColor Green

# 3. Check target project access
Write-Host "[2/6] Verifying project '$TargetProject' access..." -NoNewline
$projRes = Invoke-GCloud @('projects', 'describe', $TargetProject, '--format=json')
if ($projRes.ExitCode -ne 0) {
    Write-Host " [FAILED]" -ForegroundColor Red
    Write-Error "Unable to describe project '$TargetProject': $($projRes.Stderr)"
}
Write-Host " [OK]" -ForegroundColor Green

# 4. Inspect Target Bucket
Write-Host "[3/6] Inspecting bucket 'gs://$TargetBucket'..." -NoNewline
$bktRes = Invoke-GCloud @('storage', 'buckets', 'describe', "gs://$TargetBucket", "--project=$TargetProject", '--format=json')
$bucketExists = ($bktRes.ExitCode -eq 0)
$bucketObj = $null
if ($bucketExists) {
    $bucketObj = $bktRes.Stdout | ConvertFrom-Json
}

if (-not $bucketExists) {
    Write-Host " [NOT FOUND]" -ForegroundColor Yellow
    Write-Host "      -> Plan: Create gs://$TargetBucket in $Location (STANDARD class, uniform bucket-level access)." -ForegroundColor Yellow
    if ($Apply) {
        Write-Host "      -> Creating bucket gs://$TargetBucket..." -ForegroundColor Cyan
        $createRes = Invoke-GCloud @(
            'storage', 'buckets', 'create', "gs://$TargetBucket",
            "--project=$TargetProject",
            "--location=$Location",
            '--default-storage-class=STANDARD',
            '--uniform-bucket-level-access'
        )
        if ($createRes.ExitCode -ne 0) {
            Write-Error "Failed to create bucket gs://${TargetBucket}: $($createRes.Stderr)"
        }
        Write-Host "      -> Bucket created successfully." -ForegroundColor Green
        $bktRes = Invoke-GCloud @('storage', 'buckets', 'describe', "gs://$TargetBucket", "--project=$TargetProject", '--format=json')
        $bucketObj = $bktRes.Stdout | ConvertFrom-Json
        $bucketExists = $true
    }
} else {
    Write-Host " [EXISTS]" -ForegroundColor Green
    # Verify Location
    $actualLocation = $bucketObj.location.ToLowerInvariant()
    if ($actualLocation -ne $Location.ToLowerInvariant()) {
        Write-Error "Existing bucket location '$actualLocation' does not match expected location '$Location'."
    }
    # Verify Uniform Bucket-Level Access
    $ubla = $false
    if ($null -ne $bucketObj.PSObject.Properties['uniform_bucket_level_access']) {
        $ubla = [bool]$bucketObj.uniform_bucket_level_access
    } elseif ($null -ne $bucketObj.PSObject.Properties['iam_configuration'] -and $null -ne $bucketObj.iam_configuration.PSObject.Properties['uniform_bucket_level_access']) {
        $ubla = [bool]$bucketObj.iam_configuration.uniform_bucket_level_access.enabled
    }
    if (-not $ubla) {
        Write-Host "      -> Uniform bucket-level access is DISABLED." -ForegroundColor Yellow
        if ($Apply) {
            Write-Host "      -> Enabling uniform bucket-level access..." -ForegroundColor Cyan
            $updateRes = Invoke-GCloud @('storage', 'buckets', 'update', "gs://$TargetBucket", '--uniform-bucket-level-access')
            if ($updateRes.ExitCode -ne 0) { Write-Error "Failed to enable uniform bucket-level access: $($updateRes.Stderr)" }
            Write-Host "      -> Uniform bucket-level access enabled." -ForegroundColor Green
        } else {
            Write-Host "      -> Plan: Enable uniform bucket-level access." -ForegroundColor Yellow
        }
    } else {
        Write-Host "      -> Uniform bucket-level access: [ENABLED]" -ForegroundColor Green
    }
}

# 5. Configure CORS
Write-Host "[4/6] Inspecting CORS configuration..." -NoNewline
$corsJson = @"
[
  {
    "origin": [
      "https://listening-tasks-3ae34.web.app",
      "https://listening-tasks-3ae34.firebaseapp.com",
      "http://localhost:5000",
      "http://127.0.0.1:5000"
    ],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Range", "Origin", "Accept"],
    "maxAgeSeconds": 3600
  }
]
"@

if ($bucketExists) {
    $hasCors = ($null -ne $bucketObj.PSObject.Properties['cors']) -and ($null -ne $bucketObj.cors) -and ($bucketObj.cors.Count -gt 0)
    if (-not $hasCors) {
        Write-Host " [NOT CONFIGURED]" -ForegroundColor Yellow
        if ($Apply) {
            Write-Host "      -> Setting CORS configuration..." -ForegroundColor Cyan
            $tempCors = [System.IO.Path]::GetTempFileName()
            try {
                Set-Content -Path $tempCors -Value $corsJson -Encoding UTF8
                $corsRes = Invoke-GCloud @('storage', 'buckets', 'update', "gs://$TargetBucket", "--cors-file=$tempCors")
                if ($corsRes.ExitCode -ne 0) { Write-Error "Failed to set CORS on gs://${TargetBucket}: $($corsRes.Stderr)" }
                Write-Host "      -> CORS configured successfully." -ForegroundColor Green
            } finally {
                if (Test-Path $tempCors) { Remove-Item $tempCors -Force }
            }
        } else {
            Write-Host "      -> Plan: Configure CORS for web.app, firebaseapp.com, and localhost." -ForegroundColor Yellow
        }
    } else {
        Write-Host " [CONFIGURED]" -ForegroundColor Green
    }
} else {
    Write-Host " [PENDING BUCKET CREATION]" -ForegroundColor Gray
}

# 6. Public Read IAM Binding (allUsers -> roles/storage.objectViewer)
Write-Host "[5/6] Inspecting public read permissions..." -NoNewline
if ($bucketExists) {
    $iamRes = Invoke-GCloud @('storage', 'buckets', 'get-iam-policy', "gs://$TargetBucket", '--format=json')
    $hasPublicRead = $false
    if ($iamRes.ExitCode -eq 0 -and $iamRes.Stdout) {
        $iamObj = $iamRes.Stdout | ConvertFrom-Json
        $bindings = if ($null -ne $iamObj.PSObject.Properties['bindings']) { $iamObj.bindings } else { @() }
        foreach ($binding in ($bindings | Where-Object { $_.role -eq 'roles/storage.objectViewer' })) {
            if ($binding.members -contains 'allUsers') {
                $hasPublicRead = $true
                break
            }
        }
    }

    if (-not $hasPublicRead) {
        Write-Host " [NOT BOUND]" -ForegroundColor Yellow
        if ($Apply) {
            Write-Host "      -> Binding roles/storage.objectViewer to allUsers..." -ForegroundColor Cyan
            $bindRes = Invoke-GCloud @(
                'storage', 'buckets', 'add-iam-policy-binding', "gs://$TargetBucket",
                '--member=allUsers',
                '--role=roles/storage.objectViewer'
            )
            if ($bindRes.ExitCode -ne 0) { Write-Error "Failed to bind public read role to allUsers: $($bindRes.Stderr)" }
            Write-Host "      -> Public read permission bound successfully." -ForegroundColor Green
        } else {
            Write-Host "      -> Plan: Bind roles/storage.objectViewer to allUsers." -ForegroundColor Yellow
        }
    } else {
        Write-Host " [BOUND (allUsers)]" -ForegroundColor Green
    }
} else {
    Write-Host " [PENDING BUCKET CREATION]" -ForegroundColor Gray
}

# 7. Dedicated Service Account & Least-Privilege IAM
$saEmail = "$ServiceAccountName@$TargetProject.iam.gserviceaccount.com"
Write-Host "[6/6] Inspecting dedicated service account '$saEmail'..." -NoNewline
$saRes = Invoke-GCloud @('iam', 'service-accounts', 'describe', $saEmail, "--project=$TargetProject", '--format=json')
$saExists = ($saRes.ExitCode -eq 0)

if (-not $saExists) {
    Write-Host " [NOT FOUND]" -ForegroundColor Yellow
    if ($Apply) {
        Write-Host "      -> Creating service account '$ServiceAccountName'..." -ForegroundColor Cyan
        $saCreateRes = Invoke-GCloud @(
            'iam', 'service-accounts', 'create', $ServiceAccountName,
            '--display-name=BEL Media Publisher',
            '--description=Least-privilege publisher for practice media corpus',
            "--project=$TargetProject"
        )
        if ($saCreateRes.ExitCode -ne 0) { Write-Error "Failed to create service account ${saEmail}: $($saCreateRes.Stderr)" }
        Write-Host "      -> Service account created." -ForegroundColor Green
        $saExists = $true
    } else {
        Write-Host "      -> Plan: Create service account '$saEmail'." -ForegroundColor Yellow
    }
} else {
    Write-Host " [EXISTS]" -ForegroundColor Green
}

# Bucket IAM roles for Service Account
if ($bucketExists -and ($saExists -or $Apply)) {
    Write-Host "      -> Checking bucket-scoped roles for '$saEmail'..." -NoNewline
    $iamRes = Invoke-GCloud @('storage', 'buckets', 'get-iam-policy', "gs://$TargetBucket", '--format=json')
    $iamObj = if ($iamRes.ExitCode -eq 0 -and $iamRes.Stdout) { $iamRes.Stdout | ConvertFrom-Json } else { $null }
    
    $hasCreator = $false
    $hasViewer = $false
    $bucketBindings = if ($iamObj -and ($null -ne $iamObj.PSObject.Properties['bindings'])) { $iamObj.bindings } else { @() }
    foreach ($b in $bucketBindings) {
        if ($b.role -eq 'roles/storage.objectCreator' -and $b.members -contains "serviceAccount:$saEmail") {
            $hasCreator = $true
        }
        if ($b.role -eq 'roles/storage.objectViewer' -and $b.members -contains "serviceAccount:$saEmail") {
            $hasViewer = $true
        }
    }

    if (-not $hasCreator -or -not $hasViewer) {
        Write-Host " [NEED BINDING]" -ForegroundColor Yellow
        if ($Apply) {
            if (-not $hasCreator) {
                Write-Host "      -> Granting roles/storage.objectCreator on gs://$TargetBucket..." -ForegroundColor Cyan
                $cRes = Invoke-GCloud @(
                    'storage', 'buckets', 'add-iam-policy-binding', "gs://$TargetBucket",
                    "--member=serviceAccount:$saEmail",
                    '--role=roles/storage.objectCreator'
                )
                if ($cRes.ExitCode -ne 0) { Write-Error "Failed to bind objectCreator role: $($cRes.Stderr)" }
            }
            if (-not $hasViewer) {
                Write-Host "      -> Granting roles/storage.objectViewer on gs://$TargetBucket..." -ForegroundColor Cyan
                $vRes = Invoke-GCloud @(
                    'storage', 'buckets', 'add-iam-policy-binding', "gs://$TargetBucket",
                    "--member=serviceAccount:$saEmail",
                    '--role=roles/storage.objectViewer'
                )
                if ($vRes.ExitCode -ne 0) { Write-Error "Failed to bind objectViewer role: $($vRes.Stderr)" }
            }
            Write-Host "      -> Bucket-scoped roles granted." -ForegroundColor Green
        } else {
            Write-Host "      -> Plan: Bind roles/storage.objectCreator and roles/storage.objectViewer on gs://$TargetBucket." -ForegroundColor Yellow
        }
    } else {
        Write-Host " [ROLES VERIFIED (objectCreator + objectViewer)]" -ForegroundColor Green
    }
}

# Impersonation permission for operator
if ($saExists -or $Apply) {
    Write-Host "      -> Checking operator impersonation permission on '$saEmail'..." -NoNewline
    $saPolRes = Invoke-GCloud @('iam', 'service-accounts', 'get-iam-policy', $saEmail, "--project=$TargetProject", '--format=json')
    $hasImpersonation = $false
    if ($saPolRes.ExitCode -eq 0 -and $saPolRes.Stdout) {
        $saPolicy = $saPolRes.Stdout | ConvertFrom-Json
        $saBindings = if ($saPolicy -and ($null -ne $saPolicy.PSObject.Properties['bindings'])) { $saPolicy.bindings } else { @() }
        foreach ($b in $saBindings) {
            if ($b.role -eq 'roles/iam.serviceAccountTokenCreator' -and $b.members -contains "user:$ExpectedOperator") {
                $hasImpersonation = $true
                break
            }
        }
    }

    if (-not $hasImpersonation) {
        Write-Host " [NOT BOUND]" -ForegroundColor Yellow
        if ($Apply) {
            Write-Host "      -> Granting roles/iam.serviceAccountTokenCreator to user:$ExpectedOperator..." -ForegroundColor Cyan
            $impRes = Invoke-GCloud @(
                'iam', 'service-accounts', 'add-iam-policy-binding', $saEmail,
                "--member=user:$ExpectedOperator",
                '--role=roles/iam.serviceAccountTokenCreator',
                "--project=$TargetProject"
            )
            if ($impRes.ExitCode -ne 0) { Write-Error "Failed to grant impersonation role: $($impRes.Stderr)" }
            Write-Host "      -> Impersonation permission granted." -ForegroundColor Green
        } else {
            Write-Host "      -> Plan: Grant roles/iam.serviceAccountTokenCreator to user:$ExpectedOperator on $saEmail." -ForegroundColor Yellow
        }
    } else {
        Write-Host " [IMPERSONATION VERIFIED]" -ForegroundColor Green
    }
}

Write-Host "----------------------------------------------------------------"
if (-not $Apply) {
    Write-Host "Preflight check completed in READ-ONLY mode." -ForegroundColor Green
    Write-Host "Zero cloud resources were created or modified." -ForegroundColor Green
    Write-Host "To review and apply these changes, re-run with:" -ForegroundColor Yellow
    Write-Host "  pwsh scripts/release/provision-media-bucket.ps1 -Apply" -ForegroundColor White
} else {
    Write-Host "Infrastructure provisioning completed successfully." -ForegroundColor Green
    Write-Host "Delivery Base URL: https://storage.googleapis.com/$TargetBucket/" -ForegroundColor Cyan
}
Write-Host "================================================================" -ForegroundColor Cyan
