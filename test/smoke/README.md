# Release smoke test

A quick hands-on pass over an **installed** build of the extension (from the
Marketplace or a `.vsix`), to be relatively sure a release works end to end.
It is not exhaustive and not part of any automated suite — nothing in
`npm test` reads this folder.

Set the run target to a Viya profile (status bar, or **Python on Viya: Select
Run Target**) and work through the steps in order.

| File | How to run | What it covers |
| --- | --- | --- |
| `release_smoke.py` | **Run File**, then **Run File** again | fresh namespace, OBS reset between jobs, submission fidelity (`endsubmit;`, `&`/`%`, non-ASCII), printed output complete and in order, `sd2df`/`df2sd`/`submit`/`symput`/`symget`/`sasfnc`, Result panel (`SAS.show`, ODS procs, written files, CSP), CAS token file, package versions |
| `release_smoke_traceback.py` | **Run File**, then **Run Selection** | failure reporting, traceback frame links, Problems panel, selection line offset |
| `release_smoke_cancel.py` | **Run File**, then **Cancel** | local cancel, the "SAS may still be finishing" note, the next run waiting for the session |
| `release_smoke_sgplot.py` | **Run File**, twice | printed output and the traceback survive a `SAS.submit` whose last step is `PROC SGPLOT` (fails on v0.1.4, fixed in 0.1.5) |
| `release_smoke.ipynb` | kernel **Python on Viya**, **Run All** | notebook session, cell state, rich output and SVG note, HTML sanitizer, interrupt, cell Problems entry |

Each automated check prints `PASS`, `FAIL` or `SKIP`, and the summary raises if
anything failed. `LOOK` lines name something to confirm by eye. Run
`release_smoke.py` **twice**: the OBS check only means something on the second
run, since the first run deliberately leaves `options obs=0;` behind for it.

Before committing either file, make sure nothing deployment-specific is in it:
**Clear All Outputs** in the notebook, and don't leave an inserted CAS snippet
(it carries the internal CAS host) in any file here.

## Steps

1. **Sign in and connect.** Status bar shows the profile; **Show Log** has no
   errors.
2. **`release_smoke.py`** — Run File twice. Output channel ends with
   `Finished.` and the summary shows no `FAIL`. Confirm each `LOOK` item.
3. **Run Selection.** In `release_smoke.py`, select the two
   `_smoke_counter` lines and **Run Selection** twice: the counter prints 2,
   then 3. Then **Run Selection in Interactive Window** twice: a window opens
   beside the editor with two cells.
4. **Reset Python State**, then Run Selection on the counter lines again: it
   prints 1.
5. **`release_smoke_cancel.py`** — follow the file's header comment.
6. **`release_smoke_traceback.py`** and **`release_smoke_sgplot.py`** —
   follow the numbered steps in each file's header comment.
7. **`release_smoke.ipynb`** — Run All, then the two manual cells as the
   notebook's own markdown describes.
8. **SAS Libraries view.** Refresh, expand **WORK**, open **SMOKE_CLASS**
   (written in step 2): the grid loads, sorts, filters. Check **Table
   Properties** and **Export to CSV**. Drag the table into a `.py` editor and
   pick **Read directly**: a `smoke_class_df = SAS.sd2df(...)` line is
   inserted.
9. **SAS Content view.** Expand **My Folder**, create a folder, create a
   file in it, open, edit and save it, rename it, then delete the folder and
   restore it from **Recycle Bin**.
10. **CAS view.** Expand a server and a caslib; open a table in the grid.
11. **CAS from Python.** Run **Refresh CAS Token** and Run File on
    `release_smoke.py` again: the CAS token check turns from `SKIP` to
    `PASS`. For a live connection, open a new **untitled** Python file, run
    **Insert CAS Connection Snippet**, add `print(conn.serverstatus())`, and
    Run File. Close it without saving.
12. **Environment.** **Show Environment** opens the package document with a
    Local comparison section; **Search Environment** filters as you type.
13. **Sign Out**: Problems entries from Run File clear; the status bar
    shows signed out.

If a step fails, note the version from the Extensions view and what you saw,
and check **Show Log** before filing it.
