# Status

**Phase 3's implementation is done; one more slice (3f) is queued before**
**Phase 4 starts.** The first full run of `docs/dev/manual-test-pass.md`
(2026-08-27, against live `verde`/`Innov` profiles) found three confirmed
regressions against invariants Phase 3 already claimed as done — 3b's "no SAS
NOTEs, no page-break banners" and the cross-cutting "failures are
diagnosable" promise don't currently hold. Triaged 2026-08-28; full root
causes and the punch list are in `docs/phases/phase-3.md`'s new **3f** entry.
Phase 4 (Diagnostics) does not start until 3f closes, since it would only
compound on top of an already-broken diagnosability story. See
`docs/dev/manual-test-pass.md` for the annotated checklist this pass
produced. **3f's fixes are implemented (2026-08-28); a first independent
review pass is also complete**, raising three findings — two fixed
(`3d965d0`, `34a2987`), one left open and documented rather than closed
(the untested `run/commands.ts` → `forgetProfile` wiring) — **not yet
merged, no PR opened.** See phase-3.md's own 3f entry for exactly what
landed and what each review finding was. Still open, in order: a second,
final adversarial pass over the post-review diff, two hand-run retests,
and a full re-run of the manual test pass — none of which this session can
do itself (no live Viya deployment reachable here, and this project's own
rule against Claude running the suite).

**Full re-run of the manual test pass, complete 2026-08-30**, against a
`.vsix` built from `phase-3f-manual-test-regressions` (still unmerged) —
confirms the fixes above hold live for every item this slice targeted
(Cold-start Connect, Idle reap, both Sign Out paths, Failures are
diagnosable, the page-break banner, the big package list, and the reworded
Cancel/`defaultProfile`/Shared-sessions items). It also surfaced three
findings this slice's fixes don't cover, none of which it was written to
fix: Reload reconnects now fails a different way (a stale-fileref collision
that clears itself after 60–90 seconds, Finding 72), the deep-recursion
container crash reproducing identically on retry (still unexplained), and
an oversized rich output write taking the whole compute session down rather
than skipping cleanly (Finding 73). `docs/dev/manual-test-pass.md` and
phase-3.md's own **3f** entry (new open items, and Findings 72–73) both
reflect this.

**Work on those three, 2026-08-31.** **Finding 72 is root-caused and fixed**
on `phase-3f-manual-test-regressions`: the per-run fileref counter is a
per-backend value that restarts at zero on a window reload while the
re-attached session still holds the names the old backend assigned. The
backend now seeds that counter from the session's own `filerefs`
collection on the first run after connecting, with a bounded assign-retry
as a backstop for two windows sharing one session; unit-covered in
`compute-fileref.test.ts` and `proc-python-backend.test.ts`, and
**verified live** against a branch `.vsix` — `print(k)` after a reload
returns on the first attempt. **Finding 73 is settled as not a size-cap
defect** — a script whose figure *generation* exhausts the container is an
OOM kill outside ADR-0019's transfer cap; ADR-0019 is amended and §8's
test script reworded, and the reworded script's skip path is **verified
live** (returns the "could not retrieve rich output file …" note, session
survives). One small `translate()` message change for the rare OOM path
is left as an optional, non-blocking follow-up. **The deep-recursion
crash is resolved** — verified live 2026-08-31 that a minimal recursion
gives a clean `RecursionError` with the session intact, so the earlier
crash was `test_deep_stack_trim.py`'s own `unittest` harness
(`sys.exit()` under `PROC PYTHON`), not `PROC PYTHON`; §7 is reworded and
ticked. That run turned up **one new, deferred item** (Finding 74): a
*failing* run's output stream carries the Python interpreter banner and
`>>>` markers, which §6 says it should not — error-path only, output
channel not the diagnostic log, line types not yet captured; its own
item for a later slice, not a 3f blocker. Still open before a PR opens:
the second, final adversarial pass and the profile-switch retest.

**Second, final adversarial review pass, 2026-08-31** (Sean's own VS Code
window, full branch diff against `main`, per this project's standing
review policy): no P0/P1s, disciplined error handling, no secrets, clean
strict-TypeScript throughout. One minor finding worth fixing: in the
Finding 72 fix above, `ProcPythonBackend.seedFilerefCounter` set its
`filerefCounterSeeded` flag before confirming the fileref listing actually
succeeded, so a transient failure or a cancel mid-`GET` disabled seeding
for the rest of the connection — dropping every later run in it back onto
the 16-attempt retry, which cannot walk past a reattached session holding
more than 16 `PYnnnnnn` names, reproducing Finding 72's own symptom in a
narrower window. **Fixed the same day**: the flag now sets only after the
listing reports `ok`, so a failed or cancelled attempt retries on the next
run instead of sticking; re-seeding is safe since the counter only ever
moves up. A new regression test pins the retry. Independently re-verified
this session (traced the reorder, the doc-comment update, and the new
test's arithmetic against the actual diff, not the review's word alone).
Two other notes were left as documented, non-blocking judgment calls
rather than fixes: the retry loop has no backoff between attempts, and
`connect()` no longer de-duplicates concurrent calls when no profile is
configured. See phase-3.md's Finding 72 punch-list item for the full
account. **Still open before a PR opens: the profile-switch retest only.**

**Profile-switch retest closed, 2026-08-31, not reproduced.** Started a
long-running program on profile A, switched the active profile to B
mid-run, ran a new selection — B was not yet signed in, so it prompted for
sign-in first, then ran only the selection just invoked. Repeated with B
already signed in from that first pass: switching alone triggered no
sign-in and, more to the point, ran nothing on its own. Confirms the code
read (no queue/replay/resume path exists) in both the needs-auth and the
already-authenticated case; the original report's likely explanation
(Run was in fact invoked a second time) stands, uncontradicted by two
clean passes. **3f's punch list is now fully closed** except Finding 74
(the interpreter banner/`>>>` markers), which is deliberately deferred to
a later slice, not a 3f blocker. **Nothing left before a PR opens.**

Its between-phase housekeeping
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
| 3 — Run Python (vertical slice) | 3a–3e done (3d-i [PR #63](https://github.com/Shai-Alit/sas-py-vscode/pull/63), 3d-ii [PR #65](https://github.com/Shai-Alit/sas-py-vscode/pull/65), 3e [PR #67](https://github.com/Shai-Alit/sas-py-vscode/pull/67)); **3f (manual-test-pass regressions) fully implemented and closed on `phase-3f-manual-test-regressions` (both review passes, coverage ratchet, and the profile-switch retest all done); not yet merged, no PR opened — Finding 74 deliberately deferred, not a blocker** | `docs/phases/phase-3.md` |
| 4 — Diagnostics | not started — blocked on Phase 3's 3f | `docs/phases/phase-4.md` |
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
