# Phase 4 — Diagnostics

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 4 — Diagnostics

**4a — Traceback parsing.** Parse the traceback, discard `<stdin>` harness frames,
map `<string>` frames through the offset map to editor positions. *Medium.*

**4b — Diagnostics surface.** Publish `Diagnostic`s into the Problems panel with
correct squiggle positions; clear on re-run; optional quick actions. *Small/medium.*

*Exit:* a failing Python run puts an accurately-positioned error in Problems.


---

## Runbook

_Not yet reached — no punch list written yet._

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
