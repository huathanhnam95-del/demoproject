# Custom Agent Course Commission Rates Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Configure custom course-specific commission rates for agents and calculate commissions in invoices and monthly reports.

**Architecture:** We will store a `courseRates: { [courseId]: rateBps }` mapping on the agent source document. When generating invoices or exporting monthly agent reports, the custom agent rate will take precedence over the default course commission rate.

**Tech Stack:** Node.js, Express, Firestore, HTML, Vanilla JavaScript, Playwright

---

### Task 1: Backend service updates

**Files:**
- Modify: `functions/src/crm/agent-source-service.js`
- Create: `tests/crm/agent-source-service.test.js`

**Step 1: Write service test suite**

Create `tests/crm/agent-source-service.test.js` to verify validation of `courseRates`.

```javascript
const assert = require('assert');
const {
    buildAgentSourceCreateData,
    buildAgentSourcePatchData,
    mapAgentSourceRecord
} = require('../../functions/src/crm/agent-source-service');

const context = {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
};

// Test create
const created = buildAgentSourceCreateData({
    name: 'Agent Alpha',
    status: 'active',
    notes: 'Premium partner',
    courseRates: {
        'course-1': 1500,
        'course-2': '1250'
    }
}, context);

assert.strictEqual(created.name, 'Agent Alpha');
assert.strictEqual(created.status, 'active');
assert.deepStrictEqual(created.courseRates, {
    'course-1': 1500,
    'course-2': 1250
});

// Test patch
const patched = buildAgentSourcePatchData(created, {
    courseRates: {
        'course-1': 1800,
        'course-3': 1000
    }
}, context);

assert.deepStrictEqual(patched.courseRates, {
    'course-1': 1800,
    'course-3': 1000
});

// Test map
const mapped = mapAgentSourceRecord({
    id: 'agent-1',
    ...patched
});

assert.strictEqual(mapped.agentSourceId, 'agent-1');
assert.deepStrictEqual(mapped.courseRates, {
    'course-1': 1800,
    'course-3': 1000
});

console.log('agent source service unit tests passed');
```

**Step 2: Implement service updates**

Modify `functions/src/crm/agent-source-service.js` to normalize and store `courseRates`.

```javascript
// Add normalizeRateBps helper (or reuse logic)
function normalizeRateBps(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const rounded = Math.round(numeric);
    if (rounded < 0 || rounded > 10000) return null;
    return rounded;
}

function normalizeCourseRates(raw) {
    const rates = raw && typeof raw === 'object' ? raw : {};
    const next = {};
    Object.entries(rates).forEach(([courseId, bps]) => {
        const normalized = normalizeRateBps(bps);
        if (normalized !== null) {
            next[courseId] = normalized;
        }
    });
    return next;
}
```

Integrate `courseRates` in `buildAgentSourceCreateData`:
```javascript
        notes: cleanOptionalString(input?.notes),
        courseRates: normalizeCourseRates(input?.courseRates),
```

Integrate in `buildAgentSourcePatchData`:
```javascript
    const hasNotes = Object.prototype.hasOwnProperty.call(payload, 'notes');
    const hasCourseRates = Object.prototype.hasOwnProperty.call(payload, 'courseRates');
    if (!hasName && !hasStatus && !hasNotes && !hasCourseRates) {
        throw new Error('No agent source fields provided for update.');
    }
    ...
    if (hasCourseRates) {
        next.courseRates = normalizeCourseRates(payload.courseRates);
    }
```

Integrate in `mapAgentSourceRecord`:
```javascript
        notes: cleanOptionalString(data.notes),
        courseRates: data.courseRates && typeof data.courseRates === 'object' ? data.courseRates : {},
```

**Step 3: Run unit tests**

Run: `node tests/crm/agent-source-service.test.js`
Expected: PASS with output "agent source service unit tests passed"

**Step 4: Commit**

```bash
git add functions/src/crm/agent-source-service.js tests/crm/agent-source-service.test.js
git commit -m "feat: add courseRates support to agent source service"
```

---

### Task 2: Backend route updates (Report & Invoice)

**Files:**
- Modify: `functions/src/routes/admin/agent-sources.js`
- Modify: `functions/src/routes/admin/finance.js`
- Modify: `tests/crm/finance-service.test.js`

**Step 1: Update report calculation fallback**

In `functions/src/routes/admin/agent-sources.js` (around line 243):
Replace:
```javascript
const rateBps = Number(commission?.rateBps ?? invoice.agentCommissionBps ?? 0);
```
With:
```javascript
const rateBps = Number(commission?.rateBps ?? source?.courseRates?.[invoice.courseId] ?? invoice.agentCommissionBps ?? 0);
```

**Step 2: Update invoice creation to capture custom agent rate**

In `functions/src/routes/admin/finance.js` (around line 78):
Replace the invoice creation payload mapping with custom rate resolution:
```javascript
            let agentCommissionBps = course?.agentCommissionBps ?? null;
            if (student.agentSourceId && requestedCourseId) {
                const agentSourceSnap = await db.collection(CRM_AGENT_SOURCES).doc(student.agentSourceId).get();
                if (agentSourceSnap.exists) {
                    const agentSourceData = agentSourceSnap.data() || {};
                    const customCourseRate = agentSourceData.courseRates?.[requestedCourseId];
                    if (Number.isFinite(customCourseRate)) {
                        agentCommissionBps = customCourseRate;
                    }
                }
            }

            const invoice = buildInvoiceCreateData({
                ...(req.body || {}),
                agentSourceId: student.agentSourceId || null,
                agentCommissionBps
            }, {
                user: req.user,
                serverTimestamp
            });
```

**Step 3: Run CRM unit tests**

Run: `node tests/crm/finance-service.test.js`
Expected: PASS

**Step 4: Commit**

```bash
git add functions/src/routes/admin/agent-sources.js functions/src/routes/admin/finance.js
git commit -m "feat: apply custom agent course rates to invoices and reports"
```

---

### Task 3: Frontend HTML Updates

**Files:**
- Modify: `public/crm-admin.html`

**Step 1: Add course rates section to Agent Edit form**

In `public/crm-admin.html` (under section `data-panel="agents"`, inside the left column card, right after the note field group around line 866):
Insert:
```html
              <div class="crm-section-header" style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 15px;">
                <div>
                  <h4>Course Commission Rates</h4>
                  <p class="crm-muted">Configure custom rates for specific courses. Defaults to the course's default rate if not set.</p>
                </div>
              </div>
              <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px;">
                <select id="agent-course-select" class="crm-input" style="flex: 1;">
                  <option value="">Select a course to add...</option>
                </select>
                <button id="btn-add-agent-course" class="crm-btn-secondary" type="button">Add Course</button>
              </div>
              <div id="agent-course-rates-container" class="crm-stack-list" style="margin-bottom: 15px;">
                <div class="crm-muted" style="padding: 10px;">No course commission rates configured.</div>
              </div>
```

**Step 2: Commit**

```bash
git add public/crm-admin.html
git commit -m "ui: add course rates layout to agent management panel"
```

---

### Task 4: Frontend JS Updates

**Files:**
- Modify: `public/js/crm/agent-sources-workspace.js`

**Step 1: Implement Course Rates configuration logic**

In `public/js/crm/agent-sources-workspace.js`:
- Query new elements:
  ```javascript
  elements.selectAgentCourse = document.getElementById('agent-course-select');
  elements.btnAddAgentCourse = document.getElementById('btn-add-agent-course');
  elements.agentCourseRatesContainer = document.getElementById('agent-course-rates-container');
  ```
- Fetch active courses on `init` and `refresh` via `window.CrmCourses.fetchCourses()` and populate `#agent-course-select`.
- Maintain `localCourseRates = {}` to track configured courseId -> percent mapping.
- Update `resetForm` and `applyToForm` to load and display configured rates in `#agent-course-rates-container`.
- Implement `renderCourseRatesList()` with input validation and course removal capabilities.
- Integrate `courseRates` conversion (percent * 100) inside `buildPayload()`.

**Step 2: Commit**

```bash
git add public/js/crm/agent-sources-workspace.js
git commit -m "feat: implement frontend agent course rates logic"
```

---

### Task 5: End-to-End Verification

**Files:**
- Run tests: `npm run verify:crm`
- Run local server: `npm run start`

**Step 1: Verify E2E suite passes**

Expected: E2E Playwright test suite passes.

**Step 2: Manual confirmation**

- Launch the app locally.
- Navigate to the **Agents** panel.
- Verify adding a custom rate for a course on an agent, saving it, and reloading/editing the agent displays the correct percentage.
- Verify generating a student invoice for that course automatically resolves the custom agent rate.
