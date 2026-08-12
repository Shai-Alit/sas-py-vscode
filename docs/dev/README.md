# Developer guide

Filled in as the tooling lands. `CONTRIBUTING.md` holds the rules a change must
satisfy; these pages explain how the machinery works and why.

- [**Building and debugging**](building.md) — prerequisites, the `verify` gate,
  the F5 inner loop, what each tool in the chain is for, and the toolchain
  constraints that bite silently
- [**Testing**](testing.md) — the three tiers, the HTTP mocking layer, fixtures
  and how to sanitise them, and the coverage ratchet
- [**Continuous integration**](ci.md) — the three CI jobs, why the test matrix
  is shaped the way it is, and what `check:package` protects against

Planned pages:

- **The live test tier in anger** — what to run it against, and the cleanup
  contract for mutating tests (5b)
- **AI reviewers** — the Foundry and Entra setup, and how to diagnose a silent
  reviewer (0a-ii; `AI-PR-REVIEWERS-RUNBOOK.md` lands here in 0d-ii)
- **Releasing** — versioning, packaging, marketplace and Open VSX publishing (5c)
