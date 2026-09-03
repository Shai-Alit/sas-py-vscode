// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  type ComputeClient,
  type ComputeResult,
  createComputeClient,
} from "../../src/compute/client";
import { resolveContext } from "../../src/compute/contexts";
import {
  cancelJob,
  createJob,
  isTerminal,
  readJobState,
} from "../../src/compute/job";
import { type ComputeProblem } from "../../src/compute/problems";
import {
  type ComputeSession,
  createSession,
  deleteSession,
  SESSION_NAME,
  waitWhilePending,
} from "../../src/compute/session";
import { liveTarget, requireMutation } from "../helpers/live-gate";

/** Overrides `DEFAULT_CONTEXT`, matching `viya4-job.test.ts`'s own variable. */
const CONTEXT_VAR = "PYTHON_ON_VIYA_TEST_VIYA4_CONTEXT";
const DEFAULT_CONTEXT = "SAS Job Execution compute context";

/**
 * How long the submitted step sleeps for. Long enough that the cancel below
 * lands while the statement is genuinely in flight (Findings 75/76 both
 * cancelled a running job, not a queued one); short enough that the session's
 * teardown in the `after` hook — which, per Finding 76, waits out whatever of
 * this duration is left — does not dominate the run. A `data _null_` sleep,
 * not `PROC PYTHON`: the `If-Match` requirement this suite guards is a property
 * of the job-cancel endpoint, independent of what the job runs, and a SAS-only
 * step keeps the suite from failing on a deployment with no Python interpreter
 * configured — the same posture `viya4-job.test.ts` takes.
 */
const SLEEP_SECONDS = 30;

/**
 * `cancelJob`'s `If-Match` round trip (Finding 75) against a real Viya 4.
 *
 * ## Why this suite exists
 *
 * `test/unit/compute-job.test.ts` proves `cancelJob` reads a fresh `ETag` off
 * the `self` relation and sends it as `If-Match` — against a scripted
 * transport. What no unit tier can prove is that a live deployment still
 * *requires* that header: Phase 4's Finding 75 measured a bare `PUT
 * …/state?value=canceled` answering **`428 Precondition Required`** every time
 * on `verde`, and the shipped `cancelJob` was rejected outright until the fix
 * landed in slice 4c. That regression had no automated guard — only a by-hand
 * check on 2026-09-01 (`STATUS.md`) — which is the live-coverage gap slice 5b's
 * audit found and this suite closes.
 *
 * ## What it asserts, and what it deliberately does not
 *
 * One thing, firmly: `cancelJob` against a running job comes back `ok`. Because
 * a bare cancel is a `428` on this deployment (Finding 75), an `ok` result is
 * end-to-end proof that the fresh-`ETag` `If-Match` path still works — the job
 * is read for its `self` `ETag`, the `PUT` carries it, and the deployment
 * accepts it.
 *
 * It does **not** assert that the job stops promptly. Finding 76 measured the
 * opposite: after an accepted cancel the job's `state` endpoint answered
 * `running` for 24+ seconds before eventually settling to `canceled`, and the
 * cancelled step ran its full natural duration before SAS tore it down. So the
 * terminal-state check below is best-effort and `console.warn`s rather than
 * failing — asserting a prompt `canceled` would be flaky by that finding's own
 * measurement. Non-preemption itself is Python-statement-specific (SAS controls
 * the boundary a cancel takes effect on) and is not something this SAS-only
 * step is written to reproduce.
 *
 * ## What it costs the deployment
 *
 * One compute session, alive for the length of the run and deleted in the
 * `after` hook — which, per Finding 76, blocks until the cancelled step's
 * natural end. One job, not deleted (nothing here deletes a job; the session's
 * teardown takes it).
 *
 * The session's name is `SESSION_NAME`, the constant inside the module under
 * test, and cannot be per-run unique for the reason `viya4-job.test.ts` gives.
 * `CONTRIBUTING.md`'s per-run-uniqueness requirement is met the same way that
 * suite meets it: the submitted step is prefixed with a `%put` of a per-run
 * random marker, so a session or job this run leaks (an `after`-hook failure,
 * an overlapping run, a Mocha timeout mid-test) can be tied back to it by
 * `grep`-ing that marker in the leaked resource's log. Nothing here reads the
 * marker back — it only has to be *emitted*.
 */
describe("live: Viya 4 job cancel (Findings 75/76)", function () {
  const target = liveTarget("viya4");
  const contextName = process.env[CONTEXT_VAR] ?? DEFAULT_CONTEXT;

  // The sleep runs to its natural end before the session frees (Finding 76), so
  // the worst case is: session create + launch wait, then the full sleep, then
  // the teardown `deleteSession` waits out. Generous headroom over that, in the
  // shape `submission-corpus.test.ts` and `proc-python-rich-output.test.ts` use.
  //
  // A flat number, not `viya4-job.test.ts`'s computed
  // `MAX_WAIT_WINDOWS * (DEFAULT_WAIT_SECONDS + WAIT_MARGIN_SECONDS) * 1000 + …`
  // ceiling. That suite needs the formula because it then runs a long
  // log-stream poll whose duration no constant bounds; this one has no such
  // poll, only a session launch and two short bounded state polls. The cost of
  // the flat number is that a pathologically slow-but-legitimate
  // `waitWhilePending` would surface here as a Mocha timeout rather than as the
  // slow launch it was — accepted, as the two sibling suites accept it, because
  // that failure mode is rare and the formula's ~750 s ceiling turns a genuine
  // hang into a twelve-minute wait.
  this.timeout(120_000);

  let client: ComputeClient | undefined;
  let session: ComputeSession | undefined;

  before(function () {
    // No credentials means the tier is not configured here; credentials without
    // the mutation flag means it is configured and this suite is not permitted
    // to write. Both skip — see `viya4-job.test.ts`'s hook for the full
    // argument — and `requireMutation` below is the guarantee that survives a
    // later restructuring of these hooks.
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

  it("cancels a running job with a fresh If-Match and the deployment accepts it", async function () {
    if (!target || client === undefined) {
      // Unreachable: the hook above skipped the suite. Present because the
      // compiler cannot see that.
      this.skip();
      return;
    }
    const compute = client;

    // The last thing between this test and a `PUT` that changes server state.
    // Redundant with the `before` skip today, and positioned here so a later
    // edit to the hooks cannot get round it — the same role it plays in
    // `viya4-job.test.ts`.
    requireMutation(target);

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

    // The per-run breadcrumb. Hex and upper-case, not the UUID's own hyphenated
    // form, so it survives the SAS macro processor unchanged — the same shape
    // and reasoning as `viya4-job.test.ts`'s marker. `Math.random` is banned
    // repository-wide (`eslint.config.mjs`); a collision here would let two
    // runs' leaked resources look like one.
    const marker = `PYTHONONVIYALIVE${randomUUID().replaceAll("-", "").toUpperCase()}`;

    const job = await expectOk(
      // `%put` first — it runs near-instantly and stamps the marker into the
      // session and job logs before the `data` step sleeps, so a leaked
      // resource carries it whether or not the sleep ever started.
      createJob(compute, ready, [
        `%put ${marker};`,
        "data _null_;",
        `  rc = sleep(${String(SLEEP_SECONDS)}, 1);`,
        "run;",
      ]),
      (failure) => `the job was not accepted (${failure})`,
    );

    // Cancel a job that is actually executing, not one still `pending` —
    // Findings 75/76 both measured a running job, and a queued-job cancel is a
    // different path this suite is not claiming to cover. Poll the state until
    // it leaves `pending`, with a cap: if the step is quick enough to finish
    // first the cancel still exercises the `If-Match` round trip (the `428` is
    // the endpoint's, not the state's), so a terminal state here is not a
    // failure — only a reason to note the timing was off.
    const runningBy = Date.now() + 20_000;
    let observed = job.state;
    while (
      Date.now() < runningBy &&
      (observed === "pending" || observed === "")
    ) {
      await delay(1_000);
      observed = await expectOk(
        readJobState(compute, job),
        (failure) =>
          `the job state could not be read before cancelling (${failure})`,
      );
    }
    if (observed === "pending" || observed === "") {
      console.warn(
        `live: the job was still "${observed || "(empty)"}" after 20s; cancelling anyway`,
      );
    } else if (isTerminal(observed)) {
      console.warn(
        `live: the job reached "${observed}" before it could be cancelled while running; the If-Match round trip is still exercised below`,
      );
    }

    // The assertion this suite is for. A bare cancel is a `428` on this
    // deployment (Finding 75); `ok` here is proof the fresh-`ETag` `If-Match`
    // path in `cancelJob` still satisfies it end to end.
    const cancelled = await cancelJob(compute, job);
    assert.ok(
      cancelled.ok,
      `cancelJob was rejected: ${cancelled.ok ? "" : describeFailure(cancelled.problem)}`,
    );

    // Best-effort, never asserted. Finding 76: the job's own `state` kept
    // reading `running` for 24+ seconds after an accepted cancel, settling to
    // `canceled` only once the step ended on its own. So this observes and
    // reports; it does not gate the run.
    const terminalBy = Date.now() + 45_000;
    let finalState = "";
    while (Date.now() < terminalBy) {
      const state = await readJobState(compute, job);
      if (!state.ok) {
        // A `404` here reads as the session being gone (`asSessionGone`), which
        // on this path most likely means the `after` hook has not run yet but
        // something else removed it — report and stop rather than spin.
        console.warn(
          `live: the job state could not be read back after cancelling (${describeFailure(state.problem)})`,
        );
        break;
      }
      finalState = state.value;
      if (isTerminal(finalState)) break;
      await delay(2_000);
    }
    if (!isTerminal(finalState)) {
      console.warn(
        `live: the cancelled job had not reached a terminal state after ~45s (last read "${finalState || "(unread)"}"); Finding 76 records this as expected while the step runs out its natural duration`,
      );
    } else if (finalState !== "canceled") {
      console.warn(
        `live: the cancelled job ended in "${finalState}", not "canceled"`,
      );
    }
  });
});

/** A fixed pause between state polls. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Unwraps a {@link ComputeResult}, failing with the message the caller
 * composes. Same shape as `viya4-job.test.ts`'s helper of the same name, and
 * for the same reason — `assert.equal(result.ok, true)` does not narrow the
 * union, so the alternative at every call site would be a non-null assertion.
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
 * A live failure, in the only terms this tier is allowed to print — the
 * discriminant and the HTTP status, never the `reason` string. See
 * `viya4-job.test.ts`'s copy of this function for the full argument, including
 * why `problem.detail` carries a live session id on the `compute-unreachable`
 * path.
 */
function describeFailure(problem: ComputeProblem): string {
  return "error" in problem
    ? `${problem.code}, HTTP ${String(problem.error.status)}`
    : problem.code;
}
