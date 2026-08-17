# Execution backends

Everything in this extension that runs Python talks to one interface. Nothing
above it knows that Python reaches SAS Viya as an uploaded file run by
`PROC PYTHON`, and that is deliberate: `PROC PYTHON` is the first implementation
of the seam, not the shape of the extension. The interface lives in
`src/backend/backend.ts`, its failure vocabulary in `src/backend/problems.ts`,
and the reasoning behind every clause in
[ADR-0015](../adr/0015-the-execution-backend-seam.md).

## The interface

```ts path=src/backend/sample.ts
import type {
  BackendCapabilities,
  ExecuteOptions,
  ExecutionHandle,
  Program,
} from "./backend";
import type { BackendResult } from "./problems";

export interface ExecutionBackend {
  readonly id: string;
  capabilities(): BackendCapabilities;
  connect(): Promise<BackendResult<void>>;

  readonly busy: boolean;
  execute(
    program: Program,
    opts: ExecuteOptions,
  ): Promise<BackendResult<ExecutionHandle>>;
  cancel(handle: ExecutionHandle): Promise<BackendResult<void>>;
  reset(): Promise<BackendResult<void>>;
  close(): Promise<void>;
}
```

A `Program` is **bytes and an origin**, never a string of code:

```ts path=src/backend/sample.ts
import type { Uri } from "vscode";

export interface Program {
  readonly bytes: Uint8Array;
  readonly origin: { readonly uri: Uri; readonly lineOffset: number };
}
```

That is [ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md)
expressed as a type. Python is submitted by uploading a file and running
`proc python infile=<fileref>;`, because a line reading `endsubmit;` inside a
triple-quoted Python string really does end an inline `SUBMIT` block — and the
poisoned SAS session then reports the *next* job as completed while executing
nothing at all. Bytes are what the upload sends and what the interpreter reads,
so there is no representation in between for anything to be interpolated into.
Any implementation that reintroduces a code string reintroduces that failure.

The origin travels with the bytes rather than in the options because it is a
property of the program, not of the run: two runs of the same file share an
origin, and a caller cannot legitimately have one without the other. It is what
lets a traceback frame become a position in an editor.

## Why the handle streams

`execute` resolves as soon as the program has been accepted, with a handle:

```ts path=src/backend/sample.ts
import type { ExecutionOutcome, RichOutput } from "./backend";
import type { BackendResult } from "./problems";

export interface ExecutionHandle {
  readonly id: string;
  readonly outputs: AsyncIterable<RichOutput>;
  readonly done: Promise<BackendResult<ExecutionOutcome>>;
}
```

Waiting for a finished result would be simpler and would foreclose the features
this project exists for. Output has to appear while a long run is still going,
Cancel has to have something to act on, and a notebook cell has to render as it
produces. The aggregate view is still available — `collect()` in
`src/backend/collect.ts` builds an `ExecutionResult` from a handle in about
fifteen lines — which is the argument in miniature: the aggregate is derivable
from the stream, and the stream is not derivable from the aggregate.

`outputs` is a `RichOutput[]` rather than the single HTML string the SAS
extension's `RunResult` carries. Plain text, HTML, a base64 PNG and a structured
traceback are four different things to a result panel, a notebook renderer and an
exporter, and joining them into markup early is a decision that cannot be undone
later.

A caller may await `done` without iterating `outputs` at all. A backend that
stalls waiting for a consumer would make `done` a trap for everyone who only
wants to know whether the program worked.

## Running one program at a time

`PROC PYTHON` is serial, so `busy` is part of the contract rather than an
implementation detail. A second `execute` while one is in flight is **rejected**,
with `{ code: "busy", running }` naming the run in the way. It is not queued.

Queueing is a visible policy decision — someone has to be able to see the queue,
cancel an item in it, and understand why their program has not started — and it
belongs to the slice that has a status bar and a notebook controller in it, not
to the seam. A queue hidden here would accumulate work nobody can see.

## Failure, and what is not a failure

**A program that raises is not a failure.** An uncaught Python exception means
the backend did its job: `execute` succeeded, the handle streamed the traceback,
and `done` resolves `ok` with `succeeded: false`. `BackendProblem` covers only
failures to run the program at all, or to keep running it — not connected, busy,
unsupported, transfer failed, runtime unavailable, backend gone, cancelled, and
an honest catch-all. Conflating the two is how a user's own `ZeroDivisionError`
gets presented as an extension malfunction.

The vocabulary is the seam's own rather than the Compute client's.
`ComputeProblem` talks about HTTP status codes, ETags and Viya link relations,
and none of those terms mean anything to a backend that is not Viya. Slice 3a
translates on the way out, which is where a `428 Precondition Required` on a
fileref upload becomes the sentence "the program never reached the server".

`transfer-failed` is the member that pays for the seam having one `execute`
method rather than a `stage` and a `run`. It is load bearing: a transfer failure
means nothing executed, so a retry is safe in a way that almost nothing else
here is.

## Capabilities

`capabilities()` answers without I/O, from what is already known. It reports the
dialect, the deployment, and — for now — `runtime: "unprobed"`.

That last field is the two-stage capability split made visible. Stage 1 is
HTTP-derived: the Viya generation, endpoint presence, dialect resolution, none of
which needs to run anything. Stage 2 is runtime-derived: whether `PROC PYTHON`
actually works, the interpreter version, the installed package set. You cannot
ask Python its version before you can run Python, so the two cannot be one call,
and pretending otherwise is a circular dependency waiting to be discovered later.

## The specification is a test double

Nothing implements this interface until slice 3a, and types compile whether or
not anyone can satisfy them. So the seam ships with `test/helpers/fake-backend.ts`
— a complete implementation with the run driven by the test — and
`test/unit/backend-contract.test.ts`, whose tests are written to read as
sentences from ADR-0015. When the `PROC PYTHON` backend arrives it should be able
to run that same file.
