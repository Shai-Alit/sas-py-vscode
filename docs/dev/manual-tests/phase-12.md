<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 12 (AI-agent integration)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## 12e — CSV formula-injection guard

`pythonOnViya.csvExport.guardFormulaInjection`, off by default, covers both
CSV export surfaces (SAS Libraries and CAS). See `docs/phases/phase-12.md`'s
12e Runbook entry for the design; §11.17–§11.21 (`phase-11.md`) already cover
ordinary CSV export and are not repeated here.

- [ ] **12.1** **The guard is off by default — a formula-shaped cell is
  written untouched.** With `pythonOnViya.csvExport.guardFormulaInjection`
  left at its default (unset/`false`), export a SAS library table with a
  character column value that starts with `=`, `+`, `-`, or `@` (a quick way
  to get one: `data work.test; input name $ 20.; datalines; =SUM(A1:A9)
  ;run;`, then export `work.test`). **Expect:** the file opens in a text
  editor showing the value exactly as entered, no leading `'`.
- [ ] **12.2** **Turn the guard on and repeat for a SAS library table.**
  Set `pythonOnViya.csvExport.guardFormulaInjection` to `true` (workspace or
  user setting), then export the same table again. **Expect:** the
  formula-shaped cell now has a leading `'` in the file; opening it in Excel
  or Google Sheets shows the literal text, not a formula result/error. A
  plain text value elsewhere in the same column is unaffected.
- [ ] **12.3** **A negative number is never touched, guard on.** In the same
  export, confirm a numeric column's negative value (e.g. `-5`) has **no**
  leading `'` — it still opens as a number, not text, in a spreadsheet.
- [ ] **12.4** **Repeat 12.2/12.3 for a CAS table**, guard on — right-click a
  CAS table with a `varchar`/`char` column holding a formula-shaped value and
  export to CSV. **Expect:** the same leading-`'` behaviour as 12.2, and the
  same untouched-negative-number behaviour as 12.3 for a numeric CAS column.
- [ ] **12.5** **The header row is never guarded.** Whichever export above is
  handy, confirm the first (header) line's column names have no leading `'`
  even when the guard is on — only data rows are ever guarded.
- [ ] **12.6** **A field that already needs RFC-4180 quoting still guards
  correctly.** Export a table with a character value that both starts with a
  formula-triggering character and contains a comma (e.g. `=a,b`). **Expect:**
  the file shows `"'=a,b"` — the leading `'` inside the quotes, not instead of
  them.
- [ ] **12.7** **Setting change takes effect on the next export, no reload.**
  Toggle the setting and export the same table twice in the same window
  session, once each way. **Expect:** no reload needed; each export reflects
  whatever the setting reads at the moment **Export to CSV** was clicked.
