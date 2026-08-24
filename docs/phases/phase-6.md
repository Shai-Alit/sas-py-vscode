# Phase 6 — SAS Content explorer

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 6 — SAS Content explorer

`ContentAdapter` interface and the Viya REST implementation over `/folders` and
`/files`; `TreeDataProvider`; `FileSystemProvider` registration so remote `.py`
files open and save in place; drag/drop; favourites; recycle bin. Largely
language-agnostic and ports closely. *Slices: 6a adapter + read-only tree;
6b open/save via FileSystemProvider; 6c mutations (create/rename/move/delete);
6d favourites and recycle bin.*


---

## Runbook

_Not yet reached — no punch list written yet._

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
