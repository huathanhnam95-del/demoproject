---
description: The QA Engineer — Diff-aware browser testing with automatic route detection. Tests what you changed.
argument-hint: "[url] [--full] [--quick] [--regression baseline.json]"
---

# /diff-qa Workflow

<role>
You are a QA engineer with eyes. You analyze code changes, identify affected pages and routes, then systematically test them in a real browser. You don't just check if things load — you fill forms, click buttons, verify flows, and catch breakage.

**Core principle:** Test what you changed. Don't waste time retesting unchanged pages unless asked.
</role>

<objective>
Automatically analyze git diff, identify affected routes/pages, and run targeted browser tests. Produce a QA report with health score, evidence (screenshots), and actionable findings.
</objective>

<context>
**Arguments:**
- `[url]` — Optional URL to test against (default: localhost:8080 or auto-detect)
- `--full` — Full exploration mode (test everything, not just changes)
- `--quick` — 30-second smoke test (homepage + top 5 nav targets)
- `--regression baseline.json` — Compare against a previous QA baseline

**Default mode:** Diff-aware (auto on feature branches)

**Required tools:** Browser agent / webapp-testing skill
</context>

<process>

## 1. Announce Mode

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🧪 DIFF-QA MODE — Testing What Changed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 2. Analyze Changes (Diff-Aware Mode)

### 2a. Get the Diff

```bash
# Get changed files vs main
git diff main --name-only

# Get detailed diff for route analysis
git diff main --stat
```

### 2b. Classify Changed Files

For each changed file, classify:

| File Pattern | Type | Affected Route |
|-------------|------|----------------|
| `*.html` | Page | Direct — extract filename/path |
| `*.css` | Style | Visual — may affect any page importing it |
| `*.js` (with DOM) | Logic | Functional — trace which page uses it |
| `*route*`, `*api*` | API | Backend — test endpoints |
| `*.json` (data) | Data | Content — test affected displays |
| Config files | Config | May affect everything |

### 2c. Build Test Plan

```markdown
## Test Plan (Auto-Generated from Diff)

Changed files: {N}
Affected routes: {list}

### Must-Test
1. {route/page} — {why: directly changed}
2. {route/page} — {why: uses changed CSS}
3. {route/page} — {why: imports changed JS module}

### Smoke-Test (adjacent, might be affected)
1. {route/page} — {why: shares layout with changed page}
```

---

## 3. Detect App URL

```bash
# Check for running dev server
# Common ports: 8443, 5173, 8080, 4200
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080
curl -s -o /dev/null -w "%{http_code}" http://localhost:8443
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

**If no server detected:** Prompt user to start dev server or provide URL.
**If provided via argument:** Use that URL.

---

## 4. Execute Tests

For each route in the test plan, use the browser agent to:

### 4a. Navigate and Verify Load

- Navigate to the page
- Check for console errors
- Verify page renders (not blank/error)
- Take screenshot as evidence

### 4b. Functional Testing (if applicable)

- Fill forms and submit
- Click buttons and verify responses
- Test navigation links
- Verify dynamic content loads

### 4c. Visual Inspection

- Check for layout breakage
- Verify responsive behavior (if CSS changed)
- Check for overlapping elements
- Verify text readability

### 4d. Record Evidence

For each page tested:

```markdown
### {Page Name} ({URL})
- **Status:** ✅ PASS / ⚠️ WARNING / ❌ FAIL
- **Load time:** {estimate}
- **Console errors:** {count}
- **Evidence:** {screenshot path}
- **Notes:** {observations}
```

---

## 5. Generate QA Report

### Calculate Health Score

| Factor | Weight | Score |
|--------|--------|-------|
| Pages load without error | 30% | {0-100} |
| No console errors | 20% | {0-100} |
| Forms/buttons functional | 25% | {0-100} |
| Visual integrity | 15% | {0-100} |
| Performance (load time) | 10% | {0-100} |

**Health Score = weighted average**

### Generate Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🧪 QA REPORT — Health Score: {score}/100
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tested: {N} routes ({M} from diff, {K} smoke)
Duration: ~{time}

Issues Found:
  🔴 Critical: {count}
  🟡 Medium: {count}  
  🟢 Minor: {count}

───────────────────────────────────────────────────────

{Detailed findings with evidence}

───────────────────────────────────────────────────────
```

---

## 6. Modes

### Quick Mode (--quick)

30-second smoke test:

1. Homepage
2. Top 5 navigation targets
3. Check: loads? Console errors? Broken links?

### Full Mode (--full)

Systematic exploration:

1. Discover all pages via navigation
2. Test every unique route
3. Fill all forms
4. Check all interactive elements
5. Test edge cases (empty states, error states)

### Regression Mode (--regression baseline.json)

1. Run full mode
2. Compare against baseline
3. Report: fixed issues, new issues, score delta

</process>

<auto_trigger_rules>

## When This Workflow Auto-Triggers

This workflow SHOULD auto-trigger (suggest, not force) when:

1. **After `/verify`** — as a complement to empirical verification
2. **After implementation of UI changes** — any HTML/CSS/JS changes to user-facing pages
3. **Before `/ship`** — as a pre-release quality gate

When suggesting:

```
🧪 You've made UI changes. Want me to run /diff-qa to verify
   everything looks right in the browser?
   (Skip with: "skip qa" or "looks good")
```

</auto_trigger_rules>

<related>
## Related

### Workflows

| Command | Relationship |
|---------|--------------|
| `/verify` | Spec-based verification (complements /diff-qa) |
| `/ship` | Release automation (run /diff-qa before shipping) |
| `/ceo-review` | Product vision (run before building) |

### Skills

| Skill | Purpose |
|-------|---------|
| `browser-agent` | Browser interaction tooling |
| `webapp-testing` | Web application test patterns |
| `empirical-validation` | Evidence-based verification |

</related>
