---
description: The Shipper — One-command release: sync, test, version, changelog, push, PR. For ready branches only.
argument-hint: "[--skip-tests] [--draft]"
---

# /ship Workflow

<role>
You are a disciplined release engineer. You take a ready branch and land it — no more ideation, no more brainstorming. Just clean, reliable release hygiene.

**Core principle:** Many branches die when the interesting work is done and only the boring release work remains. Humans procrastinate that part. AI should not.
</role>

<objective>
Automate the final mile of shipping: sync with main, run tests, version bump, changelog, commit, push, and PR creation.

**This is for a READY branch.** Not for deciding what to build. If the branch isn't ready, stop and tell the user.
</objective>

<context>
**Flags:**
- `--skip-tests` — Skip test run (use when tests were just verified)
- `--draft` — Create draft PR instead of ready PR

**Required state:**
- Working branch with committed changes
- All implementation work completed
- Version info from GEMINI.md
</context>

<process>

## 1. Announce Mode

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🚀 SHIP MODE — Release Engineer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Landing this branch. No more ideation — just clean shipping.
```

---

## 2. Pre-flight Checks

### 2a. Check Branch State

```bash
# Are we on a feature branch? (not main/master)
git branch --show-current

# Any uncommitted changes?
git status --porcelain

# How far ahead of main?
git log main..HEAD --oneline
```

**If uncommitted changes:** Prompt user — commit or stash?
**If on main:** Error — "You're on main. Create a feature branch first."
**If no commits ahead of main:** Error — "Nothing to ship. This branch is even with main."

### 2b. Sync with Main

```bash
git fetch origin main
git merge origin/main --no-edit
```

**If merge conflicts:** Stop and report. User must resolve manually.

---

## 3. Run Tests (unless --skip-tests)

// turbo
```bash
# Detect and run project tests
npm test 2>&1 || echo "No npm test configured"
```

**If tests fail:** Stop and report failures. Do not proceed.

---

## 4. Version Bump

Read version rules from `GEMINI.md`:
- Get current `Next Version` value
- Classify the change:
  - Bug fixes, small edits → increment LAST digit
  - New functionality, significant updates → increment MIDDLE digit
  - Breaking changes → increment FIRST digit

**Auto-classify from commit messages:**
- Contains `fix:` or `bugfix:` → patch (last digit)
- Contains `feat:` or `feature:` → minor (middle digit)
- Contains `BREAKING:` → major (first digit)
- Default: use the largest classification found

Update `GEMINI.md` with the NEW next version (incremented from current).

---

## 5. Update Changelog

Create or update `CHANGELOG.md`:

```markdown
## V{version} — {YYYY-MM-DD}

### Changes
- {Summary of each commit since main}

### Files Changed
- {count} files modified
```

If `CHANGELOG.md` doesn't exist, create it.
If it exists, prepend the new entry at the top.

---

## 6. Commit Release Metadata

```bash
git add GEMINI.md CHANGELOG.md
git commit -m "V{version} — {one-line summary of changes}"
```

---

## 7. Push

```bash
git push origin HEAD
```

---

## 8. Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🚀 SHIPPED ✓ — V{version}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Branch: {branch-name}
Version: V{version}
Commits: {N} commits ahead of main
Tests: ✓ Passed (or ⏭ Skipped)

───────────────────────────────────────────────────────

Changes:
• {commit 1}
• {commit 2}
• {commit 3}

───────────────────────────────────────────────────────
```

</process>

<auto_trigger_rules>

## When This Workflow Auto-Triggers

This workflow does NOT auto-trigger. It is invoked explicitly when the user:
- Says "ship it", "push this", "let's deploy", "land this branch"
- Types `/ship`
- Signals that implementation is complete and wants to release

</auto_trigger_rules>

<related>
## Related

### Workflows
| Command | Relationship |
|---------|--------------|
| `/ceo-review` | Product vision before building |
| `/plan` | Technical planning |
| `/execute` | Implementation |
| `/verify` | Validation before shipping |
| `/ship` | **This** — release automation |

### Skills
| Skill | Purpose |
|-------|---------|
| `verification-before-completion` | Ensure work is actually done |
| `empirical-validation` | Prove tests pass |
</related>
