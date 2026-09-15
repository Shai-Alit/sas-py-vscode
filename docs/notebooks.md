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
next then sits with no output for a few seconds, a notice appears saying it may
simply be a long-running cell, or a previous, already-cancelled statement on
this session still finishing — the two look identical from here, so the notice
does not guess which one it is.

## Output

Plain text streams into the cell as it prints, the same way the output channel
does for a run.

An image or an HTML table needs an explicit file, exactly as it does in [the
Result panel](running-python.md#the-result-panel) — rich output is captured by
noticing a file your code **wrote** to the session's working directory, not by
an implicit `plt.show()` or `_repr_html_` capture. `fig.savefig("plot.png")` or
`df.to_html("table.html")` are what produce a rendered output; a bare
`DataFrame` or figure as a cell's last expression produces nothing, which is a
difference from how a Jupyter kernel normally behaves.

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

Closing the notebook clears every entry it produced. **Signing out does not** —
a known, documented gap carried forward for a future release, unlike Run File
where signing out clears everything.

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

**A figure or table never appears in the output.** The same rule as the
Result panel: call `fig.savefig(...)` or `df.to_html(...)` explicitly — there
is no implicit capture of a bare expression or `plt.show()`.

**An embedded chart or widget in an HTML output doesn't do anything.** If it
depends on a `<script>` tag to render or become interactive, that script never
runs — [see above](#output). The rest of the markup still renders.

**A cell sits with no output for a while after you cancel the one before it.**
Expected: the interrupt stopped locally, but SAS may still be finishing the
statement that was already running. See [Running
Python](running-python.md#cancelling-a-run) for the same behaviour outside
notebooks.

**A Problems-panel entry from a notebook cell is still there after you sign
out.** A known gap — Run File's entries clear on sign-out; a notebook's do
not yet. Closing the notebook does clear them.

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
