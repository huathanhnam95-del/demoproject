# Voice Cloning Laboratory — Standalone SOTA A/B/C Testing Suite

A dedicated, isolated laboratory and benchmarking harness designed to evaluate and compare the top 3 open-source State-of-the-Art voice cloning architectures:

1. **Model A: F5-TTS** (Flow-Matching Diffusion Transformer)
2. **Model B: CosyVoice 2** (Language Model + Conditional Flow Matching)
3. **Model C: GPT-SoVITS** (Few-Shot Semantic GPT + Soft-VITS)

---

## 🌟 Key Features

* **Complete Isolation**: 100% self-contained in `tools/voice_cloning_lab/` without touching or modifying the main web application.
* **1-Minute Audio Ingestion**: Ingests 10s to 60s reference speech clips (.wav, .mp3) for timbre extraction.
* **Side-by-Side & Double-Blind Testing**:
  * **Side-by-Side Mode**: Direct comparative inspection with real-time RTF, SECS, and WER metrics.
  * **Double-Blind Mode**: Masks model identities (*Candidate Alpha*, *Beta*, *Gamma*) to prevent brand bias during subjective listening tests.
* **Interactive Web Audio API Spectrogram**: Live real-time acoustic visualizer and frequency spectrum analyzer.
* **5-Dimension Quality Scorecard**:
  * ⭐ Speaker Timbre Similarity
  * ⭐ Natural Prosody & Flow
  * ⭐ Pronunciation Clarity
  * ⭐ Artifact / Glitch Resistance
* **One-Click Export**: Export benchmark results to CSV or JSON.

---

## 🚀 How to Run

### Option 1: One-Click Launch (PowerShell)
```powershell
.\tools\voice_cloning_lab\start_lab.ps1
```

### Option 2: Run via Python
```powershell
& "c:\Cursor AI\Kokoro-FastAPI\.venv\Scripts\python.exe" "tools/voice_cloning_lab/server.py"
```
Then open: **`http://127.0.0.1:8890`**

---

## 🧪 Running Automated Tests
```powershell
& "c:\Cursor AI\Kokoro-FastAPI\.venv\Scripts\python.exe" -m unittest "tools/voice_cloning_lab/test_lab.py"
```
