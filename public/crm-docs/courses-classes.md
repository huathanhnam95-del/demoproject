# Courses and Classes Workflow

## Goal
Configure course metadata and class delivery settings used by student enrollment and finance.

## Course Fields
- `course-name`, `course-code`, `course-label`, `course-level`, `course-category`, `course-status`
- `course-agent-commission-percent`: percent UI mapped to `agentCommissionBps` in backend
- `course-description`
- `course-total-hours`, `course-default-session-minutes`, `course-duration-step`, `course-timezone`

## Class Workflow
1. Maintain course catalog.
2. Attach teachers and scheduling template.
3. Use class management and scheduler for delivery planning.

## Commission Configuration Rule
- Keep commission percent optional.
- When set, this value is copied into invoice snapshot at invoice creation.
- Later course edits must not rewrite historical invoices.

## BEL Behavior
- Fill known course/class input fields only.
- Do not auto-save or auto-regenerate schedules.
