---
trigger: always_on
description: Mandatory rules for session tagging ((R) Ready for Deployment, (D) Deployed) and the R4D / PAR deployment orchestration workflow.
---

# Session Tagging & Deployment Protocol (`(R)` and `(D)`)

## 1. Core Conventions
- **`(R) ` Prefix (Ready for Deployment)**: Indicates a chat session whose features, fixes, or tasks are fully implemented, verified, and explicitly designated as **ready for deployment**.
- **`(D) ` Prefix (Production Deployed)**: Indicates a **concluded, verified production deployment** (e.g., `(D) Bilingual Teaching Audio Analysis`).
- **Active Development Rule**: Active development sessions (planning, bug fixes, feature work, code edits, audits, test runs) **MUST NEVER** retain the `(D) ` prefix in their title.

---

## 2. Readiness Tagging Protocol (`R4D`)

### Trigger: `R4D` (Ready for Deployment)
Whenever the user states **"R4D"** (or indicates readiness for deployment) in any chat session:
1. The agent **MUST immediately mark the current session with the `(R) ` prefix**:
   ```bash
   python scripts/session_tagger.py mark-ready
   ```
2. If the session already had a `(D) ` prefix, `mark-ready` cleanly replaces `(D) ` with `(R) `.
3. If the session already has `(R) `, it is a safe no-op.
4. To remove the ready marker if development resumes or changes:
   ```bash
   python scripts/session_tagger.py remove-ready
   ```
5. To list all readied sessions across the workspace:
   ```bash
   python scripts/session_tagger.py list-ready
   ```

---

## 3. Deployment Orchestration Protocol (`PAR`)

### Trigger: `PAR` ("Push All Readied")
Whenever the user asks to **"PAR"** (or instructs to "push all readied"):
The agent MUST orchestrate the batch deployment of all readied sessions following the workspace deployment workflow:

1. **Discover Readied Sessions**:
   Run `python scripts/session_tagger.py list-ready` to query all sessions currently marked with `(R) `.
2. **Audit Readied Tasks & Changes**:
   Reconcile all deliverables, git commits, and `TASK_TRACKER.csv` rows associated with each readied session.
3. **Run Pre-Deployment Verifications**:
   - Inspect git diff against the target branch and ensure worktree cleanliness.
   - Run required automated tests, linters, or Playwright suites to guarantee zero regressions.
4. **Follow Versioning & Changelog Standards**:
   - Perform SemVer version bump per workspace rules (e.g., `V2.0.12`).
   - Append a changelog summarizing all integrated updates.
5. **Push / Deploy to Remote & Git**:
   Execute the push/deploy command per the approved workspace deployment rules.
   **Remote Git Synchronization (MANDATORY)**: Whenever deploying to production (or executing an approved production release / PAR), ALWAYS push the committed changes to the remote Git repository (`git push origin <branch>`) in addition to deploying the hosting assets. Never leave production releases unpushed to Git.
6. **Transition Session Tags (`(R) -> (D)`)**:
   Convert all readied sessions and the deploying session from `(R) ` to `(D) `:
   ```bash
   python scripts/session_tagger.py mark-deployed --cid <cid_1> <cid_2> ...
   # or automatically trace and convert:
   python scripts/session_tagger.py trace-deployed
   ```
7. **Empirical Verification**:
   Verify with `python scripts/session_tagger.py list-ready` (confirming no readied sessions were left behind) and `python scripts/session_tagger.py status --cid <cid>` to confirm `(D) ` status.

---

## 4. Mandatory Automatic Removal of Deployed Tag (`remove-deployed`)
Whenever ANY of the following occurs:
1. A previously deployed session is resumed with new user instructions or feedback.
2. A new task or subtask is initiated (e.g. creating/appending an `In Progress` task in `TASK_TRACKER.csv`).
3. The user requests code edits, investigations, reviews, or plans in a session whose title begins with `(D) `.

The agent **MUST immediately strip the `(D) ` prefix** in its first response turn as part of its initial tool calls:
```bash
python scripts/session_tagger.py remove-deployed
```

**CRITICAL RULES**:
- **Do NOT wait until the end of the turn or after answering**: Once a text response is sent without tool calls, the turn terminates. The command must run immediately during initial tool usage (e.g., alongside checking `TASK_TRACKER.csv`).
- **Idempotent & Safe**: Running `python scripts/session_tagger.py remove-deployed` on a title without `(D)` is a fast, safe no-op that exits `0`. When in doubt at the start of a session, run it.

---

## 5. Production Deployment Tagging (`mark-deployed`)
Only when an approved production deployment has been completed (e.g., git push to production or `/ship` workflow):
```bash
python scripts/session_tagger.py mark-deployed
```

---

## 6. Batch Deployment Back-Tracing & Multi-Session Tagging (MANDATORY)
When an approved production deployment concludes that packages or integrates work from one or more prior development tracks/sessions:
1. **Trace Origin Sessions**: Identify origin session UUIDs (CIDs) via `TASK_TRACKER.csv`, git commit log, or `python scripts/session_tagger.py search "<keyword>"`.
2. **Tag All Origin Sessions with `(D) `**:
   ```bash
   python scripts/session_tagger.py mark-deployed --cid <origin_cid_1> <origin_cid_2> ...
   # or batch command:
   python scripts/session_tagger.py mark-batch <origin_cid_1> <origin_cid_2> ...
   # or automated trace command (includes readied sessions by default):
   python scripts/session_tagger.py trace-deployed --tasks <task1> <task2> ... --deploy-cid <deploy_cid>
   ```
3. **Tag the Deployment Session**: Ensure the releasing/deploying session itself is also marked with `(D) `:
   ```bash
   python scripts/session_tagger.py mark-deployed
   ```
4. **Empirical Verification**: Confirm all affected session titles reflect `(D) ` using `python scripts/session_tagger.py status --cid <cid>`.

