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
 * composing in one statement), **followed by a trailing `run;` as a second
 * statement in the same job** (ADR-0014 amendment, finding 70 — without it the
 * step never closes, and its log, `SYSCC` and any file it wrote all stay
 * unflushed), as a job (`job.ts`), stream its log (`logStream.ts`) into
 * `text/plain` output, and once the job is terminal read `SYSCC`
 * (`variables.ts`) to learn whether it raised. ADR-0014 settled why the last
 * step reads `SYSCC` rather than the job's own terminal state: finding 33
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
 * The names are a per-instance counter, `PY000001`, `PY000002`, … — which
 * only starts at `count: 0` for a session this backend opened. A window
 * reload builds a fresh backend against a session it *re-attaches* to
 * (ADR-0012), so the counter restarts while the session still holds the
 * names the previous backend assigned, and `assign` answers `400` on each
 * until the counter climbs past them (Finding 72). {@link
 * ProcPythonBackend.seedFilerefCounter} skips that whole range in one `GET`
 * on the first run after connecting; {@link
 * ProcPythonBackend.createRunFileref}'s bounded retry is the backstop for
 * what a single seed cannot cover — two windows sharing one session, each
 * counting on its own.
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
 * Turning a `LogLine` into a `RichOutput` is 3b's job now, in `logFilter.ts` —
 * ADR-0015's seam is exactly this translation, the same way 3a translates
 * `ComputeFailure` into `BackendProblem`. It shipped here first, inline,
 * because this slice could not produce any visible output at all without
 * deciding *something* about which log lines were noise; `logFilter.ts`'s own
 * doc comment records why that could not wait for a dedicated slice and what
 * moved once one existed. This module now calls into it rather than carrying
 * its own copy of `isNoiseLine` or the line-to-`RichOutput` mapping.
 *
 * ## Rich output is a directory diff, not a channel this module parses
 *
 * A matplotlib figure or a DataFrame's HTML repr never travels through the
 * log at all (ADR-0019, slice 3c-i): `runProgram` lists the session's working
 * directory before creating the job and again after it settles without being
 * cancelled, and `richOutput.ts`'s pure `selectRichOutputCandidates` decides
 * which of whatever changed is worth surfacing. This module's own part is
 * exactly the I/O `richOutput.ts` cannot perform itself — list, fetch,
 * delete, and push the result to the relay in the order the ADR gives — never
 * the diff/whitelist/decode policy, which stays in that module for the same
 * "own module, fixture-tested independent of a real Compute client" reason
 * `logFilter.ts` is split out from this one.
 *
 * ## Traceback wrapper frames are dropped here; editor-position mapping is not
 *
 * 3a shipped `parseTraceback` reading every frame exactly as the runtime
 * printed it, unfiltered — deliberately, since ADR-0014's finding 39 and
 * `backend.ts`'s own (then-)`TracebackFrame.file` doc disagreed about whether
 * 3b or 3c owned dropping the two `<stdin>` harness frames above the user's
 * own, and neither assigned it to 3a.
 *
 * **3c-ii settles it:** `parseTraceback` now drops the harness's `<stdin>`
 * frames itself — **only the leading run of them**, stopping at the first
 * frame that is not one. A plain by-name filter shipped first and was wrong:
 * an automated review caught that the user's own code can produce a frame
 * labelled `<stdin>` too (`compile(src, "<stdin>", "exec")` and similar), and
 * such a frame always sits below at least one real frame, never at the top —
 * see {@link WRAPPER_FRAME_FILE}'s own doc comment for the full reasoning.
 * What is still not done here is mapping a remaining frame's line number back
 * to a `ProgramOrigin`. That might read as though `backend.ts`'s original doc
 * assigned it to 3c too, but `logFilter.ts`'s own doc and `phase-3.md`'s
 * Phase 4 plan text already pointed at Phase 4 for it, and `backend.ts`'s
 * comment has been corrected to match rather than left disagreeing.
 *
 * ## What this backend does not attempt
 *
 * `execute()`/`reset()` still never report `unsupported` or
 * `runtime-unavailable` themselves: a session that cannot run `PROC PYTHON` at
 * all fails `createJob` or the run itself with whatever `ComputeFailure` the
 * deployment actually gives, translated to `backend-failed` like any other —
 * a plainer message than a dedicated one, and an honest one, since neither of
 * those two call sites has ever seen the real wire shape of "no such
 * procedure" to word it better.
 *
 * **3e's `probeRuntime()` is the one place this backend does report
 * `runtime-unavailable`**, and only from one signal: its own fixed probe
 * script (`environment.ts`) failing with a non-zero `SYSCC`. That script is
 * never user input and has been run successfully against a live Viya 4
 * (`docs/phases/phase-3.md`'s 3e entry), so a failure there is read as
 * evidence about the runtime rather than a bug in the probe — still not a
 * measurement of what an unlicensed or missing `PROC PYTHON` actually looks
 * like on the wire (no deployment lacking it has ever been available to this
 * project), just the most honest available signal for it.
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
  type RuntimeCapabilities,
  type Traceback,
  type TracebackFrame,
} from "./backend";
import {
  ENVIRONMENT_PROBE_FILENAME,
  environmentProbeStatements,
  MAX_ENVIRONMENT_PROBE_BYTES,
  parseEnvironmentProbeFile,
} from "./environment";
import { droppedLinesOutput, isNoiseLine, logLineOutput } from "./logFilter";
import { type BackendFailure, type BackendResult, fail } from "./problems";
import {
  SYNTHESIZED_TRACEBACK_MESSAGE,
  withModuleNotFoundGuidance,
} from "./tracebackDiagnostics";
import {
  decodeRichOutput,
  exceedsCaptureCap,
  MAX_CAPTURE_BYTES,
  selectRichOutputCandidates,
  skippedCaptureOutput,
} from "./richOutput";

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResult,
} from "../compute/client";
import {
  createFileref,
  type Fileref,
  listFilerefNames,
  writeFilerefContent,
} from "../compute/fileref";
import {
  deleteSessionFile,
  listSessionFiles,
  readFileContent,
  type SessionFile,
} from "../compute/files";
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
 * nothing else in the session). Exported so a test double can recognise a
 * `reset()`-submitted job without restating the literal — see
 * `test/helpers/recorded-proc-python.ts`. */
export const RESTART_STATEMENT = "proc python restart;";

const TRACEBACK_HEADER = "Traceback (most recent call last):";

/**
 * The interpreter's own prompt markers, as bare lines. On the error path
 * `PROC PYTHON` interleaves these with the log (Finding 74): they arrive typed
 * `normal`, so `logFilter.ts` correctly forwards them, and a run of them
 * brackets the traceback — right where {@link parseTraceback} would otherwise
 * sweep them into the exception message.
 *
 * A run of them is stripped from **each end** of the message tail; the
 * interior is never touched, so a real exception message that embeds a REPL
 * or doctest transcript (or a numpy row-elision line that trims to exactly
 * `...`) keeps every line between its first and last. Matched as a whole
 * trimmed line (`">>> "` trims to `">>>"`, `"..."` is the continuation
 * prompt), never as a substring, so `raise Exception(">>>")` →
 * `Exception: >>>` survives.
 *
 * The ends are not risk-free — a multi-line exception message whose *own*
 * first or last physical line is exactly `>>>` / `...` (e.g.
 * `raise ValueError("x\n...")`) loses that line here. Accepted: such messages
 * are near-nonexistent, `PROC PYTHON`'s error-path prompt emission is
 * demonstrably irregular (runs of `>>>`, not always one), and the alternative
 * — leaving a bare prompt marker glued to the exception message — is the
 * exact defect Finding 74 is closing.
 *
 * Not a general output filter — the live transcript still shows these; this is
 * scoped to the one place already parsing a known traceback shape.
 */
const PROMPT_LINES: ReadonlySet<string> = new Set([">>>", "..."]);

/** `  File "<name>", line <n>, in <name>` — the one shape finding 39 measured. */
const FRAME_PATTERN = /^ {2}File "(.*)", line (\d+), in (.+)$/;

/** The file label `PROC PYTHON`'s own harness prints for the frames it wraps
 * around the user's code (finding 39) — always the leading run at the very
 * top of the stack, immediately after the header.
 *
 * **Not exclusive to the harness.** An earlier version of this comment
 * claimed the user's own code could never produce this label, reasoning from
 * how the *outer* program reaches the interpreter (`infile=`, ADR-0014) —
 * true for the outer program, and wrong in general: user code that itself
 * calls `compile(src, "<stdin>", "exec")` (or `eval`/`exec` against a code
 * object built that way) can raise from a frame the runtime labels `<stdin>`
 * too, and such a frame always sits *below* at least one non-harness frame,
 * never at the very top. Caught by an automated review before this shipped —
 * `parseTraceback` therefore drops only the **leading contiguous run** of
 * `<stdin>` frames, stopping at the first frame that is not one, rather than
 * dropping every frame with this label wherever it appears. */
const WRAPPER_FRAME_FILE = "<stdin>";

/** `PY` and exactly six digits — what {@link ProcPythonBackend.nextFilerefName}
 * produces. Matched the other way here to read an existing fileref's number
 * back when seeding the counter from a reattached session (Finding 72). */
const FILEREF_NAME_PATTERN = /^PY(\d{6})$/i;

/** How many fileref names one run will try before giving up.
 *
 * {@link ProcPythonBackend.seedFilerefCounter} normally skips a reattached
 * session's existing `PYnnnnnn` filerefs in a single request, so this bounded
 * retry only ever engages for the residual case: two windows sharing one
 * session (ADR-0012), each with its own counter, drifting onto the same name,
 * or a seed request that failed. Sixteen is far more than that race can
 * realistically need and still a hard stop, so a deployment that answers
 * every `assign` with a `4xx` for some unrelated reason fails the run rather
 * than looping. */
const MAX_FILEREF_ASSIGN_ATTEMPTS = 16;

/**
 * Whether a failed `createFileref` is worth retrying under a different name.
 *
 * `createFileref`'s only per-call variable this backend does not fully
 * control is the fileref `name` — the session link and the `{ name, path }`
 * body shape are fixed — so a `4xx` from the `assign` `POST` (most often
 * `400`, "the fileref … already exists") means *that name* is unusable, and
 * advancing to the next one is the fix. A `404` is already remapped to
 * `session-gone` by `fileref.ts`, `401`/`403` carry their own codes, and a
 * `5xx` or a transport failure is not something a new name would change —
 * none of those match here, so all of them fall through to `translate`.
 */
function isRetriableFilerefName(failure: ComputeFailure): boolean {
  const { problem } = failure;
  return (
    problem.code === "compute-rejected" &&
    problem.error.status >= 400 &&
    problem.error.status < 500
  );
}

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

/**
 * Reads a raw Python traceback out of the run's forwarded log lines.
 *
 * Looks for the **last** `Traceback (most recent call last):` line — a run
 * whose own output happens to print that sentence would otherwise be
 * misparsed at an earlier, wrong occurrence — then reads consecutive frame
 * lines until one does not match, and takes what remains, joined, as the
 * exception message. The harness's own {@link WRAPPER_FRAME_FILE} frames are
 * dropped before the result is returned (3c-ii, finding 39) — **only the
 * leading run of them**, immediately after the header, never a frame with
 * that label appearing later: see {@link WRAPPER_FRAME_FILE}'s own doc for
 * why a plain by-name filter is wrong here. The remaining frames stay in the
 * order Python printed them (outermost first) and unmapped — turning a line
 * number into an editor position is Phase 4's job, not this one's (see this
 * module's doc comment).
 *
 * Returns `undefined` if no traceback header is found, or if it is found with
 * no frame lines at all following it — both mean the log does not carry the
 * shape this parser knows, and the caller falls back to `SYSERRORTEXT` alone.
 * A header followed only by the harness's leading run, with nothing after it
 * (the harness itself failing rather than the user's code), is a real,
 * different case, and is returned as a `Traceback` with an empty `frames`
 * array rather than falling back, since a header and a message were both
 * genuinely found.
 */
function parseTraceback(lines: readonly string[]): Traceback | undefined {
  const headerIndex = lines.lastIndexOf(TRACEBACK_HEADER);
  if (headerIndex === -1) return undefined;

  const rawFrames: TracebackFrame[] = [];
  let cursor = headerIndex + 1;
  for (; cursor < lines.length; cursor += 1) {
    const match = FRAME_PATTERN.exec(lines[cursor] ?? "");
    if (match === null) break;
    const [, file, lineText, name] = match;
    rawFrames.push({
      file: file ?? "",
      line: Number(lineText ?? "0"),
      name: (name ?? "").trim(),
    });
  }
  if (rawFrames.length === 0) return undefined;

  // Only the *leading* run of `WRAPPER_FRAME_FILE` frames is the harness's —
  // stop dropping at the first frame that isn't one, so a `<stdin>` frame the
  // user's own code produces (e.g. via `compile(src, "<stdin>", "exec")`),
  // which can only ever appear below a real frame, survives untouched.
  let wrapperCount = 0;
  while (
    wrapperCount < rawFrames.length &&
    rawFrames[wrapperCount]?.file === WRAPPER_FRAME_FILE
  ) {
    wrapperCount += 1;
  }
  const frames = rawFrames.slice(wrapperCount);

  const tailLines = lines
    .slice(cursor)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  // Strip a run of bare `>>>` / `...` prompt markers from each end of the
  // tail — see {@link PROMPT_LINES} for why only the ends.
  let first = 0;
  let last = tailLines.length;
  while (first < last && PROMPT_LINES.has(tailLines[first] ?? "")) first += 1;
  while (last > first && PROMPT_LINES.has(tailLines[last - 1] ?? "")) last -= 1;
  const messageLines = tailLines.slice(first, last);
  const message =
    messageLines.length > 0
      ? messageLines.join(" ")
      : SYNTHESIZED_TRACEBACK_MESSAGE;

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
        // Phase 4c, `phase-3.md`'s 3e entry: point a `ModuleNotFoundError`
        // at `probeRuntime()`'s cached package list. Only the diagnostic
        // gets the appended guidance — `trailingOutput.data` below stays
        // `traceback` unmodified, since that structured value is 4d's
        // result-panel payload and must read exactly as Python printed it.
        message: withModuleNotFoundGuidance(traceback.message),
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
  /** {@link probeRuntime}'s own abort, so {@link close} can stop it too —
   * same reasoning as {@link resetController}: a probe is not an `execute()`
   * run and produces no `ExecutionHandle` for a caller to cancel by id. */
  private probeController: AbortController | undefined;
  /** What {@link capabilities} reports for `runtime`. Starts `"unprobed"` and
   * only ever changes inside {@link probeRuntime}, on success — a probe that
   * *fails* leaves whatever was here untouched, so a successful probe followed
   * by a failed re-probe keeps reporting the earlier `"available"` snapshot.
   * `RuntimeCapabilities` has no cached "unavailable" member to move it to;
   * the failure is returned to {@link probeRuntime}'s caller instead. See that
   * type's doc comment in `backend.ts` for why, and the interface's
   * {@link probeRuntime} doc for what a consumer must do about it. */
  private runtime: RuntimeCapabilities = { kind: "unprobed" };
  private runCounter = 0;
  private filerefCounter = 0;
  /** Set once {@link seedFilerefCounter} has read the session's fileref
   * collection back successfully, so the `GET` it makes happens at most once
   * per connection rather than before every run. A failed or cancelled
   * listing leaves this `false` so the next run retries — see
   * {@link seedFilerefCounter}. */
  private filerefCounterSeeded = false;

  constructor(
    private readonly client: ComputeClient,
    private readonly session: ComputeSession,
    private readonly dialect: Dialect,
    private readonly guard: SubmissionGuard,
    /**
     * Where {@link close} reports a cancellation it could not act on, since
     * `ExecutionBackend.close()`'s own contract returns no result — "logged,
     * not returned." A narrow callback rather than `vscode.LogOutputChannel`
     * itself, for the same reason {@link SubmissionGuard} is a narrow port
     * onto `ComputeSessionManager` and not that class directly: this module
     * must never import `vscode` (see its own header) or it leaves the unit
     * coverage denominator (ADR-0009). Optional, and a no-op when absent, so
     * every existing construction of this class keeps working unchanged.
     */
    private readonly onBackgroundFailure?: (reason: string) => void,
    /**
     * Overrides `streamJobLog`'s buffer caps (`logStream.ts`'s
     * `DEFAULT_MAX_BUFFERED_LINES`/`_CHARACTERS`), for one reason only: the
     * "dropped log lines" forwarding branch below cannot otherwise be
     * exercised inside `.mocharc.json`'s 2-second unit-test budget, since the
     * real default is 100,000 lines. **Not part of `ExecutionBackend` or
     * `ExecuteOptions`** — this is not a capability a caller or a dialect
     * chooses, it is a test seam local to this implementation, the same way
     * {@link onBackgroundFailure} is. Absent in every real construction of
     * this class; a test double is the only caller that has a reason to set
     * it small.
     */
    private readonly logBufferLimits?: {
      readonly maxBufferedLines?: number;
      readonly maxBufferedCharacters?: number;
    },
  ) {}

  /** Cached; performs no I/O. `runtime` reads `this.runtime`, which only
   * {@link probeRuntime} ever updates, and only on success. */
  capabilities(): BackendCapabilities {
    return {
      dialect: this.dialect.id,
      deployment: this.dialect.deployment,
      runtime: this.runtime,
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

  // Not `async`: every branch below returns synchronously (a plain
  // `BackendFailure`, or a handle built without awaiting anything), so there
  // is no `await` for the function body to contain. `Promise.resolve` on each
  // return is what keeps the declared `Promise<...>` return type honest.
  execute(
    program: Program,
    opts: ExecuteOptions,
  ): Promise<BackendResult<ExecutionHandle>> {
    if (!this.connected) {
      return Promise.resolve(
        fail({ code: "not-connected" }, "running the program"),
      );
    }
    if (this.busy) {
      return Promise.resolve(
        fail(
          {
            code: "busy",
            running: this.active?.id ?? "a run in another window",
          },
          "running the program",
        ),
      );
    }
    if (!this.guard.startSubmission()) {
      return Promise.resolve(
        fail(
          { code: "busy", running: "a run in another window" },
          "running the program",
        ),
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

    return Promise.resolve({
      ok: true,
      value: { id: run.id, outputs: relay.drain(), done },
    });
  }

  async cancel(handle: ExecutionHandle): Promise<BackendResult<void>> {
    if (this.active?.id !== handle.id) {
      // Already settled, or a handle this backend never issued — either way,
      // ADR-0015 requires cancelling a finished run to succeed and do nothing.
      return { ok: true, value: undefined };
    }
    return await this.cancelActive(this.active);
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
      // ADR-0014 amendment, finding 70: same reasoning as `runProgram`'s own
      // trailing `run;` — without it, this step never closes either, and
      // `readSyscc` below would be reading a session that has not actually
      // finished restarting.
      const job = await createJob(
        this.client,
        this.session,
        [RESTART_STATEMENT, "run;"],
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

      // The bug ADR-0014/finding 33 already closed for `execute()`: a job's
      // own terminal state is `completed` even when the statement never ran
      // (a poisoned session, a missing license), so `reset()` cannot trust it
      // either. `readSyscc` is the same check `runProgram` makes; this caller
      // has no diagnostics channel of its own, so a failing `SYSCC` is just a
      // `backend-failed` with whatever `SYSERRORTEXT` said, or a plain
      // fallback naming the code when it said nothing.
      const sysccResult = await this.readSyscc(
        controller.signal,
        "resetting the interpreter",
      );
      if (!sysccResult.ok) return sysccResult;
      if (sysccResult.value.succeeded) {
        return { ok: true, value: undefined };
      }
      return fail(
        {
          code: "backend-failed",
          detail:
            sysccResult.value.message ??
            `SAS reported an error while restarting the interpreter (SYSCC=${sysccResult.value.syscc})`,
        },
        "resetting the interpreter",
      );
    } finally {
      this.resetController = undefined;
      this.guard.endSubmission();
    }
  }

  /**
   * Stage-2 capability probing (3e): runs `environment.ts`'s fixed probe
   * program, fetches the file it wrote, and — on success — updates
   * {@link capabilities}'s `runtime`.
   *
   * Shaped like {@link reset} rather than {@link runProgram}: the probe's
   * statements are submitted directly via `createJob`, with no fileref
   * upload, because `environment.ts`'s source is this project's own fixed
   * text, never user input (see that module's own doc comment for why
   * ADR-0014's upload/`infile=` discipline does not apply to it). Its log is
   * drained rather than forwarded — the probe's answer is the file it wrote,
   * not anything it printed — the same choice `reset()` already makes for
   * `RESTART_STATEMENT`'s own log.
   */
  async probeRuntime(): Promise<BackendResult<RuntimeCapabilities>> {
    if (!this.connected) {
      return fail({ code: "not-connected" }, "probing the Python runtime");
    }
    if (this.busy) {
      return fail(
        {
          code: "busy",
          running: this.active?.id ?? "a run in another window",
        },
        "probing the Python runtime",
      );
    }
    if (!this.guard.startSubmission()) {
      return fail(
        { code: "busy", running: "a run in another window" },
        "probing the Python runtime",
      );
    }

    const controller = new AbortController();
    this.probeController = controller;

    try {
      const job = await createJob(
        this.client,
        this.session,
        // The trailing `run;` closes the step for the same reason
        // `runProgram`'s own does (ADR-0014 amendment, finding 70) — without
        // it, the file this probe writes is never flushed.
        [...environmentProbeStatements(), "run;"],
        { signal: controller.signal },
      );
      if (!job.ok) {
        return this.translate(job, "probing the Python runtime", false);
      }

      const stream = streamJobLog(this.client, job.value, {
        signal: controller.signal,
      });
      await drainEvents(stream.events);

      const ended = await stream.done;
      if (!ended.ok) {
        return this.translate(ended, "probing the Python runtime", false);
      }
      if (ended.value.outcome === "cancelled") {
        return fail({ code: "cancelled" }, "probing the Python runtime");
      }

      const sysccResult = await this.readSyscc(
        controller.signal,
        "probing the Python runtime",
      );
      if (!sysccResult.ok) return sysccResult;
      if (!sysccResult.value.succeeded) {
        // See this module's own doc comment ("What this backend does not
        // attempt"): the probe is this project's own fixed script, so a
        // failure here is read as evidence about the runtime, not a bug to
        // recover from.
        return fail(
          {
            code: "runtime-unavailable",
            detail:
              sysccResult.value.message ??
              `SAS reported an error while probing the Python runtime (SYSCC=${sysccResult.value.syscc})`,
          },
          "probing the Python runtime",
        );
      }

      const files = await listSessionFiles(this.client, this.session, {
        signal: controller.signal,
      });
      if (!files.ok) {
        return this.translate(files, "probing the Python runtime", false);
      }

      const probeFile = files.value.find(
        (file) => file.name === ENVIRONMENT_PROBE_FILENAME,
      );
      if (probeFile === undefined) {
        return fail(
          {
            code: "backend-failed",
            detail: `the environment probe reported success but left no "${ENVIRONMENT_PROBE_FILENAME}" file behind`,
          },
          "probing the Python runtime",
        );
      }

      const content = await readFileContent(this.client, probeFile, {
        signal: controller.signal,
        // Explicit, for the same file-fetch discipline `captureRichOutput`
        // applies with `MAX_CAPTURE_BYTES` — see
        // `MAX_ENVIRONMENT_PROBE_BYTES`'s own doc for why the probe's answer
        // is capped here rather than left to the transport default.
        maxBytes: MAX_ENVIRONMENT_PROBE_BYTES,
      });
      if (!content.ok) {
        return this.translate(content, "probing the Python runtime", false);
      }

      // Best-effort, like `captureRichOutput`'s own deletion: a leaked probe
      // file is a much smaller problem than failing an otherwise-successful
      // probe over its own cleanup step.
      const deleted = await deleteSessionFile(this.client, probeFile, {
        signal: controller.signal,
      });
      if (!deleted.ok) {
        this.onBackgroundFailure?.(
          `could not delete the environment probe's own file "${ENVIRONMENT_PROBE_FILENAME}": ${deleted.reason}`,
        );
      }

      if (this.isCurrentRunAborted()) {
        return fail({ code: "cancelled" }, "probing the Python runtime");
      }

      const parsed = parseEnvironmentProbeFile(content.value);
      if (parsed === undefined) {
        return fail(
          {
            code: "backend-failed",
            detail:
              "the environment probe's own file did not parse as the shape it always produces",
          },
          "probing the Python runtime",
        );
      }

      this.runtime = parsed;
      return { ok: true, value: parsed };
    } finally {
      this.probeController = undefined;
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
      const result = await this.cancelActive(this.active);
      if (!result.ok) {
        // `close()`'s own contract (ADR-0015) returns no result to a
        // caller — "logged, not returned" — and a caller invoking `close()`
        // has, by definition, stopped waiting on anything this call could
        // hand back. `onBackgroundFailure` is what actually makes this
        // "logged" true rather than merely claimed: when the constructor
        // was given one, the failure reaches it; when not (every test
        // double in this repository today), it is still discarded, same as
        // before this callback existed.
        this.onBackgroundFailure?.(result.reason);
      }
    }
    // `reset()` has no `ExecutionHandle` and no entry in `this.active` — it is
    // not an `execute()` run — but it is still in-flight work this backend
    // holds, and `close()`'s own contract is to stop whatever that is. The
    // abort resolves `reset()`'s pending `createJob`/`streamJobLog` calls with
    // a `cancelled` failure via `isCurrentRunAborted()`; there is nothing here
    // to await, since `reset()` itself is what unwinds and releases the guard.
    this.resetController?.abort();
    // Same reasoning, for `probeRuntime()`: no `ExecutionHandle`, no entry in
    // `this.active`, still in-flight work `close()` must stop.
    this.probeController?.abort();
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
      const created = await this.createRunFileref(run);
      if (!created.ok) return created;
      const { fileref, name: filerefName } = created.value;

      const written = await writeFilerefContent(
        this.client,
        fileref,
        program.bytes,
        { signal: run.controller.signal },
      );
      if (!written.ok)
        return this.translate(written, "running the program", true);

      const statement = opts.freshNamespace
        ? `proc python restart infile=${filerefName};`
        : `proc python infile=${filerefName};`;

      // ADR-0019 point 1: listed now, immediately before the job that might
      // change it — not earlier, alongside the fileref upload above, which
      // touches a session's `filerefs` collection rather than its working
      // directory and has no bearing on this diff either way.
      const filesBefore = await listSessionFiles(this.client, this.session, {
        signal: run.controller.signal,
      });

      // ADR-0014 amendment, finding 70: without a trailing `run;`, the step
      // never closes, so its log, `SYSCC` and any file it wrote all stay
      // unflushed — invisible to every request this run makes — until some
      // later, unrelated request happens to close it. `run;` is filtered as
      // noise the same way the wrapping statement's own source echo already
      // is (`logFilter.ts`'s `isNoiseLine` excludes every `source`-typed
      // line), so nothing downstream of this changes to accommodate it.
      const job = await createJob(
        this.client,
        this.session,
        [statement, "run;"],
        { signal: run.controller.signal },
      );
      if (!job.ok) return this.translate(job, "running the program", false);

      const stream = streamJobLog(this.client, job.value, {
        signal: run.controller.signal,
        maxBufferedLines: this.logBufferLimits?.maxBufferedLines,
        maxBufferedCharacters: this.logBufferLimits?.maxBufferedCharacters,
      });
      run.stream = stream;

      for await (const event of stream.events) {
        if (event.kind === "dropped") {
          relay.push(droppedLinesOutput(event.lines));
          continue;
        }
        if (isNoiseLine(event.line.type)) continue;
        run.lines.push(event.line.line);
        relay.push(logLineOutput(event.line));
      }

      const ended = await stream.done;
      if (!ended.ok) return this.translate(ended, "running the program", false);
      if (ended.value.outcome === "cancelled") {
        return fail({ code: "cancelled" }, "running the program");
      }

      const sysccResult = await this.readSyscc(
        run.controller.signal,
        "running the program",
      );
      if (!sysccResult.ok) return sysccResult;

      let outcome: ExecutionOutcome;
      if (sysccResult.value.succeeded) {
        outcome = { succeeded: true, diagnostics: [] };
      } else {
        const built = buildFailureOutcome(
          sysccResult.value.syscc,
          sysccResult.value.message,
          run.lines,
        );
        outcome = built.outcome;
        if (built.trailingOutput !== undefined)
          relay.push(built.trailingOutput);
      }

      // ADR-0019: reached only once a genuine `ExecutionOutcome` is about to
      // be returned — never for a cancelled run (the early return above) and
      // never for a run that failed before producing one (every earlier
      // `return` in this method). That is the same "no outcome, no capture"
      // rule the ADR states for cancellation, extended to the one case it
      // does not itself name.
      await this.captureRichOutput(run, relay, filesBefore);

      // The same race `readSyscc`'s own two checks guard against, widened:
      // capture adds a listing call and, per candidate, a fetch and a delete,
      // all after `outcome` is already built — a much larger window than the
      // single network call `readSyscc` was closing, for a cancel that lands
      // after the program's own result is already known but before `done`
      // resolves. Without this check, `cancelActive` would report success
      // while the run still settled with a genuine, non-`cancelled` outcome —
      // the same wrong shape `readSyscc`'s comment describes, here reached
      // through capture rather than through the SYSCC read itself. It does
      // not undo anything capture already did (a pushed `RichOutput`, a
      // deleted file): only the outcome this call resolves with changes.
      if (this.isCurrentRunAborted()) {
        return fail({ code: "cancelled" }, "running the program");
      }

      return { ok: true, value: outcome };
    } finally {
      relay.close();
    }
  }

  /**
   * ADR-0019's mechanism: list the working directory again now that the job
   * has settled without being cancelled, diff against `filesBefore`, and push
   * each whitelisted candidate's `RichOutput` to the relay — decoded and,
   * once pushed, deleted; skipped and left undeleted if it exceeds
   * `richOutput.ts`'s cap or cannot be fetched. Never fails the run: every
   * failure here reaches `onBackgroundFailure` or becomes a `text/plain` skip
   * note, the same "best-effort, report honestly" shape `readSyscc` already
   * gives a failing `SYSERRORTEXT` read.
   *
   * `filesBefore` failing is a case ADR-0019 does not name — its worked
   * example assumes the pre-run listing succeeds. This reading extends the
   * ADR's own "no outcome, no capture" logic for a cancelled run: without a
   * baseline there is nothing to diff, so the whole step is skipped rather
   * than fabricating one against an empty listing, which would misreport
   * every file already in the directory as newly created.
   */
  private async captureRichOutput(
    run: ActiveRun,
    relay: OutputRelay,
    filesBefore: ComputeResult<readonly SessionFile[]>,
  ): Promise<void> {
    if (!filesBefore.ok) {
      this.onBackgroundFailure?.(
        `could not list the session's working directory before the run, so no rich output could be captured for it: ${filesBefore.reason}`,
      );
      return;
    }

    const filesAfter = await listSessionFiles(this.client, this.session, {
      signal: run.controller.signal,
    });
    if (!filesAfter.ok) {
      this.onBackgroundFailure?.(
        `could not list the session's working directory after the run, so no rich output could be captured for it: ${filesAfter.reason}`,
      );
      return;
    }

    const candidates = selectRichOutputCandidates(
      filesBefore.value,
      filesAfter.value,
    );

    for (const candidate of candidates) {
      if (exceedsCaptureCap(candidate.file)) {
        relay.push(
          skippedCaptureOutput(
            candidate.file.name,
            `it is larger than the ${String(MAX_CAPTURE_BYTES)}-byte capture limit`,
          ),
        );
        continue;
      }

      const content = await readFileContent(this.client, candidate.file, {
        signal: run.controller.signal,
        maxBytes: MAX_CAPTURE_BYTES,
      });
      if (!content.ok) {
        relay.push(
          skippedCaptureOutput(
            candidate.file.name,
            describeComputeProblem(content.problem),
          ),
        );
        continue;
      }

      relay.push(decodeRichOutput(candidate.mime, content.value));

      // ADR-0019 point 9: a failed deletion is logged, not surfaced or
      // retried, the same shape `close()`'s `onBackgroundFailure` already
      // gives a cancellation that could not be acted on — a leaked file is a
      // much smaller problem than failing an otherwise-successful run over
      // its own cleanup step. Point 10: a *skipped* file (the two arms above)
      // is never deleted at all — only a capture this backend actually read
      // is assumed safe to discard.
      const deleted = await deleteSessionFile(this.client, candidate.file, {
        signal: run.controller.signal,
      });
      if (!deleted.ok) {
        this.onBackgroundFailure?.(
          `could not delete captured rich-output file "${candidate.file.name}": ${deleted.reason}`,
        );
      }
    }
  }

  /**
   * Reads `SYSCC` once a job is known terminal and not cancelled — and,
   * if it is non-zero, `SYSERRORTEXT` too — checking for a cancel race after
   * each read. Shared by {@link runProgram}, which turns a failing `SYSCC`
   * into diagnostics (and, for `1012`, a traceback) via `buildFailureOutcome`,
   * and by {@link reset}, which has no diagnostics channel of its own and
   * only needs to know whether the restart itself succeeded — the same
   * question, asked by two different callers with two different uses for the
   * answer.
   *
   * ADR-0014/finding 33 is why this is read at all rather than trusted from
   * the job's own terminal state: `completed` does not mean the statement
   * ran, so both `execute()` and `reset()` confirm it here instead.
   */
  private async readSyscc(
    signal: AbortSignal,
    context: string,
  ): Promise<
    BackendResult<
      | { succeeded: true }
      | { succeeded: false; syscc: string; message: string | undefined }
    >
  > {
    const syscc = await readVariable(this.client, this.session, SYSCC_NAME, {
      signal,
    });
    if (!syscc.ok) return this.translate(syscc, context, false);
    if (syscc.value === undefined) {
      return fail(
        {
          code: "backend-failed",
          detail: `the compute session carried no "${SYSCC_NAME}" variable, which every session is expected to have`,
        },
        context,
      );
    }

    // A cancel arriving between the log settling and this read succeeding
    // would otherwise fall through to a genuine outcome below — the same
    // race `cancelActive`'s own doc comment describes, just narrowed to the
    // sliver still open after `readVariable` itself no longer fails on the
    // abort. Checked once here rather than after every return below it.
    if (this.isCurrentRunAborted()) {
      return fail({ code: "cancelled" }, context);
    }

    if (syscc.value === SUCCESS_SYSCC) {
      return { ok: true, value: { succeeded: true } };
    }

    // Best-effort: a failure here does not undo a program that did raise, so
    // the run is still reported as failed, just without the SAS-side message.
    const errorText = await readVariable(
      this.client,
      this.session,
      SYSERRORTEXT_NAME,
      { signal },
    );
    const message = errorText.ok ? errorText.value : undefined;

    // The same check as above the `SUCCESS_SYSCC` branch, repeated rather
    // than hoisted above both reads: a cancel can just as well land during
    // *this* network call as during the first one, and an asymmetry where
    // only the success path closed the window was a real gap — found on
    // review, and low-impact only because `SYSCC` had already confirmed a
    // genuine failure by this point, not because the race can't happen.
    if (this.isCurrentRunAborted()) {
      return fail({ code: "cancelled" }, context);
    }

    return {
      ok: true,
      value: { succeeded: false, syscc: syscc.value, message },
    };
  }

  /**
   * Translates a `ComputeFailure` into a `BackendFailure`.
   *
   * Cancellation is asked about first, the same rule `logStream.ts`'s pump
   * follows for the same reason: an aborted request fails as
   * `compute-unreachable` or similar, which is accurate for a dropped
   * connection and wrong for a user who pressed Cancel. `session-gone` and
   * `compute-unreachable` are the two conditions a caller can recover from by
   * connecting again, so those alone become `backend-gone` — **checked before
   * `transferStage`**, not after. `transferStage` only decides what a
   * *non*-recoverable failure during the upload calls is named:
   * `transfer-failed`, where ADR-0015 promises the distinction between "the
   * upload failed" and "the run failed" is drawn from the failure value.
   *
   * **Fixed 2026-08-28 (Phase 3's 3f slice), a real regression from how this
   * read until then.** `transferStage` used to be checked first, so a session
   * that had already died — reaped, or signed out from underneath — turned
   * its very first request of a run (creating the fileref) into a bare
   * `transfer-failed`, the least informative member this union has, instead
   * of `backend-gone`'s "The SAS Viya session ended. Connect again and
   * re-run." The 2026-08-27 manual test pass hit exactly this: the message
   * shown for a dead session and the message shown for a real upload defect
   * (a `428`, a malformed body) were the same sentence, with no way to tell
   * them apart from the log either. `fileref.ts` already maps every one of
   * its own failures through `asSessionGone`, so `session-gone` was always
   * reachable from the transfer stage — this method just never asked.
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
    const recoverable =
      result.problem.code === "session-gone" ||
      result.problem.code === "compute-unreachable";
    if (recoverable) {
      return fail({ code: "backend-gone", detail }, context);
    }
    if (transferStage) {
      return fail({ code: "transfer-failed", detail }, context);
    }
    return fail({ code: "backend-failed", detail }, context);
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
      (this.resetController?.signal.aborted ?? false) ||
      (this.probeController?.signal.aborted ?? false)
    );
  }

  /**
   * Assigns this run's fileref, working around a reattached session that
   * still holds earlier `PYnnnnnn` names (Finding 72).
   *
   * {@link seedFilerefCounter} runs first, once per connection, moving the
   * counter past whatever the session already holds in a single `GET`. The
   * loop is the backstop for what that cannot cover — two windows sharing
   * one session (ADR-0012), each counting independently — and for a seed
   * request that failed: on a retriable `4xx` from `assign`
   * ({@link isRetriableFilerefName}) it advances to the next name and tries
   * again, up to {@link MAX_FILEREF_ASSIGN_ATTEMPTS} times. Any other
   * failure, or a cancel, returns straight away.
   */
  private async createRunFileref(
    run: ActiveRun,
  ): Promise<BackendResult<{ fileref: Fileref; name: string }>> {
    await this.seedFilerefCounter(run.controller.signal);

    let lastCollision: ComputeFailure | undefined;
    for (let attempt = 0; attempt < MAX_FILEREF_ASSIGN_ATTEMPTS; attempt += 1) {
      const name = this.nextFilerefName();
      const result = await createFileref(this.client, this.session, name, {
        signal: run.controller.signal,
      });
      if (result.ok) {
        return { ok: true, value: { fileref: result.value, name } };
      }
      if (this.isCurrentRunAborted()) {
        return fail({ code: "cancelled" }, "running the program");
      }
      if (!isRetriableFilerefName(result)) {
        return this.translate(result, "running the program", true);
      }
      lastCollision = result;
    }

    // Every attempt collided on the name. Report it the same way a single
    // collision would be (`translate(..., true)` → `transfer-failed`,
    // nothing ran), with the last attempt's detail.
    const detail =
      lastCollision === undefined
        ? `${String(MAX_FILEREF_ASSIGN_ATTEMPTS)} fileref names were all already assigned in the session`
        : `${describeComputeProblem(lastCollision.problem)} (${String(MAX_FILEREF_ASSIGN_ATTEMPTS)} names tried, all already assigned)`;
    return fail({ code: "transfer-failed", detail }, "running the program");
  }

  /**
   * Moves {@link filerefCounter} past any `PYnnnnnn` fileref the session
   * already holds — once per connection.
   *
   * A fresh `ProcPythonBackend` starts the counter at zero. When the session
   * it was built against is one an earlier extension host already used (a
   * window reload re-attaches rather than restarts, ADR-0012), that session
   * still holds `PY000001…`, and each `createFileref` would collide until the
   * counter climbed past them by failing — Finding 72. One `GET` of the
   * fileref collection moves it past the highest number in a single step.
   *
   * Best-effort: a malformed listing (returned as an empty list by
   * {@link listFilerefNames}) leaves the counter untouched and
   * {@link createRunFileref}'s bounded retry is the fallback. This never fails
   * a run. It seeds at most once per connection, but only *after* a listing
   * actually comes back: a transient failure or a cancel during the `GET`
   * leaves the flag unset so the next run tries again, rather than disabling
   * the seed for the whole connection and falling back on a 16-attempt retry
   * that cannot walk past a reattached session holding more than 16
   * `PYnnnnnn` names. Re-seeding is safe — the counter only ever moves up
   * ({@link filerefCounter} is raised, never lowered), including past names
   * the retry loop's own `assign` calls have since consumed.
   */
  private async seedFilerefCounter(signal: AbortSignal): Promise<void> {
    if (this.filerefCounterSeeded) return;

    const listed = await listFilerefNames(this.client, this.session, {
      signal,
    });
    if (!listed.ok) return;
    this.filerefCounterSeeded = true;

    let highest = 0;
    for (const filerefName of listed.value) {
      const match = FILEREF_NAME_PATTERN.exec(filerefName);
      if (match === null) continue;
      const [, digits] = match;
      highest = Math.max(highest, Number.parseInt(digits ?? "0", 10));
    }
    if (highest > this.filerefCounter) {
      this.filerefCounter = highest;
    }
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
