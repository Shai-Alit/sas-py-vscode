# Browsing SAS Content

Once you have [signed in](signing-in.md), the **Python on Viya** activity-bar
icon opens a **SAS Content** view — the same folders you would see in SAS
Studio's **Explorer**, read from the Viya Folders and Files services.

You can browse the tree, refresh it, and **open and save files**. Creating,
renaming, moving and deleting content are later releases.

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
other non-file items in the tree do not open this way.

Saving is guarded against overwriting someone else's change. If the file was
modified on the server — in SAS Studio, the web client, or another editor —
after you opened it, the save is **refused** with a message asking you to close
the file and open it again to pick up the current version. There is no merge or
force-save; reopening is the way to get back in sync.

A file you have open is not watched for server-side changes while it sits in the
editor — the check happens when you save, and a fresh open always fetches the
latest.

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
- Probe findings 97–101 and 6.1–6.2 in
  [`docs/phases/phase-6.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-6.md)
  — the live Folders/Files wire shapes this is built from, including the
  `ETag`/`If-Match` round trip behind the save guard (findings 6.1–6.2).
