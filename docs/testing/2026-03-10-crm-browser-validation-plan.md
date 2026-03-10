# CRM Browser Validation Plan

## Scope

Validate the CRM admin shell in the isolated worktree `C:\Cursor AI-crm-standardization` after the standardization rollout. This plan is browser-first and assumes the backend and Functions routes are running locally.

## Preconditions

1. Start the app from `C:\Cursor AI-crm-standardization`.
2. Have two accounts ready:
   - one admin
   - one non-admin
3. Seed or prepare these records before testing:
   - 2 leads
   - 3 students
   - 2 courses
   - 2 classrooms
   - 1 duplicate student pair
   - 1 student with a real enrollment but no attendance yet
   - 1 student with attendance risk
   - 1 unpaid invoice
4. Open browser DevTools and keep both `Console` and `Network` visible.

## Test Flow

1. Log in as the non-admin user and open `crm-admin.html`.
   Expected: access is denied or redirected away from the CRM shell.

2. Log in as the admin user and open `crm-admin.html`.
   Expected: dashboard loads, no fatal console errors, and `/api/admin/status` succeeds.

3. Verify shell navigation.
   Expected: `Dashboard`, `Student Management`, `Courses & Classes`, and `Enquiry` are usable; placeholder items remain disabled.

4. Inspect the dashboard on first load.
   Expected: summary cards, funnel, revenue table, duplicate list, and audit log all render without broken states.

5. Create a merge job from a duplicate pair in the dashboard.
   Expected: success toast, `POST /api/admin/merge-jobs` succeeds, and an audit log entry appears.

6. Go to `Enquiry`, create a new lead, and confirm it appears in the board and table.
   Expected: stage counts update and the lead is visible after refresh.

7. Change the lead stage and open the lead workspace.
   Expected: stage persists and the workspace shows the selected lead.

8. Add one lead task and one lead activity.
   Expected: both render immediately and survive a page refresh.

9. Create a template and an `overdue_next_action` automation rule.
   Expected: both persist and appear in the communications manager.

10. Run the new automation manually.
    Expected: queue entries appear and the audit log records the manual run.

11. Create and run an `attendance_intervention` automation rule for a known at-risk student.
    Expected: at least one queue entry is created for the at-risk student. This specifically validates the bugfix for empty attendance datasets.

12. Convert a lead into a student.
    Expected: a student record is created, the lead is marked converted, and source/contact data carries over.

13. Open the student profile and edit the `Info` tab.
    Expected: values save, reload, and reopen correctly.

14. Edit the `Learning Profile` tab and save.
    Expected: score fields, level, and due date persist.

15. Edit the `Student 360` tab and save:
    - target exam
    - target score
    - preferred schedule
    - score history
    - guardian contacts
    - company contacts
    - document refs
    - counseling notes
    Expected: all values persist after closing and reopening the modal.

16. In `Identity`, generate a class code, run a handshake lookup, and force-link an account.
    Expected: code is shown, lookup returns a user preview, and the linked UID list refreshes.

17. Create an entrance test and submit it through the student flow.
    Expected: the CRM result list refreshes and the submission appears in the admin view.

18. Create a course, reopen it from the catalog, edit it, and verify persistence.
    Expected: course list and classroom course dropdown both reflect the updated values.

19. Create a classroom, reopen it, add a module, add classwork, and post an announcement.
    Expected: all classroom sections reload correctly after save.

20. Enroll one student with attendance and one student without attendance into the classroom.
    Expected: both enrollments appear in attendance summary and membership-scoped review flows.

21. Create an attendance session and save a mix of `present`, `late`, and `absent` records.
    Expected: attendance roster refreshes and risk badges update.

22. Mark one attendance record with `interventionFlag`.
    Expected: the student is flagged as at risk in the CRM.

23. Create a second at-risk case using low attendance rate or low score, without `interventionFlag`.
    Expected: the student is still counted in the dashboard attendance-risk KPI. This specifically validates the dashboard risk aggregation fix.

24. Open the finance tab for a student with exactly one real enrollment.
    Expected: the enrollment context selector auto-populates with that enrollment.

25. Create an invoice for that student.
    Expected: the request payload contains the real `enrollmentId` and `courseId`, not `manual-{studentId}`.

26. Select the invoice and record a partial payment.
    Expected: paid and outstanding totals update immediately and remain correct after refresh.

27. Open the finance tab for a student with multiple enrollments.
    Expected: the browser requires selecting an enrollment context before invoice creation.

28. Open the finance tab for a student with no enrollments.
    Expected: the UI clearly indicates manual fallback mode and still allows invoice creation.

29. Verify student-scoped finance summary data.
    Expected: invoices, payments, and commissions shown in the response belong only to the selected student.

30. Re-open the dashboard after all mutations.
    Expected: funnel, revenue, duplicates, and audit log all reflect the latest changes.

31. Perform a hard refresh.
    Expected: all persisted CRM state remains intact and no view regresses on reload.

## Negative Checks

1. Try saving a student with no info fields.
   Expected: validation error.

2. Try creating a lead with no name, email, or phone.
   Expected: validation error.

3. Try enrolling the same student into the same classroom twice.
   Expected: deduped enrollment response.

4. Try recording a payment without selecting an invoice.
   Expected: UI blocks the action.

5. For a student with multiple enrollments, try creating an invoice without choosing an enrollment context.
   Expected: UI blocks the action and asks for a selection.

## Exit Criteria

- No uncaught browser console errors.
- No failed CRM API requests except intentional validation cases.
- All persistence checks survive refresh and reopen.
- The three previously reviewed defect areas pass:
  - attendance-intervention automation
  - dashboard attendance-risk counting
  - finance enrollment linkage
