# Refactoring implementation playbook

1. Bound the change. State the observed problem, affected callers, behavior to preserve and intended files. Account for unrelated dirty work.
2. Establish a baseline. Run the smallest meaningful existing checks and inspect their assertions. Add characterization evidence when a relevant contract is otherwise unknown.
3. Sketch the target interface. Compare total caller and implementation complexity with the current design. Keep required ownership, authorization, persistence and failure semantics visible.
4. Change in reviewable steps. Introduce compatibility where necessary, migrate one bounded set of callers, then verify the relevant behavior. Avoid mixing unrelated renames, formatting and feature changes.
5. Remove obsolete paths only with evidence. Search actual uses, account for dynamic references and external consumers, and preserve independent test coverage. A zero text-search result alone may not prove a public interface is unused.
6. Verify the settled candidate. Check original scenarios, affected integration contracts and applicable generated outputs. Inspect the complete delta for unrelated deletions or changed semantics.

Use extraction, inlining, merging or keeping the current structure according to the problem. No maximum function length, class count or line-removal target determines success. If a required migration prerequisite is absent, report it instead of silently broadening scope.
