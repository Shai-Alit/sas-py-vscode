# ADR-0045 — Copy shares Cut's clipboard; a file is copied on the server, a folder by recreating it

- **Status:** Accepted
- **Date:** 2026-10-01
- **Decides:** how the SAS Content tree copies an item, what a copy is
  named, and how Copy and Cut share the clipboard
- **Amends:** [ADR-0032](0032-content-cut-paste.md), which left Copy out of
  scope until the services had been probed; its single slot now holds a
  copied item as well as a cut one
- **Executed in:** Phase 13, slice 13b (the "13b built" Runbook entry in
  [`docs/phases/phase-13.md`](../phases/phase-13.md))
- **Evidence:** Findings 13.9, 13.10 and 13.11 in
  [`docs/phases/phase-13.md`](../phases/phase-13.md); Sean's choices,
  2026-10-01, after the probe

## Context

ADR-0032 shipped Cut/Paste as a move and said a copy would wait for a
probe. If the services could not copy, Copy would mean reading content and
creating new files.

The probe found the two services differ (Findings 13.9 and 13.10):

- The **Files service** copies a file on the server. A file resource has a
  `copyFile` link (`POST /files/files/{id}/copy`). With
  `?parentFolderUri=`, it makes the copy and links it into that folder in
  one call. The copy keeps the bytes, the media type and the `typeDefName`.
  `Content-Disposition` names it. A name already taken in the folder is
  refused `409`, and nothing is left behind.
- The **Folders service** has no copy. No folder, member or service root
  offers a copy-shaped link, and SAS's documentation says a child member
  cannot be copied.

Upstream `vscode-sas-extension` has no Copy command. Its generated Files
client has the copy operation, unused. For a file whose name is taken, it
builds `{basename}_Copy{n}{ext}`.

## Decision

1. **Copy joins Cut in one clipboard slot.** **Copy** records the item, the
   deployment and the mode. Whichever of Cut and Copy ran last is what
   **Paste** uses, like a file manager. A cut is cleared by its paste, as
   before. A copy stays, so it can be pasted into several folders. The slot
   is still cleared on a profile switch, a session change and a sign-out,
   and a paste is still refused against a different deployment. The slot's
   names follow: `clearCutContentItem` became `clearContentClipboard`, and
   the context key `pythonOnViya.hasCutContentItem` became
   `pythonOnViya.hasContentClipboard`.
2. **A file is copied on the server**, with `copyFile`. The extension
   always sends `parentFolderUri`, since without it the copy lands in no
   folder. It also always sends the name, so the copy carries the name the
   tree shows.
3. **A folder is copied by recreating it.** The whole source tree is listed
   first. Then a folder is made for each folder, and each file is copied
   with `copyFile` into its new folder. Data flows are left out and counted,
   and so is a folder reached a second time. Reports and jobs never appear
   in this tree's listings, so they are not copied either. A failed file
   does not stop the copy. A listing or a folder that fails does, and the
   message says where the partial copy is.
4. **A taken name gets upstream's pattern.** The copy keeps its name when
   the target folder has nothing of that name. Otherwise it gets the first
   free `{base}_Copy{n}{ext}`; a folder's name is not split at a dot. Names
   are compared ignoring case. Pasting into the item's own folder therefore
   works, and never prompts or overwrites. The name can be taken between
   the listing and the call that uses it, most simply by a second Paste of
   the same copy into the same folder while the first is running. When the
   service refuses the copy's own file or folder and a fresh listing shows
   the name now taken, the call is made once more under the next free name.
   A taken name is refused `409` by a file copy (Finding 13.9) and by a
   folder create, even when two creates race (Finding 13.11), so the
   service never holds two items of one name. The fresh listing still
   decides, because the name check a folder create runs first also refuses
   names for other reasons. A call with
   no answer is not retried, since the server may already have made the
   copy.
5. **Pasting a folder into itself is allowed.** Because the source is
   listed before anything is made, the copy is of the tree as it was, and
   it ends. A move refuses this; a copy has no reason to.

## Alternatives considered

- **Files only, folders later.** Smaller, and one call per paste. Rejected:
  a folder is the copy people most expect, and 13a's download had already
  shown the shape of a folder walk and its reporting.
- **Refuse a taken name, or ask for one.** Refusing makes a same-folder
  paste impossible. Asking adds a prompt to every clash. Upstream's pattern
  needs neither.
- **A copy is used up by its first paste**, like a cut. Rejected: a file
  manager keeps a copy, and nothing about a copy makes a second paste
  unsafe.
- **Read the bytes and create a new file**, for files as well as folders.
  Not needed: `copyFile` does it on the server, keeps the type, and avoids
  moving the bytes through the client.

## Consequences

- The copy logic is in `src/content/copy.ts`, which does not import
  `vscode` and is unit-tested at 100%. `src/content/contentCopy.ts` is the
  thin shell. It reuses 13a's progress notification, problem message and
  left-out count from `contentTransfer.ts`. `reportNoTarget` moved to
  `messages.ts`, so the two command shells do not import each other.
- `ContentAdapter.copyFile` makes two calls per file: a `GET` of the file
  resource, then the copy. The member record a listing returns does not
  carry `copyFile`, and the adapter follows links rather than composing
  `/copy` onto an address.
- How long a copy of a large file takes was not probed, so it gets the bulk
  transfer timeout. The 13a follow-up about telling a cancel from a failure
  applies to a copy the same way.
- **Copy** shows on a data flow and is then refused, as **Download...**
  is, because a data flow shares the file's context value. It also shows on
  a folder directly under SAS Content, which is not a member record and is
  refused as Cut refuses it. A context value of their own would hide it,
  but would touch every menu entry that matches a file or a folder, so it
  is left for a slice of its own.
- A cancel that lands while a file's copy call is in flight cannot recall
  it: the server may finish the copy. The message says only that the copy
  was cancelled; the refreshed folder shows the file if it arrived. An
  upload behaves the same way.
- The retry in decision 4 covers one lost race. Two Pastes that both lose
  to a third fail as before, with the service's message.
