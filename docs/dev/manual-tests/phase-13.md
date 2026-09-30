<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 13 (Feature completion)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

> Renumbered from Phase 12 to Phase 13, 2026-09-22 — see
> `docs/phases/phase-13.md`'s own provenance note.

Add numbered items here (`13.1`, `13.2`, …) as slices land, the same way
every other phase file did.

## 13n — output after a `SAS.submit()` graph

See `docs/phases/phase-13.md`'s "13n built" Runbook entry. Build a `.vsix`
from this branch, install it, and connect a Viya profile. The files are in
`test/smoke/`. On v0.1.4 each of these shows no printed output.

- [x] **13.1** **Output after `PROC SGPLOT`.** Run File on
  `release_smoke_sgplot.py`. **Expect:** all three `sgplot demo` lines in
  **Python on Viya: Output**, then `Finished.`, and the scatter plot in the
  Result panel.
- [x] **13.2** **A traceback after `PROC SGPLOT`.** Uncomment the file's
  last line and Run File again. **Expect:** the three lines, then a
  `ZeroDivisionError` traceback in the Result panel and a Problems entry on
  that line. Then, without reconnecting, Run File on
  `release_smoke_traceback.py`. **Expect:** its traceback and Problems
  entries as its header comment describes. Restore the comment afterwards.
- [x] **13.3** **The smoke test.** Run File on `release_smoke.py` twice.
  **Expect:** every check's line in the output channel, a summary with no
  `FAIL`, and each `LOOK` item's output in the Result panel.
- [x] **13.4** **A notebook.** Open `release_smoke.ipynb`, pick the
  **Python on Viya** kernel and **Run All**. **Expect:** every cell's printed
  lines, the 5-row `SAS.show` table, the bar chart and the 3-row
  `proc print` table in their cells. **Clear All Outputs** before closing.
- [x] **13.5** **After a cancel.** Run File on `release_smoke_cancel.py` and
  cancel it as its header comment describes. Once the next run can start,
  Run File on `release_smoke_sgplot.py` with its last line uncommented.
  **Expect:** the same as 13.2: the three lines and the traceback. Restore
  the comment afterwards.
