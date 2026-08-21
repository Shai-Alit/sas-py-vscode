// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `PROC PYTHON` implementation of {@link ExecutionBackend} — ADR-0015's
 * seam, ADR-0014's mechanism.
 *
 * **This module must never import `vscode`.**
 *
 * A run is: upload the program's bytes to a fresh fileref (`fileref.ts`), submit
 * `proc python infile=<fileref>;` (or, with `freshNamespace`,
 * `proc python restart infile=<fileref>;` — finding 35 measured the two
 * composing in one statement) as a job (`job.ts`), stream its log
 * (`logStream.ts`) into `text/plain` output, and once the job is terminal read
 * `SYSCC` (`variables.ts`) to learn whether it raised. ADR-0014 settled why the
 * last step reads `SYSCC` rather than the job's own terminal state: finding 33
 * measured a job reporting `completed` having executed nothing at all.
 *
 * ## Why a fresh fileref every run, not one reused for the session
 *
 * A run that is cancelled mid-upload must not corrupt a fileref a later run
 * might reuse, and `execute()`'s contract lets `cancel` land at any point,
 * including mid-transfer. A new fileref per run costs one `assign` call
 * (finding 36 measured a fresh session's fileref collection starting at
 * `count: 0`, so nothing needs cleaning up first) and removes that hazard
 * structurally rather than by ordering writes carefully.
 *
 * ## Why `busy` delegates to a guard rather than a private boolean
 *
 * `ExecutionBackend.busy` and `ComputeSessionManager.startSubmission` /
 * `endSubmission` (built in slice 3a-ii, RUNBOOK's "shared-window" item) look
 * like the same guarantee at first read, and they are not: an instance-private
 * `boolean` protects a single `ProcPythonBackend` from itself, but a fresh
 * instance's own flag starts `false` regardless of whether an earlier instance
 * left a job running in the same session. The manager's guard is keyed on
 * profile id and outlives any one backend's construction and disposal, which is
 * what actually makes `busy` true for the whole life of the window rather than
 * for the life of one object. So {@link SubmissionGuard} is a narrow port onto
 * exactly those three methods, already bound to a profile id by whoever
 * constructs this backend — never the `ComputeSessionManager` class itself,
 * which reaches for `vscode.LogOutputChannel` and would drag this module out of
 * the coverage denominator (ADR-0009) the same way `backend.ts` avoids it for
 * `Program.origin`.
 *
 * ## Where the log-to-output mapping stops
 *
 * Turning a `LogLine` into a `RichOutput` is this slice's to do — ADR-0015's
 * seam is exactly this translation, the same way 3a translates `ComputeFailure`
 * into `BackendProblem` — but *how much* of it to do is bounded by what
 * `infile=` actually produces. Finding 35: the uploaded file's source is never
 * echoed, so "what remains is Python's own output plus SAS's NOTEs." This
 * module forwards every line except one whose `type` is `"note"` or `"source"`
 * (the latter should not occur with `infile=` at all, and is excluded on the
 * chance a deployment differs) — everything else, including an unrecognised
 * type, is shown, because `job.ts`'s own `LogLine.type` doc calls the vocabulary
 * "a floor, not a closed set" and a filter that hides an unknown type by default
 * would hide real output the day the vocabulary grows.
 *
 * ## Traceback frames are raw, and deliberately not disambiguated further
 *
 * ADR-0014's finding 39 says *"3b must drop [the wrapper] frames."*
 * `backend.ts`'s own `TracebackFrame.file` doc says something narrower:
 * *"Mapping this back to a `ProgramOrigin` is 3c's job, and the wrapper frames
 * … are dropped there."* The two disagree about which later slice owns the
 * cleanup. They agree on what matters here: **neither assigns it to 3a.** This
 * module's `parseTraceback` therefore does the one thing both descriptions
 * leave to the slice that produces the traceback at all — read the frames
 * exactly as the runtime printed them, outermost first, unmapped — and goes no
 * further. Whichever of 3b or 3c ends up owning the wrapper-frame drop and the
 * `ProgramOrigin` mapping, it is working from this module's output either way.
 *
 * ## What this backend does not attempt
 *
 * It never reports `unsupported` or `runtime-unavailable`. The first would need
 * a capability this slice has no way to probe (3e's job, per `backend.ts`'s
 * `BackendCapabilities.runtime`); the second would need to recognise an
 * unlicensed or missing `PROC PYTHON` from its wire shape, which no probe has
 * measured. A session that cannot run `PROC PYTHON` at all fails `createJob` or
 * the run itself with whatever `ComputeFailure` the deployment actually gives,
 * translated to `backend-failed` like any other — a plainer message than a
 * dedicated one, and an honest one, since nothing here has seen the real shape
 * to word it better.
 */

import {
  type BackendCapabilities,
  type ExecuteOptions,
  type ExecutionBackend,
  type ExecutionHandle,
  type ExecutionOutcome,
  type Program,
  type PythonDiagnostic,
  type RichOutput,
  type Traceback,
  type TracebackFrame,
} from "./backend";
import { type BackendFailure, type BackendResult, fail } from "./problems";

import { type ComputeClient, type ComputeFailure } from "../compute/client";
import { createFileref, writeFilerefContent } from "../compute/fileref";
import { createJob } from "../compute/job";
import { streamJobLog, type LogStream } from "../compute/logStream";
import { describeComputeProblem } from "../compute/problems";
import { type ComputeSession } from "../compute/session";
import { readVariable } from "../compute/variables";
import { type Dialect } from "../dialects/dialect";

/** `SYSCC` and `SYSERR` read `0` when the program raised nothing (finding 37). */
const SUCCESS_SYSCC = "0";

/** `SYSCC` for an unhandled Python exception (finding 39). A syntax error on
 * the SAS side gives `3000` instead, and is handled the same way — as a plain
 * message rather than a structured traceback, since there are no Python frames
 * to parse for one. */
const PYTHON_EXCEPTION_SYSCC = "1012";

const SYSCC_NAME = "SYSCC";
const SYSERRORTEXT_NAME = "SYSERRORTEXT";

/** `proc python restart;` alone: the standalone form of `freshNamespace`
 * (finding 38 — destroys and reinitialises the interpreter, ~3.4 s, and touches
 * nothing else in the session). */
const RESTART_STATEMENT = "proc python restart;";

const TRACEBACK_HEADER = "Traceback (most recent call last):";

/** `  File "<name>", line <n>, in <name>` — the one shape finding 39 measured. */
const FRAME_PATTERN = /^ {2}File "(.*)", line (\d+), in (.+)$/;

/**
 * The three calls of `ComputeSessionManager`'s busy guard, narrowed and bound
 * to one profile id by whoever constructs this backend. See this module's own
 * doc comment for why a per-instance boolean cannot stand in for this.
 */
export interface SubmissionGuard {
  isBusy(): boolean;
  startSubmission(): boolean;
  endSubmission(): void;
}

/** A run in progress, and what `cancel()` and the outcome need to find later. */
interface ActiveRun {
  readonly id: string;
  /** Aborts the fileref/job-creation calls; `stream`'s own `cancel()` takes
   * over once it exists. Both are needed because `ExecutionBackend.cancel`
   * must work "including while the program is still being transferred", before
   * there is a job to attach a `LogStream` to at all. */
  readonly controller: AbortController;
  /** The forwarded (non-noise) log lines, in order, for `parseTraceback`. */
  readonly lines: string[];
  stream?: LogStream | undefined;
}

/**
 * A tiny relay from `runProgram`'s single read of `stream.events` to whatever
 * this backend's caller does with `ExecutionHandle.outputs`.
 *
 * Needed because ADR-0015 lets a caller ignore `outputs` entirely and await
 * `done` alone — if the traceback parser's `run.lines` were only ever filled by
 * something iterating the public `outputs`, a caller that never iterates would
 * silently starve it. So `runProgram` is the one and only consumer of
 * `stream.events` (matching `LogStream`'s own "one consumer" rule) and pushes
 * into this relay regardless of whether anyone is draining it; `outputs` reads
 * from the relay instead of from the stream directly.
 *
 * Unbounded, unlike `logStream.ts`'s `EventBuffer`: one run's forwarded lines
 * are already bounded by whatever passed through that buffer's own caps, so
 * this is never asked to hold more than a single execution already produced
 * once, not a second growing copy of the same risk.
 */
class OutputRelay {
  private readonly queue: RichOutput[] = [];
  private closed = false;
  private wake: (() => void) | undefined;

  push(output: RichOutput): void {
    this.queue.push(output);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *drain(): AsyncGenerator<RichOutput, void, undefined> {
    for (;;) {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (item !== undefined) yield item;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = () => {
          this.wake = undefined;
          resolve();
        };
      });
    }
  }
}

/** Reads an `AsyncIterable` to its end without keeping anything it yielded. */
async function drainEvents(events: AsyncIterable<unknown>): Promise<void> {
  const iterator = events[Symbol.asyncIterator]();
  for (;;) {
    const next = await iterator.next();
    if (next.done === true) return;
  }
}

/** Whether a log line is noise `infile=` is known to produce (finding 35) and
 * this backend does not forward. Anything else — including a type nothing
 * here recognises — is shown; see this module's own doc comment. */
function isNoiseLine(type: string | undefined): boolean {
  return type === "note" || type === "source";
}

/**
 * Reads a raw Python traceback out of the run's forwarded log lines.
 *
 * Looks for the **last** `Traceback (most recent call last):` line — a run
 * whose own output happens to print that sentence would otherwise be
 * misparsed at an earlier, wrong occurrence — then reads consecutive frame
 * lines until one does not match, and takes what remains, joined, as the
 * exception message. Frames are kept in the order Python printed them
 * (outermost first), unmapped and undropped: see this module's doc comment for
 * why neither is this slice's job.
 *
 * Returns `undefined` if no traceback header is found, or if it is found with
 * no frame lines following it — both mean the log does not carry the shape
 * this parser knows, and the caller falls back to `SYSERRORTEXT` alone.
 */
function parseTraceback(lines: readonly string[]): Traceback | undefined {
  const headerIndex = lines.lastIndexOf(TRACEBACK_HEADER);
  if (headerIndex === -1) return undefined;

  const frames: TracebackFrame[] = [];
  let cursor = headerIndex + 1;
  for (; cursor < lines.length; cursor += 1) {
    const match = FRAME_PATTERN.exec(lines[cursor] ?? "");
    if (match === null) break;
    const [, file, lineText, name] = match;
    frames.push({
      file: file ?? "",
      line: Number(lineText ?? "0"),
      name: (name ?? "").trim(),
    });
  }
  if (frames.length === 0) return undefined;

  const messageLines = lines
    .slice(cursor)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const message =
    messageLines.length > 0
      ? messageLines.join(" ")
      : "an unhandled Python exception";

  return { message, frames };
}

/**
 * Builds the outcome for a run whose `SYSCC` was not `0`.
 *
 * A structured `Traceback` is only ever produced for `SYSCC=1012` — finding 39
 * ties that value specifically to an unhandled Python exception, and a SAS-side
 * error (`SYSCC=3000`, or anything else) has no Python frames to parse, so it
 * is reported as a plain message instead of a traceback this parser would have
 * to invent frames for.
 */
function buildFailureOutcome(
  syscc: string,
  syserrortext: string | undefined,
  lines: readonly string[],
): { outcome: ExecutionOutcome; trailingOutput?: RichOutput } {
  if (syscc === PYTHON_EXCEPTION_SYSCC) {
    const traceback = parseTraceback(lines);
    if (traceback !== undefined) {
      const diagnostic: PythonDiagnostic = {
        severity: "error",
        message: traceback.message,
      };
      return {
        outcome: { succeeded: false, diagnostics: [diagnostic] },
        trailingOutput: {
          mime: "application/vnd.python.traceback",
          data: traceback,
        },
      };
    }
  }

  const diagnostic: PythonDiagnostic = {
    severity: "error",
    message: syserrortext ?? `SAS reported an error (SYSCC=${syscc})`,
  };
  return { outcome: { succeeded: false, diagnostics: [diagnostic] } };
}

/**
 * `PROC PYTHON`, behind ADR-0015's seam.
 *
 * Constructed against a session that already exists (`connect()` performs no
 * I/O, per the interface's own contract) and run serially: `execute()` refuses
 * with `busy` while a previous run has not settled, delegated to
 * {@link SubmissionGuard} rather than tracked as a private flag — see this
 * module's doc comment.
 */
export class ProcPythonBackend implements ExecutionBackend {
  readonly id = "proc-python";

  private connected = false;
  private active: ActiveRun | undefined;
  /** `reset()`'s own abort, so {@link close} can stop it too. Separate from
   * `ActiveRun.controller`: a reset is not an `execute()` run, carries no
   * `SubmissionGuard` handle beyond its own start/end pair, and produces no
   * `ExecutionHandle` for a caller to cancel by id. */
  private resetController: AbortController | undefined;
  private runCounter = 0;
  private filerefCounter = 0;

  constructor(
    private readonly client: ComputeClient,
    private readonly session: ComputeSession,
    private readonly dialect: Dialect,
    private readonly guard: SubmissionGuard,
  ) {}

  /** Cached; performs no I/O. Stage-2 (`runtime`) always reads `"unprobed"`
   * until slice 3e exists — see `BackendCapabilities`'s own doc comment. */
  capabilities(): BackendCapabilities {
    return {
      dialect: this.dialect.id,
      deployment: this.dialect.deployment,
      runtime: "unprobed",
    };
  }

  /** Idempotent, and does not create a session — ADR-0012 owns that. */
  connect(): Promise<BackendResult<void>> {
    this.connected = true;
    return Promise.resolve({ ok: true, value: undefined });
  }

  get busy(): boolean {
    return this.active !== undefined || this.guard.isBusy();
  }

  async execute(
    program: Program,
    opts: ExecuteOptions,
  ): Promise<BackendResult<ExecutionHandle>> {
    if (!this.connected) {
      return fail({ code: "not-connected" }, "running the program");
    }
    if (this.busy) {
      return fail(
        { code: "busy", running: this.active?.id ?? "a run in another window" },
        "running the program",
      );
    }
    if (!this.guard.startSubmission()) {
      return fail(
        { code: "busy", running: "a run in another window" },
        "running the program",
      );
    }

    const run: ActiveRun = {
      id: this.nextRunId(),
      controller: new AbortController(),
      lines: [],
    };
    this.active = run;

    const relay = new OutputRelay();
    const done = this.runProgram(run, relay, program, opts).finally(() => {
      this.active = undefined;
      this.guard.endSubmission();
    });
    // `done` never rejects — every path through `runProgram` resolves a
    // `BackendResult` — but a caller exercising the right to ignore `done`
    // entirely must not be exposed to a defect in that guarantee as an
    // unhandled rejection. Same shape as `logStream.ts`'s own `void done.catch`.
    void done.catch(() => undefined);

    return {
      ok: true,
      value: { id: run.id, outputs: relay.drain(), done },
    };
  }

  async cancel(handle: ExecutionHandle): Promise<BackendResult<void>> {
    if (this.active === undefined || this.active.id !== handle.id) {
      // Already settled, or a handle this backend never issued — either way,
      // ADR-0015 requires cancelling a finished run to succeed and do nothing.
      return { ok: true, value: undefined };
    }
    return this.cancelActive(this.active);
  }

  /**
   * The one place a run is actually stopped, shared by {@link cancel} — which
   * has a handle to check against `this.active` first — and {@link close} —
   * which does not need to, because it is stopping whatever is running
   * regardless of which handle a caller might name.
   */
  private async cancelActive(run: ActiveRun): Promise<BackendResult<void>> {
    // Unconditional, and not an `else` on the branch below: `LogStream.cancel`
    // is a documented no-op once the job is `finished` — which `logStream.ts`
    // sets the instant the poll observes a terminal state, *before* the
    // trailing drain and long before `runProgram` gets to reading `SYSCC`. A
    // cancel arriving in that window would otherwise do nothing at all and
    // still report success, while `runProgram` went on to resolve `done` with
    // a genuine outcome instead of ADR-0015's required `cancelled` failure.
    // Aborting here reaches that whole window: `run.controller.signal` is
    // what `readVariable` is given for both the `SYSCC` and `SYSERRORTEXT`
    // reads, so an abort lands on whichever of them is still in flight, and
    // `translate()` already asks `isCurrentRunAborted()` before anything else.
    run.controller.abort();

    if (run.stream !== undefined) {
      const result = await run.stream.cancel();
      if (!result.ok) {
        return fail(
          {
            code: "backend-failed",
            detail: describeComputeProblem(result.problem),
          },
          "cancelling the run",
        );
      }
    }
    return { ok: true, value: undefined };
  }

  /** The standalone form of `freshNamespace`: destroys and reinitialises the
   * interpreter, keeping the session, its libraries and its filerefs. */
  async reset(): Promise<BackendResult<void>> {
    if (!this.connected) {
      return fail({ code: "not-connected" }, "resetting the interpreter");
    }
    if (this.busy) {
      return fail(
        { code: "busy", running: this.active?.id ?? "a run in another window" },
        "resetting the interpreter",
      );
    }
    if (!this.guard.startSubmission()) {
      return fail(
        { code: "busy", running: "a run in another window" },
        "resetting the interpreter",
      );
    }

    const controller = new AbortController();
    this.resetController = controller;

    try {
      const job = await createJob(
        this.client,
        this.session,
        [RESTART_STATEMENT],
        { signal: controller.signal },
      );
      if (!job.ok) {
        return this.translate(job, "resetting the interpreter", false);
      }

      const stream = streamJobLog(this.client, job.value, {
        signal: controller.signal,
      });
      // `proc python restart;` alone runs no Python; its log is not worth
      // surfacing here, so it is drained rather than forwarded anywhere.
      await drainEvents(stream.events);

      const ended = await stream.done;
      if (!ended.ok)
        return this.translate(ended, "resetting the interpreter", false);
      if (ended.value.outcome === "cancelled") {
        return fail({ code: "cancelled" }, "resetting the interpreter");
      }
      return { ok: true, value: undefined };
    } finally {
      this.resetController = undefined;
      this.guard.endSubmission();
    }
  }

  /**
   * Cancels whatever is in flight, then disconnects.
   *
   * ADR-0015 gives `close` no result to return, but a caller closing the
   * backend has, by definition, stopped waiting on any run it had going — the
   * same reasoning `logStream.ts`'s own `cancel()` doc gives for stopping
   * rather than abandoning a request in flight. Releases nothing else of its
   * own: the session's lifetime belongs to `ComputeSessionManager` (ADR-0012).
   */
  async close(): Promise<void> {
    if (this.active !== undefined) {
      // The result is logged, not returned — `close()`'s own contract — and
      // there is nothing more useful to do with a failure to cancel a run
      // that is being abandoned either way.
      await this.cancelActive(this.active);
    }
    // `reset()` has no `ExecutionHandle` and no entry in `this.active` — it is
    // not an `execute()` run — but it is still in-flight work this backend
    // holds, and `close()`'s own contract is to stop whatever that is. The
    // abort resolves `reset()`'s pending `createJob`/`streamJobLog` calls with
    // a `cancelled` failure via `isCurrentRunAborted()`; there is nothing here
    // to await, since `reset()` itself is what unwinds and releases the guard.
    this.resetController?.abort();
    this.connected = false;
  }

  /**
   * The whole of one run, from upload through the outcome.
   *
   * Never rejects: every failure path returns a `BackendResult`, so `execute`'s
   * `done` can be awaited without a `try`, matching `ExecutionHandle`'s own
   * contract.
   */
  private async runProgram(
    run: ActiveRun,
    relay: OutputRelay,
    program: Program,
    opts: ExecuteOptions,
  ): Promise<BackendResult<ExecutionOutcome>> {
    try {
      const filerefName = this.nextFilerefName();
      const fileref = await createFileref(
        this.client,
        this.session,
        filerefName,
        {
          signal: run.controller.signal,
        },
      );
      if (!fileref.ok)
        return this.translate(fileref, "running the program", true);

      const written = await writeFilerefContent(
        this.client,
        fileref.value,
        program.bytes,
        { signal: run.controller.signal },
      );
      if (!written.ok)
        return this.translate(written, "running the program", true);

      const statement = opts.freshNamespace
        ? `proc python restart infile=${filerefName};`
        : `proc python infile=${filerefName};`;

      const job = await createJob(this.client, this.session, [statement], {
        signal: run.controller.signal,
      });
      if (!job.ok) return this.translate(job, "running the program", false);

      const stream = streamJobLog(this.client, job.value, {
        signal: run.controller.signal,
      });
      run.stream = stream;

      for await (const event of stream.events) {
        if (event.kind === "dropped") {
          relay.push({
            mime: "text/plain",
            data: `[${String(event.lines)} log line(s) dropped]\n`,
          });
          continue;
        }
        if (isNoiseLine(event.line.type)) continue;
        run.lines.push(event.line.line);
        relay.push({ mime: "text/plain", data: `${event.line.line}\n` });
      }

      const ended = await stream.done;
      if (!ended.ok) return this.translate(ended, "running the program", false);
      if (ended.value.outcome === "cancelled") {
        return fail({ code: "cancelled" }, "running the program");
      }

      const syscc = await readVariable(this.client, this.session, SYSCC_NAME, {
        signal: run.controller.signal,
      });
      if (!syscc.ok)
        return this.translate(syscc, "reading the run's outcome", false);
      if (syscc.value === undefined) {
        return fail(
          {
            code: "backend-failed",
            detail: `the compute session carried no "${SYSCC_NAME}" variable, which every session is expected to have`,
          },
          "reading the run's outcome",
        );
      }

      // A cancel arriving between the log settling and this read succeeding
      // would otherwise fall through to a genuine outcome below — the same
      // race `cancelActive`'s own doc comment describes, just narrowed to the
      // sliver still open after `readVariable` itself no longer fails on the
      // abort. Checked once here rather than after every return below it.
      if (this.isCurrentRunAborted()) {
        return fail({ code: "cancelled" }, "running the program");
      }

      if (syscc.value === SUCCESS_SYSCC) {
        return { ok: true, value: { succeeded: true, diagnostics: [] } };
      }

      // Best-effort: a failure here does not undo a program that did raise, so
      // the run is still reported as failed, just without the SAS-side message.
      const errorText = await readVariable(
        this.client,
        this.session,
        SYSERRORTEXT_NAME,
        { signal: run.controller.signal },
      );
      const message = errorText.ok ? errorText.value : undefined;

      const { outcome, trailingOutput } = buildFailureOutcome(
        syscc.value,
        message,
        run.lines,
      );
      if (trailingOutput !== undefined) relay.push(trailingOutput);
      return { ok: true, value: outcome };
    } finally {
      relay.close();
    }
  }

  /**
   * Translates a `ComputeFailure` into a `BackendFailure`.
   *
   * Cancellation is asked about first, the same rule `logStream.ts`'s pump
   * follows for the same reason: an aborted request fails as
   * `compute-unreachable` or similar, which is accurate for a dropped
   * connection and wrong for a user who pressed Cancel. `transferStage` picks
   * `transfer-failed` for the two upload calls — where ADR-0015 promises the
   * distinction between "the upload failed" and "the run failed" is drawn from
   * the failure value — and `backend-gone` versus `backend-failed` for
   * everything after: `session-gone` and `compute-unreachable` are the two
   * conditions a caller can recover from by connecting again, so those alone
   * become `backend-gone`.
   */
  private translate(
    result: ComputeFailure,
    context: string,
    transferStage: boolean,
  ): BackendFailure {
    if (this.isCurrentRunAborted()) {
      return fail({ code: "cancelled" }, context);
    }

    const detail = describeComputeProblem(result.problem);
    if (transferStage) {
      return fail({ code: "transfer-failed", detail }, context);
    }
    const recoverable =
      result.problem.code === "session-gone" ||
      result.problem.code === "compute-unreachable";
    return fail(
      recoverable
        ? { code: "backend-gone", detail }
        : { code: "backend-failed", detail },
      context,
    );
  }

  /**
   * Whether the run in progress was asked to cancel.
   *
   * Approximated by the current run's own `AbortSignal`, since nothing else in
   * this class ever aborts one of these calls — `ComputeClient`'s per-request
   * timeout uses a signal of its own that this class never sees, and a `signal`
   * this class did not pass is never combined into a request it made.
   */
  private isCurrentRunAborted(): boolean {
    return (
      (this.active?.controller.signal.aborted ?? false) ||
      (this.resetController?.signal.aborted ?? false)
    );
  }

  private nextRunId(): string {
    this.runCounter += 1;
    return `proc-python-run-${String(this.runCounter)}`;
  }

  /** A valid, unused-per-run SAS fileref name — `PY` plus six digits, eight
   * characters, well inside the limit. */
  private nextFilerefName(): string {
    this.filerefCounter += 1;
    return `PY${String(this.filerefCounter).padStart(6, "0")}`;
  }
}
