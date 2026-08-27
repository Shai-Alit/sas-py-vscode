# Phase 4 — Diagnostics

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 4 — Diagnostics

**4a — Traceback parsing.** Parse the traceback, discard `<stdin>` harness frames,
map `<string>` frames through the offset map to editor positions. *Medium.*

**4b — Diagnostics surface.** Publish `Diagnostic`s into the Problems panel with
correct squiggle positions; clear on re-run; optional quick actions. *Small/medium.*

*Exit:* a failing Python run puts an accurately-positioned error in Problems.


---

## Runbook

_No 4a/4b work started yet. Two items carried in from Phase 3's between-phase
housekeeping (2026-08-27) — both were left open there with a stated reason,
not forgotten, and are naturally Phase 4's to close since they touch the same
run/cancel machinery 4a/4b build on:_

☐ **Probe cancellation.** Run a deliberately long Python step and cancel it.
Confirm whether the compute job cancel actually interrupts Python or blocks
until the step finishes. If it blocks, fall back to session reset with a clear
user-facing message, and log it in this phase's own Probe findings section.

☐ **A fake-transport regression test for `commands.ts`'s post-`connect()`
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
fake that actually resolves to a `ComputeConnection`-shaped value, backed by a
fake client/session `ProcPythonBackend` can be constructed against and driven
through fake `execute()`/`reset()` calls to simulate a busy backend, a
reconnect, and an in-flight reset — real test-infrastructure work, not a quick
addition, which is why it stayed a named follow-up through 3d-ii and 3e rather
than being folded into either.

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
