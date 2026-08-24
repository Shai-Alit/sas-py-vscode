// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { localiseComputeProblem } from "../../../src/compute/messages";
import type { ComputeProblem } from "../../../src/compute/problems";

/**
 * Every compute failure the user can be shown, rendered by the real `l10n`.
 *
 * The same suite as `auth/messages.test.ts`, for the same reason: `l10n.t()`
 * exists on the `vscode` module and returns nothing useful outside an extension
 * host, so the unit tier cannot execute a single line of the module under test.
 * The compiler guarantees the switch is exhaustive; it cannot notice a
 * placeholder that was never given an argument, or a `case` copy-pasted from the
 * one above it and left pointing at the wrong sentence.
 *
 * The list below has to be maintained by hand, so its length is asserted against
 * the number of codes rendered distinctly. A new `ComputeProblem` member breaks
 * the compile in `messages.ts` and then fails here until it is added.
 */

const VIYA_ERROR = {
  status: 403,
  message: "Forbidden",
  detail: "You are not authorised to use this compute context.",
  errorCode: 5837,
  correlator: "cca95fbe-1234-4a56-8b90-0c1d2e3f4a5b",
};

const PROBLEMS: ComputeProblem[] = [
  {
    code: "compute-unreachable",
    detail: "GET /compute/contexts — connect ETIMEDOUT",
  },
  { code: "unauthorized", problem: { code: "state-mismatch" } },
  { code: "forbidden", error: VIYA_ERROR },
  { code: "session-gone", error: { status: 404, errorCode: 5837 } },
  { code: "session-not-ready", state: "pending", seconds: 300 },
  { code: "compute-rejected", error: { status: 500 } },
  { code: "response-malformed", detail: "no id in a session representation" },
  {
    code: "link-missing",
    rel: "createSession",
    resource: 'compute context "SAS Job Execution compute context"',
  },
  {
    code: "foreign-link",
    rel: "self",
    href: "https://elsewhere.example.com/x",
  },
];

describe("compute problem messages under the real l10n", () => {
  it("renders every problem as a sentence, with nothing left to fill in", () => {
    for (const problem of PROBLEMS) {
      const message = localiseComputeProblem(problem);
      assert.ok(message.trim().length > 0, `${problem.code} rendered nothing`);
      // Capitalised, unlike the lower-case fragments `describeComputeProblem`
      // writes to the log. The two switches look alike and are easy to mix up.
      assert.match(message, /^[A-Z]/, `${problem.code}: ${message}`);
      assert.doesNotMatch(
        message,
        /\{\d+\}/,
        `${problem.code} shipped a literal placeholder: ${message}`,
      );
    }
  });

  it("gives each code its own message", () => {
    assert.equal(new Set(PROBLEMS.map(localiseComputeProblem)).size, 9);
  });

  it("delegates a 401 to the sign-in wording rather than rewording it", () => {
    // The whole reason `unauthorized` carries an `AuthProblem`: slice 1c already
    // words every reading of a 401, and a second wording is how the notification
    // and the Accounts menu end up disagreeing about what is wrong.
    const message = localiseComputeProblem({
      code: "unauthorized",
      problem: { code: "client-id-required", deployment: "Viya 3.5" },
    });
    assert.ok(message.includes("Viya 3.5"), message);
  });

  it("relays the deployment's own sentence when an administrator must be told", () => {
    const message = localiseComputeProblem({
      code: "forbidden",
      error: VIYA_ERROR,
    });
    assert.ok(message.includes("administrator"), message);
    assert.ok(message.includes(VIYA_ERROR.detail), message);
    // The correlator and the error code are support's, not the user's.
    assert.ok(!message.includes(String(VIYA_ERROR.errorCode)), message);
    assert.ok(!message.includes(VIYA_ERROR.correlator), message);
  });

  it("adds no stray punctuation when there is no detail to add", () => {
    const message = localiseComputeProblem({
      code: "forbidden",
      error: { status: 403 },
    });
    assert.doesNotMatch(message, /\s$/, message);
    assert.doesNotMatch(message, /\.\s\.$/, message);
  });

  it("gives the user both numbers when a session never came up", () => {
    const message = localiseComputeProblem({
      code: "session-not-ready",
      state: "pending",
      seconds: 300,
    });
    assert.ok(message.includes("300"), message);
    assert.ok(message.includes("pending"), message);
  });

  it("keeps the malformed-response detail in the log", () => {
    const detail = "no id in a session representation";
    const message = localiseComputeProblem({
      code: "response-malformed",
      detail,
    });
    assert.ok(!message.includes(detail), message);
    assert.ok(message.includes("log"), message);
  });
});
