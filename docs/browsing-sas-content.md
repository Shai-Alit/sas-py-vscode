# Browsing SAS Content

Once you have [signed in](signing-in.md), the **Python on Viya** activity-bar
icon opens a **SAS Content** view — the same folders you would see in SAS
Studio's **Explorer**, read from the Viya Folders and Files services.

You can browse the tree, refresh it, **open and save files**,
**create, rename, move and delete** folders and files, keep **favourites**, and
use the **Recycle Bin** to undo a delete. Dragging a file straight into an
editor as a code snippet is a later release.

## What the tree shows

Four top-level folders, matching SAS Studio:

- **My Favorites** — the shortcuts you have favourited.
- **My Folder** — your personal folder.
- **SAS Content** — every folder that has no parent (the shared top level).
- **Recycle Bin** — content you have deleted but not yet purged.

Expanding any folder lists its sub-folders and files, loaded on demand — nothing
is fetched until you open a folder. Folders sort before files, then by name.

## Opening and saving a file

Click a file in the tree to open it in an editor. It behaves like any other
file: edit it and **Save** writes it straight back to SAS Viya. Data flows and
other non-file items in the tree do not open this way, and a file larger than
10 MB will not open — edit those in SAS Studio.

Saving is guarded against overwriting someone else's change. If the file was
modified on the server — in SAS Studio, the web client, or another editor —
after you opened it, the save is **refused** with a message asking you to close
the file and open it again to pick up the current version. There is no merge or
force-save; reopening is the way to get back in sync.

A file you have open is not watched for server-side changes while it sits in the
editor — the check happens when you save, and a fresh open always fetches the
latest.

## Creating, renaming, moving and deleting

Right-click an item in the tree for its actions:

- **New Folder** / **New File** — on any folder, and on **My Folder**. You are
  asked for a name; a file's name should include its extension, and the type is
  registered from it (a `.py` becomes *Python code* on the server). If a
  sibling already has that name, SAS Viya says so before anything is created,
  and usually suggests a free alternative.
- **Rename** — on any folder or file. Renaming a file changes the name shown in
  the tree; it does not rewrite the file's own stored name.
- **Move** — drag a folder or file onto another folder. Drag several at once to
  move them together; a drop that is not a valid move (onto a file, onto the
  item's own folder) is quietly ignored.
- **Delete** — on any folder or file. An ordinary folder or file is moved to
  the **Recycle Bin**, with no confirmation, because you can restore it. A
  top-level folder — one directly under **SAS Content** — has no recycle step;
  deleting it is permanent and asks first. (A folder that still contains
  something SAS Studio shows but this view does not — a report, a job — will
  not delete; remove those in SAS Studio first.)

## Favourites

**Add to My Favorites** / **Remove from My Favorites** on any folder or file
keeps a shortcut to it under **My Favorites**. A favourite is a reference, not a
copy: removing it leaves the original untouched, and the star shows on the item
wherever it appears in the tree.

## The Recycle Bin

Deleting an ordinary item moves it here. Expand **Recycle Bin** to see what is
in it, then right-click:

- **Restore** — puts the item back where it was deleted from.
- **Delete** (on an item in the bin) — removes it permanently, after a
  confirmation.
- **Empty Recycle Bin** — right-click the **Recycle Bin** folder itself to
  purge everything the view lists in it. Items other tools placed in the bin,
  such as reports, are left alone — clear those in SAS Studio.

A file in the Recycle Bin opens **read-only** — you can look at it, but restore
it before editing.

**My Favorites**, **Recycle Bin** and the **SAS Content** root cannot themselves
be renamed or deleted — they are not folders you own in the same way.

If an action cannot complete — a permission, a name still in use, the item
already gone — it is reported as a notification, with the technical detail in
**Python on Viya: Show Log**. Nothing partial is left behind by a failed
create.

## Refreshing

The view does not poll. Use the **refresh** button on the view's title bar (or
**Python on Viya: Refresh SAS Content** in the Command Palette) after you have
changed something in SAS Studio or the web client and want the tree to catch up.
It also refreshes itself when you switch connection profile or sign in or out.

## When the view is empty

- **"Add a SAS Viya connection profile…"** — no profile is configured. Add one;
  see [connection profiles](connection-profiles.md).
- **"Sign in to SAS Viya…"** — you have a profile but no active session. Run
  **Python on Viya: Sign In**. The tree never opens a sign-in prompt on its own
  — it will not interrupt you with a browser window just because you clicked a
  folder.
- **A folder that will not expand** — if Viya refused the listing (a permission,
  or the folder was removed), the view shows nothing under it and the reason is
  in **Python on Viya: Show Log**, not a pop-up.
- **A file that will not open or save** — the error appears where you would
  expect it (a notification for an open, the Save flow for a save), with the
  detail in **Python on Viya: Show Log**. A refused save almost always means the
  file changed on the server; reopen it.

## Where the details are

- [Signing in](signing-in.md) — the session the tree reads through.
- [ADR-0026](adr/0026-content-adapter-shape.md) — why there is one content
  adapter and no factory or model layer, and why the listing is ordered by the
  extension rather than the server.
- Probe findings 97–101 and 6.1–6.15 in
  [`docs/phases/phase-6.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-6.md)
  — the live Folders/Files wire shapes this is built from: the `ETag`/`If-Match`
  round trip behind the save guard (6.1–6.2), the create/rename/delete request
  shapes (6.3–6.9), the move (6.10), favourites (6.13), and recycle / restore /
  empty-bin (6.14–6.15), probed against Viya 4.
