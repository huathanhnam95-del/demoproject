# Kokoro TTS Local Engine Runbook

## Overview

Kokoro-FastAPI is the local TTS engine powering audio synthesis for:
- Read Aloud Speech Coach linked/reduced speech samples
- Pronunciation reference word audio
- PTE & English Practice multi-voice listening and speaking questions (HCS, SST, HIW, SMW, RTS, LMCSA, LMCMA)

## Directory Structure

```
C:\Cursor AI\Kokoro-FastAPI\
├── .venv\                  # Python 3.12 virtualenv (uv managed)
│   └── Lib\site-packages\espeakng_loader\
│       ├── espeak-ng.dll   # Bundled eSpeak NG dynamic library
│       └── espeak-ng-data\ # Phoneme tables and dictionary data
├── api\
│   └── src\
│       ├── main.py         # FastAPI application entrypoint
│       ├── models\v1_0\    # kokoro-v1_0.pth (327MB) & config.json
│       └── voices\v1_0\    # 68 .pt voice vectors (af_heart, am_adam, etc.)
├── start-cpu.ps1           # Quick launch script (CPU mode)
└── start-gpu.ps1           # Quick launch script (GPU mode)
```

## Setup & Reinstallation Procedure

If the `Kokoro-FastAPI` folder is deleted or corrupted:

1. **Clone repository**:
   ```bash
   git clone https://github.com/remsky/Kokoro-FastAPI.git "C:\Cursor AI\Kokoro-FastAPI"
   ```

2. **Install virtual environment & dependencies**:
   ```bash
   cd "C:\Cursor AI\Kokoro-FastAPI"
   uv sync
   ```

3. **Restore / Download model weights**:
   If cached locally:
   ```powershell
   Copy-Item "C:\Users\Admin\.cache\huggingface\hub\models--hexgrad--Kokoro-82M\snapshots\*\kokoro-v1_0.pth" -Destination "api\src\models\v1_0\kokoro-v1_0.pth"
   Copy-Item "C:\Users\Admin\.cache\huggingface\hub\models--hexgrad--Kokoro-82M\snapshots\*\config.json" -Destination "api\src\models\v1_0\config.json"
   ```
   Or download:
   ```powershell
   .\.venv\Scripts\python.exe docker\scripts\download_model.py --output api\src\models\v1_0
   ```

4. **Start the Server**:
   ```powershell
   .\start-cpu.ps1
   ```

## Verification & Testing

Run all Kokoro test suites from the project root:
```bash
node tests/speech-coach-kokoro-audio.test.js
node tests/hcs-kokoro-guardrails.test.js
node tests/sst-kokoro-guardrails.test.js
node tests/pronunciation-reference-kokoro-generator.test.js
```
