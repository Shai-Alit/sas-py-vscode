# Phase 11 — Remaining parity gaps

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 11 — Remaining parity gaps

The long tail that Phases 6–10 don't cover (§3.1): session startup/autoexec
configuration, result panel styling options, snippets for common Viya patterns,
and any localisation bundles beyond English. Individually small, collectively the
difference between "works" and "feels like a peer of the SAS extension."
*Slices sized when the phase is reached.*

**Also carried here (added 2026-09-10, from the Phase 6→7/8 housekeeping
checkpoint): two items deferred out of Phase 6 that never landed a home.**

- **Upload/download to local disk.** `phase-6.md` and `STATUS.md` both state
  this is "deferred to Phase 11" (decided 2026-09-10, never part of the 6a–6d
  breakdown), but neither the plan nor the punch list here ever recorded it —
  the deferral existed only as a sentence in the phase that deferred it. Scope
  for a slice here: uploading a local file into a SAS Content folder and
  downloading a SAS Content file to local disk, the two directions Phase 6's
  `sasContent:` `FileSystemProvider` and tree explicitly did not cover.
- **Drag a folder/file onto My Favorites.** A drop onto the My Favorites
  delegate in the SAS Content tree already no-ops (`contentMove.ts`'s
  `moveObjection` returns `target-not-a-folder` for it) rather than doing
  anything; wiring it to `addToFavorites` instead is upstream parity that
  never made either 6d slice's punch list (`phase-6.md`'s 6d-i Runbook entry).
  Small, self-contained, no probe needed — the mutation it would call already
  exists.

**Also carried here (added 2026-09-09, from the Phase 5→6 manual test pass):
Accounts-menu legibility.** With two profiles signed in whose auth flows differ,
VS Code shows two separate rows (it only collapses profiles that produce the
*same* `account.label` —
[#42](https://github.com/Shai-Alit/sas-py-vscode/issues/42)), but the rows carry
no indication that they belong to **Python on Viya** or which profile each is —
one appeared as `Sean Ford (SAS Viya)`, the other as `sean.ford@sas.com
(Microsoft)`, the parenthetical being the auth provider's own name. Scope for a
slice here: give `ViyaAuthenticationProvider`'s session `account.label` (and, if
possible, the row's provider-facing name) a form that identifies the extension
and the profile — and settle the `(Microsoft)`-vs-`(SAS Viya)` inconsistency for
a corporate-creds profile. Related: `#42` itself (the same-label collapse) and
RUNBOOK item 146.


---

## Runbook

_Not yet reached — no punch list written yet._

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
