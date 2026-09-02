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
GHSA-73RR-HH4G-FPGX, low, dev-only via mocha), expiring 2026-11-12 — no
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

**5d-ii (BOM fixture) implemented and reviewed 2026-09-02; not yet verified or
merged.** This is 5d's item 2, taken as its own PR per the 5d plan. New
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
editor path. Still open before a PR: `npm run verify` + `npm run check:docs`
(the proportionate chain for tests + one config file + four markdown files;
`test:integration` isn't reachable from this diff) — this session does not run
them.

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
| 3 — Run Python (vertical slice) | ✅ **done, 3a–3f** (3d-i [PR #63](https://github.com/Shai-Alit/sas-py-vscode/pull/63), 3d-ii [PR #65](https://github.com/Shai-Alit/sas-py-vscode/pull/65), 3e [PR #67](https://github.com/Shai-Alit/sas-py-vscode/pull/67), 3f [PR #77](https://github.com/Shai-Alit/sas-py-vscode/pull/77)) — Finding 74 deliberately deferred to Phase 4, not a blocker | `docs/phases/phase-3.md` |
| 4 — Diagnostics | ✅ **done, 4a–4d** (4a [PR #78](https://github.com/Shai-Alit/sas-py-vscode/pull/78); 4b probed and closed 2026-09-01, no code change, Findings 75–76 folded into 4c; 4c [PR #81](https://github.com/Shai-Alit/sas-py-vscode/pull/81); 4d [PR #83](https://github.com/Shai-Alit/sas-py-vscode/pull/83)) — Phase 4→5 between-phase housekeeping ran 2026-09-02 (`baacf3c`); see this file's own entry above | `docs/phases/phase-4.md` |
| 5 — Hardening & first release | **in progress** — 5d-i merged ([PR #88](https://github.com/Shai-Alit/sas-py-vscode/pull/88)); 5d-ii implemented, not yet merged; 5a–5c pending — see phase-5.md's own Plan/Runbook | `docs/phases/phase-5.md` |
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
