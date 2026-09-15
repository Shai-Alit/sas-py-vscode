# Status

**Phase 5 (Hardening & first release) is complete.** `v0.1.1` is the first
published release — VS Marketplace, Open VSX, and GitHub Releases. All Phase 5
slices (5a, 5b, 5c-i–5c-iv, 5d-i–5d-iv) are merged; Viya 3.5 support was dropped
along the way ([ADR-0022](docs/adr/0022-drop-viya-35-support.md)).

**Phase 6 (SAS Content explorer) is fully complete and merged — 6a–6e all landed.** A SAS Content tree (My Favorites / My Folder / SAS Content / Recycle Bin) with open/save via a `sasContent:` `FileSystemProvider`, create/rename/move/delete, drag-and-drop, favourites, a recycle bin, and right-click Cut/Paste as a permanent move alternative ([ADR-0030](docs/adr/0030-delete-recycles-content-items.md), [ADR-0031](docs/adr/0031-content-folder-resource-uri.md), [ADR-0032](docs/adr/0032-content-cut-paste.md)). Final merge: 6e as [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), squash `a74f756`. `npm run verify` green throughout (1580 unit; coverage 95.57/95.51/95.26/95.57). **The Phase 6→7/8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — its only open item, the top-level-folder permanent-delete confirmation, closed as a documented, deferred known gap (a Viya deployment-level install-time configuration, not something this codebase or account permissions control) — see `phase-6.md`'s Runbook and `manual-test-pass.md`'s §15 for the full account. The full slice-by-slice narrative that used to live here has moved to `docs/status-archive.md`, per this file's own archival rule — a move that should have happened at the Phase 6→7/8 checkpoint itself but was missed then; caught and fixed at the Phase 8→9 checkpoint instead.

**Phase 7 (Libraries and data viewer) is fully complete — 7a–7d all merged 2026-09-11.** `src/data/` (library/table tree, ADR-0027), the React + ag-grid-community data viewer webview with sort/filter/CSV export (ADR-0028/ADR-0029), the table properties panel, and Python↔SAS-library data exchange via `SAS.sd2df`/`df2sd`/`submit` (7d, no upstream equivalent) are all live. Findings 7.1–7.20 and every phase-specific ADR are in [`docs/phases/phase-7.md`](docs/phases/phase-7.md), which has the full slice-by-slice account. Final merge: 7d as [PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163), squash `7b32db0`. `npm run verify` green throughout (1574 unit tests; coverage 95.62%/95.54%/95.38%/95.62% lines/branches/functions/statements). **The Phase 7→8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — see the "Phase 7→8 housekeeping" section below for what it found and fixed. The full slice-by-slice narrative that used to live here has moved to [`docs/status-archive.md`](docs/status-archive.md), per this file's own archival rule.

**Phase 8 (CAS and SWAT) is fully complete — 8a–8c all merged 2026-09-14.** A read-only CAS tree (servers, global caslibs, tables, and — once loaded — columns, no compute session needed — [ADR-0033](docs/adr/0033-cas-adapter-shape.md)); `pythonOnViya.insertCasConnectionSnippet` delivers a fresh CAS token via the same never-logged fileref-upload path Python source itself uses, never via inline submitted code (Finding 8.6); and CAS tables open in the same paged, sortable, filterable data-viewer panel Phase 7 built, generalized behind a `TableSource` interface rather than forked or forced through `LibraryAdapter`'s own view machinery ([ADR-0034](docs/adr/0034-table-source-abstraction.md)). Final merge: 8c as [PR #171](https://github.com/Shai-Alit/sas-py-vscode/pull/171), squash `bb80b92`. `npm run coverage` green throughout (1703 unit; coverage 95.92/95.46/95.75/95.92). **The Phase 8→9 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-14** — see the "Phase 8→9 housekeeping" section below for what it found and fixed. **Three post-merge fixes then landed as [PR #173](https://github.com/Shai-Alit/sas-py-vscode/pull/173), squash `c2478bb`, merged 2026-09-14** — a `dataTable`-relation redirect (Finding 8.14), a CAS filter's error message surfacing an opaque code instead of CAS's own actionable sentence (Finding 8.15), and an attempted tree-icon-refresh fix that live re-confirmation found still does not work, deferred as a known gap to Phase 10/11 (`docs/phases/phase-11.md`) — see `phase-8.md`'s "Post-merge fixes, 2026-09-14" Runbook entry for the full account. The full slice-by-slice narrative that used to live here has moved to `docs/status-archive.md`, per this file's own archival rule.

**Phase 9 (Notebooks) is fully complete — 9a–9d all merged or decided,
2026-09-14/15.** ipynb-native execution (no `ms-toolsai.jupyter` dependency)
against the notebook's own compute session
([ADR-0024](docs/adr/0024-notebooks-are-ipynb-native.md)/[ADR-0035](docs/adr/0035-notebook-gets-its-own-compute-session.md)),
cell output rendered via VS Code's own built-in `notebook-renderers`
extension with `text/html` sanitized before it ever reaches that renderer
([ADR-0036](docs/adr/0036-notebook-html-output-is-sanitized.md)), and
Problems-panel diagnostics for a raised cell via this module's own
`DiagnosticCollection`. Final merges: 9a
[PR #172](https://github.com/Shai-Alit/sas-py-vscode/pull/172) squash
`6884e49`; 9b [PR #176](https://github.com/Shai-Alit/sas-py-vscode/pull/176)
squash `9eca850`; 9c [PR #177](https://github.com/Shai-Alit/sas-py-vscode/pull/177)
squash `fa7222f`, merged 2026-09-15 — 9c's own PR review found four
sanitizer bypasses, all fixed and folded in before push. **9d (export)
scoped 2026-09-15 and decided: dropped outright, no code written** — a
`.ipynb` this extension writes is already exportable/convertible by any
ipynb-aware tool with zero help from this extension, and VS Code core
already covers per-output copy/save natively, so there was nothing left to
build (full reasoning in `phase-9.md`'s 9d Runbook entry). `npm run verify`
green throughout (1753 unit tests; coverage 96.04/95.51/95.9/96.04);
`npm run test:integration` green (433 passing). **The Phase 9→10
between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-15** —
see the "Phase 9→10 housekeeping" section below for what it found. The full
slice-by-slice narrative that used to live here has moved to
[`docs/status-archive.md`](docs/status-archive.md), per this file's own
archival rule.

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

## Phase 9→10 housekeeping — done 2026-09-15

The outcomes:

- **ADRs correct.** [0035](docs/adr/0035-notebook-gets-its-own-compute-session.md)
  (notebook gets its own compute session) and
  [0036](docs/adr/0036-notebook-html-output-is-sanitized.md) (HTML output
  sanitized) both read as correct and internally consistent with what
  shipped. **No amendment needed for [0024](docs/adr/0024-notebooks-are-ipynb-native.md)**
  either — 9d's drop is the payoff that ADR already named for going
  ipynb-native, not a new decision.
- **Punch list: clean.** 9a/9b/9c were already fully ticked. 9d — the one
  item still open — was scoped this session and decided: dropped outright,
  with the reasoning recorded in `phase-9.md`'s own Runbook entry (VS Code
  core already covers per-output copy/save via the bundled `ipynb`
  extension; whole-notebook export is `ms-toolsai.jupyter`'s own feature,
  backed by a local `nbconvert` dependency this project has never taken on
  and declined again here for the same reason 9a declined it for execution).
  Phase 9's punch list is now fully ticked, 9a through 9d.
- **`STATUS.md` trimmed.** Phase 9's own entry (this checkpoint) was cut
  down to a short paragraph and phase-index row; the full 9a–9d narrative,
  plus 9d's own resolution, moved to `docs/status-archive.md`.
- **One doc-consistency gap found and fixed: two Phase 9c gaps that
  `phase-9.md` said were "carried to `phase-11.md`" had never actually
  landed there.** A rejected `appendOutput` mid-stream (notebook closed
  mid-run) skipping `execution.end` (Finding 10), and a stale Problems entry
  for a notebook cell outliving a sign-out (the half of Finding 2 that
  wasn't fixed) — both real, both correctly described in `phase-9.md`, but
  the actual carry-forward into `phase-11.md`'s "Also carried here" list
  never happened. Added this session, dated to this checkpoint rather than
  backdated, with a note that they should have landed with 9c's own merge.
- **No scratch/pending files** existed to reconcile.
- **Manual test pass: fully complete.** Every Phase 9 manual-test item
  (§9.1–§9.14, `docs/dev/manual-tests/phase-9.md`) is checked — none left
  unrun. 9d needs no manual test; nothing shipped to test.
- **Dependency advisories: clean.** 0 open Dependabot alerts (checked live
  via `gh api`); `scripts/advisory-allowlist.json`'s `allowed` list is empty
  and consistent, nothing near expiry.
- **Phase 10 scoping: no drift found.** Grepped `phase-10.md` for references
  to Phase 9/notebook work that might now be stale; the only hits are
  general precedent-citing mentions of Phase 9's own scoping approach (the
  `ms-toolsai.jupyter`-shaped dependency question, the "no probe needed"
  reasoning), nothing that names an ADR-0035/ADR-0036/`BackendCache` detail
  that changed since. **Not edited** — Phase 10 is being worked concurrently
  by another session, per this project's own separate-clone convention.

## Documentation catch-up — done 2026-09-15

A completeness pass, run during Phase 10 at the developer's request, found
that Phase 8's CAS tree and Phase 9's notebooks had shipped with **no**
user-facing documentation (Phase 8 had one page for the Python-side CAS
connection, but it was never wired into `docs/README.md` or the VitePress
nav and so was unreachable; Phase 9 had nothing at all), and that Phase 6's
Cut/Paste move was undocumented too. Fixed in the same session: new
[`docs/browsing-cas.md`](docs/browsing-cas.md) and
[`docs/notebooks.md`](docs/notebooks.md), both registered in
`docs/README.md` and `.vitepress/config.mjs`'s `nav`/`sidebar`; a Cut/Paste
section added to `docs/browsing-sas-content.md`; cross-links added from
`getting-started.md`, `faq.md`, `troubleshooting.md`, `running-python.md`,
`browsing-sas-libraries.md`, and `cas-python-connection.md`. `npm run
check:docs` (reference tables, samples, self-link check, VitePress build)
and `check:secrets` both green throughout. Full accounts are each phase's own
Runbook — see `phase-6.md`'s, `phase-8.md`'s, and `phase-9.md`'s own
"Documentation catch-up, 2026-09-15" entries.

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
- **Phase 10/11 (known gap):** a CAS tree table's icon does not flip from
  "unloaded" to "loaded" after a JIT-load-on-expand, in a real VS Code
  window — a fix landed and was refined twice over [PR #173](https://github.com/Shai-Alit/sas-py-vscode/pull/173)'s
  own review, passes every unit/integration test written against it, and
  still doesn't work live (Sean, 2026-09-14). Root cause not found; needs a
  live debugging session against a real `vscode.TreeView`, not just this
  project's own fake-emitter test tiers. Recorded in
  `docs/phases/phase-11.md` and `phase-8.md`'s "Post-merge fixes,
  2026-09-14" Runbook entry.
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
Phase 6→7/8 checkpoint but was missed then. Phase 9's own narrative,
9d's resolution included, was appended 2026-09-15 at the Phase 9→10
housekeeping checkpoint. Per-phase detail
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
| 8 — CAS and SWAT | ✅ **done — 8a–8c all merged.** CAS browsing tree ([ADR-0033](docs/adr/0033-cas-adapter-shape.md)), authenticated CAS session helper, CAS tables in the data viewer via a `TableSource` abstraction ([ADR-0034](docs/adr/0034-table-source-abstraction.md)). Final PR [#171](https://github.com/Shai-Alit/sas-py-vscode/pull/171), squash `bb80b92`. `npm run coverage` green (1703 unit; coverage 95.92/95.46/95.75/95.92). Phase 8→9 housekeeping ran and closed 2026-09-14 (see above). Three post-merge fixes landed as [PR #173](https://github.com/Shai-Alit/sas-py-vscode/pull/173), squash `c2478bb`, merged 2026-09-14 — one known gap (tree icon refresh) deferred to Phase 10/11. | `docs/phases/phase-8.md` |
| 9 — Notebooks | ✅ **done — 9a–9d all merged or decided, 2026-09-14/15.** ipynb-native execution, no `ms-toolsai.jupyter` dependency, against the notebook's own compute session ([ADR-0035](docs/adr/0035-notebook-gets-its-own-compute-session.md)); cell output via VS Code's own built-in `notebook-renderers` extension, `text/html` sanitized first ([ADR-0036](docs/adr/0036-notebook-html-output-is-sanitized.md)); Problems-panel diagnostics for a raised cell. 9d (export) scoped and dropped outright — ipynb's own portability and VS Code core's native per-output commands already cover it. Final PRs [#172](https://github.com/Shai-Alit/sas-py-vscode/pull/172)/[#176](https://github.com/Shai-Alit/sas-py-vscode/pull/176)/[#177](https://github.com/Shai-Alit/sas-py-vscode/pull/177), squash `6884e49`/`9eca850`/`fa7222f`. `npm run verify` green (1753 unit, 96.04/95.51/95.9/96.04); `npm run test:integration` green (433 passing). Phase 9→10 housekeeping ran and closed 2026-09-15 (see above). | `docs/phases/phase-9.md` |
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
