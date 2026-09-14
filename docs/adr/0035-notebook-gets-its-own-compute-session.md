# ADR-0035 — A notebook cell runs against its own compute session, not Run File's

- **Status:** Accepted
- **Date:** 2026-09-14
- **Decides:** whether the notebook controller and Run File share one compute
  session per profile, or each holds its own; what that means for
  `ComputeSessionManager`, the reload-reattach binding, `Disconnect`, and the
  status bar
- **Amends:** [ADR-0012](0012-compute-session-lifetime-and-storage.md)'s "one
  session per (workspace, profile)" framing — narrowed to "one session per
  (workspace, profile, surface)", with exactly two surfaces today: Run File and
  the notebook controller. Everything else ADR-0012 decided (the workspace
  grain, the stored id being a hint, no queueing, the 900-second reaper) is
  unchanged and now applies independently to each surface's own session.
- **Executed in:** Phase 9's 9b slice, before it was pushed

## Context

9b's first cut (code-complete 2026-09-14, live-tested the same day before any
push) gave the notebook controller the *same* `BackendCache` instance as Run
File — deliberately, per `docs/phases/phase-9.md`'s own Plan section: "the
controller reuses the existing session machinery, it doesn't stand up its
own," read at the time as meaning literally one connected `ProcPythonBackend`
per profile, shared by both. `backendCache.ts` (`createBackendCache`) already
existed for exactly this: a one-backend-per-profile cache, lifted out of
`commands.ts`'s own private closure so something else could reach it.

The manual test pass (`docs/dev/manual-tests/phase-9.md` §9.9) found this
broken, not merely incomplete. In a notebook cell: `k=1`, run — `k` prints
`1` correctly. Then, for the **same profile**, a `.py` file containing
`print(k)`, run via **Run File** — fails with `k' is not defined`. Worse: a
notebook cell run immediately afterward also failed, having lost `k` too —
Run File had reset the *shared* interpreter, and the notebook had no idea.

The root cause is a hard constraint, not a bug in either surface's own code.
`ExecuteOptions.freshNamespace` (`backend.ts:80-93`, decided in Phase 2/3,
long before notebooks existed) is `true` for Run File's whole-file runs and
`false` for a notebook cell — both by design, both already correctly
implemented, both unit- and integration-tested, both live-verified
independently since Phase 3 and 9b respectively. `freshNamespace: true` is
implemented as `proc python restart infile=<fileref>;` (`procPython.ts:986-
988`), which — per finding 38 — destroys and reinitialises *the* interpreter.
Not *a* namespace scoped to the caller; *the* one interpreter the session
has. There is exactly one `PROC PYTHON` namespace per compute session. So the
instant Run File and a notebook share a session, "reset on every whole-file
run" and "persist across cells" stop being two independent guarantees and
become a race one of them always loses — invisibly, since neither surface's
own code does anything wrong to produce it.

No amount of client-side cleverness fixes this while the session stays
shared: there is no per-caller namespace to scope a reset to, because `PROC
PYTHON` does not have one. A warning before an implicit reset was considered
and rejected (Sean, 2026-09-14) — it does not restore the promise that a
notebook cell and Run File share state, it just adds a confirmation dialog in
front of the same destructive collision, for a design that already keeps
happening every time both surfaces are used against one profile.

## Decision

**The notebook controller gets its own `ComputeSessionManager`, its own
`SessionBindingStore`, and its own `BackendCache` — entirely separate from
Run File's.** `extension.ts` builds two of each. Both follow the same active
profile (`ProfileStore`'s own notion of "active" is unchanged and shared;
there is still no per-notebook profile choice — that question was already
settled in 9b's own Runbook entry, unaffected by this ADR) but as two
independent SAS compute sessions, each with its own `PROC PYTHON`
interpreter, working directory and filerefs.

Concretely:

**`ComputeSessionManager` itself needed no structural change.** Its `live`/
`generations`/`connecting`/`busySubmissions` maps are already private to one
instance; a second, independently-constructed instance naturally gets its own
copies of all four, with no compound key or re-keying required anywhere in
that class. The only thing that needed a second dimension was persistence:

**`sessionBindingKey` takes an optional `purpose`** (`binding.ts`), inserted
between the existing key prefix and the profile id. Run File's own
`SessionBindingStore` is built with no `purpose` — its persisted key is
byte-for-byte unchanged, so every binding an existing install already wrote
keeps reattaching exactly as before. The notebook's is built with
`purpose: "notebook"`, giving it a distinct `workspaceState` key per profile.
Without this, a reload would silently orphan the notebook's session (left
running until the 900-second reaper) and hand back an empty one on the next
connect, while Run File correctly reattached — a notebook losing its own
state on every window reload even though this ADR exists to stop it losing
state to Run File.

**`Disconnect` (and Sign Out, which calls the same `disconnect`) ends both
sessions.** A user asking to free this profile's Viya resources means the
whole profile, not just whichever session `compute/commands.ts` happens to
track by default — leaving the notebook's session running until its own,
independent 900-second reaper would be a surprise, not a feature. The
notebook side of it is always quiet: the primary `disconnect()` call already
produced whatever toast this action gets, and a second "nothing to
disconnect" message for a session the user never knew was separate would only
confuse. `Connect` is **not** symmetric — it still only connects Run File's
session, unchanged; the notebook's own session still connects lazily, the
first time a cell runs, the same way Run File's always has.

**The status bar keeps reflecting only Run File's session.** 9b already
decided the notebook's kernel picker is its own equivalent affordance to a
status-bar toggle (`notebookController.ts`'s own doc comment, "the kernel
picker alone"); this ADR does not reopen that, and does not add a second
`pythonOnViya.connected`-shaped indicator for the notebook's own session.
`onDidChangeConnection` similarly stays scoped to Run File's session; nothing
about library browsing (ADR-0027), CAS connect, or CAS browsing changes,
since none of them were ever touched — they read `sessions` (Run File's
manager) directly and were never routed through `BackendCache` at all.

**`docs/phases/phase-9.md`'s 9b Runbook entry and the manual test at §9.9 are
corrected in the same PR**, not layered as an amendment on top of unpushed
work — 9b had not been pushed when this was found, so there is no shipped
claim to preserve; the entry now describes what actually shipped.

## Alternatives considered

**Warn before letting Run File reset a session a notebook is also using.**
Rejected (Sean, 2026-09-14) — this does not restore state sharing, it adds a
confirmation dialog in front of the same destructive collision, and a design
that constantly threatens to kill one surface's state to run the other is not
a fix for the promise that they share it.

**Make Run File stop resetting by default**, i.e. give it `freshNamespace:
false` like a notebook cell, relying on the user to hit *Reset Python
Interpreter* explicitly when they want a clean slate. Rejected: this is a
behaviour change for **every** Run File user, not just the ones who also use
a notebook, and it reverses a deliberate Phase 3/ADR-0015 decision made
specifically to avoid "a stale namespace is the failure a user will misread
as their own bug." Trading a notebook-only edge case for reintroducing that
exact failure mode for the primary workflow is the wrong direction.

**A single session with two independent namespace "slots."** Not available.
`PROC PYTHON` has one interpreter per session — this is what finding 38
measured and what the whole `freshNamespace` design already rests on. There
is no cheaper technical option than a second session; every alternative that
does not add one is a way of living with the collision, not removing it.

## Consequences

**A profile actively used both ways holds two live compute sessions at
once.** Real cost: session start-up latency paid twice (each surface's first
touch pays its own cold start), and double the server-side session footprint
while both are warm. Each is still independently reaped after 15 idle
minutes — ADR-0012's reaper, now doubled rather than shared rather than
removed.

**The dialect/generation probe (`ComputeSessionManager.hold`'s own cache) now
runs once per surface, not once per profile.** Harmless duplication — the
answer does not depend on which surface asked — but it is a real, if small,
extra round trip the first time each surface connects a profile.

**A notebook's own state now genuinely persists across a reload** (the
reload-reattach binding this ADR's `purpose`-namespaced key exists for), a
capability 9b's original shared-session design implied but never actually
delivered independently of Run File's own session surviving.

**Two Compute Sessions Manager instances read the same `ProfileStore`,
never duplicated.** "Two sessions" is a Viya-side fact about this profile,
not a second copy of profile configuration, connection or auth plumbing —
both managers share `profiles`, the CA-aware `transport`, and the
authentication provider exactly as before.

**A pre-existing gap is now also true of the notebook's own session,
unchanged by this ADR either way**: unlike Run File's `runNow`/
`resetPythonState` (`commands.ts`'s own `forgetIfGone`), the notebook
controller has never called anything equivalent to `ComputeSessionManager
.forget()` when a run discovers its own connection is gone (`backend-gone`).
This predates this ADR — 9b's original shared-session design had the same
gap — and is not fixed here, since nothing about it got worse: a dead
notebook session still self-heals on the *next* connect via the ordinary
create-a-new-session-on-404 path (`ComputeSessionManager`'s own reattach
logic), it just does not do so as promptly as Run File's own `forgetProfile`
wiring lets it. Worth a small follow-up, not blocking.
