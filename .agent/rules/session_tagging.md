---
trigger: always_on
description: Mandatory rules for production deployment session tagging ((D)) and automatic removal when development resumes.
---

# Deployed Session Tagging Protocol (`(D)`)

## 1. Core Convention
- The `(D) ` prefix in a chat session title indicates a **concluded, verified production deployment** (e.g., `(D) Bilingual Teaching Audio Analysis`).
- Active development sessions (planning, bug fixes, feature work, code edits, audits, test runs) **MUST NEVER** retain the `(D) ` prefix in their title.

## 2. Mandatory Automatic Removal (`remove-deployed`)
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

## 3. Production Deployment Tagging (`mark-deployed`)
Only when an approved production deployment has been completed (e.g., git push to production or `/ship` workflow):
```bash
python scripts/session_tagger.py mark-deployed
```
