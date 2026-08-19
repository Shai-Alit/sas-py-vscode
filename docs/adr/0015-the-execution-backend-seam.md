# ADR-0015 — The `ExecutionBackend` seam: opaque bytes, a handle that streams, and a reject-when-busy contract

- **Status:** Accepted
- **Date:** 2026-08-16
- **Decides:** the exact shape of the interface everything above execution talks
  to, and what the dialect layer is allowed to own
- **Constrained by:** ADR-0014 (submission is upload-then-run), ADR-0012 (session
  lifetime belongs to the session manager), ADR-0009 (coverage denominator)
- **Executed in:** slice `2b-i` (this interface and the dialects), `2b-ii` (the
  contract and stage-1 probing), `3a` (the first implementation)

## Context

`PRODUCTION_PLAN.md` §2.1 calls this seam load-bearing, and means it literally:
commands, result rendering, the notebook controller and diagnostics all talk to
this interface rather than to `PROC PYTHON`, and that is the whole reason the
project can commit to `PROC PYTHON` today without regret. §2.2 sketches a target
shape and labels it "illustrative, to be settled in Phase 2b". This is that
settlement.

Two things have happened since the sketch was written. ADR-0014 established that
Python reaches the interpreter as an uploaded file run with `infile=`, and stated
that a `submit(code: string)` method is foreclosed — so the sketch's `execute`
signature cannot survive as written. And slice 2a built the Compute REST layer,
which has a settled house style of its own: link-driven, `ComputeResult`-returning,
never throwing. The seam has to be defined against both.

The risk this record exists to manage is that **nothing implements this interface
until slice 3a**. 2b is pure structure, so the interface will sit unimplemented
for a slice or two, and an interface nobody has tried to satisfy is an interface
that is probably wrong somewhere. The mitigation is written into the decision
below — a test-double backend that is driven through every clause — and the escape
hatch is the ordinary one: if 3a proves a clause wrong, this ADR is superseded,
not quietly edited.

## Decision

### The interface

```ts no-check
export interface ExecutionBackend {
  readonly id: string;
  capabilities(): BackendCapabilities;
  connect(): Promise<BackendResult<void>>;

  readonly busy: boolean;
  execute(program: Program, opts: ExecuteOptions): Promise<BackendResult<ExecutionHandle>>;
  cancel(handle: ExecutionHandle): Promise<BackendResult<void>>;
  reset(): Promise<BackendResult<void>>;
  close(): Promise<void>;
}

export interface Program {
  /** Exactly the bytes that will run. Nothing between here and the interpreter
      may re-encode, escape, or tokenise them. */
  readonly bytes: Uint8Array;
  readonly origin: ProgramOrigin;
}

export interface ProgramOrigin {
  readonly uri: Uri;
  readonly lineOffset: number;
}

export interface ExecuteOptions {
  /** Run File defaults true; a notebook cell defaults false. */
  readonly freshNamespace: boolean;
}

export interface ExecutionHandle {
  readonly id: string;
  readonly outputs: AsyncIterable<RichOutput>;
  readonly done: Promise<BackendResult<ExecutionOutcome>>;
}

export interface ExecutionOutcome {
  readonly succeeded: boolean;
  readonly diagnostics: readonly PythonDiagnostic[];
}
```

`RichOutput` keeps the four arms §2.2 named — `text/plain`, `text/html`,
`image/png` as base64, and `application/vnd.python.traceback` — because the mime
tag is what the notebook controller and the output view key on, and collapsing
them into one HTML string is the upstream mistake this project is deliberately
not inheriting.

### The clauses, and what each one commits to

**`execute` takes bytes, not a string.** This is ADR-0014 expressed in a type.
The payload is opaque: there is no code text for an implementation to interpolate
into anything, and the contract on `Program.bytes` is byte-exactness end to end.
*How* the bytes reach the runtime is the implementation's business — the Viya
backend uploads them to a fileref and runs `proc python infile=`; a future native
runtime writes them to a pipe. That difference is exactly what this seam exists to
hide.

**`origin` belongs to the `Program`, not to the `ExecuteOptions`.** Where the
bytes came from is a property of the bytes. The offset map that turns an
interpreter line number back into an editor position is derived from the pair, and
separating them invites a call site that supplies one without the other.

**The handle streams; it does not aggregate.** `execute` resolves as soon as the
run is accepted, handing back a handle whose `outputs` yield as they arrive and
whose `done` resolves once. §2.2's `ExecutionResult` — outputs, diagnostics,
succeeded, in one object — is the aggregated form of this, and it is what a caller
that does not care about streaming can build. Streaming is the primitive because
2c's log streaming, 3b's log-to-output mapping and 3d's incremental rendering all
need it, and none of them can be added to an aggregate without changing the seam.

**`busy` rejects; it does not queue.** `PROC PYTHON` is serial, so a second
`execute` against a busy backend returns `BackendProblem` of kind `busy` and does
nothing at all. Queueing is a policy decision with a user-visible answer — whether
to queue, how deep, what the status bar says, what Cancel means for a queued item —
and it belongs to slice 3d where it can be seen. A queue hidden inside the seam is
an unbounded one nobody can inspect.

**`freshNamespace: true` guarantees empty interpreter globals and nothing else.**
The compute session, its libraries and its filerefs survive it — that is what
finding 38 measured for `proc python restart;`, and it is what `reset()` promises
independently. An implementation that cannot clear globals without dropping the
session must report `unsupported` rather than quietly reuse them, because a stale
namespace is the failure a user will misread as their own bug.

**`cancel` is valid from the moment `execute` is called**, including while the
program is still being transferred. Whether a given transport can actually abort
an in-flight upload is an implementation question — the Compute client already
takes an `AbortSignal` — but the seam must not be shaped so that the answer is
structurally "no".

**`connect` does not create a session.** ADR-0012 gives session lifetime to the
session manager and ADR-0013 opens the session at sign-in; a backend is
constructed against a session that already exists, and `connect()` means "be ready
to run on it". Any other reading duplicates lifetime logic in 3a.

**`close` returns no result.** A failure to close is not actionable by a caller
that is, by definition, finished. It is logged, not returned.

### The seam owns its own failures

`BackendResult` and `BackendProblem` are declared in `src/backend/`, not reused
from `src/compute/`. `ComputeFailure` is a vocabulary about HTTP status codes,
ETags and Viya link relations; every one of those terms is meaningless to a
non-Viya backend, and importing them here would leak the REST layer through the
abstraction on day one. The precedent is `src/auth/problems.ts`, which already
does this for the auth layer. The cost is a translation in 3a, and it is paid
willingly: the translation is the place where "428 Precondition Required" becomes
"the upload was rejected", which is the sentence a user can act on.

`BackendProblem` carries `transferFailed` as a distinct kind, so that "the bytes
never arrived" and "the program ran and raised" are told apart by the failure
value rather than by which method returned it.

### What the dialect layer owns

`src/dialects/` holds a `Dialect` per Viya generation and a `resolveDialect()`
carrying an alias registry. A dialect owns the deployment kind, whether the
built-in `vscode` OAuth client exists — delegating to `src/auth/clientId.ts`
rather than restating its comparison — and the name of its contract file.

It owns nothing else, and that restraint is the decision. A dialect method with
no measured difference behind it is a guess with an interface around it, and the
lint rule that forbids version branching outside this directory only helps if the
directory contains differences that are real. Methods arrive when a probe or a
defect proves one, one at a time.

`resolveDialect()` returns the dialect together with a **reason** — the string
that says why this generation was chosen — and defaults to Viya 4 when detection
is inconclusive. Stage-1 probing is fail-soft by §2.3, so an unresolvable
deployment must degrade to the common case rather than block the user, and the
reason string is what makes that degradation legible in the log instead of silent.

### The specification is a test double

Because no real backend exists until 3a, slice 2b-i ships a double in
`test/helpers/` that implements `ExecutionBackend` and is driven through every
clause above: reject-when-busy, cancel before and after acceptance, both
`freshNamespace` values, a streamed output sequence, and each `BackendProblem`
kind. It lives in the test tier, so it never ships in the VSIX, and it is the
thing that stops this record from being a design nobody has tried to satisfy.

## Alternatives considered

**`submit(code: string)`.** Foreclosed by ADR-0014 — it makes inlining the only
possible implementation, and inlining fails by poisoning the session silently.
Recorded here only because it is the shape `PRODUCTION_PLAN.md` §2.2 still showed.

**Two phases: `stage(program)` then `run(staged, opts)`.** This is the literal
reading of ADR-0014's "put these bytes there, then run that", and it has two real
advantages: a transfer failure is distinguished by which call failed rather than
by inspecting a failure value, and a caller can abort a large upload before
committing to a run. It was rejected because it puts Viya's transfer mechanics
into the abstraction every backend must implement — a native runtime would have to
provide a `stage()` that returns something it does not need — which is precisely
the coupling the seam exists to prevent. The purpose behind ADR-0014's wording is
served by the byte-exactness contract on `Program`: there is no string for anyone
to interpolate, which was the hazard. The price is that `transferFailed` has to be
carried explicitly in the failure union, and it is.

**Reusing `ComputeResult` and `ComputeFailure`.** Cheaper by one file and
tempting because 3a's implementation is entirely Compute calls. Rejected: see
above. The seam would be describing itself in the vocabulary of one of its
implementations.

**Queueing when busy.** Rejected — see the `busy` clause. Worth noting that this
is a decision 3d may reverse *above* the seam by queueing in the controller, which
is fine; what it may not do is hide a queue below it.

**`execute` resolving with the finished result.** Simpler to test and to call, and
adequate for Run File. Rejected because it forecloses streaming, and every slice
from 2c onward needs output before the run ends.

**Putting the seam in `src/compute/`.** Rejected: `src/compute/` is the Viya
Compute REST layer. A seam that must not know `PROC PYTHON` exists should not sit
in the directory whose whole subject is talking to Viya, because proximity is how
the dependency gets added by someone in a hurry.

## Consequences

Slice 3a gains a translation layer from `ComputeFailure` to `BackendProblem` that
it would not otherwise write. That is the recurring cost of this record, and it is
also where Viya's wire-level errors become sentences a user can act on.

The seven new modules are pure — no runtime `vscode` import, `ProgramOrigin.uri`
being a **type-only** import of `vscode.Uri` on the `bindingStore.ts` precedent —
so six of them land in the coverage denominator under ADR-0009 and the ratchet
in `.c8rc.json` rises in the same pull request.

`backend.ts` is the seventh and it turned out to be the first module in this
repository with *nothing at all* to execute: interfaces and type aliases, and an
empty JavaScript file after compilation. c8 charges every line of it, doc
comments included, to the denominator while no test can execute one, which cost
three points of aggregate coverage for a file the contract tests specify
completely. ADR-0009 is amended in this pull request rather than worked around:
the rule becomes *excluded if and only if the unit tier cannot reach it*, with
types-only as the second way to be unreachable, checked by the same script in
both directions so that the day this file grows a helper it returns to the
denominator.

Callers above the seam become testable without Viya. Anything that can be driven
by the double — the notebook controller, the output view, diagnostics — can be
unit-tested against it, which is the practical form of the "test the Viya path
properly" principle in §2.1.

**What this record does not settle.** The interior of `PythonDiagnostic` and
`Traceback` is slice 3c's; both are declared here at the minimum the seam needs
(a message, and frames carrying file, line and name), and refining them does not
reopen this ADR because they are payload, not contract. What
`BackendCapabilities` reports beyond stage-1 facts is slice 3e's, and stays
`unprobed` until then. How outputs are ordered against log lines is 3b's. Queue
policy, cell identity and what Cancel does to a pending item are 3d's. Whether a
Viya upload can be aborted mid-flight is unmeasured. And nothing here has been run
against Viya 3.5, which remains true of every record in this project.
