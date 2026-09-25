# Mock all gcloud calls to exercise release gates without touching Cloud Run.
$ErrorActionPreference = 'Stop'
$script:releaseScript = Join-Path $PSScriptRoot '../../scripts/release/pronunciation-v3.ps1'
$script:configPath = Join-Path $PSScriptRoot '../../scripts/release/pronunciation-v3.production.json'
$global:serviceAccount = '1071929245506-compute@developer.gserviceaccount.com'

function gcloud {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    if ($command -like 'run services get-iam-policy*') {
        $members = if ($global:scenario -eq 'iam-drift') { @('allUsers') } else { @("serviceAccount:$global:serviceAccount") }
        return @{ bindings = @(@{ role = 'roles/run.invoker'; members = $members }) } | ConvertTo-Json -Depth 8 -Compress
    }
    if ($command -like 'run revisions describe*') {
        $concurrency = if ($global:scenario -eq 'old-concurrency') { 160 } else { 1 }
        $ready = if ($global:scenario -eq 'not-ready') { 'False' } else { 'True' }
        $probe = if ($global:scenario -eq 'bad-probe') { @{ tcpSocket = @{ port = 8080 } } } else {
            @{ httpGet = @{ path = '/readyz' }; initialDelaySeconds = 10; periodSeconds = 5; failureThreshold = 24; timeoutSeconds = 5 }
        }
        return @{
            metadata = @{ annotations = @{ 'autoscaling.knative.dev/maxScale' = '2' } }
            spec = @{
                containers = @(@{ resources = @{ limits = @{ cpu = '2'; memory = '4Gi' } }; startupProbe = $probe })
                timeoutSeconds = 120
                containerConcurrency = $concurrency
                serviceAccountName = $global:serviceAccount
            }
            status = @{
                conditions = @(@{ type = 'Ready'; status = $ready })
                imageDigest = 'gcr.io/parselmouth/phoneme-recognizer@sha256:' + ('a' * 64)
            }
        } | ConvertTo-Json -Depth 12 -Compress
    }
    if ($command -like 'run services update-traffic*') {
        $global:trafficCalls++
        return 'mocked traffic update'
    }
    throw "Unexpected mocked gcloud call: $command"
}

function Assert-Scenario {
    param([string]$Name, [string]$ExpectedError)
    $global:scenario = $Name
    $global:trafficCalls = 0
    $errorText = ''
    $revision = if ($Name -eq 'old-concurrency') { 'phoneme-recognizer-00004-bbc' } else { 'phoneme-recognizer-00018-dis' }
    try {
        & $script:releaseScript -Action Rollback -Service phoneme-recognizer `
            -Revision $revision -ConfigPath $script:configPath | Out-Null
    } catch {
        $errorText = [string]$_.Exception.Message
    }
    if ($ExpectedError) {
        if ($errorText -notmatch $ExpectedError -or $global:trafficCalls -ne 0) {
            throw "$Name did not fail closed before traffic: $errorText (updates=$global:trafficCalls)"
        }
    } elseif ($errorText -or $global:trafficCalls -ne 1) {
        throw "$Name did not reach one mocked traffic update: $errorText (updates=$global:trafficCalls)"
    }
    Write-Host "passed $Name"
}

Assert-Scenario -Name old-concurrency -ExpectedError 'runtime shape'
Assert-Scenario -Name not-ready -ExpectedError 'not ready'
Assert-Scenario -Name bad-probe -ExpectedError 'HTTP readiness probe'
Assert-Scenario -Name iam-drift -ExpectedError 'ACCESS DRIFT'
Assert-Scenario -Name compatible -ExpectedError ''

function python {
    $global:LASTEXITCODE = if ($global:sourceProofPass) { 0 } else { 1 }
}

function Assert-PromoteSourceProof {
    param([bool]$ProofPass)
    $global:scenario = 'compatible'
    $global:sourceProofPass = $ProofPass
    $global:trafficCalls = 0
    $errorText = ''
    try {
        & $script:releaseScript -Action Promote -Service phoneme-recognizer `
            -Revision phoneme-recognizer-00018-dis -Sha ('b' * 40) `
            -Digest ('sha256:' + ('a' * 64)) `
            -BuildId '11111111-2222-3333-4444-555555555555' `
            -SourceRoot $PSScriptRoot -ConfigPath $script:configPath | Out-Null
    } catch {
        $errorText = [string]$_.Exception.Message
    }
    if (-not $ProofPass) {
        if ($errorText -notmatch 'source archive did not match' -or $global:trafficCalls -ne 0) {
            throw "Promote did not fail closed on source mismatch: $errorText"
        }
    } elseif ($errorText -or $global:trafficCalls -ne 1) {
        throw "Promote did not reach one mocked traffic update after source proof: $errorText"
    }
    Write-Host "passed promote source proof=$ProofPass"
}

Assert-PromoteSourceProof -ProofPass $false
Assert-PromoteSourceProof -ProofPass $true
