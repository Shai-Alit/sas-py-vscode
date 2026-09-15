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

**Also carried here (added 2026-09-10/11, from the Phase 6→7/8 housekeeping
checkpoint): three items deferred out of Phase 6 that never landed a home.**

- ~~Upload/download to local disk, deferred to Phase 11~~ — **retracted
  2026-09-11.** `phase-6.md` and `STATUS.md` previously said this was
  "deferred to Phase 11 (Sean, 2026-09-10)"; that attribution was never
  confirmed with him (a prior session's own scope call, per git blame on
  `c63feaf`), and Sean has said directly he does not want this pushed out
  this far — it is a feature developers will expect, not a long-tail parity
  item. **Not scoped here.** It needs uploading a local file into a SAS
  Content folder and downloading a SAS Content file to local disk — the two
  directions Phase 6's `sasContent:` `FileSystemProvider` and tree explicitly
  did not cover — but which phase it actually belongs to is Sean's call to
  make, not a repeat of the same mistake in the other direction.
- **Drag a folder/file onto My Favorites.** A drop onto the My Favorites
  delegate in the SAS Content tree already no-ops (`contentMove.ts`'s
  `moveObjection` returns `target-not-a-folder` for it) rather than doing
  anything; wiring it to `addToFavorites` instead is upstream parity that
  never made either 6d slice's punch list (`phase-6.md`'s 6d-i Runbook entry).
  Small, self-contained, no probe needed — the mutation it would call already
  exists.
- ~~Right-click Cut / Paste for SAS Content items~~ — **the Cut/Paste half is
  done**, shipped at the Phase 6→7/8 housekeeping checkpoint alongside a
  drag-and-drop fix attempt (`phase-6.md`'s 6e Runbook entry,
  [ADR-0032](../adr/0032-content-cut-paste.md)) — see below, the fix
  attempt did not work, and Cut/Paste is now the only working way to move
  an item in this tree, not merely the unambiguous one. Not an oversight
  relative to upstream: `vscode-sas-extension`'s own `ContentNavigator/index.ts`
  has no such command either, only drag-and-drop plus a `copyPath` command
  that copies a path string to the OS clipboard, not the item itself — a
  deliberate improvement over upstream, not a parity gap being closed.
- **Copy/Paste for SAS Content items — still open, deliberately not scoped
  with Cut.** `src/content/types.ts`'s relation constants
  (`self`/`up`/`members`/`addMember`/`update`/`deleteResource`/`delete`/
  `deleteRecursively`/`previousParent`/`validateRename`/`validateNewMemberName`)
  include nothing for a server-side copy — unlike Cut (which reuses the
  already-probed `ContentAdapter.moveItem`), whether the Folders/Files
  service supports copying a member at all is unprobed and needs a
  `viya-api-probe` pass, not an assumption, before this is designed. If
  there is no server-side copy, this means read-the-content-then-create-a-new-file,
  real additional work rather than a rename of Cut's call.
- ~~Drag-and-drop within the SAS Content tree remains completely
  non-functional — root cause unknown~~ — **closed 2026-09-11, fixed.** 6c-ii
  shipped it fully unit/integration-tested but never live-tested; the Phase
  6→7/8 housekeeping checkpoint's live pass (2026-09-11) found it did
  nothing at all — no progress notification, no error, no move — and an
  investigation (diagnostic logging, a throwaway isolation test extension, a
  live comparison against `vscode-sas-extension`'s own working
  `ContentDataProvider`) landed on a plausible but ultimately wrong cause (a
  folder `TreeItem` missing `resourceUri` —
  [ADR-0031](../adr/0031-content-folder-resource-uri.md)), confirmed wrong by
  a live retest after shipping that fix: identical symptoms, unchanged.
  That investigation correctly ruled out the installed `@types/vscode`/VS
  Code version, general Electron drag flakiness, the drag payload's
  MIME-type format, and nesting depth — but its own theory (that folders
  were somehow special) was itself the dead end; drag *engagement* was never
  the problem.
  **The one avenue that investigation never reached — VS Code's own
  Developer Tools console during a live drop — is exactly what found it.** A
  Phase 7 session (2026-09-11, VS Code 1.109 source) saw `ERR
  o.onCancellationRequested is not a function` at `handleDrop` in the
  console: `handleDrop`'s own `CancellationToken` argument is a non-final
  argument to `mainThreadTreeViews.ts`'s `$handleDrop`, so
  `rpcProtocol.ts`'s "pop a trailing cancellation token" marshalling never
  catches it, and it crosses the extension-host RPC boundary as plain JSON,
  which strips `MutableToken`'s prototype-getter
  `onCancellationRequested`. `handleDrop` had been firing and completing its
  own guard checks on every real attempt all along; it threw immediately
  afterward, before any move ran, whenever there was something movable to
  attempt — invisible in this extension's own output channel because the
  throw lands in the DevTools console instead. Fixed in
  `src/content/contentDragAndDrop.ts` (the `token` subscription is dropped;
  only `progressToken`, which never crosses RPC, is subscribed to) and
  recorded as finding 6.16 in `phase-6.md`, including a correction of that
  file's own "fires ~1 in 6" and "root cause unknown" claims and ADR-0031's
  second amendment. `npm run verify`/`test:integration`/`check:docs` all
  green, a new regression test reproduces the exact broken-token shape, and
  an adversarial pass before the push raised no blocking findings (the
  reviewer independently re-derived the VS Code source mechanism rather
  than taking the write-up's word for it). **Live-confirmed 2026-09-11
  (Sean)**: a real drag-and-drop move now works, plus every other §15 row
  that had been blocked on the base gesture (multi-item drag, the
  My-Favorites/Recycle-Bin no-ops, the self-drop no-op, multi-select
  hiding context actions) — see `manual-test-pass.md`'s §15. Cut/Paste
  (above) remains a permanent, working alternative regardless — this
  closes the parity gap, it does not replace Cut/Paste.

**Also carried here (added 2026-09-14, from Phase 9's 9b manual pass, §9.8):
real tracking of an interrupted cell's abandoned statement, for a precise
"waiting" message.** `notebookController.ts`'s `executeCell` gives a cell that
sits with no output for `WAITING_NOTICE_DELAY_MS` an honest, cause-agnostic
notice rather than silence — deliberately not a claim that a previous,
interrupted statement is still finishing server-side, because the client has
no way to know that (Finding 76: an interrupt's local abort clears
`backend.busy` well before the SAS-side statement it interrupted actually
ends, and nothing keeps a reference to that abandoned statement afterward).
Building real tracking of it — enough to word the message precisely — is what
Phase 4c already declined once for Run File's own identical gap, as
disproportionate for that slice. Worth a harder look here: revisit whether a
lightweight version (a session-scoped "last interrupted, not yet confirmed
free" flag, cleared the next time a submission into that session succeeds)
is now proportionate, now that notebooks make the scenario more common than
Run File alone did. Not scoped as a slice yet — a candidate, not a commitment.

**Also carried here (added 2026-09-15, at the Phase 9→10 housekeeping
checkpoint — should have landed with 9c's own merge but was missed until this
checkpoint caught the gap between what `phase-9.md` claimed was carried and
what actually was): two more Phase 9c gaps, both explicitly deferred rather
than fixed.**

- **A rejected `appendOutput` mid-stream skips `execution.end`.** If a
  notebook is closed while a cell is still running, `notebookController.ts`'s
  in-flight `execution.appendOutput(...)` calls reject, and nothing calls
  `execution.end(...)` afterward — pre-existing since 9b, noted but not fixed
  by 9c's own adversarial review (Finding 10, `phase-9.md`'s 9c Runbook
  entry) since the failure mode is a closed notebook, not a live one a user
  is still looking at.
- **A stale Problems-panel entry for a notebook cell can outlive a sign-out.**
  9c's own adversarial review (Finding 2) fixed the closed-notebook half of
  this gap (`handleNotebookClosed`, wired to
  `workspace.onDidCloseNotebookDocument`) but left the sign-out half open
  deliberately — `RunDiagnostics.onDidSignOut`/`onDidCloseTextDocument`
  clearing hooks (Phase 5d-iv) have no notebook equivalent to hook into, and
  threading `onDidSignOut` through `extension.ts` a second time for a surface
  a person will, in the ordinary case, just re-run was judged not worth it
  that slice — the same "disproportionate" call Phase 4c made for Run File's
  own comparably narrow waiting-cell-message gap. Worth revisiting alongside
  the item above, since both are instances of the same shape: an execution
  surface's terminal state going stale when the surface itself goes away
  mid-run or post-run.

**Closed 2026-09-15, before Phase 11 started: the CAS tree icon-flip gap
(carried here 2026-09-14 from Phase 8's own post-merge fixes) is fixed and
live-confirmed.** Root cause: `onDidChangeTreeData` resolves a fired element
through `ExtHostTreeView`'s `_nodes: Map<T, TreeNode>`, keyed by the
extension's own **object** — `TreeItem.id` is never used to look a node up —
so the state-updated *copy* PR #173 fired was discarded with no error, which
is why that fix passed every test and did nothing live. `src/cas/casTree.ts`
now fires the identical element and carries the new state out-of-band in a
`loadedTables` set that `getTreeItem` overlays. Full account, including why
no test of the original could have caught it:
[`phase-8.md`](phase-8.md)'s "Icon-flip gap: root cause found, 2026-09-15"
Runbook entry; manual-test item 8.28 passes. **No Phase 11 work remains
here** — kept as a one-paragraph record rather than deleted outright, so a
session that arrives via the 2026-09-14 cross-references does not go looking
for an item that is no longer in this list.

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
