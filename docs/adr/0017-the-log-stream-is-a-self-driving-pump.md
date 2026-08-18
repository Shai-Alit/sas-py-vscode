# ADR-0017 — The log stream is a self-driving pump, driven by the log's own long poll

- **Status:** Accepted
- **Date:** 2026-08-17
- **Decides:** what drives the log-reading loop, what shape the stream takes at
  the seam, and how much of a job `src/compute/job.ts` owns
- **Constrained by:** ADR-0015 (the execution backend seam — `ExecutionHandle`
  and its no-stall clause), ADR-0010 (the client navigates by link relation),
  ADR-0014 (Python is submitted as an uploaded file, which is 3a's concern and
  not this one)
- **Executed in:** slices `2c-i` (the single requests this is built on) and
  `2c-ii` (the pump itself) — 2c was split on 2026-08-17 along the line the probe
  drew, between what one request settles and what a loop settles
- **Evidence:** `PROBE-FINDINGS.md` findings 46–53 (`2c-pre`, 2026-08-17)

## Context

ADR-0015 froze the seam before anything implemented it. `ExecutionHandle` carries
`readonly outputs: AsyncIterable<RichOutput>` and
`readonly done: Promise<BackendResult<ExecutionOutcome>>`, and the doc comment on
`outputs` says the thing that makes this ADR necessary:

> Iterating is not required … an implementation must not stall waiting for a
> consumer that never arrives.

That sentence was written as a constraint on a future implementation. This is the
slice that has to satisfy it, and the obvious implementation does not.

Three questions were open going in, and `2c-pre` answered the one that mattered
before any of them could be settled: **does the log endpoint's `timeout=`
parameter actually long-poll?** Upstream's loop passes it, but upstream also
declares `wait` on the session-state resource and never passes it (finding 19),
so its presence in a call was not evidence of anything. If `timeout=` were inert,
the loop would be a busy-wait throttled only by network latency, and the stream
would have to be driven from the **job-state** long poll instead — the one
finding 28 measured releasing at the moment the state changed. Not the
*session*-state poll: finding 27 already ruled that out, because completion is a
property of the job, and watching the session settle to `idle` reports a run
finished two to three seconds late.

It is not inert. Measured on a live Viya 4 across two runs: against a job
deliberately silent for 25 s, `timeout=10` blocked the full 10.27 s and returned
nothing, where the same request without the parameter came back empty in 0.56 s;
against a job printing one line a second, `timeout=10` released in about 1.0 s
each time, when the line appeared rather than when the window ran out
(finding 48). Three further measurements shape everything below. Expiry is a
`200` carrying `items: []` and never a `304`, where the session state's expiry —
the only other one measured — is a `304` (finding 28); the job state's expiry has
never been observed, because every job-state poll so far was released by a change
rather than by its own clock (finding 49). A job that has
reached a terminal state **short-circuits the wait**, answering in 0.26 s, so the
drain costs nothing and there is no ten-second stall at the end of an execution
(finding 50). And the log carries **no `ETag` at all**, so `start` is the entire
cursor and there is no conditional-request machinery to maintain (finding 48).

## Decision

**Three parts, in the order they constrain each other.**

### 1. The loop is driven by the log's own long poll

`GET {job}/log?start=N&limit=L&timeout=T`, advancing `N` by the number of items
returned. Not the session-state long poll, not the job-state long poll, and not
`logAsText`.

"Items returned" is meant literally, and 2c-i had to put it on the page type to
keep it honest: `LogPage` carries an `advance` separately from its `lines`,
because an item the parser drops still occupied a position in the deployment's
numbering. Advancing by what parsed rather than by what arrived re-reads a line
after any drop, and on a one-item page it does not advance at all — which the
deployment answers instantly, turning this loop into the busy-wait that the whole
of the `timeout` argument below exists to prevent. Same reason a server-side
clamp on `L` is harmless: the cursor follows what was sent.

`timeout` is **not an option a caller may omit**. It is passed at the call site,
by construction, because omitting it produces a request that looks correct and
returns `200` every time while turning the loop into a request storm against
somebody's corporate network. This is the same failure mode as finding 19's
unpassed `wait` and it is being designed out rather than documented around.

The job's terminal state is still authoritative for *stopping* — an empty page
means "nothing yet", never "end of log" (finding 49). But the state does not have
to be asked for on every iteration. Because a live-but-silent job makes the poll
block its full window (finding 48) while a finished one returns immediately
(finding 50), **a poll that comes back empty and fast is a cheap hint that the
job may have finished** — so the state is consulted then, and not otherwise. That
is one state request per quiet interval instead of one per iteration.

The hint is weaker than it looks and is treated as such. The probe measured the
implication in one direction only — a job already terminal answered fast, once —
and never the converse, that a fast answer implies terminal. A loaded server, a
clamped `timeout` (finding 48 could not rule one out) or any other early return
produces the same signal from a running job.

The heuristic decides only *when to ask*. It never decides the answer: the state
resource is the sole authority on whether the job is done, and a fast empty page
that turns out to belong to a still-running job simply costs one extra request
for that window. On a deployment where *every* empty poll returns fast, that is
one per empty window and so a sustained doubling of the request rate against a
silent job — the cost of being wrong, and the only cost, because the state rather
than the clock decides whether the stream ends. A timing heuristic given veto
power over termination would be a stream that ends early on a fast network, which
is not a trade this project makes.

Termination is therefore: poll until the state is terminal, then drain by
following `next` until the relation is absent. The drain must key on the link's
absence and never on a short page — the final page of a 21-line log read at
`limit=3` was *full* and still carried no `next` (finding 51).

**Both of those loops carry a bound, and for the same reason** (added by 2c-ii).
Each exits on a behaviour measured once, on one deployment: that a terminal job
short-circuits its poll (finding 50), and that the `next` relation eventually
stops arriving (finding 51). A deployment that differs would give a stream that
never settles, which is the worst failure available to a module built this way.
So the state is read at least every sixth *empty* window whatever the timing
says, and the drain stops after ten thousand pages and reports a malformed
response rather than presenting a truncated log as a whole one. A page carrying
items resets the first counter, because output arriving is better evidence that
the job is alive than the state resource could give.

### 2. `job.ts` creates jobs from opaque statements

`src/compute/job.ts` owns creation (`POST` via the session's `execute` relation,
with a caller-supplied array of SAS statements), state polling, and log
streaming. It is **neutral about what those statements say.**

This is a deliberate boundary. ADR-0014 decided that Python is submitted as an
uploaded file run with `proc python infile=<fileref>;`, and that decision belongs
entirely to slice 3a. If `job.ts` knew about it — if it took Python and composed
the SAS around it — then 3a's mechanism would be frozen into 2c, and the fileref
upload, the `If-Match` round trip and the `restart` handling would all have to be
designed here, before the slice that needs them. A job takes statements. What
generates them is somebody else's problem.

### 3. The stream is a self-driving pump behind an `AsyncIterable`

The poll loop starts when execution starts and runs **on its own**, independent
of whether anything is consuming `outputs`. Lines land in a buffer; the
`AsyncIterable` drains that buffer. `done` settles when the job reaches a
terminal state and the drain completes, whether or not a single line was ever
read.

This is the whole reason the ADR exists, and the reasoning is in the rejected
alternative below.

## Alternatives considered

**An `async function*` — the obvious implementation, and the one that does not
work.** An async generator's body does not run until something calls `next()`,
and it suspends at every `yield` until the next call. Write the poll loop as a
generator and two things follow directly. If nothing iterates, **no polling ever
happens**: the job runs to completion on the server, the log is never read, and
`done` never settles — which is the precise scenario ADR-0015's doc comment
forbids, arrived at not by carelessness but by using the language feature the
problem appears to call for. And if something iterates *slowly*, the polling
cadence becomes the consumer's cadence, so a busy editor throttles the reader
that is meant to be watching the server.

The second consequence is subtler than the first and matters more than it looks.
`done` carries the execution's outcome, and a caller may reasonably want the
outcome without wanting the output — a caller that awaits `done` and ignores
`outputs` is a perfectly sensible caller, and against a generator it deadlocks.
The no-stall clause is not a defensive nicety; it is what makes the two members
of `ExecutionHandle` independent.

A generator can be rescued by starting a detached pump and having the generator
read from it — but at that point the pump is the design and the generator is a
thin adapter over a buffer, which is what is being written here without the
pretence.

**Driving from a state long poll** — the job's, per the Context above. Rejected
now that finding 48 exists: the log's own poll is real, so one mechanism with one
response shape beats two mechanisms whose expiry conventions are known to
disagree where they have been measured at all (finding 49). It would also have
made the log's cursor and the state's ETag two pieces of state that must not
disagree. Note that upstream does *not* long-poll its state either way: it calls
the job state with no `wait` after every log page (finding 19), which is the
request storm this ADR is avoiding, not a design to copy.

**Reading `logAsText`.** The relation exists, and it is the *same href* as `log`
differing only in `Accept` (finding 46). Rejected because the line `type` is the
point: a blob puts us back to parsing `NOTE:` and `ERROR:` prefixes out of
strings, and finding 52 shows exactly how badly that goes — `note` covers
continuation lines, whitespace and blank lines, so prefix-matching would
misclassify ten of thirteen notes in a twenty-one-line log.

**A push interface — an `EventEmitter` or a callback.** A natural fit for a pump,
and rejected on the ground that ADR-0015 already froze `AsyncIterable`. Reopening
a seam three slices after freezing it, to avoid writing one buffer, is not a
trade worth making.

## Consequences

**An unconsumed stream accumulates lines.** A pump that polls regardless of
consumption will, given a runaway program and a consumer that never arrives, hold
a growing log in the extension host's memory. That is a direct consequence of the
decision above and it is recorded here as such. This ADR took no position on the
remedy when it was written, leaving it to the slice that builds the buffer.

**Settled 2026-08-17, before 2c-i: cap it, drop the oldest, and count what was
dropped.** The cap is a named constant set high enough that no ordinary program
reaches it, so in normal use nothing is dropped and the policy is invisible. On
overflow the **oldest** lines go, because a runaway loop's last thousand lines
are where its failure is and its first thousand are its start-up. And the number
dropped is **reported to the consumer** rather than silently absorbed, because a
log with a hole in it and no marker is a log that lies. 2c-ii builds it; 2c-i has
no buffer in it at all.

**The contract checker did not have to be relaxed to describe a job**, which is a
correction to what this ADR first said. `scripts/check-contracts.mjs` requires
`via.from`, `via.relation` and `via.type` to each be a string, and every relation
on the path from a context to a log page carries a media type — so 2c-i declared
the whole chain, `job_create`, `job_state` and `job_log` included, without
touching the checker. What the constraint actually blocks is narrower and wider
at once: four relations, `cancel` and `delete` on each of a session and a job,
where a job's carry `type: null` (finding 46) and a *session's* **omit the key**
entirely. Both fail the same `typeof` test, so the relaxation has to accept
absent or null rather than merely null. It shipped with `cancelJob` in 2c-ii,
which is the first thing to call one of them.

The header those three endpoints send needed the same treatment, which 2c-ii's
adversarial review found only after the relaxation above had shipped in the same
diff. A `PUT` or `DELETE` link carrying no `responseType` produces a request with
**no `Accept` header at all** — `acceptFor` in `src/compute/client.ts` falls back
to the link's `type` only on a `GET` — and the contract had claimed `text/plain`
for all three, which no request has ever sent. `accept` is now media-type-or-null
on the same two-part shape, for the same reason: the key stays required, so that
a forgotten value and a genuinely absent one remain different mistakes.

**Correcting a claim this ADR made about the checker.** An earlier version of the
paragraph above said that an endpoint the code calls but the contract omits "is
what the checker's other direction exists to catch". It is not, and the same
sentence reached `RUNBOOK.md`. `scripts/check-contracts.mjs` checks three
bidirectional pairs — contract↔dialect, contract↔fixture directory, and
contract↔code in the narrow sense that `dialect:` must name a factory exported
under `src/dialects/` — and **nothing in it reads `src/compute/` or looks at a
request at all**. So a call the inventory does not describe passes the gate
silently. What actually closes that gap is a person adding the endpoint in the
same pull request as the call, which is why `compute_session_attach` carries a
comment saying it was declared late and why 2c-ii declared `session_cancel` and
`session_delete` alongside the `job_cancel` it needed. Treat the checker as
keeping the *contract* internally honest, not as an inventory audit.

**And the fourth relation is deliberately not declared.** 2c-ii added three of
the four, not four: the job's `delete` has no caller and is not going to get one.
Reading a `404` from a job resource as "the session is gone" (finding 53) is
sound only while nothing here can have deleted the job, so the absence of a
`deleteJob` is load-bearing, and declaring the endpoint would put a dependency in
the inventory that the code has decided not to have.

**The two upstream recursions are replaced rather than ported**, as the plan
already said, and 2c-pre narrows why for one of them. `rest/job.ts::getState`
recurses into itself on a `304` because it has nowhere to keep the last value; a
poller that holds its ETag alongside the value it validated has no `304` arm to
recurse from. The second is `rest/session.ts::cancel()`, which recurses on a
`412` to re-read the ETag and retry — a retry loop with no bound, which 2c writes
as a bounded loop instead.

Separately, and *not* a recursion: upstream's `isDone` is inverted — it returns
`true` when the state is *not* terminal. That is a plain defect, named here
because it is the kind a port carries forward silently.

**Only two of five terminal states have ever been observed.** A failing job's
state is `error` and a successful one's is `completed` (finding 53); upstream's
set also contains `done`, `canceled` and `warning`, none of which this project
has provoked. All five are kept. An unobserved extra member costs nothing; a
missing one is a loop that never exits, which is the same class of bug as the
inverted `isDone` and would be found the same unpleasant way.

**Cancellation must settle `done`, not abandon it.** The pump owns an in-flight
long poll that may have up to `timeout` seconds left to run, so cancelling an
execution has to abort that request and settle `done`. Per ADR-0015 it settles
with a **`cancelled` failure, not with an outcome** — a cancelled run has no
outcome to report, and the seam already says so; 2c must not quietly widen that.
A handle whose `done` never settles is the no-stall defect wearing a different
hat, and 3d-i's Cancel command rides directly on this.

2c-ii carries it one layer down as a **success** value — `outcome: "cancelled"`
on a settled `ComputeResult` — because `cancelled` is a `BackendProblem` and
deliberately not a `ComputeProblem`, so the compute layer has no vocabulary for
it as a failure. 3a is where it becomes ADR-0015's `cancelled` failure, and 3a is
also the layer that knows the user asked for it. Two details settled with it:
cancelling stops sending anything from the moment the job's state comes back
terminal rather than from the settling of `done`, since the drain runs between
those two and the job is over throughout it; and the request that stops the job
carries no cancellation signal, because the only one in scope is the one just
aborted.

**An unrecognised line `type` is passed through, never dropped.** Four values
have been observed and the set is explicitly open (finding 52). 3b's filter is
where a type is interpreted; 2c's job is to deliver it intact.
