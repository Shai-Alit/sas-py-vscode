# Status

**Phase 5 (Hardening & first release) is complete.** `v0.1.1` is the first
published release — VS Marketplace, Open VSX, and GitHub Releases. All Phase 5
slices (5a, 5b, 5c-i–5c-iv, 5d-i–5d-iv) are merged; Viya 3.5 support was dropped
along the way ([ADR-0022](docs/adr/0022-drop-viya-35-support.md)).

**Phase 6 (SAS Content explorer) is in progress — open
[`docs/phases/phase-6.md`](docs/phases/phase-6.md).** Scoped 2026-09-03 (4
slices, 6a–6d); the 6→12 order was re-confirmed with Sean on 2026-09-09 before
starting. **6a is done** (split 6a-i + 6a-ii) and **6b is done**; **6c** is
split into 6c-i/ii/iii — the oversized-read fix (PR #147), **6c-i** (PR #148,
squash `c63feaf`) and **6c-ii (drag-and-drop move)** ([PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151),
squash `8e842c7`) are done and merged. The drag-into-editor snippet that was
scoped into 6c-ii is **deferred to future work** (Sean, 2026-09-10; finding
6.11). **6c-iii (`getParent` / `TreeView.reveal`) is code-complete 2026-09-10 —
`npm run verify` green (1480 unit; coverage 95.31 lines / 95.37 branches /
94.98 functions / 95.31 statements), 318 integration passing; adversarial pass
before the PR raised no blocking findings (two minor polish items folded in).**
Finding 6.12 pinned the `/folders/ancestors` wire shape (superseding finding
101). This clone also had `npm install` run to reconcile `node_modules` with
Sean's concurrent Phase 7b merge (React + ag-grid) that `main` fast-forwarded
onto. **6d (favourites + recycle bin) is next.**

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
  Upload/download to local disk is **deferred to Phase 11** (Sean,
  2026-09-10 — never in the 6a–6d breakdown).
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
  - **6c-iii — `getParent` / `TreeView.reveal`.** [PR #154](https://github.com/Shai-Alit/sas-py-vscode/pull/154),
    open. Adversarial pass before the PR raised no blocking findings; in review,
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
  - **6d (favourites + recycle bin) is next.**

The Phase 5→6 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed
2026-09-09 — nothing else gates Phase 6.

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
- **7d — Python↔library data exchange (`SAS.sd2df`/`df2sd`/`submit`).**
  Scoped 2026-09-04 from a separate session; that session's doc edits were
  stashed rather than committed and sat unmerged until found and resurrected
  2026-09-10. Live-probed this session (Findings 7.11/7.12): all three
  bridge methods work end to end, and the credential-echo risk the stash
  had only guessed at (by analogy to Phase 8's Finding 92) turned out to be
  more nuanced than feared — `SAS.submit()`'s own log echo applies SAS's
  standard `PASSWORD=` masking; Finding 92's own mechanism (the outer
  job-source echo) is untouched and still the real risk for a credential
  written as a literal. Remaining work: the documented example and the
  drag-and-drop snippet (7a's tree now exists to drop from).

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
| 6 — SAS Content explorer | **in progress.** 6a done (6a-i `src/wire/` promotion [ADR-0025](docs/adr/0025-shared-wire-layer.md), 6a-ii adapter + read-only tree [ADR-0026](docs/adr/0026-content-adapter-shape.md)); **6b done and merged 2026-09-10** ([PR #141](https://github.com/Shai-Alit/sas-py-vscode/pull/141), squash `1c13854`) — open/save via a `sasContent:` `FileSystemProvider`, findings 6.1–6.2, `npm run verify` green (1347 unit + 280 integration passing). Oversized-read fix merged (PR #147, `79e10b0`); **6c-i (create/rename/delete) done and merged 2026-09-10** ([PR #148](https://github.com/Shai-Alit/sas-py-vscode/pull/148), squash `c63feaf`), findings 6.3–6.9. **6c-ii (drag-and-drop move) done and merged 2026-09-10** ([PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151), squash `8e842c7`) — `npm run verify` green (1417 unit + 296 integration); findings 6.10/6.11; the drag-into-editor snippet is deferred (finding 6.11); `canSelectMany` + `!listMultiSelection` guard on the 6c-i context commands. **6c-iii (`getParent` / `TreeView.reveal`, finding 6.12) code-complete 2026-09-10** — adversarial pass raised no blocking findings; `npm run verify` green (1480 unit; coverage 95.31/95.37/94.98/95.31), 318 integration. **6d next.** | `docs/phases/phase-6.md` |
| 7 — Libraries and data viewer | **in progress. 7a done and merged 2026-09-10** ([PR #142](https://github.com/Shai-Alit/sas-py-vscode/pull/142), squash) — `src/data/`, the `pythonOnViya.dataExplorer` tree, `ComputeSessionManager`'s new `onDidChangeConnection`. `npm run verify` green (1295 passing; lines 94.81%, branches 95.22%, functions 94.45%, statements 94.81%). Findings 7.8/7.9 closed two implementation-time questions (no `itemtype` needed; a paginated collection's untyped `next` link must not be followed literally). **7b: architecture decided and code complete 2026-09-10** (React + `ag-grid-community`, [ADR-0028](docs/adr/0028-data-viewer-is-react-and-ag-grid.md)) — `LibraryAdapter.openTable`/`getColumns`/`getRows`, `DataViewerPanelManager`, the `pythonOnViya.openTable` command, and the webview bootstrap all written and typechecked; Findings 7.10/7.13 settled the row-count and link-typing questions the datasource needed. **Adversarially reviewed 2026-09-10** — three real findings folded in (no unit test for `dataViewerModel.ts`; a `requestId` collision across a webview reload; no `AbortSignal` on the panel's adapter calls) — and Sean's own `npm install` + `tsc -p tsconfig.webview.json` now come back clean. Sean's own `npm run verify`/`npm run test:integration` then surfaced and closed two more real gaps (an integration-test ordering bug; a `types.ts` branch-coverage shortfall) — both green on re-run. **Sean's own manual visual check of a real panel then ran twice, 2026-09-10.** First pass found three real findings; a live probe (Finding 7.14, `verde`) confirmed real numeric columns report `type: "FLOAT"` (never the unprobed `"NUM"` the code checked for) and the alignment check, a stale fixture, and two tests were all corrected; a missing `background-color` on the panel's `<style>` block was also fixed. Second pass, against a confirmed-fresh build, confirmed the alignment fix and surfaced a more specific, deliberately-deferred finding: neither the SAS Libraries tree nor an open data-viewer panel recovers on its own once a busy session frees up (extends an already-accepted 7a limitation to the panel; not addressed by 7c's planned scope, needs its own future slice). A second adversarial review (against `origin/main`) found no blocking findings; its one real minor observation (no test for abort-on-dispose) is folded in and verified. Left open at Sean's own direction, not blocking: the busy-recovery gap and the grid's light-only `ag-theme-alpine` (a design decision ADR-0028 didn't address). A pre-existing localisation gap (the panel's failure messages went out unlocalised) was found and fixed while preparing the PR — new `src/data/messages.ts` (`localiseDataProblem`), matching `resultPanel.ts`/`contentFileSystem.ts`'s own pattern; that commit skipped the manual adversarial pass, Sean's own call, relying on the automated PR reviewers instead. **[PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150) done and merged 2026-09-10** (squash `60a944e`), including a real profile-scoping panel-key bug caught by review and fixed, and a CodeQL-autofix origin-check rewrite re-verified against a real panel — see `phase-7.md`'s 7b Runbook for both. **7d resurrected from a 2026-09-04 stash and live-probed 2026-09-10** (Findings 7.11/7.12: bridge methods confirmed end to end; credential-echo risk narrower than feared). | `docs/phases/phase-7.md` |
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
