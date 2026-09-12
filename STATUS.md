# Status

**Phase 5 (Hardening & first release) is complete.** `v0.1.1` is the first
published release — VS Marketplace, Open VSX, and GitHub Releases. All Phase 5
slices (5a, 5b, 5c-i–5c-iv, 5d-i–5d-iv) are merged; Viya 3.5 support was dropped
along the way ([ADR-0022](docs/adr/0022-drop-viya-35-support.md)).

**Phase 6 (SAS Content explorer) is fully complete and merged — 6a–6e all
landed.** Open [`docs/phases/phase-6.md`](docs/phases/phase-6.md)
for the full account. Scoped 2026-09-03 (4 slices, 6a–6d); the 6→12 order was
re-confirmed with Sean on 2026-09-09 before starting. **6e merged 2026-09-11**
as [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), squash
`a74f756`, after two further review rounds on the open PR each found and fixed
one real race in `paste()`'s failure-restore (commits `716ae27`/`1563bd3` —
see `phase-6.md`'s 6e Runbook entry) — Cut/Paste ships and is confirmed
working live; the `resourceUri` fix attempt for native drag-and-drop does
not work (live-retested, identical symptoms — disproven as the cause, per
ADR-0031's amendment). **Drag-and-drop's real root cause — a VS Code 1.109
bug that JSON-marshals `handleDrop`'s `CancellationToken` argument and
strips its subscribe method, so it threw before any move ran — was found
and fixed 2026-09-11, in a separate follow-up after 6e merged** (finding
6.16, `phase-6.md`) — [PR #164](https://github.com/Shai-Alit/sas-py-vscode/pull/164)
opened 2026-09-11; `phase-11.md`'s tracked follow-up is closed. Fixed and
verified by `npm run verify`/`test:integration`/`check:docs`, a new
regression test reproducing the exact broken-token shape, an adversarial
pass before push (no blocking findings), and **a live retest, 2026-09-11
(Sean): confirmed working** — a real drag-and-drop move, plus every other
§15 row that had been blocked on the base gesture — see `phase-6.md`'s
Runbook and `manual-test-pass.md`'s §15.
**The Phase 6→7/8 between-phase housekeeping
(`HOUSEKEEPING.md`) is now closed.** Its last open item, the top-level-folder
permanent-delete confirmation, is resolved as a documented, deferred known
gap rather than a retry: a real live-exercise attempt found the deletion
blocked, the housekeeping checkpoint itself then mis-corrected that finding
by reasoning from Sean's own admin access (**that correction was wrong and
is retracted**), and Sean has since clarified the actual mechanism — a Viya
deployment-level configuration set at install time restricts deleting a
folder directly under SAS Content for most users, independent of account
permissions, not something admin rights bypass. Not retestable on this
deployment; needs one configured to allow it. See `phase-6.md`'s Runbook
(the `☐` item after the drag-and-drop entry) and `manual-test-pass.md`'s §15
for the full account. **6a is done** (split 6a-i + 6a-ii) and
**6b is done**; **6c** is
split into 6c-i/ii/iii — the oversized-read fix (PR #147), **6c-i** (PR #148,
squash `c63feaf`) and **6c-ii (drag-and-drop move)** ([PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151),
squash `8e842c7`) are done and merged. The drag-into-editor snippet that was
scoped into 6c-ii is **deferred to future work** (Sean, 2026-09-10; finding
6.11). **6c-iii (`getParent` / `TreeView.reveal`) is done and merged 2026-09-10
([PR #154](https://github.com/Shai-Alit/sas-py-vscode/pull/154), squash
`507155e`) — `npm run verify` green (1480 unit; coverage 95.31 lines / 95.37
branches / 94.98 functions / 95.31 statements), 318 integration passing;
adversarial pass before the PR raised no blocking findings (two minor polish
items folded in); Codex PR review flagged the two reveal-path fetches for
lacking an abort path — each now carries its own `AbortSignal.timeout(8_000)`
and the `reveal`-failed `log.debug` is `l10n.t()`-wrapped; Claude PR review
clean, all threads resolved.**
Finding 6.12 pinned the `/folders/ancestors` wire shape (superseding finding
101). This clone also had `npm install` run to reconcile `node_modules` with
Sean's concurrent Phase 7b merge (React + ag-grid) that `main` fast-forwarded
onto.

**6d (favourites + recycle bin) is split into 6d-i / 6d-ii** (Sean, 2026-09-10),
mirroring 6c. The read-only + Sean-approved mutating probe pass for both ran
2026-09-10 — findings 6.13–6.15, `verde`-only (the `innov` token had expired
again). **6d-i (favourites) is done and merged 2026-09-11**
([PR #157](https://github.com/Shai-Alit/sas-py-vscode/pull/157), squash
`652f3a8`) — `ContentAdapter.addToFavorites` / `removeFromFavorites` (a
`reference` member `POST` / a `DELETE` of that record — finding 6.13, which also
settles Finding 80: `memberCount` is a phantom, the members listing is the only
authority), a `markFavorites` opt on `getChildItems` stamping `isInMyFavorites` +
`favoriteUri`, `.fav` / `.recycled` `contextValue` suffixes + `favoriteAction`
on the presentation, two flat commands, the `=~` migration of the content menu
`when` clauses. Adversarial pass before the PR (no blocking findings); five
review findings folded in over two rounds, all local, one push each — the
`.recycled` suffix + `favorite()` bin early-out (Codex 2 × Major); dropping the
per-account `favoritesFolder()` memo (blocking — the adapter is per-endpoint,
reused across profile switches); `typeNameOf` handling wire `type: "reference"`
so favourites browsed inside My Favorites expand/open (likely blocking); a
direct test for the bin early-out (minor). `npm run verify` green (1531 unit
after the 7c-i merge; coverage 95.44 / 95.36 / 95.10 / 95.44), 331 integration,
`npm run check:docs` green; all threads resolved. See `phase-6.md`'s 6d-i
Runbook entry for the full account.
**6d-ii (recycle bin) is done and merged 2026-09-11** —
[PR #159](https://github.com/Shai-Alit/sas-py-vscode/pull/159), squash
`c6b7a70`. Adversarial pass before the PR — no blocking findings; one known
tradeoff flagged (`emptyRecycleBin` has no per-item progress or batching),
Sean's call to ship as-is. PR review (Codex ×2 clean; Claude found one likely-
blocking issue — `inRecycleBin` wasn't propagated past the bin's direct
children, so a file nested inside a recycled folder read as an ordinary
editable item with no Restore — fixed same-branch, one push, thread resolved,
`getChildItems` now also propagates from `parent.inRecycleBin`). Recycle /
restore reuse `ContentAdapter.moveItem` (findings 6.14/6.15, re-confirmed
read-only against `verde` this session; `innov` unreachable so single-cadence
like 6.11–6.15); `emptyRecycleBin` iterates + `deleteItem`s each bin member;
the read-only `sasContentReadOnly:` view is the existing `FileSystemProvider`
registered a second time with `isReadonly: true` (no new class). **"Delete" now
recycles** an ordinary member (no confirm — Restore undoes it) and only
permanently deletes an un-recyclable one (a top-level folder, or a bin item)
behind a modal — Sean's call, upstream parity, a documented-invariant change
from 6c-i, recorded as [ADR-0030](docs/adr/0030-delete-recycles-content-items.md)
at the Phase 6→7/8 housekeeping checkpoint. `npm run verify` green (1550 unit after the review-finding fix;
coverage 95.49 / 95.44 / 95.18 / 95.49), 333 integration, `npm run check:docs`
green.

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
  two Minor doc/robustness findings, all fixed in
  [PR #145](https://github.com/Shai-Alit/sas-py-vscode/pull/145) (squash
  `0449caa`; adversarial pass before the PR, `npm run verify` green, 1348 unit
  + 281 integration passing, coverage unchanged).
- **6c — mutations (create/rename/move/delete).** Split into three sub-slices
  (Sean, 2026-09-10): **6c-i** create/rename/delete for folders and files from
  the tree context menu; **6c-ii** move + drag-and-drop (repo's first
  `TreeDragAndDropController`) + the Python-shaped drag-into-editor snippet;
  **6c-iii** `getParent`/`TreeView.reveal` + the finding-101 `ancestors` probe.
  Upload/download to local disk was never in the 6a–6d breakdown; a prior
  session's own PR #148 Runbook entry said pushing it to Phase 11 was
  "(Sean, 2026-09-10)" without that actually being confirmed with him. **Sean
  has since said (2026-09-11) he does not want it deferred that far** — it's
  an expected feature, not a long-tail item — so this is now an open scope
  question, not a settled deferral. See `phase-6.md`'s correction and
  `phase-11.md`'s retracted note.
  - The 6b-deferred oversized-file-read fix went out first, **merged**
    2026-09-10 as [PR #147](https://github.com/Shai-Alit/sas-py-vscode/pull/147)
    (squash `79e10b0`) — `content-too-large` `ContentProblem` + a typed
    `ResponseTooLargeError` from `src/auth/transport.ts`. Adversarial pass
    before the PR; Codex + Claude reviews clean.
  - **6c-i is done and merged** 2026-09-10 as
    [PR #148](https://github.com/Shai-Alit/sas-py-vscode/pull/148) (squash
    `c63feaf`). `ContentAdapter` gains `createFolder`/`createFile`/
    `renameItem`/`deleteItem` over a new JSON-body arm on `ContentClient`;
    `content-name-rejected` `ContentProblem`; delegate `contextValue`s; four
    flat commands in a new `src/content/contentCommands.ts`. Findings 6.3–6.9
    (probed against both `verde` LTS 2026.03 and `innov` Stable 2026.06):
    finding 6.9 clears Finding 79's one-cadence caveat; finding 6.7 is a real
    cadence difference (a folder rejects its own full representation on `PUT`
    on 2026.06 — 6c-i sends a minimal `{name}` body, no dialect branch).
    `npm run verify` green (1395 unit + 287 integration). Adversarial pass
    before the PR (found the `createFile` rollback-signal Major); Codex PR
    review found one further Major (a post-completion Cancel click hiding a
    landed mutation) — both fixed on the branch; Claude PR review clean; all
    threads resolved.
  - **6c-ii — drag-and-drop move.** Merged 2026-09-10 as
    [PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151) (squash
    `8e842c7`). `npm run verify` green (1417 unit + 296 integration; coverage
    95.18 lines / 95.25 branches / 94.79 functions / 95.18 statements).
    `src/content/
    contentDragAndDrop.ts` — the repo's first `TreeDragAndDropController`;
    `ContentAdapter.moveItem` (a `GET`-then-`PUT` on the member's `update`
    link, `parentFolderUri` changed — finding 6.10); `vscode`-free
    `contentMove.ts` guard (incl. a recycled-item block — a drag out of the
    Recycle Bin is a restore, 6d's); `parentFolderUri` + synthetic
    `inRecycleBin` on `ContentItem`; `canSelectMany` on the view, with
    `&& !listMultiSelection` added to the 6c-i create / rename / delete
    context-menu `when` clauses so they hide during a multi-select rather than
    acting on just the clicked item. The **drag-into-editor snippet is
    deferred** (Sean, 2026-09-10) — finding 6.11: no idiomatic Python
    equivalent of `filename … filesrvc …;`, only a fragile
    `SAS.submit(… fcopy …)` blob, and a low-priority nice-to-have.
    Adversarial pass before the PR (one Minor cast fixed; the recycled-item
    guard was that pass's one call for Sean). Codex PR review clean; the Claude
    PR review raised three findings over two rounds — a multi-item drag test
    gap, `canSelectMany` leaving the 6c-i Rename/Delete/Create context commands
    able to act on one of a multi-selection, and a comment overclaim — all
    folded in on the branch; all threads resolved.
  - **6c-iii — `getParent` / `TreeView.reveal`.** Merged 2026-09-10 —
    [PR #154](https://github.com/Shai-Alit/sas-py-vscode/pull/154), squash
    `507155e`. Adversarial pass before the PR raised no blocking findings; in review,
    Codex flagged the two reveal-path fetches for lacking an abort path — both
    are already client-timeout-bounded and neither has a `CancellationToken` to
    thread, but each now carries its own `AbortSignal.timeout(8_000)`, and the
    `reveal`-failed `log.debug` is `l10n.t()`-wrapped. `ContentAdapter.getParentOfItem`
    (`GET` the `ancestors` link — finding 6.12: object `{ childUri, ancestors:
    [<folder>…] }` under the link's own media type, immediate parent first;
    empty array / `204` ⇒ no parent; finding 101's `406`/`{}` was the wrong
    `Accept`, now superseded). `SasContentTreeProvider.getParent` (top-level ⇒
    `undefined`; a root-listing folder with no ancestors ⇒ `SAS_CONTENT_ROOT`).
    A best-effort `reveal` wired into the 6c-i create commands (re-lists +
    `sameResource`-matches the new node, since a create response's folder id and
    the listing's member id disagree) and the 6c-ii drop handler (first moved
    member, id stable). **Node identity unchanged** — the re-key-by-resource-URI
    alternative was weighed and rejected as an invariant change out of
    proportion to the gain (Sean, 2026-09-10). `npm run verify` green (1480
    unit; coverage 95.31 / 95.37 / 94.98 / 95.31), 318 integration passing.
  - **6d (favourites + recycle bin)** is split into 6d-i / 6d-ii. **6d-i
    (favourites) is code-complete 2026-09-10** — findings 6.13–6.15 from a
    read-only + Sean-approved mutating probe pass (`verde`-only); `npm run
    verify` green (1506 unit; coverage 95.38/95.29/95.07/95.38), 321 integration.
    Adversarial pass pending before the PR. **6d-ii (recycle bin) is next.**

The Phase 5→6 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed
2026-09-09 — nothing else gates Phase 6.

The Phase 6→7/8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed
2026-09-11, once 6e merged. Its only remaining open item — the
top-level-folder permanent-delete confirmation — closed as a documented,
deferred known gap rather than a live confirmation: it is blocked by a Viya
deployment-level configuration set at install time, independent of account
permissions (Sean, 2026-09-11), not by anything this codebase controls or
that a different account on the same deployment would get past. See
`phase-6.md`'s Runbook and `manual-test-pass.md`'s §15 for the full account.
Nothing else gates Phase 7 or 8.

**Phase 7 (Libraries and data viewer) is fully complete — 7a–7d all merged 2026-09-11.** `src/data/` (library/table tree, ADR-0027), the React + ag-grid-community data viewer webview with sort/filter/CSV export (ADR-0028/ADR-0029), the table properties panel, and Python↔SAS-library data exchange via `SAS.sd2df`/`df2sd`/`submit` (7d, no upstream equivalent) are all live. Findings 7.1–7.20 and every phase-specific ADR are in [`docs/phases/phase-7.md`](docs/phases/phase-7.md), which has the full slice-by-slice account. Final merge: 7d as [PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163), squash `7b32db0`. `npm run verify` green throughout (1574 unit tests; coverage 95.62%/95.54%/95.38%/95.62% lines/branches/functions/statements). **The Phase 7→8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — see the "Phase 7→8 housekeeping" section below for what it found and fixed. The full slice-by-slice narrative that used to live here has moved to [`docs/status-archive.md`](docs/status-archive.md), per this file's own archival rule.

**Phase 8 (CAS and SWAT) has started — 8a (CAS browsing) is done, 2026-09-11.**
A read-only **CAS** tree — a third view in the existing activity-bar
container, alongside SAS Content and SAS Libraries — shows a deployment's CAS
servers, their global-scope caslibs, and each caslib's tables; expanding a
table loads it on demand (Finding 8.3/8.8's JIT-load `PUT`) and shows its
columns. `src/cas/` mirrors `src/content/`'s shape, not `src/data/`'s — an
endpoint and a token, no session of any kind — since Finding 8.2/8.7
confirmed global-scope `casManagement` browsing needs neither a compute
session nor a CAS session ([ADR-0033](docs/adr/0033-cas-adapter-shape.md)).
This slice's own scope — whether the tree stops at tables (7a's own
precedent) or goes one level deeper to columns — was an open inconsistency
in `phase-8.md`'s own text, resolved this session (columns included), which
is what pulled the JIT-load probe Finding 8.3 flagged into 8a rather than a
later slice. That probe (Finding 8.8) was the one mutating call this slice
needed, approved in advance, scoped to a generic-caslib system table, and
left the deployment exactly as found. `npm run verify` green (1668 unit;
coverage 95.82/95.46/95.66/95.82 — the ratchet raised from 94/95/94/94 in
this slice), 382 integration passing, `npm run check:docs` green. See
`phase-8.md`'s Runbook and Probe findings (8.7/8.8) for the full account.
**8b (authenticated CAS session helper) is next.**

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
captured in passing, moved out of this file 2026-09-09. Phase 7's own narrative was appended 2026-09-11 at the Phase 7→8 housekeeping checkpoint. Per-phase detail
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
| 6 — SAS Content explorer | **6a–6e all done and merged — Phase 6 is fully complete.** 6a done (6a-i `src/wire/` promotion [ADR-0025](docs/adr/0025-shared-wire-layer.md), 6a-ii adapter + read-only tree [ADR-0026](docs/adr/0026-content-adapter-shape.md)); **6b done and merged 2026-09-10** ([PR #141](https://github.com/Shai-Alit/sas-py-vscode/pull/141), squash `1c13854`) — open/save via a `sasContent:` `FileSystemProvider`, findings 6.1–6.2, `npm run verify` green (1347 unit + 280 integration passing). Oversized-read fix merged (PR #147, `79e10b0`); **6c-i (create/rename/delete) done and merged 2026-09-10** ([PR #148](https://github.com/Shai-Alit/sas-py-vscode/pull/148), squash `c63feaf`), findings 6.3–6.9. **6c-ii (drag-and-drop move) done and merged 2026-09-10** ([PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151), squash `8e842c7`) — `npm run verify` green (1417 unit + 296 integration); findings 6.10/6.11; the drag-into-editor snippet is deferred (finding 6.11); `canSelectMany` + `!listMultiSelection` guard on the 6c-i context commands. **6c-iii (`getParent` / `TreeView.reveal`, finding 6.12) done and merged 2026-09-10** ([PR #154](https://github.com/Shai-Alit/sas-py-vscode/pull/154), squash `507155e`) — adversarial pass raised no blocking findings; Codex PR review's abort-path finding folded in (`AbortSignal.timeout(8_000)` on the two reveal fetches); `npm run verify` green (1480 unit; coverage 95.31/95.37/94.98/95.31), 318 integration. **6d split into 6d-i / 6d-ii (Sean, 2026-09-10); 6d-i (favourites) done and merged 2026-09-11** ([PR #157](https://github.com/Shai-Alit/sas-py-vscode/pull/157), squash `652f3a8`) — findings 6.13–6.15 (`verde`-only probe pass); `addToFavorites`/`removeFromFavorites`, a `markFavorites` opt on `getChildItems`, `.fav` / `.recycled` `contextValue` suffixes, two commands; `npm run verify` green (1531 unit after the 7c-i merge; coverage 95.44/95.36/95.10/95.44), 331 integration. Adversarial pass before the PR; five review findings folded in over two rounds (one push each): the `.recycled` suffix + `favorite()` bin early-out (Codex 2×Major — bin child stayed favouritable); dropping the per-account `favoritesFolder()` memo (blocking — the adapter is per-endpoint, reused across profile switches); `typeNameOf` handling wire `type: "reference"` so favourites browsed inside My Favorites expand/open (likely blocking); a direct test for the bin early-out (minor). **6d-ii (recycle bin) done and merged 2026-09-11** — [PR #159](https://github.com/Shai-Alit/sas-py-vscode/pull/159), squash `c6b7a70` — `recycleItem`/`restoreItem`/`emptyRecycleBin` reuse `moveItem`/`deleteItem` (findings 6.14/6.15, verde re-confirmed, innov unreachable → single-cadence); `sasContentReadOnly:` = the FS provider registered again `isReadonly`; "Delete" now recycles an ordinary member and only permanently deletes an un-recyclable one behind a modal (upstream parity, invariant change from 6c-i, Sean's call, recorded as [ADR-0030](docs/adr/0030-delete-recycles-content-items.md) at the Phase 6→7/8 housekeeping checkpoint). Adversarial pass before the PR — no blocking findings; `emptyRecycleBin`'s no-progress/no-batching shape flagged and accepted as-is. PR review found one likely-blocking issue (`inRecycleBin` not propagated past the bin's direct children — fixed, thread resolved). `npm run verify` green (1550 unit; coverage 95.49/95.44/95.18/95.49), 333 integration, `check:docs` green. **6e (folder `resourceUri` fix attempt + right-click Cut/Paste) code-complete 2026-09-11**, found while live-testing 6c-ii's drag-and-drop at the Phase 6→7/8 housekeeping checkpoint — a real investigation landed on a plausible root cause for drag-and-drop, a missing `TreeItem.resourceUri` on folder items ([ADR-0031](docs/adr/0031-content-folder-resource-uri.md)), and `pythonOnViya.cutContentItem`/`pasteContentItem` shipped as a permanent, unambiguous move alternative regardless ([ADR-0032](docs/adr/0032-content-cut-paste.md)) — see `phase-6.md`'s 6e Runbook entry. Adversarial pass before any push found and this branch fixed one real blocking issue (the cut slot had no endpoint scoping and no clear on profile switch/sign-out — a cross-deployment paste could run the wrong adapter against a stale item link) and one real test-coverage gap (a new `cutPaste.test.ts`, +11, covering the happy path and every paste-reachable rejection reason), plus two related medium races (clear-before-move fixes both a double-paste race and a succeeded-then-cancelled race) and several minor findings, all folded in locally in one pass. `npm run verify` green (1580 unit; coverage 95.57/95.51/95.26/95.57), 368 integration, `check:docs`/`check:secrets` green. **[PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162) opened 2026-09-11.** **Live-retested 2026-09-11 (Sean): Cut/Paste confirmed working under its final command names; drag-and-drop itself remains completely non-functional, identical symptoms to before the fix attempt** — the `resourceUri` hypothesis is disproven as the cause (ADR-0031's own amendment), tracked as a deprioritised follow-up in `phase-11.md` rather than blocking this PR (Sean's call). **Root cause found and fixed the same day, in a separate follow-up after this PR merged** ([PR #164](https://github.com/Shai-Alit/sas-py-vscode/pull/164) opened 2026-09-11): a VS Code 1.109 bug JSON-marshals `handleDrop`'s `CancellationToken` argument (a non-final RPC argument `rpcProtocol.ts`'s trailing-token convention never catches), stripping its `onCancellationRequested` method, so `contentDragAndDrop.ts` threw before any move ran on every real attempt — invisible in this extension's own output channel since the throw landed in DevTools instead. Finding 6.16 (`phase-6.md`); fixed by dropping the outer-token subscription (only `progressToken`, which never crosses RPC, is subscribed to); adversarial pass before push raised no blocking findings; **live-confirmed 2026-09-11 (Sean)** — a real drag-and-drop move now works, plus every other `manual-test-pass.md` §15 row that had been blocked on the base gesture; `phase-11.md`'s tracked follow-up is now closed. **Two further automated-review rounds on the open PR each found and fixed one real race in `paste()`'s failure-restore**, both same-branch, one push each, both threads resolved: a `cut()` of a different item racing a failing move could get silently overwritten by the stale restore (fixed, commit `716ae27`); the fix's own `cutState === undefined` check couldn't tell that apart from an intentional `clearCutContentItem()` (profile switch/sign-out) firing mid-flight, so a late failure could resurrect a cut the intentional clear had just removed (fixed with a `cutGeneration` token, commit `1563bd3`). `npm run verify` green after each fix; `npm run test:integration` green (370 passing, all 13 Cut/Paste cases) after the second. **Merged 2026-09-11 as squash `a74f756`. Phase 6 is fully complete — all of 6a–6e merged.** The Phase 6→7/8 between-phase housekeeping (`HOUSEKEEPING.md`), which 6e was the last thing holding open, is **now closed**: the one remaining item from the checkpoint's own testing inventory — the top-level-folder permanent-delete confirmation — is resolved as a documented, deferred known gap. The checkpoint's own earlier "that reason was wrong" correction (reasoning from Sean's own admin access) was itself mistaken and is retracted; Sean has since clarified the real mechanism is a Viya deployment-level configuration, set at install time, restricting top-level-folder deletion for most users regardless of account permissions — not retestable on this deployment, needs one configured to allow it. See `phase-6.md`'s Runbook and `manual-test-pass.md`'s §15. | `docs/phases/phase-6.md` |
| 7 — Libraries and data viewer | ✅ **done — 7a–7d all merged 2026-09-11** (library/table tree, React+ag-grid data viewer with sort/filter/CSV export, table properties panel, Python↔library data exchange via `SAS.sd2df`/`df2sd`/`submit`). Final PR [#163](https://github.com/Shai-Alit/sas-py-vscode/pull/163), squash `7b32db0`. `npm run verify` green (1574 unit; coverage 95.62/95.54/95.38/95.62). Phase 7→8 housekeeping ran and closed 2026-09-11 (see above). | `docs/phases/phase-7.md` |
| 8 — CAS and SWAT | **8a (CAS browsing) done 2026-09-11** — a read-only CAS tree (servers/caslibs/tables/columns), no session of any kind needed ([ADR-0033](docs/adr/0033-cas-adapter-shape.md)); `npm run verify` green (1668 unit; coverage 95.82/95.46/95.66/95.82), 382 integration. 8b next. | `docs/phases/phase-8.md` |
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
