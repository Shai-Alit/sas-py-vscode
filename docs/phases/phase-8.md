# Phase 8 — CAS and SWAT

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 8 — CAS and SWAT

Genuinely net-new — the SAS extension calls no CAS APIs. `swat` is already
installed on the deployment (`PROBE-FINDINGS.md`), so the client side is free.
CAS server/caslib/table browsing via `/casManagement`, and a documented pattern
for getting an authenticated CAS session inside a Python cell without the user
handling credentials. *Slices: 8a CAS browsing; 8b authenticated CAS session
helper; 8c CAS tables in the data viewer.*


---

## Runbook

_Not yet reached — no punch list written yet._

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
