<#
.SYNOPSIS
  Measures the V3 phoneme-recognizer keep-alive over an observation window.

.DESCRIPTION
  Cloud Run may stop an idle instance at any time, so the keep-alive cannot be
  verified as "zero cold starts". This script measures a RATE instead, and
  separates the three categories that a naive "Starting new instance" grep
  conflates:

    1. EXPECTED  - the first start after the overnight gap (~06:00 local).
                   The ping window is 06:00-23:50, so this start is by design.
    2. UNPLANNED - an AUTOSCALING start inside the active window, i.e. the
                   instance was evicted and a learner or ping paid a cold start.
                   This is the number that matters.
    3. IGNORED   - DEPLOYMENT_ROLLOUT starts, which are deploys, not evictions.

  It also verifies the Scheduler actually executed, and reports /readyz latency.

.PARAMETER Hours
  Observation window in hours. Default 24.

.EXAMPLE
  pwsh -File scripts/verify-phoneme-keepalive.ps1 -Hours 24
#>
[CmdletBinding()]
param(
    [int]$Hours = 24,
    [string]$Project = 'parselmouth',
    [string]$Service = 'phoneme-recognizer',
    [string]$Revision = 'phoneme-recognizer-00004-bbc',
    [string]$JobId = 'phoneme-recognizer-keepalive',
    [string]$TimeZoneId = 'SE Asia Standard Time',
    [int]$WindowStartHour = 6,
    [int]$WindowEndHour = 23
)

$ErrorActionPreference = 'Stop'
$freshness = "${Hours}h"
$tz = [System.TimeZoneInfo]::FindSystemTimeZoneById($TimeZoneId)

# Windows PowerShell's gcloud.ps1 wrapper re-splits argument strings, so a
# filter containing bare double quotes arrives at gcloud as several arguments
# ("unrecognized arguments"). Escaping the quotes survives the round trip. This
# is the same class of defect as Issue 6 in the plan.
function Format-GcloudFilter([string]$filter) {
    return ($filter -replace '"', '\"')
}

function ConvertTo-LocalTime([string]$utcStamp) {
    if ([string]::IsNullOrWhiteSpace($utcStamp)) { return $null }
    $utc = [datetime]::Parse($utcStamp, $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
    return [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $tz)
}

function Test-InActiveWindow([datetime]$local) {
    return ($local.Hour -ge $WindowStartHour -and $local.Hour -le $WindowEndHour)
}

Write-Host "=== V3 keep-alive verification: last $Hours h ===" -ForegroundColor Cyan
Write-Host "Service $Service / revision $Revision"
Write-Host "Active window ${WindowStartHour}:00-${WindowEndHour}:59 $TimeZoneId`n"

# --- 1. Instance starts, categorised ------------------------------------------
# Single-quoted PowerShell string keeps the embedded double quotes intact for
# the logging filter; do not switch to double quotes here.
$startFilter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="' + $Service + '" AND textPayload:"Starting new instance"'
$startRows = @(gcloud logging read (Format-GcloudFilter $startFilter) --project=$Project --freshness=$freshness --format='value(timestamp,textPayload)' 2>$null)

$expected = @(); $unplanned = @(); $rollout = @()
foreach ($row in $startRows) {
    if ([string]::IsNullOrWhiteSpace($row)) { continue }
    $parts = $row -split "`t", 2
    $local = ConvertTo-LocalTime $parts[0]
    if ($null -eq $local) { continue }
    $payload = if ($parts.Count -gt 1) { $parts[1] } else { '' }

    if ($payload -match 'DEPLOYMENT_ROLLOUT') { $rollout += $local; continue }
    if (-not (Test-InActiveWindow $local)) { continue }   # outside window: not a regression
    # The first start at/just after the window opens is the designed daily cold start.
    if ($local.Hour -eq $WindowStartHour) { $expected += $local } else { $unplanned += $local }
}

Write-Host "Instance starts" -ForegroundColor Yellow
Write-Host ("  expected (daily {0:00}:00 warm-up) : {1}" -f $WindowStartHour, $expected.Count)
Write-Host ("  UNPLANNED (evictions in window)   : {0}" -f $unplanned.Count)
Write-Host ("  ignored (deployment rollouts)     : {0}" -f $rollout.Count)
foreach ($u in $unplanned) { Write-Host ("     ! {0:yyyy-MM-dd HH:mm:ss}" -f $u) -ForegroundColor Red }

# --- 2. Scheduler executions ---------------------------------------------------
$jobFilter = 'resource.type="cloud_scheduler_job" AND resource.labels.job_id="' + $JobId + '"'
$jobRows = @(gcloud logging read (Format-GcloudFilter $jobFilter) --project=$Project --freshness=$freshness --format='value(timestamp,jsonPayload.status)' 2>$null | Where-Object { $_ })

$expectedRuns = [math]::Floor($Hours / 24.0 * (($WindowEndHour - $WindowStartHour + 1) * 6))
Write-Host "`nScheduler executions" -ForegroundColor Yellow
Write-Host ("  observed : {0}" -f $jobRows.Count)
Write-Host ("  expected : ~{0} (every 10 min across the active window)" -f $expectedRuns)

# --- 3. /readyz latency --------------------------------------------------------
$readyFilter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="' + $Service + '" AND httpRequest.requestUrl:"/readyz"'
$readyRows = @(gcloud logging read (Format-GcloudFilter $readyFilter) --project=$Project --freshness=$freshness --format='value(httpRequest.status,httpRequest.latency)' 2>$null | Where-Object { $_ })

$lat = @(); $nonOk = 0
foreach ($row in $readyRows) {
    $p = $row -split "`t"
    if ($p[0] -ne '200') { $nonOk++ }
    if ($p.Count -gt 1 -and $p[1] -match '([\d.]+)s') { $lat += [double]$matches[1] }
}
Write-Host "`n/readyz responses" -ForegroundColor Yellow
Write-Host ("  total        : {0}   non-200: {1}" -f $readyRows.Count, $nonOk)
if ($lat.Count) {
    $sorted = $lat | Sort-Object
    Write-Host ("  median       : {0:N3}s" -f $sorted[[int]($sorted.Count/2)])
    Write-Host ("  max          : {0:N3}s" -f ($sorted[-1]))
    Write-Host ("  over 5s      : {0}  (cold starts)" -f (@($lat | Where-Object { $_ -gt 5 }).Count))
}

# --- 4. Verdict ----------------------------------------------------------------
Write-Host "`n=== VERDICT ===" -ForegroundColor Cyan
if ($unplanned.Count -eq 0 -and $jobRows.Count -gt 0) {
    Write-Host "PASS - no unplanned cold starts in the active window." -ForegroundColor Green
} elseif ($jobRows.Count -eq 0) {
    Write-Host "INCONCLUSIVE - Scheduler produced no execution logs; check the job is ENABLED." -ForegroundColor Yellow
} else {
    Write-Host ("MEASURED - {0} unplanned cold start(s) in {1}h. This is a rate, not a failure:" -f $unplanned.Count, $Hours) -ForegroundColor Yellow
    Write-Host "Cloud Run may reclaim idle instances at any time. Track the trend."
}
Write-Host "`nBilled instance time (authoritative cost figure) must come from the"
Write-Host "run.googleapis.com/container/billable_instance_time metric, not from these logs."
