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
notebook, a real selection, a real run reaching a terminal state, and — a
third automated case — a fresh notebook getting created after the tracked
one is closed) with no live Viya connection needed at all; these boxes are
about what a person actually sees, which that suite cannot check.

**Pre-work:** a Viya connection, the run target set to a Viya profile
(`docs/running-python.md`'s own pre-work). Any `.py` file with at least two
lines is enough.

- [x] **11.1** **New Interactive Window** — run **Python on Viya: New
  Interactive Window** from the Command Palette. **Expect:** an empty,
  unsaved notebook editor opens beside your `.py` file without stealing its
  focus — your cursor stays in the `.py` file, not the notebook.
- [ ] **11.2** **Run Selection in Interactive Window** — select a line in
  your `.py` file (e.g. `print("hello")`) and run **Python on Viya: Run
  Selection in Interactive Window** from the Command Palette or the editor
  context menu. **Expect:** a new cell appears in the interactive window
  carrying exactly that text, runs against your Viya session, and shows its
  output — the same rich-output behaviour [Notebooks](../../notebooks.md)
  describes for a `.ipynb` cell (a traceback with a Problems-panel entry).
  For rich output specifically, select a line that **writes a file**
  ([ADR-0019](../../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)
  — there is no implicit `plt.show()`/`_repr_html_` capture, the same rule
  `docs/notebooks.md`'s own "Output" section states and `phase-9.md`'s 9.10/
  9.13 manual-test items already exercise for a `.ipynb` cell):
  `import matplotlib.pyplot as plt; plt.plot([1,2,3]); plt.savefig("fig.png")`
  for an image, or
  `import pandas as pd; pd.DataFrame({"a": [1, 2]}).to_html("table.html")`
  for a table.
  **(2026-09-17) retested with `plt.show()` and a bare `df.head()` (no file
  write) — correctly produced no rich output, per ADR-0019; not a defect.
  Not yet retested with the file-writing form above** — leaving `[ ]` rather
  than `[-]`, since this is awaiting a retest of the right repro, not a
  confirmed known gap (`setup.md`'s own tagging-legend rule).
- [x] **11.3** **The window persists across runs, unlike the Result panel** —
  select a different line and run it into the interactive window again.
  **Expect:** a **second** cell is appended below the first, which keeps its
  own output — not replaced, the way the Result panel replaces itself on
  every run. Define a variable in one cell's selection and reference it in
  the next; **expect** it resolves, proving the two cells share one
  interpreter namespace.
- [x] **11.4** **No selection, or no active Python editor, informs rather
  than silently doing nothing** — with nothing selected, run **Run Selection
  in Interactive Window**; separately, run it with a non-Python file active.
  **Expect:** an informational message ("Select some code to run." /
  "Open a Python file to run it on SAS Viya.") and no new cell — matching
  Run Selection's own established behaviour (`docs/running-python.md`), not
  a silent no-op.
- [x] **11.5** **Reopening after close creates a fresh window, not an
  error** — close the interactive window's tab, then run **Run Selection in
  Interactive Window** again. **Expect:** a brand-new, empty interactive
  window opens and receives the cell — the extension does not try to revive
  the closed one or complain that it is gone.

Add further numbered items here (`11.6`, `11.7`, …) as later Phase 11 slices
land, the same way every other phase file did.
