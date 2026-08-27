// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The seam everything above execution talks to.
 *
 * `PRODUCTION_PLAN.md` §2.1 calls this interface load-bearing and means it
 * literally: commands, result rendering, the notebook controller and diagnostics
 * all talk to `ExecutionBackend`, never to `PROC PYTHON`. `PROC PYTHON` is one
 * implementation, arriving in slice 3a. That is what makes a future
 * native-runtime swap a new file rather than a rewrite.
 *
 * **This module must never import `vscode` at run time.** {@link ProgramOrigin}
 * needs `Uri`, and takes it as a type-only import, which is erased at compile
 * time and so keeps this file inside the coverage denominator (ADR-0009). The
 * `check:coverage-scope` gate enforces the rule in both directions.
 *
 * Every clause below is decided in **ADR-0015**, and the reasoning lives there
 * rather than being restated here. What this file adds is the contract in a form
 * the compiler can hold, and the notes an implementer needs at the point of
 * implementing.
 *
 * Nothing implements this until 3a. The specification in the meantime is
 * `test/helpers/fake-backend.ts`, which is driven through every clause — an
 * interface nobody has tried to satisfy is an interface that is wrong somewhere.
 */

import type { Uri } from "vscode";

import type { DialectId, Deployment } from "../dialects/dialect";
import type { BackendResult } from "./problems";

/**
 * A runnable program, as bytes.
 *
 * **Not a string of code.** ADR-0014 settled that Python reaches the interpreter
 * as an uploaded file run with `infile=`, because inlining it in a `SUBMIT` block
 * can silently poison the session for every later submission. ADR-0015 expresses
 * that here as a type: there is no code text for an implementation to interpolate
 * into anything, so the failure mode is structurally unavailable rather than
 * guarded against.
 *
 * *How* the bytes reach the runtime is the implementation's business — the Viya
 * backend uploads them to a fileref, a native runtime writes them to a pipe — and
 * hiding that difference is what this seam is for.
 */
export interface Program {
  /**
   * Exactly the bytes that will run.
   *
   * Nothing between here and the interpreter may re-encode, escape, wrap or
   * tokenise them. Slice 3a's fidelity corpus exists to prove that end to end.
   */
  readonly bytes: Uint8Array;
  readonly origin: ProgramOrigin;
}

/**
 * Where the bytes came from.
 *
 * Part of {@link Program} rather than of {@link ExecuteOptions}, because the
 * origin is a property of the bytes and not of a particular run. The offset map
 * that turns an interpreter line number back into an editor position is derived
 * from the pair, and separating them invites a call site that supplies one
 * without the other.
 */
export interface ProgramOrigin {
  /** The document the bytes came from. */
  readonly uri: Uri;
  /**
   * Zero-based line of `uri` at which {@link Program.bytes} begins.
   *
   * Zero for a whole file; non-zero for a selection or a notebook cell. Added to
   * a line number reported by the runtime, after any wrapper frames the
   * implementation introduced have been dropped.
   */
  readonly lineOffset: number;
}

export interface ExecuteOptions {
  /**
   * Whether the interpreter's globals must be empty before this program runs.
   *
   * Run File passes `true`; a notebook cell passes `false`. The guarantee is
   * exactly this and no more: the globals are empty, and the session, its
   * libraries and its filerefs survive — which is what probe finding 38 measured
   * for `proc python restart;`. A backend that cannot clear globals without
   * dropping the session must fail with `unsupported` rather than quietly reuse
   * them, because a stale namespace is the failure a user will misread as their
   * own bug.
   */
  readonly freshNamespace: boolean;
}

/**
 * A run in flight.
 *
 * The handle **streams and then settles**; it does not accumulate. `outputs`
 * yields as output arrives, and `done` resolves once, at the end. §2.2's
 * aggregate — outputs, diagnostics and success in one object — is
 * {@link ExecutionResult}, and `collect()` in `./collect` builds it for callers
 * that do not care about streaming.
 *
 * Streaming is the primitive because 2c's log streaming, 3b's log-to-output
 * mapping and 3d's incremental rendering all need output before the run ends, and
 * none of them can be added to an aggregate without changing the seam.
 */
export interface ExecutionHandle {
  /** Identifies this run to {@link ExecutionBackend.cancel} and in the log. */
  readonly id: string;
  /**
   * Output as it arrives, in order, ending when the run settles.
   *
   * Iterating is not required: a caller that only wants the outcome may await
   * `done` alone, and an implementation must not stall waiting for a consumer
   * that never arrives.
   */
  readonly outputs: AsyncIterable<RichOutput>;
  /**
   * Settles once, when the run is over.
   *
   * Resolving `ok` means the program ran to a conclusion — including a conclusion
   * where it raised, which is {@link ExecutionOutcome.succeeded} being `false`.
   * A {@link BackendResult} failure here means it did not get that far.
   */
  readonly done: Promise<BackendResult<ExecutionOutcome>>;
}

/** How a run ended. */
export interface ExecutionOutcome {
  /**
   * Whether the program completed without raising.
   *
   * On Viya this is read from `SYSCC` rather than inferred from the log or from
   * the job's terminal state (probe findings 33 and 37, and ADR-0014): a job that
   * reports `completed` may have executed nothing at all.
   */
  readonly succeeded: boolean;
  readonly diagnostics: readonly PythonDiagnostic[];
}

/**
 * The aggregated form of a finished run — §2.2's `ExecutionResult`.
 *
 * Built by `collect()` in `./collect` rather than returned by the seam, so that
 * the streaming shape stays the primitive.
 */
export interface ExecutionResult extends ExecutionOutcome {
  readonly outputs: readonly RichOutput[];
}

/**
 * One piece of output, tagged with what it is.
 *
 * Deliberately **not** a single HTML string. The mime tag is what the notebook
 * controller and the output view key on, and collapsing the arms into rendered
 * HTML is the upstream mistake this project is not inheriting: it throws away the
 * distinction between a value, a table, an image and a failure at the one point
 * where it is still cheap to keep.
 *
 * **The payload carried across this seam is not localised, and that stays a
 * known gap rather than a decision.** `text/plain`'s `data`,
 * {@link Traceback.message}, and {@link PythonDiagnostic.message} can all
 * carry extension-authored English — `src/backend/procPython.ts`'s `"an
 * unhandled Python exception"` fallback and its `SAS reported an error
 * (SYSCC=…)` message, `logFilter.ts`'s dropped-lines marker, and
 * `richOutput.ts`'s `skippedCaptureOutput` (`"could not retrieve rich output
 * file …"`, slice 3c-i) are the four that exist today. None go through
 * `l10n.t()`, because neither `procPython.ts` nor `logFilter.ts` may import
 * `vscode` (ADR-0009's coverage-scope discipline), and ADR-0015 never
 * assigned this seam a localisation boundary at all.
 *
 * **3d-i decided the boundary for what it renders itself, without solving the
 * gap above.** `src/run/outputChannel.ts` — the first thing to render
 * `outputs`/`diagnostics` to a person — localises everything *it* authors:
 * the "running on profile …" header, the outcome summary, the
 * `text/html`/`image/png` deferred-output placeholder, and every
 * `BackendProblem` (via the new `src/backend/messages.ts`, the same
 * `problems.ts`/`messages.ts` split `compute` and `auth` already use). What it
 * does **not** do is translate the four strings named above: they are already
 * plain English by the time they reach `RichOutput.data` or
 * `PythonDiagnostic.message`, and `outputChannel.ts` writes them verbatim, the
 * same as `logLineOutput`'s own output always was. Closing that part of the
 * gap would need `vscode` threaded down into `procPython.ts`/`logFilter.ts`,
 * which is the exact cost this comment always warned against paying "one
 * string at a time" — still not worth it for four fallback messages.
 * 3d-ii's result panel inherits the same split when it renders `text/html` and
 * `image/png` for real.
 */
export type RichOutput =
  | { readonly mime: "text/plain"; readonly data: string }
  | { readonly mime: "text/html"; readonly data: string }
  /** Base64, without a data-URI prefix. */
  | { readonly mime: "image/png"; readonly data: string }
  | {
      readonly mime: "application/vnd.python.traceback";
      readonly data: Traceback;
    };

/**
 * A Python traceback, structured.
 *
 * Declared at the minimum the seam needs: a message, and frames carrying enough
 * to map back into the editor. Slice 3c owns the interior and may extend it —
 * per ADR-0015 that does not reopen the record, because the traceback is payload
 * travelling through the seam rather than part of its contract.
 */
export interface Traceback {
  /** The exception line, e.g. `ZeroDivisionError: division by zero`. */
  readonly message: string;
  /** Outermost first, as Python prints them. */
  readonly frames: readonly TracebackFrame[];
}

export interface TracebackFrame {
  /**
   * The file as the runtime named it.
   *
   * Already stripped of the harness's own wrapper frames — 3c-ii's
   * `parseTraceback` (`procPython.ts`) drops the leading run of them
   * (finding 39) before a {@link Traceback} ever reaches this seam. A frame
   * labelled the same way the harness's are (`<stdin>`) can still appear
   * further down the stack if the user's own code produced it, and is left
   * alone — only the leading run is the harness's. Mapping what remains back to
   * a {@link ProgramOrigin} is **Phase 4's** job, not 3c's: this comment used
   * to assign both to 3c, but `logFilter.ts`'s own doc and `phase-3.md`'s
   * Phase 4 plan text settled on Phase 4 for the editor-position mapping, and
   * this was the one place still disagreeing with that.
   */
  readonly file: string;
  /** One-based, as the runtime reports it. */
  readonly line: number;
  /** The function name, or the runtime's placeholder for module level. */
  readonly name: string;
}

/**
 * Something the user should see about their program.
 *
 * As with {@link Traceback}, this is the minimum the seam carries; slice 3c
 * refines it when it maps diagnostics onto editor ranges.
 */
export interface PythonDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  /** One-based, relative to {@link ProgramOrigin.uri}, once mapped. */
  readonly line?: number;
}

/**
 * What this backend can do, as far as it currently knows.
 *
 * Split by *how the facts are discovered* (§2.3), because conflating the two
 * creates a circular dependency — you cannot ask Python its version before you
 * can run Python. Stage 1 is HTTP-derived and lands in 2b-ii; stage 2 is
 * runtime-derived and lands in 3e.
 */
export interface BackendCapabilities {
  readonly dialect: DialectId;
  readonly deployment: Deployment;
  /**
   * Stage-2 facts: whether Python actually runs, its version, its packages.
   *
   * See {@link RuntimeCapabilities} for what the two members mean and why
   * there is no cached "unavailable" one.
   */
  readonly runtime: RuntimeCapabilities;
}

/** One installed distribution, as `importlib.metadata` names it. */
export interface PythonPackage {
  readonly name: string;
  readonly version: string;
}

/**
 * {@link BackendCapabilities.runtime}'s own type — what is known about the
 * runtime once something has actually asked.
 *
 * `"unprobed"` until {@link ExecutionBackend.probeRuntime} has been called at
 * least once — this is a cached, synchronous getter, never itself an I/O
 * call, so there is no other way for it to become `"available"`. There is no
 * cached "unavailable" member here: a probe that discovers Python does not
 * work is a `BackendResult` failure (`problems.ts`'s own `runtime-unavailable`
 * member, whose doc comment already names this as 3e's job), not a value this
 * getter hands back — a caller has to act on that failure differently than it
 * renders a value, the same reason `ExecutionOutcome` and a `BackendFailure`
 * are two different types rather than one with an error field. `procPython.ts`
 * and `src/backend/environment.ts` are the implementation; this seam only
 * needs the shape.
 */
export type RuntimeCapabilities =
  | { readonly kind: "unprobed" }
  | {
      readonly kind: "available";
      readonly version: string;
      readonly executable: string;
      readonly packages: readonly PythonPackage[];
    };

/**
 * A place programs can run.
 *
 * The lifecycle is: construct against a session that already exists, `connect()`,
 * then `execute()` repeatedly, then `close()`. Every clause is ADR-0015.
 */
export interface ExecutionBackend {
  /** Stable, human-readable, and safe to log — e.g. `proc-python`. */
  readonly id: string;

  /**
   * Cached; never performs I/O.
   *
   * **Not** refreshed automatically by {@link connect}. An earlier version of
   * this comment said probing happened there; that does not survive slice
   * 3e's own plan text, which calls for an explicit, user-triggered refresh
   * (`PRODUCTION_PLAN.md` §2.3: "a slow answer that changes rarely") rather
   * than taxing every reconnect with a full package-list probe. The only way
   * {@link BackendCapabilities.runtime} becomes anything other than
   * `"unprobed"` is a prior call to {@link probeRuntime} succeeding.
   */
  capabilities(): BackendCapabilities;

  /**
   * Runs the stage-2 capability probe: whether Python actually works, its
   * version and executable path, and its installed package set.
   *
   * Explicit and on-demand — never called by {@link connect} or {@link
   * execute} themselves, per {@link capabilities}'s own doc. A caller (3e's
   * `Show environment` command, and whatever refreshes its cache) decides
   * when the cost is worth paying.
   *
   * On success, also updates what {@link capabilities} subsequently returns —
   * that is the only way `BackendCapabilities.runtime` leaves `"unprobed"`.
   * `PROC PYTHON` being missing or unlicensed is reported as a
   * `runtime-unavailable` failure here, not as a value — see {@link
   * RuntimeCapabilities}'s own doc comment for why.
   *
   * Subject to the same serial contract as {@link execute}: fails with `busy`
   * while a run or a reset is in flight, and does nothing else while it does.
   * Takes no `signal`, matching {@link reset}'s own shape rather than {@link
   * execute}'s: there is no handle for a caller to cancel by, and {@link close}
   * is the one documented way to interrupt work this seam is already doing
   * without one.
   */
  probeRuntime(): Promise<BackendResult<RuntimeCapabilities>>;

  /**
   * Makes the backend ready to run on the session it was constructed against.
   *
   * **Does not create a session.** ADR-0012 gives session lifetime to the
   * session manager and ADR-0013 opens the session at sign-in; a backend that
   * created its own would duplicate that logic in the one place it is hardest to
   * see. Idempotent: connecting an already-connected backend succeeds and does
   * nothing.
   */
  connect(): Promise<BackendResult<void>>;

  /**
   * Whether a program is running now.
   *
   * `PROC PYTHON` is serial, so this is not an optimisation — it is the state a
   * caller must consult to know whether {@link execute} can succeed.
   */
  readonly busy: boolean;

  /**
   * Runs a program.
   *
   * Resolves as soon as the run is *accepted*, with a handle that streams. While
   * {@link busy}, this fails with `busy` and does nothing at all — the seam does
   * not queue, because queueing has a user-visible answer and belongs above it.
   */
  execute(
    program: Program,
    opts: ExecuteOptions,
  ): Promise<BackendResult<ExecutionHandle>>;

  /**
   * Stops a run.
   *
   * Valid from the moment {@link execute} is called, **including while the
   * program is still being transferred**. Whether a given transport can abort an
   * upload in flight is an implementation question; the seam must not be shaped
   * so that the answer is structurally no. Cancelling a run that has already
   * settled succeeds and does nothing. The cancelled run's `done` resolves with a
   * `cancelled` failure, not with an outcome.
   */
  cancel(handle: ExecutionHandle): Promise<BackendResult<void>>;

  /**
   * Discards interpreter state, keeping everything else.
   *
   * The standalone form of `freshNamespace` — same guarantee, same limits: the
   * session, its libraries and its filerefs survive.
   */
  reset(): Promise<BackendResult<void>>;

  /**
   * Releases whatever the backend holds. Idempotent.
   *
   * Returns no result on purpose: a failure to close is not actionable by a
   * caller that is, by definition, finished with it. It is logged, not returned.
   */
  close(): Promise<void>;
}
