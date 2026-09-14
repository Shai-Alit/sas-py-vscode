<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 9 (Notebooks)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## Notebook controller registration (phase 9a)

A `NotebookController` registered against VS Code's own `jupyter-notebook`
type — no serializer of this extension's own
([ADR-0024](../../adr/0024-notebooks-are-ipynb-native.md);
`docs/phases/phase-9.md`'s 9a Runbook entry). This section is only the
registration/kernel-picker question — whether "Python on Viya" shows up as
a choice at all, alongside Jupyter's own kernels. Whether selecting it and
running a cell actually works is **not** in this section; that moved to
"Real execution (phase 9b)" below, since 9b replaced 9a's own placeholder
`executeHandler` and this section's original §9.2–§9.5 tested that
placeholder specifically. **Run 2026-09-14: passed**, against 9a's own
placeholder build — kept as the historical record for §9.1; the other four
items that ran that day are superseded below, not repeated here.

**Pre-work:** none — pure local VS Code notebook UI, no Viya connection
needed.

- [x] **9.1** **"Python on Viya" appears in the kernel picker alongside
  Jupyter's own kernels, not instead of them** — create or open any `.ipynb`
  file. Click **Select Kernel** in the top right of the notebook editor (or
  the equivalent prompt on a brand-new notebook).
  **Expect:** "Python on Viya" appears as a selectable entry, with the
  description "Run notebook cells on SAS Viya" — alongside whatever Jupyter
  kernels `ms-toolsai.jupyter` already offers, not replacing them, and with
  no error dialog just from opening the picker.

## Real execution (phase 9b)

`createNotebookExecutionHandlers` (`src/notebook/notebookController.ts`)
wires the controller to the same `BackendCache` Run File uses
(`src/run/backendCache.ts`) — `docs/phases/phase-9.md`'s 9b Runbook entry
has the full account, including the two scope decisions this slice made:
the kernel picker alone is a notebook's run-target equivalent (no
status-bar toggle), and `text/html`/`image/png` output gets an honest
placeholder rather than a real rendering (9c's own job).

**§9.2–§9.5 are the basic capability this whole slice exists to add —
run them first and don't skip ahead to §9.6 on the assumption they pass.**
Everything from §9.6 on (interrupt, the busy refusal, session-sharing,
the output placeholders) only means something once a cell can actually run
to completion; a failure in §9.2 makes the rest moot, not merely untested.

**Pre-work:** a signed-in Viya profile with `PROC PYTHON` available, the
same as any other phase's live rows — **except §9.5**, which deliberately
wants no profile signed in.

- [ ] **9.2** **Selecting the kernel and running a cell actually runs the
  Python and streams its output live** — select **Python on Viya** as the
  kernel, type `print("hello")` in a code cell, then run it (the ▷ gutter
  button or **Run All**). **(live)**
  **Expect:** the cell shows `hello` as its output, appearing as the run
  streams rather than only once it finishes; the cell gets a green check and
  an execution-order number (`[1]`) once it settles. No placeholder text —
  that behaviour belonged to 9a only, and is gone in this build.
- [ ] **9.3** **A multi-cell notebook runs cells in order and keeps state
  between them** — in a fresh notebook, cell 1: `x = 1`; cell 2:
  `print(x + 1)`. **Run All**. **(live)**
  **Expect:** cell 1 runs first, then cell 2, each getting its own execution
  order number in sequence; cell 2 prints `2` — proving the interpreter's
  globals survive from one cell to the next (`freshNamespace: false`,
  `backend.ts:80-93`), the same persistent-namespace guarantee `proc python
  restart;` gives Run File across its own runs, not a fresh interpreter per
  cell.
- [ ] **9.4** **A raised exception shows its traceback as plain text and a
  red X, with nothing duplicated** — in a fresh cell, run something that
  raises, e.g. `1 / 0`. **(live)**
  **Expect:** the traceback text appears once, as the cell's own streamed
  output (the same text `logFilter.ts` already passes through for Run
  File), the cell gets VS Code's own red-X execution-failure indicator, and
  there is no second, separate error output repeating the same message —
  `src/run/render.ts`'s own "already visible" reasoning applies here too.
  Run another cell afterward and confirm it starts normally — a raised
  exception ends the run, it does not leave the backend stuck "busy".
- [ ] **9.5** **No profile selected reports a clear reason, not a hang or a
  crash** — sign out of every profile (or leave none configured), select
  **Python on Viya** as the kernel anyway, and run a cell.
  **Expect:** a toast reading "Select a SAS Viya connection profile before
  connecting." (`ComputeSessionManager`'s own message — the same one Run
  File's `backendFor()` produces for this exact case), and the cell's own
  execution ends promptly (a red X, no output) rather than spinning
  forever.
- [ ] **9.6** **Legible in every theme** — with a cell showing real output
  (from §9.2), switch VS Code between a light theme, a dark theme, and a
  high-contrast theme.
  **Expect:** the kernel picker entry and the cell's output both render as
  normal, legible text in all three.
- [ ] **9.7** **Interrupting a running cell actually stops watching it, and
  says so** — run a cell with `import time; time.sleep(30)`, then click the
  cell's own **Interrupt** control (or the notebook toolbar's Interrupt)
  while it's running. **(live)**
  **Expect:** the cell ends promptly with a red error output starting
  "Cancelled." — not the raw VS Code "kernel interrupted" chrome — matching
  Cancel's own wording for Run File (Finding 75/76: the caveat that a SAS
  step already in flight may keep running its own natural duration is the
  same one here). A cell run immediately afterward should start normally,
  not be refused as still busy.
- [ ] **9.8** **A second cell run while one is still in flight is refused
  as busy, not queued or silently dropped** — start a long-running cell
  (`import time; time.sleep(15)`), then, before it finishes, run a
  *different* cell in the same notebook. **(live)**
  **Expect:** the second cell's own output shows a red error reading "A
  Python program is already running in this session. Wait for it to
  finish, or cancel it, before starting another." — the first cell keeps
  running and finishes normally afterward.
- [ ] **9.9** **A notebook cell and Run File share the same session and
  namespace, not two independent ones** — in a notebook cell:
  `shared = "from the notebook"`. Run it. Then open a `.py` file for the
  **same profile**, put `print(shared)` in it, and **Run File**.
  **(live)**
  **Expect:** Run File's output shows `from the notebook` — proving the
  notebook controller reused the same cached `ProcPythonBackend`/session
  Run File already had (or now shares), rather than each holding an
  independent interpreter for the same profile. This is `backendCache.ts`'s
  whole reason for existing; a failure here is a regression in the sharing
  itself, not just the notebook's own behaviour.
- [ ] **9.10** **`text/html`/`image/png` output gets an honest "not yet",
  not silence or a crash** — run a cell that writes one of ADR-0019's
  captured files, e.g.
  `import matplotlib.pyplot as plt; plt.plot([1,2,3]); plt.savefig("fig.png")`.
  **(live)**
  **Expect:** the cell's output includes a line reading "[an image was
  produced — rich rendering in a notebook cell isn't implemented yet]" —
  not a broken image icon, not nothing. (9c is where this becomes a real
  inline image.)
