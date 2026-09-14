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
wires the controller to its own `BackendCache`
(`src/run/backendCache.ts`), wrapping its own compute session — **not** Run
File's, since [ADR-0035](../../adr/0035-notebook-gets-its-own-compute-session.md)
— `docs/phases/phase-9.md`'s 9b Runbook entry has the full account,
including the two scope decisions this slice made: the kernel picker alone
is a notebook's run-target equivalent (no status-bar toggle), and
`text/html`/`image/png` output gets an honest placeholder rather than a real
rendering (9c's own job).

**§9.2–§9.5 are the basic capability this whole slice exists to add —
run them first and don't skip ahead to §9.6 on the assumption they pass.**
Everything from §9.6 on (interrupt, the busy refusal, session-sharing,
the output placeholders) only means something once a cell can actually run
to completion; a failure in §9.2 makes the rest moot, not merely untested.

**Pre-work:** a signed-in Viya profile with `PROC PYTHON` available, the
same as any other phase's live rows — **except §9.5**, which deliberately
wants no profile signed in.

- [x] **9.2** **Selecting the kernel and running a cell actually runs the
  Python and streams its output live** — select **Python on Viya** as the
  kernel, type `print("hello")` in a code cell, then run it (the ▷ gutter
  button or **Run All**). **(live)**
  **Expect:** the cell shows `hello` as its output, appearing as the run
  streams rather than only once it finishes; the cell gets a green check and
  an execution-order number (`[1]`) once it settles. No placeholder text —
  that behaviour belonged to 9a only, and is gone in this build.
- [x] **9.3** **A multi-cell notebook runs cells in order and keeps state
  between them** — in a fresh notebook, cell 1: `x = 1`; cell 2:
  `print(x + 1)`. **Run All**. **(live)**
  **Expect:** cell 1 runs first, then cell 2, each getting its own execution
  order number in sequence; cell 2 prints `2` — proving the interpreter's
  globals survive from one cell to the next (`freshNamespace: false`,
  `backend.ts:80-93`), the same persistent-namespace guarantee `proc python
  restart;` gives Run File across its own runs, not a fresh interpreter per
  cell.
- [x] **9.4** **A raised exception shows its traceback as plain text and a
  red X, with nothing duplicated** — in a fresh cell, run something that
  raises, e.g. `1 / 0`. **(live)**
  **Expect:** the traceback text appears once, as the cell's own streamed
  output (the same text `logFilter.ts` already passes through for Run
  File), the cell gets VS Code's own red-X execution-failure indicator, and
  there is no second, separate error output repeating the same message —
  `src/run/render.ts`'s own "already visible" reasoning applies here too.
  Run another cell afterward and confirm it starts normally — a raised
  exception ends the run, it does not leave the backend stuck "busy".
- [x] **9.5** **No profile selected reports a clear reason, not a hang or a
  crash** — sign out of every profile (or leave none configured), select
  **Python on Viya** as the kernel anyway, and run a cell.
  **Expect:** a toast reading "Select a SAS Viya connection profile before
  connecting." (`ComputeSessionManager`'s own message — the same one Run
  File's `backendFor()` produces for this exact case), and the cell's own
  execution ends promptly (a red X, no output) rather than spinning
  forever.
- [x] **9.6** **Legible in every theme** — with a cell showing real output
  (from §9.2), switch VS Code between a light theme, a dark theme, and a
  high-contrast theme.
  **Expect:** the kernel picker entry and the cell's output both render as
  normal, legible text in all three.
- [x] **9.7** **Interrupting a running cell actually stops watching it, and
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
  as busy, not queued or silently dropped; a cell that has to wait behind an
  interrupted one's still-finishing statement says so honestly** — start a
  long-running cell (`import time; time.sleep(15)`), then, before it
  finishes, run a *different* cell in the same notebook. **(live)**
  **Expect:** the second cell's own output shows a red error reading "A
  Python program is already running in this session. Wait for it to
  finish, or cancel it, before starting another." — the first cell keeps
  running and finishes normally afterward. Separately: interrupt a
  long-running cell (`import time; time.sleep(30)`, then Interrupt), then
  immediately run a different cell. **Expect:** the new cell may still sit
  with no output for a while — Finding 76 (Phase 4b) already established
  that an interrupt cannot preempt a running SAS-side statement, and this is
  the same limitation, now visible from a notebook too — but after
  `WAITING_NOTICE_DELAY_MS` (3s) with nothing shown, its own output gains an
  honest line: "[still no output — this cell may simply be running long, or
  a previous statement on this session may still be finishing]". It should
  **not** simply sit blank with no indication anything is happening.
  **(2026-09-14) partial, root cause identified and this item reworded to
  match the fix — needs a fresh live re-run.** Interrupting a cell does not
  kill the SAS-side statement (Finding 76, already known for Run File; not
  new to notebooks) — a cell run afterward genuinely does wait for it to
  finish naturally. A real, cause-specific message would need tracking the
  abandoned statement, which Phase 4c already declined to build for Run
  File's own identical gap; `phase-11.md`'s "Also carried here" list keeps
  it as a candidate. This item now tests the honest, cause-agnostic notice
  instead.
- [ ] **9.9** **A notebook's own state persists across its own cells and
  across a reload — and Run File, running against a different SAS session
  now, never touches it** — in a notebook cell: `k = 1`. Run it, then run a
  second cell with `print(k)` — confirms cell-to-cell persistence within the
  notebook (already covered by §9.3, repeated here as the baseline this item
  builds on). Then open a `.py` file for the **same profile**, put
  `print(k)` in it, and **Run File**. **(live)**
  **Expect:** Run File's own run fails with `NameError: name 'k' is not
  defined` — it is running in its own, independent compute session
  ([ADR-0035](../../adr/0035-notebook-gets-its-own-compute-session.md)),
  which starts empty the same way Run File's own whole-file runs always
  have. Run a notebook cell again afterward (e.g. `print(k)`): **Expect**
  it still prints `1` — Run File's own run must **not** have disturbed the
  notebook's session or its variables in any way. Reload the window, open
  the same notebook, run `print(k)` again: **Expect** `1` again, without
  first re-running the `k = 1` cell — proving the notebook's own session
  survived the reload via its own `purpose`-namespaced binding (ADR-0035),
  not merely coincidentally sharing Run File's already-working reattach.
  **(2026-09-14) failed, root cause identified and this item rewritten to
  match the fix (ADR-0035) — needs a fresh live re-run.** The original
  wording expected `print(shared)` via Run File to see a variable the
  notebook had set — literal namespace sharing. Root cause: `PROC PYTHON`
  has exactly one interpreter namespace per compute session (finding 38),
  and 9b's first cut gave Run File and the notebook the *same* session, so
  Run File's own `freshNamespace: true` (every whole-file run, unchanged
  since Phase 3) silently wiped the notebook's variables — and, since it
  really was the same session, running the notebook again afterward showed
  the same wipe. Fixed by giving the notebook its own, entirely separate
  compute session; this item now tests the corrected guarantee — notebook
  state survives its own reload and is never touched by Run File — rather
  than the literal cross-surface variable visibility the first cut could
  not safely deliver.
- [x] **9.10** **`text/html`/`image/png` output gets an honest "not yet",
  not silence or a crash** — run a cell that writes one of ADR-0019's
  captured files, e.g.
  `import matplotlib.pyplot as plt; plt.plot([1,2,3]); plt.savefig("fig.png")`.
  **(live)**
  **Expect:** the cell's output includes a line reading "[an image was
  produced — rich rendering in a notebook cell isn't implemented yet]" —
  not a broken image icon, not nothing. (9c is where this becomes a real
  inline image.)
- [ ] **9.11** **Disconnect ends both sessions, not just Run File's** — with
  a notebook cell already run once (so the notebook's own, separate
  compute session is live — [ADR-0035](../../adr/0035-notebook-gets-its-own-compute-session.md))
  and Run File also used at least once on the same profile, run
  **Disconnect** (command palette or the status bar). **(live)**
  **Expect:** a single confirmation, and both sessions actually end
  server-side — a notebook cell run immediately afterward reconnects and
  starts with a fresh, empty namespace (no leftover variables from before
  Disconnect), the same as Run File's own post-Disconnect reconnect
  already does. No automated test exercises `commands.ts`'s
  `notebookSessions?.disconnect({ quiet: true })` call (adversarial review,
  2026-09-14) — `registerComputeCommands` calls real `vscode` command and
  event-emitter APIs that only exist in the extension host, and the
  existing integration suite (`test/integration/compute/commands.test.ts`)
  deliberately never opens a real session — so this item is this
  behaviour's only coverage until that changes.
