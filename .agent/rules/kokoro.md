# Kokoro TTS Local Engine Rule

**Trigger**: When working with audio generation, pronunciation reference audio, Speech Coach audio, PTE/English Practice TTS, or local Kokoro server tasks.

## Runtime Architecture
- **Location**: `C:\Cursor AI\Kokoro-FastAPI` (git ignored).
- **Service Port**: `http://127.0.0.1:8880` (Uvicorn FastAPI server).
- **Python Environment**: `Kokoro-FastAPI/.venv` (Python 3.11/3.12 managed via `uv sync`).
- **Phonemizer & Espeak**: Uses bundled `espeakng_loader` in `.venv/Lib/site-packages/espeakng_loader` with `PHONEMIZER_ESPEAK_LIBRARY` pointing to `espeak-ng.dll` and `ESPEAK_DATA_PATH` pointing to `espeak-ng-data`.

## Key Endpoints
1. `GET /v1/audio/voices`: Lists available voice packs (68 voices). Default reference voice is `af_heart`.
2. `POST /dev/phonemize`: Converts English text to IPA/Kokoro phonemes (`{ text, language: "a" }`).
3. `POST /dev/generate_from_phonemes`: Directly synthesizes raw phonemes into WAV audio (`{ phonemes, voice }`).
4. `POST /v1/audio/speech`: OpenAI-compatible endpoint for text-to-speech (`{ input, voice, response_format, speed }`).

## Generator Scripts & Workflows
- Speech Coach Audio Generator: `node scripts/kokoro/generate_speech_coach_audio.js`
- Pronunciation Reference Audio: `node scripts/kokoro/generate_pronunciation_reference_audio.js`
- Batch Generators: `scripts/kokoro/kokoro_batch_all_voices.js`, `kokoro_batch_hcs.js`, `kokoro_batch_sst.js`, `kokoro_batch_hiw.js`, `kokoro_batch_smw.js`, `kokoro_batch_rts.js`
- Verification Suite: `node scripts/kokoro/verify_speech_coach_audio.js`

## Model Weights & Cache
- Model directory: `Kokoro-FastAPI/api/src/models/v1_0/` (`kokoro-v1_0.pth` + `config.json`).
- Weights are also cached in HuggingFace cache: `C:\Users\Admin\.cache\huggingface\hub\models--hexgrad--Kokoro-82M`.
