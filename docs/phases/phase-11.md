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

**Priority order set 2026-09-16 (Sean's own call, ahead of everything else in
this file): session startup/autoexec configuration and the new interactive-window
feature (F7, below) go first** when this phase starts, ahead of the rest of the
long tail above and the feature candidates below. Neither is sized yet — sizing
happens when the phase is actually picked up, per this section's own rule — but
the *order* is decided now so a future scoping session doesn't have to
re-litigate it.

**New feature candidates (added 2026-09-16, from Sean's own post-Phase-10 usage
— not sized, not sequenced beyond the priority order above, and not yet
triaged against §3.1's parity table).**

- **F1 — A SQL-passthrough bridge for Python queries against SAS libnames.** A
  custom UI for setting up and maintaining SAS libname definitions from the
  extension, with Python calls against that library intercepted and rewritten
  as a database-passthrough query run over the existing SAS connection, its
  answer returned to Python. **Flagged, not scoped**: this is qualitatively
  different from every other candidate here — it needs its own UI surface (new
  webview or tree, unlike anything this project has built for *configuration*
  rather than *browsing*), a Python-side interception mechanism this project
  has never needed (today's model is "submit a whole program, capture its
  output," never "rewrite one call inside it before it runs"), and a design
  question about where the libname definitions themselves persist. Sean's own
  assessment ("probably extremely complicated") matches: this reads as an
  architecture-level candidate that may warrant its own phase and a dedicated
  scoping pass with a hands-on spike, not a Phase 11 slice sized alongside
  autoexec and snippets. Not decided here, per this project's own "treat
  architecture-level changes as a deliberate event" rule — surfaced for Sean
  to weigh against the rest of the backlog.
- **F2 — Table properties for CAS tables.** Phase 7c already built this for SAS
  library tables (`tablePropertiesPanel.ts`); Phase 8 never extended it to CAS.
  Likely a straightforward reuse of the existing static panel against
  `TableSource`'s CAS implementation, in the same spirit as Phase 8c's own
  data-viewer reuse ([ADR-0034](../adr/0034-table-source-abstraction.md)).
- **F3 — CSV export for CAS tables.** Same gap as F2, for `csvExportCommand.ts`
  instead of the properties panel — Phase 7c-iii shipped it for SAS library
  tables, Phase 8 never extended it to CAS. Likely the same shape of reuse as
  F2, and worth scoping together with it since both are "the CAS tree is
  missing a context-menu action the SAS Libraries tree already has."
- **F6 — A UI panel of common commands, so users don't have to remember the
  command palette.** A small view (Sean's own suggestion: under the CAS tree)
  surfacing frequently-used commands as clickable entries rather than requiring
  **Ctrl+Shift+P** and a remembered name. Needs a design pass on which commands
  earn a spot (connect/disconnect, show/refresh/search environment, insert CAS
  snippet, and run-file are the obvious candidates) before it's sized.
- **F7 — An interactive window, matching VS Code's normal Python experience.**
  **Grounding, not a design yet**: VS Code's own Python Interactive Window
  (`Shift+Enter` / "Run Selection/Line in Python Interactive Window") is not
  provided by `ms-python.python` itself — it is `ms-toolsai.jupyter`'s own
  feature, and it requires either a real Jupyter server or, for its lighter
  "Raw Kernel" mode, a local `ipykernel` reachable via ZeroMQ
  ([code.visualstudio.com/docs/python/jupyter-support-py](https://code.visualstudio.com/docs/python/jupyter-support-py),
  fetched 2026-09-16). That is a structurally different execution model from
  anything this project runs today, and depending on it would reintroduce
  exactly the local-Python dependency this project's own non-negotiable (§1)
  and Phase 9's own ipynb-native decision
  ([ADR-0024](../adr/0024-notebooks-are-ipynb-native.md)) both deliberately
  avoided — a Viya profile has no local kernel process to connect to.
  **The likely shape, by analogy with Phase 9**: a bespoke, this-project-owned
  surface (a scratch document or a `NotebookController`-shaped experience) that
  sends a selection to the *profile's own compute session* and shows the
  result inline, matching the interactive window's user-facing shape without
  actually integrating with `ms-toolsai.jupyter`'s kernel machinery — the same
  choice Phase 9 made for notebooks generally, applied to a single-selection
  REPL-like flow instead of a whole `.ipynb`. Not decided; a real design pass
  and likely a hands-on spike (same shape as Phase 9's 9a spike and Phase 10's
  10b spike) belong at the start of this slice, before any code is written.
- **F8 — Interactive, sortable pandas DataFrame display**, distinct from the
  existing SAS/CAS table data viewer (Phase 7b, Phase 8c) — this is about a
  DataFrame value produced *during a run or in a notebook cell*, not a table
  browsed from a tree. Sean's own proposed default cap: 100 rows and 20
  columns, configurable. Likely reuses the existing React/ag-grid machinery
  ([ADR-0028](../adr/0028-data-viewer-is-react-and-ag-grid.md)) as a rendering
  target rather than building a new grid, but the cap, the trigger (every
  DataFrame result, or an opt-in action), and how this interacts with the
  Result panel's existing `RichOutput[]` shape are all open.

**Bugs found pre-release (added 2026-09-16, from Sean's own hands-on use —
not yet triaged for whether they're fixed ahead of the next release or as the
start of this phase).**

- **B1 — No connection means no clear way back in.** When the Viya connection
  is down (a timed-out session, a dropped VPN), the CAS tree, SAS Content tree,
  and SAS Libraries tree all currently just go blank, with nothing on screen
  explaining why or offering a way to sign back in. Every one of these views
  should always show *something* — an explanatory state and a way to
  reconnect — never a silently empty tree.
- **B2 — A stale connection breaks the SAS Libraries tree with no way back
  except a full sign-out/sign-in cycle.** With a stale connection, the SAS
  Libraries tree goes blank with no connect button, and **Connect to Viya**
  itself is not offered in the command palette in that state — the only way
  out is **Disconnect** (a full sign-out) followed by signing in again. If
  re-authentication is genuinely required, the extension should say so
  directly rather than leaving the user to discover the sign-out/sign-in dance
  by trial and error.
- **B3 — The SAS Libraries table icon doesn't match the CAS tree's.** SAS
  Libraries currently shows tables with a generic `[ ]` icon; CAS tables use a
  purpose-built loaded/unloaded table icon (Phase 8,
  [`src/cas/casTree.ts`](../../src/cas/casTree.ts)). The SAS Libraries tree
  should use the same icon for visual consistency between the two table
  browsers.

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

**Also carried here (added 2026-09-15, from Phase 10b's pre-push adversarial
review — two items discussed with the developer and deferred rather than
built, `phase-10.md`'s "Adversarial self-review, 2026-09-15" Runbook entry
has the full discussion).**

- **A `pythonOnViya.*` setting to opt out of Pylance stub generation.** 10b
  (`docs/python-environment.md`#quieting-pylances-false-unresolved-import-warnings)
  writes a generated stub tree into the workspace and edits
  `python.analysis.stubPath` on every fresh probe, with no way to turn it
  off. Nobody has asked for one yet, and it's a real if bounded addition — a
  new `package.json` configuration contribution plus wiring
  (`src/run/pylanceStubSync.ts`) and a documentation update. A candidate for
  whenever it is actually requested, not scoped as a slice yet.
- **Closed on the 10b branch itself, before this item ever reached Phase
  11.** A PR #182 review round found the gap was not only a multi-root
  concern as first scoped here — `stubPathSetting.ts`'s `decideStubPathAction`
  only checked `workspaceValue`, which missed a `stubPath` set at *user/global*
  scope even in the ordinary single-folder case, silently overriding it. Fixed
  in `c81f9d5`: `decideStubPathAction` now takes `globalValue`,
  `workspaceValue`, and `workspaceFolderValue` together, honouring VS Code's
  own scope precedence. Kept as a one-paragraph record rather than deleted
  outright, for the same reason the CAS tree icon-flip entry above is.

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
