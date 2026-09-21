---
name: dependency-management
description: "Evaluate, add, update or remove a software dependency when the task needs that decision. Check existing capabilities, compatibility, maintenance, licensing, security and lockfile effects before changing the dependency graph."
---

# Dependency decisions

Start with the required behavior and operating constraints. Read the project's manifests, lockfile, supported runtimes and existing wrappers. Search for a suitable capability already in the project before proposing another package.

## Compare actual options

Consider existing code, the standard library, native platform features and a maintained dependency. Compare correctness, edge cases, security, accessibility where relevant, portability, performance, maintenance effort and integration cost. Fewer lines or fewer dependencies do not automatically make an option better; a mature library may be safer than a custom implementation.

Use current primary documentation and relevant advisories to verify version-dependent claims. Check API compatibility, supported runtimes, licenses and transitive effects. Download counts, age and vulnerability scan counts alone are not quality verdicts. Distinguish confirmed exposure from an advisory that does not affect this usage.

## Make a bounded change

Use the project's package manager and version policy. Update the manifest and lockfile together, inspect the actual dependency delta and avoid unrelated broad upgrades. For a major change, read migration guidance and test affected callers before claiming compatibility.

Preserve existing public behavior unless changing it is authorized. Do not install an entire toolkit, add a package-manager migration or replace working validation just to simplify a diff. Do not run a force-fix command that rewrites the graph without inspecting its consequences.

Verify installation reproducibility as appropriate and run focused tests for the behavior that uses the dependency. Explain the selected option, relevant compatibility/security limits and any deferred upgrade. For removal, check runtime, build, test and dynamic use rather than relying solely on one text search.

Stop when the needed capability is supported and the dependency change is reviewable with adequate evidence. [Provenance](SOURCE.md).
