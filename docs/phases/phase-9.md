# Phase 9 — Notebooks

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 9 — Notebooks

`.py`-first notebook support with a `NotebookController` reusing the same session
(so state is shared between notebook and editor, exactly as the SAS extension
does). **Decide early: ipynb-compatible or a bespoke format?** The SAS extension
chose bespoke `.sasnb`; for Python, ipynb compatibility is worth serious weight
because the ecosystem expects it. *Slices: 9a format decision + serializer;
9b controller + execution; 9c renderers; 9d export.*


---

## Runbook

_Not yet reached — no punch list written yet._

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
