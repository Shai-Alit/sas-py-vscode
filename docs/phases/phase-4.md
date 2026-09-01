# Phase 4 — Diagnostics

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 4 — Diagnostics

**Relettered 2026-08-31, before any code was written.** The original plan
only ever named two slices here — "4a" (traceback parsing) and "4b"
(diagnostics surface). Phase 3's between-phase housekeeping (2026-08-27)
separately carried two more items into this phase's Runbook as bare,
unlettered checkboxes. When this phase's actual scoping session sequenced all
four together, it briefly called the carried-over pair "Slice 0"/"Slice 1" to
distinguish them from the plan's "4a"/"4b" — inventing a third, one-off
numbering scheme this project has never used elsewhere. Caught in review by
Sean: the project's own precedent (3f) is that a carried-over item which grows
into real, lettered-slice-sized work gets its own letter in the phase's normal
sequence, not a side-channel numbering. So: **4a and 4b are now the two
carried-over items, in the order they're done first; 4c and 4d are the
original plan's traceback parsing and diagnostics surface**, run after them
since 4d also consumes 4c's mapping function. Every place that referenced the
old "4a = traceback"/"4b = diagnostics" naming was swept in this same pass:
`docs/architecture/README.md`'s planned-pages entry now says "(4c)", and a
stale, orphaned "Phase 4" bash stub left behind in `docs/phases/phase-3.md`
from before the docs were split per-phase (it still had
`phase-4a-traceback-parsing`/`phase-4b-diagnostics` branch names) was removed
there rather than relettered, since this file's own Runbook below is the
actual source of truth now. That stub's siblings for Phase 5 and Phases 6–12
are still sitting in `phase-3.md` unswept — noticed, not fixed, since they're
outside what changed here; worth a follow-up sweep whenever Phase 5 starts.

**4a — Fake-transport regression test for `commands.ts`.** Test-infrastructure
only, no behavior change. *Small.*

**4b — Probe cancellation.** Live-Viya probe via the `viya-api-probe` skill.
*Small.*

**4c — Traceback parsing.** Parse the traceback, discard `<stdin>` harness
frames, map `<string>` frames through the offset map to editor positions.
Includes a triage pass on Finding 74. **Also now includes Findings 75/76 from
4b** — fixing `cancelJob()`'s missing `If-Match` (Finding 75) and revisiting
`cancelRun`'s messaging for a run/reset queued behind a still-executing
cancelled job, since a cancel cannot preempt a running statement either way
(Finding 76) — folded in here rather than a separate slice, decided with Sean
2026-09-01 right after 4b closed. *Medium*, raised from the original scope
for the same reason.

**4d — Diagnostics surface.** Publish `Diagnostic`s into the Problems panel
with correct squiggle positions; clear on re-run; wire the result panel's
existing frame data for click-to-jump-to-editor (ADR-0021 flagged this as
Phase 4's job); optional quick actions. *Medium* — raised from the original
*Small/medium* now that it serves two consumers instead of one.

*Exit:* a failing Python run puts an accurately-positioned error in Problems,
and clicking a frame in the result panel jumps to it in the editor.

---

## Runbook

_Scoped 2026-08-31, before any code was written — full technical grounding
(what already exists vs. what's greenfield) came from a codebase survey done
the same session; see each item below for what it found. Execution order is
4a → 4b → 4c → 4d, confirmed with Sean: closing 4a first means 4c/4d's new
`commands.ts` wiring gets real regression coverage from the start rather than
adding to the untested surface 4a is closing._

☑ **4a — A fake-transport regression test for `commands.ts`'s post-`connect()`
paths. Done 2026-08-31.** Raised by Claude Bot's review on PR #63, and the
same gap `commands.ts`'s own 3d-i Runbook entry in `phase-3.md` already named
before that review — every test in `test/integration/run/commands.test.ts`
uses `sessionsThatMustNotConnect()`, so that suite only ever exercised the
pre-`connect()` guards (readiness, the editor/selection checks,
`selectRunTarget`). New `test/integration/run/commands-backend.test.ts` pins
the three paths named here previously: `backendFor()`'s reconnect-orphan
close (a still-busy cached backend closed before being overwritten, when a
new `ComputeConnection` arrives for the same profile), `cancelRun`'s
`currentReset` fallback (interrupting an in-flight `reset()` via `close()`),
and the `backend.busy` serialisation guard in `runNow`/`resetPythonState`
(stopping a second invocation from clobbering `currentRun`/`currentReset` in
the shared `finally`). New `test/helpers/recorded-connection.ts` builds the
`RunCommandSessions.connect()` fake this needed — a real `ComputeConnection`
(real-enough `client`/`session`/`generation` fields per
`sessionManager.ts:123-146`) over `recorded-proc-python.ts`'s same simulated
wire, so `backendFor()`'s real `new ProcPythonBackend(...)` construction
(`commands.ts:326` hardcodes the constructor — there is no injectable backend
factory) runs against it unmodified, rather than being bypassed by a
`FakeBackend`-shaped double the way `test/helpers/backend-contract-suite.ts`'s
`BackendFactory` pattern is built for one layer down. Two small, backward-
compatible additions to that shared wire made the three cases reachable:
`SimulatedJob.nextPage` now resolves an in-flight poll early when the
request's `AbortSignal` fires — nothing in this simulated wire observed a
signal at all before this, so a `close()`-driven cancellation used to hang
forever rather than being observable — and `buildClient`'s new
`autoFinishReset` option (default `true`, every existing caller unchanged)
lets a test hold a `reset()` open long enough for Cancel to interrupt it,
where `recorded-proc-python.ts`'s own consumer never needed to drive that
timing at all. **`npx tsc --noEmit` and `npx prettier --check` are the checks
this diff warrants** — test-infrastructure and fixture code only, no change
to `src/` production logic; the full verify chain (which this session does
not run — see `RUNBOOK.md`) is still the right call before merge, since a
typecheck alone would not catch a test that passes for the wrong reason.
**`npm run test:unit`, `npm run test:integration` and `npm run lint` all came
back green** once Sean ran them, and the adversarial review pass (verdict
"looks good, merge-ready") found one real, non-blocking issue — the same
`SimulatedJob.nextPage` cleanup closure left a stale `AbortSignal` listener
attached when a poll settled via `push`/`finish` rather than abort, fixed the
same day and re-verified against both test tiers. CI then caught a second,
unrelated `prefer-const` violation in that same closure after the PR opened;
fixed by restructuring `onAbort`/`settle` to both stay `const` (`settle`
alone now owns removing the listener, on every settling path, not just
abort's), re-verified again. **Merged 2026-08-31 as
[PR #78](https://github.com/Shai-Alit/sas-py-vscode/pull/78), squashed as
`8b1bc7c`.** See `STATUS.md` for the full account, including the independent,
same-day `.gitignore` fix (PR #79).

☑ **4b — Probe cancellation. Done 2026-09-01.** Live probe against `verde`'s
SAS Studio compute context via the `viya-api-probe` skill — raw wire calls
against a session created for the probe, not through the extension. Two
findings, both load-bearing for the already-shipped `cancelRun`/`cancelJob`
code: **Finding 75** — the deployment requires `If-Match` on a job cancel,
which `cancelJob()` (`job.ts:508-521`) does not send; every cancel this
extension issues against this deployment is rejected outright with `428`
today, and `cancelRun()` (`commands.ts:518-522`) discards that failure without
inspecting it. **Finding 76** — even a correctly-`If-Match`'d cancel does not
preempt a running Python statement: a 60-second loop cancelled ~6s in still
ran its full 60.01s before SAS tore the interpreter down, so the question this
item was scoped to answer settles the pessimistic way — **it blocks**. The
"Cancelled." message a user sees today comes entirely from `LogStream`'s own
local abort and says nothing about whether the paired server-side request
succeeded. Checked, not assumed, per this item's own instruction:
`cancelRun`'s existing messaging has **no fallback** for a run or reset queued
behind a still-executing cancelled job — `backend.busy` clears on the local
abort, so the "busy" message never fires, and the user gets a silently slow
Run/Reset instead of an explanation. See the Probe findings section for the
full account, including what this probe left untested. **Decided with Sean
the same day: fold the fix into 4c** rather than open a separate slice —
4c's own entry above and its Runbook item below now carry that work. 4b
itself stays probe-only, as scoped: no source changed in this slice.

☐ **4c — Traceback parsing.** Smaller than a fresh read of the plan suggests,
because the offset-mapping groundwork already exists:
`ProgramOrigin.lineOffset` (`backend.ts:58-78`) is already populated per run in `buildProgram`
(`commands.ts:383-400` — 0 for whole-file, `selection.start.line` for Run
Selection) and carried alongside `Program.bytes` on purpose. ADR-0014 already
established that a `<string>` frame's line number is the *identity* mapping
against the uploaded file — no wrapper preamble is ever prepended, so there's
no fixed harness-line-count to subtract. The actual new work is a pure
function (no `vscode` import, so it stays unit-coverable per ADR-0009's
module-exclusion rule) taking a `TracebackFrame` + `ProgramOrigin` and
producing a plain line/character position for `<string>` frames — leaving
other frames (e.g., a user-triggered nested `<stdin>` frame from the user's
own `compile()` call) unmapped rather than guessed at. The innermost `<string>`
frame is the primary location; the rest of the stack is data for 4d's
`relatedInformation` (decided there, confirmed with Sean: one `Diagnostic` at
the innermost frame, not one per frame — the idiomatic VS Code pattern, and
avoids cluttering Problems with duplicate entries for a single recursive
error). Also in this slice: the `ModuleNotFoundError` special case
`phase-3.md:121-125` already asked for (pointing at `probeRuntime()`'s cached
installed-package list), and a triage pass on **Finding 74** (2026-08-31,
`phase-3.md`'s own entry) — confirming whether the interpreter banner/`>>>`
markers and duplicated traceback tail bleeding into the output channel on the
error path actually corrupt what `parseTraceback` sees, before finalizing this
slice's parsing assumptions rather than discovering it mid-4d.

**Folded in 2026-09-01, decided with Sean right after 4b closed:** Findings
75 and 76 from this phase's own Probe findings section. (1) `cancelJob()`
(`job.ts:508-521`) now reads a fresh `ETag` off the job's own `self`
relation immediately before the `PUT` and sends it as `If-Match` — Finding
75 measured every cancel failing outright with `428` without it, and the
create response's own `ETag` is already stale by the time a caller would
have held one; `cancelRun()` (`commands.ts:518-522`) now inspects
`cancel()`'s result instead of discarding it, logging and reporting a
failure there. (2) `cancelRun`'s messaging, per Finding 76: rather than add
new tracking machinery for "is the session still finishing the previous
step" (a background poll of an already-cancelled job, kept alive purely to
know when it truly ends — considered and rejected as disproportionate for
this slice), the "Cancelled." message itself (`messages.ts`) is reworded to
say only what is true unconditionally: that this window's own view of the
run has stopped, and that Viya may keep executing a step already in
flight. That covers the same ground the missing "busy" fallback would have
— set the right expectation at cancel time, rather than explain a delay
reactively — without a new failure mode. Implemented 2026-09-01: source in
`src/compute/job.ts`, `src/run/commands.ts`, `src/backend/messages.ts`;
unit coverage in `compute-job.test.ts` (the fresh-ETag sequence and its four
new failure/link-missing arms), `compute-log-stream.test.ts` (every
`cancel()` scenario updated for the extra self-GET this now sends first),
`proc-python-backend.test.ts` and `test/helpers/recorded-proc-python.ts`
(both gained a `self` relation on the simulated job, without which the new
code fails `link-missing` immediately); `commands-backend.test.ts`'s three
existing "Cancelled." assertions now match on the reworded sentence's
leading clause rather than the old exact string.

Also implemented 2026-09-01, the plan's own traceback-mapping and
`ModuleNotFoundError` work: new `src/backend/tracebackDiagnostics.ts`
(`mapFrameToOrigin`, `primaryFrame`, `primaryPosition`,
`withModuleNotFoundGuidance`) plus its own unit tests
(`backend-traceback-diagnostics.test.ts`), and `procPython.ts`'s
`buildFailureOutcome` now appends the `Show Environment` pointer to a
`ModuleNotFoundError`'s diagnostic message (a new `proc-python-backend.test.ts`
case pins it, and that the forwarded `Traceback.message` 4d will consume
stays unmodified). **Finding 74's triage is also done** — see `phase-3.md`'s
own Finding 74 entry for the full account: not a `parseTraceback` defect,
and its own two adjacent findings (the banner/`>>>` reading as noise to a
person despite correctly not being log noise, and `writeOutcome`'s
traceback-tail echo being genuinely redundant) are left as open,
undecided follow-ups rather than fixed here — outside this slice's own
scope of traceback→editor mapping.

**Verified 2026-09-01:** `tsc --noEmit` (all three projects), `format:check`,
`npm run test:unit` (1155 passing), `npm run coverage` (95% branch floor
held, `tracebackDiagnostics.ts` at 100%), `lint`, `check:coverage-scope`,
`check:copyright` and `check:contracts` all green; `test:integration`
unaffected by this session's review fixes (comment- and test-only, plus a
behaviour-preserving `primaryFrame` refactor) and already green on Sean's
own earlier run. The standing adversarial review pass was also done — three
notes folded in (a `primaryFrame` branch-coverage refactor, an added test,
and a stale count in `backend.ts`'s `RichOutput` doc comment), a
`prettier` miss on the branch's `compute-job.test.ts` edits fixed, two
observations recorded as non-blocking. Full account in `STATUS.md`'s 4c
paragraph.

☐ **4d — Diagnostics surface (Problems panel + result-panel click-to-jump).**
A `DiagnosticCollection` (`languages.createDiagnosticCollection('pythonOnViya
')`), cleared for a `Program`'s origin URI at the start of every run (success
or failure) and populated on failure with one `Diagnostic` at the innermost
user frame (`severity: Error`), `relatedInformation` carrying the rest of the
call stack from 4c. No `vscode.Diagnostic`/`DiagnosticCollection`/
`createDiagnosticCollection` usage exists anywhere in `src/` yet — this half
is genuinely greenfield. Also wires the result panel: `resultPanelDom.ts`'s
existing, currently-unconsumed `frames`/`frameLines` data (`phase-3.md:1028-
1032` already notes it "has no consumer until Phase 4's traceback-to-editor
mapping") becomes clickable, posting a message through ADR-0021's existing
buffered host↔webview protocol, resolved through 4c's same mapping function to
open/reveal the position in the editor — confirmed in scope with Sean since
ADR-0021 explicitly flagged this as unscoped-but-Phase-4's-job rather than
leaving it a further-deferred follow-up. No new webview surface or CSP change
expected, just a new message type on the existing protocol. "Optional quick
actions" stays genuinely optional/time-boxed, not committed to now.

---

## Probe findings

Probed 2026-09-01 against `verde` (Viya 4), the SAS Studio compute context,
via the `viya-api-probe` skill against `creds.json`. Both findings continue
the numbering from `phase-3.md` (last was Finding 74).

### Finding 75 — Job cancel requires `If-Match`; the shipped `cancelJob()` omits it and is rejected outright

`job.ts`'s own doc comment on `cancelJob` claims the deployment needs "no
`If-Match`" — "sending no validator means there is no `412` to recover from."
Measured false. A `PUT …/jobs/{id}/state?value=canceled` sent with no
`If-Match` answered **`428 Precondition Required`** every time (`errorCode
5033`: "An If-Match header containing the current entity tag of this resource
is required."), never the succeed-or-412 shape the comment assumed. Retried
with a fresh `ETag` — read from a `GET` on the job immediately before the
`PUT`, since the job's `ETag` had already changed between the `201` create
response (`"kprhurectx"`) and a `GET` a second later (`"kprhurecyg"`), so the
create response's own `ETag` cannot be reused — the same request answered
`200` with body `canceled`.

**This is not a hypothetical for this deployment: it is what `cancelJob()`
does today.** `client.send()` only attaches `If-Match` when a caller passes an
`etag` (`client.ts:299`), and `cancelJob` (`job.ts:508-521`) does not — it
sends exactly the bare request the probe just showed failing. The failure
comes back as `{code: "compute-rejected", error: {status: 428}}` — untouched
by `asSessionGone`, which only rewrites a `404` — and `LogStream.cancel()`
(`logStream.ts:602`) returns it verbatim as its own result. `cancelActive()`
(`procPython.ts:628-637`) turns that into `fail({code: "backend-failed", …})`.
**`cancelRun()` (`commands.ts:518-522`) then discards it**: `await
currentRun.backend.cancel(currentRun.handle); return;` — the `BackendResult`
is never inspected. So on this deployment, every press of Cancel today sends
a request the server always rejects, and nothing anywhere (no log line, no
notification) says so.

What the user sees regardless is "Cancelled." — but that comes entirely from
a separate, local mechanism. `LogStream.cancel()`'s own `abort()`
(`logStream.ts:577-581` — "the abort goes first, deliberately… a user who
pressed Cancel is waiting on that, not on the deployment's acknowledgement")
fires unconditionally *before* `cancelJob` is even sent, and that local abort
alone is what makes the run's own `done` settle as `cancelled` and the
"Cancelled." message appear. The message is honest about the *local* run
stopping and silent about whether the *session* was ever told to. See
Finding 76 for what an actually-accepted cancel does once it reaches the
session.

### Finding 76 — An accepted job cancel does not preempt a running Python statement; the step runs to its natural end before the interpreter is torn down

Same session, a fresh 60-second job (60 `print`/`sleep(1)` iterations inside
one `submit`/`endsubmit` block). Cancelled ~6 seconds in, this time with a
correctly-fetched `If-Match` — accepted, `200`, job state read back as
`canceled` on the next read. But the job's `state` endpoint answered
**`running`** for the next 24+ seconds of 1-second polling, never observed
transitioning during that window; by the time it was checked again the job
had settled to `canceled`, yet the log's closing `NOTE: PROCEDURE PYTHON used
(Total process time): real time 1:00.01` shows the step ran the **full 60
seconds** the loop asked for. The `ERROR: Proc Python was killed in the
middle of processing. Terminating Python to keep the SAS session functional.`
line that precedes it is the teardown SAS performs once the block's last
statement returns control, not evidence the block was interrupted early.

**So: the deployment accepts and echoes `canceled` as the job's own state
promptly, but does not preempt an in-flight Python statement.** Cancellation
only takes effect at a statement boundary SAS itself controls, and a single
long-running Python call inside one `submit`/`endsubmit` block has no such
boundary before it finishes on its own. This settles the Runbook item's open
question the pessimistic way: **it blocks.**

A same-session job submitted immediately afterward (while the cancelled job's
own state was still reading `running`) came back `201`/`pending` and later
completed correctly (`hello-after-cancel`, `3.28s` real time) once the first
job's teardown finally happened — so a run queued behind a cancelled-but-
still-executing job is not corrupted, only delayed by however much of the
original step's natural duration was left. This probe did not measure how
long it actually sat `pending`.

**`cancelRun`'s fallback messaging is not adequate for this** — checked
directly, per the Runbook item, rather than assumed. `backend.busy` (and
therefore every message a second Run or Reset could show) clears the moment
the *local* run settles, which Finding 75 already showed happens on `abort()`
— near-instantly, well before the session is actually free. A user who
cancels and immediately runs or resets again never sees the "busy" message
(it can't fire; the client believes nothing is running) — they get a Run or a
"Resetting the Python interpreter…" notification that queues correctly
behind the old job but sits with no explanation for up to the remainder of
its natural duration. Nothing is corrupted, but nothing tells the user why it
is slow. Not fixed here — this item's own scope was to confirm and record,
not to change `cancelRun`.

Also resolves `job.ts`'s "`done`, `canceled` and `warning` are inherited on
trust [into `TERMINAL_STATES`]" (line ~133): `canceled` **is now observed
live** (2026-09-01, `verde`), lower-case, matching the existing
case-insensitive comparison.

**Not settled by this probe:** whether a *session*-level cancel (`PUT
/compute/sessions/{id}/state?value=canceled`, the same shape per finding 21)
behaves any differently — not tried, since `cancelJob` never composes one;
how long a queued job actually sits `pending` before it starts; whether a
shorter or CPU-bound (non-`sleep`) Python statement is preempted any
differently than a `time.sleep` loop; Viya 3.5 behaviour (this deployment is
Viya 4). All probe sessions and jobs were deleted at the end and the session
delete confirmed by a `404` read-back.
