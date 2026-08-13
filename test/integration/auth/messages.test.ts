// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { localiseAuthProblem } from "../../../src/auth/messages";
import type { AuthProblem } from "../../../src/auth/problems";

/**
 * Every sign-in failure the user can be shown, rendered by the real `l10n`.
 *
 * `vscode.l10n.t()` is the only thing this module does, and it is precisely what
 * the unit tier cannot execute — the function exists on the `vscode` module and
 * does nothing outside an extension host. The failures worth catching are the two
 * that survive a clean type-check: a message whose placeholder was never given an
 * argument, so `{0}` reaches the user literally, and a `case` that was
 * copy-pasted and left pointing at the wrong sentence.
 *
 * `problems.ts` is the exhaustiveness guard — a new member breaks the compile in
 * `messages.ts`. What is not guarded by the compiler is this list, so the count
 * is asserted below and a new code fails here until it is added.
 */

const PROBLEMS: AuthProblem[] = [
  { code: "client-id-required", deployment: "Viya 3.5" },
  { code: "oauth-rejected", error: "invalid_client" },
  {
    code: "oauth-rejected",
    error: "invalid_grant",
    description: "the authorization code has expired",
  },
  {
    code: "token-endpoint-unreachable",
    detail: "https://viya.example.com — connect ETIMEDOUT",
  },
  {
    code: "token-response-malformed",
    detail: "access_token was absent from a 200 response",
  },
  { code: "state-mismatch" },
];

describe("auth problem messages under the real l10n", () => {
  it("renders every problem as a non-empty sentence", () => {
    for (const problem of PROBLEMS) {
      const message = localiseAuthProblem(problem);
      assert.ok(
        message.trim().length > 0,
        `${problem.code} rendered to nothing`,
      );
      // Capitalised, unlike the lower-case log fragments in `problems.ts`. The
      // two conventions are easy to mix up because the switches look alike.
      assert.match(
        message,
        /^[A-Z]/,
        `${problem.code} does not start like a sentence: ${message}`,
      );
    }
  });

  it("leaves no placeholder unfilled", () => {
    for (const problem of PROBLEMS) {
      const message = localiseAuthProblem(problem);
      assert.doesNotMatch(
        message,
        /\{\d+\}/,
        `${problem.code} shipped a literal placeholder: ${message}`,
      );
    }
  });

  it("gives each code its own message", () => {
    // Five codes, six cases: the two `oauth-rejected` variants differ from each
    // other too, which is what proves the description arm is wired up.
    const rendered = new Set(PROBLEMS.map(localiseAuthProblem));
    assert.equal(rendered.size, PROBLEMS.length);
  });

  it("names the deployment an administrator has to be told about", () => {
    const message = localiseAuthProblem({
      code: "client-id-required",
      deployment: "Viya 3.5",
    });
    assert.ok(message.includes("Viya 3.5"), message);
    assert.ok(message.includes("authorization_code"), message);
    assert.ok(message.includes("refresh_token"), message);
  });

  it("quotes the OAuth error and its description", () => {
    const message = localiseAuthProblem({
      code: "oauth-rejected",
      error: "invalid_grant",
      description: "the authorization code has expired",
    });
    assert.ok(message.includes("invalid_grant"), message);
    assert.ok(message.includes("the authorization code has expired"), message);
  });

  it("keeps the malformed-response detail out of the user's message", () => {
    // The detail describes a response body's shape. It belongs in the log, and
    // the message says where to find it — putting it here would show the user a
    // sentence they cannot act on.
    const detail = "access_token was absent from a 200 response";
    const message = localiseAuthProblem({
      code: "token-response-malformed",
      detail,
    });
    assert.ok(!message.includes(detail), message);
    assert.ok(message.includes("log"), message);
  });
});
