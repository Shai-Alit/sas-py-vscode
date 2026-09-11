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

**Phase 7 (Libraries and data viewer) is in progress, worked from the
separate `sas-py-vscode-cowork` clone — open
[`docs/phases/phase-7.md`](docs/phases/phase-7.md).** Scoped 2026-09-03
(7a–7c); **7a is done and merged** ([PR #142](https://github.com/Shai-Alit/sas-py-vscode/pull/142));
**7b (data viewer webview) is done and merged 2026-09-10** ([PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150),
squash `60a944e`) — adversarially reviewed twice — no blocking findings
either time — and Sean's own manual visual check of a real panel ran
2026-09-10, twice: once before this round's fixes, once after.
Of the three findings the first check surfaced: column alignment is fixed
and confirmed by Sean's own re-test (Finding 7.14, live-probed against
`verde`); the busy-session blank-grid panel got a real, defensible fix
(`buildHtml` was missing a `background-color` rule, kept) but Sean's re-test
against a confirmed-fresh build surfaced a second, deliberately deferred gap
instead — neither the SAS Libraries tree nor an open data-viewer panel
recovers on its own once a busy run finishes; the tree needs a manual
refresh (already an accepted 7a limitation, now confirmed to extend to the
panel too, per 7a's own Runbook hedge), and the panel has no equivalent
affordance at all. **Deliberately left open at Sean's own direction — not
blocking this slice, and not addressed by anything in 7c's current punch
list**, so it is flagged for its own future slice rather than assumed away;
the grid's light-only theme remains a separate open design decision for
Sean, not a defect. One minor gap from the second review (no test asserts
panel-dispose aborts its `AbortController`) has been folded in and verified.
Preparing this PR's own body also surfaced a real, pre-existing gap: the
data viewer panel's failure messages went out as `describeDataProblem`'s
unlocalised log fragment, unlike every other panel in this project. Fixed
with a new `src/data/messages.ts` (`localiseDataProblem`), matching
`resultPanel.ts`/`contentFileSystem.ts`'s own established pattern exactly,
with its own integration coverage. See `phase-7.md`'s 7b Runbook entry for
the full account. **Sean has
confirmed the deferred busy-recovery gap and the light-theme decision are
acceptable to ship as documented follow-ups rather than blockers.**
**[PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150) opened
2026-09-10, merged 2026-09-10 (squash `60a944e`)** (the l10n fix's own commit
skipped the standing pre-push manual adversarial pass, Sean's own call, to
rely on those two instead). **github-advanced-security (CodeQL) then flagged
a real `js/missing-origin-check` finding**: `dataViewerEntry.tsx`'s message
listener trusted `event.data` with no check on who posted it (the
CVE-2021-43908 class of gap). Fixed in two attempts — the first, following a
Microsoft community thread's `https:`-prefix suggestion, was itself broken
(Codex's review caught that a bare `https:` prefix matches almost any HTTPS
origin) and was tightened to the two concrete origins VS Code actually
issues (`vscode-webview://…` desktop, `https://….vscode-webview.net` web).
`tsc`/`prettier` clean; **a third manual check (open a real table) then
confirmed it, 2026-09-10** — Sean's own console export showed no
`postMessage`/`origin` error, and the grid rendered column headers and rows
for a real table. Closed, until GitHub's Copilot Autofix suggestion for the
same CodeQL alert was applied directly to the branch as its own commit
(`03e6caec`), rewriting the check to a `new URL(event.origin)` version
without going through local review or re-verification. **Fourth manual pass,
2026-09-10: confirmed against that exact commit** — same result, no
`postMessage`/`origin` error, grid rendered. See `phase-7.md`'s 7b Runbook
entry for the full account, including the unrelated benign VS Code-internal
console warnings (`local-network-access`, iframe sandbox) a later log from
the same check surfaced. That same console export also surfaced a new,
unrelated, real gap: the panel's CSP has no `font-src`, so ag-grid's own
bundled icon font (an `@font-face` inside `ag-theme-alpine.css`) is
blocked — currently invisible (7b ships `sortable: false` and no filter, so
nothing draws an icon from it yet) but will show as broken/missing icons
the moment 7c turns sort or filter on. First deferred to 7c as its own
punch-list item; **superseded same day** — a second adversarial review
(prompted with that deferral) agreed it was reasonable but flagged the fix
as cheap and already confirmed, so **Sean's final call was to fix it now**
rather than carry it forward: `font-src {cspSource} data:;` added to
`buildHtml`'s CSP, with a matching new test assertion. Nothing left on 7c's
punch list for this. That same review found no blocking issues across the
full 7b diff (11 files); two low, non-blocking findings — a `null`
message-listener gap (practically unreachable, file untested by any tier
either way) and a stale `NUM` doc-comment example Finding 7.14 should have
swept — **both fixed too, Sean's call to fold them in alongside the CSP
fix**. A fourth manual pass confirmed the origin check again after GitHub's
Copilot Autofix rewrote it to a `new URL(event.origin)` version
post-merge-of-the-manual-pass (`03e6caec`); a real profile-scoping bug in
`DataViewerPanelManager`'s panel key (caught by review, same shape as 6b's
`sasContent:` ETag-guard fix) was found and fixed with a regression test;
and the branch was reconciled against `main` after phase 6's 6c-ii merged
in the meantime. **PR #150 merged 2026-09-10 as squash `60a944e`.** Full
account in `phase-7.md`'s 7b Runbook entry.

- **7a — `LibraryAdapter` + read-only tree.** Done. `src/data/`, the
  `pythonOnViya.dataExplorer` tree, `ComputeSessionManager`'s new
  `onDidChangeConnection` — see this file's Phase index row for the full
  verify numbers.
- **7b — Data viewer webview.** Decided 2026-09-10, with Sean: React +
  `ag-grid-community`, not a hand-rolled grid — [ADR-0028](docs/adr/0028-data-viewer-is-react-and-ag-grid.md)
  records the reasoning, the re-derived CSP threat model 7b's own code must
  write, the testing-boundary call (browser-only exclusion, no `jsdom`), and
  the dependency-classification decision (`devDependencies`, preserving
  [ADR-0005](docs/adr/0005-supply-chain-policy.md)'s zero-runtime-dependency
  invariant — see that ADR's own 2026-09-10 amendment). Finding 7.10
  (`phase-7.md`) settles a real implementation question in 7b's favour: the
  rows collection's `count` is populated even at a small `limit`, so no
  "assume last page" heuristic is needed (a same-day re-probe corrected that
  finding's own `itemCount` detail; unused by any code, see `phase-7.md`).
  Finding 7.13 confirms the rows collection's own `next`/`last`/`self` links
  are properly typed, unlike the tables collection's (Finding 7.9). **Code
  complete 2026-09-10**: `LibraryAdapter.openTable`/`getColumns`/`getRows`
  (unit-tested), `DataViewerPanelManager`/`OpenTablePanel`
  (integration-tested against a fake panel and the real adapter), the
  `pythonOnViya.openTable` command, and the React/ag-grid webview bootstrap
  (`src/webview/dataViewerEntry.tsx`) — see `phase-7.md`'s 7b punch list for
  the full file-by-file account. **Adversarially reviewed 2026-09-10,
  before any push** (per `CLAUDE.md`'s standing rule): three real findings
  folded in — no unit test for `dataViewerModel.ts` (added), a `requestId`
  collision across a webview reload that could resolve the wrong row window
  (fixed with `crypto.randomUUID()`), and no `AbortSignal` on any of the
  panel's three adapter calls (fixed with a per-panel `AbortController`).
  Sean's own `npm install` + `npx tsc -p tsconfig.webview.json --noEmit`
  then came back clean — the one thing nothing in the sandbox this was
  written in could check — after two small fixes the install itself
  surfaced (an ambient `*.css` module shim; an `exactOptionalPropertyTypes`
  conflict on an intentionally-omitted `rowCount`). Sean's own
  `npm run verify` and `npm run test:integration` then surfaced two more
  real gaps the review pass predates: a test-ordering bug in three
  `DataViewerPanelManager` integration tests (`sendReady()` called before
  `open()` had registered the fake panel's listener), and a branch-coverage
  shortfall traced to under-tested `src/data/types.ts` parser functions.
  Both fixed and re-verified — `phase-7.md`'s 7b punch list has the full
  account — and Sean's re-run of both commands is green. **Sean's own
  manual visual check of a real panel then ran twice, 2026-09-10.** First
  pass (`manual-test-pass.md` §10/§11) found three real findings: numeric
  columns not right-aligning, a busy-session table-open showing a blank
  panel with no message, and the grid always rendering in ag-grid's
  light-only theme. A live probe against `verde` (Finding 7.14) settled the
  first — real numeric columns report `type: "FLOAT"`, never `"NUM"` — and
  `toColumnDefs` was fixed to match, along with a stale fixture and two
  tests that had baked in the same unprobed `"NUM"` value. A
  `background-color` rule was added to the panel's `<style>` block for the
  second. **Second pass**, against a confirmed-fresh installed build,
  confirmed the alignment fix and surfaced a different, more specific
  finding in its place: neither the SAS Libraries tree nor an open
  data-viewer panel recovers on its own once a busy session frees up — the
  tree needs a manual refresh (already an accepted 7a limitation; this
  confirms it extends to the panel too), and the panel has no equivalent
  affordance at all. A second adversarial review (against `origin/main`,
  covering the original 7b commit plus the Finding 7.14 fixes) found no
  blocking findings; its one real minor observation — no test asserted that
  disposing a panel aborts its in-flight `AbortController` — is now folded
  in and verified. **Left open, at Sean's own direction, not blocking**: the
  busy-recovery gap (not covered by 7c's planned scope, needs its own future
  slice) and the light-only-theme decision (ADR-0028 didn't address it).
  `phase-7.md`'s 7b punch list and Probe findings section have the full
  account. **Merged 2026-09-10** as [PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150)
  (squash `60a944e`), after a profile-scoping panel-key fix and a
  reconciliation against `main` (6c-ii had merged while this PR was open) —
  see `phase-7.md`'s 7b Runbook for the full account.
- **Three small PR #150 follow-up findings closed 2026-09-10**, from the
  `sas-py-vscode-cowork` clone, ahead of 7c proper: `pythonOnViya.openTable`
  hidden from the global Command Palette (a `commandPalette` `"when": "false"`
  entry, matching the four content commands); the dead `data-title` attribute
  (and its now-unused `escapeHtmlAttribute` helper and `buildHtml`
  parameter) removed from the data viewer's HTML shell; and a JSX test case
  added for `check-coverage-scope.mjs`'s `scriptKindFor`, feeding
  `importsHostModule` a real, ag-grid-shaped `.tsx` element. See
  `phase-7.md`'s 7c punch list for the full account, including why the JSX
  test's own investigation found this particular check doesn't actually
  depend on `scriptKindFor` for any well-formed input. `npm run test:unit`
  (1443 passing), `test:integration` (305 passing), and `npm run coverage`
  (95.29/95.37/94.95/95.29, all thresholds met) all green; `build`/lint/
  typecheck/copyright/secrets/contracts all clean.
- **7c — Sort, filter, CSV export, table properties.** Split into three
  sub-slices 2026-09-10, mirroring 6c's own split: **7c-i** sort + filter
  (share one request payload/probe — the `createView`/`where=` mechanism,
  and fixing upstream's un-cleaned-up orphan-view bug rather than porting
  it); **7c-ii** table properties/columns static viewer; **7c-iii** CSV
  export to local disk (standalone — Phase 6 deferred its own
  upload/download to Phase 11 entirely, so there's no helper to share).
  **7c-i (sort + filter) is code-complete 2026-09-10** (`sas-py-vscode-cowork`
  clone) — live-probed first (Findings 7.15–7.18: `createView`'s real
  request/response shape and its own `delete`/`rowsAsCSV` links; `where=` is
  silently ignored on a created view's own rows read, so a filter must be
  baked into the same `createView` body as `sortBy`; `count` disappears the
  instant a filter or view is involved, not just sometimes null); design
  recorded in [ADR-0029](docs/adr/0029-sort-view-lifecycle.md) (one view
  reused per (sort, filter) state across pagination, not recreated per page
  the way upstream's own un-cleaned-up `getSortedRows` does; guaranteed
  cleanup on every state change and on dispose; a serialised
  `ensureReadTarget` closing a real concurrent-view-creation race). A shared
  fix also landed in `src/wire/viyaError.ts` (a nested `errors[0].details`
  fallback, Finding 7.18). A pre-existing 7a/7b fixture
  (`table-detail-class.json`) had guessed its `createView`/`rowsAsCSV` link
  hrefs wrong (neither had a caller before now); corrected against Finding
  7.15's real shape. **Reviewed twice before push**: an independent-agent
  pass (no blocking findings, two low-priority notes addressed — see
  `phase-7.md`), then Sean's own review of the same diff, per this
  project's actual standing requirement. Sean's pass found three further
  real, low-priority issues, all fixed: the new filter box had no
  theme-aware styling (fixed with the standard `--vscode-input-*`
  variables); a `getRows` call following a resolved `ensureReadTarget` was
  not itself serialised against a *later* request's own sort/filter change,
  so a fast state change could leave an earlier read answering against an
  already-discarded view (fixed — `handleRequestRows` now drops a reply
  once the panel's state has moved past it; a new integration test
  reproduces the race directly); and `ensureReadTarget` returned an
  un-`catch`'d promise (latent hardening, now fixed). Full account in
  `phase-7.md`'s 7c-i Runbook entry. `npm run verify`/`test:integration`
  re-run green after all three fixes (1468 unit, 310 integration passing,
  thresholds unchanged); `check:docs`/`l10n:extract`/`build` all clean.
  **[PR #155](https://github.com/Shai-Alit/sas-py-vscode/pull/155) opened
  2026-09-10.** `docs/dev/manual-test-pass.md` gained an unrun §12 for
  Sean's own visual check of the new filter bar and sort-icon rendering.
  **That check ran 2026-09-10 and found three real bugs, all fixed on the
  same branch before merge**: a sort or filter was silently lost switching
  away from the table's tab and back (`retainContextWhenHidden: false`
  reloads the webview document on hide/show, and the freshly mounted grid
  had no memory of the previous document's sort/filter — its own first
  request read as "cleared", which this panel's state machine took as an
  instruction to discard the still-wanted server-side view); and an invalid
  filter showed a blank grid with no error, warning, or log line anywhere
  (the host already computed a real, specific message — Finding 7.18 — but
  `dataViewerEntry.tsx`'s own datasource was discarding it). Fixed:
  `InitMessage` gained `initialSort`/`initialFilter`, replayed as the panel's
  *current* state (not the state frozen when the table first opened) on
  every `"ready"`; the webview restores the filter box's text and seeds
  ag-grid's initial sort from them; a `rowsError` reply now renders as a
  banner instead of being silently dropped; and `dataViewerPanel.ts` now logs
  a warning on both row-fetch failure paths, which it did not before either.
  `npm run verify` green (1468 unit, coverage unchanged); `test:integration`
  green (313 passing, three new). Full account in `phase-7.md`'s 7c-i Runbook
  entry. **Also found, separately**: both AI PR reviewers showed "pass" on
  PR #155 with no review ever actually posted — a `cancel-in-progress`
  concurrency gap in `ai-review.yml`/`claude-review.yml` let a fast-follow
  `[skip-review]` docs commit cancel the review runs against the real source
  commits, then legitimately skip itself. Not a runner fluke.
  **Fixed and merged** as [PR #156](https://github.com/Shai-Alit/sas-py-vscode/pull/156)
  (squash) — both `ai_review.py` and the Claude Review guard step now also
  require the commit immediately before a `synchronize` push to be
  skip-tagged before honouring the head's own flag. `phase-7c-i-sort-filter`
  was reconciled with `main` a second time to pick it up, and both automated
  reviewers then ran against this branch's real diff for the first time.
  **Each found one real issue, both verified and fixed before any further
  push**: a stale `requestRows` reply was silently dropped rather than
  answered (a real, if narrow, leak — `dataViewerEntry.tsx`'s own
  `pendingRowRequests` entry, and the promise it resolves, was left pending
  forever), and no test exercised `onDidDispose`'s own stale-view-delete
  cleanup on either its success or failure-logged path. `npm run verify`/
  `test:integration` re-run green (321 passing — the jump from 313 includes
  6c-iii's own tests from the `main` reconciliation, plus 2 new dispose
  tests this round added). Full account in `phase-7.md`'s 7c-i Runbook
  entry.
- **7c-ii (table properties/columns static viewer) is code-complete
  2026-09-11** (`sas-py-vscode-cowork` clone) — live-probed first (Finding
  7.19: the full `TableInfo` field set, and confirmation that
  `creationTimeStamp`/`modifiedTimeStamp` are ISO-8601 strings, not a raw SAS
  epoch number, settling the one open question this slice's own punch list
  raised). `TableDetail`/`readTableDetail` (`src/data/types.ts`) gained the
  rest of `TableInfo`'s field set; a new `src/data/tablePropertiesModel.ts`
  (`vscode`-free, unit-tested) and `src/data/tablePropertiesPanel.ts`
  (`.c8rc.json`-excluded, integration-tested) render a static properties/
  columns panel opened via a new `pythonOnViya.showTableProperties` context
  command. **Deliberately not a straight port of upstream's own client-side
  tab-toggle script** — this panel needs no `<script>` at all: the two tabs
  are CSS-only (radio-button `:checked` sibling selectors), so
  `enableScripts` is `false`, the only one of this project's three webview
  panels that needs no script execution. `npm run verify` green (1519 unit
  passing; coverage 95.48/95.43/95.15/95.48, every threshold met);
  `npm run test:integration` green (333 passing, 9 new);
  `npm run check:docs` green. **Adversarial pass done before the PR
  2026-09-11 — no blocking findings.** Four low-priority notes, one folded
  in: `formatTimestamp`'s own epoch-fallback unit test re-derived the
  function's `315619200` constant instead of asserting an
  independently-computed expected value; fixed. Two accepted as-is (a bare
  numeric string parsing as a year rather than reaching the epoch fallback —
  parity with upstream, not reachable with real ISO-8601 data; the `disposed`
  boolean vs. `AbortSignal.aborted` style note). One noted as a real but
  pre-existing, cross-panel gap and initially deferred (a stuck "Loading…"
  panel if `openTable`/`getColumns` *rejects* rather than resolving
  `{ok:false}`, shared with `DataViewerPanelManager`'s own identical
  `loadTable`) — **a second Codex review round on the open PR then flagged
  this same gap as its own in-scope finding** (a fair distinction: introducing
  new code that reproduces a known-bad pattern is different from also being
  asked to patch a different file's pre-existing instance), so it was fixed
  after all, scoped to `tablePropertiesPanel.ts` alone — see below.
  **[PR #158](https://github.com/Shai-Alit/sas-py-vscode/pull/158) opened
  2026-09-11.** Both automated PR reviewers ran against the real diff; the
  Claude reviewer found nothing new. **Codex found two real issues, both
  fixed on the branch**: (blocking) `panelHead`'s CSP allowed `style-src
  'unsafe-inline'`, reasoned as safe only because every dynamic value is
  `escapeHtml`-escaped — correctly pushed back on as weaker than not needing
  the exception at all; unlike `dataViewerPanel.ts` (which genuinely needs
  `'unsafe-inline'` for `ag-grid`'s own runtime-set `style="…"` *attributes*,
  which a nonce cannot cover), this panel has exactly one `<style>` *element*
  and no inline `style="…"` attributes anywhere, so a nonce (the same
  mechanism `resultPanel.ts`/`dataViewerPanel.ts` already use for their own
  `<script>` tag) removes the exception entirely; (major) the new
  `showTableProperties` log line was hard-coded English — fixed, and its
  identical `openTable` neighbor (copied from 7b, same defect, not flagged
  since it predates this diff) fixed alongside it rather than left
  inconsistent. **A CI failure surfaced separately**: `test (windows-latest,
  node 24)` timed out at the unit tier's 2s budget on `formatTimestamp`'s own
  test — this project's first-ever call to `Date.prototype.toLocaleString()`,
  and Intl/ICU's first-use cost apparently exceeded 2s on that one
  runner/Node combination. Fixed the same way `eslint-ignores.test.ts`/
  `contracts.test.ts`/`coverage-scope.test.ts` already do for their own
  "loading a tool" cost: a suite-level `this.timeout(30_000)`. `npm run
  verify` re-run green after all three fixes (1519 unit passing, coverage
  unchanged); `npm run test:integration` green (334 passing — a new CSP
  nonce test). **A second Codex review round, against that fix commit,
  raised one further Major**: the "stuck on Loading… forever" gap this
  file's own pre-PR write-up had accepted as pre-existing and deferred.
  Fixed, scoped to this slice's own file only: `start()` now wraps its two
  adapter calls in a `try`/`catch`, rendering a failure (the same
  `compute-unreachable` shape `dataViewerPanel.ts`'s own `ensureReadTarget`
  already produces for an unexpected throw) and then rethrowing, so the
  command handler's own log line still fires. `dataViewerPanel.ts`'s
  identical instance is deliberately left untouched — a different file from
  an earlier phase, not this PR's own diff; closing it, if wanted, is its own
  small follow-up. A new integration test drives a raw `ComputeClient` whose
  `send` rejects and asserts both the rendered failure text and that
  `manager.open(...)` itself still rejects. `npm run verify` green again
  (1519 unit, coverage unchanged); `npm run test:integration` green (335
  passing). Full account in `phase-7.md`'s 7c-ii Runbook entry.
- **7c-iii (CSV export to local disk) is done and merged 2026-09-11**
  (`sas-py-vscode-cowork` clone) —
  [PR #161](https://github.com/Shai-Alit/sas-py-vscode/pull/161), squash
  `dac4f7f`. Live-probed
  first (Finding 7.20): the real `rowsAsCSV` mechanism is `Accept`-header
  content negotiation on the identical `rows` href, not upstream's own
  hand-composed `.../rows#CSV` suffix (which never actually reaches a CSV
  response on a real deployment — upstream silently re-serializes JSON rows
  instead); pagination/`where=`/quoting all already correct, and pages
  concatenate with no separator needed. `LibraryAdapter.getRowsAsCsv`, a new
  `vscode`-free `src/data/csvExportModel.ts` (deliberately unbounded
  pagination — its own `start` is self-derived, never a server link, so it
  cannot cycle the way a `next`-link loop could), and a new
  `src/data/csvExportCommand.ts` wiring `pythonOnViya.exportTableToCsv`: a
  save dialog, a cancellable progress notification, a streaming write to a
  temporary file renamed onto the destination only on full success (so a
  cancelled/failed export never touches, or truncates, a destination the
  user already had), and a pre-flight `ensureDiskSpace` check refusing to
  start if the destination volume looks too small for the estimated size.
  **A genuine architecture decision, confirmed with Sean before writing the
  code**: `csvExportCommand.ts` is a new, fifth entry on
  [ADR-0003](docs/adr/0003-extension-host-target.md)'s Node-built-ins
  allow-list (`node:fs`, `node:path`, `node:crypto`) — `vscode.workspace.fs`'s
  whole-buffer-only `writeFile` can't stream a potentially large export
  without holding the whole table in memory first, defeating the reason this
  feature streams at all; see that ADR's 2026-09-11 amendment.
  **Adversarially reviewed twice before the PR, per `CLAUDE.md`'s standing
  rule**: an independent-agent pass found three real findings, most
  notably that an existing file at the chosen destination could be
  truncated then deleted on a failed export — fixed with an atomic
  write-to-temp-then-rename redesign, which also closed a synchronous-throw
  gap and a missing stream-error test. Sean's own review then found no
  blocking issues; two of its three minor notes were folded in (a missing
  mid-write failure test; deferring temp-file creation until after
  `openTable`/the disk-space check pass, so an early failure touches the
  filesystem not at all). `npm run verify` green (1551 unit passing;
  coverage 95.56%/95.51%/95.25%/95.56%, every threshold met);
  `npm run test:integration` green (346 passing, 7 new); `check:docs`/
  `l10n:extract`/`build`/`check:copyright`/`check:secrets`/
  `check:coverage-scope`/`check:contracts` all clean. Full account in
  `phase-7.md`'s 7c-iii Runbook entry. **7c (sort/filter, table properties,
  CSV export) is now fully done — all three sub-slices merged.**
- **7d — Python↔library data exchange (`SAS.sd2df`/`df2sd`/`submit`).**
  Scoped 2026-09-04 from a separate session; that session's doc edits were
  stashed rather than committed and sat unmerged until found and resurrected
  2026-09-10. Live-probed this session (Findings 7.11/7.12): all three
  bridge methods work end to end, and the credential-echo risk the stash
  had only guessed at (by analogy to Phase 8's Finding 92) turned out to be
  more nuanced than feared — `SAS.submit()`'s own log echo applies SAS's
  standard `PASSWORD=` masking; Finding 92's own mechanism (the outer
  job-source echo) is untouched and still the real risk for a credential
  written as a literal. **Code-complete 2026-09-11** (`sas-py-vscode-cowork`
  clone): a new `docs/data-access.md`
  ("Python and SAS libraries", registered in the VitePress sidebar and
  `docs/README.md`'s index — neither 7a/7b/7c ever shipped a user-facing doc
  page of its own to fold this into); the drag-and-drop snippet
  (`src/data/dragSnippet.ts`, `vscode`-free/unit-tested, and
  `src/data/dataDragAndDrop.ts`, the one class playing both the
  `TreeDragAndDropController` and `DocumentDropEditProvider` roles this
  needs, registered for `{ language: "python" }`) — a drop always asks, via a
  quick pick, whether to insert a plain `SAS.sd2df(...)` read or a
  `SAS.submit`-based `PROC SQL` pass-through (Sean's call), with the assigned
  variable name derived from the table's own name and deduplicated against
  the drop target document's own text (Sean's call); and
  `test/fixtures/data/submit-log-echo.txt`, a verbatim transcription of
  Finding 7.12's own already-sanitized log excerpt (not a captured wire JSON
  envelope — this mechanism has no wire call), pinned by a new unit test.
  **Adversarial pass (independent agent) ran before any push, per
  `CLAUDE.md`'s standing rule** — one real, blocking finding: the SQL
  pass-through's own `select * from libref.table` line had no protection
  against a `;` in the table name, letting the rest run as independent SAS
  statements the moment the inserted snippet is run unmodified. **Fixed**:
  `dragSnippet.ts`'s new `sasNameRef` wraps a name outside the ordinary
  bare-identifier shape in a SAS name literal (`'…'n`) before either escaping
  layer runs, applied only to the SQL pass-through's own generated SAS
  source (not `sd2df`'s runtime string argument). Two related Medium
  findings also fixed: the drop's own `CancellationToken` never reached the
  quick pick (now threaded through), and an already-cancelled drop still
  showed the picker before discarding the answer (now checked first, via a
  `cancelled()` closure matching `contentDragAndDrop.ts`'s own idiom, to
  dodge a TypeScript narrowing false-positive across the intervening
  `await`). `npm run verify` green (1567 unit passing; coverage
  95.6%/95.5%/95.35%/95.6%, every threshold met); `npm run test:integration`
  green (355 passing, 9 new); `check:docs` (all four steps) green.
  **[PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163) opened
  2026-09-11**, after which Sean's own live test found the drop silently
  inserting nothing — a tree→editor drop crosses the extension-host RPC
  boundary and VS Code serializes the payload, so
  `provideDocumentDropEdits` got the `JSON.stringify`'d text rather than the
  `TableItem[]` `handleDrag` set, and the slice had cast it instead of
  parsing it; the resulting `TypeError` was swallowed by VS Code and visible
  only in the DevTools console. **Fixed** with a validated, `vscode`-free
  `readDraggedTables` in `src/data/types.ts` (+6 unit tests) rather than an
  inline parse in the coverage-excluded `dataDragAndDrop.ts`, and
  **re-tested live by Sean the same day: drag, both snippet choices and the
  inserted code all work** (`manual-test-pass.md` §17's first six rows now
  pass). Diagnosing it also found a **separate root cause for Phase 6's own
  drag-and-drop failure** — `handleDrop`'s `CancellationToken` does not
  survive the RPC hop, so `contentDragAndDrop.ts:203` throws before doing any
  work — recorded in `phase-6.md` and handed to that phase's agent, not fixed
  here. Reconciled with `main` (merge `30771e8`, picking up 6e/PR #162);
  `npm run verify` re-run green (1574 unit; coverage
  95.62/95.54/95.38/95.62), `npm run test:integration` green (372 passing).
  Sean's own review pending before merge. Full account in `phase-7.md`'s 7d
  Runbook entry.

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
| 6 — SAS Content explorer | **6a–6e all done and merged — Phase 6 is fully complete.** 6a done (6a-i `src/wire/` promotion [ADR-0025](docs/adr/0025-shared-wire-layer.md), 6a-ii adapter + read-only tree [ADR-0026](docs/adr/0026-content-adapter-shape.md)); **6b done and merged 2026-09-10** ([PR #141](https://github.com/Shai-Alit/sas-py-vscode/pull/141), squash `1c13854`) — open/save via a `sasContent:` `FileSystemProvider`, findings 6.1–6.2, `npm run verify` green (1347 unit + 280 integration passing). Oversized-read fix merged (PR #147, `79e10b0`); **6c-i (create/rename/delete) done and merged 2026-09-10** ([PR #148](https://github.com/Shai-Alit/sas-py-vscode/pull/148), squash `c63feaf`), findings 6.3–6.9. **6c-ii (drag-and-drop move) done and merged 2026-09-10** ([PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151), squash `8e842c7`) — `npm run verify` green (1417 unit + 296 integration); findings 6.10/6.11; the drag-into-editor snippet is deferred (finding 6.11); `canSelectMany` + `!listMultiSelection` guard on the 6c-i context commands. **6c-iii (`getParent` / `TreeView.reveal`, finding 6.12) done and merged 2026-09-10** ([PR #154](https://github.com/Shai-Alit/sas-py-vscode/pull/154), squash `507155e`) — adversarial pass raised no blocking findings; Codex PR review's abort-path finding folded in (`AbortSignal.timeout(8_000)` on the two reveal fetches); `npm run verify` green (1480 unit; coverage 95.31/95.37/94.98/95.31), 318 integration. **6d split into 6d-i / 6d-ii (Sean, 2026-09-10); 6d-i (favourites) done and merged 2026-09-11** ([PR #157](https://github.com/Shai-Alit/sas-py-vscode/pull/157), squash `652f3a8`) — findings 6.13–6.15 (`verde`-only probe pass); `addToFavorites`/`removeFromFavorites`, a `markFavorites` opt on `getChildItems`, `.fav` / `.recycled` `contextValue` suffixes, two commands; `npm run verify` green (1531 unit after the 7c-i merge; coverage 95.44/95.36/95.10/95.44), 331 integration. Adversarial pass before the PR; five review findings folded in over two rounds (one push each): the `.recycled` suffix + `favorite()` bin early-out (Codex 2×Major — bin child stayed favouritable); dropping the per-account `favoritesFolder()` memo (blocking — the adapter is per-endpoint, reused across profile switches); `typeNameOf` handling wire `type: "reference"` so favourites browsed inside My Favorites expand/open (likely blocking); a direct test for the bin early-out (minor). **6d-ii (recycle bin) done and merged 2026-09-11** — [PR #159](https://github.com/Shai-Alit/sas-py-vscode/pull/159), squash `c6b7a70` — `recycleItem`/`restoreItem`/`emptyRecycleBin` reuse `moveItem`/`deleteItem` (findings 6.14/6.15, verde re-confirmed, innov unreachable → single-cadence); `sasContentReadOnly:` = the FS provider registered again `isReadonly`; "Delete" now recycles an ordinary member and only permanently deletes an un-recyclable one behind a modal (upstream parity, invariant change from 6c-i, Sean's call, recorded as [ADR-0030](docs/adr/0030-delete-recycles-content-items.md) at the Phase 6→7/8 housekeeping checkpoint). Adversarial pass before the PR — no blocking findings; `emptyRecycleBin`'s no-progress/no-batching shape flagged and accepted as-is. PR review found one likely-blocking issue (`inRecycleBin` not propagated past the bin's direct children — fixed, thread resolved). `npm run verify` green (1550 unit; coverage 95.49/95.44/95.18/95.49), 333 integration, `check:docs` green. **6e (folder `resourceUri` fix attempt + right-click Cut/Paste) code-complete 2026-09-11**, found while live-testing 6c-ii's drag-and-drop at the Phase 6→7/8 housekeeping checkpoint — a real investigation landed on a plausible root cause for drag-and-drop, a missing `TreeItem.resourceUri` on folder items ([ADR-0031](docs/adr/0031-content-folder-resource-uri.md)), and `pythonOnViya.cutContentItem`/`pasteContentItem` shipped as a permanent, unambiguous move alternative regardless ([ADR-0032](docs/adr/0032-content-cut-paste.md)) — see `phase-6.md`'s 6e Runbook entry. Adversarial pass before any push found and this branch fixed one real blocking issue (the cut slot had no endpoint scoping and no clear on profile switch/sign-out — a cross-deployment paste could run the wrong adapter against a stale item link) and one real test-coverage gap (a new `cutPaste.test.ts`, +11, covering the happy path and every paste-reachable rejection reason), plus two related medium races (clear-before-move fixes both a double-paste race and a succeeded-then-cancelled race) and several minor findings, all folded in locally in one pass. `npm run verify` green (1580 unit; coverage 95.57/95.51/95.26/95.57), 368 integration, `check:docs`/`check:secrets` green. **[PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162) opened 2026-09-11.** **Live-retested 2026-09-11 (Sean): Cut/Paste confirmed working under its final command names; drag-and-drop itself remains completely non-functional, identical symptoms to before the fix attempt** — the `resourceUri` hypothesis is disproven as the cause (ADR-0031's own amendment), tracked as a deprioritised follow-up in `phase-11.md` rather than blocking this PR (Sean's call). **Root cause found and fixed the same day, in a separate follow-up after this PR merged** ([PR #164](https://github.com/Shai-Alit/sas-py-vscode/pull/164) opened 2026-09-11): a VS Code 1.109 bug JSON-marshals `handleDrop`'s `CancellationToken` argument (a non-final RPC argument `rpcProtocol.ts`'s trailing-token convention never catches), stripping its `onCancellationRequested` method, so `contentDragAndDrop.ts` threw before any move ran on every real attempt — invisible in this extension's own output channel since the throw landed in DevTools instead. Finding 6.16 (`phase-6.md`); fixed by dropping the outer-token subscription (only `progressToken`, which never crosses RPC, is subscribed to); adversarial pass before push raised no blocking findings; **live-confirmed 2026-09-11 (Sean)** — a real drag-and-drop move now works, plus every other `manual-test-pass.md` §15 row that had been blocked on the base gesture; `phase-11.md`'s tracked follow-up is now closed. **Two further automated-review rounds on the open PR each found and fixed one real race in `paste()`'s failure-restore**, both same-branch, one push each, both threads resolved: a `cut()` of a different item racing a failing move could get silently overwritten by the stale restore (fixed, commit `716ae27`); the fix's own `cutState === undefined` check couldn't tell that apart from an intentional `clearCutContentItem()` (profile switch/sign-out) firing mid-flight, so a late failure could resurrect a cut the intentional clear had just removed (fixed with a `cutGeneration` token, commit `1563bd3`). `npm run verify` green after each fix; `npm run test:integration` green (370 passing, all 13 Cut/Paste cases) after the second. **Merged 2026-09-11 as squash `a74f756`. Phase 6 is fully complete — all of 6a–6e merged.** The Phase 6→7/8 between-phase housekeeping (`HOUSEKEEPING.md`), which 6e was the last thing holding open, is **now closed**: the one remaining item from the checkpoint's own testing inventory — the top-level-folder permanent-delete confirmation — is resolved as a documented, deferred known gap. The checkpoint's own earlier "that reason was wrong" correction (reasoning from Sean's own admin access) was itself mistaken and is retracted; Sean has since clarified the real mechanism is a Viya deployment-level configuration, set at install time, restricting top-level-folder deletion for most users regardless of account permissions — not retestable on this deployment, needs one configured to allow it. See `phase-6.md`'s Runbook and `manual-test-pass.md`'s §15. | `docs/phases/phase-6.md` |
| 7 — Libraries and data viewer | **in progress. 7a done and merged 2026-09-10** ([PR #142](https://github.com/Shai-Alit/sas-py-vscode/pull/142), squash) — `src/data/`, the `pythonOnViya.dataExplorer` tree, `ComputeSessionManager`'s new `onDidChangeConnection`. `npm run verify` green (1295 passing; lines 94.81%, branches 95.22%, functions 94.45%, statements 94.81%). Findings 7.8/7.9 closed two implementation-time questions (no `itemtype` needed; a paginated collection's untyped `next` link must not be followed literally). **7b: architecture decided and code complete 2026-09-10** (React + `ag-grid-community`, [ADR-0028](docs/adr/0028-data-viewer-is-react-and-ag-grid.md)) — `LibraryAdapter.openTable`/`getColumns`/`getRows`, `DataViewerPanelManager`, the `pythonOnViya.openTable` command, and the webview bootstrap all written and typechecked; Findings 7.10/7.13 settled the row-count and link-typing questions the datasource needed. **Adversarially reviewed 2026-09-10** — three real findings folded in (no unit test for `dataViewerModel.ts`; a `requestId` collision across a webview reload; no `AbortSignal` on the panel's adapter calls) — and Sean's own `npm install` + `tsc -p tsconfig.webview.json` now come back clean. Sean's own `npm run verify`/`npm run test:integration` then surfaced and closed two more real gaps (an integration-test ordering bug; a `types.ts` branch-coverage shortfall) — both green on re-run. **Sean's own manual visual check of a real panel then ran twice, 2026-09-10.** First pass found three real findings; a live probe (Finding 7.14, `verde`) confirmed real numeric columns report `type: "FLOAT"` (never the unprobed `"NUM"` the code checked for) and the alignment check, a stale fixture, and two tests were all corrected; a missing `background-color` on the panel's `<style>` block was also fixed. Second pass, against a confirmed-fresh build, confirmed the alignment fix and surfaced a more specific, deliberately-deferred finding: neither the SAS Libraries tree nor an open data-viewer panel recovers on its own once a busy session frees up (extends an already-accepted 7a limitation to the panel; not addressed by 7c's planned scope, needs its own future slice). A second adversarial review (against `origin/main`) found no blocking findings; its one real minor observation (no test for abort-on-dispose) is folded in and verified. Left open at Sean's own direction, not blocking: the busy-recovery gap and the grid's light-only `ag-theme-alpine` (a design decision ADR-0028 didn't address). A pre-existing localisation gap (the panel's failure messages went out unlocalised) was found and fixed while preparing the PR — new `src/data/messages.ts` (`localiseDataProblem`), matching `resultPanel.ts`/`contentFileSystem.ts`'s own pattern; that commit skipped the manual adversarial pass, Sean's own call, relying on the automated PR reviewers instead. **[PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150) done and merged 2026-09-10** (squash `60a944e`), including a real profile-scoping panel-key bug caught by review and fixed, and a CodeQL-autofix origin-check rewrite re-verified against a real panel — see `phase-7.md`'s 7b Runbook for both. **7d resurrected from a 2026-09-04 stash and live-probed 2026-09-10** (Findings 7.11/7.12: bridge methods confirmed end to end; credential-echo risk narrower than feared). **7c-i (sort + filter) code-complete 2026-09-10**, [PR #155](https://github.com/Shai-Alit/sas-py-vscode/pull/155) open — Findings 7.15–7.18 (`createView`'s shape, `where=` ignored on a view's own rows read, `count` absent once a sort/filter is active, an invalid `where=` is a `400` with the real message nested in `errors[0].details`); reviewed twice before push, no blocking findings. Sean's own manual test (§12) then found and this branch fixed three real bugs: sort/filter silently lost on a tab switch (a webview reload replaying stale, empty state instead of the panel's current sort/filter), and an invalid filter showing a blank grid with nothing logged (the message existed, the webview was discarding it). A `cancel-in-progress` CI concurrency gap found alongside that pass was fixed separately, [PR #156](https://github.com/Shai-Alit/sas-py-vscode/pull/156) (squash, merged) — after which both automated reviewers ran against the real diff for the first time and found one real issue each (a stale `requestRows` reply silently dropped instead of answered; no dispose-time test for the stale-view-delete cleanup), both fixed. A third finding on that same fix commit (Major): all four of the file's `log?.warn` calls (two new, two pre-existing from 7c-i's original commit) were hard-coded English rather than run through `vscode.l10n.t()`, unlike every comparable log line elsewhere in the codebase (`dataTree.ts`/`contentTree.ts`/`sessionManager.ts`'s own `"<area>: {0}"` pattern) — fixed the same way. See the bullet list above and `phase-7.md`'s 7c-i Runbook entry for the full account. **7c-ii (table properties/columns static viewer) code-complete 2026-09-11** — Finding 7.19 (`TableInfo`'s full field set; `creationTimeStamp`/`modifiedTimeStamp` are ISO-8601, not a raw SAS epoch number); a fully static, script-free panel (`enableScripts: false`, CSS-only radio-button tabs — the only one of this project's three webview panels needing no script execution at all) opened via a new `pythonOnViya.showTableProperties` command. `npm run verify` green (1519 unit passing; coverage 95.48/95.43/95.15/95.48); `npm run test:integration` green (335 passing); `npm run check:docs` green. Adversarial pass done 2026-09-11 — no blocking findings; one low-priority test-decoupling fix folded in (`formatTimestamp`'s epoch-fallback test). **[PR #158](https://github.com/Shai-Alit/sas-py-vscode/pull/158) opened** — Codex found and this branch fixed one blocking (CSP `style-src` tightened from `'unsafe-inline'` to a nonce, since this panel needs no inline-style exception at all) and one major (a hard-coded English log line, plus its identical pre-existing neighbor) finding; a `windows-latest, node 24` CI timeout on this project's first-ever `toLocaleString()` call was fixed with a suite-level `this.timeout(30_000)`, matching `eslint-ignores.test.ts`'s own precedent. A second Codex review round then flagged, as its own in-scope finding, the "stuck on Loading… if the adapter rejects" gap the pre-PR pass had accepted as pre-existing and deferred — fixed in `tablePropertiesPanel.ts` alone (a `try`/`catch` around the two adapter calls, rendering a failure then rethrowing); `dataViewerPanel.ts`'s own identical pre-existing instance stays a deliberate, separate follow-up, not silently swept in here. **Post-merge fix, 2026-09-11**: Sean's own manual test pass (`manual-test-pass.md` §13) found the Properties/Columns panel opening with both tabs but no content in either pane — the CSS-only tab toggle's radio inputs were nested one level deeper than the panes they were meant to reveal, so the `:checked ~ #pane-*` general-sibling rule never matched. Fixed on `fix/7c-ii-table-properties-blank-panes` (flattened sibling structure in `src/data/tablePropertiesPanel.ts`), confirmed live in a real browser before/after and pinned with a new integration test; `npm run verify` green (1538 unit, coverage 95.52/95.51/95.23/95.52), `npm run test:integration` green (338 passing), `check:docs` green. Adversarial pass (`CLAUDE.md`) found no blocking issues. **Re-verified live 2026-09-11 (Sean, `verde`)** against a real panel built from this branch — every §13 field matches (Name/Library/Type/Label/Engine/Row Count/Column Count/Created/Modified/Compression Routine/Encoding), and the section's other rows (Columns tab switch, re-opening reveals the same panel, theme legibility, busy-session message) all pass; §13 is now fully ticked. Sean also used this branch to record Phase 6's own first live manual pass — new `manual-test-pass.md` §15/§16 (SAS Content browsing/mutations and favourites/Recycle Bin) — as a docs-only addition, out of its normal phase-boundary sequence; found two open Phase 6 items (drag-and-drop non-functional; the top-level-folder permanent-delete confirmation unexercised, originally recorded as a permissions block that turned out to be wrong), left untouched in this branch and picked up directly by the Phase 6→7/8 housekeeping checkpoint (`HOUSEKEEPING.md`), which root-caused and fixed the drag-and-drop defect and shipped a Cut/Paste alternative as 6e — see `phase-6.md`. **7c-iii (CSV export to local disk) is done and merged 2026-09-11** — [PR #161](https://github.com/Shai-Alit/sas-py-vscode/pull/161), squash `dac4f7f`. Finding 7.20 (the real `Accept`-header `rowsAsCSV` mechanism, versus upstream's own broken `#CSV`-suffix approach); `LibraryAdapter.getRowsAsCsv`, a `vscode`-free `csvExportModel.ts`, and `csvExportCommand.ts` wiring `pythonOnViya.exportTableToCsv` (save dialog, cancellable progress, atomic temp-file-then-rename write, a pre-flight disk-space check). `csvExportCommand.ts` is a new, fifth entry on [ADR-0003](docs/adr/0003-extension-host-target.md)'s Node-built-ins allow-list (`node:fs`, `node:path`, `node:crypto`) — see that ADR's 2026-09-11 amendment. Adversarially reviewed twice before the PR (an independent-agent pass found and fixed a real destination-file-destruction risk via the atomic-rename redesign; Sean's own review found no blocking issues, two of its three minor notes folded in). `npm run verify` green (1551 unit passing; coverage 95.56/95.51/95.25/95.56); `npm run test:integration` green (346 passing, 7 new); `check:docs` green. **7c (sort/filter, table properties, CSV export) is now fully done — all three sub-slices merged.** **7d (document, probe, and snippet-ize `SAS.sd2df`/`df2sd`/`submit`) is code-complete 2026-09-11** — `docs/data-access.md`, the drag-and-drop snippet (`src/data/dragSnippet.ts`/`dataDragAndDrop.ts`), and `test/fixtures/data/submit-log-echo.txt` pinning Finding 7.12. Adversarial pass (independent agent) before any push found and fixed one blocking issue (a `;` in a dropped table's name could break out of the SQL pass-through's generated `create view` statement — closed with a SAS name-literal wrapper, `sasNameRef`) and two related Medium ones (the drop's `CancellationToken` not reaching the quick pick; an already-cancelled drop still showing it). `npm run verify` green (1567 unit passing; coverage 95.6/95.5/95.35/95.6); `npm run test:integration` green (355 passing, 9 new); `check:docs` green. **[PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163) opened 2026-09-11.** Sean's own live test against an installed build then found the drop broken in a way no tier could catch: the drag engaged and the quick pick appeared, but either choice inserted nothing, silently. Root-caused from VS Code 1.109's own source — a tree→editor drop crosses the extension-host RPC boundary and VS Code serializes the payload on the way (`DataTransferItem.asString()` is `JSON.stringify(value)` for a non-string; the drop side rebuilds it as `new InternalDataTransferItem(item.asString)`), so `provideDocumentDropEdits` receives the JSON **string**, not the `TableItem[]` `handleDrag` set. The slice had cast it, making `payload[0]` the character `"["` — truthy, so the undefined-guard passed — and every field `undefined`; `deriveVariableName(undefined)` then threw out of the provider, which VS Code swallows (`dropIntoEditorController.ts` logs it to the DevTools console and drops the edit), so nothing surfaced in the output channel. Fixed with a validated, `vscode`-free `readDraggedTables` in `src/data/types.ts` (+6 unit tests, one a round-trip regression pin) rather than parsing inline in the coverage-excluded `dataDragAndDrop.ts`; upstream's own `ContentDataProvider` parses at the identical point for the identical reason. **Re-tested live by Sean 2026-09-11: the drag, both snippet choices, and the inserted code all work** — `manual-test-pass.md` §17's first six rows now pass. Diagnosing it also turned up a **separate, unrelated root cause for Phase 6's own long-standing drag-and-drop failure** (`handleDrop`'s `CancellationToken` does not survive the RPC hop, so `contentDragAndDrop.ts:203` throws before doing any work) — recorded in `phase-6.md`, handed to that phase's own agent, not fixed here. Reconciled with `main` 2026-09-11 (merge `30771e8`, picking up 6e/PR #162; one `STATUS.md` phase-index conflict, pure additions otherwise). `npm run verify` re-run green (1574 unit; coverage 95.62/95.54/95.38/95.62), `npm run test:integration` green (372 passing). Sean's own review pending before merge — **once that lands, Phase 7 is fully done.** | `docs/phases/phase-7.md` |
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
