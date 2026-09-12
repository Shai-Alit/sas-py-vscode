// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { describeCasProblem, type CasProblem } from "../../src/cas/problems";

/**
 * `describeCasProblem` writes the lower-case log fragment the CAS browsing
 * tree logs on a failed listing. Mirrors `content-problems.test.ts` — every
 * variant, and the `ViyaError` clause each carries.
 */
describe("cas/problems describeCasProblem", () => {
  const cases: readonly [CasProblem, RegExp][] = [
    [
      {
        code: "cas-unreachable",
        detail: "GET /casManagement/servers — ECONNRESET",
      },
      /could not reach the CAS management service: GET .*ECONNRESET/,
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
      /not permitted to read this CAS resource \(user is not authorized\)/,
    ],
    [
      {
        code: "cas-rejected",
        error: { status: 404, message: "Not Found", errorCode: 12204 },
      },
      /returned HTTP 404 \(Not Found, error code 12204\)/,
    ],
    [
      { code: "response-malformed", detail: "carried no items array" },
      /answered with something unexpected: carried no items array/,
    ],
    [
      {
        code: "link-missing",
        rel: "caslibs",
        resource: 'CAS server "cas-shared-default"',
      },
      /the CAS server "cas-shared-default" carried no "caslibs" link/,
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
      assert.match(describeCasProblem(problem), expected);
    });
  }
});
