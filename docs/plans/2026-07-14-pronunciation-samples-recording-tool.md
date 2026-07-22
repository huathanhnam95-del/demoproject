# Pronunciation Samples Recording Tool Design

This document outlines the design and implementation plan for the local "Pronunciation Samples" recording page, accessed from the Developer Tools panel in the CRM.

---

## 1. Objectives

- **Goal:** Provide a local, self-contained web utility inside the CRM to record and build the evaluation corpus (`test-results/pronunciation-segmentation-corpus/*.wav` and `tests/fixtures/pronunciation-segmentation/manifest.json`).
- **Prerequisites:** Must run entirely on localhost, bypass production databases/cloud buckets, and store recorded files directly to the local disk.
- **Privacy:** Generate deidentified metadata matching the schema rules, and automatically compute SHA-256 hashes for manifest recording.

---

## 2. User Interface

The recording tool will be implemented as a new Developer panel inside `public/crm-admin.html` and managed by `public/crm-admin.js`.

### Navigation
- A new subtab/view will be added to the CRM's **Dev Tools** section named **🎙️ Pronunciation Samples**.
- It is only visible when local dev/emulator mode is confirmed (using the existing `state.devToolsAvailable` visibility flag).

### Left Column: Word & Metadata Selector
- **Mandatory Word List:** Quick-navigation buttons for the 6 required words:
  - `busy` (2 syllables, `/ˈbɪz.i/`)
  - `photograph` (3 syllables, `/ˈfoʊ.tə.ɡræf/`)
  - `photography` (4 syllables, `/fəˈtɑː.ɡrə.fi/`)
  - `banana` (3 syllables, `/bəˈnæn.ə/`)
  - `camera` (2 or 3 syllables, `/ˈkæm.rə/` or `/ˈkæm.ər.ə/`)
  - `university` (5 syllables, `/ˌjuː.nɪˈvɜːr.sə.t̬i/`)
- **Custom Word Input:** Text input allowing the user to type other words to reach the 120 total target recordings.
- **Expected Syllable Count:** Input field pre-filled with the word's canonical syllable count, adjustable if recording insertions/omissions.
- **Category Selector:** Dropdown selector (`clean`, `omission`, `insertion`, `accented`, `unrateable`).
- **Deidentified Cohort ID:** Input field for speaker cohort (e.g. `native-us`, `l1-vn-01`).
- **American-English IPA Reference:** Text field (auto-prefilled for mandatory words).

### Right Column: Recording Console
- **Microphone Status Indicator:** Displays authorization status.
- **Record & Redo Buttons:**
  - **Start Record:** Instantiates `MediaRecorder` or a Web Audio stream to capture mic inputs.
  - **Stop:** Stops recording, processes audio into a Blob.
  - **Redo:** Clears the active recording to allow retrying before saving.
- **Audio Playback:** A simple `<audio>` player to review the recorded attempt locally before committing it.
- **Save to Corpus Button:** Send a `POST` request with the WAV audio file and metadata to the local backend.
- **Status Log:** Shows success/error feedback (e.g., "Saved banana-clean-cohort-1.wav and updated manifest.json").

---

## 3. Client-Side Audio Processing

To satisfy V3 model requirements, the audio must be stored as uncompressed `16-bit PCM WAV`.
We will implement an inline JavaScript WAV encoder. When the user stops recording:
1. We feed the raw Float32 audio samples from the `AudioContext` / `AudioBuffer` node.
2. The encoder downmixes stereo to mono and structures a valid 44-byte WAV header.
3. It packages the PCM data as a binary `Blob` with type `audio/wav`.
4. This ensures native compatibility without requiring the local server to run binary transcoder executables.

---

## 4. Backend Local Endpoint

We will register a local-only developer route inside `src/routes/admin.js`:

```javascript
router.post('/dev/save-corpus-sample', localAuthMiddleware, upload.single('audio'), async (req, res) => { ... })
```

### Save Process
1. Check if the environment is a local emulator (`FIRESTORE_EMULATOR_HOST` present). If not, reject with 403.
2. Read the metadata payload: `sampleId`, `targetWord`, `referenceIpa`, `expectedObservedCount`, `targetSyllableCount`, `category`, `speakerCohort`.
3. Save the audio buffer to `test-results/pronunciation-segmentation-corpus/[sampleId].wav`. If a file with that name exists, overwrite it.
4. Calculate the SHA-256 hash of the saved WAV.
5. Read `tests/fixtures/pronunciation-segmentation/manifest.json`.
6. Insert or update the entry in the `entries` array:
   ```json
   {
     "sampleId": "[sampleId]",
     "targetWord": "[targetWord]",
     "referenceIpa": "[referenceIpa]",
     "expectedObservedCount": [expectedObservedCount],
     "targetSyllableCount": [targetSyllableCount],
     "category": "[category]",
     "speakerCohort": "[speakerCohort]",
     "sourceHash": "[calculated_sha256]",
     "labelProvenance": "manual",
     "verifiedSpans": null
   }
   ```
7. Re-write the updated `manifest.json`.
8. Return a 200 OK response with the generated file path and updated manifest stats.

---

## 5. Verification Plan

### Automated Tests
- Run `python -m unittest backend.test_pronunciation_segmentation_corpus` to confirm manifest validation is intact after saves.
- Run a new endpoint integration test verifying validation rules and local filesystem write permissions.

### Manual Verification
- Launch the CRM local server, navigate to the Dev Tools panel, and ensure the new **Pronunciation Samples** section loads.
- Record a sample for the word `banana` under category `clean`, click **Save**, and check that:
  - `test-results/pronunciation-segmentation-corpus/banana-clean-*.wav` exists on disk.
  - `manifest.json` contains the deidentified entry and matching SHA-256 checksum.
