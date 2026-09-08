# Phase5 verification matrix

Status: acceptance design; no checks below are claimed passed. Root owns this matrix and final evidence. Use isolated demo Auth/Firestore/Storage and Chrome, one runtime owner, Node22, and the canonical phase manifest. Read C:/Cursor AI/.local/browser-test-credentials.md before authenticated browser work; use dedicated emulator accounts for fixtures and never copy secrets into artifacts.

## Data and projection fixture

Create at least 620 active leaves plus nested nonleaf parents, two sections, all task statuses, explicit unassigned owners, two accountable owners and overlapping assignees. Include archived descendants, a filtered-out parent with a matching descendant, an unmatched child making its matching parent nonleaf, undated tasks, start-only/due-only tasks and interval boundaries. Keep an independently calculated fixture oracle rather than copying service aggregation logic.

- Traverse every page with no duplicates or omissions; full totals remain invariant across pages and all views. Reject actor/project/filter mismatched cursors and stale snapshot continuations.
- Assert labelled leaf counts/status/owner/completion against the oracle. Matching nonleaf parents never become aggregate leaves because their child is filtered out. Context ancestors never inflate totals.
- Compare derived parent spans/progress with deliberately different stored parent dates/status and read persisted records to prove no projection writes.
- Change canonical status and dates through real UI; switch views, open the same task detail/discussion and reload. Check exact task IDs and persisted values, not text-only presence.

## Dependencies and schedule admission

- Reject self, duplicate, nonexistent and cross-project edges. Add A-to-B and race B-to-A; at most one succeeds and the persisted graph remains acyclic. Duplicate exact operation is one write; differing operation payload conflicts.
- Archive/restore a predecessor and verify explicit warnings with no task resurrection or date mutation.
- Preview a concrete date interval; verify before/after dates, accountable-owner workdays and assignee warnings. No preview request changes task dates.
- Alter task, calendar, dependency endpoint or edges after preview and reject stale application. Reject another actor/project token and expired token. Exact successful retry produces one canonical effect.

## Calendar and independent CRM authority

- Pure fixtures cover leap/invalid dates, all three verified 2026 Tet selections, absent selection, September adjacent selection, weekly-rest compensation, explicit public-sector swap adoption and exclusion of proposed November23/28.
- Persist inclusive whole-team/person leave, test both endpoints and outside days, legacy single-date compatibility, stale revision rejection and preservation after effective feed revision. Owner availability governs workdays; assignee-only leave warns. Member calendar response has no unrelated staff IDs or private leave labels.
- Verify task AND project link picker/save/read/remove/reload, server-canonical names and strict record types/IDs. Project picker works with no task selected.
- For both link levels: member without independent CRM access, workforce admin only, stale token claim, CRM admin nonmember, current CRM permission revoked, deleted/missing record and forged label. Inspect full JSON for forbidden IDs/names across views, generic project/task mutations, history, recovery, replay and link endpoints.
- Exercise production and local mount predicates separately; no test-only resolver should conceal missing real adapter injection.

## Chrome and final gates

Use actual Chrome keyboard and pointer interactions across Board, Kanban, Timeline, Calendar and Charts; shared filters survive view changes. Check hit targets, horizontal/vertical scrolling, bounded row/card DOM, empty/loading/error states, visible counts and paging. Capture screenshots plus console/network and exact persisted readback. Hold requests across project/account switches to prove old view/link/preview results cannot repaint or apply to the new scope. Preserve Phase4 discussion/recovery and Phase3 board interactions.

After source/test freeze: run relevant pure checks, lint and diff checks; canonical Phase5 API/persisted/Chrome matrix; then affected Phase0-4 regressions. Record exact source revision and report/artifact paths, each resolved audit finding and cleanup. Phase10 owns 10k/latency claims; no paid calls, deployment or production mutation.
