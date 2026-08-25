# Status

**Current phase: 3** — see `docs/phases/phase-3.md`. Slice 3a (`PROC PYTHON`
backend, plus the `resolveContext` no-such-context correction) is merged; 3b
(log filter) is next.

> Update this file at the end of every phase (or slice, for phase 2). It is the
> only file every session should need to open to know where to start — open the
> phase file it points to, not the others, unless the current file says
> otherwise or you have a specific reason to check history.

## Phase index

| Phase | Status | File |
|---|---|---|
| 0 — Repository foundation | ✅ done | `docs/phases/phase-0.md` |
| 1 — Auth & connection profiles | ✅ done | `docs/phases/phase-1.md` |
| 2a — Compute core & VS Code shell | ✅ done | `docs/phases/phase-2a.md` |
| 2b — Backend seam, dialects, job log & the pump (covers 2b and 2c) | ✅ done | `docs/phases/phase-2b.md` |
| 3 — Run Python (vertical slice) | ▶ in progress (3a done, 3b next) | `docs/phases/phase-3.md` |
| 4 — Diagnostics | not started | `docs/phases/phase-4.md` |
| 5 — Hardening & first release | not started | `docs/phases/phase-5.md` |
| 6 — SAS Content explorer | not started | `docs/phases/phase-6.md` |
| 7 — Libraries and data viewer | not started | `docs/phases/phase-7.md` |
| 8 — CAS and SWAT | not started | `docs/phases/phase-8.md` |
| 9 — Notebooks | not started | `docs/phases/phase-9.md` |
| 10 — Viya environment awareness | not started | `docs/phases/phase-10.md` |
| 11 — Remaining parity gaps | not started | `docs/phases/phase-11.md` |
| 12 — Second execution backend | not started | `docs/phases/phase-12.md` |

Each phase file bundles everything that phase needs: the plan section
(architecture, scope), the runbook punch list (commands, order, barriers), and
the relevant probe findings — so one file is normally all a session needs
beyond this index and the trimmed `RUNBOOK.md` / `PRODUCTION_PLAN.md` cores.

Phase 2b covers what were originally separate "2b" and "2c" labels in the
source runbook — they share one continuous command block in the original
document and don't split cleanly, so they're kept as one phase file here.
