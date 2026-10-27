# Development Rule: Minimal, Surgical Fixes

- Fix the root cause in existing code with the smallest complete change. Do not add code, files, dependencies, abstractions, or layers unless they are necessary to fix the requested issue.
- Prefer correcting or reusing existing behavior over introducing a parallel implementation. Avoid expanding the app or increasing maintenance complexity for convenience.
- Before adding a new abstraction, persistence mechanism, service, or dependency, verify that the problem cannot be solved by a focused change to the existing flow. If a substantial addition appears necessary, explain why and ask before proceeding.
- Preserve existing behavior outside the requested fix, and do not make unrelated changes.
- Run the smallest relevant validation and report what was changed and verified.
- Design user-facing behavior with usability and accessibility in mind: provide clear, actionable feedback at the moment it is needed, use accessible labels and states, and avoid persistent instructional text when contextual feedback is more appropriate.