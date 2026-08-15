# ADR-0012 — A compute session belongs to a workspace and a profile, and its id is a hint

- **Status:** Accepted
- **Date:** 2026-08-14
- **Decides:** where the compute session id is persisted, what happens when it is
  stale, and whether an abandoned session is ever adopted
- **Executed in:** slice `2a-ii`

## Context

Slice 2a-i built the Compute client: create a session, wait out `pending`, delete
it. Slice 2a-ii puts that behind a VS Code shell, and the first question it has to
answer is whether the session id survives a window reload — because
`attributes.sessionInactiveTimeout` is **900 seconds** (finding 18), a session
that is not reconnected to is not merely forgotten, it is a SAS process holding
memory on a shared deployment for fifteen minutes with nobody attached.

The session is also the only thing that makes this extension different from
uploading a script. The Python namespace — the DataFrame someone waited four
minutes to load — lives in it. Reconnecting is not a convenience; it is the
feature.

Upstream persists its session id in `workspaceState` and holds one global
`ComputeSession` in module scope, so a second profile cannot have a live session
at all. That singleton is already rejected in the plan. Where it stores the id is
a separate question, and the answer is not automatically wrong just because the
singleton around it is.

### What the probes settled first

This decision was held open until it could rest on measurement rather than
argument, and three of the four inputs changed once measured
(`PROBE-FINDINGS.md`, findings 25–29):

**A stale id is the cheapest failure in the system.** A dead session answers
`404` identically on the session, on its state, and on a job submission — the
same `404`, with the same body, that a session id which never existed returns. So
a stored id needs no validation protocol, no heartbeat, and no probe before use:
use it, catch the `404`, create a new one.

**But a `404` cannot say why.** Expired at 900 seconds, deleted by an
administrator, lost with the compute node, or never ours — one status code. Any
recovery that needs to know the cause cannot be built on this API.

**A session is self-identifying on the server.** `owner` is exactly the identity
`id` slice 1c already fetches, `applicationName` is the token's OAuth client id,
and `name` is ours to set, so
`and(eq(owner,…),eq(applicationName,…),eq(name,'python-on-viya'))` finds every
session this extension started for this user. Reclaim-by-listing is therefore
*possible*, which it was assumed not to be.

**And it is not trustworthy.** Session names are not unique — a second create with
the same name returns `200` and a distinct id, and the filter then matches two
(finding 26). The listing was also not caller-scoped under the probe's
administrator token, and whether that holds for an ordinary user is unverified.

## Decision

**The session id is persisted in `workspaceState`, keyed by profile id. One
session per (workspace, profile). The stored value is a hint, validated by use.**

Concretely:

**The workspace is the grain, because the workspace is what the code belongs to.**
A session is where *this folder's* code runs, which is the same question ADR-0011
answers with the run target, stored in the same place at the same grain. Two
different workspaces get two different sessions, which is the case that costs
money and correctness to get wrong.

**Two windows on the same folder share one session, and we say so.**
`workspaceState` is keyed to the workspace, not the window, and offers no
cross-window change event — the qualifier ADR-0007 states and ADR-0011 repeats.
This ADR does not invent a claim protocol on top of a last-writer-wins store with
no change notification; that is how you get a defect nobody can reproduce. Two
windows on one folder are the same workspace, the same target, and the same code,
so sharing a namespace is coherent rather than merely tolerated. The costs are
interleaved output and the possibility of two concurrent submissions, and the
mitigations are below.

**A submission into a `running` session is refused, not queued.** The session
state reads `running` while a job executes and `idle` when it is free (finding
27), which is a cheap, honest busy check. Concurrent submission into one session
is *unobserved* — we do not know whether the second queues, fails, or corrupts
the first — so we decline to find out in front of a user. This is also the only
defence the shared-session case has.

**Completion is polled on the job, not the session.** The job reaches `completed`
two to three seconds before the session returns to `idle` (finding 27), so
watching the session would report every run finished late and would be plainly
wrong once a second job exists.

**The session is not deleted on `deactivate`.** Persisting an id in order to
reconnect and reaping the session on exit are contradictory instructions;
a reload is the case this decision exists for. The 900-second timeout is the
automatic reaper. An explicit *Disconnect* command is the manual one, and it is
the only thing besides an error that clears the stored id.

**Nothing user-identifying goes in the session `name`.** The marker is the
constant `python-on-viya`. The identity `id` is an email address on at least one
deployment (finding 25), and a session name is readable by anyone who can list
the collection — so the user narrowing comes from `owner`, a value the server
already holds and did not learn from us.

**Death is reported without a cause.** "The session ended and the Python state is
gone; start a new one?" is true for every reason a `404` might mean. The code
keys on the **status**, not on the undocumented `errorCode` 5837 in the body.
A `401` remains an authentication problem and is not folded into this path.

## Alternatives considered

**`globalState` keyed by profile id.** One session per profile, following the
user everywhere, which is the smallest number of sessions and the least waste.
Rejected because it makes a scratch folder inherit the namespace of the
production ETL folder the user had open ten minutes ago: variables, loaded data,
and imports arriving from code the current workspace never ran. That is the exact
shape ADR-0002 restricts and ADR-0011 rejects for the run target, and it is worse
here because the contamination is invisible — a name resolves and nobody asks
why. It also fails the reverse test: closing one workspace would strand a session
another workspace is mid-run against.

**Persist nothing; every window start is a new session.** Genuinely attractive,
and the safest possible design — no stale state, no sharing, no protocol. It is
what we would choose if the namespace were cheap. Rejected because the namespace
is the product: a reload during an upgrade, an extension settings change, or a
crash would silently discard work whose cost is measured in minutes, and the user
would experience it as the extension losing their data. Rejected *second* because
it does not even save the deployment anything: the abandoned session still bills
for its full 900 seconds, so the only thing not persisting achieves is that
nobody can get back to it.

**Reclaim-by-listing instead of a stored id.** Find our sessions on the server
with `and(eq(owner,…),eq(applicationName,…),eq(name,…))` and adopt one, making
the server the source of truth and the local store unnecessary. This was the
leading candidate until it was measured. Rejected on three counts. Names are not
unique and windows do not remove their own entries, so the filter returns *n*
candidates and choosing among them is a coin flip between an abandoned session
and one another window is actively using — the collision the stored id at least
scopes to one folder. The listing was not caller-scoped under an administrator
token, so an ordinary user's results may differ and a feature that works only for
administrators is worse than none. And adopting a session we did not create means
inheriting a namespace of unknown provenance, which is the `globalState` failure
arriving by another route.

**A per-window claim recorded in `workspaceState`.** Stamp the entry with a token
generated at activation so a second window can see the session is taken.
Rejected because the store has no cross-window change event and last-writer-wins
semantics, so the protocol is racy by construction; and because a reload produces
a new token, which means the mechanism fails precisely in the reconnect case it
was built to protect.

## Consequences

**Two windows on one folder can interleave output into one session.** Accepted,
bounded by the busy check, and documented rather than hidden. Every run naming
its target and session in the output channel (ADR-0011) is what makes the
interleaving legible when it happens. If the beta reports this as a real problem
rather than a theoretical one, the fix is a claim protocol on a store that
supports it, which is a new ADR and not a patch to this one.

**The busy check costs a round trip before every submission,** and it can be
wrong the instant after it returns. It is a courtesy, not a lock, and the code
must not be written as though it were one.

**An abandoned session bills for up to fifteen minutes.** Closing the last window
on a workspace leaves the session to time out. This is the cost of not reaping on
exit, it is bounded and small, and the *Disconnect* command exists for anyone who
minds.

**One observation is assumed rather than measured.** Every `404` in finding 29
followed an explicit `DELETE`. A session reaped by the 900-second timeout is
assumed to answer identically. The assumption is cheap — the recovery path is the
same for any failure to use a stored id — but the 2a-ii manual check exists to
confirm it, and this ADR should be annotated when it does.

**The stored id is a per-profile map, not a single value.** Two profiles hold
live sessions simultaneously, which is the thing upstream's global singleton
forecloses and a headline reason this client is hand-written (ADR-0010).
