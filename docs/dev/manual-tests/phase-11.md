<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 11 (Remaining parity gaps)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## The interactive window (phase 11a)

A bespoke, this-project-owned surface built on Phase 9's own ipynb-native
`NotebookController` — not VS Code's real Interactive Window, which needs the
`interactiveWindow` proposed API a published extension cannot use
(`docs/phases/phase-11.md`'s F7 write-up). **Not yet run** — new for 11a, no
prior pass to compare against. `test/integration/notebook/
interactiveWindow.test.ts` already proves the mechanism end to end (a real
notebook, a real selection, a real run reaching a terminal state) with no
live Viya connection needed at all; these boxes are about what a person
actually sees, which that suite cannot check.

**Pre-work:** a Viya connection, the run target set to a Viya profile
(`docs/running-python.md`'s own pre-work). Any `.py` file with at least two
lines is enough.

- [ ] **11.1** **New Interactive Window** — run **Python on Viya: New
  Interactive Window** from the Command Palette. **Expect:** an empty,
  unsaved notebook editor opens beside your `.py` file without stealing its
  focus — your cursor stays in the `.py` file, not the notebook.
- [ ] **11.2** **Run Selection in Interactive Window** — select a line in
  your `.py` file (e.g. `print("hello")`) and run **Python on Viya: Run
  Selection in Interactive Window** from the Command Palette or the editor
  context menu. **Expect:** a new cell appears in the interactive window
  carrying exactly that text, runs against your Viya session, and shows its
  output — the same rich-output behaviour [Notebooks](../../notebooks.md)
  describes for a `.ipynb` cell (an image, an HTML table, a traceback with a
  Problems-panel entry).
- [ ] **11.3** **The window persists across runs, unlike the Result panel** —
  select a different line and run it into the interactive window again.
  **Expect:** a **second** cell is appended below the first, which keeps its
  own output — not replaced, the way the Result panel replaces itself on
  every run. Define a variable in one cell's selection and reference it in
  the next; **expect** it resolves, proving the two cells share one
  interpreter namespace.
- [ ] **11.4** **No selection is a no-op** — with nothing selected, run
  **Run Selection in Interactive Window**. **Expect:** nothing happens — no
  new cell, no error — matching Run Selection's own established behaviour
  (`docs/running-python.md`).
- [ ] **11.5** **Reopening after close creates a fresh window, not an
  error** — close the interactive window's tab, then run **Run Selection in
  Interactive Window** again. **Expect:** a brand-new, empty interactive
  window opens and receives the cell — the extension does not try to revive
  the closed one or complain that it is gone.

Add further numbered items here (`11.6`, `11.7`, …) as later Phase 11 slices
land, the same way every other phase file did.
