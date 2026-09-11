# ADR-0032 — Right-click Cut/Paste ships as a SAS Content move interaction, alongside drag-and-drop

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decides:** whether the SAS Content tree gets a right-click Cut/Paste
  command pair for moving an item, in addition to drag-and-drop, and how
  much of it ships now versus later (Copy is explicitly out of scope here)
- **Constrained by:** [ADR-0031](0031-content-folder-resource-uri.md) (the
  drag-and-drop fix this was investigated alongside), `src/content/contentMove.ts`
  and `ContentAdapter.moveItem` (finding 6.10, already probed and shipped in
  6c-ii — reused unchanged, not re-probed), [ADR-0026](0026-content-adapter-shape.md)
- **Executed in:** the Phase 6→7/8 housekeeping checkpoint (`docs/phases/phase-6.md`)

## Context

While diagnosing why drag-and-drop was not delivering drops reliably
(ADR-0031), Sean raised two separate points that hold regardless of whether
that defect gets fixed:

1. **Drag-and-drop is ambiguous.** Even working perfectly, dragging an item
   onto a folder never tells the user whether it will move or copy the
   item — a real UX gap independent of the functional defect. Sean's own
   words: this should have been ahead of drag-and-drop on the original
   list, not an afterthought.
2. **A menu command tests the actual move mechanism independent of VS
   Code's native drag delivery.** Since `handleDrop` was firing so
   inconsistently that it was genuinely unclear whether `ContentAdapter.moveItem`
   itself worked at all, a right-click alternative that calls the exact
   same adapter method was the fastest way to separate "the move logic is
   broken" from "VS Code isn't delivering the gesture" — and it turned out
   to be the latter: three live moves through Cut/Paste (`Demo → tst`,
   `tst → My Folder`, `My Folder → Demo`) all succeeded cleanly, before
   ADR-0031's fix was even written.

`vscode-sas-extension` was checked for a precedent and has none: its
`ContentDataProvider` supports drag-and-drop and a `copyPath` command that
writes a path string to the OS clipboard, but no command that cuts or
copies a content item itself. So this is not a parity gap being closed —
it is a deliberate improvement over upstream, motivated by both drag-and-drop's
inherent ambiguity and its (at the time) unreliability.

## Decision

Two new commands, `pythonOnViya.cutContentItem` and
`pythonOnViya.pasteContentItem`, in `src/content/contentCommands.ts`:

- **Cut** records the clicked item, and the endpoint it was cut from, in a
  single module-level slot. Nothing on the server changes yet. Shown on an
  ordinary or favourited folder/file, never a Recycle Bin item or anything
  that is not an ordinary member (matching `favorite()`'s own `inRecycleBin`
  early-out, checked before the session so it applies even to a
  non-menu-driven invocation). The endpoint is recorded because a
  `ContentAdapter` is per-endpoint and reused across profile switches — the
  same fact 6d-i's `favoritesFolder()` finding turned on — so a stale cut
  pasted after switching profiles must not silently run the wrong
  deployment's adapter against the old item's link. A profile switch, an
  auth session change, or a sign-out also clears the slot outright
  (`contentExplorer.ts`), rather than relying on the endpoint check alone.
- **Paste**, right-clicked on a folder-shaped target (an ordinary or
  favourited folder, or My Folder — the same set Create offers itself on),
  refuses a cross-endpoint paste with a named reason, then calls
  `moveObjection` (the exact guard `contentDragAndDrop.ts`'s `handleDrop`
  already uses) and, if the move is valid, `ContentAdapter.moveItem` — the
  same adapter call a working drag-and-drop drop makes. An invalid paste
  (onto the item's own current folder, onto itself, onto a Recycle Bin
  item) shows a complete, standalone message naming the reason rather than
  staying silent the way a missed drag does, since a deliberate menu click
  deserves an explanation a mouse gesture does not. The slot is cleared
  *before* the move runs, restored only if the move did not actually
  happen — see Consequences for why the ordering matters.
- Only one item can be cut at a time; cutting a second replaces the first.
  There is no "cancel cut" command and no visual indication in the tree of
  what is currently cut — see Consequences.
- **Copy is explicitly out of scope for this decision.** A true server-side
  copy needs the Folders/Files service to support copying a member at all,
  which has never been probed — none of the relation constants this
  project has recorded (`self`/`up`/`members`/`addMember`/`update`/
  `deleteResource`/`delete`/`deleteRecursively`/`previousParent`/
  `validateRename`/`validateNewMemberName`) are copy-shaped. If it turns
  out there is none, Copy would mean reading the content and creating a new
  file — real additional work, not a rename of Cut's call. That is its own
  future decision, tracked in `docs/phases/phase-11.md`, not decided here.

## Alternatives considered

- **Fix drag-and-drop (ADR-0031) and stop there, without adding Cut/Paste.**
  Rejected: even fixed, drag-and-drop does not address the move-vs-copy
  ambiguity Sean raised as the more fundamental complaint, and a native
  tree drag gesture is inherently more fragile than a menu click — this
  investigation's own experience is the evidence for that, independent of
  whatever the root cause turned out to be.
- **Ship Cut and Copy together**, since the user asked for "cut/copy/paste"
  as one phrase. Rejected for this slice: Copy's feasibility is genuinely
  unknown pending a probe, while Cut reuses an already-probed, already-shipped
  primitive (`moveItem`) with zero new wire surface. Shipping Cut now and
  scoping Copy separately, once probed, avoids blocking a low-risk,
  already-proven change on an open question.
- **A visible "what's cut" indicator** (status bar item, dimmed row).
  Rejected for a first slice: VS Code has no supported way to dim or badge
  a single arbitrary `TreeItem` on demand outside of a `contextValue`-driven
  icon change, which would mean re-rendering the whole tree to grey one
  row — real cost for a nice-to-have, not a correctness gap. Noted as a
  possible future polish item, not a defect.

## Consequences

- `contentCommands.ts` grows a second cross-command piece of state (the cut
  slot, alongside the file's existing `run()` helper) and a
  `pythonOnViya.hasCutContentItem` context key the Paste menu entry gates
  on, both managed through one `setCutState`/`clearCutContentItem` pair so
  the slot and its context key can never drift apart. Neither is expected
  to need to generalise to multiple simultaneous cuts. The slot is
  module-level, shared across the whole extension host (and, in the
  integration test suite, across every test in the process) — `clearCutContentItem`
  is exported partly so tests can reset it between cases, since nothing
  currently does and the first test that sets it would otherwise leak into
  every later one in the file.
- **Paste clears the slot before the move runs, not after**, restoring it
  only if the move did not happen (`!result.ok`, which already covers a
  cancelled attempt — `run()`'s own contract treats a cancelled action as a
  failure whose cause is the abort). Clearing late instead would leave two
  related races open: a second Paste click fired while the first is still
  in flight would race a second move of an item that may already have
  relocated, and a move that lands right as the user clicks Cancel
  (`result.ok && aborted` — a real, narrow window `run()`'s own doc comment
  describes) would leave a now-invalid cut still armed for a second paste.
  Clearing first closes both without needing a separate in-flight guard.
- Cut/Paste and drag-and-drop now both call `ContentAdapter.moveItem` /
  `moveObjection` — exactly one implementation of "is this move valid" and
  "how do you do it," reached two ways. A future change to move semantics
  (a new objection case, a new wire shape) only has one place to change.
- `describeMoveObjection` (a small, human-readable-reason lookup) lives in
  `contentCommands.ts` itself rather than a `vscode`-free module — a minor,
  deliberate departure from this project's usual "logic lives in a tested,
  `vscode`-free module; the shell stays thin" pattern (ADR-0026), on the
  grounds that it is a straight, five-case string lookup with no branching
  logic of its own, the same level of complexity `createChild`'s
  `kind === "folder" ? ... : ...` ternary already carries in this same
  file. If it grows real logic later, it should move.
