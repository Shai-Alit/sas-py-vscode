# Status

**Phase 5 (Hardening & first release) is complete.** `v0.1.1` is the first
published release — VS Marketplace, Open VSX, and GitHub Releases. All Phase 5
slices (5a, 5b, 5c-i–5c-iv, 5d-i–5d-iv) are merged; Viya 3.5 support was dropped
along the way ([ADR-0022](docs/adr/0022-drop-viya-35-support.md)).

**Phase 6 (SAS Content explorer) is in progress — open
[`docs/phases/phase-6.md`](docs/phases/phase-6.md).** Scoped 2026-09-03 (4
slices, 6a–6d); the 6→12 order was re-confirmed with Sean on 2026-09-09 before
starting. **6a is done** (split 6a-i + 6a-ii) and **6b is done**; **6c is
next.**

(Probe finding numbers are now phase-scoped `N.x` — see the "Finding-numbering
scheme changed 2026-09-09" section below and `CLAUDE.md`.)

- **6a-i — `src/wire/` promotion.** Done. The Viya hypermedia link helpers and
  the `application/vnd.sas.error+json` reader moved from `src/compute/` to a
  new service-agnostic `src/wire/` layer so `src/content/` can share them
  ([ADR-0025](docs/adr/0025-shared-wire-layer.md)). Zero behaviour change.
- **6a-ii — content adapter + read-only tree.** Done ([PR #139](https://github.com/Shai-Alit/sas-py-vscode/pull/139)).
  The `src/content/` module (`types`/`problems`/`client`/`adapter`/
  `contentSession`/`presentation` `vscode`-free; `contentTree`/`contentExplorer`
  thin `vscode` shells), this repo's first activity-bar view container, and a
  read-only SAS Content tree (My Favorites / My Folder / SAS Content / Recycle
  Bin, lazy-expanded). No `ContentModel`, no adapter factory, no `sortBy`
  cadence branch — [ADR-0026](docs/adr/0026-content-adapter-shape.md). Live
  Folders/Files findings 97–101 in `phase-6.md`; the `.py`-type second-cadence
  probe moved to 6c (it only feeds create-file).
- **6b — open/save via `FileSystemProvider`.** Done and merged 2026-09-10
  ([PR #141](https://github.com/Shai-Alit/sas-py-vscode/pull/141), squash
  `1c13854`). A new `sasContent:` `FileSystemProvider`
  (`src/content/contentFileSystem.ts`) over three `vscode`-free
  `ContentAdapter` methods (`statFile`/`readFileContent`/`writeFileContent`)
  and the mutating arm added to `src/content/client.ts`: clicking a file leaf
  opens it, saving writes it back with an `If-Match` round trip, and a
  lost-update `412` surfaces as a "reopen for the current version" conflict
  via the returning `localiseContentProblem` seam. Findings 6.1–6.2. Scoped
  to the open/save core — `getParent`/`reveal` + the finding-101 `ancestors`
  probe moved to 6c, the `sasContentReadOnly` recycle-bin scheme to 6d, and
  the drag-into-editor snippet (Python-shaped, probe-gated — Sean's call) to
  6c. `npm run verify` green (1347 unit + 280 integration passing; coverage
  94.93% lines / 95.22% branches / 94.53% functions / 94.93% statements);
  adversarial pass done before the PR, Codex + Claude PR reviews clean, all
  threads resolved. One review finding deferred to 6c (an oversized-file read
  surfaces as a network error, not a size error). A post-merge review pass
  raised one Major — the `opened` ETag guard was keyed by the file href alone,
  so it leaked across deployments; now keyed by deployment root + href — plus
  two Minor doc/robustness findings, addressed on
  `fix/content-etag-guard-per-deployment` (adversarial pass done; `npm run
  verify` green locally on the branch, 1348 unit + 281 integration passing) and
  headed for a follow-up PR.
- **6c — mutations (create/rename/move/delete).** Next. Also picks up the
  three items moved out of 6b above, and the `.py` type / `/types/types`
  probe deferred from 6a.

The Phase 5→6 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed
2026-09-09 — nothing else gates Phase 6.

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
captured in passing, moved out of this file 2026-09-09. Per-phase detail
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
| 6 — SAS Content explorer | **in progress.** 6a done (6a-i `src/wire/` promotion [ADR-0025](docs/adr/0025-shared-wire-layer.md), 6a-ii adapter + read-only tree [ADR-0026](docs/adr/0026-content-adapter-shape.md)); **6b done and merged 2026-09-10** ([PR #141](https://github.com/Shai-Alit/sas-py-vscode/pull/141), squash `1c13854`) — open/save via a `sasContent:` `FileSystemProvider`, findings 6.1–6.2, `npm run verify` green (1347 unit + 280 integration passing); 6c (mutations) next. | `docs/phases/phase-6.md` |
| 7 — Libraries and data viewer | **in progress. 7a done and merged 2026-09-10** ([PR #142](https://github.com/Shai-Alit/sas-py-vscode/pull/142), squash) — `src/data/`, the `pythonOnViya.dataExplorer` tree, `ComputeSessionManager`'s new `onDidChangeConnection`. `npm run verify` green (1295 passing; lines 94.81%, branches 95.22%, functions 94.45%, statements 94.81%). Findings 7.8/7.9 closed two implementation-time questions (no `itemtype` needed; a paginated collection's untyped `next` link must not be followed literally). 7b (data viewer webview) next, not started. | `docs/phases/phase-7.md` |
| 8 — CAS and SWAT | **scoped 2026-09-03**, not started | `docs/phases/phase-8.md` |
| 9 — Notebooks | **scoped 2026-09-04**, not started | `docs/phases/phase-9.md` |
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
