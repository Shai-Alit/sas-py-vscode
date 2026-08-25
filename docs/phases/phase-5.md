# Phase 5 — Hardening and first release

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 5 — Hardening and first release

**5a — Drift gate hardening.** The contracts themselves grew alongside the dialect
code from 2b onward; this slice completes them, hardens the
contracts ↔ dialect ↔ fixtures checker, and wires it into CI as a gate. *Small/medium.*

**5b — Live test tier.** Opt-in, env-gated live tests (`PYTHON_ON_VIYA_TEST_VIYA4_*` /
`PYTHON_ON_VIYA_TEST_VIYA35_*`), with the 3.5 tier as a skipped scaffold. Nothing live runs in
default CI. *Medium.*

**5c — Docs publishing and release engineering.** The docs themselves were written
slice by slice (§4.1); this slice *publishes* them — docs site build and deploy,
marketplace metadata and README rendering, screenshots/GIFs, the troubleshooting
guide assembled from what actually went wrong during Phases 1–4, publishing
workflow (VS Marketplace + Open VSX), and the release checklist. *Medium.*

*Exit:* **v0.1.0 published.** A user can install from the marketplace and run
Python on Viya.

---

Everything above is the product. Everything below is breadth, and each phase is
independently valuable and independently shippable. Order is a recommendation,
not a dependency chain — reprioritise based on what users actually ask for once
v0.1.0 is in their hands.


---

## Runbook

_Not yet reached — no punch list written yet._

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
