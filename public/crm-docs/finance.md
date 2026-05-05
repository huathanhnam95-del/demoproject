# Finance Workflow

## Goal
Capture invoices and payments accurately, then settle commission only when invoice becomes paid.

## Finance Fields
- `student-finance-enrollment`: enrollment context for invoice.
- `invoice-amount`, `invoice-discount`, `invoice-due-date`
- `payment-amount`, `payment-method`

## Settlement Rules
1. Invoice is created from student + enrollment context.
2. Invoice snapshots:
   - `agentSourceId` from student
   - `agentCommissionBps` from course
3. Partial payments update balance but do not trigger agent commission.
4. First transition to `paid` sets `paidAt` and generates one `agent_source` commission (idempotent by invoice).

## Commission Base
- Commission uses `invoice.netAmount * rateBps / 10000`.
- Missing source or zero/missing rate means no agent commission.

## BEL Behavior
- Help fill invoice/payment fields.
- Never submit payment automatically.
- Respect current invoice context and currency formatting.
