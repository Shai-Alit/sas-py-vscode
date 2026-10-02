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

## Changing files and folders

Right-click a folder for **New Folder** and **New File**, or a file or
folder for **Rename** and **Delete**. To move something, drag it onto
another folder. A name already used in the folder is refused rather than
replaced.

**Delete is permanent.** The SAS server has no recycle bin, and deleting a
folder deletes everything inside it. You are asked to confirm first.

The top folder cannot be renamed, moved or deleted. A folder the server
marks read-only, such as the server's root, `/`, offers nothing that creates
files in it.

These all work while your Python runs.

If you rename or move a file that is open in an editor, close that editor:
it still points at the old path, so saving it fails. Reopen the file from
its new place.

## Uploading and downloading

- **Upload Files...**, on a folder: pick one or more files on your computer
  to copy into it. A file whose name is already used in the folder is not
  uploaded.
- **Download...**, on a file or folder: pick a folder on your computer to
  save it into. A folder comes with everything inside it. If something of
  the same name is already there, you are asked before files are
  overwritten.

Each file can be up to 100 MB. A download leaves out anything whose name
your computer cannot use, any folder more than 32 levels deep, and the
rest of any folder with more entries than the view can list, and the
summary says how many items it left out. The **Python on Viya** log says
which ones, and why.

Your SAS administrator can turn downloads off for a compute context. If
they have, **Download...** is not offered.
