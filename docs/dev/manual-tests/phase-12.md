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
