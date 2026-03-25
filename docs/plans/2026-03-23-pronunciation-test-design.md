# Segmental Pronunciation Screening Test Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `executing-plans` to implement this plan task-by-task.

**Goal:** Build a sub-10-minute segmental pronunciation screening mode for Vietnamese learners of English using Azure Pronunciation Assessment as the primary scoring engine and Praat as a secondary vowel-visualization tool.

**Architecture:** The browser records short isolated-word responses. A new Express route under `src/routes` sends 16 kHz mono WAV audio to Azure Pronunciation Assessment (`en-US`, phoneme granularity, miscue enabled), extracts the target phoneme result for the current item, and returns raw Azure evidence plus spoken-phoneme candidates. For vowel items only, the frontend optionally requests a Praat vowel-analysis endpoint that returns exploratory F1/F2 measurements for visualization only. The MVP is a screening tool, not a formal exam: no arbitrary score inflation, no pass/fail cutoffs, and no Praat-derived score contribution until human validation is complete.

**Tech Stack:** Vanilla JS, Node/Express (`src/server/app.js`, `src/routes`), Flask/Parselmouth (`backend/local_server/server.py`), Azure AI Speech Pronunciation Assessment REST API, Playwright browser checks, Node smoke scripts.

---

## Scope Guardrails

- Under 10 minutes end-to-end, including instructions, recording, upload, and feedback.
- Segmentals only. No stress, rhythm, prosody, or fluency scoring in this mode.
- Azure is the only scoring source in v1.
- Praat visuals are explicitly marked exploratory and do not affect scores.
- No score inflation curve such as `raw * 1.25`.
- No consonant-cluster scoring in the stage-1 screen. Clusters are deferred to a later drill-down module.
- All prompts must be high-frequency, familiar words. Avoid low-frequency items and spelling traps.
- `en-US` only in v1 so the Azure phoneme inventory and spoken-phoneme evidence stay consistent.

## Non-Goals

- No summative grade, placement decision, or certification claim.
- No speaker-normalized vowel scoring in v1.
- No attempt to infer VOT or consonant quality from pitch/intensity alone.
- No ElevenLabs dependency in MVP. Native audio is optional and the UI must degrade cleanly when it is absent.

---

## Test Blueprint

### Stage Structure

| Stage | Purpose | Item Count | Time Target |
|---|---|---:|---:|
| Stage 0 | Mic check + practice | 1 unscored item | ~1 min |
| Stage 1 | Core screen | 12 scored items | ~5-6 min |
| Stage 2 | Adaptive follow-up | 4 scored items | ~2 min |
| Results | Contrast summary | 1 screen | ~1 min |

**Total target:** 8-9 minutes for a normal run, with a hard cap below 10 minutes.

### Stage 1 Contrast Set

Use 6 contrasts with 2 tokens each:

| Contrast | Type | Example Tokens | Notes |
|---|---|---|---|
| `/i/` vs `/ɪ/` | vowel | `sheep`, `ship` | High-value vowel contrast for VN learners |
| `/ɛ/` vs `/æ/` | vowel | `pen`, `pan` | Keep spelling simple |
| `/u/` vs `/ʊ/` | vowel | `fool`, `full` | Avoid sentence context in v1 |
| `/θ/` vs `/t/` | consonant | `thin`, `tin` | Better isolation than `think` |
| `/ð/` vs `/d/` | consonant | `then`, `den` | Keep final segment simple |
| `/ʃ/` vs `/tʃ/` | consonant | `ship`, `chip` | High diagnostic value |

### Stage 2 Follow-Up Logic

- Select the 2 weakest contrasts from Stage 1.
- Present 2 fresh tokens for each weak contrast.
- Do not repeat the exact same token unless the user explicitly taps retry.
- If Azure fails to return target-phoneme evidence for an item, replace that item with another token from the same contrast.

### Item Design Rules

- Each scored item should isolate one target contrast.
- Prefer CV, CVC, or simple CVCC words.
- Do not use onset or coda clusters in the screening stage.
- Do not use pseudo-words in v1.
- Do not use morphologically confounded items such as inflectional `-s` or `-ed` forms in the core screen.
- Keep text prompts readable at a glance and familiar to A1-B1 learners.

---

## Scoring Model

### Azure as the Scoring Source

For each item, request:

```json
{
  "ReferenceText": "thin",
  "GradingSystem": "HundredMark",
  "Granularity": "Phoneme",
  "PhonemeAlphabet": "IPA",
  "EnableMiscue": true
}
```

### What We Store

For each item, store:

- `wordAccuracyScore`
- `targetPhonemeAccuracyScore`
- `targetPhoneme`
- `targetPosition`
- `spokenPhonemeCandidates`
- `wordErrorType`
- `azureRecognizedText`
- `rawPhonemes`

### What We Do Not Do

- Do not average all phonemes in the word and call that the target score.
- Do not inflate raw scores.
- Do not convert the first release to pass/fail.
- Do not mix Praat values into the score.

### Contrast-Level Result

The contrast summary should be computed from the two target-phoneme scores for that contrast:

```text
contrastScore = mean(targetPhonemeAccuracyScore across valid tokens)
```

If one token is invalid, use the remaining valid token and mark the contrast as `lowConfidence`.

### User-Facing Feedback

The MVP UI should show:

- raw Azure target-phoneme score
- a short explanation using spoken-phoneme candidates when available
- a contrast label such as `clear`, `close`, or `needs review`

These labels must be stored in config and explicitly marked `provisional` until validation is complete.

---

## Praat Role in v1

Praat is used only for vowel visualization on vowel items.

### Allowed Praat Outputs

- vowel nucleus time window
- F1/F2 samples at 35%, 50%, and 65% of the detected vowel nucleus
- raw pitch at the nucleus midpoint
- metadata flag: `exploratory: true`

### Forbidden Praat Uses in v1

- no Praat-derived pronunciation score
- no Praat-derived consonant accuracy score
- no claims that pitch/intensity alone measure VOT
- no fixed red-dot-against-one-target chart presented as authoritative accuracy

### Frontend Copy Requirement

Any vowel chart shown from Praat must include helper text such as:

> "Exploratory acoustic hint only. This chart does not affect your score."

---

## File Plan

### New Files to Create

| File | Purpose |
|---|---|
| `src/routes/pronunciation-test.js` | Express route for Azure assessment and result shaping |
| `public/pronunciation-test/index.html` | Screening UI |
| `public/pronunciation-test/test-mode.js` | Frontend controller for stage flow, recording, and rendering |
| `public/pronunciation-test/test-bank.js` | Browser loader + item selection helpers |
| `public/pronunciation-test/test-bank.json` | Static test bank served directly from `public/` |
| `tests/browser/pronunciation-test-browser-check.js` | Browser contract test for the UI flow |
| `scripts/smoke-pronunciation-test-route.js` | Manual/CI smoke script for the API contract |
| `docs/audits/pronunciation-test/validation-protocol.md` | Human-rating protocol and launch criteria |
| `scripts/evals/pronunciation-test-metrics.js` | Metric calculator for validation runs |
| `data/evals/pronunciation-test/template.csv` | Template for human ratings + Azure outputs |

### Existing Files to Modify

| File | What Changes |
|---|---|
| `src/server/app.js` | Mount the new route under `/api` |
| `package.json` | Add direct dependency on `multer`; add scripts for smoke/browser/eval checks |
| `public/index.html` | Add the new practice-mode card |
| `public/pronunciation-analyzer/praat-api.js` | Reuse WAV conversion helper and add vowel-only API method if useful |
| `backend/local_server/server.py` | Add `/analyze-vowel` exploratory endpoint |

---

## Task 1: Add the Static Test Bank and Selection Rules

**Files:**
- Create: `public/pronunciation-test/test-bank.json`
- Create: `public/pronunciation-test/test-bank.js`

**Step 1: Create the JSON test bank**

Use a structure like:

```json
[
  {
    "id": "practice-thin-001",
    "stage": 0,
    "word": "thin",
    "displayIpa": "θɪn",
    "referenceText": "thin",
    "targetPhoneme": "θ",
    "targetPosition": "initial",
    "category": "dental-fricative",
    "contrastId": "theta-t",
    "nativeAudioUrl": null,
    "isPractice": true
  },
  {
    "id": "core-ship-001",
    "stage": 1,
    "word": "ship",
    "displayIpa": "ʃɪp",
    "referenceText": "ship",
    "targetPhoneme": "ʃ",
    "targetPosition": "initial",
    "category": "fricative-affricate",
    "contrastId": "sh-ch",
    "nativeAudioUrl": null,
    "isPractice": false
  }
]
```

**Step 2: Implement the browser loader**

Requirements:

- fetch from `./test-bank.json` or `/pronunciation-test/test-bank.json`
- export `TestBank`
- expose `getPracticeItem()`, `getStageOneItems()`, `getFollowUpItems(weakContrastIds)`
- do not fetch from `/data/...`

**Step 3: Add a contract check**

Run:

```bash
node -e "const fs=require('fs'); const bank=JSON.parse(fs.readFileSync('public/pronunciation-test/test-bank.json','utf8')); console.log(bank.length)"
```

Expected: a number greater than or equal to `17` for the initial build.

**Step 4: Commit**

```bash
git add public/pronunciation-test/test-bank.json public/pronunciation-test/test-bank.js
git commit -m "feat(pron-test): add screening test bank and loader"
```

---

## Task 2: Add the Azure Assessment Route in the Real Server Structure

**Files:**
- Create: `src/routes/pronunciation-test.js`
- Modify: `src/server/app.js`
- Modify: `package.json`

**Step 1: Add direct dependency support**

Add:

```json
"multer": "^2.0.2"
```

Also add scripts:

```json
"smoke:pronunciation-test": "node scripts/smoke-pronunciation-test-route.js",
"test:pronunciation-test:browser": "node tests/browser/pronunciation-test-browser-check.js"
```

**Step 2: Create the new route**

The route should:

- expose `POST /api/pronunciation-test/assess`
- accept multipart audio upload plus item metadata
- reject missing `word`, `targetPhoneme`, or `targetPosition`
- call Azure short-audio Pronunciation Assessment
- extract:
  - full word result
  - target phoneme result
  - spoken-phoneme candidates for the target phoneme
- return raw evidence without remapping

Response shape:

```json
{
  "provisional": true,
  "word": "thin",
  "targetPhoneme": "θ",
  "targetPosition": "initial",
  "wordAccuracyScore": 78,
  "targetPhonemeAccuracyScore": 64,
  "spokenPhonemeCandidates": [
    { "phoneme": "t", "score": 0.71 },
    { "phoneme": "θ", "score": 0.24 }
  ],
  "wordErrorType": "Mispronunciation",
  "azureRecognizedText": "thin",
  "rawPhonemes": []
}
```

**Step 3: Mount it in the actual app**

In `src/server/app.js`, add the route to the `routes` object and mount it with the other `/api` routes.

**Step 4: Smoke-test the route**

Run:

```bash
node scripts/smoke-pronunciation-test-route.js
```

Expected:

- clear error if `AZURE_SPEECH_KEY` is missing
- `200` plus JSON contract when a valid fixture and key are present
- no score inflation fields such as `calibratedScore`

**Step 5: Commit**

```bash
git add package.json package-lock.json src/routes/pronunciation-test.js src/server/app.js scripts/smoke-pronunciation-test-route.js
git commit -m "feat(pron-test): add Azure-backed screening route"
```

---

## Task 3: Add the Praat Vowel-Only Exploratory Endpoint

**Files:**
- Modify: `backend/local_server/server.py`

**Step 1: Add `/analyze-vowel`**

Behavior:

- accept only short single-word WAV uploads
- reject consonant items
- find the voiced vowel nucleus inside the short utterance
- return:
  - `nucleusStart`
  - `nucleusEnd`
  - `samples`: F1/F2 at 35%, 50%, and 65%
  - `midPitch`
  - `exploratory: true`

Response shape:

```json
{
  "exploratory": true,
  "nucleusStart": 0.11,
  "nucleusEnd": 0.23,
  "samples": [
    { "pct": 35, "f1": 410.2, "f2": 1964.1 },
    { "pct": 50, "f1": 398.4, "f2": 2010.5 },
    { "pct": 65, "f1": 389.8, "f2": 2051.7 }
  ],
  "midPitch": 178.3
}
```

**Step 2: Do not add a Praat score**

The endpoint must not return:

- `score`
- `distanceFromTarget`
- `pass`
- `fail`

**Step 3: Test it manually**

Run:

```bash
curl -X POST http://localhost:5000/analyze-vowel -F "audio=@path/to/test-vowel.wav" -F "targetPhoneme=ɪ"
```

Expected: JSON with `exploratory: true` and a non-empty `samples` array.

**Step 4: Commit**

```bash
git add backend/local_server/server.py
git commit -m "feat(pron-test): add exploratory vowel analysis endpoint"
```

---

## Task 4: Build the Frontend Screening Flow

**Files:**
- Create: `public/pronunciation-test/index.html`
- Create: `public/pronunciation-test/test-mode.js`
- Modify: `public/pronunciation-analyzer/praat-api.js`
- Modify: `public/index.html`

**Step 1: Build the page shell**

The screen must include:

- objective text: `Segmental Screening`
- one visible prompt card
- a touch-safe record button using pointer events or tap-to-toggle
- clear state text: `Ready`, `Recording`, `Uploading`, `Scoring`
- stage progress indicator
- target-only feedback card
- optional vowel hint panel that can be hidden for consonant items

**Step 2: Implement the stage flow**

Requirements:

- Stage 0: one practice item, unscored
- Stage 1: 12 items from the bank
- Stage 2: 4 adaptive items from the 2 weakest contrasts
- if the user cancels or a route call fails, keep the current item and allow retry
- if `nativeAudioUrl` is missing, hide or disable the native-audio button without error

**Step 3: Render trustworthy feedback**

For each item, show:

- target phoneme
- raw target-phoneme score
- one short explanation using spoken-phoneme candidates when available
- provisional label such as `clear`, `close`, or `needs review`

For vowel items only:

- optionally request `/analyze-vowel`
- render an exploratory panel or small chart
- include the copy: `Exploratory acoustic hint only. This chart does not affect your score.`

**Step 4: Add the dashboard card**

Add a new practice card in `public/index.html` that links to `/pronunciation-test/index.html`.

**Step 5: Browser-check the flow**

Run:

```bash
node tests/browser/pronunciation-test-browser-check.js
```

Expected:

- page loads without console errors
- progress indicator is visible
- practice item appears first
- UI can transition through mock scoring states
- no corrupted text markers

**Step 6: Commit**

```bash
git add public/index.html public/pronunciation-test/ public/pronunciation-analyzer/praat-api.js tests/browser/pronunciation-test-browser-check.js
git commit -m "feat(pron-test): add screening UI and browser contract check"
```

---

## Task 5: Add a Validation Protocol Before Any Score Calibration

**Files:**
- Create: `docs/audits/pronunciation-test/validation-protocol.md`
- Create: `scripts/evals/pronunciation-test-metrics.js`
- Create: `data/evals/pronunciation-test/template.csv`

**Step 1: Write the protocol**

The protocol must require:

- at least 2 human raters with phonetics or ESL teaching experience
- ratings from Vietnamese learners plus a small native-control sample
- item-level judgments focused on the target contrast, not general accent quality
- separate reporting for vowels and consonants

**Step 2: Create the evaluation template**

Columns:

```text
speaker_id,item_id,contrast_id,target_phoneme,azure_score,human_rater_1,human_rater_2,notes
```

**Step 3: Build the metrics script**

The script should compute:

- overall score correlation
- per-contrast agreement
- confusion counts by expected vs heard phoneme category
- a list of items with large model-human disagreements

Run:

```bash
node scripts/evals/pronunciation-test-metrics.js data/evals/pronunciation-test/template.csv
```

Expected: a readable summary with no uncaught errors.

**Step 4: Define the launch rule**

The MVP may ship as a **provisional screening tool** once the protocol exists and raw scores are clearly labeled provisional.

The product may **not**:

- remap raw scores
- publish pass/fail decisions
- claim assessment validity

until a completed validation run is reviewed.

**Step 5: Commit**

```bash
git add docs/audits/pronunciation-test/validation-protocol.md scripts/evals/pronunciation-test-metrics.js data/evals/pronunciation-test/template.csv
git commit -m "docs(pron-test): add validation protocol and metrics tooling"
```

---

## Verification Plan

### Automated / Scripted Checks

**A. Test Bank Contract**

```bash
node -e "const fs=require('fs'); const bank=JSON.parse(fs.readFileSync('public/pronunciation-test/test-bank.json','utf8')); console.log(bank.filter(i=>i.stage===1).length)"
```

Expected: `12`

**B. Route Smoke Check**

```bash
node scripts/smoke-pronunciation-test-route.js
```

Expected:

- helpful config error when Azure env vars are missing
- contract-valid JSON when fixture audio and env vars are present

**C. Browser Contract Check**

```bash
node tests/browser/pronunciation-test-browser-check.js
```

Expected:

- no page errors
- no corrupted text markers
- stage flow visible
- mock scoring path completes

### Manual Checks

1. Open `https://localhost:8443` and verify the new card appears.
2. Open `/pronunciation-test/index.html` and verify the practice item loads first.
3. Record the practice item and confirm no permanent score is stored.
4. Complete Stage 1 and confirm exactly 12 scored items are shown.
5. Confirm Stage 2 only shows 4 items based on the weakest contrasts.
6. For a consonant item, confirm no vowel chart is shown.
7. For a vowel item, confirm any Praat panel is labeled exploratory and non-scoring.
8. Confirm the displayed numeric score matches the raw Azure target-phoneme score with no inflation.

---

## Edge Cases to Explicitly Handle

- Azure recognizes the whole word but does not return a usable target-phoneme candidate.
- Azure returns a low score for an acceptable English variant such as an unreleased final stop or a flapped `/t/`.
- The learner inserts a schwa; `EnableMiscue` should help surface insertion/omission risk.
- The user is on a touch device; `mousedown`/`mouseup` alone is not acceptable.
- `nativeAudioUrl` is missing; the UI must not break.
- Praat fails or times out; the Azure result should still complete.
- The item bank contains duplicate tokens for the same contrast; Stage 2 must choose unused items first.
- A vowel item returns implausible formants; the frontend should hide the chart rather than render misleading values.

---

## Notes for the Implementer

- Keep the first release narrow. This is a screening mode, not a full pronunciation tutor.
- The core score is the target phoneme only. Do not let the other phonemes in the word dilute the result.
- If a future phase adds clusters, build that as a separate subtest with its own validation pass.
- If future research supports calibrated bands, add them after the validation protocol produces real data.
