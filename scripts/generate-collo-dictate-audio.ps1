<#
.SYNOPSIS
  Generate Collo-dictate audio assets from public/collocations.json using Windows TTS.

.DESCRIPTION
  Creates one WAV file per unique collocation phrase, named by the same deterministic key
  used by `public/js/collo-dictate-utils.js`:
    public/database/collo-dictate/audio/cd_<hash>.wav

  The Collo-dictate mode will try to play these files first; if missing, it falls back to browser TTS.

.EXAMPLE
  # Generate first 50 files (quick smoke test)
  powershell -ExecutionPolicy Bypass -File scripts/generate-collo-dictate-audio.ps1 -Limit 50

.EXAMPLE
  # Generate all files, skipping ones that already exist
  powershell -ExecutionPolicy Bypass -File scripts/generate-collo-dictate-audio.ps1

.EXAMPLE
  # List installed voices
  powershell -ExecutionPolicy Bypass -File scripts/generate-collo-dictate-audio.ps1 -ListVoices
#>

[CmdletBinding()]
param(
  [string]$CollocationsPath = 'public/collocations.json',
  [string]$OutDir = 'public/database/collo-dictate/audio',
  [int]$Limit = 0,
  [switch]$Overwrite,
  [switch]$DryRun,
  [int]$Rate = 0,
  [ValidateRange(0, 100)]
  [int]$Volume = 100,
  [string]$Voice = '',
  [switch]$ListVoices,
  [switch]$DebugKeys
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Path))
}

function Strip-JsonBom([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  if ($Text.Length -gt 0 -and $Text[0] -eq [char]0xFEFF) {
    return $Text.Substring(1)
  }
  return $Text
}

function Normalize-ForCompare([string]$Text) {
  $t = if ($null -eq $Text) { '' } else { [string]$Text }
  $t = $t.Replace([char]0x2018, "'").Replace([char]0x2019, "'").Replace([char]0x02BC, "'")
  $t = $t.ToLowerInvariant()
  $t = [regex]::Replace($t, "['""]", '')
  $t = [regex]::Replace($t, '[^a-z0-9\s]', ' ')
  $t = $t.Trim()
  $t = [regex]::Replace($t, '\s+', ' ')
  return $t
}

function Get-Fnv1a32Hex([string]$Text) {
  [uint32]$hash = 2166136261
  $s = if ($null -eq $Text) { '' } else { [string]$Text }

  if ($script:DebugKeys) {
    Write-Host "[Debug] fnv input='$s' len=$($s.Length)"
  }

  foreach ($ch in $s.ToCharArray()) {
    # JS uses charCodeAt (UTF-16 code units). After normalization we only have ASCII.
    if ($script:DebugKeys) {
      Write-Host "[Debug] fnv ch='$ch' code=$([int][char]$ch) hash_before=$hash"
    }
    $hash = $hash -bxor [uint32][int][char]$ch
    $hash = [uint32](([uint64]$hash * 16777619) % 4294967296)
    if ($script:DebugKeys) {
      Write-Host "[Debug] fnv hash_after=$hash"
    }
  }

  return $hash.ToString('x8')
}

function Get-ColloAudioKey([string]$Phrase) {
  $normalized = Normalize-ForCompare $Phrase
  $hex = Get-Fnv1a32Hex $normalized
  return "cd_$hex"
}

function Select-PreferredSoftFemaleVoice([System.Speech.Synthesis.SpeechSynthesizer]$Synth) {
  if ($null -eq $Synth) { return $null }

  $voiceInfos = @()
  try {
    $voiceInfos = @($Synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo })
  } catch {
    return $null
  }

  if (-not $voiceInfos -or $voiceInfos.Count -eq 0) { return $null }

  # Prefer common Windows female US voice names (matches typical browser TTS too).
  $zira = $voiceInfos | Where-Object { $_.Name -match 'Zira' } | Select-Object -First 1
  if ($zira -and $zira.Name) {
    try { $Synth.SelectVoice($zira.Name); return $zira.Name } catch { }
  }

  $femaleEnUs = $voiceInfos | Where-Object {
    $_.Gender -eq 'Female' -and $_.Culture -and $_.Culture.Name -eq 'en-US'
  } | Select-Object -First 1
  if ($femaleEnUs -and $femaleEnUs.Name) {
    try { $Synth.SelectVoice($femaleEnUs.Name); return $femaleEnUs.Name } catch { }
  }

  $femaleEn = $voiceInfos | Where-Object {
    $_.Gender -eq 'Female' -and $_.Culture -and ($_.Culture.Name -like 'en-*')
  } | Select-Object -First 1
  if ($femaleEn -and $femaleEn.Name) {
    try { $Synth.SelectVoice($femaleEn.Name); return $femaleEn.Name } catch { }
  }

  $femaleAny = $voiceInfos | Where-Object { $_.Gender -eq 'Female' } | Select-Object -First 1
  if ($femaleAny -and $femaleAny.Name) {
    try { $Synth.SelectVoice($femaleAny.Name); return $femaleAny.Name } catch { }
  }

  return $null
}

$collocationsFullPath = Resolve-RepoPath $CollocationsPath
$outDirFullPath = Resolve-RepoPath $OutDir

Add-Type -AssemblyName System.Speech

if ($ListVoices) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Sort-Object Name
  $voices | Format-Table Name, Culture, Gender, Age -AutoSize
  $s.Dispose()
  exit 0
}

if (-not (Test-Path $collocationsFullPath)) {
  throw "Collocations file not found: $collocationsFullPath"
}

Write-Host "Loading: $collocationsFullPath"
$raw = Get-Content -Path $collocationsFullPath -Raw -Encoding UTF8
$raw = Strip-JsonBom $raw
$data = ConvertFrom-Json -InputObject $raw

$phraseSet = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($prop in $data.PSObject.Properties) {
  # Include base key words/phrases too (not just the collocation list values).
  if ($prop.Name -is [string]) {
    $k = $prop.Name.Trim()
    if (-not [string]::IsNullOrWhiteSpace($k)) {
      [void]$phraseSet.Add($k)
    }
  }

  $value = $prop.Value
  if (-not ($value -is [System.Array])) { continue }
  foreach ($entry in $value) {
    if (-not ($entry -is [string])) { continue }
    $phrase = $entry.Trim()
    if ([string]::IsNullOrWhiteSpace($phrase)) { continue }
    [void]$phraseSet.Add($phrase)
  }
}

$phrases = $phraseSet | Sort-Object
if ($Limit -gt 0) {
  $phrases = $phrases | Select-Object -First $Limit
}

New-Item -ItemType Directory -Force -Path $outDirFullPath | Out-Null

Write-Host "Output dir: $outDirFullPath"
Write-Host "Phrases: $($phrases.Count)"
Write-Host "Mode lookup: public/database/collo-dictate/audio/cd_<hash>.wav"

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = $Rate
$synth.Volume = $Volume

if (-not [string]::IsNullOrWhiteSpace($Voice)) {
  $synth.SelectVoice($Voice)
} else {
  [void](Select-PreferredSoftFemaleVoice $synth)
}

$voiceInfo = $synth.Voice
if ($voiceInfo -and $voiceInfo.Name) {
  Write-Host "Voice: $($voiceInfo.Name) [$($voiceInfo.Culture.Name)]"
} else {
  Write-Host "Voice: (default)"
}

$generated = 0
$skipped = 0
$failed = 0
$startedAt = Get-Date

for ($i = 0; $i -lt $phrases.Count; $i += 1) {
  $phrase = [string]$phrases[$i]
  $key = Get-ColloAudioKey $phrase
  $outPath = Join-Path $outDirFullPath "$key.wav"

  if ((-not $Overwrite) -and (Test-Path $outPath)) {
    $skipped += 1
    continue
  }

  if ($DebugKeys) {
    $normalized = Normalize-ForCompare $phrase
    $hex = Get-Fnv1a32Hex $normalized
    Write-Host "[Debug] phrase='$phrase' norm='$normalized' hex='$hex'"
  }

  $pct = [int](($i + 1) * 100 / [math]::Max(1, $phrases.Count))
  Write-Progress -Activity 'Generating Collo-dictate WAV audio' -Status "$($i + 1)/$($phrases.Count)" -PercentComplete $pct

  if ($DryRun) {
    Write-Host "[DryRun] $outPath <= $phrase"
    $generated += 1
    continue
  }

  try {
    $synth.SetOutputToWaveFile($outPath)
    $synth.Speak($phrase)
    $synth.SetOutputToNull()
    $generated += 1
  } catch {
    $failed += 1
    try { $synth.SetOutputToNull() } catch { }
    Write-Warning "Failed: $phrase -> $outPath ($($_.Exception.Message))"
  }
}

Write-Progress -Activity 'Generating Collo-dictate WAV audio' -Completed
$synth.Dispose()

$elapsed = (Get-Date) - $startedAt
Write-Host ''
Write-Host "Done in $([int]$elapsed.TotalSeconds)s"
Write-Host "Generated: $generated"
Write-Host "Skipped:   $skipped"
Write-Host "Failed:    $failed"
