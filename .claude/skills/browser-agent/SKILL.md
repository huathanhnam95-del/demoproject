---
name: browser-agent
description: Use when a task requires interacting with a web browser - testing UI flows, verifying web app behavior, clicking through screens, reading live web content, or automating browser workflows in Google Antigravity
---

# Browser Agent

## Overview

Antigravity includes a built-in browser subagent that can autonomously interact with web applications.
The main agent delegates browser tasks to it - this skill governs when and how to do that correctly.

The browser agent is NOT a general-purpose web search tool. It is a UI interaction and verification tool.
Use it when you need to act on a web page, not just read information from it.

## Scope and Routing

- If you are testing a web app in this workspace, run the repo's Playwright-based `webapp-testing` workflow first.
- After the Playwright check, use this skill as the second step when you want browser-subagent confirmation, a richer interactive repro, or browser-agent artifacts such as screenshots, recordings, or console evidence.
- Use this skill only when the browser subagent is actually available and the task must run through that Antigravity browser path.
- For authenticated browser checks in this workspace, follow `C:\Cursor AI\.local\browser-test-credentials.md` and use the documented admin account unless the user asks for a different one.

## Prerequisites

Before any browser task, verify:

1. Chrome extension installed - if not yet installed:
   - Look for the Chrome icon in Agent Manager (bottom left) or Editor (top right)
   - Click it, follow the setup prompt, install from Chrome Web Store, and grant permissions
   - Without the extension, the browser agent cannot interact with pages

2. URL allowlist configured for non-localhost URLs - add trusted domains to:
   ```
   ~/.gemini/antigravity/browserAllowlist.txt
   ```
   One domain per line, e.g.:
   ```
   localhost
   127.0.0.1
   staging.myapp.com
   ```
   Add both `localhost` and `127.0.0.1` if the app may be accessed under either hostname.
   Keep entries to hostnames only; do not include schemes, paths, or duplicate lines.
   The browser agent will refuse to access domains not on this list.

Before starting, state the prerequisite status in this format:
"Chrome extension: [installed / NOT installed]  |  Allowlist: [domain confirmed / domain NOT listed]"
If either check fails, stop and follow the relevant Error Path below before proceeding.

## When to Use the Browser Agent

Use it when the task requires:
- Following an initial Playwright pass with a browser-subagent confirmation step
- Reproducing a UI issue interactively after Playwright has already exercised the flow
- Verifying that a deployed app behaves correctly in the browser subagent
- Clicking through screens to confirm UI state after a code change
- Reading live content from a specific URL that cannot be fetched as static text
- Automating a repetitive browser workflow such as fill, submit, and verify

Do NOT use it for:
- General web research - use the `deep-research` skill instead
- Fetching static API responses - use `curl` or fetch in terminal
- Anything that can be verified with a unit or integration test

## How to Frame Browser Requests

The browser agent responds to precise, stepwise instructions. Vague requests produce unreliable results.

Bad: "Test the login page"

Good: "Navigate to http://localhost:3000/login. Enter 'test@example.com' in the email field and 'password123' in the password field. Click the 'Sign In' button. Wait for navigation to complete. Verify the URL is now http://localhost:3000/dashboard and the text 'Welcome' appears on screen."

Every browser request must specify:
1. The starting URL
2. Each action in sequence
3. The expected end state

Prefer visible labels and text over CSS selectors. Use "Click the button labeled 'Submit'" rather than "Click button#submit-btn".

## Supported Actions

The browser subagent can execute:

| Action | Example instruction |
|--------|-------------------|
| Navigate | "Go to http://localhost:3000/settings" |
| Click | "Click the button labeled 'Submit'" |
| Type | "Type 'hello world' into the search input" |
| Scroll | "Scroll down until the footer is visible" |
| Wait | "Wait for the spinner to disappear" |
| Read DOM | "Read the text content of the h1 element" |
| Screenshot | "Take a screenshot of the current state" |
| Read console | "Check the browser console for errors" |
| Execute JS | "Execute document.title and return the result" - read-only operations only |
| Record | "Start recording before the first action; stop recording after the final step" |

## Artifacts

The browser agent produces verifiable artifacts:

- Screenshot - static image of page state at a moment in time
- Screen recording - video of the full interaction session
- Console log - captured JavaScript errors and warnings

Completion requires an artifact. Do not claim a browser task is complete without one.

Acceptable completion statement:
> "Browser task complete. Screenshot attached shows dashboard loaded at /dashboard with 'Welcome, Jane' visible. No console errors."

Unacceptable:
> "I think the login flow worked."

## Error Paths

Extension not installed:
> "Browser agent setup required. Open Agent Manager -> click the Chrome icon -> install the extension -> retry."
> Do NOT proceed. The browser agent cannot function without it.

URL blocked by allowlist:
> "URL [domain] is not in the allowlist. Add it to ~/.gemini/antigravity/browserAllowlist.txt and retry."
> Do NOT attempt to bypass the allowlist.

Page does not reach expected state:
1. Take a screenshot of the actual state
2. Compare actual vs expected
3. Report the discrepancy with the screenshot as evidence
4. Do NOT claim success if the expected state was not reached
5. Stop and surface the failure to the user with the screenshot. Do NOT retry automatically without user confirmation.

Browser agent timeout:
> "Browser agent timed out. Simplify the request into smaller steps and retry once. If it times out again, stop and escalate to the user."

## Completion Criteria

A browser task is complete when ALL of the following are true:

- Chrome extension was confirmed installed before starting
- URL(s) were confirmed in the allowlist before starting
- Each action step was executed in sequence
- The expected end state was verified
- At least one artifact was produced
- Completion statement includes artifact reference and describes actual observed state

A task that ends with "it should be working" is not complete.

## Anti-Patterns

| Pattern | Why it fails |
|---------|-------------|
| Skipping prerequisite check | Browser agent silently fails without extension installed |
| Vague action descriptions | Agent takes wrong actions or stops mid-flow |
| Claiming done without artifact | No verifiable evidence; errors may be invisible |
| Using browser agent for research | Slower and less reliable than `deep-research` |
| Starting local app verification with browser-agent instead of Playwright | Skips the more reliable first pass and increases the chance of a stall |

## Example: Testing a Login Flow

Request: "Verify the login flow works on the local dev server."

Correct execution:

1. Run the initial login verification through the repo's Playwright-based `webapp-testing` workflow.
2. Announce prerequisites: "Chrome extension: installed | Allowlist: domain NOT listed - adding localhost and 127.0.0.1 now..."
3. Add `localhost` and `127.0.0.1` to `~/.gemini/antigravity/browserAllowlist.txt`
4. Delegate to browser agent with precise steps:
   - Navigate to `http://localhost:3000/login`
   - Type `admin@test.com` into `#email`
   - Type `secret` into `#password`
   - Click `button[type=submit]`
   - Wait for URL to change
   - Take screenshot
   - Verify URL is `/dashboard`, text "Welcome" is present, console has no errors
5. Produce artifact: screenshot of `/dashboard` state
6. Completion statement: "Login flow verified. Playwright passed first, then the browser-agent screenshot confirmed /dashboard with 'Welcome, Admin' heading. Zero console errors."
