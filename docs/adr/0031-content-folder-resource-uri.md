# ADR-0031 — Every SAS Content tree item gets a `resourceUri`, folders included, to fix native drag-and-drop

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decides:** why a folder-shaped `ContentItem` gets a `TreeItem.resourceUri`
  in `src/content/contentTree.ts`, even though it is never opened, and what
  scheme that URI uses
- **Constrained by:** [ADR-0026](0026-content-adapter-shape.md) (`src/content/`
  is one concrete adapter; `contentTree.ts` is a thin `vscode` shell over it),
  the 6c-ii Runbook entry (`docs/phases/phase-6.md`) that shipped
  `SasContentDragAndDropController` with no live drag ever confirmed against
  it, and the Phase 6→7/8 housekeeping checkpoint's live investigation
  (`docs/phases/phase-6.md`)
- **Executed in:** the Phase 6→7/8 housekeeping checkpoint (`docs/phases/phase-6.md`)

> **Amended 2026-09-11, the day after this ADR was written.** The live
> retest this record's own Consequences section called for came back
> negative: rebuilt, reinstalled, reloaded, and dragged, drag-and-drop
> within the SAS Content tree failed identically to before this change —
> same symptoms (`handleDrag` fires, `handleDrop` does not, no pattern by
> target) as the original report. **This ADR's title overclaims** — the
> `resourceUri` change described below does **not** fix native
> drag-and-drop, and that hypothesis should be read as disproven, not
> merely unconfirmed. The decision itself is kept regardless, on its own
> narrower merits: it matches `vscode-sas-extension`'s own unconditional
> behaviour, and it gives every folder a real tooltip it previously lacked
> (a genuine small parity fix). The correlational evidence in this ADR's
> Context — the file-vs-folder pattern, the comparison against upstream —
> is preserved below as a real, if ultimately incomplete, investigation:
> it ruled out several concrete candidates (VS Code version, Electron drag
> flakiness, mime-type format, nesting depth) even though it did not land
> on the actual cause. Root cause remains open, tracked in
> [`phase-11.md`](../phases/phase-11.md) rather than blocking
> [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), which
> ships [ADR-0032](0032-content-cut-paste.md)'s Cut/Paste as the actual
> working move interaction — see `phase-6.md`'s 6e Runbook entry for the
> full account.

## Context

6c-ii shipped a `TreeDragAndDropController` for the SAS Content tree, fully
unit- and integration-tested — but every one of those tests calls
`handleDrag`/`handleDrop` directly, which is not the same thing as VS Code
actually delivering a real mouse drag to them. No live drag had ever been
tried against it before the Phase 6→7/8 housekeeping checkpoint's manual
pass, which found it did not work: dragging a tree item onto a folder
produced no progress notification, no error, and no move, on a build
rebuilt fresh from `main` (ruling out a stale `.vsix`).

Diagnostic logging added to every early-return path in `handleDrag`/
`handleDrop` (kept — see that file's own doc comment) showed `handleDrag`
firing reliably on every attempt, but `handleDrop` firing in only one of
roughly six real attempts across several target folders — no pattern by
folder depth or which folder was involved. A throwaway two-view test
extension, built to isolate the cause, showed `handleDrop` firing reliably
4-for-4 for a trivial synchronous tree, using both VS Code's own
"recommended" `application/vnd.code.tree.<treeidlowercase>` mime format and
a private custom one — ruling out the installed `@types/vscode`/VS Code
version, general Electron drag flakiness, and mime-type-format choice as
explanations. A live comparison against `vscode-sas-extension`'s own
`ContentDataProvider` (confirmed by Sean to drag reliably, live, in this
exact environment) then surfaced the real difference: a follow-up live test
showed our `handleDrop` firing reliably for every **file** target (a leaf
row) but almost never for a **folder** target (an expandable row) — and
upstream's `getTreeItem` sets `resourceUri` on every item unconditionally,
folder or file:

```ts no-check
// vscode-sas-extension, ContentDataProvider.getTreeItem
const uri = await this.model.getUri(item, false);
return {
  ...
  command: isContainer ? undefined : { command: "vscode.open", ... },
  resourceUri: uri,   // set unconditionally — folders too
};
```

Our own `contentTree.ts` set `resourceUri` only on an openable file leaf
(`NodePresentation.openable`); a folder was built with a label, an icon, a
`contextValue` and a stable `id`, but no `resourceUri` at all. This is not
documented anywhere as a VS Code drag-and-drop requirement — `TreeItem`'s
own doc comments describe `resourceUri` only as an input to label/icon/
description derivation — but it is the one concrete, confirmed structural
difference between an implementation that reliably drags, live, in this
exact environment (upstream's) and one that mostly does not (this
project's), and it lines up exactly with the file-versus-folder pattern the
live logs showed.

## Decision

Every `ContentItem` with a resolvable {@link resourceHrefOf} href gets a
`TreeItem.resourceUri` in `getTreeItem` — not only an openable file leaf.
An openable leaf keeps its existing `sasContent:` / `sasContentReadOnly:`
URI and its `vscode.open` command, unchanged. A folder (or a delegate —
My Folder, My Favorites, the Recycle Bin, the SAS Content root, wherever a
href resolves) gets a `resourceUri` under a new, inert
**`sasContentFolder:`** scheme (`src/content/uri.ts`) and **no `command`** —
clicking a folder still only expands it. `sasContentFolder:` is never
registered with a `FileSystemProvider`; nothing calls `workspace.fs.*` on
it. It exists purely to give the row an identity for VS Code's drag
machinery to use, carrying no behaviour of its own.

## Alternatives considered

- **Reuse the existing `sasContent:` scheme for folders too**, matching
  upstream's single-scheme approach exactly. Rejected for now: our
  `SasContentFileSystemProvider.stat()` unconditionally calls
  `adapter.statFile(href)` and returns `FileType.File`, and `readDirectory()`
  already throws `NoPermissions` — both assume a *file* resource. Folders
  and files are different API surfaces on Viya's Folders/Files services;
  routing a folder's `resourceUri` into a provider built only for files
  risks a wrong-shaped wire call if VS Code ever calls `stat()` on it for
  some internal reason (a decoration, a hover) this project does not
  currently register anything for, but might in the future. A dedicated,
  unregistered scheme is safer at essentially no cost, and does not
  foreclose folding folders into `sasContent:` properly later if a real
  reason to browse them as files ever comes up — that would be its own
  decision, not a side effect of this one.
- **Make folders genuinely browsable through the `FileSystemProvider`**
  (real `stat`/`readDirectory` support for a folder resource). Rejected as
  far out of proportion to the problem: this ADR fixes a drag-and-drop
  defect, not a request to expand what `sasContent:` supports, and doing so
  would be exactly the kind of scope expansion this project's own process
  flags for a separate decision.
- **Ship the mime-type-format swap instead** (tested first, since it was the
  cheaper change and matched upstream's own convention). Rejected: live
  Sean-tested, twice, and it did not change anything — `handleDrop` still
  did not fire reliably for folder targets. Reverted in
  `contentDragAndDrop.ts` rather than left in as an unconfirmed change.

## Consequences

- `src/content/uri.ts` now has three schemes instead of two
  (`CONTENT_SCHEME`, `CONTENT_READONLY_SCHEME`, `CONTENT_FOLDER_SCHEME`),
  and `contentFolderUriString` alongside `contentUriString` /
  `contentReadOnlyUriString`. `parseContentUri` still reads a
  `sasContentFolder:` URI's query the same way, on the chance anything ever
  needs to, but nothing currently does.
- A folder's `TreeItem` never set `tooltip`, so VS Code derives one from
  `resourceUri` when absent — an openable file leaf already had this; a
  folder didn't, and now does (its own name, e.g. `/reports`, on hover).
  Cosmetic, and presumed harmless, but noted here because it is a genuine
  user-visible side effect of this decision that no test currently asserts
  one way or the other.
- A future contributor adding a real capability to `sasContent:` folders
  (browsing, decorations, anything that calls `workspace.fs.*` on a folder's
  `resourceUri`) needs to either extend `SasContentFileSystemProvider` to
  handle a directory resource properly first, or keep using
  `sasContentFolder:` for identity-only purposes and build the real
  capability against its own seam — this ADR does not answer that question,
  it only establishes that the inert scheme exists and why.
- The root cause is now understood and fixed at the code level; it still
  needs a fresh live re-test (rebuild, reinstall, reload, drag) to confirm
  in practice before this is considered closed — see `phase-6.md`'s Runbook.
