# Notebooks

Open or create a `.ipynb` file and pick **Python on Viya** from the kernel
picker. Nothing else has to be installed first — this extension registers its
own kernel against VS Code's built-in notebook support, with no dependency on
`ms-toolsai.jupyter`. If you already have that extension installed, both kernel
entries coexist; picking one does not disturb the other.

The file itself is an ordinary `.ipynb` — the same format Jupyter, JupyterLab
and GitHub already read. There is nothing SAS-specific in what gets written to
disk, so any tool that already handles notebooks handles this one too.

## Running a cell

Each notebook gets its **own compute session**, separate from the one [Run
File and Run Selection](running-python.md) use — even in the same window, on
the same profile. This is deliberate: `PROC PYTHON` has one interpreter
namespace per session, and a notebook cell shares state with the cells above
it the same way Run Selection does, which is not safe to mix with Run File's
fresh-namespace-every-time behaviour in the same interpreter. The session opens
lazily, on your first cell run, the same way connecting normally does — you do
not have to run a separate Connect first.

A cell you run again picks up where the last one left off — a variable set two
cells up is still there, the same way it would be a cell down in Run Selection.
There is no per-cell fresh namespace and no separate "restart this notebook's
kernel" command of its own; **Disconnect** (or **Sign Out**) ends this session
along with your ordinary one, and the next cell you run opens a fresh
interpreter.

Cells run one at a time. Interrupting a cell (the stop button VS Code shows
while it runs) behaves like [Cancel](running-python.md#cancelling-a-run) does
for an ordinary run: it stops locally at once, but it cannot reach into SAS and
interrupt a Python statement that is already executing. If the cell you run
next then sits with no output for a few seconds, a notice says that SAS Viya
may still be finishing the statement the cancelled cell was running, and that
this cell starts once it ends. The notice keeps saying so until a later cell
on the session has started producing output or has finished. A cell that
sits silent when nothing was cancelled gets a plainer notice: it is still
running.

## Output

Plain text appears in the cell all at once when the cell's code finishes, the
same way it does in the output channel for a run: SAS Viya holds printed
output until the step ends ([Watching the
output](running-python.md#watching-the-output)).

A cell shows its result the way a Jupyter cell does:

- **Its last expression.** If the cell ends in an expression whose value is
  not `None`, the cell shows it: a pandas `DataFrame` as a sortable grid
  (see below), anything else as HTML if the value has `_repr_html_` (a
  Series, a Styler), as an image if it has `_repr_png_`, and
  otherwise as its `repr()`, in plain text. End the line with `;` to hide
  it, as in Jupyter. If the value's `_repr_html_` or `_repr_png_` raises,
  one line in the cell's output names it, and the value is shown the next
  way down.
- **Its open matplotlib figures.** After the cell runs, every figure still
  open is shown as a PNG and closed, whether or not you called `plt.show()`
  and whether or not the cell raised. Plots drawn by libraries built on
  matplotlib, such as seaborn and pandas' `.plot()`, are matplotlib figures
  too.

A figure you also show yourself, with `SAS.show(plt, filetype="png")` or by
saving it with `fig.savefig(...)`, and leave open, is shown twice: once from
your own call and once by the cell. Call `plt.close()` after showing it to
avoid that. Jupyter behaves the same way.

### A DataFrame as a grid

A cell whose last expression is a pandas `DataFrame`, such as `df` or
`df.head(50)`, shows it as a grid. Click a column header to sort by it, and
again to reverse. The index comes first, in bold.

The grid holds the first 100 rows and 20 columns. The line above it gives
the DataFrame's full size and says when rows or columns were left out. Sorting
reorders only the rows the grid holds, not the whole DataFrame, and the line
says so. Two settings change the size:

- `pythonOnViya.notebook.dataFrameGrid.maxRows`: up to 5,000.
- `pythonOnViya.notebook.dataFrameGrid.maxColumns`: up to 200.

Set either to `0` to show DataFrames as pandas' HTML table instead.

Each value is shown as text, the way Python's `str()` writes it, not with
pandas' display options. A missing value reads `NaN`, `NaT` or `None`. A
number column sorts by value, including integers too large for JavaScript
and infinities. Any other column sorts as text.

To see pandas' own HTML table for one output, choose **Change
Presentation** from the output's `...` menu. If your
`notebook.displayOrder` setting lists `text/html`, the HTML table shows
first and the grid is the alternative. A notebook saved with a grid
opens in Jupyter, or on GitHub, as that HTML table.

If the grid cannot be built, for example because a value cannot be
converted to text, one line in the cell's output says so and the DataFrame
is shown as HTML. A Series is shown as text and a Styler as HTML, as
before.

The explicit ways still work as they do in [the Result
panel](running-python.md#the-result-panel): `SAS.show(df)`, `SAS.show(plt,
filetype="png")`, or a file your code **writes** to the session's working
directory, such as `df.to_html("table.html")`. Run File and Run Selection do
not show a last expression or open figures; only notebook and interactive
window cells do ([ADR-0046](adr/0046-notebook-cells-display-their-result.md)).

The cell runs through two small helper programs the extension keeps in the
session under the filerefs `PYVRUN` and `PYVFLUSH`, and passes values in the
macro variables `PYVIYA_CELL`, `PYVIYA_USERCC`, `PYVIYA_FLUSHCC`,
`PYVIYA_GRID_ROWS` and `PYVIYA_GRID_COLS`. Don't use
those names in your own `SAS.submit()` code. If showing the figures fails,
the cell's output ends with one line saying so, and the cell's own result is
unaffected. If the helpers cannot be uploaded at all, the cell still runs,
without showing its result, and the **Python on Viya** output channel says
why.

Pass `filetype="png"` when you show a figure with `SAS.show`. `SAS.show(plt)` on its own
produces an SVG figure, and a notebook cell drops SVG entirely (it can carry
script). In SAS output the cell shows `SAS.show`'s `Output` title and,
where the figure would be, a one-line note saying to pass `filetype="png"`.
An SVG in an HTML file your code writes is dropped with no note.

SAS output (a `SAS.show` table or a `SAS.submit()` procedure) renders in the
notebook's own table styling rather than the SAS style the Result panel
uses. Every output in a notebook shares one page, and the SAS stylesheet
would restyle the other cells.

`text/html` output is sanitized before it renders — a `<script>` tag is
dropped, along with anything that could smuggle one past the scan, so an
interactive embed that depends on running its own script renders as static,
inert markup rather than not at all. This matters more here than for the
Result panel: a notebook's outputs are saved into the `.ipynb` file and
re-render on reopen with no round trip to Viya, so an untrusted notebook
someone hands you cannot run a script just by being opened.

## Diagnostics

A cell that raises gets the same treatment [Run File's traceback
does](diagnostics.md): a **Problems** panel entry positioned on the innermost
line of your own code, cleared when you run that cell again. It is a separate
Problems collection from Run File's, keyed per cell rather than per file,
so a notebook's entries and a `.py` file's entries never collide.

Closing the notebook clears every entry it produced. Signing out leaves them
in place; an entry stays until you run its cell again or close the notebook.

## What is not here yet

**Export.** There is no export command, and none is planned — a `.ipynb` this
extension writes is already a real notebook file, directly usable by
`jupyter nbconvert`, JupyterLab, or any other ipynb-aware tool with zero help
from this extension. Copying or saving a single cell's output is VS Code's own
built-in `ipynb` extension's job (right-click an output), not something this
extension adds.

**A restart command of its own.** Disconnect (which ends both sessions) or
running a cell after the session has timed out are the ways to get a clean
interpreter; there is no notebook-specific reset separate from
[Reset Python State](running-python.md#reset-python-state), which affects Run
File's session, not the notebook's.

## When it does not work

**A figure or table never appears in the output.** A value shows only when
it is the cell's last statement, with no `;` after it, and is not `None`;
`print(df)` or a value earlier in the cell shows only what it prints. A
figure shows only if it is still open when the cell ends, so a `plt.close()`
in the cell hides it. Check the **Python on Viya** output channel for a line
saying the cell ran without displaying its result. For a figure shown with
`SAS.show`, check that you passed `filetype="png"`.

**A figure appears twice.** You showed or saved it yourself and left it open,
[see above](#output). Close it with `plt.close()` after showing it.

**A plotly chart shows nothing.** Its HTML depends on a script, which never
runs (next item). Have your code save it as an image file instead.

**An embedded chart or widget in an HTML output doesn't do anything.** If it
depends on a `<script>` tag to render or become interactive, that script never
runs — [see above](#output). The rest of the markup still renders.

**A cell sits with no output for a while after you cancel the one before it.**
Expected: the interrupt stopped locally, but SAS may still be finishing the
statement that was already running. See [Running
Python](running-python.md#cancelling-a-run) for the same behaviour outside
notebooks.

## Where the details are

- [Running Python](running-python.md) — the session, cancellation, and rich
  output capture this shares almost all of its machinery with.
- [Diagnostics](diagnostics.md) — the Problems-panel behaviour this reuses.
- [ADR-0024](adr/0024-notebooks-are-ipynb-native.md) — why this is a plain
  `.ipynb` file and no bespoke format.
- [ADR-0035](adr/0035-notebook-gets-its-own-compute-session.md) — why a
  notebook cannot share a session with Run File.
- [ADR-0036](adr/0036-notebook-html-output-is-sanitized.md) — what the HTML
  sanitizer allows and drops, and why.
- [ADR-0046](adr/0046-notebook-cells-display-their-result.md) — how a cell
  shows its last expression and its open figures.
