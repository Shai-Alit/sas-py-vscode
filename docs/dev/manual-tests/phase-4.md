<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 4 (Diagnostics)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend. These items were originally folded into `phase-3.md`'s traceback/rich-output sections (they re-use the same scripts) but each carries its own explicit phase tag (`4c`/`4d`) in its title, so they live here instead — see `setup.md`'s History section for that split.

## Problems panel, Show Environment pointer, traceback reveal

- [x] **4.1** **(live) `ModuleNotFoundError` points at Show Environment** — run
  `import polars` (or any absent package).
  **Expect:** a `ModuleNotFoundError` traceback whose diagnostic message (the
  line after "Finished with an error." in the output channel) has one
  sentence appended: `Run "Python on Viya: Show Environment" to see what is
  installed on this connection.` The structured traceback itself (Result
  panel, once 4d wires it) keeps Python's own text unchanged.
  **Implemented in phase 4c** (`src/backend/tracebackDiagnostics.ts`'s
  `withModuleNotFoundGuidance`), unit-covered, and **verified live
  2026-09-01** against `verde` with a branch `.vsix` — the appended sentence
  appears on the diagnostic exactly as above.
- [x] **4.2** **(live) A failed run lands in the Problems panel — phase 4d** — run a
  file whose last line is `c = 1 / 0`.
  **Expect:** after "Finished with an error.", the **Problems** panel
  (View → Problems) shows exactly one entry for this file — `Error`, source
  "Python on Viya", its message the same `ZeroDivisionError: division by
  zero` line the output channel shows — positioned on the `1 / 0` line.
  Expanding it walks the rest of the call stack (`relatedInformation`).
  Re-run the file with the error fixed → the Problems entry clears at the
  **start** of the run. Run Selection starting partway down the file → the
  entry still lands on the true editor line (`lineOffset` is added). A
  SAS-side failure with no Python traceback (e.g. `PROC PYTHON` not licensed)
  produces **no** Problems entry — only the output-channel message.
  Implemented in phase 4d (`src/run/diagnostics.ts`); **verified live
  2026-09-02** against `verde` with a branch `.vsix` — the entry lands on
  the `1 / 0` line, clears on a clean re-run, and follows the selection's
  `lineOffset`.
- [x] **4.3** **(live) Traceback frames jump to the editor — phase 4d** — run the
  `outer()`/`inner()` script from §7 and let it raise, so the Result panel
  shows its structured traceback.
  **Expect:** each frame from your own file (`<string>`) is underlined and
  focusable — click it, or Tab to it and press Enter/Space, and the editor
  reveals that line (adding the `lineOffset` for a Run Selection). A frame
  with an absolute library path is plain text, not interactive. No CSP
  change — the panel still loads nothing from the network. **Verified live
  2026-09-02** against `verde` with a branch `.vsix` — clicking a `<string>`
  frame reveals it in the editor column (not over the panel); a library
  frame is not clickable. **Phase 5d-iv** adds a per-run token to the
  `revealFrame` message so a click delayed past the start of a later run is
  dropped, not resolved against the new run's traceback — a race that needs
  the host event loop stalled across a whole run to hit, so it is
  unit/integration-covered (`result-panel.test.ts`) rather than a hand-run
  step here.

