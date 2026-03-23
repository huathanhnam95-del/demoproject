# ElevenLabs Integration Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Set up ElevenLabs integration for both offline (Python) and on-the-fly (Firebase Cloud Function) audio generation for practice modes, without interfering with existing text-to-speech features.

**Architecture:** 
- **Approach A (Offline):** A Python script `scripts/generate_elevenlabs_audio.py` that reads predefined texts, calls ElevenLabs API, and outputs `.mp3` files to `public/audio/`.
- **Approach B (Online):** A Firebase Callable Cloud function `elevenLabsTts` that accepts text from the frontend, securely calls the API without exposing the key, and returns the audio content securely.

**Tech Stack:** Python (`elevenlabs`, `python-dotenv`), Node.js Firebase Functions v2 (`elevenlabs` for node, or native fetch).

---

## User Review Required
Please review the proposed plan to ensure it meets your expectations for the setup. I have also securely saved the API key in `.env`.

---

### Task 1: Initialize Offline Configuration (Approach A)

**Files:**
- Create: `scripts/generate_elevenlabs_audio.py`
- Modify: `requirements.txt` (to append `elevenlabs` and `python-dotenv`)

**Step 1:** Append required python dependencies to `requirements.txt`
```text
elevenlabs
python-dotenv
```

**Step 2:** Write `scripts/generate_elevenlabs_audio.py`
```python
import os
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

# Load from ../.env
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

elevenlabs = ElevenLabs(
    api_key=os.getenv("ELEVENLABS_API_KEY"),
)

def generate_audio_file(text: str, filename: str, voice_id: str = "JBFqnCBsd6RMkjVDRZzb"):
    """
    Generates audio for `text` using ElevenLabs and saves it to `public/audio/` as `filename`
    """
    audio = elevenlabs.text_to_speech.convert(
        text=text,
        voice_id=voice_id, 
        model_id="eleven_v3",
        output_format="mp3_44100_128",
    )
    
    save_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio', filename)
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    
    with open(save_path, "wb") as f:
        for chunk in audio:
            if chunk:
                f.write(chunk)
    
    print(f"Saved audio to {save_path}")

if __name__ == "__main__":
    # Example usage (commented out to prevent accidental execution)
    # generate_audio_file("Hello, this is a test practice sentence.", "test_practice.mp3")
    pass
```

### Task 2: Firebase Backend Cloud Function Setup (Approach B)

**Files:**
- Modify: `functions/package.json`
- Create: `functions/src/elevenLabsTts.js`
- Modify: `functions/src/index.js`

**Step 1:** Add `elevenlabs-node` (via `npm install elevenlabs` or native `fetch`) to `functions/package.json`.
For simplicity and minimal dependencies, we will use native `fetch` (Node 20 supports it) to call the ElevenLabs REST API directly.

**Step 2:** Write `functions/src/elevenLabsTts.js`
```javascript
const { onCall, HttpsError } = require("firebase-functions/v2/https");

exports.elevenLabsTts = onCall({ region: 'us-central1' }, async (request) => {
    // 1. Authenticate user - ensure they are logged in
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in to generate audio.');
    }

    const { text, voiceId } = request.data;
    if (!text) {
        throw new HttpsError('invalid-argument', 'Text is required mapping.');
    }

    const API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!API_KEY) {
        throw new HttpsError('internal', 'ElevenLabs API key is missing from environment.');
    }

    const defaultVoice = "JBFqnCBsd6RMkjVDRZzb";
    const selectedVoice = voiceId || defaultVoice;

    try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': API_KEY,
                'Accept': 'audio/mpeg'
            },
            body: JSON.stringify({
                text: text,
                model_id: "eleven_turbo_v2_5", // Fast model for on-the-fly
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error("ElevenLabs Error:", errBody);
            throw new HttpsError('internal', 'Failed to generate audio from ElevenLabs.');
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Return base64 encoded audio
        return {
            audioBase64: buffer.toString('base64'),
            mimetype: 'audio/mpeg'
        };

    } catch (error) {
        console.error("TTS Error:", error);
        throw new HttpsError('internal', 'An error occurred during text-to-speech generation.');
    }
});
```

**Step 3:** Export it in `functions/src/index.js`
Modify `index.js` to contain:
```javascript
const { elevenLabsTts } = require('./elevenLabsTts');
// ... 
module.exports = {
   // ... existing exports
   elevenLabsTts,
};
```

**Step 4:** Symlink or copy `.env` to `functions/.env` to ensure Cloud Functions emulator picks up the `ELEVENLABS_API_KEY`. (Firebase v2 automatically detects `.env` in the functions directory).

### Verification Plan
- For Task 1 (Offline): I will execute the python script locally with a dummy parameter to verify it properly outputs an `audio/test_practice.mp3` file, confirming authentication works.
- For Task 2 (Online): I will use `npm run serve` to spin up the Firebase emulators, then write a small test script `scripts/test_elevenlabs_function.js` to invoke the `elevenLabsTts` callable function using `firebase/functions` SDK, and verify it returns a valid base64 audio string.
