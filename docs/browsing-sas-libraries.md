# Browsing SAS libraries

Once you have [connected](connecting.md), the **Python on Viya** activity-bar
icon also shows a **SAS Libraries** view — the libraries visible to your
compute session, and every table in them. It reads live off the session
itself, so it always shows what your Python code could reach with
[`SAS.sd2df`](data-access.md#reading-a-table) right now, not a separate catalog.

## What the tree shows

Expanding **SAS Libraries** lists every libref your session can see —
`WORK`, `SASHELP`, and any site-registered library, including one connected to
an external database through SAS/ACCESS. `WORK` is always there and is always
writable; most others are set up read-only by whoever administers your
deployment. Expanding a library lists its tables, loaded on demand the same
way [SAS Content](browsing-sas-content.md) loads folders.

The view will not start a session on its own. If you have not connected yet,
it shows an explicit **Connect** prompt rather than quietly starting one —
opening a SAS process is a real cost, and it should only happen because you
asked, whether by pressing that prompt or by running a Python file.

## Opening a table

Click a table (or right-click it and choose **Open Table**) to open it in a
scrollable grid — one tab per table, reused if you open the same one twice.
Rows page in as you scroll; the whole table is never pulled into memory at
once, no matter its size. Numeric columns are right-aligned, matching their
underlying SAS type; everything else is left-aligned.

**Open Table**, **Table Properties**, and **Export to CSV** (below) only ever
appear on a table in the tree — right-click, or the icons on the row itself.
None of the three is in the Command Palette, because none of them means
anything without a specific table already selected.

## Sorting and filtering

Click a column header to sort by it. Type a SAS `WHERE`-clause expression into
the filter box above the grid and press Enter to apply it — for example
`Age > 12`. Sort and filter combine, and either can be cleared independently.

Both are applied on the server, against a temporary view Viya builds for the
combination currently in effect — not a client-side re-sort of whatever rows
happen to already be on screen. One consequence worth knowing: the grid can
normally show a total row count, but once a sort or a filter is active, Viya
does not return one for that read. The grid keeps paging correctly regardless;
it just cannot tell you the total until you clear back to the unsorted,
unfiltered view.

## Table Properties

Right-click a table and choose **Table Properties** for a static, read-only
panel with two tabs: one with its size, engine, encoding, and timestamp
details, the other with its full column list (type, length, format, informat,
label). Nothing here is editable — it is the same information SAS Studio's own
table properties view shows, laid out for a quick check before you write a
query against something you have not looked at yet.

## Export to CSV

Right-click a table and choose **Export to CSV** for a save dialog, then a
cancellable progress notification. Rows stream straight from Viya to the file
you chose as they arrive — there is no size limit tied to what the grid, or
memory, can hold, unlike opening the table itself.

The export writes to a temporary file next to your chosen destination and only
replaces it once every row has been written successfully. If you cancel, if
the export fails partway, or if there is not enough free disk space to finish
(checked before anything is written, from a quick sample of the table), your
destination file — if one already existed at that path — is left exactly as it
was. Nothing partial is ever left in its place.

## Refreshing

The view does not poll. Use the refresh button on the view's title bar, or
**Python on Viya: Refresh SAS Libraries** from the Command Palette, after a
library or table changes and you want the tree to catch up. It also refreshes
itself when you connect, disconnect, or switch connection profile.

## When it does not work

**The view shows "Connect to SAS Viya to browse libraries…" and nothing
else.** Expected once you are signed in but not connected — press the prompt,
or run **Python on Viya: Connect to SAS Viya**. See [Connecting to
Viya](connecting.md).

**Browsing is refused while something else is running.** The session runs one
thing at a time, the same rule [Running Python](running-python.md#one-run-at-a-time)
documents for a run, a reset, or an environment probe. Opening a table, or
refreshing the tree, while a run is in flight is refused with a message rather
than left to hang silently. Wait for the run to finish, or cancel it.

**A panel gets stuck on "Loading…" and never shows an error.** If a table
becomes unreachable at the exact moment you open it — renamed, dropped, or a
permission changed right then — the data viewer and Table Properties panels
can be left showing their loading state indefinitely rather than a failure
message. This is a known, documented gap, not something wrong with your table:
close the tab, refresh SAS Libraries, and try again.

## Where the details are

- [Python and SAS libraries](data-access.md) — reading and writing this same
  library data from your own Python code with `SAS.sd2df` / `SAS.df2sd`, and
  dragging a table from this tree straight into an editor as code.
- [ADR-0027](adr/0027-library-adapter-shape.md) — why the tree borrows the
  active profile's session rather than owning a connection of its own.
- [ADR-0028](adr/0028-data-viewer-is-react-and-ag-grid.md) — why the data
  viewer is a React and ag-grid webview rather than a hand-rolled table.
- [ADR-0029](adr/0029-sort-view-lifecycle.md) — the server-side view a sort or
  filter creates, and why it is reused across pagination instead of rebuilt
  per page.
