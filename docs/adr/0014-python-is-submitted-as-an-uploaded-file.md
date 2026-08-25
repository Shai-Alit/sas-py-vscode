# ADR-0014 — Python is submitted as an uploaded file and run with `infile=`, not inlined in a `SUBMIT` block

- **Status:** Accepted
- **Date:** 2026-08-16
- **Decides:** how user Python reaches the interpreter, and therefore what shape
  the `ExecutionBackend` seam can take
- **Settled by:** the 2-pre probe (`PROBE-FINDINGS.md`, findings 31–39)
- **Executed in:** slice `2b` (the interface) and slice `3a` (the implementation)

> **Amended 2026-08-25 (slice 3c-i).** `proc python infile=<fileref>;` alone,
> with no `run;`, never closes its own step — discovered when 3c-i's live
> rich-output test found a session's first job reporting `completed` with
> `SYSCC` still `0` while its log, and the file it wrote, stayed invisible for
> over sixty seconds. See the amendment at the end of this record and
> `docs/phases/phase-3.md`'s finding 70. This does not change the mechanism
> decided below — `infile=` is still how the file reaches the interpreter —
> only what the job submitting it must also send.

## Context

Every design in this project has assumed the obvious mechanism: wrap the editor's
Python in `proc python; submit; … endsubmit; run;` and post it as a Compute job.
Upstream's SAS extension submits SAS that way, the plan was written that way, and
the only doubt recorded against it was an escaping problem — `PRODUCTION_PLAN.md`
§1.5 item 1 names `endsubmit;`-in-a-string as an injection path and the whole
quoting section as the sharp edge, and prescribes a fidelity corpus to prove
whatever escaper we write.

That framing put the decision in the wrong place. It treated the mechanism as
settled and the escaper as the open question, when the mechanism is what
determines whether an escaper can exist at all. Slice 2b freezes the
`ExecutionBackend` interface, and an interface whose submission method takes a
string of code has already chosen inlining — so the question had to be answered
first, which is why 2-pre exists and why it ran before 2b rather than after.

### What the probe settled first

Three of the inputs to this decision were assumptions, and two of them were
wrong in ways that mattered.

**A stray `endsubmit;` does end the block, even inside a triple-quoted string**
(finding 31). SAS finds the statement before Python ever sees the string, so the
hazard is real and it is trivial to hit by accident — a tutorial about `PROC
PYTHON`, a docstring quoting an error message, a test fixture.

**But the block is otherwise faithful** (finding 32). No macro resolution fires
inside it, in either quote style, for automatic or user-defined variables; `''`
is not collapsed; an unbalanced apostrophe in a comment is harmless while the
block is intact; UTF-8 survives. The `&`-and-`%` hazard §1.5 anticipated does not
fire. So inlining fails in exactly one way rather than in the several the plan
feared.

**And that one way is not a failed submission — it is a poisoned session**
(finding 33). The truncated remainder leaves the SAS tokeniser inside an open
quote, and it stays there **across job boundaries**. The next job's statements
were swallowed as string content with no output, no error and no NOTE, and it
returned `state: completed`. The one after it did the same and finally emitted
`NOTE: The quoted string currently being processed has become more than 262 bytes
long.` A `PROC PYTHON` step swallowed this way also took 1:36 to do nothing.

That is the finding that decides this ADR. An injection risk is a bug we could
test for; a mechanism that reports success while executing nothing, and keeps
doing so for every later submission until the session is torn down or fed a
recovery incantation, is a mechanism whose failure mode the user cannot see. This
project's stated reason for the fidelity corpus — "the quoting failures are
silent, so the corpus is the only thing standing between a user and a program that
runs and means something else" — applies with more force to the mechanism than to
the escaper.

**The alternative works, and the option name in the plan was wrong** (findings 34
and 35). `proc python file=…` is not valid syntax; `ERROR 22-322` enumerates the
real set — `COMMAND, ECHO, INFILE, RESTART, SRC, TERMINATE, TIMEOUT`. With
`infile=`, every case that destroyed the inline path ran correctly, including a
bare `endsubmit;` inside a triple-quoted string, and the file's source is never
echoed into the log.

## Decision

**User Python is written to a file on the compute session and executed with
`proc python infile=<fileref>;`. It is never inlined in a `SUBMIT` block.**

Concretely:

**The transfer is a fileref, and it is byte-exact.** `POST
/compute/sessions/{id}/filerefs` with
`application/vnd.sas.compute.fileref.request+json`, then `PUT …/content` as
`application/octet-stream` carrying the `ETag` from a `GET` of the fileref as
`If-Match` — without it the service answers `428 Precondition Required` (finding
36). A round trip came back md5-identical. The bytes the editor holds are the
bytes the interpreter reads, with nothing in between that tokenises, escapes, or
re-encodes them.

**Nothing is escaped, because nothing parses the file.** There is no escaper to
write and no escaper to get wrong. This is the whole point of the decision: the
correctness argument is structural rather than a claim about how thorough our
test corpus is.

**The submission fidelity corpus still ships in 3a, and its job changes.** It no
longer proves an escaper; it proves the upload path — that what the interpreter
read is what the editor held, across CRLF, tabs, non-ASCII, an empty file and no
trailing newline. The hostile cases stay, because they are now the evidence that
nothing tokenises the file, and the first one to fail would tell us something we
believe is untrue.

**Success is read from `SYSCC`, not from the job's state.** `GET
/compute/sessions/{id}/variables/SYSCC` returns the value live (finding 37):
`1012` for an unhandled Python exception, `3000` for a SAS-side syntax error,
`0` otherwise. Finding 33 is the reason this is stated as part of *this* decision
rather than left to 3a — `state: completed` covered two jobs that executed
nothing, so a client that trusts the state has no failure detection at all. The
value is read immediately after the job it belongs to; the observed per-job reset
to `0` is not assumed to be contractual.

**`freshNamespace` is `proc python restart;`, and it composes into the same
statement** — `proc python restart infile=<fileref>;` destroys the interpreter,
starts a new one, and runs the file in one step, at a measured cost of about 3.4
seconds (finding 38). The compute session, its macro variables, librefs and
filerefs are untouched, so a fresh namespace is a per-run option rather than a
session-lifecycle event, and neither `reset()` nor the cancellation fallback has
to destroy a session.

**The `ExecutionBackend` seam must express *put these bytes there, then run
that*.** A `submit(code: string)` method is foreclosed by this ADR. A backend
that could only be handed a string would either force a dialect to invent its own
upload out of band or force the Viya dialect back to inlining, and 2b is the
slice that freezes the answer.

## Alternatives considered

**Inline `submit`/`endsubmit` with a hand-written escaper.** The plan's original
answer, and the reason the fidelity corpus was invented. Rejected because the
escape does not exist: `endsubmit;` is a *statement* found by the SAS tokeniser
before Python's string rules apply, and the ways to hide it from that tokeniser —
splitting the token across a concatenation, doubling quotes — all modify the
user's source, which is the exact failure the corpus was written to catch.
Rejected a second time on the shape of the failure rather than its likelihood:
the damage outlives the submission that caused it, so a single unlucky docstring
breaks every subsequent run in that session while each one reports success.

**Inline, plus sending the recovery incantation before every submission.** The
`*';*";*/;quit;run;` sequence does work — it was used during the probe to
resurrect a poisoned session. As a prophylactic it is genuinely tempting, because
it makes the poisoning self-healing at the cost of three lines per run. Rejected
because it treats the symptom and leaves the disease: the truncated block still
executes the remainder of the user's Python *as SAS*, which is the injection path,
and the run still produces a wrong answer rather than an error. Rejected a second
time because the incantation carries `options nosyntaxcheck nodmssynchk;`, so
adopting it as routine would suppress genuine syntax errors on every submission —
trading a rare silent failure for a permanent one.

**Scan the user's code for `endsubmit;` and refuse to run it.** Cheap, and it
would catch the common case. Rejected because a scanner for a tokeniser hazard is
the same class of artefact as an escaper — it has to model SAS's lexer to know
which occurrences are real, gets the general case wrong in both directions, and
fails closed on a valid program (a string containing the word) or fails open on an
invalid one. It also makes the extension refuse code that is legal Python, for a
reason the user cannot see in their own file.

**The `files` service instead of session filerefs.** `POST /files/files` with a
`~fs~`-encoded path is the other way to put bytes on the compute node, and it
survives the session. Rejected for now because the file's lifetime should match
the run rather than outlive it, because the filerefs collection starts empty in a
new session so nothing has to be reconciled before use (finding 36), and because
the `files` endpoint is fussier about media types — it answered `406` to a
`collection+json` `Accept` during the probe. Not a closed door: if a later slice
needs a file that survives the session, this is where to look.

**`SRC=`, the other option that might hand over code.** Named by finding 34's
error message and never tried. Not rejected — unprobed, and recorded below as an
open item rather than dismissed, because it may be a shorter path to the same
place.

## Consequences

**A run costs three extra round trips before any Python executes** — create the
fileref, `GET` it for the `ETag`, `PUT` the content — on top of the job
submission. Against a 900-second session and a multi-second interpreter start
this is small, but it is not free, and it is per run rather than per session.

**The log gets much cleaner, and 3b gets smaller.** `infile=` echoes no source,
so the largest category of noise the log filter was built to strip does not
arrive. What remains is Python's own output plus SAS's NOTEs.

**Traceback mapping for the user's frame becomes the identity** (finding 39). The
user's frame is the last one, `<string>`, and its line number is correct against
the uploaded file, so 3a needs no offset map for it. Two `<stdin>` wrapper frames
sit above it and 3b must drop them, or every traceback points at lines the user
did not write.

**Job state is demoted to a liveness signal.** `completed` means the request
finished, not that the code ran. Every place in the codebase that would otherwise
read a terminal state as success has to read `SYSCC` instead, and this is the kind
of rule that decays — it belongs in the contracts file 2b starts, not only in
prose.

**Six things this decision rests on are unsettled**, and are recorded here so that
2b and 3a treat them as open rather than reconstructing them as answered:

`ECHO`, `TIMEOUT`, `COMMAND` and `SRC` are unprobed. `TIMEOUT` may be the honest
answer to 3d-i's Cancel and `SRC` may be a second way to hand over code; both
should be probed before 3a fixes a design around their absence. Whether Compute's
per-job reset of `SYSCC` is contractual is observed twice and documented nowhere.
Large files and concurrency are untested — the probe's payload was 191 bytes and
one job ran at a time, so nothing here says how a megabyte of Python behaves or
what a second job submitted during a `PROC PYTHON` step does. Where the uploaded
file should live is unchosen: `/tmp` on the compute node was used because it was
convenient, the session home directory under `…/compsrv/default/<session-id>` is
the obvious alternative, and no permissions were checked — which matters, because
a shared deployment means a world-readable path is somebody else's Python source.
Cleanup on failure is unobserved; the probe's fileref was deassigned by hand, and
what becomes of an uploaded file when a session dies mid-run is unknown. And
everything here is Viya 4, as everywhere else in `PROBE-FINDINGS.md`.

**Nothing about this decision is Viya-3.5-safe until it is probed there.**
`PROC PYTHON`'s availability on 3.5 was already a named risk; `infile=` and the
filerefs upload are two more things the 3.5 dialect has to confirm rather than
inherit.

## Amendment — 2026-08-25 (slice 3c-i): the submitted statement was missing its own terminator

This ADR settled that success is read from `SYSCC`, not from the job's own
`completed` state, because finding 33 showed `completed` lying about a
poisoned session. What it did not settle — because nothing before 3c-i's live
rich-output test had submitted `proc python infile=<fileref>;` end to end
against a real deployment and checked the *first* job's own log and variables
immediately afterward — is that the statement this project has sent since 3a,
on its own, never closes its SAS step at all. Finding 70
(`docs/phases/phase-3.md`) is the full account: a fresh session's first
`proc python infile=X;` job reports `completed` in under a second, its log
stays frozen at two lines and `SYSCC` reads its stale pre-run `0` for over a
minute of polling — not because the code failed, but because the step was
never told to end. `run;`, or the start of some later, unrelated step, is what
ends it; nothing before this slice ever sent the former or waited for the
latter.

**This narrows what "read `SYSCC`, not job state" actually bought.** It is
still the right mitigation for finding 33's poisoning case — a session stuck
mid-quote really does keep answering `completed` for everything, and `SYSCC`
is the only signal that catches it. But `SYSCC` itself is one of the things a
never-closed step leaves stale, so it was never a complete substitute for
"did the step actually finish" the way this ADR's Consequences section implied
— it substitutes for one specific way `state` lies, not for every way a
signal read too early can be wrong.

**Fixed by sending the statement as two elements of the job's `code` array,
the second always `"run;"`** — in both `runProgram`'s ordinary and
`freshNamespace` statements and in `reset()`'s standalone `proc python
restart;`. Confirmed live: with the trailing `run;`, a fresh session's first
job reports `completed` at the elapsed time the work actually costs, and its
log and any file it wrote are visible in that same job's own first read — no
second job required. `logFilter.ts` needed no change: `run;` echoes as a
`source`-typed line, the same type the wrapping statement's own echo already
was, and `isNoiseLine` already excludes the whole type.

**This does not reopen the mechanism this ADR decided.** Upload plus
`infile=` is still how the file reaches the interpreter untouched; what
changed is that the job carrying it must also tell SAS the step is over.
