// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { describeDataProblem, type DataProblem } from "../../src/data/problems";

/**
 * `describeDataProblem` writes the lower-case log fragment the SAS Libraries
 * tree logs on a failed listing. The `compute` variant delegates to
 * `describeComputeProblem` rather than re-diagnosing it — this test only
 * pins that the delegation actually happens, not `describeComputeProblem`'s
 * own coverage (`compute-problems.test.ts` already owns that).
 */
describe("data/problems describeDataProblem", () => {
  const cases: readonly [DataProblem, RegExp][] = [
    [
      { code: "not-connected" },
      /no active SAS Viya session for browsing libraries/,
    ],
    [
      { code: "session-busy" },
      /running Python and cannot be browsed right now/,
    ],
    [
      {
        code: "compute",
        problem: { code: "session-gone", error: { status: 404 } },
      },
      /the compute session is no longer available/,
    ],
    [
      {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "tables",
          resource: 'library "WORK"',
        },
      },
      /the library "WORK" carried no "tables" link/,
    ],
  ];

  for (const [problem, expected] of cases) {
    it(`describes ${problem.code}`, () => {
      assert.match(describeDataProblem(problem), expected);
    });
  }
});
