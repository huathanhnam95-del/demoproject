<#
.SYNOPSIS
  Measures the V3 phoneme-recognizer keep-alive over an explicit UTC interval.

.DESCRIPTION
  Cloud Run may stop an idle instance at any time, so the keep-alive cannot be
  verified as "zero cold starts". This reports a measured RATE, and keeps two
  things strictly separate:

    evidenceComplete - every required query succeeded and the Scheduler
                       executions line up with the recognizer's /readyz rows.
                       If this is false, NOTHING below it may be trusted.
    evictions        - unplanned in-window instance starts. Descriptive only.
                       Zero evictions is never a guarantee of future behaviour.

  Instance starts are classified per local date:
    EXPECTED  - the FIRST AUTOSCALING start at/just after the window opens.
                The ping window is 06:00-23:50, so the overnight gap makes one
                start per day inevitable by design.
    UNPLANNED - any later AUTOSCALING start inside the window, including a
                second start in the 06:00 hour.
    IGNORED   - DEPLOYMENT_ROLLOUT starts. Those are deploys, not evictions.

.PARAMETER FixturePath
  Read canned query results instead of calling gcloud. Used by
  tests/ops/verify-phoneme-keepalive-contract.test.mjs so the parsing and
  classification logic is exercised deterministically.

.EXAMPLE
  pwsh -File scripts/verify-phoneme-keepalive.ps1 -Hours 24 -Revision phoneme-recognizer-00010-rir -OutputJson
#>
[CmdletBinding()]
param(
    [int]$Hours = 24,
    [string]$StartUtc,
    [string]$EndUtc,
    [string]$Project = 'parselmouth',
    [string]$Service = 'phoneme-recognizer',
    [string]$Revision = 'phoneme-recognizer-00010-rir',
    [string]$JobId = 'phoneme-recognizer-keepalive',
    [string]$TimeZoneId = 'SE Asia Standard Time',
    [int]$WindowStartHour = 6,
    [int]$WindowEndHour = 23,
    [int]$PingIntervalMinutes = 10,
    [string]$FixturePath,
    [switch]$OutputJson
)

$ErrorActionPreference = 'Stop'
$tz = [System.TimeZoneInfo]::FindSystemTimeZoneById($TimeZoneId)
$queryErrors = New-Object System.Collections.ArrayList

# --- interval ----------------------------------------------------------------
# -Hours is a convenience; everything downstream uses an explicit UTC interval
# so partial days cannot be silently mis-scaled.
$end   = if ($EndUtc)   { [datetime]::Parse($EndUtc,   $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal) } else { (Get-Date).ToUniversalTime() }
$start = if ($StartUtc) { [datetime]::Parse($StartUtc, $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal) } else { $end.AddHours(-$Hours) }
if ($start -ge $end) { throw "Invalid interval: start $start is not before end $end" }

# --- one gcloud path ---------------------------------------------------------
# Windows PowerShell's gcloud.ps1 wrapper re-splits argument strings, so a
# filter containing bare double quotes arrives as several arguments
# ("unrecognized arguments"). Escaping survives the round trip.
function Format-GcloudFilter([string]$filter) { return ($filter -replace '"', '\"') }

$fixture = if ($FixturePath) { Get-Content -Raw $FixturePath | ConvertFrom-Json } else { $null }

function Invoke-LogQuery {
    param([string]$Name, [string]$Filter, [string]$Format)

    if ($fixture) {
        $q = $fixture.queries.$Name
        if (-not $q) { [void]$queryErrors.Add("$Name : missing from fixture"); return @() }
        if (-not $q.ok) { [void]$queryErrors.Add("$Name : $($q.error)"); return @() }
        return @($q.rows)
    }

    $stamp = { param($d) $d.ToString('yyyy-MM-ddTHH:mm:ssZ') }
    $scoped = "$Filter AND timestamp>=`"$(& $stamp $start)`" AND timestamp<=`"$(& $stamp $end)`""
    $out = & gcloud logging read (Format-GcloudFilter $scoped) --project=$Project --format=$Format 2>&1
    if ($LASTEXITCODE -ne 0) {
        [void]$queryErrors.Add("$Name : gcloud exit $LASTEXITCODE - $($out | Select-Object -Last 1)")
        return @()
    }
    return @($out | Where-Object { $_ -and -not [string]::IsNullOrWhiteSpace($_) })
}

function ConvertTo-LocalTime([string]$utcStamp) {
    if ([string]::IsNullOrWhiteSpace($utcStamp)) { return $null }
    try {
        $utc = [datetime]::Parse($utcStamp, $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
        return [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $tz)
    } catch { return $null }
}

# --- 1. instance starts, scoped to the selected revision ---------------------
$startFilter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="' + $Service +
               '" AND resource.labels.revision_name="' + $Revision +
               '" AND textPayload:"Starting new instance"'
$startRows = Invoke-LogQuery -Name 'instanceStarts' -Filter $startFilter -Format 'value(timestamp,resource.labels.revision_name,textPayload)'

$expected = @(); $unplanned = @(); $rollout = @()
$firstSeenPerDate = @{}
foreach ($row in ($startRows | Sort-Object)) {
    $parts = $row -split "`t"
    $local = ConvertTo-LocalTime $parts[0]
    if ($null -eq $local) { continue }
    $rev = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    $payload = if ($parts.Count -gt 2) { $parts[2] } else { '' }

    # A row for another revision means the filter did not do its job.
    if ($rev -and $Revision -and $rev -ne $Revision) {
        [void]$queryErrors.Add("instanceStarts : row for unexpected revision '$rev'")
        continue
    }
    if ($payload -match 'DEPLOYMENT_ROLLOUT') { $rollout += $local; continue }
    if ($local.Hour -lt $WindowStartHour -or $local.Hour -gt $WindowEndHour) { continue }

    $dateKey = $local.ToString('yyyy-MM-dd')
    if (-not $firstSeenPerDate.ContainsKey($dateKey) -and $local.Hour -eq $WindowStartHour) {
        # Only the FIRST start in the opening hour is the designed daily warm-up.
        $firstSeenPerDate[$dateKey] = $true
        $expected += $local
    } else {
        $unplanned += $local
    }
}

# --- 2. Scheduler executions: AttemptFinished only ---------------------------
# Each run emits several log entries; counting rows instead of finishes
# double-counts and inflates the apparent execution rate.
$jobFilter = 'resource.type="cloud_scheduler_job" AND resource.labels.job_id="' + $JobId +
             '" AND jsonPayload.@type="type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished"'
$jobRows = Invoke-LogQuery -Name 'scheduler' -Filter $jobFilter -Format 'value(timestamp,jsonPayload.status)'

$finished = 0; $schedulerNonOk = 0
foreach ($row in $jobRows) {
    $p = $row -split "`t"
    $finished++
    $status = if ($p.Count -gt 1) { $p[1] } else { '' }
    if ($status -and $status -ne 'OK' -and $status -ne '200') { $schedulerNonOk++ }
}

# Expected occurrences derived from the actual interval, not Hours/24*108.
$expectedRuns = 0
$cursor = [System.TimeZoneInfo]::ConvertTimeFromUtc($start, $tz)
$localEnd = [System.TimeZoneInfo]::ConvertTimeFromUtc($end, $tz)
while ($cursor -le $localEnd) {
    if ($cursor.Hour -ge $WindowStartHour -and $cursor.Hour -le $WindowEndHour -and ($cursor.Minute % $PingIntervalMinutes) -eq 0) {
        $expectedRuns++
    }
    $cursor = $cursor.AddMinutes(1)
}

# --- 3. /readyz responses attributable to the Scheduler ----------------------
$readyFilter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="' + $Service +
               '" AND resource.labels.revision_name="' + $Revision +
               '" AND httpRequest.requestUrl:"/readyz" AND httpRequest.userAgent="Google-Cloud-Scheduler"'
$readyRows = Invoke-LogQuery -Name 'readyz' -Filter $readyFilter -Format 'value(timestamp,resource.labels.revision_name,httpRequest.status,httpRequest.latency)'

$lat = @(); $readyNonOk = 0
foreach ($row in $readyRows) {
    $p = $row -split "`t"
    $rev = if ($p.Count -gt 1) { $p[1] } else { '' }
    if ($rev -and $Revision -and $rev -ne $Revision) {
        [void]$queryErrors.Add("readyz : row for unexpected revision '$rev'")
        continue
    }
    $status = if ($p.Count -gt 2) { $p[2] } else { '' }
    if ($status -ne '200') { $readyNonOk++ }
    if ($p.Count -gt 3 -and $p[3] -match '([\d.]+)s') { $lat += [double]$matches[1] }
}

# --- 4. evidence completeness (separate from the eviction rate) --------------
$evidenceComplete = ($queryErrors.Count -eq 0) -and ($finished -gt 0) -and
                    ($schedulerNonOk -eq 0) -and ($readyNonOk -eq 0) -and
                    ($finished -eq $readyRows.Count)
if ($finished -ne $readyRows.Count) {
    [void]$queryErrors.Add("mismatch : $finished Scheduler finishes vs $($readyRows.Count) /readyz rows")
}

$sorted = @($lat | Sort-Object)
$result = [ordered]@{
    window           = [ordered]@{ startUtc = $start.ToString('o'); endUtc = $end.ToString('o'); timeZone = $TimeZoneId }
    revision         = $Revision
    evidenceComplete = [bool]$evidenceComplete
    queryErrors      = @($queryErrors)
    scheduler        = [ordered]@{ finished = $finished; nonOk = $schedulerNonOk; expected = $expectedRuns }
    readyz           = [ordered]@{ schedulerResponses = $readyRows.Count; nonOk = $readyNonOk
                                   medianSec = $(if ($sorted.Count) { $sorted[[int]($sorted.Count/2)] } else { $null })
                                   maxSec    = $(if ($sorted.Count) { $sorted[-1] } else { $null }) }
    starts           = [ordered]@{ expected = $expected.Count; unplanned = $unplanned.Count; rollout = $rollout.Count
                                   unplannedLocal = @($unplanned | ForEach-Object { $_.ToString('yyyy-MM-dd HH:mm:ss') }) }
}

if ($OutputJson) {
    $result | ConvertTo-Json -Depth 6
} else {
    Write-Host "=== V3 keep-alive: $($start.ToString('u')) .. $($end.ToString('u')) ===" -ForegroundColor Cyan
    Write-Host "revision: $Revision`n"
    Write-Host ("evidenceComplete : {0}" -f $result.evidenceComplete) -ForegroundColor $(if ($evidenceComplete) { 'Green' } else { 'Red' })
    if ($queryErrors.Count) { $queryErrors | ForEach-Object { Write-Host "   ! $_" -ForegroundColor Red } }
    Write-Host ("scheduler        : {0} finished / ~{1} expected, {2} non-OK" -f $finished, $expectedRuns, $schedulerNonOk)
    Write-Host ("/readyz          : {0} responses, {1} non-200, median {2}s, max {3}s" -f `
        $result.readyz.schedulerResponses, $readyNonOk, $result.readyz.medianSec, $result.readyz.maxSec)
    Write-Host ("starts           : {0} expected, {1} UNPLANNED, {2} rollout" -f $expected.Count, $unplanned.Count, $rollout.Count)
    $unplanned | ForEach-Object { Write-Host ("   ! {0:yyyy-MM-dd HH:mm:ss}" -f $_) -ForegroundColor Yellow }
    Write-Host "`nEvictions are a measured rate, not a guarantee: Cloud Run may reclaim an"
    Write-Host "idle instance at any time. Billed cost must come from the"
    Write-Host "run.googleapis.com/container/billable_instance_time metric, not these logs."
}

# A failed query must never look like a clean result.
if ($queryErrors.Count -gt 0) { exit 2 }
exit 0
