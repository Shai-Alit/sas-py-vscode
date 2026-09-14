<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 9 (Notebooks)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## Notebook controller registration (phase 9a)

A `NotebookController` registered against VS Code's own `jupyter-notebook`
type — no serializer of this extension's own
([ADR-0024](../../adr/0024-notebooks-are-ipynb-native.md);
`docs/phases/phase-9.md`'s 9a Runbook entry). This slice does not run
Python: its `executeHandler` is a deliberate placeholder, since real
execution against a Viya session is 9b's own slice. **Run 2026-09-14: all
five items pass.** This section is new for Phase 9a and had no prior pass to
compare against; every box below was a first assertion, not a re-check.

**Pre-work:** none — this is the one section in this project's manual tests
that needs **no** Viya connection, no signed-in profile, and no compute
session. It is pure local VS Code notebook UI. Use whatever VS Code profile
you normally develop in, with `ms-toolsai.jupyter` still installed — §9.1
specifically checks coexistence with it, which the automated integration
suite cannot: that suite always runs with `--disable-extensions`, so it
proves the controller works with **no** Jupyter extension present, not that
it behaves sensibly alongside one.

- [x] **9.1** **"Python on Viya" appears in the kernel picker alongside
  Jupyter's own kernels, not instead of them** — create or open any `.ipynb`
  file. Click **Select Kernel** in the top right of the notebook editor (or
  the equivalent prompt on a brand-new notebook).
  **Expect:** "Python on Viya" appears as a selectable entry, with the
  description "Run notebook cells on SAS Viya (execution lands in a later
  release)" — alongside whatever Jupyter kernels `ms-toolsai.jupyter` already
  offers, not replacing them, and with no error dialog just from opening the
  picker.
- [x] **9.2** **Selecting it and running a cell reports an honest "not yet",
  not a crash or silent nothing** — select **Python on Viya** as the kernel,
  type `print("hello")` in a code cell, then run it (the ▷ gutter button or
  **Run All**).
  **Expect:** the cell shows a red error output reading "Running notebook
  cells on SAS Viya isn't implemented yet." — not VS Code's own generic "no
  kernel" error, not a stack trace from this extension, and not an empty
  output with no indication anything happened.
- [x] **9.3** **Every cell in a multi-cell notebook gets the same
  placeholder, not just the first** — add a second and third cell, then
  **Run All**.
  **Expect:** all three cells show the same placeholder error, each with its
  own execution order number.
- [x] **9.4** **No Viya connection of any kind is needed** — sign out of
  every profile (or leave none configured), then repeat §9.2.
  **Expect:** identical behaviour — the placeholder error, with no "sign in
  first" or "connect first" message. Unlike every other command this
  extension contributes, notebook execution does not check sign-in state at
  all yet, because it does not talk to Viya at all yet.
- [x] **9.5** **Legible in every theme** — with a cell showing the
  placeholder error, switch VS Code between a light theme, a dark theme, and
  a high-contrast theme.
  **Expect:** the kernel picker entry and the error output both render as
  normal, legible text in all three. Nothing custom was themed in this
  slice (no icon, no webview), so this is really confirming VS Code's own
  notebook chrome, not anything drawn here — low-value but cheap to check
  alongside §9.1–§9.2.
