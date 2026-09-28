# ADR-0040 — Every URI scheme this extension registers starts with `pythonOnViya`, never with a name the SAS extension uses

- **Status:** Accepted
- **Date:** 2026-09-27
- **Decides:** the names of the three SAS Content URI schemes, and the rule
  for any scheme added later
- **Amends:** [ADR-0031](0031-content-folder-resource-uri.md) (its folder
  identity scheme, `sasContentFolder`, is now `pythonOnViyaContentFolder`)
- **Executed in:** Phase 12 slice 12r (fixes B12.3)
- **Evidence:** [`docs/phases/phase-12.md`](../phases/phase-12.md), Finding
  12.21

## Context

Slice 6b (v0.1.2) named this extension's SAS Content schemes after the SAS
extension's own: `sasContent` for an editable file, `sasContentReadOnly` for
a recycled one, and later `sasContentFolder` for a folder's identity URI
(ADR-0031). The read-only one was described as mirroring upstream's.

A URI scheme belongs to the extension host, not to one extension. VS Code
accepts one `FileSystemProvider` per scheme per host and throws for the
second. The SAS extension registers `sasContent` too, so with both installed,
whichever activated second failed partway through `activate()`. The SAS
extension then could not sign in, or this one had no notebook kernel and no
CAS or SAS Libraries views, depending on which started first. VS Code tells
the user nothing (B12.3, Finding 12.21).

Two more clashes sat behind that one. The SAS extension serves
`sasContentReadOnly` with a `TextDocumentContentProvider`, and a
`FileSystemProvider` for the same scheme takes precedence, so once both
extensions could activate, ours would have served its Recycle Bin previews
and failed them. The SAS extension's `F8`/`F3` keybindings and Run menus also
apply to any Python editor whose scheme matches `/^sas(Content|Server).*/`.

## Decision

1. **The three schemes are `pythonOnViyaContent`, `pythonOnViyaContentReadOnly`
   and `pythonOnViyaContentFolder`** (`src/content/uri.ts`). The activation
   event is `onFileSystem:pythonOnViyaContent`.
2. **Every scheme this extension registers, or names in an `onFileSystem:`
   activation event, starts with `pythonOnViya`.** `pythonOnViyaEnvironment`
   already did. None starts with `sas`. A unit test pins the three content
   schemes, and an integration test checks the activation events and that
   `sasContent:` is left unclaimed.
3. **Tree `contextValue` strings are unchanged** (`sasContent:folder` and the
   rest). Every `when` clause that matches them also requires
   `view == pythonOnViya.contentExplorer`, so no other extension sees them.
4. **No migration for editor tabs left open under the old names.**

## Alternatives considered

- **Rename only `sasContent`.** Both extensions would then activate, and
  `sasContentReadOnly` would shadow the SAS extension's Recycle Bin previews.
- **A new name that keeps a `sas` prefix**, such as `sasContentPy`. The SAS
  extension's Run keybindings and menus would still apply to our files.
- **Catch the registration error and run without the SAS Content view.** That
  helps only when the SAS extension wins the race. When this extension
  registers first, the SAS extension still fails.
- **Keep `onFileSystem:sasContent` so old tabs still activate us.** It would
  also activate this extension whenever the SAS extension touches one of its
  own files.
- **Also isolate each registrar in `activate()`**, so a failed registration
  costs one feature rather than everything after it. That is defence in depth
  rather than a fix, since it cannot stop the SAS extension failing. Sean left
  it out of 12r.

## Consequences

- **Both extensions activate, in either order.** Each keeps its own SAS
  Content tree, sign-in and run commands.
- **A tab left open by 0.1.2 or 0.1.3 does not reopen.** Its URI still names
  `sasContent`, which now belongs to the SAS extension, or to nothing. Closing
  it and opening the file again from the SAS Content view fixes it.
  `CHANGELOG.md` says so.
- **The integration suite cannot catch a clash with another extension.** It
  runs with `--disable-extensions`. The name tests above guard this one, and
  manual items 12.30–12.32 cover both extensions installed together.
