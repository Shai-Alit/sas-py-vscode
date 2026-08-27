# Status

**Phase 3 is done; Phase 4 has not yet started.** Its between-phase
housekeeping (2026-08-27) fixed a stale `PRODUCTION_PLAN.md` reference to
ADR-0011's superseded default, rolled two open "After 3d-i" punch-list items
into `docs/phases/phase-4.md`'s own Runbook, and ran the live check
phase-3.md's own closing note called for: `probeRuntime()`'s full wire
sequence (job, `SYSCC`, directory listing, content fetch, delete, cleanup),
confirmed against `verde` — see `docs/phases/phase-3.md`'s Finding 71. The
two open Dependabot alerts (both `serialize-javascript`, `GHSA-5C6J-R48X-RMVQ`
high and `GHSA-QJ8W-GFJ5-8C6V` moderate) were cleared 2026-08-27 by pinning
`serialize-javascript ^7.0.5` in `package.json`'s `overrides` — the
child-override route the August allow-list note said to check and then did not
apply to these two; the allow-list is now down to the one `low` `diff` entry.
See ADR-0005's 2026-08-27 amendments. See `docs/phases/phase-3.md`. Slice 3a (`PROC PYTHON`
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
the full account. **3e is merged, as
[PR #67](https://github.com/Shai-Alit/sas-py-vscode/pull/67)** —
`ExecutionBackend.probeRuntime()` (widening `BackendCapabilities.runtime` from
the seam's own `"unprobed"`-only type), a fixed, extension-authored Python
probe that writes its answer to a file rather than printing it (finding 62
applied, not a new finding), a per-profile `globalState` cache with explicit
refresh, and the new `Show environment`/`Refresh Environment Info` commands
opening a read-only virtual document. Two rounds of in-session adversarial
review, an independent senior-review pass, and the automated PR reviewer
between them found and fixed: a cache-hit path that connected before ever
checking the cache, defeating the point of caching for a fresh window; a
distribution with malformed `METADATA` that could crash or blank the whole
probe; a `del` that only ran on the success path; a coverage-branches gap the
eventual unit-tier move exposed (95.03% once fixed, floor unmoved); an
implicit vs. explicit fetch cap on the probe's own file read; a stale-runtime-
snapshot gap after a failed re-probe; and a transcription error in this
slice's own citation of finding 62. See phase-3.md's 3e entry for the full
account.

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
| 3 — Run Python (vertical slice) | ✅ done (3a, 3b, 3c-probe, 3c-i, 3c-ii, 3d-i merged [PR #63](https://github.com/Shai-Alit/sas-py-vscode/pull/63), 3d-ii merged [PR #65](https://github.com/Shai-Alit/sas-py-vscode/pull/65), 3e merged [PR #67](https://github.com/Shai-Alit/sas-py-vscode/pull/67)) | `docs/phases/phase-3.md` |
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
