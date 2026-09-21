<!-- BEGIN PAR COMMAND ENTRYPOINT -->
## Automatic readiness and PAR

Before completing deployable work, evaluating R4D, or executing PAR, read the [release protocol](../.agent/rules/session_tagging.md). Automatically record and mark verified ready tasks (R). PAR explicitly authorizes discovery, safe integration, verification, commit, push, deployment, and live checks for the current project's eligible batch; no repeated stage approvals are needed. Mark (D) only after all intended surfaces are verified live. Invalidate readiness when new work starts. Use verified native task IDs and shared readiness records; never guess a session or use another host's title helper. Existing safety and deployment gates still apply.
<!-- END PAR COMMAND ENTRYPOINT -->

<!-- BEGIN WORKSPACE PARALLEL WORK SAFETY -->
## Required safety policy for every agent

Read the complete policy in [parallel-work-safety.md](../.agent/rules/parallel-work-safety.md) before writing, handing off, integrating, publishing, migrating data, or retiring work. It applies to every agent host and model in this workspace and supplements the account-wide policy.

Apply its ownership and preservation requirements to all workflows below: use one integration owner for the current destination, assign one writer per shared file/resource, preserve existing content and unowned dirty work, and record the exact changes and checks before integration. A shared tracker or release workflow does not permit competing writers or bypass that review. Integrate sequentially and verify both tasks' behavior; keep deployment and live-data changes within their authorized scope. Existing sessions must reread this policy before their next affected action. These instructions do not install or prove automated Git enforcement.
<!-- END WORKSPACE PARALLEL WORK SAFETY -->

For other repository conventions, read [AGENTS.md](../AGENTS.md) and the relevant scoped instructions. This adapter applies the common safety policy to Copilot without changing another host's model or workflow settings.
