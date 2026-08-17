// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type BackendProblem,
  type BackendResult,
  describeBackendProblem,
  fail,
} from "../../src/backend/problems";

/**
 * Two claims, matching the shape of `compute-problems.test.ts`.
 *
 * The first is that {@link describeBackendProblem} is total. The `switch` has no
 * `default`, so a missing case is a compile error — but only running every member
 * through it proves that none of them returns an empty string, which is the way a
 * log line goes missing without anyone noticing.
 *
 * The second is about the one distinction this union exists to make: a program
 * that raises is *not* a problem here. There is no member for it, and the test
 * below is what stops one being added by someone reasoning from "the run
 * failed".
 */

/** One of every member, so the exhaustiveness claim is exercised. */
const every: BackendProblem[] = [
  { code: "not-connected" },
  { code: "busy", running: "run-1" },
  {
    code: "unsupported",
    feature: "freshNamespace",
    reason: "the runtime has no restart",
  },
  { code: "transfer-failed", detail: "428 on the fileref upload" },
  { code: "runtime-unavailable", detail: "PROC PYTHON is not licensed" },
  { code: "backend-gone", detail: "the compute session no longer exists" },
  { code: "cancelled" },
  { code: "backend-failed", detail: "unknown error" },
];

describe("describeBackendProblem", () => {
  it("says something about every member", () => {
    for (const problem of every) {
      const described = describeBackendProblem(problem);
      assert.ok(
        described.length > 0,
        `${problem.code} described as an empty string`,
      );
    }
  });

  it("writes lower-case fragments with no trailing full stop", () => {
    // These get embedded in a longer log line by the caller, exactly as the
    // auth and compute describers do. A capital or a full stop here produces a
    // sentence broken in the middle of another one.
    for (const problem of every) {
      const described = describeBackendProblem(problem);
      assert.ok(
        !described.endsWith("."),
        `${problem.code} ends with a full stop`,
      );
      assert.ok(
        !/^[A-Z]/.test(described),
        `${problem.code} starts with a capital`,
      );
    }
  });

  it("names the run that is already going, so the user can tell which", () => {
    assert.match(
      describeBackendProblem({ code: "busy", running: "run-7" }),
      /run-7/,
    );
  });

  it("says nothing ran when the transfer failed", () => {
    // The distinction ADR-0015 pays for by not splitting the seam into `stage`
    // and `run`: this failure means the program never executed, so a retry is
    // safe. If the sentence stops saying so, the compensation for that design
    // choice has quietly gone away.
    assert.match(
      describeBackendProblem({ code: "transfer-failed", detail: "reset" }),
      /nothing ran/,
    );
  });

  it("has no member for a program that raised", () => {
    // A Python exception is a successful run with `succeeded: false`, not a
    // seam failure. Guarding it as a test rather than a comment because the
    // member someone would add is plausible enough to survive review.
    const codes = every.map((problem) => problem.code);
    for (const suspect of ["program-failed", "exception", "traceback"]) {
      assert.ok(
        !codes.includes(suspect as BackendProblem["code"]),
        `${suspect} should not be a BackendProblem`,
      );
    }
  });
});

describe("fail", () => {
  it("fills the reason from the problem", () => {
    const failure = fail({ code: "not-connected" });
    assert.equal(failure.reason, "the backend is not connected");
    assert.deepEqual(failure.problem, { code: "not-connected" });
  });

  it("puts the caller's context in front", () => {
    const failure = fail({ code: "cancelled" }, "running run-2");
    assert.equal(failure.reason, "running run-2: the run was cancelled");
  });

  it("is assignable to a result of any value type", () => {
    // The reason `BackendFailure` is named separately from `BackendResult`: a
    // failure carries nothing of the value type, so it can be returned from a
    // function whose success type is something else entirely. This compiles or
    // it does not; there is nothing to assert beyond that.
    const asVoid: BackendResult<void> = fail({ code: "cancelled" });
    const asHandleId: BackendResult<string> = fail({ code: "cancelled" });
    assert.ok(!asVoid.ok);
    assert.ok(!asHandleId.ok);
  });
});
