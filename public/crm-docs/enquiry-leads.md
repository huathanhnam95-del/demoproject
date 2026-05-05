# Enquiry and Leads Workflow

## Goal
Capture lead data quickly, qualify the lead, and convert to student with minimal re-entry.

## Lead Creation Fields
- `lead-name`: full name when available.
- `lead-email`: email contact.
- `lead-phone`: phone contact.
- `lead-source`: acquisition channel, for example Facebook or referral.
- `lead-agent-source`: collaborator source (optional, but required for commission tracking).
- `lead-stage`: current stage (`new`, `contacted`, `test_scheduled`, `test_completed`, `counseling`, `trial`, `won`, `lost`).
- `lead-probability`: numeric probability 0-100.

## Operational Steps
1. Open lead composer.
2. Fill contact + source fields.
3. Save lead.
4. Maintain next task and activity timeline.
5. Convert lead when ready.

## Conversion Rules
- Conversion must carry lead `agentSourceId` to student `agentSourceId`.
- Conversion should preserve source context for downstream finance and reporting.
- Converted leads should open the student profile directly.

## BEL Behavior
- Use fill actions only on known lead fields.
- Prefer preserving existing values unless user asks to overwrite.
- Never click save/convert automatically.
