# Phase8–9 provider source check

## September 8 recovery verification

Reopened the official model pages and pricing below during recovery. Both exact model IDs remain documented. Flash supports structured text output and does not support Live/audio generation; the Live preview supports audio and synchronous function calling, without structured output. Standard Flash prices remain $0.75 input/$3.75 output including thoughts per million through 2026, then $1.50/$7.50 from January 1, 2027. Live standard text is $0.75/$4.50 and audio $3/$12 per million. Source verification is not a paid API/access test or a proof of a hard session charge maximum. Native paid dispatch remains disabled.

- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview
- https://ai.google.dev/gemini-api/docs/pricing

Read-only verification on September7,2026 during Phase5 testing preparation. No provider request, credential check or paid API use. This is preparation, not Phase8/9 implementation or acceptance.

The [Gemini3.8Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), updated September2, lists stable gemini-3.8-flash, text output, structured output/function calling, input limit1,048,576 and output limit65,536. Audio generation and Live are unsupported. Thinking accepts low/medium/high; minimal is rejected.

The [Gemini3.1FlashLive page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview), updated August18, lists text/audio output,131,072 input and65,536 output limits, synchronous function calls and no structured output mode. It instructs processing all parts of an event, realtime input for conversational text updates, and initial-history configuration for clientContent seeding. Proactive audio and affective dialogue remain unsupported.

[Published standard pricing](https://ai.google.dev/gemini-api/docs/pricing):3.8Flash input/output including thinking is USD0.75/3.75 per million through2026, then1.50/7.50 from January1,2027. Live text input/output is0.75/4.50; audio3/12; image/video input1 per million. Grounding has separate charges and must remain disabled unless explicitly bounded/accounted. Product accounting must select standard pricing intentionally; Codex Fast settings are unrelated.

The [Live WebSockets reference](https://ai.google.dev/api/live) exposes maxOutputTokens and modality-specific prompt/response token details, plus thought/tool-use counters. These fields alone do not establish a hard maximum charge per live session or prove whether successive usage reports are cumulative. Missing or ambiguous usage must remain reserved. A documented generation limit is not evidence that all concurrent input, context replay, thoughts, tools and disconnect work fit a guessed reservation.

Before any paid enablement: establish exact disjoint accounting semantics, maximum admissible context/input/output/tool/retry bounds and crash/reconnect reconciliation. Keep Live disabled if the proof or metered provider acceptance is unavailable. Manual features and local fake-provider protocol tests remain independently executable. No audio latency or provider access is verified here.

During later Phase6 regressions root checked the [Cloud Run WebSockets guide](https://docs.cloud.google.com/run/docs/triggering/websockets), updated September1,2026. WebSockets remain subject to service request timeouts (documented default5minutes, maximum60minutes), and reconnects can reach another instance despite best-effort affinity. Durable conversation/draft/confirmation state therefore cannot rely on one process. The guide advises external synchronization and avoiding end-to-end HTTP/2 for this service. These are deployment prerequisites, not an executed Cloud Run release or proof of provider session recovery.

## September7 resumed accounting source check

Root re-opened [official pricing](https://ai.google.dev/gemini-api/docs/pricing) and [GenerateContent UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata). Standard3.8 rates remain0.75 input/3.75 output per million through2026, then1.50/7.50. Live rates remain0.75/4.50 text and3/12 audio input/output; image/video input1.00. These are token prices, not a proven disconnect/in-flight maximum.

UsageMetadata defines prompt count including cached content, separate candidate and thought counts, and an aggregate of prompt+thoughts+candidates. Do not bill the aggregate in addition to components. Tool-use prompt usage and returned service tier need explicit supported accounting; reject unsupported tool/cache/tier combinations rather than infer their cost. Advertised token limits still do not establish every paid Live bound. No provider call or real-meter reconciliation was performed by this check.
