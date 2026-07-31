# Pronounce retry and manual-segmentation status report

Date: July 31, 2026  
Scope: Local Pronounce mode changes and the proposed admin-only production sample-collection path  
Status: Local implementation and verification complete; production deployment pending explicit approval

## 1. Executive summary

Two related issues were reproduced in the local Pronounce flow:

1. Repeated low-confidence recordings stayed on the same generic “try again” message instead of applying the two-retry rule.
2. The automatic syllable segmentation for `industrial` did not match the saved manual review. It split `dus`, failed to identify `tri`, and created an artificial gap before the final span.

The retry issue is fixed in the V2 learner-feedback path. The segmentation pipeline now avoids splitting an already count-matched result and then pruning the manufactured span. That removes the artificial gap, but the recording still does not contain reliable acoustic evidence for the `tri` boundary; more manually labeled samples are needed before changing the general segmentation model.

Manual review is now enabled on localhost and gated to verified admins off localhost. The production corpus-save endpoint already has server-side admin authorization. No production deployment was performed.

## 2. Reproduced retry issue

### Observed behavior

The user recorded the same word five times and continued to see:

> The recording was detected, but confidence is too low for detailed stress feedback. Please try again.

### Root cause

The local configuration is using the V2 learner path (`usePronunciationV3LearnerAnalysis: false`). The V3 path already used the attempt policy, but V2 `renderSyllableFeedback()` bypassed it and always rendered the same message. The attempt state therefore never advanced.

### Current behavior

For evidence-based, low-confidence V2 results, the state is keyed by word, reference variant, IPA, and expected syllable count:

| Recording | Learner-facing result |
|---|---|
| Initial attempt | `re-recording 1 of 2` |
| First retry | `re-recording 2 of 2` |
| Third and later attempts | Advisory that the result may be inaccurate, with manual review available |

Formal results reset the sequence. Service outages and transport failures do not consume an attempt.

Implementation: `public/pronunciation-analyzer/app.js` and `public/pronunciation-analyzer/verification-attempt-policy.js`.

## 3. Industrial manual-review comparison

Source artifact: `test-results/pronounce-local-samples/industrial-manual-review-20260731051338161-201c5c5f.json`  
Audio: `test-results/pronounce-local-samples/industrial-manual-review-20260731051338161-201c5c5f.wav`

The manual labels were `in / dus / tri / al`:

| Syllable | Manual interval | Duration |
|---|---:|---:|
| `in` | 0.713–0.894 s | 0.181 s |
| `dus` | 0.894–1.231 s | 0.337 s |
| `tri` | 1.234–1.414 s | 0.181 s |
| `al` | 1.420–1.707 s | 0.288 s |

The automatic spans stored with the manual sample were:

| Span | Automatic interval | Duration |
|---|---:|---:|
| 1 | 0.695–0.955 s | 0.260 s |
| 2 | 0.955–1.030 s | 0.075 s |
| 3 | 1.030–1.165 s | 0.135 s |
| 4 | 1.325–1.785 s | 0.460 s |

The important differences are:

- `dus` was divided into three automatic pieces spanning 0.894–1.165 s.
- No automatic span represented the manually marked `tri` interval.
- The saved automatic output had a 160 ms gap between spans 3 and 4.
- The manual boundaries were effectively continuous; the only internal gaps were about 2.7 ms and 5.5 ms.

### Segmentation fix and fresh reanalysis

The detector was splitting an oversized final span even though it already had the expected four spans. It then pruned the zero-pitch candidate, which created the 160 ms gap. The guard in `backend/local_server/server.py` now skips that split when `len(syllables) >= expected_count`.

Fresh local reanalysis after the guard produced:

```text
0.695–0.955 s
0.955–1.030 s
1.030–1.165 s
1.165–1.785 s
```

The artificial gap is gone. The remaining limitation is substantive: the acoustic pass still splits `dus` and absorbs `tri` into the final span because the `tri` portion has insufficient reliable voicing/pitch evidence. The stress evidence was still low-confidence (`0.39`). This sample should be retained as a manual label for corpus analysis, not used as a word-specific hard-coded correction.

## 4. Manual review access and saving

### Local behavior

- Localhost and loopback continue to expose local sample saving and manual segmentation.
- Local debug samples remain under `test-results/pronounce-local-samples/`.

### Non-local behavior

- The UI requests `/api/admin/status` with the current Firebase ID token.
- Manual review controls are enabled only when the server confirms `success: true` and `isAdmin: true`.
- The cloud save request remains `/api/admin/dev/save-corpus-sample`.
- The server-side route is admin-protected; the router fallback was changed to fail closed instead of promoting an arbitrary authenticated user.

This keeps manual review out of the general learner UI while allowing the admin account to collect labeled samples after deployment.

## 5. Verification evidence

Passed locally:

```text
npm run test:pronounce:logic
node --no-warnings tests/pronunciation-analyzer/verification-attempt-policy.test.mjs
python -m unittest backend.test_pronunciation_alignment_v2
npm run test:pronounce:browser
node tests/crm/admin-status-security.test.js
node tests/crm/pronunciation-corpus-production-route.test.js
npx eslint public/pronunciation-analyzer/app.js public/pronunciation-analyzer/verification-attempt-policy.js tests/browser/pronounce-mode-browser-check.js functions/src/routes/admin/create-crm-router.js
```

The browser suite passed the V2 retry sequence, the admin/non-admin manual-review gate, waveform playback, and manual save behavior. The backend alignment suite passed 47 tests.

## 6. Current deployment state and next steps

Current state:

- Local code and tests are updated.
- The `industrial` sample is saved locally and analyzed.
- The production corpus route exists and is server-authorized.
- No Firebase hosting/functions deployment was run.
- The Pronounce V3 learner flag remains unchanged/off; this report concerns the V2 retry path and the admin-only manual-review collection path.

Next steps:

1. Explicitly approve a production deployment.
2. Deploy hosting and the functions revision together, then verify `/api/admin/status` and `/api/admin/dev/save-corpus-sample` independently.
3. Sign in with the documented admin test account and confirm the manual-review controls are visible only for that account.
4. Collect a broader set of manual labels, especially words with weak or unvoiced syllables, before making another general segmentation change.

## 7. Decision

The retry defect is fixed and locally verified. The segmentation guard is safe and removes a demonstrated artifact, but the `industrial` sample does not yet justify a full automatic segmentation-model change. Production enablement is ready for a separately approved deployment and admin-only smoke check.
