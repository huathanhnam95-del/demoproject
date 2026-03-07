# Comprehensive Classroom Feature Test Plan (Admin & Student Views)

This test plan covers the end-to-end flow for the LMS Classroom features, moving from the initial setup (Course, Student, Classroom) to daily operations (Announcements, Submissions, Grading).

---

## Phase 1: Environment Preparation (Admin Setup)

### 1. Create a New Course
1. Open the **CRM Admin** panel (`/crm-admin.html`).
2. Navigate to **Courses & Classes** -> **Courses** in the sidebar.
3. Click the **"+ New Course"** button.
4. Fill in the required fields in the "Info" tab (e.g., Name: "Beginner English 101", Code: "BE101").
5. Click **"Save Course"**.
6. **Verify:** A success toast appears, and the new course shows up in the Courses grid.

### 2. Create a New Student & Link Identity
1. Navigate to **Student Management** -> **Student Data**.
2. Click **"+ New Student"**.
3. Fill in basic Info (e.g., Name: "Test Student", Email: "test.student@example.com").
4. Click **"Save Student"**. The student receives a unique Student ID.
5. Switch to the **Identity** tab within the Student Modal.
6. Under "Handshake Search", enter an existing Firebase Authentication email (a real user account you can log into later to test the Student View).
7. Click **"Lookup"**. Verify the user profile details appear.
8. Click **"Confirm Link"**.
9. **Verify:** A success toast appears, and the User ID is now listed under "Linked Accounts". Note the "Class Code" displayed here (you will need it later if testing the join flow).

### 3. Create a New Classroom
1. Navigate to **Courses & Classes** -> **Class Management**.
2. Click **"+ New Classroom"**.
3. Enter a Classroom Name (e.g., "Spring 2026 BE101").
4. Select the Course ID created in Step 1 (if available/required) and set the status to "Active".
5. Click **"Save Settings"**.
6. **Verify:** The modal updates, generating a Classroom ID behind the scenes.

---

## Phase 2: Content Creation & Announcements (Admin Operations)

### 1. Create Modules
1. While still in the Classroom Modal, switch to the **Modules** tab.
2. Click **"Add Module"**. Enter a title (e.g., "Week 1: Introductions").
3. **Verify:** The new module appears in the Modules list.

### 2. Create Classwork (Assignment with Audio)
1. Switch to the **Classwork** tab.
2. Click **"Add Classwork"**.
3. Enter a Title (e.g., "Speaking Practice: Say Hello").
4. Select the Module created above from the dropdown.
5. Check the box for **"Allow Voice Note Submission"**.
6. Click **"Save Draft"**.
7. **Verify:** The assignment appears in the Classwork list.

### 3. Post an Announcement
1. Switch to the **Stream** tab.
2. In the text input, type: "Welcome to the class! Please complete Week 1 assignments."
3. Click **"Post"**.
4. **Verify:** The announcement appears immediately below in the Stream timeline with the Admin's name and a timestamp.

---

## Phase 3: Student Interaction (Student View)

*Log out of the Admin account or open a new Incognito window, and log into the application using the student email linked in Phase 1, Step 2.*

### 1. Verify Stream & Announcements
1. Navigate to the **Student Account / Classroom Panel** (`/classroom.html` or via the "My Courses" button in the main app).
2. Look at the **Stream** tab (this is usually the default view).
3. **Verify:** You should see the announcement posted by the Admin ("Welcome to the class...").

### 2. Verify Classwork (To Do View)
1. Switch to the **To Do** tab.
2. **Verify:** You should see the "Speaking Practice: Say Hello" assignment.
3. Click the **"Open"** button on the assignment card.

### 3. Submit an Audio Assignment
1. In the Assignment Modal, verify the title matches.
2. Click **"🎤 Tap to Record"**. Allow microphone permissions if prompted.
3. Speak a short test phrase.
4. Click **"Stop Recording"**.
5. **Verify:** An audio preview widget appears. You can play it back to ensure audio was captured.
6. Click **"Submit"**.
7. **Verify:** The button changes to "Submitted" (Green), and the assignment modal closes.
8. Look at the **To Do** tab again.
9. **Verify:** The assignment card now displays **"✓ Turned In"** instead of the "Open" button.

---

## Phase 4: Review & Grading (Admin View)

*Return to the CRM Admin window (`/crm-admin.html`).*

### 1. The "Missing" Column & Submission Arrival
1. Navigate to **Courses & Classes** -> **Class Management**.
2. Click the Classroom you created to open its modal.
3. Switch to the **Review Board** tab.
4. **Verify:**
   - The audio submission from the student should be visible in the **"Turned In"** column.
   - If there are other students linked to the system who did *not* submit, they should be calculated and displayed in the **"Missing"** column.

### 2. Audio Playback Check
1. On the submitted card in the "Turned In" column, click the **"▶ Listen Audio"** button.
2. **Verify:** The button changes to "Loading...", then "Playing...", and the recorded audio plays successfully.

### 3. Grading the Submission
1. On the same card, locate the Grade input field.
2. Enter a score (e.g., "10/10" or "A+").
3. Click **"Submit Grade"**.
4. **Verify:** The card disappears from the "Turned In" column and moves to the **"Graded"** column, displaying the assigned grade.

---

## Phase 5: Feedback Loop Verification (Student View)

*Return to the Student window.*

1. Refresh the Student Classroom page (`/classroom.html`).
2. Navigate to the **To Do** tab.
3. **Verify:** The assignment card that previously said "✓ Turned In" now has a highlighted blue block that displays **"Grade: 10/10"** (or whatever grade was assigned). The card should no longer be clickable to re-record.

---
**End of Test Plan.** If all verifications pass, the Classroom MVP is functioning correctly end-to-end.