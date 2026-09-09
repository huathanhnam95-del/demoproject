param([Parameter(Mandatory=$true)][string]$TextFile, [Parameter(Mandatory=$true)][string]$OutputFile, [Parameter(Mandatory=$true)][string]$Voice)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($TextFile) -or -not [IO.Path]::IsPathRooted($OutputFile)) { throw 'Absolute offline file paths required' }
if (Test-Path -LiteralPath $OutputFile) { throw 'Audio output exists; refusing overwrite' }
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $installed = @($speech.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq $Voice })
    if ($installed.Count -ne 1) { throw 'Requested System.Speech voice is unavailable; no network fallback' }
    $speech.SelectVoice($Voice)
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $speech.SetOutputToWaveFile($OutputFile, $format)
    $speech.Speak([IO.File]::ReadAllText($TextFile))
    $speech.SetOutputToNull()
} finally { $speech.Dispose() }
