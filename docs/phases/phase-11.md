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
- **Drag-and-drop within the SAS Content tree remains completely
  non-functional — root cause unknown, deliberately deprioritised behind
  Cut/Paste, tracked here for whoever wants to pick it up.** 6c-ii shipped
  it fully unit/integration-tested but never live-tested; the Phase 6→7/8
  housekeeping checkpoint's live pass (2026-09-11) found it did nothing at
  all — no progress notification, no error, no move — and a real
  investigation (diagnostic logging, a throwaway isolation test extension,
  a live comparison against `vscode-sas-extension`'s own working
  `ContentDataProvider`) landed on a plausible cause (a folder `TreeItem`
  missing `resourceUri` — [ADR-0031](../adr/0031-content-folder-resource-uri.md))
  that turned out, on a second live retest after shipping the fix, **not**
  to be it: identical symptoms, unchanged. Ruled out along the way and
  confirmed *not* the cause: the installed `@types/vscode`/VS Code version,
  general Electron drag flakiness, the drag payload's MIME-type format
  (custom vs. VS Code's own "recommended" `application/vnd.code.tree.*`),
  and nesting depth. **Not yet tried**: VS Code's own suggested diagnostic
  for exactly this class of problem — **Developer: Set Log Level…** → Debug,
  Developer Tools console open, drag live, and read what (if anything) VS
  Code itself logs about the drop — `TreeDragAndDropController.dropMimeTypes`'s
  own doc comment names this as the supported way to see what mime type,
  if any, gets offered. Not blocking anything — Cut/Paste (above) is the
  real, shipped, working way to move a SAS Content item today.

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
