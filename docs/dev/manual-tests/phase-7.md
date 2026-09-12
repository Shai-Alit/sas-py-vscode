<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 7 (Libraries and data viewer)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## SAS Libraries — browsing your session (phase 7a)

A second, independent tree in the same activity-bar container Phase 6 added,
reading the *active compute session's* own libraries and tables
([ADR-0027](../../adr/0027-library-adapter-shape.md)) — unlike SAS Content
(Phase 6), which reads a deployment-wide Folders/Files service and needs no
session at all. **Not yet run** — this section and §11 are new for Phase
7a/7b and have no prior pass to compare against; every box below is a first
assertion, not a re-check.

**Pre-work:** a Viya connection, the same one §4 sets up — sign in and
**Connect to SAS Viya** first, so a compute session actually exists. You do
not need any table of your own: **SASHELP**, a system library, ships with
every Viya deployment and is what every example below uses. If your
deployment happens to lack it, substitute any library/table you can see.

- [x] **7.1** **The view exists and reflects connection state** — open the **Python
  on Viya** icon in the Activity Bar.
  **Expect:** two views stacked in the same container — **SAS Content**
  (Phase 6) above, **SAS Libraries** below. Before any profile is configured,
  SAS Libraries shows "Add a SAS Viya connection profile to browse
  libraries." with a clickable **Add Connection Profile** link. Signed out
  with a profile configured, it instead reads "Sign in to SAS Viya to browse
  libraries." Signed in but not connected, it reads "Connect to SAS Viya to
  browse libraries in your session." Each message's link does what it says.
- [x] **7.2** **Connecting populates the tree** — with a profile signed in, run
  **Connect to SAS Viya** (§4).
  **Expect:** SAS Libraries now lists at least **SASHELP** and **WORK**, each
  with a database icon and a collapsed expand chevron — no welcome text
  remains.
- [x] **7.3** **Expanding a library lists its tables** — click the chevron next to
  **SASHELP** to expand it.
  **Expect:** a list of tables appears, each with a different icon than the
  library had (no database icon, no expand chevron — a table is always a
  leaf this phase). SASHELP alone can hold several hundred tables on a stock
  deployment; if the list is long, that is expected, not a bug.
- [x] **7.4** **Refresh reloads the tree** — click the refresh icon in the SAS
  Libraries title bar (hover the view's header if you don't see it), or run
  **Refresh SAS Libraries** from the Command Palette.
  **Expect:** the tree reloads. If nothing changed on the server, the visible
  list looks the same — that is a pass, not a no-op failure.
- [x] **7.5** **The tree follows connection changes on its own** — with SAS
  Libraries populated, run **Disconnect from SAS Viya**, then **Connect to
  SAS Viya** again (optionally to a different profile, if you have two).
  **Expect:** the tree updates by itself — empty (welcome text) right after
  Disconnect, repopulated after Connect — without you pressing Refresh.
- [x] **7.6** **A busy session refuses browsing instead of hanging** — start a
  long-running selection first: open a `.py` file, type `import time;
  time.sleep(30)`, select it, and **Run Selection** (§6 has the mechanics if
  this is unfamiliar). While that run is still going, run **Refresh SAS
  Libraries**, then try expanding a library you have not yet expanded this
  session.
  **Expect:** nothing new appears, and neither action hangs for the run's
  30 seconds — it returns immediately with nothing changed. Open **Show
  Log**: you should see a line reading `SAS Libraries: the compute session is
  running Python and cannot be browsed right now`. Once the run finishes,
  repeat the refresh/expand and confirm it now works normally.
- [x] **7.7** **Disconnecting empties the tree cleanly** — run **Disconnect from SAS
  Viya**.
  **Expect:** SAS Libraries returns to its "Connect to SAS Viya…" welcome
  text; no stale library or table entries are left showing.


## Data viewer webview (phase 7b)

Clicking a table in SAS Libraries (§10) opens it in a scrollable grid — a
second webview panel this project ships, built with React and
`ag-grid-community` rather than hand-rolled DOM
([ADR-0028](../../adr/0028-data-viewer-is-react-and-ag-grid.md)), reading
through `LibraryAdapter.openTable`/`getColumns`/`getRows`
(`docs/phases/phase-7.md`). **Not yet run** — no prior pass exists for this
section either; see §10's own note.

**Pre-work:** the same live connection as §10 — SAS Libraries populated,
**SASHELP** expanded. This section's running example is **SASHELP.CLASS**: a
small, standard table (19 rows; columns Name and Sex as text, Age, Height and
Weight as numbers) that every live probe and automated test in this phase
already uses, so its exact shape is known ahead of time. If you'd like to
also see a grid actually page (§11's fourth box), pick a second, larger
SASHELP table too — anything with more than a couple hundred rows will do.

- [x] **7.8** **Clicking a table opens it** — expand **SASHELP**, then click
  **CLASS** (a plain click, the same as opening a file — not a right-click
  action).
  **Expect:** a new tab opens in the editor area titled `SASHELP.CLASS`.
  Briefly nothing is visible, then a grid appears with five columns — Name,
  Sex, Age, Height, Weight — populated with data, 19 rows in total.
- [x] **7.9** **The right-click menu does the same thing** — right-click a
  *different* table and choose **Open Table**.
  **Expect:** identical result to the box above, just reached from the
  context menu instead of a click.
- [x] **7.10** **Numbers are right-aligned, text is not** — look at the open
  **SASHELP.CLASS** grid.
  **Expect:** the Age, Height and Weight columns are right-aligned; Name and
  Sex are left-aligned — the ordinary spreadsheet convention, and something
  this phase's own review added (the column's type was being carried across
  the wire from the start, but nothing actually read it to align anything
  until caught in review).
- [x] **7.11** **Every row is really there** — scroll the **SASHELP.CLASS** grid all
  the way to the bottom.
  **Expect:** exactly 19 rows, no gaps, no blank rows, nothing repeated. The
  scrollbar should already be sized as though the grid knows the true total
  from the start, not growing in size as you scroll further down.
- [x] **7.12** **A larger table actually pages as you scroll (slow)** — open your
  second, larger table (see this section's pre-work) and scroll down steadily
  past the first couple hundred rows.
  **Expect:** new rows keep appearing smoothly as you reach the bottom of
  what's loaded so far; there is a brief pause the first time each new block
  loads, but no permanent stop partway through, and no error.
- [x] **7.13** **Opening an already-open table reveals it, not a duplicate** — with
  **SASHELP.CLASS** already open, click **CLASS** again from the tree.
  **Expect:** VS Code switches focus to the existing tab; no second
  `SASHELP.CLASS` tab is created.
- [x] **7.14** **Two different tables stay independent** — open a second, different
  table alongside **SASHELP.CLASS**.
  **Expect:** two separate tabs, each showing its own data; closing one
  leaves the other exactly as it was, still scrolled where you left it.
- [x] **7.15** **A busy session shows the reason in the panel, not a blank grid** —
  start the same `time.sleep(30)` selection as §10's busy-session box, and
  while it runs, open a table you have **not** already opened this session.
  **Expect:** the tab opens, but instead of a grid you see a short message
  explaining that the session is busy running Python and cannot be browsed —
  in the panel itself, not only in the log.
- [x] **7.16** **Closing a panel while it is still loading does not error** — open a
  table you have not opened before, and close its tab immediately (within
  about a second, before the grid has had time to appear).
  **Expect:** no error notification, nothing alarming in **Show Log**; open a
  different table afterward to confirm the extension is still working
  normally.
- [x] **7.17** **Switching away and back does not scramble the data** — with a table
  open and scrolled partway down, click into a code editor tab (so the panel
  is hidden), then click straight back to the table's own tab quickly — within
  a second or two, ideally while a scroll-triggered fetch might still be in
  flight.
  **Expect:** the grid visibly reloads (a brief flash/refetch is expected —
  the panel does not preserve its state while hidden) and then shows the
  correct rows for wherever you land — never rows that belong to a different
  scroll position. This is the hand-run version of a `requestId`-collision
  defect found and fixed in code review; rows that don't match where you
  scrolled to is exactly that regression coming back.
- [x] **7.18** **Legible in every theme** — with a table open, switch VS Code between
  a light theme, a dark theme, and a high-contrast theme (Command Palette →
  **Preferences: Color Theme**).
  **Expect:** text and grid lines stay readable in all three, and nothing in
  the grid (column headers, the loading indicator, resize handles) shows as a
  visibly broken/missing icon — this panel's Content-Security-Policy
  deliberately allows no image loading at all, on the prediction that
  `ag-grid` needs none; a broken icon here means that prediction was wrong,
  which is itself worth reporting, not just a cosmetic nit.
- [x] **7.19** **(known gap, closed by phase 7c-i) No sort or filter yet in this
  slice** — look for either on an open table.
  **Expect (7b):** neither exists — Phase 7c, not this slice. See §12 for
  7c-i's own pass, now that sort and filter exist. CSV export and a table
  properties view remain Phase 7c-ii/iii, still absent as of this pass.


## Sort and filter in the data viewer (phase 7c-i)

Adds column sort (click a header) and a free-text filter box above the grid
to the data viewer §11 already covers — both server-side
([ADR-0029](../../adr/0029-sort-view-lifecycle.md)), neither client-side.
**Sean's own first pass ran 2026-09-10** and found three real bugs, all now
fixed on the `phase-7c-i-sort-filter` branch, not yet re-verified against a
real panel: a sort or filter was silently lost switching away from the
table's tab and back (`retainContextWhenHidden: false` reloads the webview
document on every hide/show, and the freshly mounted grid had no way to tell
the host it should keep whatever sort/filter the previous document had — see
the two new rows below, added for this), and an invalid filter showed a
blank grid with no error or warning anywhere, not even the log (the host
already computed a real, specific message — Finding 7.18 — but
`dataViewerEntry.tsx`'s own datasource was discarding it — see the
now-unchecked row below). Every other row below was validated clean by that
same first pass and stays checked: the fix for the three bugs above touched
no code path any of them exercises. See `phase-7.md`'s 7c-i Runbook entry
for the full account.

**Pre-work:** the same live connection and open **SASHELP.CLASS** table as
§11.

- [x] **7.20** **Clicking a column header sorts the grid** — with **SASHELP.CLASS**
  open, click the **Age** column header.
  **Expect:** a brief pause, then the grid re-renders sorted by Age
  (ascending — an arrow or similar indicator appears in the header). Click
  the same header again for descending.
- [x] **7.21** **Sorting scrolls to the top** — with the grid scrolled partway down,
  click a different column's header to change the sort.
  **Expect:** the grid returns to the top and shows the newly sorted rows
  from the start, not a stale scroll position over now-reordered data.
- [x] **7.22** **The filter box applies a SAS `WHERE` clause** — type
  `Sex='F'` (including the quotes) into the filter box above the grid and
  press Enter.
  **Expect:** the grid reloads showing only the 9 female students from
  **SASHELP.CLASS**; the row count (if visible) drops accordingly.
- [x] **7.23** **Sort and filter combine** — with the filter from the box above still
  applied, click the **Age** column header.
  **Expect:** the grid shows only the filtered (female) rows, now also
  sorted by Age — not all 19 rows, and not the filter silently dropped.
- [x] **7.24** **Clearing the filter box restores every row** — select all the text in
  the filter box, delete it, and press Enter.
  **Expect:** all 19 rows return (still sorted, if a sort is still active).
- [x] **7.25** **An invalid filter expression shows a real error, not a blank grid** —
  type `NoSuchColumn=1` into the filter box and press Enter.
  **Expect:** the grid shows an error (in the panel, not just the log) naming
  the actual problem (a variable that does not exist on the table) rather
  than a generic failure or a silently empty grid.
  **First pass, 2026-09-10 (Sean): failed** — a blank grid, no error or
  warning anywhere, nothing in the log. The host was already computing the
  real SAS parser message (Finding 7.18) but `dataViewerEntry.tsx`'s own
  datasource discarded it on a failed fetch; fixed by rendering it in a small
  banner above the grid, and by adding a `log?.warn` in `dataViewerPanel.ts`
  for both row-fetch failure paths (there was none before, for either).
- [x] **7.26** **A sort survives switching to a different tab and back** — with the
  grid sorted by **Age** (first item above), switch to a different editor
  tab, then switch back to this table's tab.
  **Expect:** the grid still shows the sort indicator and the Age-sorted
  rows, not a reset to the table's natural row order.
  **First pass, 2026-09-10 (Sean): failed** — the sort was silently lost.
  `retainContextWhenHidden: false` reloads the webview document on every
  hide/show, and the freshly mounted grid had no memory of the previous
  document's sort; its own first row request read as "no sort", which this
  panel's own state machine takes as an instruction to discard the
  still-wanted server-side view. Fixed: the host now replays its current
  sort/filter, not the state from when the table was first opened, on every
  `"ready"` handshake (`InitMessage.initialSort`/`initialFilter`,
  `dataViewerModel.ts`).
- [x] **7.27** **A filter survives switching to a different tab and back** — with the
  filter box showing `Sex='F'` (per the filter-box item above), switch to a
  different editor tab, then switch back.
  **Expect:** the filter box still shows `Sex='F'` and the grid still shows
  only the filtered rows, not a reset to all 19 unfiltered rows.
  **First pass, 2026-09-10 (Sean): failed**, for the same reason and with the
  same fix as the sort row immediately above.
- [x] **7.28** **A large table still pages correctly while sorted** — open your
  second, larger table (§11's pre-work) and sort it by a column, then scroll
  to the bottom.
  **Expect:** new rows keep appearing as you scroll, exactly as an unsorted
  large table already does (§11) — sorting does not break paging, and the
  final row count (if the grid shows one) is not negative or obviously wrong
  (a real risk this feature's own design flagged: a freshly created sort view
  reports an internal placeholder row count that must never reach the UI).
- [x] **7.29** **Closing the panel while sorted does not error** — with a sort active,
  close the table's tab.
  **Expect:** no error notification; open a different table afterward to
  confirm the extension still works normally. (This exercises a background
  cleanup of the temporary sort view the panel created — nothing about that
  should be visible from the UI side either way.)
- [x] **7.30** **The filter box and grid icons are legible** — with a table open,
  switch between a light theme, a dark theme, and a high-contrast theme.
  **Expect:** the filter box's placeholder text and any sort-direction
  indicator in a column header are both legible and not shown as a
  broken/missing icon in any of the three themes.


## Table properties (phase 7c-ii)

Adds a **Table Properties** command to a table's context menu in the SAS
Libraries view — a fully static panel (no scripts at all; its "Properties"/
"Columns" tab toggle is pure CSS, no message loop) showing the table's size,
engine, encoding and timestamp details ([Finding 7.19](../../phases/phase-7.md))
and its full column list. **Sean's own first pass, 2026-09-10, found one real
bug**: both panes rendered blank regardless of which tab was selected (the
CSS-only tab toggle's sibling selector could never match either pane — see the
"Properties tab shows real values" row below for the full account). Root-caused
and fixed on `fix/7c-ii-table-properties-blank-panes`, then **re-verified live,
2026-09-11 (Sean, against `verde`)**, along with every other row this section's
first pass could not reach while the panes were blank — every row below is
now checked clean.

**Pre-work:** the same live connection as §10, with **SASHELP.CLASS** visible
in the tree.

- [x] **7.31** **Table Properties opens a panel with two tabs** — right-click
  **SASHELP.CLASS** and choose **Table Properties**.
  **Expect:** a new panel opens, titled with the table's `libref.name`,
  showing a **Properties** tab (selected by default) and a **Columns** tab.
- [x] **7.32** **The Properties tab shows real values** — with the Properties tab
  selected.
  **Expect:** Name **CLASS**, Library **SASHELP**, Type **DATA**, Label
  **Student Data**, Engine **V9**; Row Count **19**, Column Count **5**;
  Created/Modified show a real date/time (not a raw number), Compression
  Routine **NO**, Encoding **us-ascii ASCII (ANSI)**.
  **First pass, 2026-09-10 (Sean): failed**, tab comes up with two sub tabs
  'properties' and 'columns' but it's all blank.
  **Root-caused and fixed** on `fix/7c-ii-table-properties-blank-panes`: the
  two radio inputs driving the CSS-only tab toggle were nested one level
  deeper (inside their own wrapper `<div>`) than the two panes they were
  meant to reveal, so `panelHead`'s `:checked ~ #pane-*` general-sibling rule
  could never match either pane and both stayed at their `display: none`
  default regardless of which tab was selected — a static-HTML/CSS defect,
  not a data-mapping one. Fixed in `src/data/tablePropertiesPanel.ts`
  (flattened sibling structure); confirmed live in a real browser
  (before/after) that the broken structure reproduces this exact symptom and
  the fix resolves it, and pinned with a new integration test.
  **Re-verified live, 2026-09-11 (Sean), against `verde` with a `.vsix` built
  from `fix/7c-ii-table-properties-blank-panes`:** every field matches —
  Name **CLASS**, Library **SASHELP**, Type **DATA**, Label **Student Data**,
  Engine **V9**, Row Count **19**, Column Count **5**, Created/Modified as
  real dates, Compression Routine **NO**, Encoding **us-ascii ASCII (ANSI)**.
  See `phase-7.md`'s 7c-ii Runbook entry (post-merge fix) for the full
  account.
- [x] **7.33** **Clicking the Columns tab switches panes, with no flash or reload** —
  click the **Columns** tab, then click back to **Properties**.
  **Expect:** the visible pane switches instantly (this is pure CSS, not a
  script) — Name/Sex/Age/Height/Weight with their types (CHAR/CHAR/FLOAT/
  FLOAT/FLOAT), lengths, and no error.
- [x] **7.34** **Choosing Table Properties again reveals the same panel** — with the
  panel from the item above still open, right-click **SASHELP.CLASS** and
  choose **Table Properties** again.
  **Expect:** the existing panel is revealed/focused, not a second one opened.
- [x] **7.35** **The panel is legible in light, dark, and high-contrast themes** —
  switch VS Code's color theme with the panel open.
  **Expect:** text, table borders, and the tab underline all remain legible in
  all three; nothing renders as an unstyled white box.
- [x] **7.36** **A table properties panel opened while the session is busy shows a
  clear message, not a blank panel** — start a long-running Python job, then
  choose **Table Properties** on any table before it finishes.
  **Expect:** the panel shows a real, readable message (not a blank page)
  explaining the session is busy.


## Python and SAS libraries — `SAS.sd2df`/`df2sd`/`submit`, and the drag-and-drop snippet (phase 7d)

`PROC PYTHON`'s own `SAS` bridge object, documented at
[`docs/data-access.md`](../../data-access.md) — no new backend code, so this
section is entirely about the documented example being accurate and the new
drag-and-drop snippet inserting what it claims to.

**Pre-work:** the same live connection as §10, with **SASHELP.CLASS** visible
in the tree, and an empty `.py` file open.

**First live pass ran 2026-09-11 (Sean, `verde`), against an installed build.**
The three `Run File` rows and all three drag-and-drop rows pass. The drag rows
failed on the first attempt for a real reason — see the note under the drag row
below, and `phase-7.md`'s 7d Runbook entry for the root cause.

- [x] **7.37** **`SAS.sd2df` reads a table** — Run File on a script containing just
  `df = SAS.sd2df("sashelp.class")` followed by `print(df.shape)`.
  **Expect:** output includes `(19, 5)`, matching `SASHELP.CLASS`'s known
  row/column count — the exact example `docs/data-access.md` shows.
- [x] **7.38** **`SAS.df2sd` writes a table back** — Run File on a script that builds a
  small `DataFrame` (e.g. `import pandas as pd; df = pd.DataFrame({"x": [1,
  2, 3]})`) then calls `SAS.df2sd(df, "work.probe_out")`, then reopen the SAS
  Libraries tree (refresh) and expand **WORK**.
  **Expect:** the run succeeds with no error, and `PROBE_OUT` now appears
  under **WORK** in the tree.
- [ ] **7.39** **The `PROC SQL` pass-through example runs** — Run File on
  `docs/data-access.md`'s own pass-through example (substitute a real
  site-registered library/table you can read for `external_db.orders`, or
  use `sashelp.class` with any `where` clause on a real column).
  **Expect:** no error, and `SAS.sd2df` on the created `work.` view returns
  only the filtered rows.
- [x] **7.40** **Dragging a table into a `.py` editor asks how** — drag
  **SASHELP.CLASS** from the SAS Libraries tree and drop it into the open
  `.py` file.
  **Expect:** a quick pick appears titled `Insert "SASHELP.CLASS" into
  Python as…`, offering **Read directly** and **Filter with PROC SQL
  first**.
  **First attempt, 2026-09-11 (Sean): failed, then fixed.** The quick pick
  appeared and either choice inserted nothing, silently — VS Code serializes
  a tree→editor drop payload across the extension-host RPC boundary, so
  `provideDocumentDropEdits` received the `JSON.stringify`'d text rather than
  the `TableItem[]` `handleDrag` set, and the slice had cast it instead of
  parsing it. The resulting `TypeError` was swallowed by VS Code and appeared
  only in the DevTools console, never in the output channel. Fixed
  (`readDraggedTables`), and **re-tested live the same day: passes.** Full
  account in `phase-7.md`'s 7d Runbook entry.
- [x] **7.41** **"Read directly" inserts a plain sd2df assignment** — choose **Read
  directly**.
  **Expect:** `class_df = SAS.sd2df("SASHELP.CLASS")` lands at the drop
  point, as plain text (no tabstops to Tab through).
- [x] **7.42** **"Filter with PROC SQL first" inserts a real snippet, with a mirrored
  tabstop** — undo the previous insert, drag **SASHELP.CLASS** in again, and
  this time choose **Filter with PROC SQL first**.
  **Expect:** a multi-line `SAS.submit("""proc sql; …""")` block followed by
  a `SAS.sd2df("work.$1")` line lands at the drop point, with
  `class_view` pre-selected as an editable tabstop; typing a new name and
  pressing `Tab` updates *both* the `create view work.…` line and the
  `SAS.sd2df("work....")` line together, then lands the cursor on the `where`
  clause's own `1=1` placeholder.
- [x] **7.43** **Dropping the same table twice de-duplicates the variable name** —
  with `class_df = SAS.sd2df(...)` already in the file from an earlier row,
  drop **SASHELP.CLASS** again and choose **Read directly**.
  **Expect:** the new line assigns `class_df2`, not `class_df` again.

## CSV export (phase 7c-ii)

`pythonOnViya.exportTableToCsv`, reached from a table's context menu in the
SAS Libraries tree — a save dialog, a cancellable progress notification, and
a streaming write to local disk (`docs/phases/phase-7.md`'s 7c-iii Runbook
entry). **Added at the Phase 7→8 housekeeping checkpoint (2026-09-11):** this
section did not exist in the original single-file manual test pass despite
7c-iii being merged and live-facing ([PR #161](https://github.com/Shai-Alit/sas-py-vscode/pull/161)) — every item below is
unrun.

**Pre-work:** the same live connection as the SAS Libraries section above,
with **SASHELP.CLASS** visible in the tree.

- [x] **7.44** **Export a table to CSV** — right-click **SASHELP.CLASS** and
  choose **Export to CSV…**, pick a destination in the save dialog.
  **Expect:** a progress notification while it writes, then the destination
  file exists with a header row (`Name,Sex,Age,Height,Weight`) and 19 data
  rows matching the grid.
- [x] **7.45** **Cancelling an export leaves no partial file at the
  destination** — start the export above again, to a *new* destination, and
  click **Cancel** on the progress notification partway through.
  **Expect:** the destination path does not exist afterward — no
  zero-byte or truncated file left behind (the write goes to a temporary
  file, renamed onto the destination only on full success).
- [x] **7.46** **An export that fails or is cancelled never touches an
  existing file at the destination** — export once successfully to a path,
  then export again to that *same* path and cancel partway through.
  **Expect:** the original file at that path is byte-for-byte unchanged
  after the cancelled second attempt — reopen it and confirm the original 19
  rows are still there, not truncated or replaced.
- [x] **7.47** **A destination with too little free disk space is refused
  before anything is written** — export to a destination on a volume you can
  arrange to have little free space on (or note this as not independently
  reachable if no such volume is available, per this section's own
  known-gap convention).
  **Expect:** a clear message naming the problem, shown before the write
  starts — no partially-written file appears at the destination.

