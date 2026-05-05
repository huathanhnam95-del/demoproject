# Agent Management and Reporting Workflow

## Goal
Manage human collaborator sources and export monthly commission statements.

## Agent Source Fields
- `agent-source-name`
- `agent-source-status` (`active` or `inactive`)
- `agent-source-notes`
- `agent-report-month` for export period (`YYYY-MM`)

## Reporting Endpoint
- `GET /api/admin/agent-sources/report?month=YYYY-MM&format=xlsx`

## Report Scope
- Includes invoices with `status = paid`.
- Month boundary uses Asia/Bangkok based on `invoice.paidAt`.
- Includes detail rows and summary totals grouped by agent source and currency.

## Export Columns
- Agent Source
- Student
- Course
- Tuition
- Rate
- Commission Amount
- Currency
- Invoice ID
- Paid At
- Commission Status

## BEL Behavior
- Assist with agent source form fill and month selection.
- Never trigger destructive actions.
