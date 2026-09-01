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
Includes a triage pass on Finding 74. *Medium.*

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

☐ **4a — A fake-transport regression test for `commands.ts`'s post-`connect()`
paths.** Raised by Claude Bot's review on PR #63, and the same gap
`commands.ts`'s own 3d-i Runbook entry in `phase-3.md` already named before
that review — every test in `test/integration/run/commands.test.ts` uses
`sessionsThatMustNotConnect()`, so the suite only ever exercises the
pre-`connect()` guards (readiness, the editor/selection checks,
`selectRunTarget`). None of the following are pinned by an automated test
anywhere in the tree, despite each one having needed a second review pass to
get right during 3d-i itself: `backendFor()`'s reconnect-orphan close (a
still-busy cached backend closed before being overwritten, when a new
`ComputeConnection` arrives for the same profile), `cancelRun`'s
`currentReset` fallback (interrupting an in-flight `reset()` via `close()`),
and the `backend.busy` serialisation guard in `runNow`/`resetPythonState`
(stopping a second invocation from clobbering `currentRun`/`currentReset` in
the shared `finally`). Closing this needs a `RunCommandSessions.connect()`
fake that actually resolves to a `ComputeConnection`-shaped value (real-enough
`client`/`session`/`generation` fields per `sessionManager.ts:123-146`), so
that `backendFor()`'s real `new ProcPythonBackend(...)` construction (there is
no injectable backend factory — `commands.ts:326` hardcodes the constructor)
runs against a simulated wire. `test/helpers/recorded-proc-python.ts` is the
precedent one layer down (a real `ProcPythonBackend` fed a simulated
`ComputeClient`); this needs the same shape one layer up. `test/helpers/
backend-contract-suite.ts`'s `BackendFactory` type already generalizes over
this pattern. Real test-infrastructure work, not a quick addition, which is
why it stayed a named follow-up through 3d-ii and 3e rather than being folded
into either.

☐ **4b — Probe cancellation.** Run a deliberately long Python step and cancel
it, via the `viya-api-probe` skill against `creds.json`'s `verde`/`Innov`
profiles. Confirm whether the compute job cancel actually interrupts Python or
blocks until the step finishes. If it blocks, confirm `cancelRun`'s existing
session-reset fallback message is adequate rather than assuming it already is,
and log the result in this phase's own Probe findings section below.

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

_No live-Viya probes recorded for this phase yet._
