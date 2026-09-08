# Phase8 accounting preparation

Read-only preparation during Phase6 verification. The approved package authorizes implementation after the preceding phase gates; no Phase8 implementation, paid provider call or hard-bound acceptance is claimed here.

## Superseding shared architecture

The user subsequently requires one staff UID/Vietnam-month balance across covered CRM AI and live-chat modes. [The canonical shared contract](../../specs/shared-ai-assistance.md) governs cross-feature ownership and policy; this note retains Projects integration and arithmetic details only. Students are managed records, not eligible feature users. Feature and purpose are attribution, never separate wallets. Existing configured numeric allowances and administrator overrides remain authoritative.

Aligned implementation homes: `functions/src/ai-assistance/accounting/{money-pricing,ledger-service,provider-accounting}.js`, central `functions/src/ai-assistance/collections.js`, and Projects-specific `functions/src/crm/projects/budget-service.js`. Use `crmAiBudgetLedgers` and `crmAiBudgetReservations`; do not create a parallel Projects ledger. Shared services accept server-registered current-authority callbacks for each domain, independent of Express/Projects types. The Projects adapter retains its existing grant/membership checks; the future data-input adapter supplies its domain checks against the same ledger. No generic caller-supplied feature label grants authority. No source work starts before Phase7 acceptance/regressions close.

## Ledger invariants

One UID plus server-derived Vietnam calendar month identifies one allowance across all Projects. Store decimal strings of integer nanodollars and calculate with BigInt: USD5 is5000000000 units; one cent is10000000 units. Price components must be exactly representable; round only display. Current allowance resolves the existing UID override, organization default, then500cents. Admission transaction reads those configuration documents and requires settled+reserved+requestedMaximum<=currentAllowance, then creates the reservation and increments the monthly reserved amount atomically.

Admin decreases preserve settled and reserved amounts; displayed available may be negative and no further paid admission is allowed. A reservation's original month never changes. Old-month unknown work remains reserved in that month; new work in a new month requires a new admission. No rollover or automatic reconnect refund.

Reservation identity binds UID, request digest, purpose, month, immutable price version, bounds proof version and maximum disjoint quantities. Same identity with changed inputs conflicts. Before dispatch, recheck current Auth/account/module/project authority and feature gates; record dispatch intent durably before external I/O. Reconnecting or losing a lease does not prove an undispatched request. Ambiguous dispatch remains reserved and is not resent automatically.

Settlement atomically replaces the reserved maximum with validated exact cost and immutable usage evidence. Exact evidence replay is a no-op; conflicting evidence fails. A provider adapter must establish disjoint billing categories and cumulative versus incremental semantics; totals must not be added to their modality/thought/tool components. Missing, partial, disconnected or unprovable usage stays reserved. Cancellation releases only when dispatch is conclusively prevented or authoritative evidence establishes no charge. Any actual charge exceeding the reserved maximum is recorded in full, marks the bound violated and blocks further paid admission; never truncate the obligation to pretend the cap held.

Revocation blocks new admission/dispatch but does not erase obligations: trusted internal settlement may reconcile an already-dispatched reservation after its actor loses access. It derives UID/month/pricing from that reservation, not caller-supplied identity. User-facing reads still require current eligibility and are restricted to the caller. External usage evidence is accepted only through the configured server provider adapter; model text or client claims are never billing evidence.

## Existing source integration

`access-service.js` exposes assertTransactionEligible and assertTransactionContentAccess. Use those current transaction fences, not a cached identity. Allowance documents are crmProjectAllowanceConfigs/{uid} and crmProjectAllowanceDefaults/default; current admin update already rechecks authority and supports expectedRevision. Shared admission reads the same documents inside its transaction so simultaneous allowance decreases conflict correctly. Ordinary users must not gain admin allowance access.

Suggested focused modules: budget/money-pricing.js for arithmetic/month/pricing, budget/ledger-service.js for ledger/admission/dispatch/settlement, budget/provider-accounting.js for strict normalized usage and bounds. Current-user GET /budget and /budget/reservations precede project parameter routes. Reservation/dispatch/usage mutation methods stay internal; clients cannot submit arbitrary prices, usage, UID or refunds. Explicitly deny new server-only collections in Firestore rules and add required indexes.

All later feature Gemini calls use this one admission boundary, including structured task/workflow drafts, automation drafts, voice and retries. Manual commands and deterministic automation consume no model allowance. UI shows allowance, settled, pending and available, including exhaustion without losing drafts.

## Provider acceptance boundary

The separately verified provider-source note records advertised limits/pricing, not proof of every billing or disconnect bound. A versioned admissible bound must cover context replay, modalities, outputs/thoughts, tool traffic, retries, in-flight/disconnect work and price/month boundaries. Fail closed on unknown schemas, unsupported modalities or unproven bounds. Local fake-provider tests establish ledger/protocol behavior only. Live remains disabled until documented bounds and separately authorized metered acceptance exist; an environment flag alone is not that proof.

Required tests include simultaneous final balance across projects/devices, exact/conflicting retries, duplicate/missing/ambiguous reports, current revocation before dispatch, crash before/after dispatch intent, admin decrease during admission, exact integer arithmetic, month/year/price boundaries, original-month pending, and no auto-release on disconnect/expiry. No paid API call is authorized by this preparation.
