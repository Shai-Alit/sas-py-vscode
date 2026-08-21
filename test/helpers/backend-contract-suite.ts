// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * ADR-0015, clause by clause — exported as a suite over a factory rather than
 * written against one fixed double.
 *
 * `src/backend/backend.ts` is types, and types compile whether or not anyone
 * can satisfy them. `test/unit/backend-contract.test.ts` used to construct
 * `createFakeBackend()` directly in all twenty-three cases below, which meant
 * its own header's claim — "when slice 3a's `PROC PYTHON` backend arrives it
 * should be able to run this same file" — was not true: there was no factory
 * parameter and no exported suite, so nothing outside this module could reuse
 * it. This is that refactor. The subject is still the *contract*, not the
 * double: every test here should read as a sentence from the ADR.
 *
 * `createBackend` is typed against {@link FakeBackend}, not the bare
 * `ExecutionBackend` from `src/backend/backend.ts`, because the tests need
 * more than the seam itself — `.runs`, `.connected`, `.closed`, and each run's
 * `finish`/`emit`/`abort` are how a test drives an outcome instead of waiting
 * on a timer. That is the interface 3a's own double has to satisfy to reuse
 * this suite, not a promise about how 3a's real `PROC PYTHON` backend talks to
 * Viya underneath it. Whether 3a's double is driven by a recording
 * `ComputeClient` releasing scripted responses, or something else, is 3a's
 * decision — this file does not anticipate it.
 */

import assert from "node:assert/strict";

import { collect } from "../../src/backend/collect";
import {
  fakeProgram,
  type FakeBackend,
  type FakeBackendOptions,
} from "./fake-backend";

/** Builds a fresh backend for one test. Called once per `it`, never shared. */
export type BackendFactory = (options?: FakeBackendOptions) => FakeBackend;

export function describeExecutionBackendContract(
  createBackend: BackendFactory,
): void {
  describe("the ExecutionBackend contract", () => {
    describe("connecting", () => {
      it("refuses to run before it is connected", async () => {
        const backend = createBackend();
        const result = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "not-connected");
        assert.equal(backend.runs.length, 0);
      });

      it("connects twice without complaint", async () => {
        const backend = createBackend();
        assert.ok((await backend.connect()).ok);
        assert.ok((await backend.connect()).ok);
        assert.ok(backend.connected);
      });

      it("reports a connection failure rather than throwing", async () => {
        const backend = createBackend({
          connectProblem: { code: "backend-gone", detail: "no such session" },
        });
        const result = await backend.connect();
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "backend-gone");
        assert.ok(!backend.connected);
      });

      it("does not create a session of its own", () => {
        // ADR-0012 gives session lifetime to the session manager and ADR-0013
        // opens the session at sign-in. There is nothing to assert about an
        // absence except that the interface offers no way to do it — no
        // `create`, no session argument on `connect` — so this test exists to
        // fail loudly in review if one is ever added.
        const backend = createBackend();
        assert.ok(
          !Object.prototype.hasOwnProperty.call(backend, "createSession"),
        );
      });
    });

    describe("running one program at a time", () => {
      it("is busy while a run is in flight and free once it settles", async () => {
        const backend = createBackend();
        await backend.connect();
        assert.ok(!backend.busy);

        const accepted = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);
        assert.ok(backend.busy);

        backend.runs[0]?.finish({ succeeded: true, diagnostics: [] });
        await accepted.value.done;
        assert.ok(!backend.busy);
      });

      it("rejects a second run and does not queue it", async () => {
        // The clause with the most consequences above the seam: the extension
        // refuses rather than accumulating work nobody can see. A queue is a
        // visible policy decision and belongs to the slice with a status bar
        // in it, so the evidence here is that *nothing was accepted*.
        const backend = createBackend();
        await backend.connect();
        const first = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(first.ok);

        const second = await backend.execute(fakeProgram("print(2)"), {
          freshNamespace: false,
        });
        assert.ok(!second.ok);
        assert.equal(second.problem.code, "busy");
        assert.equal(backend.runs.length, 1);
      });

      it("names the run that is in the way", async () => {
        const backend = createBackend();
        await backend.connect();
        const first = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(first.ok);

        const second = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(!second.ok);
        assert.ok(second.problem.code === "busy");
        assert.equal(second.problem.running, first.value.id);
      });
    });

    describe("the program is bytes", () => {
      it("carries the bytes through unchanged", async () => {
        // ADR-0014 in executable form. The hostile string is the one from
        // probe finding 31 — the line that ends a `SUBMIT` block from inside a
        // Python string — and the point is that it is not special here,
        // because there is no code text for anything to interpolate it into.
        const source = "s = '''\nendsubmit;\n'''\nprint(len(s))\n";
        const backend = createBackend();
        await backend.connect();
        const accepted = await backend.execute(fakeProgram(source), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);

        const received = backend.runs[0]?.program.bytes;
        assert.ok(received !== undefined);
        assert.equal(new TextDecoder().decode(received), source);
      });

      it("keeps the origin with the bytes", async () => {
        const backend = createBackend();
        await backend.connect();
        await backend.execute(fakeProgram(), { freshNamespace: false });
        assert.equal(backend.runs[0]?.program.origin.lineOffset, 0);
      });
    });

    describe("a fresh namespace", () => {
      it("is refused explicitly by a backend that cannot provide one", async () => {
        // The clause that keeps a degraded backend honest. Quietly reusing
        // the namespace would present as the user's own bug, in their own
        // code, and nothing in the log would say otherwise.
        const backend = createBackend({ freshNamespace: false });
        await backend.connect();
        const result = await backend.execute(fakeProgram(), {
          freshNamespace: true,
        });
        assert.ok(!result.ok);
        assert.ok(result.problem.code === "unsupported");
        assert.equal(result.problem.feature, "freshNamespace");
        assert.equal(backend.runs.length, 0);
      });

      it("does not stand in the way of a run that did not ask for one", async () => {
        const backend = createBackend({ freshNamespace: false });
        await backend.connect();
        const result = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(result.ok);
      });

      it("is available on its own through reset", async () => {
        const backend = createBackend();
        await backend.connect();
        assert.ok((await backend.reset()).ok);
      });

      it("refuses reset for the same reason, before connecting", async () => {
        const backend = createBackend();
        const result = await backend.reset();
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "not-connected");
      });
    });

    describe("transfer", () => {
      it("reports that nothing ran when the bytes never arrived", async () => {
        // The price ADR-0015 pays for a single `execute` rather than a
        // `stage` then a `run`: this distinction has to live in the failure
        // value. If the member disappears, so does a caller's ability to
        // know a retry is safe.
        const backend = createBackend({
          transferProblem: {
            code: "transfer-failed",
            detail: "428 on the fileref upload",
          },
        });
        await backend.connect();
        const result = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "transfer-failed");
        assert.equal(backend.runs.length, 0);
        assert.ok(!backend.busy);
      });
    });

    describe("the handle streams", () => {
      it("yields output before the run has settled", async () => {
        // The reason the seam returns a handle instead of a finished result.
        // If this ever has to wait for `done`, slices 2c, 3b and 3d lose the
        // thing they were built on.
        const backend = createBackend();
        await backend.connect();
        const accepted = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);

        const run = backend.runs[0];
        assert.ok(run !== undefined);
        run.emit({ mime: "text/plain", data: "still going" });

        const iterator = accepted.value.outputs[Symbol.asyncIterator]();
        const first = await iterator.next();
        assert.ok(!first.done);
        assert.equal(first.value.data, "still going");
        assert.ok(!run.settled);
      });

      it("lets a caller await the outcome without iterating at all", async () => {
        // A backend that stalls waiting for a consumer would make `done` a
        // trap for every caller that only wants to know whether it worked.
        const backend = createBackend();
        await backend.connect();
        const accepted = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);

        backend.runs[0]?.emit({ mime: "text/plain", data: "ignored" });
        backend.runs[0]?.finish({ succeeded: true, diagnostics: [] });

        const settled = await accepted.value.done;
        assert.ok(settled.ok);
        assert.ok(settled.value.succeeded);
      });

      it("settles once, and says the same thing every time it is awaited", async () => {
        const backend = createBackend();
        await backend.connect();
        const accepted = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);

        const run = backend.runs[0];
        assert.ok(run !== undefined);
        run.finish({ succeeded: true, diagnostics: [] });
        // A second ending must not overwrite the first: whichever conclusion
        // the run reached is the one the user saw.
        run.finish({ succeeded: false, diagnostics: [] });
        run.abort({ code: "backend-gone", detail: "too late" });

        const first = await accepted.value.done;
        const second = await accepted.value.done;
        assert.deepEqual(first, second);
        assert.ok(first.ok);
        assert.ok(first.value.succeeded);
      });
    });

    describe("cancelling", () => {
      it("settles the run as cancelled rather than as an outcome", async () => {
        const backend = createBackend();
        await backend.connect();
        const accepted = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);

        assert.ok((await backend.cancel(accepted.value)).ok);
        const settled = await accepted.value.done;
        assert.ok(!settled.ok);
        assert.equal(settled.problem.code, "cancelled");
        assert.ok(!backend.busy);
      });

      it("succeeds and does nothing for a run that already finished", async () => {
        // A user who hits Cancel as the run completes has not made a
        // mistake, and must not be shown a failure for winning a race.
        const backend = createBackend();
        await backend.connect();
        const accepted = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);
        backend.runs[0]?.finish({ succeeded: true, diagnostics: [] });

        const cancelled = await backend.cancel(accepted.value);
        assert.ok(cancelled.ok);
        const settled = await accepted.value.done;
        assert.ok(settled.ok);
        assert.ok(settled.value.succeeded);
      });

      it("ends the output stream, so a collector does not wait forever", async () => {
        const backend = createBackend();
        await backend.connect();
        const accepted = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);

        const collecting = collect(accepted.value);
        await backend.cancel(accepted.value);
        const result = await collecting;
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "cancelled");
      });
    });

    describe("closing", () => {
      it("cancels what is in flight and disconnects", async () => {
        const backend = createBackend();
        await backend.connect();
        const accepted = await backend.execute(fakeProgram(), {
          freshNamespace: false,
        });
        assert.ok(accepted.ok);

        await backend.close();
        const settled = await accepted.value.done;
        assert.ok(!settled.ok);
        assert.ok(backend.closed);
        assert.ok(!backend.connected);
      });

      it("closes twice without complaint", async () => {
        const backend = createBackend();
        await backend.connect();
        await backend.close();
        await backend.close();
        assert.ok(backend.closed);
      });
    });

    describe("capabilities", () => {
      it("answers without I/O, and admits it has not probed the runtime", async () => {
        // Stage 1 and stage 2 are separated because you cannot ask Python its
        // version before you can run Python (§2.3). `unprobed` is that
        // separation made visible, and slice 3e is what widens it.
        const backend = createBackend();
        const before = backend.capabilities();
        await backend.connect();
        const after = backend.capabilities();

        assert.deepEqual(before, after);
        assert.equal(after.runtime, "unprobed");
        assert.equal(after.dialect, "viya4");
      });
    });
  });
}
