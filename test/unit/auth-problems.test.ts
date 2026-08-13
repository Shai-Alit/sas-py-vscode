// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { type AuthProblem, describeAuthProblem } from "../../src/auth/problems";

/**
 * These sentences go to the output channel, and from there into issue reports
 * people paste in public. So the test that matters is not the wording — it is
 * that every branch is total and that none of them can be handed a credential and
 * print it.
 */

/** One of every member of the union, so the exhaustiveness claim is exercised. */
const every: AuthProblem[] = [
  { code: "client-id-required", deployment: "Viya 3.5" },
  { code: "oauth-rejected", error: "invalid_grant" },
  { code: "oauth-rejected", error: "invalid_grant", description: "expired" },
  { code: "token-endpoint-unreachable", detail: "ECONNREFUSED" },
  { code: "token-response-malformed", detail: "no access_token field" },
  { code: "state-mismatch" },
];

describe("describeAuthProblem", () => {
  it("answers for every member of the union", () => {
    // If a code is added without a case, the switch stops type-checking — this
    // asserts the runtime half: no member returns undefined or an empty string.
    for (const problem of every) {
      const described = describeAuthProblem(problem);
      assert.equal(typeof described, "string");
      assert.ok(described.length > 0, `empty description for ${problem.code}`);
    }
  });

  it("writes lower-case fragments with no trailing full stop", () => {
    // The convention `describeProblem` in src/profile/model.ts sets: these get
    // embedded into a longer log line by the caller.
    for (const problem of every) {
      const described = describeAuthProblem(problem);
      assert.ok(
        !described.endsWith("."),
        `"${described}" should not end in a full stop`,
      );
      assert.equal(described[0], described[0]?.toLowerCase());
    }
  });

  it("names the deployment on a missing client id", () => {
    assert.match(
      describeAuthProblem({
        code: "client-id-required",
        deployment: "Viya 3.5",
      }),
      /Viya 3\.5/,
    );
  });

  it("includes the OAuth description only when there is one", () => {
    assert.equal(
      describeAuthProblem({ code: "oauth-rejected", error: "invalid_client" }),
      "the deployment rejected the sign-in: invalid_client",
    );
    assert.match(
      describeAuthProblem({
        code: "oauth-rejected",
        error: "invalid_client",
        description: "Bad client credentials",
      }),
      /invalid_client \(Bad client credentials\)/,
    );
  });

  it("explains a discarded callback in terms of what was wrong with it", () => {
    // The user sees a sign-in that did nothing. Without this line there is no
    // evidence anywhere that a callback arrived and was rejected on purpose.
    assert.match(describeAuthProblem({ code: "state-mismatch" }), /state/);
    assert.match(describeAuthProblem({ code: "state-mismatch" }), /discarded/);
  });
});
