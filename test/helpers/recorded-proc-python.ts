// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A {@link FakeBackend} whose runs are driven by a real {@link ProcPythonBackend}
 * over a simulated Compute wire, so `backend-contract-suite.ts` — written once
 * against `fake-backend.ts` — can be run a second time against 3a's actual
 * implementation without being rewritten for it. `backend-contract-suite.ts`'s
 * own header anticipates exactly this: *"whether 3a's double is driven by a
 * recording `ComputeClient`… is 3a's decision"*. This is that decision.
 *
 * ## What is real and what is simulated
 *
 * `ProcPythonBackend` itself is the genuine article — the same class 3a ships.
 * What is fake is everything below it: a `ComputeClient` that answers
 * `assign`/`self`/`upload`/`execute`/`log`/`state`/`cancel`/`variables` from an
 * in-memory job rather than a live deployment. A test's `run.emit(...)` pushes
 * a line onto that job's log; `run.finish(...)` sets its `SYSCC` and its
 * terminal state; `ProcPythonBackend` discovers both the ordinary way, through
 * `streamJobLog` and `readVariable`.
 *
 * ## Why `execute` cannot bind a job synchronously
 *
 * `ProcPythonBackend.execute` resolves as soon as the run is accepted — before
 * the fileref is even created — because `ExecutionBackend.cancel` has to work
 * "including while the program is still being transferred" (`backend.ts`).
 * That means the wire calls that create the simulated job happen *after* this
 * wrapper's `execute` has already returned a `FakeRun` to the caller, so a
 * test's `run.emit`/`run.finish` can arrive before the job exists to receive
 * them. {@link JobSlot} is the queue that makes that ordering harmless: an
 * operation runs immediately if the job is bound, or waits for `bind` if not.
 *
 * ## What this double cannot exercise
 *
 * `run.abort` is only ever called by the suite *after* `run.finish` has
 * already settled the run (as a check that a second ending is ignored), so it
 * is a no-op here — there is no real mid-flight seam failure this simulated
 * wire can trigger on demand, and nothing in the suite asks it to. `connect`
 * failing, `execute` refusing before transfer, and `freshNamespace` being
 * unsupported are all short-circuited in this wrapper rather than produced by
 * the real backend, because `ProcPythonBackend` has no I/O in `connect()` and
 * always supports `freshNamespace` — there is no wire shape that would make it
 * fail either one for real, and the suite's own point in offering those
 * options is that the *contract* can express the failure, not that every
 * implementation can be made to produce it artificially.
 *
 * ## What is exported for the layer above this one
 *
 * Phase 4's 4a slice needs a `ComputeConnection`-shaped fixture, not a
 * `FakeBackend`-shaped one — `commands.ts`'s own `backendFor()` constructs its
 * `ProcPythonBackend` itself, from a `client`/`session`/`generation` triple,
 * and nothing above that seam can inject a backend instance the way this
 * module's own `createRecordedProcPythonBackend` does. `test/helpers/
 * recorded-connection.ts` is that one layer up, and it is built from exactly
 * the same simulated wire as this module — {@link SimulatedJob},
 * {@link JobSlot}, {@link buildClient}, {@link session} and {@link dialect}
 * are exported for it to reuse rather than fork. Two differences it needs
 * that this module's own consumer never has:
 *
 * - **A way to interrupt a stuck poll.** `close()`'s cancellation path aborts
 *   a signal that this simulated wire used to ignore entirely — `execute()`'s
 *   own `run.abort` no-op above was true only because nothing exercised that
 *   path for real. {@link SimulatedJob.nextPage} now takes the request's
 *   `AbortSignal` and resolves an in-flight wait with an empty page the
 *   moment it fires, which is what lets `logStream.ts`'s pump notice the
 *   cancellation on its very next loop iteration — the same shape a dropped
 *   connection would produce, not a new log line invented to signal it.
 * - **A reset that does not finish itself.** {@link buildClient}'s
 *   `autoFinishReset` option (default `true`, unchanged for every existing
 *   caller of this module) lets `recorded-connection.ts` leave a
 *   `RESTART_STATEMENT` job running exactly like an ordinary `execute()` job,
 *   so a test can hold it open long enough for a Cancel to interrupt it —
 *   this module's own `reset()` case never needed that, since nothing here
 *   drives `reset()`'s timing at all (see this comment's own header for why).
 */

import {
  ProcPythonBackend,
  RESTART_STATEMENT,
  type SubmissionGuard,
} from "../../src/backend/procPython";
import { type BackendResult, fail } from "../../src/backend/problems";
import {
  type ComputeClient,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import { type ComputeSession } from "../../src/compute/session";
import { type Dialect } from "../../src/dialects/dialect";
import { type BackendFactory } from "./backend-contract-suite";
import {
  type FakeBackend,
  type FakeBackendOptions,
  type FakeRun,
} from "./fake-backend";

const SESSION_ID = "recorded-proc-python-session";

/** An in-memory stand-in for one `PROC PYTHON` job's log and outcome.
 * Exported for `test/helpers/recorded-connection.ts` — see this module's own
 * doc comment ("What is exported for the layer above this one"). */
export class SimulatedJob {
  state: "running" | "completed" = "running";
  syscc = "0";
  syserrortext: string | undefined;

  private queued: string[] = [];
  private waiting: ((lines: readonly string[]) => void) | undefined;

  /** A line becomes available to the next (or currently parked) log poll. */
  push(text: string): void {
    if (this.waiting !== undefined) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve([text]);
      return;
    }
    this.queued.push(text);
  }

  /**
   * First call wins; later ones are no-ops.
   *
   * The suite calls `finish` more than once on the same run to prove `done`
   * settles once (`backend-contract-suite.ts`'s "settles once…" case), the
   * same way `fake-backend.ts`'s own `FakeRun.finish` is guarded by a
   * `settled` flag. Without this, a second call here would silently rewrite
   * `SYSCC` underneath a real backend that has not read it yet — the real
   * backend has no equivalent of the fake's synchronous `settled` guard,
   * because *its* `done` only settles once it actually polls through this
   * simulated wire, so the guard has to live here instead.
   */
  finish(succeeded: boolean, message: string | undefined): void {
    if (this.state === "completed") return;
    this.syscc = succeeded ? "0" : "1012";
    this.syserrortext = message;
    this.state = "completed";
    if (this.waiting !== undefined) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve([]);
    }
  }

  /** One page for `streamJobLog`'s poll: whatever is queued, or a hold until
   * `push` or `finish` produces something. Terminal and empty answers `[]`
   * immediately — the expiry shape finding 49 measured.
   *
   * `signal`, when given, resolves an in-flight hold with an empty page the
   * moment it aborts — the shape a dropped connection produces, not a new
   * kind of answer this simulated wire invents. Added for
   * `recorded-connection.ts` (Phase 4's 4a slice): `close()`'s cancellation
   * path aborts the same signal `streamJobLog` chained into this request, and
   * without this, a poll parked here never notices — nothing else in this
   * class observes an `AbortSignal` at all.
   *
   * The wait always settles through `settle`, which removes the listener
   * first — so a wait resolved by `push`/`finish` (the ordinary case: most
   * polls end because a line arrived or the job finished, not because of a
   * cancellation) does not leave its listener attached. `{ once: true }` would
   * only cover the abort path, since it fires the listener rather than the
   * settle. `streamJobLog` chains one long-lived signal across every poll of a
   * single run, so without this a run whose log streams more than a handful of
   * lines would accumulate one stale listener per line on it, eventually past
   * Node's default `maxListeners` warning threshold. Found on review before
   * this shipped — this module's own consumers stream few enough lines that
   * the leak was latent rather than triggered, which is exactly the kind of
   * finding "it hasn't tripped yet" would have let slip through. */
  async nextPage(signal?: AbortSignal): Promise<readonly string[]> {
    if (this.queued.length > 0) {
      const page = this.queued;
      this.queued = [];
      return page;
    }
    if (this.state === "completed") return [];
    return await new Promise<readonly string[]>((resolve) => {
      if (signal === undefined) {
        this.waiting = resolve;
        return;
      }
      // `onAbort` and `settle` reference each other, so one is named before the
      // other is declared — safe because neither is *called* until both
      // declarations have run (the `signal.aborted` branch and the listener
      // callback are both below this point).
      const onAbort = (): void => {
        if (this.waiting !== settle) return;
        this.waiting = undefined;
        settle([]);
      };
      const settle = (lines: readonly string[]): void => {
        signal.removeEventListener("abort", onAbort);
        resolve(lines);
      };
      this.waiting = settle;
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
    });
  }
}

/** Queues an operation until a job exists to receive it. See this module's
 * own doc comment for why `execute` cannot bind one synchronously. Exported
 * for `recorded-connection.ts` — see this module's own doc comment. */
export class JobSlot {
  private job: SimulatedJob | undefined;
  private queue: ((job: SimulatedJob) => void)[] = [];

  bind(job: SimulatedJob): void {
    this.job = job;
    const pending = this.queue;
    this.queue = [];
    for (const op of pending) op(job);
  }

  run(op: (job: SimulatedJob) => void): void {
    if (this.job !== undefined) {
      op(this.job);
      return;
    }
    this.queue.push(op);
  }

  current(): SimulatedJob | undefined {
    return this.job;
  }
}

function ok(
  body: unknown,
  init?: Partial<ComputeResponse>,
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      contentType: "application/json",
      text: "",
      body,
      ...init,
    },
  };
}

/** The `name` a filtered `variables` read was asking for. */
function variableName(href: string): string | undefined {
  const query = href.split("?")[1];
  if (query === undefined) return undefined;
  const filter = new URLSearchParams(query).get("filter");
  if (filter === null) return undefined;
  return /eq\(name,'(.*)'\)/.exec(filter)?.[1];
}

/** The `ComputeClient` `ProcPythonBackend` talks to. Every request is
 * answered from `slot`'s current job, or from nothing worth naming — there is
 * exactly one run in flight at a time, matching `ProcPythonBackend`'s own
 * serial contract, so one slot is all a test ever needs.
 *
 * `autoFinishReset` (default `true`, matching every existing caller in this
 * module unchanged) controls whether a `RESTART_STATEMENT` job finishes
 * itself the instant it is created — this module's own consumer needs that,
 * since nothing here ever drives `reset()`'s timing (see the class doc
 * comment on `createRecordedProcPythonBackend`). `recorded-connection.ts`
 * passes `false`: Phase 4's 4a slice needs a reset that stays running until
 * something — a test, or a real cancellation — ends it, the same way an
 * ordinary `execute()` job already does in both callers. */
export function buildClient(
  slot: JobSlot,
  options: { autoFinishReset?: boolean } = {},
): ComputeClient {
  const autoFinishReset = options.autoFinishReset ?? true;
  let filerefName = "unknown";

  return {
    send: async (request) => {
      switch (request.link.rel) {
        case "assign": {
          const body = request.body as { name: string };
          filerefName = body.name;
          return ok(
            {
              id: filerefName,
              links: [
                {
                  rel: "self",
                  method: "GET",
                  href: `/filerefs/${filerefName}`,
                },
                {
                  rel: "upload",
                  method: "PUT",
                  href: `/filerefs/${filerefName}/content`,
                  type: "application/octet-stream",
                },
              ],
            },
            { status: 201 },
          );
        }
        case "self":
          return ok({ id: filerefName }, { etag: '"v1"' });
        case "upload":
          return ok(undefined, { status: 201 });
        case "execute": {
          const job = new SimulatedJob();
          slot.bind(job);
          // `reset()` submits this exact statement and has no
          // `ExecutionHandle` for a test to drive with `emit`/`finish` —
          // nothing production-side calls those for it either, since
          // `ProcPythonBackend.reset()` just waits for the job to actually
          // finish. A real deployment does that on its own; when
          // `autoFinishReset` is left at its default, this stands in for it
          // so `reset()` does not hang forever waiting on a run nobody can
          // complete. `recorded-connection.ts` turns this off on purpose —
          // see this function's own doc comment.
          if (
            autoFinishReset &&
            (request.body as { code?: string[] }).code?.[0] ===
              RESTART_STATEMENT
          ) {
            job.finish(true, undefined);
          }
          return ok(
            {
              id: "recorded-job",
              state: "pending",
              links: [
                // Finding 75 (Phase 4c): `cancelJob` now reads this relation
                // for a fresh ETag immediately before its `PUT`, routing
                // through the same generic `case "self"` below the fileref's
                // own self-check already uses.
                {
                  rel: "self",
                  method: "GET",
                  href: "/jobs/recorded-job",
                },
                {
                  rel: "state",
                  method: "GET",
                  href: "/jobs/recorded-job/state",
                },
                {
                  rel: "log",
                  method: "GET",
                  href: "/jobs/recorded-job/log",
                  type: "application/vnd.sas.collection",
                },
                {
                  rel: "cancel",
                  method: "PUT",
                  href: "/jobs/recorded-job/state?value=canceled",
                },
              ],
            },
            { status: 201 },
          );
        }
        case "log": {
          const job = slot.current();
          const lines =
            job === undefined ? [] : await job.nextPage(request.signal);
          return ok(
            {
              count: 0,
              items: lines.map((text) => ({ line: text, type: "normal" })),
              links: [
                { rel: "self", method: "GET", href: "/jobs/recorded-job/log" },
              ],
            },
            { contentType: "application/vnd.sas.collection+json" },
          );
        }
        case "state":
          return ok(undefined, {
            status: 200,
            contentType: "text/plain",
            text: slot.current()?.state ?? "completed",
            body: undefined,
          });
        case "cancel":
          // `logStream.ts`'s own pump stops itself on the caller's signal;
          // this reply only has to be one the client accepts.
          return ok(undefined, { status: 204 });
        case "variables": {
          const job = slot.current();
          const name = variableName(request.link.href);
          if (name === "SYSCC") {
            return ok({
              count: 1,
              items: [{ name, value: job?.syscc ?? "0" }],
            });
          }
          if (name === "SYSERRORTEXT") {
            const text = job?.syserrortext;
            return text === undefined
              ? ok({ count: 0, items: [] })
              : ok({ count: 1, items: [{ name, value: text }] });
          }
          return ok({ count: 0, items: [] });
        }
        // ADR-0019 (3c-i): `runProgram` lists the session's working
        // directory before and after every run, unconditionally, to look for
        // rich output. Nothing in this double's simulated session ever
        // writes a file there, so an always-empty directory is the whole of
        // what these two need to answer — `backend-contract-suite.ts` has no
        // case that expects a candidate to be found.
        case "getFiles":
          return ok({
            isDirectory: true,
            links: [
              {
                rel: "getDirectoryMembers",
                method: "GET",
                href: "/files/cwd/members",
                type: "application/vnd.sas.collection",
              },
            ],
          });
        case "getDirectoryMembers":
          return ok({ count: 0, items: [] });
        default:
          throw new Error(
            `recorded-proc-python: unscripted request rel "${request.link.rel}"`,
          );
      }
    },
  };
}

function fixedGuard(): SubmissionGuard {
  // The suite drives one `ProcPythonBackend` per test and never constructs a
  // second instance against the same profile, so there is no "another window"
  // for the real guard in `sessionManager.ts` to arbitrate — a bare boolean
  // is the whole of what this double needs to satisfy `SubmissionGuard`.
  let busy = false;
  return {
    isBusy: () => busy,
    startSubmission: () => {
      if (busy) return false;
      busy = true;
      return true;
    },
    endSubmission: () => {
      busy = false;
    },
  };
}

/** Exported for `recorded-connection.ts` — see this module's own doc
 * comment. */
export function session(): ComputeSession {
  return {
    id: SESSION_ID,
    state: "idle",
    links: [
      { method: "POST", rel: "assign", href: "/filerefs" },
      { method: "POST", rel: "execute", href: "/jobs" },
      {
        method: "GET",
        rel: "variables",
        href: "/variables",
        responseType: "application/vnd.sas.collection",
      },
      {
        method: "GET",
        rel: "getFiles",
        href: "/files/cwd",
        type: "application/vnd.sas.compute.file.properties",
      },
    ],
  };
}

/** Exported for `recorded-connection.ts` — see this module's own doc
 * comment. */
export function dialect(): Dialect {
  return {
    id: "viya4",
    deployment: { kind: "viya4", release: "2026.03" },
    contract: "viya4",
    hasBuiltInClient: () => true,
    describe: () => "Viya 4 (recorded-transport fixture)",
  };
}

/**
 * Builds a {@link FakeBackend} backed by a real {@link ProcPythonBackend}.
 *
 * Satisfies `BackendFactory`, so `describeExecutionBackendContract` runs
 * unmodified against it — see this module's own doc comment for the two
 * clauses (`connectProblem`, and a mid-flight `abort`) it necessarily
 * short-circuits rather than produces for real.
 */
export const createRecordedProcPythonBackend: BackendFactory = (
  options: FakeBackendOptions = {},
): FakeBackend => {
  const freshNamespaceSupported = options.freshNamespace ?? true;

  const slot = new JobSlot();
  const client = buildClient(slot);
  const real = new ProcPythonBackend(
    client,
    session(),
    dialect(),
    fixedGuard(),
  );

  const runs: FakeRun[] = [];
  let connected = false;
  let closed = false;
  let current: FakeRun | undefined;

  return {
    id: real.id,
    capabilities: () => real.capabilities(),

    async connect(): Promise<BackendResult<void>> {
      if (options.connectProblem !== undefined) {
        return fail(options.connectProblem, "connecting");
      }
      const result = await real.connect();
      if (result.ok) {
        connected = true;
        closed = false;
      }
      return result;
    },

    get connected() {
      return connected;
    },
    get closed() {
      return closed;
    },
    get busy() {
      return real.busy;
    },
    get current() {
      return current;
    },
    get runs() {
      return runs;
    },

    async execute(program, opts) {
      if (opts.freshNamespace && !freshNamespaceSupported) {
        return fail(
          {
            code: "unsupported",
            feature: "freshNamespace",
            reason: "this backend cannot clear the interpreter",
          },
          "running",
        );
      }
      if (options.transferProblem !== undefined) {
        return fail(options.transferProblem, "running");
      }

      const result = await real.execute(program, opts);
      if (!result.ok) return result;

      let settled = false;
      const run: FakeRun = {
        handle: result.value,
        program,
        options: opts,
        get settled() {
          return settled;
        },
        emit(output) {
          if (settled || output.mime !== "text/plain") return;
          slot.run((job) => {
            job.push(output.data);
          });
        },
        finish(outcome) {
          slot.run((job) => {
            job.finish(outcome.succeeded, outcome.diagnostics[0]?.message);
          });
        },
        abort() {
          // See this module's own doc comment: the suite only ever calls this
          // after `finish` has already settled the run, so there is nothing
          // left to do.
        },
      };
      runs.push(run);
      current = run;
      void result.value.done.then(() => {
        settled = true;
        if (current === run) current = undefined;
      });

      return { ok: true, value: run.handle };
    },

    cancel(handle) {
      return real.cancel(handle);
    },

    reset() {
      return real.reset();
    },

    // 3e: delegates straight to the real backend, same as `cancel`/`reset`
    // above. Not exercised by `backend-contract-suite.ts` today (that suite
    // predates 3e and has no case naming `probeRuntime`) — this double's
    // simulated `getDirectoryMembers` always answers empty (see the comment
    // on that case in `buildClient`), so a probe run through this fixture
    // would settle successfully on `SYSCC` and then fail to find its own
    // output file. `proc-python-backend.test.ts`'s own `probeRuntime` cases
    // use a smaller, purpose-built client instead, scripted for that
    // method's exact call sequence, rather than extending this shared
    // double to special-case a second kind of job alongside `execute()`'s.
    probeRuntime() {
      return real.probeRuntime();
    },

    async close(): Promise<void> {
      await real.close();
      connected = false;
      closed = true;
    },
  };
};
