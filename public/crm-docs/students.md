# Students Workflow

## Goal
Maintain complete student profile data from pre-enrollment to active learning.

## Info Fields
- `student-name`, `student-label`, `student-phone`, `student-email`, `student-zalo`, `student-facebook`
- `student-acquisition-source`: where student was acquired.
- `student-agent-source`: collaborator source for commission flow.
- `student-level`, `student-target-exam`, `student-target-score`
- `student-preferred-learning-days`, `student-preferred-learning-hours`
- `student-counseling-notes`

## Typical Flow
1. Open student profile.
2. Update info and learning profile.
3. Keep task and activity timeline current.
4. Move to finance tab for invoicing and payment.

## Data Consistency Rules
- Keep `student-agent-source` populated when student originated from collaborator leads.
- Do not remove source fields unless user requests.
- Preserve timeline notes for counselor context.

## BEL Behavior
- Fill requested profile fields with preview.
- Avoid destructive actions (no save, no delete, no conversion clicks).
