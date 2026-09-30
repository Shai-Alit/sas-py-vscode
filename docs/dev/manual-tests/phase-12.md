<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 12 (AI-agent integration)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## 12e — CSV formula-injection guard

`pythonOnViya.csvExport.guardFormulaInjection`, off by default, covers both
CSV export surfaces (SAS Libraries and CAS). See `docs/phases/phase-12.md`'s
12e Runbook entry for the design; §11.17–§11.21 (`phase-11.md`) already cover
ordinary CSV export and are not repeated here.

- [x] **12.1** **The guard is off by default — a formula-shaped cell is
  written untouched.** With `pythonOnViya.csvExport.guardFormulaInjection`
  left at its default (unset/`false`), export a SAS library table with a
  character column value that starts with `=`, `+`, `-`, or `@`. A quick way
  to build a table that serves 12.1–12.8 (run it in a `.py` file against a
  Viya profile, then export `work.test`):

  ```python
  SAS.submit("""
  data work.test;
    length name $ 40;
    age = 12;
    name = '=SUM(A1:A9)';  output;
    name = '+1 (555) 0100'; output;
    name = '-drwxr-xr-x';  output;
    name = '@handle';      output;
    name = '=a,b';         output;
    name = '09'x || '=1+1'; output;
    name = 'Alfred';       age = -5; output;
  run;
  """)
  ```

  **Expect:** the file opens in a text editor showing each value exactly as
  entered, no leading `'`.
 
- [x] **12.2** **Turn the guard on and repeat for a SAS library table.**
  Set `pythonOnViya.csvExport.guardFormulaInjection` to `true` (workspace or
  user setting), then export the same table again. **Expect:** the
  formula-shaped cell now has a leading `'` in the file; opening it in Excel
  or Google Sheets never evaluates it as a formula (no formula result/error).
  Google Sheets is expected to also drop the `'` and show the literal text; if
  Excel instead leaves the `'` visible after the file is saved and reopened,
  that is the known OWASP-documented Excel caveat, not a bug in this guard —
  see `docs/browsing-sas-libraries.md`'s Export to CSV section. A plain text
  value elsewhere in the same column is unaffected.
- [x] **12.3** **A negative number is never touched, guard on.** In the same
  export, confirm a numeric column's negative value (e.g. `-5`) has **no**
  leading `'` — it still opens as a number, not text, in a spreadsheet.
- [x] **12.4** **Repeat 12.2/12.3 for a CAS table**, guard on. `SAS.submit`
  runs on compute, not CAS, so build the same data as 12.1 through SWAT:
  run **Python on Viya: Insert CAS Connection** first to get the
  authenticated `conn = swat.CAS(...)` lines, then the code below in the same
  file. Refresh the CAS tree, then right-click `casuser.test` and export to
  CSV. `promote=True` makes the table global so the CAS tree, which uses its
  own CAS session, can see it:

  ```python
  import pandas as pd

  df = pd.DataFrame(
      {
          "name": [
              "=SUM(A1:A9)",
              "+1 (555) 0100",
              "-drwxr-xr-x",
              "@handle",
              "=a,b",
              "\t=1+1",
              "Alfred",
          ],
          "age": [12, 12, 12, 12, 12, 12, -5],
      }
  )
  conn.upload_frame(
      df, casout=dict(name="test", caslib="casuser", promote=True)
  )
  ```

  **Expect:** the same leading-`'` behaviour as 12.2 (including the
  tab-prefixed row from 12.8), and the same untouched-negative-number
  behaviour as 12.3 for the numeric `age` column.
  **(9/23/2026) fail** Multiple problems, number 1 may be the root cause of number 2. 
  Both problems were recreated at least twice, and the same tests passed multiple times
  for SAS libraries.
  1 - this might have been here for a while but the name and age data are swapped, 
  so the name column contains the ages and the age column contains the names. 
  2 - there is no guard. all of the values are non-guarded including the "=a,b" 
  and negative number. 
  **Root cause found and fixed, 2026-09-23 — re-run against a build with the
  fix.** Both problems had one cause: the extension listed a CAS table's
  columns alphabetically (`age`, `name`) while each row's cells come in table
  order (`name`, `age`). That swapped the headers, and the guard checked each
  cell against the other column's type, so the text column was never guarded.
  See B12.2 and Finding 12.6 in `docs/phases/phase-12.md`.
  **(9/23/2026) pass** on re-run against a build with the fix: headers match
  their data, the formula-shaped `name` values (including `=a,b` and the
  tab-prefixed row) are guarded, and `-5` is untouched.
- [x] **12.5** **The header row is never guarded.** Whichever export above is
  handy, confirm the first (header) line's column names have no leading `'`
  even when the guard is on — only data rows are ever guarded.
- [x] **12.6** **A field that already needs RFC-4180 quoting still guards
  correctly.** Export a table with a character value that both starts with a
  formula-triggering character and contains a comma (e.g. `=a,b`). **Expect:**
  the file shows `"'=a,b"` — the leading `'` inside the quotes, not instead of
  them.
- [x] **12.7** **Setting change takes effect on the next export, no reload.**
  Toggle the setting and export the same table twice in the same window
  session, once each way. **Expect:** no reload needed; each export reflects
  whatever the setting reads at the moment **Export to CSV** was clicked.
- [x] **12.8** **A value beginning with a tab is guarded too, guard on.** A
  tab-only prefix check is the exact gap CVE-2021-41270 (Symfony) shipped
  with — the tab hid the formula from a naive `=`/`+`/`-`/`@`-only check
  while Excel still evaluated it. The `work.test` table from 12.1 already
  has a row whose `name` is a literal tab (`'09'x`) followed by `=1+1`;
  export it with the guard on. **Expect:** that row's cell starts with `'`
  immediately before the tab, and opening the file does not evaluate `=1+1`.
- [x] **12.9** **A CAS table's columns show in table order everywhere.** The
  12.4 fix changes the column order shared by the CAS tree, the data viewer and
  CSV export. Using 12.4's `casuser.test`: expand it in the CAS tree, then open
  it in the data viewer. **Expect:** the tree lists `name` before `age` (it
  used to list them alphabetically), and in the viewer the `name` column holds
  the text values and `age` holds the numbers — not swapped.

## 12f — three Phase 11 follow-ups

See `docs/phases/phase-12.md`'s "12f built" Runbook entry and Findings
12.11/12.12.

- [x] **12.10** **A large SAS library table asks before exporting.** Build a
  table above 100 MB as CSV in a `.py` file against a Viya profile — Finding
  12.12's shape at 400,000 rows is about 120 MB:

  ```python
  SAS.submit("""
  data work.big;
    length c1-c10 $24;
    array c{10} $ c1-c10; array n{10} n1-n10;
    do i = 1 to 400000;
      do j = 1 to 10; c{j} = cats('val_', put(i*j, z12.), '_x'); n{j} = i*j/7; end;
      output;
    end;
    drop i j;
  run;
  """)
  ```

  Refresh SAS Libraries, then **Export to CSV** on `WORK.BIG`. **Expect:**
  a modal naming 400,000 rows and an estimated size above 100 MB, with
  **Export anyway**, before anything is written. Dismiss it: nothing
  happens, no file, no error. (11.19/11.20's CAS behaviour, on the library
  side.)
- [x] **12.11** **A small SAS library table still exports without asking.**
  Export `SASHELP.CLASS`. **Expect:** no modal; the CSV is written as
  before.
- [x] **12.12** **A bad autoExec line's error text reaches the user.** Use
  11.26's profile setup (`"autoExec": [{"type": "line", "line": "this is not
  valid sas;"}, {"type": "line", "line": "%let P11E=after;"}]`), disconnect,
  connect. **Expect:** the session connects; the message quotes `ERROR
  180-322: Statement is not valid or it is used out of proper order.`; the
  Python on Viya log has a `Session startup log:` line with that same text
  and **no** line containing `this is not valid sas;`, `----` or a bare
  `180`.
- [x] **12.13** **A clean autoExec stays quiet.** Replace the bad line with
  `%let a=1;`, disconnect, connect. **Expect:** no startup message and no
  `Session startup log:` lines.

## 12g — the "resuming Python state" `NOTE`

See `docs/phases/phase-12.md`'s "12g run" Runbook entry and Finding 12.13.

- [x] **12.14** **No Python-state `NOTE` ever reaches the transcript.** On a
  freshly connected profile, in a `.py` file containing `x = 1` and
  `print(globals().get("x"))`:
  1. **Run Selection** on `x = 1`, then on the `print` line. **Expect:** `1`.
  2. **Run File**. **Expect:** the interpreter banner, then `1`.
  3. **Reset Python State**, then **Run Selection** on the `print` line.
     **Expect:** `None`, with no banner.

  **Expect, throughout:** **Python on Viya: Output** never shows
  `Resuming Python state`, `Previous Python state destroyed` or
  `Python initialized`.

## 12j — inline graphics through the ODS wrapper

See `docs/phases/phase-12.md`'s "12j built" Runbook entry, Finding 12.16 and
[ADR-0038](../../adr/0038-every-run-is-wrapped-in-a-named-ods-destination.md).
All items need a Viya 2025.03 or later deployment, since `SAS.show` is new in
that release. Start with this in a `.py` file against a Viya profile:

```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.figure()
plt.plot([1, 2, 3], [3, 1, 2])
plt.title("12j figure")
SAS.show(plt, filetype="png")
```

- [x] **12.15** **A `SAS.show` figure reaches the Result panel.** Run File.
  **Expect:** the Result panel opens with the figure. **Python on Viya:
  Output** shows no `ods` statement, no `Writing HTML5(VSCODE) Body file`
  line, and nothing else new.
  **(9/25/2026) note** the output does show a message saying
  "[an HTML table was produced — see the Result panel]"
  **Expected, 2026-09-25.** That line is the output channel's existing
  placeholder for any `text/html` output (`src/run/outputChannel.ts`), and
  the ODS body is `text/html`. It is not new with 12j; the "nothing else new"
  above meant nothing from the wrapper itself. Pass stands.
- [x] **12.16** **The same figure reaches a notebook cell.** Put the same
  code in an `.ipynb` cell on the same profile and run it. **Expect:** the
  figure renders in the cell's output.
- [x] **12.17** **An SVG figure: shown in the panel, dropped whole in a
  cell.** Change the last line to `SAS.show(plt)`, with no `filetype`. Run
  File, then run the cell. **Expect:** the Result panel shows the figure. The
  cell shows no figure and no stray text: nothing like `image/svg+xml` or
  `Matplotlib v`.
  **(9/25/2026) partial** a regular .py file show the svg. no plot is shown in the notebook - 
  just an "output" banner with nothin under it. 
  no errors reported in the log, output, or problem panel.
  **Cause found, 2026-09-25.** The banner is `SAS.show`'s own
  `title2 'Output'` (its default `title=`), in the ODS body's title block
  above the SVG. The sanitizer dropped the SVG as designed and left the
  banner above a gap. Fixed: a notebook cell now shows a one-line note
  where each SVG figure was. See Finding 12.18. **Re-run expectation:** the
  cell shows the `Output` banner, then `[an SVG figure is not shown in a
  notebook cell — pass filetype="png" to SAS.show]`, and still no
  `image/svg+xml` or `Matplotlib v` text. The Result panel is unchanged.
- [x] **12.18** **A DataFrame and a `SAS.submit()` procedure show as
  tables.** Run:

  ```python
  import pandas as pd
  SAS.show(pd.DataFrame({"a": [1, 2], "b": ["x", "y"]}))
  SAS.submit("proc print data=sashelp.class(obs=3); run;")
  SAS.submit("proc sgplot data=sashelp.class; scatter x=height y=weight; run;")
  ```

  **Expect:** in both the panel and a cell, a two-row table with columns `a`
  and `b`, a three-row `SASHELP.CLASS` listing, then the scatter plot, once.
  No separate `SGPlot.png` output appears.
- [x] **12.19** **A run that shows nothing stays quiet, and a saved file comes
  first.** Close the Result panel, then Run File on `print("only text")`.
  **Expect:** the panel does not open and the cell has only the text. Then
  run a file that calls `plt.savefig("a.png")` and then
  `SAS.show(plt, filetype="png")`. **Expect:** the saved `a.png` first, then
  the `SAS.show` figure.
- [x] **12.20** **A cancelled run's figure never appears later.** Run File on
  the figure code with `import time; time.sleep(30)` added after the
  `SAS.show` line, and cancel it while it sleeps. Then Run File on
  `print("after cancel")`. **Expect:** only `after cancel`; no figure. Then
  run the original figure code. **Expect:** its figure, once.
- [x] **12.21** **A user's own `ods _all_ close;` costs that run's figure
  only.** Add `SAS.submit("ods _all_ close;")` before the `SAS.show` line and
  Run File. **Expect:** the run succeeds, the output shows `WARNING: No output
  destinations active.`, and no figure appears. Remove the line and run
  again. **Expect:** the figure.
- [x] **12.22** **SAS output in one cell never restyles another cell.** Use a
  dark theme. In one notebook, run a cell that raises (`1/0`), then a second
  cell with the figure code above (`filetype="png"`). Run the second cell
  twice more. **Expect:** the first cell's error text stays light every
  time, including while the second cell runs and after it finishes. Then
  run 12.18's code in a cell. **Expect:** its tables use the notebook's own
  table styling, not SAS's white-and-blue style, and stay readable. SAS's
  stylesheet leaked into every output in the notebook and turned other
  cells' text black (Finding 12.18).

## 12k — a failed SAS step no longer poisons the session

See `docs/phases/phase-12.md`'s "12k built" Runbook entry, Finding 12.19 and
[ADR-0039](../../adr/0039-every-job-switches-syntax-check-mode-off.md).
Before 12k, one failed step like the one below made every later run and
Reset Python State fail with the same `Libref CASUSER is not assigned.`
until you reconnected (B12.1). Start each item on a fresh connection.

12.23 checks prevention. On this build the failing step alone never puts
the session in syntax-check mode, because the prefix has already switched
it off. 12.24–12.26 check recovery instead. They start from a session that
is already poisoned, the state an older build or a reattached session
leaves behind. To poison one, Run File on this **poison file**, which
switches the option back on before the failing step:

```python
SAS.submit("options syntaxcheck; data casuser.test; x=1; run;")
```

**Expect:** that run fails with `Libref CASUSER is not assigned.`

- [x] **12.23** **Manual test 12.4's repro, then a later run.** Run File on:

  ```python
  SAS.submit("data casuser.test; x=1; run;")
  print("after the failed step")
  ```

  **Expect:** the run fails with `Libref CASUSER is not assigned.`, and
  `after the failed step` still prints. Then Run File on
  `print("next run")`. **Expect:** it succeeds and prints `next run`, with
  no error. Repeat both in two notebook cells. **Expect:** the same, and
  the second cell shows no error.
- [x] **12.24** **A poisoned session runs the next file.** Run File on the
  poison file, then on `print("next run")`. **Expect:** `next run` prints
  and the run succeeds, with no `Libref CASUSER` error. Before 12k it
  printed nothing and failed with the old error.
- [x] **12.25** **Reset Python State on a poisoned session.** Run File on the
  poison file, then **Python on Viya: Reset Python State**. **Expect:** the
  reset succeeds. The log has no `resetting the interpreter: the backend
  failed` line. Then Run Selection on `print("after reset")`. **Expect:**
  `after reset`.
- [x] **12.26** **The `OBS` restore: a DATA step reads rows again, and a
  user's own `obs=5` survives.** Save this as the **rows file**:

  ```python
  SAS.submit("data work.t; set sashelp.class; run;")
  print(SAS.sd2df("work.t").shape)
  ```

  Run File on the poison file, then on the rows file. **Expect:** `(19, 5)`.
  Without the restore the copy would have no rows, since SAS left `OBS=0`
  (Finding 12.19 counted 0). Then Run File on `SAS.submit("options obs=0;")`, then the rows
  file. **Expect:** `(19, 5)` again, because a deliberate `OBS=0` is reset
  too (ADR-0039). Then Run File on `SAS.submit("options obs=5;")`, then the
  rows file. **Expect:** `(5, 5)`. Finish with Run File on
  `SAS.submit("options obs=max;")`.

## 12l — notebook execution-surface staleness

See `docs/phases/phase-12.md`'s "12l built" Runbook entry and Finding
12.20. Use a saved `.ipynb` file with **Python on Viya** selected as its
kernel.

- [ ] **12.27** **Dropped 2026-09-27, with the sign-out change it tested.**
  Kept as the record of why. **Sign-out clears a notebook cell's Problems
  entry.** Run a
  cell containing:

  ```python
  x = 1
  y = 1 / 0
  ```

  **Expect:** a Problems entry on the cell's second line. Run **Python on
  Viya: Sign Out**. **Expect:** the entry is gone. Before 12l it stayed
  until the notebook was closed.
  **(9/27/2026) fail** entry stayed after sign out. this seems like perfectly
  acceptable behavior. This seems like normal operation. not a defect and not
  sure why this was decided to become an issue. We should not pursue this any
  further.
- [x] **12.28** **The waiting notice names a cancelled cell, then stops.**
  Run a cell that prints nothing for 30 seconds:

  ```python
  import time
  time.sleep(30)
  ```

  Interrupt it after about 3 seconds, then at once run a cell containing
  `print("after")`. **Expect:** after about 3 seconds that cell shows
  `[still no output — SAS Viya may still be finishing the statement a
  cancelled cell was running; this cell starts once it ends]`, and `after`
  prints once the sleep's 30 seconds are up. Then run a cell containing
  `import time; time.sleep(10)`. **Expect:** after about 3 seconds it shows
  `[still no output — this cell is still running]`, with no mention of a
  cancelled cell.
- [x] **12.29** **Closing a notebook mid-run.** Make a two-cell notebook:
  `import time; time.sleep(20); print("done")`, then `print("second")`.
  Save it, then **Run All**, and close the notebook's tab while the first
  cell runs. Wait 25 seconds, then reopen the notebook and run the first
  cell. **Expect:** it runs and prints `done` after 20 seconds, with no
  "already running" refusal. **Output** panel, **Extension Host** channel:
  **Expect:** no `NO notebook document` or `duplicate execution` error from
  this extension.

## 12r — coexisting with the SAS extension

See `docs/phases/phase-12.md`'s "12r built" Runbook entry and Finding 12.21.
The integration suite runs with other extensions disabled, so these items are
the only check with both installed. Install the SAS extension (`sas.sas-lsp`)
and a `.vsix` built from this branch in the same VS Code, each with a
connection profile. Before 12r, one of the two failed to start with
`a provider for the scheme 'sasContent' is already registered` in the
**Output** panel's **Extension Host** channel.

- [x] **12.30** **Python on Viya starts first.** Close the SAS sidebar and
  any `.sas` or `.sasnb` file, then run **Developer: Reload Window**. Wait 30
  seconds, then open the SAS sidebar. **Expect:** the SAS extension's sign-in
  view with its **Sign In** link, not "Your connection does not support SAS
  content navigation". Sign in to SAS and open a file from its SAS Content
  tree. Then connect Python on Viya and run a cell in a `.ipynb` with
  **Python on Viya** as its kernel. **Expect:** both work, and the
  **Extension Host** channel shows no `already registered` error and no
  `Activating extension … failed`.
- [x] **12.31** **The SAS extension starts first.** Leave the SAS sidebar
  open and reload the window. **Expect:** a `.ipynb`'s kernel picker offers
  **Python on Viya**. After connecting, Python on Viya's SAS Content, SAS
  Libraries and CAS views all fill in. The **Extension Host** channel shows
  neither error.
- [x] **12.32** **Files from both trees.** With both signed in, in a trusted
  workspace, and with the run target set to a Viya profile, open a `.py`
  file from Python on Viya's SAS Content view, edit it and save. **Expect:**
  it saves, and the editor title shows Python on Viya's run button but not
  the SAS extension's. Open a recycled `.py` file from Python on Viya's
  Recycle Bin. **Expect:** it opens read-only. Then open a file from the SAS
  extension's SAS Content tree, and a recycled file from its Recycle Bin.
  **Expect:** both open, the second as a read-only preview.

## 12m — the Python startup snippet

See `docs/phases/phase-12.md`'s "12m built" Runbook entry, ADR-0041 and
Findings 12.22 and 12.23. Build a `.vsix` from this branch. In
`settings.json`, give the profile you test with:

```json
"pythonStartup": [
  { "type": "line", "line": "import math as m" },
  { "type": "line", "line": "STARTUP_OK = 1" },
  { "type": "line", "line": "print('startup printed')" }
]
```

Then run **Python on Viya: Disconnect** and connect again, so the session is
a new one.

- [x] **12.33** **A new session is seeded.** Before any Run File, run
  **Run Selection** on `print(m.pi, STARTUP_OK)`. **Expect:** `3.14159…  1`,
  and no `startup printed` line anywhere in the output.
- [x] **12.34** **Run File keeps it.** Run File on a file holding
  `print(m.sqrt(16), STARTUP_OK)`. **Expect:** `4.0 1`. Before 12m, this
  was a `NameError`.
- [x] **12.35** **Reset Python State keeps it, and clears the rest.** Run
  Selection on `X = 5`, then **Reset Python State**, then Run Selection on
  `print(STARTUP_OK)` and then on `print(X)`. **Expect:** the reset succeeds
  with no error, `1` prints, and `X` is a `NameError`.
- [x] **12.36** **A `__future__` import and line numbers.** Run File on:

  ```python
  from __future__ import annotations
  x: SomethingUndefined = 1
  print(STARTUP_OK)
  1 / 0
  ```

  **Expect:** `1`, then a `ZeroDivisionError` whose Problems entry points at
  line 4.
- [x] **12.37** **A failing snippet.** Add
  `{ "type": "line", "line": "raise ValueError('startup broke')" }` as the
  last entry, then Disconnect and connect. Run File on
  `print("user ran", STARTUP_OK)`. **Expect:** `user ran 1`, then one line
  saying the profile's Python startup snippet failed with
  `ValueError: startup broke`. The run reports success, and the
  **Python on Viya** log (**Show Log**) holds the snippet's traceback. Then
  run **Reset Python State**. **Expect:** an error naming the startup
  snippet's failure. Remove the entry before going on.
- [x] **12.38** **A reloaded window.** Change `STARTUP_OK = 1` to
  `STARTUP_OK = 2` and run **Developer: Reload Window**. The extension
  reattaches to the same session. Run File on `print(STARTUP_OK)`.
  **Expect:** `2`, with no error; the session's existing snippet fileref was
  rewritten in place.
- [x] **12.39** **A notebook.** Open a new `.ipynb`, pick **Python on
  Viya** as its kernel, and run a first cell holding `print(STARTUP_OK)`.
  **Expect:** `2`. A notebook has its own session (ADR-0035), and it is
  seeded too.
- [x] **12.40** **An unreadable file entry.** Add
  `{ "type": "file", "filePath": "C:/no/such/startup.py" }`, then Disconnect
  and connect. **Expect:** a message that the Python startup file could not
  be read and was skipped, and a connect that goes ahead; Run File on
  `print(STARTUP_OK)` still prints `2`.

## 12n — a reusable CAS connection

See `docs/phases/phase-12.md`'s "12n built" Runbook entry and Finding 12.25.
Build a `.vsix` from this branch. The compute context needs `swat`. Leave
`pythonOnViya.cas.tokenFileref` unset, then **Disconnect** and connect
again, so the session is a new one.

- [x] **12.41** **The default name.** Open a `.py` file and run **Insert CAS
  Connection Snippet**. **Expect:** the inserted snippet opens
  `open("CASTOKEN")`. Add `print(conn.serverstatus().severity)` below it and
  Run File. **Expect:** `0`.
- [x] **12.42** **Run again, same session.** Run the command again into a
  second, empty `.py` file. **Expect:** the same `open("CASTOKEN")` and no
  error; Run File on the first file still prints `0`, now with the new token.
- [x] **12.43** **A reloaded window.** First Run Selection on
  `open("reload-marker.txt", "w").write("x")`, which leaves a file in the
  session's run directory. Run **Developer: Reload Window**, which reattaches
  to the same session. Run Selection on
  `import os; print(os.path.exists("reload-marker.txt"))`. **Expect:** `True`,
  so the window reattached to the same session and `CASTOKEN` from 12.41 is
  still held. Then run the command again. **Expect:** no error, and Run File
  on the 12.41 file prints `0`. This window did not create `CASTOKEN`; it
  found it and rewrote it.
- [x] **12.44** **A name from the setting.** Set
  `"pythonOnViya.cas.tokenFileref": "teamtok"` in the workspace settings and
  run the command. **Expect:** `open("TEAMTOK")`, and Run File prints `0`.
- [x] **12.45** **A name the command refuses.** Set the setting to `PYVSTART`
  (the Settings UI marks it; save it anyway in `settings.json`) and run the
  command. **Expect:** an error naming `pythonOnViya.cas.tokenFileref` and
  `PYVSTART`, and nothing inserted. Set it to `SASTOK` before going on.
- [x] **12.46** **A name your SAS code holds.** Run Selection on
  `SAS.submit("filename sastok temp;")`, then run the command. **Expect:** an
  error that the session already has a fileref named `SASTOK` that the
  extension did not create, suggesting `filename SASTOK clear;`, and nothing
  inserted. Run Selection on `SAS.submit("filename sastok clear;")`, then run
  the command again. **Expect:** `open("SASTOK")`, and Run File prints `0`.
  Remove the setting afterwards.
- [x] **12.47** **Refresh CAS Token.** With no Python file open (a Markdown
  file active, say), run **Python on Viya: Refresh CAS Token**. **Expect:**
  a notification that the token in `CASTOKEN` is refreshed, and nothing
  inserted anywhere; Run File on the 12.41 file still prints `0`.
- [x] **12.48** **A new session, then Refresh.** **Disconnect** and connect,
  then Run File on the 12.41 file. **Expect:** a `FileNotFoundError` for
  `CASTOKEN`, since the new session has no token file. Run **Refresh CAS
  Token**, then Run File again. **Expect:** `0`.
