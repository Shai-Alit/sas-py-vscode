# ADR-0048 — A notebook cell shows a trailing DataFrame as a sortable grid, from a payload the cell runner writes

- **Status:** Accepted
- **Date:** 2026-10-01
- **Decides:** how a notebook or interactive-window cell whose last
  expression is a pandas DataFrame shows it as a sortable grid, what
  leaves the compute session to make that happen, and what a saved
  notebook keeps
- **Amends:** [ADR-0046](0046-notebook-cells-display-their-result.md),
  whose cell runner tries a grid before the display protocol;
  [ADR-0019](0019-rich-output-is-captured-by-diffing-the-working-directory.md),
  whose whitelist admits one more reserved name;
  [ADR-0015](0015-the-execution-backend-seam.md), whose `ExecuteOptions`
  and `RichOutput` each gain one arm
- **Constrained by:** [ADR-0028](0028-data-viewer-is-react-and-ag-grid.md)
  (the grid is `ag-grid-community`, bundled, a dev dependency),
  [ADR-0036](0036-notebook-html-output-is-sanitized.md) (notebook HTML is
  sanitised), [ADR-0009](0009-coverage-scope.md) (browser-only code is
  excluded from coverage by rule)
- **Executed in:** Phase 13 slice 13g (the "13g built" Runbook entry in
  [`docs/phases/phase-13.md`](../phases/phase-13.md))
- **Evidence:** Finding 13.35 in
  [`docs/phases/phase-13.md`](../phases/phase-13.md); Sean's choices,
  2026-10-01, recorded in that file's "13g built" entry

## Context

Since 13f, a cell whose last line is `df` shows the DataFrame's
`_repr_html_()`: a static table, cut by pandas' own display options, that
cannot be sorted. ADR-0046 named this as 13g's trigger.

A grid needs the values, not HTML. The only way out of the session is
ADR-0019's working-directory diff: files, whitelisted by name, capped at
10 MiB, fetched and deleted. pandas' own `to_json` was the obvious encoder,
and Finding 13.35 rules it out. On the probed deployment it rounded
integers past 2^53, wrote `NaN` and both infinities as one `null`, cut
nanoseconds to milliseconds, dropped index names, and raised on a column of
`bytes`.

A notebook output can hold several representations of one value, and VS
Code shows the one it ranks first. Its `MimeTypeDisplayOrder.sort`
(`notebookCommon.ts`, read 2026-10-01) ranks by the user's
`notebook.displayOrder` setting, then by `NOTEBOOK_DISPLAY_ORDER`, where
`text/html` is third and a mime type missing from the list sorts ahead of
every listed one. So by default a grid with an HTML alternative shows as
the grid, and "Change Presentation" offers the table.

## Decision

1. **The cell runner writes the grid.** When the trailing value is a
   `pandas.DataFrame` (checked against the `pandas` module already in
   `sys.modules`, never imported) and both caps are above 0, the runner
   writes `pyviya_<id>_grid.json` and nothing else for that value. It holds
   the payload format, the DataFrame's own row and column counts, one field
   per index level and shown column, the first rows and columns up to the
   caps, and the DataFrame's `_repr_html_()`. A DataFrame with more than
   32 index levels fails the grid (point 3), so the runner never writes a
   file point 6's parser rejects. A Series, a Styler and every
   other value take ADR-0046's path unchanged.
2. **The runner's own encoding, not `to_json`.** A missing value (`NaN`,
   `None`, `NaT`, `pd.NA`) is `null`. In a number column, an integer beyond
   ±2^53 and an infinity are strings (`"9007199254740993"`, `"inf"`), so
   nothing is rounded. Every other value is `str()` of it, cut at 1,000
   characters. A tuple label is joined with `", "` and then cut the same
   way. `json.dumps` runs with
   `allow_nan=False`, so a value that slipped through raises rather than
   writing invalid JSON.
3. **Any failure falls back.** If building the payload raises, or it is
   larger than ADR-0019's 10 MiB cap, the runner removes any partial file,
   writes one `stderr` line saying the grid could not be built, and
   continues with ADR-0046's `_repr_html_`, `_repr_png_`, `repr()` order.
   A grid is never the reason a cell shows nothing.
4. **Two settings set the caps.** `pythonOnViya.notebook.dataFrameGrid.maxRows`
   (default 100, at most 5,000) and `.maxColumns` (default 20, at most
   200). `ExecuteOptions` gains `dataFrameGrid`, which the notebook
   controller fills from them. The job passes them as the macro variables
   `PYVIYA_GRID_ROWS` and `PYVIYA_GRID_COLS`. A value that is not a whole
   number in range is read as its default. 0 in either turns the grid off.
   Run File and Run Selection never set them.
5. **ADR-0019's whitelist admits `pyviya_<anything>_grid.json`.** No other
   `.json` file is captured. The fetched file is parsed and checked field
   by field (`src/backend/dataFrameGrid.ts`) before it becomes a
   `RichOutput` of mime `application/vnd.python-on-viya.dataframe+json`.
   One that fails is skipped with the reason, as an oversized file is.
6. **One parser on both sides.** `dataFrameGrid.ts` imports nothing at run
   time, and the renderer bundles it. The renderer checks the cell output
   with it, because a saved notebook can hold anything under that mime. The
   parser bounds every count by the payload's own stated counts and by the
   settings' maximums, and caps every string's length.
7. **A grid cell output carries two items:** the grid JSON, with the
   host's localised summary line, and the DataFrame's HTML, sanitised under
   ADR-0036. Jupyter and GitHub, which have no renderer for the grid's
   mime, show the HTML from the saved file.
8. **The renderer is the extension's own `notebookRenderer`**, an ES module
   built by `esbuild.mjs` into `dist/renderer/dataFrameGrid.js`, with
   `requiresMessaging: "never"`. Every cell is text: ag-grid's default cell
   renderer writes values as text, and no column names another renderer.
   Its colours and font come from VS Code's `--vscode-*` variables.
9. **Sorting is client-side, over the captured rows only.** The summary
   line says so when rows were left out ("sorting applies to the rows
   shown"). A number column sorts big integers and infinities by value; a
   missing value sorts first.
10. **The output channel and the result panel do not show a grid.** The
    output channel gets ADR-0019's deferred-output placeholder. The result
    panel shows the HTML. Neither path sets the caps today, so neither
    sees a grid file; this is for completeness.

## Alternatives considered

**`to_json(orient="split")`.** One call, and pandas maintains it. Rejected
by Finding 13.35: it loses precision and information silently, and raises
on ordinary data.

**Open the data viewer panel (ADR-0028's 7b viewer).** It already sorts
and pages, server-side. But it reads a SAS or CAS table; a DataFrame would
have to be written to one first, and the user asked for the grid inline
in the cell (Sean, 2026-10-01).

**HTML first, grid under "Change Presentation".** Keeps today's look by
default. Not taken: the grid is the point of the slice (Sean, 2026-10-01).

**Re-run the query to sort all rows.** Exact, but needs messaging from
the renderer back to the session, which may have moved on. Not taken
(Sean, 2026-10-01); the summary line says what is sorted.

**Grid a Series and a Styler too.** A Series is one column, and a Styler
carries formatting a grid would lose. Left for later.

## Consequences

- **A trailing DataFrame shows as a grid** in notebooks and the
  interactive window, with "Change Presentation" offering pandas' HTML.
  A user whose `notebook.displayOrder` setting lists `text/html`, or who
  chose it with "Change Presentation" earlier in the window, sees the
  HTML first instead.
- **A saved notebook carries both** and opens anywhere: a viewer without
  the renderer shows the HTML.
- **ADR-0019's whitelist is no longer closed to `.json`**, but it admits
  only the reserved name, and the content is parsed before use. A user's
  own file named `pyviya_x_grid.json` is captured and shown if it parses,
  as a user's own `.png` already is.
- **Values are text.** A float reads as `str()` writes it, not as pandas'
  display options would. Index levels come first, in bold.
- **The renderer adds about 1.2 MB to the package**, ag-grid's community
  modules. The data viewer bundles its own copy.
- **Probed against one Viya 4 deployment (`verde`, pandas 3.0.5, Python
  3.12.12).** One probe frame of datetimes printed empty and was not
  explained; 13g's manual pass checks datetime columns on Viya.
