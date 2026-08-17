// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type {
  ExecutionHandle,
  ExecutionOutcome,
  RichOutput,
} from "../../src/backend/backend";
import { collect } from "../../src/backend/collect";
import type { BackendResult } from "../../src/backend/problems";
import {
  type FakeBackend,
  type FakeRun,
  createFakeBackend,
  fakeProgram,
} from "../helpers/fake-backend";

/**
 * `collect` is the working proof of the claim ADR-0015 rests on: that the
 * aggregate view of a run is derivable from the streaming one, so the seam did
 * not have to be shaped around the aggregate. If a test here ever has to reach
 * past the handle to get its answer, that claim has stopped being true.
 */

const succeeded: ExecutionOutcome = { succeeded: true, diagnostics: [] };

/** Connects a backend and starts a run, returning both halves of it. */
async function started(): Promise<{
  backend: FakeBackend;
  handle: ExecutionHandle;
  run: FakeRun;
}> {
  const backend = createFakeBackend();
  await backend.connect();
  const accepted = await backend.execute(fakeProgram(), {
    freshNamespace: true,
  });
  assert.ok(accepted.ok);
  const run = backend.runs[0];
  assert.ok(run !== undefined);
  return { backend, handle: accepted.value, run };
}

/**
 * An output stream that yields one part and then throws.
 *
 * It has to be an *async* generator to be an `AsyncIterable<RichOutput>`, which
 * is what an `ExecutionHandle` carries, so `require-await` sees an async
 * function with nothing awaited. There is nothing to await: the whole subject of
 * these two tests is a stream that fails, and adding an `await` to satisfy the
 * rule would put a statement in this function that no test is about.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- must be an async generator to satisfy AsyncIterable; see above.
async function* brokenStream(message: string): AsyncGenerator<RichOutput> {
  yield { mime: "text/plain", data: "one line, then trouble" };
  throw new Error(message);
}

/** A handle built by hand, for shapes a correct backend should never produce. */
function handleOf(
  outputs: AsyncIterable<RichOutput>,
  done: Promise<BackendResult<ExecutionOutcome>>,
): ExecutionHandle {
  return { id: "run-hand-made", outputs, done };
}

describe("collect", () => {
  it("returns the outputs in order, with the outcome", async () => {
    const { handle, run } = await started();

    const collecting = collect(handle);
    run.emit({ mime: "text/plain", data: "first" });
    run.emit({ mime: "text/plain", data: "second" });
    run.finish(succeeded);

    const result = await collecting;
    assert.ok(result.ok);
    assert.ok(result.value.succeeded);
    assert.deepEqual(
      result.value.outputs.map((output) => output.data),
      ["first", "second"],
    );
  });

  it("treats a program that raised as a successful collection", async () => {
    // The distinction the failure union is built around: the backend did its
    // job, the program did not. If this ever comes back as a failure, every
    // user's own exception starts being presented as an extension malfunction.
    const { handle, run } = await started();

    const collecting = collect(handle);
    run.emit({
      mime: "application/vnd.python.traceback",
      data: {
        message: "ZeroDivisionError: division by zero",
        frames: [{ file: "program.py", line: 3, name: "main" }],
      },
    });
    run.finish({
      succeeded: false,
      diagnostics: [
        { severity: "error", message: "division by zero", line: 3 },
      ],
    });

    const result = await collecting;
    assert.ok(result.ok);
    assert.ok(!result.value.succeeded);
    assert.equal(result.value.outputs.length, 1);
    assert.equal(result.value.diagnostics.length, 1);
  });

  it("returns the failure when the run never reached a conclusion", async () => {
    const { handle, run } = await started();

    const collecting = collect(handle);
    run.emit({ mime: "text/plain", data: "some output before it died" });
    run.abort({ code: "backend-gone", detail: "the session was deleted" });

    const result = await collecting;
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "backend-gone");
    // The partial output is dropped with the failure, deliberately: there is no
    // outcome to attach it to, and an `ExecutionResult` that reports neither
    // success nor failure is worse than none.
  });

  it("passes a cancellation through unchanged", async () => {
    const { handle, run } = await started();

    const collecting = collect(handle);
    run.abort({ code: "cancelled" });

    const result = await collecting;
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "cancelled");
    assert.match(result.reason, /cancelled/);
  });

  it("does not throw when the output stream does", async () => {
    // No correct backend does this. `collect` runs on the path where something
    // has already gone wrong, so it has to be total for handles that are wrong
    // too — the alternative is an exception escaping into the extension host,
    // where it reads as a crash rather than as a failed run.
    const result = await collect(
      handleOf(
        brokenStream("the stream broke"),
        Promise.resolve({ ok: true, value: succeeded }),
      ),
    );
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "backend-failed");
    assert.match(result.reason, /the stream broke/);
  });

  it("defuses a `done` that rejects, which the contract forbids", async () => {
    // The comment in `collect` made executable. A rejected `done` that nobody
    // attached a handler to becomes an unhandled rejection, which in the
    // extension host is louder and less informative than the failure we already
    // have. Mocha fails the run when one escapes, so part of this assertion is
    // the absence of that.
    const result = await collect(
      handleOf(
        brokenStream("the stream broke first"),
        Promise.reject(new Error("and done rejected too")),
      ),
    );
    assert.ok(!result.ok);
    assert.match(result.reason, /the stream broke first/);
    // Give the rejected promise a turn to become unhandled, if it is going to.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
