// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * An {@link ExecutionBackend} that runs nothing.
 *
 * This is the specification for ADR-0015, in the only form that can be checked.
 * Slice 2b-i freezes the seam and slice 3a writes the first implementation of it,
 * so for a slice or two the interface would otherwise sit with nothing trying to
 * satisfy it — and an interface nobody has implemented is an interface that is
 * wrong somewhere. This double implements every clause, and
 * `test/unit/backend-contract.test.ts` drives every clause through it.
 *
 * It has a second life once 3a lands: everything *above* the seam — the notebook
 * controller, the output view, diagnostics — can be unit-tested against this
 * without a Viya deployment, which is the practical form of §2.1's "test the Viya
 * path properly".
 *
 * The run is driven from the test rather than by a timer. Nothing here resolves
 * on its own, so a test that forgets to finish a run hangs visibly instead of
 * passing by accident.
 */

import type { Uri } from "vscode";

import type {
  BackendCapabilities,
  ExecuteOptions,
  ExecutionBackend,
  ExecutionHandle,
  ExecutionOutcome,
  Program,
  RichOutput,
} from "../../src/backend/backend";
import {
  type BackendProblem,
  type BackendResult,
  fail,
} from "../../src/backend/problems";
import { resolveDialect } from "../../src/dialects/resolve";

/** The controls a test uses to drive one run. */
export interface FakeRun {
  readonly handle: ExecutionHandle;
  /** The program as the backend received it. */
  readonly program: Program;
  readonly options: ExecuteOptions;
  /** Whether this run is still in flight. */
  readonly settled: boolean;
  /** Streams one output to whoever is iterating. */
  emit(output: RichOutput): void;
  /** Ends the run with an outcome — including an unsuccessful one. */
  finish(outcome: ExecutionOutcome): void;
  /** Ends the run with a seam failure: it never reached a conclusion. */
  abort(problem: BackendProblem): void;
}

export interface FakeBackendOptions {
  /** Fails every {@link ExecutionBackend.connect}. */
  connectProblem?: BackendProblem;
  /** Fails every {@link ExecutionBackend.execute} before the run is accepted. */
  transferProblem?: BackendProblem;
  /**
   * Whether this backend can clear the interpreter's globals.
   *
   * `false` models the degraded backend ADR-0015 legislates for: it must refuse
   * `freshNamespace` with `unsupported` rather than quietly reuse a namespace.
   */
  freshNamespace?: boolean;
}

export interface FakeBackend extends ExecutionBackend {
  /** Every run this backend has accepted, in order. */
  readonly runs: readonly FakeRun[];
  /** The run currently in flight, if any. */
  readonly current: FakeRun | undefined;
  readonly connected: boolean;
  readonly closed: boolean;
}

/**
 * A {@link Program} for a test that does not care what the program says.
 *
 * The `uri` is a structural stand-in rather than a real `vscode.Uri`: the unit
 * tier has no `vscode` module to construct one from, and the seam only ever
 * carries the value through to the offset map in slice 3c. A test that starts
 * caring what is in it should build a real one in the integration tier.
 */
export function fakeProgram(source = "print('hello')"): Program {
  return {
    bytes: new TextEncoder().encode(source),
    origin: {
      uri: { scheme: "file", path: "/workspace/program.py" } as unknown as Uri,
      lineOffset: 0,
    },
  };
}

/** A push-driven `AsyncIterable`, which is what a streaming handle needs. */
function createStream(): {
  readonly iterable: AsyncIterable<RichOutput>;
  push(output: RichOutput): void;
  end(): void;
} {
  const buffered: RichOutput[] = [];
  let ended = false;
  let wake: (() => void) | undefined;

  const nudge = (): void => {
    const waiting = wake;
    wake = undefined;
    waiting?.();
  };

  return {
    iterable: {
      async *[Symbol.asyncIterator](): AsyncGenerator<RichOutput> {
        for (;;) {
          const next = buffered.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    },
    push(output) {
      buffered.push(output);
      nudge();
    },
    end() {
      ended = true;
      nudge();
    },
  };
}

/**
 * Builds a backend that does nothing until told to.
 *
 * Capabilities come from a real {@link resolveDialect} on an unknown deployment —
 * the fail-soft path — so a test that reads them sees the shape the extension
 * will actually see rather than a hand-written literal that can drift from it.
 */
export function createFakeBackend(
  options: FakeBackendOptions = {},
): FakeBackend {
  const runs: FakeRun[] = [];
  let connected = false;
  let closed = false;
  let current: FakeRun | undefined;
  let counter = 0;

  const freshNamespaceSupported = options.freshNamespace ?? true;
  const { dialect } = resolveDialect({ kind: "unknown" });

  const capabilities: BackendCapabilities = {
    dialect: dialect.id,
    deployment: dialect.deployment,
    runtime: "unprobed",
  };

  const startRun = (program: Program, opts: ExecuteOptions): FakeRun => {
    const stream = createStream();
    const id = `run-${String(++counter)}`;
    let settle: (result: BackendResult<ExecutionOutcome>) => void = () => {
      /* replaced synchronously below */
    };
    const done = new Promise<BackendResult<ExecutionOutcome>>((resolve) => {
      settle = resolve;
    });

    let settled = false;
    const end = (result: BackendResult<ExecutionOutcome>): void => {
      if (settled) return;
      settled = true;
      current = undefined;
      stream.end();
      settle(result);
    };

    const run: FakeRun = {
      handle: { id, outputs: stream.iterable, done },
      program,
      options: opts,
      get settled() {
        return settled;
      },
      emit(output) {
        if (!settled) stream.push(output);
      },
      finish(outcome) {
        end({ ok: true, value: outcome });
      },
      abort(problem) {
        end(fail(problem, `running ${id}`));
      },
    };
    return run;
  };

  return {
    id: "fake",
    capabilities: () => capabilities,

    connect() {
      if (options.connectProblem !== undefined) {
        return Promise.resolve(fail(options.connectProblem, "connecting"));
      }
      connected = true;
      closed = false;
      return Promise.resolve({ ok: true, value: undefined });
    },

    get busy() {
      return current !== undefined;
    },

    execute(program, opts) {
      if (!connected) {
        return Promise.resolve(fail({ code: "not-connected" }, "running"));
      }
      if (current !== undefined) {
        return Promise.resolve(
          fail({ code: "busy", running: current.handle.id }, "running"),
        );
      }
      if (opts.freshNamespace && !freshNamespaceSupported) {
        return Promise.resolve(
          fail(
            {
              code: "unsupported",
              feature: "freshNamespace",
              reason: "this backend cannot clear the interpreter",
            },
            "running",
          ),
        );
      }
      if (options.transferProblem !== undefined) {
        return Promise.resolve(fail(options.transferProblem, "running"));
      }

      const run = startRun(program, opts);
      runs.push(run);
      current = run;
      return Promise.resolve({ ok: true, value: run.handle });
    },

    cancel(handle) {
      const run = runs.find((candidate) => candidate.handle.id === handle.id);
      if (run === undefined) {
        return Promise.resolve(
          fail(
            {
              code: "backend-failed",
              detail: `no run with id ${handle.id}`,
            },
            "cancelling",
          ),
        );
      }
      // Cancelling a settled run succeeds and does nothing — a user who hits
      // Cancel as the run finishes has not made a mistake.
      run.abort({ code: "cancelled" });
      return Promise.resolve({ ok: true, value: undefined });
    },

    reset() {
      if (!connected) {
        return Promise.resolve(fail({ code: "not-connected" }, "resetting"));
      }
      if (!freshNamespaceSupported) {
        return Promise.resolve(
          fail(
            {
              code: "unsupported",
              feature: "reset",
              reason: "this backend cannot clear the interpreter",
            },
            "resetting",
          ),
        );
      }
      return Promise.resolve({ ok: true, value: undefined });
    },

    close() {
      current?.abort({ code: "cancelled" });
      connected = false;
      closed = true;
      return Promise.resolve();
    },

    get runs() {
      return runs;
    },
    get current() {
      return current;
    },
    get connected() {
      return connected;
    },
    get closed() {
      return closed;
    },
  };
}
