# Status

**Phase 5 (Hardening & first release) is complete.** `v0.1.1` is the first
published release — VS Marketplace, Open VSX, and GitHub Releases. All Phase 5
slices (5a, 5b, 5c-i–5c-iv, 5d-i–5d-iv) are merged; Viya 3.5 support was dropped
along the way ([ADR-0022](docs/adr/0022-drop-viya-35-support.md)).

**Phase 6 (SAS Content explorer) is fully complete and merged — 6a–6e all landed.** A SAS Content tree (My Favorites / My Folder / SAS Content / Recycle Bin) with open/save via a `sasContent:` `FileSystemProvider`, create/rename/move/delete, drag-and-drop, favourites, a recycle bin, and right-click Cut/Paste as a permanent move alternative ([ADR-0030](docs/adr/0030-delete-recycles-content-items.md), [ADR-0031](docs/adr/0031-content-folder-resource-uri.md), [ADR-0032](docs/adr/0032-content-cut-paste.md)). Final merge: 6e as [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), squash `a74f756`. `npm run verify` green throughout (1580 unit; coverage 95.57/95.51/95.26/95.57). **The Phase 6→7/8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — its only open item, the top-level-folder permanent-delete confirmation, closed as a documented, deferred known gap (a Viya deployment-level install-time configuration, not something this codebase or account permissions control) — see `phase-6.md`'s Runbook and `manual-test-pass.md`'s §15 for the full account. The full slice-by-slice narrative that used to live here has moved to `docs/status-archive.md`, per this file's own archival rule — a move that should have happened at the Phase 6→7/8 checkpoint itself but was missed then; caught and fixed at the Phase 8→9 checkpoint instead.

**Phase 7 (Libraries and data viewer) is fully complete — 7a–7d all merged 2026-09-11.** `src/data/` (library/table tree, ADR-0027), the React + ag-grid-community data viewer webview with sort/filter/CSV export (ADR-0028/ADR-0029), the table properties panel, and Python↔SAS-library data exchange via `SAS.sd2df`/`df2sd`/`submit` (7d, no upstream equivalent) are all live. Findings 7.1–7.20 and every phase-specific ADR are in [`docs/phases/phase-7.md`](docs/phases/phase-7.md), which has the full slice-by-slice account. Final merge: 7d as [PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163), squash `7b32db0`. `npm run verify` green throughout (1574 unit tests; coverage 95.62%/95.54%/95.38%/95.62% lines/branches/functions/statements). **The Phase 7→8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — see the "Phase 7→8 housekeeping" section below for what it found and fixed. The full slice-by-slice narrative that used to live here has moved to [`docs/status-archive.md`](docs/status-archive.md), per this file's own archival rule.

**Phase 8 (CAS and SWAT) is fully complete — 8a–8c all merged 2026-09-14.** A read-only CAS tree (servers, global caslibs, tables, and — once loaded — columns, no compute session needed — [ADR-0033](docs/adr/0033-cas-adapter-shape.md)); `pythonOnViya.insertCasConnectionSnippet` delivers a fresh CAS token via the same never-logged fileref-upload path Python source itself uses, never via inline submitted code (Finding 8.6); and CAS tables open in the same paged, sortable, filterable data-viewer panel Phase 7 built, generalized behind a `TableSource` interface rather than forked or forced through `LibraryAdapter`'s own view machinery ([ADR-0034](docs/adr/0034-table-source-abstraction.md)). Final merge: 8c as [PR #171](https://github.com/Shai-Alit/sas-py-vscode/pull/171), squash `bb80b92`. `npm run coverage` green throughout (1703 unit; coverage 95.92/95.46/95.75/95.92). **The Phase 8→9 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-14** — see the "Phase 8→9 housekeeping" section below for what it found and fixed. The full slice-by-slice narrative that used to live here has moved to `docs/status-archive.md`, per this file's own archival rule.

**Phase 9 (Notebooks) is in progress.** 9a (dependency spike + controller
registration) is done, merged 2026-09-14 as [PR #172](https://github.com/Shai-Alit/sas-py-vscode/pull/172),
squash `6884e49` — a hands-on spike confirmed `.ipynb` opens as a notebook
and a `NotebookController` contributing no serializer is selectable as its
kernel with **zero** other extensions installed, so
[ADR-0024](docs/adr/0024-notebooks-are-ipynb-native.md) needs no amendment.
**9b (controller + execution) is code-complete 2026-09-14, including a
same-day architecture correction (ADR-0035) found by the manual pass before
any of this was pushed.** Real execution:
`src/notebook/notebookController.ts`'s `createNotebookExecutionHandlers`
wires `executeHandler` to `ExecutionBackend.execute()` with
`freshNamespace: false` and `interruptHandler` to `cancel()` (Finding
75/76's caveats apply the same way they do to Run File's own Cancel).
Decided this slice, not left implicit: the kernel picker alone is a
notebook's run-target equivalent — no separate status-bar toggle needed
(ADR-0011/0020's own concept does not extend to notebooks); and cell output
renders `text/plain` live as it streams, with `text/html`/`image/png` given
an honest "not rendered yet" placeholder and 9c left to build the real
renderer (full reasoning in `notebookController.ts`'s own doc comment).
**The manual pass (§9.8/§9.9) found the first cut's session sharing was
destructive, not merely incomplete**: `src/run/backendCache.ts` (lifted out
of `commands.ts`'s private closure, a straight move) was first handed to
*both* Run File and the notebook controller as one shared instance — but
`PROC PYTHON` has exactly one interpreter namespace per compute session, so
Run File's own `freshNamespace: true` (every whole-file run, unchanged
since Phase 3) silently wiped the notebook's variables the instant both
were used against the same profile. Fixed same day by
[ADR-0035](docs/adr/0035-notebook-gets-its-own-compute-session.md): the
notebook controller now gets its own `ComputeSessionManager`, its own
`purpose`-namespaced `SessionBindingStore` (`binding.ts`'s
`sessionBindingKey` gained an optional `purpose` parameter — `undefined`
for Run File's own binding, so every existing install's binding keeps
reattaching unchanged), and its own `BackendCache`; `extension.ts` now
builds two of each instead of one shared pair. `Disconnect`/Sign Out end
both sessions; `Connect` and the status bar stay scoped to Run File's
session only. `backendCache.ts` itself needed no change — it was already
just a cache keyed on `connection.profileId`. A related, smaller fix from
the same pass (§9.8): a cell run right after an interrupted one can sit
with no output for as long as the interrupted statement takes to actually
finish server-side (Finding 76); `notebookController.ts` now shows an
honest, cause-agnostic "still no output" notice after 3 seconds rather than
silence — real tracking for a precise message was considered and carried
forward to `phase-11.md` instead, matching Phase 4c's own call on the
identical gap for Run File. `npm run coverage` green — 1685 unit tests (up
from 1675 at the original cut), coverage 95.94/95.48/95.81/95.94 (unchanged
throughout — `.c8rc.json`'s 95.8/95.8/95.6/95.4 floor cleared with room);
`backendCache.ts` turned out **not** to need a `.c8rc.json` exclusion (it
imports `vscode` only for types, so the unit tier can reach it —
`test/unit/run-backend-cache.test.ts` covers it directly at 99.4% lines,
reusing `test/helpers/recorded-connection.ts`). `npm run test:integration`
green — 411 passing (up from 406 at 9a): `execution.test.ts`'s five cases
(streamed success, busy refusal, the two waiting-notice cases, interrupt-
then-recover), driven against a **fake** `NotebookController`/
`NotebookCellExecution` rather than a real one (a real one refuses
`createNotebookCellExecution` unless VS Code's own kernel picker already
selected it — state that test has no reason to fight, since both are plain
structural interfaces in `@types/vscode`, not classes). `controller.test.ts`'s
9a regression still passes, lightened to assert a terminal
`executionSummary` is reached rather than the now-superseded placeholder
message. Full account in `phase-9.md`'s 9b Runbook entry.
**§9.8/§9.9 need a fresh live re-run against the corrected code — left for
Sean.** **Adversarial self-review ran 2026-09-14 against the full diff
(ADR-0035 split included) — three findings, all verified independently and
folded into the branch before push:** a real wrong-target `interruptHandler`
bug (it cancelled whatever `currentRun` held regardless of which notebook
Interrupt was actually pressed on — fixed by having `currentRun` record its
own notebook and checking it); a fire-and-forget `appendOutput` with no
explanation, unlike every other swallowed promise in this codebase (fixed
with the same comment convention); and "Disconnect ends both sessions"
(ADR-0035) having no test, automated or manual — not reachable at the unit
or integration tier (`registerComputeCommands` needs a real extension host),
so recorded instead as a new, unchecked manual-test item (§9.11). `npm run
verify` and `npm run test:integration` both green after folding the fixes
in — same 1685 unit / 411 integration counts as before, since no tests were
added or removed. Full account in `phase-9.md`'s 9b Runbook entry.

## Phase 5→6 housekeeping — done 2026-09-09

Full write-up in `docs/status-archive.md`; the outcomes:

- **All seven `HOUSEKEEPING.md` checklist items clean or reconciled.** ADRs
  correct (ADR-0023's title/index row now note the 2026-09-04
  `--azure-credential` amendment); `phase-5.md` punch list fully ticked;
  `RUNBOOK.md` / `PRODUCTION_PLAN.md` current (coverage figures match
  `.c8rc.json` 94/94/93/95); no scratch files outstanding; **0 open Dependabot
  alerts** and `scripts/advisory-allowlist.json` empty.
- **Finding 74 closed** by a live probe → **Finding 93** (`phase-5.md`): no
  `PROC PYTHON` option suppresses the interpreter banner or `>>>` prompt
  markers. Decision (Sean): accept and document — `manual-test-pass.md` §6 and
  the user docs reworded to treat them as inherent `PROC PYTHON` output.
- **Full manual test pass ran 2026-09-09** (Sean) against `verde` (SSO) /
  `Innov` (SAS corporate creds) with the published `.vsix` — the first full
  pass since 2026-08-27. Everything passed **except the 5d-i user-provided-CA
  row**, which needs a deployment whose chain the OS distrusts (none available;
  stays deferred). It surfaced one bug:
  - **Fileref collision after reopening VS Code** on a folder with a long-lived
    session — `listFilerefNames` read only the first page of the fileref
    collection, under-seeding Finding 72's counter. **Fixed** (paginate the
    listing; **Finding 94**) in [PR #135](https://github.com/Shai-Alit/sas-py-vscode/pull/135),
    squashed as `9cb7de9`.
- **Also merged:** stale-comment sweep in `src/run`
  ([PR #133](https://github.com/Shai-Alit/sas-py-vscode/pull/133)); the
  housekeeping docs ([PR #132](https://github.com/Shai-Alit/sas-py-vscode/pull/132),
  [PR #134](https://github.com/Shai-Alit/sas-py-vscode/pull/134)); and
  `CLAUDE.md` hardened so the adversarial review always happens **before** a PR
  is opened.

## Phase 7→8 housekeeping — done 2026-09-11

The outcomes:

- **ADRs correct.** [0027](docs/adr/0027-library-adapter-shape.md), [0028](docs/adr/0028-data-viewer-is-react-and-ag-grid.md), [0029](docs/adr/0029-sort-view-lifecycle.md), and [0003](docs/adr/0003-extension-host-target.md)'s 2026-09-11 amendment all read as correct and internally consistent with what shipped. Nothing to fix.
- **One stale punch-list checkbox fixed**: `phase-7.md`'s 7c-iii header had never been flipped to ☑ despite every sub-item under it being done and PR #161 merged — a doc-hygiene slip, corrected.
- **`PRODUCTION_PLAN.md` §3.1's parity table gained a row for 7d** (Python↔library data exchange via `SAS.sd2df`/`df2sd`/`submit`) — a no-upstream-equivalent capability, like the existing CAS/SWAT row, that had no row of its own.
- **`STATUS.md`'s own Phase 7 entry trimmed** per this checkpoint's own rule (both the body narrative and the phase-index row) — the full narrative moved to `docs/status-archive.md`.
- **No scratch/pending files** to reconcile — none existed.
- **Manual test pass**: §10–§13 all fully passed. Two rows in the old §17 (the `PROC PYTHON` SQL-pass-through example; duplicate-drop de-duplication) had been left unrun with no prior explanation. A CSV-export (7c-iii) section was missing from the manual-test tracking doc entirely despite the feature being merged and live-facing; added (items 7.44–7.47) to track it. **The manual-test doc itself was also restructured this session, per Sean's own request** — `docs/dev/manual-test-pass.md` is now a stub; the real content lives at [`docs/dev/manual-tests/`](docs/dev/manual-tests/setup.md), one file per phase plus a `setup.md` and a `misc.md` for phase-agnostic checks, every item numbered (`S.1`, `1.1`, `6.4`, `M.2`, …) instead of a bare bullet. **Sean then ran the new items live, 2026-09-11**: CSV export (7.44–7.47) and duplicate-drop de-duplication (7.43) all pass — see `phase-7.md`'s 7c-iii and 7d Runbook entries. The one remaining open row is the `PROC PYTHON` SQL-pass-through example (`docs/dev/manual-tests/phase-7.md` item 7.39), still unrun.
- **Dependency advisories: clean.** 0 open Dependabot alerts (checked live); `scripts/advisory-allowlist.json`'s `allowed` list is empty and consistent.
- **Phase 8 (next) scoping has drift from Phase 6/7 learnings**, found and partly fixed this session: `phase-8.md`'s stale "should `src/wire/` promotion happen here" question is already resolved (ADR-0025, shipped in 6a) — corrected in place. Findings 87–92 in `phase-8.md`, carried under the old global numbering scheme, are renumbered `8.1`–`8.6` now that Phase 8 is being picked up, per `CLAUDE.md`'s numbering rule. Not fixed, flagged for whoever writes 8b: no connection is drawn yet between Finding 7.3/ADR-0027's "refuse rather than queue" busy-session precedent and an analogous CAS/SWAT concurrency question.
- **Innov cross-check attempted, still open.** Phase 7's Findings 7.10–7.20 were only ever probed against `verde`; a live retry this session found `innovationlab.sas.com` fails DNS resolution outright ("Non-existent domain") — a different symptom than the VPN-timeout signature earlier Phase 7 sessions hit. `verde` itself resolved and responded normally over the same network at the same time. Left open, Sean's call, same as every prior "not probed against Innov" note in `phase-7.md` — not blocking Phase 8.

## Phase 8→9 housekeeping — done 2026-09-14

The outcomes:

- **ADRs correct.** [0033](docs/adr/0033-cas-adapter-shape.md) (`CasAdapter` shape) and [0034](docs/adr/0034-table-source-abstraction.md) (`TableSource` abstraction) both read as correct and internally consistent with what shipped. Nothing to fix.
- **Punch list: clean.** 8b and 8c are fully ticked. 8a's three open items (a second-cadence probe blocked on a stale `innov` credential; the no-`sessionId` reading unconfirmed for a session-scoped caslib, none existing on `verde`; the `sortBy=name` fix unverified for 3 of 4 collections) each already carry a stated reason — left open as documented gaps, not fixed this session.
- **`RUNBOOK.md` / `PRODUCTION_PLAN.md` current.** §3.1's CAS/SWAT parity row reads correctly as-is; `.c8rc.json`'s thresholds (95.8/95.8/95.6/95.4) match the last reported coverage (95.92/95.46/95.75/95.92, cleared with no ratchet raise needed). Nothing to fix.
- **`STATUS.md` trimmed — two phases, not one.** Phase 8's own entry (this checkpoint) was trimmed to a short paragraph and phase-index row, full narrative moved to `docs/status-archive.md`, per the standing rule. **Phase 6's entry was found not to have been trimmed at the Phase 6→7/8 checkpoint** — that checkpoint's own outcomes note only mentions trimming Phase 7's entry, and Phase 6's full 6a–6e narrative was still sitting in both the body text and the phase-index table, with no copy in `status-archive.md`. Fixed at this checkpoint: both phases' full narratives are now archived and both entries read as short summaries.
- **No scratch/pending files** existed to reconcile.
- **Manual test pass: 8a and 8b fully run and passed** (`docs/dev/manual-tests/phase-8.md`) — all ten 8a items pass; all ten 8b items pass or are explicitly noted not independently reachable (§8.13, §8.17). **8c (CAS tables in the data viewer) had no tracking section at all**, despite being merged and live-facing — the same gap the Phase 7→8 checkpoint found and fixed for 7c-iii's CSV export. Added items 8.21–8.27 to track opening a CAS table, JIT-load-on-open, sort/filter, panel reveal/dedup, cross-deployment panel isolation (ADR-0034), dispose, and theme legibility — **not yet run**, left for Sean to run and check off.
- **Dependency advisories: clean.** 0 open Dependabot alerts (checked live via `gh api`); `scripts/advisory-allowlist.json`'s `allowed` list is empty and consistent, nothing near expiry.
- **Phase 9/10 scoping: no drift found.** Grepped both `phase-9.md` and `phase-10.md` for any reference to Phase 8/CAS/`TableSource` work that might now be stale or resolved differently than assumed; no hits in either file. Not edited — Phase 9 is being worked concurrently by another session.

## Open items carried forward

- **Open VSX namespace claim** — file the "Request ownership of a namespace"
  issue on `EclipseFdn/open-vsx.org` for the `shai-alit` namespace (Sean's
  Eclipse Foundation account) to clear the ⚠️ unverified-publisher warning on
  every release. Blocks nothing; trust-signal only.
- **5d-i user-provided-CA live test** — the one unrun `manual-test-pass.md` row
  (§3). Needs a deployment whose certificate chain the OS does not already
  trust. Run it when such an environment exists.
- **Phase 11 (parity gaps):** Accounts-menu legibility — with two profiles
  signed in, VS Code shows separate rows but they don't identify the extension
  or which profile each is (`Sean Ford (SAS Viya)` vs `sean.ford@sas.com
  (Microsoft)`). Recorded in `docs/phases/phase-11.md`; related to
  [#42](https://github.com/Shai-Alit/sas-py-vscode/issues/42).
- **Hosted docs site** — deliberately **not planned** pre-1.0 (the VitePress
  build runs as a CI link-check gate; nothing deploys the output). A standalone
  task if ever revisited, not a phase slice.

No new GitHub issues are being filed while the project is pre-release /
invite-only — tracked work lives in the phase files and as `fix/` PRs. Revisit
issue tracking once past "preview".

## Finding-numbering scheme changed 2026-09-09

Probe findings are now numbered per-phase (`N.x`), not one continuing global
sequence — see `CLAUDE.md`'s "Don't guess about Viya — probe it" section for
the full rationale (this project now works phases in parallel from separate
clones, and a continuing global counter can't be claimed safely by two
sessions at once) and the rules for applying it. **Applies from Phase 6
onward:** Phase 6's 6b-and-later findings are `6.1`, `6.2`, …; Phase 7's were
renumbered `7.1`–`7.7` (previously the global 83–86, 95, 96, 102). The old
flat sequence ran through **Finding 101** — findings written under it
(including Phase 6's 78–82 and 97–101) keep their global numbers. Any
already-recorded phase 8–10 findings from their scoping sessions keep their
global numbers until that phase is picked up, then move to `N.x` — not
preemptively.

## History

`docs/status-archive.md` holds the slice-by-slice narrative for Phase 3f
through the `v0.1.1` release and the Phase 5→6 housekeeping — the reasoning
captured in passing, moved out of this file 2026-09-09. Phase 7's own
narrative was appended 2026-09-11 at the Phase 7→8 housekeeping checkpoint.
Phase 6's and Phase 8's own narratives were both appended 2026-09-14 at the
Phase 8→9 housekeeping checkpoint — Phase 6's should have moved at the
Phase 6→7/8 checkpoint but was missed then. Per-phase detail
(plan, punch list, probe findings) is bundled in each
`docs/phases/phase-N.md`.

> Update this file when a slice lands, not just at phase boundaries — in the
> same PR that does the work. Keep it lean: it is the only file every session
> should need to open to know where to start. Put slice-by-slice detail in the
> phase file, and move a completed phase's narrative into `status-archive.md`
> at the between-phase boundary rather than letting this file grow without
> bound.

## Phase index

| Phase | Status | File |
|---|---|---|
| 0 — Repository foundation | ✅ done | `docs/phases/phase-0.md` |
| 1 — Auth & connection profiles | ✅ done | `docs/phases/phase-1.md` |
| 2a — Compute core & VS Code shell | ✅ done | `docs/phases/phase-2a.md` |
| 2b — Backend seam, dialects, job log & the pump (covers 2b and 2c) | ✅ done | `docs/phases/phase-2b.md` |
| 3 — Run Python (vertical slice) | ✅ **done, 3a–3f.** Finding 74 (interpreter banner / `>>>`) fully closed 2026-09-09 by Finding 93 — accepted and documented. | `docs/phases/phase-3.md` |
| 4 — Diagnostics | ✅ **done, 4a–4d.** Phase 4→5 housekeeping ran 2026-09-02 (`baacf3c`). | `docs/phases/phase-4.md` |
| 5 — Hardening & first release | ✅ **done — all slices merged; `v0.1.1` is the first published release.** Phase 5→6 housekeeping ran 2026-09-09 (see above). | `docs/phases/phase-5.md` |
| 6 — SAS Content explorer | ✅ **done — 6a–6e all merged.** SAS Content tree, open/save `FileSystemProvider`, create/rename/move/delete, drag-and-drop, favourites, recycle bin, Cut/Paste. Final PR [#162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), squash `a74f756`. `npm run verify` green (1580 unit; coverage 95.57/95.51/95.26/95.57). Phase 6→7/8 housekeeping ran and closed 2026-09-11 (see above). | `docs/phases/phase-6.md` |
| 7 — Libraries and data viewer | ✅ **done — 7a–7d all merged 2026-09-11** (library/table tree, React+ag-grid data viewer with sort/filter/CSV export, table properties panel, Python↔library data exchange via `SAS.sd2df`/`df2sd`/`submit`). Final PR [#163](https://github.com/Shai-Alit/sas-py-vscode/pull/163), squash `7b32db0`. `npm run verify` green (1574 unit; coverage 95.62/95.54/95.38/95.62). Phase 7→8 housekeeping ran and closed 2026-09-11 (see above). | `docs/phases/phase-7.md` |
| 8 — CAS and SWAT | ✅ **done — 8a–8c all merged.** CAS browsing tree ([ADR-0033](docs/adr/0033-cas-adapter-shape.md)), authenticated CAS session helper, CAS tables in the data viewer via a `TableSource` abstraction ([ADR-0034](docs/adr/0034-table-source-abstraction.md)). Final PR [#171](https://github.com/Shai-Alit/sas-py-vscode/pull/171), squash `bb80b92`. `npm run coverage` green (1703 unit; coverage 95.92/95.46/95.75/95.92). Phase 8→9 housekeeping ran and closed 2026-09-14 (see above). | `docs/phases/phase-8.md` |
| 9 — Notebooks | **9a done, merged as [PR #172](https://github.com/Shai-Alit/sas-py-vscode/pull/172).** No `ms-toolsai.jupyter` dependency (confirmed live, ADR-0024 unchanged). **9b (controller + execution) code-complete 2026-09-14 — adversarial review run, three findings folded in, ready to push.** `notebookController.ts` wires real execution (`freshNamespace: false`) and interrupt-to-cancel, now notebook-scoped after the review's wrong-target-interrupt finding; kernel picker alone is the notebook run-target equivalent, no status-bar extension. The manual pass found the first cut's session sharing with Run File destructive (one `PROC PYTHON` namespace per session); fixed same day by [ADR-0035](docs/adr/0035-notebook-gets-its-own-compute-session.md) — the notebook controller now runs against its own, separate compute session. `npm run coverage`/`test:integration` green (1685 unit, 95.94/95.48/95.81/95.94; 411 integration). §9.8/§9.9/§9.11 need a fresh live re-run. | `docs/phases/phase-9.md` |
| 10 — Viya environment awareness | **scoped 2026-09-04**, not started | `docs/phases/phase-10.md` |
| 11 — Remaining parity gaps | not started | `docs/phases/phase-11.md` |
| 12 — Second execution backend | not started | `docs/phases/phase-12.md` |

Each phase file bundles everything that phase needs: the plan section
(architecture, scope), the runbook punch list (commands, order, barriers), and
the relevant probe findings — so one file is normally all a session needs
beyond this index and the trimmed `RUNBOOK.md` / `PRODUCTION_PLAN.md` cores.

Phase 2b covers what were originally separate "2b" and "2c" labels in the
source runbook — they share one continuous command block in the original
document and don't split cleanly, so they're kept as one phase file here.
