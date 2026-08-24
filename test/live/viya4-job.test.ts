// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  type ComputeClient,
  type ComputeResult,
  createComputeClient,
} from "../../src/compute/client";
import { listContexts, resolveContext } from "../../src/compute/contexts";
import { createJob } from "../../src/compute/job";
import { streamJobLog } from "../../src/compute/logStream";
import { type ComputeProblem } from "../../src/compute/problems";
import {
  DEFAULT_WAIT_SECONDS,
  MAX_WAIT_WINDOWS,
  SESSION_NAME,
  WAIT_MARGIN_SECONDS,
  type ComputeSession,
  createSession,
  deleteSession,
  waitWhilePending,
} from "../../src/compute/session";
import { liveTarget, requireMutation } from "../helpers/live-gate";

/** Overrides {@link DEFAULT_CONTEXT}, for a deployment that renamed its contexts. */
const CONTEXT_VAR = "PYTHON_ON_VIYA_TEST_VIYA4_CONTEXT";

/** Upstream's `DEFAULT_COMPUTE_CONTEXT`, and Viya 4's stock context name. */
const DEFAULT_CONTEXT = "SAS Job Execution compute context";

/**
 * The whole of slice 2c against a real deployment: resolve a context, start a
 * session, submit a job, read its log to the end, and delete the session.
 *
 * This is the tier's first **mutating** test, and therefore the first caller of
 * {@link requireMutation}. Until it existed the write gate had no exercised path
 * at all — it was unit-tested and never reached — so a change that quietly broke
 * it would have gone unnoticed until the day it let something write.
 *
 * ## What it asserts, and why that is enough
 *
 * One `%put` of a per-run marker, and the marker coming back out of the log. It
 * looks thin next to the unit suite, and it is a different claim: the unit tier
 * proves each module reads a recorded response correctly, and this proves the
 * responses a live deployment sends are still the ones that were recorded. A
 * marker that makes the round trip has been through `contexts.ts`, `session.ts`,
 * `job.ts`, `logStream.ts` and the transport, on real bytes.
 *
 * **No `PROC PYTHON` here, on purpose.** Whether a deployment can run Python is a
 * property of that deployment rather than of this code — it is what the dialect
 * layer's capability probe is for — and a test that failed on a Viya without a
 * Python interpreter configured would be reporting somebody's site configuration
 * as a defect in the extension. Slice 3a owns that test, and it will own the skip
 * that has to go with it.
 *
 * ## What it costs the deployment
 *
 * One compute session, alive for the length of the run and deleted in an `after`
 * hook. The job is not deleted and must not be: `job.ts` records the absence of a
 * `deleteJob` as load-bearing — it is what lets a `404` from a job resource be
 * read as the session having gone — and the session's own teardown takes the job
 * with it.
 *
 * The session's name is not unique per run, and cannot be: it is `SESSION_NAME`,
 * a constant inside the module under test, and a test that passed its own name
 * would no longer be exercising what the extension does. CONTRIBUTING.md's
 * per-run uniqueness requirement is met where it does the work — the marker,
 * which is what distinguishes this run's log from any other run's.
 */
describe("live: Viya 4 job execution", function () {
  const target = liveTarget("viya4");

  /**
   * The context to run in.
   *
   * The default is upstream's — `client/src/components/profile.ts` exports it as
   * `DEFAULT_COMPUTE_CONTEXT`, and `package.json` ships it as the default of the
   * connection profile's context setting — so it is the name most likely to
   * exist on an arbitrary Viya 4 rather than a guess. It is overridable because
   * "most likely" is not "always", and a deployment that renamed its contexts
   * should cost one environment variable rather than a code change.
   *
   * Read here rather than added to `live-gate.ts`: this is a parameter, not a
   * gate. Nothing about it decides whether the suite is allowed to run.
   */
  const contextName = process.env[CONTEXT_VAR] ?? DEFAULT_CONTEXT;

  /**
   * Above the ceiling `waitWhilePending` imposes on itself, or Mocha's number
   * becomes the thing under test: a session that took its time launching would
   * be reported as a hung client rather than as the slow launch it was.
   *
   * All three constants, because the ceiling is not
   * `MAX_WAIT_WINDOWS * DEFAULT_WAIT_SECONDS`. Each window asks the deployment
   * to hold the request for `waitSeconds` and then allows it `WAIT_MARGIN_
   * SECONDS` more before the client gives up on its own — `readSessionState`
   * sets the request timeout to `(waitSeconds + WAIT_MARGIN_SECONDS) * 1000` —
   * so the worst case is thirty twenty-five-second windows, not thirty
   * ten-second ones. Leaving the margin out put Mocha's number *below* the one
   * it is meant to sit above, which is the bug this arithmetic used to have.
   *
   * The minute on the end covers the part no constant bounds: once the job is
   * submitted `streamJobLog` polls until the state goes terminal, and a job that
   * never gets there polls until something stops it. A minute is long for one
   * `%put`. If Mocha does fire during that phase the pump is still running when
   * the test is marked failed — what stops it is the `after` hook's
   * `deleteSession`, after which the next poll reads a `404` and the stream
   * settles, one poll window later.
   */
  this.timeout(
    MAX_WAIT_WINDOWS * (DEFAULT_WAIT_SECONDS + WAIT_MARGIN_SECONDS) * 1000 +
      60_000,
  );

  let client: ComputeClient | undefined;
  let session: ComputeSession | undefined;

  before(function () {
    // One condition, two situations behind it: no credentials means the tier is
    // not configured on this machine, and credentials without the mutation flag
    // means it is configured and this suite has not been given permission to
    // write. They are deliberately *not* told apart here — Mocha reports a
    // skipped test the same way either way — and the suite-level counts are
    // where they separate, because the read-only sibling suite runs in the
    // second situation and not the first. RUNBOOK P40 steps 1 and 3 are that
    // distinction.
    //
    // Skipping rather than failing is a judgement about ergonomics, and the one
    // `docs/dev/testing.md` argues for elsewhere: a tier that goes red for
    // someone pointing it at a deployment they may only read from is a tier that
    // gets commented out. The gate itself still refuses — see the
    // `requireMutation` call below, which is what keeps the write unreachable
    // even if this hook is later restructured.
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
    // Cleared first. A second attempt after a failure would be another request to
    // a deployment that has already refused, and if the failure was a `404` the
    // session is gone anyway — `deleteSession` reports that one as a success.
    session = undefined;

    const result = await deleteSession(client, doomed);
    if (!result.ok) {
      // Reported, not asserted. A cleanup failure must not turn a passing run
      // red, but it may have left a SAS process running on somebody's real
      // deployment, and the person who ran the suite is the only one in a
      // position to go and look.
      //
      // Summarised rather than reported verbatim, for the reason `describe
      // Failure` gives: the failure's own `reason` can carry the deployment's
      // sentence about the session, session id included, and this line is
      // printed on the path where the session is most likely to still exist.
      console.warn(
        `live: the compute session was not deleted (${describeFailure(result.problem)}); look for a session named "${SESSION_NAME}" on the deployment`,
      );
    }
  });

  it("runs a job and reads its log back", async function () {
    if (!target || client === undefined) {
      // Unreachable: the hook above skipped the suite. Present because the
      // compiler cannot see that, and a non-null assertion would be a worse way
      // to tell it.
      this.skip();
      return;
    }

    // Bound to a `const` because the narrowing above does not survive into the
    // callbacks below: `client` is a `let` that a hook assigns, so inside a
    // nested function the compiler goes back to its declared type. Copying it
    // once here is the fix that stays true if the hooks change; a non-null
    // assertion at each use would only be a claim that they will not.
    const compute = client;

    // The last thing between this test and a `POST`. Redundant with the skip in
    // `before` today, and deliberately so: this is the assertion that the write
    // gate is closed, positioned where a later edit to the hooks cannot get round
    // it. It is also the only call to it anywhere outside its own unit test,
    // which is half the reason this file exists.
    requireMutation(target);

    const resolved = await expectOk(
      resolveContext(compute, contextName),
      (failure) =>
        `the compute context "${contextName}" could not be resolved (${failure})`,
    );
    // Not a `ComputeFailure`: an empty collection is a legitimate absent
    // value (see `resolveContext`'s own doc comment — a decision distinct
    // from RUNBOOK's still-open `#135`), and this suite is the caller that
    // decides what it means, the same as `sessionManager.ts` does. Here, it
    // means the fixture is broken and the run cannot continue.
    if (resolved === undefined) {
      assert.fail(
        `no compute context named "${contextName}" was returned by the deployment. ${await describeVisibleContexts(compute)} Set ${CONTEXT_VAR} to a compute context this account can use.`,
      );
    }
    const context = resolved;

    const created = await expectOk(
      createSession(compute, context),
      (failure) => `could not start a session in "${contextName}" (${failure})`,
    );
    // Recorded before anything else can fail, so that the `after` hook can delete
    // a session whose very next request went wrong.
    session = created;

    const ready = await expectOk(
      waitWhilePending(compute, created),
      (failure) => `the session never became usable (${failure})`,
    );
    session = ready;

    // The per-run unique value, and the only thing this test writes into the
    // deployment that it also reads back.
    //
    // Hex and upper case rather than the UUID as `randomUUID` formats it: the
    // text goes through the SAS macro processor on its way to the log, and a
    // value made only of `A-Z0-9` cannot be read there as anything but itself.
    // `Math.random` is banned repository-wide for exactly this use — see
    // `eslint.config.mjs` — and a collision here would be two runs reading each
    // other's log and both passing.
    const marker = `PYTHONONVIYALIVE${randomUUID().replaceAll("-", "").toUpperCase()}`;

    const job = await expectOk(
      createJob(compute, ready, [`%put ${marker};`]),
      (failure) => `the job was not accepted (${failure})`,
    );

    // The shipped defaults, including the poll window. A test that shortened them
    // would be exercising a configuration nobody runs.
    const stream = streamJobLog(compute, job);

    const lines: string[] = [];
    let dropped = 0;
    for await (const event of stream.events) {
      if (event.kind === "line") {
        lines.push(event.line.line);
      } else {
        dropped += event.lines;
      }
    }

    const end = await expectOk(
      stream.done,
      (failure) => `the log could not be read to the end (${failure})`,
    );

    if (end.outcome !== "terminal") {
      assert.fail(
        `expected the run to reach a terminal state, and it ended as "${end.outcome}"`,
      );
    }

    // `error` and not "anything but `completed`", which is what this asserted
    // first and could not support. `TERMINAL_STATES` holds five, and finding 53
    // observed two of them: `completed` and `error`. `warning` is on the list on
    // trust, its trigger was never provoked, and the reading the finding offers
    // for it — a run that produced a `WARNING:` — is one a site's own autoexec
    // can produce on a `%put` that has nothing wrong with it. Demanding
    // `completed` would fail this test for somebody's session configuration,
    // which is the same mistake the `PROC PYTHON` note above avoids.
    //
    // Judging the program's outcome properly is 3a's, through `SYSCC`. What is
    // asserted here is only that the deployment did not report the run as
    // broken; the marker below is what shows it actually ran.
    assert.notEqual(
      end.state,
      "error",
      "the deployment ended the run in the error state",
    );
    if (end.state !== "completed") {
      // Not a failure, but not silent either: a state other than `completed`
      // from a one-line `%put` is the closest thing to a live observation of
      // `warning` this suite can produce, and finding 53 lists that as still
      // wanted.
      console.warn(`live: the job ended in "${end.state}", not "completed"`);
    }

    // Zero, because a one-line log cannot reach a buffer bound measured in tens
    // of thousands. Asserted anyway: a non-zero tally here would mean the pump is
    // discarding output it has no reason to discard, which is a defect worth
    // failing on rather than a number worth ignoring. Both are checked because
    // they are computed separately — the in-stream marker and the run total.
    assert.equal(
      dropped,
      0,
      "the pump reported dropping lines from a one-line log",
    );
    assert.equal(
      end.dropped.lines,
      0,
      "the stream's own tally reported dropped lines",
    );

    assert.equal(
      lines.some((line) => line.includes(marker)),
      true,
      // The count and not the log. The rest of it belongs to the deployment, and
      // a failure message that dumped it would put a real site's SAS banner —
      // release, host name, licensed products — into whatever the run was piped
      // to.
      `the log did not contain the marker this run submitted (${String(lines.length)} lines read)`,
    );
  });
});

/**
 * Unwraps a {@link ComputeResult}, failing with the message the caller composes.
 *
 * A helper rather than `assert.equal(result.ok, true)` because that asserts
 * without narrowing — the compiler still sees a union afterwards, and the usual
 * way out of that is a non-null assertion, which would also survive the day the
 * result really is a failure. `assert.fail` returns `never`, so the narrowing
 * here is the compiler's own.
 *
 * The callback is handed {@link describeFailure}'s summary and never the
 * failure's own `reason` — see that function for why. It is a callback at all so
 * that composing the message may itself make a request ({@link
 * describeVisibleContexts} does), and so that nothing is composed on the path
 * where the result was fine.
 */
async function expectOk<T>(
  result: ComputeResult<T> | Promise<ComputeResult<T>>,
  onFailure: (failure: string) => string | Promise<string>,
): Promise<T> {
  const settled = await result;
  if (!settled.ok) {
    assert.fail(await onFailure(describeFailure(settled.problem)));
  }
  return settled.value;
}

/**
 * A live failure, in the only terms this tier is allowed to print.
 *
 * `ComputeFailure.reason` is the obvious thing to interpolate and must not be:
 * on the `compute-rejected` path it is composed by `client.ts` from
 * `describeViyaError`, which appends the deployment's own `detail` sentence —
 * and a measured example of that sentence is
 * `A session with the ID "…-ses0000" could not be found.` `live-gate.ts` is
 * unambiguous that a live failure message "may name the endpoint and the status
 * code and nothing else", and `viya4-connectivity.test.ts` already holds that
 * line. A live run's output goes into terminals, screenshots and bug reports,
 * none of which are the right home for a real session id.
 *
 * So: the discriminant, plus the HTTP status for the three variants that carry
 * one. Both are ours or the protocol's, neither is free text from the
 * deployment, and between them they say which of the nine failures happened —
 * which is what the person reading a red live run actually needs. The rest is in
 * the extension's log, where it belongs.
 *
 * `problem.detail` on the two members that carry one is not an exception to
 * this and was tried as one on 2026-08-20. `compute-unreachable`'s detail is
 * `${method} ${href} — ${message}`: the href holds a live session id, and a DNS
 * failure's message holds the internal hostname. Neither belongs in a terminal
 * either. The diagnostic that widening was meant to buy is instead written
 * down where it costs nothing — see this suite's own doc comment on what an
 * all-`compute-unreachable` run means.
 */
function describeFailure(problem: ComputeProblem): string {
  return "error" in problem
    ? `${problem.code}, HTTP ${String(problem.error.status)}`
    : problem.code;
}

/**
 * How many contexts this account can see, when `resolveContext` came back
 * empty rather than with the deployment's own failure.
 *
 * The count and not the names. A count separates the two readings worth
 * telling apart — nothing visible at all, which is a permissions problem, from
 * a collection this account can read perfectly well that simply does not hold
 * the name it was asked for, which is a spelling or configuration problem. The
 * names would add little to that and can carry a customer's or a team's name
 * in them, which is the kind of thing this repository keeps out of logs and
 * screenshots by default.
 */
async function describeVisibleContexts(client: ComputeClient): Promise<string> {
  const listed = await listContexts(client);
  if (!listed.ok) {
    return "The contexts collection could not be listed either.";
  }
  return `This account can see ${String(listed.value.length)} compute context(s).`;
}
