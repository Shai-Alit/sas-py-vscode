<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 6 (SAS Content explorer)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## SAS Content — browsing, open/save, and mutations (phases 6a–6c, 6e)

A tree view over the deployment-wide Folders/Files service — this repo's
first activity-bar view container, first `FileSystemProvider`
(`sasContent:`), and first `TreeDragAndDropController`
([ADR-0025](../../adr/0025-shared-wire-layer.md),
[ADR-0026](../../adr/0026-content-adapter-shape.md)). Unlike SAS Libraries
(§10), it needs no compute session — signing in is enough. **First pass ran
2026-09-11 (Sean, live)** — no prior manual pass existed for any of Phase 6
before this. Every row through "Delete on an ordinary item recycles it
silently" passed clean.

Two things came out of that pass, both investigated at the Phase 6→7/8
housekeeping checkpoint rather than in this branch's own scope:

- The top-level-folder permanent-delete confirmation was recorded as
  blocked by a permissions limit. The Phase 6→7/8 housekeeping checkpoint
  later recorded that reason as wrong, reasoning from Sean's own admin
  access — **that correction was itself mistaken and is retracted.** Sean
  has since clarified: deleting a folder directly under SAS Content is
  restricted by a Viya deployment-level configuration set at install time,
  independent of the requesting account's own permissions — admin rights
  do not bypass it. The original finding was correct. **Deferred as a known
  gap** (row below) — it needs a deployment configured to allow this, not a
  retry on the current one.
- Drag-and-drop within the tree was completely non-functional. A real
  investigation found a plausible cause and shipped a fix for it
  ([ADR-0031](../../adr/0031-content-folder-resource-uri.md); a folder tree
  item never carried a `resourceUri`) — but **a second live retest,
  2026-09-11, after the fix shipped, found drag-and-drop still completely
  non-functional, identical symptoms.** The `resourceUri` hypothesis is
  disproven as *the* cause (ADR-0031's own amendment); the change is kept
  regardless for its own smaller reasons, but drag-and-drop itself is now
  an accepted, deprioritised **(known gap)** — see `phase-11.md`. The four
  rows below that test drag variants stay unchecked; they cannot be
  exercised while the base gesture does not work at all. A right-click
  Cut/Paste alternative shipped alongside the fix attempt
  ([ADR-0032](../../adr/0032-content-cut-paste.md)) and **is confirmed working,
  live, under its final command names** — this is now the only way to move
  an item in this tree, not merely the less ambiguous one.

**Pre-work:** a Viya connection signed in (§3) — no need to **Connect to
SAS Viya** first. Have write access to at least one folder you don't mind
creating, renaming, moving, and deleting test files/folders in.

- [x] **6.1** **The view exists and reflects profile/auth state** — open the
  **Python on Viya** icon in the Activity Bar.
  **Expect:** **SAS Content** is the first view in the container. With no
  profile configured it reads "Add a SAS Viya connection profile to browse
  SAS Content." with a working **Add Connection Profile** link. With a
  profile configured but signed out, it reads "Sign in to SAS Viya to browse
  SAS Content." with a working **Sign In** link. There is no third
  "connect" state — signing in is enough, since this view never touches a
  compute session.
- [x] **6.2** **Signing in populates the tree** — sign in.
  **Expect:** the view lists delegate rows for My Favorites, My Folder, SAS
  Content, and Recycle Bin (the exact names are whatever your deployment's
  Folders service returns), each with a chevron and no children loaded yet.
- [x] **6.3** **Expanding a folder lists its contents, folders first** — expand SAS
  Content (or any folder with a mix of subfolders and files).
  **Expect:** subfolders are listed before files, and within each group,
  alphabetically, case-insensitively — this extension orders the listing
  itself rather than asking the server (ADR-0026).
- [x] **6.4** **Refresh reloads the tree** — click the refresh icon in the SAS
  Content title bar, or run **Refresh SAS Content** from the Command
  Palette.
  **Expect:** the tree reloads; an unexpanded state stays unexpanded.
- [x] **6.5** **Opening a file opens it for editing** — click a small text file
  (e.g. a `.py` or `.txt` file) in the tree.
  **Expect:** a new editor tab opens titled with the file's name, showing
  its real content; the tab is not read-only.
- [x] **6.6** **Saving writes back to Viya** — with that file open, make a small
  edit and save (Ctrl/Cmd+S).
  **Expect:** the save completes with no error; reopening the file (close
  the tab, click it again in the tree) shows the edit persisted.
- [x] **6.7** **New Folder / New File prompt, validate, and create** — right-click
  a folder-shaped node (the SAS Content root, an ordinary subfolder, or My
  Folder — not My Favorites or Recycle Bin) and choose **New Folder**, then
  separately **New File**.
  **Expect:** an input box titled with the parent's name; typing a name
  containing `/` is rejected in place with "A name cannot contain \"/\".";
  submitting empty is rejected with "Enter a name."; a valid name shows a
  brief progress notification ("Creating folder \"…\"…" / "Creating
  file \"…\"…"), then the new item appears in the tree, already selected
  and revealed (expanding the parent if it was collapsed) — no separate
  refresh needed.
- [x] **6.8** **Rename** — right-click the folder or file just created and choose
  **Rename**.
  **Expect:** an input box titled `Rename "<name>"`, pre-filled with the
  current name; submitting the unchanged name is rejected with "That is
  already its name."; a new name shows a brief progress notification
  ("Renaming to \"…\"…") and the tree reflects it.
- [x] **6.9** **Delete on an ordinary item recycles it silently** — right-click the
  renamed file and choose **Delete**.
  **Expect:** no confirmation dialog — a brief progress notification
  ("Moving \"…\" to the Recycle Bin…") and the item disappears from its
  folder. (Confirmed separately in §16 that it lands in the Recycle Bin.)
- [-] **6.10** **(known gap) Delete on a top-level folder permanently deletes, behind
  a modal** — right-click a folder that sits directly under SAS Content
  (not nested inside another folder) and choose **Delete**.
  **Expect:** a blocking confirmation — "Permanently delete the folder
  \"…\" and everything inside it?" with detail "This cannot be undone." and
  a **Delete Permanently** button. Cancelling leaves it untouched;
  confirming removes it for good (not recoverable from the Recycle Bin).
  **First pass, 2026-09-11 (Sean): unable to test** — a Viya
  deployment-level configuration, set at install time, restricts deleting a
  folder directly under SAS Content for most users regardless of account
  permissions; not something an admin account bypasses, and not retestable
  on this deployment. **Deferred**: needs a deployment configured to allow
  it. Unit- and integration-tested (`content-adapter.test.ts`,
  `explorer.test.ts`) — this is a live-confirmation gap only. Do not re-tick
  this box on this deployment; rewrite it as a normal **Expect** only once
  it is actually confirmed live somewhere.
- [x] **6.11** **Dragging an item onto a folder moves it** — drag a test
  file onto a different folder.
  **Expect:** a progress notification ("Moving \"…\"…"), the item
  disappears from its old location, and it is auto-revealed (selected,
  ancestors expanded) under the new folder — no manual refresh needed.
  **First pass, 2026-09-11 (Sean): failed** — dragging a file from Windows
  Explorer does nothing (expected — see below), and dragging a file from
  within the SAS Content tree also did nothing: no progress notification,
  no message, no file movement. **Second pass, 2026-09-11 (Sean), against a
  build with ADR-0031's fix: failed identically.** No progress notification,
  no message, no file movement — same as the first pass, no visible change
  at all. Root cause was unknown at the time; deprioritised behind Cut/Paste
  (below), tracked in `phase-11.md` for a future investigation. **Third
  pass, 2026-09-11 (Sean), against the actual fix (finding 6.16 —
  `handleDrop`'s `CancellationToken` argument was broken by a VS Code 1.109
  RPC marshalling bug, unrelated to `resourceUri`): passed, working as
  expected.** Rewritten as a normal **Expect** per this doc's own
  convention, per the note this row previously carried.
- [x] **6.12** **Dragging multiple items moves all of them together** — select two
  or more items (Ctrl/Cmd-click) and drag them onto a folder.
  **Expect:** a progress notification naming the count ("Moving N
  items…"); all selected items move; the first one is revealed afterward.
  **Live-tested 2026-09-11 (Sean), after the fix above: passed.**
- [x] **6.13** **Dragging onto My Favorites or the Recycle Bin does nothing** — drag
  a test file onto the My Favorites row, then onto the Recycle Bin row.
  **Expect:** no error, no toast, no move — the item stays exactly where it
  was. (Neither gesture is wired to add-to-favourites or recycle; only the
  context-menu actions in §16 do that.) **Live-tested 2026-09-11 (Sean),
  after the fix above: passed** — now a meaningful result, since the base
  gesture works and this confirms the no-op is deliberate, not a symptom of
  the general failure that used to make every drag a no-op.
- [x] **6.14** **Dragging an item onto itself or its current folder is a no-op** —
  drag an item onto the folder it already lives in, and drop it directly on
  itself if your OS allows the gesture.
  **Expect:** nothing happens either way — no progress notification, no
  error. **Live-tested 2026-09-11 (Sean), after the fix above: passed** —
  same caveat as the row above, now resolved the same way.
- [x] **6.15** **Multi-select hides the single-item context actions** — select two
  or more items at once and right-click.
  **Expect:** New Folder, New File, Rename, Delete, Cut, and the favourite
  toggle are all absent from the context menu (they act on exactly one
  item); only Empty Recycle Bin / Restore-style bulk actions would still
  apply where relevant. **Live-tested 2026-09-11 (Sean): passed.**
- [x] **6.16** **Cut, then Paste, moves an item unambiguously (6e)** — right-click a
  test file and choose **Cut**, then right-click a *different* folder and
  choose **Paste**.
  **Expect:** Cut shows a brief info message ("Cut \"…\". Right-click a
  folder and choose Paste."); Paste shows a progress notification ("Moving
  \"…\"…"), the item disappears from its old location, and it is
  auto-revealed under the new folder — same end state as a working drag,
  reached without touching drag-and-drop at all. **Live-tested twice**:
  first under the diagnostic's original command names (2026-09-11, Sean —
  three real moves, `Demo → tst`, `tst → My Folder`, `My Folder → Demo`,
  all clean), then again, 2026-09-11, against
  [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162)'s branch
  under the final `pythonOnViya.cutContentItem`/`pasteContentItem` names —
  confirmed working. At the time this was live-tested, this was the only
  working way to move an item in this tree; drag-and-drop (above) is now
  fixed too, so Cut/Paste is a second, unambiguous way to do the same move
  rather than the only one.
- [x] **6.17** **Paste without a Cut, or onto an invalid target, explains why** —
  right-click a folder and choose **Paste** with nothing cut yet; then Cut
  a file, and Paste it onto the folder it already lives in.
  **Expect:** "Nothing has been cut yet. Cut an item first." for the first
  case; a message naming the item, the target, and "it's already there" for
  the second — neither silently does nothing the way a missed drag would.
- [x] **6.18** **Cut is not offered on a Recycle Bin item** — expand the Recycle
  Bin and right-click an item inside it.
  **Expect:** no **Cut** entry on the context menu at all.


## SAS Content — favourites and the Recycle Bin (phase 6d)

Two independent features layered on §15's tree: My Favorites, a per-account
reference list, and the Recycle Bin, where "Delete" (§15) lands for
anything that isn't a top-level folder. Both are `getChildItems`
add-ons — no favourite/recycled item gets a different icon; only its
context menu changes. **First pass ran 2026-09-11 (Sean, live), same session
as §15** — every row below passed clean, no open items.

**Pre-work:** the same signed-in connection as §15, with at least one test
folder containing a nested file (a file inside a subfolder, not directly
under SAS Content) that you don't mind recycling.

- [x] **6.19** **Add to My Favorites** — right-click an ordinary folder or file (not
  a delegate, and not something already inside the Recycle Bin) and choose
  **Add to My Favorites**.
  **Expect:** a brief progress notification ("Adding \"…\" to My
  Favorites…"); expanding My Favorites now shows it, with no manual
  refresh needed. Right-clicking it again — either under My Favorites or in
  its original location — now offers **Remove from My Favorites** instead.
- [x] **6.20** **A favourited item looks identical, no badge** — compare the icon of
  the item you just favourited against an ordinary sibling.
  **Expect:** the same folder or file icon either way — favouriting does
  not add a star or any other visual marker in this build. The only way to
  tell is the context menu wording. (Not a bug if true; flag it if you
  instead see a badge, since that would mean the code changed since this
  was written.)
- [x] **6.21** **A favourited item browsed from My Favorites behaves like the real
  thing** — expand My Favorites and open/expand the item from there rather
  than from its original location.
  **Expect:** a favourited file opens for editing exactly as in §15; a
  favourited folder expands and lists its real children.
- [x] **6.22** **Remove from My Favorites** — right-click the item under My
  Favorites and choose **Remove from My Favorites**.
  **Expect:** a brief progress notification and it disappears from My
  Favorites; its original location is untouched.
- [x] **6.23** **A Recycle Bin item cannot be favourited** — expand the Recycle Bin
  (recycle something first if it's empty) and right-click an item inside
  it.
  **Expect:** neither **Add to My Favorites** nor **Remove from My
  Favorites** appears on the context menu at all.
- [x] **6.24** **Restore returns an item to where it lived** — recycle a test file
  (§15's Delete), then expand the Recycle Bin, right-click it, and choose
  **Restore**.
  **Expect:** a brief progress notification ("Restoring \"…\"…"); the item
  disappears from the Recycle Bin and reappears in its original folder.
- [x] **6.25** **A file nested inside a recycled folder is still recognizably
  recycled** — recycle a folder that contains a file (not a bare empty
  folder), then expand the recycled folder inside the Recycle Bin.
  **Expect:** the nested file shows as read-only (see the row below) and
  offers Restore, the same as a directly-recycled item — not as an
  ordinary editable file. (This confirms a real bug found and fixed in PR
  #159's review: `inRecycleBin` not propagating past the bin's direct
  children.)
- [x] **6.26** **Recycled files open read-only** — click a file inside the Recycle
  Bin (not a file inside a recycled folder — either works, per the row
  above).
  **Expect:** it opens in the editor, but the tab is read-only (VS Code's
  padlock indicator; editing and Ctrl/Cmd+S either do nothing or show an
  error) — a different command than an ordinary open (**View Recycled SAS
  Content File** vs. **Open SAS Content File**), backed by a second,
  read-only registration of the same `FileSystemProvider`.
- [x] **6.27** **Delete on an already-recycled item permanently deletes, behind a
  modal** — right-click an item already inside the Recycle Bin and choose
  **Delete**.
  **Expect:** the same blocking confirmation as a top-level folder in
  §15 — "Permanently delete \"…\"?", detail "This cannot be undone.", a
  **Delete Permanently** button — since a bin item can't be recycled again.
- [x] **6.28** **Dragging into or out of the Recycle Bin does nothing** — drag an
  item from the Recycle Bin onto an ordinary folder, and drag an ordinary
  item onto the Recycle Bin.
  **Expect:** neither does anything — no move, no error, no toast. (Moving
  a recycled item out would be a restore and dropping into the bin an odd
  half-recycle; 6d deliberately defines neither as a drag gesture — only
  the context-menu actions above do this.)
- [x] **6.29** **(slow) Empty Recycle Bin** — recycle two or three test items so the
  bin isn't empty, then right-click the Recycle Bin row and choose **Empty
  Recycle Bin**.
  **Expect:** a blocking confirmation — "Permanently delete everything in
  the Recycle Bin?" with detail mentioning that items other tools placed
  there (such as reports) are left alone — then a progress notification
  ("Emptying the Recycle Bin…") with **no per-item progress bar** (a known,
  accepted tradeoff — confirm it doesn't read as hung for your handful of
  items), and the bin ends up empty.

