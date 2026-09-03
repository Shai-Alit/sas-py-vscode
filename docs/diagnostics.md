# Diagnostics

A Python program that raises an exception has not broken the extension — it has
done something you need to see clearly. This page is what the extension does
with a failed run: where the traceback goes, how it becomes a clickable jump
back to your code, and what the Problems panel shows.

## A failure is reported as a failure

When a run raises at the top level, the output channel ends with **Finished
with an error.** rather than **Finished.**, and the exception message follows
on the next line. The distinction is deliberate: your own `ZeroDivisionError`
is not an extension malfunction, and the two are never conflated. See
[ADR-0015](adr/0015-the-execution-backend-seam.md).

The raw traceback also streams into the output channel as plain text while the
run executes, exactly as `PROC PYTHON` emits it.

## The traceback in the Result panel

For a run that raises, the [Result panel](running-python.md#the-result-panel)
opens with a structured traceback: a heading, the exception message, and an
ordered list of frames.

Frames from **your own code** show with the file name `<string>` — that is what
`PROC PYTHON` calls the file it ran — and are rendered as links. Click one, or
Tab to it and press <kbd>Enter</kbd> or <kbd>Space</kbd>, and the editor
reveals that line. For a Run Selection the line is offset correctly: if the
selection started on line 40, a frame at "line 3" jumps to line 42. The editor
opens in its own column, not on top of the panel you clicked in.

Frames in **library code** — anything with an absolute path to a file on the
SAS server you cannot open — are plain text, not links. There is nowhere in
your workspace for them to jump to, and a guessed location would be worse than
none.

The harness adds a couple of wrapper frames of its own at the top of every
stack; those are dropped. Your frames, including the deep repetition in a
`RecursionError`, are kept as they are.

## The Problems panel

A failed run whose traceback has at least one frame in your file also gets one
entry in the **Problems** panel (**View → Problems**, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>):

- one **Error**, source **Python on Viya**, positioned on the innermost line of
  your code in the traceback;
- its message is the same exception line the output channel shows;
- expanding it walks the rest of your frames as related information.

Re-run the file with the error fixed and the entry clears at the **start** of
the run — before the new output arrives, so you are never looking at a stale
red mark next to fresh output.

### When there is no Problems entry

If the traceback has **no frame in your file** — a `PROC PYTHON`-level or
SAS-side failure (for example, Python is not licensed on the deployment), or a
stack that is entirely library code — there is no Problems entry at all. The
output channel still carries the message. The Problems panel is the one surface
that would be *lying* if it planted an error on line 0 of your file, so it says
nothing instead.

### What clears a stranded entry

Normally the next run of the same file clears its entry. Three other things do
too, for when there is no next run coming:

- **closing the file's editor tab** — reopening it does not bring the entry
  back;
- **signing out** of the Viya profile (**Python on Viya: Sign Out**, or the
  Accounts menu) — this clears every entry, because an entry carries no record
  of which profile's run produced it;
- **switching the run target to Local** — a Local run can never clear a Viya
  run's entry, so flipping the target strands them all.

Switching from one Viya profile to another leaves the entries in place: a run
against the new profile might still be about the same code.

## `ModuleNotFoundError` points at your environment

When the exception is a `ModuleNotFoundError`, the diagnostic message — the
line after "Finished with an error." in the output channel, and the Problems
entry's text — has one sentence added:

> Run "Python on Viya: Show Environment" to see what is installed on this
> connection.

Nine times in ten a missing import means the package is not in the deployment's
managed Python environment, not that your code is wrong.
[The Python environment](python-environment.md) is how you check. The
structured traceback in the Result panel keeps Python's own wording unchanged —
the pointer is only on the diagnostic.

## When it does not work

**A run failed but nothing appeared in the Problems panel.** Either the
traceback had no frame in your own file (a SAS-side failure, or an all-library
stack — see [above](#when-there-is-no-problems-entry)), or the run failed
before producing a structured traceback at all. The output channel has the
message either way.

**Clicking a traceback frame does nothing.** It is a library frame (plain text,
not a link), or the file has been renamed or deleted since the run. A frame
that cannot be resolved is a silent no-op rather than a wrong jump.

**The Problems entry is on the wrong line.** It should not be — the selection
offset is accounted for. If you can reproduce it, the **Python on Viya** log
records the run, and it is worth reporting.

## What is not here yet

**Quick fixes on the diagnostic.** An *Install this package* action for a
`ModuleNotFoundError`, say. The pointer to **Show Environment** is as far as
this release goes.

**Column-level positioning.** The entry highlights the whole line, because
`PROC PYTHON`'s traceback reports a line number and no column.

## Where the details are

- [Running Python](running-python.md) — the output channel and the Result
  panel these build on.
- [The Python environment](python-environment.md) — following the
  `ModuleNotFoundError` pointer.
- [Traceback mapping and the diagnostics surface](architecture/diagnostics-surface.md)
  — how a traceback line number becomes an editor position, and why `<string>`
  frames are the only mappable ones.
