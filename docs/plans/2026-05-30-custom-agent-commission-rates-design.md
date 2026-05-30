# Custom Agent Course Commission Rates Design

## Overview
This document outlines the design for configuring course-specific agent commission rates under the Agent Management CRM panel, capturing these rates in generated invoices, and exporting monthly XLSX commission reports with fallbacks.

## User Interface Design (CRM Admin)
- Under the "Agent Management" panel, we will add a "Course Commission Rates" section to the editor.
- Features:
  - Dropdown select populated with all active courses fetched via `CrmCourses.fetchCourses()`.
  - "Add Course" button which appends the selected course to a dynamically rendered list.
  - A list containing course names, custom percentage input fields, and a "Remove" button.
  - The custom percentage is stored locally in basis points (percent * 100) before saving.

## Database Schema (Firestore)
- Inside the `CRM_AGENT_SOURCES` collection (`agent-sources`):
  - Add a map field: `courseRates: { [courseId]: rateBps }`.
  - E.g.:
    ```json
    {
      "name": "Nguyen Counseling Team",
      "status": "active",
      "courseRates": {
        "course-1": 1500,
        "course-2": 1200
      }
    }
    ```

## Business & Fallback Logic
1. **Invoice Creation (`finance.js` POST)**:
   - When generating a student's invoice:
     - Check if the student has an `agentSourceId`.
     - Check if the invoice is associated with a `courseId`.
     - Look up the agent's document. If it has a configured rate under `courseRates.[courseId]`, copy it into `invoice.agentCommissionBps`.
     - Fall back to the course's default `agentCommissionBps` if not configured.
2. **Monthly XLSX Report (`agent-sources.js` GET)**:
   - The monthly XLSX report generates commissions based on paid invoices using the following fallback priority for `rateBps`:
     1. Manual override recorded in the commission payout document (`commission?.rateBps`).
     2. Agent source course-specific rate (`source?.courseRates?.[invoice.courseId]`).
     3. Invoice historical rate (`invoice.agentCommissionBps`).
     4. Default to `0`.
