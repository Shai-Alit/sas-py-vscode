# Browsing the SAS server

Once you have [connected](connecting.md), the **Python on Viya** activity-bar
icon also shows a **SAS Server** view: the files and folders on the compute
server your session runs on. These are different from
[SAS Content](browsing-sas-content.md), which lives in Viya's own content
store. A file here is one your Python code can open with `open()` by its
path.

## What the tree shows

The tree starts at one folder, **Home**. Expand it to see what is inside,
folders first, then files, each sorted by name. Click a file to open it in an
editor. Hover over an item to see its full path, and right-click it and choose
**Copy Path** to copy it, ready to paste into Python.

The view uses the session you connected. It never starts one on its own: if
you have not connected, it shows a **Connect** prompt instead. It keeps
working while your Python runs, so you can browse and save during a long run.

Files and folders whose names start with `.` are hidden. Turn on
`pythonOnViya.sasServer.showHiddenFiles` to show them.

The server decides what you can see. On some deployments the top folder
lists only a few folders, and a folder the server will not show behaves as
if it were not there.

## Where the tree starts

By default the tree starts at the server's root, `/`. To start somewhere
else, set two fields in your [connection profile](connection-profiles.md#where-the-sas-server-view-starts):

```json
"fileNavigationRoot": "CUSTOM",
"fileNavigationCustomRootPath": "/mnt/shared/project"
```

The tree's top folder is then labelled `project`. If your SAS administrator
has set a starting folder on the compute context, theirs is used instead of
yours.

## Editing a file

Save an open file as usual, and it is written back to the server. If someone
else changed the file after you opened it, the save is refused, so their
change is not lost. Copy your edits, reopen the file and apply them again.

A file larger than 10 MB does not open in the editor.

If your session ends, for example after a while without use, an open
file can still be saved: connect again, then save.

## What is not here yet

Creating, renaming, moving and deleting files and folders, and uploading and
downloading them, are coming in a later release.
