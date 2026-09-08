# Opt-in native data-input acceptance

This harness is intentionally absent from all default manifests. Only the assigned native runtime owner may run it. It makes paid Gemini Live and Flash calls against synthetic records in a **new demo Firebase project**, using already running loopback emulators. It does not start emulators, deploy, push, use an engineering provider, or retry a failed paid operation.

Prerequisites:

- Read `C:\Cursor AI\.local\browser-test-credentials.md`. Inject its admin username/password as `CRM_NATIVE_EMAIL` and `CRM_NATIVE_PASSWORD` through environment variables; never put values in this file or run receipts. The harness creates that admin identity only in its unique Auth emulator project.
- Node 22 with existing dependencies discoverable through `NODE_PATH` (Firebase Admin, Express, Sharp and ws), Python with Playwright, and installed Chrome.
- Existing Firestore, Auth and Storage emulators on explicit loopback ports owned by the runtime coordinator are required for every scenario. Restoring a voice draft also lists attachments, even when none were uploaded. The harness always injects the explicit synthetic project's bucket rather than relying on an Admin default bucket. No emulator startup or cleanup of another task's project is performed.
- The Auth emulator's **default project must equal this run's `GCLOUD_PROJECT`**. The installed emulator routes API-key password sign-in to its default project, ignoring the browser API key when selecting that project. Seeding a unique project on an Auth emulator started for another project produces `auth/user-not-found`. The runtime owner must assign a dedicated matching Auth emulator and its port; preserve existing services. Do not bypass authentication or substitute custom tokens.
- Windows PowerShell 5.1 `System.Speech` and explicitly selected installed English voices for instruction and confirmation. Missing voices stop the run; there is no network TTS fallback. WAV files are generated locally as mono, signed PCM16, 16 kHz, under 55 seconds. The exact English confirmation text comes from the visible reviewed draft, including its current revision and payment wording. Each turn launches Chrome with that WAV as fake microphone input and the real AudioWorklet path. No transcript or confirmation event is injected.
- A clean, committed checkout. Set `CRM_NATIVE_EXPECTED_SHA` to its full verified SHA. Source hashes are retained in the run directory.

Choose one scenario per process:

| Scenario | Paid work limit | Acceptance |
| --- | --- | --- |
| `create` | At most 2 Live sessions, configured Flash limit | Spoken lead creation, exact preview, separate spoken confirmation, persisted lead and one receipt, reload without duplicate save or automatic paid reconnect. |
| `edit` | At most 2 Live sessions, configured Flash limit | Seed one synthetic lead, speak an exact-name edit, verify the preview and unchanged record before confirmation, then verify the same lead was changed once. |
| `discard-reconnect` | At most 1 Live session, configured Flash limit | Spoken create draft, discard before saving, reload with no domain record, receipt, or automatic paid reconnect. This is **not post-save Undo**. |
| `image` | Exactly one admitted Flash attempt, no Live sessions | Upload a locally rendered synthetic enquiry PNG through the real attachment API, use it for native drafting, verify all three values and their image provenance in the review, click confirmation, then verify one persisted lead/receipt and no retry on reload. |

Set environment variables in the coordinator's process. Example nonsecret configuration (choose free owned ports and a fresh run ID):

```powershell
$env:CRM_NATIVE_PAID_TEST = 'true'
$env:CRM_NATIVE_RUN_ID = 'input-create-20260908-a01'
$env:GCLOUD_PROJECT = 'demo-' + $env:CRM_NATIVE_RUN_ID
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8270'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9173' # assigned Auth emulator started for this exact run project
$env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9370'
$env:CRM_NATIVE_HTTP_PORT = '9270'
$env:CRM_NATIVE_MAX_FLASH_CALLS = '4'
$env:CRM_NATIVE_OUTPUT_ROOT = 'C:\Users\Admin\Documents\Codex\crm-data-input-2026-09-07\execution\native-harness'
$env:CRM_NATIVE_NODE = 'C:\Users\Admin\AppData\Local\Temp\cursor-ai-structure-str01-b7c0-20260907\runtime\node-v22.19.0-win-x64\node.exe'
$env:NODE_PATH = 'C:\Users\Admin\Documents\Codex\crm-data-input-2026-09-07\execution\emulator\vendor\node_modules;C:\Users\Admin\Documents\Codex\crm-data-input-2026-09-07\execution\image-validation\runtime\node_modules;C:\Users\Admin\.codex\worktrees\b699\Cursor AI\services\crm-voice-relay\node_modules'
$env:CRM_NATIVE_EXPECTED_SHA = (git -C 'C:\Cursor AI-data-input-20260907' rev-parse HEAD).Trim()
# Set CRM_NATIVE_EMAIL, CRM_NATIVE_PASSWORD, and a fresh random
# CRM_NATIVE_CONTROL of at least32characters via trusted environment injection.
$env:CRM_NATIVE_INSTRUCTION_VOICE = 'Microsoft Zira Desktop'
$env:CRM_NATIVE_CONFIRMATION_VOICE = 'Microsoft Zira Desktop'
python 'C:\Cursor AI-data-input-20260907\tests\browser\crm-data-input-native\run.py' --scenario create
```

Use a new run ID for each invocation, including failures. Both output and demo-project reuse are rejected. Do not add this command to an ordinary test script. The runner launches only its owned local HTTP and relay servers, then closes them. Demo records and sanitized evidence remain for the coordinator's review; no broad emulator cleanup is performed. Browser authentication state is kept in memory across the two Chrome instances, not saved as an evidence profile.

Both the shared runtime and the harness HTTP assembly use `resolveLiveChatApiKey()`: dedicated `CRM_VOICE_GEMINI_API_KEY` environment override first, then `CRM_VOICE_CREDENTIAL_FILE` or the existing Windows default `%LOCALAPPDATA%\Codex\private-provider-config\live-chat.env`, then legacy `GEMINI_API_KEY` fallback. The private file is configured by the credential owner; this harness never modifies it or the general Gemini environment files. Do not copy key values into commands, reports or this document. Python forwards the environment but does not read the private key file. Shared provider and HTTP evidence redaction remains server-owned.

For the image case, use a fresh run ID and demo project, set `CRM_NATIVE_MAX_FLASH_CALLS=1`, and provide the coordinator-owned `FIREBASE_STORAGE_EMULATOR_HOST` (for example `127.0.0.1:9370`). Run the same command with `--scenario image`. No speech voices are required for this scenario. `image.ps1` uses offline System.Drawing to create a 1000×440 PNG containing only synthetic name, source and notes; the runner records its original hash. The real upload sanitizer may re-encode it, so acceptance compares the **normalized attachment hash** with the native transport's actual image-byte hash, and compares the interpretation's full request digest with the transport descriptor digest. Inline image data must not appear in reservation evidence. The image scenario requires the released shared image provider integration; it must not run against the older `supportsImages:false` checkpoint.

Image enquiry confirmation is an explicit review-button click, which the data-input contract permits. Native image-payment extraction and its operator-confirmed receipt-of-funds wording remain a separate required acceptance case; this enquiry scenario does not claim payment verification, native payment-image acceptance, or spoken image confirmation. Existing deterministic payment safeguards are not native-model evidence.

Three additional opt-in scenarios use the same fresh demo namespace, one-Flash maximum and zero Live turns: `image-payment`, `image-ambiguous-date`, and `image-adversarial`. Set `CRM_NATIVE_MAX_FLASH_CALLS=1`; speech voices are not required. Each scenario generates its own deterministic offline PNG through `image.ps1 -Case`. Source/provider configuration and authorization are unchanged.

Payment cases seed one synthetic student and USD 10.25 invoice, then select them through the real student/invoice picker controls before image extraction. The success image uses **2026-09-01**, deliberately different from the test day, and `SYNTHETIC-TRANSFER-001`. Assertions compare the proposed date, review effect and persisted `paymentDate`, reference, amount, invoice totals and `receipt.paymentAssertion`. A one-shot authenticated commit without acknowledgement must return exact `PAYMENT_ASSERTION_REQUIRED` 422 with no financial writes. The current preview token remains only in runner memory. The normal visible checkbox and save button then authorize the successful commit; reload must preserve the same receipt and provider counts.

The ambiguous image uses `03/04/2026` without a date convention. It must retain a clarification, invent no canonical date and create no preview or payment. The only permitted probe is one exact `DRAFT_INCOMPLETE` 422 from the current draft/revision preview request, including `MODEL_CLARIFICATION`. Expected errors are armed through the protected local harness control endpoint, bound to the exact scenario/path/current draft and preview or revision, and consumed once. Every unrelated or repeated HTTP error still stops the run; these are not provider retries.

The adversarial image contains the intended enquiry fields plus untrusted text ordering an extra student/payment. Acceptance requires only the requested enquiry, exact image provenance, no unreviewed effects, and matching `fixtureContactDigest` on the draft and saved record. `fixtureContactSource` contains only image kind and attachment ID. Raw contact fields and addresses inside provider text remain redacted; screenshots mask contact controls/text and image thumbnails. A rejected extraction does not count as successful extraction.

Offline harness checks (no browser or provider calls):

```powershell
node --test tests/crm/data-input/expected-http-error.test.cjs
python -B tests/crm/data-input/native_image_cases_test.py
```

The edit scenario permits at most one explicit typed record clarification when the real UI reports an unresolved lookup. It corrects the exact name through `Exact value`, searches, verifies the returned seeded record, chooses it and presses `Continue instruction`. That button uses the same guarded automatic-review pipeline as spoken input; the harness never clicks Review to bypass this path. Evidence records the original lookup value, typed correction and selected ID. This is mixed voice and typed clarification, not fully automatic name recognition. Canonical exact matching, the original voice instruction, current authorization and separate spoken save remain intact; no provider failure is retried. The existing maximum six Flash calls and two Live turns still apply. Clarification-to-preview timing is recorded separately when used.

At harness authoring time, this machine exposed `Microsoft David Desktop` and `Microsoft Zira Desktop`, both `en-US`; offline English WAV synthesis passed. The approved server policy displays exact English and Vietnamese alternatives for the same bound preview. The harness uses the visible English alternative and does not claim Vietnamese ASR acceptance. It never translates or loosens the phrase itself; native ASR and the canonical confirmation policy remain the acceptance gate.

The original System.Speech `<label>.wav` is retained unchanged. Chrome receives a separate `<label>-microphone.wav` with five seconds of leading silence and two seconds of trailing silence, because fake capture starts at `getUserMedia` before authenticated relay readiness. Metadata records both file hashes and durations, the original PCM hash and its exact frame offset. Offline tests prove the original PCM is unchanged and the padding is silent; total padded duration is bounded to 55 seconds. The speaking wait uses the padded duration. This synthetic fixture lead-in is not a product latency measurement: reported response timers still start at the Finish speaking action. Exact captured-audio transcription and confirmation checks remain required; padding does not prove physical microphone behavior.

Offline fixture verification requires an external output directory and makes no browser or provider calls:

```powershell
$env:CRM_NATIVE_AUDIO_TEST_OUTPUT_ROOT = '<existing external evidence directory>'
python -B tests/crm/data-input/native_audio_padding_test.py
```

To inspect offline installed voices without browser/provider work:

```powershell
powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices().VoiceInfo | Select-Object Name,Culture"
```

The server uses the canonical `services/crm-voice-relay/data-input-composition.js` entry and its authenticated ALS wrapper. The HTTP assembly uses the real API app/router and its default lazy `functions/src/crm/data-input/http-native-config.js` builder. The harness injects only a server-owned environment copy and transport instrumentation, rather than a complete assistance configuration; it checks that HTTP and relay resolve the same scoped credential. Both assemblies construct native services through `functions/src/crm/data-input/native-provider.js`, which pins JSON generation mode. The complete output schema remains in the system instruction and action definitions remain in the request; strict proposal parsing and canonical validation still gate every preview and save. Shared native provider and ledger files are not replaced, and ASR keeps its explicit transcript schema.

Outside the harness, native HTTP defaults require effective `CRM_DATA_INPUT_ENABLED=true`, `CRM_VOICE_NATIVE_ENABLED=true`, a scoped live-chat credential, and `CRM_VOICE_RELAY_URL`. No flag or credential is changed by this patch. Disabled defaults return before credential resolution or native factory construction. Enabled invalid configuration returns sanitized `ASSISTANCE_UNAVAILABLE` 503 for the feature while CRM startup remains available. Relay URLs require HTTPS, or loopback HTTP in a `demo-` project, with no URL credentials, query or fragment. Explicit trusted `dataInputAssistanceConfig` (including `null`) overrides the default builder. Request fields cannot supply this configuration. Capabilities still depend on the constructed provider and current staff admission; constructing services makes no paid request.

Evidence includes source hashes, offline audio text/hash/duration, visible preview, Chrome errors and redacted domain HTTP responses, native provider HTTP status and whitelisted response body fields, persisted leads/previews/receipts, consumed attestations, captured-audio provenance, settled/pending ledger rows and reservations. Thought parts, thought signatures, resumption handles, credentials and confirmation tokens are excluded. Usage token counts are retained. Reported usage is a monitored cost calculation; unresolved Live usage may remain pending and delayed overage is possible. A paid failure ends the run without another automatic attempt. Local syntax and gate checks do not prove native acceptance.
