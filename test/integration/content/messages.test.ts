// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { localiseContentProblem } from "../../../src/content/messages";
import type { ContentProblem } from "../../../src/content/problems";

/**
 * Every SAS Content failure the user can be shown, rendered by the real
 * `l10n` — the same suite as `auth/messages.test.ts` and
 * `compute/messages.test.ts`, for the same reason: `l10n.t()` is on the
 * `vscode` module and does nothing useful outside an extension host, so the
 * unit tier cannot execute a line of the module under test. The compiler
 * guarantees the switch is exhaustive; it cannot notice a placeholder left
 * unfilled, or a `case` copied from the one above and left pointing at the
 * wrong sentence — which for `content-rejected` fans out into three sub-cases
 * on `error.status` (412/428 conflict, 404 gone, everything else generic).
 */

const VIYA_ERROR = {
  status: 403,
  message: "Forbidden",
  detail: "Ask the folder owner for read access.",
  errorCode: 9137,
  correlator: "d1e2f3a4-5678-4b90-8c12-3d4e5f6a7b8c",
};

const PROBLEMS: ContentProblem[] = [
  {
    code: "content-unreachable",
    detail: "GET /files/files/x/content — ETIMEDOUT",
  },
  { code: "content-too-large", limitBytes: 10 * 1024 * 1024 },
  { code: "unauthorized", problem: { code: "state-mismatch" } },
  { code: "forbidden", error: VIYA_ERROR },
  { code: "content-rejected", error: { status: 412, errorCode: 0 } },
  { code: "content-rejected", error: { status: 404, errorCode: 11500 } },
  { code: "content-rejected", error: { status: 500 } },
  {
    code: "content-name-rejected",
    message: 'An item named "reports" already exists in the folder.',
    suggestion: "reports (1)",
  },
  { code: "content-name-rejected", message: "that name is reserved" },
  { code: "response-malformed", detail: "a file representation with no size" },
  {
    code: "link-missing",
    rel: "updateContent",
    resource: 'file "analysis.py"',
  },
  { code: "foreign-link", rel: "content", href: "https://elsewhere.example/x" },
];

describe("content problem messages under the real l10n", () => {
  it("renders every problem as a sentence, with nothing left to fill in", () => {
    for (const problem of PROBLEMS) {
      const message = localiseContentProblem(problem);
      assert.ok(message.trim().length > 0, `${problem.code} rendered nothing`);
      assert.match(message, /^[A-Z]/, `${problem.code}: ${message}`);
      assert.doesNotMatch(
        message,
        /\{\d+\}/,
        `${problem.code} shipped a literal placeholder: ${message}`,
      );
    }
  });

  it("gives the 412 and 428 preconditions one shared 'reopen it' message", () => {
    const conflict412 = localiseContentProblem({
      code: "content-rejected",
      error: { status: 412 },
    });
    const conflict428 = localiseContentProblem({
      code: "content-rejected",
      error: { status: 428 },
    });
    assert.equal(conflict412, conflict428);
    assert.match(conflict412, /changed on the server/);
    assert.match(conflict412, /open it again/);
  });

  it("tells the user a 404 means the file is gone, not that a request failed", () => {
    const message = localiseContentProblem({
      code: "content-rejected",
      error: { status: 404 },
    });
    assert.match(message, /no longer exists/);
    assert.doesNotMatch(message, /HTTP 404/);
  });

  it("falls through to a generic HTTP message for any other rejection status", () => {
    const message = localiseContentProblem({
      code: "content-rejected",
      error: { status: 500, detail: "the folder service is unavailable" },
    });
    assert.match(message, /HTTP 500/);
    assert.match(message, /the folder service is unavailable/);
  });

  it("tells the user a too-large file is a size limit, with the limit in MB", () => {
    const message = localiseContentProblem({
      code: "content-too-large",
      limitBytes: 10 * 1024 * 1024,
    });
    assert.match(message, /too large/);
    assert.match(message, /10 MB/);
    assert.doesNotMatch(message, /proxy/);
  });

  it("delegates a 401 to the sign-in wording rather than rewording it", () => {
    const message = localiseContentProblem({
      code: "unauthorized",
      problem: { code: "client-id-required", deployment: "Viya 4 2022.05" },
    });
    assert.ok(message.includes("Viya 4 2022.05"), message);
  });

  it("relays the deployment's own sentence on a forbidden, but not the codes", () => {
    const message = localiseContentProblem({
      code: "forbidden",
      error: VIYA_ERROR,
    });
    assert.ok(message.includes(VIYA_ERROR.detail), message);
    assert.ok(!message.includes(String(VIYA_ERROR.errorCode)), message);
    assert.ok(!message.includes(VIYA_ERROR.correlator), message);
  });

  it("relays the deployment's own name-rejection sentence and its suggestion", () => {
    const withSuggestion = localiseContentProblem({
      code: "content-name-rejected",
      message: 'An item named "reports" already exists.',
      suggestion: "reports (1)",
    });
    assert.match(withSuggestion, /An item named "reports" already exists\./);
    assert.match(withSuggestion, /reports \(1\)/);

    const withoutSuggestion = localiseContentProblem({
      code: "content-name-rejected",
      message: "that name is reserved",
    });
    assert.match(withoutSuggestion, /that name is reserved/);
    assert.doesNotMatch(withoutSuggestion, /Try "/);
  });

  it("adds no stray punctuation when a forbidden has no detail", () => {
    const message = localiseContentProblem({
      code: "forbidden",
      error: { status: 403 },
    });
    assert.doesNotMatch(message, /\s$/, message);
    assert.doesNotMatch(message, /\.\s\.$/, message);
  });
});
