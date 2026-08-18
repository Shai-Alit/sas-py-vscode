// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The self-driving log pump — ADR-0017 part 3.
 *
 * **This module must never import `vscode`.**
 *
 * `job.ts` makes single requests. This is the loop over them: it polls the log,
 * decides when the job has finished, drains what is left, and hands the lines out
 * through an `AsyncIterable`. It is the first module in `src/compute` that keeps
 * running between calls, and every decision below follows from that one fact.
 *
 * ## Self-driving is the whole point
 *
 * The poll starts when {@link streamJobLog} is called and continues whether or not
 * anything is reading {@link LogStream.events}. ADR-0015 requires it in one
 * sentence — *"an implementation must not stall waiting for a consumer that never
 * arrives"* — and ADR-0017 explains why the obvious implementation cannot satisfy
 * it: an `async function*` does not execute until something calls `next()`, so a
 * caller that awaits `done` while ignoring the output deadlocks against a loop
 * that never ran. Lines therefore land in a buffer that the iterator drains, and
 * `done` settles from the loop rather than from the iterator.
 *
 * The cost of that is stated in ADR-0017's consequences and dealt with below: a
 * pump nobody is consuming accumulates lines. See {@link DEFAULT_MAX_BUFFERED_LINES}.
 *
 * ## Why the loop is driven by the log rather than by a state poll
 *
 * The log's `timeout=` parameter really does hold the connection open — measured
 * at 10.27 s against a job deliberately silent for 25 s, where the same request
 * without it came back empty in 0.56 s (finding 48). So one mechanism reads the
 * output *and* provides the pacing, and there is no second long poll whose expiry
 * convention has to agree with the first. That mattered: the log's expiry is a
 * `200` carrying `items: []` while the session state's is a `304` (findings 28 and
 * 49), so the two conventions are known to disagree where both have been measured.
 *
 * The job state is still the only authority on whether the job has finished — an
 * empty page means "nothing yet" and never "end of log". What the pacing buys is
 * that the state does not have to be *asked* every iteration. A live-but-silent
 * job makes the poll block its full window; a finished one short-circuits and
 * answers in 0.26 s (finding 50). So an empty page that arrives **fast** is a
 * cheap hint that the job may be over, and the state is read then.
 *
 * The hint decides only when to ask, never the answer — see
 * {@link FAST_EMPTY_FRACTION} for why it is treated as weakly as it is, and
 * {@link MAX_WINDOWS_WITHOUT_STATE_READ} for what happens when the hint never
 * fires at all.
 *
 * ## What this module does not do
 *
 * It does not know what the job is running. `job.ts` takes opaque statements
 * (ADR-0017 part 2) and this takes an already-created job, so ADR-0014's upload
 * and `infile=` mechanism stays entirely inside slice 3a.
 *
 * It does not produce `RichOutput`. The seam's `ExecutionHandle.outputs` is an
 * `AsyncIterable<RichOutput>` (ADR-0015) and this yields {@link LogEvent}, which
 * is a SAS log line and nothing more. Turning a log line into a rendered output is
 * 3b's mapping, and doing it here would put the seam's vocabulary inside the
 * compute layer — the same mistake `problems.ts` avoids by keeping
 * `ComputeProblem` and `BackendProblem` apart.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResult,
} from "./client";
import {
  DEFAULT_LOG_LIMIT,
  DEFAULT_LOG_TIMEOUT_SECONDS,
  type ComputeJob,
  type LogLine,
  cancelJob,
  followLogPage,
  isTerminal,
  readJobState,
  readLogPage,
} from "./job";
import { type Link } from "./links";

/**
 * How many lines the pump will hold for a consumer that is not keeping up.
 *
 * A hundred thousand, which is a number chosen to be **unreachable in ordinary
 * use** rather than tuned: the whole policy is meant to be invisible, and a cap
 * that a real program trips is a cap that silently damages real output. For scale,
 * the twenty-one-line log of finding 52 is the only log this project has measured,
 * and a SAS log that reaches six figures is already a runaway.
 *
 * It is a safety bound on a pathological case — a program looping on `print` with
 * nothing consuming `events` — not a buffering strategy. A consumer that iterates
 * at all drains the buffer as fast as pages arrive and never approaches it.
 */
export const DEFAULT_MAX_BUFFERED_LINES = 100_000;

/**
 * The same bound expressed in characters, because a line count does not bound
 * memory on its own.
 *
 * Sixteen million. A hundred thousand lines is a comfortable bound when lines are
 * log-shaped, and no bound at all when they are not: a program printing a wide
 * dataframe, a base64 blob or a minified document can put kilobytes on a single
 * line, and a hundred thousand of those is hundreds of megabytes inside the
 * extension host. Whichever cap is reached first is the one that trims.
 *
 * **Characters, not bytes, and the name is literal.** These are UTF-16 code units
 * — `String.length` — because that is what a JavaScript string costs and what can
 * be measured without encoding every line to count it. A string is at least two
 * bytes per code unit, so this bounds the buffered text at roughly 32 MB. Calling
 * it bytes would be a number that is wrong for every non-ASCII log in a direction
 * nobody could predict.
 */
export const DEFAULT_MAX_BUFFERED_CHARACTERS = 16_000_000;

/**
 * How much of the poll window has to elapse before an empty page stops looking
 * like a finished job.
 *
 * Half. An empty page that returns in under half the window is "fast" and triggers
 * a state read; one that used more than half of it is taken as the window running
 * its course against a live, silent job.
 *
 * The two measurements sit either side of it, but **not symmetrically**, and the
 * asymmetry is the interesting part. A terminal job answered in 0.26 s against a
 * 10 s window (finding 50) — under three per cent of it — so the fast side clears
 * the 5 s threshold by about 19×. A live silent one used 10.27 s (finding 48), so
 * the slow side clears it by about 2×. Ordinary latency and a loaded server are
 * comfortably inside both margins; a deployment that silently **clamped**
 * `timeout` is not, and finding 48 says explicitly that it cannot rule one out,
 * because a server clamping a large value would have produced the same
 * measurement it took.
 *
 * Which is survivable, because when the classification is wrong it is only ever
 * wrong about *cost*. The probe measured the implication in one direction — a
 * terminal job answers fast, once — and never the converse. A fast empty page
 * from a job that is still running costs one extra state request, and on a
 * deployment where *every* empty page comes back fast it costs one per empty
 * window: the request rate against a silent job doubles, and nothing else changes,
 * because the state resource rather than the clock decides whether the stream
 * ends. A timing heuristic with a veto over termination would be a stream that
 * ends early on a fast network, which is not a trade this project makes.
 *
 * A caller raising `timeoutSeconds` above ten is the likeliest way to reach that
 * doubling, since ten is the largest value finding 48 verified running its full
 * course.
 */
export const FAST_EMPTY_FRACTION = 0.5;

/**
 * How many consecutive windows may pass without reading the state.
 *
 * Six — one minute at the default ten-second window.
 *
 * This is the safety net under {@link FAST_EMPTY_FRACTION}, and it guards the
 * failure the heuristic cannot see. Termination depends on a finished job
 * short-circuiting its poll, which is finding 50: one measurement, on one
 * deployment, of one job. A deployment that instead lets the window run its course
 * on a terminal job would produce empty page after empty page, none of them fast,
 * and the stream would never end — `done` would never settle and the user would
 * watch a spinner over a program that finished a minute ago.
 *
 * So the state is read at least this often across **empty** windows, whatever the
 * timing says. Empty is the operative word and the counter is deliberately not a
 * bound on the loop as a whole: a page carrying items resets it, because output
 * arriving is direct evidence the job is alive and better evidence than the state
 * resource could give. The cost when the heuristic is working — which is every
 * deployment measured so far — is nil, because a terminal job trips the fast path
 * long before six windows elapse.
 *
 * Same shape as `MAX_WAIT_WINDOWS` in `session.ts` and the same reasoning: a loop
 * whose exit depends on a server behaving as it did during a probe needs a bound
 * that does not.
 */
export const MAX_WINDOWS_WITHOUT_STATE_READ = 6;

/**
 * How many pages the drain will follow before deciding the paging is broken.
 *
 * Ten thousand — two million lines at the default page size, twenty times what
 * the line cap will hold, so no log a real program produces can reach it.
 *
 * It exists for the same reason {@link MAX_WINDOWS_WITHOUT_STATE_READ} does, and
 * against the same weakness in the evidence. The drain's only exit is the
 * deployment stopping sending a `next` relation, and that it does so is finding
 * 51: one observation, of one 21-line log, on one deployment. A `next` that
 * pointed at itself, or that a rewriting proxy kept alive, would give an
 * unbounded request storm and a `done` that never settles — the worst failure
 * this module has available to it, and the one the counter above exists to make
 * impossible in the other loop. Leaving one loop bounded and its neighbour
 * unbounded would be holding the same evidence to two standards.
 *
 * Reaching it is reported as a malformed response rather than passed off as a
 * finished log, because a drain that stopped early and said nothing is the
 * "log with a hole in it and no marker" this module refuses to produce anywhere
 * else.
 */
export const MAX_DRAIN_PAGES = 10_000;

/**
 * One thing that happened to the log, in the order it happened.
 *
 * A union rather than a bare {@link LogLine} because an overflow has to be
 * reportable **in the stream**, at the position where the hole is, and there is no
 * honest way to say that as a log line. `job.ts` is explicit that the line `type`
 * vocabulary belongs to the server — *"inventing a type for it would put a word
 * into a vocabulary the server owns"* — so a synthetic line carrying
 * `type: "dropped"` would be this module writing into the deployment's namespace
 * and a renderer switching on it would have no way to tell ours from theirs.
 */
export type LogEvent =
  | { readonly kind: "line"; readonly line: LogLine }
  /**
   * Lines were discarded here to stay inside the buffer bounds.
   *
   * Emitted **at the position of the hole**, so a consumer rendering the stream in
   * order shows the gap where it happened rather than discovering at the end that
   * two adjacent lines were not adjacent. Consecutive overflows coalesce into one
   * event rather than accumulating markers, because a runaway program would
   * otherwise replace the log it was truncating with a list of complaints about
   * truncating it.
   */
  | {
      readonly kind: "dropped";
      readonly lines: number;
      readonly characters: number;
    };

/** How much was discarded, in both units the caps are expressed in. */
export interface DroppedTally {
  readonly lines: number;
  readonly characters: number;
}

/**
 * How the stream ended.
 *
 * `dropped` is on both arms and is the **total for the whole run**, which is the
 * half of the answer the in-stream marker cannot give: ADR-0015 says a caller may
 * await `done` and never touch `outputs`, and such a caller would otherwise be
 * told a complete-looking story about a log with a hole in it. A log with a hole
 * in it and no marker is a log that lies, in either direction of reading.
 */
export type LogStreamEnd =
  | {
      readonly outcome: "terminal";
      /** The state that stopped the loop — `completed` or `error` in practice. */
      readonly state: string;
      readonly dropped: DroppedTally;
    }
  | { readonly outcome: "cancelled"; readonly dropped: DroppedTally };

/**
 * A log being read, and the two independent things a caller can want from it.
 *
 * Independent is the operative word and it is what ADR-0017 exists to protect:
 * `events` may be ignored entirely, `done` may be ignored entirely, and neither
 * choice changes what the other does.
 */
export interface LogStream {
  /**
   * The lines, in order, ending when the run does.
   *
   * **One consumer.** The iterator removes what it yields, so a second one gets
   * whatever the first left. Nothing here needs a second, and supporting one would
   * mean holding every line for the lifetime of the stream — which is precisely
   * what the caps below exist to avoid.
   */
  readonly events: AsyncIterable<LogEvent>;
  /**
   * Settles once, when the loop stops.
   *
   * Every failure it has to *report* arrives as a settled {@link ComputeResult}
   * rather than as a rejection, so a caller never needs a `try` around the
   * `await`. A failure here is a failure to read the log — the deployment became
   * unreachable, the session was reaped — and not a failure of the program, which
   * is reported by its terminal state and, in 3a, by `SYSCC`.
   *
   * Two things outside that guarantee can still reject it, and both are defects
   * rather than conditions: a {@link LogStreamOptions.now} that throws, and a
   * {@link ComputeClient} that rejects instead of returning a failure. Neither is
   * something this module can describe as a `ComputeProblem`, so neither is
   * caught — but the rejection is always *handled*, so a caller exercising
   * ADR-0015's right to ignore `done` entirely cannot be killed by an unhandled
   * rejection for a mistake it did not make.
   */
  readonly done: Promise<ComputeResult<LogStreamEnd>>;
  /**
   * Stops the job and the reading of it.
   *
   * Idempotent, and **once the run is over it sends nothing** and succeeds.
   * ADR-0015 requires cancelling a finished run to succeed and do nothing, and
   * doing nothing has to be literal here: a `PUT` to a job that has already
   * completed is at best pointless, and against a session the reaper has since
   * taken it is a `404` — which {@link cancelJob} reads as `session-gone` and
   * would report as a failure of the one operation that is required to succeed.
   *
   * "Over" starts at the terminal state and not at the settling of `done`, which
   * matters because the drain runs between the two. Cancelling there would send
   * that pointless `PUT` *and* abandon the tail of a log that is already complete
   * on the server — a truncation with no marker on it, since there is no way to
   * count what was never read.
   *
   * While the stream is still running, the returned result is about the
   * **request to the deployment** and not about the stream: it says whether the
   * job was successfully told to stop. `done` settles as `cancelled` either way,
   * because the user asked for the run to end and it has ended, whatever the
   * deployment did with the message.
   */
  cancel(): Promise<ComputeResult<void>>;
}

export interface LogStreamOptions {
  /** Lines per page. Defaults to `DEFAULT_LOG_LIMIT`. */
  limit?: number | undefined;
  /** Seconds per poll window. Defaults to `DEFAULT_LOG_TIMEOUT_SECONDS`. */
  timeoutSeconds?: number | undefined;
  /** Defaults to {@link DEFAULT_MAX_BUFFERED_LINES}. */
  maxBufferedLines?: number | undefined;
  /** Defaults to {@link DEFAULT_MAX_BUFFERED_CHARACTERS}. */
  maxBufferedCharacters?: number | undefined;
  /**
   * The caller's own cancellation, if it has one.
   *
   * Aborting it is equivalent to calling {@link LogStream.cancel}, except that
   * nothing is sent to the deployment: an abort says the caller has stopped
   * caring, and it may have stopped caring because the whole window is closing,
   * which is not a moment to start a new request. A caller that wants the job
   * itself stopped calls `cancel`.
   */
  signal?: AbortSignal | undefined;
  /**
   * The clock, for tests.
   *
   * The fast-empty heuristic is a timing decision, and a test that had to actually
   * wait out a ten-second window to exercise it would be a test nobody runs.
   * Defaults to `Date.now`.
   */
  now?: (() => number) | undefined;
}

/**
 * Starts reading a job's log, and returns immediately.
 *
 * The pump is already running when this returns; there is nothing to start and no
 * promise to await before output begins to arrive.
 *
 * @throws {TypeError} if any bound is not a positive integer. Caller defects are
 *   thrown from here rather than reported through `done`, matching `job.ts`: a
 *   `limit` of zero is a mistake at the call site, and surfacing it as a settled
 *   failure would put it in the same channel as a deployment being unreachable.
 *   Throwing synchronously also means a defective call never starts a poll loop.
 */
export function streamJobLog(
  client: ComputeClient,
  job: ComputeJob,
  options?: LogStreamOptions,
): LogStream {
  const limit = positiveInteger("limit", options?.limit ?? DEFAULT_LOG_LIMIT);
  const timeoutSeconds = positiveInteger(
    "timeoutSeconds",
    options?.timeoutSeconds ?? DEFAULT_LOG_TIMEOUT_SECONDS,
  );
  const maxLines = positiveInteger(
    "maxBufferedLines",
    options?.maxBufferedLines ?? DEFAULT_MAX_BUFFERED_LINES,
  );
  const maxCharacters = positiveInteger(
    "maxBufferedCharacters",
    options?.maxBufferedCharacters ?? DEFAULT_MAX_BUFFERED_CHARACTERS,
  );
  const now = options?.now ?? Date.now;

  const buffer = new EventBuffer(maxLines, maxCharacters);

  // The pump's own signal. The caller's, when there is one, is chained into it
  // rather than used directly: `cancel()` has to be able to abort the in-flight
  // poll without an abort controller belonging to somebody else.
  const controller = new AbortController();
  const signal = controller.signal;
  let cancelled = false;

  const abort = (): void => {
    cancelled = true;
    if (!controller.signal.aborted) controller.abort();
  };

  /**
   * Whether cancellation has been asked for — read through a **call**, never as
   * the variable.
   *
   * The flag is written from outside the loop's control flow: from `cancel()`,
   * and from a listener on the caller's signal that fires while the pump is
   * parked on an `await`. TypeScript's analysis does not model either, so after
   * one `if (cancelled) return …` it narrows the variable to `false` for the rest
   * of the function and `no-unnecessary-condition` reports every later read as
   * "always falsy". That is precisely the state the pump exists to notice, and
   * the checks are the only thing keeping a cancelled poll's failure — which
   * reads as an unreachable deployment — out of the caller's result.
   *
   * A call is opaque to the narrowing, so the reads type as the `boolean` they
   * are. Suppressing the rule instead would have left the same false claim in
   * the code with a comment on top of it.
   */
  const isCancelled = (): boolean => cancelled;

  const callerSignal = options?.signal;
  let releaseCaller = (): void => undefined;
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) {
      abort();
    } else {
      const onAbort = (): void => {
        abort();
      };
      callerSignal.addEventListener("abort", onAbort, { once: true });
      releaseCaller = (): void => {
        callerSignal.removeEventListener("abort", onAbort);
      };
    }
  }

  const fastWindowMs = timeoutSeconds * 1000 * FAST_EMPTY_FRACTION;

  // Set the moment the job is known terminal, which is strictly earlier than
  // `settled`: the drain sits between them. `cancel()` reads it — see the note
  // on `LogStream.cancel`.
  let finished = false;

  /** One poll, one classification, and whatever follows from it. */
  async function pump(): Promise<ComputeResult<LogStreamEnd>> {
    let start = 0;
    let windowsSinceStateRead = 0;

    for (;;) {
      if (isCancelled()) return { ok: true, value: buffer.cancelledEnd() };

      const began = now();
      const page = await readLogPage(client, job, {
        start,
        limit,
        timeoutSeconds,
        signal,
      });
      // Order matters: a cancelled poll fails as `compute-unreachable`, which is
      // accurate for a dropped connection and wrong for a user who pressed Cancel.
      // `cancellation.ts` states the rule — on a failure, ask about cancellation
      // first — and this is the one place in the pump where the two are
      // indistinguishable from the failure alone.
      if (isCancelled()) return { ok: true, value: buffer.cancelledEnd() };
      if (!page.ok) return page;

      buffer.push(page.value.lines);
      start += page.value.advance;

      if (page.value.advance > 0) {
        // Output is still arriving, so the job is demonstrably alive and the
        // state resource has nothing to add. This also resets the safety counter,
        // which is why a chatty job never pays for it.
        windowsSinceStateRead = 0;
        continue;
      }

      windowsSinceStateRead += 1;
      const fast = now() - began < fastWindowMs;
      if (!fast && windowsSinceStateRead < MAX_WINDOWS_WITHOUT_STATE_READ) {
        continue;
      }

      windowsSinceStateRead = 0;
      const state = await readJobState(client, job, { signal });
      if (isCancelled()) return { ok: true, value: buffer.cancelledEnd() };
      if (!state.ok) return state;
      if (!isTerminal(state.value)) continue;

      finished = true;
      const drained = await drain(start);
      if (isCancelled()) return { ok: true, value: buffer.cancelledEnd() };
      if (!drained.ok) return drained;

      return {
        ok: true,
        value: {
          outcome: "terminal",
          state: state.value,
          dropped: buffer.dropped(),
        },
      };
    }
  }

  /**
   * Reads what is left once the job has stopped.
   *
   * Begins with one ordinary page read from the live cursor rather than by
   * following the last page's `next`, and that first read is not redundant. The
   * page that triggered the state check was empty, so it carried the cursor and
   * nothing else; anything the job wrote between that poll and the state coming
   * back terminal exists only at `start` and would be lost by picking up a `next`
   * from before it.
   *
   * From there it follows `next` until the relation is **absent**, never stopping
   * on a short page: a 21-line log read at `limit=3` produced seven pages, the
   * last of them full and carrying no `next` (finding 51), so a reader keyed on
   * page length stops one page early and does so only on the logs where the line
   * count happens to divide. {@link MAX_DRAIN_PAGES} is the bound under that,
   * for the deployment where the relation never goes away.
   *
   * The whole drain is cheap because the job is terminal, and a terminal job
   * short-circuits the wait rather than sitting out its window (finding 50) — so
   * there is no ten-second stall at the end of every execution.
   *
   * Cancelling here is the caller's `signal` and never {@link LogStream.cancel},
   * which does nothing once the job is terminal. An abort means the caller has
   * stopped caring — the window is closing — so stopping mid-drain is the
   * outcome it asked for.
   */
  async function drain(start: number): Promise<ComputeResult<void>> {
    const first = await readLogPage(client, job, {
      start,
      limit,
      timeoutSeconds,
      signal,
    });
    if (isCancelled()) return { ok: true, value: undefined };
    if (!first.ok) return first;

    buffer.push(first.value.lines);
    let next: Link | undefined = first.value.next;

    for (let page = 0; next !== undefined; page += 1) {
      if (page >= MAX_DRAIN_PAGES) return pagingDidNotEnd();

      const result: ComputeResult<{
        lines: readonly LogLine[];
        next?: Link | undefined;
      }> = await followLogPage(client, next, { signal });
      if (isCancelled()) return { ok: true, value: undefined };
      if (!result.ok) return result;

      buffer.push(result.value.lines);
      next = result.value.next;
    }

    return { ok: true, value: undefined };
  }

  let settled = false;
  const done = pump().finally(() => {
    settled = true;
    releaseCaller();
    buffer.close();
  });
  // ADR-0015 lets a caller ignore `done` entirely, and `pump` can still reject on
  // a caller defect — a `now` that throws. Without this, that defect arrives as
  // an unhandled rejection, which under Node's default policy takes the extension
  // host down. Attaching it to a second reference leaves `done` itself rejecting
  // for whoever does await it.
  void done.catch(() => undefined);

  let cancelling: Promise<ComputeResult<void>> | undefined;

  return {
    events: buffer.events(),
    done,
    cancel: async (): Promise<ComputeResult<void>> => {
      // Nothing left to stop, so nothing is sent. `finished` rather than
      // `settled` alone, because the drain runs between the two and the job is
      // already over throughout it. Checked before the memo so that a cancel
      // arriving after a normal finish is not answered from a request made while
      // the run was still live.
      if (settled || finished) return { ok: true, value: undefined };

      // Idempotent by memoisation rather than by a flag, so that two callers
      // racing get one request and the same answer.
      cancelling ??= (async (): Promise<ComputeResult<void>> => {
        // The abort goes first, deliberately. It is what makes `done` settle, and
        // a user who pressed Cancel is waiting on that, not on the deployment's
        // acknowledgement. Telling the job to stop is the slower half and it is
        // still done — just not in front of the person waiting.
        abort();
        // And **no signal at all**, which is the point of the omission rather
        // than an oversight: the pump's has just been aborted a line above, so
        // passing it — the obvious tidy-up, since every other call in this file
        // takes it — would abort the one request whose entire purpose is to stop
        // the job. The program would then run to completion unattended, and only
        // once it finished would the session's idle clock start and take another
        // fifteen minutes to reap it (finding 18 measures the idle timeout, not
        // a timeout on running work). There is deliberately no replacement
        // controller either: nothing here has a reason to abort this request.
        //
        // Unsignalled is not unbounded, which is the part worth stating because
        // two readers have now assumed otherwise. `ComputeClient.send` composes
        // `AbortSignal.timeout(timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS)`
        // into every request and combines it with the caller's signal rather than
        // choosing between them, so a deployment that never answers this `PUT`
        // fails it at the client's timeout — thirty seconds unless the profile
        // says otherwise — and `cancel()` settles with that failure. What the
        // omission removes is the *caller's* ability to abandon the request, not
        // the bound on it, and removing that is the whole point: the one request
        // this module must not abandon is the one that stops the job.
        return await cancelJob(client, job);
      })();
      // The same guard `done` gets, on a second reference and for the same
      // reason. `ComputeClient.send` is contracted never to reject, but it is an
      // injected interface, so the contract holds only for the implementations
      // this repository happens to ship — a test double is the likeliest thing to
      // break it. A caller tearing down a window is also the likeliest one to
      // fire `cancel()` without awaiting it, and those two together would turn a
      // caller's defect into an unhandled rejection in someone else's process.
      // `cancelling` itself still rejects for whoever does await it.
      void cancelling.catch(() => undefined);
      return await cancelling;
    },
  };
}

/**
 * The lines waiting for a consumer, and the policy for when there are too many.
 *
 * ADR-0017 settled the policy and left the mechanism to this slice: **cap it, drop
 * the oldest, and count what was dropped.** The oldest go because a runaway loop's
 * last thousand lines are where its failure is and its first thousand are its
 * start-up.
 */
class EventBuffer {
  private readonly queue: LogEvent[] = [];
  private lines = 0;
  private characters = 0;
  private droppedLines = 0;
  private droppedCharacters = 0;
  private closed = false;
  private wake: (() => void) | undefined;

  constructor(
    private readonly maxLines: number,
    private readonly maxCharacters: number,
  ) {}

  push(lines: readonly LogLine[]): void {
    if (lines.length === 0) return;
    for (const line of lines) {
      this.queue.push({ kind: "line", line });
      this.lines += 1;
      this.characters += line.line.length;
    }
    this.trim();
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  dropped(): DroppedTally {
    return { lines: this.droppedLines, characters: this.droppedCharacters };
  }

  cancelledEnd(): LogStreamEnd {
    return { outcome: "cancelled", dropped: this.dropped() };
  }

  /**
   * Discards from the front until both bounds are satisfied.
   *
   * A stream that overflows repeatedly carries one growing "dropped" event at the
   * head rather than a run of them, and the coalescing happens on the way *out*
   * rather than on the way in: a marker already at the head is shifted off with
   * everything else and its tally carried into the marker written afterwards.
   * There is no separate merge step, and there cannot usefully be one — shifting a
   * marker changes neither bound, so the loop keeps going and whatever is at the
   * head when it stops is a line. An `if (head is a marker)` branch here would be
   * code no input can reach.
   *
   * The loop also has to terminate when a single line is longer than the character
   * bound — it does, because dropping that line empties the queue and an empty
   * queue is under every bound.
   */
  private trim(): void {
    // Discarded by *this* call, and separately, carried over from a marker this
    // call shifted out of the way. The two are counted apart because they are
    // owed to different places: the run total must see each line exactly once,
    // and the marker left behind has to describe the whole hole. Adding a
    // shifted marker's tally to the run total would count those lines twice,
    // once when they were dropped and once when their marker was moved.
    let lines = 0;
    let characters = 0;
    let carriedLines = 0;
    let carriedCharacters = 0;

    while (
      this.queue.length > 0 &&
      (this.lines > this.maxLines || this.characters > this.maxCharacters)
    ) {
      const oldest = this.queue.shift();
      if (oldest === undefined) break;
      if (oldest.kind === "line") {
        this.lines -= 1;
        this.characters -= oldest.line.line.length;
        lines += 1;
        characters += oldest.line.line.length;
      } else {
        carriedLines += oldest.lines;
        carriedCharacters += oldest.characters;
      }
    }

    if (lines === 0) return;

    this.droppedLines += lines;
    this.droppedCharacters += characters;

    // The queue's head is a line or nothing — see the note above — so this is
    // always an insert and never a merge. The merge already happened, in
    // `carriedLines`.
    this.queue.unshift({
      kind: "dropped",
      lines: lines + carriedLines,
      characters: characters + carriedCharacters,
    });
  }

  /**
   * The consumer's half.
   *
   * Yields what is buffered, then waits to be woken. It never drives the pump and
   * the pump never waits for it, which is the property the whole design exists to
   * have: a consumer that stops iterating stops receiving lines and changes
   * nothing else.
   */
  async *events(): AsyncGenerator<LogEvent, void, undefined> {
    for (;;) {
      while (this.queue.length > 0) {
        const event = this.queue.shift();
        if (event === undefined) break;
        if (event.kind === "line") {
          this.lines -= 1;
          this.characters -= event.line.line.length;
        }
        yield event;
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

/**
 * The failure for a `next` chain that will not end.
 *
 * The only problem this module constructs itself, and it is about the *shape* of
 * the paging rather than about anything in it: no status, no media type, no line
 * and above all no body, because the body of a log page is the user's own program
 * output and `job.ts` is explicit that a failure path must not echo it.
 *
 * `response-malformed` rather than a new code, because that is what it is — the
 * collection the deployment sent does not terminate — and a caller has the same
 * remedy either way.
 */
function pagingDidNotEnd(): ComputeFailure {
  return {
    ok: false,
    reason: "the compute service did not answer with a log that ends",
    problem: {
      code: "response-malformed",
      detail: `the job's log kept offering a "next" page after ${String(MAX_DRAIN_PAGES)} of them, which is more log than the reader will hold, so the paging is not ending`,
    },
  };
}

/** A bound that may not be zero, or a `TypeError` naming the argument. */
function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      `${name} must be a positive whole number, not ${String(value)}`,
    );
  }
  return value;
}
