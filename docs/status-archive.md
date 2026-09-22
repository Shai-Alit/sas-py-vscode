<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Status archive

The slice-by-slice narrative that `STATUS.md` accumulated from Phase 3's
final slice (3f) through the v0.1.1 first release and the Phase 5→6
between-phase housekeeping. Moved here 2026-09-09 to keep `STATUS.md` small
enough to load every session — it had grown past 1,500 lines.

This is history, not current state. For where the project is now and what to
do next, read `STATUS.md` at the repository root. Per-phase detail (plan,
punch list, probe findings) lives in each `docs/phases/phase-N.md`; this file
is the cross-phase chronological record and the reasoning captured in passing.

---

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

**PR opened, then merged, 2026-08-31: [PR #77](https://github.com/Shai-Alit/sas-py-vscode/pull/77)**, squashed as `b21317b` on `main`. **Phase 3 (3a–3f) is now fully done.** Confirmed independently — local `main` fast-forwarded to `b21317b`, matching `origin/main`, working tree clean. **Phase 4 (Diagnostics) is no longer blocked** and can start next session. This PR's own merge is the trigger for this project's own between-phase-housekeeping checklist (ADRs, punch-list completeness, RUNBOOK/PRODUCTION_PLAN currency, this file's phase pointer, any scratch-file reconciliation, manual-test completeness, and Dependabot advisories) — not yet run; see chat for the proposal on scope and timing. The local `phase-3f-manual-test-regressions` branch is stale now (merged) — safe to `git branch -D` and `git fetch --prune` once ready.

**Between-phase housekeeping for the Phase 3→4 boundary ran twice**, with 3f's
own rework landing in between: a first pass around 2026-08-27 (before the
manual-test pass surfaced the regressions that became 3f — see
`b53d3e9`/`80293a5` for that day's Dependabot clearance, and
`phase-3-runbook-pending.md` in the project folder for that pass's
scratch-file reconciliation), then a second, final pass on 2026-08-31 that
re-verified the first pass's items were still accurate after 3f's changes
and closed out the rest — landed as `3b658a7`** (docs-only, `[skip-review]`,
plus the project-folder-only scratch-file re-verification that leaves no git
diff of its own): ticked 3f's own header in `phase-3.md` now that its punch
list is closed (Finding 74 excepted, same carried-over pattern 3d-i used),
retired the "rich output has no clean return path" risk row in
`PRODUCTION_PLAN.md` §6 (settled by 3c-i/ADR-0019), and replaced a
hard-coded, twice-stale coverage figure there with a pointer at `.c8rc.json`
instead. That closes the checklist's punch-list-completeness, plan-currency,
and scratch-file-reconciliation items. This paragraph itself closes the
phase-pointer item — the previous paragraph's "not yet run" was accurate when
written but went stale the moment `3b658a7` landed without this file being
updated in the same commit; caught and fixed 2026-08-31 rather than left to
misdirect the next session. **One item is genuinely open, not silently
assumed done: today's (2026-08-31) Dependabot run hasn't been looked at.**
Last Monday's (2026-08-24) findings were addressed the same week
(`b53d3e9`/`80293a5`, 2026-08-27) and `scripts/advisory-allowlist.json`
reflects that review accurately (one low-severity `diff` entry, expires
2026-11-12). But Dependabot runs on its own schedule and has almost certainly
produced a fresh batch today, unreviewed. **Sean's call, 2026-08-31: don't
spend pre-first-release time chasing that churn now** — carry it as an open
item to the next between-phase checkpoint, by which point Dependabot will
have run again regardless. Manual-test completeness is covered by the record
above through 2026-08-31.

**Phase 4 started, 2026-08-31. 4a is merged, as
[PR #78](https://github.com/Shai-Alit/sas-py-vscode/pull/78), squashed as
`8b1bc7c` on `main`.** `docs/phases/phase-4.md`'s own 4a entry — a regression
suite for three `commands.ts` paths that only exist once a real backend is
running (`backendFor()`'s reconnect-orphan `close()`, `cancelRun`'s
`currentReset` fallback, and the `busy` serialisation guard
`runNow`/`resetPythonState` share) — is implemented, in
`test/integration/run/commands-backend.test.ts` plus a new
`test/helpers/recorded-connection.ts`. Test-infrastructure only, no `src/`
behaviour change; see phase-4.md's own 4a entry for the two small additions
made to `recorded-proc-python.ts`'s shared simulated wire and why. Before the
PR opened: an `exactOptionalPropertyTypes` typecheck error `npm run
typecheck`'s `tsconfig.test.json` step caught that a bare `tsc --noEmit`
against the app's own config did not, fixed with a conditional spread; and an
adversarial review pass (2026-08-31, verdict "looks good, merge-ready") whose
one real finding — a stale `AbortSignal` listener on `SimulatedJob.nextPage`
left attached when a poll settles via `push`/`finish` rather than abort,
latent today only because this module's own consumers stream few enough
lines to never trip Node's `maxListeners` warning — was fixed the same day.
A second, smaller lint fix (`prefer-const` on that same cleanup closure)
landed after CI caught it on the open PR, restructured so both `onAbort` and
`settle` stay `const` and `settle` alone owns the listener's removal on every
path, not just the abort one. `npm run test:unit`, `npm run test:integration`
and `npm run lint` were re-confirmed green after each of those two fixes, not
assumed from the first pass. **Also merged the same day, independent of 4a:
[PR #79](https://github.com/Shai-Alit/sas-py-vscode/pull/79)** (squashed as
`9f8540d`) — a one-line `.gitignore` addition for `docs/.vitepress/.temp/`
(VitePress's own build cache, noticed sitting untracked in this session's
mount); docs-only, no adversarial review pass needed. Local branches for both
are gone (`gh pr merge --delete-branch` on each); the stale local
`phase-4a-backend-path-regression-tests` and the two stale
`remotes/origin/*` refs for the deleted branches are cosmetic only — `git
branch -D phase-4a-backend-path-regression-tests && git fetch --prune`
whenever convenient, not urgent.

**4b (probe cancellation) run and closed, 2026-09-01** — a live probe against
`verde`, no code touched. Two findings, both in `docs/phases/phase-4.md`'s own
4b entry and Probe findings section: **Finding 75** — the deployment requires
`If-Match` on a job cancel; `cancelJob()` (`job.ts:508-521`) doesn't send one,
so every cancel this extension issues against this deployment is rejected
outright with `428` today, and `cancelRun()` (`commands.ts:518-522`) discards
that failure without ever inspecting it — the "Cancelled." message users see
comes entirely from a local abort in `LogStream`, independent of whether the
paired server request succeeded. **Finding 76** — even a correctly-`If-Match`'d
cancel doesn't preempt a running Python statement: a 60-second loop cancelled
~6s in still ran its full 60.01s before SAS tore the interpreter down, so
`cancelRun`'s existing "busy" messaging has no fallback for a run or reset
queued behind a still-executing cancelled job (checked directly, not
assumed — `backend.busy` clears on the local abort well before the session is
actually free, so the "busy" message never fires; the user just gets a
silently slow Run/Reset). **Decided with Sean the same day: fold both fixes
into 4c** rather than open a separate slice — 4c is now traceback parsing
*plus* the `cancelJob` `If-Match` fix and a decision on `cancelRun`'s
messaging gap, raised from *Medium* to reflect the added scope.

**4c implemented, 2026-09-01; not yet verified or reviewed.** All of it in
one pass: `src/backend/tracebackDiagnostics.ts` (new — the `<string>`-frame
offset mapping plus `primaryFrame`/`primaryPosition` for 4d, none of it
wired into anything user-visible yet), the `ModuleNotFoundError` → `Show
Environment` pointer in `procPython.ts`'s diagnostic message, `cancelJob`'s
`If-Match` fix (a fresh `ETag` read off the job's own `self` relation right
before the cancel `PUT` — Finding 75), `cancelRun` no longer discarding a
cancel failure, and the "Cancelled." message reworded rather than papering
over Finding 76's queued-run gap with new background-tracking machinery
(considered and rejected as disproportionate for this slice — see
`phase-4.md`'s own 4c entry for the reasoning). Finding 74's triage is also
closed: not a `parseTraceback` defect — see `phase-3.md`'s own Finding 74
entry — with two adjacent, smaller gaps found and deliberately left open
rather than fixed here. Unit tests updated throughout, including two test
fixtures (`proc-python-backend.test.ts`'s router, and
`test/helpers/recorded-proc-python.ts`'s simulated wire) that needed a
`self` relation added to their job payloads, without which `cancelJob`'s new
code fails `link-missing` before ever reaching the server.

**Verified and independently reviewed, 2026-09-01.** Sean's own
`tsc`/`prettier`/`test`/`lint` run first (all green), then a senior-review
pass over the full branch diff against `main`: no P0/P1s — the `cancelJob`
`If-Match` fix mirrors `fileref.ts`/`files.ts`'s existing fresh-`ETag`
pattern exactly, error handling is disciplined (no swallowed failures, every
new call timeout- and abort-bounded), the new `self` relation is confirmed
present on a live job payload (finding 46) so its `link-missing` arm is a
real guard rather than a new failure mode, and the tests are HTTP-boundary
mocks covering every new branch. Three review notes were folded in the same
day: (1) `primaryFrame` reworked from an index walk to a `for…of` over a
reversed shallow copy, removing an unreachable `noUncheckedIndexedAccess`
guard branch — `tracebackDiagnostics.ts` is now 100% branch-covered and the
suite's 95% floor is unmoved; (2) a new `primaryFrame` test for the
non-empty "no `<string>` frame anywhere" case; (3) `backend.ts`'s
`RichOutput` doc comment, which enumerated "the four" un-`l10n`'d
extension-authored strings, corrected to five (this slice's
`withModuleNotFoundGuidance` is the fifth) with a note that a sixth should
reopen ADR-0015's localisation boundary rather than extend the list again.
Also caught: the branch's `compute-job.test.ts` edits were not
`prettier`-clean (`format:check` now passes). Two review observations left
as non-blocking: the failed-server-cancel path now shows both the reworded
"Cancelled…" outcome and a `backend-failed` toast (intentional per Finding
75, mildly noisy), and `tracebackDiagnostics.ts`'s `primaryFrame`/
`primaryPosition`/`mapFrameToOrigin` ship unwired until 4d (disclosed in the
CHANGELOG and this phase's 4c entry).

**Fully verified, 2026-09-01.** `npm run verify` and `npm run
test:integration` both green (Sean's own run). Then the cancel fix —
Findings 75/76, the part with real wire-behaviour risk — **live-verified**
against `verde` (Viya 4) with a branch `.vsix`: Cancel from both the
progress-notification button and the palette command stops the run with
`done` never printing, the output channel shows the reworded "Cancelled. If
a single step was already running…" line, and **no error toast** — meaning
the server accepted the `If-Match`'d `PUT` rather than answering the `428` a
bare request drew before. A run submitted ~15 s into the 60 s `sleep`,
right after cancelling, completed cleanly ~30–40 s later — the cancelled
step running out its natural duration before the session freed, exactly
Finding 76, no corruption and no reconnect needed. `docs/dev/manual-test-
pass.md` §6's "Cancel, both ways" item is updated for the reworded message
and this run. The `ModuleNotFoundError` → Show Environment message addition
was live-verified in the same session (`import polars` against `verde`) —
the appended `Run "Python on Viya: Show Environment" …` sentence shows on
the diagnostic as specified, and `manual-test-pass.md` §7's row is rewritten
from a `(known gap)` into a ticked assertion. **Nothing outstanding before
the PR opens.** Merged as [PR #81](https://github.com/Shai-Alit/sas-py-vscode/pull/81).

**4d (diagnostics surface) merged 2026-09-02 as
[PR #83](https://github.com/Shai-Alit/sas-py-vscode/pull/83), squashed as
`f3a4bb2` on `main`. This closes Phase 4 (4a–4d).** Wires 4c's
`tracebackDiagnostics.ts` mapping to its two consumers. **Problems panel:**
new `src/run/diagnostics.ts` (`RunDiagnostics` — a `vscode` shell around one
`languages.createDiagnosticCollection("pythonOnViya")`, on `.c8rc.json`'s
exclude list, integration-tested); `commands.ts`'s `runNow` clears it for the
program's origin URI at the start of every run and, on a `!succeeded` outcome
that streamed a structured traceback (`drainOutputs` now captures the trailing
`application/vnd.python.traceback` output and hands it back), publishes one
`Error` at `primaryPosition`, `source "Python on Viya"`, the `<string>` stack
as `relatedInformation`. **Publishes nothing when no frame maps** — a SAS-side
failure or an all-library stack gets no Problems entry rather than one planted
at line 0 (the phase's exit criterion is an *accurately*-positioned error;
`tracebackDiagnostics.ts`'s own "don't guess a position" rule, applied at the
surface). **Result panel:** the traceback `RenderItem` gained structured
`frames`; `resultPanelDom.ts` wraps a `<string>`-frame's line in an inner
`<span role="button">` (new `DomPort.onActivate`) when `applyMessage` is
given an `onFrameActivate` — the `<li>` stays a listitem so the `<ol>`'s
screen-reader semantics hold; `webview/entry.ts` posts `{ type:
"revealFrame", frameIndex }` — the one webview→host message beyond `"ready"`,
its own `isRevealFrameMessage` guard, kept out of `ResultPanelMessage`;
`resultPanel.ts` retains the run's `ProgramOrigin` (`startRun(origin)`, now
required) and frames, maps the activated index via `mapFrameToOrigin`, opens
the editor via a new injectable `revealPosition` dep (default reuses an
existing editor's column, else `ViewColumn.One` — never the panel's; swallows
a rejected `showTextDocument`). No new command, setting, webview surface or
CSP change. New page `docs/architecture/diagnostics-surface.md` covers both
4c and 4d (4c never wrote its reserved page). **An adversarial review pass
has been done** (2026-09-01) and its findings folded in: `revealPosition`
now reuses an existing editor's column (never `Active`/the panel's) and
swallows a rejected `showTextDocument`; the clickable frame is an inner
`<span role="button">` so the `<ol>` keeps its screen-reader semantics;
`clearFor` moved to sit with `startRun` at the "a run began" point;
`startRun(origin)` made required; comment/record corrections. Nits left as
documented, not fixed: `?? traceback.message` is an unreachable
belt-and-braces fallback; and two diagnostics-lifecycle gaps carried to
Phase 5 (also flagged by the CI reviewer on PR #83) — the Problems entry is
only cleared by the next run of the same file, and `RevealFrameMessage`
carries no per-run token so a stale `revealFrame` that outraces the host
queue can resolve against the wrong run. The CI reviewer also asked why
`Diagnostic.source` is a bare literal rather than `l10n.t()` — kept bare
(a per-locale source string fragments Problems-panel filtering) with the
comment expanded to say so. **Checks run this session** (VS
Code Claude Code — the sandbox-timeout reason `CLAUDE.md` bars lint/tests
for does not apply here): `typecheck` ×3, `npm run lint`, `prettier
--check`, `check:coverage-scope`/`check:copyright`/`check:secrets`,
`check:docs`, `npm run test:unit` (**1161 passing**; one unrelated Windows
drive-letter flake that passes on re-run), and **`npm run verify` end to end
(exit 0)** — all green. Coverage ratchet bumped in `.c8rc.json`:
`lines`/`statements` 93 → 94 (measured 94.09), `functions`/`branches`
unchanged; `resultPanelModel.ts`/`resultPanelDom.ts`/`tracebackDiagnostics.ts`
all 100%. **Verified 2026-09-02 (Sean):** `npm run test:integration` green in
the VS Code host tier — one test failed first (`diagnostics.test.ts` read
`DiagnosticCollection.get()` after `dispose()`, which throws; moved onto
`languages.getDiagnostics()`), re-run green. **Live-verified against `verde`**
with a branch `.vsix`: failing run → positioned Problems entry that opens in
the editor column not over the panel; clean re-run clears it; Run Selection
mid-file lands on the true line; clicking a `<string>` frame jumps the
editor, a library-frame line does not. `manual-test-pass.md` §7/§8 ticked.
The two CI-reviewer nits (above) were folded in as comments/docs only
(`3a8de68`, in the PR).

**Phase 4 (Diagnostics) is fully done — 4a–4d all merged. Phase 5
(Hardening & first release) is next; `docs/phases/phase-5.md`.** PR #83's
merge is the trigger for the Phase 4→5 between-phase-housekeeping checklist
(ADRs, punch-list completeness, RUNBOOK/PRODUCTION_PLAN currency, this file's
phase pointer, scratch-file reconciliation, manual-test completeness, and
Dependabot advisories — the last already carried forward from the Phase 3→4
pass, still unreviewed). Not yet run. This docs PR only records the merge;
the housekeeping is its own pass. The local `phase-4d-diagnostics-surface`
branch is stale now (merged) — `git branch -D` and `git fetch --prune` when
convenient.

**Phase 4→5 between-phase housekeeping run 2026-09-02.** ADRs: ADR-0021
still read the traceback-to-editor jump as unscoped future work after 4d
actually shipped it — amended with a dated note pointing at phase-4.md's 4d
entry and PR #83; ADR-0011/0019/0020/README all confirmed correct, no
change needed. `PRODUCTION_PLAN.md`: the coverage figure was stale (still
93/93/93/95; `.c8rc.json` moved to 94/94/93/95 in 4d) — corrected; the
"Compute cancellation doesn't interrupt" risk row still said "Not yet
probed" though 4b/4c settled and partly fixed it (Findings 75/76) — struck
through and retired with the actual outcome. `RUNBOOK.md` and this file's
own phase pointer/index table were both already current, no edit needed.
Punch-list completeness (`phase-4.md`, 4a–4d) and manual-test completeness
(`docs/dev/manual-test-pass.md` §6/§7/§8, all live-verified and ticked) were
both confirmed clean. Dependency advisories: `npm audit` shows exactly the
one entry `scripts/advisory-allowlist.json` already allows (`diff`,
GHSA-73RR-HH4G-FPGX, low, dev-only via mocha), expiring 2026-11-12 (that
entry was removed 2026-09-08 once mocha 12 took `diff@^9` and cleared it —
see this file's Section D entry below) — no
open Dependabot items found this pass, though this sandbox has no `gh` CLI
or token, so GitHub's own Dependabot UI (e.g. any Actions-workflow
advisories) couldn't be checked directly; `npm audit` is a proxy for the
npm ecosystem only, not a full substitute. **Scratch-file reconciliation:**
`phase-3-runbook-pending.md`'s two pre-existing items (certificate escape
hatch, BOM fixture) were re-confirmed still genuinely untracked elsewhere;
two more were added rather than written into `phase-5.md` ahead of its own
scoping session — Finding 74's two adjacent sub-findings (the interpreter
banner/`>>>` noise and `writeOutcome`'s redundant traceback-tail echo,
`phase-3.md`'s Finding 74 entry) and phase-4.md's two "Deferred to Phase 5"
diagnostics-lifecycle gaps (`DiagnosticCollection` not cleared on
doc-close/sign-out/target-flip; `RevealFrameMessage`'s missing per-run
token) — both previously named as Phase-5-bound with no phase-file home.
**Left deliberately unswept, Sean's call:** `phase-3.md`'s orphaned
bash-stub branch names for "Phase 5"/"Phases 6–12" (flagged when the
Phase-4 stub was removed as "worth a sweep whenever Phase 5 starts") —
noted, not actioned this pass. `docs/phases/phase-5.md` itself is
untouched; its Runbook stays "not yet reached" until Phase 5's own scoping
session, which is when the four scratch-file items above should get folded
into a real punch list.

**Phase 5 scoped 2026-09-02**, same day as the housekeeping pass above. A
codebase survey found 5a (drift gate) and 5b (live test tier) both further
along than the plan text assumed — `scripts/check-contracts.mjs` already
exists and is already wired into `npm run verify`/CI, and `test/live/`
already has three viya4 suites plus a fully working `viya35`-capable gate in
`test/helpers/live-gate.ts` with no viya35 test file yet written. Both are
downgraded to *Small* and rescoped as audits/scaffolding rather than
build-from-scratch work. 5c (docs publishing) holds up as planned and is now
the largest slice — the docs site has no user-facing pages at all yet for
Phase 3/4's shipped feature set (running Python, diagnostics, cancel,
environment info), and `docs/release-checklist.md` names a publish workflow
that doesn't exist. **New 5d slice** carries the four scratch-file items
above (certificate escape hatch, BOM fixture, Finding 74's two sub-findings,
the two 4d-deferred diagnostics-lifecycle gaps) — `phase-3-runbook-pending.md`
is reconciled and its holding role retired again now that all four have a
real home. Recommended order: 5d → 5a → 5b → 5c. Full Plan and Runbook detail
in `docs/phases/phase-5.md`; the stale Phase 5 bash-stub in `phase-3.md`
(orphaned branch names predating this scoping) was removed in the same pass,
the same way the Phase 4 stub was retired at its own scoping session. This
paragraph also closes this file's own phase-index-table item — the previous
Phase 4 row's "housekeeping not yet run" note was accurate when `baacf3c`
landed but should have been corrected in that same commit; fixed here rather
than left to misdirect the next session, per this project's own precedent for
exactly this mistake three paragraphs above. **Merged 2026-09-02 as
[PR #86](https://github.com/Shai-Alit/sas-py-vscode/pull/86)**, squashed as
`043d7dd`.

**Finding 77 probed 2026-09-02, same day**, against `verde` — de-risking 5d's
BOM-fixture item before it's written rather than after: a UTF-8 BOM
(`EF BB BF`) immediately followed by `print("bom-ok")` was uploaded through
the exact `assign`/`self`/`upload` fileref path `procPython.ts` uses and run
via `proc python infile=...;`. It ran clean — job `completed`, `SYSCC` `0`,
`bom-ok` printed with nothing garbled around it, no `SyntaxError` anywhere in
the log — so ADR-0014's byte-for-byte upload discipline is not put in a bind
by a BOM. One incidental correction recorded in the same finding: a link's
wire `type` (e.g. `application/vnd.sas.compute.session.request`) needs
`computeMediaType`'s `+json` suffix restored before it's sent as a real
`Content-Type` header (finding 14) — copying `contracts/viya4.yaml`'s
`via.type` value verbatim into a hand-run probe draws a `415`. Full account
in `docs/phases/phase-5.md`'s own Finding 77 entry; the throwaway session was
deleted and confirmed gone by a `404` read-back. Not yet committed — landing
alongside this paragraph in a small follow-up PR.

**Phase 5 started, 2026-09-02. 5d-i (certificate escape hatch) implemented; not
yet verified, reviewed, or merged.** Recommended order was 5d → 5a → 5b → 5c,
and 5d's four items are being taken as three PRs (Sean's call): item 1 alone,
then item 2 (BOM fixture), then 3, then 4. Item 1 was scoped in `phase-5.md` as
"decide whether an escape hatch is needed, the way the SAS extension needs
none" — but on inspection the SAS extension *does* ship one
(`SAS.userProvidedCertificates` + `CAHelper.ts`'s `installCAs()` + a documented
FAQ), so the premise was wrong and a deployment with an incomplete chain or an
uninstalled private root is genuinely unreachable here today. 5d-i is therefore
the scoped implementation of the long-deferred **1c-ii**: a `machine`-scoped
`pythonOnViya.userProvidedCertificates` array; `src/auth/caAgent.ts` (new,
unit-tested, and the fourth entry on `eslint.config.mjs`'s Node-built-in
allow-list — the "certificate module" ADR-0003's hedge always named, amended
2026-09-02) building **one dedicated `https.Agent`** from Node's bundled
roots plus the user's PEMs — never `https.globalAgent`, which is what upstream's
`installCAs()` mutates process-wide; `src/auth/transport.ts` gaining
`createNodeHttpTransport({ agent })` with `nodeHttpTransport` unchanged as its
zero-config form; and `src/extension.ts` threading the resulting transport
through both `ViyaAuthenticationProvider` (`token`/`identity` deps) and
`ComputeSessionManager` (new `transport` dep) so a private-CA deployment is
reachable for running Python, not only for signing in. Unreadable cert paths
are logged, not swallowed. ADR-0008 amended (2026-09-02) — the `agent` seam it
left unset is now filled, and its "upstream has no TLS code" claim is corrected.
`docs/signing-in.md` gains a "Private certificate authorities" section;
`manual-test-pass.md` §3 gains an unrun live row (needs a deployment whose chain
the OS does not already trust). **`verify` + `test:integration` green
2026-09-02** (1171 unit passing; coverage 94.16/95.15/93.46/94.16, all flooring
to the current `.c8rc.json` thresholds — no ratchet bump). **Adversarial review
pass done 2026-09-02** (Sean's own window, full branch diff): overall sound —
threading complete, no secrets, ADR upstream claims verified against live
`CAHelper.ts`, `machine` scope correct. Five findings, all verified here and
fixed on the branch: (1, P1) a mistyped `machine`-scoped setting value could
throw out of `activate()` — the raw value is now read as `unknown` and coerced
by a new tested `certificatePathsFrom` (the `connectionProfiles` discipline);
(2–3, P2) `@vscode/proxy-agent` stops merging the OS cert store once a request
carries `ca`, and under default `proxySupport` replaces the agent instance
while hoisting only its `ca` — so the CA trust works but by hoist, not by the
agent; documented in `caAgent.ts`, `signing-in.md`, the setting description and
phase-5.md with the `microsoft/vscode-proxy-agent` citation, and the boundary
test reworded; (4, P3) `keepAlive: true` added to match Node 19+'s global-agent
default for the no-proxy-patch path, with `agent.destroy()` on teardown; (5,
P3) a test now exercises the default `node:fs` reader so the one filesystem
line is covered. **Open before a PR:** re-run `verify`/`test:integration`/`docs:build`
on the fix commit.

**5d-i merged 2026-09-02 as
[PR #88](https://github.com/Shai-Alit/sas-py-vscode/pull/88)**, squashed as
`331bcf3` on `main` (local `main` fast-forwarded, matches `origin/main`,
working tree clean). The pre-PR checks above were run and CI + both reviewers
passed on the PR. Recording the merge here is the first thing after it merged,
per this project's plan/runbook policy — the paragraph above was accurate up to
"Open before a PR" and stopped there.

**5d-ii (BOM fixture) merged 2026-09-02 as
[PR #89](https://github.com/Shai-Alit/sas-py-vscode/pull/89), squashed as
`e08e55f`.** This is 5d's item 2, taken as its own PR per the 5d plan. New
`test/fixtures/submission-corpus/utf8-bom.py` — three `EF BB BF` bytes then
`print("byte-order mark before this line")\n` (45 bytes), BOM-then-ASCII, the
simplest shape Finding 77 said the fixture needs. Added to `EXPECTED_CASES` in
`test/unit/submission-corpus.test.ts` so the existing "what reaches the
transport" loop drives it byte-for-byte with the other fourteen; a new "the
fixtures themselves" assertion pins the leading three bytes and the absence of a
second BOM later in the file. `.editorconfig`'s corpus block gains
`charset = unset` so an editor honouring the repo-wide `charset = utf-8` ("no
BOM", per the EditorConfig spec) cannot strip the mark on save — the same
failure class `.gitattributes` `-text` already guards for the CRLF and
no-trailing-newline cases. Enumerations updated in `PRODUCTION_PLAN.md` §4,
`test/fixtures/README.md`, `docs/dev/manual-test-pass.md` §6's grid, and
`CHANGELOG.md`. De-risked by Finding 77 (live BOM probe already ran clean), so
this is "add the case, assert success". **`test/live/submission-corpus.test.ts`'s
`CURATED_CASES` left unchanged** — deliberate: that tier is capped at five
maximally-distinct cases and Finding 77 already exercised the live BOM path;
the unit tier is the permanent guard the runbook item called for. Test-only, no
`src/` change. **One adversarial review pass, 2026-09-02, ran in this session —
not the separate VS Code Claude Code window the standing policy names; the
record should say so, and Sean's call whether the window pass is still wanted
for a test-only slice.** It read the full `a852504` diff plus the surrounding
files whose invariants it touches. No P0/P1. Three findings, all verified
independently and folded into a follow-up commit on the branch: (1, P2) the
live suite's doc comment still said "not all fourteen" — corrected to fifteen
in the same PR, per this project's evidence-sweep rule; (2, P3) the new fixture
assertion did not pin that anything follows the BOM — added a check that
`print(` source does; (3, P3, claim accuracy) a scope note in phase-5.md's
5d-ii entry, since `program.bytes` is `TextEncoder().encode(document.getText())`
(`commands.ts:396`/`:404`) and `getText()` has already consumed any BOM — so
the fixture pins the transport seam (the corpus's actual charter), not the
editor path. **Verified green 2026-09-02 (Sean's run): `npm run verify`, `npm
run check:docs`, and `npm run test:integration` all pass.** Merged as
[PR #89](https://github.com/Shai-Alit/sas-py-vscode/pull/89) (`e08e55f`); local
`main` fast-forwarded, matches `origin/main`.

**PR #89's `supply-chain` job first failed on six dev-tree advisories that have
nothing to do with 5d-ii** — pre-existing on `main`, transitive under
`@vscode/vsce`, and not shown by GitHub's Dependabot UI (dev-tree; `npm audit` /
`check:audit` is deliberately stricter). `qs` 6.15.3 carried two moderate DoS
advisories (fixed in 6.16.0), `fast-uri` 3.1.5 four high host-confusion / SSRF
advisories (fixed in 3.1.6). Both fixed lines are in range for their parents, so
they clear via the child-override route (`overrides.qs ^6.16.0`,
`overrides.fast-uri ^3.1.6`) the `vite` / `serialize-javascript` pins already
use — no allow-list entry. `npm install` resolved `qs@6.16.0` / `fast-uri@3.1.7`
(18 packages changed) and dropped `npm audit` from 1 moderate + 1 high to just
the pre-existing lows. **Folded into #89** rather than a separate PR, since the
`check:audit` gate blocks every PR until the tree is clean and a separate PR
would only add a round trip. `check:audit` could not be re-run locally to
confirm — it spawns `npm.cmd` and current Node throws `EINVAL` doing that on
Windows (the CVE-2024-27980 `.cmd`-spawn hardening); CI runs it on Linux, where
that does not apply, so #89's own re-run is the confirmation. CHANGELOG (under
`### Changed`, beside the `vite` entry) and `advisory-allowlist.json`'s `$comment`
narrative both updated.

**Two more pre-existing `main` issues surfaced in the same look, neither
touched here and neither blocking #89 — their own follow-up PR:** (a) two CodeQL
*High* findings open ~3 weeks — `scripts/generate-reference.mjs:83` (a
markdown-cell escaper that adds `\|` without escaping backslashes first) and
`scripts/check-package.mjs:266` (`statSync` then `readFileSync` on the same path
— a check-then-use TOCTOU); both in build scripts over fully trusted input, so
low real risk but real patterns. (b) `scripts/check-audit.mjs` cannot run on
Windows at all (the `npm.cmd` `EINVAL` above), despite `CLAUDE.md` listing the
`check-*.mjs` gates as locally runnable — worth a `shell`/`execPath` fix in the
same PR.

**All three landed in a follow-up build-script PR, 2026-09-02** (branch
`chore/build-script-hardening`, off `main` after #89's squash-merge): the
`cell()` escaper now escapes backslashes before pipes (output byte-identical —
no manifest string carries a backslash, `docs:reference:check` unchanged);
`check-package.mjs` reads the `.vsix` once and takes the size from the buffer,
dropping the `statSync`; `check-audit.mjs` passes `shell: needsShell(command)`
(new exported predicate, true only for a `.cmd`/`.bat` shim), all-literal args.
`prettier --check`, `docs:reference --check`, and two `check-package.mjs` smoke
runs (missing file, non-zip file) pass locally; the `codeql` context on the PR
is what confirms the two `main` alerts close. The `github-actions` reviewer
asked for regression tests on all three; two were added (`docs-reference.test.ts`
for the backslash-before-pipe escape, `audit-gate.test.ts` for `needsShell`'s
two arms) and the third (`check-package.mjs`'s errno branch) was declined with a
reply — the module runs `main()` unconditionally so it is not importable for a
test, and its pure logic is already runtime-checked by `runSelfTest()`; making
it importable is its own small change. **Merged 2026-09-02 as
[PR #90](https://github.com/Shai-Alit/sas-py-vscode/pull/90), squashed as
`c72e6a8`.** The two CodeQL *High* alerts on `main` should drop on the next
code-scanning run against `main`; confirm in the GitHub Code scanning UI (no
`gh`/token in this sandbox to check directly). Making `check-package.mjs`
importable + its own test file is the one carried-forward item from this
detour — small, unscheduled, not on any phase punch list.

**5d-iii (Finding 74) merged 2026-09-02 as
[PR #92](https://github.com/Shai-Alit/sas-py-vscode/pull/92), squashed as
`b9b18ef`.** Local `main` fast-forwarded, matches `origin/main`. Module
confirmed: the Runbook's `src/backend/outputChannel.ts` path was stale — the
real target is `src/run/outputChannel.ts`. **Sub-finding (b) fixed on both outcome surfaces:**
a shared helper `alreadyStreamedAsTraceback` (`tracebackDiagnostics.ts`) lets
`RunOutputChannel.writeOutcome` **and** `ResultPanel.writeOutcome` drop a
diagnostic whose message already streamed as the raw traceback — value-equality,
so a SAS-side `SYSCC=3000` message, the synthesized "an unhandled Python
exception" stand-in, and a `ModuleNotFoundError`'s "Show Environment" pointer
all still print. Paired backend cleanup: `parseTraceback` trims the
interpreter's bare `>>>`/`...` prompt markers from each end of the message tail
(not the interior). **Sub-finding (a)'s live-transcript half deliberately not
fixed** — scrubbing `normal`-typed output client-side contradicts
`logFilter.ts`'s documented rationale and `>>>` collides with real program
output; the success/error-path asymmetry points at a `PROC PYTHON` invocation
question for a live probe. **Adversarial pass done (separate review window):**
no P0/P1; three P2s folded into a follow-up commit — the synthesized-fallback
string was suppressible (carve-out added), `PROMPT_LINES` filtered interior
lines (restricted to the ends), and the result-panel triple-render was hedged
rather than closed (now closed). A non-blocking PR bot comment on the
end-trim's doc comment (it overstated boundary safety — a message whose own
first/last line is exactly `>>>`/`...` loses it) was answered with a comment
tightening plus a pinning test (`d4da928`), the unbounded trim kept.
`npm run verify` green (coverage ratchet held;
`tracebackDiagnostics.ts` 100%); `npm run test:integration` green (237 passing,
after stripping the extension host's `ELECTRON_RUN_AS_NODE=1` — see phase-5.md's
5d-iii entry for that harness gotcha). **Verified live 2026-09-02** against
`verde` with a branch `.vsix` — 10 runs, five scripts × Run Selection and Run
File: the output channel ends at "Finished with an error." with no repeated
exception line (the `ModuleNotFoundError` superset line still prints, by
design), the Result panel shows no third copy of the message and no trailing
`>>>` on the structured message, and a program's own `>>>`/`...` stdout is
untouched. **Sub-finding (a) refined:** the banner tracks the Run File
`restart` (shows on a successful Run File too), and `>>>` shows on every run
of either mode — so §6's "Hello world streams clean" no longer holds for Run
File; not a 5d-iii regression (the stream is untouched), folded into that box
and the probe. See `docs/phases/phase-5.md`'s Runbook item 3.

**5d-iv (diagnostics-lifecycle gaps) merged 2026-09-03 as
[PR #94](https://github.com/Shai-Alit/sas-py-vscode/pull/94), squashed as
`b03a92d`.** Local `main` fast-forwarded, matches `origin/main`. This was the
last of 5d's four items — **Phase 5's 5d slice is now fully done (5d-i–5d-iv).**
**(a) Clearing the Problems collection:** `RunDiagnostics`
gains `clearAll()`; `createRunCommandHandlers` (`src/run/commands.ts`) wires
three triggers, all in that one place — a run-target flip to Local (existing
`targets.onDidChange` sub, gated `kind() === "local"`; a viya→viya profile
switch is deliberately left alone), a document close
(`vscode.workspace.onDidCloseTextDocument`, injectable as
`RunCommandDeps.onDidCloseTextDocument`), and a profile sign-out (new
`RunCommandDeps.onDidSignOut`). **(b) Per-run token:** `resultPanel.ts` gains a
monotonic `currentRunToken` bumped in `startRun`, stamped onto the traceback
`RenderItem` (`toRenderItem` gains the param) so it survives the panel's
hide/show rebuild + backlog replay; the webview echoes it in `revealFrame`;
`RevealFrameMessage`/`isRevealFrameMessage` gain `runToken` (non-negative
integer, like `frameIndex`); `ResultPanel.revealFrame` drops a message whose
token isn't the current run's. **Correction to phase-4.md's 4d note:** the
token closes (b), not the "two-`<ol>`s-in-one-run" alias it also named — that
stays structurally impossible (`buildFailureOutcome` emits one traceback per
run); the note and `resultPanel.ts`'s `currentFrames` comment are both updated.

**`npm run verify` + `npm run test:integration` green (Sean's runs)** — 1191
passing, coverage 94.22/95.16/93.78/94.22, no ratchet move. **Adversarial
review pass done 2026-09-02** (separate VS Code Claude Code window). No P0/P1;
six findings, all verified and folded in. The one that mattered: **the sign-out
clear was keyed off `auth.onDidChangeSessions`'s `removed`, which is a diff of
the published session list — it also fires when a slow renewal or an unreadable
keychain entry drops a profile for one poll**, so transient network weather
would have wiped the Problems panel. Fixed by adding a dedicated
`ViyaAuthenticationProvider.onDidSignOut` that fires only from `removeSession`
(both deliberate sign-out routes go through it); `extension.ts` wires that
through instead, and its `EventEmitter` bridge is gone. The other five were P3:
an `onDidCloseTextDocument`-also-fires-on-language-change comment gap; a wrong
"token 0 never matches" claim in two places; a self-undermining sign-out
rationale; `isRenderItem` accepting any `number` for `runToken` where
`isRevealFrameMessage` wanted a non-negative integer; and a test-helper `?? 0`
fallback that masked a missing `sendReady()`. All fixed in the same branch,
`authProvider.ts` + a new `auth-provider.test.ts` case added. Docs
(`diagnostics-surface.md`, phase-4.md pointer, phase-5.md 5d-iv entry,
CHANGELOG, `manual-test-pass.md` §7/§8) all reflect the final shape.

**Live-verified 2026-09-03** against `verde` with a branch `.vsix` (after a
window reload — a first attempt ran a stale build): all three lifecycle clears
in §7's new row hold — closing the file's editor tab, **Sign Out**, and
flipping the run target to Local each clear the Problems entry; reopen /
switch-back leave it gone; a viya→viya profile switch leaves it in place.
`manual-test-pass.md` §7 ticked. One PR-bot nit folded in on the open PR (the
`phase-4.md` deferral note contradicted itself after the "resolved" prepend —
reworded to past tense). **Merged as `b03a92d`; nothing carried over.**

**5a (drift-gate hardening) implemented and reviewed 2026-09-03; verified
green; not yet merged, no PR opened.** An audit of `scripts/check-contracts.mjs`
against the three gaps in phase-5.md's Runbook item 5a, then harden. Outcome:
**(1) empty fixture dir** — real, fixed: `readScope` now derives
`emptyFixtureDirs` (exists but holds nothing but dotfiles) and `check` gains an
`emptyFixtureDirs` param so the rule is a pure-function case the unit tier can
state; an empty dir gets its own message, distinct from "does not exist"
(`test/fixtures/viya35/`, one README, still passes). **(1) stale fixture dir** —
left unaddressed by design: staleness is drift, which only a probe settles, not
a structural gate (recorded so the ticked box isn't misread). **(2) orphan
fixture dir** — real, no general form (`harness/`, `submission-corpus/`,
`rich-output/` are contract-less by design); added a narrow reverse check for a
`test/fixtures/<id>/` named for a `DialectId` whose generation's contract points
`fixtures` elsewhere (the rename-orphan), scoped so a missing contract or a
missing `fixtures` key doesn't double-report. **(3) path/via XOR negative
tests** — found already present for both arms; added the one adjacent positive
(`accepts a via with no path`). One adversarial review pass in the separate VS
Code Claude Code window (2026-09-03): nine P2/P3 findings, all verified
independently and folded in — the emptiness rule moved into pure `check` for
testability, the new dir read guarded (`listFixtureDirs` replaces
`listDirectories`), dotfiles excluded from "content", the reverse check
tightened against the double-report, `run()` in the test given optional
`fixtureDirs`/`emptyFixtureDirs`, `docs/architecture/contracts.md` +
`test/fixtures/README.md` (missing `rich-output/` row) + `test/fixtures/viya35/
README.md` (stale `PROBE-FINDINGS.md` pointer) all updated. `npm run verify`
green (exit 0; coverage unmoved — `scripts/` is outside the `out/src`
denominator); unit tier 1191 → 1197; no `src/` change, so `test:integration`
not warranted. **Opened as
[PR #97](https://github.com/Shai-Alit/sas-py-vscode/pull/97)** (`98fa14d`); the
two AI reviewers then each found one more, both folded on the branch — Codex:
`listFixtureDirs` recorded a directory as present before its own `readdirSync`
succeeded (`7aab792`, read-then-push); the Claude reviewer: the reverse orphan
check's typo carve-out only covered a non-string `fixtures`, so a `fixtures:`
typo pointing nowhere real still drew a second misworded complaint
(`fixtureDirs.includes(declared)` added). **Merged 2026-09-03 as
[PR #97](https://github.com/Shai-Alit/sas-py-vscode/pull/97), squashed as
`f0e55b8`** — local `main` fast-forwarded, matches `origin/main`, working tree
clean. CI + both reviewers passed on the final commit. Nothing carried over.

**5b (live test tier) merged 2026-09-03 as
[PR #99](https://github.com/Shai-Alit/sas-py-vscode/pull/99), squashed as
`a3b89ce`.** Local `main` fast-forwarded, matches `origin/main`, working tree
clean. Test-files-plus-docs only, no `src/` change. Three
parts: **(1)** a `viya35` scaffold — `test/live/viya35-connectivity.test.ts`,
mirroring `viya4-connectivity.test.ts`, gated on `liveTarget("viya35")`,
reporting a clean skip on an unconfigured machine (verified: `npm run test:live`
→ 11 pending, exit 0). Deliberately narrow (identity endpoint only, no compute /
jobs / `PROC PYTHON`) because this project has still never talked to a live 3.5
and `docs/README.md` bars presenting 3.5 as supported from documentation — the
doc comment says the first run with real 3.5 creds is the verification. **(2)**
Audit of the existing viya4 suites vs. Phase 3/4's shipped behaviour: the four
suites cover the 2c / 2b-3a / 3c-i wire paths well; the one real gap is **cancel
(Findings 75/76)** — `cancelJob`'s `If-Match` round trip regressed silently once
and only a by-hand check guarded it. Closed with a new mutating suite
`test/live/viya4-job-cancel.test.ts` (submit a 30 s `data _null_` sleep, cancel
the running job, assert `cancelJob` returns `ok` — which on `verde` is
end-to-end proof the fresh-`ETag` `If-Match` path still satisfies the `428`;
terminal-state check is best-effort `console.warn` only, since Finding 76
measured the state reading `running` for 24+ s after an accepted cancel).
`parseTraceback` / `tracebackDiagnostics.ts` (3c-ii/4c) and 4d's diagnostics
surface are **not** live-coverage gaps — pure text transforms / VS Code
integration with no new wire risk. **(3)** New `docs/dev/live-testing.md` ("The
live test tier in anger", the page `docs/dev/README.md` already had planned for
5b) — the three gates with env-var names in full, the CA-certificate case, a
per-suite deployment-cost table, the cleanup contract for mutating tests, the
`viya35` scaffold's unverified status, and the audit summary; `testing.md`'s
tier-three section trimmed to an overview + pointer; registered in the VitePress
sidebar. **Checks green this session:** `typecheck`, `lint`, `prettier`,
`check:docs` (incl. `docs:build`), `check:copyright`, `check:secrets`,
`test:unit` (1197 passing, unchanged from 5a), `test:live` (clean skip).
`test:integration` not warranted (no `src/` change — same call as 5a). The
adversarial review pass was **waived by Sean** (2026-09-03, test-files-plus-docs
only). **`viya4-job-cancel.test.ts` live-verified 2026-09-03** against `verde`
(token via the `viya-api-probe` skill, scoped `--grep "job cancel"` run): 1
passing, 8 s, exit 0, no `console.warn`s — `cancelJob` returned `ok` (the
`If-Match` `PUT` accepted, not the `428` a bare cancel draws), the job settled to
`canceled`, the session cleaned up. Node needed `NODE_OPTIONS=--use-system-ca`
(the `cacert.pem` bundle via `NODE_EXTRA_CA_CERTS` was not enough). Incidental:
the SAS `data _null_` sleep cancelled promptly (~8 s), unlike Finding 76's
`PROC PYTHON` loop — consistent with that finding's own reasoning, not asserted.
The two AI reviewers then raised one Major (the mutating cancel suite submitted a
deterministic job under the fixed `SESSION_NAME`, missing `CONTRIBUTING.md`'s
per-run-uniqueness rule — fixed in `9918268` with a `%put` of a `randomUUID`
marker, re-verified live) and two nits (the flat `120_000` timeout — comment now
owns the tradeoff; `describeFailure`'s fourth byte-identical copy — deferred to
its own cleanup lifting it into `test/helpers/live-gate.ts`). The `gh pr comment`
replies posted during this did not appear on the PR (a known local issue — the
substantive record is the commit message and the phase-5.md 5b entry).

**The `viya35` scaffold's live run — against the 3.5 deployment that was
deploying as this landed — is deferred to the end of Phase 5** (Sean's call,
2026-09-03), with all other 3.5 testing.

**Decided and executed, 2026-09-03: Viya 3.5 support is dropped — Sean's call,
combining code and docs into one slice/PR rather than the usual one-thing-per-PR
split.** No Viya 3.5 deployment was ever reachable by this project, across every
phase from 0 through 5b, and very few Viya 3.5 customers remain in the target
audience — see [ADR-0022](adr/0022-drop-viya-35-support.md) for the full
record, which also supersedes the Viya-3.5-specific part of ADR-0008.
Implemented this session, matching the codebase survey the "open consideration"
note above (now superseded) had sketched: `src/dialects/viya35.ts` deleted;
`DialectId` (`dialect.ts`) is `"viya4"` alone; `Deployment`
(`auth/clientId.ts`) is `viya4 | unknown`, no `viya35` member;
`deploymentFromSignal`'s `absent` arm now resolves to `{kind:"unknown"}`, same
as `unreadable`; `contracts/viya35.yaml`, `test/fixtures/viya35/`, and
`test/live/viya35-connectivity.test.ts` removed; `check-contracts.mjs` needed no
code change, since it already reads `DialectId` off the source file. Test
fixtures using `{kind:"viya35"}` were deleted or rewritten against the new
behaviour; `check-contracts.mjs`'s own unit tests, which needed a *second*
synthetic generation to exercise their cross-file rules, now use a fictitious
`viya6` instead of `viya35`. Docs swept in the same pass: `PRODUCTION_PLAN.md`
§1.4/§2/§2.3/§4/§6/decision 9 (amended in place, original text kept per this
file's own convention — see the amendment blockquotes), `docs/README.md`'s
honesty gate, `docs/architecture/dialects.md` and `capability-probing.md` and
`contracts.md`, `docs/dev/live-testing.md` and `testing.md`, and the
user-facing `docs/connecting.md` / `connection-profiles.md` / `signing-in.md`.
`docs/phases/phase-5.md`'s 5b entry gets a closing note retiring the
"`viya35` scaffold deferred to end of Phase 5" item rather than leaving it to
mislead the next session; phase-1/2a/2b/3/4's own historical 3.5 mentions are
untouched, per this project's own rule against rewriting history.
**Implemented; not yet checked, reviewed, or merged — see the next entry.**

Full detail in `docs/phases/phase-5.md`'s 5b Runbook entry (for the live test
tier this decision retires part of) and its new closing note (for the decision
itself). **After this lands: 5c — docs publishing and release engineering**
(the largest slice in the phase; see phase-5.md's Runbook). The local
`phase-5b-live-test-tier` branch is stale now (merged) — safe to
`git branch -D` and `git fetch --prune`.

**Viya 3.5 drop merged 2026-09-03 as
[PR #101](https://github.com/Shai-Alit/sas-py-vscode/pull/101), squashed as
`c2c5b2b` on `main`** — local `main` fast-forwarded, matches `origin/main`,
working tree clean. (The "not yet checked, reviewed, or merged" two paragraphs
up was accurate when written; it went stale on merge. Recording it here rather
than editing that paragraph, per this file's supersede-don't-rewrite
convention.) CI + both reviewers passed. The `phase-5b-live-test-tier` and
`drop-viya-35-support` local branches are both stale now.

**5c scoped into four sub-slices, 2026-09-03 (Sean's call).** 5c is the five
Runbook items regrouped: **5c-i** the user-facing feature-docs pages (item 1,
docs-only), **5c-ii** the troubleshooting guide (item 2, docs-only), **5c-iii**
release engineering — `release.yml` + `package.json` marketplace metadata +
icon asset + `release-checklist.md` rewrite (items 3 + 4 minus the version
bump), **5c-iv** the v0.1.0 release itself — dry run then tag, plus the
deferred version bump / `CHANGELOG` finalise (item 5). Order i → ii → iii → iv;
i and ii have no dependency between them. Full breakdown in phase-5.md's own 5c
Runbook entry.

**5c-i implemented 2026-09-03; not yet reviewed or merged, no PR.** Docs-only —
no adversarial pass, per this project's own rule (the diff is its own
evidence); the `check:docs` build (incl. `docs:build`) and `check:secrets` are
the checks it can plausibly fail. Three new top-level pages —
`docs/running-python.md`, `docs/diagnostics.md`, `docs/python-environment.md` —
covering Phase 3/4's shipped feature set (Run File/Selection, the output
channel and Result panel, Reset, one-run-at-a-time, cancel with the Findings
75/76 caveat; the traceback surfaces and the Problems panel with its "no entry
when no `<string>` frame maps" rule and 5d-iv lifecycle clears; Show/Refresh
Environment and the per-profile no-auto-refresh cache). Registered in
`.vitepress/config.mjs`'s "Using the extension" sidebar; `docs/README.md`'s
page list extended; now-false "not here yet" notes in `connecting.md` /
`connection-profiles.md` swept to point at the new pages; `CHANGELOG.md`
`[Unreleased]` entry added. **One `src/` follow-up noted, deliberately not
folded in** (it would make 5c-i not docs-only): `src/run/outputChannel.ts`'s
`writeOutput` still says an image/HTML output's viewer "ships in a later slice"
— stale since 3d-ii — its own small `fix(run):` change. Branch
`phase-5c-i-feature-docs`.

**5c-i merged 2026-09-03 as
[PR #102](https://github.com/Shai-Alit/sas-py-vscode/pull/102), squashed as
`bce3dc3` on `main`** — local `main` fast-forwarded, matches `origin/main`,
working tree clean. CI green. The `github-actions` reviewer raised **one
blocking finding**, verified and fixed on the branch (`e6a061f`): the
"switching the run target to Local" bullet in `diagnostics.md` said flipping
the target *strands* every Viya Problems entry, where the shipped code
(`targets.onDidChange` → `diagnostics.clearAll()`, pinned by
`commands-diagnostics.test.ts`) *clears* the whole collection — reworded, with
the reason. The reviewer's non-blocking side note — `src/run/commands.ts`'s
own `targets.onDidChange` inline comment carries the same wrong "strands"
wording, contradicted by the `clearAll()` directly below it — is folded into
the carried `fix(run):` follow-up, which is now **two** items: that comment
plus the `outputChannel.ts` "ships in a later slice" string. Both live in
`phase-5.md`'s 5c Runbook entry. The `phase-5c-i-feature-docs` local branch is
stale now (merged).

**5c-ii (troubleshooting guide) merged 2026-09-03 as
[PR #104](https://github.com/Shai-Alit/sas-py-vscode/pull/104), squashed as
`1f073e4` on `main`** — local `main` fast-forwarded, matches `origin/main`,
working tree clean. Docs-only, so no adversarial pass per this project's own rule (the
diff is its own evidence); `check:docs` (incl. `docs:build`) and `check:secrets`
are the checks it can plausibly fail. One new top-level page
`docs/troubleshooting.md` — symptom-indexed, assembled from failures actually
hit in Phases 1–4 rather than a generic FAQ: the sign-in paste-code route and
redirect-mismatch message (Finding 10) and the bare-`401` ambiguity (Finding 9),
with the private-CA / TLS case pointing at `signing-in.md` (5d-i, no numbered
finding), the per-response context-links message and the no-Python-context case
(`connecting.md`, phase-2b),
session reaping (Finding 18) and the post-reload stale-fileref collision and its
seed-the-counter fix (Finding 72), the measured cancel caveat (Findings 75–76),
the interpreter banner / `>>>` noise (Finding 74, still a probe follow-up),
rich-output capture and the OOM-during-generation kill vs the 10 MiB skip
(ADR-0019 + Finding 73), why Reset Python State is for a wedged namespace not a
submission problem (ADR-0014 + Findings 33/64), and a short
reset-vs-reconnect-vs-reload guide. Registered in `.vitepress/config.mjs`'s
"Using the extension" sidebar; `docs/README.md` page list extended;
`CHANGELOG.md` `[Unreleased]` entry added. **No new probe opened** — every entry
rests on a finding already recorded, and Finding 74's source-side resolution
stays its own tracked follow-up, not this slice's. CI green; both AI reviewers
passed with no blocking findings. Two non-blocking review notes: the Finding 6 →
Finding 9/10 citation fix (folded pre-merge as `795b48f` on the branch), and a
prose accuracy fix in the "fileref already exists" entry — its "clears itself in
up to a minute" borrowed a number measured for the pre-fix single-window race,
where the residual two-window case is instead absorbed by the bounded
assign-retry (Finding 72's fix). The prose fix and this merge record land
together in a small follow-up docs PR (`docs/record-pr-104`), per the same
pattern PR #103 used for 5c-i. The `phase-5c-ii-troubleshooting` local and
remote branches are deleted. **After this: 5c-iii —
release engineering** (`release.yml`, `package.json` marketplace metadata, icon
asset, `release-checklist.md` rewrite); see phase-5.md's own 5c Runbook entry.

**5c-iii (release engineering) — [PR #106](https://github.com/Shai-Alit/sas-py-vscode/pull/106),
opened 2026-09-03, reviewed, fixes folded, not yet merged.** Branch
`phase-5c-iii-release-engineering`. `.github/workflows/release.yml` — **two
jobs** on a `v*` tag push: `build` (`contents: read`, no credentials) runs
checkout → `npm ci` → assert tag `vX.Y.Z` equals `package.json` `version` →
`npm run verify` → `npm run package` → upload the `.vsix` artifact; `publish`
(`needs: build`, `if: push`, `environment: release`, `id-token: write` +
`contents: write`) downloads the artifact and `npx`es the pinned `vsce`/`ovsx`
(**never `npm ci`** — keeps the ~880-pkg dev tree out of the credentialed job)
→ `vsce publish --oidc --packagePath` (VS Marketplace, OIDC trusted publishing,
**no stored PAT**) → `ovsx publish` (best-effort: `continue-on-error`,
unset-`OVSX_PAT` guard, a failure only warns) → `gh release create` with the
`.vsix` + notes from `CHANGELOG.md`. `workflow_dispatch` runs `build` only —
no input, cannot publish. Recorded as
[ADR-0023](adr/0023-release-publishing.md). `package.json` gains
`"private": false`, `"icon": "media/icon.png"`, `galleryBanner`, `pricing`
(version bump / `"preview"` → 5c-iv). `media/icon.png` is a
deterministically-generated `Py` wordmark (white on `#0766D1`, 128×128, no
alpha) — explicit stopgap, `release-checklist.md` D3 says replace it.
`ovsx@1.1.1` + **`@vscode/vsce` pinned to the `3.9.3-11` prerelease** (see the
review below); `npm audit` unchanged at 2 pre-existing lows, `allowScripts`
unchanged; `check:audit` can't run on this Windows box (`npm.cmd`-spawn
`EINVAL`, as in 5d-ii) — CI's `supply-chain` job confirms. **Pre-existing
packaging leak, folded in:** the `.vsix` was already shipping `CLAUDE.md`,
`STATUS.md`, `HOUSEKEEPING.md`, `.claude/**` and `tsconfig.webview.json`
(`.vscodeignore` never excluded them, `check:package`'s rules predated them) —
`STATUS.md`/`CLAUDE.md` name deployments, and this is the slice that makes the
package public. `.vscodeignore` + `scripts/check-package.mjs` (`DENY`
rules + `SELF_TEST`) updated; `REQUIRED` also now lists the icon. Archive drops
18 files/142 KiB → 12/97 KiB. **Also folded in:** `scripts/check-audit.mjs`'s
per-audit timeout 120s → 240s — the `ovsx`/`vsce` deps pushed the full-tree
`npm audit --json` to ~90s (measured local) and the old cap kept failing the
`supply-chain` CI job on registry latency (2 of 3 runs on this branch).
`docs/release-checklist.md` rewritten around the tag→two-job flow;
`docs/dev/ci.md`'s Release + audit-timeout notes updated. `CHANGELOG.md`
`[Unreleased]` + ADR-0023 (indexed) updated.

**Adversarial review done 2026-09-03** (hand-over prompt, separate window).
**One blocker (finding 1):** `@vscode/vsce@3.9.2` (latest stable, what the
first cut pinned) has **no `--oidc`** — it shipped only in the `3.9.3`
prereleases. Fixed by pinning `@vscode/vsce@3.9.3-11`; Dependabot's normal bump
retires the exception when `3.9.3` goes stable. **Two should-fix, both done:**
(2) `id-token`/`contents: write` were in scope while `npm ci`/`verify` ran
arbitrary tagged-tree code → the two-job split above; (3) any tag push could
publish any tree → `environment: release` gate + a `v*` tag ruleset (repo
settings, documented). **One docs gap (4):** the one-time setup skipped that
the `shai-alit` Marketplace publisher must pre-exist and Open VSX needs a
signed Eclipse Publisher Agreement → added. Smaller items folded: `--pat`
dropped from the `ovsx` call (env-read) with an unset guard; release notes →
`$RUNNER_TEMP`; `awk` regex → literal `index()` match. The reviewer's positive
verifications held. **Merged 2026-09-04 as
[PR #106](https://github.com/Shai-Alit/sas-py-vscode/pull/106), squashed as
`e70c682` on `main`** (local `main` fast-forwarded). CI + both AI reviewers
passed on the final commit. Two mid-flight follow-ups were folded into #106
rather than split: the pre-existing packaging leak (above) and a `check:audit`
per-audit timeout bump 120s → 240s — the added `ovsx`/`vsce` deps pushed
`npm audit --json` to ~90s locally and the 120s cap kept failing `supply-chain`.
**That bump did not fix it** — `npm audit --json` on CI now exceeds 240s too
(PR #110's run), so `check:audit`/`supply-chain` reliability needs its own
look, likely gating the job on `package-lock.json` actually changing rather
than raising the timeout again. The publish path (OIDC exchange + tokens + the
`release` environment gate) is still not exercisable locally or by the
build-only dispatch — first real run is the v0.1.0 tag (**5c-iv**), which
needs the one-time setup S1–S4 in `docs/release-checklist.md` done first. The
two stale-comment `fix(run):` items 5c-i carried are still open and deliberately
not taken mid-phase — a small PR when convenient, or fold into Phase 5→6
housekeeping.

**CI reliability follow-up to 5c-iii, 2026-09-04 — [PR #112](https://github.com/Shai-Alit/sas-py-vscode/pull/112)
and [PR #113](https://github.com/Shai-Alit/sas-py-vscode/pull/113) merged.** Two
`ci:` PRs off the thread above; no `src/` change. **#112** (`a8b906d`) closes the
`check:audit`/`supply-chain` reliability item flagged above. `supply-chain` no
longer runs on every code change: `changes` now emits a `deps` output (true when
the diff touches `package.json`, `package-lock.json`, `.npmrc`,
`scripts/check-audit.mjs`, `scripts/advisory-allowlist.json`, or a workflow file)
and `supply-chain` gates on that instead of `code`, so a comment or `src/` edit
no longer pays the ~9-minute `npm@12` install + `npm audit` round trip;
`verify`/`test`/`package` are unchanged and the `allowScripts` half stays checked
on every code change by the unit tier. `scripts/check-audit.mjs` also now passes
`--fetch-timeout=45000 --fetch-retries=2` to `npm audit` — a single wedged
request, not a slow tree, was the real cause of the intermittent failures the
120→240s bump had not fixed — and its backstop per-audit timeout drops 240s →
180s. **#113** (`219c096`) adds a `ci-required` aggregate job: it `needs` the
gated jobs (`changes, verify, test, docs, package, supply-chain`) with
`if: always()` and passes only when each succeeded or was legitimately skipped
(a `failure`/`cancelled` result fails it; the guard matches the bad states
positively so a blank line cannot read as failure). This lets branch protection
name one stable check instead of the six matrix-expanded `test (…)` names that
never report on a run where `test` is skipped — the reason a documentation-only
PR previously needed an admin merge. `analyze` (CodeQL, in `codeql.yml`, cannot
be a `needs:` here, and runs on every PR with no path filter) stays required on
its own. **Branch protection updated 2026-09-04** via `gh api`, after
`ci-required` reported once green on `main`: `main`'s required status checks went
from `docs, package, verify, analyze, supply-chain, changes` to
`ci-required, analyze, changes`; `strict` (up-to-date), linear history and
required-conversation-resolution are unchanged. The everything-runs case is
confirmed — all six `test` legs plus `ci-required` green on the `219c096` merge
commit — and this docs-only PR is itself the first live exercise of the
skip-tolerant path (`verify`/`test`/`package`/`supply-chain` skipped,
`ci-required` still green, no admin merge). This paragraph is that record.

**Phase 6 (SAS Content explorer) scoped 2026-09-03**, from a separate clone
(`sas-py-vscode-cowork`), deliberately kept apart from the primary working
copy so this scoping session would not collide with Phase 5's own in-progress
work (5c-iii next, per the paragraph above) — this branched from `main` at
`0e2efb4` (5c-ii merged) and does not reflect anything landed on `main` since.
**No code was written.** A codebase survey of both this repo and
`vscode-sas-extension`'s Content Navigator
(`client/src/components/ContentNavigator/`,
`client/src/connection/rest/RestContentAdapter.ts`), plus five read-only live
probes against `verde` (Findings 78–82, `docs/phases/phase-6.md`'s own Probe
findings section), refined `PRODUCTION_PLAN.md`'s one-line sketch into a
4-slice Runbook (6a adapter + read-only tree, 6b `FileSystemProvider`
open/save, 6c mutations, 6d favourites/recycle bin), recommended order
6a→6b→6c→6d. Key outcomes: **no adapter factory needed** — unlike upstream's
six-way `{Rest,IOM,COM}×{SASContent,SASServer}` dispatch, this project is
Viya-REST-only (ADR-0007, ADR-0022), so one concrete `ContentAdapter` class
is the whole adapter layer; **the generic `.py` type lookup already works**
on the one cadence probed (Finding 79 — `file_py`, no `.sas`-style special
case needed); and **an open architecture question** — whether
`src/compute/links.ts`'s link-following helpers should be promoted to a
shared, session-agnostic home before `src/content/` either imports across a
layering boundary or duplicates them. Two live anomalies (Findings 80, 81 —
a favorites member-count mismatch; an inconsistent recycle-bin restore link)
and one non-goal correction (`convertNotebookToFlow`/SAS Studio flow
conversion, already excluded by `PRODUCTION_PLAN.md` §3.1) are recorded, not
resolved, in the phase file. **Not yet committed** — this is prepared in the
working copy; see the handoff for the exact branch/commit/PR commands.
**Merge-conflict note for whoever lands this:** `STATUS.md` and
`docs/phases/phase-6.md` are new/appended content only, so a conflict against
whatever Phase 5 has landed on `main` in the meantime should be a clean
append on both sides — but confirm with a fresh `git pull --ff-only` before
cutting the branch, since this paragraph was written against a snapshot, not
against `main` as it stands when this actually gets pushed.

**Phase 7 (Libraries and data viewer) scoped 2026-09-03**, same day, same
separate clone (`sas-py-vscode-cowork`) — branched from `main` at `c57a4f1`
(Phase 6 scoping merged as PR #107), so it does not reflect anything landed
on `main` since. **No code was written.** A codebase survey of both this
repo (`src/compute/sessionManager.ts`, `job.ts`, `links.ts`) and
`vscode-sas-extension`'s Library Navigator
(`client/src/components/LibraryNavigator/`,
`client/src/connection/rest/RestLibraryAdapter.ts`, its generated
`DataAccessApi` client, `client/src/panels/DataViewer.ts`/
`TablePropertiesViewer.ts`, `client/src/webview/useDataViewer.ts`) refined
`PRODUCTION_PLAN.md`'s one-line sketch into a 3-slice Runbook (7a adapter +
read-only tree, 7b data-viewer webview, 7c sort/filter/CSV export/table
properties), recommended order 7a→7b→7c. Key outcome: **the whole feature is
session-scoped, not a separate service** — every `DataAccessApi` call is a
path under `/compute/sessions/{sessionId}/data/…`, so a library browser rides
on the exact same `ComputeSessionManager`-held session Phase 3 already runs
Python in, a materially smaller structural lift than Phase 6's four-new-surface
problem. One open architecture question recorded, not resolved: React +
`ag-grid-community`/`ag-grid-react` (upstream's data-viewer stack) as this
project's first React dependency, versus hand-rolling a lighter grid in the
existing DOM-manipulation webview style ADR-0021 established — flagged for
7b, not decided here. **The busy-submission question is now settled, not
just flagged**: an initial probe attempt this session failed at the network
layer (every `CONNECT` to `verde` came back `502 Bad Gateway` while a public
host tunnelled fine — a VPN outage on the deployment side, confirmed resolved
once retried), and once reachability returned, a live probe (Finding 85)
measured a `getRows` call blocking for 14.911s behind a submitted 15-second
job, against a 0.349s baseline once idle — `DataAccessApi` calls serialize at
the session's kernel level rather than erroring or racing, so 7a needs a
visible "session busy" UI rather than assuming browsing is always safe
mid-run. Five other findings (83, 84, 86) confirmed the core wire shapes
against `SASHELP`/`WORK` on `verde`, via one throwaway session created and
deleted (confirmed gone by a `404` read-back) — full account in
`docs/phases/phase-7.md`'s own Probe findings section. **Not yet committed** —
prepared in the working
copy; same merge-conflict caveat as the Phase 6 paragraph above applies here
too (confirm `git pull --ff-only` against `main` before cutting the branch).

**Phase 8 (CAS and SWAT) scoped 2026-09-03**, same day, same separate clone
(`sas-py-vscode-cowork`) — branched from `main` at whatever commit was current
when this session started (Phase 6 and Phase 7's own scoping commits are both
ahead of `main` on their own unmerged branches; confirm with a fresh
`git pull --ff-only` before cutting this branch, same caveat those two
paragraphs already give). **No code was written.** A codebase survey (this
repo's `src/compute/sessionManager.ts`/`client.ts`/`links.ts`, plus a targeted
grep of `vscode-sas-extension` that confirms its own claim of calling no CAS
APIs — every `CAS`/`CASLIB`/`swat` hit lands in the language server's syntax
reference data, nothing in `client/src`), a web search for the CAS Management
REST API and `swat`'s current authentication documentation, and eight live
probes against `verde` (Findings 8.1–8.6, `docs/phases/phase-8.md`'s own Probe
findings section) refined `PRODUCTION_PLAN.md`'s one-line sketch into a
3-slice Runbook (8a CAS browsing, 8b authenticated CAS session helper, 8c CAS
tables in the data viewer), recommended order 8a→8b→8c. Key outcomes: caslib
and table browsing needs **no `sessionId` and no CAS session of its own**
for global-scope resources, contradicting every example in the CAS
Management API's own reference docs (Finding 8.2); the existing
`ComputeClient`/`links.ts` machinery already fits `casManagement`'s hypermedia
shape without modification, so 8a needs no new HTTP layer (Finding 8.1); and a
`PROC PYTHON` cell can authenticate to CAS with the exact same Viya access
token this project already borrows per request, live-confirmed over both the
binary and REST/HTTP transports (Finding 8.5) — settling Phase 8's central
premise. **One serious finding came out of settling that last one**: the
naive way of delivering that token to the cell (an inline `PROC PYTHON`
`submit` block) echoed it in plaintext into the job log (Finding 8.6), which
happened for real during this session's own probe — the exposed `verde`
token was reported to Sean for rotation, and the throwaway Compute session
that carried it is deleted and confirmed gone (`404` read-back). 8b's own
Runbook entry now carries a non-negotiable constraint as a result: never
deliver a credential to a session via inline submitted code. Two open
architecture questions carried into the phase file rather than settled here:
whether 8a needs its own CAS-session lifecycle for session-scoped (personal)
caslibs, and whether the `links.ts`/`client.ts` promotion Phase 7 already
flagged happens in 8a, 7a, or not at all. **Not yet committed** — prepared in
the working copy; same merge-conflict caveat as the Phase 6/7 paragraphs
applies here too.

**Phase 9 (Notebooks) scoped 2026-09-04**, same separate clone
(`sas-py-vscode-cowork`) Phases 6–8 were scoped from — branched from `main`
at `a62f6c4` (current tip: 5c-iii, ADR-0023, and the CI-reliability/
`ci-required` follow-ups all merged; Phases 6/7/8 also already in this
history). **No code was written.** A codebase survey of this repo
(`src/backend/backend.ts`, `richOutput.ts`, `src/run/commands.ts`,
`resultPanel.ts`/`resultPanelModel.ts`) and `vscode-sas-extension`'s one
notebook implementation (`client/src/components/notebook/`), plus VS Code's
own Notebook API documentation, refined `PRODUCTION_PLAN.md`'s one-line
sketch into a 4-slice Runbook (9a format decision, 9b controller + execution,
9c renderers + diagnostics, 9d export), recommended order 9a→9b→9c→9d.
**No live-Viya probe was run or needed** — unlike Phases 6–8, this phase's
open questions are VS Code client-side integration questions, not wire
behaviour; the underlying Viya mechanics (persistent namespace across cells,
rich-output capture, cancellation) were already settled in Phases 2–5 for Run
File, and a notebook cell is just one more caller of the same
`ExecutionBackend` seam — `ExecuteOptions.freshNamespace` was already
documented in-repo as *"a notebook cell passes `false`"* before this phase
existed. **Key outcome, now a settled decision, not just a recommendation:
[ADR-0024](adr/0024-notebooks-are-ipynb-native.md) — notebooks are
ipynb-native, with no bespoke fallback**, settling `PRODUCTION_PLAN.md` §6
open decision 7. Go ipynb-native by registering only a `NotebookController`
against VS Code's existing `.ipynb` infrastructure (the documented
"alternative kernel for an existing notebook type" pattern, the same shape
.NET Interactive and Deno's own Jupyter kernels use), rather than inventing a
bespoke format the way upstream's `.sasnb` did — since a Python notebook's
own `RichOutput` shape is already a well-formed Jupyter output bundle, unlike
SAS's two-fixed-mimetype log/ODS model, and a developer already using Jupyter
notebooks should get the same file format everywhere, not a shape only this
extension understands (Sean's direction, 2026-09-04). **What's still open is
implementation mechanics only, not the format itself**: 9a's very first task
is a hands-on spike confirming whether `.ipynb` notebooks open and accept a
third-party kernel with `ms-toolsai.jupyter` **not** installed, since nothing
found this session states that directly — if the spike shows that extension
is needed, 9a documents it as a recommended/required companion rather than
retreating to a bespoke format. Two further open architecture questions carried into the
phase file rather than settled here: lifting `commands.ts`'s private
`backends`/`backendFor` cache out of its closure so a notebook controller and
Run File share one backend per profile instead of each holding an
independent one, and whether the run-target (ADR-0011/0020) status-bar
concept needs to extend to notebooks at all, given the kernel picker is
already an explicit per-notebook choice. **Committed as `3bdb9f2` on branch
`phase-9-scoping`, opened as [PR #115](https://github.com/Shai-Alit/sas-py-vscode/pull/115),
2026-09-04.** Docs-only, no adversarial review pass needed (the diff is its
own evidence, same as Phases 6/7/8's own scoping PRs) — `check:docs` and
`check:secrets` are the checks it can plausibly fail.

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
[ADR-0020](adr/0020-run-target-defaults-to-local.md)**, which reverses
the run target's default to Local — an unconfigured workspace now
contributes nothing to the editor, so this extension can only win the
primary slot once a user has explicitly asked for Viya. See phase-3.md's
findings write-up and ADR-0020 for the full record. **3d-ii is merged, as
[PR #65](https://github.com/Shai-Alit/sas-py-vscode/pull/65)** — this
repository's first webview: a singleton `WebviewPanel`, CSP-locked, fed by a
buffered host↔webview message protocol, per
[ADR-0021](adr/0021-result-panel-webview.md), opening only for a run
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

**Phase 10 (Viya environment awareness) scoped 2026-09-04**, same separate
clone (`sas-py-vscode-cowork`) Phases 6–9 were scoped from — `main` at
`95e4c73` (Phase 9's own scoping merge, PR #115, already in this history).
**No code was written.** `docs/phases/phase-10.md` and this file's own
phase-index row and narrative entry. **Committed as `fa70f0f` on branch
`phase-10-scoping`, opened as [PR #116](https://github.com/Shai-Alit/sas-py-vscode/pull/116),
2026-09-04.** Docs-only, no adversarial review pass needed (the diff is its
own evidence, same as Phases 6–9's own scoping PRs) — `check:docs` and
`check:secrets` are the checks it can plausibly fail, and both pass clean
(so does `prettier --check`). A codebase survey of
this repo's existing Stage-2 probe and its consumers
(`src/backend/environment.ts`, `environmentPanel.ts`/`environmentDocument.ts`/
`environmentStore.ts`/`environmentStatusBar.ts`, all landed in 3e) plus
`PRODUCTION_PLAN.md` §2.3/§3.1 and current Python/Pylance extension
documentation (cited inline in the phase file) refined the plan's one-line
sketch into a 2-slice Runbook (10a environment view — search/filtering plus
a local/remote diff; 10b Pylance environment reflection), recommending 10b's
own spike first since its answer sizes the rest. **No live-Viya probe was
run or needed** — same reasoning Phase 9 gave for its own scoping session:
the open questions here are VS Code/Pylance client-side questions (does a
generated `python.analysis.stubPath` get picked up without a reload; does a
workspace-settings write need a merge), not Viya wire behaviour, and 3e's
existing probe (untouched by this phase) already answers everything this
phase needs about the deployment side. **Central technical finding, backed
by two independent documented examples, not settled as an ADR yet since
nothing here has been hands-on-verified**: Pylance/pyright's own
`python.analysis.stubPath` mechanism — a directory of generated `.pyi` stub
packages, one per remote-reported distribution, containing only a
permissive catch-all — is the documented way to turn a Viya-only import from
a hard `reportMissingImports` into at worst a suppressible
`reportMissingModuleSource`, without installing anything locally; a
`microsoft/pyright` discussion thread and the `micropython-stubs` project's
own docs both show exactly this shape used for a package (or, in
MicroPython's case, an entire interpreter) that is never locally installed.
Getting the local side of 10a's diff needs no new local-Python dependency
either — `@vscode/python-extension`'s `resolveEnvironment()` gives a
`sysPrefix` to read `*.dist-info` metadata from directly, the same
no-subprocess shape `environment.ts`'s own Viya-side probe already uses via
`importlib.metadata`. **What's still open, and deliberately not settled
here**: whether 3e's plain-text `Show environment` document should gain a
filterable `QuickPick` sibling rather than being replaced (3e's own
documented rationale for plain text — editor-native search, split view —
still stands for the "read the whole thing" case); and a hands-on spike,
10b's own first task, confirming whether a changed `stubPath` is picked up
live and whether a workspace-settings write is safe to make without
clobbering a user's own keys — this sandbox has no interactive VS Code
window to run that spike itself. See `docs/phases/phase-10.md` for the full
account, including why the newer `ms-python.vscode-python-envs` extension's
own environment-registration API is named as an optional future
enhancement rather than a dependency, the same way Phase 9 treated
`ms-toolsai.jupyter`.

**5c-iv started 2026-09-04 — S1 done, but `release-checklist.md` had it
wrong.** Working through the one-time publish setup live (Marketplace,
Open VSX, GitHub) with Sean found that `--oidc` trusted publishing
(ADR-0023's original decision) has never been usable: the Marketplace has
no policy-registration UI for it, confirmed against the live `shai-alit`
publisher's own Manage page and an open, unanswered upstream question
([microsoft/vscode-vsce#1291](https://github.com/microsoft/vscode-vsce/pull/1291)).
Switched to `vsce publish --azure-credential`, reusing an Entra ID identity
this repo already had live (kept when Foundry was walked back from
`claude-review.yml`) via a new federated credential scoped to a new
`release` GitHub Environment — so S3's environment half is also done in the
same pass. Two non-obvious findings recorded in
[ADR-0023](adr/0023-release-publishing.md)'s 2026-09-04 amendment:
GitHub's OIDC subject claim already defaults to the immutable owner/repo-id
form for this repo, and the Marketplace's Members search needs the
identity's Azure DevOps profile id (obtained via a throwaway
`workflow_dispatch` helper, [PR #117](https://github.com/Shai-Alit/sas-py-vscode/pull/117)),
not any Entra identifier. The actual rewrite — `release.yml`, the ADR
amendment, `release-checklist.md`, `docs/dev/ci.md`, and reverting
`@vscode/vsce` from the `3.9.3` prerelease pin back to stable `3.9.2` —
merged as [PR #118](https://github.com/Shai-Alit/sas-py-vscode/pull/118)
(`278eac7`); local `main` fast-forwarded, matches `origin/main`. **Still
open before the real v0.1.0 tag:** S2 (Open VSX), S3's separate
repository-level `v*` tag ruleset, and the `workflow_dispatch` dry run. See
`docs/phases/phase-5.md`'s own 5c-iv Runbook entry for the full account.

**S2, S3, and the dry run all closed the same day, 2026-09-04.** Open VSX:
Publisher Agreement signed, `OVSX_PAT` set, `shai-alit` namespace created.
S3: a `release-tags` repository ruleset (target `refs/tags/v*`, `creation`/
`deletion`/`non_fast_forward` all active) — confirmed via
`gh api repos/Shai-Alit/sas-py-vscode/rulesets`. Dry run: `release.yml`
dispatched manually on `main`
([run 33916176665](https://github.com/Shai-Alit/sas-py-vscode/actions/runs/33916176665)),
`build` green in 1m9s, `publish` correctly skipped. **All of S1–S4 and the
dry run are done — nothing left before the real v0.1.0 tag except Section D
itself.** See `docs/phases/phase-5.md`'s 5c-iv Runbook entry for the full
account.

**Section D run 2026-09-08 — v0.1.0 and a v0.1.1 listing-text patch both
shipped. D7/D8 and three held Dependabot PRs remain.**

**D1–D4** landed pre-weekend as
[PR #121](https://github.com/Shai-Alit/sas-py-vscode/pull/121) (`432b4e7`,
2026-09-04): `CHANGELOG.md` finalised to `## [0.1.0] - 2026-09-04`,
`package.json` → `0.1.0` with `"preview": true`. **D3 (replace the stopgap
icon) deliberately skipped** — ships the generated `Py`-wordmark icon, Sean's
call; `release-checklist.md` D3 carried to a later release. After the long
weekend `main` was still at `432b4e7` with no tag pushed.

**D5/D6 for v0.1.0, 2026-09-08.** The first `git push origin v0.1.0` was
**rejected by the `release-tags` ruleset** — S3 set its `creation` /
`deletion` / `non_fast_forward` rules but left `bypass_actors` empty, so the
`creation` rule blocked _everyone_, admins included, from ever cutting a
release tag. Fixed via the GitHub UI by adding the **Repository admin** role
as an always-bypass actor (`gh api …/rulesets/22299037` confirms
`bypass_actors:[{actor_id:5,actor_type:RepositoryRole,bypass_mode:always}]`) —
the guard against ordinary write collaborators pushing arbitrary `v*` tags is
kept, admins can now tag. S3's guard is only actually complete as of this fix;
its earlier "confirmed via `gh api`" note was checking the rules, not the
bypass list. Tag re-pushed (Sean chose to tag `432b4e7` exactly, not `main`
HEAD, so #122 rides the next release). Release workflow
[run 34277110735](https://github.com/Shai-Alit/sas-py-vscode/actions/runs/34277110735):
`build` green, `publish` approved on the `release` environment, all steps
green — Marketplace `vsce publish --azure-credential`, Open VSX `ovsx publish`
(the failure-note step _skipped_, i.e. it succeeded), and the GitHub Release
`v0.1.0` with the `.vsix` attached. VS Marketplace listing live within ~15 min,
publisher flag `verified`.

**Open VSX namespace warning — expected, one open follow-up.** Every version in
the `shai-alit` namespace shows ⚠️ _"Shai-Alit is not a verified publisher of
the namespace shai-alit"_ — `ovsx create-namespace` (S2) only reserves the
name, it does not make you a verified owner (`"verified": false` on the
namespace and every release). It blocks neither publishing nor installing; it
is a trust-signal only. Removed by a one-time public namespace claim: an issue
on `EclipseFdn/open-vsx.org` (the "Request ownership of a namespace" template —
namespace `shai-alit`, the Eclipse Foundation account that signed the S2
Publisher Agreement, proof via `package.json` `publisher` + the Open VSX
profile + the extension page). An Eclipse admin grants `owner`; the ⚠️ then
becomes a shield on the existing release and all future ones, no republish.
**Not yet filed — carried as a post-release item.**

**v0.1.1 (`e76e8e0`), 2026-09-08 — a docs-only patch to fix the store
listing.** `README.md`'s status blockquote, which ships _inside_ the `.vsix`
and renders on both listing pages, still read **"Nothing is published to the
marketplace yet"** and linked `STATUS.md` / `PRODUCTION_PLAN.md` (both
`.vscodeignore`d out of the package). Rewritten to state the preview status
and link `CHANGELOG.md` (in the package) + the issue tracker.
[PR #127](https://github.com/Shai-Alit/sas-py-vscode/pull/127) — `README.md` +
`version` → `0.1.1` (`npm version --no-git-tag-version`) + a
`## [0.1.1] - 2026-09-08` CHANGELOG section; **no `src/` change, extension
byte-identical to 0.1.0**, so no adversarial review pass (docs-only). Local
`prettier` / `check:docs` / `check:secrets` green; CI + both reviewers green.
Tagged `v0.1.1` (the ruleset bypass let it through, "Bypassed rule violations"
noted in the push output as designed). Release
[run 34281281390](https://github.com/Shai-Alit/sas-py-vscode/actions/runs/34281281390):
`build` + `publish` all steps green, same three targets. GitHub Release live;
both registries re-indexing at time of writing (~15 min like 0.1.0).

**Dependabot's 2026-09-07 weekly run — four PRs, triaged 2026-09-08, none
release-related.** [PR #122](https://github.com/Shai-Alit/sas-py-vscode/pull/122)
**merged** (`5fd67c2`) — dev-tooling minor bumps (`eslint` 10.9.1→10.10.0,
`globals` 17.11→17.12, `typescript-eslint` 8.68→8.69); CI green incl.
`verify`, dev tree only, no `.vsix` impact. **#123, #124, #125 held until
after the release:**
- **#123** (`mocha` 11.8.0 → **12.0.0**) — suite green on all eight `test`
  jobs, but `supply-chain` fails _correctly_: mocha 12 moves off `diff@^7`
  onto `diff@^9`, clearing **GHSA-73RR-HH4G-FPGX** so the sole
  `scripts/advisory-allowlist.json` entry matches nothing (`check-audit.mjs`'s
  `stale` arm — the entry's own `why` foresaw exactly this). Fix = delete the
  entry + sweep its four doc citations (this file's line ~342, `docs/dev/ci.md`,
  `docs/adr/0005-supply-chain-policy.md`, `docs/phases/phase-5.md`); its own
  small PR, since Dependabot can't make that change.
- **#124** (`azure/login` v2 → **v3**; Node 20→24) and **#125**
  (`actions/download-artifact` v7 → **v8**; breaking — ESM, digest-mismatch
  now errors, no auto-unzip of non-zips) — both touch **only**
  `.github/workflows/release.yml`, which no PR exercises, so their green checks
  don't cover the release path. Merge after the release, then re-run the
  `workflow_dispatch` rehearsal to validate.

**D7 confirmed 2026-09-08** (Sean) — the 0.1.1 listing renders on the live
Marketplace / Open VSX pages with the corrected blockquote (no more "nothing
published"); no full `manual-test-pass.md` re-run, zero `src/` delta across
0.1.0→0.1.1. **D8** is [PR #128](https://github.com/Shai-Alit/sas-py-vscode/pull/128) —
`version` → `0.1.2-dev`, fresh `## [Unreleased]` in `CHANGELOG.md`; docs-only,
no publish. **With D8 merged, Section D (and slice 5c-iv, and Phase 5's
release track) is complete — v0.1.1 is the first published release.**

**The three held Dependabot PRs, 2026-09-08.** **#123** superseded by
**[PR #129](https://github.com/Shai-Alit/sas-py-vscode/pull/129)** (`c12ee64`) —
`mocha` 12 taken directly (exact pin `12.0.0`), which drops `diff@^7` for
`diff@^9` and so clears **GHSA-73RR-HH4G-FPGX** _and_, as a bonus, a fresh
**high** advisory **GHSA-2883-XCG3-V3HH** (`js-yaml`) that npm published
against the tree the same day and that had started reddening `supply-chain`
on every open PR. `scripts/advisory-allowlist.json` `allowed` is now empty
and its four doc citations (`docs/dev/ci.md`, ADR-0005, this file's
2026-09-02 housekeeping entry, `phase-5.md`'s `ovsx@1.1.1` bullet) are swept;
`check:audit` green. **#124** (`azure/login` v2→v3) **merged** (`e72a458`).
**#125** (`actions/download-artifact` v7→v8) is rebased and green but **not
yet merged** — this session's `gh` token lacks the `workflow` OAuth scope
needed to merge a PR that edits `.github/workflows/`, so #125 needs a merge
from Sean's own session (one click; it's `CLEAN`). v8 is the intended pairing
for `upload-artifact@v7` (no v8 of that action exists) and is validated by
the next real tag push, not the `workflow_dispatch` rehearsal, since
`download-artifact` runs only in the push-only `publish` job.

**CI note — the `review` (Claude) reviewer workflow is currently broken.** On
a non-`[skip-review]` PR (seen on #129) it fails with `Claude Code native
binary not found at /home/runner/.local/bin/claude` — `anthropics/claude-code-action@v1`
failing its own install step on the runner. `@v1` floats, so a bad upstream
release breaks it with no change on our side; `claude-review.yml` itself was
last touched 2026-09-03. Not an auth problem: the workflow authenticates with
`secrets.CLAUDE_CODE_OAUTH_TOKEN` (intact, last updated 2026-08-27), not an
API key — an earlier note here that read the blank `ANTHROPIC_API_KEY` env
line as a symptom was wrong; that variable is simply unset because this repo
uses OAuth-token auth. It is not a required check (`main` gates only on
`analyze`, `changes`, `ci-required`) and `Codex review` still runs, so no
merge was blocked. Fix: pin `anthropics/claude-code-action` off `@v1` to a
known-good version in `claude-review.yml` (and `ai-review.yml` if it uses the
same action).

**Carried past the release:** (1) the **Open VSX namespace claim** — file the
"Request ownership of a namespace" issue on `EclipseFdn/open-vsx.org` for
`shai-alit` (Sean's Eclipse Foundation account) to clear the ⚠️
unverified-publisher warning; (2) the **Phase 5→6 between-phase housekeeping**
(`HOUSEKEEPING.md`) — its own session.

**Phase 5→6 between-phase housekeeping ran 2026-09-09.** Landed as a docs-only
`[skip-review]` commit. **Findings, by `HOUSEKEEPING.md` checklist item:**
- **ADRs.** ADR-0023's title and index row still said "over OIDC" though the
  body was properly amended 2026-09-04 to `vsce publish --azure-credential` —
  its Status line and `docs/adr/README.md` row now carry that pointer. No other
  ADR needed a change; Phase 5 owed no new ADR (5c-iii already produced
  ADR-0023; 5d-i amended ADR-0003/0008).
- **Punch list (`phase-5.md`).** The `5c` header box was the only unticked one
  though 5c-i–5c-iv all merged — ticked. Stale 5c-iv sub-items closed with a
  dated closeout note: #125 (`download-artifact` v7→v8) merged from Sean's
  session (`c383430`); #123→#129 and #124 merged; the 5c-iii "checks … pending"
  note closed; the detailed `release.yml` bullet's `--oidc` design marked
  superseded. phase-4.md's two deferred diagnostics-lifecycle gaps confirmed
  closed by 5d-iv.
- **RUNBOOK / PRODUCTION_PLAN.** Both current — `RUNBOOK.md` is cross-cutting
  only; `PRODUCTION_PLAN.md`'s coverage figures match `.c8rc.json` (94/94/93/95)
  and defer to it. `phase-3.md`'s orphaned "Phases 6–12" bash-stub (stale
  guessed branch names, flagged for a sweep "whenever Phase 5 starts") retired
  to a redirect, the same as the Phase 4 / Phase 5 stubs already were.
- **This file.** The phase-index row for Phase 5 moves to ✅ done in this same
  commit (see the table below).
- **Scratch files.** None outstanding — `phase-3-runbook-pending.md`'s holding
  role was retired during Phase 5 scoping; nothing in the repo, the project
  folder, or `.claude/` to reconcile.
- **Manual tests.** **No full `manual-test-pass.md` run since 2026-08-27 (end of
  Phase 3)** — all of Phase 4 and Phase 5, including v0.1.0 / v0.1.1, had only
  targeted live re-checks. Sean's call: run a full pass against `verde` /
  `Innov` with the published `.vsix` **before Phase 6 coding starts**, together
  with the still-`[ ]` 5d-i user-provided-CA row (needs a deployment the OS does
  not already trust). Documented in `manual-test-pass.md`'s header.
- **Dependency advisories.** Clean — **0 open GitHub Dependabot alerts**;
  `scripts/advisory-allowlist.json` `allowed` is empty (no `expires` date can
  lapse mid-Phase-6); all four PRs from the 2026-09-07 Dependabot run resolved.
  No production-tree advisories.
- **Cross-cutting, carried:** the **`review` (Claude) CI workflow** is broken
  (`anthropics/claude-code-action@v1` fails its own install step) — fix is a
  version pin in `claude-review.yml`; matters before a code-heavy Phase 6. Its
  own small follow-up, as is the Open VSX namespace claim.

**Finding 74 closed by a live probe during this pass — Finding 93 in
`docs/phases/phase-5.md`.** Probed `verde` 2026-09-09: `PROC PYTHON`'s full
option list (from the deployment's own syntax-error enumeration) is
`COMMAND ECHO INFILE RESTART SRC TERMINATE TIMEOUT`, and **none suppresses the
CPython startup banner or the `>>>` prompt markers** — the banner is the
embedded interpreter's own startup line (emitted on every init: every Run File,
first Run Selection after connect/reset), `>>>` is the REPL prompt on every run.
No `PAGESIZE=MAX`-style source-side fix exists. Decision (Sean, 2026-09-09):
**accept and document** — `manual-test-pass.md` §6 and the user docs
(`running-python.md`, `troubleshooting.md`) are reconciled to treat the
banner/`>>>` as inherent `PROC PYTHON` output. A narrow position-anchored
client-side filter stays a possible future enhancement gated on its own ADR,
not a tracked item.

**Phase 6 (SAS Content explorer) is next — scoped 2026-09-03,
`docs/phases/phase-6.md`.** Before its first slice: the full manual-test pass
above, the `claude-review.yml` fix, and a re-read of `PRODUCTION_PLAN.md` §3 to
confirm the 6→12 order against real post-v0.1.0 demand.

**Phase 5→6 checkpoint closeout, 2026-09-09.**
- **Manual test pass — done, Sean's run.** Full pass against `verde` (SSO) /
  `Innov` (SAS corporate creds) with the published `.vsix`. Everything passed
  **except the 5d-i user-provided-CA row** — no reachable deployment whose chain
  the OS distrusts; stays deferred, as `phase-5.md`'s 5d-i entry records. Three
  notes (`docs/dev/manual-test-pass.md` §3/§4):
  - **Fileref collision after a full VS Code restart — real bug, `fix/` PR
    before Phase 6.** `src/compute/fileref.ts`'s `listFilerefNames` reads only
    the first page of the session's fileref collection, so Finding 72's
    `seedFilerefCounter` under-seeds when a reattached session holds >1 page of
    `PYnnnnnn` names and the 16-attempt retry can't close the gap
    (`The fileref "py000026" already exists … 16 names tried`). Disconnect →
    Connect clears it (new session). Fix = paginate the listing. Standalone
    `fix/` PR, not a phase slice.
  - **Reload-reconnect may re-prompt for auth** on a password-backed profile
    (profile B did; SSO profile A did not) — expected IdP behaviour, not a
    defect; §4 wording updated.
  - **Accounts menu shows both profiles as separate rows** when their auth
    flows differ — refines [#42](https://github.com/Shai-Alit/sas-py-vscode/issues/42)
    (collapse is `account.label`-keyed), and the rows don't identify the
    extension or the profile (`Sean Ford (SAS Viya)` vs `sean.ford@sas.com
    (Microsoft)`). Carried to **Phase 11** (`docs/phases/phase-11.md`).
- **Hosted docs site — not planned.** It was in 5c's original scope but never
  built; the last 10% (Pages deploy, `base` path, `srcExclude` for `phases/**`,
  a canonical-URL ADR) is an independently-breakable surface not worth it pre-1.0.
  Recorded as a standalone task, not a phase slice; the misleading "slice 5c"
  notes in `docs/.vitepress/config.mjs` and `docs/dev/ci.md` are corrected.
- **`claude-review.yml` fix — dropped.** Both AI reviewers ran clean on #133;
  the earlier install-step failure was a one-off, not worth chasing.
- **New issues held.** Per Sean, no new GitHub issues filed while the project is
  pre-release / invite-only — the fileref bug is a `fix/` PR, the accounts-menu
  gap lives in `phase-11.md`. Revisit issue tracking once past "preview".

**Phase 6 (SAS Content explorer) — full slice-by-slice narrative, moved here 2026-09-14 at the Phase 8→9 housekeeping checkpoint**, per `STATUS.md`'s own archival rule — this should have moved at the Phase 6→7/8 checkpoint (2026-09-11) alongside Phase 7's own narrative, but was missed then; caught and fixed at this checkpoint instead.

**Phase 6 (SAS Content explorer) is fully complete and merged — 6a–6e all
landed.** Open [`docs/phases/phase-6.md`](phases/phase-6.md)
for the full account. Scoped 2026-09-03 (4 slices, 6a–6d); the 6→12 order was
re-confirmed with Sean on 2026-09-09 before starting. **6e merged 2026-09-11**
as [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), squash
`a74f756`, after two further review rounds on the open PR each found and fixed
one real race in `paste()`'s failure-restore (commits `716ae27`/`1563bd3` —
see `phase-6.md`'s 6e Runbook entry) — Cut/Paste ships and is confirmed
working live; the `resourceUri` fix attempt for native drag-and-drop does
not work (live-retested, identical symptoms — disproven as the cause, per
ADR-0031's amendment). **Drag-and-drop's real root cause — a VS Code 1.109
bug that JSON-marshals `handleDrop`'s `CancellationToken` argument and
strips its subscribe method, so it threw before any move ran — was found
and fixed 2026-09-11, in a separate follow-up after 6e merged** (finding
6.16, `phase-6.md`) — [PR #164](https://github.com/Shai-Alit/sas-py-vscode/pull/164)
opened 2026-09-11; `phase-11.md`'s tracked follow-up is closed. Fixed and
verified by `npm run verify`/`test:integration`/`check:docs`, a new
regression test reproducing the exact broken-token shape, an adversarial
pass before push (no blocking findings), and **a live retest, 2026-09-11
(Sean): confirmed working** — a real drag-and-drop move, plus every other
§15 row that had been blocked on the base gesture — see `phase-6.md`'s
Runbook and `manual-test-pass.md`'s §15.
**The Phase 6→7/8 between-phase housekeeping
(`HOUSEKEEPING.md`) is now closed.** Its last open item, the top-level-folder
permanent-delete confirmation, is resolved as a documented, deferred known
gap rather than a retry: a real live-exercise attempt found the deletion
blocked, the housekeeping checkpoint itself then mis-corrected that finding
by reasoning from Sean's own admin access (**that correction was wrong and
is retracted**), and Sean has since clarified the actual mechanism — a Viya
deployment-level configuration set at install time restricts deleting a
folder directly under SAS Content for most users, independent of account
permissions, not something admin rights bypass. Not retestable on this
deployment; needs one configured to allow it. See `phase-6.md`'s Runbook
(the `☐` item after the drag-and-drop entry) and `manual-test-pass.md`'s §15
for the full account. **6a is done** (split 6a-i + 6a-ii) and
**6b is done**; **6c** is
split into 6c-i/ii/iii — the oversized-read fix (PR #147), **6c-i** (PR #148,
squash `c63feaf`) and **6c-ii (drag-and-drop move)** ([PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151),
squash `8e842c7`) are done and merged. The drag-into-editor snippet that was
scoped into 6c-ii is **deferred to future work** (Sean, 2026-09-10; finding
6.11). **6c-iii (`getParent` / `TreeView.reveal`) is done and merged 2026-09-10
([PR #154](https://github.com/Shai-Alit/sas-py-vscode/pull/154), squash
`507155e`) — `npm run verify` green (1480 unit; coverage 95.31 lines / 95.37
branches / 94.98 functions / 95.31 statements), 318 integration passing;
adversarial pass before the PR raised no blocking findings (two minor polish
items folded in); Codex PR review flagged the two reveal-path fetches for
lacking an abort path — each now carries its own `AbortSignal.timeout(8_000)`
and the `reveal`-failed `log.debug` is `l10n.t()`-wrapped; Claude PR review
clean, all threads resolved.**
Finding 6.12 pinned the `/folders/ancestors` wire shape (superseding finding
101). This clone also had `npm install` run to reconcile `node_modules` with
Sean's concurrent Phase 7b merge (React + ag-grid) that `main` fast-forwarded
onto.

**6d (favourites + recycle bin) is split into 6d-i / 6d-ii** (Sean, 2026-09-10),
mirroring 6c. The read-only + Sean-approved mutating probe pass for both ran
2026-09-10 — findings 6.13–6.15, `verde`-only (the `innov` token had expired
again). **6d-i (favourites) is done and merged 2026-09-11**
([PR #157](https://github.com/Shai-Alit/sas-py-vscode/pull/157), squash
`652f3a8`) — `ContentAdapter.addToFavorites` / `removeFromFavorites` (a
`reference` member `POST` / a `DELETE` of that record — finding 6.13, which also
settles Finding 80: `memberCount` is a phantom, the members listing is the only
authority), a `markFavorites` opt on `getChildItems` stamping `isInMyFavorites` +
`favoriteUri`, `.fav` / `.recycled` `contextValue` suffixes + `favoriteAction`
on the presentation, two flat commands, the `=~` migration of the content menu
`when` clauses. Adversarial pass before the PR (no blocking findings); five
review findings folded in over two rounds, all local, one push each — the
`.recycled` suffix + `favorite()` bin early-out (Codex 2 × Major); dropping the
per-account `favoritesFolder()` memo (blocking — the adapter is per-endpoint,
reused across profile switches); `typeNameOf` handling wire `type: "reference"`
so favourites browsed inside My Favorites expand/open (likely blocking); a
direct test for the bin early-out (minor). `npm run verify` green (1531 unit
after the 7c-i merge; coverage 95.44 / 95.36 / 95.10 / 95.44), 331 integration,
`npm run check:docs` green; all threads resolved. See `phase-6.md`'s 6d-i
Runbook entry for the full account.
**6d-ii (recycle bin) is done and merged 2026-09-11** —
[PR #159](https://github.com/Shai-Alit/sas-py-vscode/pull/159), squash
`c6b7a70`. Adversarial pass before the PR — no blocking findings; one known
tradeoff flagged (`emptyRecycleBin` has no per-item progress or batching),
Sean's call to ship as-is. PR review (Codex ×2 clean; Claude found one likely-
blocking issue — `inRecycleBin` wasn't propagated past the bin's direct
children, so a file nested inside a recycled folder read as an ordinary
editable item with no Restore — fixed same-branch, one push, thread resolved,
`getChildItems` now also propagates from `parent.inRecycleBin`). Recycle /
restore reuse `ContentAdapter.moveItem` (findings 6.14/6.15, re-confirmed
read-only against `verde` this session; `innov` unreachable so single-cadence
like 6.11–6.15); `emptyRecycleBin` iterates + `deleteItem`s each bin member;
the read-only `sasContentReadOnly:` view is the existing `FileSystemProvider`
registered a second time with `isReadonly: true` (no new class). **"Delete" now
recycles** an ordinary member (no confirm — Restore undoes it) and only
permanently deletes an un-recyclable one (a top-level folder, or a bin item)
behind a modal — Sean's call, upstream parity, a documented-invariant change
from 6c-i, recorded as [ADR-0030](adr/0030-delete-recycles-content-items.md)
at the Phase 6→7/8 housekeeping checkpoint. `npm run verify` green (1550 unit after the review-finding fix;
coverage 95.49 / 95.44 / 95.18 / 95.49), 333 integration, `npm run check:docs`
green.

(Probe finding numbers are now phase-scoped `N.x` — see the "Finding-numbering
scheme changed 2026-09-09" section below and `CLAUDE.md`.)

- **6a-i — `src/wire/` promotion.** Done. The Viya hypermedia link helpers and
  the `application/vnd.sas.error+json` reader moved from `src/compute/` to a
  new service-agnostic `src/wire/` layer so `src/content/` can share them
  ([ADR-0025](adr/0025-shared-wire-layer.md)). Zero behaviour change.
- **6a-ii — content adapter + read-only tree.** Done ([PR #139](https://github.com/Shai-Alit/sas-py-vscode/pull/139)).
  The `src/content/` module (`types`/`problems`/`client`/`adapter`/
  `contentSession`/`presentation` `vscode`-free; `contentTree`/`contentExplorer`
  thin `vscode` shells), this repo's first activity-bar view container, and a
  read-only SAS Content tree (My Favorites / My Folder / SAS Content / Recycle
  Bin, lazy-expanded). No `ContentModel`, no adapter factory, no `sortBy`
  cadence branch — [ADR-0026](adr/0026-content-adapter-shape.md). Live
  Folders/Files findings 97–101 in `phase-6.md`; the `.py`-type second-cadence
  probe moved to 6c (it only feeds create-file).
- **6b — open/save via `FileSystemProvider`.** Done and merged 2026-09-10
  ([PR #141](https://github.com/Shai-Alit/sas-py-vscode/pull/141), squash
  `1c13854`). A new `sasContent:` `FileSystemProvider`
  (`src/content/contentFileSystem.ts`) over three `vscode`-free
  `ContentAdapter` methods (`statFile`/`readFileContent`/`writeFileContent`)
  and the mutating arm added to `src/content/client.ts`: clicking a file leaf
  opens it, saving writes it back with an `If-Match` round trip, and a
  lost-update `412` surfaces as a "reopen for the current version" conflict
  via the returning `localiseContentProblem` seam. Findings 6.1–6.2. Scoped
  to the open/save core — `getParent`/`reveal` + the finding-101 `ancestors`
  probe moved to 6c, the `sasContentReadOnly` recycle-bin scheme to 6d, and
  the drag-into-editor snippet (Python-shaped, probe-gated — Sean's call) to
  6c. `npm run verify` green (1347 unit + 280 integration passing; coverage
  94.93% lines / 95.22% branches / 94.53% functions / 94.93% statements);
  adversarial pass done before the PR, Codex + Claude PR reviews clean, all
  threads resolved. One review finding deferred to 6c (an oversized-file read
  surfaces as a network error, not a size error). A post-merge review pass
  raised one Major — the `opened` ETag guard was keyed by the file href alone,
  so it leaked across deployments; now keyed by deployment root + href — plus
  two Minor doc/robustness findings, all fixed in
  [PR #145](https://github.com/Shai-Alit/sas-py-vscode/pull/145) (squash
  `0449caa`; adversarial pass before the PR, `npm run verify` green, 1348 unit
  + 281 integration passing, coverage unchanged).
- **6c — mutations (create/rename/move/delete).** Split into three sub-slices
  (Sean, 2026-09-10): **6c-i** create/rename/delete for folders and files from
  the tree context menu; **6c-ii** move + drag-and-drop (repo's first
  `TreeDragAndDropController`) + the Python-shaped drag-into-editor snippet;
  **6c-iii** `getParent`/`TreeView.reveal` + the finding-101 `ancestors` probe.
  Upload/download to local disk was never in the 6a–6d breakdown; a prior
  session's own PR #148 Runbook entry said pushing it to Phase 11 was
  "(Sean, 2026-09-10)" without that actually being confirmed with him. **Sean
  has since said (2026-09-11) he does not want it deferred that far** — it's
  an expected feature, not a long-tail item — so this is now an open scope
  question, not a settled deferral. See `phase-6.md`'s correction and
  `phase-11.md`'s retracted note.
  - The 6b-deferred oversized-file-read fix went out first, **merged**
    2026-09-10 as [PR #147](https://github.com/Shai-Alit/sas-py-vscode/pull/147)
    (squash `79e10b0`) — `content-too-large` `ContentProblem` + a typed
    `ResponseTooLargeError` from `src/auth/transport.ts`. Adversarial pass
    before the PR; Codex + Claude reviews clean.
  - **6c-i is done and merged** 2026-09-10 as
    [PR #148](https://github.com/Shai-Alit/sas-py-vscode/pull/148) (squash
    `c63feaf`). `ContentAdapter` gains `createFolder`/`createFile`/
    `renameItem`/`deleteItem` over a new JSON-body arm on `ContentClient`;
    `content-name-rejected` `ContentProblem`; delegate `contextValue`s; four
    flat commands in a new `src/content/contentCommands.ts`. Findings 6.3–6.9
    (probed against both `verde` LTS 2026.03 and `innov` Stable 2026.06):
    finding 6.9 clears Finding 79's one-cadence caveat; finding 6.7 is a real
    cadence difference (a folder rejects its own full representation on `PUT`
    on 2026.06 — 6c-i sends a minimal `{name}` body, no dialect branch).
    `npm run verify` green (1395 unit + 287 integration). Adversarial pass
    before the PR (found the `createFile` rollback-signal Major); Codex PR
    review found one further Major (a post-completion Cancel click hiding a
    landed mutation) — both fixed on the branch; Claude PR review clean; all
    threads resolved.
  - **6c-ii — drag-and-drop move.** Merged 2026-09-10 as
    [PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151) (squash
    `8e842c7`). `npm run verify` green (1417 unit + 296 integration; coverage
    95.18 lines / 95.25 branches / 94.79 functions / 95.18 statements).
    `src/content/
    contentDragAndDrop.ts` — the repo's first `TreeDragAndDropController`;
    `ContentAdapter.moveItem` (a `GET`-then-`PUT` on the member's `update`
    link, `parentFolderUri` changed — finding 6.10); `vscode`-free
    `contentMove.ts` guard (incl. a recycled-item block — a drag out of the
    Recycle Bin is a restore, 6d's); `parentFolderUri` + synthetic
    `inRecycleBin` on `ContentItem`; `canSelectMany` on the view, with
    `&& !listMultiSelection` added to the 6c-i create / rename / delete
    context-menu `when` clauses so they hide during a multi-select rather than
    acting on just the clicked item. The **drag-into-editor snippet is
    deferred** (Sean, 2026-09-10) — finding 6.11: no idiomatic Python
    equivalent of `filename … filesrvc …;`, only a fragile
    `SAS.submit(… fcopy …)` blob, and a low-priority nice-to-have.
    Adversarial pass before the PR (one Minor cast fixed; the recycled-item
    guard was that pass's one call for Sean). Codex PR review clean; the Claude
    PR review raised three findings over two rounds — a multi-item drag test
    gap, `canSelectMany` leaving the 6c-i Rename/Delete/Create context commands
    able to act on one of a multi-selection, and a comment overclaim — all
    folded in on the branch; all threads resolved.
  - **6c-iii — `getParent` / `TreeView.reveal`.** Merged 2026-09-10 —
    [PR #154](https://github.com/Shai-Alit/sas-py-vscode/pull/154), squash
    `507155e`. Adversarial pass before the PR raised no blocking findings; in review,
    Codex flagged the two reveal-path fetches for lacking an abort path — both
    are already client-timeout-bounded and neither has a `CancellationToken` to
    thread, but each now carries its own `AbortSignal.timeout(8_000)`, and the
    `reveal`-failed `log.debug` is `l10n.t()`-wrapped. `ContentAdapter.getParentOfItem`
    (`GET` the `ancestors` link — finding 6.12: object `{ childUri, ancestors:
    [<folder>…] }` under the link's own media type, immediate parent first;
    empty array / `204` ⇒ no parent; finding 101's `406`/`{}` was the wrong
    `Accept`, now superseded). `SasContentTreeProvider.getParent` (top-level ⇒
    `undefined`; a root-listing folder with no ancestors ⇒ `SAS_CONTENT_ROOT`).
    A best-effort `reveal` wired into the 6c-i create commands (re-lists +
    `sameResource`-matches the new node, since a create response's folder id and
    the listing's member id disagree) and the 6c-ii drop handler (first moved
    member, id stable). **Node identity unchanged** — the re-key-by-resource-URI
    alternative was weighed and rejected as an invariant change out of
    proportion to the gain (Sean, 2026-09-10). `npm run verify` green (1480
    unit; coverage 95.31 / 95.37 / 94.98 / 95.31), 318 integration passing.
  - **6d (favourites + recycle bin)** is split into 6d-i / 6d-ii. **6d-i
    (favourites) is code-complete 2026-09-10** — findings 6.13–6.15 from a
    read-only + Sean-approved mutating probe pass (`verde`-only); `npm run
    verify` green (1506 unit; coverage 95.38/95.29/95.07/95.38), 321 integration.
    Adversarial pass pending before the PR. **6d-ii (recycle bin) is next.**

The Phase 5→6 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed
2026-09-09 — nothing else gates Phase 6.

The Phase 6→7/8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed
2026-09-11, once 6e merged. Its only remaining open item — the
top-level-folder permanent-delete confirmation — closed as a documented,
deferred known gap rather than a live confirmation: it is blocked by a Viya
deployment-level configuration set at install time, independent of account
permissions (Sean, 2026-09-11), not by anything this codebase controls or
that a different account on the same deployment would get past. See
`phase-6.md`'s Runbook and `manual-test-pass.md`'s §15 for the full account.
Nothing else gates Phase 7 or 8.


**Phase 7 (Libraries and data viewer) — full slice-by-slice narrative, moved here 2026-09-11 at the Phase 7→8 housekeeping checkpoint**, per `STATUS.md`'s own archival rule, once its own copy of this narrative started duplicating `docs/phases/phase-7.md`'s own detail (the pattern this file's own header note has always asked for at a phase boundary).

**Phase 7 (Libraries and data viewer) is fully complete — 7a–7d all merged,
worked from the separate `sas-py-vscode-cowork` clone — open
[`docs/phases/phase-7.md`](phases/phase-7.md).** Scoped 2026-09-03
(7a–7c); **7a is done and merged** ([PR #142](https://github.com/Shai-Alit/sas-py-vscode/pull/142));
**7b (data viewer webview) is done and merged 2026-09-10** ([PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150),
squash `60a944e`) — adversarially reviewed twice — no blocking findings
either time — and Sean's own manual visual check of a real panel ran
2026-09-10, twice: once before this round's fixes, once after.
Of the three findings the first check surfaced: column alignment is fixed
and confirmed by Sean's own re-test (Finding 7.14, live-probed against
`verde`); the busy-session blank-grid panel got a real, defensible fix
(`buildHtml` was missing a `background-color` rule, kept) but Sean's re-test
against a confirmed-fresh build surfaced a second, deliberately deferred gap
instead — neither the SAS Libraries tree nor an open data-viewer panel
recovers on its own once a busy run finishes; the tree needs a manual
refresh (already an accepted 7a limitation, now confirmed to extend to the
panel too, per 7a's own Runbook hedge), and the panel has no equivalent
affordance at all. **Deliberately left open at Sean's own direction — not
blocking this slice, and not addressed by anything in 7c's current punch
list**, so it is flagged for its own future slice rather than assumed away;
the grid's light-only theme remains a separate open design decision for
Sean, not a defect. One minor gap from the second review (no test asserts
panel-dispose aborts its `AbortController`) has been folded in and verified.
Preparing this PR's own body also surfaced a real, pre-existing gap: the
data viewer panel's failure messages went out as `describeDataProblem`'s
unlocalised log fragment, unlike every other panel in this project. Fixed
with a new `src/data/messages.ts` (`localiseDataProblem`), matching
`resultPanel.ts`/`contentFileSystem.ts`'s own established pattern exactly,
with its own integration coverage. See `phase-7.md`'s 7b Runbook entry for
the full account. **Sean has
confirmed the deferred busy-recovery gap and the light-theme decision are
acceptable to ship as documented follow-ups rather than blockers.**
**[PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150) opened
2026-09-10, merged 2026-09-10 (squash `60a944e`)** (the l10n fix's own commit
skipped the standing pre-push manual adversarial pass, Sean's own call, to
rely on those two instead). **github-advanced-security (CodeQL) then flagged
a real `js/missing-origin-check` finding**: `dataViewerEntry.tsx`'s message
listener trusted `event.data` with no check on who posted it (the
CVE-2021-43908 class of gap). Fixed in two attempts — the first, following a
Microsoft community thread's `https:`-prefix suggestion, was itself broken
(Codex's review caught that a bare `https:` prefix matches almost any HTTPS
origin) and was tightened to the two concrete origins VS Code actually
issues (`vscode-webview://…` desktop, `https://….vscode-webview.net` web).
`tsc`/`prettier` clean; **a third manual check (open a real table) then
confirmed it, 2026-09-10** — Sean's own console export showed no
`postMessage`/`origin` error, and the grid rendered column headers and rows
for a real table. Closed, until GitHub's Copilot Autofix suggestion for the
same CodeQL alert was applied directly to the branch as its own commit
(`03e6caec`), rewriting the check to a `new URL(event.origin)` version
without going through local review or re-verification. **Fourth manual pass,
2026-09-10: confirmed against that exact commit** — same result, no
`postMessage`/`origin` error, grid rendered. See `phase-7.md`'s 7b Runbook
entry for the full account, including the unrelated benign VS Code-internal
console warnings (`local-network-access`, iframe sandbox) a later log from
the same check surfaced. That same console export also surfaced a new,
unrelated, real gap: the panel's CSP has no `font-src`, so ag-grid's own
bundled icon font (an `@font-face` inside `ag-theme-alpine.css`) is
blocked — currently invisible (7b ships `sortable: false` and no filter, so
nothing draws an icon from it yet) but will show as broken/missing icons
the moment 7c turns sort or filter on. First deferred to 7c as its own
punch-list item; **superseded same day** — a second adversarial review
(prompted with that deferral) agreed it was reasonable but flagged the fix
as cheap and already confirmed, so **Sean's final call was to fix it now**
rather than carry it forward: `font-src {cspSource} data:;` added to
`buildHtml`'s CSP, with a matching new test assertion. Nothing left on 7c's
punch list for this. That same review found no blocking issues across the
full 7b diff (11 files); two low, non-blocking findings — a `null`
message-listener gap (practically unreachable, file untested by any tier
either way) and a stale `NUM` doc-comment example Finding 7.14 should have
swept — **both fixed too, Sean's call to fold them in alongside the CSP
fix**. A fourth manual pass confirmed the origin check again after GitHub's
Copilot Autofix rewrote it to a `new URL(event.origin)` version
post-merge-of-the-manual-pass (`03e6caec`); a real profile-scoping bug in
`DataViewerPanelManager`'s panel key (caught by review, same shape as 6b's
`sasContent:` ETag-guard fix) was found and fixed with a regression test;
and the branch was reconciled against `main` after phase 6's 6c-ii merged
in the meantime. **PR #150 merged 2026-09-10 as squash `60a944e`.** Full
account in `phase-7.md`'s 7b Runbook entry.

- **7a — `LibraryAdapter` + read-only tree.** Done. `src/data/`, the
  `pythonOnViya.dataExplorer` tree, `ComputeSessionManager`'s new
  `onDidChangeConnection` — see this file's Phase index row for the full
  verify numbers.
- **7b — Data viewer webview.** Decided 2026-09-10, with Sean: React +
  `ag-grid-community`, not a hand-rolled grid — [ADR-0028](adr/0028-data-viewer-is-react-and-ag-grid.md)
  records the reasoning, the re-derived CSP threat model 7b's own code must
  write, the testing-boundary call (browser-only exclusion, no `jsdom`), and
  the dependency-classification decision (`devDependencies`, preserving
  [ADR-0005](adr/0005-supply-chain-policy.md)'s zero-runtime-dependency
  invariant — see that ADR's own 2026-09-10 amendment). Finding 7.10
  (`phase-7.md`) settles a real implementation question in 7b's favour: the
  rows collection's `count` is populated even at a small `limit`, so no
  "assume last page" heuristic is needed (a same-day re-probe corrected that
  finding's own `itemCount` detail; unused by any code, see `phase-7.md`).
  Finding 7.13 confirms the rows collection's own `next`/`last`/`self` links
  are properly typed, unlike the tables collection's (Finding 7.9). **Code
  complete 2026-09-10**: `LibraryAdapter.openTable`/`getColumns`/`getRows`
  (unit-tested), `DataViewerPanelManager`/`OpenTablePanel`
  (integration-tested against a fake panel and the real adapter), the
  `pythonOnViya.openTable` command, and the React/ag-grid webview bootstrap
  (`src/webview/dataViewerEntry.tsx`) — see `phase-7.md`'s 7b punch list for
  the full file-by-file account. **Adversarially reviewed 2026-09-10,
  before any push** (per `CLAUDE.md`'s standing rule): three real findings
  folded in — no unit test for `dataViewerModel.ts` (added), a `requestId`
  collision across a webview reload that could resolve the wrong row window
  (fixed with `crypto.randomUUID()`), and no `AbortSignal` on any of the
  panel's three adapter calls (fixed with a per-panel `AbortController`).
  Sean's own `npm install` + `npx tsc -p tsconfig.webview.json --noEmit`
  then came back clean — the one thing nothing in the sandbox this was
  written in could check — after two small fixes the install itself
  surfaced (an ambient `*.css` module shim; an `exactOptionalPropertyTypes`
  conflict on an intentionally-omitted `rowCount`). Sean's own
  `npm run verify` and `npm run test:integration` then surfaced two more
  real gaps the review pass predates: a test-ordering bug in three
  `DataViewerPanelManager` integration tests (`sendReady()` called before
  `open()` had registered the fake panel's listener), and a branch-coverage
  shortfall traced to under-tested `src/data/types.ts` parser functions.
  Both fixed and re-verified — `phase-7.md`'s 7b punch list has the full
  account — and Sean's re-run of both commands is green. **Sean's own
  manual visual check of a real panel then ran twice, 2026-09-10.** First
  pass (`manual-test-pass.md` §10/§11) found three real findings: numeric
  columns not right-aligning, a busy-session table-open showing a blank
  panel with no message, and the grid always rendering in ag-grid's
  light-only theme. A live probe against `verde` (Finding 7.14) settled the
  first — real numeric columns report `type: "FLOAT"`, never `"NUM"` — and
  `toColumnDefs` was fixed to match, along with a stale fixture and two
  tests that had baked in the same unprobed `"NUM"` value. A
  `background-color` rule was added to the panel's `<style>` block for the
  second. **Second pass**, against a confirmed-fresh installed build,
  confirmed the alignment fix and surfaced a different, more specific
  finding in its place: neither the SAS Libraries tree nor an open
  data-viewer panel recovers on its own once a busy session frees up — the
  tree needs a manual refresh (already an accepted 7a limitation; this
  confirms it extends to the panel too), and the panel has no equivalent
  affordance at all. A second adversarial review (against `origin/main`,
  covering the original 7b commit plus the Finding 7.14 fixes) found no
  blocking findings; its one real minor observation — no test asserted that
  disposing a panel aborts its in-flight `AbortController` — is now folded
  in and verified. **Left open, at Sean's own direction, not blocking**: the
  busy-recovery gap (not covered by 7c's planned scope, needs its own future
  slice) and the light-only-theme decision (ADR-0028 didn't address it).
  `phase-7.md`'s 7b punch list and Probe findings section have the full
  account. **Merged 2026-09-10** as [PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150)
  (squash `60a944e`), after a profile-scoping panel-key fix and a
  reconciliation against `main` (6c-ii had merged while this PR was open) —
  see `phase-7.md`'s 7b Runbook for the full account.
- **Three small PR #150 follow-up findings closed 2026-09-10**, from the
  `sas-py-vscode-cowork` clone, ahead of 7c proper: `pythonOnViya.openTable`
  hidden from the global Command Palette (a `commandPalette` `"when": "false"`
  entry, matching the four content commands); the dead `data-title` attribute
  (and its now-unused `escapeHtmlAttribute` helper and `buildHtml`
  parameter) removed from the data viewer's HTML shell; and a JSX test case
  added for `check-coverage-scope.mjs`'s `scriptKindFor`, feeding
  `importsHostModule` a real, ag-grid-shaped `.tsx` element. See
  `phase-7.md`'s 7c punch list for the full account, including why the JSX
  test's own investigation found this particular check doesn't actually
  depend on `scriptKindFor` for any well-formed input. `npm run test:unit`
  (1443 passing), `test:integration` (305 passing), and `npm run coverage`
  (95.29/95.37/94.95/95.29, all thresholds met) all green; `build`/lint/
  typecheck/copyright/secrets/contracts all clean.
- **7c — Sort, filter, CSV export, table properties.** Split into three
  sub-slices 2026-09-10, mirroring 6c's own split: **7c-i** sort + filter
  (share one request payload/probe — the `createView`/`where=` mechanism,
  and fixing upstream's un-cleaned-up orphan-view bug rather than porting
  it); **7c-ii** table properties/columns static viewer; **7c-iii** CSV
  export to local disk (standalone — Phase 6 deferred its own
  upload/download to Phase 11 entirely, so there's no helper to share).
  **7c-i (sort + filter) is code-complete 2026-09-10** (`sas-py-vscode-cowork`
  clone) — live-probed first (Findings 7.15–7.18: `createView`'s real
  request/response shape and its own `delete`/`rowsAsCSV` links; `where=` is
  silently ignored on a created view's own rows read, so a filter must be
  baked into the same `createView` body as `sortBy`; `count` disappears the
  instant a filter or view is involved, not just sometimes null); design
  recorded in [ADR-0029](adr/0029-sort-view-lifecycle.md) (one view
  reused per (sort, filter) state across pagination, not recreated per page
  the way upstream's own un-cleaned-up `getSortedRows` does; guaranteed
  cleanup on every state change and on dispose; a serialised
  `ensureReadTarget` closing a real concurrent-view-creation race). A shared
  fix also landed in `src/wire/viyaError.ts` (a nested `errors[0].details`
  fallback, Finding 7.18). A pre-existing 7a/7b fixture
  (`table-detail-class.json`) had guessed its `createView`/`rowsAsCSV` link
  hrefs wrong (neither had a caller before now); corrected against Finding
  7.15's real shape. **Reviewed twice before push**: an independent-agent
  pass (no blocking findings, two low-priority notes addressed — see
  `phase-7.md`), then Sean's own review of the same diff, per this
  project's actual standing requirement. Sean's pass found three further
  real, low-priority issues, all fixed: the new filter box had no
  theme-aware styling (fixed with the standard `--vscode-input-*`
  variables); a `getRows` call following a resolved `ensureReadTarget` was
  not itself serialised against a *later* request's own sort/filter change,
  so a fast state change could leave an earlier read answering against an
  already-discarded view (fixed — `handleRequestRows` now drops a reply
  once the panel's state has moved past it; a new integration test
  reproduces the race directly); and `ensureReadTarget` returned an
  un-`catch`'d promise (latent hardening, now fixed). Full account in
  `phase-7.md`'s 7c-i Runbook entry. `npm run verify`/`test:integration`
  re-run green after all three fixes (1468 unit, 310 integration passing,
  thresholds unchanged); `check:docs`/`l10n:extract`/`build` all clean.
  **[PR #155](https://github.com/Shai-Alit/sas-py-vscode/pull/155) opened
  2026-09-10.** `docs/dev/manual-test-pass.md` gained an unrun §12 for
  Sean's own visual check of the new filter bar and sort-icon rendering.
  **That check ran 2026-09-10 and found three real bugs, all fixed on the
  same branch before merge**: a sort or filter was silently lost switching
  away from the table's tab and back (`retainContextWhenHidden: false`
  reloads the webview document on hide/show, and the freshly mounted grid
  had no memory of the previous document's sort/filter — its own first
  request read as "cleared", which this panel's state machine took as an
  instruction to discard the still-wanted server-side view); and an invalid
  filter showed a blank grid with no error, warning, or log line anywhere
  (the host already computed a real, specific message — Finding 7.18 — but
  `dataViewerEntry.tsx`'s own datasource was discarding it). Fixed:
  `InitMessage` gained `initialSort`/`initialFilter`, replayed as the panel's
  *current* state (not the state frozen when the table first opened) on
  every `"ready"`; the webview restores the filter box's text and seeds
  ag-grid's initial sort from them; a `rowsError` reply now renders as a
  banner instead of being silently dropped; and `dataViewerPanel.ts` now logs
  a warning on both row-fetch failure paths, which it did not before either.
  `npm run verify` green (1468 unit, coverage unchanged); `test:integration`
  green (313 passing, three new). Full account in `phase-7.md`'s 7c-i Runbook
  entry. **Also found, separately**: both AI PR reviewers showed "pass" on
  PR #155 with no review ever actually posted — a `cancel-in-progress`
  concurrency gap in `ai-review.yml`/`claude-review.yml` let a fast-follow
  `[skip-review]` docs commit cancel the review runs against the real source
  commits, then legitimately skip itself. Not a runner fluke.
  **Fixed and merged** as [PR #156](https://github.com/Shai-Alit/sas-py-vscode/pull/156)
  (squash) — both `ai_review.py` and the Claude Review guard step now also
  require the commit immediately before a `synchronize` push to be
  skip-tagged before honouring the head's own flag. `phase-7c-i-sort-filter`
  was reconciled with `main` a second time to pick it up, and both automated
  reviewers then ran against this branch's real diff for the first time.
  **Each found one real issue, both verified and fixed before any further
  push**: a stale `requestRows` reply was silently dropped rather than
  answered (a real, if narrow, leak — `dataViewerEntry.tsx`'s own
  `pendingRowRequests` entry, and the promise it resolves, was left pending
  forever), and no test exercised `onDidDispose`'s own stale-view-delete
  cleanup on either its success or failure-logged path. `npm run verify`/
  `test:integration` re-run green (321 passing — the jump from 313 includes
  6c-iii's own tests from the `main` reconciliation, plus 2 new dispose
  tests this round added). Full account in `phase-7.md`'s 7c-i Runbook
  entry.
- **7c-ii (table properties/columns static viewer) is code-complete
  2026-09-11** (`sas-py-vscode-cowork` clone) — live-probed first (Finding
  7.19: the full `TableInfo` field set, and confirmation that
  `creationTimeStamp`/`modifiedTimeStamp` are ISO-8601 strings, not a raw SAS
  epoch number, settling the one open question this slice's own punch list
  raised). `TableDetail`/`readTableDetail` (`src/data/types.ts`) gained the
  rest of `TableInfo`'s field set; a new `src/data/tablePropertiesModel.ts`
  (`vscode`-free, unit-tested) and `src/data/tablePropertiesPanel.ts`
  (`.c8rc.json`-excluded, integration-tested) render a static properties/
  columns panel opened via a new `pythonOnViya.showTableProperties` context
  command. **Deliberately not a straight port of upstream's own client-side
  tab-toggle script** — this panel needs no `<script>` at all: the two tabs
  are CSS-only (radio-button `:checked` sibling selectors), so
  `enableScripts` is `false`, the only one of this project's three webview
  panels that needs no script execution. `npm run verify` green (1519 unit
  passing; coverage 95.48/95.43/95.15/95.48, every threshold met);
  `npm run test:integration` green (333 passing, 9 new);
  `npm run check:docs` green. **Adversarial pass done before the PR
  2026-09-11 — no blocking findings.** Four low-priority notes, one folded
  in: `formatTimestamp`'s own epoch-fallback unit test re-derived the
  function's `315619200` constant instead of asserting an
  independently-computed expected value; fixed. Two accepted as-is (a bare
  numeric string parsing as a year rather than reaching the epoch fallback —
  parity with upstream, not reachable with real ISO-8601 data; the `disposed`
  boolean vs. `AbortSignal.aborted` style note). One noted as a real but
  pre-existing, cross-panel gap and initially deferred (a stuck "Loading…"
  panel if `openTable`/`getColumns` *rejects* rather than resolving
  `{ok:false}`, shared with `DataViewerPanelManager`'s own identical
  `loadTable`) — **a second Codex review round on the open PR then flagged
  this same gap as its own in-scope finding** (a fair distinction: introducing
  new code that reproduces a known-bad pattern is different from also being
  asked to patch a different file's pre-existing instance), so it was fixed
  after all, scoped to `tablePropertiesPanel.ts` alone — see below.
  **[PR #158](https://github.com/Shai-Alit/sas-py-vscode/pull/158) opened
  2026-09-11.** Both automated PR reviewers ran against the real diff; the
  Claude reviewer found nothing new. **Codex found two real issues, both
  fixed on the branch**: (blocking) `panelHead`'s CSP allowed `style-src
  'unsafe-inline'`, reasoned as safe only because every dynamic value is
  `escapeHtml`-escaped — correctly pushed back on as weaker than not needing
  the exception at all; unlike `dataViewerPanel.ts` (which genuinely needs
  `'unsafe-inline'` for `ag-grid`'s own runtime-set `style="…"` *attributes*,
  which a nonce cannot cover), this panel has exactly one `<style>` *element*
  and no inline `style="…"` attributes anywhere, so a nonce (the same
  mechanism `resultPanel.ts`/`dataViewerPanel.ts` already use for their own
  `<script>` tag) removes the exception entirely; (major) the new
  `showTableProperties` log line was hard-coded English — fixed, and its
  identical `openTable` neighbor (copied from 7b, same defect, not flagged
  since it predates this diff) fixed alongside it rather than left
  inconsistent. **A CI failure surfaced separately**: `test (windows-latest,
  node 24)` timed out at the unit tier's 2s budget on `formatTimestamp`'s own
  test — this project's first-ever call to `Date.prototype.toLocaleString()`,
  and Intl/ICU's first-use cost apparently exceeded 2s on that one
  runner/Node combination. Fixed the same way `eslint-ignores.test.ts`/
  `contracts.test.ts`/`coverage-scope.test.ts` already do for their own
  "loading a tool" cost: a suite-level `this.timeout(30_000)`. `npm run
  verify` re-run green after all three fixes (1519 unit passing, coverage
  unchanged); `npm run test:integration` green (334 passing — a new CSP
  nonce test). **A second Codex review round, against that fix commit,
  raised one further Major**: the "stuck on Loading… forever" gap this
  file's own pre-PR write-up had accepted as pre-existing and deferred.
  Fixed, scoped to this slice's own file only: `start()` now wraps its two
  adapter calls in a `try`/`catch`, rendering a failure (the same
  `compute-unreachable` shape `dataViewerPanel.ts`'s own `ensureReadTarget`
  already produces for an unexpected throw) and then rethrowing, so the
  command handler's own log line still fires. `dataViewerPanel.ts`'s
  identical instance is deliberately left untouched — a different file from
  an earlier phase, not this PR's own diff; closing it, if wanted, is its own
  small follow-up. A new integration test drives a raw `ComputeClient` whose
  `send` rejects and asserts both the rendered failure text and that
  `manager.open(...)` itself still rejects. `npm run verify` green again
  (1519 unit, coverage unchanged); `npm run test:integration` green (335
  passing). Full account in `phase-7.md`'s 7c-ii Runbook entry.
- **7c-iii (CSV export to local disk) is done and merged 2026-09-11**
  (`sas-py-vscode-cowork` clone) —
  [PR #161](https://github.com/Shai-Alit/sas-py-vscode/pull/161), squash
  `dac4f7f`. Live-probed
  first (Finding 7.20): the real `rowsAsCSV` mechanism is `Accept`-header
  content negotiation on the identical `rows` href, not upstream's own
  hand-composed `.../rows#CSV` suffix (which never actually reaches a CSV
  response on a real deployment — upstream silently re-serializes JSON rows
  instead); pagination/`where=`/quoting all already correct, and pages
  concatenate with no separator needed. `LibraryAdapter.getRowsAsCsv`, a new
  `vscode`-free `src/data/csvExportModel.ts` (deliberately unbounded
  pagination — its own `start` is self-derived, never a server link, so it
  cannot cycle the way a `next`-link loop could), and a new
  `src/data/csvExportCommand.ts` wiring `pythonOnViya.exportTableToCsv`: a
  save dialog, a cancellable progress notification, a streaming write to a
  temporary file renamed onto the destination only on full success (so a
  cancelled/failed export never touches, or truncates, a destination the
  user already had), and a pre-flight `ensureDiskSpace` check refusing to
  start if the destination volume looks too small for the estimated size.
  **A genuine architecture decision, confirmed with Sean before writing the
  code**: `csvExportCommand.ts` is a new, fifth entry on
  [ADR-0003](adr/0003-extension-host-target.md)'s Node-built-ins
  allow-list (`node:fs`, `node:path`, `node:crypto`) — `vscode.workspace.fs`'s
  whole-buffer-only `writeFile` can't stream a potentially large export
  without holding the whole table in memory first, defeating the reason this
  feature streams at all; see that ADR's 2026-09-11 amendment.
  **Adversarially reviewed twice before the PR, per `CLAUDE.md`'s standing
  rule**: an independent-agent pass found three real findings, most
  notably that an existing file at the chosen destination could be
  truncated then deleted on a failed export — fixed with an atomic
  write-to-temp-then-rename redesign, which also closed a synchronous-throw
  gap and a missing stream-error test. Sean's own review then found no
  blocking issues; two of its three minor notes were folded in (a missing
  mid-write failure test; deferring temp-file creation until after
  `openTable`/the disk-space check pass, so an early failure touches the
  filesystem not at all). `npm run verify` green (1551 unit passing;
  coverage 95.56%/95.51%/95.25%/95.56%, every threshold met);
  `npm run test:integration` green (346 passing, 7 new); `check:docs`/
  `l10n:extract`/`build`/`check:copyright`/`check:secrets`/
  `check:coverage-scope`/`check:contracts` all clean. Full account in
  `phase-7.md`'s 7c-iii Runbook entry. **7c (sort/filter, table properties,
  CSV export) is now fully done — all three sub-slices merged.**
- **7d — Python↔library data exchange (`SAS.sd2df`/`df2sd`/`submit`).**
  Scoped 2026-09-04 from a separate session; that session's doc edits were
  stashed rather than committed and sat unmerged until found and resurrected
  2026-09-10. Live-probed this session (Findings 7.11/7.12): all three
  bridge methods work end to end, and the credential-echo risk the stash
  had only guessed at (by analogy to Phase 8's Finding 8.6) turned out to be
  more nuanced than feared — `SAS.submit()`'s own log echo applies SAS's
  standard `PASSWORD=` masking; Finding 8.6's own mechanism (the outer
  job-source echo) is untouched and still the real risk for a credential
  written as a literal. **Code-complete 2026-09-11** (`sas-py-vscode-cowork`
  clone): a new `docs/data-access.md`
  ("Python and SAS libraries", registered in the VitePress sidebar and
  `docs/README.md`'s index — neither 7a/7b/7c ever shipped a user-facing doc
  page of its own to fold this into); the drag-and-drop snippet
  (`src/data/dragSnippet.ts`, `vscode`-free/unit-tested, and
  `src/data/dataDragAndDrop.ts`, the one class playing both the
  `TreeDragAndDropController` and `DocumentDropEditProvider` roles this
  needs, registered for `{ language: "python" }`) — a drop always asks, via a
  quick pick, whether to insert a plain `SAS.sd2df(...)` read or a
  `SAS.submit`-based `PROC SQL` pass-through (Sean's call), with the assigned
  variable name derived from the table's own name and deduplicated against
  the drop target document's own text (Sean's call); and
  `test/fixtures/data/submit-log-echo.txt`, a verbatim transcription of
  Finding 7.12's own already-sanitized log excerpt (not a captured wire JSON
  envelope — this mechanism has no wire call), pinned by a new unit test.
  **Adversarial pass (independent agent) ran before any push, per
  `CLAUDE.md`'s standing rule** — one real, blocking finding: the SQL
  pass-through's own `select * from libref.table` line had no protection
  against a `;` in the table name, letting the rest run as independent SAS
  statements the moment the inserted snippet is run unmodified. **Fixed**:
  `dragSnippet.ts`'s new `sasNameRef` wraps a name outside the ordinary
  bare-identifier shape in a SAS name literal (`'…'n`) before either escaping
  layer runs, applied only to the SQL pass-through's own generated SAS
  source (not `sd2df`'s runtime string argument). Two related Medium
  findings also fixed: the drop's own `CancellationToken` never reached the
  quick pick (now threaded through), and an already-cancelled drop still
  showed the picker before discarding the answer (now checked first, via a
  `cancelled()` closure matching `contentDragAndDrop.ts`'s own idiom, to
  dodge a TypeScript narrowing false-positive across the intervening
  `await`). `npm run verify` green (1567 unit passing; coverage
  95.6%/95.5%/95.35%/95.6%, every threshold met); `npm run test:integration`
  green (355 passing, 9 new); `check:docs` (all four steps) green.
  **[PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163) opened
  2026-09-11**, after which Sean's own live test found the drop silently
  inserting nothing — a tree→editor drop crosses the extension-host RPC
  boundary and VS Code serializes the payload, so
  `provideDocumentDropEdits` got the `JSON.stringify`'d text rather than the
  `TableItem[]` `handleDrag` set, and the slice had cast it instead of
  parsing it; the resulting `TypeError` was swallowed by VS Code and visible
  only in the DevTools console. **Fixed** with a validated, `vscode`-free
  `readDraggedTables` in `src/data/types.ts` (+6 unit tests) rather than an
  inline parse in the coverage-excluded `dataDragAndDrop.ts`, and
  **re-tested live by Sean the same day: drag, both snippet choices and the
  inserted code all work** (`manual-test-pass.md` §17's first six rows now
  pass). Diagnosing it also found a **separate root cause for Phase 6's own
  drag-and-drop failure** — `handleDrop`'s `CancellationToken` does not
  survive the RPC hop, so `contentDragAndDrop.ts:203` throws before doing any
  work — recorded in `phase-6.md` and handed to that phase's agent, not fixed
  here. Reconciled with `main` (merge `30771e8`, picking up 6e/PR #162);
  `npm run verify` re-run green (1574 unit; coverage
  95.62/95.54/95.38/95.62), `npm run test:integration` green (372 passing).
  Sean's own review pending before merge. Full account in `phase-7.md`'s 7d
  Runbook entry.


**Phase 8 (CAS and SWAT) — full slice-by-slice narrative, moved here 2026-09-14 at the Phase 8→9 housekeeping checkpoint**, per `STATUS.md`'s own archival rule, once its own copy of this narrative started duplicating `docs/phases/phase-8.md`'s own detail.

**Phase 8 (CAS and SWAT) has started — 8a (CAS browsing) is done, 2026-09-11.**
A read-only **CAS** tree — a third view in the existing activity-bar
container, alongside SAS Content and SAS Libraries — shows a deployment's CAS
servers, their global-scope caslibs, and each caslib's tables; expanding a
table loads it on demand (Finding 8.3/8.8's JIT-load `PUT`) and shows its
columns. `src/cas/` mirrors `src/content/`'s shape, not `src/data/`'s — an
endpoint and a token, no session of any kind — since Finding 8.2/8.7
confirmed global-scope `casManagement` browsing needs neither a compute
session nor a CAS session ([ADR-0033](adr/0033-cas-adapter-shape.md)).
This slice's own scope — whether the tree stops at tables (7a's own
precedent) or goes one level deeper to columns — was an open inconsistency
in `phase-8.md`'s own text, resolved this session (columns included), which
is what pulled the JIT-load probe Finding 8.3 flagged into 8a rather than a
later slice. That probe (Finding 8.8) was the one mutating call this slice
needed, approved in advance, scoped to a generic-caslib system table, and
left the deployment exactly as found. **Before 8a's PR was ever opened,
Sean's own manual test pass found a real crash** — expanding a caslib with
several tables threw VS Code's own "Element with id … is already
registered" repeatedly and the tree ended up empty — root-caused live
(Finding 8.9): `casManagement`'s own collections have no stable order
across identical requests at all, so `CasAdapter`'s offset-based pagination
duplicated some tables and silently dropped others. Fixed by seeding every
paginated request with `sortBy=name` in the one shared `collectPages`
helper. `npm run verify` green (1669 unit — one new test citing Finding 8.9;
coverage unchanged at 95.82/95.46/95.66/95.82 — the ratchet raised from
94/95/94/94 in this slice), 382 integration passing, `npm run check:docs`
green. **Adversarial review run twice before the PR opens, no blocking
findings from either pass** — one near-miss on the first pass (the JIT-load
`PUT` firing as a side effect of expanding a table node, confirmed
intentional per ADR-0033/Finding 8.8) and a disclosed sortBy-forwarding
assumption on the second, now tracked as its own 8a punch-list item.
**[PR #169](https://github.com/Shai-Alit/sas-py-vscode/pull/169) merged
2026-09-13, squash `610d3f7`** — bundled the 8a slice, the 8a manual-test
items (8.1–8.10), the Finding 8.9 fix, and an unrelated CI-classifier/
activity-bar-icon chore into one PR, merged directly by Sean; the second
adversarial pass's open process question (whether that bundling was
intentional) is resolved by the merge itself. **Sean's live retest
2026-09-13 confirmed the Finding 8.9 fix**: items 8.4 and 8.7, which the
pagination-crash had blocked on 2026-09-12, now pass, and all ten 8a
manual-test items pass. See `phase-8.md`'s Runbook and Probe findings
(8.7/8.8/8.9) for the full account. **Flagged 2026-09-13 (Sean) and folded
into 8b:** CAS tables show the same tree icon whether loaded into memory or
not, so a user has no visual cue before running code that will fail against
an unloaded table — now a punch-list item on 8b in `phase-8.md`'s Runbook.
**8b (authenticated CAS session helper) is code-complete 2026-09-13** —
`pythonOnViya.insertCasConnectionSnippet` writes a fresh CAS token as a
fileref and inserts a plain-text `swat.CAS()` connect snippet; the slice's
one non-negotiable manual check (the token never appears in the job log)
passed 2026-09-13. Sean's manual test pass the same day found one further
bug: the command inserted its snippet into any focused file, not just a
`.py` one — fixed by gating on `editor?.document.languageId !== "python"`,
the same check `src/run/commands.ts`'s Run commands already use, with a new
regression test. The adversarial pass before this PR opens then found one
real coverage gap (three of the command's own error-report branches were
untested) — fixed with three more tests, no code defect. `npm run verify`
green (1689 unit; coverage 95.87/95.45/95.72/95.87), 400 integration
passing, `npm run check:docs` green. **8b awaits a live re-confirmation of
the 8.18 fix before its Runbook box ticks** — see `phase-8.md`'s 8b
Runbook. (That live re-confirmation landed and 8b merged as
[PR #170](https://github.com/Shai-Alit/sas-py-vscode/pull/170) — see the
Phase 8 row in the index table below for the up-to-date account.)

**8c (CAS tables in the data viewer) is code-complete 2026-09-13** — a fresh
probe pass at 8c's own start (Findings 8.11–8.13) found a CAS table's row
data lives at the end of a `casManagement` → Data Tables API → `rowSets`
relation chain, not in `casManagement` itself, and needs no server-side view
of any kind for sort/filter (both travel as plain query parameters on every
request, together, with `count` staying populated regardless — materially
simpler than `LibraryAdapter`'s own view-creation dance). Reusing the
existing data-viewer webview for a second backend was a real architecture
decision, made with Sean before any code: `DataViewerPanelManager`/
`OpenTablePanel` (`src/data/dataViewerPanel.ts`) are now generalized behind a
small `TableSource` interface (`src/data/tableSource.ts`) rather than forking
a second panel or forcing CAS through Library's view machinery —
`src/data/librarySource.ts`'s `LibraryTableSource` carries every bit of that
view-creation complexity now, unchanged in behaviour, and
`src/cas/casTableSource.ts`'s `CasTableSource` is a thin, direct pass-through
with none of it, since Finding 8.12 found none is needed. `CasAdapter`
gained `openTable`/`getRows`; a table node's click/context-menu command,
`pythonOnViya.openCasTable`, opens the same shared panel manager instance the
"SAS Libraries" tree's own `openTable` already uses. `npm run coverage`
green (1675 unit; coverage 95.91/95.46/95.75/95.91 — no ratchet change
needed), 403 integration passing (8 of them new, `cas-data-viewer.test.ts`),
`npm run check:docs` green (regenerated `docs/reference/commands.md`).
**Adversarial self-review run before this PR opens, 2026-09-13 — no
blocking findings.** Two non-actionable observations: the density of
finding-citing doc comments on the new CAS types (a deliberate convention,
not flagged as excessive) and this file's own now-corrected "review not yet
run" note. See `phase-8.md`'s 8c Runbook entry for the full account,
including what is deliberately still open (CSV export for a CAS table;
whether the CAS-side ephemeral per-request sessions Finding 8.13 observed are
ever cleaned up automatically).

**Phase 9 (Notebooks) is in progress.** 9a (dependency spike + controller
registration) is done, merged 2026-09-14 as [PR #172](https://github.com/Shai-Alit/sas-py-vscode/pull/172),
squash `6884e49` — a hands-on spike confirmed `.ipynb` opens as a notebook
and a `NotebookController` contributing no serializer is selectable as its
kernel with **zero** other extensions installed, so
[ADR-0024](adr/0024-notebooks-are-ipynb-native.md) needs no amendment.
**9b (controller + execution) is code-complete 2026-09-14, including a
same-day architecture correction (ADR-0035) found by the manual pass before
any of this was pushed.** Real execution:
`src/notebook/notebookController.ts`'s `createNotebookExecutionHandlers`
wires `executeHandler` to `ExecutionBackend.execute()` with
`freshNamespace: false` and `interruptHandler` to `cancel()` (Finding
75/76's caveats apply the same way they do to Run File's own Cancel).
Decided this slice, not left implicit: the kernel picker alone is a
notebook's run-target equivalent — no separate status-bar toggle needed
(ADR-0011/0020's own concept does not extend to notebooks); and cell output
renders `text/plain` live as it streams, with `text/html`/`image/png` given
an honest "not rendered yet" placeholder and 9c left to build the real
renderer (full reasoning in `notebookController.ts`'s own doc comment).
**The manual pass (§9.8/§9.9) found the first cut's session sharing was
destructive, not merely incomplete**: `src/run/backendCache.ts` (lifted out
of `commands.ts`'s private closure, a straight move) was first handed to
*both* Run File and the notebook controller as one shared instance — but
`PROC PYTHON` has exactly one interpreter namespace per compute session, so
Run File's own `freshNamespace: true` (every whole-file run, unchanged
since Phase 3) silently wiped the notebook's variables the instant both
were used against the same profile. Fixed same day by
[ADR-0035](adr/0035-notebook-gets-its-own-compute-session.md): the
notebook controller now gets its own `ComputeSessionManager`, its own
`purpose`-namespaced `SessionBindingStore` (`binding.ts`'s
`sessionBindingKey` gained an optional `purpose` parameter — `undefined`
for Run File's own binding, so every existing install's binding keeps
reattaching unchanged), and its own `BackendCache`; `extension.ts` now
builds two of each instead of one shared pair. `Disconnect`/Sign Out end
both sessions; `Connect` and the status bar stay scoped to Run File's
session only. `backendCache.ts` itself needed no change — it was already
just a cache keyed on `connection.profileId`. A related, smaller fix from
the same pass (§9.8): a cell run right after an interrupted one can sit
with no output for as long as the interrupted statement takes to actually
finish server-side (Finding 76); `notebookController.ts` now shows an
honest, cause-agnostic "still no output" notice after 3 seconds rather than
silence — real tracking for a precise message was considered and carried
forward to `phase-11.md` instead, matching Phase 4c's own call on the
identical gap for Run File. `npm run coverage` green — 1685 unit tests (up
from 1675 at the original cut), coverage 95.94/95.48/95.81/95.94 (unchanged
throughout — `.c8rc.json`'s 95.8/95.8/95.6/95.4 floor cleared with room);
`backendCache.ts` turned out **not** to need a `.c8rc.json` exclusion (it
imports `vscode` only for types, so the unit tier can reach it —
`test/unit/run-backend-cache.test.ts` covers it directly at 99.4% lines,
reusing `test/helpers/recorded-connection.ts`). `npm run test:integration`
green — 411 passing (up from 406 at 9a): `execution.test.ts`'s five cases
(streamed success, busy refusal, the two waiting-notice cases, interrupt-
then-recover), driven against a **fake** `NotebookController`/
`NotebookCellExecution` rather than a real one (a real one refuses
`createNotebookCellExecution` unless VS Code's own kernel picker already
selected it — state that test has no reason to fight, since both are plain
structural interfaces in `@types/vscode`, not classes). `controller.test.ts`'s
9a regression still passes, lightened to assert a terminal
`executionSummary` is reached rather than the now-superseded placeholder
message. Full account in `phase-9.md`'s 9b Runbook entry.
**§9.8/§9.9 need a fresh live re-run against the corrected code — left for
Sean.** **Adversarial self-review ran 2026-09-14 against the full diff
(ADR-0035 split included) — three findings, all verified independently and
folded into the branch before push:** a real wrong-target `interruptHandler`
bug (it cancelled whatever `currentRun` held regardless of which notebook
Interrupt was actually pressed on — fixed by having `currentRun` record its
own notebook and checking it); a fire-and-forget `appendOutput` with no
explanation, unlike every other swallowed promise in this codebase (fixed
with the same comment convention); and "Disconnect ends both sessions"
(ADR-0035) having no test, automated or manual — not reachable at the unit
or integration tier (`registerComputeCommands` needs a real extension host),
so recorded instead as a new, unchecked manual-test item (§9.11). `npm run
verify` and `npm run test:integration` both green after folding the fixes
in — same 1685 unit / 411 integration counts as before, since no tests were
added or removed. Full account in `phase-9.md`'s 9b Runbook entry.
**§9.8/§9.9/§9.11 then ran live (Sean, 2026-09-14) and all pass** —
`docs/dev/manual-tests/phase-9.md` updated in place. **PR #176's own AI
review then raised two findings, both fixed and folded in before push, same
day:** the wrong-target-interrupt fix (above) had no regression test
covering the actual two-notebook race it addresses — `execution.test.ts`
gained `"does not cancel a different notebook's in-flight cell"` to close
that gap; and this file and `phase-9.md` still carried 9b's original-cut
counts (1685 unit / 411 integration) after the branch had since merged
`main`, while the PR description already carried the post-merge figures —
reconciled here to what a fresh `npm run verify`/`test:integration` on the
branch actually produces: **1693 unit tests**, coverage
**95.95/95.48/95.83/95.95**; **419 integration** passing (418 post-merge,
+1 for the new regression case).

**9c (renderers + diagnostics) is code-complete 2026-09-14, adversarial
review folded in, not yet pushed — pending a live manual test pass and a
fresh `npm run test:integration`, neither of which could run this session.**
It needed less than the punch list assumed — no renderer script at all. The
open question 9b's own doc comment left standing (whether VS Code core's
built-in renderers show `text/html`/`image/png` with no `ms-toolsai.jupyter`
installed) was spiked, not guessed at: the installed VS Code's own bundled
`notebook-renderers` extension (publisher `vscode`) already renders both,
`requiresMessaging: "never"`, with `controller.test.ts`'s existing
`--disable-extensions` run as continuous proof it needs no Jupyter
extension — the same evidentiary bar 9a's own `ipynb` spike set. Since this
project's own `RichOutput` union already uses those standard mimes, there
was nothing for upstream's `LogRenderer.ts`/`HTMLRenderer.ts`-shaped script
to do; `src/notebook/notebookRender.ts` (new, pure, mirroring `render.ts`/
`resultPanelModel.ts`'s own "decide what, not how" split) plus
`notebookController.ts`'s `appendRichOutput` build the real
`vscode.NotebookCellOutputItem`s directly. `RunDiagnostics` also now applies
to a raised cell — confirmed by a real test that `tracebackDiagnostics.ts`'s
position maths needs no change for a `vscode-notebook-cell:` URI — via this
module's own `DiagnosticCollection`, not Run File's; a stale Problems entry
outliving a sign-out is a deliberate, recorded gap (carried to
`phase-11.md`), the same "disproportionate" call Phase 4c made for a
comparably narrow Run File gap — the closed-notebook half of that gap turned
out worse than "stale" and is fixed, not carried, below.

**Adversarial self-review ran 2026-09-14, before any of this was pushed —
ten findings, one blocking, all verified independently and folded into the
branch.** The blocking one (Finding 1, security): `text/html` output reached
VS Code's own built-in notebook renderer as real, unsanitized markup, which
executes an embedded `<script>` — contradicting
[ADR-0021](adr/0021-result-panel-webview.md)'s own load-bearing "a
`<script>` in `text/html` output must stay inert" decision, and worse than
the result-panel case it contradicts because a notebook's outputs persist
into the `.ipynb` and re-execute on reopen with no Viya round trip. **Sean's
call: sanitize the markup, not build a second CSP-locked renderer or accept
the risk.** `src/notebook/htmlSanitize.ts` (new, pure, no dependency added —
ADR-0005's "first runtime dependency" trigger still hasn't fired) is an
allow-list tokenizer/re-serializer, recorded in
[ADR-0036](adr/0036-notebook-html-output-is-sanitized.md) and
cross-referenced from ADR-0021. The other nine: a closed notebook's stale
Problems entries could misattribute to the wrong cell after a reopen (fixed,
not deferred — `handleNotebookClosed`); Run File's and the notebook's own
`RunDiagnostics` collided on the same collection name (fixed, an optional
`name` on `RunDiagnosticsDeps`); six integration tests leaked a
`DiagnosticCollection` each (fixed); the one diagnostics test never actually
asserted the published position (fixed, plus a "no frame maps" case); §9.12's
repro could not produce a `text/html` output at all (fixed, reworded to
`to_html(...)`); `diagnostics.ts`'s own doc comment under-named its callers
(fixed); image output carried no alt text (fixed, parity with the result
panel's own `labels.imageAlt`); the l10n bundle looked stale in the
reviewing session's own working copy, but is gitignored/generated, not a
branch issue (nothing to fix); and a pre-existing 9b gap (a rejected
`appendOutput` mid-stream skips `execution.end`) is noted, carried to
`phase-11.md`, not fixed here. Full account, finding by finding, in
`phase-9.md`'s 9c Runbook entry.

`npm run verify` green — **1749 unit tests** (up from 1725), coverage
**96.03/95.51/95.9/96.03** (statements/branches/functions/lines,
`.c8rc.json`'s floor cleared with room). `npm run test:integration` **ran
green 2026-09-14 — 433 passing** (up from 419 at 9b's post-merge
reconciliation). The prior session's "could not run" note was a
misdiagnosis: `Code.exe: bad option: --disable-extensions` is the same
`ELECTRON_RUN_AS_NODE`-leak already documented in `phase-5.md`'s 5d-iii
Runbook entry, not an environment limitation — a shell spawned inside the
VS Code extension host inherits `ELECTRON_RUN_AS_NODE=1` and other
`VSCODE_*` vars, so `@vscode/test-electron` launches the downloaded
`Code.exe` as bare Node; stripping those vars for the one command (5d-iii's
own workaround) ran the real Electron host and all 433 cases passed,
`execution.test.ts`'s three net-new cases and two enhanced ones included.
Manual test items §9.10 (reworded to test real image rendering, reset to
unchecked since the placeholder it used to test is gone), §9.12 (Finding 6's
fix), §9.13 (Finding 2's close/reopen step), and new §9.14 (the sanitizer's
real-renderer behaviour) **all ran live (Sean, 2026-09-14) and pass** —
`docs/dev/manual-tests/phase-9.md` updated in place.

**[PR #177](https://github.com/Shai-Alit/sas-py-vscode/pull/177)'s own AI
review then raised three findings against `htmlSanitize.ts` — two blocking,
one non-blocking, all real — fixed and folded in before push, 2026-09-15.**
Each was reproduced against the compiled sanitizer before fixing, not taken
on faith: a malformed-but-spec-valid raw-text close tag (`</style/>`) walked
past `findRawTextEnd`'s bare-`</style>`-only match and let a live `<script>`
after it re-emit verbatim; and a backslash-escaped `url(`/`javascript:`
(`\75\72\6c(` decodes to `url(`) slipped past `CSS_DANGER`'s literal
substring check in both a `style=` attribute and a `<style>` block. Fixed:
`findRawTextEnd` now matches the spec's full terminator set and reuses
`findTagEnd`'s quote-aware scan for the real closing `>`; `isDangerousCss`
now rejects any backslash at all rather than decoding CSS escapes to
check after them. `npm run verify` green — **1752 unit tests** (up from
1749), coverage **96.04/95.51/95.9/96.04**; `npm run test:integration`
unchanged at 433 passing (unit-tier fixes only).

**A follow-up review on that same push found a fourth bypass the backslash
fix didn't close**: `isDangerousCss` checks a `style` attribute's *raw*
source text, but a real HTML parser entity-decodes an attribute value on
the way into the DOM — a separate decoding step from the CSS-escape one
already covered. `style="background:&#x75;&#x72;&#x6c;&#40;https://
evil.example/x&#41;"` has no literal `url(` and no backslash, so it passed
unchanged — reproduced before fixing. Fixed the same way: any `&` at all in
a style value or block is now dangerous too. `npm run verify` green —
**1753 unit tests**, coverage unchanged; `npm run test:integration`
unchanged at 433 passing. Replied to and resolved all four review threads
on PR #177. Full account, including the reproduction and fix for each
finding, in `phase-9.md`'s 9c Runbook entry.

**9c is fully verified and merged.** Final merge: 9c as
[PR #177](https://github.com/Shai-Alit/sas-py-vscode/pull/177), squash
`fa7222f`, merged 2026-09-15.

**9d (export) scoped 2026-09-15, at the start of the Phase 9→10 housekeeping
session — decided: dropped outright, no code written.** Every export use
case upstream's own `toSAS.ts`/`toHTML.ts`/`saveOutput` cover is already
served here with zero extension code, for two independent reasons: a
`.ipynb` this extension writes is already a real, portable Jupyter notebook
(ADR-0024) that any ipynb-aware tool can open, diff, or convert with no
knowledge of this extension at all; and VS Code itself already covers both
halves of what upstream's exporters do — the installed VS Code's own bundled
`ipynb` extension (publisher `vscode`, `resources/app/extensions/ipynb/
package.json`, read directly) contributes `notebook.cellOutput.copy`/
`notebook.cellOutput.openInTextEditor` for any cell's output on any
notebook, and whole-notebook Export (HTML/PDF/py) is `ms-toolsai.jupyter`'s
own feature, backed by `nbconvert` (confirmed by web search against VS
Code's own Jupyter-notebooks doc page and the `vscode-jupyter` wiki's Import
Export page, not assumed) — building an equivalent ourselves would mean
taking on exactly the local-Python/`nbconvert` dependency this project has
never required and 9a already declined for execution, to duplicate
something that already works for free the moment `ms-toolsai.jupyter` is
installed, and does nothing for someone without it that a plain `jupyter
nbconvert` from any terminal doesn't already do identically. No ADR
amendment needed — this is the payoff ADR-0024 already named for going
ipynb-native, not a new decision. Full reasoning in `phase-9.md`'s 9d
Runbook entry. **Phase 9 (9a–9d) is now fully complete.**

**Phase 10 (Viya environment awareness) is fully complete — 10a and 10b
both merged, 2026-09-15 and 2026-09-16.** Those two slices were the whole
phase. 10b (Pylance stub reflection) landed as
[PR #182](https://github.com/Shai-Alit/sas-py-vscode/pull/182), squash
`2842722`, fully manually tested beforehand (all of 10.1–10.14 green). 10a
(`docs/phases/phase-10.md`) adds a
local/remote package diff to the existing `Show environment` document (a
new "Local comparison" section, reading the local interpreter
`ms-python.python` has active via `@vscode/python-extension` and
`vscode.workspace.fs`, never `node:fs`) and a new filterable `Python on
Viya: Search environment` `QuickPick`, additive to the existing plain-text
document. Local/remote package names are matched PEP 503-normalised so a
capitalisation difference alone is never reported as a false mismatch.
`npm run verify`'s full chain and `npm run test:integration` both green
throughout (see `phase-10.md`'s own "10a verification" Runbook entry for
numbers). **The pre-push adversarial self-review and two rounds of PR
review together found and fixed four real defects**, all in
`src/run/localPythonEnvironment.ts`: an unguarded
`getActiveEnvironmentPath`/`resolveEnvironment` pair that could propagate a
local-Python-extension error and blank the whole `Show environment`
document instead of degrading only the new "Local comparison" section;
trusting `ResolvedEnvironment`'s declared type over its real runtime shape
(`sysPrefix`/`version.major`/`version.minor` can come back empty/undefined
despite the type, a documented vscode-python defect,
[microsoft/vscode-python#20147](https://github.com/microsoft/vscode-python/issues/20147)),
which would have silently reported every remote package as "remote-only";
an unguarded bare `process.platform` read that could do the same
document-blanking under a hypothetical web extension host; and an unused
`version` field on `LocalEnvironment`'s `known` arm, dropped. Full account
in `phase-10.md`'s Runbook. Manual-test items 10.1–10.5
(`docs/dev/manual-tests/phase-10.md`) all passed (Sean, 2026-09-15). **Final
merge: 10a as [PR #178](https://github.com/Shai-Alit/sas-py-vscode/pull/178),
squash `62cf217`.** `npm run verify` green throughout (1771 unit; coverage
96.09/95.57/95.98/96.09); `npm run test:integration` green (436 passing).
**10b (Pylance environment reflection) is implemented and locally
verified, not yet reviewed, manually tested, or opened as a PR.** Its own
first task — the hands-on stub-path spike the Runbook named as needing an
interactive session — ran this session via the `pyright` CLI (the
open-source engine Pylance is built on) rather than a live VS Code window,
since even Claude Code running directly on the developer's machine has no
tool that can drive VS Code's UI or read its Problems panel; see
`phase-10.md`'s "10b spike" Runbook entry. The spike settled both of its own
questions (a `stubPath` change needs a window reload; a reload is always
needed, not only sometimes) and surfaced one more, unplanned finding before
any stub-generation code was written: a generated stub takes precedence over
a same-named package that already resolves locally with real source,
silently disabling real type-checking for it (Finding 10.2) — so stub
generation is scoped to 10a's `remoteOnly` diff bucket, never every remote
package as the Plan section originally described. A second design point (the
existing Stage-2 probe only reports the PyPI *distribution* name, not the
*import* name Pylance actually needs — `Pillow`/`PIL`, `beautifulsoup4`/`bs4`,
and others) was raised to the developer before any code was written and
decided: extend the probe's payload, not ship a feature that silently
under-covers common packages. New: `src/run/stubGenerator.ts`,
`src/run/stubPathSetting.ts` (pure, 100% unit-covered), and
`src/run/pylanceStubSync.ts` (the `vscode`-importing shell — generated stubs
live at their own `.pythonOnViya/typings/`, never the conventional bare
`typings/`, and `python.analysis.stubPath` is written via
`vscode.workspace.getConfiguration(...).update(...)` — the sanctioned API,
simpler and safer than the hand-rolled JSON merge the Runbook originally
planned — only when nothing already claims that setting at workspace scope).
`npm run verify`'s full chain and `npm run test:integration` both green (see
`phase-10.md`'s "10b verification" Runbook entry for numbers). Manual-test
items 10.6–10.11 (`docs/dev/manual-tests/phase-10.md`) are written but not
yet run — they need a real VS Code+Pylance window, which this session cannot
open. **The pre-push adversarial self-review has now run and found four real,
blocking defects, all fixed on this branch** — Finding 10.2's shadowing
mitigation was only half the hazard (a generated stub could still shadow the
user's own workspace source, not just an installed local package); the reload
notice nagged on every unchanged refresh; `Search Environment` silently wrote
to the workspace with no signal to the user; and three bare `catch {}` blocks
discarded the real cause of a write failure, one of which could silently skip
pruning a stale, shadowing stub. Full account, including the review's
non-blocking items folded in and the ones left open for the developer to
decide, in `phase-10.md`'s own "Adversarial self-review, 2026-09-15" Runbook
entry. The four discussed-not-decided items from that pass were resolved with
the developer the same day: `workspaceFolderValue` initially settled with no
code change (it only diverges from `workspaceValue` in a real multi-root
workspace, out of scope today, carried to `phase-11.md`) — **superseded
2026-09-16**, when a PR #182 review round found the gap was broader than
multi-root (a `stubPath` set at user/global scope was missed even in the
ordinary single-folder case); fixed in `c81f9d5`, and `phase-11.md`'s own
carried-item entry now records it closed; local-unknown
stubbing every remote package kept as-is; a `pythonOnViya.*` opt-out setting
deferred to `phase-11.md`; and a "Reload Window" action button built onto the
reload notice. **The developer then ran their own independent adversarial
pass against the full branch** (`git diff main`, plus the allowed static
gates run by hand) and found two more real findings: `commands.ts`'s own 10b
wiring had a real injection seam nothing used, so the `changed`-based no-nag
fix above was itself untested at the wiring level — fixed with a new
purpose-built probe fixture (`test/helpers/recorded-probe-connection.ts`) and
five new integration tests; and unsanitised Viya-sourced `name`/`version`
strings could escape a generated stub's `#` comment via a newline — fixed
(`stubGenerator.ts`'s new `sanitiseForComment`). Full account in
`phase-10.md`'s Runbook. `npm run verify`'s full chain (1813 unit; coverage
96.17/95.63/96.05/96.17), `npm run test:integration` (443 passing), and
`npm run check:secrets` (502 files — this session also caught its own gap:
`check:secrets` reads `git ls-files`, so new files went unscanned until
staged) all green after every fix above.

**Manual-test pass (items 10.6–10.14), run 2026-09-15 (Sean, real VS
Code+Pylance window) — 8 of 9 passed; §10.8 is open, and a separate design
objection came out of the same session.** 10.6, 10.7, 10.9–10.14 all passed
(`docs/dev/manual-tests/phase-10.md` has the per-item detail, including a
first-attempt false start on §10.8 with `saspy` — discarded once traced to a
stub already on disk from an earlier test today, unrelated to the feature's
own sync — and a first-attempt failure on §10.9 with nothing logged, not
reproduced on retry, cause not established). **§10.8 itself failed and is
still open**: against `babel` (confirmed never previously stubbed), a fresh
probe correctly left the `reportMissingImports` diagnostic unchanged before
any reload — but after accepting the "reload the window" notice and
completing a real reload, the diagnostic still did not clear or downgrade.
Root cause not investigated, at the developer's own direction. Recorded as
**Finding 10.3** (`phase-10.md`'s Probe findings section — open, not
resolved) and in the Runbook's "Manual test session, 2026-09-15" entry.
**Separately, the developer has flagged the reload-required design itself as
unacceptable, independent of whether §10.8 is a distinct bug**: a ~60–90
second full extension-host restart — every extension restarting, the current
Viya connection dropped and needing a manual reconnect — every time a
refresh changes the remote-only package set, in exchange for a bare,
attribute-less catch-all stub, is judged too costly as currently built. Full
account, including candidate directions not yet evaluated, in the same
Runbook entry. **The reload-design objection has since been acted on:** a
"Restart Language Server" action is now offered alongside "Reload Window" on
every stub-changing refresh (`src/run/commands.ts`'s new `offerReloadRemedy`),
matching Pylance's own troubleshooting docs' recommendation for a
`python.analysis.*` change — it restarts only the language-server process,
not the whole extension host, so it has no structural reason to touch this
project's own Viya connection or any other extension. The button is only
offered when `python.analysis.restartLanguageServer` is actually registered
(checked live via `vscode.commands.getCommands()`), and a registered-but-
failing restart is caught and falls back to offering the reload, never a
silent dead end. The real command id was confirmed against a live installed
`ms-python.python` 2026.4.0, not assumed from a bug report — **Finding 10.4**
(`phase-10.md`). `npm run verify`'s full chain green (1813 unit tests,
coverage unchanged at 96.17/95.63/96.05/96.17 — `src/run/commands.ts` stays
outside the coverage tier, same as before this change). Full account in
`phase-10.md`'s Runbook, "Design change implemented, 2026-09-15" entry.
**The pre-push adversarial self-review of this design change has now run
and found two small, non-blocking issues, both fixed**: an unhandled-
rejection gap on `offerReloadRemedy`'s call site, and two dev-machine
artefacts (`.vscode/settings.json` residue; `.pythonOnViya/` untracked
because this repo's own `.gitignore` didn't exclude it, unlike what
`docs/python-environment.md` tells users to do for theirs) — full account in
`phase-10.md`'s Runbook, "Pre-push adversarial self-review of the design
change, 2026-09-15" entry. **§10.8 re-tested live against this change,
2026-09-15 — passed.** Against `requests` (confirmed never previously
stubbed): uninstalling it locally produced `reportMissingImports`; a fresh
probe correctly left that unchanged; clicking **Restart Language Server**
(~5–10 seconds, no dropped Viya connection) downgraded it to
`reportMissingModuleSource` as expected. Recorded as **Finding 10.5**
(`phase-10.md`) — which directly contradicts Finding 10.3's own `babel`
result under a full reload alone, a discrepancy neither finding explains.
**The developer's own call: Finding 10.3's `babel` result is set aside as a
likely mistake in how that attempt was run, not a reproduced defect** — left
in place verbatim as the historical record, no longer treated as blocking.
§10.8 is marked passed on Finding 10.5's strength. **The full manual-test
board for Phase 10 (items 10.1–10.14) is now all green.** **10b merged as
[PR #182](https://github.com/Shai-Alit/sas-py-vscode/pull/182)**, squash
`2842722`, 2026-09-16.

**Deep-dive pass on the open 10b branch, 2026-09-16 — the guard that was
missing.** After several reviewer round trips on #182 that kept surfacing
further issues, this pass went after the class of defect rather than the
individual findings, and the organising question turned out to be one none of
the earlier rounds had asked: pyright resolves `python.analysis.stubPath`
**ahead of every other import source**, so what can a generated stub actually
shadow? Three things — installed local packages, the workspace's own source,
and Pylance's own bundled typeshed. 10b guarded the first two. The third was
unguarded and is the only one whose failure is **silent**, which is why it
survived four prior reviews: a generated stub for a standard-library name
(`typing`, `dataclasses` and `contextvars` all exist as real PyPI backports)
switches off real type checking for that module workspace-wide, measured as
1 error to 0 against pyright 1.1.414, and a stub for a typeshed-covered
third-party name is a pure regression — Pylance already emits the
`reportMissingModuleSource` warning this whole feature exists to produce, and
supplies real types alongside it. Recorded as **Finding 10.7**
(`phase-10.md`). Fixed with a new pure module, `src/run/typeshedNames.ts`
(554 case-folded top-level names generated from pyright 1.1.414's bundled
typeshed), applied as one more exclusion in `generateStubTree`. Three smaller
fixes rode along: `writeStubTree` now returns `{ changed, wrote }` so
`stubPath` is never pointed at a directory that was never created;
`EnvironmentStore` now validates entries read back out of `globalState`,
dropping (not defaulting) any written before 10b made `PythonPackage.importNames`
required; and `__pycache__` — which really does appear in shipped
`top_level.txt` data — is no longer stubbed. The live probe that closed the
`MAX_ENVIRONMENT_PROBE_BYTES` question left open at the end of the previous
session is **Finding 10.6**: 11,049 bytes for 264 distributions, **1.05% of
the 1 MiB cap**, so the widened payload does not warrant revisiting it. Full
account, including what the probe did *not* settle and the one deferred
follow-up (runtime enumeration of Pylance's typeshed, an architecture change
not taken unilaterally), in `phase-10.md`'s "Deep-dive pass before the
adversarial review" Runbook entry. Verified once, whole branch:
`npm run verify` green end to end (**1,814** unit tests; coverage
**96.3/95.68/96.08/96.3**; `src/run` at 100% branch coverage;
`check:secrets` 502 files), `npm run test:integration` green (**454
passing**). Those are against freshly re-measured clean baselines of
**1,796 unit / 453 integration** — note that earlier Phase 10 entries'
`1813 unit; 443 integration` figures were taken with stale compiled tests
still sitting in a local `out/` and are somewhat too high; `phase-10.md`'s
Runbook entry explains the trap and how to avoid repeating it. The branch
adds source and changes a documented invariant, so it went to the
developer's independent adversarial pass **before** the push, per the
working agreement. That pass returned **no blocking findings**; its one
low-severity observation (`topLevelSegment`'s namespace-package truncation)
was verified as documented, deliberate behaviour rather than a defect.
Merged as squash `2842722`, 2026-09-16 — one commit, one push, one CI and
reviewer cycle.

---

**Phase 11 (Remaining parity gaps), 11a–11e, 2026-09-17 through
2026-09-21.** A 2026-09-16/17 scoping session sized five slices in priority
order (`docs/phases/phase-11.md`'s Plan section): **11a — the interactive
window (F7)**, merged 2026-09-17 as
[PR #192](https://github.com/Shai-Alit/sas-py-vscode/pull/192) — a bespoke,
this-project-owned scratch-notebook surface built entirely on Phase 9's
already-shipped `NotebookController` infrastructure, not VS Code's real
Interactive Window (off-limits to a published extension regardless of the
kernel question — see `phase-11.md`'s F7 write-up). `npm run verify` green
(1,814 unit tests; coverage 96.3/95.68/96.08/96.3), `npm run test:integration`
green (457 passing); manual-test items 11.1–11.5 all pass. **11b — the
CAS/SWAT SQL passthrough helper (F9)**, shipped 2026-09-17 alongside its own
`viya-api-probe` confirmation (Finding 11.2, against a real Snowflake-backed
caslib on `verde`) that predated the slice itself — documentation
(`docs/cas-python-connection.md`'s new "Running native SQL against an
external database" section) plus a small, fully static
`pythonOnViya.insertCasSqlPassthroughSnippet` command, needing no network
round trip unlike 8b's own connection command. `npm run verify` green (1,816
unit tests; coverage 96.31/95.68/96.08/96.31), `npm run test:integration`
green (460 passing). **A pre-push adversarial review (code-review skill,
high effort) caught that the snippet's/docs' `result["Result Set"]` claim
was never actually probed — Finding 11.2 only exercised raw `PROC CAS`,
never `swat` — so a follow-up probe ran against `verde` 2026-09-18 (Finding
11.4) and confirmed the key is real (positive + negative control via `PROC
CAS`, reasoned to generalize to `swat` since CAS result-member names are
server-side); no code/doc change was needed, the claim as written was
correct. The Finding 11.4 write-up landed as its own commit, `f2c0270`, on
`feat/cas-sql-passthrough-snippet`. **Manual-test items 11.6–11.7 then ran
and passed, 2026-09-18**, and that pass surfaced one usability fix: the
snippet's `query=` value now wraps in triple quotes (`'''...'''`) instead of
a single pair of double quotes, so the user-filled native-query tabstop can
carry the target database's own quoting (Snowflake's double-quoted
identifiers, a `where` clause's single-quoted string literals) without
having to escape anything — see `phase-11.md`'s own "11b manual-test pass
and a triple-quote fix" Runbook entry. Committed as `d1051f4`, alongside a
pre-push adversarial review's two findings (Finding 11.4 reordered into
numeric order; this file's own wording corrected), and pushed to
`feat/cas-sql-passthrough-snippet`. **Final `npm run verify` (1,816 unit
tests; coverage 96.31/95.68/96.08/96.31) and `npm run check:docs` both
re-ran green 2026-09-18** against the pushed branch, and
[PR #194](https://github.com/Shai-Alit/sas-py-vscode/pull/194) merged for
these two follow-up commits. **11c — the three pre-release bugs
(B1/B2/B3)** is code-complete 2026-09-18: B1 (blank trees on a failed
listing) is a new `ConnectionProblemNode` (`src/connectionProblemNode.ts`)
each of the three browsing trees' `getChildren` now returns instead of `[]`;
B2 (a stale SAS Libraries connection had no way back except **Disconnect**)
is `SasLibraryTreeProvider` and (extended mid-session, Sean's own live
report of the same gap in `Insert CAS Connection Snippet`)
`casConnectCommand.ts` both now calling `forgetProfile` on a `session-gone`
reading, so **Connect to Viya** re-syncs into the palette immediately; B3
(SAS Libraries table icon) now matches CAS's loaded-table icon. B1 and B2
turned out not to share one mechanism — CAS/SAS Content have no "connected"
concept of their own (ADR-0033), SAS Libraries does — see `phase-11.md`'s
own 11c Runbook entry for the full design account. A new
`test/integration/data/tree.test.ts` was added (`dataTree.ts` had no test
file at all before this slice); `test/integration/cas/tree.test.ts`,
`test/integration/content/tree.test.ts`, and
`test/integration/cas/connect-command.test.ts` all gained assertions for
the new behaviour. `npm run verify` green (1,816 unit tests; coverage
96.31/95.68/96.08/96.31), `npm run test:integration` green (465 passing),
`npm run check:docs` green. Manual-test items 11.8–11.14 added to
`docs/dev/manual-tests/phase-11.md`. **The manual pass ran 2026-09-18 and
all items passed.** Item 11.12 surfaced one design note: both insert-snippet
commands vanished from the palette when the session was stale, because
`enablement: pythonOnViya.connected` hid them. Resolved in this slice by
removing that enablement from both commands and having each report "Connect
to SAS Viya first, then run this command again." instead
(`insertCasSqlPassthroughSnippet` gained `sessions`/`profiles` params to do
so). **The pre-PR adversarial review has run twice (2026-09-18)** — once on
the original 11c diff, once on the 11.12 follow-up, whose one finding (an
`as never` cast in the new test) was folded in. `npm run verify` green after
the fold-in (1,816 unit tests; coverage 96.31/95.68/96.08/96.31); the
integration suite and `check:docs` were green before the final test-only
fix. [PR #195](https://github.com/Shai-Alit/sas-py-vscode/pull/195) is open; its one
review finding (no automated regression test for the drag-and-drop
`ConnectionProblemNode` exclusion) was folded in as integration tests in
`test/integration/data/drag-and-drop.test.ts` and
`test/integration/content/dragAndDrop.test.ts`. **11d (CAS table properties + CSV export, F2/F3) merged
2026-09-20 as [PR #197](https://github.com/Shai-Alit/sas-py-vscode/pull/197)
after a pre-PR adversarial review (no blocking findings) and a manual pass
(11.15-11.22, all passing):** two new commands on the
CAS table node, built by generalising the existing properties panel and CSV
command behind a per-backend source rather than forking them; the CAS export
formats CSV client-side because CAS's own `text/csv` pads numerics
(Finding 11.5), and asks for confirmation above an estimated 100 MB (Finding
11.6 found no server-side row cap). The same confirmation for SAS library
tables is a recorded follow-up, alongside a dedicated CAS problem for an
oversized response and an opt-in CSV formula-injection guard (all three on
the phase's punch list). `npm run test:integration` green (489 passing).
**11e (session startup: profile `sasOptions` + `autoExec`) merged
2026-09-21 as [PR #199](https://github.com/Shai-Alit/sas-py-vscode/pull/199),
squash `e256d25`:** scoped with Sean to
SAS-side startup only (a Python startup snippet is a recorded, unbuilt
candidate). A `viya-api-probe` pass (Finding 11.7) found that the compute
service silently ignores `NAME=VALUE` options — so 3f's `PAGESIZE=MAX` had
never been applied; now `PAGESIZE MAX`, with profile options formatted the same
way — and that a bad autoExec line leaves the session `idle` with
`sessionConditionCode` 3000, which now raises a message. `npm run verify` green
(1,856 unit tests; coverage 96.38/95.85/96.16/96.38), `npm run
test:integration` green (495 passing), `npm run check:docs` green. The pre-PR
adversarial review found no blocking issue; its one gap (no test for **Edit
Connection Profile** carrying `sasOptions`/`autoExec` over) is folded in.
A second review after manual testing (Finding 11.8: a `pending` create
reports condition code 0, so the autoExec warning is now raised from a
re-read of the settled session) found six issues, all folded in. **Manual-test
items 11.23–11.28 all pass (2026-09-21).** PR #199's own review, after it was
open, raised four more comments (Finding 11.9 — the duplicate-option-wins
claim, probed rather than softened; an `l10n.t()` gap; a CodeQL
backtracking-regex flag; and a documented, deliberate non-fix for a
`NAME =VALUE` typo form) — all replied to, resolved, and folded in
(`cd5b267`, `9d787e1`) before merge.

**AI-agent integration work moved to a new Phase 12, 2026-09-22, and Phase
12 gates v1.0.** Briefly scoped into Phase 11 as 11f/11g the same day (ship an
Agent Skill; spike an in-process MCP server reachable by Claude Code), plus a
third slice (11h) to investigate the separate Python-startup-snippet
follow-up. All three, plus the 11d CSV-guard follow-up (which turned out to
need the same kind of investigation), moved together into **Phase 12** as
12a–12d — see [ADR-0037](adr/0037-ai-agent-integration-approach.md) and
`docs/phases/phase-12.md`. The previous "Phase 12" (second execution backend,
never started) was renumbered to **Phase 13** the same day to make room —
see `docs/phases/phase-13.md`. `PRODUCTION_PLAN.md` §8 is amended: Phase 12
is now a v1.0 gate, Phase 13 explicitly is not, matching the phase this note
used to describe.

**Phase 11's own remaining scope, after that move, was first recorded as
three decided-to-build follow-ups** (11d large-table confirmation for SAS
library tables, 11d `CasProblem` for an oversized response, 11e
autoExec-error text), with the note "once those land, Phase 11 is done."
**Superseded the same day, at the Phase 11→12 housekeeping checkpoint**:
Sean's call there was to close the phase now. A first pass at that
checkpoint framed the three as "carried forward as documented open items,"
on the model of Phase 8a's own open items — corrected within the same
session once that comparison didn't hold (Phase 8a's items are each blocked
on something external; these three had no blocker, just no slice). **The
three are folded into Phase 12 as a new slice, 12e**, instead — see
`phase-11.md`'s own "Phase 11→12 housekeeping" Runbook entry and
`phase-12.md`'s own "12e added" Runbook entry for the full account.

Full plan, punch list, and probe findings (11.1–11.9) are in
`docs/phases/phase-11.md`. **Note**: 11a's own completion was missed from
`STATUS.md` at the time it merged — a housekeeping gap, caught and
corrected only at the Phase 11→12 checkpoint, alongside 11b's own update,
rather than in 11a's own PR as `CLAUDE.md`'s own "STATUS.md is part of the
slice" rule calls for.
