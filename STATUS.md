# Status

**Current phase: 3** — see `docs/phases/phase-3.md`. Slice 3a (`PROC PYTHON`
backend, plus the `resolveContext` no-such-context correction) and 3b (the log
filter) are merged. 3c's own probe (step 1, findings 61–66) is also merged —
the file-write-plus-Compute-files-API mechanism won outright over
base64-through-the-log. 3c-i (matplotlib/pandas rich-output capture) is merged
too (PR #59, ADR-0019), and so is 3c-ii (traceback structuring: `parseTraceback`
drops the harness's `<stdin>` wrapper frames, finding 39 — no ADR needed, a
narrow correction rather than a competing design). **3d-i is merged, as
[PR #63](https://github.com/Shai-Alit/sas-py-vscode/pull/63)** — the run
target (ADR-0011) plus, per a scope decision settled before writing any code,
the full `Run File`/`Run Selection`/`Cancel`/`Reset Python State` commands and
the program output channel, not only the run-target mechanism the Runbook's
own punch list had detailed going in. See `docs/phases/phase-3.md`'s 3d-i
entry for the scope note and the design decisions. **The "confirm by hand"
editor check ADR-0011 called for was run, 2026-08-26, and found the outcome
the ADR said would mean revisiting it**: this extension's own Run File came
up as the *primary* `editor/title/run` button, ahead of `ms-python.python`'s,
on a folder where it had never once been invoked before — not explainable as
"last used remembered." **Resolved the same day by
[ADR-0020](docs/adr/0020-run-target-defaults-to-local.md)**, which reverses
the run target's default to Local — an unconfigured workspace now
contributes nothing to the editor, so this extension can only win the
primary slot once a user has explicitly asked for Viya. See phase-3.md's
findings write-up and ADR-0020 for the full record. **3d-ii is merged, as
[PR #65](https://github.com/Shai-Alit/sas-py-vscode/pull/65)** — this
repository's first webview: a singleton `WebviewPanel`, CSP-locked, fed by a
buffered host↔webview message protocol, per
[ADR-0021](docs/adr/0021-result-panel-webview.md), opening only for a run
that produces `text/html`, `image/png`, or a structured traceback. Two
rounds of in-session adversarial review plus a third manual pass in Sean's
own VS Code window found and fixed real defects before the PR opened —
most notably a user closing the panel mid-run permanently using up that
run's one reveal, caught only by `npm run test:integration` against the
real VS Code host, since the mocked-`vscode` unit tier never executes
`test/integration/**` at all. Two automated PR reviewers then raised a
CodeQL origin-check finding (dismissed as a scanner false positive — the
CSP already makes it unreachable) and an incorrect claim that
`style-src 'unsafe-inline'` permits script execution (it does not; kept,
for pandas fidelity, and turned into an explicit recorded exception in
ADR-0021/`SECURITY.md`, pinned by a test). See phase-3.md's 3d-ii entry for
the full account. **3e (the environment probe) is implemented, 2026-08-27 —
not yet committed or merged.** `ExecutionBackend.probeRuntime()` (widening
`BackendCapabilities.runtime`), `src/backend/environment.ts`,
`src/run/environmentStore.ts`/`environmentDocument.ts`/`environmentPanel.ts`/
`environmentStatusBar.ts`, and the new `Show environment`/`Refresh
Environment Info` commands. The transport question (why the probe writes a
file rather than printing) is finding 62 applied, not a new finding — see
phase-3.md's 3e entry for the full design record, including the seam-vs.
-separate-module fork it settles and the compile-breaking test-double fix it
required. The scoped in-session adversarial-review pass over the finished diff
has now run too, and found one Major defect: `showEnvironment`'s cache-hit path
was connecting before ever checking the cache, contradicting its own doc
comment — fixed in `commands.ts`, see phase-3.md's 3e entry for the full
finding. A subsequent independent senior-review pass over the finished diff
then applied four more fixes, all in the same change: the probe now skips a
distribution whose name or version is not a non-empty string (a broken
`METADATA` would otherwise crash the probe and be misreported as
`runtime-unavailable`); the cache-before-connect fix gained the regression
test it had been missing; a failed probe's `SYSERRORTEXT` is now logged so
"see the log for details" is true; and the probe's `del` moved into a
`finally` so a raising probe still cleans up after itself. The stray
comment-only `test/unit/environment-store.test.ts` is removed. Sean then ran
`npm run verify` and `npm run test:integration`: `test:integration` passes
207/207 (with the new cache-hit regression case) and `test:unit` 1111/1111,
but `npm run lint` flagged two errors, now fixed in the same change —
`environmentPanel.ts` switched to an optional chain, and `environmentStore.ts`
switched to `import type * as vscode` (it uses `vscode` only for a type),
which meant removing it from `.c8rc.json`'s exclude list and moving its test
from the integration tier to `test/unit/environment-store.test.ts` behind a
`Map`-backed memento — it is a plain store with no runtime `vscode` use, so
the unit tier is where it belongs. That tier move then showed a real gap:
Sean's next `npm run verify` reported branches coverage at 94.93%, just under
`.c8rc.json`'s unchanged 95% floor — `environment.ts`'s own two guard
conditions (`parseEnvironmentProbeFile`'s not-object-or-null check,
`readPackages`'s not-an-array check) had never had every arm forced by a test.
Fixed by adding three cases to `backend-environment.test.ts` that force each
missing arm, not by moving the floor. **Confirmed, 2026-08-27:** Sean's next
`npm run verify` (1122 passing) measured branches at 95.03%, clearing the
floor again with every other metric unchanged (93.87/93.48/93.87). `npm run
build` then came back green too. Still ahead: his own manual VS Code review
pass over the final state (already done once, on a diff only a few small
fixes lighter than this one), and the commit/PR.

> Update this file when a slice lands, not just at phase boundaries — in the
> same PR that does the work. It is the
> only file every session should need to open to know where to start — open the
> phase file it points to, not the others, unless the current file says
> otherwise or you have a specific reason to check history.

## Phase index

| Phase | Status | File |
|---|---|---|
| 0 — Repository foundation | ✅ done | `docs/phases/phase-0.md` |
| 1 — Auth & connection profiles | ✅ done | `docs/phases/phase-1.md` |
| 2a — Compute core & VS Code shell | ✅ done | `docs/phases/phase-2a.md` |
| 2b — Backend seam, dialects, job log & the pump (covers 2b and 2c) | ✅ done | `docs/phases/phase-2b.md` |
| 3 — Run Python (vertical slice) | ▶ in progress (3a, 3b, 3c-probe, 3c-i, 3c-ii, 3d-i merged [PR #63](https://github.com/Shai-Alit/sas-py-vscode/pull/63), 3d-ii merged [PR #65](https://github.com/Shai-Alit/sas-py-vscode/pull/65), 3e implemented 2026-08-27, not yet committed) | `docs/phases/phase-3.md` |
| 4 — Diagnostics | not started | `docs/phases/phase-4.md` |
| 5 — Hardening & first release | not started | `docs/phases/phase-5.md` |
| 6 — SAS Content explorer | not started | `docs/phases/phase-6.md` |
| 7 — Libraries and data viewer | not started | `docs/phases/phase-7.md` |
| 8 — CAS and SWAT | not started | `docs/phases/phase-8.md` |
| 9 — Notebooks | not started | `docs/phases/phase-9.md` |
| 10 — Viya environment awareness | not started | `docs/phases/phase-10.md` |
| 11 — Remaining parity gaps | not started | `docs/phases/phase-11.md` |
| 12 — Second execution backend | not started | `docs/phases/phase-12.md` |

Each phase file bundles everything that phase needs: the plan section
(architecture, scope), the runbook punch list (commands, order, barriers), and
the relevant probe findings — so one file is normally all a session needs
beyond this index and the trimmed `RUNBOOK.md` / `PRODUCTION_PLAN.md` cores.

Phase 2b covers what were originally separate "2b" and "2c" labels in the
source runbook — they share one continuous command block in the original
document and don't split cleanly, so they're kept as one phase file here.
