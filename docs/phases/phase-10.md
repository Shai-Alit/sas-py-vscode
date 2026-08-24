# Phase 10 — Viya environment awareness

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 10 — Viya environment awareness

Phase 3e already ships the honest answer to "what can I import?" — a command that
lists the interpreter version, path, and installed distributions. This phase makes
that answer *ambient* rather than something you have to go and ask for: a proper
environment view with search and filtering, a diff against the local environment
so the mismatch that will bite is visible before it does, and reflecting the
remote package set back to Pylance so completions and unresolved-import warnings
describe the environment the code will actually run in rather than the laptop's.
Package *installation* into the compute context is deliberately deferred — it
raises governance questions that need a product decision first. *Slices:
10a environment view and local/remote diff; 10b Pylance environment reflection.*


---

## Runbook

_Not yet reached — no punch list written yet._

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
