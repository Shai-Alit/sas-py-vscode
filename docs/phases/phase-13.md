# Phase 13 — Second execution backend

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

> **Renumbered from Phase 12 to Phase 13, 2026-09-22 (Sean's own call).**
> Phase 12 was repurposed the same day for AI-agent integration
> (`docs/phases/phase-12.md`,
> [ADR-0037](../adr/0037-ai-agent-integration-approach.md)) — a body of work
> that did not exist when this phase was first numbered, and had no work of
> its own against this number yet (no punch list, no probe findings). This
> phase's own content — a second execution backend — is unchanged; only its
> number and file path moved. Every cross-reference to "Phase 12" meaning
> this topic (`docs/adr/0007-connection-profile-storage.md`,
> `docs/phases/phase-3.md`, `PRODUCTION_PLAN.md` §8,
> `docs/dev/manual-tests/`) was updated to Phase 13 in the same change.

---

## Plan

### Phase 13 — Second execution backend

Only if warranted. The `ExecutionBackend` seam exists so this is additive. Revisit
native Python runtimes (SAS Workbench, batch/job execution) once real usage shows
where `PROC PYTHON` actually hurts.

---


---

## Runbook

_Not yet reached — no punch list written yet._

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
