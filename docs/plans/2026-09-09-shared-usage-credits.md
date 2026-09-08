# Shared monthly staff usage credits

Status: approved for implementation; integrated acceptance pending. This supersedes monetary admission as the product quota for covered native CRM AI services. Historical provider accounting and test evidence remain intact. Repository placement follows [project_structure.md](../../agent_docs/project_structure.md).

## Product contract

Each eligible staff UID receives one shared Vietnam calendar-month allowance across Projects and Data Input: 5,000 credits by default, calibrated conservatively to USD 5. One credit is 1,000,000 integer microcredits. Existing admin defaults and per-account cents overrides remain authoritative, with 10 credits per configured cent and the existing override precedence. Changing the allowance never resets consumption. Unused credits do not roll over.

This is an application allowance, not a guaranteed provider invoice cap. The separate real-provider test campaign remains limited to USD 5 total, including all prior charges and unresolved holds; app credits cannot authorize more campaign spend.

The shared balance displays used, reserved and remaining credits. Approximate voice minutes come from a versioned server profile that includes audio and processing assumptions; they are estimates rather than promised call duration. Provider billing observations remain available separately. Incomplete provider usage vectors alone cannot deny a request that fits the application quota.

## Architecture and accounting decisions

Keep the existing feature ledger facade and add quota sidecars keyed by UID and Vietnam month. Replacing monetary fields with credits would destroy historical semantics; per-feature counters would permit duplicate allowances. Both alternatives are rejected. Quota reserve, dispatch and cancellation coordinate with monetary records in the same Firestore transaction, with all reads before writes. Every physical dispatch consumes one durable permit.

The first implementation reserves a full bounded turn. Final local metering releases unused quota; ambiguous dispatched work retains its reservation. This makes concurrency and crash recovery reviewable while allowing a later incrementally reserved streaming design. It can deny a long configured turn when a smaller turn would fit; the UI exposes reserved credits.

Calibration `crm-ai-usage-v1-2026-09` applies a 125/100 margin to new usage and rounds once over accumulated integer units. Audio input and output use distinct active-sample rates; text and processing use explicitly estimated policy-token units. UTF-8 byte proxies are not provider-reported tokens. Image tiles remain a separately bounded processing category. Calibration is immutable per reservation.

The trusted provider layer meters fixed-window PCM activity, not socket-open time. Fixed windows make the result independent of transport chunk boundaries. Activity is an energy-based estimate, not semantic speech recognition. Pure silence and idle time add no audio units; a completed Live connection with no activity or output has zero final usage. Input audio and its display transcript are one content representation. A separate ASR dispatch has its own instruction/processing cost, but does not debit the captured audio or transcript again. Proposal input counts text actually composed for that distinct request. Hidden processing uses one disclosed policy estimate, never fabricated provider telemetry.

The server checks reserved audio/text/output limits before forwarding or returning data. Client durations and balance arithmetic have no authority. Meter events have stable IDs, payload digests and monotonic cumulative counters; repeats are idempotent and changed payloads conflict. Final quota and provider settlement are independent states. Missing invoice fields do not erase local usage or force another provider call.

## Migration and month ownership

At cutover, import the origin month's existing settled and pending aggregate exactly once at one nanoUSD to one microcredit. Do not reprice or add component reservation totals on top of the aggregate. Link legacy reservations so their later reconciliation adjusts that existing origin-month obligation exactly once. Settlement above an imported estimate remains recorded as overspend. New quota reservations never incur an additional quota charge when provider billing later reconciles.

Older months retain their historical balances and unresolved financial holds. They are not repeatedly subtracted from future monthly allowances. Already admitted bounded work remains attributed to its admission month; new work uses the new Vietnam month. Unknown invoice counters and old-month invoice dispatches cannot freeze the new allowance.

Updated legacy-mode writers must respect the shared cutover marker. An old deployed binary cannot learn a new marker: before enabling this mode in a future release, drain old admissions and replace all HTTP/relay writers together. Preserve the ledger on rollback; a legacy rollback must not resume money-only admission past the cutover fence. This implementation does not run a production migration or deploy any component.

## Consumer and verification contracts

The central allowance resolver supplies both legacy money and credit units. Consumers inject `usageQuota: { enabled: true }` and pass the shared budget through. Functions code remains self-contained; the service-side Data Input adapter injects the trusted Live descriptor builder. Domain authorization, eligibility, preview confirmation and receipt idempotency are unchanged.

Acceptance must cover concurrent devices/features competing for the final credits; event replay and conflicts; current-month migration races and late settlement; no rollover; admin cap changes; more than eight incomplete invoices; silent/partitioned audio; transcript deduplication; enforced output bounds; and shared UI identity/refresh races. Root owns emulator and Chrome verification. Focused unit results do not establish integrated or production readiness.

Implementation and verification evidence are retained externally under `C:/Users/Admin/Documents/Codex/2026-09-08/crm-projects-recovery/work/final-acceptance-package/usage-credits`, with the exact task contract and pre-edit snapshot. No push or deployment is authorized by this plan.
