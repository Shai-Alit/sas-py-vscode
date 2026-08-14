// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type AuthProblem,
  describeAuthProblem,
  redactSecrets,
  redactText,
} from "../../src/auth/problems";

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
  { code: "session-expired" },
  { code: "session-expired", description: "Access token expired" },
  { code: "not-authenticated" },
  { code: "identity-unavailable", detail: "406 for the summary media type" },
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

const VERIFIER = "verifier-held-in-memory";

describe("redactText", () => {
  it("replaces every occurrence of every secret", () => {
    assert.equal(
      redactText(`a ${VERIFIER} b ${VERIFIER} c secret`, [VERIFIER, "secret"]),
      "a [redacted] b [redacted] c [redacted]",
    );
  });

  it("skips the empty secret", () => {
    // A public client's secret is "". Splitting on it would put [redacted]
    // between every pair of characters in the message.
    assert.equal(redactText("nothing to hide", [""]), "nothing to hide");
  });

  it("substitutes rather than deletes", () => {
    // An emptied field reads as "the server said nothing", which is a different
    // and misleading diagnosis. The marker says a value was removed on purpose.
    assert.match(redactText(VERIFIER, [VERIFIER]), /\[redacted\]/);
  });
});

describe("redactSecrets", () => {
  it("scrubs the OAuth description SASLogon echoes the verifier into", () => {
    assert.deepEqual(
      redactSecrets(
        {
          code: "oauth-rejected",
          error: "invalid_grant",
          description: `Invalid code verifier: ${VERIFIER}`,
        },
        [VERIFIER],
      ),
      {
        code: "oauth-rejected",
        error: "invalid_grant",
        description: "Invalid code verifier: [redacted]",
      },
    );
  });

  it("scrubs an expiry description too", () => {
    assert.deepEqual(
      redactSecrets({ code: "session-expired", description: VERIFIER }, [
        VERIFIER,
      ]),
      { code: "session-expired", description: "[redacted]" },
    );
  });

  it("returns the same object when there is nothing to scrub", () => {
    // Identity, not equality: the common path allocates nothing, and a caller
    // can tell whether anything was removed.
    const clean: AuthProblem = {
      code: "oauth-rejected",
      error: "invalid_grant",
      description: "Authorization code expired",
    };
    assert.equal(redactSecrets(clean, [VERIFIER]), clean);

    const bare: AuthProblem = {
      code: "oauth-rejected",
      error: "invalid_grant",
    };
    assert.equal(redactSecrets(bare, [VERIFIER]), bare);

    const ours: AuthProblem = { code: "state-mismatch" };
    assert.equal(redactSecrets(ours, [VERIFIER]), ours);
  });

  it("never scrubs text this process wrote", () => {
    // `deployment` and `detail` are ours, not the server's. Redacting them
    // would delete the diagnosis to protect a value that was never a secret —
    // so a secret list that happens to match them changes nothing.
    for (const problem of every) {
      assert.equal(redactSecrets(problem, ["Viya", "ECONNREFUSED"]), problem);
    }
  });
});
