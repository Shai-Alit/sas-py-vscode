# Browsing SAS Content

Once you have [signed in](signing-in.md), the **Python on Viya** activity-bar
icon opens a **SAS Content** view — the same folders you would see in SAS
Studio's **Explorer**, read from the Viya Folders and Files services.

This release is **read-only**: you can browse the tree and refresh it. Opening a
file into the editor, and creating, renaming, moving or deleting content, are
later releases.

## What the tree shows

Four top-level folders, matching SAS Studio:

- **My Favorites** — the shortcuts you have favourited.
- **My Folder** — your personal folder.
- **SAS Content** — every folder that has no parent (the shared top level).
- **Recycle Bin** — content you have deleted but not yet purged.

Expanding any folder lists its sub-folders and files, loaded on demand — nothing
is fetched until you open a folder. Folders sort before files, then by name.

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

## Where the details are

- [Signing in](signing-in.md) — the session the tree reads through.
- [ADR-0026](adr/0026-content-adapter-shape.md) — why there is one content
  adapter and no factory or model layer, and why the listing is ordered by the
  extension rather than the server.
- Probe findings 83–87 in
  [`docs/phases/phase-6.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-6.md)
  — the live Folders/Files wire shapes this is built from.
