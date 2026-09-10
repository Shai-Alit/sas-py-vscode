// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  describeContentProblem,
  type ContentProblem,
} from "../../src/content/problems";

/**
 * `describeContentProblem` writes the lower-case log fragment the read-only
 * tree logs on a failed listing. Mirrors `compute-problems.test.ts` — every
 * variant, and the `ViyaError` clause each carries.
 */
describe("content/problems describeContentProblem", () => {
  const cases: readonly [ContentProblem, RegExp][] = [
    [
      {
        code: "content-unreachable",
        detail: "GET /folders/folders/@myFolder — ECONNRESET",
      },
      /could not reach the SAS Content service: GET .*ECONNRESET/,
    ],
    [
      { code: "unauthorized", problem: { code: "not-authenticated" } },
      /refused the request:/,
    ],
    [
      {
        code: "unauthorized",
        problem: { code: "not-authenticated" },
        noSession: true,
      },
      /^no active SAS Viya session for this deployment$/,
    ],
    [
      {
        code: "forbidden",
        error: { status: 403, detail: "user is not authorized" },
      },
      /not permitted to read this content \(user is not authorized\)/,
    ],
    [
      {
        code: "content-rejected",
        error: { status: 404, message: "Not Found", errorCode: 11500 },
      },
      /returned HTTP 404 \(Not Found, error code 11500\)/,
    ],
    [
      { code: "response-malformed", detail: "carried no items array" },
      /answered with something unexpected: carried no items array/,
    ],
    [
      { code: "link-missing", rel: "members", resource: 'folder "reports"' },
      /the folder "reports" carried no "members" link/,
    ],
    [
      {
        code: "foreign-link",
        rel: "self",
        href: "https://elsewhere.example/x",
      },
      /pointed outside this deployment and was not followed: https:\/\/elsewhere\.example\/x/,
    ],
  ];

  for (const [problem, expected] of cases) {
    const label =
      problem.code === "unauthorized" && problem.noSession === true
        ? "unauthorized (noSession)"
        : problem.code;
    it(`describes ${label}`, () => {
      assert.match(describeContentProblem(problem), expected);
    });
  }
});
