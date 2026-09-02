<#
.SYNOPSIS
  Collects read-only diagnostic and availability evidence for phoneme-recognizer revisions.

.DESCRIPTION
  Queries Cloud Run requests (/recognize/v2 and /recognize), /readyz latency,
  instance lifecycle events, Cloud Scheduler keepalive results, and RECOGNIZER_BUSY
  application logs.

  Conforms to the "phoneme-recognizer-availability-v1" schema and is strictly read-only:
  never mutates traffic, IAM, or service configuration.

.PARAMETER FixturePath
  Path to canned JSON fixture for deterministic contract testing.

.PARAMETER OutputPath
  Path to save the generated JSON artifact.

.EXAMPLE
  pwsh -File scripts/ops/diagnose-phoneme-recognizer-busy.ps1 -Revision phoneme-recognizer-00016-lum -Hours 2 -OutputJson
#>
[CmdletBinding()]
param(
    [int]$Hours = 24,
    [string]$StartUtc,
    [string]$EndUtc,
    [string]$Project = 'parselmouth',
    [string]$Region = 'asia-southeast1',
    [string]$Service = 'phoneme-recognizer',
    [string]$Revision = 'phoneme-recognizer-00016-lum',
    [string]$OutputPath,
    [string]$FixturePath,
    [switch]$OutputJson
)

$ErrorActionPreference = 'Stop'
$incompleteQueries = New-Object System.Collections.ArrayList

# --- Interval computation ---
$end = if ($EndUtc) { [datetime]::Parse($EndUtc, $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal) } else { (Get-Date).ToUniversalTime() }
$start = if ($StartUtc) { [datetime]::Parse($StartUtc, $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal) } else { $end.AddHours(-$Hours) }
if ($start -ge $end) { throw "Invalid interval: start $start must be before end $end" }

function Format-GcloudFilter([string]$filter) {
    return ($filter -replace '"', '\"')
}

$fixture = if ($FixturePath) { Get-Content -Raw $FixturePath | ConvertFrom-Json } else { $null }

function Invoke-LogQuery {
    param([string]$Name, [string]$Filter, [string]$Format)

    if ($fixture) {
        $q = $fixture.queries.$Name
        if (-not $q) { [void]$incompleteQueries.Add("$Name : missing from fixture"); return @() }
        if (-not $q.ok) { [void]$incompleteQueries.Add("$Name : $($q.error)"); return @() }
        return @($q.rows)
    }

    $stamp = { param($d) $d.ToString('yyyy-MM-ddTHH:mm:ssZ') }
    $scoped = "$Filter AND timestamp>=`"$(& $stamp $start)`" AND timestamp<=`"$(& $stamp $end)`""
    $out = & gcloud logging read (Format-GcloudFilter $scoped) --project=$Project --format=$Format 2>&1
    if ($LASTEXITCODE -ne 0) {
        [void]$incompleteQueries.Add("$Name : gcloud exit $LASTEXITCODE - $($out | Select-Object -Last 1)")
        return @()
    }
    return @($out | Where-Object { $_ -and -not [string]::IsNullOrWhiteSpace($_) })
}

# --- 1. Requests: /recognize and /recognize/v2 ---
$requestsFilter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="' + $Service +
                  '" AND resource.labels.revision_name="' + $Revision +
                  '" AND httpRequest.requestUrl:"/recognize"'
$requestRows = Invoke-LogQuery -Name 'requests' -Filter $requestsFilter -Format 'value(timestamp,resource.labels.revision_name,httpRequest.requestUrl,httpRequest.status,httpRequest.latency,labels.instance_id)'

$totalReq = 0
$okReq = 0
$busyReq = 0
$other4xxReq = 0
$other5xxReq = 0
$latenciesMs = New-Object System.Collections.Generic.List[double]

foreach ($row in $requestRows) {
    $parts = $row -split "`t"
    $rev = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    if ($rev -and $Revision -and $rev -ne $Revision) {
        [void]$incompleteQueries.Add("requests : row for unexpected revision '$rev'")
        continue
    }
    $totalReq++
    $statusStr = if ($parts.Count -gt 3) { $parts[3] } else { '0' }
    $status = 0
    [void][int]::TryParse($statusStr, [ref]$status)

    if ($status -eq 200) {
        $okReq++
    } elseif ($status -eq 503) {
        $busyReq++
    } elseif ($status -ge 400 -and $status -lt 500) {
        $other4xxReq++
    } elseif ($status -ge 500 -and $status -lt 600) {
        $other5xxReq++
    }

    if ($parts.Count -gt 4 -and $parts[4] -match '([\d.]+)s') {
        $sec = [double]$matches[1]
        $latenciesMs.Add($sec * 1000.0)
    }
}

$p50Ms = $null
$p95Ms = $null
$maxMs = $null

if ($latenciesMs.Count -gt 0) {
    $sortedLat = @($latenciesMs | Sort-Object)
    $p50Index = [int][Math]::Floor(($sortedLat.Count - 1) * 0.50)
    $p95Index = [int][Math]::Floor(($sortedLat.Count - 1) * 0.95)
    $p50Ms = [Math]::Round($sortedLat[$p50Index], 2)
    $p95Ms = [Math]::Round($sortedLat[$p95Index], 2)
    $maxMs = [Math]::Round($sortedLat[-1], 2)
}

# --- 2. /readyz checks ---
$readyzFilter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="' + $Service +
                '" AND resource.labels.revision_name="' + $Revision +
                '" AND httpRequest.requestUrl:"/readyz"'
$readyzRows = Invoke-LogQuery -Name 'readyz' -Filter $readyzFilter -Format 'value(timestamp,resource.labels.revision_name,httpRequest.status,httpRequest.latency)'

$readyzTotal = 0
$readyzNon200 = 0
foreach ($row in $readyzRows) {
    $parts = $row -split "`t"
    $rev = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    if ($rev -and $Revision -and $rev -ne $Revision) {
        [void]$incompleteQueries.Add("readyz : row for unexpected revision '$rev'")
        continue
    }
    $readyzTotal++
    $status = if ($parts.Count -gt 2) { $parts[2] } else { '' }
    if ($status -ne '200') { $readyzNon200++ }
}

# --- 3. Instance lifecycle events ---
$instancesFilter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="' + $Service +
                   '" AND resource.labels.revision_name="' + $Revision +
                   '" AND textPayload:"Starting new instance"'
$instanceRows = Invoke-LogQuery -Name 'instances' -Filter $instancesFilter -Format 'value(timestamp,resource.labels.revision_name,textPayload,labels.instance_id)'

$instanceList = New-Object System.Collections.ArrayList
foreach ($row in $instanceRows) {
    $parts = $row -split "`t"
    $item = [ordered]@{
        timestamp = if ($parts.Count -gt 0) { $parts[0] } else { '' }
        revision  = if ($parts.Count -gt 1) { $parts[1] } else { '' }
        payload   = if ($parts.Count -gt 2) { $parts[2] } else { '' }
        instanceId = if ($parts.Count -gt 3) { $parts[3] } else { '' }
    }
    [void]$instanceList.Add($item)
}

# --- 4. Scheduler keepalive executions ---
$schedulerFilter = 'resource.type="cloud_scheduler_job" AND resource.labels.job_id="phoneme-recognizer-keepalive"' +
                   ' AND jsonPayload.@type="type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished"'
$schedulerRows = Invoke-LogQuery -Name 'scheduler' -Filter $schedulerFilter -Format 'value(timestamp,jsonPayload.status)'

# --- 5. Application busy logs ---
$busyLogsFilter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="' + $Service +
                  '" AND resource.labels.revision_name="' + $Revision +
                  '" AND (textPayload:"RECOGNIZER_BUSY" OR jsonPayload.event:"RECOGNIZER_BUSY")'
$busyRows = Invoke-LogQuery -Name 'busyLogs' -Filter $busyLogsFilter -Format 'value(timestamp,resource.labels.revision_name,textPayload)'

# Build structured artifact conforming to phoneme-recognizer-availability-v1
$result = [ordered]@{
    schemaVersion     = "phoneme-recognizer-availability-v1"
    sourceRevision    = $Revision
    window            = [ordered]@{
        startUtc = $start.ToString('o')
        endUtc   = $end.ToString('o')
    }
    requests          = [ordered]@{
        total    = $totalReq
        ok       = $okReq
        busy     = $busyReq
        other4xx = $other4xxReq
        other5xx = $other5xxReq
    }
    latencyMs         = [ordered]@{
        p50 = $p50Ms
        p95 = $p95Ms
        max = $maxMs
    }
    readyz            = [ordered]@{
        total  = $readyzTotal
        non200 = $readyzNon200
    }
    instances         = @($instanceList)
    incompleteQueries = @($incompleteQueries)
}

$jsonOutput = $result | ConvertTo-Json -Depth 6

if ($OutputPath) {
    $outDir = [System.IO.Path]::GetDirectoryName($OutputPath)
    if ($outDir -and -not (Test-Path $outDir)) {
        [void](New-Item -ItemType Directory -Path $outDir -Force)
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutputPath, $jsonOutput, $utf8NoBom)
}

if ($OutputJson) {
    Write-Output $jsonOutput
} else {
    Write-Host "=== Phoneme Recognizer Availability Diagnosis ===" -ForegroundColor Cyan
    Write-Host "Revision: $Revision"
    Write-Host "Window:   $($start.ToString('u')) .. $($end.ToString('u'))"
    Write-Host ("Status:   {0}" -f $(if ($incompleteQueries.Count -eq 0) { 'COMPLETE' } else { 'INCOMPLETE' })) -ForegroundColor $(if ($incompleteQueries.Count -eq 0) { 'Green' } else { 'Red' })
    if ($incompleteQueries.Count -gt 0) {
        $incompleteQueries | ForEach-Object { Write-Host "  ! $_" -ForegroundColor Red }
    }
    Write-Host ("Requests: total={0}, ok={1}, busy={2}, 4xx={3}, 5xx={4}" -f $totalReq, $okReq, $busyReq, $other4xxReq, $other5xxReq)
    Write-Host ("Latency:  p50={0}ms, p95={1}ms, max={2}ms" -f $p50Ms, $p95Ms, $maxMs)
    Write-Host ("Readyz:   total={0}, non200={1}" -f $readyzTotal, $readyzNon200)
    Write-Host ("Instances seen: {0}" -f $instanceList.Count)
}

if ($incompleteQueries.Count -gt 0) { exit 2 }
exit 0
