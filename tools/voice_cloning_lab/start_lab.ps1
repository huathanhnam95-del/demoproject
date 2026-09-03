# Voice Cloning Laboratory - Startup Script (PowerShell)
$ErrorActionPreference = "Stop"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   VOICE CLONING LABORATORY — SOTA A/B/C TEST HARNESS   " -ForegroundColor Yellow
Write-Host "   Comparing: F5-TTS vs. CosyVoice 2 vs. GPT-SoVITS     " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$VENV_PYTHON = "c:\Cursor AI\Kokoro-FastAPI\.venv\Scripts\python.exe"
if (-not (Test-Path $VENV_PYTHON)) {
    $VENV_PYTHON = "python"
}

Write-Host "Starting Standalone Voice Cloning Lab on http://127.0.0.1:8890..." -ForegroundColor Green
Start-Process "http://127.0.0.1:8890"

& $VENV_PYTHON "c:\Cursor AI\tools\voice_cloning_lab\server.py"
