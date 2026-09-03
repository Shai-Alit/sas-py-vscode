# Running Python

Once you have [connected](connecting.md), you have a compute session with a
Python interpreter in it. This page is what you do with it: run a file, run a
selection, watch the output, cancel, and start over.

## Before anything appears

Running is offered only when the workspace's **run target** is a Viya profile.
Set it from the status bar — the item that names **Local Python** or **SAS
Viya** — or run **Python on Viya: Select Run Target** and pick a profile. That
one gesture sets the target and the active profile together.

On the **Local** target this extension contributes nothing to the editor: the
run button you already had is Microsoft's, and we neither wrap it nor start an
interpreter of our own. Nothing here changes what a command *means*; the target
only decides whether our commands also appear on the editor and in its context
menu. See [ADR-0011](adr/0011-choosing-where-python-runs.md) and
[ADR-0020](adr/0020-run-target-defaults-to-local.md).

The folder also has to be trusted, for the same reason
[connecting](connecting.md) does — a run starts a process on your deployment
under your identity.

## Run File and Run Selection

**Python on Viya: Run File** runs the whole document. It is on the editor's
run button (the one shared with `ms-python.python` — you get one play button
with a dropdown, not two), in the editor context menu, and in the Command
Palette. Every Run File starts with a **fresh namespace**: the interpreter's
globals are cleared first, so a file always runs against a clean slate and
cannot silently depend on something a previous run left behind.

**Python on Viya: Run Selection** runs the selected text and *does not* clear
the namespace first. A selection builds on whatever state earlier runs left in
the interpreter, the same way a notebook cell builds on the cells above it — so
you can define a DataFrame with one selection and keep poking at it with the
next. It is in the Command Palette and, when there is a selection, the editor
context menu.

No keybinding ships for either. Every plausible default already means something
in a Python editor; [ADR-0011](adr/0011-choosing-where-python-runs.md) has the
list. Bind them yourself under **Preferences: Open Keyboard Shortcuts** if you
run often.

If the active editor is not a Python file, or a Run Selection has nothing
selected, the extension says so and does nothing.

## Watching the output

Text output goes to a channel called **Python on Viya: Output**. It is
deliberately not the same channel as the extension's log
(**Python on Viya: Show Log**): the log is a timestamped record of what the
*extension* did, and this is a transcript of what your *program* printed. The
first line names the profile and what is running; then your `stdout` streams in
as it arrives, line by line, rather than all at once when the run ends; then a
final `Finished.` or `Finished with an error.`. The channel reveals itself
without taking focus off your code.

Anything that is not plain text — a matplotlib figure, a DataFrame rendered as
HTML, a structured traceback — goes to the **Result** panel instead.

## The Result panel

The Result panel is a single webview that opens beside the editor. It is reused
across runs — a second run replaces its contents rather than adding to them —
and it is locked down: it runs only this extension's own script and loads
nothing from the network, so an HTML table from pandas renders as a real,
selectable `<table>` and an image carries alt text, but a `<script>` in that
HTML does nothing. A traceback becomes a heading, the exception message, and an
ordered list of frames. See
[ADR-0021](adr/0021-result-panel-webview.md).

It opens **only** when a run produces something the output channel cannot show
in full — an image, an HTML table, or a traceback. A run that only `print()`s
never pops it. If you already have it open from an earlier run, it still comes
back to the front for the next run's first figure.

Rich output is captured by comparing the session's working directory before and
after the run
([ADR-0019](adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)):
your script has to actually **write a file** — `fig.savefig("plot.png")`,
`df.to_html("table.html")` — because there is no implicit `savefig`. A written
file larger than 10 MiB is skipped with a note naming it and the limit; the run
and the session carry on. A cancelled run captures nothing.

Reloading the window clears the panel, the same way it clears the output
channel's scrollback. There is no serializer for it yet.

## Reset Python State

**Python on Viya: Reset Python State** restarts the interpreter inside the
session — `proc python restart`, a few seconds. Your imports and variables are
gone; the compute session itself, its SAS libraries and its filerefs are not.
Use it when the namespace has gotten into a state you would rather not reason
about, instead of disconnecting and reconnecting.

This is different from Run File's fresh namespace: Run File clears globals in
the same interpreter, while Reset restarts the interpreter process.

## One run at a time

The session runs one thing at a time. Start a run and then start another — or a
reset, or **Show Environment** — and the second is refused with a message
naming what is in the way, not queued behind it. If you want the second thing,
cancel the first or wait for it.

## Cancelling a run

While a run is in flight, **Python on Viya: Cancel** is available — from the
progress notification's **Cancel** button, or from the Command Palette. It
stops the run locally at once: the output channel stops and the progress
notification clears, without waiting on a reply from the server.

What it cannot do is reach into SAS and stop a Python statement that is already
executing. A `time.sleep(60)` cancelled six seconds in will still run out its
full minute inside SAS before the interpreter is torn down, and anything you
queue immediately behind the cancel — a new run, a reset — waits for the
session to actually come free. The output channel says as much:

> Cancelled. If a single step was already running, SAS Viya may keep executing
> it until that step finishes on its own.

This was measured against a live deployment, not assumed — see the Probe
findings (75 and 76) in
[`docs/phases/phase-4.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-4.md).
A clean cancel shows **no** error notification; the server accepted the request.
If the cancel request itself fails, that is logged and surfaced rather than
swallowed, because the local run stopping does not by itself mean Viya was told
to stop.

## Where your state lives, and how long

The interpreter's state — imports, variables, the DataFrame you spent four
minutes building — lives in the compute session, survives a window reload
(the extension reattaches to the same session), and is reaped after about
fifteen minutes idle. [Connecting to Viya](connecting.md) covers all of that;
it is the same session, whether you reached it through Connect or through a
run.

## When it does not work

**"The run target is Local Python."** You asked to run on Viya but the target
is Local. Switch it from the status bar or with **Select Run Target**.

**"No SAS Viya connection profile is selected."** The target is Viya but no
profile is active in this window. **Select Run Target** and pick one.

**"Open a Python file to run it on SAS Viya."** The active editor is not a
`.py` file. Click into the file you meant.

**"Select some code to run."** Run Selection with an empty or whitespace-only
selection.

**A run is refused as already running.** Something — a run, a reset, an
environment probe — is still going in this window. Cancel it or wait.

**The run fails with a message about the session.** The session may have been
reaped or signed out from under the run. The message says what happened and the
next run re-authenticates and reconnects; [Diagnostics](diagnostics.md) covers
reading these.

**Nothing of ours is in the editor.** The run target is Local, the folder is
untrusted, or the file is not Python. Unavailable commands are left out of the
Command Palette rather than shown greyed, so a missing entry is the normal way
this looks.

## Known rough edges

**The transcript carries the interpreter's startup banner and `>>>` prompt
markers.** A run's output currently includes a `Python 3.x … / Type "help" …`
banner and bare `>>>` lines that `PROC PYTHON` emits around the code. They are
harmless but they are noise, and removing them cleanly needs a change on the
SAS side rather than the extension guessing which lines to hide — a program
that legitimately prints `>>>` must not have it stripped. Tracked as a live
probe follow-up.

## What is not here yet

**A queue.** A second run is refused, not held. A queue is a policy with a UI,
and it is not this release.

**A local run.** On the Local target the run button is Microsoft's; this
extension does not run Python on your machine and never will
([the README](https://github.com/Shai-Alit/sas-py-vscode#readme) explains why).

**Panel and channel history across a reload.** Both are cleared. Re-run to
repopulate them.

## Where the details are

- [Diagnostics](diagnostics.md) — what a failed run looks like, and the
  Problems panel.
- [The Python environment](python-environment.md) — what is installed on the
  interpreter you are running against.
- [ADR-0015](adr/0015-the-execution-backend-seam.md) — why a program is bytes
  and an origin, never a string of code, and why a program that raises is not
  counted as a failure of the extension.
- [Execution backends](architecture/execution-backends.md) — the seam
  `PROC PYTHON` is one implementation of.
