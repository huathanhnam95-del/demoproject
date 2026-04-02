# CRM Student Deep-Link Browser Test Results

Date: 2026-04-01

Plan executed from:
[2026-04-01-crm-student-deep-link-browser-test-plan.md](/c:/Cursor%20AI/docs/testing/2026-04-01-crm-student-deep-link-browser-test-plan.md)

Test target:
`https://localhost:8443/crm-admin.html`

## Environment

- App was reachable on port `8443`.
- Browser session was already authenticated as admin.
- No browser console errors were surfaced during the checked flows.

## Outcome

Overall result: failed.

The live CRM shell on `https://localhost:8443` does not behave like the deep-link implementation reviewed in code. The browser-visible behavior still reflects an older internal-`studentId` workflow.

## Checked Scenarios

1. Students list loads on `#students/potential`
   Result: partial pass
   Notes: the page loads and the student table renders.

2. Public ID column uses `CRM ID`
   Result: fail
   Notes: the visible table header still says `Student ID`, and the rendered values look like internal Firestore document IDs such as `hSVFijNYigmjcBflw6MG`.

3. Clicking a student updates the hash to `#students/<crmId>`
   Result: fail
   Notes: clicking a student opened the modal, but the URL stayed on `#students/potential`.

4. Student badge shows public `crmId`
   Result: fail
   Notes: the modal badge showed internal-looking IDs such as `ID: hSVFijNYigmjcBflw6MG`.

5. Direct deep-link load on `#students/a0001`
   Result: fail
   Notes: the route did not resolve a student by CRM ID. The shell did not show the expected list fallback behavior.

6. Closing after a direct deep-link load returns to a students list route
   Result: fail
   Notes: after loading `#students/a0001`, closing the modal left the app stranded on a blank `#students/a0001` state instead of returning to `#students/potential` or `#students/data`.

7. Malformed hash such as `#students/not-a-student` falls back safely
   Result: fail
   Notes: the shell rendered a blank state instead of redirecting to a safe student list route.

8. Unsaved new-student modal leaves the hash unchanged
   Result: pass
   Notes: opening and closing `+ New Student` from `#students/potential` preserved the original hash.

9. Saving a brand-new student changes the hash to `#students/<newCrmId>`
   Result: fail
   Notes: save succeeded, but the URL remained `#students/potential`. The modal badge showed an internal-looking ID such as `ID: rlAH2N2QG0zrnTnTTVgE`.

10. New-student follow-up requests use public `crmId` routing
    Result: fail
    Notes: follow-up requests after save continued to use internal `studentId` paths such as:
    - `GET /api/admin/tasks?studentId=rlAH2N2QG0zrnTnTTVgE&limit=50`
    - `GET /api/admin/students/rlAH2N2QG0zrnTnTTVgE/entrance-tests`

11. Lead conversion opens the created student on a `crmId` route
    Result: fail
    Notes: converting a lead opened the student modal while the URL remained `#enquiry`. The modal badge again showed an internal-looking ID such as `ID: mIjhkZbL6hvcjWxLHFqo`.

## Key Conclusion

The live app served at `https://localhost:8443` is not currently exhibiting the CRM-ID deep-link behavior expected by the plan. Either:

1. the running frontend is stale relative to the reviewed code, or
2. the deployed/running bundle is not the same implementation that was patched and tested locally by script.

## Recommended Next Step

Verify which frontend bundle and backend instance are actually serving `https://localhost:8443`, then rerun this plan after the live environment is aligned with the deep-link implementation.
