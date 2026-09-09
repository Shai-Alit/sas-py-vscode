// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ComputeProblem,
  describeComputeProblem,
} from "../../src/compute/problems";

/**
 * The claim worth testing here is that {@link describeComputeProblem} is total —
 * the `switch` has no `default`, so a missing case is a compile error, but only
 * the runtime half proves none of them returns nothing.
 *
 * The `application/vnd.sas.error+json` envelope reader that used to live
 * alongside this — {@link describeViyaError}, {@link readViyaError} — moved to
 * `src/wire/` in Phase 6a-i (ADR-0025); its tests are in
 * `test/unit/wire-viya-error.test.ts`.
 */

/** One of every member of the union, so the exhaustiveness claim is exercised. */
const every: ComputeProblem[] = [
  { code: "compute-unreachable", detail: "ECONNREFUSED" },
  { code: "unauthorized", problem: { code: "session-expired" } },
  {
    code: "unauthorized",
    problem: { code: "not-authenticated" },
  },
  { code: "forbidden", error: { status: 403 } },
  { code: "session-gone", error: { status: 404, errorCode: 5837 } },
  { code: "compute-rejected", error: { status: 500 } },
  { code: "response-malformed", detail: "no id field in the session response" },
  { code: "link-missing", rel: "execute", resource: "compute session" },
  {
    code: "foreign-link",
    rel: "self",
    href: "https://elsewhere.example/collect",
  },
];

describe("describeComputeProblem", () => {
  it("answers for every member of the union", () => {
    for (const problem of every) {
      const described = describeComputeProblem(problem);
      assert.equal(typeof described, "string");
      assert.ok(described.length > 0, `empty description for ${problem.code}`);
    }
  });

  it("writes lower-case fragments with no trailing full stop", () => {
    // The convention `describeProblem` in src/profile/model.ts set and
    // `describeAuthProblem` follows: the caller embeds these in a longer line.
    for (const problem of every) {
      const described = describeComputeProblem(problem);
      assert.ok(
        !described.endsWith("."),
        `"${described}" should not end in a full stop`,
      );
      assert.equal(described[0], described[0]?.toLowerCase());
    }
  });

  it("delegates a 401 to the auth module rather than re-diagnosing it", () => {
    // The runbook item this satisfies: 1c already tells a dead token apart from
    // a request that carried no credentials, and that verdict is what travels.
    // If these two ever read the same, the delegation has been lost.
    const expired = describeComputeProblem({
      code: "unauthorized",
      problem: { code: "session-expired", description: "Access token expired" },
    });
    const missing = describeComputeProblem({
      code: "unauthorized",
      problem: { code: "not-authenticated" },
    });

    assert.match(expired, /no longer active/);
    assert.match(expired, /Access token expired/);
    assert.match(missing, /without credentials/);
    assert.notEqual(expired, missing);
  });

  it("names the status on an unclassified rejection", () => {
    assert.match(
      describeComputeProblem({
        code: "compute-rejected",
        error: { status: 503 },
      }),
      /HTTP 503/,
    );
  });

  it("reports a refused link with the href the server actually sent", () => {
    // Whoever reads this log needs to see where the deployment tried to send a
    // request carrying their bearer token.
    assert.match(
      describeComputeProblem({
        code: "foreign-link",
        rel: "next",
        href: "//elsewhere.example/collect",
      }),
      /elsewhere\.example/,
    );
  });
});
