// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { type RichOutput } from "../../src/backend/backend";
import {
  ProcPythonBackend,
  type SubmissionGuard,
} from "../../src/backend/procPython";
import {
  type ComputeClient,
  type ComputeResult,
  createComputeClient,
} from "../../src/compute/client";
import { resolveContext } from "../../src/compute/contexts";
import { listSessionFiles } from "../../src/compute/files";
import { type ComputeProblem } from "../../src/compute/problems";
import {
  type ComputeSession,
  createSession,
  deleteSession,
  SESSION_NAME,
  waitWhilePending,
} from "../../src/compute/session";
import { type Dialect } from "../../src/dialects/dialect";
import { fakeProgram } from "../helpers/fake-backend";
import { liveTarget, requireMutation } from "../helpers/live-gate";

/** Overrides `DEFAULT_CONTEXT`, matching `viya4-job.test.ts`'s own variable. */
const CONTEXT_VAR = "PYTHON_ON_VIYA_TEST_VIYA4_CONTEXT";
const DEFAULT_CONTEXT = "SAS Job Execution compute context";

/**
 * ADR-0019's mechanism (slice 3c-i), end to end against a real Viya 4
 * deployment.
 *
 * Every other tier proves this backend against a recorded or fake transport:
 * `test/unit/compute-files.test.ts` and `test/unit/backend-rich-output.test.ts`
 * prove the wire mechanics and the pure decision logic in isolation, and
 * `test/unit/proc-python-backend.test.ts` proves `runProgram` calls both in the
 * right order against a scripted `ComputeClient`. None of them prove that a
 * real deployment's `getFiles` → `getDirectoryMembers` → `getFile` chain still
 * answers the way findings 61/65/67/68 recorded it, or that `fig.savefig(...)`
 * inside a real `PROC PYTHON` run actually produces a file this mechanism can
 * see. This is that proof: one `ProcPythonBackend.execute()` call, running a
 * real matplotlib figure through a real session, asserting the `image/png`
 * `RichOutput` that comes back and that the captured file is gone afterward
 * (ADR-0019 point 9).
 *
 * **No capability probe.** Same posture `viya4-job.test.ts` takes for the SAS
 * interpreter itself: whether a deployment has `PROC PYTHON` and matplotlib
 * available is a property of that deployment, not of this code — 3e's
 * capability probe is the slice that will own detecting it. A deployment
 * without them fails this test with a SAS-side or Python-side error rather
 * than a silent skip, which is an honest limitation of this suite rather than
 * a decision to hide it.
 *
 * **What this does not prove.** The `text/html` arm (`pandas.DataFrame.to_html()`)
 * is not exercised here — `image/png` alone already walks the full
 * list/run/diff/fetch/decode/delete path findings 61-68 measured, and a second
 * file would cost one more `getFile`/`deleteFile` round trip against a real
 * deployment for no additional mechanism coverage. The size cap (ADR-0019
 * point 7) is unit-tested only: provoking a real >10 MiB figure here would
 * make this suite's runtime and Viya's disk usage the price of a case the unit
 * tier already covers deterministically.
 */
describe("live: Viya 4 rich-output capture (ADR-0019)", function () {
  const target = liveTarget("viya4");
  const contextName = process.env[CONTEXT_VAR] ?? DEFAULT_CONTEXT;

  // One session, one job, one PNG round trip, one directory re-listing —
  // generous headroom over `submission-corpus.test.ts`'s four-request budget
  // for the extra job-execution and log-drain time a real `PROC PYTHON` run
  // (matplotlib import included) costs over a bare fileref round trip.
  this.timeout(120_000);

  let client: ComputeClient | undefined;
  let session: ComputeSession | undefined;

  before(function () {
    if (!target?.allowMutation) {
      this.skip();
      return;
    }
    client = createComputeClient({
      root: target.baseUrl,
      token: () => target.token,
    });
  });

  after(async function () {
    if (client === undefined || session === undefined) return;
    const doomed = session;
    session = undefined;
    const result = await deleteSession(client, doomed);
    if (!result.ok) {
      console.warn(
        `live: the compute session was not deleted (${describeFailure(result.problem)}); look for a session named "${SESSION_NAME}" on the deployment`,
      );
    }
  });

  it("captures a matplotlib figure as image/png and deletes it afterward", async function () {
    if (!target || client === undefined) {
      this.skip();
      return;
    }
    requireMutation(target);
    const compute = client;

    const resolved = await expectOk(
      resolveContext(compute, contextName),
      (failure) =>
        `the compute context "${contextName}" could not be resolved (${failure})`,
    );
    if (resolved === undefined) {
      assert.fail(
        `no compute context named "${contextName}" was returned by the deployment. Set ${CONTEXT_VAR} to a compute context this account can use.`,
      );
    }
    const context = resolved;

    const created = await expectOk(
      createSession(compute, context),
      (failure) => `could not start a session in "${contextName}" (${failure})`,
    );
    session = created;
    const ready = await expectOk(
      waitWhilePending(compute, created),
      (failure) => `the session never became usable (${failure})`,
    );
    session = ready;

    // A minimal, single-purpose implementation of the two ports
    // `ProcPythonBackend` needs beyond a client and a session: this suite runs
    // exactly one execution, on one instance, so there is no cross-window
    // contention for a real `ComputeSessionManager` guard to arbitrate.
    const dialect: Dialect = {
      id: "viya4",
      deployment: { kind: "viya4", release: "live" },
      contract: "viya4",
      hasBuiltInClient: () => true,
      describe: () => "Viya 4 (live rich-output test)",
    };
    const guard: SubmissionGuard = {
      isBusy: () => false,
      startSubmission: () => true,
      endSubmission: () => undefined,
    };

    // Captured rather than left as the default no-op: `captureRichOutput`
    // swallows a listing or delete failure into exactly this sink (ADR-0019 —
    // "the run's own outcome is unaffected"), and against a real deployment,
    // for the first time, that silence is exactly what would make a genuine
    // capture-step defect indistinguishable from "the script produced no rich
    // output at all". Surfaced in the assertion below rather than trusted to
    // print on its own.
    const backgroundFailures: string[] = [];
    const backend = new ProcPythonBackend(
      compute,
      ready,
      dialect,
      guard,
      (reason) => backgroundFailures.push(reason),
    );
    const connected = await backend.connect();
    if (!connected.ok) {
      assert.fail(`connect() failed unexpectedly: ${connected.reason}`);
    }

    const program = fakeProgram(
      [
        "import matplotlib",
        "matplotlib.use('Agg')",
        "import matplotlib.pyplot as plt",
        "fig, ax = plt.subplots()",
        "ax.plot([1, 2, 3], [1, 4, 9])",
        "fig.savefig('live_rich_output.png')",
      ].join("\n"),
    );

    const accepted = await backend.execute(program, { freshNamespace: false });
    if (!accepted.ok) {
      assert.fail(`the run was not accepted: ${accepted.reason}`);
    }

    const outputs: RichOutput[] = [];
    for await (const output of accepted.value.outputs) outputs.push(output);
    const settled = await accepted.value.done;

    if (!settled.ok) {
      assert.fail(`the run did not reach an outcome: ${settled.reason}`);
    }
    assert.ok(
      settled.value.succeeded,
      // The log lines are this run's own text/plain outputs — printed here
      // rather than swallowed, since a failure at this point is almost always
      // matplotlib or PROC PYTHON not being available on this deployment,
      // which the person running this suite needs to see to tell it apart
      // from a real defect.
      `the Python program did not run to a successful conclusion: ${settled.value.diagnostics.map((d) => d.message).join("; ")}. Output: ${outputs.map((o) => (o.mime === "text/plain" ? o.data : `[${o.mime}]`)).join("")}`,
    );

    const png = outputs.find(
      (output): output is Extract<RichOutput, { mime: "image/png" }> =>
        output.mime === "image/png",
    );
    assert.ok(
      png !== undefined,
      `no image/png output was captured (${String(outputs.length)} output(s): ${outputs.map((o) => o.mime).join(", ")}). background failures: ${backgroundFailures.length === 0 ? "(none — no listing or delete failure was reported; the file was genuinely never seen as a candidate)" : backgroundFailures.join("; ")}`,
    );

    const bytes = Buffer.from(png.data, "base64");
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "the captured output did not start with a PNG signature",
    );

    // ADR-0019 point 9: a successfully captured file is deleted afterward.
    const remaining = await expectOk(
      listSessionFiles(compute, ready),
      (failure) =>
        `the working directory could not be listed after the run (${failure})`,
    );
    assert.equal(
      remaining.some((file) => file.name === "live_rich_output.png"),
      false,
      "the captured PNG was still in the session's working directory after the run",
    );
  });
});

/**
 * Unwraps a {@link ComputeResult}, failing with the message the caller
 * composes. Same shape as `viya4-job.test.ts`'s helper of the same name.
 */
async function expectOk<T>(
  result: ComputeResult<T> | Promise<ComputeResult<T>>,
  onFailure: (failure: string) => string,
): Promise<T> {
  const settled = await result;
  if (!settled.ok) {
    assert.fail(onFailure(describeFailure(settled.problem)));
  }
  return settled.value;
}

/**
 * A live failure, in the only terms this tier is allowed to print — see
 * `viya4-job.test.ts`'s copy of this function for the full argument.
 */
function describeFailure(problem: ComputeProblem): string {
  return "error" in problem
    ? `${problem.code}, HTTP ${String(problem.error.status)}`
    : problem.code;
}
